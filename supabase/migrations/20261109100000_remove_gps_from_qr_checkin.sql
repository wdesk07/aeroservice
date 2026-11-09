-- Remove GPS as a prerequisite for learner QR check-in only.
-- Keep the existing pending-confirmation workflow intact:
-- the request is still reviewed physically by the secretary before attendance
-- and any related penalty are finalized.
--
-- The legacy GPS RPC signature is retained for compatibility with older clients.
-- GPS inputs are intentionally ignored; the established request function remains
-- the single source of truth for identity, schedule, duplicate, throttle and timing rules.

create or replace function public.request_qr_checkin_with_gps(
  p_latitude numeric,
  p_longitude numeric,
  p_accuracy_m numeric
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  return public.request_qr_checkin();
end;
$function$;

revoke all on function public.request_qr_checkin_with_gps(numeric,numeric,numeric)
  from public, anon;
grant execute on function public.request_qr_checkin_with_gps(numeric,numeric,numeric)
  to authenticated;

notify pgrst, 'reload schema';
