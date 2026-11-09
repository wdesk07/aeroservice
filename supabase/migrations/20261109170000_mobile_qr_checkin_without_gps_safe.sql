-- Mobile QR check-in without collecting device location.
-- Learners create a pending request; only the secretariat can confirm attendance.
-- Personnel attendance continues through the production attendance triggers.
create or replace function public.request_qr_checkin_without_gps()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_local timestamp without time zone := clock_timestamp() at time zone 'Africa/Porto-Novo';
  v_student public.students%rowtype;
  v_session public.course_sessions%rowtype;
  v_existing public.attendance%rowtype;
  v_request_id uuid;
  v_delay integer;
  v_duplicate boolean := false;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (select 1 from public.profiles p where p.id=v_uid and lower(coalesce(p.status,''))='active')
     or not exists (select 1 from public.user_roles ur join public.roles r on r.id=ur.role_id
                    where ur.user_id=v_uid and upper(r.code) in ('STUDENT','APPRENANT')) then
    raise exception 'ACTIVE_STUDENT_REQUIRED';
  end if;
  select s.* into v_student from public.students s where s.id=v_uid;
  if not found then raise exception 'ACTIVE_STUDENT_REQUIRED'; end if;
  if v_local::time < time '08:30' or v_local::time >= time '19:00' then raise exception 'STUDENT_CHECKIN_CLOSED'; end if;
  select cs.* into v_session from public.course_sessions cs
  where cs.session_date=v_local::date
    and lower(coalesce(cs.status,'')) not in ('cancelled','canceled','annule','annulée','annulee')
    and cs.formation_id=v_student.formation_id
    and (cs.group_id=v_student.group_id or cs.group_id is null)
  order by cs.planned_start asc limit 1;
  if not found then raise exception 'NO_TRAINING_SESSION_SCHEDULED_TODAY'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text||':'||v_session.id::text,0));
  select a.* into v_existing from public.attendance a
  where a.person_id=v_uid and lower(a.person_type)='student'
    and (coalesce(a.arrived_at,a.planned_at,a.created_at) at time zone 'Africa/Porto-Novo')::date=v_local::date
  order by a.created_at desc limit 1;
  if found then raise exception 'ATTENDANCE_ALREADY_RECORDED'; end if;
  select q.id,q.requested_at into v_request_id,v_now
  from public.qr_checkin_requests q
  where q.person_id=v_uid and q.session_id=v_session.id and q.status='pending_confirmation'
  limit 1;
  if found then
    v_duplicate := true;
  else
    insert into public.qr_checkin_requests(person_id,session_id,requested_at,status)
    values(v_uid,v_session.id,v_now,'pending_confirmation')
    on conflict (person_id,session_id) where status='pending_confirmation' do nothing
    returning id into v_request_id;
    if v_request_id is null then
      select q.id,q.requested_at into v_request_id,v_now
      from public.qr_checkin_requests q
      where q.person_id=v_uid and q.session_id=v_session.id and q.status='pending_confirmation'
      limit 1;
      v_duplicate := true;
    end if;
  end if;
  v_delay := greatest(0,floor(extract(epoch from (v_now-v_session.planned_start))/60)::integer);
  return jsonb_build_object('ok',true,'duplicate',v_duplicate,'request_id',v_request_id,
    'status','pending_confirmation','requested_at',v_now,'planned_start',v_session.planned_start,
    'delay_minutes',v_delay,'late',v_delay>15,'tolerance_minutes',15,
    'message','PENDING_SECRETARIAT_CONFIRMATION');
end;
$function$;

create or replace function public.request_personnel_qr_checkin_without_gps()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  u uuid := auth.uid();
  n timestamptz := clock_timestamp();
  loc timestamp without time zone := clock_timestamp() at time zone 'Africa/Porto-Novo';
  d date;
  sess public.course_sessions%rowtype;
  att public.attendance%rowtype;
  pen uuid;
  pen_amount integer := 0;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (select 1 from public.profiles p where p.id=u and lower(coalesce(p.status,''))='active') then
    raise exception 'ACTIVE_PERSONNEL_REQUIRED';
  end if;
  if exists(select 1 from public.students where id=u)
     and not public.kiosk_actor_has_role(array[
       'DIRECTOR','ADMIN','PRE_ADMIN','SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE',
       'STAFF','PERSONNEL','ACCOUNTING','FINANCE','PEDAGOGY','PEDAGOGIE','TEACHER','ENSEIGNANT'
     ]) then
    raise exception 'ACTIVE_PERSONNEL_REQUIRED';
  end if;
  if not (
    exists(select 1 from public.staff where id=u)
    or exists(select 1 from public.teachers where id=u)
    or public.kiosk_actor_has_role(array[
      'DIRECTOR','ADMIN','PRE_ADMIN','SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE',
      'STAFF','PERSONNEL','ACCOUNTING','FINANCE','PEDAGOGY','PEDAGOGIE','TEACHER','ENSEIGNANT'
    ])
  ) then raise exception 'ACTIVE_PERSONNEL_REQUIRED'; end if;
  if loc::time < time '08:30' or loc::time >= time '19:00' then
    raise exception 'PERSONNEL_CHECKIN_CLOSED';
  end if;
  d := loc::date;
  perform pg_advisory_xact_lock(hashtextextended('personnel-daily:'||d::text,0));
  select * into sess from public.course_sessions cs
  where cs.session_date=d and cs.session_type='exceptional'
    and cs.cancellation_reason='SYSTEM_PERSONNEL_DAILY_ATTENDANCE'
  limit 1;
  if not found then
    insert into public.course_sessions(session_date,planned_start,planned_end,session_type,status,cancellation_reason)
    values(d,(d+time '08:30') at time zone 'Africa/Porto-Novo',
      (d+time '19:00') at time zone 'Africa/Porto-Novo',
      'exceptional','scheduled','SYSTEM_PERSONNEL_DAILY_ATTENDANCE')
    returning * into sess;
  end if;
  select * into att from public.attendance a
  where a.person_id=u and a.session_id=sess.id
  order by a.created_at desc limit 1;
  if found then
    select p.id,p.amount_fcfa into pen,pen_amount from public.penalties p
    where p.attendance_id=att.id order by p.created_at desc limit 1;
    return jsonb_build_object('ok',true,'duplicate',true,'attendance_id',att.id,
      'status',att.status,'arrived_at',att.arrived_at,'delay_minutes',att.delay_minutes,
      'access_blocked',att.access_blocked,'penalty_id',pen,
      'penalty_amount_fcfa',coalesce(pen_amount,0),'location_verified',false);
  end if;
  insert into public.attendance(
    session_id,person_id,person_type,status,planned_at,arrived_at,delay_minutes,
    access_blocked,source,checkpoint_id,latitude,longitude,location_accuracy_m,
    anomaly,anomaly_reason,metadata
  ) values (
    sess.id,u,'staff','on_time',(d+time '08:30') at time zone 'Africa/Porto-Novo',
    n,0,false,'qr',null,null,null,null,false,null,
    jsonb_build_object('mobile_qr',true,'location_verified',false,'location_method','not_collected')
  )
  on conflict(session_id,person_id) do nothing returning * into att;
  if not found then
    select * into att from public.attendance where session_id=sess.id and person_id=u;
  end if;
  select p.id,p.amount_fcfa into pen,pen_amount from public.penalties p
  where p.attendance_id=att.id order by p.created_at desc limit 1;
  return jsonb_build_object('ok',true,'duplicate',false,'attendance_id',att.id,
    'status',att.status,'arrived_at',att.arrived_at,'delay_minutes',att.delay_minutes,
    'access_blocked',att.access_blocked,'penalty_id',pen,
    'penalty_amount_fcfa',coalesce(pen_amount,0),'location_verified',false);
end;
$function$;

revoke all on function public.request_qr_checkin_without_gps() from public, anon;
grant execute on function public.request_qr_checkin_without_gps() to authenticated;
revoke all on function public.request_personnel_qr_checkin_without_gps() from public, anon;
grant execute on function public.request_personnel_qr_checkin_without_gps() to authenticated;
