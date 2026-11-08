-- בדיקות הרשאות. כל בדיקה שנכשלת זורקת שגיאה. ריצה: psql -v ON_ERROR_STOP=1 -f
\set mgr  '11111111-1111-1111-1111-111111111111'
\set s1   '22222222-2222-2222-2222-222222222222'
\set s2   '33333333-3333-3333-3333-333333333333'
\set rdr  '44444444-4444-4444-4444-444444444444'
\set out  '55555555-5555-5555-5555-555555555555'
insert into members(uid,role,name) values (:'mgr','manager','מנהל'),(:'rdr','reader','סימולטור');
insert into settings values ('join_code','abcd1234');

create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub',u,'role','authenticated')::text, false); end $$;
create or replace function pg_temp.expect_fail(sql text, what text) returns void language plpgsql as $$
begin begin execute sql; exception when others then return; end; raise exception 'SHOULD FAIL: %', what; end $$;

set role authenticated;
-- מנהל כותב לוח זמנים וקבוצה
select pg_temp.as_user(:'mgr');
select doc_write('control/main','{"cur":1,"sched":{"1":[90001,90002,90003,90004]}}','set');
select doc_write('teams/90001','{"num":90001,"name":"דרקונים"}','set');
select set_join_code('code5678');

-- מבחוץ, בלי חשבון: כלום
reset role; set role anon;
select pg_temp.expect_fail($$select * from docs$$,'anon reads docs');
select pg_temp.expect_fail($$select jsonb_deep_merge('{}','{}')$$,'anon runs merge');
select pg_temp.expect_fail($$select join_team('code5678','x')$$,'anon joins');
reset role; set role authenticated;

-- משתמש מחובר שלא הצטרף: לא רואה כלום, לא כותב
select pg_temp.as_user(:'out');
do $$ begin if (select count(*) from docs) <> 0 then raise exception 'outsider sees docs'; end if; end $$;
select pg_temp.expect_fail($$select doc_write('entries/55555555-5555-5555-5555-555555555555','{"rows":{}}','set')$$,'outsider writes own entry');
do $$ begin if join_team('wrong','x') <> 'bad_code' or join_team('abcd1234','x') <> 'bad_code' then raise exception 'bad code accepted'; end if; end $$;

-- סקאוטר מצטרף עם הקוד
select pg_temp.as_user(:'s1');
do $$ begin if join_team('code5678',E'\u202eנועה\u0007') <> 'scout' then raise exception 'join failed'; end if; end $$;
do $$ begin if (select name from members where uid=auth.uid()) <> 'נועה' then raise exception 'name not cleaned: %', (select name from members where uid=auth.uid()); end if; end $$;
select doc_write('entries/22222222-2222-2222-2222-222222222222','{"rows":{"m1-t90001":{"tTips":2}},"ts":1}','set');
select doc_write('entries/22222222-2222-2222-2222-222222222222','{"rows":{"m2-t90002":{"tTips":1}},"pit":{"p90001":{"drive":"tank"}}}','merge');
do $$ declare d jsonb; begin select data into d from docs where path='entries/22222222-2222-2222-2222-222222222222';
  if d->'rows'->'m1-t90001'->>'tTips' <> '2' or d->'rows'->'m2-t90002'->>'tTips' <> '1' or d->'pit'->'p90001'->>'drive' <> 'tank' or d->>'ts' <> '1'
  then raise exception 'deep merge wrong: %', d; end if; end $$;
do $$ begin if (select count(*) from docs where coll in ('control','teams')) <> 2 then raise exception 'scout cannot read control/teams'; end if; end $$;
select pg_temp.expect_fail($$select doc_write('control/main','{"cur":9}','merge')$$,'scout writes control');
select pg_temp.expect_fail($$select doc_write('teams/90009','{"num":90009}','set')$$,'scout writes team');
select pg_temp.expect_fail($$select doc_write('entries/33333333-3333-3333-3333-333333333333','{"rows":{}}','set')$$,'scout writes other entry');
select pg_temp.expect_fail($$insert into members(uid,role) values ('22222222-2222-2222-2222-222222222222','manager') on conflict (uid) do update set role='manager'$$,'scout promotes self');
update members set role='manager' where uid='22222222-2222-2222-2222-222222222222'; -- 0 שורות: המדיניות מסננת
do $$ begin if exists (select 1 from members where role='manager' and uid=auth.uid()) then raise exception 'scout became manager'; end if; end $$;
do $$ begin if (select count(*) from members) <> 1 then raise exception 'scout sees other members'; end if; end $$;
select pg_temp.expect_fail($$select * from settings$$,'scout reads join code');
do $$ begin if (select count(*) from sim_profiles) <> 0 then raise exception 'scout reads profiles'; end if; end $$;
select pg_temp.expect_fail($$insert into sim_profiles(team,data) values (90001,'{}')$$,'scout writes profile');
select pg_temp.expect_fail($$select set_join_code('hijack99')$$,'scout changes code');
select pg_temp.expect_fail($$select doc_write('entries/22222222-2222-2222-2222-222222222222','[1]','set')$$,'non-object data');
select pg_temp.expect_fail($$select doc_write('bad/path','{}','set')$$,'bad path');

-- זיוף "מי כתב" נדרס בשרת
update docs set updated_by='11111111-1111-1111-1111-111111111111' where path='entries/22222222-2222-2222-2222-222222222222';
do $$ begin if (select updated_by from docs where path='entries/22222222-2222-2222-2222-222222222222') <> auth.uid() then raise exception 'updated_by forged'; end if; end $$;
-- מסמך עם יותר מדי שדות עליונים נדחה
select pg_temp.expect_fail($$select doc_write('entries/22222222-2222-2222-2222-222222222222',(select jsonb_object_agg('k'||g,g) from generate_series(1,20) g),'set')$$,'too many top keys');
-- מיזוג על מסמך גדול מהיר (העלות לפי השינוי)
do $$ declare t0 timestamptz:=clock_timestamp(); begin
  perform doc_write('entries/22222222-2222-2222-2222-222222222222',jsonb_build_object('rows',(select jsonb_object_agg('r'||g,jsonb_build_object('x',g)) from generate_series(1,5000) g)),'merge');
  perform doc_write('entries/22222222-2222-2222-2222-222222222222','{"ts":2}','merge');
  if clock_timestamp()-t0 > interval '2 seconds' then raise exception 'merge too slow: %', clock_timestamp()-t0; end if; end $$;

-- ניחוש הקוד: אחרי 5 ניסיונות בעשר דקות – חסום
select pg_temp.as_user('66666666-6666-6666-6666-666666666666');
do $$ declare r text; i int; begin for i in 1..5 loop r:=join_team('guess'||i,'x'); end loop;
  if join_team('code5678','x') <> 'rate_limited' then raise exception 'no rate limit'; end if; end $$;

-- סקאוטר שני לא רואה את הראשון
select pg_temp.as_user(:'s2');
select join_team('code5678','איתי');
do $$ begin if (select count(*) from docs where coll='entries') <> 0 then raise exception 's2 sees s1 entry'; end if; end $$;

-- מנהל רואה הכול, מפרסם פרופילים
select pg_temp.as_user(:'mgr');
do $$ begin if (select count(*) from docs where coll='entries') <> 1 then raise exception 'manager cannot see entries'; end if;
  if (select count(*) from members) <> 4 then raise exception 'manager cannot see members'; end if; end $$;
-- הסרת סקאוטר: הרשומות שלו כבר לא נספרות
reset role; insert into docs(path,data) values ('entries/77777777-7777-7777-7777-777777777777','{"rows":{}}'); set role authenticated; select pg_temp.as_user(:'mgr');
do $$ begin if exists (select 1 from docs where path='entries/77777777-7777-7777-7777-777777777777') then raise exception 'manager sees entry of non-member'; end if; end $$;
insert into sim_profiles(event_code,team,data) values ('',90001,'{"team":90001}') on conflict (event_code,team) do update set data=excluded.data, updated_at=now();
insert into sim_meta(event_code,data) values ('','{"schedule":{}}') on conflict (event_code) do update set data=excluded.data;

-- הקורא (הסימולטור): קורא פרופילים בלבד
select pg_temp.as_user(:'rdr');
do $$ begin if (select count(*) from sim_profiles) <> 1 or (select count(*) from sim_meta) <> 1 then raise exception 'reader cannot read profiles'; end if;
  if (select count(*) from docs) <> 0 then raise exception 'reader sees raw docs'; end if;
  if (select count(*) from members) <> 1 then raise exception 'reader sees members'; end if; end $$;
select pg_temp.expect_fail($$insert into sim_profiles(team,data) values (90002,'{}')$$,'reader writes profile');
do $$ begin update sim_profiles set data='{}'; if (select data from sim_profiles where team=90001) = '{}'::jsonb then raise exception 'reader changed profile'; end if; exception when insufficient_privilege then null; end $$;
do $$ begin if join_team('code5678','x') <> 'reader' then raise exception 'reader role changed by join'; end if; end $$;

reset role;
select 'ALL RLS TESTS PASSED' as result;
