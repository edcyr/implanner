-- IMPlanner database setup. Paste into Supabase → SQL Editor → Run. Safe to re-run.
--
-- Privacy model
--   • Everything you create belongs to you (user_id = auth.uid()).
--   • Your thresholds (FTP, paces, heart rates) and plan settings are private.
--   • People who share a crew with you can READ your profile, plan, completed
--     sessions (date, sport, duration, how it felt, notes) and cheers.
--   • Distances, paces, heart rate and power live in activity_details and are
--     readable by your crew only if you turn on "Share workout details".
--   • Nobody but you can change your data.

-- ---------------------------------------------------------------- tables

create table if not exists public.profiles (
  id            uuid primary key references auth.users on delete cascade,
  name          text not null default '' check (char_length(name) <= 60),
  race_name     text not null default '' check (char_length(race_name) <= 80),
  race_date     date,
  share_details boolean not null default false,
  updated_at    timestamptz not null default now()
);

create table if not exists public.profile_settings (     -- private: thresholds, plan settings
  user_id  uuid primary key default auth.uid() references auth.users on delete cascade,
  settings jsonb not null default '{}'::jsonb
);

create table if not exists public.sessions (            -- planned workouts
  id           uuid primary key,
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  date         date not null,
  sport        text not null check (sport in ('swim','bike','run','strength','other')),
  kind         text not null default '',
  title        text not null default '' check (char_length(title) <= 120),
  description  text not null default '' check (char_length(description) <= 2000),
  duration_min integer not null default 0 check (duration_min between 0 and 1440),
  distance_m   integer check (distance_m between 0 and 1000000),
  phase        text not null default '',
  week         integer not null default 0,
  sort         integer not null default 0,
  skip_reason  text check (char_length(skip_reason) <= 200),
  created_at   timestamptz not null default now()
);
create index if not exists sessions_user_date on public.sessions (user_id, date);
-- Optional fixed start time ("07:30"), e.g. pool slots.
alter table public.sessions add column if not exists at_time text
  check (at_time is null or at_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

create table if not exists public.activities (          -- completed workouts (shared with crew)
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  session_id  uuid references public.sessions on delete set null,
  date        date not null,
  start_time  timestamptz,
  sport       text not null check (sport in ('swim','bike','run','strength','other')),
  title       text not null default '' check (char_length(title) <= 120),
  duration_s  integer not null default 0 check (duration_s between 0 and 172800),
  source      text not null default 'manual',
  rpe         smallint check (rpe between 1 and 10),
  feel        text check (feel in ('great','good','ok','tired','rough')),
  notes       text not null default '' check (char_length(notes) <= 2000),
  file_hash   text,
  created_at  timestamptz not null default now()
);
create index if not exists activities_user_date on public.activities (user_id, date);
create index if not exists activities_session on public.activities (session_id);

create table if not exists public.activity_details (    -- numbers that invite comparison (opt-in sharing)
  activity_id   uuid primary key references public.activities on delete cascade,
  user_id       uuid not null default auth.uid() references auth.users on delete cascade,
  distance_m    real,
  elapsed_s     integer,
  avg_hr        smallint,
  max_hr        smallint,
  avg_power     smallint,
  np            smallint,
  avg_cadence   smallint,
  ascent_m      real,
  calories      integer,
  pool_length_m real,
  zones         jsonb,
  series        jsonb
);
create index if not exists activity_details_user on public.activity_details (user_id);

create table if not exists public.crews (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 60),
  invite_code text not null unique,
  created_by  uuid not null default auth.uid() references auth.users on delete cascade,
  created_at  timestamptz not null default now()
);

create table if not exists public.crew_members (
  crew_id   uuid not null references public.crews on delete cascade,
  user_id   uuid not null references auth.users on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (crew_id, user_id)
);
create index if not exists crew_members_user on public.crew_members (user_id);

create table if not exists public.cheers (
  id          uuid primary key default gen_random_uuid(),
  from_user   uuid not null default auth.uid() references auth.users on delete cascade,
  to_user     uuid not null references auth.users on delete cascade,
  target_type text not null check (target_type in ('activity','session','week')),
  target_id   text not null,
  emoji       text not null default '' check (char_length(emoji) <= 16),
  message     text not null default '' check (char_length(message) <= 280),
  created_at  timestamptz not null default now()
);
create index if not exists cheers_target on public.cheers (to_user, target_id);

-- ---------------------------------------------------------------- helpers
-- security definer so the checks can read crew_members without tripping its own RLS.

create or replace function public.shares_crew(other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from crew_members a join crew_members b on a.crew_id = b.crew_id
    where a.user_id = auth.uid() and b.user_id = other)
$$;

create or replace function public.is_crew_member(crew uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from crew_members where crew_id = crew and user_id = auth.uid())
$$;

create or replace function public.shares_details(owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select share_details from profiles where id = owner), false)
$$;

-- Crews are created and joined through these functions so invite codes stay unguessable
-- and nobody can add someone else to a crew.
create or replace function public.create_crew(crew_name text)
returns public.crews language plpgsql security definer set search_path = public as $$
declare c crews;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into crews (name, invite_code, created_by)
  values (trim(crew_name), substr(replace(gen_random_uuid()::text, '-', ''), 1, 12), auth.uid())
  returning * into c;
  insert into crew_members (crew_id, user_id) values (c.id, auth.uid());
  return c;
end $$;

create or replace function public.crew_by_code(code text)
returns table (id uuid, name text, members bigint) language sql stable security definer set search_path = public as $$
  select c.id, c.name, (select count(*) from crew_members m where m.crew_id = c.id)
  from crews c where c.invite_code = lower(trim(code)) and auth.uid() is not null
$$;

create or replace function public.join_crew(code text)
returns public.crews language plpgsql security definer set search_path = public as $$
declare c crews;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into c from crews where invite_code = lower(trim(code));
  if c.id is null then raise exception 'invite code not found'; end if;
  insert into crew_members (crew_id, user_id) values (c.id, auth.uid()) on conflict do nothing;
  return c;
end $$;

-- Every new sign-up gets a profile row, named from the sign-up form.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, name) values (new.id, left(coalesce(new.raw_user_meta_data->>'name', ''), 60))
  on conflict (id) do nothing;
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- row level security

alter table public.profiles         enable row level security;
alter table public.profile_settings enable row level security;
alter table public.sessions         enable row level security;
alter table public.activities       enable row level security;
alter table public.activity_details enable row level security;
alter table public.crews            enable row level security;
alter table public.crew_members     enable row level security;
alter table public.cheers           enable row level security;

do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public'
    and tablename in ('profiles','profile_settings','sessions','activities','activity_details','crews','crew_members','cheers')
  loop execute format('drop policy %I on public.%I', r.policyname, r.tablename); end loop;
end $$;

create policy "read own or crew"   on public.profiles for select to authenticated
  using (id = auth.uid() or shares_crew(id));
create policy "insert own"         on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "update own"         on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "own only"           on public.profile_settings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "read own or crew"   on public.sessions for select to authenticated
  using (user_id = auth.uid() or shares_crew(user_id));
create policy "write own"          on public.sessions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "read own or crew"   on public.activities for select to authenticated
  using (user_id = auth.uid() or shares_crew(user_id));
create policy "write own"          on public.activities for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "read own, or crew if shared" on public.activity_details for select to authenticated
  using (user_id = auth.uid() or (shares_crew(user_id) and shares_details(user_id)));
create policy "write own"          on public.activity_details for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "members read"       on public.crews for select to authenticated using (is_crew_member(id));
create policy "creator renames"    on public.crews for update to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy "creator deletes"    on public.crews for delete to authenticated using (created_by = auth.uid());

create policy "members read"       on public.crew_members for select to authenticated using (is_crew_member(crew_id));
create policy "leave"              on public.crew_members for delete to authenticated using (user_id = auth.uid());

create policy "read in crew"       on public.cheers for select to authenticated
  using (to_user = auth.uid() or from_user = auth.uid() or shares_crew(to_user));
create policy "cheer crewmates"    on public.cheers for insert to authenticated
  with check (from_user = auth.uid() and to_user <> auth.uid() and shares_crew(to_user));
create policy "delete own"         on public.cheers for delete to authenticated using (from_user = auth.uid());

-- ---------------------------------------------------------------- Data API access
-- Only signed-in users get any access; RLS above decides which rows.

revoke all on public.profiles, public.profile_settings, public.sessions, public.activities, public.activity_details,
  public.crews, public.crew_members, public.cheers from anon;
grant select, insert, update         on public.profiles         to authenticated;
grant select, insert, update         on public.profile_settings to authenticated;
grant select, insert, update, delete on public.sessions         to authenticated;
grant select, insert, update, delete on public.activities       to authenticated;
grant select, insert, update, delete on public.activity_details to authenticated;
grant select, update, delete         on public.crews            to authenticated;
grant select, delete                 on public.crew_members     to authenticated;
grant select, insert, delete         on public.cheers           to authenticated;

revoke execute on function public.shares_crew(uuid), public.is_crew_member(uuid), public.shares_details(uuid),
  public.create_crew(text), public.crew_by_code(text), public.join_crew(text) from public, anon;
grant execute on function public.shares_crew(uuid), public.is_crew_member(uuid), public.shares_details(uuid),
  public.create_crew(text), public.crew_by_code(text), public.join_crew(text) to authenticated;
