# בדיקות דפדפן

ממאגר האפליקציה:

    node tools/tests/pit.test.js app/index.html
    node tools/tests/profile.test.js app/index.html

- `mock.js` מדמה את המאגר, המשתמש וההורדות. רק קבוצות דמיוניות, מ־90001 ומעלה.
- `profile.test.js` כותב קובצי דוגמה לצד הבדיקה. אם משהו במבנה השתנה, מעתיקים אותם ל־`docs/samples/`.
