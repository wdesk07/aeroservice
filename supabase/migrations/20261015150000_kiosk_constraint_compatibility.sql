-- Permit the registered kiosk as an attendance source while preserving all
-- source values already accepted by the production schema.
alter table public.attendance
  drop constraint if exists attendance_source_check;

alter table public.attendance
  add constraint attendance_source_check
    check (source = any (array[
      'qr','biometric','face','fingerprint','secretariat','manual','hybrid',
      'kiosk'
    ]::text[]));
