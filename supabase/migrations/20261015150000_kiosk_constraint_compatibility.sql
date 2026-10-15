-- Allow the production-compatible kiosk workflow to use explicit kiosk states
-- while retaining every value already accepted by the production schema.
alter table public.attendance
  drop constraint if exists attendance_status_check,
  drop constraint if exists attendance_source_check;

alter table public.attendance
  add constraint attendance_status_check
    check (status = any (array[
      'on_time','late','regularized_late','absent',
      'justification_pending','excused_absence'
    ]::text[])),
  add constraint attendance_source_check
    check (source = any (array[
      'qr','biometric','face','fingerprint','secretariat','manual','hybrid',
      'kiosk'
    ]::text[]));

alter table public.attendance_events
  drop constraint if exists attendance_events_event_type_check;

alter table public.attendance_events
  add constraint attendance_events_event_type_check
    check (event_type = any (array[
      'pointage','late_detected','absence_detected','regularized','blocked',
      'unblocked','correction','anomaly','checkin','late_checkin',
      'absence_auto_closed'
    ]::text[]));
