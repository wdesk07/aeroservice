-- TEST ONLY: tie opening/closing of the business day to kiosk token lifecycle.
-- Target project: aero-service-test (nuijzdqnhjzcnqpfqvvl).

create or replace function public.open_operating_day_and_activate_kiosk(p_name text default 'Borne officielle Aéro Service')
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_local timestamp without time zone;
  v_date date;
  v_token text;
  v_device_id uuid;
  v_name text := left(trim(coalesce(p_name, 'Borne officielle Aéro Service')), 80);
  v_day public.operating_days%rowtype;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN']::text[]) then raise exception 'KIOSK_ADMIN_REQUIRED'; end if;
  if v_name = '' then v_name := 'Borne officielle Aéro Service'; end if;
  v_local := v_now at time zone 'Africa/Porto-Novo';
  v_date := v_local::date;

  select * into v_day from public.operating_days where business_date=v_date for update;
  if found and v_day.status='closed' and v_day.closed_at is not null then raise exception 'OPERATING_DAY_ALREADY_CLOSED'; end if;

  -- One official kiosk at a time: rotate and invalidate stale test-device tokens.
  update public.presence_kiosk_devices set revoked_at=v_now where revoked_at is null;
  v_token := encode(extensions.gen_random_bytes(32),'hex');
  insert into public.presence_kiosk_devices(name,token_hash,activated_by)
  values(v_name,encode(extensions.digest(convert_to(v_token,'UTF8'),'sha256'),'hex'),v_uid)
  returning id into v_device_id;

  insert into public.operating_days(business_date,status,opened_at,opened_by,closed_at,closed_by,updated_at)
  values(v_date,'open',v_now,v_uid,null,null,v_now)
  on conflict (business_date) do update
    set status='open',
        opened_at=coalesce(public.operating_days.opened_at,excluded.opened_at),
        opened_by=coalesce(public.operating_days.opened_by,excluded.opened_by),
        closed_at=null,closed_by=null,updated_at=v_now;

  return jsonb_build_object('ok',true,'opened',true,'business_date',v_date,'status','open',
    'device_id',v_device_id,'device_name',v_name,'device_token',v_token,'opened_at',v_now,'timezone','Africa/Porto-Novo');
end;
$function$;

create or replace function public.close_operating_day_and_revoke_kiosk(p_device_id uuid default null)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_local timestamp without time zone;
  v_date date;
  v_day public.operating_days%rowtype;
  v_revoked integer := 0;
  v_absences jsonb := null;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN']::text[]) then raise exception 'KIOSK_ADMIN_REQUIRED'; end if;
  v_local := v_now at time zone 'Africa/Porto-Novo';
  v_date := v_local::date;
  select * into v_day from public.operating_days where business_date=v_date for update;
  if not found or v_day.status <> 'open' then raise exception 'OPERATING_DAY_NOT_OPEN'; end if;

  if v_local::time >= time '19:00' then v_absences := public.close_daily_student_absences(); end if;

  update public.operating_days set status='closed',closed_at=v_now,closed_by=v_uid,updated_at=v_now
   where business_date=v_date;
  update public.presence_kiosk_devices set revoked_at=v_now where revoked_at is null;
  get diagnostics v_revoked = row_count;

  return jsonb_build_object('ok',true,'closed',true,'business_date',v_date,'status','closed',
    'closed_at',v_now,'devices_revoked',v_revoked,'absences',v_absences,'timezone','Africa/Porto-Novo');
end;
$function$;

revoke all on function public.open_operating_day_and_activate_kiosk(text) from public, anon;
grant execute on function public.open_operating_day_and_activate_kiosk(text) to authenticated;
revoke all on function public.close_operating_day_and_revoke_kiosk(uuid) from public, anon;
grant execute on function public.close_operating_day_and_revoke_kiosk(uuid) to authenticated;

create or replace function public.get_public_operating_day_status()
returns text
language sql
security definer
set search_path = ''
as $function$
  select coalesce((
    select od.status from public.operating_days od
    where od.business_date=(clock_timestamp() at time zone 'Africa/Porto-Novo')::date
    limit 1
  ), 'not_opened');
$function$;

revoke all on function public.get_public_operating_day_status() from public;
grant execute on function public.get_public_operating_day_status() to anon, authenticated;

create or replace function public.is_presence_kiosk_active(p_device_token text)
returns boolean
language sql
security definer
set search_path = ''
as $function$
  select coalesce(
    p_device_token is not null
    and length(p_device_token) >= 40
    and exists (
      select 1 from public.presence_kiosk_devices d
      where d.token_hash=encode(extensions.digest(convert_to(p_device_token,'UTF8'),'sha256'),'hex')
        and d.revoked_at is null
    )
    and exists (
      select 1 from public.operating_days od
      where od.business_date=(clock_timestamp() at time zone 'Africa/Porto-Novo')::date
        and od.status='open'
    ), false
  );
$function$;

revoke all on function public.is_presence_kiosk_active(text) from public;
grant execute on function public.is_presence_kiosk_active(text) to anon, authenticated;

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
 if not exists(select 1 from public.operating_days od where od.business_date=dt and od.status='open') then raise exception 'OPERATING_DAY_CLOSED'; end if;
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

 if loc::time>=time '19:00' then raise exception 'STUDENT_CHECKIN_CLOSED'; end if;
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

-- Approved justifications regularize the exact linked absence, not merely the request date.
CREATE OR REPLACE FUNCTION public.review_absence_justification(p_justification_id uuid, p_decision text, p_comment text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := auth.uid();
  v_row public.absence_justifications%rowtype;
  v_now timestamptz := clock_timestamp();
  v_attendance_id uuid;
begin
  if v_user is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;

  if not public.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN']::text[]) then
    raise exception 'ADMIN_REVIEW_REQUIRED';
  end if;

  if lower(coalesce(p_decision,'')) not in ('approved','rejected') then
    raise exception 'INVALID_JUSTIFICATION_DECISION';
  end if;

  select * into v_row
  from public.absence_justifications
  where id = p_justification_id
  for update;

  if not found then raise exception 'JUSTIFICATION_NOT_FOUND'; end if;
  if v_row.status <> 'pending' then raise exception 'JUSTIFICATION_ALREADY_REVIEWED'; end if;

  update public.absence_justifications
    set status = lower(p_decision),
        reviewed_by = v_user,
        reviewed_at = v_now,
        review_comment = nullif(trim(coalesce(p_comment,'')),'')
    where id = p_justification_id
    returning * into v_row;

  if lower(p_decision) = 'approved' then
    if v_row.attendance_id is not null then
      update public.daily_attendance
        set status = 'regularized'
        where id = v_row.attendance_id
          and person_id = v_row.person_id
          and status = 'absent'
        returning id into v_attendance_id;
    else
      -- If no absence row existed when the learner submitted the request,
      -- regularize a same-day absence if closure created one later.
      update public.daily_attendance
        set status = 'regularized'
        where person_id = v_row.person_id
          and local_date = (v_row.submitted_at at time zone 'Africa/Porto-Novo')::date
          and status = 'absent'
        returning id into v_attendance_id;
    end if;

    insert into public.attendance_events(
      attendance_id, person_id, event_type, occurred_at, source, metadata, created_by
    ) values (
      null, v_row.person_id, 'regularized', v_now, 'absence_justification_review',
      jsonb_build_object(
        'justification_id',v_row.id,
        'decision','approved',
        'daily_attendance_id',v_attendance_id,
        'review_comment',v_row.review_comment,
        'previous_status','absent'
      ), v_user
    );
  end if;

  insert into public.notifications(
    recipient_id, channel, type, title, body, data, status, created_at
  ) values (
    v_row.person_id, 'in_app', 'absence_justification_result',
    case when lower(p_decision) = 'approved' then 'Justification d’absence approuvée' else 'Justification d’absence refusée' end,
    case when lower(p_decision) = 'approved'
      then 'La Direction a approuvé votre justification d’absence.'
      else 'La Direction a refusé votre justification d’absence. Consultez le commentaire ou contactez le secrétariat.'
    end,
    jsonb_build_object('justification_id',v_row.id,'decision',lower(p_decision),'comment',v_row.review_comment),
    'pending', v_now
  );

  return jsonb_build_object(
    'ok',true,'justification_id',v_row.id,'status',v_row.status,
    'reviewed_at',v_row.reviewed_at,'daily_attendance_regularized',v_attendance_id is not null
  );
end;
$function$;

-- pg_cron is GMT on TEST; Benin is GMT+1.
do $schedule$
begin
  if not exists(select 1 from cron.job where jobname='aero-operating-day-opening-reminder') then
    perform cron.schedule('aero-operating-day-opening-reminder','35 7 * * *',
      $$select public.notify_operating_day_attention('opening');$$);
  end if;
  if not exists(select 1 from cron.job where jobname='aero-operating-day-closing-reminder') then
    perform cron.schedule('aero-operating-day-closing-reminder','35 19 * * *',
      $$select public.notify_operating_day_attention('closing');$$);
  end if;
  if not exists(select 1 from cron.job where jobname='aero-daily-student-absence-closure') then
    perform cron.schedule('aero-daily-student-absence-closure','5 18 * * *',
      $$select public.close_daily_student_absences()
        where exists (select 1 from public.operating_days
          where business_date=(now() at time zone 'Africa/Porto-Novo')::date and status='open');$$);
  end if;
end;
$schedule$;
