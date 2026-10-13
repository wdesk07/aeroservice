-- Test-environment support for learner identifiers and kiosk login throttling.
-- Safe additive changes; apply only to aero-service-test before production review.

alter table public.profiles add column if not exists public_id text;
alter table public.profiles add column if not exists first_name text;
alter table public.profiles add column if not exists last_name text;
alter table public.students add column if not exists student_number text;
alter table public.students add column if not exists education_level text;

create unique index if not exists students_student_number_unique
  on public.students(student_number)
  where student_number is not null;

create table if not exists public.presence_kiosk_login_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  attempted_at timestamptz not null default now(),
  succeeded boolean not null default false
);

create index if not exists presence_kiosk_login_attempts_ip_time
  on public.presence_kiosk_login_attempts(ip_hash, attempted_at desc);

alter table public.presence_kiosk_login_attempts enable row level security;
revoke all on public.presence_kiosk_login_attempts from anon, authenticated;
