-- Daily absence closure for active learners.
-- Depends on 20261012130000_daily_attendance_qr_policy.sql.
-- Feature branch only: do not apply to production until reviewed and tested.
--
-- A missing QR action is classified as absent only after the official cutoff.
-- This function is idempotent: it never overwrites a recorded arrival.
alter table public.daily_attendance
  drop constraint if exists daily_attendance_status_check;

alter table public.daily_attendance
  add constraint daily_attendance_status_check
  check (status in ('on_time', 'late', 'absent'));

alter table public.daily_attendance
  alter column arrived_at drop not null,
  alter column checkpoint_id drop not null,
  alter column latitude drop not null,
  alter column longitude drop not null,
  alter column location_accuracy_m drop not null;

create or replace function public.close_daily_student_absences()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_local timestamp without time zone;
  v_date date;
  v_inserted integer := 0;
begin
  -- Authenticated callers must be authorized administrators. A trusted
  -- service-role scheduler may call this function after the cutoff.
  if auth.uid() is not null then
    if not public.is_admin_actor()
       and not public.has_any_role(array[
         'DIRECTOR','PRE_ADMIN','SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE'
       ]) then
      raise exception 'UNAUTHORIZED_ABSENCE_CLOSURE';
    end if;
  elsif coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;

  v_local := v_now at time zone 'Africa/Porto-Novo';
  v_date := v_local::date;

  -- Learner cutoff is inclusive through 09:15; close absences from 09:16.
  if v_local::time < time '09:16' then
    raise exception 'ABSENCE_CUTOFF_NOT_REACHED';
  end if;

  insert into public.daily_attendance (
    person_id, local_date, person_type, nominal_time, cutoff_time,
    arrived_at, status, minutes_after_cutoff, checkpoint_id,
    latitude, longitude, location_accuracy_m
  )
  select
    s.id, v_date, 'student', time '09:00', time '09:15',
    null, 'absent', 0, null, null, null, null
  from public.students s
  join public.profiles p on p.id = s.id
  where p.status = 'active'
    and (s.enrollment_date is null or s.enrollment_date <= v_date)
    and not exists (
      select 1 from public.daily_attendance da
      where da.person_id = s.id and da.local_date = v_date
    )
  on conflict (person_id, local_date) do nothing;

  get diagnostics v_inserted = row_count;

  -- Preserve exactly one audit event per absence. This also repairs a missing
  -- audit event on a prior run without duplicating events already recorded.
  -- Event rows are tied to the daily record through metadata; attendance_id
  -- is nullable in the existing production schema.
  insert into public.attendance_events (
    attendance_id, person_id, event_type, occurred_at, source, metadata, created_by
  )
  select
    null, da.person_id, 'absence_detected', v_now, 'daily_absence_closure',
    jsonb_build_object(
      'daily_attendance_id', da.id,
      'local_date', da.local_date,
      'person_type', da.person_type,
      'status', da.status,
      'reason', 'No valid daily check-in by 09:16 Africa/Porto-Novo'
    ),
    null
  from public.daily_attendance da
  where da.local_date = v_date
    and da.status = 'absent'
    and da.person_type = 'student'
    and not exists (
      select 1 from public.attendance_events ae
      where ae.event_type = 'absence_detected'
        and ae.metadata ->> 'daily_attendance_id' = da.id::text
    );

  return jsonb_build_object(
    'ok', true,
    'local_date', v_date,
    'absences_inserted', v_inserted,
    'cutoff', '09:16',
    'timezone', 'Africa/Porto-Novo'
  );
end;
$function$;

revoke all on function public.close_daily_student_absences() from public, anon;
grant execute on function public.close_daily_student_absences() to authenticated, service_role;
