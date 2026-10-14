-- Grant the authenticated Supabase role the table privileges needed by the
-- payments module. Row-level security policies remain enabled and continue
-- to determine which rows can be read or changed by each user's role.
grant select, insert, update on table public.payments to authenticated;
