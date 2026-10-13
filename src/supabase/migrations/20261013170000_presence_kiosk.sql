-- Aéro Présence kiosk: registered-device-only daily check-in.
-- Apply only to the isolated aero-service-test project until all tests pass.

create table if not exists public.presence_kiosk_devices (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  token_hash text not null unique,
  activated_by uuid not null references auth.users(id),
  activated_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

alter table public.presence_kiosk_devices enable row level security;
revoke all on public.presence_kiosk_devices from anon, authenticated;

create or replace function public.activate_presence_kiosk(p_name text default 'Borne principale')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_token text;
  v_device_id uuid;
  v_name text := left(trim(coalesce(p_name, 'Borne principale')), 80);
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not (
    public.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN'])
  ) then raise exception 'KIOSK_ADMIN_REQUIRED'; end if;
  if v_name = '' then v_name := 'Borne principale'; end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.presence_kiosk_devices(name, token_hash, activated_by)
  values (v_name, encode(extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'), 'hex'), v_uid)
  returning id into v_device_id;

  return jsonb_build_object(
    'ok', true,
    'device_id', v_device_id,
    'device_name', v_name,
    'device_token', v_token,
    'activated_at', now()
  );
end;
$$;

create or replace function public.revoke_presence_kiosk(p_device_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN']) then
    raise exception 'KIOSK_ADMIN_REQUIRED';
  end if;

  update public.presence_kiosk_devices
  set revoked_at = now()
  where id = p_device_id and revoked_at is null;

  if not found then raise exception 'KIOSK_NOT_FOUND_OR_ALREADY_REVOKED'; end if;
  return jsonb_build_object('ok', true, 'device_id', p_device_id, 'revoked_at', now());
end;
$$;

create or replace function public.kiosk_daily_checkin(
  p_device_token text,
  p_lat numeric default null,
  p_lng numeric default null,
  p_accuracy_m numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

  -- GPS is supplemental: only a complete, reasonably precise location is checked.
  -- The registered kiosk remains mandatory even when the browser has no GPS.
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

  -- Keep the existing daily rule: on time until 09:15 inclusive; late from 09:16.
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
    null, v_uid, 'daily_kiosk_checkin', v_now, 'registered_kiosk',
    jsonb_build_object(
      'daily_attendance_id', v_row.id, 'local_date', v_local_date,
      'person_type', v_person_type, 'status', v_status,
      'minutes_after_cutoff', v_minutes, 'kiosk_device_id', v_device.id,
      'gps_checked', v_distance is not null,
      'distance_m', case when v_distance is null then null else round(v_distance) end,
      'accuracy_m', p_accuracy_m
    ), v_uid
  );

  return jsonb_build_object(
    'ok', true, 'duplicate', false, 'status', v_status,
    'arrived_at', v_now, 'nominal_time', v_nominal,
    'cutoff_time', v_cutoff, 'minutes_after_cutoff', v_minutes,
    'checkpoint', v_device.name
  );
end;
$$;

revoke all on function public.activate_presence_kiosk(text) from public, anon;
revoke all on function public.revoke_presence_kiosk(uuid) from public, anon;
revoke all on function public.kiosk_daily_checkin(text, numeric, numeric, numeric) from public, anon;
grant execute on function public.activate_presence_kiosk(text) to authenticated;
grant execute on function public.revoke_presence_kiosk(uuid) to authenticated;
grant execute on function public.kiosk_daily_checkin(text, numeric, numeric, numeric) to authenticated;

-- QR-based personal-device pointage is intentionally disabled in this test branch.
revoke all on function public.qr_daily_checkin(uuid, numeric, numeric, numeric) from public, anon, authenticated;
