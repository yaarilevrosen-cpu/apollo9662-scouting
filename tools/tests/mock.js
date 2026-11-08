// Mock of window.claude.use("db"/"user") with shared state in localStorage-free memory, seeded via window.__SEED
(function(){
  const seed=window.__SEED||{};
  const store=JSON.parse(JSON.stringify(seed.docs||{})); // path -> data
  const subs=[]; // {kind:'doc'|'col', path, cb}
  window.__STORE=store;
  const deep=(a,b)=>{for(const [k,v] of Object.entries(b)){if(v&&typeof v==="object"&&!Array.isArray(v)&&a[k]&&typeof a[k]==="object"&&!Array.isArray(a[k]))deep(a[k],v);else a[k]=JSON.parse(JSON.stringify(v));}return a;};
  const snapDoc=p=>({exists:p in store,data:()=>JSON.parse(JSON.stringify(store[p]||{})),metadata:{fromCache:false}});
  const snapCol=c=>({docs:Object.keys(store).filter(k=>k.startsWith(c+"/")).map(k=>({id:k.slice(c.length+1),data:()=>JSON.parse(JSON.stringify(store[k]))})),metadata:{fromCache:false}});
  const notify=()=>setTimeout(()=>{for(const s of subs)s.kind==="doc"?s.cb(snapDoc(s.path)):s.cb(snapCol(s.path));},5);
  const db={
    doc:p=>({onSnapshot(cb){subs.push({kind:"doc",path:p,cb});setTimeout(()=>cb(snapDoc(p)),5);return()=>{};},
      async set(v){store[p]=JSON.parse(JSON.stringify(v));notify();},
      async update(v){if(!(p in store))throw {code:"not_found"};deep(store[p],v);notify();}}),
    collection:c=>({onSnapshot(cb){subs.push({kind:"col",path:c,cb});setTimeout(()=>cb(snapCol(c)),5);return()=>{};}})
  };
  const user={isOwner:async()=>!!seed.owner,id:async()=>seed.me,name:async()=>seed.name||"",can:async()=>true,profiles:async ids=>Object.fromEntries(ids.map(i=>[i,{name:"שם "+i}]))};
  window.__DL=[];const downloads={save:async o=>{window.__DL.push(o);}};
  window.claude={use:async k=>k==="db"?db:k==="user"?user:k==="downloads"?downloads:null};
})();
