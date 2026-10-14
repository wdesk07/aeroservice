create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  formation_id uuid references public.formations(id) on delete restrict,
  description text,
  status text not null default 'active'
    check (status in ('active','inactive','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subjects_formation_id_idx on public.subjects(formation_id);
create index if not exists subjects_status_name_idx on public.subjects(status, name);

alter table public.subjects enable row level security;

drop policy if exists "authorized staff can read subjects" on public.subjects;
create policy "authorized staff can read subjects"
  on public.subjects for select to authenticated
  using (public.has_any_role(array[
    'DIRECTOR','ADMIN','PRE_ADMIN','PEDAGOGY','PEDAGOGIE','TEACHER',
    'ENSEIGNANT','SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE'
  ]));

drop policy if exists "authorized education staff can manage subjects" on public.subjects;
create policy "authorized education staff can manage subjects"
  on public.subjects for all to authenticated
  using (public.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN','PEDAGOGY','PEDAGOGIE']))
  with check (public.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN','PEDAGOGY','PEDAGOGIE']));

grant select, insert, update, delete on public.subjects to authenticated;
