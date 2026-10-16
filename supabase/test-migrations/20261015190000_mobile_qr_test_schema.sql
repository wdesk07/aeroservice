-- TEST-ONLY compatibility for the TEST project's daily_attendance schema.
-- Do not apply this file to production; production uses the main migration with public.attendance.
create table if not exists public.qr_checkin_requests (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.students(id) on delete cascade,
  session_id uuid not null references public.course_sessions(id) on delete cascade,
  requested_at timestamptz not null default clock_timestamp(),
  status text not null default 'pending_confirmation'
    check (status in ('pending_confirmation','approved','rejected')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  daily_attendance_id uuid references public.daily_attendance(id),
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
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_local timestamp without time zone := clock_timestamp() at time zone 'Africa/Porto-Novo';
  v_student public.students%rowtype;
  v_session public.course_sessions%rowtype;
  v_existing public.daily_attendance%rowtype;
  v_request public.qr_checkin_requests%rowtype;
  v_id uuid;
  v_delay integer;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.profiles p where p.id=v_uid and lower(coalesce(p.status,''))='active')
    or not exists(select 1 from public.user_roles ur join public.roles r on r.id=ur.role_id
      where ur.user_id=v_uid and upper(r.code) in ('STUDENT','APPRENANT')) then
    raise exception 'ACTIVE_STUDENT_REQUIRED';
  end if;
  select s.* into v_student from public.students s where s.id=v_uid;
  if not found then raise exception 'ACTIVE_STUDENT_REQUIRED'; end if;
  if not exists(select 1 from public.operating_days od where od.business_date=v_local::date and od.status='open') then
    raise exception 'OPERATING_DAY_CLOSED';
  end if;
  if v_local::time >= time '19:00' then raise exception 'STUDENT_CHECKIN_CLOSED'; end if;

  select * into v_session from public.course_sessions c
  where c.session_date=v_local::date and lower(coalesce(c.status,'')) not in ('cancelled','canceled','annule','annulée','annulee')
    and (c.group_id=v_student.group_id or (c.group_id is null and c.formation_id=v_student.formation_id))
  order by case when v_local::time between c.planned_start and c.planned_end then 0
                when v_local::time < c.planned_start then 1 else 2 end, c.planned_start asc
  limit 1;
  if not found then raise exception 'NO_TRAINING_SESSION_SCHEDULED_TODAY'; end if;
  if v_local::time > v_session.planned_end then raise exception 'CHECKIN_WINDOW_CLOSED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || v_session.id::text,0));

  select * into v_existing from public.daily_attendance d
  where d.person_id=v_uid and d.local_date=v_local::date limit 1;
  if found then
    return jsonb_build_object('ok',true,'duplicate',true,'status',v_existing.status,
      'arrived_at',v_existing.arrived_at,'delay_minutes',v_existing.minutes_after_cutoff);
  end if;

  select * into v_request from public.qr_checkin_requests q
  where q.person_id=v_uid and q.session_id=v_session.id and q.status='pending_confirmation'
  order by q.requested_at desc limit 1;
  if found then
    v_delay := greatest(0,ceil(extract(epoch from ((v_request.requested_at at time zone 'Africa/Porto-Novo') - (v_session.session_date + v_session.planned_start)))/60)::integer);
    return jsonb_build_object('ok',true,'duplicate',true,'request_id',v_request.id,
      'status','pending_confirmation','requested_at',v_request.requested_at,'delay_minutes',v_delay);
  end if;
  if (select count(*) from public.qr_checkin_requests q where q.person_id=v_uid and q.requested_at>=v_now-interval '1 hour') >= 5 then
    raise exception 'QR_CHECKIN_RATE_LIMIT';
  end if;
  insert into public.qr_checkin_requests(person_id,session_id,requested_at,status)
  values(v_uid,v_session.id,v_now,'pending_confirmation') returning id into v_id;
  v_delay := greatest(0,ceil(extract(epoch from (v_local-(v_session.session_date+v_session.planned_start)))/60)::integer);
  return jsonb_build_object('ok',true,'duplicate',false,'request_id',v_id,
    'status','pending_confirmation','requested_at',v_now,'delay_minutes',v_delay);
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
  if not exists(select 1 from public.user_roles ur join public.roles r on r.id=ur.role_id
    where ur.user_id=auth.uid() and upper(r.code) in ('DIRECTOR','ADMIN','PRE_ADMIN','SECRETARIAT','SECRETARY','SECRETAIRE')) then
    raise exception 'QR_CHECKIN_REVIEW_FORBIDDEN';
  end if;
  return query
  select q.id,q.person_id,
    coalesce(nullif(trim(p.display_name),''),nullif(trim(concat_ws(' ',p.first_name,p.last_name)),''),p.email,'Apprenant')::text,
    s.student_number,cs.id,f.name,q.requested_at,
    ((cs.session_date+cs.planned_start) at time zone 'Africa/Porto-Novo'),
    greatest(0,ceil(extract(epoch from ((q.requested_at at time zone 'Africa/Porto-Novo')-(cs.session_date+cs.planned_start)))/60)::integer),
    q.status
  from public.qr_checkin_requests q
  join public.students s on s.id=q.person_id
  join public.profiles p on p.id=q.person_id
  join public.course_sessions cs on cs.id=q.session_id
  left join public.formations f on f.id=cs.formation_id
  where q.status='pending_confirmation'
  order by q.requested_at asc limit 100;
end;
$$;
revoke all on function public.list_qr_checkin_requests() from public, anon;
grant execute on function public.list_qr_checkin_requests() to authenticated;

create or replace function public.review_qr_checkin_request(p_request_id uuid,p_decision text,p_comment text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_req public.qr_checkin_requests%rowtype;
  v_session public.course_sessions%rowtype;
  v_att public.daily_attendance%rowtype;
  v_penalty_id uuid;
  v_penalty_amount integer := 0;
  v_delay integer;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.user_roles ur join public.roles r on r.id=ur.role_id
    where ur.user_id=v_uid and upper(r.code) in ('DIRECTOR','ADMIN','PRE_ADMIN','SECRETARIAT','SECRETARY','SECRETAIRE')) then
    raise exception 'QR_CHECKIN_REVIEW_FORBIDDEN';
  end if;
  if p_decision not in ('approved','rejected') then raise exception 'INVALID_QR_CHECKIN_DECISION'; end if;
  select * into v_req from public.qr_checkin_requests q where q.id=p_request_id and q.status='pending_confirmation' for update;
  if not found then raise exception 'QR_CHECKIN_REQUEST_NOT_PENDING'; end if;
  if p_decision='rejected' then
    update public.qr_checkin_requests set status='rejected',reviewed_by=v_uid,reviewed_at=v_now,
      rejection_reason=nullif(left(trim(coalesce(p_comment,'')),500),'') where id=v_req.id;
    return jsonb_build_object('ok',true,'status','rejected');
  end if;
  select * into v_session from public.course_sessions cs where cs.id=v_req.session_id;
  if not found then raise exception 'NO_TRAINING_SESSION_SCHEDULED_TODAY'; end if;
  if exists(select 1 from public.daily_attendance d where d.person_id=v_req.person_id and d.local_date=v_session.session_date) then
    raise exception 'ATTENDANCE_ALREADY_RECORDED';
  end if;
  v_delay := greatest(0,ceil(extract(epoch from ((v_req.requested_at at time zone 'Africa/Porto-Novo')-(v_session.session_date+v_session.planned_start)))/60)::integer);
  insert into public.daily_attendance(person_id,local_date,person_type,nominal_time,cutoff_time,arrived_at,status,minutes_after_cutoff)
  values(v_req.person_id,v_session.session_date,'student',v_session.planned_start,v_session.planned_start,
    v_req.requested_at,case when v_delay>0 then 'late' else 'on_time' end,v_delay)
  returning * into v_att;
  -- The TEST database's existing AFTER INSERT trigger applies the configured penalty tier.
  select p.id,p.amount_fcfa into v_penalty_id,v_penalty_amount
  from public.penalties p where p.daily_attendance_id=v_att.id limit 1;
  insert into public.attendance_events(attendance_id,person_id,event_type,occurred_at,source,metadata,created_by)
  values(null,v_req.person_id,case when v_delay>0 then 'late_detected' else 'pointage' end,
    v_req.requested_at,'qr',jsonb_build_object('request_id',v_req.id,'daily_attendance_id',v_att.id,
      'session_id',v_req.session_id,'delay_minutes',v_delay,'physical_presence_confirmed',true),v_uid);
  update public.qr_checkin_requests set status='approved',reviewed_by=v_uid,reviewed_at=v_now,
    daily_attendance_id=v_att.id,penalty_id=v_penalty_id where id=v_req.id;
  return jsonb_build_object('ok',true,'status','approved','attendance_id',v_att.id,
    'penalty_id',v_penalty_id,'delay_minutes',v_delay,'penalty_amount_fcfa',coalesce(v_penalty_amount,0),
    'access_blocked',v_delay>0);
end;
$$;
revoke all on function public.review_qr_checkin_request(uuid,text,text) from public, anon;
grant execute on function public.review_qr_checkin_request(uuid,text,text) to authenticated;
