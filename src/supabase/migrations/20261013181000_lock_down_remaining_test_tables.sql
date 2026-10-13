-- Restrict remaining exposed test tables and give finance modules role-aware access.
alter table public.payments enable row level security;
drop policy if exists "authorized finance staff can read payments" on public.payments;
create policy "authorized finance staff can read payments" on public.payments for select to authenticated
using (person_id = (select auth.uid()) or public.has_any_role(array['ACCOUNTING','FINANCE','SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE','DIRECTOR','ADMIN','PRE_ADMIN']));
drop policy if exists "authorized finance staff can record payments" on public.payments;
create policy "authorized finance staff can record payments" on public.payments for insert to authenticated
with check (public.has_any_role(array['ACCOUNTING','FINANCE','SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE','DIRECTOR','ADMIN','PRE_ADMIN']));
drop policy if exists "authorized finance staff can validate payments" on public.payments;
create policy "authorized finance staff can validate payments" on public.payments for update to authenticated
using (public.has_any_role(array['ACCOUNTING','FINANCE','SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE','DIRECTOR','ADMIN','PRE_ADMIN']))
with check (public.has_any_role(array['ACCOUNTING','FINANCE','SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE','DIRECTOR','ADMIN','PRE_ADMIN']));

alter table public.penalties enable row level security;
drop policy if exists "authorized staff or person can read penalties" on public.penalties;
create policy "authorized staff or person can read penalties" on public.penalties for select to authenticated
using (person_id = (select auth.uid()) or public.has_any_role(array['ACCOUNTING','FINANCE','SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE','DIRECTOR','ADMIN','PRE_ADMIN']));
drop policy if exists "director admin can create penalties" on public.penalties;
create policy "director admin can create penalties" on public.penalties for insert to authenticated
with check (public.has_any_role(array['DIRECTOR','ADMIN']));
drop policy if exists "director admin can update penalties" on public.penalties;
create policy "director admin can update penalties" on public.penalties for update to authenticated
using (public.has_any_role(array['DIRECTOR','ADMIN']))
with check (public.has_any_role(array['DIRECTOR','ADMIN']));

alter table public.checkpoints enable row level security;
drop policy if exists "administrators can read checkpoints" on public.checkpoints;
create policy "administrators can read checkpoints" on public.checkpoints for select to authenticated
using (public.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN']));

alter table public.course_sessions enable row level security;
drop policy if exists "authorized education staff can read course sessions" on public.course_sessions;
create policy "authorized education staff can read course sessions" on public.course_sessions for select to authenticated
using (public.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN','PEDAGOGY','TEACHER','SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE']));
drop policy if exists "authorized education staff can manage course sessions" on public.course_sessions;
create policy "authorized education staff can manage course sessions" on public.course_sessions for all to authenticated
using (public.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN','PEDAGOGY']))
with check (public.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN','PEDAGOGY']));

alter table public.attendance_events enable row level security;
drop policy if exists "authorized staff can read attendance events" on public.attendance_events;
create policy "authorized staff can read attendance events" on public.attendance_events for select to authenticated
using (public.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN','SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE','STAFF','PERSONNEL','TEACHER','ENSEIGNANT']));

alter table public.notifications enable row level security;
drop policy if exists "recipients can read own notifications" on public.notifications;
create policy "recipients can read own notifications" on public.notifications for select to authenticated
using (recipient_id = (select auth.uid()));
