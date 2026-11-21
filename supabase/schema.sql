-- מאגר הענן של 04 סקאוטינג (סופאבייס). מריצים פעם אחת בעורך ה־SQL של הפרויקט.
-- אין כאן נתונים, מפתחות או כתובות. הכול מוגן בהרשאות ברמת השורה (החלטה 03).
-- תאימות: אותו מבנה מסמכים כמו בארטיפקט – control/main, teams/<מספר>, entries/<מזהה סקאוטר>.

-- ── חברים: סקאוטר, מנהל, או קורא (הסימולטור) ──
create table if not exists public.members (
  uid        uuid primary key,
  role       text not null check (role in ('scout','manager','reader')),
  name       text not null default '' check (char_length(name) <= 40),
  joined_at  timestamptz not null default now()
);

-- גרסה 12: "removed" – סקאוטר שהמנהל הסיר. הרשומות שלו נשארות, אבל אין לו גישה לכלום
alter table public.members drop constraint if exists members_role_check;
alter table public.members add constraint members_role_check check (role in ('scout','manager','reader','removed'));

-- ── הגבלת קצב כתיבה (גרסה 12): נגד סקאוטר שכותב בלולאה ומכלה את המכסה החינמית ──
create table if not exists public.write_rate (
  uid  uuid not null,
  win  timestamptz not null,
  n    int not null default 0,
  primary key (uid, win)
);

-- ── הגדרות פרטיות (קוד הצטרפות). אף אחד לא קורא ישירות, רק דרך פונקציות ──
create table if not exists public.settings (
  key   text primary key,
  value text not null
);

-- ── ניסיונות הצטרפות (נגד ניחוש הקוד) ──
create table if not exists public.join_attempts (
  uid  uuid not null,
  at   timestamptz not null default now()
);
create index if not exists join_attempts_uid on public.join_attempts (uid, at);

-- ── מסמכים, כמו במאגר של הארטיפקט ──
create table if not exists public.docs (
  path        text primary key check (path ~ '^(control/main|teams/[0-9]{1,5}|entries/[A-Za-z0-9_-]{1,80})$'),
  coll        text generated always as (split_part(path, '/', 1)) stored,
  doc_id      text generated always as (split_part(path, '/', 2)) stored,
  data        jsonb not null default '{}'::jsonb check (pg_column_size(data) <= 1048576),
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
create index if not exists docs_coll on public.docs (coll);

-- ── מה שהסימולטור קורא: פרופיל לכל קבוצה, ומידע על התחרות ──
create table if not exists public.sim_profiles (
  event_code  text not null default '' check (event_code ~ '^[A-Za-z0-9]{0,12}$'),
  team        int  not null check (team between 1 and 99999),
  data        jsonb not null check (pg_column_size(data) <= 65536),
  updated_at  timestamptz not null default now(),
  primary key (event_code, team)
);
create table if not exists public.sim_meta (
  event_code  text primary key check (event_code ~ '^[A-Za-z0-9]{0,12}$'),
  data        jsonb not null check (pg_column_size(data) <= 262144),
  updated_at  timestamptz not null default now()
);

-- ── עזרים ──
create or replace function public.my_role() returns text
language sql stable security definer set search_path = '' as $$
  select role from public.members where uid = auth.uid()
$$;
revoke all on function public.my_role() from public;
grant execute on function public.my_role() to authenticated;

create or replace function public.is_manager() returns boolean
language sql stable set search_path = '' as $$ select coalesce(public.my_role() = 'manager', false) $$;

-- מיזוג עמוק של שני אובייקטים (כמו update בארטיפקט)
-- עלות לפי גודל השינוי (b), לא לפי גודל המסמך השמור
create or replace function public.jsonb_deep_merge(a jsonb, b jsonb, depth int default 0) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare k text; v jsonb; r jsonb;
begin
  if jsonb_typeof(a) is distinct from 'object' or jsonb_typeof(b) is distinct from 'object' or depth > 6 then return b; end if;
  r := a;
  for k, v in select * from jsonb_each(b) loop
    if jsonb_typeof(v) = 'object' and jsonb_typeof(r -> k) = 'object' then
      r := r || jsonb_build_object(k, public.jsonb_deep_merge(r -> k, v, depth + 1));
    else
      r := r || jsonb_build_object(k, v);
    end if;
  end loop;
  return r;
end $$;

-- ── הרשאות ברמת השורה ──
alter table public.members      enable row level security;
alter table public.settings     enable row level security;
alter table public.docs         enable row level security;
alter table public.sim_profiles enable row level security;
alter table public.sim_meta     enable row level security;
-- ניסיונות הצטרפות: בלי מדיניות = חסום לכולם. רק join_team (בהרשאות הבעלים) נוגעת בה
alter table public.join_attempts enable row level security;
-- קצב כתיבה: בלי מדיניות = חסום לכולם. רק note_write (בהרשאות הבעלים) נוגעת בה
alter table public.write_rate enable row level security;

-- חברים: כל אחד רואה את עצמו; מנהל רואה את כולם. שינוי תפקידים – רק מנהל.
drop policy if exists members_read on public.members;
create policy members_read on public.members for select to authenticated
  using (uid = auth.uid() or public.is_manager());
drop policy if exists members_manage on public.members;
create policy members_manage on public.members for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- הגדרות: אין גישה ישירה בכלל (בלי מדיניות = חסום).

-- מסמכים: קריאה
drop policy if exists docs_read on public.docs;
create policy docs_read on public.docs for select to authenticated using (
  (public.is_manager() and (coll <> 'entries' or exists (select 1 from public.members m where m.uid::text = doc_id)))
  or (public.my_role() = 'scout' and (coll in ('control','teams') or path = 'entries/' || auth.uid()::text))
);
-- מסמכים: כתיבה. סקאוטר – רק entries/<עצמו>. מנהל – הכול.
drop policy if exists docs_insert on public.docs;
create policy docs_insert on public.docs for insert to authenticated with check (
  public.is_manager() or (public.my_role() = 'scout' and path = 'entries/' || auth.uid()::text)
);
drop policy if exists docs_update on public.docs;
create policy docs_update on public.docs for update to authenticated
  using (public.is_manager() or (public.my_role() = 'scout' and path = 'entries/' || auth.uid()::text))
  with check (public.is_manager() or (public.my_role() = 'scout' and path = 'entries/' || auth.uid()::text));
drop policy if exists docs_delete on public.docs;
create policy docs_delete on public.docs for delete to authenticated using (public.is_manager());

-- פרופילים לסימולטור: כותב רק מנהל; קוראים מנהל וקורא.
drop policy if exists simp_read on public.sim_profiles;
create policy simp_read on public.sim_profiles for select to authenticated using (public.my_role() in ('manager','reader'));
drop policy if exists simp_write on public.sim_profiles;
create policy simp_write on public.sim_profiles for all to authenticated using (public.is_manager()) with check (public.is_manager());
drop policy if exists simm_read on public.sim_meta;
create policy simm_read on public.sim_meta for select to authenticated using (public.my_role() in ('manager','reader'));
drop policy if exists simm_write on public.sim_meta;
create policy simm_write on public.sim_meta for all to authenticated using (public.is_manager()) with check (public.is_manager());

-- גישה בסיסית לטבלאות (ההרשאות בפועל – במדיניות למעלה). אנונימי בלי חשבון – כלום.
revoke all on public.members, public.settings, public.docs, public.sim_profiles, public.sim_meta from anon;
grant select, insert, update, delete on public.members, public.docs, public.sim_profiles, public.sim_meta to authenticated;
revoke all on public.settings from authenticated;
revoke all on public.join_attempts from anon, authenticated;
revoke all on public.write_rate from anon, authenticated;

-- ── פונקציות ──
-- הצטרפות כסקאוטר עם קוד הקבוצה. מנהל וקורא לא משתנים.
-- מחזירה: התפקיד, או 'bad_code' / 'rate_limited' / 'full'. לא זורקת שגיאה, כדי שהניסיון יירשם.
create or replace function public.join_team(code text, display_name text default '') returns text
language plpgsql security definer set search_path = '' as $$
declare want text; cur text; tries int; nm text;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select role into cur from public.members where uid = auth.uid();
  if cur is not null then return cur; end if;
  select count(*) into tries from public.join_attempts where uid = auth.uid() and at > now() - interval '10 minutes';
  if tries >= 5 then return 'rate_limited'; end if;
  insert into public.join_attempts(uid) values (auth.uid());
  delete from public.join_attempts where at < now() - interval '1 day';
  select value into want from public.settings where key = 'join_code';
  -- לא רגיש לאותיות ולרווחים בקצוות: המקלדת בטלפון מגדילה את האות הראשונה לבד
  want := upper(btrim(want));
  if want is null or length(want) < 8 or upper(btrim(coalesce(code,''))) <> want then return 'bad_code'; end if;
  if (select count(*) from public.members where role = 'scout') >= 60 then return 'full'; end if;
  -- בלי תווי בקרה וכיווניות שאפשר להתחזות בהם
  nm := btrim(regexp_replace(coalesce(display_name,''), '[\u0001-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]', '', 'g'));
  insert into public.members(uid, role, name) values (auth.uid(), 'scout', left(nm, 40));
  delete from public.join_attempts where uid = auth.uid();
  return 'scout';
end $$;
revoke all on function public.join_team(text, text) from public;
grant execute on function public.join_team(text, text) to authenticated;

-- החלפת קוד ההצטרפות – רק מנהל
create or replace function public.set_join_code(code text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_manager() then raise exception 'not_manager'; end if;
  code := btrim(code);
  if code is null or length(code) < 8 or length(code) > 32 then raise exception 'bad_code'; end if;
  insert into public.settings(key, value) values ('join_code', code)
    on conflict (key) do update set value = excluded.value;
end $$;
revoke all on function public.set_join_code(text) from public;
grant execute on function public.set_join_code(text) to authenticated;

-- הסרה והחזרה של סקאוטר – רק מנהל, ורק בין "scout" ל־"removed" (לא נוגע במנהל או בקורא)
create or replace function public.set_scout_role(target uuid, new_role text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_manager() then raise exception 'not_manager'; end if;
  if new_role not in ('scout','removed') then raise exception 'bad_role'; end if;
  update public.members set role = new_role where uid = target and role in ('scout','removed');
  if not found then raise exception 'not_found'; end if;
end $$;
revoke all on function public.set_scout_role(uuid, text) from public;
grant execute on function public.set_scout_role(uuid, text) to authenticated;

-- קצב: עד 20 כתיבות בדקה לכל סקאוטר (שמירה רגילה היא אחת בכמה שניות). מנהל – בלי הגבלה
create or replace function public.note_write() returns void
language plpgsql security definer set search_path = '' as $$
declare k int;
begin
  if public.my_role() is distinct from 'scout' then return; end if;
  insert into public.write_rate(uid, win, n) values (auth.uid(), date_trunc('minute', now()), 1)
    on conflict (uid, win) do update set n = public.write_rate.n + 1 returning n into k;
  if k > 20 then raise exception 'rate_limited'; end if;
  if random() < 0.02 then delete from public.write_rate where win < now() - interval '1 hour'; end if;
end $$;
revoke all on function public.note_write() from public;
grant execute on function public.note_write() to authenticated;

-- אסימון קריאה לסימולטור (גרסה 14): במקום סיסמה בקוד החיבור. המנהל מחליף אותו בלחיצה, והקוד הישן מפסיק לעבוד מיד
create or replace function public.set_sim_token(tok text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_manager() then raise exception 'not_manager'; end if;
  if tok is null or tok !~ '^[A-Za-z0-9]{24,64}$' then raise exception 'bad_token'; end if;
  insert into public.settings(key, value) values ('sim_token', tok) on conflict (key) do update set value = excluded.value;
  -- אסימון חדש מבטל ספרות שעוד לא נוצלו (גרסה 19), כדי שהן לא ימסרו אותו. set_sim_pair מכניסה ספרות חדשות אחרי זה
  delete from public.sim_pairing where id = 1;
end $$;
revoke all on function public.set_sim_token(text) from public;
grant execute on function public.set_sim_token(text) to authenticated;
-- קריאה עם האסימון: רק פרופילים ומידע התחרות (בדיוק מה שחשבון הקריאה רואה). גם בלי חשבון
create or replace function public.sim_read(tok text, ev text default '') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare want text;
begin
  select value into want from public.settings where key = 'sim_token';
  if want is null or tok is null or length(tok) < 24 or tok <> want then raise exception 'bad_token'; end if;
  return jsonb_build_object(
    'meta', (select jsonb_build_object('data', data, 'updated_at', updated_at) from public.sim_meta where event_code = coalesce(ev, '')),
    'profiles', coalesce((select jsonb_agg(jsonb_build_object('team', team, 'data', data, 'updated_at', updated_at)) from public.sim_profiles where event_code = coalesce(ev, '')), '[]'::jsonb));
end $$;
revoke all on function public.sim_read(text, text) from public;

-- ── קוד צימוד של 6 ספרות (גרסה 19): במקום קיואר או מחרוזת ארוכה ──
-- המנהל יוצר אסימון חדש ו־6 ספרות. בסימולטור מקלידים את הספרות פעם אחת ומקבלים את האסימון (ואת התחרות).
-- הספרות: תקפות 10 דקות, לשימוש אחד, ונשרפות אחרי 10 טעויות (סיכוי ניחוש 10 מתוך מיליון)
create table if not exists public.sim_pairing (
  id     int primary key default 1 check (id = 1),
  pin    text not null check (pin ~ '^[0-9]{6}$'),
  ev     text not null default '' check (ev ~ '^[A-Za-z0-9]{0,12}$'),
  exp    timestamptz not null,
  fails  int not null default 0
);
-- בלי מדיניות = חסום לכולם. רק set_sim_pair ו־sim_pair (בהרשאות הבעלים) נוגעות בה
alter table public.sim_pairing enable row level security;
revoke all on public.sim_pairing from anon, authenticated;

create or replace function public.set_sim_pair(tok text, pin text, ev text default '') returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_manager() then raise exception 'not_manager'; end if;
  if pin is null or pin !~ '^[0-9]{6}$' then raise exception 'bad_pin'; end if;
  if coalesce(ev, '') !~ '^[A-Za-z0-9]{0,12}$' then raise exception 'bad_event'; end if;
  perform public.set_sim_token(tok);
  insert into public.sim_pairing(id, pin, ev, exp, fails) values (1, pin, coalesce(ev, ''), now() + interval '10 minutes', 0)
    on conflict (id) do update set pin = excluded.pin, ev = excluded.ev, exp = excluded.exp, fails = 0;
end $$;
revoke all on function public.set_sim_pair(text, text, text) from public;
grant execute on function public.set_sim_pair(text, text, text) to authenticated;

-- גם בלי חשבון. לא זורקת שגיאה בטעות, כדי שספירת הטעויות תישמר.
-- חשוב: הספירה נשמרת רק כי כל קריאה נשמרת בסוף. לא להפעיל ב־PostgREST את db-tx-end עם allow-override
-- (אז אפשר לבקש ביטול בסוף כל קריאה, והספירה לא נשמרת – ניחוש בלי הגבלה).
-- ידוע ומקובל: מי שמכיר את הכתובת הציבורית יכול לשרוף ספרות פעילות ב־10 ניסיונות. המנהל פשוט יוצר חדשות.
-- מחזירה { token, event } או { error: 'bad_pin' | 'expired' }
create or replace function public.sim_pair(pin text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare r record; t text; p text := btrim(coalesce(pin, ''));
begin
  select * into r from public.sim_pairing where id = 1 for update;
  if not found then return jsonb_build_object('error', 'expired'); end if;
  if r.exp < now() or r.fails >= 10 then
    delete from public.sim_pairing where id = 1;
    return jsonb_build_object('error', 'expired');
  end if;
  if p <> r.pin then
    if r.fails + 1 >= 10 then delete from public.sim_pairing where id = 1;
    else update public.sim_pairing set fails = fails + 1 where id = 1; end if;
    return jsonb_build_object('error', 'bad_pin');
  end if;
  delete from public.sim_pairing where id = 1;
  select value into t from public.settings where key = 'sim_token';
  if t is null then return jsonb_build_object('error', 'expired'); end if;
  return jsonb_build_object('token', t, 'event', r.ev);
end $$;
revoke all on function public.sim_pair(text) from public;

-- כתיבה למסמך: set (החלפה) או merge (מיזוג עמוק). רץ בהרשאות המשתמש, כך שהמדיניות חלה.
drop function if exists public.doc_write(text, jsonb, boolean);
drop function if exists public.jsonb_deep_merge(jsonb, jsonb);
-- מצבים: 'set' (החלפה), 'merge' (מיזוג עמוק), 'fields' (מחליף רק את השדות העליונים שנשלחו)
create or replace function public.doc_write(p_path text, p_data jsonb, p_mode text) returns timestamptz
language plpgsql security invoker set search_path = '' as $$
declare t timestamptz := now(); n int;
begin
  if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'bad_data'; end if;
  select count(*) into n from jsonb_object_keys(p_data);
  if n > 16 then raise exception 'bad_data'; end if;
  if p_path like 'entries/%' and pg_column_size(p_data) > 262144 then raise exception 'too_big'; end if;
  if p_path like 'entries/%' then perform public.note_write(); end if;
  if p_mode = 'merge' or p_mode = 'fields' then
    update public.docs set data = case when p_mode = 'merge' then public.jsonb_deep_merge(data, p_data) else data || p_data end
      where path = p_path;
    if not found then raise exception 'not_found'; end if;
  elsif p_mode = 'set' then
    insert into public.docs(path, data) values (p_path, p_data)
      on conflict (path) do update set data = excluded.data;
  else raise exception 'bad_mode';
  end if;
  return t;
end $$;
revoke all on function public.doc_write(text, jsonb, text) from public;
grant execute on function public.doc_write(text, jsonb, text) to authenticated;

-- מי כתב ומתי – תמיד מהשרת, אי אפשר לזייף
create or replace function public.stamp_row() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create or replace function public.stamp_doc() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if new.path like 'entries/%' then
    if pg_column_size(new.data) > 262144 then raise exception 'too_big'; end if;
  end if;
  return new;
end $$;
drop trigger if exists docs_stamp on public.docs;
create trigger docs_stamp before insert or update on public.docs for each row execute function public.stamp_doc();
drop trigger if exists simp_stamp on public.sim_profiles;
create trigger simp_stamp before insert or update on public.sim_profiles for each row execute function public.stamp_row();
drop trigger if exists simm_stamp on public.sim_meta;
create trigger simm_stamp before insert or update on public.sim_meta for each row execute function public.stamp_row();

-- סופאבייס נותן הרשאת הרצה לכל פונקציה חדשה; אנונימי בלי חשבון לא צריך אף אחת
revoke execute on all functions in schema public from anon;
grant execute on function public.sim_read(text, text) to anon, authenticated;
grant execute on function public.sim_pair(text) to anon, authenticated;
revoke execute on function public.jsonb_deep_merge(jsonb, jsonb, int) from public;
grant execute on function public.jsonb_deep_merge(jsonb, jsonb, int) to authenticated;

-- ── זמן אמת: הטבלאות שהאפליקציה והסימולטור מאזינים להן (בסופאבייס בלבד) ──
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.docs; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.sim_profiles; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.sim_meta; exception when duplicate_object then null; end;
  end if;
end $$;
