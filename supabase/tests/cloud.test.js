/* בדיקת שילוב: האתר (app + cloud.js + supabase-js אמיתי) מול Postgres אמיתי עם schema.sql, דרך fake-supabase.js.
   דורש: Postgres מקומי (PG_URL), npm: playwright, pg, jsqr. הרצה מתיקיית המאגר:
     PG_URL=postgres://postgres@localhost:5544/postgres node supabase/tests/cloud.test.js
   רק קבוצות דמיוניות (90001+). */
const {chromium}=require("playwright");const {Client}=require("pg");const {spawn,execSync}=require("child_process");
const fs=require("fs"),path=require("path"),zlib=require("zlib");
const ROOT=path.resolve(__dirname,"../..");const PG=process.env.PG_URL||"postgres://postgres@localhost:5544/postgres";
const DB="cloudtest";const PORT=54329;const fails=[];
const ok=(c,m)=>{console.log((c?"PASS ":"FAIL ")+m);if(!c)fails.push(m);};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,ms,label){const t0=Date.now();while(Date.now()-t0<ms){try{if(await fn())return true;}catch(e){}await wait(400);}return false;}
(async()=>{
  /* מאגר נקי */
  const admin=new Client({connectionString:PG});await admin.connect();
  await admin.query(`drop database if exists ${DB}`);await admin.query(`create database ${DB}`);await admin.end();
  const dbUrl=PG.replace(/\/[^/]*$/,"/"+DB);const q=new Client({connectionString:dbUrl});await q.connect();
  for(const f of ["supabase/tests/stub-supabase.sql","supabase/schema.sql"])await q.query(fs.readFileSync(path.join(ROOT,f),"utf8"));
  await q.query("insert into settings values ('join_code','team9662xyz')");
  execSync("python3 tools/build-site.py",{cwd:ROOT});
  const srv=spawn("node",[path.join(__dirname,"fake-supabase.js"),String(PORT),dbUrl],{stdio:"inherit"});await wait(800);
  const mgr=await (await fetch(`http://127.0.0.1:${PORT}/__test/user`,{method:"POST",body:JSON.stringify({email:"mgr@example.test",password:"pw-test-1"})})).json();
  await q.query("insert into members(uid,role,name) values ($1,'manager','מנהל')",[mgr.id]);
  await q.query(`insert into docs(path,data) values ('control/main',$1)`,[JSON.stringify({cur:1,event:"בדיקה",ev:"",sched:{1:[90001,90002,90003,90004],2:[90005,90006,90007,90008]},assign:{},pitAssign:{}})]);
  const browser=await chromium.launch();
  const jsqr=fs.readFileSync(require.resolve("jsqr/dist/jsQR.js"),"utf8");
  async function open(vp){
    const ctx=await browser.newContext({viewport:vp||{width:390,height:844}});const p=await ctx.newPage();p.ctx=ctx;
    const errs=[];p.on("pageerror",e=>errs.push(e.message));p.errs=errs;
    await p.route("http://site/**",r=>{const f=new URL(r.request().url()).pathname.replace(/^\//,"")||"index.html";
      if(f==="config.js")return r.fulfill({body:`window.SCOUT_CLOUD={url:"http://supa.test",anonKey:"anon-test"};`,contentType:"text/javascript"});
      const fp=path.join(ROOT,"site",f);if(!fs.existsSync(fp))return r.fulfill({status:404,body:""});
      r.fulfill({body:fs.readFileSync(fp),contentType:f.endsWith(".js")?"text/javascript":"text/html"});});
    await p.route(/fonts\.(googleapis|gstatic)/,r=>r.abort());
    /* הדפדפן חוסם פנייה מאתר לכתובת מקומית, אז הבקשות לענן עוברות דרך כתובת מדומה */
    await p.route("http://supa.test/**",async r=>{const u=r.request().url().replace("http://supa.test",`http://127.0.0.1:${PORT}`);
      try{const resp=await r.fetch({url:u});await r.fulfill({response:resp});}catch(e){await r.abort();}});
    await p.goto("http://site/index.html");return p;
  }
  /* ── סקאוטר מצטרף ── */
  const s=await open();
  ok(await until(()=>s.isVisible("#cloudGate"),8000),"scout: join screen shown");
  await s.fill("#cgName","נועה");await s.fill("#cgCode","wrong");await s.click("#cgJoin button");
  ok(await until(async()=>(await s.textContent("#cgMsg")).includes("לא נכון"),5000),"scout: wrong code refused");
  await s.fill("#cgCode","team9662xyz");await s.click("#cgJoin button");
  ok(await until(async()=>!(await s.isVisible("#cloudGate")),8000),"scout: joined with code");
  const sid=(await q.query("select uid from members where role='scout'")).rows[0]?.uid;
  ok(!!sid,"scout: member row created");
  ok(await until(async()=>(await s.textContent("#liveTxt")).includes("10 שניות")||(await s.textContent("#liveTxt")).includes("חי"),15000),"scout: status shows poll mode (no realtime server) "+await s.textContent("#liveTxt"));
  /* הזנת מאץ׳ */
  /* מסך הפרופיל של האפליקציה: השם כבר ממולא מהכניסה */
  ok(await until(()=>s.isVisible("[data-join]"),8000),"scout: profile screen shown");
  ok((await s.inputValue("#jNick"))==="נועה","scout: name carried from join screen");
  await s.click("[data-join]");await wait(800);
  await s.click("#tab-entry");await wait(300);
  await s.fill("#fMatch","1");await s.fill("#fTeam","90001");
  for(let i=0;i<2;i++)await s.click('.ctr[data-k="tTips"] .plus');
  await s.click("#formSave");
  ok(await until(async()=>{const r=(await q.query("select data from docs where path=$1",["entries/"+sid])).rows[0];return r&&r.data.rows&&r.data.rows["m1-t90001"]&&r.data.rows["m1-t90001"].tTips===2;},10000),"scout: match record reached the cloud");
  /* בלי רשת: נשמר בטלפון ונשלח אחר כך */
  await s.ctx.setOffline(true);
  await s.fill("#fMatch","2");await s.fill("#fTeam","90005");await s.click('.ctr[data-k="tTips"] .plus');await s.click("#formSave");
  await wait(1500);
  const pendTxt=await s.textContent("#liveTxt");
  ok(/ממתינות|לא נשלחו|בלי רשת/.test(pendTxt),"scout offline: pending shown ("+pendTxt+")");
  await s.ctx.setOffline(false);await s.evaluate(()=>window.dispatchEvent(new Event("online")));
  ok(await until(async()=>{const r=(await q.query("select data from docs where path=$1",["entries/"+sid])).rows[0];return r.data.rows["m2-t90005"];},25000),"scout: offline record sent after reconnect");
  /* סקאוטר לא יכול לכתוב ללוח הזמנים */
  const hack=await s.evaluate(async()=>{const db=await window.claude.use("db");try{await db.doc("control/main").set({cur:99});return "written";}catch(e){return e.code;}});
  ok(hack==="permission_denied","scout: writing control refused ("+hack+")");
  const peek=await s.evaluate(async()=>{const {data}=await window.supabase.createClient(window.SCOUT_CLOUD.url,window.SCOUT_CLOUD.anonKey,{auth:{storageKey:"a9662-auth"}}).from("sim_profiles").select("*");return (data||[]).length;});
  ok(peek===0,"scout: cannot read simulator profiles");
  /* ── מנהל ── */
  const m=await open({width:1280,height:900});
  await until(()=>m.isVisible("#cloudGate"),8000);
  await m.click("#cloudGate summary");await m.fill("#cgMail","mgr@example.test");await m.fill("#cgPass","pw-test-1");await m.click("#cgMgr button");
  ok(await until(async()=>!(await m.isVisible("#cloudGate")),8000),"manager: signed in");
  ok(await until(async()=>(await m.textContent("#roleTag").catch(()=>""))!=="סקאוטר",5000),"manager: has manager role");
  await m.click("#tab-team");await m.fill("#tPick","90001");
  ok(await until(async()=>(await m.textContent("#teamBody")).includes("היפוכים"),15000),"manager: sees scout data");
  /* פרסום אוטומטי לסימולטור */
  ok(await until(async()=>(await q.query("select count(*)::int n from sim_profiles")).rows[0].n>=8,20000),"manager: profiles auto-published");
  const prof=(await q.query("select data from sim_profiles where team=90001")).rows[0]?.data;
  ok(prof&&prof.measured&&prof.measured.tips_per_match.value===2,"publish: profile content correct");
  const meta=(await q.query("select data from sim_meta")).rows[0]?.data;
  ok(meta&&meta.schedule&&meta.schedule["1"]&&meta.schedule["1"].red[0]===90001,"publish: schedule in meta");
  /* שינוי חדש מגיע לסימולטור */
  await s.fill("#fMatch","1");await s.fill("#fTeam","90002");await s.click('.ctr[data-k="tTips"] .plus');await s.click("#formSave");
  ok(await until(async()=>{const r=(await q.query("select data from sim_profiles where team=90002")).rows[0];return r&&r.data.measured&&r.data.measured.tips_per_match.value===1;},40000),"publish: new scout data reaches simulator table");
  /* מסך ההגדרות: מצב הסנכרון */
  await m.click("#tab-admin");await wait(500);
  ok((await m.textContent("#simSync")).includes("פורסם"),"admin: sync status shown");
  /* קוד הצטרפות חדש */
  await m.fill("#joinCode","newcode778888");await m.click("[data-joincode]");
  ok(await until(async()=>(await q.query("select value from settings where key='join_code'")).rows[0].value==="newcode778888",5000),"admin: join code changed");
  /* שני מנהלים: שינוי שדה אחד לא דורס שדה אחר */
  await q.query(`update docs set data=data||'{"event":"שם חדש"}' where path='control/main'`);
  await m.evaluate(()=>{});await m.click("#tab-admin");
  await m.evaluate(async()=>{const db=await window.claude.use("db");await db.doc("control/main").setFields({cur:2,_seq:99});});
  const ctl=(await q.query("select data from docs where path='control/main'")).rows[0].data;
  ok(ctl.event==="שם חדש"&&ctl.cur===2,"control: field update keeps another manager's change");
  /* הסרת סקאוטר */
  await m.evaluate(async uid=>{await window.__CLOUD.removeScout(uid);},sid);
  ok((await q.query("select count(*)::int n from members where uid=$1",[sid])).rows[0].n===0&&(await q.query("select count(*)::int n from docs where path=$1",["entries/"+sid])).rows[0].n===0,"admin: scout removed with records");
  /* ── QR ── */
  await m.fill("#simMatch","1");await m.click("[data-qr]");await wait(400);
  await m.addScriptTag({content:jsqr});
  const decoded=[];
  for(let k=0;k<5;k++){
    const part=await m.evaluate(async()=>{const svg=document.querySelector("#qrBox svg");const xml=new XMLSerializer().serializeToString(svg);
      const img=new Image();img.src="data:image/svg+xml;base64,"+btoa(unescape(encodeURIComponent(xml)));await img.decode();
      const c=document.createElement("canvas");c.width=c.height=600;const g=c.getContext("2d");g.fillStyle="#fff";g.fillRect(0,0,600,600);g.drawImage(img,0,0,600,600);
      const d=g.getImageData(0,0,600,600);const r=jsQR(d.data,600,600);return r&&r.data;});
    decoded.push(part);const nx=await m.$('[data-qrnav="1"]:not([disabled])');if(!nx)break;await nx.click();await wait(200);
  }
  ok(decoded.every(Boolean),"qr: every code decodes ("+decoded.length+" codes)");
  const parts=decoded.map(x=>/^A9662:(\d+)\/(\d+):(\w+):(.*)$/.exec(x)).filter(Boolean).sort((a,b)=>a[1]-b[1]);
  const b64=parts.map(x=>x[4]).join("").replace(/-/g,"+").replace(/_/g,"/");
  let pk=null;try{pk=JSON.parse(zlib.inflateRawSync(Buffer.from(b64,"base64")).toString());}catch(e){}
  ok(pk&&pk.format==="apollo9662-scouting/match"&&pk.match===1&&pk.robots.length===4,"qr: package rebuilt from codes");
  ok(s.errs.length===0&&m.errs.length===0,"no page errors "+[...s.errs,...m.errs].join(" | "));
  await browser.close();srv.kill();await q.end();
  console.log(fails.length?fails.length+" FAILED":"ALL PASSED");process.exit(fails.length?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
