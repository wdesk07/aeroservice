-- Personnel QR without phone GPS, using the production attendance pipeline.
-- The QR/checkpoint is still required by the client flow; identity and active personnel
-- membership are enforced server-side. Attendance triggers remain authoritative for delay,
-- status, audit events and penalty creation.
create or replace function public.qr_daily_checkin_without_gps(p_checkpoint_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_checkpoint public.checkpoints%rowtype;
  v_session public.course_sessions%rowtype;
  v_attendance public.attendance%rowtype;
  v_now timestamptz := clock_timestamp();
  v_local timestamp without time zone;
  v_date date;
  v_penalty_id uuid;
  v_penalty_amount integer := 0;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_profile
  from public.profiles
  where id = v_uid and lower(coalesce(status, '')) = 'active';
  if not found then
    raise exception 'ACTIVE_PERSONNEL_REQUIRED';
  end if;

  -- A learner identity must never use the personnel-only endpoint.
  if exists (select 1 from public.students where id = v_uid) then
    raise exception 'ACTIVE_PERSONNEL_REQUIRED';
  end if;

  if not (
    exists (select 1 from public.staff where id = v_uid)
    or exists (select 1 from public.teachers where id = v_uid)
    or public.kiosk_actor_has_role(array[
      'DIRECTOR','ADMIN','PRE_ADMIN','SECRETARIAT','SECRETARY',
      'SECRETAIRE','SECRÉTAIRE','STAFF','PERSONNEL','ACCOUNTING',
      'FINANCE','PEDAGOGY','PEDAGOGIE','TEACHER','ENSEIGNANT'
    ])
  ) then
    raise exception 'ACTIVE_PERSONNEL_REQUIRED';
  end if;

  select * into v_checkpoint
  from public.checkpoints
  where id = p_checkpoint_id and active;
  if not found then
    raise exception 'CHECKPOINT_INACTIVE';
  end if;

  v_local := v_now at time zone 'Africa/Porto-Novo';
  v_date := v_local::date;

  if v_local::time < time '08:30' or v_local::time >= time '19:00' then
    raise exception 'PERSONNEL_CHECKIN_CLOSED';
  end if;

  -- Match the existing production daily personnel session, without creating
  -- a second attendance model or bypassing attendance triggers.
  perform pg_advisory_xact_lock(hashtextextended('personnel-daily:' || v_date::text, 0));

  select * into v_session
  from public.course_sessions cs
  where cs.session_date = v_date
    and cs.session_type = 'exceptional'
    and cs.cancellation_reason = 'SYSTEM_PERSONNEL_DAILY_ATTENDANCE'
  limit 1;

  if not found then
    insert into public.course_sessions(
      session_date, planned_start, planned_end, session_type, status, cancellation_reason
    )
    values (
      v_date,
      (v_date + time '08:30') at time zone 'Africa/Porto-Novo',
      (v_date + time '19:00') at time zone 'Africa/Porto-Novo',
      'exceptional',
      'scheduled',
      'SYSTEM_PERSONNEL_DAILY_ATTENDANCE'
    )
    returning * into v_session;
  end if;

  select * into v_attendance
  from public.attendance a
  where a.person_id = v_uid and a.session_id = v_session.id
  order by a.created_at desc
  limit 1;

  if found then
    select p.id, p.amount_fcfa
      into v_penalty_id, v_penalty_amount
    from public.penalties p
    where p.attendance_id = v_attendance.id
    order by p.created_at desc
    limit 1;

    return jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'attendance_id', v_attendance.id,
      'daily_attendance_id', v_attendance.id,
      'status', v_attendance.status,
      'arrived_at', v_attendance.arrived_at,
      'delay_minutes', v_attendance.delay_minutes,
      'penalty_id', v_penalty_id,
      'penalty_amount_fcfa', coalesce(v_penalty_amount, 0),
      'access_blocked', v_attendance.access_blocked,
      'checkpoint', v_checkpoint.name
    );
  end if;

  insert into public.attendance(
    session_id, person_id, person_type, status, planned_at, arrived_at,
    delay_minutes, access_blocked, source, checkpoint_id,
    latitude, longitude, location_accuracy_m, anomaly, anomaly_reason
  )
  values (
    v_session.id, v_uid, 'staff', 'on_time',
    (v_date + time '08:30') at time zone 'Africa/Porto-Novo',
    v_now, 0, false, 'qr', v_checkpoint.id,
    null, null, null, false, null
  )
  on conflict (session_id, person_id) do nothing
  returning * into v_attendance;

  if not found then
    select * into v_attendance
    from public.attendance
    where session_id = v_session.id and person_id = v_uid;
  end if;

  select p.id, p.amount_fcfa
    into v_penalty_id, v_penalty_amount
  from public.penalties p
  where p.attendance_id = v_attendance.id
  order by p.created_at desc
  limit 1;

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'attendance_id', v_attendance.id,
    'daily_attendance_id', v_attendance.id,
    'status', v_attendance.status,
    'arrived_at', v_attendance.arrived_at,
    'delay_minutes', v_attendance.delay_minutes,
    'penalty_id', v_penalty_id,
    'penalty_amount_fcfa', coalesce(v_penalty_amount, 0),
    'access_blocked', v_attendance.access_blocked,
    'checkpoint', v_checkpoint.name
  );
end;
$function$;

revoke all on function public.qr_daily_checkin_without_gps(uuid) from public, anon;
grant execute on function public.qr_daily_checkin_without_gps(uuid) to authenticated;
notify pgrst, 'reload schema';
