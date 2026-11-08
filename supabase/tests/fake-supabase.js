/* שרת בדיקה שמחקה את מה שהאפליקציה משתמשת בו בסופאבייס, מעל Postgres אמיתי עם schema.sql:
   כניסה (אנונימית ובסיסמה), קריאה מטבלאות, upsert ופונקציות. כל בקשה רצה בתפקיד authenticated
   עם מזהה המשתמש, כך שההרשאות ברמת השורה נבדקות באמת. אין כאן זרם חי – זה בכוונה, כדי לבדוק את המעבר לשאילה.
   שימוש: node fake-supabase.js <port> <postgres-url>   (לבדיקות בלבד) */
const http=require("http");const crypto=require("crypto");const {Pool}=require("pg");
const PORT=+process.argv[2]||54321;const pool=new Pool({connectionString:process.argv[3]});
const users=new Map(); /* email -> {id,password} */
const b64u=b=>Buffer.from(b).toString("base64").replace(/=+$/,"").replace(/\+/g,"-").replace(/\//g,"_");
function jwt(sub,extra){const h=b64u(JSON.stringify({alg:"HS256",typ:"JWT"}));const now=Math.floor(Date.now()/1000);
  const p=b64u(JSON.stringify({sub,role:"authenticated",aud:"authenticated",iat:now,exp:now+3600,...extra}));
  return h+"."+p+"."+b64u(crypto.createHmac("sha256","test").update(h+"."+p).digest());}
function claims(req){const a=req.headers.authorization||"";const t=a.replace(/^Bearer /,"");const parts=t.split(".");
  if(parts.length!==3)return null;try{const c=JSON.parse(Buffer.from(parts[1],"base64").toString());return c.sub?c:null;}catch(e){return null;}}
function session(u,anon){const access_token=jwt(u.id,{is_anonymous:!!anon});
  return {access_token,token_type:"bearer",expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,refresh_token:"r-"+u.id,user:{id:u.id,aud:"authenticated",role:"authenticated",email:u.email||"",is_anonymous:!!anon,app_metadata:{},user_metadata:{},created_at:new Date().toISOString()}};}
async function asUser(c,fn){const cl=await pool.connect();try{await cl.query("begin");
  if(c){await cl.query("set local role authenticated");await cl.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify(c)]);}
  else await cl.query("set local role anon");
  const r=await fn(cl);await cl.query("commit");return r;}catch(e){await cl.query("rollback").catch(()=>{});throw e;}finally{cl.release();}}
const TABLES={docs:["path","coll","doc_id","data","updated_at","updated_by"],members:["uid","role","name","joined_at"],sim_profiles:["event_code","team","data","updated_at"],sim_meta:["event_code","data","updated_at"]};
function send(res,code,body,hdr){res.writeHead(code,{"content-type":"application/json","access-control-allow-origin":"*","access-control-allow-headers":"*","access-control-allow-methods":"*","access-control-expose-headers":"*",...hdr});res.end(body===undefined?"":JSON.stringify(body));}
function filters(q,cols){const where=[],vals=[];
  for(const [k,v] of q){if(["select","limit","order","on_conflict","columns"].includes(k))continue;if(!cols.includes(k))throw new Error("bad column "+k);
    let m;if((m=/^eq\.(.*)$/.exec(v))){vals.push(m[1]);where.push(`"${k}"::text = $${vals.length}`);}
    else if((m=/^in\.\((.*)\)$/.exec(v))){const xs=m[1].split(",").map(x=>x.replace(/^"|"$/g,""));vals.push(xs);where.push(`"${k}"::text = any($${vals.length})`);}
    else throw new Error("bad filter "+v);}
  return {where:where.length?" where "+where.join(" and "):"",vals};}
const server=http.createServer(async(req,res)=>{
  if(req.method==="OPTIONS")return send(res,204);
  let body="";for await(const ch of req)body+=ch;const J=body?JSON.parse(body):null;
  const u=new URL(req.url,"http://x");const c=claims(req);
  try{
    /* ── כניסה ── */
    if(u.pathname==="/auth/v1/signup"&&req.method==="POST"){const id=crypto.randomUUID();return send(res,200,session({id},true));}
    if(u.pathname==="/auth/v1/token"&&u.searchParams.get("grant_type")==="password"){const x=users.get(J.email);if(!x||x.password!==J.password)return send(res,400,{error:"invalid_grant",error_description:"Invalid login credentials"});return send(res,200,session(x,false));}
    if(u.pathname==="/auth/v1/token"&&u.searchParams.get("grant_type")==="refresh_token"){const id=String(J.refresh_token||"").slice(2);return send(res,200,session({id},false));}
    if(u.pathname==="/auth/v1/user"){if(!c)return send(res,401,{msg:"no session"});return send(res,200,{id:c.sub,aud:"authenticated",role:"authenticated",is_anonymous:!!c.is_anonymous,app_metadata:{},user_metadata:{}});}
    if(u.pathname==="/auth/v1/logout")return send(res,204);
    /* לבדיקות: יצירת משתמש עם סיסמה */
    if(u.pathname==="/__test/user"){const id=crypto.randomUUID();users.set(J.email,{id,email:J.email,password:J.password});return send(res,200,{id});}
    /* ── פונקציות ── */
    let m;
    if((m=/^\/rest\/v1\/rpc\/(\w+)$/.exec(u.pathname))){
      const fn=m[1];if(!["doc_write","join_team","set_join_code"].includes(fn))return send(res,404,{message:"no function"});
      const keys=Object.keys(J||{});const r=await asUser(c,cl=>cl.query(`select public.${fn}(${keys.map((k,i)=>`${k} => $${i+1}`).join(",")}) as r`,keys.map(k=>typeof J[k]==="object"&&J[k]!==null?JSON.stringify(J[k]):J[k])));
      return send(res,200,r.rows[0].r);
    }
    /* ── טבלאות ── */
    if((m=/^\/rest\/v1\/(\w+)$/.exec(u.pathname))&&TABLES[m[1]]){
      const t=m[1],cols=TABLES[t];
      if(req.method==="GET"){const sel=(u.searchParams.get("select")||"*").split(",").filter(x=>x==="*"||cols.includes(x));
        const {where,vals}=filters(u.searchParams,cols);const lim=+u.searchParams.get("limit")||0;
        const r=await asUser(c,cl=>cl.query(`select ${sel.map(x=>x==="*"?"*":`"${x}"`).join(",")} from public.${t}${where}${lim?" limit "+lim:""}`,vals));
        return send(res,200,r.rows);}
      if(req.method==="DELETE"){const {where,vals}=filters(u.searchParams,cols);if(!where)return send(res,400,{message:"no filter"});
        await asUser(c,cl=>cl.query(`delete from public.${t}${where}`,vals));return send(res,204);}
      if(req.method==="POST"){const rows=Array.isArray(J)?J:[J];const conf=(u.searchParams.get("on_conflict")||"").split(",").filter(Boolean);
        for(const row of rows){const ks=Object.keys(row).filter(k=>cols.includes(k));
          const sql=`insert into public.${t}(${ks.map(k=>`"${k}"`).join(",")}) values (${ks.map((k,i)=>`$${i+1}`).join(",")})`+(conf.length?` on conflict (${conf.join(",")}) do update set ${ks.filter(k=>!conf.includes(k)).map(k=>`"${k}"=excluded."${k}"`).join(",")}`:"");
          await asUser(c,cl=>cl.query(sql,ks.map(k=>typeof row[k]==="object"&&row[k]!==null?JSON.stringify(row[k]):row[k])));}
        return send(res,201,[]);}
    }
    return send(res,404,{message:"not found "+u.pathname});
  }catch(e){const code=e.code==="42501"?403:400;return send(res,code,{code:e.code||"",message:String(e.message||e)});}
});
server.listen(PORT,()=>console.log("fake supabase on",PORT));
