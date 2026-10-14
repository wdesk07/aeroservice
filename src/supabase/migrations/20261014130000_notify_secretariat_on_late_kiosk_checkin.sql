-- Notify the authorized secretariat and leadership when a kiosk check-in is late.
-- Test branch migration: no production database is changed by this file.
create or replace function public.kiosk_daily_checkin(
  p_device_token text,
  p_lat numeric default null,
  p_lng numeric default null,
  p_accuracy_m numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_device public.presence_kiosk_devices%rowtype;
  v_person_type text := 'student';
  v_now timestamptz := clock_timestamp();
  v_local timestamp without time zone;
  v_local_date date;
  v_nominal time without time zone := time '09:00';
  v_cutoff time without time zone := time '09:15';
  v_checkpoint public.checkpoints%rowtype;
  v_distance numeric;
  v_status text;
  v_minutes integer;
  v_row public.daily_attendance%rowtype;
  v_inserted boolean := false;
  v_person_name text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_device_token is null or length(p_device_token) < 40 then raise exception 'KIOSK_NOT_REGISTERED'; end if;

  select * into v_device
  from public.presence_kiosk_devices
  where token_hash = encode(extensions.digest(convert_to(p_device_token, 'UTF8'), 'sha256'), 'hex')
    and revoked_at is null;
  if not found then raise exception 'KIOSK_NOT_REGISTERED'; end if;

  if not exists (
    select 1 from public.profiles p
    join public.students s on s.id = p.id
    where p.id = v_uid and lower(coalesce(p.status, 'active')) = 'active'
  ) then
    raise exception 'ACTIVE_STUDENT_REQUIRED';
  end if;

  -- GPS is supplemental; the registered kiosk remains mandatory.
  if p_lat is not null or p_lng is not null or p_accuracy_m is not null then
    if p_lat is not null and p_lng is not null and p_accuracy_m is not null
       and p_lat between -90 and 90 and p_lng between -180 and 180
       and p_accuracy_m > 0 and p_accuracy_m <= 50 then
      select * into v_checkpoint
      from public.checkpoints
      where active and latitude is not null and longitude is not null and radius_m > 0
      order by created_at desc
      limit 1;

      if found then
        v_distance := 6371000 * 2 * asin(sqrt(
          power(sin(radians(p_lat - v_checkpoint.latitude) / 2), 2)
          + cos(radians(v_checkpoint.latitude)) * cos(radians(p_lat))
          * power(sin(radians(p_lng - v_checkpoint.longitude) / 2), 2)
        ));
        if v_distance > v_checkpoint.radius_m or p_accuracy_m > v_checkpoint.radius_m then
          raise exception 'OUTSIDE_CHECKPOINT_RADIUS';
        end if;
      end if;
    end if;
  end if;

  v_local := v_now at time zone 'Africa/Porto-Novo';
  v_local_date := v_local::date;
  if v_local::time >= time '19:00' then raise exception 'STUDENT_CHECKIN_CLOSED'; end if;

  v_status := case when v_local::time < time '09:16' then 'on_time' else 'late' end;
  v_minutes := case when v_status = 'on_time' then 0
    else greatest(0, floor(extract(epoch from (v_local::time - v_cutoff)) / 60)::integer) end;

  insert into public.daily_attendance(
    person_id, local_date, person_type, nominal_time, cutoff_time, arrived_at,
    status, minutes_after_cutoff, checkpoint_id, latitude, longitude, location_accuracy_m
  ) values (
    v_uid, v_local_date, v_person_type, v_nominal, v_cutoff, v_now,
    v_status, v_minutes, v_checkpoint.id, p_lat, p_lng, p_accuracy_m
  )
  on conflict (person_id, local_date) do nothing
  returning * into v_row;
  v_inserted := found;

  update public.presence_kiosk_devices set last_used_at = v_now where id = v_device.id;

  if not v_inserted then
    select * into v_row from public.daily_attendance
    where person_id = v_uid and local_date = v_local_date;
    return jsonb_build_object(
      'ok', true, 'duplicate', true, 'status', v_row.status,
      'arrived_at', v_row.arrived_at, 'nominal_time', v_row.nominal_time,
      'cutoff_time', v_row.cutoff_time, 'minutes_after_cutoff', v_row.minutes_after_cutoff
    );
  end if;

  insert into public.attendance_events(
    attendance_id, person_id, event_type, occurred_at, source, metadata, created_by
  ) values (
    null, v_uid, 'daily_qr_checkin', v_now, 'registered_kiosk',
    jsonb_build_object(
      'daily_attendance_id', v_row.id, 'local_date', v_local_date,
      'person_type', v_person_type, 'status', v_status,
      'minutes_after_cutoff', v_minutes, 'kiosk_device_id', v_device.id,
      'gps_checked', v_distance is not null,
      'distance_m', case when v_distance is null then null else round(v_distance) end,
      'accuracy_m', p_accuracy_m
    ), v_uid
  );

  if v_status = 'late' then
    select coalesce(
      nullif(trim(p.display_name), ''),
      nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
      p.email,
      'Apprenant'
    )
    into v_person_name
    from public.profiles p
    where p.id = v_uid;

    insert into public.notifications(
      recipient_id, channel, type, title, body, data, status
    )
    select distinct ur.user_id, 'in_app', 'attendance_late',
      'Alerte de retard — apprenant',
      format(
        '%s est arrivé(e) en retard le %s à %s (%s minute(s) après 09 h 15). Veuillez vérifier la régularisation.',
        coalesce(v_person_name, 'Un apprenant'),
        to_char(v_local_date, 'DD/MM/YYYY'),
        to_char(v_local::time, 'HH24:MI'),
        v_minutes
      ),
      jsonb_build_object(
        'person_id', v_uid,
        'daily_attendance_id', v_row.id,
        'local_date', v_local_date,
        'arrived_at', v_now,
        'status', v_status,
        'minutes_after_cutoff', v_minutes
      ),
      'pending'
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where upper(r.code) in ('SECRETARIAT', 'SECRETARY', 'DIRECTOR', 'ADMIN', 'PRE_ADMIN')
      and ur.user_id <> v_uid;
  end if;

  return jsonb_build_object(
    'ok', true, 'duplicate', false, 'status', v_status,
    'arrived_at', v_now, 'nominal_time', v_nominal,
    'cutoff_time', v_cutoff, 'minutes_after_cutoff', v_minutes,
    'checkpoint', v_device.name
  );
end;
$function$;
