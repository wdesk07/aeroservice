-- General penalty rules plus secure review permissions for learner absence justifications.
create table if not exists public.penalty_rules (
  id uuid primary key default gen_random_uuid(),
  person_type text not null default 'student',
  penalty_type text not null default 'late_arrival',
  description text,
  target_scope text not null default 'all' check (target_scope in ('all','students','staff','teacher')),
  application_mode text not null default 'manual' check (application_mode in ('automatic','manual')),
  applies_after_time time without time zone,
  min_delay_minutes integer not null default 0 check (min_delay_minutes >= 0),
  max_delay_minutes integer,
  tolerance_minutes integer not null default 0 check (tolerance_minutes >= 0),
  amount_fcfa integer not null check (amount_fcfa > 0),
  blocks_access boolean not null default false,
  priority integer not null default 100,
  active boolean not null default true,
  effective_from timestamptz,
  effective_until timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint penalty_rules_max_delay_check check (max_delay_minutes is null or max_delay_minutes >= min_delay_minutes)
);
alter table public.penalty_rules enable row level security;
drop policy if exists "penalty rules read authorized" on public.penalty_rules;
create policy "penalty rules read authorized" on public.penalty_rules
  for select to authenticated
  using (public.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN','ACCOUNTING','FINANCE','SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE']::text[]));
drop policy if exists "penalty rules manage director admin" on public.penalty_rules;
create policy "penalty rules manage director admin" on public.penalty_rules
  for all to authenticated
  using (public.has_any_role(array['DIRECTOR','ADMIN']::text[]))
  with check (public.has_any_role(array['DIRECTOR','ADMIN']::text[]));

drop policy if exists "absence justifications review authorized" on public.absence_justifications;
create policy "absence justifications review authorized" on public.absence_justifications
  for update to authenticated
  using (public.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN','SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE']::text[]))
  with check (
    public.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN','SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE']::text[])
    and status in ('approved','rejected','pending')
  );
