/* cloud.js – מחבר את האפליקציה למאגר הענן של 04 (סופאבייס), באותו ממשק שהארטיפקט נותן:
   window.claude.use("db" | "user" | "downloads").
   נטען רק בגרסת האתר (site/). בארטיפקט הוא לא קיים, והאפליקציה עובדת כמו קודם.

   שרשרת הקריאה:
     1. זרם חי (שינויים נדחפים מהענן)
     2. שאילה כל 10 שניות, כשהזרם לא מחובר
     3. התמונה האחרונה מהטלפון, כשאין רשת בכלל
   הכתיבה: נכשלת בלי רשת → האפליקציה שומרת בטלפון ושולחת אחר כך (קיים בה).

   הגדרות: window.SCOUT_CLOUD = { url, anonKey } בקובץ config.js. המפתח הציבורי מותר בקוד (החלטה 03). */
(function(){
"use strict";
const CFG=window.SCOUT_CLOUD||{};
const POLL_MS=10000,SAFETY_MS=60000,CACHE="a9662-cache:";
const listeners=new Set();
const state={mode:"connecting",since:Date.now(),lastOk:0,role:null,uid:null,name:"",error:""};
function setMode(m,err){if(state.mode!==m){state.mode=m;state.since=Date.now();}state.error=err||"";
  for(const f of listeners)try{f({...state});}catch(e){}
  try{window.dispatchEvent(new CustomEvent("cloud-status",{detail:{...state}}));}catch(e){}}
const cacheGet=k=>{try{return JSON.parse(localStorage.getItem(CACHE+k)||"null");}catch(e){return null;}};
const cacheSet=(k,v)=>{try{localStorage.setItem(CACHE+k,JSON.stringify(v));}catch(e){}};
const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
const CODES=["not_found","permission_denied","bad_code","too_big","not_configured","unavailable","rate_limited"];
function errCode(e){
  /* שגיאה שכבר עטופה (fail) שומרת על הקוד שלה */
  if(e&&CODES.includes(e.code))return e.code;
  const m=String(e&&(e.message||e.code||e)||"");
  if(/not_found/.test(m))return "not_found";
  if(/row-level security|permission|42501|not_manager|PGRST301|JWT/i.test(m))return "permission_denied";
  if(/bad_code/.test(m))return "bad_code";
  if(/too_big/.test(m))return "too_big";
  if(/rate_limited/.test(m))return "rate_limited";
  if(/not_configured/.test(m))return "not_configured";
  /* "Load failed" – כך ספארי באייפון מדווח על רשת בלי אינטרנט */
  if(/Failed to fetch|NetworkError|network|fetch|timeout|abort|ECONN|Load failed/i.test(m)||navigator.onLine===false)return "unavailable";
  return "unknown";
}
const fail=e=>{const c=errCode(e);const o=new Error(c);o.code=c;o.cause=e;return o;};

let client=null;
function sb(){
  if(client)return client;
  if(!CFG.url||!CFG.anonKey||!window.supabase)throw fail("not_configured");
  /* כל בקשה נחתכת אחרי 10 שניות, כדי שבקשה תקועה לא תעצור את השליחה */
  const tfetch=(u,o)=>{const c=new AbortController();const t=setTimeout(()=>c.abort(),10000);
    if(o&&o.signal)o.signal.addEventListener("abort",()=>c.abort());
    return fetch(u,{...(o||{}),signal:c.signal}).finally(()=>clearTimeout(t));};
  client=CFG.client||window.supabase.createClient(CFG.url,CFG.anonKey,{auth:{persistSession:true,autoRefreshToken:true,storageKey:"a9662-auth"},realtime:{params:{eventsPerSecond:5}},global:{fetch:tfetch}});
  return client;
}

/* ── קריאות ── */
const watchers=new Set(); /* {kind:"doc"|"col", key, cb, err} */
function snapDoc(path,row,fromCache){return {exists:!!row,id:path.split("/")[1],data:()=>clone(row?row.data:undefined),metadata:{fromCache:!!fromCache}};}
function snapCol(rows,fromCache){return {docs:rows.map(r=>({id:r.doc_id,data:()=>clone(r.data)})),empty:!rows.length,size:rows.length,metadata:{fromCache:!!fromCache}};}
/* אוסף: קודם רק הנתיבים וזמני העדכון (קטן), ואז התוכן רק של מה שהשתנה מאז הפעם הקודמת.
   בלי זה כל שינוי של סקאוטר אחד הוריד מחדש את כל הרשומות של כולם */
const lastCol=new Map();
async function fetchKey(kind,key){
  if(kind==="doc"){
    const {data,error}=await sb().from("docs").select("path,doc_id,data,updated_at").eq("path",key).limit(1);
    if(error)throw error;return data[0]||null;
  }
  let prev=lastCol.get(key)||cacheGet("col:"+key);if(!Array.isArray(prev))prev=[];
  const byPath=new Map(prev.map(r=>[r.path,r]));
  const {data:heads,error}=await sb().from("docs").select("path,updated_at").eq("coll",key);
  if(error)throw error;
  heads.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  const need=heads.filter(h=>{const o=byPath.get(h.path);return !o||o.updated_at!==h.updated_at;}).map(h=>h.path);
  const fresh=new Map();
  for(let i=0;i<need.length;i+=40){
    const {data,error:e2}=await sb().from("docs").select("path,doc_id,data,updated_at").in("path",need.slice(i,i+40));
    if(e2)throw e2;for(const r of data)fresh.set(r.path,r);
  }
  const rows=heads.map(h=>fresh.get(h.path)||byPath.get(h.path)).filter(Boolean);
  lastCol.set(key,rows);return rows;
}
const inflight=new Map(),again=new Set();
async function refresh(kind,key){
  /* משיכה שכבר בדרך התחילה לפני השינוי: מסמנים להריץ עוד אחת כשהיא נגמרת, כדי לא לפספס אותו */
  const id=kind+":"+key;if(inflight.has(id)){again.add(id);return inflight.get(id);}
  const p=(async()=>{
    try{
      const v=await fetchKey(kind,key);
      const sig=JSON.stringify(kind==="doc"?(v&&[v.updated_at,v.data]):v.map(r=>[r.path,r.updated_at]));
      cacheSet(id,v);state.lastOk=Date.now();
      if(state.mode==="offline")setMode(rtLive?"live":"poll");
      /* לא מעדכנים מאזין שכבר קיבל בדיוק את אותו מצב – אחרת הבדיקה כל דקה מציירת את כל המסך מחדש */
      for(const w of watchers)if(w.kind===kind&&w.key===key&&w.sig!==sig){w.sig=sig;w.cb(kind==="doc"?snapDoc(key,v,false):snapCol(v,false));}
    }catch(e){
      const c=errCode(e);
      if(c==="unavailable"){setMode("offline");}
      else for(const w of watchers)if(w.kind===kind&&w.key===key&&w.err)try{w.err(fail(e));}catch(_){}
    }finally{inflight.delete(id);if(again.delete(id))refresh(kind,key);}
  })();
  inflight.set(id,p);return p;
}
function refreshAll(){const seen=new Set();for(const w of watchers){const id=w.kind+":"+w.key;if(!seen.has(id)){seen.add(id);refresh(w.kind,w.key);}}}
function watch(kind,key,cb,err){
  const w={kind,key,cb,err};watchers.add(w);
  const c=cacheGet(kind+":"+key);
  if(c!==null)setTimeout(()=>{if(watchers.has(w))cb(kind==="doc"?snapDoc(key,c,true):snapCol(c,true));},0);
  ready.then(()=>{startRealtime();refresh(kind,key);}).catch(e=>{if(err)err(fail(e));});
  return ()=>watchers.delete(w);
}

/* ── זרם חי, ושאילה כשהוא לא מחובר ── */
let rtChan=null,rtLive=false,pollT=null,safetyT=null,rtDeb=new Map();
function onChange(row){
  if(!row)return;const path=row.path||"";const coll=path.split("/")[0];
  for(const [kind,key] of [["doc",path],["col",coll]]){
    const id=kind+":"+key;if(![...watchers].some(w=>w.kind===kind&&w.key===key))continue;
    clearTimeout(rtDeb.get(id));rtDeb.set(id,setTimeout(()=>refresh(kind,key),250));
  }
}
function startRealtime(){
  if(rtChan)return;
  try{
    rtChan=sb().channel("docs-"+Math.random().toString(36).slice(2,8))
      .on("postgres_changes",{event:"*",schema:"public",table:"docs"},p=>onChange(p.new&&p.new.path?p.new:p.old))
      .subscribe(st=>{
        if(st==="SUBSCRIBED"){rtLive=true;setMode("live");refreshAll();}
        else if(["CHANNEL_ERROR","TIMED_OUT","CLOSED"].includes(st)){rtLive=false;if(state.mode!=="offline")setMode("poll");}
      });
  }catch(e){rtLive=false;setMode("poll");}
  clearInterval(pollT);pollT=setInterval(()=>{if(!rtLive)refreshAll();},POLL_MS);
  clearInterval(safetyT);safetyT=setInterval(refreshAll,SAFETY_MS);
  /* אם הזרם לא עלה תוך 8 שניות – שאילה */
  setTimeout(()=>{if(!rtLive&&state.mode==="connecting")setMode("poll");},8000);
}
window.addEventListener("online",()=>{refreshAll();});
window.addEventListener("offline",()=>setMode("offline"));
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")refreshAll();});

/* ── כתיבה ── */
async function write(path,data,mode){
  await ready;
  if(navigator.onLine===false)throw fail("unavailable");
  const {error}=await sb().rpc("doc_write",{p_path:path,p_data:data,p_mode:mode});
  if(error){
    /* הכתיבה נכשלה: המסך כבר הציג את השינוי, אז שולחים שוב את מה שבאמת בענן */
    const coll0=path.split("/")[0];
    for(const w of watchers)if((w.kind==="doc"&&w.key===path)||(w.kind==="col"&&w.key===coll0))w.sig=undefined;
    refresh("doc",path);if([...watchers].some(w=>w.kind==="col"&&w.key===coll0))refresh("col",coll0);
    throw fail(error);
  }
  state.lastOk=Date.now();
  const coll=path.split("/")[0];refresh("doc",path);if([...watchers].some(w=>w.kind==="col"&&w.key===coll))refresh("col",coll);
}

/* ── כניסה: סקאוטר בקוד קבוצה, מנהל במייל וסיסמה ── */
let readyResolve,readyReject;const ready=new Promise((a,b)=>{readyResolve=a;readyReject=b;});ready.catch(()=>{});
const savedMember=()=>{try{return JSON.parse(localStorage.getItem("a9662-member")||"null");}catch(e){return null;}};
async function loadMember(){
  const {data:{session},error:se}=await sb().auth.getSession();
  if(!session){
    /* הטוקן פג ולא הצלחנו לחדש בגלל הרשת – ממשיכים כמו בלי רשת, לא פותחים כניסה */
    if(savedMember()&&(se||navigator.onLine===false))throw fail(se||"unavailable");
    return null;
  }
  const {data:{user},error:ue}=await sb().auth.getUser();if(ue&&errCode(ue)==="unavailable")throw ue;if(!user)return null;
  state.uid=user.id;
  const {data,error}=await sb().from("members").select("role,name").eq("uid",user.id).limit(1);
  if(error)throw error;
  if(!data.length)return null;
  /* סקאוטר שהמנהל הסיר: לא נכנס. מסך הכניסה יגיד לו לפנות למנהל */
  if(data[0].role==="removed"){state.removed=true;return null;}
  state.role=data[0].role;state.name=data[0].name||"";
  try{localStorage.setItem("a9662-member",JSON.stringify({uid:user.id,role:state.role,name:state.name}));}catch(e){}
  return data[0];
}
const domReady=()=>document.body?Promise.resolve():new Promise(r=>document.addEventListener("DOMContentLoaded",r,{once:true}));
/* עובד רקע: האפליקציה נפתחת גם בלי רשת (רק באתר עצמו, בכתובת מאובטחת) */
try{if("serviceWorker" in navigator&&(location.protocol==="https:"||location.hostname==="localhost"))addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));}catch(e){}
/* קישור איפוס סיסמה מהמייל: הסימן נמצא בכתובת לפני שהספרייה קוראת ומנקה אותה */
const H0=String(location.hash||"");
const RECOVERY=/type=recovery/.test(H0)&&/access_token=/.test(H0);
const LINK_ERR=/error_code=otp_expired|error=access_denied/.test(H0);
const SITE=location.origin+location.pathname;
const GATE_CSS=`#cloudGate{--g-bg:var(--bg,#EDF1EE);--g-card:var(--surface,#fff);--g-ink:var(--ink,#12201A);--g-muted:var(--muted,#536359);--g-line:var(--line,#D0DAD3);--g-sunk:var(--sunk,#E2E8E4);
    --g-honey:var(--honey,#B27800);--g-on:var(--on-honey,#2E1F00);--g-soft:var(--honey-soft,#F6E4B0);--g-bad:var(--bad,#B72C2C);--g-good:var(--good,#1F7F55);
    position:fixed;inset:0;z-index:9999;overflow:auto;display:grid;place-items:center;padding:24px 16px;color:var(--g-ink);
    font:16px/1.45 var(--f-body,"Assistant",system-ui,sans-serif);
    background:radial-gradient(120% 70% at 50% -10%,var(--g-soft),transparent 60%),var(--g-bg)}
  #cloudGate *{box-sizing:border-box}
  #cloudGate .cg-card{width:min(400px,100%);background:var(--g-card);border:1px solid var(--g-line);border-radius:22px;padding:24px 22px 20px;display:grid;gap:16px;
    box-shadow:0 1px 0 rgba(18,32,26,.04),0 24px 48px -28px rgba(18,32,26,.45)}
  #cloudGate .cg-head{display:flex;align-items:center;gap:12px}
  #cloudGate .cg-mark{width:46px;height:46px;flex:none}
  #cloudGate h2{margin:0;font:400 24px/1.1 var(--f-display,"Secular One",system-ui,sans-serif)}
  #cloudGate .cg-sub{margin:2px 0 0;color:var(--g-muted);font-size:14px}
  #cloudGate .cg-tabs{display:grid;grid-template-columns:1fr 1fr;background:var(--g-sunk);border-radius:12px;padding:4px;gap:4px}
  #cloudGate .cg-tabs button{min-height:44px;border:0;border-radius:9px;background:transparent;color:var(--g-muted);font:700 15px var(--f-body,system-ui);cursor:pointer}
  #cloudGate .cg-tabs button[aria-selected="true"]{background:var(--g-card);color:var(--g-ink);box-shadow:0 1px 3px rgba(0,0,0,.12)}
  #cloudGate form{display:grid;gap:14px}
  #cloudGate label{display:grid;gap:6px;font-weight:700;font-size:15px}
  #cloudGate .cg-hint{font-weight:400;color:var(--g-muted);font-size:13px}
  #cloudGate input{font:inherit;font-size:17px;min-height:50px;padding:10px 14px;border:1.5px solid var(--g-muted);border-radius:12px;background:var(--g-card);color:var(--g-ink);width:100%}
  #cloudGate input:focus{outline:3px solid var(--g-honey);outline-offset:1px;border-color:var(--g-honey)}
  #cloudGate input.cg-code{font-family:var(--f-num,ui-monospace,monospace);letter-spacing:.18em;text-transform:uppercase;text-align:center;font-size:20px}
  #cloudGate .cg-pw{position:relative}
  #cloudGate .cg-pw input{padding-inline-start:64px}
  #cloudGate .cg-eye{position:absolute;inset-inline-start:6px;top:50%;transform:translateY(-50%);min-height:38px;padding:0 10px;border:0;border-radius:8px;background:var(--g-sunk);color:var(--g-ink);font:600 13px var(--f-body,system-ui);cursor:pointer}
  #cloudGate .cg-go{min-height:52px;border:0;border-radius:12px;background:var(--g-honey);color:var(--g-on);font:800 19px var(--f-body,system-ui);cursor:pointer}
  #cloudGate .cg-go:disabled{opacity:.6;cursor:progress}
  #cloudGate .cg-go:focus-visible,#cloudGate .cg-tabs button:focus-visible,#cloudGate .cg-link:focus-visible{outline:3px solid var(--g-honey);outline-offset:2px}
  #cloudGate .cg-link{justify-self:start;min-height:44px;border:0;background:none;padding:6px 0;color:var(--g-muted);font:600 14px var(--f-body,system-ui);text-decoration:underline;cursor:pointer}
  #cloudGate .cg-msg{margin:0;min-height:1.3em;font-weight:600;color:var(--g-bad)}
  #cloudGate .cg-msg.ok{color:var(--g-good)}
  #cloudGate .cg-foot{margin:0;color:var(--g-muted);font-size:12.5px;text-align:center}
  #cloudGate .cg-modes{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  #cloudGate .cg-ml{grid-column:1/-1;font-weight:700;font-size:15px}
  #cloudGate .cg-mode{display:grid;gap:2px;min-height:64px;padding:10px;border:2px solid var(--g-line);border-radius:14px;background:var(--g-card);color:var(--g-ink);font:inherit;cursor:pointer;text-align:center}
  #cloudGate .cg-mode b{font-size:17px}#cloudGate .cg-mode span{font-size:13px;color:var(--g-muted)}
  #cloudGate .cg-mode[aria-pressed="true"]{border-color:var(--g-honey);background:var(--g-soft)}
  #cloudGate .cg-mode:focus-visible{outline:3px solid var(--g-honey);outline-offset:2px}
  #cloudGate [hidden]{display:none!important}`;
const HEX=`<svg class="cg-mark" viewBox="0 0 48 48" aria-hidden="true"><path d="M24 3l18 10.5v21L24 45 6 34.5v-21z" fill="var(--g-honey)"/><path d="M24 13l9 5.2v10.5L24 34l-9-5.3V18.2z" fill="var(--g-card)" opacity=".92"/><path d="M24 19.5l3.7 2.2v4.5L24 28.4l-3.7-2.2v-4.5z" fill="var(--g-honey)"/></svg>`;
const pwField=(id,ac)=>`<div class="cg-pw"><input id="${id}" type="password" required dir="ltr" autocomplete="${ac}" minlength="${ac==="new-password"?8:1}"><button type="button" class="cg-eye" data-eye="${id}" aria-label="הצגת הסיסמה">הצג</button></div>`;
async function gate(mode){
  await domReady();
  return new Promise(resolve=>{
    if(!document.getElementById("cgCss")){const css=document.createElement("style");css.id="cgCss";css.textContent=GATE_CSS;document.head.appendChild(css);}
    const box=document.createElement("div");box.id="cloudGate";box.setAttribute("dir","rtl");box.setAttribute("lang","he");
    box.innerHTML=`<div class="cg-card" role="dialog" aria-modal="true" aria-labelledby="cgTitle">
      <div class="cg-head">${HEX}<div><h2 id="cgTitle">סקאוטינג ביובאז</h2><p class="cg-sub">אפולו 9662 · חדר הנתונים של התחרות</p></div></div>
      <div class="cg-tabs" role="tablist" id="cgTabs">
        <button type="button" role="tab" id="cgTabScout" aria-selected="true" aria-controls="cgJoin">סקאוטר</button>
        <button type="button" role="tab" id="cgTabMgr" aria-selected="false" aria-controls="cgMgr">מנהל</button></div>
      <form id="cgJoin" role="tabpanel" aria-labelledby="cgTabScout" novalidate>
        <div class="cg-modes" role="group" aria-labelledby="cgModeL"><span id="cgModeL" class="cg-ml">מה עושים היום?</span>
          <button type="button" class="cg-mode" data-gmode="match" aria-pressed="false"><b>מאצ׳ים</b><span>צופים ומזינים</span></button>
          <button type="button" class="cg-mode" data-gmode="pit" aria-pressed="false"><b>פיט</b><span>שואלים את הקבוצות</span></button></div>
        <label>השם שלך<input id="cgName" maxlength="40" autocomplete="nickname" required></label>
        <label>קוד ההצטרפות <span class="cg-hint">מהמנהל. לא משנה אם באותיות גדולות או קטנות</span>
          <input id="cgCode" class="cg-code" maxlength="32" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" dir="ltr" required></label>
        <button type="submit" class="cg-go">כניסה</button></form>
      <form id="cgMgr" role="tabpanel" aria-labelledby="cgTabMgr" hidden novalidate>
        <label>מייל<input id="cgMail" type="email" required dir="ltr" autocomplete="username"></label>
        <label>סיסמה${pwField("cgPass","current-password")}</label>
        <button type="submit" class="cg-go">כניסת מנהל</button>
        <button type="button" class="cg-link" id="cgForgot">שכחתי סיסמה</button></form>
      <form id="cgReset" hidden>
        <p class="cg-sub" style="margin:0">נשלח קישור לקביעת סיסמה חדשה למייל של המנהל.</p>
        <label>מייל<input id="cgRMail" type="email" required dir="ltr" autocomplete="username"></label>
        <button type="submit" class="cg-go">שליחת קישור</button>
        <button type="button" class="cg-link" id="cgBack">חזרה לכניסה</button></form>
      <form id="cgNew" hidden>
        <p class="cg-sub" style="margin:0">קביעת סיסמה חדשה לחשבון המנהל. לפחות 8 תווים.</p>
        <label>סיסמה חדשה${pwField("cgNew1","new-password")}</label>
        <label>שוב, לאימות${pwField("cgNew2","new-password")}</label>
        <button type="submit" class="cg-go">שמירת הסיסמה</button>
        <button type="button" class="cg-link" id="cgNewCancel">ביטול, חזרה לכניסה</button></form>
      <p class="cg-msg" id="cgMsg" role="status" aria-live="polite"></p>
      <p class="cg-foot">בלי רשת? הרשומות נשמרות בטלפון ונשלחות כשהרשת חוזרת.</p></div>`;
    document.body.appendChild(box);
    const inerted=[...document.body.children].filter(el=>el!==box&&!el.inert);inerted.forEach(el=>{el.inert=true;});
    const done=()=>{inerted.forEach(el=>{el.inert=false;});box.remove();resolve();};
    const $g=id=>box.querySelector("#"+id);
    const msg=(t,ok)=>{const m=$g("cgMsg");m.textContent=t||"";m.classList.toggle("ok",!!ok);};
    const show=v=>{for(const f of ["cgJoin","cgMgr","cgReset","cgNew"])$g(f).hidden=f!==v;
      $g("cgTabs").hidden=v==="cgReset"||v==="cgNew";
      $g("cgTabScout").setAttribute("aria-selected",String(v==="cgJoin"));$g("cgTabMgr").setAttribute("aria-selected",String(v!=="cgJoin"));msg("");
      const first=$g(v).querySelector("input");if(first)setTimeout(()=>first.focus(),0);};
    /* כפתור בזמן עבודה: לא לוחצים פעמיים, ורואים שמשהו קורה */
    const busy=async(form,label,fn)=>{const b=form.querySelector(".cg-go");const t=b.textContent;b.disabled=true;b.textContent=label;
      try{await fn();}finally{b.disabled=false;b.textContent=t;}};
    /* מאצ׳ים או פיט: נשמר בטלפון, והאפליקציה פותחת ישר את הלשוניות של המצב */
    let gmode=null;try{const v=JSON.parse(localStorage.getItem("bbz-mode")||"null");if(v==="match"||v==="pit")gmode=v;}catch(e){}
    const markMode=()=>box.querySelectorAll("[data-gmode]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.gmode===gmode)));markMode();
    box.querySelectorAll("[data-gmode]").forEach(b=>b.addEventListener("click",()=>{gmode=b.dataset.gmode;markMode();msg("");}));
    if(state.removed)setTimeout(()=>msg("המנהל הסיר את החשבון הזה מהצוות. לפנות אליו כדי לחזור"),0);
    $g("cgTabScout").addEventListener("click",()=>show("cgJoin"));
    $g("cgTabMgr").addEventListener("click",()=>show("cgMgr"));
    $g("cgForgot").addEventListener("click",()=>{show("cgReset");$g("cgRMail").value=$g("cgMail").value;});
    $g("cgBack").addEventListener("click",()=>show("cgMgr"));
    $g("cgNewCancel").addEventListener("click",async()=>{try{await sb().auth.signOut({scope:"local"});}catch(e){}state.role=null;show("cgMgr");});
    /* חצים בין הלשוניות */
    $g("cgTabs").addEventListener("keydown",ev=>{if(!["ArrowLeft","ArrowRight"].includes(ev.key))return;ev.preventDefault();
      const toMgr=$g("cgTabScout")===document.activeElement;(toMgr?$g("cgTabMgr"):$g("cgTabScout")).focus();show(toMgr?"cgMgr":"cgJoin");});
    box.addEventListener("click",ev=>{const e=ev.target.closest("[data-eye]");if(!e)return;const i=$g(e.dataset.eye);const vis=i.type==="password";
      i.type=vis?"text":"password";e.textContent=vis?"הסתר":"הצג";e.setAttribute("aria-label",vis?"הסתרת הסיסמה":"הצגת הסיסמה");});
    $g("cgJoin").addEventListener("submit",ev=>{ev.preventDefault();msg("");
      if(!gmode){msg("לבחור קודם: מאצ׳ים או פיט");box.querySelector("[data-gmode]").focus();return;}
      if($g("cgName").value.trim().length<2){msg("לכתוב את השם שלך");$g("cgName").focus();return;}
      if(!$g("cgCode").value.trim()){msg("לכתוב את קוד ההצטרפות מהמנהל");$g("cgCode").focus();return;}
      try{localStorage.setItem("bbz-mode",JSON.stringify(gmode));}catch(e){}
      busy($g("cgJoin"),"נכנס…",async()=>{
      try{
        let {data:{session}}=await sb().auth.getSession();
        if(!session){const r=await sb().auth.signInAnonymously();if(r.error)throw r.error;}
        const old=savedMember();
        const {data:res,error}=await sb().rpc("join_team",{code:$g("cgCode").value.trim(),display_name:$g("cgName").value.trim()});
        if(error)throw error;
        if(res==="bad_code"){msg("הקוד לא נכון");return;}
        if(res==="rate_limited"){msg("יותר מדי ניסיונות. לנסות שוב בעוד כמה דקות");return;}
        if(res==="full"){msg("הצוות מלא. לפנות למנהל");return;}
        if(res==="removed"){msg("המנהל הסיר את החשבון הזה מהצוות. לפנות אליו כדי לחזור");return;}
        if(await loadMember()){if(old&&old.uid&&old.uid!==state.uid)migrate(old.uid,state.uid);done();}
      }catch(e){const c=errCode(e);msg(c==="unavailable"?"אין רשת. לנסות שוב, או להשתמש בגיבוי של הקבוצה":"הכניסה לא הצליחה");}});});
    $g("cgMgr").addEventListener("submit",ev=>{ev.preventDefault();msg("");
      if(!/^[^@\s]+@[^@\s]+$/.test($g("cgMail").value.trim())){msg("לכתוב את המייל של המנהל");$g("cgMail").focus();return;}
      if(!$g("cgPass").value){msg("לכתוב סיסמה");$g("cgPass").focus();return;}
      busy($g("cgMgr"),"נכנס…",async()=>{
      try{
        const {error}=await sb().auth.signInWithPassword({email:$g("cgMail").value.trim(),password:$g("cgPass").value});
        if(error)throw error;
        if(await loadMember()){done();}else msg("החשבון הזה עוד לא מוגדר כמנהל");
      }catch(e){msg(errCode(e)==="unavailable"?"אין רשת. לנסות שוב":"מייל או סיסמה לא נכונים");}});});
    /* איפוס: אותה תשובה גם למייל שלא רשום, כדי לא לחשוף אילו מיילים קיימים */
    $g("cgReset").addEventListener("submit",ev=>{ev.preventDefault();msg("");busy($g("cgReset"),"שולח…",async()=>{
      try{
        const {error}=await sb().auth.resetPasswordForEmail($g("cgRMail").value.trim(),{redirectTo:SITE});
        /* השרת עונה 200 גם למייל שלא רשום, ולכן הצגת שגיאה אמיתית לא חושפת אילו מיילים קיימים */
        if(error&&(error.status===429||/rate_limit/.test(String(error.code||""))))throw Object.assign(new Error("rate"),{code:"rate"});
        if(error)throw error;
        msg("אם המייל רשום, נשלח אליו קישור. לבדוק גם בספאם. הקישור תקף שעה.",true);
      }catch(e){msg(e.code==="rate"?"נשלח כבר מייל לפני רגע. לחכות כמה דקות ולנסות שוב":errCode(e)==="unavailable"?"אין רשת. לנסות שוב":"השליחה לא הצליחה. לנסות שוב מאוחר יותר");}});});
    $g("cgNew").addEventListener("submit",ev=>{ev.preventDefault();msg("");
      const a=$g("cgNew1").value,b=$g("cgNew2").value;
      if(a.length<8){msg("לפחות 8 תווים");return;}
      if(a!==b){msg("שתי הסיסמאות לא זהות");return;}
      busy($g("cgNew"),"שומר…",async()=>{
        try{
          const {error}=await sb().auth.updateUser({password:a});
          if(error)throw error;
          $g("cgNew1").value="";$g("cgNew2").value="";
          if(await loadMember()){done();}else{msg("הסיסמה נשמרה, אבל החשבון לא מוגדר כמנהל");}
        }catch(e){const t=String(e.code||"")+" "+String(e.message||"");
          msg(errCode(e)==="unavailable"?"אין רשת. לנסות שוב":/same_password|different from the old/i.test(t)?"זו הסיסמה הקודמת. לבחור סיסמה אחרת":/weak|short|characters/i.test(t)?"הסיסמה חלשה מדי. לבחור ארוכה יותר":"השמירה לא הצליחה. אפשר לבקש קישור חדש");}});});
    if(mode==="recovery")show("cgNew");
    else if(mode==="link_error"){show("cgReset");msg("הקישור פג או כבר נוצל. אפשר לשלוח קישור חדש");}
    else show("cgJoin");
  });
}
/* נכנסת מחדש עם מזהה חדש: הרשומות שלא נשלחו עוברות איתה, לא נשארות תקועות בטלפון */
function migrate(from,to){
  try{for(const pre of ["bbz-pending:","bbz-pitpending:","bbz-draft:","bbz-profile:"]){
    const v=localStorage.getItem(pre+from);if(v==null)continue;
    if(pre==="bbz-pending:"||pre==="bbz-pitpending:"){let a={},b={};try{a=JSON.parse(v)||{};b=JSON.parse(localStorage.getItem(pre+to)||"{}")||{};}catch(e){}
      localStorage.setItem(pre+to,JSON.stringify({...a,...b}));}
    else if(localStorage.getItem(pre+to)==null)localStorage.setItem(pre+to,v);
    localStorage.removeItem(pre+from);}}catch(e){}
}
function pendingCount(){let n=0;try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(/^bbz-(pit)?pending:/.test(k)){const o=JSON.parse(localStorage.getItem(k)||"{}");n+=Object.keys(o||{}).length;}}}catch(e){}return n;}
(async function start(){
  try{
    sb();
    let m=null;
    try{m=await loadMember();}catch(e){
      /* בלי רשת: ממשיכים עם מה שנשמר בטלפון */
      const c=errCode(e);const saved=savedMember();
      if(c==="unavailable"&&saved){state.uid=saved.uid;state.role=saved.role;state.name=saved.name;m=saved;setMode("offline");}
      else throw e;
    }
    /* הגענו מקישור איפוס: קודם קובעים סיסמה חדשה, ורק אז נכנסים. מנקים את הכתובת כדי שרענון לא יחזור לכאן */
    if(RECOVERY||LINK_ERR){try{history.replaceState(null,"",SITE);}catch(e){}}
    if(RECOVERY){const {data:{session}}=await sb().auth.getSession();await gate(session?"recovery":"link_error");m=state.role?{role:state.role}:m;}
    else if(LINK_ERR&&!m)await gate("link_error");
    else if(!m)await gate();
    readyResolve();
  }catch(e){try{console.warn("cloud start",e&&(e.message||e));}catch(_){}
    const c=errCode(e);
    /* האתר לא מחובר לענן: לא מעמידים פנים שזה "בלי רשת". אומרים מה חסר ומפנים לגיבוי */
    if(c==="not_configured")domReady().then(()=>{const d=document.createElement("div");d.setAttribute("dir","rtl");d.setAttribute("role","alert");
      d.style.cssText="position:sticky;top:0;z-index:9998;padding:14px 16px;background:#c94a3d;color:#fff;font:600 15px system-ui,sans-serif";
      d.textContent="האתר עוד לא מחובר לענן, ולכן אי אפשר לאסוף בו נתונים. להשתמש בארטיפקט ״סקאוטינג ביובאז״ ולהודיע למנהל.";document.body.prepend(d);});
    /* תקלה רגעית בכניסה (רשת של אולם, חשבון שפג): לא נתקעים על מסך טעינה – כפתור לנסות שוב */
    else domReady().then(()=>{if(document.getElementById("cgRetry"))return;const d=document.createElement("div");d.setAttribute("dir","rtl");d.setAttribute("role","alert");
      d.style.cssText="position:sticky;top:0;z-index:9998;padding:12px 16px;background:#B27800;color:#1d1400;font:600 15px system-ui,sans-serif;display:flex;gap:12px;align-items:center;flex-wrap:wrap";
      const s=document.createElement("span");s.textContent="החיבור לענן נכשל. הרשומות שכבר שמורות בטלפון לא נמחקות.";
      const b=document.createElement("button");b.id="cgRetry";b.type="button";b.textContent="לנסות שוב";b.style.cssText="min-height:44px;padding:8px 16px;border-radius:10px;border:0;font:700 15px system-ui,sans-serif;background:#1d1400;color:#fff";
      b.onclick=()=>location.reload();d.append(s,b);document.body.prepend(d);});
    setMode("offline",c);readyReject(fail(e));}
})();

/* ── הממשק שהאפליקציה מכירה ── */
const db={
  doc:path=>({
    onSnapshot:(cb,err)=>watch("doc",path,cb,err),
    set:v=>write(path,v,"set"),
    update:v=>write(path,v,"merge"),
    setFields:v=>write(path,v,"fields"),
    get:async()=>{await ready;return snapDoc(path,await fetchKey("doc",path),false);}
  }),
  collection:coll=>({onSnapshot:(cb,err)=>watch("col",coll,cb,err)})
};
const user={
  isOwner:async()=>{await ready;return state.role==="manager";},
  id:async()=>{await ready;return state.uid;},
  name:async()=>{await ready;return state.name;},
  can:async()=>{await ready;return state.role==="scout"||state.role==="manager";},
  profiles:async ids=>{
    await ready;const out={};
    try{const {data}=await sb().from("members").select("uid,name").in("uid",ids);for(const r of data||[])out[r.uid]={name:r.name};}catch(e){}
    return out;
  }
};
const downloads={save:async({filename,data,mimeType})=>{
  const blob=data instanceof Blob?data:new Blob([data],{type:mimeType||"application/octet-stream"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=filename||"download";document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1000);
}};

/* ── פרסום פרופילים לסימולטור (רק מנהל) ── */
async function publishProfiles(pkg,prev){
  await ready;if(state.role!=="manager")throw fail("permission_denied");
  const ev=pkg.event_code||"";const rows=[];const next={};
  for(const r of pkg.robots){const s=JSON.stringify(r);next[r.team]=s;if(!prev||prev[r.team]!==s)rows.push({event_code:ev,team:r.team,data:r});}
  if(rows.length){const {error}=await sb().from("sim_profiles").upsert(rows,{onConflict:"event_code,team"});if(error)throw fail(error);}
  const meta={format:pkg.format,version:pkg.version,generated_at:pkg.generated_at,event:pkg.event,event_code:ev,current_match:pkg.current_match??null,units:pkg.units,schedule:pkg.schedule,teams:pkg.robots.map(r=>r.team)};
  const {error}=await sb().from("sim_meta").upsert({event_code:ev,data:meta},{onConflict:"event_code"});
  if(error)throw fail(error);
  /* קבוצות שכבר לא בתחרות */
  if(prev){const gone=Object.keys(prev).filter(t=>!(t in next)).map(Number);if(gone.length)await sb().from("sim_profiles").delete().eq("event_code",ev).in("team",gone);}
  state.lastOk=Date.now();
  return {changed:rows.length,map:next};
}
async function setJoinCode(code){await ready;const {error}=await sb().rpc("set_join_code",{code});if(error)throw fail(error);}
/* יציאה: לא מוחקת רשומות שלא נשלחו. מוחקת את כל השאר מהטלפון (מכשיר משותף) */
async function signOut(force){
  if(!force&&pendingCount())return "pending";
  try{await sb().auth.signOut();}catch(e){}
  try{const ks=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(/^(a9662-|bbz-(draft|profile|tab))/.test(k))ks.push(k);}ks.forEach(k=>localStorage.removeItem(k));}catch(e){}
  location.reload();return "ok";
}
async function listScouts(){await ready;const {data,error}=await sb().from("members").select("uid,name,role,joined_at").in("role",["scout","removed"]).order("joined_at");if(error)throw fail(error);return data;}
/* הסרת סקאוטר. בלי wipe: רק חוסמים את הגישה (role=removed). הרשומות שלו נשארות ונספרות.
   עם wipe: מוחקים גם את הרשומות, ואז את החבר */
async function removeScout(uid,wipe){await ready;
  if(!wipe){const {error}=await sb().rpc("set_scout_role",{target:uid,new_role:"removed"});if(error)throw fail(error);refreshAll();return;}
  const r1=await sb().from("docs").delete().eq("path","entries/"+uid);if(r1.error)throw fail(r1.error);
  const r2=await sb().from("members").delete().eq("uid",uid);if(r2.error)throw fail(r2.error);refreshAll();}
async function restoreScout(uid){await ready;const {error}=await sb().rpc("set_scout_role",{target:uid,new_role:"scout"});if(error)throw fail(error);refreshAll();}

/* קוד חיבור לסימולטור: בודקים שהמייל והסיסמה באמת של חשבון קריאה, בחיבור זמני נפרד
   (לא נוגע בכניסה של המנהל ולא נשמר בדפדפן), ומחזירים את מה שנכנס לקוד */
async function simConnInfo(email,pw){
  if(!CFG.url||!CFG.anonKey||!window.supabase)throw fail("not_configured");
  const tmp=window.supabase.createClient(CFG.url,CFG.anonKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,storageKey:"a9662-probe"}});
  const {error}=await tmp.auth.signInWithPassword({email,password:pw});
  if(error)throw Object.assign(new Error("bad_login"),{code:"bad_login"});
  try{
    const {data:role,error:e2}=await tmp.rpc("my_role");
    if(e2)throw fail(e2);
    if(role!=="reader")throw Object.assign(new Error("not_reader"),{code:"not_reader",role});
  }finally{try{await tmp.auth.signOut({scope:"local"});}catch(_){}}
  return {url:CFG.url,key:CFG.anonKey};
}
window.__CLOUD={status:()=>({...state}),simConnInfo,onStatus:f=>{listeners.add(f);return()=>listeners.delete(f);},publishProfiles,setJoinCode,signOut,listScouts,removeScout,restoreScout,pendingCount,ready,_refreshAll:refreshAll};
window.claude={use:async k=>k==="db"?db:k==="user"?user:k==="downloads"?downloads:null};
})();
