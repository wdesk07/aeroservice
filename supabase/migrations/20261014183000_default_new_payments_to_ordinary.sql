-- Avoid classifying inserts that omit payment_type as penalty payments.
-- Penalty payments must explicitly reference a pending penalty; existing guards remain in force.
alter table public.payments alter column payment_type set default 'ordinary';
