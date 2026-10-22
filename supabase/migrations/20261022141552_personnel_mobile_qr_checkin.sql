create or replace function public.request_personnel_qr_checkin_with_gps(
  p_latitude numeric, p_longitude numeric, p_accuracy_m numeric
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  u uuid := auth.uid();
  p public.profiles%rowtype;
  cp public.checkpoints%rowtype;
  att public.daily_attendance%rowtype;
  n timestamptz := clock_timestamp();
  loc timestamp without time zone;
  dt date;
  distance_m numeric;
  inserted boolean := false;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_latitude is null or p_longitude is null
     or p_latitude not between -90 and 90 or p_longitude not between -180 and 180
     or p_accuracy_m is null or p_accuracy_m <= 0 or p_accuracy_m > 100 then
    raise exception 'GPS_INVALID_OR_INACCURATE';
  end if;
  select * into p from public.profiles where id = u and lower(coalesce(status, '')) = 'active';
  if not found then raise exception 'ACTIVE_PERSONNEL_REQUIRED'; end if;
  if not exists (
    select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
    where ur.user_id = u and upper(r.code) in (
      'DIRECTOR','ADMIN','PRE_ADMIN','SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE',
      'STAFF','PERSONNEL','TEACHER','ENSEIGNANT','PEDAGOGY','PEDAGOGIE','ACCOUNTING','FINANCE'
    )
  ) then raise exception 'ACTIVE_PERSONNEL_REQUIRED'; end if;
  loc := n at time zone 'Africa/Porto-Novo';
  dt := loc::date;
  if loc::time < time '08:30' or loc::time >= time '19:00' then
    raise exception 'PERSONNEL_CHECKIN_CLOSED';
  end if;
  select * into cp from public.checkpoints
  where active and latitude is not null and longitude is not null and radius_m > 0
  order by (code = 'AERO_ENTRANCE') desc, created_at asc
  limit 1;
  if not found then raise exception 'CHECKPOINT_NOT_CONFIGURED'; end if;
  distance_m := 6371000 * 2 * asin(sqrt(
    power(sin(radians((p_latitude - cp.latitude)::double precision) / 2), 2) +
    cos(radians(cp.latitude::double precision)) * cos(radians(p_latitude::double precision)) *
    power(sin(radians((p_longitude - cp.longitude)::double precision) / 2), 2)
  ));
  if distance_m > cp.radius_m + p_accuracy_m then raise exception 'OUTSIDE_CHECKPOINT_GEOFENCE'; end if;
  insert into public.daily_attendance
    (person_id, local_date, person_type, nominal_time, cutoff_time, arrived_at, status,
     minutes_after_cutoff, checkpoint_id, latitude, longitude, location_accuracy_m)
  values (u, dt, 'staff', loc::time, loc::time, n, 'on_time', 0, cp.id,
     p_latitude, p_longitude, p_accuracy_m)
  on conflict (person_id, local_date) do nothing
  returning * into att;
  inserted := found;
  if not inserted then
    select * into att from public.daily_attendance where person_id = u and local_date = dt;
  else
    insert into public.attendance_events
      (attendance_id, person_id, event_type, occurred_at, source, metadata, created_by)
    values (null, u, 'daily_qr_checkin', n, 'mobile_qr',
      jsonb_build_object('daily_attendance_id', att.id, 'local_date', dt, 'status', att.status,
        'person_type', 'staff', 'checkpoint_id', cp.id, 'gps_checked', true,
        'latitude', p_latitude, 'longitude', p_longitude, 'accuracy_m', p_accuracy_m,
        'distance_m', round(distance_m)), u);
  end if;
  return jsonb_build_object('ok', true, 'duplicate', not inserted, 'status', att.status,
    'arrived_at', att.arrived_at, 'nominal_time', att.nominal_time,
    'gps_verified', true, 'distance_m', round(distance_m));
end;
$function$;

revoke all on function public.request_personnel_qr_checkin_with_gps(numeric,numeric,numeric) from public;
grant execute on function public.request_personnel_qr_checkin_with_gps(numeric,numeric,numeric) to authenticated;