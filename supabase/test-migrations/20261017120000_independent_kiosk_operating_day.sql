
create or replace function public.open_operating_day()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid(); v_now timestamptz:=clock_timestamp(); v_date date:=(clock_timestamp() at time zone 'Africa/Porto-Novo')::date; v_status text;
begin
 if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
 if not public.kiosk_actor_has_role(array['DIRECTOR','ADMIN','PRE_ADMIN','SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE','STAFF','PERSONNEL']) then raise exception 'KIOSK_ADMIN_REQUIRED'; end if;
 select status into v_status from public.operating_days where business_date=v_date for update;
 if v_status='closed' then raise exception 'OPERATING_DAY_ALREADY_CLOSED'; end if;
 insert into public.operating_days(business_date,status,opened_at,opened_by,updated_at) values(v_date,'open',v_now,v_uid,v_now)
 on conflict(business_date) do update set status='open',opened_at=coalesce(public.operating_days.opened_at,excluded.opened_at),opened_by=coalesce(public.operating_days.opened_by,excluded.opened_by),closed_at=null,closed_by=null,updated_at=v_now;
 return jsonb_build_object('ok',true,'opened',true,'business_date',v_date,'status','open','opened_at',v_now,'timezone','Africa/Porto-Novo');
end;
$$;
revoke all on function public.open_operating_day() from public,anon;
grant execute on function public.open_operating_day() to authenticated;

create or replace function public.close_operating_day()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid(); v_now timestamptz:=clock_timestamp(); v_local timestamp without time zone:=clock_timestamp() at time zone 'Africa/Porto-Novo'; v_date date:=v_local::date; v_status text; v_absence_result jsonb:='{}'::jsonb;
begin
 if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
 if not public.kiosk_actor_has_role(array['DIRECTOR','ADMIN','PRE_ADMIN','SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE','STAFF','PERSONNEL']) then raise exception 'KIOSK_ADMIN_REQUIRED'; end if;
 select status into v_status from public.operating_days where business_date=v_date for update;
 if v_status is distinct from 'open' then raise exception 'OPERATING_DAY_NOT_OPEN'; end if;
 if v_local::time>=time '19:00' then v_absence_result:=public.close_daily_student_absences(); end if;
 update public.operating_days set status='closed',closed_at=v_now,closed_by=v_uid,updated_at=v_now where business_date=v_date;
 return jsonb_build_object('ok',true,'closed',true,'business_date',v_date,'status','closed','closed_at',v_now,'absence_result',v_absence_result,'kiosk_remains_registered',true);
end;
$$;
revoke all on function public.close_operating_day() from public,anon;
grant execute on function public.close_operating_day() to authenticated;

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
  -- Kiosk availability follows its own 08:30–19:00 schedule, not the administrative day.
  if v_local::time < time '08:30' or v_local::time >= time '19:00' then raise exception 'STUDENT_CHECKIN_CLOSED'; end if;

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
$function$
;
revoke all on function public.request_qr_checkin() from public,anon;
grant execute on function public.request_qr_checkin() to authenticated;
notify pgrst,'reload schema';
