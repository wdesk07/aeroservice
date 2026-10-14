-- Allow an authenticated learner to read only course sessions assigned to their own group or formation.
-- This does not grant access to create, update, or delete sessions.
create policy "students can read assigned course sessions"
on public.course_sessions
for select
to authenticated
using (
  exists (
    select 1
    from public.students s
    where s.id = auth.uid()
      and (
        course_sessions.group_id = s.group_id
        or (course_sessions.group_id is null and course_sessions.formation_id = s.formation_id)
      )
  )
);
