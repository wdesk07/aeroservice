-- Apply to the TEST Supabase project first. This table stores manual observations
-- for review; it does not automatically create official attendance or penalties.
create table if not exists public.attendance_offline_events (
  id uuid primary key default gen_random_uuid(),
  client_event_id uuid not null unique,
  person_identifier text not null check (length(trim(person_identifier)) between 1 and 120),
  person_name text not null check (length(trim(person_name)) between 1 and 160),
  observed_at timestamptz not null,
  reason text not null check (length(trim(reason)) between 3 and 500),
  device_label text not null default 'Borne officielle',
  created_by uuid references auth.users(id) on delete set null,
  review_status text not null default 'pending_review' check (review_status in ('pending_review','approved','rejected')),
  review_note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  received_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists attendance_offline_events_received_at_idx on public.attendance_offline_events (received_at desc);
create index if not exists attendance_offline_events_review_status_idx on public.attendance_offline_events (review_status, received_at desc);
alter table public.attendance_offline_events enable row level security;
grant select, insert on public.attendance_offline_events to authenticated;
drop policy if exists attendance_offline_events_staff_insert on public.attendance_offline_events;
create policy attendance_offline_events_staff_insert on public.attendance_offline_events for insert to authenticated
with check (created_by = auth.uid() and public.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN','SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE']::text[]));
drop policy if exists attendance_offline_events_staff_read on public.attendance_offline_events;
create policy attendance_offline_events_staff_read on public.attendance_offline_events for select to authenticated
using (public.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN','SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE']::text[]));
