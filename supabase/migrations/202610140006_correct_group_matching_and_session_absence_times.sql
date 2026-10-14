-- Keep test-validated QR attendance and absence closure definitions in version control.
CREATE OR REPLACE FUNCTION public.kiosk_daily_checkin(p_device_token text, p_lat numeric DEFAULT NULL::numeric, p_lng numeric DEFAULT NULL::numeric, p_accuracy_m numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 u uuid:=auth.uid(); d public.presence_kiosk_devices%rowtype; st public.students%rowtype;
 cs public.course_sessions%rowtype; n timestamptz:=clock_timestamp(); loc timestamp without time zone;
 dt date; nom time; cut time; cp public.checkpoints%rowtype; dist numeric; stat text; mins integer;
 att public.daily_attendance%rowtype; ins boolean:=false;
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 if p_device_token is null or length(p_device_token)<40 then raise exception 'KIOSK_NOT_REGISTERED'; end if;
 select * into d from public.presence_kiosk_devices where token_hash=encode(extensions.digest(convert_to(p_device_token,'UTF8'),'sha256'),'hex') and revoked_at is null;
 if not found then raise exception 'KIOSK_NOT_REGISTERED'; end if;
 select s.* into st from public.students s join public.profiles p on p.id=s.id where s.id=u and lower(coalesce(p.status,'active'))='active';
 if not found then raise exception 'ACTIVE_STUDENT_REQUIRED'; end if;
 if p_lat is not null and p_lng is not null and p_accuracy_m is not null and p_lat between -90 and 90 and p_lng between -180 and 180 and p_accuracy_m>0 and p_accuracy_m<=50 then
  select * into cp from public.checkpoints where active and latitude is not null and longitude is not null and radius_m>0 order by created_at desc limit 1;
  if found then
   dist:=6371000*2*asin(sqrt(power(sin(radians(p_lat-cp.latitude)/2),2)+cos(radians(cp.latitude))*cos(radians(p_lat))*power(sin(radians(p_lng-cp.longitude)/2),2)));
   if dist>cp.radius_m or p_accuracy_m>cp.radius_m then raise exception 'OUTSIDE_CHECKPOINT_RADIUS'; end if;
  end if;
 end if;
 loc:=n at time zone 'Africa/Porto-Novo'; dt:=loc::date;
 select c.* into cs from public.course_sessions c where c.session_date=dt
 and lower(coalesce(c.status,'')) not in ('cancelled','canceled','annule','annulée','annulee')
 and (c.group_id=st.group_id or (c.group_id is null and c.formation_id=st.formation_id))
 order by case when loc::time between c.planned_start and c.planned_end then 0 when loc::time<c.planned_start then 1 else 2 end,
 case when c.planned_start>loc::time then c.planned_start end asc nulls last,
 case when c.planned_start<=loc::time then c.planned_start end desc nulls last limit 1;
 if not found then raise exception 'NO_TRAINING_SESSION_SCHEDULED_TODAY'; end if;
 nom:=cs.planned_start; cut:=(cs.planned_start+interval '15 minutes')::time;
 if loc::time>=time '19:00' then raise exception 'STUDENT_CHECKIN_CLOSED'; end if;
 stat:=case when loc::time<=cut then 'on_time' else 'late' end;
 mins:=case when stat='on_time' then 0 else greatest(0,floor(extract(epoch from(loc::time-cut))/60)::integer) end;
 insert into public.daily_attendance(person_id,local_date,person_type,nominal_time,cutoff_time,arrived_at,status,minutes_after_cutoff,checkpoint_id,latitude,longitude,location_accuracy_m)
 values(u,dt,'student',nom,cut,n,stat,mins,cp.id,p_lat,p_lng,p_accuracy_m)
 on conflict(person_id,local_date) do nothing returning * into att;
 ins:=found; update public.presence_kiosk_devices set last_used_at=n where id=d.id;
 if not ins then
  select * into att from public.daily_attendance where person_id=u and local_date=dt;
  return jsonb_build_object('ok',true,'duplicate',true,'status',att.status,'arrived_at',att.arrived_at,'nominal_time',att.nominal_time,'cutoff_time',att.cutoff_time,'minutes_after_cutoff',att.minutes_after_cutoff);
 end if;
 insert into public.attendance_events(attendance_id,person_id,event_type,occurred_at,source,metadata,created_by)
 values(null,u,'daily_qr_checkin',n,'registered_kiosk',jsonb_build_object('daily_attendance_id',att.id,'local_date',dt,'status',stat,'minutes_after_cutoff',mins,'kiosk_device_id',d.id,'session_id',cs.id,'formation_id',cs.formation_id,'group_id',cs.group_id,'planned_start',nom,'cutoff_time',cut,'gps_checked',dist is not null,'distance_m',case when dist is null then null else round(dist) end,'accuracy_m',p_accuracy_m),u);
 if stat='late' then
  insert into public.notifications(recipient_id,channel,type,title,body,data,status)
  select distinct ur.user_id,'in_app','attendance_late','Alerte de retard — apprenant',
  format('Un apprenant est arrivé en retard le %s à %s (%s minute(s) après l’heure limite).',to_char(dt,'DD/MM/YYYY'),to_char(loc::time,'HH24:MI'),mins),
  jsonb_build_object('person_id',u,'daily_attendance_id',att.id,'local_date',dt,'status',stat,'minutes_after_cutoff',mins),'pending'
  from public.user_roles ur join public.roles r on r.id=ur.role_id
  where upper(r.code) in ('SECRETARIAT','SECRETARY','DIRECTOR','ADMIN','PRE_ADMIN') and ur.user_id<>u;
 end if;
 return jsonb_build_object('ok',true,'duplicate',false,'status',stat,'arrived_at',n,'nominal_time',nom,'cutoff_time',cut,'minutes_after_cutoff',mins,'checkpoint',d.name,'session_id',cs.id,'formation_id',cs.formation_id,'group_id',cs.group_id);
end; $function$


revoke all on function public.kiosk_daily_checkin(text,numeric,numeric,numeric) from public,anon;
grant execute on function public.kiosk_daily_checkin(text,numeric,numeric,numeric) to authenticated;

CREATE OR REPLACE FUNCTION public.close_daily_student_absences()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 n timestamptz:=clock_timestamp(); loc timestamp without time zone; dt date;
 ins_count integer:=0; ev_count integer:=0; note_count integer:=0;
begin
 if auth.uid() is not null then
  if not public.is_admin_actor() and not public.has_any_role(array['DIRECTOR','PRE_ADMIN','SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE']) then raise exception 'UNAUTHORIZED_ABSENCE_CLOSURE'; end if;
 elsif coalesce(auth.role(),'')<>'service_role' and session_user not in ('postgres','supabase_admin') then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
 loc:=n at time zone 'Africa/Porto-Novo'; dt:=loc::date;
 if loc::time<time '19:00' then raise exception 'ABSENCE_CUTOFF_NOT_REACHED'; end if;
 insert into public.daily_attendance(person_id,local_date,person_type,nominal_time,cutoff_time,arrived_at,status,minutes_after_cutoff,checkpoint_id,latitude,longitude,location_accuracy_m)
 select s.id,dt,'student',sch.first_start,(sch.first_start+interval '15 minutes')::time,null,'absent',0,null,null,null,null
 from public.students s join public.profiles p on p.id=s.id
 cross join lateral (
  select min(cs.planned_start) first_start from public.course_sessions cs
  where cs.session_date=dt and lower(coalesce(cs.status,'')) not in ('cancelled','canceled','annule','annulée','annulee')
  and cs.planned_start<time '19:00' and (cs.group_id=s.group_id or (cs.group_id is null and cs.formation_id=s.formation_id))
 ) sch
 where p.status='active' and (s.enrollment_date is null or s.enrollment_date<=dt) and sch.first_start is not null
 and not exists(select 1 from public.absence_justifications aj where aj.person_id=s.id and aj.status='approved' and (aj.submitted_at at time zone 'Africa/Porto-Novo')::date=dt)
 and not exists(select 1 from public.daily_attendance da where da.person_id=s.id and da.local_date=dt)
 on conflict(person_id,local_date) do nothing;
 get diagnostics ins_count=row_count;
 insert into public.attendance_events(attendance_id,person_id,event_type,occurred_at,source,metadata,created_by)
 select null,da.person_id,'absence_detected',n,'daily_absence_closure',jsonb_build_object('daily_attendance_id',da.id,'local_date',da.local_date,'person_type',da.person_type,'status',da.status,'reason','No valid daily check-in or approved justification by official 19:00 closure','nominal_time',da.nominal_time,'cutoff_time',da.cutoff_time),null
 from public.daily_attendance da where da.local_date=dt and da.status='absent' and da.person_type='student'
 and not exists(select 1 from public.attendance_events ae where ae.event_type='absence_detected' and ae.metadata->>'daily_attendance_id'=da.id::text);
 get diagnostics ev_count=row_count;
 insert into public.notifications(recipient_id,channel,type,title,body,data,status,created_at)
 select da.person_id,'in_app','absence_detected','Absence à régulariser','Aucun pointage QR ni justificatif approuvé n’a été enregistré pour vos cours du jour. Veuillez contacter le secrétariat pour régulariser votre situation avant le prochain accès aux cours.',
 jsonb_build_object('daily_attendance_id',da.id,'local_date',dt,'action_required','contact_secretariat','nominal_time',da.nominal_time,'cutoff_time',da.cutoff_time),'pending',n
 from public.daily_attendance da where da.local_date=dt and da.status='absent' and da.person_type='student'
 and not exists(select 1 from public.notifications no where no.recipient_id=da.person_id and no.type='absence_detected' and no.data->>'local_date'=dt::text);
 get diagnostics note_count=row_count;
 return jsonb_build_object('ok',true,'local_date',dt,'absences_inserted',ins_count,'audit_events_inserted',ev_count,'notifications_queued',note_count,'cutoff','19:00','timezone','Africa/Porto-Novo');
end; $function$


revoke all on function public.close_daily_student_absences() from public,anon;
grant execute on function public.close_daily_student_absences() to authenticated,service_role;
