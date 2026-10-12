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


-- Allow a controlled, session-less manual late-arrival entry from the secretariat.
-- Normal QR/session attendance keeps the original server-authoritative path.
create or replace function private.guard_attendance_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_session public.course_sessions%rowtype;
  v_person_type text;
  v_delay integer;
  v_penalty record;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if new.person_id <> (select auth.uid())
     and not public.is_admin_actor()
     and not public.has_any_role(ARRAY['SECRETARIAT','TEACHER','PEDAGOGY'])
  then
    raise exception 'Unauthorized attendance actor';
  end if;

  if new.session_id is null and new.source = 'secretariat' then
    if not public.is_admin_actor()
       and not public.has_any_role(ARRAY['SECRETARIAT','PRE_ADMIN','DIRECTOR'])
    then
      raise exception 'Unauthorized manual attendance';
    end if;

    if new.planned_at is null or new.arrived_at is null then
      raise exception 'Manual attendance requires planned and arrival times';
    end if;

    if exists (select 1 from public.students where id = new.person_id) then
      v_person_type := 'student';
    elsif exists (select 1 from public.teachers where id = new.person_id) then
      v_person_type := 'teacher';
    elsif exists (select 1 from public.staff where id = new.person_id) then
      v_person_type := 'staff';
    else
      raise exception 'Person is not registered';
    end if;

    v_delay := greatest(0, floor(extract(epoch from (new.arrived_at - new.planned_at))/60)::integer);
    if v_delay <= 0 then
      raise exception 'Manual late arrival requires a positive delay';
    end if;

    new.person_type := v_person_type;
    new.delay_minutes := v_delay;
    new.status := 'late';
    new.access_blocked := true;
    new.anomaly := true;
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := now();
    return new;
  end if;

  select * into v_session
  from public.course_sessions
  where id = new.session_id;

  if not found then
    raise exception 'Session not found';
  end if;

  if exists (select 1 from public.students where id = new.person_id) then
    v_person_type := 'student';
  elsif exists (select 1 from public.teachers where id = new.person_id) then
    v_person_type := 'teacher';
  elsif exists (select 1 from public.staff where id = new.person_id) then
    v_person_type := 'staff';
  else
    raise exception 'Person is not registered';
  end if;

  new.person_type := v_person_type;
  new.planned_at := v_session.planned_start;
  new.arrived_at := clock_timestamp();
  v_delay := greatest(0, floor(extract(epoch from (new.arrived_at - v_session.planned_start))/60)::integer);
  new.delay_minutes := v_delay;
  new.status := case when v_delay = 0 then 'on_time' else 'late' end;
  new.access_blocked := false;

  if v_delay > 0 then
    select rule_id, amount_fcfa, blocks_access
      into v_penalty
    from public.calculate_penalty(v_person_type, v_delay, new.arrived_at)
    limit 1;

    if found then
      new.access_blocked := coalesce(v_penalty.blocks_access,false);
    end if;
  end if;

  new.created_at := coalesce(new.created_at,now());
  new.updated_at := now();
  return new;
end;
$function$;
