-- TEST only: distinguish a persistent registered kiosk from its current time-window availability.
create or replace function public.is_presence_kiosk_registered(p_device_token text)
returns boolean
language sql
security definer
set search_path = ''
as $function$
  select coalesce(
    p_device_token is not null
    and length(p_device_token) >= 40
    and exists (
      select 1
      from public.presence_kiosk_devices d
      where d.token_hash = encode(extensions.digest(convert_to(p_device_token, 'UTF8'), 'sha256'), 'hex')
        and d.revoked_at is null
    ),
    false
  );
$function$;
revoke all on function public.is_presence_kiosk_registered(text) from public;
grant execute on function public.is_presence_kiosk_registered(text) to anon, authenticated;
