// בדיקות לתיקוני גרסה 11 (סקירת עשרת הסוכנים, 15.11.2026). קבוצות דמיוניות בלבד.
const {chromium}=require('playwright');
const fs=require('fs');
/* פתח לבדיקה בלבד: גישה לפונקציות שבתוך האפליקציה (eval בתוך הסגירה), לא נכנס לאפליקציה עצמה */
const src=fs.readFileSync(process.argv[2],'utf8');const hook='(function(){\ndocument.documentElement.setAttribute("lang","he");';
if(!src.includes(hook))throw new Error('test hook point missing');
const html=src.replace(hook,'(function(){window.__T=c=>eval(c);\ndocument.documentElement.setAttribute("lang","he");');
const mock=fs.readFileSync(__dirname+'/mock.js','utf8');
const fails=[];const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fails.push(m);};
async function page(browser,seed,vp){
  const ctx=await browser.newContext({viewport:vp||{width:390,height:844},deviceScaleFactor:1});
  const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!m.text().includes('Failed to load resource'))errs.push(m.text());});
  await p.addInitScript(`window.__SEED=${JSON.stringify(seed)};`+mock);
  await p.route('**/*',r=>r.request().url().startsWith('http://app/')?r.fulfill({body:html,contentType:'text/html'}):r.abort());
  await p.goto('http://app/');await p.waitForTimeout(400);p.errs=errs;return p;
}
/* מריץ פונקציה בתוך הסגירה של האפליקציה */
const T=(pg,fn)=>pg.evaluate(c=>window.__T('('+c+')()'),fn.toString());
const row=(m,t,x)=>({match:m,team:t,ev:"",ts:Date.now()-1000,aLeave:true,shotsHit:4,shotsMiss:1,tTips:1,...(x||{})});
(async()=>{
  const browser=await chromium.launch();
  const sched={1:[90001,90002,90003,90004],2:[90005,90006,90007,90008]};
  const prof=n=>({nick:n,color:1,motto:"",joined:Date.now()});

  // ── מנהל: רשומות שלא מתאימות ללוח לא נספרות ──
  const poison={};for(let m=100;m<120;m++)poison["m"+m+"-t90001"]=row(m,90001,{shotsHit:60,tTips:6});
  poison["m1-t90009"]=row(1,90009);
  const seedM={me:"mgr",owner:true,docs:{"control/main":{cur:3,sched,ev:"",pitAssign:{s1:[90002]}},
    "entries/s1":{rows:{"m1-t90001":row(1,90001)},ts:1,profile:prof("נועה"),
      pit:{p90002:{team:90002,ev:"",ts:Date.now()-5000,retry:false,drive:"tank",set:["drive"]}}},
    "entries/s2":{rows:poison,ts:1,profile:prof("רון"),
      pit:{p90002:{team:90002,ev:"",ts:Date.now()+250000,retry:false,drive:"mecanum",set:["drive"]}}}}};
  const m=await page(browser,seedM,{width:1280,height:900});
  const counted=await T(m,()=>allRows().filter(r=>r.team===90001).length);
  ok(counted===1,'poison: only the scheduled match counts ('+counted+')');
  ok(await T(m,()=>!allRows().some(r=>r.team===90009)),'poison: team not in that match is not counted');
  ok(await T(m,()=>coverage().orphans.length===21),'poison: manager sees the uncounted records');
  ok(await T(m,()=>{S.control=readControl({...S.control,playoff:{n:2,al:[[90001,90005],[90002,90006]]}});return !offSched({match:40,team:90005})&&offSched({match:40,team:90009});}),'poison: playoff matches count only for playoff teams');
  // פיט: השיבוץ קודם לזמן מזויף; תשובות של "לנסות שוב" נשמרות
  ok(await T(m,()=>pitMerged(pitByTeam().get(90002))?.drive==="tank"),'pit: assigned scout beats a future timestamp');
  ok(await T(m,()=>{const g=[{retry:true,set:["drive"],drive:"tank",ts:1,by:"x",notes:""}];const p=pitMerged(g);return p&&p.known.has("drive");}),'pit: answers from a busy team are kept');
  // לוח זמנים: שעות מסוננות, ואישור לפני שמאצ׳ים נמחקים
  ok(await T(m,()=>{const r=parseSched("Q-1 10:00 AM 90001 90002 90003 90004");return r.out[1]&&r.out[1].join()==="90001,90002,90003,90004";}),'schedule: clock times ignored');
  await m.click('#tab-admin');await m.waitForTimeout(200);
  await m.fill('#schedTxt','1 90001 90002 90003 90004');await m.click('[data-savesched]');await m.waitForTimeout(200);
  ok(Object.keys((await T(m,()=>window.__STORE["control/main"].sched))).length===2,'schedule: first tap does not wipe matches');
  await m.click('[data-savesched]');await m.waitForTimeout(300);
  ok(Object.keys((await T(m,()=>window.__STORE["control/main"].sched))).length===1,'schedule: second tap saves');
  await m.fill('#schedTxt','שטויות');await m.click('[data-savesched]');await m.click('[data-savesched]');await m.waitForTimeout(300);
  ok(Object.keys((await T(m,()=>window.__STORE["control/main"].sched))).length===1,'schedule: never saves an empty schedule');
  ok(await T(m,()=>eventPackage().current_match===3),'sim: current match sent');
  ok(m.errs.length===0,'manager: no JS errors '+m.errs.join('|'));

  // ── סקאוטר מאצ׳ים ──
  const seedS={me:"s1",owner:false,docs:{"control/main":{cur:1,sched,ev:"",assign:{s1:"r1"}},"entries/s1":{rows:{},ts:1,profile:prof("נועה")}}};
  const s=await page(browser,seedS);
  await s.click('[data-mode="match"]');await s.waitForTimeout(150);
  await s.click('[data-startm="1"]');await s.waitForTimeout(150);
  await T(s,()=>startClock(Date.now()-33000));await s.waitForTimeout(350);
  ok(await s.$('#shotStrip [data-strip="aFlip"]'),'clock: flip during the transition counts for auto');
  await s.click('#shotStrip [data-strip="aFlip"]');
  ok(await T(s,()=>F.aFlip===1&&(F.tFlip||0)===0),'clock: transition flip stored as auto');
  await s.click('#formSave');await s.waitForTimeout(200);
  ok(!(await T(s,()=>Object.keys(window.__STORE["entries/s1"].rows).length)),'save: first tap mid-match does not save');
  ok((await s.textContent('#formMsg')).includes('עוד לא נגמר'),'save: asks to confirm mid-match');
  await s.click('#formSave');await s.waitForTimeout(400);
  ok(await T(s,()=>!!window.__STORE["entries/s1"].rows["m1-t90001"]),'save: second tap saves');
  ok(await s.isVisible('#toast')&&(await s.textContent('#toast')).includes('נשמר'),'save: "saved" message survives the tab switch');
  // סוף המאץ׳: השעון לא חוזר ל"התחל שעון"
  await s.click('[data-startm="2"]').catch(()=>{});await T(s,()=>{freshForm(2,90005,"r1");go("entry");startClock(Date.now()-176000);});await s.waitForTimeout(400);
  ok(await T(s,()=>CLK.ended&&!CLK.on),'clock: ended state after the buzzer');
  ok((await s.textContent('#clkBtn'))==='המאץ׳ נגמר','clock: shows "match over", not "start"');
  await s.click('#clkBtn');await s.waitForTimeout(100);
  ok(await T(s,()=>!CLK.on),'clock: one tap does not restart it');
  // שתי לשוניות: רשומה ממתינה מהלשונית השנייה לא נדרסת
  ok(await T(s,()=>{const k=pendKey();window.dispatchEvent(new StorageEvent("storage",{key:k,newValue:JSON.stringify({"m9-t90001":null})}));const del=S.pending["m9-t90001"]===null;S.pending["m9-t90001"]={match:9,team:90001,ev:"",ts:1};window.dispatchEvent(new StorageEvent("storage",{key:k,newValue:JSON.stringify({"m9-t90001":{match:9,team:90001,ev:"",ts:5,notes:"x"}})}));return del&&S.pending["m9-t90001"].ts===5;}),'two tabs: deletes and newer versions travel');
  ok(await T(s,()=>{const k=pendKey();window.dispatchEvent(new StorageEvent("storage",{key:k,newValue:JSON.stringify({"m9-t90001":{match:9,team:90001,ev:"",ts:Date.now()}})}));return !!S.pending["m9-t90001"];}),'two tabs: pending record from the other tab merged');
  ok(s.errs.length===0,'scout: no JS errors '+s.errs.join('|'));

  // ── סקאוטר פיט ──
  const seedP={me:"s3",owner:false,docs:{"control/main":{cur:1,sched,ev:"",pitAssign:{s3:[90001]}},"entries/s3":{rows:{},ts:1,profile:prof("גל")}}};
  const p=await page(browser,seedP);
  await p.click('[data-mode="pit"]');await p.waitForTimeout(150);
  await p.click('#v-pit [data-popen="90001"]');await p.waitForTimeout(150);
  await p.click('[data-pn="cap"] [data-pd="1"]');await p.click('[data-pn="cap"] [data-pd="-1"]');
  ok((await p.textContent('[data-pn="cap"] output'))==='?','pit: minus at the bottom goes back to "?"');
  await p.click('[data-p1="drive"][data-v="tank"]');await p.click('[data-pm="intake"][data-v="floor"]');
  await p.click('[data-p1="shooters"][data-v="0"]');
  ok(!(await p.$('[data-pn="aBalls"]')),'pit: no auto-balls question without a shooter');
  await p.click('[data-p1="shooters"][data-v="1"]');await p.click('[data-p1="balls"][data-v="unk"]');
  await p.click('[data-psave]');await p.waitForTimeout(300);
  ok((await p.textContent('#toast')).startsWith('נשמר ·'),'pit: "don\'t know" counts as answered');
  ok(await T(p,()=>declaredOf(90001).shoot_balls===null),'pit: "don\'t know" exported as null');
  ok(p.errs.length===0,'pit: no JS errors '+p.errs.join('|'));

  // ── סקאוטר פיט חדש נשאר בפיט אחרי ההרשמה ──
  const n=await page(browser,{me:"s4",owner:false,docs:{"control/main":{cur:1,sched,ev:""}}});
  await T(n,()=>{localStorage.setItem("bbz-mode",JSON.stringify("pit"));S.mode="pit";go("join");});await n.waitForTimeout(200);
  if(await n.$('#jNick')){await n.fill('#jNick','מאיה');await n.click('#v-join [data-joinsave], #v-join .btn.pri');await n.waitForTimeout(300);
    ok(await T(n,()=>S.mode==="pit"&&S.tab==="pit"),'join: pit scout lands in pit ('+(await T(n,()=>S.mode+"/"+S.tab))+')');}
  else ok(false,'join: form not found');

  await browser.close();
  console.log(fails.length?'\n'+fails.length+' FAILED':'\nALL PASSED');process.exit(fails.length?1:0);
})();
