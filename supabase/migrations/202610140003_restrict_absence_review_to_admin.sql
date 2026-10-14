-- Restrict absence justification decisions to authorized administration only.
-- Grant the SQL privilege required for RLS to evaluate the row-level policy.
grant update on table public.absence_justifications to authenticated;

drop policy if exists "absence justifications review authorized" on public.absence_justifications;
drop policy if exists "absence justifications review administrators only" on public.absence_justifications;
create policy "absence justifications review administrators only" on public.absence_justifications
  for update to authenticated
  using (public.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN']::text[]))
  with check (
    public.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN']::text[])
    and status in ('approved','rejected','pending')
  );
