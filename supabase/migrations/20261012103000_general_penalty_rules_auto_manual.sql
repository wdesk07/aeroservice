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

create or replace function public.apply_automatic_penalty_for_attendance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_rule public.penalty_rules%rowtype;
  local_arrival timestamp without time zone;
begin
  if new.status <> 'late' or new.arrived_at is null then
    return new;
  end if;

  local_arrival := new.arrived_at at time zone 'Africa/Porto-Novo';

  select r.* into selected_rule
  from public.penalty_rules r
  where r.active = true
    and r.application_mode = 'automatic'
    and r.penalty_type = 'late_arrival'
    and r.effective_from <= new.arrived_at
    and (r.effective_until is null or r.effective_until >= new.arrived_at)
    and (
      r.target_scope = 'all'
      or (r.target_scope = 'students' and new.person_type = 'student')
      or (r.target_scope = 'staff' and new.person_type = 'staff')
      or (r.target_scope = 'teacher' and new.person_type = 'teacher')
    )
    and coalesce(new.delay_minutes, 0) >= r.min_delay_minutes + r.tolerance_minutes
    and (r.applies_after_time is null or local_arrival::time > r.applies_after_time)
  order by r.priority asc, r.created_at desc
  limit 1;

  if selected_rule.id is not null then
    insert into public.penalties (
      attendance_id, person_id, rule_id, amount_fcfa, status, penalty_type, description
    )
    values (
      new.id, new.person_id, selected_rule.id, selected_rule.amount_fcfa, 'pending',
      selected_rule.penalty_type,
      concat_ws(' — ', nullif(selected_rule.description, ''), 'Pénalité créée automatiquement à partir du pointage')
    )
    on conflict (attendance_id) where attendance_id is not null do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_apply_automatic_penalty_for_attendance on public.attendance;
create trigger trg_apply_automatic_penalty_for_attendance
after insert on public.attendance
for each row execute function public.apply_automatic_penalty_for_attendance();
