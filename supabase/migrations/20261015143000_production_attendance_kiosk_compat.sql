-- Production-compatible attendance kiosk foundation.
-- This migration targets the legacy production schema (public.attendance), not daily_attendance.
-- Keep the production schema compatible with the Director's formation-aware penalty editor.
alter table public.penalty_rules
  add column if not exists formation_id uuid references public.formations(id) on delete set null,
  add column if not exists target_scope text,
  add column if not exists application_mode text,
  add column if not exists applies_after_time time without time zone;

update public.penalty_rules
set target_scope = case
  when lower(coalesce(person_type,'')) in ('all') then 'all'
  when lower(coalesce(person_type,'')) in ('staff','personnel') then 'staff'
  when lower(coalesce(person_type,'')) in ('teacher','enseignant') then 'teacher'
  else 'students'
end
where target_scope is null;

update public.penalty_rules
set application_mode = case when lower(coalesce(penalty_type,''))='late_arrival' then 'automatic' else 'manual' end
where application_mode is null;

alter table public.penalty_rules alter column target_scope set default 'students';
alter table public.penalty_rules alter column target_scope set not null;
alter table public.penalty_rules alter column application_mode set default 'automatic';
alter table public.penalty_rules alter column application_mode set not null;

do $migration$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.penalty_rules'::regclass and conname='penalty_rules_target_scope_check') then
    alter table public.penalty_rules add constraint penalty_rules_target_scope_check check (target_scope in ('all','students','staff','teacher'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.penalty_rules'::regclass and conname='penalty_rules_application_mode_check') then
    alter table public.penalty_rules add constraint penalty_rules_application_mode_check check (application_mode in ('automatic','manual'));
  end if;
end;
$migration$;

-- A late-arrival rule never grants a hidden grace period.
update public.penalty_rules set tolerance_minutes=0
where active=true and lower(coalesce(penalty_type,''))='late_arrival';

create table if not exists public.operating_days (
  business_date date primary key,
  status text not null check (status in ('open','closed')),
  opened_at timestamptz,
  opened_by uuid references public.profiles(id),
  closed_at timestamptz,
  closed_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.presence_kiosk_devices (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  token_hash text not null unique,
  activated_by uuid not null references public.profiles(id),
  activated_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

alter table public.operating_days enable row level security;
alter table public.presence_kiosk_devices enable row level security;
revoke all on public.operating_days, public.presence_kiosk_devices from anon, authenticated;

create or replace function public.kiosk_actor_has_role(p_roles text[])
returns boolean
language sql stable security definer set search_path = ''
as $$
 select exists (
   select 1
   from public.user_roles ur
   join public.roles r on r.id = ur.role_id
   where ur.user_id = auth.uid() and upper(r.code) = any(p_roles)
 );
$$;
revoke all on function public.kiosk_actor_has_role(text[]) from public, anon;
grant execute on function public.kiosk_actor_has_role(text[]) to authenticated;

create or replace function public.get_public_operating_day_status()
returns text language sql stable security definer set search_path = ''
as $$
 select coalesce((
   select od.status from public.operating_days od
   where od.business_date = (clock_timestamp() at time zone 'Africa/Porto-Novo')::date
 ), 'not_opened');
$$;
revoke all on function public.get_public_operating_day_status() from public;
grant execute on function public.get_public_operating_day_status() to anon, authenticated;

create or replace function public.open_operating_day_and_activate_kiosk(p_name text default 'Borne officielle Aéro Service')
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
 v_uid uuid := auth.uid();
 v_now timestamptz := clock_timestamp();
 v_date date := (clock_timestamp() at time zone 'Africa/Porto-Novo')::date;
 v_token text;
 v_device uuid;
 v_status text;
begin
 if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
 if not public.kiosk_actor_has_role(array['DIRECTOR','ADMIN','PRE_ADMIN','SECRETARIAT','SECRETARY']) then raise exception 'KIOSK_ADMIN_REQUIRED'; end if;
 select status into v_status from public.operating_days where business_date=v_date for update;
 if v_status='closed' then raise exception 'OPERATING_DAY_ALREADY_CLOSED'; end if;
 update public.presence_kiosk_devices set revoked_at=v_now where revoked_at is null;
 v_token := encode(extensions.gen_random_bytes(32),'hex');
 insert into public.presence_kiosk_devices(name,token_hash,activated_by)
 values(left(coalesce(nullif(trim(p_name),''),'Borne officielle Aéro Service'),80),
        encode(extensions.digest(convert_to(v_token,'UTF8'),'sha256'),'hex'),v_uid)
 returning id into v_device;
 insert into public.operating_days(business_date,status,opened_at,opened_by,updated_at)
 values(v_date,'open',v_now,v_uid,v_now)
 on conflict (business_date) do update set status='open',
   opened_at=coalesce(public.operating_days.opened_at,excluded.opened_at),
   opened_by=coalesce(public.operating_days.opened_by,excluded.opened_by),
   closed_at=null,closed_by=null,updated_at=v_now;
 return jsonb_build_object('ok',true,'opened',true,'business_date',v_date,'status','open',
   'device_id',v_device,'device_token',v_token,'opened_at',v_now,'timezone','Africa/Porto-Novo');
end;
$$;

create or replace function public.close_operating_day_and_revoke_kiosk(p_device_id uuid default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
 v_uid uuid := auth.uid();
 v_now timestamptz := clock_timestamp();
 v_date date := (clock_timestamp() at time zone 'Africa/Porto-Novo')::date;
 v_local timestamp without time zone := clock_timestamp() at time zone 'Africa/Porto-Novo';
 v_status text;
 v_revoked integer;
 v_absences integer := 0;
begin
 if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
 if not public.kiosk_actor_has_role(array['DIRECTOR','ADMIN','PRE_ADMIN','SECRETARIAT','SECRETARY']) then raise exception 'KIOSK_ADMIN_REQUIRED'; end if;
 select status into v_status from public.operating_days where business_date=v_date for update;
 if v_status is distinct from 'open' then raise exception 'OPERATING_DAY_NOT_OPEN'; end if;
 if v_local::time >= time '19:00' then
   with missing_sessions as (
     select cs.id as session_id, st.id as person_id, cs.planned_start
     from public.course_sessions cs
     join public.students st on (cs.group_id=st.group_id or (cs.group_id is null and cs.formation_id=st.formation_id))
     join public.profiles p on p.id=st.id and p.status='active'
     where cs.session_date=v_date and cs.planned_end<=v_now
       and lower(coalesce(cs.status,'')) not in ('cancelled','canceled','annule','annulée','annulee')
       and not exists (
         select 1 from public.attendance a
         where a.session_id=cs.id and a.person_id=st.id and lower(a.person_type)='student'
       )
   ), created_absences as (
     insert into public.attendance(session_id,person_id,person_type,status,planned_at,access_blocked,source)
     select ms.session_id,ms.person_id,'student','absent',ms.planned_start,false,'kiosk'
     from missing_sessions ms
     returning id,person_id
   )
   insert into public.attendance_events(attendance_id,person_id,event_type,occurred_at,source,metadata,created_by)
   select ca.id,ca.person_id,'absence_detected',v_now,'kiosk',
     jsonb_build_object('business_date',v_date),v_uid
   from created_absences ca;
   get diagnostics v_absences = row_count;
 end if;
 update public.operating_days set status='closed',closed_at=v_now,closed_by=v_uid,updated_at=v_now where business_date=v_date;
 update public.presence_kiosk_devices set revoked_at=v_now where revoked_at is null;
 get diagnostics v_revoked = row_count;
 return jsonb_build_object('ok',true,'closed',true,'business_date',v_date,'status','closed','closed_at',v_now,'devices_revoked',v_revoked,'absences_created',v_absences);
end;
$$;

create or replace function public.is_presence_kiosk_active(p_device_token text)
returns boolean language sql stable security definer set search_path = ''
as $$
 select coalesce(
   p_device_token is not null and length(p_device_token)>=40
   and exists(select 1 from public.presence_kiosk_devices d
     where d.token_hash=encode(extensions.digest(convert_to(p_device_token,'UTF8'),'sha256'),'hex') and d.revoked_at is null)
   and exists(select 1 from public.operating_days od
     where od.business_date=(clock_timestamp() at time zone 'Africa/Porto-Novo')::date and od.status='open'),
 false);
$$;
revoke all on function public.is_presence_kiosk_active(text) from public;
grant execute on function public.is_presence_kiosk_active(text) to anon, authenticated;
revoke all on function public.open_operating_day_and_activate_kiosk(text) from public, anon;
grant execute on function public.open_operating_day_and_activate_kiosk(text) to authenticated;
revoke all on function public.close_operating_day_and_revoke_kiosk(uuid) from public, anon;
grant execute on function public.close_operating_day_and_revoke_kiosk(uuid) to authenticated;

-- Check-in uses the production attendance/session/rule schema. A student can only record their own presence.
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
 if not exists(select 1 from public.operating_days od where od.business_date=v_date and od.status='open') then raise exception 'OPERATING_DAY_CLOSED'; end if;
 if v_local::time >= time '19:00' then raise exception 'STUDENT_CHECKIN_CLOSED'; end if;
 select * into v_session from public.course_sessions c
 where c.session_date=v_date
 and lower(coalesce(c.status,'')) not in ('cancelled','canceled','annule','annulée','annulee')
 and (c.group_id=v_student.group_id or (c.group_id is null and c.formation_id=v_student.formation_id))
 order by case when v_local between (c.planned_start at time zone 'Africa/Porto-Novo') and (c.planned_end at time zone 'Africa/Porto-Novo') then 0
               when v_local < (c.planned_start at time zone 'Africa/Porto-Novo') then 1 else 2 end,
 c.planned_start asc limit 1;
 if not found then raise exception 'NO_TRAINING_SESSION_SCHEDULED_TODAY'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || v_session.id::text,0));
 select * into v_att from public.attendance a where a.person_id=v_uid and a.session_id=v_session.id
 and a.person_type in ('student','STUDENT') order by a.created_at desc limit 1;
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
 if v_delay>0 and v_has_rule and v_rule.amount_fcfa>0
    and v_delay>=v_rule.min_delay_minutes
    and (v_rule.max_delay_minutes is null or v_delay<=v_rule.max_delay_minutes) then
   insert into public.penalties(attendance_id,person_id,rule_id,amount_fcfa,status,calculated_at,penalty_type,description)
   values(v_att.id,v_uid,v_rule.id,v_rule.amount_fcfa,'pending',v_now,'late_arrival',coalesce(v_rule.description,'Retard à une séance de formation'))
   returning id into v_penalty;
 end if;
 update public.presence_kiosk_devices set last_used_at=v_now where id=v_device.id;
 return jsonb_build_object('ok',true,'duplicate',false,'status',v_att.status,'arrived_at',v_now,
   'delay_minutes',v_delay,'penalty_id',v_penalty,'penalty_amount_fcfa',case when v_penalty is not null then v_rule.amount_fcfa else 0 end);
end;
$$;

revoke all on function public.kiosk_daily_checkin(text,numeric,numeric,numeric) from public, anon;
grant execute on function public.kiosk_daily_checkin(text,numeric,numeric,numeric) to authenticated;


-- Failed kiosk logins are rate-limited by identifier over a rolling 15-minute window.
create table if not exists public.kiosk_auth_attempts (
  id bigint generated always as identity primary key,
  identifier_hash text not null,
  success boolean not null default false,
  attempted_at timestamptz not null default now()
);
create index if not exists kiosk_auth_attempts_identifier_time_idx
  on public.kiosk_auth_attempts(identifier_hash, attempted_at desc);
alter table public.kiosk_auth_attempts enable row level security;
revoke all on public.kiosk_auth_attempts from anon, authenticated;
grant select, insert on public.kiosk_auth_attempts to service_role;
grant usage, select on sequence public.kiosk_auth_attempts_id_seq to service_role;


-- Absence justification workflow uses the existing production tables and does not rewrite attendance records.
create or replace function public.submit_absence_justification(
 p_attendance_id uuid, p_reason_type text, p_reason text, p_document_url text default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
 v_uid uuid := auth.uid();
 v_att public.attendance%rowtype;
 v_id uuid;
begin
 if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
 if nullif(trim(coalesce(p_reason_type,'')),'') is null then raise exception 'JUSTIFICATION_REASON_REQUIRED'; end if;
 if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'JUSTIFICATION_DETAILS_REQUIRED'; end if;
 select * into v_att from public.attendance a
 where a.id=p_attendance_id and a.person_id=v_uid
 and lower(a.status) in ('absent','absence','missing');
 if not found then raise exception 'ABSENCE_RECORD_NOT_FOUND'; end if;
 if exists(select 1 from public.absence_justifications j
   where j.attendance_id=p_attendance_id and j.status='pending') then
   raise exception 'JUSTIFICATION_ALREADY_PENDING';
 end if;
 insert into public.absence_justifications(attendance_id,person_id,reason_type,reason,document_url,status)
 values(p_attendance_id,v_uid,left(trim(p_reason_type),80),left(trim(p_reason),3000),nullif(trim(p_document_url),''),'pending')
 returning id into v_id;
 return jsonb_build_object('ok',true,'id',v_id,'status','pending');
end;
$$;
revoke all on function public.submit_absence_justification(uuid,text,text,text) from public, anon;
grant execute on function public.submit_absence_justification(uuid,text,text,text) to authenticated;

create or replace function public.review_absence_justification(
 p_justification_id uuid, p_decision text, p_comment text default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
 v_uid uuid := auth.uid();
 v_status text;
begin
 if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
 if not public.kiosk_actor_has_role(array['DIRECTOR','ADMIN','PRE_ADMIN','SECRETARIAT','SECRETARY']) then
   raise exception 'JUSTIFICATION_REVIEW_FORBIDDEN';
 end if;
 if p_decision not in ('approved','rejected') then raise exception 'INVALID_JUSTIFICATION_DECISION'; end if;
 update public.absence_justifications
 set status=p_decision,reviewed_by=v_uid,reviewed_at=clock_timestamp(),
     review_comment=nullif(left(trim(coalesce(p_comment,'')),2000),'')
 where id=p_justification_id and status='pending'
 returning status into v_status;
 if not found then raise exception 'PENDING_JUSTIFICATION_NOT_FOUND'; end if;
 return jsonb_build_object('ok',true,'status',v_status,'reviewed_at',clock_timestamp());
end;
$$;
revoke all on function public.review_absence_justification(uuid,text,text) from public, anon;
grant execute on function public.review_absence_justification(uuid,text,text) to authenticated;


create or replace function public.list_absence_justifications()
returns setof public.absence_justifications
language sql stable security definer set search_path = ''
as $$
 select j.* from public.absence_justifications j
 where j.person_id=auth.uid()
    or public.kiosk_actor_has_role(array['DIRECTOR','ADMIN','PRE_ADMIN','SECRETARIAT','SECRETARY'])
 order by j.submitted_at desc
 limit 300;
$$;
revoke all on function public.list_absence_justifications() from public, anon;
grant execute on function public.list_absence_justifications() to authenticated;

create or replace function public.list_my_absence_candidates()
returns table(id uuid, session_id uuid, planned_at timestamptz, status text)
language sql stable security definer set search_path = ''
as $$
 select a.id,a.session_id,a.planned_at,a.status
 from public.attendance a
 where a.person_id=auth.uid() and lower(a.status) in ('absent','absence','missing')
 order by a.planned_at desc nulls last
 limit 100;
$$;
revoke all on function public.list_my_absence_candidates() from public, anon;
grant execute on function public.list_my_absence_candidates() to authenticated;
