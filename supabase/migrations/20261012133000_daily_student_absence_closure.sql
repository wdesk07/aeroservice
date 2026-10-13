-- Daily absence closure for active learners who actually have a course scheduled today.
-- Depends on 20261012130000_daily_attendance_qr_policy.sql.
-- Feature branch only: do not apply to production until reviewed and tested.
--
-- QR check-in still classifies arrival after 09:15 as late. Absence is only
-- finalized at the end of the course day (19:00 local time).
-- This function is idempotent and never overwrites an existing arrival.
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
  v_events integer := 0;
  v_notifications integer := 0;
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
  elsif coalesce(auth.role(), '') <> 'service_role' and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;

  v_local := v_now at time zone 'Africa/Porto-Novo';
  v_date := v_local::date;

  -- Never finalize absences before the official end of classes.
  if v_local::time < time '19:00' then
    raise exception 'ABSENCE_CUTOFF_NOT_REACHED';
  end if;

  -- Only learners with a non-cancelled course session on this local date
  -- are eligible. No scheduled course means no automatic absence penalty.
  -- An approved justification submitted for this local date excludes the learner.
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
    and exists (
      select 1
      from public.course_sessions cs
      where cs.session_date = v_date
        and cs.status <> 'cancelled'
        and cs.planned_start < time '19:00'
        and (
          cs.group_id = s.group_id
          or (cs.group_id is null and cs.formation_id = s.formation_id)
        )
    )
    and not exists (
      select 1 from public.absence_justifications aj
      where aj.person_id = s.id
        and aj.status = 'approved'
        and (aj.submitted_at at time zone 'Africa/Porto-Novo')::date = v_date
    )
    and not exists (
      select 1 from public.daily_attendance da
      where da.person_id = s.id and da.local_date = v_date
    )
  on conflict (person_id, local_date) do nothing;

  get diagnostics v_inserted = row_count;

  -- Preserve exactly one audit event per absence, including recovery of a
  -- missing event on a prior run without duplicating events already recorded.
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
      'reason', 'No valid daily QR check-in or approved justification by 19:00 Africa/Porto-Novo'
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
  get diagnostics v_events = row_count;

  -- Queue an in-app notice once per learner and date; delivery workers can
  -- subsequently send the configured channel without duplicating the record.
  insert into public.notifications (
    recipient_id, channel, type, title, body, data, status, created_at
  )
  select
    da.person_id, 'in_app', 'absence_detected',
    'Absence à régulariser',
    'Aucun pointage QR ni justificatif approuvé n’a été enregistré pour vos cours du jour. Veuillez contacter le secrétariat pour régulariser votre situation avant le prochain accès aux cours.',
    jsonb_build_object(
      'daily_attendance_id', da.id,
      'local_date', v_date,
      'action_required', 'contact_secretariat'
    ),
    'pending', v_now
  from public.daily_attendance da
  where da.local_date = v_date
    and da.status = 'absent'
    and da.person_type = 'student'
    and not exists (
      select 1 from public.notifications n
      where n.recipient_id = da.person_id
        and n.type = 'absence_detected'
        and n.data ->> 'local_date' = v_date::text
    );
  get diagnostics v_notifications = row_count;

  return jsonb_build_object(
    'ok', true,
    'local_date', v_date,
    'absences_inserted', v_inserted,
    'audit_events_inserted', v_events,
    'notifications_queued', v_notifications,
    'cutoff', '19:00',
    'timezone', 'Africa/Porto-Novo'
  );
end;
$function$;

revoke all on function public.close_daily_student_absences() from public, anon;
grant execute on function public.close_daily_student_absences() to authenticated, service_role;
