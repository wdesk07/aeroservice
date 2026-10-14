-- Grant authenticated users the table privileges needed to load the penalties module.
-- Row-level security remains enabled and policies continue to restrict visible and writable rows.
grant select, insert, update on table public.penalties to authenticated;
