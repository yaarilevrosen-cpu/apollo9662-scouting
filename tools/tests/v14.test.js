// בדיקות גרסה 14: שאלות פיט חדשות ותמונת רובוט, גיבוי בקוד מהסקאוטר למנהל, עברית אחידה. קבוצות דמיוניות בלבד.
const {chromium}=require('playwright');
const fs=require('fs');const zlib=require('zlib');
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
/* תמונה קטנה ואמיתית (PNG בצבע אחד, 400 על 300) */
function png(w,h){
  const crc=(b)=>{let c,t=[];for(let n=0;n<256;n++){c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0;}let x=0xffffffff;for(const v of b)x=t[(x^v)&255]^(x>>>8);return (x^0xffffffff)>>>0;};
  const chunk=(type,data)=>{const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const td=Buffer.concat([Buffer.from(type),data]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([len,td,c]);};
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=2;
  const raw=Buffer.alloc((w*3+1)*h);for(let y=0;y<h;y++){raw[y*(w*3+1)]=0;for(let x=0;x<w;x++){const o=y*(w*3+1)+1+x*3;raw[o]=242;raw[o+1]=182;raw[o+2]=50;}}
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),chunk("IDAT",zlib.deflateSync(raw)),chunk("IEND",Buffer.alloc(0))]);
}
(async()=>{
  const browser=await chromium.launch();
  const sched={1:[90001,90002,90003,90004],2:[90005,90006,90007,90008]};
  // ── פיט ──
  const p=await page(browser,{me:"s3",owner:false,docs:{"control/main":{cur:1,ev:"",sched,pitAssign:{s3:[90001]}},"entries/s3":{rows:{},ts:1,profile:prof("גל")}}});
  await p.click('[data-mode="pit"]');await p.waitForTimeout(150);await p.click('#v-pit [data-popen="90001"]');await p.waitForTimeout(200);
  ok(await p.$('[data-pn="tipsAll"]')&&await p.$('[data-pb="flipSide"]')&&await p.$('[data-pb="autoAdapt"]')&&await p.$('#pitBreaks'),'pit: new questions in the main part');
  ok(!(await p.$('[data-p1="shooter"]'))&&!(await p.$('[data-pb="full"]')),'pit: unused questions removed');
  ok((await p.textContent('#pitForm')).includes('לא ידוע'),'pit: "unknown" instead of "not asked"');
  fs.writeFileSync('/tmp/v14-robot.png',png(400,300));
  await p.setInputFiles('#pitPhoto','/tmp/v14-robot.png');await p.waitForTimeout(600);
  const ph=await T(p,()=>PF.photo);
  ok(ph&&ph.startsWith('data:image/jpeg;base64,')&&ph.length<=24000,'pit: photo shrunk to a small JPEG ('+(ph||"").length+')');
  await p.click('[data-p1="drive"][data-v="tank"]');await p.click('[data-p1="shooters"][data-v="1"]');await p.click('[data-pm="intake"][data-v="floor"]');await p.click('[data-p1="balls"][data-v="both"]');
  await p.click('[data-pn="tipsAll"] [data-pd="1"]');await p.click('[data-pn="tipsAll"] [data-pd="1"]');await p.click('[data-pb="flipSide"][data-v="yes"]');
  await p.fill('#pitBreaks','השרשרת במעלית');
  await p.click('[data-psave]');await p.waitForTimeout(400);
  const rec=await T(p,()=>window.__STORE["entries/s3"].pit.p90001);
  ok(rec&&rec.photo&&rec.breaks==="השרשרת במעלית"&&rec.tipsAll===2&&rec.flipSide===true,'pit: answers, note and photo saved');
  ok(p.errs.length===0,'pit: no JS errors '+p.errs.join('|'));
  // אצל המנהל: תמונה וסיכום, וייצוא לסימולטור
  const m=await page(browser,{me:"mgr",owner:true,docs:{"control/main":{cur:1,ev:"",sched},"entries/s3":JSON.parse(JSON.stringify(await T(p,()=>window.__STORE["entries/s3"])))}},{width:1280,height:900});
  await m.click('#tab-pit');await m.waitForTimeout(300);await m.click('#v-pit tr[data-popen="90001"] td');await m.waitForTimeout(200);
  ok(await m.$('#pitSummary img.pit-img')&&(await m.textContent('#pitSummary')).includes('השרשרת במעלית'),'manager: photo and what breaks shown');
  const dc=await T(m,()=>declaredOf(90001));
  ok(dc.tips_per_match===2&&dc.shoots_other_side_after_tip===true&&dc.auto_adaptable===null,'export: new declared fields');
  // ── גיבוי בקוד מהסקאוטר ──
  const rows={"m1-t90001":{match:1,team:90001,ev:"",ts:Date.now()-1000,fm:2,tFlip:2,shotsHit:3,sv:true},"m2-t90005":{match:2,team:90005,ev:"",ts:Date.now()-500,fm:2,aLeave:true}};
  const sc=await page(browser,{me:"s1",owner:false,docs:{"control/main":{cur:3,ev:"",sched},"entries/s1":{rows:{},ts:1,profile:prof("נועה")}}});
  await T(sc,()=>{S.pending=window.__ROWS;return 1;}).catch(()=>{});
  await sc.evaluate(r=>{window.__ROWS=r;},rows);await T(sc,()=>{S.pending=JSON.parse(JSON.stringify(window.__ROWS));return 1;});
  await sc.click('[data-mode="match"]');await sc.waitForTimeout(150);await sc.click('#tab-mine');await sc.waitForTimeout(200);
  await sc.click('[data-bkqr]');await sc.waitForTimeout(400);
  const parts=await T(sc,()=>QR.parts);
  ok(parts.length>=1&&parts.every(x=>/^A9662B:\d+\/\d+:[a-z0-9]+:[A-Za-z0-9_-]+$/.test(x)),'backup: scout shows backup codes ('+parts.length+')');
  ok(await sc.$('#qrBox [data-bkshare]'),'backup: can also be sent as text');
  ok(sc.errs.length===0,'backup scout: no JS errors '+sc.errs.join('|'));
  await m.click('#tab-admin');await m.waitForTimeout(200);
  if(parts.length>1){await m.fill('#bkTxt',parts[0]);await m.click('[data-bkpaste]');await m.waitForTimeout(200);ok((await m.textContent('#bkStatus')).includes('מתוך'),'backup: partial codes counted');}
  await m.fill('#bkTxt',parts.join("\n"));await m.click('[data-bkpaste]');await m.waitForTimeout(500);
  const got=await T(m,()=>window.__STORE["entries/s1"]);
  ok(got&&got.rows&&got.rows["m1-t90001"]&&got.rows["m1-t90001"].tFlip===2&&got.rows["m2-t90005"],'backup: manager wrote the rows into the scout\'s document');
  await m.fill('#bkTxt','שלום');await m.click('[data-bkpaste]');await m.waitForTimeout(100);
  ok(m.errs.length===0,'manager: no JS errors '+m.errs.join('|'));
  // ── עברית אחידה ──
  ok(!/(?<![\u0590-\u05FF])(לחץ|בחר|הקלד|נסה) /.test(src),'hebrew: no imperative "לחץ/בחר/הקלד/נסה" left');
  await browser.close();
  console.log(fails.length?'\n'+fails.length+' FAILED':'\nALL PASSED');process.exit(fails.length?1:0);
})();
