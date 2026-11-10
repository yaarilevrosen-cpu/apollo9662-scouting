"""בונה את גרסת האתר: אותה אפליקציה, מחוברת לענן.
הרצה: python tools/build-site.py  →  site/index.html (+ קבצי עזר). site/ מוחרג מהמאגר; הבנייה רצה גם בפעולה של גיטהאב."""
import base64, json, os, pathlib, re, shutil, sys
root = pathlib.Path(__file__).resolve().parent.parent

# בפעולה בגיטהאב (REQUIRE_CONFIG=1): לא בונים אתר שלא מחובר לענן, ולא אתר עם המפתח הסודי
if os.environ.get("REQUIRE_CONFIG") == "1":
    cfg = (root / "app" / "config.js").read_text(encoding="utf-8")
    url = re.search(r'url:\s*"([^"]*)"', cfg)
    key = re.search(r'anonKey:\s*"([^"]*)"', cfg)
    url, key = (url.group(1) if url else ""), (key.group(1) if key else "")
    if not url or not key:
        sys.exit("config.js ריק: חסרים כתובת ומפתח. ראו docs/cloud-setup.md, שלב 5")
    role = ""
    if key.count(".") == 2:
        try:
            p = key.split(".")[1]
            role = json.loads(base64.urlsafe_b64decode(p + "=" * (-len(p) % 4))).get("role", "")
        except Exception:
            role = ""
    if key.startswith("sb_secret_") or role == "service_role":
        sys.exit("config.js מכיל את המפתח הסודי! להחליף במפתח הציבורי, ולהחליף את המפתח הסודי בסופאבייס")
out = root / "site"
out.mkdir(exist_ok=True)
for f in ["config.js", "cloud.js"]:
    shutil.copy(root / "app" / f, out / f)
(out / "vendor").mkdir(exist_ok=True)
shutil.copy(root / "app" / "vendor" / "supabase.js", out / "vendor" / "supabase.js")
app = (root / "app" / "index.html").read_text(encoding="utf-8")
inject = '<script src="vendor/supabase.js"></script><script src="config.js"></script><script src="cloud.js"></script>'
assert app.count("<head>") == 1
(out / "index.html").write_text(app.replace("<head>", "<head>" + inject, 1), encoding="utf-8")
(out / ".nojekyll").write_text("")
print("נבנה", out)
