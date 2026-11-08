const {chromium}=require('playwright');
const fs=require('fs');
const html=fs.readFileSync(process.argv[2],'utf8');
const mock=fs.readFileSync(__dirname+'/mock.js','utf8');
const out=__dirname+'/shots';fs.mkdirSync(out,{recursive:true});
const fails=[];const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fails.push(m);};
async function page(browser,seed,vp){
  const ctx=await browser.newContext({viewport:vp||{width:390,height:844},deviceScaleFactor:1});
  const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!m.text().includes('Failed to load resource'))errs.push(m.text());});
  await p.addInitScript(`window.__SEED=${JSON.stringify(seed)};`+mock);
  await p.route('**/*',r=>r.request().url().startsWith('http://app/')?r.fulfill({body:html,contentType:'text/html'}):r.abort());
  await p.goto('http://app/');await p.waitForTimeout(400);p.errs=errs;return p;
}
(async()=>{
  const browser=await chromium.launch();
  const sched={1:[90001,90002,90003,90004],2:[9662,90005,90006,90007]};
  const control={cur:1,sched,ev:"",pitAssign:{s1:[90001,90002,90003]}};
  // ── scout ──
  const seedS={me:"s1",owner:false,docs:{"control/main":control,"entries/s1":{rows:{},ts:1,profile:{nick:"נועה",color:1,motto:"",joined:Date.now()}}}};
  const s=await page(browser,seedS);
  await s.click('#tab-pit');await s.waitForTimeout(200);
  ok(await s.isVisible('#v-pit'),'scout: pit tab visible');
  ok((await s.locator('#v-pit [data-popen]').count())===3,'scout: three assigned teams listed');
  await s.screenshot({path:out+'/scout-list.png',fullPage:true});
  await s.click('#v-pit [data-popen="90001"]');await s.waitForTimeout(200);
  ok(await s.isVisible('#pitForm'),'scout: form opens');
  await s.click('[data-p1="drive"][data-v="mecanum"]');
  await s.click('[data-p1="shooters"][data-v="1"]');
  await s.click('#pitMore summary');await s.click('[data-p1="speed"][data-v="fast"]');
  await s.click('[data-pm="intake"][data-v="flower"]');await s.click('[data-pm="intake"][data-v="human"]');
  await s.click('[data-pn="cap"] [data-pd="1"]');await s.click('[data-pn="cap"] [data-pd="1"]');
  await s.click('[data-pm="zones"][data-v="mid"]');
  await s.click('[data-pb="moving"][data-v="yes"]');await s.click('[data-pb="lift"][data-v="no"]');
  await s.click('[data-pm="starts"][data-v="A"]');
  await s.fill('#pitNotes','גאים באוטונומי');
  await s.screenshot({path:out+'/scout-form.png',fullPage:true});
  await s.click('[data-psave]');await s.waitForTimeout(300);
  const st=await s.evaluate(()=>window.__STORE["entries/s1"]);
  const rec=st.pit&&st.pit.p90001;
  ok(rec&&rec.drive==="mecanum"&&rec.speed==="fast"&&rec.cap===2&&rec.zones.join()==="mid"&&rec.intake.join()==="flower,human"&&rec.moving===true&&rec.lift===false&&rec.set.includes('lift')&&!rec.set.includes('aim')&&rec.notes==="גאים באוטונומי"&&rec.starts.join()==="A",'scout: record saved to own doc '+JSON.stringify(rec));
  ok(Object.keys(st.rows).length===0,'scout: match rows untouched');
  ok(await s.isVisible('#pitForm')&&(await s.textContent('#pitForm h2')).includes('90002'),'scout: next assigned team opened automatically');
  // retry
  await s.click('[data-pretry]');await s.click('[data-pretry]');await s.waitForTimeout(300);
  const st2=await s.evaluate(()=>window.__STORE["entries/s1"].pit.p90002);
  ok(st2&&st2.retry===true,'scout: retry marker saved');
  // reopen 90001 shows saved values
  await s.click('#v-pit [data-popen="90001"]');await s.waitForTimeout(200);
  ok(await s.getAttribute('[data-p1="drive"][data-v="mecanum"]','aria-pressed')==='true','scout: saved values reload');
  // edit and save keeps history
  await s.click('[data-p1="speed"][data-v="mid"]');await s.click('[data-psave]');await s.waitForTimeout(300);
  const st3=await s.evaluate(()=>window.__STORE["entries/s1"].pit.p90001);
  ok(st3.speed==="mid"&&st3.edits.length===1,'scout: edit keeps history');
  ok(s.errs.length===0,'scout: no JS errors '+s.errs.join('|'));
  await s.screenshot({path:out+'/scout-after.png',fullPage:true});
  // ── manager ──
  const scoutDoc=JSON.parse(JSON.stringify(await s.evaluate(()=>window.__STORE["entries/s1"])));
  const seedM={me:"mgr",owner:true,docs:{"control/main":control,"entries/s1":scoutDoc,"entries/s2":{rows:{},ts:1,pit:{p90004:{team:90004,ev:"",ts:Date.now(),drive:"tank",role:"defense"}}},"teams/90001":{num:90001,name:"דרקונים"}}};
  const m=await page(browser,seedM,{width:1280,height:900});
  await m.click('#tab-pit');await m.waitForTimeout(300);
  const rows=await m.locator('#v-pit tr[data-popen]').count();
  ok(rows===7,'manager: coverage lists all schedule teams except us ('+rows+')');
  const chip=async t=>m.textContent(`#v-pit tr[data-popen="${t}"] .chip`);
  ok((await chip(90001))==='נסקר'&&(await chip(90002))==='לנסות שוב'&&(await chip(90004))==='חלקי'&&(await chip(90005))==='חסר','manager: statuses correct');
  await m.screenshot({path:out+'/mgr-coverage.png',fullPage:true});
  await m.click('[data-pauto]');await m.waitForTimeout(300);
  const pa=await m.evaluate(()=>window.__STORE["control/main"].pitAssign);
  const all=Object.values(pa).flat().sort();
  ok(all.length===7&&new Set(all).size===7,'manager: auto assign covers every team once '+JSON.stringify(pa));
  ok(pa.s1.join()==='90001,90002,90003'&&pa.s2.join()==='90004,90005,90006,90007','manager: existing assignments kept, free teams in a contiguous block '+JSON.stringify(pa));
  ok(Math.abs(pa.s1.length-pa.s2.length)<=1,'manager: split is even');
  const ctl=await m.evaluate(()=>window.__STORE["control/main"]);
  ok(JSON.stringify(ctl.sched)===JSON.stringify(sched),'manager: schedule preserved by control write');
  await m.selectOption('#v-pit select[data-pas="90005"]','s2');await m.waitForTimeout(300);
  const pa2=await m.evaluate(()=>window.__STORE["control/main"].pitAssign);
  ok(pa2.s2.includes(90005)&&!(pa2.s1||[]).includes(90005),'manager: manual reassignment');
  await m.click('#v-pit tr[data-popen="90001"] td');await m.waitForTimeout(200);
  ok((await m.textContent('#v-pit')).includes('מה ידוע על 90001'),'manager: team summary shown');
  // team profile card
  await m.evaluate(()=>{});await m.click('#tab-team');await m.waitForTimeout(200);
  await m.fill('#tPick','90004');await m.waitForTimeout(300);
  ok((await m.textContent('#teamBody')).includes('סקאוטינג פיט')&&(await m.textContent('#teamBody')).includes('טנק')&&(await m.textContent('#teamBody')).includes('חסר:'),'manager: pit card in team profile (no matches yet)');
  await m.screenshot({path:out+'/mgr-team.png',fullPage:true});
  ok(m.errs.length===0,'manager: no JS errors '+m.errs.join('|'));
  // ── demo ──
  const d=await page(browser,{me:"mgr",owner:true,docs:{"control/main":{cur:1}}},{width:1280,height:900});
  await d.evaluate(()=>document.querySelector('[data-demo]')?.click());await d.waitForTimeout(300);
  await d.click('#tab-pit');await d.waitForTimeout(300);
  const dr=await d.locator('#v-pit tr[data-popen]').count();
  ok(dr===15,'demo: 15 teams in pit coverage ('+dr+')');
  await d.screenshot({path:out+'/demo-pit.png',fullPage:true});
  await d.click('#tab-board');await d.waitForTimeout(300);
  ok(d.errs.length===0,'demo: no JS errors '+d.errs.join('|'));
  // ── regression: match entry still saves ──
  const r=await page(browser,seedS);
  await r.click('#tab-entry');await r.fill('#fMatch','1');await r.fill('#fTeam','90001');await r.click('#formSave');await r.waitForTimeout(300);
  const rr=await r.evaluate(()=>window.__STORE["entries/s1"].rows);
  ok(rr&&rr["m1-t90001"],'regression: match entry still saved');
  ok(r.errs.length===0,'regression: no JS errors '+r.errs.join('|'));
  await browser.close();
  console.log(fails.length?'\n'+fails.length+' FAILED':'\nALL PASSED');process.exit(fails.length?1:0);
})();
