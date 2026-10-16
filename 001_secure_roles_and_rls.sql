-- Create role-backed user profile table.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'player' check (role in ('player', 'admin')),
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role, display_name)
  values (new.id, 'player', coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

drop policy if exists "Users can read their own profile" on public.profiles;
drop policy if exists "Users can update their own profile" on public.profiles;
drop policy if exists "Admins can manage profiles" on public.profiles;

create policy "Users can read their own profile"
on public.profiles for select to authenticated
using (auth.uid() = id);

create policy "Users can update their own profile"
on public.profiles for update to authenticated
using (auth.uid() = id)
with check (auth.uid() = id and role = 'player');

create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  mode text not null check (mode in ('Battle Royale', 'Clash Squad')),
  match_at timestamptz,
  entry_fee integer not null default 0 check (entry_fee between 0 and 999999),
  prize_pool integer not null default 0 check (prize_pool between 0 and 999999999),
  max_teams integer not null default 48 check (max_teams between 1 and 10000),
  status text not null default 'draft' check (status in ('draft', 'open', 'closed', 'completed')),
  rules text check (rules is null or char_length(rules) <= 4000),
  created_at timestamptz not null default now()
);

create table if not exists public.registrations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  uid text not null check (uid ~ '^[0-9]{5,20}$'),
  mode text not null check (mode in ('Battle Royale', 'Clash Squad')),
  contact text check (contact is null or char_length(contact) <= 80),
  tournament_id uuid references public.tournaments(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  points integer not null default 0 check (points between 0 and 999999),
  created_at timestamptz not null default now()
);

alter table public.registrations enable row level security;
alter table public.tournaments enable row level security;

create unique index if not exists registrations_uid_tournament_not_rejected_key
  on public.registrations (uid, coalesce(tournament_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status <> 'rejected';

create index if not exists registrations_tournament_id_idx on public.registrations(tournament_id);

-- Public: allow guest registration only for the given workflow with no privileged fields.
revoke all on public.registrations from anon, authenticated;
revoke all on public.tournaments from anon, authenticated;

grant select on public.tournaments to anon, authenticated;
grant insert, update, delete on public.tournaments to authenticated;

grant select (id, name, uid, mode, contact, status, points, tournament_id, created_at)
  on public.registrations to authenticated;
grant insert (name, uid, mode, contact, tournament_id, status, points)
  on public.registrations to anon, authenticated;

drop policy if exists "Public can view approved leaderboard" on public.registrations;
drop policy if exists "Public can submit registrations" on public.registrations;
drop policy if exists "Players can manage their own registrations" on public.registrations;
drop policy if exists "Admins can manage all registrations" on public.registrations;
drop policy if exists "Public can read tournaments" on public.tournaments;
drop policy if exists "Admins can manage tournaments" on public.tournaments;

create policy "Public can read approved leaderboard"
on public.registrations for select to anon, authenticated
using (status = 'approved');

create policy "Public can submit registrations"
on public.registrations for insert to anon, authenticated
with check (
  status = 'pending'
  and points = 0
  and (tournament_id is null or exists (
    select 1 from public.tournaments t where t.id = tournament_id and t.status = 'open'
  ))
  and not (auth.uid() is not null and user_id is not null and auth.uid() <> user_id)
);

create policy "Admins can manage all registrations"
on public.registrations for all to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy "Public can read tournaments"
on public.tournaments for select to anon, authenticated
using (status in ('open','closed','completed'));

create policy "Admins can manage tournaments"
on public.tournaments for all to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Guard against privilege escalation in browser code.
create or replace function public.enforce_registration_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status not in ('pending','approved','rejected') then
    raise exception 'Invalid status.';
  end if;

  if new.points < 0 or new.points > 999999 then
    raise exception 'Points out of range.';
  end if;

  if new.user_id is not null and new.user_id <> auth.uid()
      and (auth.jwt() -> 'app_metadata' ->> 'role') is distinct from 'admin' then
    raise exception 'Not allowed to assign another user.';
  end if;

  if auth.uid() is null and new.user_id is not null then
    raise exception 'A guest registration cannot claim a user id.';
  end if;

  return new;
end;
$$;

drop trigger if exists registrations_enforce_rules on public.registrations;
create trigger registrations_enforce_rules
before insert or update on public.registrations
for each row execute function public.enforce_registration_rules();
