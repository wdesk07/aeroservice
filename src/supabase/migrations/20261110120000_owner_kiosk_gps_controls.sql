-- Owner-controlled kiosk schedule, GPS policy and learner assignment.
-- Applied to Aéro Service PRODUCTION only through the verified WDESK owner API.

insert into public.system_settings(key,value,description)
values
  ('kiosk.opening_time','"07:30"'::jsonb,'Heure d’ouverture automatique de la borne (Africa/Porto-Novo)'),
  ('kiosk.closing_time','"19:00"'::jsonb,'Heure de fermeture automatique de la borne (Africa/Porto-Novo)'),
  ('attendance.gps_enabled','false'::jsonb,'Exiger la géolocalisation pour les pointages')
on conflict (key) do nothing;

create or replace function public.kiosk_opening_time()
returns time language sql stable security definer set search_path to ''
as $$
  select coalesce((select (value #>> '{}')::time from public.system_settings where key='kiosk.opening_time'), time '07:30');
$$;

create or replace function public.kiosk_closing_time()
returns time language sql stable security definer set search_path to ''
as $$
  select coalesce((select (value #>> '{}')::time from public.system_settings where key='kiosk.closing_time'), time '19:00');
$$;

create or replace function public.attendance_gps_enabled()
returns boolean language sql stable security definer set search_path to ''
as $$
  select coalesce((select (value #>> '{}')::boolean from public.system_settings where key='attendance.gps_enabled'), false);
$$;

revoke all on function public.kiosk_opening_time() from public, anon;
revoke all on function public.kiosk_closing_time() from public, anon;
revoke all on function public.attendance_gps_enabled() from public, anon;
grant execute on function public.kiosk_opening_time() to authenticated, service_role;
grant execute on function public.kiosk_closing_time() to authenticated, service_role;
grant execute on function public.attendance_gps_enabled() to authenticated, service_role;

create or replace function public.wdesk_owner_update_kiosk_settings(
  p_actor_id uuid,
  p_opening_time text,
  p_closing_time text,
  p_gps_enabled boolean,
  p_reason text,
  p_request_id uuid
) returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare
  v_actor public.profiles%rowtype;
  v_roles text[];
  v_before jsonb;
  v_after jsonb;
  v_open time;
  v_close time;
begin
  if p_actor_id is null or p_request_id is null then raise exception 'OWNER_ACTOR_AND_REQUEST_REQUIRED'; end if;
  if length(trim(coalesce(p_reason,''))) < 8 then raise exception 'OWNER_REASON_REQUIRED'; end if;
  if p_opening_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     or p_closing_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'INVALID_KIOSK_TIME_FORMAT'; end if;
  v_open := p_opening_time::time;
  v_close := p_closing_time::time;
  if v_open >= v_close then raise exception 'KIOSK_OPENING_MUST_PRECEDE_CLOSING'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  if exists(select 1 from public.audit_logs where module='wdesk_production' and new_values->>'request_id'=p_request_id::text) then
    return jsonb_build_object('ok',true,'replayed',true,'request_id',p_request_id);
  end if;
  select * into v_actor from public.profiles where id=p_actor_id for share;
  if not found or lower(coalesce(v_actor.email,'')) <> 'wdesk87@gmail.com' or lower(v_actor.status) <> 'active' then raise exception 'PRODUCTION_OWNER_NOT_VERIFIED'; end if;
  select array_agg(upper(r.code)) into v_roles
  from public.user_roles ur join public.roles r on r.id=ur.role_id where ur.user_id=p_actor_id;
  if not coalesce(v_roles,'{}'::text[]) @> array['DIRECTOR','PRE_ADMIN']::text[] then raise exception 'PRODUCTION_OWNER_ROLES_REQUIRED'; end if;

  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into v_before
  from public.system_settings where key in ('kiosk.opening_time','kiosk.closing_time','attendance.gps_enabled');

  insert into public.system_settings(key,value,description,updated_by,updated_at) values
    ('kiosk.opening_time',to_jsonb(p_opening_time),'Heure d’ouverture automatique de la borne (Africa/Porto-Novo)',p_actor_id,clock_timestamp()),
    ('kiosk.closing_time',to_jsonb(p_closing_time),'Heure de fermeture automatique de la borne (Africa/Porto-Novo)',p_actor_id,clock_timestamp()),
    ('attendance.gps_enabled',to_jsonb(p_gps_enabled),'Exiger la géolocalisation pour les pointages',p_actor_id,clock_timestamp())
  on conflict (key) do update set value=excluded.value,description=excluded.description,updated_by=excluded.updated_by,updated_at=excluded.updated_at;

  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into v_after
  from public.system_settings where key in ('kiosk.opening_time','kiosk.closing_time','attendance.gps_enabled');
  insert into public.audit_logs(actor_id,action,module,entity_type,entity_id,old_values,new_values,visibility)
  values(p_actor_id,'kiosk_settings_update','wdesk_production','kiosk_settings',null,v_before,
    v_after || jsonb_build_object('request_id',p_request_id,'reason',left(trim(p_reason),500)),'business');
  return jsonb_build_object('ok',true,'action','kiosk_settings_update','before',v_before,'after',v_after,'request_id',p_request_id);
end;
$$;

create or replace function public.wdesk_owner_assign_student(
  p_actor_id uuid,
  p_target_id uuid,
  p_formation_id uuid,
  p_group_id uuid,
  p_reason text,
  p_request_id uuid
) returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare
  v_actor public.profiles%rowtype;
  v_roles text[];
  v_student_before jsonb;
  v_student_after jsonb;
  v_registration_before jsonb;
  v_registration_after jsonb;
  v_registration_id uuid;
  v_old jsonb;
  v_new jsonb;
begin
  if p_actor_id is null or p_target_id is null or p_formation_id is null or p_request_id is null then raise exception 'OWNER_ASSIGNMENT_FIELDS_REQUIRED'; end if;
  if length(trim(coalesce(p_reason,''))) < 8 then raise exception 'OWNER_REASON_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  if exists(select 1 from public.audit_logs where module='wdesk_production' and new_values->>'request_id'=p_request_id::text) then
    return jsonb_build_object('ok',true,'replayed',true,'request_id',p_request_id);
  end if;
  select * into v_actor from public.profiles where id=p_actor_id for share;
  if not found or lower(coalesce(v_actor.email,'')) <> 'wdesk87@gmail.com' or lower(v_actor.status) <> 'active' then raise exception 'PRODUCTION_OWNER_NOT_VERIFIED'; end if;
  select array_agg(upper(r.code)) into v_roles
  from public.user_roles ur join public.roles r on r.id=ur.role_id where ur.user_id=p_actor_id;
  if not coalesce(v_roles,'{}'::text[]) @> array['DIRECTOR','PRE_ADMIN']::text[] then raise exception 'PRODUCTION_OWNER_ROLES_REQUIRED'; end if;
  if not exists(select 1 from public.profiles where id=p_target_id and status='active') then raise exception 'ACTIVE_STUDENT_PROFILE_REQUIRED'; end if;
  if not exists(select 1 from public.students where id=p_target_id) then raise exception 'STUDENT_NOT_FOUND'; end if;
  if not exists(select 1 from public.formations where id=p_formation_id and status='active') then raise exception 'ACTIVE_FORMATION_REQUIRED'; end if;
  if p_group_id is not null and not exists(select 1 from public.groups where id=p_group_id and formation_id=p_formation_id and status='active') then raise exception 'GROUP_DOES_NOT_BELONG_TO_FORMATION'; end if;

  select to_jsonb(s) into v_student_before from public.students s where s.id=p_target_id for update;
  select id,to_jsonb(r) into v_registration_id,v_registration_before
  from public.registrations r where r.person_id=p_target_id and r.status='approved'
  order by r.created_at desc limit 1 for update;

  update public.students set formation_id=p_formation_id,group_id=p_group_id,updated_at=clock_timestamp()
  where id=p_target_id returning to_jsonb(public.students.*) into v_student_after;

  if v_registration_id is not null then
    update public.registrations set formation_id=p_formation_id,group_id=p_group_id,updated_at=clock_timestamp()
    where id=v_registration_id returning to_jsonb(public.registrations.*) into v_registration_after;
  end if;

  v_old := jsonb_build_object('student',v_student_before,'registration',v_registration_before);
  v_new := jsonb_build_object('student',v_student_after,'registration',v_registration_after);
  insert into public.audit_logs(actor_id,action,module,entity_type,entity_id,old_values,new_values,visibility)
  values(p_actor_id,'student_assignment_update','wdesk_production','student',p_target_id,v_old,
    v_new || jsonb_build_object('request_id',p_request_id,'reason',left(trim(p_reason),500)),'business');
  return jsonb_build_object('ok',true,'action','student_assignment_update','entity_id',p_target_id,'before',v_old,'after',v_new,'request_id',p_request_id);
end;
$$;

revoke all on function public.wdesk_owner_update_kiosk_settings(uuid,text,text,boolean,text,uuid) from public, anon, authenticated;
revoke all on function public.wdesk_owner_assign_student(uuid,uuid,uuid,uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.wdesk_owner_update_kiosk_settings(uuid,text,text,boolean,text,uuid) to service_role;
grant execute on function public.wdesk_owner_assign_student(uuid,uuid,uuid,uuid,text,uuid) to service_role;

-- Make the existing kiosk time windows read the owner-controlled values.
do $$
declare r record; v_definition text;
begin
  for r in
    select p.oid, p.proname, pg_get_functiondef(p.oid) as definition
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'close_operating_day','close_operating_day_and_revoke_kiosk','is_presence_kiosk_active',
      'kiosk_daily_checkin','qr_daily_checkin','request_personnel_qr_checkin_with_gps',
      'request_personnel_qr_checkin_without_gps','request_qr_checkin','request_qr_checkin_without_gps'
    )
  loop
    v_definition := replace(r.definition, 'time ''07:30''', 'public.kiosk_opening_time()');
    v_definition := replace(v_definition, 'time ''19:00''', 'public.kiosk_closing_time()');
    if v_definition <> r.definition then execute v_definition; end if;
  end loop;
end;
$$;

-- Enforce the selected GPS policy in both mobile QR routes.
do $$
declare v_definition text;
begin
  select pg_get_functiondef('public.request_qr_checkin_without_gps()'::regprocedure) into v_definition;
  v_definition := replace(v_definition,
    $old$if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;$old$,
    $new$if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if public.attendance_gps_enabled() and coalesce(current_setting('app.gps_verified',true),'') <> 'true' then raise exception 'GPS_REQUIRED'; end if;$new$);
  execute v_definition;

  select pg_get_functiondef('public.request_personnel_qr_checkin_without_gps()'::regprocedure) into v_definition;
  v_definition := replace(v_definition,
    $old$if u is null then raise exception 'AUTH_REQUIRED'; end if;$old$,
    $new$if u is null then raise exception 'AUTH_REQUIRED'; end if;
  if public.attendance_gps_enabled() then raise exception 'GPS_REQUIRED'; end if;$new$);
  execute v_definition;

  select pg_get_functiondef('public.request_qr_checkin_with_gps(numeric,numeric,numeric)'::regprocedure) into v_definition;
  v_definition := replace(v_definition,
    $old$begin
  if v_uid is null then$old$,
    $new$begin
  if not public.attendance_gps_enabled() then return public.request_qr_checkin_without_gps() || jsonb_build_object('gps_required',false,'gps_verified',false); end if;
  if v_uid is null then$new$);
  v_definition := replace(v_definition, 'v_result := public.request_qr_checkin();', 'perform set_config(''app.gps_verified'',''true'',true); v_result := public.request_qr_checkin_without_gps();');
  execute v_definition;

  select pg_get_functiondef('public.request_personnel_qr_checkin_with_gps(numeric,numeric,numeric)'::regprocedure) into v_definition;
  v_definition := replace(v_definition,
    $old$begin
  if u is null then$old$,
    $new$begin
  if not public.attendance_gps_enabled() then return public.request_personnel_qr_checkin_without_gps() || jsonb_build_object('gps_required',false,'gps_verified',false); end if;
  if u is null then$new$);
  execute v_definition;

  select pg_get_functiondef('public.qr_checkin(uuid,text,numeric,numeric,numeric)'::regprocedure) into v_definition;
  v_definition := replace(v_definition,
    $old$begin
  if v_uid is null then$old$,
    $new$begin
  if public.attendance_gps_enabled() and (p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 or p_accuracy_m is null or p_accuracy_m <= 0 or p_accuracy_m > 100) then raise exception 'GPS_REQUIRED'; end if;
  if not public.attendance_gps_enabled() then p_lat := null; p_lng := null; p_accuracy_m := null; end if;
  if v_uid is null then$new$);
  execute v_definition;
end;
$$;

-- The fixed kiosk uses the same owner-controlled geofence when GPS is enabled.
do $$
declare v_definition text;
begin
  select pg_get_functiondef('public.kiosk_daily_checkin(text,numeric,numeric,numeric)'::regprocedure) into v_definition;
  v_definition := replace(v_definition,
    $old$  v_date := v_local::date;
  IF v_local::time < public.kiosk_opening_time()$old$,
    $new$  v_date := v_local::date;
  IF public.attendance_gps_enabled() THEN
    IF p_lat IS NULL OR p_lng IS NULL OR p_accuracy_m IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 OR p_accuracy_m <= 0 OR p_accuracy_m > 100 THEN RAISE EXCEPTION 'GPS_REQUIRED_OR_INACCURATE'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.checkpoints c WHERE c.active AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL) THEN RAISE EXCEPTION 'CENTRE_GPS_NOT_CONFIGURED'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.checkpoints c WHERE c.active AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL AND 6371000 * 2 * asin(sqrt(power(sin(radians(p_lat-c.latitude)/2),2)+cos(radians(c.latitude))*cos(radians(p_lat))*power(sin(radians(p_lng-c.longitude)/2),2))) <= coalesce(c.radius_m,100) AND p_accuracy_m <= coalesce(c.radius_m,100)) THEN RAISE EXCEPTION 'OUTSIDE_CHECKPOINT_RADIUS'; END IF;
  END IF;
  IF v_local::time < public.kiosk_opening_time()$new$);
  if v_definition not like '%attendance_gps_enabled()%' then raise exception 'KIOSK_GPS_PATCH_ANCHOR_NOT_FOUND'; end if;
  execute v_definition;
end;
$$;
