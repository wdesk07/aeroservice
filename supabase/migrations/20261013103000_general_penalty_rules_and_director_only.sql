-- General penalty-rule fields and strict Director-only write access.
-- Backfill legacy rule scope before enforcing the new non-null column.
alter table public.penalty_rules
  add column if not exists target_scope text,
  add column if not exists application_mode text,
  add column if not exists applies_after_time time without time zone;

update public.penalty_rules
set target_scope = case
      when lower(person_type) = 'staff' then 'staff'
      when lower(person_type) = 'teacher' then 'teacher'
      else 'students'
    end
where target_scope is null;

update public.penalty_rules
set application_mode = 'manual'
where application_mode is null;

alter table public.penalty_rules
  alter column target_scope set default 'all',
  alter column target_scope set not null,
  alter column application_mode set default 'manual',
  alter column application_mode set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.penalty_rules'::regclass
      and conname = 'penalty_rules_target_scope_check'
  ) then
    alter table public.penalty_rules
      add constraint penalty_rules_target_scope_check
      check (target_scope in ('all', 'students', 'staff', 'teacher'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.penalty_rules'::regclass
      and conname = 'penalty_rules_application_mode_check'
  ) then
    alter table public.penalty_rules
      add constraint penalty_rules_application_mode_check
      check (application_mode in ('automatic', 'manual'));
  end if;
end
$$;

-- Remove older write policies that also granted Secretary/Secretariat or
-- PRE_ADMIN access. PostgreSQL combines permissive policies with OR.
drop policy if exists "penalties manage authorized" on public.penalties;
drop policy if exists "pre_admin_full_access" on public.penalties;

create policy "penalties manage director only"
  on public.penalties
  for all
  to authenticated
  using (public.has_any_role(array['DIRECTOR']::text[]))
  with check (public.has_any_role(array['DIRECTOR']::text[]));

drop policy if exists "penalty rules manage admin" on public.penalty_rules;
drop policy if exists "pre_admin_full_access" on public.penalty_rules;

create policy "penalty rules manage director only"
  on public.penalty_rules
  for all
  to authenticated
  using (public.has_any_role(array['DIRECTOR']::text[]))
  with check (public.has_any_role(array['DIRECTOR']::text[]));
