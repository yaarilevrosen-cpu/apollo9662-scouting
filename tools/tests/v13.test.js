// בדיקות גרסה 13: היפוכים של הברית וחלוקה לפי פגיעות, פרח, מטחים, תגיות, דף מאץ׳ לצוות הנהיגה, התאמה, "לא לבחור". קבוצות דמיוניות בלבד.
const {chromium}=require('playwright');
const fs=require('fs');
const src=fs.readFileSync(process.argv[2],'utf8');const hook='(function(){\ndocument.documentElement.setAttribute("lang","he");';
if(!src.includes(hook))throw new Error('test hook point missing');
/* פתח לבדיקה בלבד */
const html=src.replace(hook,'(function(){window.__T=c=>eval(c);\ndocument.documentElement.setAttribute("lang","he");');
const mock=fs.readFileSync(__dirname+'/mock.js','utf8');
const fails=[];const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fails.push(m);};
const T=(pg,fn)=>pg.evaluate(c=>window.__T('('+c+')()'),fn.toString());
async function page(browser,seed,vp){
  const ctx=await browser.newContext({viewport:vp||{width:390,height:844},deviceScaleFactor:1});
  const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!m.text().includes('Failed to load resource'))errs.push(m.text());});
  await p.addInitScript(`window.__SEED=${JSON.stringify(seed)};`+mock);
  await p.route('**/*',r=>r.request().url().startsWith('http://app/')?r.fulfill({body:html,contentType:'text/html'}):r.abort());
  await p.goto('http://app/');await p.waitForTimeout(400);p.errs=errs;return p;
}
const prof=n=>({nick:n,color:1,motto:"",joined:Date.now()});
const R=(m,t,x)=>({match:m,team:t,ev:"",ts:Date.now()-5000,fm:2,sv:true,...x});
(async()=>{
  const browser=await chromium.launch();
  const sched={1:[9662,90001,90002,90003],2:[90001,90002,90003,9662],3:[9662,90004,90005,90006]};
  // ── קרדיט: 3 היפוכים לברית האדומה, 6 פגיעות ל־9662 ו־2 לשותף ──
  const rowsA={"m1-t9662":R(1,9662,{aFlip:1,aHit:4,tFlip:2,shotsHit:6,shotsMiss:2,hitT:[40,40.5,41,60,60.4,61],flipT:[42,62],fBalls:6,bonus:1,cell:0,nectHive:true,tags:["fastCycle"]}),
    "m1-t90001":R(1,90001,{aFlip:1,aHit:0,tFlip:2,shotsHit:2,tags:["pin"]}),
    "m1-t90002":R(1,90002,{aFlip:0,tFlip:1,shotsHit:5}),"m1-t90003":R(1,90003,{noShow:true})};
  const pit={p9662:{team:9662,ev:"",ts:Date.now()-9000,starts:["B"],balls:"pollen",zones:["mid"],intake:["floor"],set:["starts","balls","zones","intake","drive","shooters"],drive:"tank",shooters:"1"},
    p90001:{team:90001,ev:"",ts:Date.now()-9000,starts:["B"],balls:"both",zones:["mid"],set:["starts","balls","zones"]}};
  const m=await page(browser,{me:"mgr",owner:true,docs:{"control/main":{cur:3,ev:"",sched},"entries/s1":{rows:rowsA,ts:1,profile:prof("נועה"),pit}}},{width:1280,height:900});
  const cr=await T(m,()=>Object.fromEntries(allRows().filter(r=>r.match===1).map(r=>[r.team,[r.aTips,r.tTips]])));
  ok(cr[9662][0]===1&&cr[90001][0]===0,'credit: auto flip goes to the robot that hit '+JSON.stringify(cr));
  ok(Math.abs(cr[9662][1]-1.5)<1e-9&&Math.abs(cr[90001][1]-.5)<1e-9,'credit: teleop flips split by hits (6:2)');
  ok(cr[90002][1]===1,'credit: partner no-show – all flips are ours');
  ok(await T(m,()=>{const r=allRows().find(x=>x.match===1&&x.team===9662);return pts(r).end===6*2+5&&pts(r).tips===2.5;}),'points: flower balls and bottom nectar');
  // היפוכים רשמיים גוברים על הספירה בשליטה הידנית
  ok(await T(m,()=>{S.control=readControl({...S.control,day:{otips:{1:[5,1]}}});return Math.abs(allRows().find(x=>x.match===1&&x.team===9662).tTips-3)<1e-9;}),'credit: official alliance tips replace the scouted teleop count');
  const me=await T(m,()=>measuredOf(allStats().A.find(a=>a.team===9662)));
  ok(me.volley_cycle_s&&me.volley_cycle_s.value===20&&me.balls_per_volley.value===3,'export: volley cycle and balls per volley '+JSON.stringify([me.volley_cycle_s,me.balls_per_volley]));
  ok(me.nectar_hive.value===1&&me.flower_balls.value===6&&me.tags.fastCycle.value===1,'export: nectar, flower and tags');
  ok(me.minor_fouls&&me.breakdown_share&&me.disconnect_share&&me.points_sd===null,'export: fouls, breakdowns, disconnects');
  // התאמה ודף מאץ׳
  ok(await T(m,()=>compat(90001).some(x=>x[1].includes("אותה עמדת פתיחה"))&&compat(90001).some(x=>x[1]==="משלימה נקטר")),'compat: same start and nectar complement');
  await T(m,()=>{openSheet(3);return 1;});await m.waitForTimeout(200);
  const sh=await m.textContent('#sheet');
  ok(sh.includes('מאץ׳ 3')&&sh.includes('לשאול את השותף')&&sh.includes('הגנה'),'sheet: drive team page opens');
  await m.click('[data-sheetclose]');ok(!(await m.$('#sheet')),'sheet: closes');
  // "לא לבחור"
  await m.click('#tab-play');await m.waitForTimeout(300);
  const dn=await m.$('[data-dnp="90002"]');
  if(dn){await dn.click();await m.waitForTimeout(300);ok(await T(m,()=>S.control.day.dnp.includes(90002)),'pick list: do-not-pick saved for all managers');}
  else ok(false,'pick list: do-not-pick button');
  ok(m.errs.length===0,'manager: no JS errors '+m.errs.join('|'));

  // ── סקאוטר: שורת הלחיצות במבנה החדש ──
  const s=await page(browser,{me:"s1",owner:false,docs:{"control/main":{cur:1,ev:"",sched,assign:{s1:"r2"}},"entries/s1":{rows:{},ts:1,profile:prof("נועה")}}});
  await s.click('[data-mode="match"]');await s.waitForTimeout(150);await s.click('[data-startm="1"]');await s.waitForTimeout(150);
  ok(await s.isHidden('[data-k="tTips"]')&&!(await s.isHidden('[data-k="tFlip"]')),'form: new counters shown, old ones hidden');
  await T(s,()=>{startClock(Date.now()-10000);return 1;});await s.waitForTimeout(300);
  ok(await s.$('#shotStrip [data-strip="aHit"]')&&await s.$('#shotStrip [data-strip="aFlip"]'),'strip: auto has hit and flip');
  await s.click('#shotStrip [data-strip="aHit"]');await s.click('#shotStrip [data-strip="aFlip"]');
  await T(s,()=>{CLK.t0=Date.now()-60000;renderClock();return 1;});await s.waitForTimeout(300);
  for(let i=0;i<3;i++)await s.click('#shotStrip [data-strip="shotsHit"]');
  await s.click('#shotStrip [data-strip="tFlip"]');await s.click('#shotStrip [data-strip="shotsHit"]');
  ok(await T(s,()=>F.shotsHit===4&&F.tFlip===1&&F.hitT.length===4&&F.aHitT.length===1&&F.flipT.length===2&&F.flipH.join()==="1,4"&&F.aHit===1),'strip: hits and flips recorded with times');
  await s.click('#qchips [data-tag="block"]');
  ok(await T(s,()=>F.tags.includes("block")),'tags: one tap');
  await T(s,()=>{CLK.t0=Date.now()-176000;renderClock();return 1;});await s.waitForTimeout(400);
  ok(await T(s,()=>F.cell===1),'end: balls left in the cell = hits after the last flip');
  await s.click('#formSave');await s.waitForTimeout(400);
  const saved=await T(s,()=>window.__STORE["entries/s1"].rows["m1-t90001"]);
  ok(saved&&saved.fm===2&&saved.hitT.length===4&&saved.tags[0]==="block"&&saved.tFlip===1,'save: new fields stored '+JSON.stringify(saved&&{fm:saved.fm,tFlip:saved.tFlip}));
  ok(s.errs.length===0,'scout: no JS errors '+s.errs.join('|'));

  // ── רשומה ישנה בעריכה: המונים הישנים ──
  const o=await page(browser,{me:"s1",owner:false,docs:{"control/main":{cur:2,ev:"",sched},"entries/s1":{rows:{"m1-t90001":{match:1,team:90001,ev:"",ts:1,tTips:2,flower:3}},ts:1,profile:prof("נועה")}}});
  await o.click('[data-mode="match"]');await o.waitForTimeout(150);
  await T(o,()=>{loadEntry("m1-t90001","s1");return 1;});await o.waitForTimeout(200);
  ok(!(await o.isHidden('[data-k="tTips"]'))&&await o.isHidden('[data-k="tFlip"]'),'legacy record: old counters for editing');
  ok(o.errs.length===0,'legacy: no JS errors '+o.errs.join('|'));
  await browser.close();
  console.log(fails.length?'\n'+fails.length+' FAILED':'\nALL PASSED');process.exit(fails.length?1:0);
})();
