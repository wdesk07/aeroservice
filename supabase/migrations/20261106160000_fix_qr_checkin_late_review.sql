-- Correct QR review so a late request remains late after physical confirmation.
-- This updates only the review RPC; it does not alter existing attendance or penalties.
create or replace function public.review_qr_checkin_request(p_request_id uuid, p_decision text, p_comment text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_req public.qr_checkin_requests%rowtype;
  v_session public.course_sessions%rowtype;
  v_rule public.penalty_rules%rowtype;
  v_att public.attendance%rowtype;
  v_delay integer;
  v_penalty uuid;
  v_has_rule boolean := false;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.kiosk_actor_has_role(array['DIRECTOR','ADMIN','PRE_ADMIN','SECRETARIAT','SECRETARY','SECRETAIRE']) then
    raise exception 'QR_CHECKIN_REVIEW_FORBIDDEN';
  end if;
  if p_decision not in ('approved','rejected') then raise exception 'INVALID_QR_CHECKIN_DECISION'; end if;

  select * into v_req from public.qr_checkin_requests q
    where q.id=p_request_id and q.status='pending_confirmation' for update;
  if not found then raise exception 'QR_CHECKIN_REQUEST_NOT_PENDING'; end if;

  if p_decision='rejected' then
    update public.qr_checkin_requests set status='rejected',reviewed_by=v_uid,
      reviewed_at=v_now,rejection_reason=nullif(left(trim(coalesce(p_comment,'')),500),'')
    where id=v_req.id;
    return jsonb_build_object('ok',true,'status','rejected');
  end if;

  select * into v_session from public.course_sessions cs where cs.id=v_req.session_id;
  if not found then raise exception 'NO_TRAINING_SESSION_SCHEDULED_TODAY'; end if;
  if exists(select 1 from public.attendance a where a.person_id=v_req.person_id
      and a.session_id=v_req.session_id and lower(a.person_type)='student') then
    raise exception 'ATTENDANCE_ALREADY_RECORDED';
  end if;

  v_delay := greatest(0,ceil(extract(epoch from (v_req.requested_at-v_session.planned_start))/60)::integer);
  select * into v_rule from public.penalty_rules r
  where r.active and r.penalty_type='late_arrival'
    and r.application_mode='automatic'
    and r.target_scope in ('students','all')
    and (r.formation_id=v_session.formation_id or r.formation_id is null)
    and (r.applies_after_time is null or (v_req.requested_at at time zone 'Africa/Porto-Novo')::time > r.applies_after_time)
    and v_delay > greatest(coalesce(r.tolerance_minutes,0),0)
    and v_delay >= r.min_delay_minutes
    and (r.max_delay_minutes is null or v_delay <= r.max_delay_minutes)
    and (r.effective_from is null or r.effective_from<=v_req.requested_at)
    and (r.effective_until is null or r.effective_until>=v_req.requested_at)
  order by (r.formation_id is not null) desc, r.priority asc, r.min_delay_minutes desc, r.created_at desc
  limit 1;
  v_has_rule := found;

  insert into public.attendance(session_id,person_id,person_type,status,planned_at,arrived_at,
    delay_minutes,access_blocked,source)
  values(v_req.session_id,v_req.person_id,'student',
    case when v_delay>0 then 'late' else 'on_time' end,
    v_session.planned_start,v_req.requested_at,v_delay,
    case when v_delay>0 then true else false end,'qr')
  returning * into v_att;

  insert into public.attendance_events(attendance_id,person_id,event_type,occurred_at,source,metadata,created_by)
  values(v_att.id,v_req.person_id,case when v_delay>0 then 'late_detected' else 'pointage' end,
    v_req.requested_at,'qr',
    jsonb_build_object('request_id',v_req.id,'session_id',v_req.session_id,
      'delay_minutes',v_delay,'physical_presence_confirmed',true,
      'penalty_rule_id',case when v_has_rule then v_rule.id else null end),v_uid);

  if v_delay>0 and v_has_rule and v_rule.amount_fcfa>0 then
    insert into public.penalties(attendance_id,person_id,rule_id,amount_fcfa,status,
      calculated_at,penalty_type,description)
    values(v_att.id,v_req.person_id,v_rule.id,v_rule.amount_fcfa,'pending',v_now,
      'late_arrival',coalesce(v_rule.description,'Retard à une séance de formation'))
    returning id into v_penalty;
  end if;

  update public.qr_checkin_requests set status='approved',reviewed_by=v_uid,reviewed_at=v_now,
    attendance_id=v_att.id,penalty_id=v_penalty,
    rejection_reason=nullif(left(trim(coalesce(p_comment,'')),500),'')
  where id=v_req.id;

  return jsonb_build_object('ok',true,'status','approved','attendance_id',v_att.id,
    'penalty_id',v_penalty,'delay_minutes',v_delay,
    'penalty_amount_fcfa',case when v_penalty is not null then v_rule.amount_fcfa else 0 end,
    'access_blocked',v_delay>0);
end;
$$;
revoke all on function public.review_qr_checkin_request(uuid,text,text) from public, anon;
grant execute on function public.review_qr_checkin_request(uuid,text,text) to authenticated;
