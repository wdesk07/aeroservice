-- Backfill test notifications for late attendance already recorded before alerts were enabled.
-- Safe to rerun: a notification is only created when this attendance id has no existing alert.
insert into public.notifications (
  recipient_id, channel, type, title, body, data, status
)
select distinct
  ur.user_id,
  'in_app',
  'attendance_late',
  'Alerte de retard — apprenant',
  format(
    '%s est arrivé(e) en retard le %s à %s (%s minute(s) après 09 h 15). Veuillez vérifier la régularisation.',
    coalesce(
      nullif(trim(p.display_name), ''),
      nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
      p.email,
      'Un apprenant'
    ),
    to_char(da.local_date, 'DD/MM/YYYY'),
    to_char(da.arrived_at at time zone 'Africa/Porto-Novo', 'HH24:MI'),
    coalesce(da.minutes_after_cutoff, 0)
  ),
  jsonb_build_object(
    'person_id', da.person_id,
    'daily_attendance_id', da.id,
    'local_date', da.local_date,
    'arrived_at', da.arrived_at,
    'status', da.status,
    'minutes_after_cutoff', da.minutes_after_cutoff
  ),
  'pending'
from public.daily_attendance da
join public.profiles p on p.id = da.person_id
join public.user_roles ur on ur.user_id <> da.person_id
join public.roles r on r.id = ur.role_id
where da.status = 'late'
  and upper(r.code) in ('SECRETARIAT', 'SECRETARY', 'SECRETAIRE', 'SECRÉTAIRE', 'DIRECTOR', 'ADMIN', 'PRE_ADMIN')
  and not exists (
    select 1
    from public.notifications n
    where n.recipient_id = ur.user_id
      and n.type = 'attendance_late'
      and n.data ->> 'daily_attendance_id' = da.id::text
  );
