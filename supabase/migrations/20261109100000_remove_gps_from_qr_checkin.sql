-- GPS-only removal for learner QR check-in.
-- Keeps the existing QR check-in workflow, identity checks, schedule checks,
-- duplicate protection, lateness calculation, and penalty rules unchanged.

create or replace function public.request_qr_checkin()
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
  v_rule public.penalty_rules%rowtype;
  v_att public.attendance%rowtype;
  v_penalty uuid;
  v_delay integer;
  v_tolerance integer := 15;
  v_has_rule boolean := false;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (
    select 1 from public.profiles p where p.id=v_uid and lower(coalesce(p.status,''))='active'
  ) or not exists (
    select 1 from public.user_roles ur join public.roles r on r.id=ur.role_id
    where ur.user_id=v_uid and upper(r.code) in ('STUDENT','APPRENANT')
  ) then raise exception 'ACTIVE_STUDENT_REQUIRED'; end if;

  select s.* into v_student from public.students s where s.id=v_uid;
  if not found then raise exception 'ACTIVE_STUDENT_REQUIRED'; end if;

  if v_local::time < time '08:30' or v_local::time >= time '19:00' then
    raise exception 'STUDENT_CHECKIN_CLOSED';
  end if;

  select * into v_session from public.course_sessions c
  where c.session_date=v_local::date
    and lower(coalesce(c.status,'')) not in ('cancelled','canceled','annule','annulée','annulee')
    and (c.group_id=v_student.group_id or (c.group_id is null and c.formation_id=v_student.formation_id))
  order by
    case
      when v_local between (c.planned_start at time zone 'Africa/Porto-Novo') and (c.planned_end at time zone 'Africa/Porto-Novo') then 0
      when v_local >= (c.planned_start at time zone 'Africa/Porto-Novo') then 1
      else 2
    end,
    case when v_local >= (c.planned_start at time zone 'Africa/Porto-Novo') then c.planned_start end desc nulls last,
    c.planned_start asc
  limit 1;
  if not found then raise exception 'NO_TRAINING_SESSION_SCHEDULED_TODAY'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || v_session.id::text,0));
  select * into v_existing from public.attendance a
  where a.person_id=v_uid and a.session_id=v_session.id and lower(a.person_type)='student'
  order by a.created_at desc limit 1;
  if found then
    return jsonb_build_object(
      'ok',true,'duplicate',true,'status',v_existing.status,
      'attendance_id',v_existing.id,'arrived_at',v_existing.arrived_at,
      'delay_minutes',v_existing.delay_minutes,'access_blocked',coalesce(v_existing.access_blocked,false),
      'message','ATTENDANCE_ALREADY_RECORDED'
    );
  end if;

  v_delay := greatest(0,ceil(extract(epoch from (v_now-v_session.planned_start))/60)::integer);

  select greatest(coalesce(r.tolerance_minutes,15),0) into v_tolerance
  from public.penalty_rules r
  where r.active and r.penalty_type='late_arrival'
    and r.application_mode='automatic' and r.target_scope in ('students','all')
    and (r.formation_id=v_session.formation_id or r.formation_id is null)
    and (r.effective_from is null or r.effective_from<=v_now)
    and (r.effective_until is null or r.effective_until>=v_now)
  order by (r.formation_id is not null) desc, r.priority asc, r.created_at desc
  limit 1;
  v_tolerance := coalesce(v_tolerance,15);

  select * into v_rule from public.penalty_rules r
  where r.active and r.penalty_type='late_arrival'
    and r.application_mode='automatic' and r.target_scope in ('students','all')
    and (r.formation_id=v_session.formation_id or r.formation_id is null)
    and (r.applies_after_time is null or (v_now at time zone 'Africa/Porto-Novo')::time > r.applies_after_time)
    and v_delay > greatest(coalesce(r.tolerance_minutes,15),0)
    and v_delay >= r.min_delay_minutes
    and (r.max_delay_minutes is null or v_delay <= r.max_delay_minutes)
    and (r.effective_from is null or r.effective_from<=v_now)
    and (r.effective_until is null or r.effective_until>=v_now)
  order by (r.formation_id is not null) desc, r.priority asc, r.min_delay_minutes desc, r.created_at desc
  limit 1;
  v_has_rule := found;

  insert into public.attendance(
    session_id,person_id,person_type,status,planned_at,arrived_at,
    delay_minutes,access_blocked,source
  )
  values(
    v_session.id,v_uid,'student',
    case when v_delay>v_tolerance then 'late' else 'on_time' end,
    v_session.planned_start,v_now,v_delay,
    v_delay>v_tolerance,'qr'
  ) returning * into v_att;

  insert into public.attendance_events(attendance_id,person_id,event_type,occurred_at,source,metadata,created_by)
  values(
    v_att.id,v_uid,
    case when v_delay>v_tolerance then 'late_detected' else 'pointage' end,
    v_now,'qr',
    jsonb_build_object('session_id',v_session.id,'delay_minutes',v_delay,
      'physical_presence_confirmed',true,
      'tolerance_minutes',v_tolerance,
      'penalty_rule_id',case when v_has_rule then v_rule.id else null end),
    v_uid
  );

  if v_delay>v_tolerance and v_has_rule and v_rule.amount_fcfa>0 then
    insert into public.penalties(attendance_id,person_id,rule_id,amount_fcfa,status,
      calculated_at,penalty_type,description)
    values(v_att.id,v_uid,v_rule.id,v_rule.amount_fcfa,'pending',v_now,
      'late_arrival',coalesce(v_rule.description,'Retard à une séance de formation'))
    returning id into v_penalty;
  end if;

  return jsonb_build_object(
    'ok',true,'duplicate',false,'status',v_att.status,
    'attendance_id',v_att.id,'arrived_at',v_att.arrived_at,
    'delay_minutes',v_delay,'tolerance_minutes',v_tolerance,
    'access_blocked',v_att.access_blocked,'penalty_id',v_penalty,
    'penalty_amount_fcfa',case when v_penalty is not null then v_rule.amount_fcfa else 0 end,
    'formation_id',v_session.formation_id
  );
end;
$function$;

-- The normal QR RPC is now called directly by the learner screen.
revoke all on function public.request_qr_checkin() from public, anon;
grant execute on function public.request_qr_checkin() to authenticated;

-- Compatibility wrapper: keep the old signature for older clients, but ignore
-- GPS inputs and delegate to the normal authenticated QR check-in.
create or replace function public.request_qr_checkin_with_gps(
  p_accuracy_m numeric,
  p_latitude numeric,
  p_longitude numeric
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  return public.request_qr_checkin();
end;
$function$;

revoke all on function public.request_qr_checkin_with_gps(numeric,numeric,numeric) from public, anon;
grant execute on function public.request_qr_checkin_with_gps(numeric,numeric,numeric) to authenticated;
