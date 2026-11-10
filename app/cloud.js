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
const CODES=["not_found","permission_denied","bad_code","too_big","not_configured","unavailable"];
function errCode(e){
  /* שגיאה שכבר עטופה (fail) שומרת על הקוד שלה */
  if(e&&CODES.includes(e.code))return e.code;
  const m=String(e&&(e.message||e.code||e)||"");
  if(/not_found/.test(m))return "not_found";
  if(/row-level security|permission|42501|not_manager|PGRST301|JWT/i.test(m))return "permission_denied";
  if(/bad_code/.test(m))return "bad_code";
  if(/too_big/.test(m))return "too_big";
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
const inflight=new Map();
async function refresh(kind,key){
  const id=kind+":"+key;if(inflight.has(id))return inflight.get(id);
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
    }finally{inflight.delete(id);}
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
  state.role=data[0].role;state.name=data[0].name||"";
  try{localStorage.setItem("a9662-member",JSON.stringify({uid:user.id,role:state.role,name:state.name}));}catch(e){}
  return data[0];
}
const domReady=()=>document.body?Promise.resolve():new Promise(r=>document.addEventListener("DOMContentLoaded",r,{once:true}));
async function gate(){
  await domReady();
  return new Promise(resolve=>{
    const box=document.createElement("div");box.id="cloudGate";box.setAttribute("dir","rtl");
    box.innerHTML=`<div class="cg-card"><h2>סקאוטינג ביובאז</h2>
      <form id="cgJoin"><label>השם שלך<input id="cgName" maxlength="40" autocomplete="nickname" required></label>
      <label>קוד ההצטרפות<input id="cgCode" maxlength="32" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" dir="ltr" required></label>
      <button type="submit">כניסה</button></form>
      <details><summary>כניסת מנהל</summary><form id="cgMgr"><label>מייל<input id="cgMail" type="email" required dir="ltr"></label>
      <label>סיסמה<input id="cgPass" type="password" required dir="ltr"></label><button type="submit">כניסה</button></form></details>
      <p class="cg-msg" id="cgMsg" role="status"></p></div>`;
    const css=document.createElement("style");css.textContent=`#cloudGate{position:fixed;inset:0;z-index:9999;background:#eef1ee;display:grid;place-items:center;padding:16px;font:16px system-ui,sans-serif}
      #cloudGate .cg-card{background:#fff;border:1px solid #d5dad6;border-radius:16px;padding:20px;width:min(380px,100%);display:grid;gap:12px}
      #cloudGate h2{margin:0}#cloudGate form{display:grid;gap:10px}#cloudGate label{display:grid;gap:4px;font-weight:600}
      #cloudGate input{font:inherit;padding:10px;border:1px solid #d5dad6;border-radius:10px}#cloudGate button{font:inherit;font-weight:700;padding:12px;border:0;border-radius:10px;background:#1b1f1c;color:#fff}
      #cloudGate .cg-msg{color:#c94a3d;min-height:1.2em;margin:0}`;
    document.head.appendChild(css);document.body.appendChild(box);
    const msg=t=>{box.querySelector("#cgMsg").textContent=t;};
    box.querySelector("#cgJoin").addEventListener("submit",async ev=>{
      ev.preventDefault();msg("");
      try{
        let {data:{session}}=await sb().auth.getSession();
        if(!session){const r=await sb().auth.signInAnonymously();if(r.error)throw r.error;}
        const old=savedMember();
        const {data:res,error}=await sb().rpc("join_team",{code:box.querySelector("#cgCode").value.trim(),display_name:box.querySelector("#cgName").value.trim()});
        if(error)throw error;
        if(res==="bad_code"){msg("הקוד לא נכון");return;}
        if(res==="rate_limited"){msg("יותר מדי ניסיונות. נסה שוב בעוד כמה דקות");return;}
        if(res==="full"){msg("הצוות מלא. פנה למנהל");return;}
        if(await loadMember()){if(old&&old.uid&&old.uid!==state.uid)migrate(old.uid,state.uid);box.remove();resolve();}
      }catch(e){const c=errCode(e);msg(c==="unavailable"?"אין רשת. נסה שוב, או השתמש בגיבוי של הקבוצה":"הכניסה לא הצליחה");}
    });
    box.querySelector("#cgMgr").addEventListener("submit",async ev=>{
      ev.preventDefault();msg("");
      try{
        const {error}=await sb().auth.signInWithPassword({email:box.querySelector("#cgMail").value.trim(),password:box.querySelector("#cgPass").value});
        if(error)throw error;
        if(await loadMember()){box.remove();resolve();}else msg("החשבון הזה עוד לא מוגדר כמנהל");
      }catch(e){msg(errCode(e)==="unavailable"?"אין רשת. נסה שוב":"מייל או סיסמה לא נכונים");}
    });
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
    if(!m)await gate();
    readyResolve();
  }catch(e){try{console.warn("cloud start",e&&(e.message||e));}catch(_){}
    const c=errCode(e);
    /* האתר לא מחובר לענן: לא מעמידים פנים שזה "בלי רשת". אומרים מה חסר ומפנים לגיבוי */
    if(c==="not_configured")domReady().then(()=>{const d=document.createElement("div");d.setAttribute("dir","rtl");d.setAttribute("role","alert");
      d.style.cssText="position:sticky;top:0;z-index:9998;padding:14px 16px;background:#c94a3d;color:#fff;font:600 15px system-ui,sans-serif";
      d.textContent="האתר עוד לא מחובר לענן, ולכן אי אפשר לאסוף בו נתונים. להשתמש בארטיפקט ״סקאוטינג ביובאז״ ולהודיע למנהל.";document.body.prepend(d);});
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
  const meta={format:pkg.format,version:pkg.version,generated_at:pkg.generated_at,event:pkg.event,event_code:ev,units:pkg.units,schedule:pkg.schedule,teams:pkg.robots.map(r=>r.team)};
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
async function listScouts(){await ready;const {data,error}=await sb().from("members").select("uid,name,role,joined_at").eq("role","scout").order("joined_at");if(error)throw fail(error);return data;}
/* הסרת סקאוטר: השורה שלו והרשומות שלו */
async function removeScout(uid){await ready;
  /* קודם הרשומות (אחרי הסרת החבר הן כבר לא גלויות למחיקה), ואז החבר */
  const r1=await sb().from("docs").delete().eq("path","entries/"+uid);if(r1.error)throw fail(r1.error);
  const r2=await sb().from("members").delete().eq("uid",uid);if(r2.error)throw fail(r2.error);refreshAll();}

window.__CLOUD={status:()=>({...state}),onStatus:f=>{listeners.add(f);return()=>listeners.delete(f);},publishProfiles,setJoinCode,signOut,listScouts,removeScout,pendingCount,ready,_refreshAll:refreshAll};
window.claude={use:async k=>k==="db"?db:k==="user"?user:k==="downloads"?downloads:null};
})();
