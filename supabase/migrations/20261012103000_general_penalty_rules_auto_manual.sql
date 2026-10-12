-- General penalty rules: configurable scope, automatic/manual application and local cutoff time.
alter table public.penalty_rules
  add column if not exists target_scope text not null default 'all',
  add column if not exists application_mode text not null default 'manual',
  add column if not exists applies_after_time time without time zone;

alter table public.penalty_rules
  drop constraint if exists penalty_rules_target_scope_check;
alter table public.penalty_rules
  add constraint penalty_rules_target_scope_check
  check (target_scope in ('all', 'students', 'staff', 'teacher'));

alter table public.penalty_rules
  drop constraint if exists penalty_rules_application_mode_check;
alter table public.penalty_rules
  add constraint penalty_rules_application_mode_check
  check (application_mode in ('automatic', 'manual'));

-- Avoid creating duplicate penalties for one attendance event.
create unique index if not exists penalties_one_per_attendance
  on public.penalties(attendance_id)
  where attendance_id is not null;

-- Reuse the existing secure attendance workflow instead of adding a second
-- AFTER trigger that could race with private.after_attendance_insert().
-- private.calculate_penalty() is called by both the server-side attendance guard
-- and the existing AFTER trigger, so only automatic general rules are returned.
drop trigger if exists trg_apply_automatic_penalty_for_attendance on public.attendance;
drop function if exists public.apply_automatic_penalty_for_attendance();

create or replace function private.calculate_penalty(
  p_person_type text,
  p_delay_minutes integer,
  p_at timestamp with time zone default now()
)
returns table(rule_id uuid, amount_fcfa integer, blocks_access boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select pr.id, pr.amount_fcfa, pr.blocks_access
  from public.penalty_rules pr
  where pr.active = true
    and pr.application_mode = 'automatic'
    and pr.penalty_type = 'late_arrival'
    and (
      pr.target_scope = 'all'
      or (pr.target_scope = 'students' and p_person_type = 'student')
      or (pr.target_scope = 'staff' and p_person_type = 'staff')
      or (pr.target_scope = 'teacher' and p_person_type = 'teacher')
    )
    and p_delay_minutes >= pr.min_delay_minutes + pr.tolerance_minutes
    and (pr.max_delay_minutes is null or p_delay_minutes <= pr.max_delay_minutes)
    and (pr.effective_from is null or p_at >= pr.effective_from)
    and (pr.effective_until is null or p_at <= pr.effective_until)
    and (pr.applies_after_time is null or (p_at at time zone 'Africa/Porto-Novo')::time > pr.applies_after_time)
  order by pr.priority asc, pr.created_at desc
  limit 1
$$;
