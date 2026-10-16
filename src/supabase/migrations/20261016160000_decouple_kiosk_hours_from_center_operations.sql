-- TEST ONLY: decouple kiosk hours from the administrative opening/closing of Aéro Service.
-- Kiosk availability is automatic 08:30-19:00 Africa/Porto-Novo.
-- Center operations are manual and audited separately.

create table if not exists public.center_operation_audit (
  id uuid primary key default gen_random_uuid(),
  business_date date not null,
  action text not null check (action in ('opened','closed')),
  actor_id uuid not null references auth.users(id),
  occurred_at timestamptz not null default clock_timestamp(),
  timezone text not null default 'Africa/Porto-Novo',
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists center_operation_audit_date_idx
  on public.center_operation_audit (business_date desc, occurred_at desc);
alter table public.center_operation_audit enable row level security;
revoke all on public.center_operation_audit from anon, authenticated;

create or replace function public.open_aero_center()
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_local timestamp without time zone;
  v_date date;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN','SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE','STAFF','PERSONNEL']::text[]) then
    raise exception 'CENTER_OPERATION_NOT_ALLOWED';
  end if;
  v_local := v_now at time zone 'Africa/Porto-Novo';
  v_date := v_local::date;
  insert into public.operating_days(business_date,status,opened_at,opened_by,closed_at,closed_by,updated_at)
  values(v_date,'open',v_now,v_uid,null,null,v_now)
  on conflict (business_date) do update set
    status='open', opened_at=v_now, opened_by=v_uid,
    closed_at=null, closed_by=null, updated_at=v_now;
  insert into public.center_operation_audit(business_date,action,actor_id,occurred_at)
  values(v_date,'opened',v_uid,v_now);
  return jsonb_build_object('ok',true,'status','open','business_date',v_date,'occurred_at',v_now,'timezone','Africa/Porto-Novo');
end;
$function$;

create or replace function public.close_aero_center()
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_local timestamp without time zone;
  v_date date;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN','SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE','STAFF','PERSONNEL']::text[]) then
    raise exception 'CENTER_OPERATION_NOT_ALLOWED';
  end if;
  v_local := v_now at time zone 'Africa/Porto-Novo';
  v_date := v_local::date;
  update public.operating_days set status='closed',closed_at=v_now,closed_by=v_uid,updated_at=v_now
   where business_date=v_date and status='open';
  if not found then raise exception 'CENTER_NOT_OPEN'; end if;
  insert into public.center_operation_audit(business_date,action,actor_id,occurred_at)
  values(v_date,'closed',v_uid,v_now);
  return jsonb_build_object('ok',true,'status','closed','business_date',v_date,'occurred_at',v_now,'timezone','Africa/Porto-Novo');
end;
$function$;

create or replace function public.get_center_operation_audit(p_limit integer default 50)
returns table(id uuid,business_date date,action text,actor_id uuid,actor_email text,occurred_at timestamptz)
language plpgsql security definer set search_path = ''
as $function$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN']::text[]) then raise exception 'CENTER_AUDIT_DIRECTOR_ONLY'; end if;
  return query
    select a.id,a.business_date,a.action,a.actor_id,u.email,a.occurred_at
    from public.center_operation_audit a
    left join auth.users u on u.id=a.actor_id
    order by a.occurred_at desc
    limit greatest(1,least(coalesce(p_limit,50),200));
end;
$function$;

revoke all on function public.open_aero_center() from public, anon;
revoke all on function public.close_aero_center() from public, anon;
revoke all on function public.get_center_operation_audit(integer) from public, anon;
grant execute on function public.open_aero_center() to authenticated;
grant execute on function public.close_aero_center() to authenticated;
grant execute on function public.get_center_operation_audit(integer) to authenticated;

-- The registered kiosk token remains valid independently of center status.
create or replace function public.is_presence_kiosk_active(p_device_token text)
returns boolean language sql security definer set search_path = ''
as $function$
  select coalesce(
    p_device_token is not null
    and length(p_device_token) >= 40
    and (clock_timestamp() at time zone 'Africa/Porto-Novo')::time >= time '08:30'
    and (clock_timestamp() at time zone 'Africa/Porto-Novo')::time < time '19:00'
    and exists (
      select 1 from public.presence_kiosk_devices d
      where d.token_hash=encode(extensions.digest(convert_to(p_device_token,'UTF8'),'sha256'),'hex')
        and d.revoked_at is null
    ), false
  );
$function$;
revoke all on function public.is_presence_kiosk_active(text) from public;
grant execute on function public.is_presence_kiosk_active(text) to anon, authenticated;

-- Preserve the existing session/penalty logic, but remove the dependency on the
-- center's manual operating_days status. The 08:30-19:00 kiosk window is authoritative.

-- Registered status is distinct from availability at the current time.
create or replace function public.is_presence_kiosk_registered(p_device_token text)
returns boolean language sql security definer set search_path = ''
as $function$
  select coalesce(p_device_token is not null and length(p_device_token)>=40 and exists(
    select 1 from public.presence_kiosk_devices d
    where d.token_hash=encode(extensions.digest(convert_to(p_device_token,'UTF8'),'sha256'),'hex')
      and d.revoked_at is null
  ),false);
$function$;
revoke all on function public.is_presence_kiosk_registered(text) from public;
grant execute on function public.is_presence_kiosk_registered(text) to anon, authenticated;

CREATE OR REPLACE FUNCTION public.kiosk_daily_checkin(p_device_token text, p_lat numeric DEFAULT NULL::numeric, p_lng numeric DEFAULT NULL::numeric, p_accuracy_m numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 u uuid := auth.uid();
 d public.presence_kiosk_devices%rowtype;
 st public.students%rowtype;
 cs public.course_sessions%rowtype;
 pr public.penalty_rules%rowtype;
 n timestamptz := clock_timestamp();
 loc timestamp without time zone;
 dt date;
 nom time;
 cut time;
 cp public.checkpoints%rowtype;
 dist numeric;
 stat text;
 mins integer;
 att public.daily_attendance%rowtype;
 ins boolean := false;
 has_rule boolean := false;
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 if p_device_token is null or length(p_device_token)<40 then raise exception 'KIOSK_NOT_REGISTERED'; end if;
 select * into d from public.presence_kiosk_devices
 where token_hash=encode(extensions.digest(convert_to(p_device_token,'UTF8'),'sha256'),'hex')
 and revoked_at is null;
 if not found then raise exception 'KIOSK_NOT_REGISTERED'; end if;
 select s.* into st from public.students s join public.profiles p on p.id=s.id
 where s.id=u and lower(coalesce(p.status,'active'))='active';
 if not found then raise exception 'ACTIVE_STUDENT_REQUIRED'; end if;
 if p_lat is not null and p_lng is not null and p_accuracy_m is not null
    and p_lat between -90 and 90 and p_lng between -180 and 180
    and p_accuracy_m>0 and p_accuracy_m<=50 then
  select * into cp from public.checkpoints
  where active and latitude is not null and longitude is not null and radius_m>0
  order by created_at desc limit 1;
  if found then
   dist:=6371000*2*asin(sqrt(power(sin(radians(p_lat-cp.latitude)/2),2)
     +cos(radians(cp.latitude))*cos(radians(p_lat))
     *power(sin(radians(p_lng-cp.longitude)/2),2)));
   if dist>cp.radius_m or p_accuracy_m>cp.radius_m then
    raise exception 'OUTSIDE_CHECKPOINT_RADIUS';
   end if;
  end if;
 end if;
 loc:=n at time zone 'Africa/Porto-Novo';
 dt:=loc::date;
 -- Center opening is tracked separately; kiosk availability is governed by the clock window below.
 select c.* into cs from public.course_sessions c
 where c.session_date=dt
 and lower(coalesce(c.status,'')) not in ('cancelled','canceled','annule','annulée','annulee')
 and (c.group_id=st.group_id or (c.group_id is null and c.formation_id=st.formation_id))
 order by case when loc::time between c.planned_start and c.planned_end then 0
               when loc::time<c.planned_start then 1 else 2 end,
 case when c.planned_start>loc::time then c.planned_start end asc nulls last,
 case when c.planned_start<=loc::time then c.planned_start end desc nulls last
 limit 1;
 if not found then raise exception 'NO_TRAINING_SESSION_SCHEDULED_TODAY'; end if;
 nom:=cs.planned_start;

 -- Prefer an active automatic rule for this formation; use a general rule only as fallback.
 select r.* into pr from public.penalty_rules r
 where r.active=true
   and r.application_mode='automatic'
   and r.penalty_type='late_arrival'
   and (r.person_type='student' or r.target_scope in ('all','students'))
   and r.target_scope in ('all','students')
   and (r.formation_id=cs.formation_id or r.formation_id is null)
   and (r.effective_from is null or r.effective_from<=n)
   and (r.effective_until is null or r.effective_until>=n)
 order by (r.formation_id is not null) desc, r.priority asc, r.created_at desc
 limit 1;
 has_rule:=found;

 -- A configured cutoff wins. Otherwise use the configured tolerance from the session start.
 -- Keep the existing 15-minute default only when no automatic rule exists for this formation.
 if has_rule then
   cut:=coalesce(pr.applies_after_time,
     (cs.planned_start + make_interval(mins=>coalesce(pr.tolerance_minutes,0)))::time);
 else
   cut:=(cs.planned_start+interval '15 minutes')::time;
 end if;

 if loc::time < time '08:30' or loc::time >= time '19:00' then raise exception 'STUDENT_CHECKIN_CLOSED'; end if;
 stat:=case when loc::time<=cut then 'on_time' else 'late' end;
 mins:=case when stat='on_time' then 0
            else greatest(0,floor(extract(epoch from(loc::time-cut))/60)::integer) end;
 insert into public.daily_attendance(
   person_id,local_date,person_type,nominal_time,cutoff_time,arrived_at,status,
   minutes_after_cutoff,checkpoint_id,latitude,longitude,location_accuracy_m
 )
 values(u,dt,'student',nom,cut,n,stat,mins,cp.id,p_lat,p_lng,p_accuracy_m)
 on conflict(person_id,local_date) do nothing returning * into att;
 ins:=found;
 update public.presence_kiosk_devices set last_used_at=n where id=d.id;
 if not ins then
  select * into att from public.daily_attendance where person_id=u and local_date=dt;
  return jsonb_build_object('ok',true,'duplicate',true,'status',att.status,
    'arrived_at',att.arrived_at,'nominal_time',att.nominal_time,
    'cutoff_time',att.cutoff_time,'minutes_after_cutoff',att.minutes_after_cutoff);
 end if;
 insert into public.attendance_events(
   attendance_id,person_id,event_type,occurred_at,source,metadata,created_by
 )
 values(null,u,'daily_qr_checkin',n,'registered_kiosk',
   jsonb_build_object('daily_attendance_id',att.id,'local_date',dt,'status',stat,
     'minutes_after_cutoff',mins,'kiosk_device_id',d.id,'session_id',cs.id,
     'formation_id',cs.formation_id,'group_id',cs.group_id,'planned_start',nom,
     'cutoff_time',cut,'penalty_rule_id',case when has_rule then pr.id else null end,
     'gps_checked',dist is not null,'distance_m',case when dist is null then null else round(dist) end,
     'accuracy_m',p_accuracy_m),u);
 if stat='late' then
  insert into public.notifications(recipient_id,channel,type,title,body,data,status)
  select distinct ur.user_id,'in_app','attendance_late','Alerte de retard — apprenant',
    format('Un apprenant est arrivé en retard le %s à %s (%s minute(s) après l’heure limite).',
      to_char(dt,'DD/MM/YYYY'),to_char(loc::time,'HH24:MI'),mins),
    jsonb_build_object('person_id',u,'daily_attendance_id',att.id,'local_date',dt,
      'status',stat,'minutes_after_cutoff',mins),'pending'
  from public.user_roles ur join public.roles r on r.id=ur.role_id
  where upper(r.code) in ('SECRETARIAT','SECRETARY','DIRECTOR','ADMIN','PRE_ADMIN')
    and ur.user_id<>u;
 end if;
 return jsonb_build_object('ok',true,'duplicate',false,'status',stat,'arrived_at',n,
   'nominal_time',nom,'cutoff_time',cut,'minutes_after_cutoff',mins,
   'checkpoint',d.name,'session_id',cs.id,'formation_id',cs.formation_id,'group_id',cs.group_id,
   'penalty_rule_id',case when has_rule then pr.id else null end);
end;
$function$;
