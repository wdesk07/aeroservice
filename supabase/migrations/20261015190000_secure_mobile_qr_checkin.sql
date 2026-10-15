-- Mobile QR attendance requests: a static QR never finalizes attendance by itself.
-- A secretary must physically verify the learner before the server creates attendance and penalties.
create table if not exists public.qr_checkin_requests (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.students(id) on delete cascade,
  session_id uuid not null references public.course_sessions(id) on delete cascade,
  requested_at timestamptz not null default clock_timestamp(),
  status text not null default 'pending_confirmation'
    check (status in ('pending_confirmation','approved','rejected')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  attendance_id uuid references public.attendance(id),
  penalty_id uuid references public.penalties(id),
  rejection_reason text,
  created_at timestamptz not null default now()
);
create unique index if not exists qr_checkin_one_pending_per_session
  on public.qr_checkin_requests(person_id, session_id)
  where status = 'pending_confirmation';
create index if not exists qr_checkin_requests_pending_time_idx
  on public.qr_checkin_requests(status, requested_at desc);
alter table public.qr_checkin_requests enable row level security;
revoke all on public.qr_checkin_requests from anon, authenticated;

create or replace function public.request_qr_checkin()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_local timestamp without time zone := clock_timestamp() at time zone 'Africa/Porto-Novo';
  v_student public.students%rowtype;
  v_session public.course_sessions%rowtype;
  v_existing public.attendance%rowtype;
  v_request public.qr_checkin_requests%rowtype;
  v_id uuid;
  v_delay integer;
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

  if not exists (
    select 1 from public.operating_days od
    where od.business_date=v_local::date and od.status='open'
  ) then raise exception 'OPERATING_DAY_CLOSED'; end if;
  if v_local::time >= time '19:00' then raise exception 'STUDENT_CHECKIN_CLOSED'; end if;

  select * into v_session from public.course_sessions c
  where c.session_date=v_local::date
    and lower(coalesce(c.status,'')) not in ('cancelled','canceled','annule','annulée','annulee')
    and (c.group_id=v_student.group_id or (c.group_id is null and c.formation_id=v_student.formation_id))
  order by case
    when v_local between (c.planned_start at time zone 'Africa/Porto-Novo') and (c.planned_end at time zone 'Africa/Porto-Novo') then 0
    when v_local < (c.planned_start at time zone 'Africa/Porto-Novo') then 1 else 2 end,
    c.planned_start asc
  limit 1;
  if not found then raise exception 'NO_TRAINING_SESSION_SCHEDULED_TODAY'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || v_session.id::text,0));
  select * into v_existing from public.attendance a
    where a.person_id=v_uid and a.session_id=v_session.id
      and lower(a.person_type)='student'
    order by a.created_at desc limit 1;
  if found then
    return jsonb_build_object('ok',true,'duplicate',true,'status',v_existing.status,
      'arrived_at',v_existing.arrived_at,'delay_minutes',v_existing.delay_minutes,
      'message','ATTENDANCE_ALREADY_RECORDED');
  end if;

  select * into v_request from public.qr_checkin_requests q
    where q.person_id=v_uid and q.session_id=v_session.id and q.status='pending_confirmation'
    order by q.requested_at desc limit 1;
  if found then
    v_delay := greatest(0,ceil(extract(epoch from (v_request.requested_at-v_session.planned_start))/60)::integer);
    return jsonb_build_object('ok',true,'duplicate',true,'request_id',v_request.id,
      'status','pending_confirmation','requested_at',v_request.requested_at,'delay_minutes',v_delay);
  end if;

  -- Basic abuse throttle: one new request per learner/session and at most 5 per rolling hour.
  if (select count(*) from public.qr_checkin_requests q
      where q.person_id=v_uid and q.requested_at >= v_now - interval '1 hour') >= 5 then
    raise exception 'QR_CHECKIN_RATE_LIMIT';
  end if;

  insert into public.qr_checkin_requests(person_id,session_id,requested_at,status)
  values(v_uid,v_session.id,v_now,'pending_confirmation')
  returning id into v_id;
  v_delay := greatest(0,ceil(extract(epoch from (v_now-v_session.planned_start))/60)::integer);
  return jsonb_build_object('ok',true,'duplicate',false,'request_id',v_id,
    'status','pending_confirmation','requested_at',v_now,'delay_minutes',v_delay,
    'formation_id',v_session.formation_id);
end;
$$;
revoke all on function public.request_qr_checkin() from public, anon;
grant execute on function public.request_qr_checkin() to authenticated;

create or replace function public.list_qr_checkin_requests()
returns table(
  request_id uuid, person_id uuid, person_name text, student_number text,
  session_id uuid, formation_name text, requested_at timestamptz,
  planned_start timestamptz, delay_minutes integer, status text
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.kiosk_actor_has_role(array['DIRECTOR','ADMIN','PRE_ADMIN','SECRETARIAT','SECRETARY','SECRETAIRE']) then
    raise exception 'QR_CHECKIN_REVIEW_FORBIDDEN';
  end if;
  return query
  select q.id, q.person_id,
    coalesce(nullif(trim(p.display_name),''),nullif(trim(concat_ws(' ',p.first_name,p.last_name)),''),p.email,'Apprenant')::text,
    s.student_number, cs.id, f.name, q.requested_at, cs.planned_start,
    greatest(0,ceil(extract(epoch from (q.requested_at-cs.planned_start))/60)::integer),
    q.status
  from public.qr_checkin_requests q
  join public.students s on s.id=q.person_id
  join public.profiles p on p.id=q.person_id
  join public.course_sessions cs on cs.id=q.session_id
  left join public.formations f on f.id=cs.formation_id
  where q.status='pending_confirmation'
  order by q.requested_at asc
  limit 100;
end;
$$;
revoke all on function public.list_qr_checkin_requests() from public, anon;
grant execute on function public.list_qr_checkin_requests() to authenticated;

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
