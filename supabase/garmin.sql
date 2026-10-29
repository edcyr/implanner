-- IMPlanner: Garmin Connect sync with the Garmin Personal API. Run after schema.sql. Safe to re-run.
--
-- Each person's Garmin Personal API key is kept encrypted in Supabase Vault. Nobody can read it
-- back through the app's API, not even its owner: only the `garmin` Edge Function (service role)
-- can, to fetch that person's own workouts.

create extension if not exists supabase_vault with schema vault;

-- Imported workouts remember their Garmin activity id, so each one is imported once.
alter table public.activities add column if not exists external_id text;
create unique index if not exists activities_user_external on public.activities (user_id, external_id) where external_id is not null;

create table if not exists public.garmin_links (
  user_id      uuid primary key references auth.users on delete cascade,
  secret_id    uuid not null,
  key_expires  date,
  connected_at timestamptz not null default now(),
  last_sync_at timestamptz,
  last_error   text
);
alter table public.garmin_links enable row level security;   -- no policies: only the functions below touch it
revoke all on public.garmin_links from anon, authenticated;

create or replace function public.garmin_status()
returns table (connected boolean, key_expires date, connected_at timestamptz, last_sync_at timestamptz, last_error text)
language sql stable security definer set search_path = public as $$
  select true, g.key_expires, g.connected_at, g.last_sync_at, g.last_error from garmin_links g where g.user_id = auth.uid()
$$;

create or replace function public.garmin_connect(api_key text, expires date)
returns void language plpgsql security definer set search_path = public, vault as $$
declare old uuid; sid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if api_key is null or length(trim(api_key)) < 16 then raise exception 'That doesn''t look like a Garmin API key'; end if;
  select secret_id into old from garmin_links where user_id = auth.uid();
  if old is not null then
    perform vault.update_secret(old, trim(api_key));
    update garmin_links set key_expires = expires, connected_at = now(), last_error = null where user_id = auth.uid();
  else
    sid := vault.create_secret(trim(api_key), 'implanner-garmin-' || auth.uid(), 'IMPlanner: Garmin Personal API key');
    insert into garmin_links (user_id, secret_id, key_expires) values (auth.uid(), sid, expires);
  end if;
end $$;

create or replace function public.garmin_disconnect()
returns void language plpgsql security definer set search_path = public, vault as $$
declare sid uuid;
begin
  delete from garmin_links where user_id = auth.uid() returning secret_id into sid;
  if sid is not null then delete from vault.secrets where id = sid; end if;
end $$;

-- Server only (the Edge Function runs as service_role).
create or replace function public.garmin_key_for(uid uuid)
returns text language sql stable security definer set search_path = public, vault as $$
  select s.decrypted_secret from garmin_links g join vault.decrypted_secrets s on s.id = g.secret_id where g.user_id = uid
$$;

create or replace function public.garmin_mark(uid uuid, ok boolean, err text)
returns void language sql security definer set search_path = public as $$
  update garmin_links
     set last_sync_at = case when ok then now() else last_sync_at end,
         last_error   = case when ok then null else left(err, 300) end
   where user_id = uid
$$;

revoke execute on function public.garmin_status(), public.garmin_connect(text, date), public.garmin_disconnect(),
  public.garmin_key_for(uuid), public.garmin_mark(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.garmin_status(), public.garmin_connect(text, date), public.garmin_disconnect() to authenticated;
grant execute on function public.garmin_key_for(uuid), public.garmin_mark(uuid, boolean, text) to service_role;
