// בדיקות גרסה 15: התג "שעון שוויצרי" והביטחון בזמן המחזור עובדים גם עם הטופס החדש (גרסה 13). קבוצות דמיוניות בלבד.
const {chromium}=require('playwright');
const fs=require('fs');
const src=fs.readFileSync(process.argv[2],'utf8');const hook='(function(){\ndocument.documentElement.setAttribute("lang","he");';
if(!src.includes(hook))throw new Error('test hook point missing');
/* פתח לבדיקה בלבד */
const html=src.replace(hook,'(function(){window.__T=c=>eval(c);\ndocument.documentElement.setAttribute("lang","he");');
const mock=fs.readFileSync(__dirname+'/mock.js','utf8');
const fails=[];const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fails.push(m);};
const T=(pg,fn)=>pg.evaluate(c=>window.__T('('+c+')()'),fn.toString());
(async()=>{
  const browser=await chromium.launch();
  const sched={};for(let m=1;m<=6;m++)sched[m]=[90001,90002+m,90010+m,90020+m];
  const now=Date.now();const rows={};
  /* חמישה מאצ׳ים בטופס החדש, עם זמני פגיעות והיפוכים; מאץ׳ שישי בלי שעון */
  for(let m=1;m<=5;m++)rows["m"+m+"-t90001"]={match:m,team:90001,ev:"",ts:now-10000+m,by:"s1",fm:2,sv:true,clk:true,shotsHit:4,hitT:[45,47,70,72],tFlip:3,flipT:[50,66,82],flipH:[1,2,4]};
  rows["m6-t90001"]={match:6,team:90001,ev:"",ts:now-100,by:"s1",fm:2,sv:true,shotsHit:2};
  const ctx=await browser.newContext({viewport:{width:1280,height:900}});const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.addInitScript(`window.__SEED=${JSON.stringify({me:"mgr",owner:true,docs:{"control/main":{cur:7,ev:"",sched},"entries/s1":{rows,ts:now,profile:{nick:"נועה",color:1,motto:"",joined:now}}}})};`+mock);
  await p.route('**/*',r=>r.request().url().startsWith('http://app/')?r.fulfill({body:html,contentType:'text/html'}):r.abort());
  await p.goto('http://app/');await p.waitForTimeout(500);
  const s=await T(p,()=>{const x=scoutsList().find(y=>y.uid==="s1");const st=scoutStats("s1",x.rows,null);return {clock:st.clock,badges:st.badges,xp:st.xp,life:st.life};});
  ok(s.life===6,'six records counted ('+s.life+')');
  ok(s.clock===5,'new-form matches count as clocked ('+s.clock+')');
  ok(s.badges.includes("clock"),'"שעון שוויצרי" badge unlocked');
  ok(s.xp>=6*10+5*4,'clock XP counted ('+s.xp+')');
  const cy=await T(p,()=>robotProfile(90001).measured.cycle_s);
  ok(cy&&cy.confidence>0,'cycle confidence uses flip times for the new form ('+JSON.stringify(cy)+')');
  const old=await T(p,()=>scoutStats("x",[{match:1,team:90001,ev:"",ts:1,by:"x",tTips:2,tipT:[50,70]}],null).clock);
  ok(old===1,'old-form clock still counted');
  await p.click('#tab-crew').catch(()=>{});await p.waitForTimeout(200);
  ok(errs.length===0,'no JS errors '+errs.join('|'));
  await browser.close();
  if(fails.length){console.log(fails.length+' failed');process.exit(1);}console.log('all passed');
})().catch(e=>{console.error(e);process.exit(1);});
