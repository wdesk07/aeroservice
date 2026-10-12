-- Enforce the Director's official arrival limits on manual secretariat entries.
-- This migration is only committed to the feature branch; it is NOT applied to Supabase.
-- Session attendance continues to use course_sessions.planned_start; daily cutoffs apply
-- only to the session-less secretariat entry path below.
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
  v_arrival_local timestamp without time zone;
  v_local_date date;
  v_nominal_time time without time zone;
  v_cutoff_time time without time zone;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if new.person_id <> (select auth.uid())
     and not public.is_admin_actor()
     and not public.has_any_role(ARRAY['SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE','DIRECTOR','PRE_ADMIN','TEACHER','PEDAGOGY'])
  then
    raise exception 'Unauthorized attendance actor';
  end if;

  -- Manual arrival entries are restricted to approved secretariat/admin actors.
  -- Person type, official schedule and cutoff are derived by the database.
  if new.session_id is null and new.source = 'secretariat' then
    if not public.is_admin_actor()
       and not public.has_any_role(ARRAY['SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE','PRE_ADMIN','DIRECTOR'])
    then
      raise exception 'Unauthorized manual attendance';
    end if;

    if new.arrived_at is null then
      raise exception 'Manual attendance requires arrival time';
    end if;

    v_arrival_local := new.arrived_at at time zone 'Africa/Porto-Novo';
    v_local_date := v_arrival_local::date;
    if v_local_date <> (clock_timestamp() at time zone 'Africa/Porto-Novo')::date then
      raise exception 'Manual attendance must be recorded for the current local date';
    end if;
    if new.arrived_at > clock_timestamp() + interval '2 minutes' then
      raise exception 'Manual attendance cannot be in the future';
    end if;

    if exists (select 1 from public.students where id = new.person_id) then
      v_person_type := 'student';
      v_nominal_time := time '09:00';
      v_cutoff_time := time '09:15';
    elsif exists (select 1 from public.staff where id = new.person_id) then
      v_person_type := 'staff';
      v_nominal_time := time '08:30';
      v_cutoff_time := time '08:30';
    elsif exists (select 1 from public.teachers where id = new.person_id) then
      raise exception 'Manual attendance for teachers is not configured; use session attendance';
    else
      raise exception 'Person is not registered';
    end if;

    if v_arrival_local::time <= v_cutoff_time then
      raise exception 'ARRIVAL_WITHIN_TOLERANCE';
    end if;

    new.person_type := v_person_type;
    new.planned_at := (v_local_date + v_nominal_time) at time zone 'Africa/Porto-Novo';
    new.delay_minutes := greatest(0, floor(extract(epoch from (new.arrived_at - new.planned_at))/60)::integer);
    new.status := 'late';
    new.access_blocked := true;
    new.anomaly := true;
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := now();
    return new;
  end if;

  -- Existing class/session attendance keeps its server-authoritative schedule.
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
