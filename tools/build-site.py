"""בונה את גרסת האתר: אותה אפליקציה, מחוברת לענן.
הרצה: python tools/build-site.py  →  site/index.html (+ קבצי עזר). site/ מוחרג מהמאגר; הבנייה רצה גם בפעולה של גיטהאב."""
import pathlib, shutil
root = pathlib.Path(__file__).resolve().parent.parent
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
