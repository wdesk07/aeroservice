-- Aéro Service: explicit penalty categories for configurable penalty management.
-- Apply only after reviewing on the test environment; this migration is not run automatically here.
alter table public.penalties
  add column if not exists penalty_type text not null default 'late_arrival',
  add column if not exists description text;

alter table public.penalty_rules
  add column if not exists penalty_type text not null default 'late_arrival',
  add column if not exists description text;

update public.penalties p
set penalty_type = case
  when p.attendance_id is not null then 'late_arrival'
  when p.penalty_type is null or btrim(p.penalty_type) = '' then 'other'
  else p.penalty_type
end;

alter table public.penalties
  drop constraint if exists penalties_penalty_type_check;
alter table public.penalties
  add constraint penalties_penalty_type_check check (penalty_type in (
    'late_arrival', 'unjustified_absence', 'early_departure',
    'repeated_absence', 'noncompliance', 'misconduct',
    'equipment_damage', 'equipment_loss', 'badge_loss',
    'incomplete_file', 'late_payment', 'unauthorized_access',
    'safety_violation', 'exam_misconduct', 'other'
  ));

alter table public.penalty_rules
  drop constraint if exists penalty_rules_penalty_type_check;
alter table public.penalty_rules
  add constraint penalty_rules_penalty_type_check check (penalty_type in (
    'late_arrival', 'unjustified_absence', 'early_departure',
    'repeated_absence', 'noncompliance', 'misconduct',
    'equipment_damage', 'equipment_loss', 'badge_loss',
    'incomplete_file', 'late_payment', 'unauthorized_access',
    'safety_violation', 'exam_misconduct', 'other'
  ));

create index if not exists penalties_type_status_idx
  on public.penalties (penalty_type, status);
create index if not exists penalty_rules_type_active_idx
  on public.penalty_rules (penalty_type, active);
