-- Restore the registration workflow and restrict access to the records it uses.
insert into public.roles (code, name) values
  ('STUDENT', 'Apprenant'), ('TEACHER', 'Enseignant'), ('STAFF', 'Personnel'),
  ('TRAVEL_AGENT', 'Agent de voyage'), ('ACCOUNTING', 'Comptabilité / Finance'),
  ('PEDAGOGY', 'Responsable pédagogique'), ('ADMIN', 'Administrateur'), ('SECRETARY', 'Secrétaire')
on conflict (code) do update set name = excluded.name;

create table if not exists public.registrations (
  id uuid primary key default gen_random_uuid(),
  registration_number text not null unique,
  person_id uuid not null references public.profiles(id) on delete cascade,
  formation_id uuid references public.formations(id) on delete set null,
  group_id uuid,
  registration_date date not null default current_date,
  status text not null default 'pending' check (status in ('pending','submitted','pre_review','approved','rejected')),
  created_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  review_comment text,
  created_at timestamptz not null default now()
);
create index if not exists registrations_status_submitted_idx on public.registrations(status, submitted_at desc);
create index if not exists registrations_person_id_idx on public.registrations(person_id);
alter table public.registrations enable row level security;

drop policy if exists "registration submitter or authorized staff can read" on public.registrations;
create policy "registration submitter or authorized staff can read" on public.registrations for select to authenticated
using (person_id = (select auth.uid()) or public.has_any_role(array['SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE','DIRECTOR','ADMIN','PRE_ADMIN']));
drop policy if exists "authorized staff can create registrations" on public.registrations;
create policy "authorized staff can create registrations" on public.registrations for insert to authenticated
with check (public.has_any_role(array['SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE','DIRECTOR','ADMIN','PRE_ADMIN']));
drop policy if exists "authorized staff can review registrations" on public.registrations;
create policy "authorized staff can review registrations" on public.registrations for update to authenticated
using (public.has_any_role(array['SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE','DIRECTOR','ADMIN','PRE_ADMIN']))
with check (public.has_any_role(array['SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE','DIRECTOR','ADMIN','PRE_ADMIN']));

drop policy if exists "authorized staff can read profiles directory" on public.profiles;
create policy "authorized staff can read profiles directory" on public.profiles for select to authenticated
using (public.has_any_role(array['SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE','DIRECTOR','ADMIN','PRE_ADMIN']));
drop policy if exists "authorized staff can update profiles" on public.profiles;
create policy "authorized staff can update profiles" on public.profiles for update to authenticated
using (public.has_any_role(array['SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE','DIRECTOR','ADMIN','PRE_ADMIN']))
with check (public.has_any_role(array['SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE','DIRECTOR','ADMIN','PRE_ADMIN']));

alter table public.roles enable row level security;
drop policy if exists "authenticated users can read role catalog" on public.roles;
create policy "authenticated users can read role catalog" on public.roles for select to authenticated using (true);
alter table public.user_roles enable row level security;
drop policy if exists "users can read own role assignments" on public.user_roles;
create policy "users can read own role assignments" on public.user_roles for select to authenticated
using (user_id = (select auth.uid()) or public.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN']));

alter table public.students enable row level security;
drop policy if exists "students can read own student record" on public.students;
create policy "students can read own student record" on public.students for select to authenticated
using (id = (select auth.uid()) or public.has_any_role(array['SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE','DIRECTOR','ADMIN','PRE_ADMIN','PEDAGOGY','TEACHER','ACCOUNTING']));
drop policy if exists "authorized staff can manage student records" on public.students;
create policy "authorized staff can manage student records" on public.students for all to authenticated
using (public.has_any_role(array['SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE','DIRECTOR','ADMIN','PRE_ADMIN','PEDAGOGY']))
with check (public.has_any_role(array['SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE','DIRECTOR','ADMIN','PRE_ADMIN','PEDAGOGY']));

alter table public.staff enable row level security;
drop policy if exists "authorized staff can read staff records" on public.staff;
create policy "authorized staff can read staff records" on public.staff for select to authenticated
using (public.has_any_role(array['SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE','DIRECTOR','ADMIN','PRE_ADMIN']));
alter table public.teachers enable row level security;
drop policy if exists "authorized staff can read teacher records" on public.teachers;
create policy "authorized staff can read teacher records" on public.teachers for select to authenticated
using (public.has_any_role(array['SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE','DIRECTOR','ADMIN','PRE_ADMIN','PEDAGOGY']));