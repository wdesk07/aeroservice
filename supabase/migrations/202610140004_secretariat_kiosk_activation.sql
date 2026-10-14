-- Allow the authorized secretariat to activate/renew the attendance kiosk.
-- The kiosk token remains generated and hashed server-side; the raw token is returned once.
create or replace function public.activate_presence_kiosk(p_name text default 'Borne principale')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_token text;
  v_device_id uuid;
  v_name text := left(trim(coalesce(p_name, 'Borne principale')), 80);
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.has_any_role(array[
    'DIRECTOR','ADMIN','PRE_ADMIN',
    'SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE'
  ]::text[]) then
    raise exception 'KIOSK_ADMIN_OR_SECRETARIAT_REQUIRED';
  end if;
  if v_name = '' then v_name := 'Borne principale'; end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.presence_kiosk_devices(name, token_hash, activated_by)
  values (v_name, encode(extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'), 'hex'), v_uid)
  returning id into v_device_id;

  return jsonb_build_object(
    'ok', true,
    'device_id', v_device_id,
    'device_name', v_name,
    'device_token', v_token,
    'activated_at', now()
  );
end;
$function$;

revoke all on function public.activate_presence_kiosk(text) from public, anon;
grant execute on function public.activate_presence_kiosk(text) to authenticated;
