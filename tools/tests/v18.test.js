// בדיקות גרסה 18: שאלות שתלויות בתשובה אחרת נעלמות, "חובה" בפיט, ו"לא הגיע" מסתיר את המאץ׳. קבוצות דמיוניות בלבד.
const {chromium}=require('playwright');
const fs=require('fs');
const src=fs.readFileSync(process.argv[2],'utf8');const hook='(function(){\ndocument.documentElement.setAttribute("lang","he");';
if(!src.includes(hook))throw new Error('test hook point missing');
/* פתח לבדיקה בלבד */
const html=src.replace(hook,'(function(){window.__T=c=>eval(c);\ndocument.documentElement.setAttribute("lang","he");');
const mock=fs.readFileSync(__dirname+'/mock.js','utf8');
const fails=[];const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fails.push(m);};
const T=(pg,fn)=>pg.evaluate(c=>window.__T('('+c+')()'),fn.toString());
async function page(browser,seed){
  const ctx=await browser.newContext({viewport:{width:390,height:844}});const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.addInitScript(`window.__SEED=${JSON.stringify(seed)};`+mock);
  await p.route('**/*',r=>r.request().url().startsWith('http://app/')?r.fulfill({body:html,contentType:'text/html'}):r.abort());
  await p.goto('http://app/');await p.waitForTimeout(400);p.errs=errs;return p;
}
const prof=n=>({nick:n,color:1,motto:"",joined:Date.now()});
(async()=>{
  const browser=await chromium.launch();
  const sched={1:[90001,90002,90003,90004]};
  const p=await page(browser,{me:"s1",owner:false,docs:{"control/main":{cur:1,ev:"",sched,assign:{s1:"r1"},pitAssign:{s1:[90001]}},"entries/s1":{rows:{},ts:1,profile:prof("נועה")}}});
  await p.click('[data-mode="pit"]');await p.waitForTimeout(150);await p.click('#v-pit [data-popen="90001"]');await p.waitForTimeout(200);
  // יציאה מהקיר = לא → חניה באוטונומי נעלמת, והתשובה שלה לא נשמרת
  await p.click('[data-pb="aPark"][data-v="yes"]');await p.click('[data-pb="aLeave"][data-v="no"]');await p.waitForTimeout(100);
  ok(!(await p.$('[data-pb="aPark"]'))&&!(await T(p,()=>PF.set.includes("aPark"))),'pit: no LEAVE → auto parking hidden and dropped');
  await p.click('[data-pb="aLeave"][data-v="yes"]');await p.waitForTimeout(100);
  ok(!!(await p.$('[data-pb="aPark"]')),'pit: LEAVE yes → auto parking back');
  // יורה אחד; 0 כדורים באוטונומי → היפוכים באוטונומי נעלמים
  await p.click('[data-p1="shooters"][data-v="1"]');await p.waitForTimeout(100);
  await p.click('[data-pn="aBalls"] [data-pd="-1"]');await p.waitForTimeout(100);
  ok(await T(p,()=>PF.set.includes("aBalls")&&PF.aBalls===0)&&!(await p.$('[data-pn="aTips"]')),'pit: 0 auto balls → auto flips hidden');
  // רק פולן → נקטר בדקה האחרונה נעלם
  await p.click('[data-p1="balls"][data-v="pollen"]');await p.waitForTimeout(100);
  ok(!(await p.$('[data-pb="late"]')),'pit: pollen only → last-minute nectar hidden');
  // בלי יורה → כל הירי נעלם
  await p.click('[data-p1="shooters"][data-v="0"]');await p.waitForTimeout(100);
  ok(!(await p.$('[data-p1="balls"]'))&&!(await p.$('[data-pn="aBalls"]'))&&!(await p.$('[data-pn="aTips"]'))&&!(await p.$('[data-p1="mount"]')),'pit: no shooter → shooting questions hidden');
  ok(await T(p,()=>{const r=pitReqFor(PF);return !r.includes("balls")&&!r.includes("aTips")&&!r.includes("mount")&&r.includes("cap")&&r.includes("role");}),'pit: must list skips hidden questions');
  ok(!!(await p.$('[data-pn="cap"]'))&&!!(await p.$('[data-p1="role"]'))&&!!(await p.$('[data-pb="tPark"]')),'pit: must questions in the main part');
  ok(p.errs.length===0,'pit: no JS errors '+p.errs.join('|'));
  // טופס המאץ׳: "לא הגיע" מסתיר את המאץ׳, ההערות נשארות
  const m=await page(browser,{me:"s1",owner:false,docs:{"control/main":{cur:1,ev:"",sched,assign:{s1:"r1"}},"entries/s1":{rows:{},ts:1,profile:prof("נועה")}}});
  await m.click('[data-mode="match"]');await m.waitForTimeout(150);await m.click('[data-startm="1"]');await m.waitForTimeout(200);
  await m.click('#noShow');await m.waitForTimeout(100);
  ok(await m.isHidden('.block[data-phase="auto"]')&&await m.isHidden('#qchips')&&await m.isHidden('.fseg[data-fk="aStart"]')&&await m.isVisible('#fNotes'),'match: no-show hides the match, keeps notes');
  await m.click('#noShow');await m.waitForTimeout(100);
  ok(await m.isVisible('.block[data-phase="auto"]'),'match: undo no-show shows it again');
  ok(m.errs.length===0,'match: no JS errors '+m.errs.join('|'));
  await browser.close();
  if(fails.length){console.log(fails.length+' failed');process.exit(1);}console.log('all passed');
})().catch(e=>{console.error(e);process.exit(1);});
