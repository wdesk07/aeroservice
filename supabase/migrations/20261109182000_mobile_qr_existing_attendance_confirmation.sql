-- Return an existing confirmed learner attendance as a duplicate result.
-- Re-scanning must never create a second attendance or recalculate the original arrival.
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
  v_penalty_amount integer := 0;
  v_penalty_id uuid;
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
  if found then
    select p.id,p.amount_fcfa into v_penalty_id,v_penalty_amount
    from public.penalties p where p.attendance_id=v_existing.id
    order by p.created_at desc limit 1;
    return jsonb_build_object(
      'ok',true,'duplicate',true,'already_confirmed',true,
      'attendance_id',v_existing.id,'status',v_existing.status,
      'arrived_at',v_existing.arrived_at,'delay_minutes',v_existing.delay_minutes,
      'access_blocked',v_existing.access_blocked,
      'penalty_id',v_penalty_id,'penalty_amount_fcfa',coalesce(v_penalty_amount,0),
      'message','ATTENDANCE_ALREADY_CONFIRMED'
    );
  end if;
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
  return jsonb_build_object('ok',true,'duplicate',v_duplicate,'already_confirmed',false,'request_id',v_request_id,
    'status','pending_confirmation','requested_at',v_now,'planned_start',v_session.planned_start,
    'delay_minutes',v_delay,'late',v_delay>15,'tolerance_minutes',15,
    'message',case when v_duplicate then 'PENDING_REQUEST_ALREADY_SENT' else 'PENDING_SECRETARIAT_CONFIRMATION' end);
end;
$function$;

revoke all on function public.request_qr_checkin_without_gps() from public, anon;
grant execute on function public.request_qr_checkin_without_gps() to authenticated;
