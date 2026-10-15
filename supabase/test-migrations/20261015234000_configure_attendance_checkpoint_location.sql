-- Allow only Director/Admin/Pre-admin to register the center's GPS geofence.
create or replace function public.set_attendance_checkpoint_location(
  p_latitude numeric,
  p_longitude numeric,
  p_radius_m integer default 100
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (
    select 1 from public.user_roles ur join public.roles r on r.id=ur.role_id
    where ur.user_id=v_uid and upper(r.code) in ('DIRECTOR','ADMIN','PRE_ADMIN')
  ) then raise exception 'CHECKPOINT_CONFIG_FORBIDDEN'; end if;
  if p_latitude is null or p_longitude is null
    or p_latitude < -90 or p_latitude > 90
    or p_longitude < -180 or p_longitude > 180 then
    raise exception 'INVALID_CHECKPOINT_COORDINATES';
  end if;
  if p_radius_m is null or p_radius_m < 25 or p_radius_m > 500 then
    raise exception 'INVALID_CHECKPOINT_RADIUS';
  end if;

  update public.checkpoints
    set latitude=p_latitude,longitude=p_longitude,radius_m=p_radius_m,active=true
  where code='AERO_ENTRANCE';
  if not found then
    insert into public.checkpoints(code,name,type,latitude,longitude,radius_m,active)
    values('AERO_ENTRANCE','Entrée Aéro Service','entrance',p_latitude,p_longitude,p_radius_m,true);
  end if;
  return jsonb_build_object('ok',true,'checkpoint','AERO_ENTRANCE','radius_m',p_radius_m);
end;
$function$;
revoke all on function public.set_attendance_checkpoint_location(numeric,numeric,integer) from public, anon;
grant execute on function public.set_attendance_checkpoint_location(numeric,numeric,integer) to authenticated;
