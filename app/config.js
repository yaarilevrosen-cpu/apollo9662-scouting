/* הגדרות הענן של 04. המפתח הציבורי (anon) מותר בקוד לפי החלטה 03 – ההגנה היא בהרשאות שבמאגר.
   המפתח הסודי (service_role) לעולם לא כאן ולא במאגר.
   ממלאים אחרי שפותחים את הפרויקט בסופאבייס (ראו docs/cloud-setup.md). */
window.SCOUT_CLOUD = window.SCOUT_CLOUD || {
  url: "",      /* למשל https://xxxx.supabase.co */
  anonKey: ""   /* Project Settings → API → anon public */
};
