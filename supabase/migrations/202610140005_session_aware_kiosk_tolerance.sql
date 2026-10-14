-- Session-aware daily QR check-in. Fifteen-minute tolerance is enforced by PostgreSQL.
create or replace function public.kiosk_daily_checkin(
 p_device_token text, p_lat numeric default null, p_lng numeric default null, p_accuracy_m numeric default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 u uuid := auth.uid(); d public.presence_kiosk_devices%rowtype; st public.students%rowtype;
 cs public.course_sessions%rowtype; n timestamptz := clock_timestamp();
 loc timestamp without time zone; dt date; nom time; cut time; cp public.checkpoints%rowtype;
 dist numeric; stat text; mins integer; att public.daily_attendance%rowtype; ins boolean := false;
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 if p_device_token is null or length(p_device_token)<40 then raise exception 'KIOSK_NOT_REGISTERED'; end if;
 select * into d from public.presence_kiosk_devices
 where token_hash=encode(extensions.digest(convert_to(p_device_token,'UTF8'),'sha256'),'hex') and revoked_at is null;
 if not found then raise exception 'KIOSK_NOT_REGISTERED'; end if;
 select s.* into st from public.students s join public.profiles p on p.id=s.id
 where s.id=u and lower(coalesce(p.status,'active'))='active';
 if not found then raise exception 'ACTIVE_STUDENT_REQUIRED'; end if;
 if p_lat is not null or p_lng is not null or p_accuracy_m is not null then
  if p_lat between -90 and 90 and p_lng between -180 and 180 and p_accuracy_m>0 and p_accuracy_m<=50 then
   select * into cp from public.checkpoints where active and latitude is not null and longitude is not null and radius_m>0 order by created_at desc limit 1;
   if found then
    dist:=6371000*2*asin(sqrt(power(sin(radians(p_lat-cp.latitude)/2),2)+cos(radians(cp.latitude))*cos(radians(p_lat))*power(sin(radians(p_lng-cp.longitude)/2),2)));
    if dist>cp.radius_m or p_accuracy_m>cp.radius_m then raise exception 'OUTSIDE_CHECKPOINT_RADIUS'; end if;
   end if;
  end if;
 end if;
 loc:=n at time zone 'Africa/Porto-Novo'; dt:=loc::date;
 select c.* into cs from public.course_sessions c
 where c.session_date=dt and lower(coalesce(c.status,'')) not in ('cancelled','canceled','annule','annulée','annulee')
 and ((st.group_id is not null and c.group_id=st.group_id) or (st.formation_id is not null and c.formation_id=st.formation_id))
 order by case when loc::time between c.planned_start and c.planned_end then 0 when loc::time<c.planned_start then 1 else 2 end,
 case when c.planned_start>loc::time then c.planned_start end asc nulls last,
 case when c.planned_start<=loc::time then c.planned_start end desc nulls last limit 1;
 if not found then raise exception 'NO_TRAINING_SESSION_SCHEDULED_TODAY'; end if;
 nom:=cs.planned_start; cut:=(cs.planned_start+interval '15 minutes')::time;
 if loc::time>=time '19:00' then raise exception 'STUDENT_CHECKIN_CLOSED'; end if;
 stat:=case when loc::time<=cut then 'on_time' else 'late' end;
 mins:=case when stat='on_time' then 0 else greatest(0,floor(extract(epoch from (loc::time-cut))/60)::integer) end;
 insert into public.daily_attendance(person_id,local_date,person_type,nominal_time,cutoff_time,arrived_at,status,minutes_after_cutoff,checkpoint_id,latitude,longitude,location_accuracy_m)
 values(u,dt,'student',nom,cut,n,stat,mins,cp.id,p_lat,p_lng,p_accuracy_m)
 on conflict(person_id,local_date) do nothing returning * into att;
 ins:=found; update public.presence_kiosk_devices set last_used_at=n where id=d.id;
 if not ins then
  select * into att from public.daily_attendance where person_id=u and local_date=dt;
  return jsonb_build_object('ok',true,'duplicate',true,'status',att.status,'arrived_at',att.arrived_at,'nominal_time',att.nominal_time,'cutoff_time',att.cutoff_time,'minutes_after_cutoff',att.minutes_after_cutoff,'session_id',cs.id,'formation_id',cs.formation_id,'group_id',cs.group_id);
 end if;
 insert into public.attendance_events(attendance_id,person_id,event_type,occurred_at,source,metadata,created_by)
 values(null,u,'daily_qr_checkin',n,'registered_kiosk',jsonb_build_object('daily_attendance_id',att.id,'local_date',dt,'person_type','student','status',stat,'minutes_after_cutoff',mins,'kiosk_device_id',d.id,'session_id',cs.id,'formation_id',cs.formation_id,'group_id',cs.group_id,'planned_start',nom,'cutoff_time',cut,'gps_checked',dist is not null,'distance_m',case when dist is null then null else round(dist) end,'accuracy_m',p_accuracy_m),u);
 return jsonb_build_object('ok',true,'duplicate',false,'status',stat,'arrived_at',n,'nominal_time',nom,'cutoff_time',cut,'minutes_after_cutoff',mins,'checkpoint',d.name,'session_id',cs.id,'formation_id',cs.formation_id,'group_id',cs.group_id);
end; $$;
revoke all on function public.kiosk_daily_checkin(text,numeric,numeric,numeric) from public,anon;
grant execute on function public.kiosk_daily_checkin(text,numeric,numeric,numeric) to authenticated;
