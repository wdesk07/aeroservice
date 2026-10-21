create table if not exists public.director_agenda_events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 2 and 160),
  event_type text not null default 'other' check (event_type in ('programme','meeting','exam','defense','ceremony','deadline','reminder','other')),
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  reminder_at timestamptz,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint director_agenda_event_dates check (ends_at is null or ends_at >= starts_at)
);
create index if not exists director_agenda_events_starts_at_idx on public.director_agenda_events(starts_at);
create index if not exists director_agenda_events_reminder_at_idx on public.director_agenda_events(reminder_at);
alter table public.director_agenda_events enable row level security;
grant select, insert, update, delete on public.director_agenda_events to authenticated;
drop policy if exists director_agenda_read on public.director_agenda_events;
create policy director_agenda_read on public.director_agenda_events for select to authenticated
using (public.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN']::text[]));
drop policy if exists director_agenda_insert on public.director_agenda_events;
create policy director_agenda_insert on public.director_agenda_events for insert to authenticated
with check (created_by = auth.uid() and public.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN']::text[]));
drop policy if exists director_agenda_update on public.director_agenda_events;
create policy director_agenda_update on public.director_agenda_events for update to authenticated
using (public.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN']::text[]))
with check (created_by = auth.uid() and public.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN']::text[]));
drop policy if exists director_agenda_delete on public.director_agenda_events;
create policy director_agenda_delete on public.director_agenda_events for delete to authenticated
using (public.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN']::text[]));
