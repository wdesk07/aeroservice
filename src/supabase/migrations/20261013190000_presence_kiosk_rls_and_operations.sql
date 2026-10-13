-- Keep kiosk secrets and brute-force attempt records private while allowing administrators to audit devices.
alter table public.presence_kiosk_devices enable row level security;
drop policy if exists "administrators can inspect presence kiosk devices" on public.presence_kiosk_devices;
create policy "administrators can inspect presence kiosk devices"
on public.presence_kiosk_devices
for select to authenticated
using (public.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN']));

alter table public.presence_kiosk_login_attempts enable row level security;
drop policy if exists "administrators can inspect kiosk login attempts" on public.presence_kiosk_login_attempts;
create policy "administrators can inspect kiosk login attempts"
on public.presence_kiosk_login_attempts
for select to authenticated
using (public.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN']));

comment on policy "administrators can inspect presence kiosk devices" on public.presence_kiosk_devices is
'Only the Direction/Admin/Pre-admin can inspect registered kiosk devices; raw tokens are never stored.';
comment on policy "administrators can inspect kiosk login attempts" on public.presence_kiosk_login_attempts is
'Only the Direction/Admin/Pre-admin can inspect kiosk abuse and failed-attempt records.';
