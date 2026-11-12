ALTER TABLE public.penalty_rules ADD COLUMN IF NOT EXISTS person_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS penalty_rules_person_active_type_idx ON public.penalty_rules(person_id, active, penalty_type);

CREATE OR REPLACE FUNCTION private.after_attendance_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_penalty record; v_formation_id uuid;
begin
  if new.status='absent' and new.arrived_at is null then
    insert into public.attendance_events(attendance_id,person_id,event_type,occurred_at,source,metadata,created_by)
    values(new.id,new.person_id,'absence_detected',clock_timestamp(),new.source,jsonb_build_object('session_id',new.session_id,'status','absent'),auth.uid());
    return new;
  end if;
  insert into public.attendance_events(attendance_id,person_id,event_type,occurred_at,source,metadata,created_by)
  values(new.id,new.person_id,'pointage',new.arrived_at,new.source,
    jsonb_build_object('session_id',new.session_id,'delay_minutes',new.delay_minutes,'status',new.status),auth.uid());

  if new.status='late' then
    insert into public.attendance_events(attendance_id,person_id,event_type,occurred_at,source,metadata,created_by)
    values(new.id,new.person_id,'late_detected',new.arrived_at,new.source,
      jsonb_build_object('delay_minutes',new.delay_minutes,'access_blocked',new.access_blocked),auth.uid());

    select cs.formation_id into v_formation_id from public.course_sessions cs where cs.id=new.session_id;
    select pr.id as rule_id,pr.amount_fcfa into v_penalty
    from public.penalty_rules pr
    where pr.active and pr.penalty_type='late_arrival' and pr.application_mode='automatic'
      and (pr.person_id is null or pr.person_id=new.person_id)
      and (pr.formation_id=v_formation_id or pr.formation_id is null)
      and (pr.target_scope='all'
        or (new.person_type='student' and pr.target_scope='students')
        or (new.person_type='staff' and pr.target_scope='staff')
        or (new.person_type='teacher' and pr.target_scope='teacher'))
      and new.delay_minutes > greatest(coalesce(pr.tolerance_minutes,0),0)
      and new.delay_minutes between pr.min_delay_minutes and coalesce(pr.max_delay_minutes,2147483647)
      and (pr.applies_after_time is null or (new.arrived_at at time zone 'Africa/Porto-Novo')::time > pr.applies_after_time)
      and (pr.effective_from is null or new.arrived_at>=pr.effective_from)
      and (pr.effective_until is null or new.arrived_at<=pr.effective_until)
    order by (pr.person_id is not null) desc, (pr.formation_id is not null) desc,
      case when (new.person_type='student' and pr.target_scope='students') or (new.person_type='staff' and pr.target_scope='staff') or (new.person_type='teacher' and pr.target_scope='teacher') then 0 else 1 end,
      pr.priority asc,pr.min_delay_minutes desc,pr.created_at desc
    limit 1;
    if found and v_penalty.amount_fcfa>0 then
      insert into public.penalties(attendance_id,person_id,rule_id,amount_fcfa,status)
      values(new.id,new.person_id,v_penalty.rule_id,v_penalty.amount_fcfa,'pending');
    end if;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.kiosk_daily_checkin(p_device_token text, p_lat numeric DEFAULT NULL::numeric, p_lng numeric DEFAULT NULL::numeric, p_accuracy_m numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_local timestamp without time zone := clock_timestamp() at time zone 'Africa/Porto-Novo';
  v_date date;
  v_student public.students%rowtype;
  v_session public.course_sessions%rowtype;
  v_rule public.penalty_rules%rowtype;
  v_device public.presence_kiosk_devices%rowtype;
  v_att public.attendance%rowtype;
  v_delay integer;
  v_raw_delay integer;
  v_penalty uuid;
  v_penalty_amount integer := 0;
  v_has_rule boolean := false;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_device_token IS NULL OR length(p_device_token)<40 THEN RAISE EXCEPTION 'KIOSK_NOT_REGISTERED'; END IF;
  SELECT * INTO v_device FROM public.presence_kiosk_devices
   WHERE token_hash=encode(extensions.digest(convert_to(p_device_token,'UTF8'),'sha256'),'hex') AND revoked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'KIOSK_NOT_REGISTERED'; END IF;

  SELECT s.* INTO v_student FROM public.students s JOIN public.profiles p ON p.id=s.id
   WHERE s.id=v_uid AND p.status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'ACTIVE_STUDENT_REQUIRED'; END IF;

  v_date := v_local::date;
  IF public.attendance_gps_enabled() THEN
    IF p_lat IS NULL OR p_lng IS NULL OR p_accuracy_m IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 OR p_accuracy_m <= 0 OR p_accuracy_m > 100 THEN RAISE EXCEPTION 'GPS_REQUIRED_OR_INACCURATE'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.checkpoints c WHERE c.active AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL) THEN RAISE EXCEPTION 'CENTRE_GPS_NOT_CONFIGURED'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.checkpoints c WHERE c.active AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL AND 6371000 * 2 * asin(sqrt(power(sin(radians(p_lat-c.latitude)/2),2)+cos(radians(c.latitude))*cos(radians(p_lat))*power(sin(radians(p_lng-c.longitude)/2),2))) <= coalesce(c.radius_m,100) AND p_accuracy_m <= coalesce(c.radius_m,100)) THEN RAISE EXCEPTION 'OUTSIDE_CHECKPOINT_RADIUS'; END IF;
  END IF;
  IF v_local::time < public.kiosk_opening_time() OR v_local::time >= public.kiosk_closing_time() THEN RAISE EXCEPTION 'STUDENT_CHECKIN_CLOSED'; END IF;

  -- Daily idempotency comes before session matching: a prior valid pointage
  -- remains recognized even if a schedule was edited after the pointage.
  SELECT * INTO v_att FROM public.attendance a
   WHERE a.person_id=v_uid AND lower(a.person_type)='student'
     AND (coalesce(a.arrived_at,a.planned_at,a.created_at) AT TIME ZONE 'Africa/Porto-Novo')::date=v_date
   ORDER BY a.arrived_at ASC NULLS LAST,a.created_at ASC LIMIT 1;
  IF FOUND THEN
    UPDATE public.presence_kiosk_devices SET last_used_at=v_now WHERE id=v_device.id;
    RETURN jsonb_build_object('ok',true,'duplicate',true,'status',v_att.status,'arrived_at',v_att.arrived_at,'delay_minutes',v_att.delay_minutes);
  END IF;

  PERFORM public.materialize_formation_sessions_for_date(v_date);

  SELECT * INTO v_session FROM public.course_sessions c
   WHERE c.session_date=v_date
     AND lower(coalesce(c.status,'')) NOT IN ('cancelled','canceled','annule','annulée','annulee')
     AND (
       c.formation_id=v_student.formation_id
       AND (
         c.group_id IS NULL
         OR c.group_id=v_student.group_id
         OR (
           v_student.group_id IS NULL
           AND c.group_id IS NOT NULL
           AND (SELECT count(*) FROM public.groups g WHERE g.formation_id=v_student.formation_id AND g.status='active')=1
           AND c.group_id=(SELECT g.id FROM public.groups g WHERE g.formation_id=v_student.formation_id AND g.status='active' LIMIT 1)
         )
       )
     )
   ORDER BY c.planned_start ASC
   LIMIT 1;

  -- Formation is the primary learner assignment. If a legacy group mismatch
  -- prevented the strict match, accept a scheduled session for that same formation.
  IF NOT FOUND THEN
    SELECT * INTO v_session FROM public.course_sessions c
     WHERE c.session_date=v_date
       AND c.formation_id=v_student.formation_id
       AND lower(coalesce(c.status,'')) NOT IN ('cancelled','canceled','annule','annulée','annulee')
     ORDER BY c.planned_start ASC
     LIMIT 1;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_TRAINING_SESSION_SCHEDULED_TODAY'; END IF;
  -- Daily pointage remains valid after the first session ends; it covers all sessions today.

  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || v_date::text,0));
  -- Recheck under the daily lock to prevent duplicate daily records on concurrent attempts.
  SELECT * INTO v_att FROM public.attendance a
   WHERE a.person_id=v_uid AND lower(a.person_type)='student'
     AND (coalesce(a.arrived_at,a.planned_at,a.created_at) AT TIME ZONE 'Africa/Porto-Novo')::date=v_date
   ORDER BY a.arrived_at ASC NULLS LAST,a.created_at ASC LIMIT 1;
  IF FOUND THEN
    UPDATE public.presence_kiosk_devices SET last_used_at=v_now WHERE id=v_device.id;
    RETURN jsonb_build_object('ok',true,'duplicate',true,'status',v_att.status,'arrived_at',v_att.arrived_at,'delay_minutes',v_att.delay_minutes);
  END IF;

  v_raw_delay := greatest(0,floor(extract(epoch FROM (v_now-v_session.planned_start))/60)::integer);
  SELECT * INTO v_rule FROM public.penalty_rules r
   WHERE r.active AND r.penalty_type='late_arrival'
     AND r.application_mode='automatic'
     AND r.target_scope IN ('students','all')
     AND (r.person_id IS NULL OR r.person_id=v_uid)
     AND (r.formation_id=v_session.formation_id OR r.formation_id IS NULL)
     AND (r.applies_after_time IS NULL OR v_local::time > r.applies_after_time)
     AND v_raw_delay > greatest(coalesce(r.tolerance_minutes,0),0)
     AND v_raw_delay >= r.min_delay_minutes
     AND (r.max_delay_minutes IS NULL OR v_raw_delay <= r.max_delay_minutes)
     AND (r.effective_from IS NULL OR r.effective_from<=v_now)
     AND (r.effective_until IS NULL OR r.effective_until>=v_now)
   ORDER BY (r.person_id IS NOT NULL) DESC,(r.formation_id IS NOT NULL) DESC,r.priority ASC,r.min_delay_minutes DESC,r.created_at DESC
   LIMIT 1;
  v_has_rule := FOUND;
  v_delay := v_raw_delay;

  INSERT INTO public.attendance(session_id,person_id,person_type,status,planned_at,arrived_at,delay_minutes,access_blocked,source,latitude,longitude,location_accuracy_m)
   VALUES(v_session.id,v_uid,'student',CASE WHEN v_raw_delay>0 THEN 'late' ELSE 'on_time' END,
     v_session.planned_start,v_now,v_delay,CASE WHEN v_has_rule THEN v_rule.blocks_access ELSE false END,
     'qr',p_lat,p_lng,p_accuracy_m)
   RETURNING * INTO v_att;
-- Attendance events and penalties are created centrally by the AFTER INSERT trigger.
  SELECT p.id,p.amount_fcfa INTO v_penalty,v_penalty_amount FROM public.penalties p WHERE p.attendance_id=v_att.id ORDER BY p.created_at DESC LIMIT 1;
  UPDATE public.presence_kiosk_devices SET last_used_at=v_now WHERE id=v_device.id;
  RETURN jsonb_build_object('ok',true,'duplicate',false,'status',v_att.status,'arrived_at',v_att.arrived_at,
    'delay_minutes',v_att.delay_minutes,'penalty_id',v_penalty,'penalty_amount_fcfa',coalesce(v_penalty_amount,0),'access_blocked',v_att.access_blocked);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.request_qr_checkin()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  if v_local::time < public.kiosk_opening_time() or v_local::time >= public.kiosk_closing_time() then
    raise exception 'STUDENT_CHECKIN_CLOSED';
  end if;

  select * into v_session from public.course_sessions c
  where c.session_date=v_local::date
    and lower(coalesce(c.status,'')) not in ('cancelled','canceled','annule','annulée','annulee')
    and c.formation_id=v_student.formation_id
    and (c.group_id=v_student.group_id or c.group_id is null)
  order by c.planned_start asc
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

  v_delay := greatest(0,floor(extract(epoch from (v_now-v_session.planned_start))/60)::integer);

  -- Canonical student grace period matches the attendance guard: 15 full minutes.
  v_tolerance := 15;
  v_delay := case when v_delay > v_tolerance then v_delay else 0 end;

  select * into v_rule from public.penalty_rules r
  where r.active and r.penalty_type='late_arrival'
    and r.application_mode='automatic' and r.target_scope in ('students','all')
    and (r.person_id is null or r.person_id=v_uid)
    and (r.formation_id=v_session.formation_id or r.formation_id is null)
    and (r.applies_after_time is null or (v_now at time zone 'Africa/Porto-Novo')::time > r.applies_after_time)
    and v_delay > greatest(coalesce(r.tolerance_minutes,15),0)
    and v_delay >= r.min_delay_minutes
    and (r.max_delay_minutes is null or v_delay <= r.max_delay_minutes)
    and (r.effective_from is null or r.effective_from<=v_now)
    and (r.effective_until is null or r.effective_until>=v_now)
  order by (r.person_id is not null) desc, (r.formation_id is not null) desc, r.priority asc, r.min_delay_minutes desc, r.created_at desc
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
  v_delay := coalesce(v_att.delay_minutes,0);

  -- The AFTER INSERT trigger writes the attendance event and creates any penalty once.
  select p.id into v_penalty
  from public.penalties p
  where p.attendance_id = v_att.id
  order by p.created_at desc
  limit 1;

  return jsonb_build_object(
    'ok',true,'duplicate',false,'status',v_att.status,
    'attendance_id',v_att.id,'arrived_at',v_att.arrived_at,
    'delay_minutes',v_delay,'tolerance_minutes',v_tolerance,
    'access_blocked',v_att.access_blocked,'penalty_id',v_penalty,
    'penalty_amount_fcfa',case when v_penalty is not null then v_rule.amount_fcfa else 0 end,
    'formation_id',v_session.formation_id
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.wdesk_owner_penalty_mutation(
  p_actor_id uuid,
  p_action text,
  p_payload jsonb,
  p_reason text,
  p_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor public.profiles%rowtype;
  v_role_codes text[];
  v_id uuid;
  v_person_id uuid;
  v_person_type text;
  v_scope text;
  v_old jsonb;
  v_new jsonb;
  v_status text;
  v_result jsonb;
BEGIN
  IF p_actor_id IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'OWNER_ACTOR_AND_REQUEST_REQUIRED'; END IF;
  IF length(trim(coalesce(p_reason,''))) < 8 OR length(trim(p_reason)) > 500 THEN RAISE EXCEPTION 'OWNER_REASON_REQUIRED'; END IF;
  IF p_action NOT IN ('penalty_rule_upsert','penalty_rule_delete','penalty_delete') THEN RAISE EXCEPTION 'PENALTY_ACTION_NOT_ALLOWED'; END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN RAISE EXCEPTION 'PENALTY_PAYLOAD_REQUIRED'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  SELECT new_values INTO v_result FROM public.audit_logs
    WHERE module='wdesk_production' AND new_values->>'request_id'=p_request_id::text
    ORDER BY created_at DESC LIMIT 1;
  IF v_result IS NOT NULL THEN RETURN v_result || jsonb_build_object('ok',true,'replayed',true); END IF;

  SELECT * INTO v_actor FROM public.profiles WHERE id=p_actor_id FOR SHARE;
  IF NOT FOUND OR lower(coalesce(v_actor.email,'')) <> 'wdesk87@gmail.com' OR lower(coalesce(v_actor.status,'')) <> 'active' THEN
    RAISE EXCEPTION 'PRODUCTION_OWNER_NOT_VERIFIED';
  END IF;
  SELECT array_agg(upper(r.code)) INTO v_role_codes
    FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id WHERE ur.user_id=p_actor_id;
  IF NOT coalesce(v_role_codes,'{}'::text[]) @> array['DIRECTOR','PRE_ADMIN']::text[] THEN
    RAISE EXCEPTION 'PRODUCTION_OWNER_ROLES_REQUIRED';
  END IF;

  IF p_action='penalty_rule_upsert' THEN
    IF coalesce(trim(p_payload->>'penalty_type'),'')='' OR coalesce((p_payload->>'amount_fcfa')::integer,0)<=0
      OR coalesce((p_payload->>'min_delay_minutes')::integer,-1)<0
      OR coalesce((p_payload->>'tolerance_minutes')::integer,-1)<0
      OR (nullif(p_payload->>'max_delay_minutes','') IS NOT NULL AND (p_payload->>'max_delay_minutes')::integer < (p_payload->>'min_delay_minutes')::integer) THEN
      RAISE EXCEPTION 'INVALID_PENALTY_RULE';
    END IF;
    IF coalesce(p_payload->>'penalty_type','') NOT IN ('late_arrival','unjustified_absence','early_departure','repeated_absence','noncompliance','misconduct','equipment_damage','equipment_loss','badge_loss','incomplete_file','late_payment','unauthorized_access','safety_violation','exam_misconduct','other') THEN
      RAISE EXCEPTION 'INVALID_PENALTY_TYPE';
    END IF;
    v_person_type := coalesce(p_payload->>'person_type','student');
    IF v_person_type NOT IN ('student','staff','teacher') THEN RAISE EXCEPTION 'INVALID_PENALTY_PERSON_TYPE'; END IF;
    v_scope := coalesce(p_payload->>'target_scope','all');
    IF v_scope NOT IN ('all','students','staff','teacher') THEN RAISE EXCEPTION 'INVALID_PENALTY_SCOPE'; END IF;
    IF coalesce(p_payload->>'application_mode','automatic') NOT IN ('automatic','manual') THEN RAISE EXCEPTION 'INVALID_PENALTY_APPLICATION_MODE'; END IF;
    v_person_id := nullif(p_payload->>'person_id','')::uuid;
    IF v_person_id IS NOT NULL THEN
      IF NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=v_person_id AND lower(coalesce(p.status,''))='active') THEN
        RAISE EXCEPTION 'ACTIVE_TARGET_PROFILE_REQUIRED';
      END IF;
      IF (v_person_type='student' AND NOT EXISTS(SELECT 1 FROM public.students s WHERE s.id=v_person_id))
        OR (v_person_type='staff' AND NOT EXISTS(SELECT 1 FROM public.staff s WHERE s.id=v_person_id))
        OR (v_person_type='teacher' AND NOT EXISTS(SELECT 1 FROM public.teachers t WHERE t.id=v_person_id)) THEN
        RAISE EXCEPTION 'TARGET_PERSON_TYPE_MISMATCH';
      END IF;
      v_scope := CASE v_person_type WHEN 'student' THEN 'students' WHEN 'staff' THEN 'staff' ELSE 'teacher' END;
    END IF;
    v_id := nullif(p_payload->>'target_id','')::uuid;
    v_status := CASE WHEN coalesce((p_payload->>'active')::boolean,true) THEN 'true' ELSE 'false' END;
    IF v_id IS NOT NULL THEN
      SELECT to_jsonb(pr) INTO v_old FROM public.penalty_rules pr WHERE pr.id=v_id FOR UPDATE;
      IF v_old IS NULL THEN RAISE EXCEPTION 'PENALTY_RULE_NOT_FOUND'; END IF;
      UPDATE public.penalty_rules SET
        person_id=v_person_id,
        person_type=v_person_type,
        penalty_type=trim(p_payload->>'penalty_type'),
        description=nullif(trim(coalesce(p_payload->>'description','')),''),
        target_scope=v_scope,
        application_mode=coalesce(p_payload->>'application_mode','automatic'),
        min_delay_minutes=(p_payload->>'min_delay_minutes')::integer,
        max_delay_minutes=nullif(p_payload->>'max_delay_minutes','')::integer,
        tolerance_minutes=(p_payload->>'tolerance_minutes')::integer,
        amount_fcfa=(p_payload->>'amount_fcfa')::integer,
        priority=coalesce((p_payload->>'priority')::integer,100),
        formation_id=nullif(p_payload->>'formation_id','')::uuid,
        blocks_access=coalesce((p_payload->>'blocks_access')::boolean,false),
        active=(v_status='true'),
        effective_until=CASE WHEN v_status='true' THEN NULL ELSE effective_until END
      WHERE id=v_id RETURNING to_jsonb(public.penalty_rules.*) INTO v_new;
    ELSE
      INSERT INTO public.penalty_rules(
        person_id,person_type,penalty_type,description,target_scope,application_mode,
        min_delay_minutes,max_delay_minutes,tolerance_minutes,amount_fcfa,priority,
        formation_id,blocks_access,active,created_by,effective_from
      ) VALUES (
        v_person_id,v_person_type,trim(p_payload->>'penalty_type'),
        nullif(trim(coalesce(p_payload->>'description','')),''),v_scope,
        coalesce(p_payload->>'application_mode','automatic'),
        (p_payload->>'min_delay_minutes')::integer,
        nullif(p_payload->>'max_delay_minutes','')::integer,
        (p_payload->>'tolerance_minutes')::integer,(p_payload->>'amount_fcfa')::integer,
        coalesce((p_payload->>'priority')::integer,100),
        nullif(p_payload->>'formation_id','')::uuid,
        coalesce((p_payload->>'blocks_access')::boolean,false),(v_status='true'),
        p_actor_id,clock_timestamp()
      ) RETURNING id,to_jsonb(public.penalty_rules.*) INTO v_id,v_new;
    END IF;
  ELSIF p_action='penalty_rule_delete' THEN
    v_id := nullif(p_payload->>'target_id','')::uuid;
    IF v_id IS NULL THEN RAISE EXCEPTION 'PENALTY_RULE_ID_REQUIRED'; END IF;
    SELECT to_jsonb(pr) INTO v_old FROM public.penalty_rules pr WHERE pr.id=v_id FOR UPDATE;
    IF v_old IS NULL THEN RAISE EXCEPTION 'PENALTY_RULE_NOT_FOUND'; END IF;
    UPDATE public.penalty_rules SET active=false,
      effective_until=CASE WHEN effective_until IS NULL OR effective_until>clock_timestamp() THEN clock_timestamp() ELSE effective_until END
    WHERE id=v_id RETURNING to_jsonb(public.penalty_rules.*) INTO v_new;
  ELSIF p_action='penalty_delete' THEN
    v_id := nullif(p_payload->>'target_id','')::uuid;
    IF v_id IS NULL THEN RAISE EXCEPTION 'PENALTY_ID_REQUIRED'; END IF;
    SELECT to_jsonb(pn) INTO v_old FROM public.penalties pn WHERE pn.id=v_id FOR UPDATE;
    IF v_old IS NULL THEN RAISE EXCEPTION 'PENALTY_NOT_FOUND'; END IF;
    IF coalesce(v_old->>'status','') <> 'pending' THEN RAISE EXCEPTION 'ONLY_PENDING_PENALTIES_CAN_BE_CANCELLED'; END IF;
    IF EXISTS(SELECT 1 FROM public.payments pm WHERE pm.penalty_id=v_id) THEN RAISE EXCEPTION 'PENALTY_HAS_PAYMENT_HISTORY'; END IF;
    UPDATE public.penalties SET status='cancelled',cancelled_reason=left(trim(p_reason),500)
      WHERE id=v_id RETURNING to_jsonb(public.penalties.*) INTO v_new;
  END IF;

  INSERT INTO public.audit_logs(actor_id,action,module,entity_type,entity_id,old_values,new_values,visibility)
  VALUES(p_actor_id,p_action,'wdesk_production',p_action,v_id,v_old,
    coalesce(v_new,'{}'::jsonb)||jsonb_build_object('request_id',p_request_id,'reason',left(trim(p_reason),500)),
    'business');
  RETURN jsonb_build_object('ok',true,'action',p_action,'entity_id',v_id,'entity',v_new,'request_id',p_request_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.wdesk_owner_penalty_mutation(uuid,text,jsonb,text,uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.wdesk_owner_penalty_mutation(uuid,text,jsonb,text,uuid) TO service_role;

NOTIFY pgrst, 'reload schema';