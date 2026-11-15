/* עובד רקע: האפליקציה נפתחת גם בלי רשת, אחרי רענון או אחרי שהטלפון סגר את הלשונית.
   קודם הרשת (כדי לקבל תמיד את הגרסה החדשה), ואם אין רשת או שהיא תקועה יותר מ־4 שניות – העותק השמור.
   רק קבצי האפליקציה מאותו אתר. בקשות לענן (נתונים, כניסה) לא עוברות כאן בכלל. */
const CACHE = "a9662-app-v11";
const FILES = ["./", "index.html", "config.js", "cloud.js", "vendor/supabase.js", "manifest.json", "icon.svg"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("a9662-app-") && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const base = new URL(self.registration.scope).pathname;
  if (!url.pathname.startsWith(base)) return;
  /* רק קבצי האפליקציה עצמם; כל השאר (גם אם באותו אתר) עובר ישר לרשת */
  if (req.mode !== "navigate" && !FILES.includes(url.pathname.slice(base.length))) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = req.mode === "navigate" ? "index.html" : req;
    const net = fetch(req).then(r => {
      /* דף שנפתח ישירות (למשל config.js) לא נשמר במקום דף הבית: רק תוכן מסוג דף */
      const isPage = (r && r.headers.get("content-type") || "").includes("text/html");
      if (r && r.ok && r.type === "basic" && (req.mode !== "navigate" || isPage)) cache.put(key, r.clone()).catch(() => {});
      return r;
    });
    const timer = new Promise(res => setTimeout(res, 4000, null));
    try {
      const r = await Promise.race([net, timer]);
      if (r) return r;
    } catch (err) { /* אין רשת */ }
    const hit = await cache.match(key, { ignoreSearch: true });
    if (hit) return hit;
    return net;
  })());
});
