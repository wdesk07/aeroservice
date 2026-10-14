-- Restore the Rooms module in the isolated test database.
-- Access is restricted to authenticated users with authorized platform roles.
create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  capacity integer,
  location_description text,
  status text not null default 'active'
    check (status in ('active','inactive','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rooms_capacity_positive check (capacity is null or capacity > 0)
);

create index if not exists rooms_status_name_idx on public.rooms(status, name);

alter table public.rooms enable row level security;

drop policy if exists "authorized staff can read rooms" on public.rooms;
create policy "authorized staff can read rooms"
  on public.rooms for select to authenticated
  using (public.has_any_role(array[
    'DIRECTOR','ADMIN','PRE_ADMIN','PEDAGOGY','PEDAGOGIE','TEACHER',
    'ENSEIGNANT','SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE'
  ]));

drop policy if exists "authorized management can manage rooms" on public.rooms;
create policy "authorized management can manage rooms"
  on public.rooms for all to authenticated
  using (public.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN','PEDAGOGY','PEDAGOGIE']))
  with check (public.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN','PEDAGOGY','PEDAGOGIE']));

grant select, insert, update, delete on public.rooms to authenticated;
