/* scouting-reader.js – עזר לסימולטור (03): קורא את פרופילי הרובוטים מהסקאוטינג (04) בשרשרת גיבויים.
   לא חובה להשתמש בו. הוא שייך ל־04 ונשמר במאגר של 04; 03 יכול להעתיק אותו או לכתוב משלו לפי docs/live-sync.md.

   השרשרת, מהטוב לפחות טוב:
     1. "live"  – זרם חי מהענן (ועוד בדיקה כל דקה, למקרה שהזרם שותק)
     2. "poll"  – שאילה כל 10 שניות, כשהזרם לא מחובר
     3. "cache" – התמונה האחרונה שנשמרה במחשב, לאותה תחרות בלבד
     4. "file"  – קובץ שנטען ידנית
     5. "qr"    – קודי QR שנסרקו מהטלפון של המנהל
   onUpdate({ source, at, data, stale }) – רק כשהנתונים השתנו או המקור השתנה.
   onStatus({ mode, lastAt, source, heartbeatAt, stale, error }).
   stale = הנתונים או הדופק של המנהל ישנים מ־5 דקות (המנהל כנראה לא מחובר).

   שימוש:
     const r = ScoutingReader.create({ url, anonKey, email, password, eventCode: "", onUpdate, onStatus });
     r.importFile(text); await r.addQR(decodedString); r.stop();
   הסיסמה והמפתח – בקובץ הגדרות מקומי שלא נכנס למאגר. */
(function(root){
"use strict";
const POLL_MS=10000,SAFETY_MS=60000,TIMEOUT_MS=8000,STALE_MS=5*60000,RELOGIN_MS=8000;
function create(opt){
  const o=Object.assign({eventCode:"",storage:root.localStorage||null,onUpdate:()=>{},onStatus:()=>{}},opt||{});
  const CACHE_KEY="a9662-sim-cache:"+(o.eventCode||"");
  const SB=o.supabase||root.supabase;let client=null,chan=null,live=false,pollT=null,safeT=null,stopped=false,mode="connecting",last=null,lastSig="",heartbeatAt=0,busy=false,signedIn=false,lastLogin=0,seq=0,applied=0;
  const qrParts=new Map();
  const isStale=()=>{const t=Math.max(heartbeatAt,last&&last.at||0);return !t||Date.now()-t>STALE_MS;};
  const status=(m,extra)=>{mode=m;try{o.onStatus(Object.assign({mode:m,lastAt:last&&last.at,source:last&&last.source,heartbeatAt,stale:isStale()},extra||{}));}catch(e){}};
  function valid(d){return d&&d.version===1&&/^apollo9662-scouting\/(event|match)$/.test(d.format||"");}
  function emit(source,data,at){
    if(!valid(data)){status(mode,{error:"bad_package"});return false;}
    if((data.event_code||"")!==(o.eventCode||"")){status(mode,{error:"other_event"});return false;}
    const sig=source+"|"+JSON.stringify(data);
    if(sig===lastSig&&last){last.at=at||last.at;return true;}
    lastSig=sig;last={source,at:at||Date.now(),data};
    if(source==="live"||source==="poll"){try{o.storage&&o.storage.setItem(CACHE_KEY,JSON.stringify({at:last.at,data}));}catch(e){}}
    try{o.onUpdate({source,at:last.at,data,stale:isStale()});}catch(e){}
    return true;
  }
  const tfetch=(u,op)=>{const c=new AbortController();const t=setTimeout(()=>c.abort(),TIMEOUT_MS);return fetch(u,Object.assign({},op,{signal:c.signal})).finally(()=>clearTimeout(t));};
  async function login(){
    if(Date.now()-lastLogin<RELOGIN_MS&&!signedIn)throw new Error("relogin_wait");
    lastLogin=Date.now();
    const {error}=await client.auth.signInWithPassword({email:o.email,password:o.password});
    if(error){signedIn=false;throw error;}
    signedIn=true;
  }
  async function fetchAll(source){
    if(busy)return;busy=true;const my=++seq;
    try{
      if(!signedIn)await login();
      const [{data:meta,error:e1},{data:rows,error:e2}]=await Promise.all([
        client.from("sim_meta").select("data,updated_at").eq("event_code",o.eventCode).limit(1),
        client.from("sim_profiles").select("team,data,updated_at").eq("event_code",o.eventCode)]);
      const err=e1||e2;
      if(err){if(/JWT|401|403|permission|42501/i.test(String(err.message||err.code||"")))signedIn=false;throw err;}
      if(my<applied)return; /* תשובה ישנה שהגיעה מאוחר */
      applied=my;
      if(!meta.length){status(source,{error:"no_data"});return;}
      heartbeatAt=Date.parse(meta[0].updated_at)||heartbeatAt;
      const m=meta[0].data;const byTeam={};for(const r of rows)byTeam[r.team]=r.data;
      const pkg={format:"apollo9662-scouting/event",version:m.version||1,generated_at:m.generated_at,event:m.event,event_code:m.event_code||"",units:m.units,schedule:m.schedule||{},
        robots:(m.teams||Object.keys(byTeam).map(Number)).map(t=>byTeam[t]).filter(Boolean)};
      const newest=Math.max(heartbeatAt,...rows.map(r=>Date.parse(r.updated_at)||0));
      emit(source,pkg,newest||Date.now());status(source);
    }finally{busy=false;}
  }
  async function tick(force){if(stopped||(live&&!force))return;try{await fetchAll(live?"live":"poll");}catch(e){fromCache();}}
  function fromCache(){
    status("offline");
    if(last)return;
    try{const c=JSON.parse(o.storage&&o.storage.getItem(CACHE_KEY)||"null");if(c)emit("cache",c.data,c.at);}catch(e){}
  }
  async function start(){
    fromCache();
    if(!SB||!o.url||!o.anonKey){status("offline",{error:"not_configured"});return;}
    try{
      client=SB.createClient(o.url,o.anonKey,{auth:{persistSession:false,autoRefreshToken:true},global:{fetch:tfetch}});
      chan=client.channel("sim-"+Math.random().toString(36).slice(2,8))
        .on("postgres_changes",{event:"*",schema:"public",table:"sim_profiles"},()=>debounced())
        .on("postgres_changes",{event:"*",schema:"public",table:"sim_meta"},()=>debounced())
        .subscribe(st=>{live=st==="SUBSCRIBED";if(live){status("live");tick(true);}else if(mode==="live")status("poll");});
    }catch(e){}
    /* גם אם הענן לא זמין עכשיו – ממשיכים לנסות, ונכנסים מחדש כשהוא חוזר */
    tick(true);
    pollT=setInterval(()=>tick(false),POLL_MS);
    safeT=setInterval(()=>tick(true),SAFETY_MS);
  }
  let deb=null;const debounced=()=>{clearTimeout(deb);deb=setTimeout(()=>tick(true),300);};
  /* קובץ ידני */
  function importFile(text){let d=null;try{d=JSON.parse(text);}catch(e){return false;}return emit("file",d);}
  /* QR: מחרוזת מכל קוד שנסרק. מחזיר כמה חסרים, 0 כשהחבילה הושלמה, ו־-1 לקוד פגום */
  async function addQR(str){
    try{
      const m=/^A9662:(\d+)\/(\d+):(\w+):([A-Za-z0-9_-]*)$/.exec(String(str||""));if(!m)return -1;
      const i=+m[1],n=+m[2],id=m[3],data=m[4];
      if(!(n>=1&&n<=20&&i>=1&&i<=n))return -1;
      if(!qrParts.has(id)){if(qrParts.size>8)qrParts.clear();qrParts.set(id,{n,parts:new Map()});}
      const g=qrParts.get(id);if(g.n!==n)return -1;g.parts.set(i,data);
      if(g.parts.size<n)return n-g.parts.size;
      let b64="";for(let k=1;k<=n;k++)b64+=g.parts.get(k);
      qrParts.delete(id);
      const bin=atob(b64.replace(/-/g,"+").replace(/_/g,"/"));const bytes=new Uint8Array(bin.length);for(let k=0;k<bin.length;k++)bytes[k]=bin.charCodeAt(k);
      const ds=new DecompressionStream("deflate-raw");const w=ds.writable.getWriter();
      const done=Promise.all([w.write(bytes),w.close()]).catch(()=>{});
      const text=new TextDecoder().decode(await new Response(ds.readable).arrayBuffer());await done;
      return emit("qr",JSON.parse(text))?0:-1;
    }catch(e){return -1;}
  }
  function stop(){stopped=true;clearInterval(pollT);clearInterval(safeT);try{chan&&client.removeChannel(chan);}catch(e){}}
  start();
  return {importFile,addQR,stop,current:()=>last,status:()=>mode,stale:isStale};
}
const api={create};
if(typeof module!=="undefined"&&module.exports)module.exports=api;else root.ScoutingReader=api;
})(typeof window!=="undefined"?window:globalThis);
