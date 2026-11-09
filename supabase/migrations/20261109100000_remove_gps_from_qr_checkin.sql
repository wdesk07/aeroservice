-- Remove GPS as a prerequisite for learner QR check-in only.
-- Use a dedicated RPC so legacy GPS-enforced QR and personnel flows remain unchanged.
-- This function creates a pending request; it does NOT write attendance.
-- A secretary must physically verify the learner and approve the request.

create or replace function public.request_qr_checkin_without_gps()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_local timestamp without time zone := clock_timestamp() at time zone 'Africa/Porto-Novo';
  v_student public.students%rowtype;
  v_session public.course_sessions%rowtype;
  v_request public.qr_checkin_requests%rowtype;
  v_id uuid;
  v_delay integer;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = v_uid and lower(coalesce(p.status, '')) = 'active'
  ) or not exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = v_uid and upper(r.code) in ('STUDENT', 'APPRENANT')
  ) then
    raise exception 'ACTIVE_STUDENT_REQUIRED';
  end if;

  select s.* into v_student
  from public.students s
  where s.id = v_uid;
  if not found then
    raise exception 'ACTIVE_STUDENT_REQUIRED';
  end if;

  if v_local::time < time '08:30' or v_local::time >= time '19:00' then
    raise exception 'STUDENT_CHECKIN_CLOSED';
  end if;

  select cs.* into v_session
  from public.course_sessions cs
  where cs.session_date = v_local::date
    and lower(coalesce(cs.status, '')) not in ('cancelled', 'canceled', 'annule', 'annulée', 'annulee')
    and (cs.group_id = v_student.group_id
      or (cs.group_id is null and cs.formation_id = v_student.formation_id))
  order by (cs.group_id = v_student.group_id) desc nulls last, cs.planned_start asc
  limit 1;

  if not found then
    raise exception 'NO_TRAINING_SESSION_SCHEDULED_TODAY';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || v_session.id::text, 0));

  if exists (
    select 1 from public.attendance a
    where a.person_id = v_uid
      and a.session_id = v_session.id
      and lower(a.person_type) = 'student'
  ) then
    raise exception 'ATTENDANCE_ALREADY_RECORDED';
  end if;

  select q.* into v_request
  from public.qr_checkin_requests q
  where q.person_id = v_uid
    and q.session_id = v_session.id
    and q.status = 'pending_confirmation'
  order by q.requested_at desc
  limit 1;

  if found then
    v_delay := greatest(
      0,
      ceil(extract(epoch from (
        (v_request.requested_at at time zone 'Africa/Porto-Novo')
        - (v_session.session_date + (v_session.planned_start at time zone 'Africa/Porto-Novo')::time)
      )) / 60)::integer
    );
    return jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'request_id', v_request.id,
      'status', 'pending_confirmation',
      'requested_at', v_request.requested_at,
      'delay_minutes', v_delay
    );
  end if;

  if (
    select count(*)
    from public.qr_checkin_requests q
    where q.person_id = v_uid
      and q.requested_at >= v_now - interval '1 hour'
  ) >= 5 then
    raise exception 'QR_CHECKIN_RATE_LIMIT';
  end if;

  insert into public.qr_checkin_requests(person_id, session_id, requested_at, status)
  values (v_uid, v_session.id, v_now, 'pending_confirmation')
  returning id into v_id;

  v_delay := greatest(
    0,
    ceil(extract(epoch from (
      v_local - (v_session.session_date + (v_session.planned_start at time zone 'Africa/Porto-Novo')::time)
    )) / 60)::integer
  );

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'request_id', v_id,
    'status', 'pending_confirmation',
    'requested_at', v_now,
    'delay_minutes', v_delay
  );
end;
$function$;

revoke all on function public.request_qr_checkin_without_gps() from public, anon;
grant execute on function public.request_qr_checkin_without_gps() to authenticated;

notify pgrst, 'reload schema';
