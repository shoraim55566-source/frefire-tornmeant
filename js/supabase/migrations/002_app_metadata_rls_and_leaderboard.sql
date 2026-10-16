-- KHAN FF ESPORTS hardening for the existing tournaments/registrations schema.
-- Apply only after reviewing the live schema and policies in Supabase.

create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  mode text not null check (mode in ('Battle Royale', 'Clash Squad')),
  match_at timestamptz,
  entry_fee integer not null default 0 check (entry_fee between 0 and 999999),
  prize_pool integer not null default 0 check (prize_pool between 0 and 999999999),
  max_teams integer not null default 48 check (max_teams between 1 and 10000),
  status text not null default 'draft',
  rules text check (rules is null or char_length(rules) <= 4000),
  created_at timestamptz not null default now()
);

create table if not exists public.registrations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  uid text not null check (uid ~ '^[0-9]{5,20}$'),
  mode text not null check (mode in ('Battle Royale', 'Clash Squad')),
  contact text check (contact is null or char_length(contact) <= 80),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  points integer not null default 0 check (points between 0 and 999999),
  created_at timestamptz not null default now()
);

alter table public.registrations
  add column if not exists tournament_id uuid references public.tournaments(id) on delete set null;

alter table public.tournaments
  drop constraint if exists tournaments_status_check;
alter table public.tournaments
  add constraint tournaments_status_check
  check (status in ('draft', 'open', 'closed', 'live', 'completed', 'cancelled'));

drop index if exists public.registrations_uid_not_rejected_key;
create unique index if not exists registrations_uid_tournament_not_rejected_key
  on public.registrations
    (uid, (coalesce(tournament_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  where status <> 'rejected';
create index if not exists registrations_tournament_id_idx
  on public.registrations (tournament_id);

create or replace function public.enforce_tournament_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tournament_status text;
  team_limit integer;
  active_count integer;
begin
  if new.tournament_id is null then
    return new;
  end if;

  select status, max_teams
    into tournament_status, team_limit
    from public.tournaments
    where id = new.tournament_id
    for update;

  if not found then
    raise exception 'Tournament does not exist.';
  end if;

  if tg_op = 'INSERT' or (old.status = 'rejected' and new.status <> 'rejected') then
    if tournament_status <> 'open' then
      raise exception 'Tournament registration is not open.';
    end if;
  end if;

  if new.status <> 'rejected' then
    select count(*) into active_count
      from public.registrations
      where tournament_id = new.tournament_id
        and status <> 'rejected'
        and id is distinct from new.id;
    if active_count >= team_limit then
      raise exception 'Tournament is full.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists registrations_enforce_tournament_capacity on public.registrations;
create trigger registrations_enforce_tournament_capacity
before insert or update of tournament_id, status on public.registrations
for each row execute function public.enforce_tournament_capacity();

-- Old profile-role authorization is no longer trusted; app_metadata is authoritative.
drop trigger if exists registrations_enforce_rules on public.registrations;
drop function if exists public.enforce_registration_rules();

do $$
begin
  if to_regclass('public.profiles') is not null then
    execute 'drop policy if exists "Admins can manage profiles" on public.profiles';
  end if;
end;
$$;

alter table public.registrations enable row level security;
alter table public.tournaments enable row level security;

-- Replace existing policies on only these two tables to eliminate permissive conflicts.
do $$
declare
  existing_policy record;
begin
  for existing_policy in
    select schemaname, tablename, policyname
      from pg_policies
      where schemaname = 'public'
        and tablename in ('registrations', 'tournaments')
  loop
    execute format(
      'drop policy %I on %I.%I',
      existing_policy.policyname,
      existing_policy.schemaname,
      existing_policy.tablename
    );
  end loop;
end;
$$;

revoke all on public.registrations from public, anon, authenticated;
revoke all on public.tournaments from public, anon, authenticated;

grant select (id, name, mode, match_at, entry_fee, prize_pool, max_teams, status, rules, created_at)
  on public.tournaments to anon, authenticated;
grant insert, update, delete on public.tournaments to authenticated;

grant select on public.registrations to authenticated;
grant insert (name, uid, mode, contact, tournament_id) on public.registrations to anon, authenticated;
grant update (status, points, tournament_id) on public.registrations to authenticated;
grant delete on public.registrations to authenticated;

create policy "Public can read listed tournaments"
  on public.tournaments for select to anon, authenticated
  using (status in ('open', 'closed', 'live', 'completed', 'cancelled'));
create policy "Admins can manage tournaments"
  on public.tournaments for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy "Admins can read registrations"
  on public.registrations for select to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy "Public can create pending registrations"
  on public.registrations for insert to anon, authenticated
  with check (
    status = 'pending'
    and points = 0
    and (
      tournament_id is null
      or exists (
        select 1
          from public.tournaments t
          where t.id = tournament_id and t.status = 'open'
      )
    )
  );
create policy "Admins can update registrations"
  on public.registrations for update to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy "Admins can delete registrations"
  on public.registrations for delete to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create or replace view public.public_leaderboard
  with (security_barrier = true)
as
  select name, mode, points, tournament_id
    from public.registrations
    where status = 'approved';
revoke all on public.public_leaderboard from public, anon, authenticated;
grant select on public.public_leaderboard to anon, authenticated;

-- Set app_metadata.role = 'admin' for the intended existing Auth user in the
-- Supabase Dashboard. Never grant admin via user-editable user_metadata/profiles.
