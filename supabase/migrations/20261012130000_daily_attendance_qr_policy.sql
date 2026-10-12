-- Separate daily arrival policy from course-session attendance.
-- Apply only after review; this file is committed to the feature branch and is NOT
-- applied to the connected Supabase database.
create table if not exists public.daily_attendance (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.profiles(id) on delete restrict,
  local_date date not null,
  person_type text not null check (person_type in ('student','staff')),
  nominal_time time without time zone not null,
  cutoff_time time without time zone not null,
  arrived_at timestamptz not null,
  status text not null check (status in ('on_time','late')),
  minutes_after_cutoff integer not null default 0 check (minutes_after_cutoff >= 0),
  checkpoint_id uuid not null references public.checkpoints(id) on delete restrict,
  latitude numeric not null,
  longitude numeric not null,
  location_accuracy_m numeric not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (person_id, local_date)
);

alter table public.daily_attendance enable row level security;

drop policy if exists daily_attendance_read_self_or_admin on public.daily_attendance;
create policy daily_attendance_read_self_or_admin
on public.daily_attendance for select to authenticated
using (
  person_id = (select auth.uid())
  or public.is_admin_actor()
  or public.has_any_role(array['SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE','DIRECTOR','PRE_ADMIN','ACCOUNTING'])
);

-- No direct INSERT/UPDATE/DELETE policy is granted: daily rows are written by
-- this security-definer RPC only, after checking the authenticated identity.
revoke all on public.daily_attendance from anon, authenticated;
grant select on public.daily_attendance to authenticated;

create or replace function public.qr_daily_checkin(
  p_checkpoint_id uuid,
  p_lat numeric,
  p_lng numeric,
  p_accuracy_m numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_checkpoint public.checkpoints%rowtype;
  v_person_type text;
  v_now timestamptz := clock_timestamp();
  v_local timestamp without time zone;
  v_local_date date;
  v_nominal time without time zone;
  v_cutoff time without time zone;
  v_distance numeric;
  v_status text;
  v_minutes integer;
  v_row public.daily_attendance%rowtype;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_lat is null or p_lng is null or p_accuracy_m is null
     or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180
     or p_accuracy_m <= 0 or p_accuracy_m > 50
  then raise exception 'GPS_REQUIRED_OR_INACCURATE'; end if;

  select * into v_checkpoint
  from public.checkpoints
  where id = p_checkpoint_id and active;
  if not found then raise exception 'CHECKPOINT_INACTIVE'; end if;
  if v_checkpoint.latitude is null or v_checkpoint.longitude is null
     or v_checkpoint.radius_m is null or v_checkpoint.radius_m <= 0
  then raise exception 'CHECKPOINT_GEOFENCE_NOT_CONFIGURED'; end if;

  v_distance := 6371000 * 2 * asin(sqrt(
    power(sin(radians(p_lat - v_checkpoint.latitude) / 2), 2)
    + cos(radians(v_checkpoint.latitude)) * cos(radians(p_lat))
    * power(sin(radians(p_lng - v_checkpoint.longitude) / 2), 2)
  ));
  if v_distance > v_checkpoint.radius_m or p_accuracy_m > v_checkpoint.radius_m then
    raise exception 'OUTSIDE_CHECKPOINT_RADIUS';
  end if;

  if exists (select 1 from public.students where id = v_uid) then
    v_person_type := 'student';
    v_nominal := time '09:00';
    v_cutoff := time '09:15';
  elsif exists (select 1 from public.staff where id = v_uid)
     or exists (select 1 from public.teachers where id = v_uid)
     or public.has_any_role(array['DIRECTOR','PRE_ADMIN','SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE'])
  then
    v_person_type := 'staff';
    v_nominal := time '08:30';
    v_cutoff := time '08:30';
  else
    raise exception 'PERSON_NOT_REGISTERED';
  end if;

  v_local := v_now at time zone 'Africa/Porto-Novo';
  v_local_date := v_local::date;
  v_status := case when v_local::time <= v_cutoff then 'on_time' else 'late' end;
  v_minutes := case when v_local::time <= v_cutoff then 0
    else floor(extract(epoch from (v_local::time - v_cutoff)) / 60)::integer end;

  insert into public.daily_attendance(
    person_id, local_date, person_type, nominal_time, cutoff_time, arrived_at,
    status, minutes_after_cutoff, checkpoint_id, latitude, longitude, location_accuracy_m
  ) values (
    v_uid, v_local_date, v_person_type, v_nominal, v_cutoff, v_now,
    v_status, v_minutes, p_checkpoint_id, p_lat, p_lng, p_accuracy_m
  )
  on conflict (person_id, local_date) do nothing
  returning * into v_row;

  if not found then
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
    null, v_uid, 'daily_qr_checkin', v_now, 'qr_daily',
    jsonb_build_object(
      'daily_attendance_id', v_row.id, 'local_date', v_local_date,
      'person_type', v_person_type, 'nominal_time', v_nominal,
      'cutoff_time', v_cutoff, 'status', v_status,
      'minutes_after_cutoff', v_minutes, 'checkpoint_id', p_checkpoint_id,
      'distance_m', round(v_distance), 'accuracy_m', p_accuracy_m
    ), v_uid
  );

  return jsonb_build_object(
    'ok', true, 'duplicate', false, 'status', v_status,
    'arrived_at', v_now, 'nominal_time', v_nominal,
    'cutoff_time', v_cutoff, 'minutes_after_cutoff', v_minutes,
    'checkpoint', v_checkpoint.name
  );
end;
$function$;

revoke all on function public.qr_daily_checkin(uuid,numeric,numeric,numeric) from public, anon;
grant execute on function public.qr_daily_checkin(uuid,numeric,numeric,numeric) to authenticated;
