-- Require server-validated geofencing for every mobile QR check-in.
-- The active checkpoint must be configured with the center's GPS coordinates and radius.
alter table public.qr_checkin_requests
  add column if not exists latitude numeric,
  add column if not exists longitude numeric,
  add column if not exists location_accuracy_m numeric;
alter table public.attendance
  add column if not exists latitude numeric,
  add column if not exists longitude numeric,
  add column if not exists location_accuracy_m numeric;

create or replace function public.request_qr_checkin_with_gps(
  p_latitude numeric,
  p_longitude numeric,
  p_accuracy_m numeric
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_checkpoint record;
  v_distance_m numeric;
  v_result jsonb;
  v_request_id uuid;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_latitude is null or p_longitude is null
    or p_latitude < -90 or p_latitude > 90
    or p_longitude < -180 or p_longitude > 180 then
    raise exception 'GPS_REQUIRED';
  end if;
  if p_accuracy_m is null or p_accuracy_m <= 0 or p_accuracy_m > 100 then
    raise exception 'GPS_ACCURACY_TOO_LOW';
  end if;

  select c.latitude,c.longitude,c.radius_m
    into v_checkpoint
  from public.checkpoints c
  where c.active = true and c.latitude is not null
    and c.longitude is not null and c.radius_m > 0
  order by case when c.code = 'AERO_ENTRANCE' then 0 else 1 end, c.created_at asc
  limit 1;
  if not found then raise exception 'ATTENDANCE_LOCATION_NOT_CONFIGURED'; end if;

  v_distance_m := 6371000 * acos(least(1::numeric,greatest(-1::numeric,
    sin(radians(p_latitude)) * sin(radians(v_checkpoint.latitude))
    + cos(radians(p_latitude)) * cos(radians(v_checkpoint.latitude))
    * cos(radians(p_longitude - v_checkpoint.longitude))
  )));
  if v_distance_m > v_checkpoint.radius_m then
    raise exception 'OUTSIDE_ATTENDANCE_GEOFENCE';
  end if;

  v_result := public.request_qr_checkin();
  if coalesce((v_result->>'ok')::boolean,false) and v_result ? 'request_id' then
    v_request_id := (v_result->>'request_id')::uuid;
    update public.qr_checkin_requests
      set latitude=p_latitude,longitude=p_longitude,location_accuracy_m=p_accuracy_m
    where id=v_request_id and person_id=v_uid and status='pending_confirmation';
  end if;
  return v_result;
end;
$function$;

revoke all on function public.request_qr_checkin_with_gps(numeric,numeric,numeric) from public, anon;
grant execute on function public.request_qr_checkin_with_gps(numeric,numeric,numeric) to authenticated;
revoke all on function public.request_qr_checkin() from public, anon, authenticated;

create or replace function public.copy_qr_gps_to_attendance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status = 'approved' and old.status = 'pending_confirmation'
     and new.daily_attendance_id is not null then
    update public.attendance
      set latitude=new.latitude,longitude=new.longitude,location_accuracy_m=new.location_accuracy_m
    where id=new.attendance_id;
  end if;
  return new;
end;
$function$;

drop trigger if exists qr_checkin_copy_gps_to_attendance on public.qr_checkin_requests;
create trigger qr_checkin_copy_gps_to_attendance
after update of status on public.qr_checkin_requests
for each row execute function public.copy_qr_gps_to_attendance();
