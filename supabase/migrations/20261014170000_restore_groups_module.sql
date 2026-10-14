-- Restore the Groups module in the isolated test database.
-- Groups are attached to formations and can be managed only by authorized education staff.
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  formation_id uuid not null references public.formations(id) on delete restrict,
  code text not null unique,
  name text not null,
  academic_year text not null,
  capacity integer,
  status text not null default 'active' check (status in ('active','inactive','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint groups_capacity_positive check (capacity is null or capacity > 0)
);

create index if not exists groups_formation_id_idx on public.groups(formation_id);
create index if not exists groups_status_name_idx on public.groups(status, name);

alter table public.groups enable row level security;

drop policy if exists "authorized staff can read groups" on public.groups;
create policy "authorized staff can read groups"
  on public.groups for select to authenticated
  using (
    public.has_any_role(array[
      'DIRECTOR','ADMIN','PRE_ADMIN','PEDAGOGY','TEACHER',
      'SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE','ACCOUNTING'
    ])
    or exists (
      select 1 from public.students s
      where s.id = auth.uid() and s.group_id = groups.id
    )
  );

drop policy if exists "authorized education staff can manage groups" on public.groups;
create policy "authorized education staff can manage groups"
  on public.groups for all to authenticated
  using (public.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN','PEDAGOGY']))
  with check (public.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN','PEDAGOGY']));

grant select, insert, update, delete on public.groups to authenticated;
