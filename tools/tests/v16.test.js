// בדיקות גרסה 16: שאלות שהוסרו מהטופס, ותיקונים מסבב הבודקים (גיבוי, איחוד, ניקוד אחיד, מיזוג day, משמרות, כיסוי, שעון). קבוצות דמיוניות בלבד.
const {chromium}=require('playwright');
const fs=require('fs');
const src=fs.readFileSync(process.argv[2],'utf8');const hook='(function(){\ndocument.documentElement.setAttribute("lang","he");';
if(!src.includes(hook))throw new Error('test hook point missing');
/* פתח לבדיקה בלבד */
const html=src.replace(hook,'(function(){window.__T=c=>eval(c);\ndocument.documentElement.setAttribute("lang","he");');
const mock=fs.readFileSync(__dirname+'/mock.js','utf8');
const fails=[];const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fails.push(m);};
const T=(pg,fn,arg)=>pg.evaluate(([c,a])=>window.__T('('+c+')('+JSON.stringify(a)+')'),[fn.toString(),arg===undefined?null:arg]);
let ftcCalls=0;
async function page(browser,seed,vp){
  const ctx=await browser.newContext({viewport:vp||{width:390,height:844},deviceScaleFactor:1});
  const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!m.text().includes('Failed to load resource'))errs.push(m.text());});
  await p.addInitScript(`window.__SEED=${JSON.stringify(seed)};`+mock);
  await p.route('**/*',r=>r.request().url().startsWith('http://app/')?r.fulfill({body:html,contentType:'text/html'}):r.abort());
  await p.route('https://api.ftcscout.org/graphql',r=>{ftcCalls++;r.fulfill({body:JSON.stringify({errors:[{message:'Unknown type "TeamEventStats2026"'}]}),contentType:'application/json',headers:{'access-control-allow-origin':'*'}});});
  await p.goto('http://app/');await p.waitForTimeout(400);p.errs=errs;return p;
}
const prof=n=>({nick:n,color:1,motto:"",joined:Date.now()});
(async()=>{
  const browser=await chromium.launch();
  const now=Date.now();
  const sched={};for(let m=1;m<=30;m++)sched[m]=[90001+(m%7),90008+(m%5),90013+(m%4),90017+(m%6)];
  sched[1]=[90001,90002,90003,90004];sched[2]=[90005,90006,90007,90008];

  // ── טופס המאץ׳ (סקאוטר) ──
  const sc=await page(browser,{me:"s1",owner:false,docs:{"control/main":{cur:1,ev:"",sched,assign:{s1:"r1"}},"entries/s1":{rows:{},ts:1,profile:prof("נועה")}}});
  await sc.click('[data-mode="match"]');await sc.waitForTimeout(150);
  await sc.click('[data-startm="1"]');await sc.waitForTimeout(200);
  ok(!(await sc.isHidden('[data-k="fNect"]'))&&!(await sc.isHidden('#fCard')),'match form: nectar in flowers and card are back (v18)');
  ok(await sc.isHidden('.fseg[data-fk="zone"]'),'match form: shooting zone removed (v18)');
  ok((await sc.textContent('[data-k="aLeave"]')).includes('LEAVE')&&(await sc.textContent('[data-k="aPark"]')).trim().startsWith('חניה'),'match form: auto labels LEAVE and parking');
  ok((await sc.textContent('.fseg[data-fk="aStart"]')).includes('ליד אזור הטעינה'),'match form: start positions by place on the field');
  ok(await sc.isHidden('#fAllyF'),'match form: alliance hidden when the schedule knows it');
  ok((await sc.$$('#qchips button')).length===9,'match form: all 9 tags (v18)');
  await sc.click('[data-k="shotsHit"] .plus');await sc.click('[data-k="shotsHit"] .plus');await sc.click('[data-k="tFlip"] .plus');await sc.click('[data-k="tFlip"] .plus');await sc.waitForTimeout(100);
  ok((await sc.textContent('#ptsT'))==='20 נק׳','match form: live teleop points count hits and flips ('+(await sc.textContent('#ptsT'))+')');
  // שעון: "הידני התחיל" באוטונומי צריך לחיצה שנייה
  await T(sc,()=>{startClock(Date.now()-5000);return 1;});await sc.waitForTimeout(300);
  const t0=await T(sc,()=>CLK.t0);
  await sc.click('#clkSync');await sc.waitForTimeout(100);
  ok((await T(sc,()=>CLK.t0))===t0&&(await sc.textContent('#clkSync')).includes('ללחוץ שוב'),'clock: first tap on "manual started" only arms');
  await sc.click('#clkSync');await sc.waitForTimeout(100);
  ok((await T(sc,()=>CLK.t0))<t0-30000,'clock: second tap syncs to teleop');
  ok(sc.errs.length===0,'scout: no JS errors '+sc.errs.join('|'));

  // ── מנהל: נתונים ──
  const R=(m,t,by,x)=>({match:m,team:t,ev:"",ts:now-100000+m*100,by,fm:2,sv:true,...x});
  const docs={
    "control/main":{cur:7,ev:"",sched,assign:{},day:{dnp:[90009],log:[{u:"s1",s:"r1",f:1},{u:"s1",s:"",f:7},{u:"s2",s:"r1",f:7}]}},
    "entries/s1":{rows:{"m1-t90001":R(1,90001,"s1",{aHit:2,aFlip:1,shotsHit:8,tFlip:4,fBalls:4})},ts:now,profile:prof("נועה"),
      pit:{p90003:{team:90003,ev:"",ts:now,drive:"tank",shooters:"1",set:["drive","shooters"],photo:"data:image/jpeg;base64,AAAA"}}},
    "entries/s2":{rows:{"m1-t90002":R(1,90002,"s2",{shotsHit:2,tFlip:4})},ts:now,profile:prof("גל")},
    "entries/s3":{rows:{},ts:1,profile:prof("רון")},"entries/s4":{rows:{},ts:1,profile:prof("מאיה")},
    "entries/s5":{rows:{},ts:1,profile:prof("איתי")},"entries/s6":{rows:{},ts:1,profile:prof("שירה")}};
  const m=await page(browser,{me:"mgr",owner:true,fields:true,docs},{width:1280,height:900});
  // ניקוד אחיד: רשומה גולמית = רשומה מאוחדת
  const same=await T(m,()=>{const r=rawAll().find(x=>x.team===90001);const a=allRows().find(x=>x.team===90001);return [pts(credRow(r)).total,pts(a).total,flipsOf(r,pts(credRow(r)))];});
  ok(same[0]===same[1]&&same[0]>0,'points: raw record shows the alliance credit ('+same.join(" / ")+')');
  ok(same[2]===5,'points: flips column shows whole alliance flips');
  const fl=await T(m,()=>allStats().A.find(a=>a.team===90001).flower);
  ok(fl===8,'stats: flower points include flower balls ('+fl+')');
  // ייצוא גולמי: עמודות המבנה החדש
  await T(m,()=>{exportCsv("raw");return 1;});await m.waitForTimeout(300);
  const csv=await m.evaluate(()=>window.__DL.slice(-1)[0]?.data||"");
  ok(csv.includes("היפוכי הברית בידני")&&csv.includes("כדורים בפרחים"),'csv: new-form columns exported');
  // איחוד: ישנה ששוחקה + חדשה ששוחקה + חדשה "לא הגיע" → שוחקה
  const mg=await T(m,()=>{const b={match:3,team:90009,ev:"",tags:[],hitT:[],aHitT:[],flipT:[],flipH:[],tipT:[]};
    return mergeGroup([{...b,by:"a",ts:3,fm:0,tTips:1,shotsHit:2},{...b,by:"b",ts:2,fm:2,tFlip:1,shotsHit:2},{...b,by:"c",ts:1,fm:2,noShow:true}]).noShow===true;});
  ok(mg===false,'merge: the majority that saw the robot play wins over one no-show');
  // התראת כיסוי: מי שפספס, לא מי שבעמדה עכשיו
  const cov=await T(m,()=>{const a=covAlerts().find(x=>x.k==="r1");return a?{who:a.who,own:a.own}:null;});
  ok(cov&&cov.who.join()==="s1"&&cov.own.join()==="s2",'coverage: names the scout who missed ('+JSON.stringify(cov)+')');
  ok((await m.textContent('#covAlert')).includes('אצל נועה')&&(await m.textContent('#covAlert')).includes('עכשיו בעמדה: גל'),'coverage: banner text');
  // day במיזוג: "לא לבחור" של מנהל אחר לא נדרס כשנשלחת הודעה
  await m.evaluate(()=>{window.__STORE["control/main"].day.dnp=[90009,90010];});
  await T(m,()=>{const msg={t:"בדיקה",at:Date.now(),to:"all"};writeControl({day:{...S.control.day,msg}},null,{msg});return 1;});await m.waitForTimeout(300);
  const day=await m.evaluate(()=>window.__STORE["control/main"].day);
  ok(day.dnp.join()==="90009,90010"&&day.msg?.t==="בדיקה",'day: merge keeps another manager\'s "do not pick" ('+JSON.stringify(day.dnp)+')');
  // שתי לחיצות מהירות על "לא לבחור": השנייה לא מוחקת את הראשונה
  await T(m,()=>{const d=S.control.day;const a=[...(d.dnp||[]),90011];writeControl({day:{...d,dnp:a}},null,{dnp:a});const d2=S.control.day;const b=[...(d2.dnp||[]),90012];writeControl({day:{...d2,dnp:b}},null,{dnp:b});return 1;});
  await m.waitForTimeout(400);
  const dn=await m.evaluate(()=>window.__STORE["control/main"].day.dnp);
  ok(dn.includes(90011)&&dn.includes(90012),'day: two quick writes both kept ('+JSON.stringify(dn)+')');
  // בלי setFields (כמו בארטיפקט): שינוי של day בלבד הולך במיזוג
  {const a2=await page(browser,{me:"mgr",owner:true,docs:{"control/main":{cur:1,ev:"",sched,day:{dnp:[90009]}}}},{width:1280,height:900});
   await a2.evaluate(()=>{window.__STORE["control/main"].day.log=[{u:"x",s:"r1",f:1}];});
   await T(a2,()=>{const msg={t:"x",at:Date.now(),to:"all"};writeControl({day:{...S.control.day,msg}},null,{msg});return 1;});await a2.waitForTimeout(300);
   const d3=await a2.evaluate(()=>window.__STORE["control/main"].day);
   ok(d3.log?.length===1&&d3.msg?.t==="x",'day: merge also without field writes (artifact)');}
  // מטמון הדירוג מתעדכן כשרק ההיפוכים הרשמיים משתנים
  const k1=await T(m,()=>{projectRanking();return projCache.key;});
  await T(m,()=>{S.control={...S.control,day:{...S.control.day,otips:{1:[3,1]}}};return 1;});
  const k2=await T(m,()=>{projCache.at=0;projectRanking();return projCache.key;});
  ok(k1!==k2,'ranking: cache key follows official tips');
  // גיבוי בקוד: לא מוחק תמונה ולא דורס גרסה חדשה יותר
  await T(m,()=>backupApply({u:"s1",rows:{"m1-t90001":{match:1,team:90001,ev:"",ts:Date.now()-900000,fm:2,shotsHit:1}},pit:{p90003:{team:90003,ev:"",ts:Date.now()-900000,drive:"mecanum",set:["drive"]}}}));
  await m.waitForTimeout(300);
  let st=await m.evaluate(()=>window.__STORE["entries/s1"]);
  ok(st.rows["m1-t90001"].shotsHit===8&&st.pit.p90003.drive==="tank",'backup: older records do not overwrite newer cloud data');
  await T(m,()=>backupApply({u:"s1",rows:{},pit:{p90003:{team:90003,ev:"",ts:Date.now(),drive:"mecanum",set:["drive"]}}}));await m.waitForTimeout(300);
  st=await m.evaluate(()=>window.__STORE["entries/s1"]);
  ok(st.pit.p90003.drive==="mecanum"&&st.pit.p90003.photo==="data:image/jpeg;base64,AAAA",'backup: newer pit answer applied, photo kept');
  // משמרות: בלי לוח – לא משבצים; עם לוח – מאוזן, ובלי מעבר עמדה באמצע רצף
  await T(m,()=>{S.control={...S.control,sched:{},cur:1,day:{}};autoAssign();return 1;});await m.waitForTimeout(150);
  ok((await m.textContent('#toast')).includes('קודם להכניס את לוח הזמנים'),'shifts: refused without a schedule');
  const sh=await T(m,()=>{S.control={...S.control,sched:window.__STORE["control/main"].sched,cur:1,day:{}};autoAssign();
    const ms=Object.keys(sched()).map(Number).sort((a,b)=>a-b);const us=["s1","s2","s3","s4","s5","s6"];let jump=0;
    const n=us.map(u=>{let c=0,prev="";for(const mm of ms){const x=slotAt(u,mm);if(x){c++;if(prev&&prev!==x)jump++;}prev=x;}return c;});
    const full=ms.every(mm=>new Set(us.map(u=>slotAt(u,mm)).filter(Boolean)).size===4);
    return {n,jump,full,plan:planHTML().includes("תוכנית המשמרות")};});
  ok(sh.full,'shifts: all four slots covered in every match');
  ok(Math.max(...sh.n)-Math.min(...sh.n)<=6,'shifts: balanced load ('+sh.n.join(",")+')');
  ok(sh.jump===0,'shifts: nobody switches slot in the middle of a run');
  ok(sh.plan,'shifts: plan shown to the manager');
  // פיט: מי שבהפסקה מקבל את הקבוצות
  const pa=await T(m,()=>{S.control={...S.control,pitAssign:{}};pitAutoAssign();const cur=curMatch();
    const a=S.control.pitAssign;return {got:Object.keys(a),off:["s1","s2","s3","s4","s5","s6"].filter(u=>!slotAt(u,cur))};});
  ok(pa.got.length&&pa.got.every(u=>pa.off.includes(u)),'pit: teams go to scouts on break ('+pa.got.join()+' / '+pa.off.join()+')');
  // אתר התוצאות לא מעודכן לעונה: לא עוברים לעונה הקודמת
  ftcCalls=0;const fr=await T(m,()=>ftcPull("ILNOM1",true));
  ok(fr===null&&ftcCalls===1,'ftc: no fallback to last season ('+ftcCalls+' calls)');
  ok(m.errs.length===0,'manager: no JS errors '+m.errs.join('|'));
  await browser.close();
  if(fails.length){console.log(fails.length+' failed');process.exit(1);}console.log('all passed');
})().catch(e=>{console.error(e);process.exit(1);});
