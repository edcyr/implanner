-- Privacy-rule check. Creates three throwaway users (Ann, Bob, Cat), exercises the rules as
-- each of them, then raises an error on purpose so EVERYTHING rolls back. Nothing is kept.
-- Run in Supabase → SQL Editor. The "error" message is the test report: every line should say ok.
do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  s_id uuid := gen_random_uuid(); act_id uuid := gen_random_uuid();
  cr public.crews; n int; out text := '';
begin
  insert into auth.users (id, email, raw_user_meta_data, aud, role) values
    (a, 'ann@rls-test.invalid', '{"name":"Ann"}', 'authenticated', 'authenticated'),
    (b, 'bob@rls-test.invalid', '{"name":"Bob"}', 'authenticated', 'authenticated'),
    (c, 'cat@rls-test.invalid', '{"name":"Cat"}', 'authenticated', 'authenticated');
  select count(*) into n from public.profiles where id in (a, b, c) and name in ('Ann', 'Bob', 'Cat');
  out := out || format(E'\n%s profile rows made by sign-up trigger (want 3)', n);

  set local role authenticated;

  -- Ann: plan, a finished workout with details, private settings, and a crew
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  insert into public.profile_settings (settings) values ('{"thresholds":{"ftp":250}}');
  insert into public.sessions (id, date, sport, title, duration_min) values (s_id, '2026-11-03', 'bike', 'Sweet spot', 60);
  insert into public.activities (id, session_id, date, sport, title, duration_s, notes) values (act_id, s_id, '2026-11-03', 'bike', 'Sweet spot', 3600, 'Felt good');
  insert into public.activity_details (activity_id, distance_m, avg_power) values (act_id, 32000, 210);
  cr := public.create_crew('Test crew');
  out := out || format(E'\ncrew created, invite code %s chars (want 12)', length(cr.invite_code));

  -- Bob before joining: sees nothing of Ann
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  select count(*) into n from public.sessions where user_id = a;
  out := out || format(E'\nBob sees %s of Ann''s sessions before joining (want 0)', n);
  select count(*) into n from public.crew_by_code(cr.invite_code);
  out := out || format(E'\nBob can look up the invite: %s (want 1)', n);
  perform public.join_crew(cr.invite_code);

  -- Bob after joining
  select count(*) into n from public.sessions where user_id = a;            out := out || format(E'\nBob sees Ann''s sessions: %s (want 1)', n);
  select count(*) into n from public.activities where user_id = a;          out := out || format(E'\nBob sees Ann''s workouts: %s (want 1)', n);
  select count(*) into n from public.activity_details where user_id = a;    out := out || format(E'\nBob sees Ann''s distance/power while she does not share: %s (want 0)', n);
  select count(*) into n from public.profile_settings where user_id = a;    out := out || format(E'\nBob sees Ann''s private settings: %s (want 0)', n);
  select count(*) into n from public.profiles where id = a;                 out := out || format(E'\nBob sees Ann''s profile: %s (want 1)', n);
  update public.sessions set title = 'hacked' where id = s_id;
  get diagnostics n = row_count;                                             out := out || format(E'\nBob changed Ann''s session: %s rows (want 0)', n);
  delete from public.activities where id = act_id;
  get diagnostics n = row_count;                                             out := out || format(E'\nBob deleted Ann''s workout: %s rows (want 0)', n);
  insert into public.cheers (to_user, target_type, target_id, emoji) values (a, 'activity', act_id::text, '👏');
  out := out || E'\nBob cheered Ann: ok';
  begin
    insert into public.crew_members (crew_id, user_id) values (cr.id, c);
    out := out || E'\nBob added Cat to the crew directly: ALLOWED (bad)';
  exception when others then out := out || E'\nBob blocked from adding Cat directly: ok';
  end;

  -- Ann opts in to sharing details
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  update public.profiles set share_details = true where id = a;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  select count(*) into n from public.activity_details where user_id = a;    out := out || format(E'\nBob sees Ann''s details after she opts in: %s (want 1)', n);

  -- Cat is not in the crew
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  select count(*) into n from public.sessions where user_id = a;            out := out || format(E'\nCat sees Ann''s sessions: %s (want 0)', n);
  select count(*) into n from public.activity_details where user_id = a;    out := out || format(E'\nCat sees Ann''s details: %s (want 0)', n);
  select count(*) into n from public.cheers;                                out := out || format(E'\nCat sees cheers: %s (want 0)', n);
  select count(*) into n from public.crews;                                 out := out || format(E'\nCat sees crews: %s (want 0)', n);
  select count(*) into n from public.profiles where id in (a, b);           out := out || format(E'\nCat sees Ann/Bob profiles: %s (want 0)', n);
  begin
    insert into public.cheers (to_user, target_type, target_id, emoji) values (a, 'activity', act_id::text, '👏');
    out := out || E'\nCat cheered Ann from outside the crew: ALLOWED (bad)';
  exception when others then out := out || E'\nCat blocked from cheering outside the crew: ok';
  end;

  reset role;
  raise exception 'RLS TEST REPORT (rolled back, nothing saved):%', out;
end $$;
