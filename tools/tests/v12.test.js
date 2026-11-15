// בדיקות גרסה 12: משיכה מ־FTCScout (מדומה), משמרות, התראות כיסוי, הודעה לסקאוטרים, דירוג רשמי. קבוצות דמיוניות בלבד.
const {chromium}=require('playwright');
const fs=require('fs');
const src=fs.readFileSync(process.argv[2],'utf8');const hook='(function(){\ndocument.documentElement.setAttribute("lang","he");';
if(!src.includes(hook))throw new Error('test hook point missing');
/* פתח לבדיקה בלבד: גישה לפונקציות שבתוך האפליקציה */
const html=src.replace(hook,'(function(){window.__T=c=>eval(c);\ndocument.documentElement.setAttribute("lang","he");');
const mock=fs.readFileSync(__dirname+'/mock.js','utf8');
const fails=[];const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fails.push(m);};
const T=(pg,fn)=>pg.evaluate(c=>window.__T('('+c+')()'),fn.toString());
/* תשובה מדומה של FTCScout: שלושה מאצ׳י דירוג (שניים שוחקו) ומאץ׳ גמר אחד שלא נכנס ללוח */
const tm=(r1,r2,b1,b2)=>[["Red","One",r1],["Red","Two",r2],["Blue","One",b1],["Blue","Two",b2]].map(([alliance,station,teamNumber])=>({teamNumber,alliance,station}));
const FTC={data:{eventByCode:{name:"North League Meet 1",teams:[90001,90002,90003,90004,90005,90006,90007,90008].map((n,i)=>({teamNumber:n,team:{name:"קבוצה "+n},stats:i<4?{rank:i+1,rp:3-i*.5,qualMatchesPlayed:2}:null})),
  matches:[{matchNum:1,tournamentLevel:"Quals",hasBeenPlayed:true,teams:tm(90001,90002,90003,90004),scores:{red:{totalPoints:120,tips:5},blue:{totalPoints:90,tips:3}}},
    {matchNum:2,tournamentLevel:"Quals",hasBeenPlayed:true,teams:tm(90005,90006,90007,90008),scores:{red:{totalPoints:80,tips:2},blue:{totalPoints:140,tips:7}}},
    {matchNum:3,tournamentLevel:"Quals",hasBeenPlayed:false,teams:tm(90001,90005,90002,90006),scores:null},
    {matchNum:1,tournamentLevel:"DoubleElim",hasBeenPlayed:false,teams:tm(90001,90002,90003,90004),scores:null}]}}};
let ftcCalls=0;
async function page(browser,seed,vp){
  const ctx=await browser.newContext({viewport:vp||{width:390,height:844},deviceScaleFactor:1});
  const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!m.text().includes('Failed to load resource'))errs.push(m.text());});
  await p.addInitScript(`window.__SEED=${JSON.stringify(seed)};`+mock);
  await p.route('**/*',r=>r.request().url().startsWith('http://app/')?r.fulfill({body:html,contentType:'text/html'}):r.abort());
  await p.route('https://api.ftcscout.org/graphql',r=>{ftcCalls++;r.fulfill({body:JSON.stringify(FTC),contentType:'application/json',headers:{'access-control-allow-origin':'*'}});});
  await p.goto('http://app/');await p.waitForTimeout(400);p.errs=errs;return p;
}
const prof=n=>({nick:n,color:1,motto:"",joined:Date.now()});
(async()=>{
  const browser=await chromium.launch();
  // ── משיכה מ־FTCScout ──
  const m=await page(browser,{me:"mgr",owner:true,docs:{"control/main":{cur:1,ev:"",sched:{4:[90001,90002,90003,90004]}}}},{width:1280,height:900});
  await m.click('#tab-admin');await m.waitForTimeout(200);
  await m.fill('#ftcCode','ilnom1');await m.click('[data-ftcpull]');await m.waitForTimeout(400);
  let ctl=await T(m,()=>window.__STORE["control/main"]);
  ok(ftcCalls===1&&Object.keys(ctl.sched).join()==="4",'ftc: first pull that would delete matches asks first');
  await m.click('[data-ftcpull]');await m.waitForTimeout(500);
  ctl=await T(m,()=>window.__STORE["control/main"]);
  ok(Object.keys(ctl.sched).sort().join()==="1,2,3"&&ctl.sched[3].join()==="90001,90005,90002,90006",'ftc: quals schedule pulled, playoffs left out '+JSON.stringify(ctl.sched));
  ok(ctl.scores[1].join()==="120,90"&&ctl.scores[2].join()==="80,140"&&!ctl.scores[3],'ftc: official scores of played matches');
  ok(ctl.cur===3,'ftc: current match moves past the last played one ('+ctl.cur+')');
  ok(ctl.day.otips[2].join()==="2,7"&&ctl.day.ranks[90001][0]===1&&ctl.day.ftc.code==="ILNOM1",'ftc: official tips, ranks and code stored');
  ok(ctl.event==="North League Meet 1",'ftc: event name filled');
  ok(await T(m,()=>window.__STORE["teams/90003"]?.name==="קבוצה 90003"),'ftc: team names saved');
  // עדכון אוטומטי: לא מוחק מאצ׳ים שהוספו ידנית, ולא כותב כשאין שינוי
  await T(m,()=>{S.control.sched[9]=[90001,90002,90003,90004];return 1;});
  await T(m,()=>ftcSync("ILNOM1",true));await m.waitForTimeout(300);
  ok(await T(m,()=>!!sched()[9]&&!!sched()[1]),'ftc: auto update never deletes matches');
  // קוד של תחרות אחרת: אוטומטי לא נוגע; ידני – רק בלחיצה שנייה, ומאפס ניקוד
  await T(m,()=>ftcSync("ILNOM2",true));await m.waitForTimeout(300);
  ok(await T(m,()=>S.control.day.ftc.code==="ILNOM1"),'ftc: auto never switches to another event');
  await m.click('#tab-admin');await m.waitForTimeout(150);await m.fill('#ftcCode','ILNOM2');await m.click('[data-ftcpull]');await m.waitForTimeout(300);
  ok(await T(m,()=>S.control.day.ftc.code==="ILNOM1"),'ftc: another event asks first');
  await m.click('[data-ftcpull]');await m.waitForTimeout(400);
  ok(await T(m,()=>S.control.day.ftc.code==="ILNOM2"&&!sched()[9]),'ftc: second tap replaces the event');
  await m.click('#tab-quals');await m.waitForTimeout(300);
  ok((await m.textContent('#qualsBody')).includes('רשמי'),'quals: official rank column');
  ok(m.errs.length===0,'manager ftc: no JS errors '+m.errs.join('|'));

  // ── משמרות ──
  const sched={};for(let i=1;i<=24;i++)sched[i]=[90001+i%8,90009+i%8,90017+i%8,90025+i%8];
  const docs={"control/main":{cur:1,ev:"",sched,assign:{u1:"r1"}}};for(let i=1;i<=6;i++)docs["entries/u"+i]={rows:{},ts:1,profile:prof("סקאוטר "+i)};
  const s=await page(browser,{me:"mgr",owner:true,docs},{width:1280,height:900});
  // שינוי עמדה באמצע: העבר נשאר בעמדה הקודמת
  await T(s,()=>{S.control=readControl({...S.control,cur:5});return 1;});
  await s.click('#tab-admin');await s.waitForTimeout(200);
  await s.selectOption('#as-u1','b2');await s.waitForTimeout(300);
  ok(await T(s,()=>slotAt("u1",3)==="r1"&&slotAt("u1",5)==="b2"&&slotAt("u1",9)==="b2"),'shifts: changing a slot keeps past matches on the old slot');
  await s.click('[data-autoassign]');await s.waitForTimeout(300);
  const plan=await T(s,()=>[1,5,11,17].map(mm=>["u1","u2","u3","u4","u5","u6"].map(u=>slotAt(u,mm)).join(",")));
  ok(plan[1].split(",").filter(Boolean).length===4&&plan[2].split(",").filter(Boolean).length===4,'shifts: four on duty in every block '+JSON.stringify(plan));
  ok(plan[1]!==plan[2],'shifts: rotation every 6 matches');
  ok(await T(s,()=>slotAt("u1",2)==="r1"),'shifts: auto plan keeps the past');
  ok(await T(s,()=>slotAt("u2",2)===""),'shifts: a scout added by the plan was not on duty before it');
  await T(s,()=>{S.control.day.log.push({u:"ghost",s:"b2",f:1});return 1;});await s.click('#tab-board');await s.click('#tab-admin');await s.waitForTimeout(100);await s.click('[data-autoassign]');await s.waitForTimeout(300);
  ok(await T(s,()=>slotAt("ghost",30)===""&&slotAt("ghost",2)==="b2"),'shifts: someone left out of the plan goes off duty');
  ok(s.errs.length===0,'shifts: no JS errors '+s.errs.join('|'));

  // ── סקאוטר בהפסקה ──
  const log=[{u:"s1",s:"",f:1},{u:"s1",s:"b1",f:7}];
  const sb=await page(browser,{me:"s1",owner:false,docs:{"control/main":{cur:2,ev:"",sched,day:{log}},"entries/s1":{rows:{},ts:1,profile:prof("נועה")}}});
  await sb.click('[data-mode="match"]');await sb.waitForTimeout(200);
  const mt=await sb.textContent('#v-mission');
  ok(mt.includes('הפסקה')&&mt.includes('מאץ׳ 7'),'break: scout sees the break and when the next shift starts');
  ok(await T(sb,()=>missingMine().length===0),'break: matches during a break are not missing');
  ok(sb.errs.length===0,'break: no JS errors '+sb.errs.join('|'));

  // ── התראות כיסוי ──
  const rows={};for(const mm of [1,2])rows["m"+mm+"-t"+sched[mm][0]]={match:mm,team:sched[mm][0],ev:"",ts:1,shotsHit:1};
  const c=await page(browser,{me:"mgr",owner:true,docs:{"control/main":{cur:5,ev:"",sched,assign:{u1:"r1"}},"entries/u1":{rows,ts:1,profile:prof("רון")}}},{width:1280,height:900});
  const al=await c.textContent('#covAlert');
  ok(!(await c.isHidden('#covAlert'))&&al.includes('אדום 1')&&al.includes('2 מאצ׳ים')&&al.includes('רון'),'coverage: alert for a slot that stopped saving ('+al.trim().slice(0,80)+')');
  ok(c.errs.length===0,'coverage: no JS errors '+c.errs.join('|'));

  // ── הודעה לסקאוטרים ──
  await c.click('#tab-admin');await c.waitForTimeout(200);
  await c.fill('#bcTxt','עוברים לפיט');await c.click('[data-bcsend]');await c.waitForTimeout(300);
  const msg=await T(c,()=>window.__STORE["control/main"].day.msg);
  ok(msg&&msg.t==="עוברים לפיט"&&msg.to==="all",'broadcast: manager sends');
  const sc=await page(browser,{me:"s2",owner:false,docs:{"control/main":{cur:1,ev:"",day:{msg}},"entries/s2":{rows:{},ts:1,profile:prof("גל")}}});
  await sc.click('[data-mode="match"]');await sc.waitForTimeout(200);
  ok(!(await sc.isHidden('#bcBanner'))&&(await sc.textContent('#bcText')).startsWith('עוברים לפיט · '),'broadcast: scout sees it, with its age');
  await sc.click('#bcOk');await sc.waitForTimeout(100);
  ok(await sc.isHidden('#bcBanner'),'broadcast: dismissed');
  await sc.reload();await sc.waitForTimeout(400);
  ok(await sc.isHidden('#bcBanner'),'broadcast: stays dismissed after reload');
  ok(sc.errs.length===0,'broadcast: no JS errors '+sc.errs.join('|'));

  await browser.close();
  console.log(fails.length?'\n'+fails.length+' FAILED':'\nALL PASSED');process.exit(fails.length?1:0);
})();
