"""בונה את דף הבדיקה על המחשב: שלושה טלפונים מדומים על מאגר משותף מדומה.
הרצה: python tools/build-pc-test.py  →  נוצר pc-test.html (מוחרג מהמאגר)."""
import base64, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
app = (root / "app" / "index.html").read_bytes()
tpl = (root / "tools" / "pc-test.tpl.html").read_text(encoding="utf-8")
out = root / "pc-test.html"
out.write_text(tpl.replace("__APP_B64__", base64.b64encode(app).decode()), encoding="utf-8")
print("נוצר", out)
