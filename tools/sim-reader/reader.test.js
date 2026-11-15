/* בדיקה לקורא: חי/שאילה מול השרת המדומה, ואז בלי שרת – זיכרון, קובץ ו־QR. דורש מאגר מבדיקת cloud.test.js.
   הרצה: PG_URL=... node tools/sim-reader/reader.test.js */
const {spawn}=require("child_process");const path=require("path");const zlib=require("zlib");const fs=require("fs");const {Client}=require("pg");
global.supabase=require("@supabase/supabase-js");
const R=require("./scouting-reader.js");const PORT=54330;const ROOT=path.resolve(__dirname,"../..");
const DBURL=(process.env.PG_URL||"postgres://postgres@localhost:5544/postgres").replace(/\/[^/]*$/,"/cloudtest");
const fails=[];const ok=(c,m)=>{console.log((c?"PASS ":"FAIL ")+m);if(!c)fails.push(m);};const wait=ms=>new Promise(r=>setTimeout(r,ms));
const mem=()=>{const m=new Map();return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};};
(async()=>{
  const srv=spawn("node",[path.join(ROOT,"supabase/tests/fake-supabase.js"),String(PORT),DBURL],{stdio:"ignore"});await wait(700);
  const u=await (await fetch(`http://127.0.0.1:${PORT}/__test/user`,{method:"POST",body:JSON.stringify({email:"sim@example.test",password:"pw-sim"})})).json();
  const q=new Client({connectionString:DBURL});await q.connect();await q.query("insert into members(uid,role,name) values ($1,'reader','סימולטור')",[u.id]);
  const nProf=(await q.query("select count(*)::int n from sim_profiles")).rows[0].n;
  const storage=mem();const ups=[];const sts=[];
  const r=R.create({url:`http://127.0.0.1:${PORT}`,anonKey:"anon",email:"sim@example.test",password:"pw-sim",storage,onUpdate:x=>ups.push(x),onStatus:x=>sts.push(x.mode)});
  await wait(3000);
  const first=ups.find(x=>x.source==="poll"||x.source==="live");
  ok(first&&first.data.robots.length===nProf&&first.data.format==="apollo9662-scouting/event","reader: gets all profiles from the cloud ("+(first&&first.data.robots.length)+"/"+nProf+")");
  ok(first&&first.data.schedule["1"].red.length===2,"reader: schedule included");
  ok(!!storage.getItem("a9662-sim-cache:"),"reader: snapshot cached locally");
  /* שינוי בענן מגיע בשאילה */
  await q.query("update sim_profiles set data=jsonb_set(data,'{matches_seen}','99'),updated_at=now() where team=90001");
  await wait(11000);
  const upd=ups.slice().reverse().find(x=>x.source!=="cache");
  ok(upd&&upd.data.robots.find(x=>x.team===90001).matches_seen===99,"reader: cloud change arrives within 10 s");
  r.stop();
  /* גרסה 2: אסימון קריאה, בלי חשבון */
  await q.query("insert into settings(key,value) values ('sim_token','Tok1234567890abcdefghijklmn') on conflict (key) do update set value=excluded.value");
  const ups4=[];const r4=R.create({url:`http://127.0.0.1:${PORT}`,anonKey:"anon",token:"Tok1234567890abcdefghijklmn",storage:mem(),onUpdate:x=>ups4.push(x)});
  await wait(2500);
  ok(ups4[0]&&ups4[0].source==="poll"&&ups4[0].data.robots.length===nProf,"reader token: gets profiles without a password ("+(ups4[0]&&ups4[0].data.robots.length)+")");
  r4.stop();
  const ups5=[];const r5=R.create({url:`http://127.0.0.1:${PORT}`,anonKey:"anon",token:"WrongWrongWrongWrongWrong1",storage:mem(),onUpdate:x=>ups5.push(x)});
  await wait(1500);ok(ups5.length===0,"reader token: wrong token gets nothing");r5.stop();
  srv.kill();await wait(300);
  /* בלי שרת: זיכרון */
  const ups2=[];const r2=R.create({url:`http://127.0.0.1:${PORT}`,anonKey:"anon",email:"sim@example.test",password:"pw-sim",storage,onUpdate:x=>ups2.push(x)});
  await wait(1500);
  ok(ups2[0]&&ups2[0].source==="cache"&&ups2[0].data.robots.length===nProf,"reader offline: falls back to cached snapshot");
  ok(r2.status()==="offline","reader offline: status offline");
  /* קובץ */
  const sample=fs.readFileSync(path.join(ROOT,"docs/samples/sim-match-sample.json"),"utf8");
  ok(r2.importFile(sample)&&ups2.at(-1).source==="file","reader: manual file");
  ok(!r2.importFile('{"version":2,"format":"apollo9662-scouting/match"}'),"reader: unknown version refused");
  ok(!r2.importFile(JSON.stringify({...JSON.parse(sample),event_code:"OTHER"})),"reader: other event refused");
  /* QR בשני חלקים */
  const b64=zlib.deflateRawSync(Buffer.from(sample)).toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  const h=Math.ceil(b64.length/2);const p1="A9662:1/2:ab12:"+b64.slice(0,h),p2="A9662:2/2:ab12:"+b64.slice(h);
  ok(await r2.addQR(p2)===1,"reader: QR waits for missing part");
  ok(await r2.addQR(p1)===0&&ups2.at(-1).source==="qr"&&ups2.at(-1).data.match===JSON.parse(sample).match,"reader: QR package rebuilt");
  ok(await r2.addQR("A9662:3/2:zz99:abc")===-1&&await r2.addQR("A9662:1/1:yy88:@@@")===-1&&await r2.addQR("A9662:1/1:xx77:AAAA")===-1,"reader: bad QR returns -1 without throwing");
  /* קוד חיבור מהמנהל */
  const cc=x=>"A9662C:1:"+zlib.deflateRawSync(Buffer.from(JSON.stringify(x))).toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  const cfg=await R.parseConnCode(" "+cc({url:"https://abc.supabase.co",key:"anon",email:"sim@example.test",pw:"pw-sim",event:"ILCMP"})+"\n");
  ok(cfg&&cfg.url==="https://abc.supabase.co"&&cfg.anonKey==="anon"&&cfg.email==="sim@example.test"&&cfg.password==="pw-sim"&&cfg.eventCode==="ILCMP","reader: connection code parsed (with spaces and Enter)");
  const cc2=x=>"A9662C:2:"+zlib.deflateRawSync(Buffer.from(JSON.stringify(x))).toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  const cfg2=await R.parseConnCode(cc2({url:"https://abc.supabase.co",key:"anon",token:"Tok1234567890abcdefghijklmn",event:"ILCMP"}));
  ok(cfg2&&cfg2.token==="Tok1234567890abcdefghijklmn"&&!cfg2.password&&cfg2.eventCode==="ILCMP","reader: connection code v2 (token) parsed");
  ok(await R.parseConnCode(cc2({url:"https://abc.supabase.co",key:"anon",token:"short"}))===null,"reader: v2 with a bad token refused");
  ok(await R.parseConnCode(cc({url:"javascript:alert(1)",key:"a",email:"b",pw:"c"}))===null&&await R.parseConnCode(cc({url:"http://localhost:1@evil.com",key:"a",email:"b",pw:"c"}))===null&&await R.parseConnCode(cc({url:"http://evil.com",key:"a",email:"b",pw:"c"}))===null&&await R.parseConnCode("A9662C:1:@@@")===null&&await R.parseConnCode("A9662C:3:AAAA")===null,"reader: bad connection code returns null");
  /* זיכרון של תחרות אחרת לא נטען */
  const ups3=[];const r3=R.create({url:`http://127.0.0.1:${PORT}`,anonKey:"anon",email:"x",password:"y",storage,eventCode:"OTHER",onUpdate:x=>ups3.push(x)});
  await wait(800);ok(ups3.length===0,"reader: cache of another event not used");r3.stop();
  r2.stop();await q.query("delete from members where uid=$1",[u.id]);await q.end();
  console.log(fails.length?fails.length+" FAILED":"ALL PASSED");process.exit(fails.length?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
