alter table public.attendance add column if not exists metadata jsonb not null default '{}'::jsonb;

CREATE OR REPLACE FUNCTION private.guard_attendance_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_session public.course_sessions%rowtype;
  v_person_type text;
  v_delay integer;
  v_penalty record;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if new.person_id <> (select auth.uid())
     and not public.is_admin_actor()
     and not public.has_any_role(ARRAY['SECRETARIAT','TEACHER','PEDAGOGY'])
  then raise exception 'Unauthorized attendance actor'; end if;

  select * into v_session from public.course_sessions where id=new.session_id;
  if not found then raise exception 'Session not found'; end if;

  if exists(select 1 from public.students where id=new.person_id) then
    v_person_type := 'student';
  elsif exists(select 1 from public.teachers where id=new.person_id) then
    v_person_type := 'teacher';
  elsif exists(select 1 from public.staff where id=new.person_id) then
    v_person_type := 'staff';
  elsif public.has_any_role(ARRAY['SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE','DIRECTOR','ADMIN','PRE_ADMIN','STAFF','PERSONNEL','ACCOUNTING','FINANCE']) then
    v_person_type := 'staff';
  else raise exception 'Person is not registered'; end if;

  new.person_type := v_person_type;
  new.planned_at := v_session.planned_start;
  if new.status='absent' and new.arrived_at is null and lower(coalesce(new.source,''))='kiosk' then
    new.delay_minutes := 0;
    new.access_blocked := true;
    new.created_at := coalesce(new.created_at,now());
    new.updated_at := now();
    return new;
  end if;
  new.arrived_at := coalesce(new.arrived_at,clock_timestamp());
  v_delay := greatest(0,floor(extract(epoch from (new.arrived_at-v_session.planned_start))/60)::integer);
  new.delay_minutes := v_delay;
  -- The kiosk's agreed grace period is 15 minutes: 09:15 is on time, 09:16 is late.
  new.status := case when (v_person_type='staff' and v_delay <= 10) or (v_person_type<>'staff' and v_delay <= 15) then 'on_time' else 'late' end;
  new.access_blocked := false;

  if new.status='late' then
    select rule_id,amount_fcfa,blocks_access into v_penalty
    from public.calculate_penalty(v_person_type,v_delay,new.arrived_at) limit 1;
    if found then new.access_blocked := coalesce(v_penalty.blocks_access,false); end if;
  end if;

  new.created_at := coalesce(new.created_at,now());
  new.updated_at := now();
  return new;
end;
$function$


CREATE OR REPLACE FUNCTION private.after_attendance_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_penalty record;
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

    select rule_id,amount_fcfa into v_penalty
    from public.calculate_penalty(new.person_type,new.delay_minutes,new.arrived_at) limit 1;
    if found and v_penalty.amount_fcfa>0 then
      insert into public.penalties(attendance_id,person_id,rule_id,amount_fcfa,status)
      values(new.id,new.person_id,v_penalty.rule_id,v_penalty.amount_fcfa,'pending');
    end if;
  end if;
  return new;
end;
$function$


create or replace function public.activate_presence_kiosk(p_name text default 'Borne principale')
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid:=auth.uid(); v_token text; v_device_id uuid; v_name text:=left(trim(coalesce(p_name,'Borne principale')),80);
begin
 if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
 if not public.kiosk_actor_has_role(array['DIRECTOR','ADMIN','PRE_ADMIN','SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE']) then raise exception 'KIOSK_ADMIN_REQUIRED'; end if;
 update public.presence_kiosk_devices set revoked_at=clock_timestamp() where revoked_at is null;
 v_token:=encode(extensions.gen_random_bytes(32),'hex');
 insert into public.presence_kiosk_devices(name,token_hash,activated_by)
 values(coalesce(nullif(v_name,''),'Borne principale'),encode(extensions.digest(convert_to(v_token,'UTF8'),'sha256'),'hex'),v_uid)
 returning id into v_device_id;
 return jsonb_build_object('ok',true,'device_id',v_device_id,'device_name',coalesce(nullif(v_name,''),'Borne principale'),'device_token',v_token,'activated_at',clock_timestamp());
end;
$$;
revoke all on function public.activate_presence_kiosk(text) from public,anon;
grant execute on function public.activate_presence_kiosk(text) to authenticated;

create or replace function public.is_presence_kiosk_registered(p_device_token text)
returns boolean language sql stable security definer set search_path = ''
as $$
 select coalesce(p_device_token is not null and length(p_device_token)>=40 and exists(
   select 1 from public.presence_kiosk_devices d where d.token_hash=encode(extensions.digest(convert_to(p_device_token,'UTF8'),'sha256'),'hex') and d.revoked_at is null
 ),false);
$$;
revoke all on function public.is_presence_kiosk_registered(text) from public;
grant execute on function public.is_presence_kiosk_registered(text) to anon,authenticated;

create or replace function public.is_presence_kiosk_active(p_device_token text)
returns boolean language sql stable security definer set search_path = ''
as $$
 select coalesce(p_device_token is not null and length(p_device_token)>=40
   and (clock_timestamp() at time zone 'Africa/Porto-Novo')::time >= time '08:30'
   and (clock_timestamp() at time zone 'Africa/Porto-Novo')::time < time '19:00'
   and exists(select 1 from public.presence_kiosk_devices d where d.token_hash=encode(extensions.digest(convert_to(p_device_token,'UTF8'),'sha256'),'hex') and d.revoked_at is null),false);
$$;
revoke all on function public.is_presence_kiosk_active(text) from public;
grant execute on function public.is_presence_kiosk_active(text) to anon,authenticated;

create or replace function public.open_operating_day()
returns jsonb language plpgsql security definer set search_path = ''
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
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid:=auth.uid(); v_now timestamptz:=clock_timestamp(); v_local timestamp without time zone:=clock_timestamp() at time zone 'Africa/Porto-Novo'; v_date date:=v_local::date; v_status text; v_absences integer:=0;
begin
 if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
 if not public.kiosk_actor_has_role(array['DIRECTOR','ADMIN','PRE_ADMIN','SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE','STAFF','PERSONNEL']) then raise exception 'KIOSK_ADMIN_REQUIRED'; end if;
 select status into v_status from public.operating_days where business_date=v_date for update;
 if v_status is distinct from 'open' then raise exception 'OPERATING_DAY_NOT_OPEN'; end if;
 if v_local::time >= time '19:00' then
   perform public.materialize_formation_sessions_for_date(v_date);
   with first_sessions as (
     select distinct on (st.id) st.id as person_id,cs.id as session_id,cs.planned_start
     from public.students st join public.profiles p on p.id=st.id and lower(coalesce(p.status,''))='active'
     join public.course_sessions cs on (cs.group_id=st.group_id or (cs.group_id is null and cs.formation_id=st.formation_id))
     where cs.session_date=v_date and lower(coalesce(cs.status,'')) not in ('cancelled','canceled')
       and not exists(select 1 from public.attendance a where a.person_id=st.id and lower(a.person_type)='student'
         and (coalesce(a.arrived_at,a.planned_at,a.created_at) at time zone 'Africa/Porto-Novo')::date=v_date)
     order by st.id,cs.planned_start
   ), inserted as (
     insert into public.attendance(session_id,person_id,person_type,status,planned_at,arrived_at,delay_minutes,access_blocked,source)
     select fs.session_id,fs.person_id,'student','absent',fs.planned_start,null,0,true,'kiosk' from first_sessions fs
     on conflict(session_id,person_id) do nothing returning id
   ) select count(*) into v_absences from inserted;
 end if;
 update public.operating_days set status='closed',closed_at=v_now,closed_by=v_uid,updated_at=v_now where business_date=v_date;
 return jsonb_build_object('ok',true,'closed',true,'business_date',v_date,'status','closed','closed_at',v_now,'absences_created',v_absences,'kiosk_remains_registered',true);
end;
$$;
revoke all on function public.close_operating_day() from public,anon;
grant execute on function public.close_operating_day() to authenticated;

create or replace function public.kiosk_daily_checkin(
 p_device_token text, p_lat numeric default null, p_lng numeric default null, p_accuracy_m numeric default null
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
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
begin
 if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
 if p_device_token is null or length(p_device_token)<40 then raise exception 'KIOSK_NOT_REGISTERED'; end if;
 select * into v_device from public.presence_kiosk_devices
 where token_hash=encode(extensions.digest(convert_to(p_device_token,'UTF8'),'sha256'),'hex') and revoked_at is null;
 if not found then raise exception 'KIOSK_NOT_REGISTERED'; end if;
 select s.* into v_student from public.students s join public.profiles p on p.id=s.id
 where s.id=v_uid and p.status='active';
 if not found then raise exception 'ACTIVE_STUDENT_REQUIRED'; end if;
 v_date := v_local::date;
 if v_local::time < time '08:30' or v_local::time >= time '19:00' then raise exception 'STUDENT_CHECKIN_CLOSED'; end if;
 perform public.materialize_formation_sessions_for_date(v_date);
 select * into v_session from public.course_sessions c
 where c.session_date=v_date
 and lower(coalesce(c.status,'')) not in ('cancelled','canceled','annule','annulée','annulee')
 and (c.group_id=v_student.group_id or (c.group_id is null and c.formation_id=v_student.formation_id))
 order by case when v_local between (c.planned_start at time zone 'Africa/Porto-Novo') and (c.planned_end at time zone 'Africa/Porto-Novo') then 0
               when v_local < (c.planned_start at time zone 'Africa/Porto-Novo') then 1 else 2 end,
 c.planned_start asc limit 1;
 if not found then raise exception 'NO_TRAINING_SESSION_SCHEDULED_TODAY'; end if;
 if v_local > (v_session.planned_end at time zone 'Africa/Porto-Novo') then raise exception 'CHECKIN_WINDOW_CLOSED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || v_session.id::text,0));
 select * into v_att from public.attendance a where a.person_id=v_uid and lower(a.person_type)='student'
 and (coalesce(a.arrived_at,a.planned_at,a.created_at) at time zone 'Africa/Porto-Novo')::date=v_date
 order by a.arrived_at asc nulls last,a.created_at asc limit 1;
 if found then
   return jsonb_build_object('ok',true,'duplicate',true,'status',v_att.status,'arrived_at',v_att.arrived_at,'delay_minutes',v_att.delay_minutes);
 end if;
 -- Zero tolerance means even a positive delay under one minute is late.
  v_raw_delay := greatest(0,ceil(extract(epoch from (v_now-v_session.planned_start))/60)::integer);
 -- Select the configured penalty tier that matches this actual delay, including the zero-tolerance rule.
 select * into v_rule from public.penalty_rules r
 where r.active and r.penalty_type='late_arrival'
 and r.application_mode='automatic'
 and r.target_scope in ('students','all')
 and (r.formation_id=v_session.formation_id or r.formation_id is null)
 and (r.applies_after_time is null or v_local::time > r.applies_after_time)
 and v_raw_delay > greatest(coalesce(r.tolerance_minutes,0),0)
 and v_raw_delay >= r.min_delay_minutes
 and (r.max_delay_minutes is null or v_raw_delay <= r.max_delay_minutes)
 and (r.effective_from is null or r.effective_from<=v_now)
 and (r.effective_until is null or r.effective_until>=v_now)
 order by (r.formation_id is not null) desc, r.priority asc, r.min_delay_minutes desc, r.created_at desc
 limit 1;
 v_has_rule := found;
 v_delay := v_raw_delay;
 insert into public.attendance(session_id,person_id,person_type,status,planned_at,arrived_at,delay_minutes,access_blocked,source,latitude,longitude,location_accuracy_m)
 values(v_session.id,v_uid,'student',case when v_raw_delay>0 then 'late' else 'on_time' end,
   v_session.planned_start,v_now,v_delay,case when v_has_rule then v_rule.blocks_access else false end,
   'kiosk',p_lat,p_lng,p_accuracy_m)
 returning * into v_att;
 insert into public.attendance_events(attendance_id,person_id,event_type,occurred_at,source,metadata,created_by)
 values(v_att.id,v_uid,case when v_delay>0 then 'late_detected' else 'pointage' end,v_now,'kiosk',
   jsonb_build_object('session_id',v_session.id,'delay_minutes',v_delay,'tolerance_minutes',case when v_has_rule then v_rule.tolerance_minutes else 0 end),v_uid);
 select p.id,p.amount_fcfa into v_penalty,v_penalty_amount from public.penalties p where p.attendance_id=v_att.id order by p.created_at desc limit 1;
 update public.presence_kiosk_devices set last_used_at=v_now where id=v_device.id;
 return jsonb_build_object('ok',true,'duplicate',false,'status',v_att.status,'arrived_at',v_att.arrived_at,
   'delay_minutes',v_att.delay_minutes,'penalty_id',v_penalty,'penalty_amount_fcfa',coalesce(v_penalty_amount,0),'access_blocked',v_att.access_blocked);
end;
$$;



revoke all on function public.kiosk_daily_checkin(text,numeric,numeric,numeric) from public,anon;
grant execute on function public.kiosk_daily_checkin(text,numeric,numeric,numeric) to authenticated;

create or replace function public.set_attendance_checkpoint_location(p_latitude numeric,p_longitude numeric,p_radius_m integer default 100)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid:=auth.uid(); v_id uuid;
begin
 if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
 if not public.kiosk_actor_has_role(array['DIRECTOR','ADMIN','PRE_ADMIN']) then raise exception 'KIOSK_ADMIN_REQUIRED'; end if;
 if p_latitude is null or p_longitude is null or p_latitude < -90 or p_latitude > 90 or p_longitude < -180 or p_longitude > 180 then raise exception 'INVALID_LOCATION'; end if;
 if p_radius_m is null or p_radius_m<10 or p_radius_m>1000 then raise exception 'INVALID_RADIUS'; end if;
 update public.checkpoints set latitude=p_latitude,longitude=p_longitude,radius_m=p_radius_m,active=true where code='AERO_ENTRANCE' returning id into v_id;
 if v_id is null then raise exception 'ATTENDANCE_LOCATION_NOT_CONFIGURED'; end if;
 return jsonb_build_object('ok',true,'checkpoint_id',v_id,'radius_m',p_radius_m);
end;
$$;
revoke all on function public.set_attendance_checkpoint_location(numeric,numeric,integer) from public,anon;
grant execute on function public.set_attendance_checkpoint_location(numeric,numeric,integer) to authenticated;

create or replace function public.qr_daily_checkin(p_checkpoint_id uuid,p_lat numeric,p_lng numeric,p_accuracy_m numeric)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
 u uuid:=auth.uid(); n timestamptz:=clock_timestamp(); loc timestamp without time zone:=clock_timestamp() at time zone 'Africa/Porto-Novo';
 d date; cp public.checkpoints%rowtype; sess public.course_sessions%rowtype; att public.attendance%rowtype;
 dist numeric; pen uuid; pen_amount integer:=0;
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 if not exists(select 1 from public.profiles p where p.id=u and lower(coalesce(p.status,''))='active') then raise exception 'ACTIVE_PERSONNEL_REQUIRED'; end if;
 if exists(select 1 from public.students where id=u) and not public.kiosk_actor_has_role(array['DIRECTOR','ADMIN','PRE_ADMIN','SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE','STAFF','PERSONNEL','ACCOUNTING','FINANCE','PEDAGOGY','PEDAGOGIE','TEACHER','ENSEIGNANT']) then raise exception 'ACTIVE_PERSONNEL_REQUIRED'; end if;
 if not (exists(select 1 from public.staff where id=u) or exists(select 1 from public.teachers where id=u) or public.kiosk_actor_has_role(array['DIRECTOR','ADMIN','PRE_ADMIN','SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE','STAFF','PERSONNEL','ACCOUNTING','FINANCE','PEDAGOGY','PEDAGOGIE','TEACHER','ENSEIGNANT'])) then raise exception 'ACTIVE_PERSONNEL_REQUIRED'; end if;
 if loc::time < time '08:30' or loc::time >= time '19:00' then raise exception 'STUDENT_CHECKIN_CLOSED'; end if;
 if p_lat is null or p_lng is null or p_accuracy_m is null or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 or p_accuracy_m<=0 or p_accuracy_m>100 then raise exception 'GPS_REQUIRED_OR_INACCURATE'; end if;
 select * into cp from public.checkpoints where id=p_checkpoint_id and active;
 if not found then raise exception 'CHECKPOINT_INACTIVE'; end if;
 if cp.latitude is null or cp.longitude is null or coalesce(cp.radius_m,0)<=0 then raise exception 'ATTENDANCE_LOCATION_NOT_CONFIGURED'; end if;
 dist:=6371000*2*asin(sqrt(power(sin(radians(p_lat-cp.latitude)/2),2)+cos(radians(cp.latitude))*cos(radians(p_lat))*power(sin(radians(p_lng-cp.longitude)/2),2)));
 if dist>cp.radius_m or p_accuracy_m>cp.radius_m then raise exception 'OUTSIDE_CHECKPOINT_RADIUS'; end if;
 d:=loc::date; perform pg_advisory_xact_lock(hashtextextended('personnel-daily:'||d::text,0));
 select * into sess from public.course_sessions cs where cs.session_date=d and cs.session_type='exceptional' and cs.cancellation_reason='SYSTEM_PERSONNEL_DAILY_ATTENDANCE' limit 1;
 if not found then
   insert into public.course_sessions(session_date,planned_start,planned_end,session_type,status,cancellation_reason)
   values(d,(d+time '08:30') at time zone 'Africa/Porto-Novo',(d+time '19:00') at time zone 'Africa/Porto-Novo','exceptional','scheduled','SYSTEM_PERSONNEL_DAILY_ATTENDANCE') returning * into sess;
 end if;
 select * into att from public.attendance a where a.person_id=u and a.session_id=sess.id order by a.created_at desc limit 1;
 if found then
   select p.id,p.amount_fcfa into pen,pen_amount from public.penalties p where p.attendance_id=att.id order by p.created_at desc limit 1;
   return jsonb_build_object('ok',true,'duplicate',true,'attendance_id',att.id,'daily_attendance_id',att.id,'status',att.status,'arrived_at',att.arrived_at,'delay_minutes',att.delay_minutes,'penalty_id',pen,'penalty_amount_fcfa',coalesce(pen_amount,0));
 end if;
 insert into public.attendance(session_id,person_id,person_type,status,planned_at,arrived_at,delay_minutes,access_blocked,source,checkpoint_id,latitude,longitude,location_accuracy_m,anomaly,anomaly_reason)
 values(sess.id,u,'staff','on_time',(d+time '08:30') at time zone 'Africa/Porto-Novo',n,0,false,'qr',cp.id,p_lat,p_lng,p_accuracy_m,false,null)
 on conflict(session_id,person_id) do nothing returning * into att;
 if not found then select * into att from public.attendance where session_id=sess.id and person_id=u; end if;
 select p.id,p.amount_fcfa into pen,pen_amount from public.penalties p where p.attendance_id=att.id order by p.created_at desc limit 1;
 return jsonb_build_object('ok',true,'duplicate',false,'attendance_id',att.id,'daily_attendance_id',att.id,'status',att.status,'arrived_at',att.arrived_at,'delay_minutes',att.delay_minutes,'penalty_id',pen,'penalty_amount_fcfa',coalesce(pen_amount,0),'access_blocked',att.access_blocked,'checkpoint',cp.name);
end;
$$;
revoke all on function public.qr_daily_checkin(uuid,numeric,numeric,numeric) from public,anon;
grant execute on function public.qr_daily_checkin(uuid,numeric,numeric,numeric) to authenticated;

create or replace view public.daily_attendance with (security_invoker=true) as
select a.id,a.person_id,(coalesce(a.arrived_at,a.planned_at,a.created_at) at time zone 'Africa/Porto-Novo')::date as local_date,
 a.person_type,(a.planned_at at time zone 'Africa/Porto-Novo')::time as nominal_time,
 ((a.planned_at at time zone 'Africa/Porto-Novo')::time + make_interval(mins=>case when lower(a.person_type)='staff' then 10 else 15 end))::time as cutoff_time,
 a.arrived_at,case when a.status='regularized_late' then 'regularized' else a.status end as status,
 greatest(0,coalesce(a.delay_minutes,0)-case when lower(a.person_type)='staff' then 10 else 15 end) as minutes_after_cutoff,
 a.checkpoint_id,a.latitude,a.longitude,a.location_accuracy_m,a.created_at
from public.attendance a;

create or replace view public.director_session_attendance with (security_invoker=true) as
select coalesce(a.id,md5(cs.id::text||':'||st.id::text)::uuid) as id,st.id as person_id,p.display_name,p.first_name,p.last_name,
 st.student_number,cs.id as session_id,cs.session_date,f.name as formation_name,cs.planned_start,cs.planned_end,
 coalesce(case when a.status='regularized_late' then 'regularized' else a.status end,
   case when (clock_timestamp() at time zone 'Africa/Porto-Novo')::date>=cs.session_date
          and (clock_timestamp() at time zone 'Africa/Porto-Novo')::time>=time '19:00' then 'absent' else 'scheduled' end) as status,
 a.arrived_at,(cs.planned_start at time zone 'Africa/Porto-Novo')::time as nominal_time,
 ((cs.planned_start at time zone 'Africa/Porto-Novo')::time + interval '15 minutes')::time as cutoff_time,
 greatest(0,coalesce(a.delay_minutes,0)-15) as minutes_after_cutoff,a.id as daily_attendance_id
from public.course_sessions cs
join public.students st on (cs.group_id=st.group_id or (cs.group_id is null and cs.formation_id=st.formation_id))
join public.profiles p on p.id=st.id and lower(coalesce(p.status,''))='active'
left join public.formations f on f.id=cs.formation_id
left join lateral (
 select x.* from public.attendance x where x.person_id=st.id and lower(x.person_type)='student'
 and (coalesce(x.arrived_at,x.planned_at,x.created_at) at time zone 'Africa/Porto-Novo')::date=cs.session_date
 order by x.arrived_at asc nulls last,x.created_at asc limit 1
) a on true
where lower(coalesce(cs.status,'')) not in ('cancelled','canceled');

grant select on public.daily_attendance,public.director_session_attendance to authenticated;

create or replace function public.materialize_formation_sessions_for_date(p_date date)
returns integer language plpgsql security definer set search_path = ''
as $$
declare n integer:=0;
begin
 if p_date is null then raise exception 'SESSION_DATE_REQUIRED'; end if;
 if auth.uid() is not null and not public.kiosk_actor_has_role(array['DIRECTOR','ADMIN','PRE_ADMIN','PEDAGOGY','STUDENT','APPRENANT','SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE','STAFF','PERSONNEL']) then raise exception 'SESSION_MATERIALIZATION_FORBIDDEN'; end if;
 insert into public.course_sessions(schedule_template_id,formation_id,group_id,subject_id,teacher_id,room_id,session_date,planned_start,planned_end,session_type,status,created_by)
 select st.id,st.formation_id,st.group_id,st.subject_id,st.teacher_id,st.room_id,p_date,
   (p_date+st.start_time) at time zone 'Africa/Porto-Novo',(p_date+st.end_time) at time zone 'Africa/Porto-Novo',
   'regular','scheduled',auth.uid()
 from public.schedule_templates st
 where st.status='active' and st.weekday=extract(isodow from p_date)::integer
   and (st.valid_from is null or st.valid_from<=p_date) and (st.valid_until is null or st.valid_until>=p_date)
   and not exists(select 1 from public.course_sessions cs where cs.schedule_template_id=st.id and cs.session_date=p_date);
 get diagnostics n=row_count; return n;
end;
$$;
revoke all on function public.materialize_formation_sessions_for_date(date) from public,anon;
grant execute on function public.materialize_formation_sessions_for_date(date) to authenticated;

create or replace function public.refresh_session_attendance_for_date(p_date date)
returns integer language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
 if auth.uid() is not null and not public.kiosk_actor_has_role(array['DIRECTOR','ADMIN','PRE_ADMIN']) then raise exception 'SESSION_ATTENDANCE_REFRESH_FORBIDDEN'; end if;
 select count(*) into n from public.course_sessions where session_date=p_date; return n;
end;
$$;
revoke all on function public.refresh_session_attendance_for_date(date) from public,anon;
grant execute on function public.refresh_session_attendance_for_date(date) to authenticated;

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

  -- The kiosk's availability is based on its own 08:30–19:00 schedule, not on the administrative day record.
  if v_local::time < time '08:30' or v_local::time >= time '19:00' then
    raise exception 'STUDENT_CHECKIN_CLOSED';
  end if;

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
  if v_local > (v_session.planned_end at time zone 'Africa/Porto-Novo') then raise exception 'CHECKIN_WINDOW_CLOSED'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || v_session.id::text,0));
  select * into v_existing from public.attendance a
    where a.person_id=v_uid and lower(a.person_type)='student'
      and (coalesce(a.arrived_at,a.planned_at,a.created_at) at time zone 'Africa/Porto-Novo')::date=v_local::date
    order by a.arrived_at asc nulls last,a.created_at asc limit 1;
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

revoke all on function public.request_qr_checkin() from public,anon;
grant execute on function public.request_qr_checkin() to authenticated;

create or replace function public.review_qr_checkin_request(p_request_id uuid, p_decision text, p_comment text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_req public.qr_checkin_requests%rowtype;
  v_session public.course_sessions%rowtype;
  v_att public.attendance%rowtype;
  v_penalty uuid;
  v_penalty_amount integer := 0;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.kiosk_actor_has_role(array['DIRECTOR','ADMIN','PRE_ADMIN','SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE']) then raise exception 'QR_CHECKIN_REVIEW_FORBIDDEN'; end if;
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
  if exists(select 1 from public.attendance a where a.person_id=v_req.person_id and lower(a.person_type)='student'
    and (coalesce(a.arrived_at,a.planned_at,a.created_at) at time zone 'Africa/Porto-Novo')::date=v_session.session_date) then
    raise exception 'ATTENDANCE_ALREADY_RECORDED';
  end if;
  insert into public.attendance(session_id,person_id,person_type,status,planned_at,arrived_at,delay_minutes,access_blocked,source)
  values(v_req.session_id,v_req.person_id,'student','on_time',v_session.planned_start,v_req.requested_at,0,false,'qr')
  returning * into v_att;
  select p.id,p.amount_fcfa into v_penalty,v_penalty_amount from public.penalties p where p.attendance_id=v_att.id order by p.created_at desc limit 1;
  update public.qr_checkin_requests set status='approved',reviewed_by=v_uid,reviewed_at=v_now,
    attendance_id=v_att.id,penalty_id=v_penalty,rejection_reason=nullif(left(trim(coalesce(p_comment,'')),500),'')
  where id=v_req.id;
  return jsonb_build_object('ok',true,'status','approved','attendance_id',v_att.id,'penalty_id',v_penalty,
    'delay_minutes',v_att.delay_minutes,'penalty_amount_fcfa',coalesce(v_penalty_amount,0),'access_blocked',v_att.access_blocked);
end;
$$;

revoke all on function public.review_qr_checkin_request(uuid,text,text) from public,anon;
grant execute on function public.review_qr_checkin_request(uuid,text,text) to authenticated;

CREATE OR REPLACE FUNCTION public.qr_checkin(p_checkpoint_id uuid, p_challenge text, p_lat numeric DEFAULT NULL::numeric, p_lng numeric DEFAULT NULL::numeric, p_accuracy_m numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_token uuid;
  v_hash text;
  v_person_type text;
  v_session_id uuid;
  v_att public.attendance%rowtype;
  v_checkpoint public.checkpoints%rowtype;
  v_group_id uuid;
  v_formation_id uuid;
  v_teacher_id uuid;
  v_distance numeric;
  v_anomaly boolean := false;
  v_local_date date := (clock_timestamp() at time zone 'Africa/Porto-Novo')::date;
  v_local_time time := (clock_timestamp() at time zone 'Africa/Porto-Novo')::time;
  v_template record;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_challenge is null or length(p_challenge)<16 then raise exception 'INVALID_CHALLENGE'; end if;

  select * into v_checkpoint from public.checkpoints where id=p_checkpoint_id and active;
  if not found then raise exception 'CHECKPOINT_INACTIVE'; end if;

  v_hash := encode(extensions.digest(convert_to(p_challenge,'utf8'),'sha256'),'hex');
  update public.qr_tokens q set active=false
   where q.checkpoint_id=p_checkpoint_id and q.active=true
     and q.expires_at>clock_timestamp() and q.token_hash=v_hash
   returning q.id into v_token;
  if v_token is null then raise exception 'QR_INVALID_OR_EXPIRED'; end if;

  if exists(select 1 from public.students where id=v_uid) then
    v_person_type := 'student';
    select group_id, formation_id into v_group_id, v_formation_id
    from public.students where id=v_uid;

    -- Use a session already generated for today, including the 30-minute early-arrival window.
    select id into v_session_id
    from public.course_sessions
    where session_date=v_local_date
      and status not in ('cancelled','canceled')
      and planned_start <= (clock_timestamp() + interval '30 minutes')
      and planned_end >= clock_timestamp()
      and (group_id=v_group_id or (group_id is null and v_group_id is null))
      and (formation_id=v_formation_id or formation_id is null)
    order by planned_start asc limit 1;

    -- If no dated session exists, resolve the current session from the student's formation timetable.
    if v_session_id is null and v_formation_id is not null then
      perform pg_advisory_xact_lock(hashtextextended(v_formation_id::text || ':' || v_local_date::text,0));
      select id into v_session_id
      from public.course_sessions
      where session_date=v_local_date
        and status not in ('cancelled','canceled')
        and planned_start <= (clock_timestamp() + interval '30 minutes')
        and planned_end >= clock_timestamp()
        and (group_id=v_group_id or (group_id is null and v_group_id is null))
        and formation_id=v_formation_id
      order by planned_start asc limit 1;

      if v_session_id is null then
        select st.*, s.name as resolved_subject_name
          into v_template
        from public.schedule_templates st
        left join public.subjects s on s.id=st.subject_id
        where st.formation_id=v_formation_id
          and (st.group_id is null or st.group_id=v_group_id)
          and st.weekday=extract(isodow from v_local_date)::integer
          and st.status='active'
          and (st.valid_from is null or st.valid_from<=v_local_date)
          and (st.valid_until is null or st.valid_until>=v_local_date)
          and st.start_time <= (v_local_time + interval '30 minutes')::time
          and st.end_time >= v_local_time
        order by st.start_time asc
        limit 1;

        if found then
          insert into public.course_sessions(
            schedule_template_id,formation_id,group_id,subject_id,session_date,
            planned_start,planned_end,session_type,status
          ) values (
            v_template.id,v_formation_id,coalesce(v_template.group_id,v_group_id),v_template.subject_id,
            v_local_date,
            ((v_local_date + v_template.start_time) at time zone 'Africa/Porto-Novo'),
            ((v_local_date + v_template.end_time) at time zone 'Africa/Porto-Novo'),
            'regular','scheduled'
          ) returning id into v_session_id;
        end if;
      end if;
    end if;
  elsif exists(select 1 from public.teachers where id=v_uid) then
    v_person_type := 'teacher';
    select id into v_teacher_id from public.teachers where id=v_uid;
    select id into v_session_id from public.course_sessions
    where (teacher_id=v_teacher_id or replacement_teacher_id=v_teacher_id)
      and session_date=v_local_date and status not in ('cancelled','canceled')
      and planned_start <= clock_timestamp() and planned_end >= clock_timestamp()
    order by planned_start desc limit 1;
  elsif exists(select 1 from public.staff where id=v_uid) then
    v_person_type := 'staff';
    raise exception 'STAFF_QR_SESSION_REQUIRED';
  else
    raise exception 'PERSON_NOT_REGISTERED';
  end if;

  if v_session_id is null then raise exception 'NO_ACTIVE_SESSION'; end if;

  if p_lat is not null and p_lng is not null and v_checkpoint.latitude is not null and v_checkpoint.longitude is not null then
    v_distance := 6371000 * 2 * asin(sqrt(
      power(sin(radians(p_lat-v_checkpoint.latitude)/2),2)
      + cos(radians(v_checkpoint.latitude))*cos(radians(p_lat))
      * power(sin(radians(p_lng-v_checkpoint.longitude)/2),2)
    ));
    v_anomaly := v_distance > coalesce(v_checkpoint.radius_m,100);
  end if;

  insert into public.attendance(person_id,person_type,session_id,source,checkpoint_id,latitude,longitude,location_accuracy_m,anomaly,anomaly_reason,metadata)
  values(v_uid,v_person_type,v_session_id,'qr',p_checkpoint_id,p_lat,p_lng,p_accuracy_m,v_anomaly,
    case when v_anomaly then 'Position GPS hors rayon du point de contrôle' else null end,
    jsonb_build_object('qr_token_id',v_token,'actor_id',v_uid))
  returning * into v_att;

  return jsonb_build_object('attendance_id',v_att.id,'status',v_att.status,
    'delay_minutes',coalesce(v_att.delay_minutes,0),'access_blocked',v_att.access_blocked,
    'planned_at',v_att.planned_at,'arrived_at',v_att.arrived_at,'anomaly',v_att.anomaly,
    'anomaly_reason',v_att.anomaly_reason,'checkpoint',v_checkpoint.name,'session_id',v_session_id);
end;
$function$


update public.penalty_rules set tolerance_minutes=case when lower(person_type)='staff' then 10 else 15 end where active=true and lower(penalty_type)='late_arrival' and application_mode='automatic';
notify pgrst,'reload schema';