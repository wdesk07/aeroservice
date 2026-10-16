-- TEST ONLY: decouple kiosk hours from the administrative opening/closing of Aéro Service.
-- Kiosk availability is automatic 08:30-19:00 Africa/Porto-Novo.
-- Center operations are manual and audited separately.

create table if not exists public.center_operation_audit (
  id uuid primary key default gen_random_uuid(),
  business_date date not null,
  action text not null check (action in ('opened','closed')),
  actor_id uuid not null references auth.users(id),
  occurred_at timestamptz not null default clock_timestamp(),
  timezone text not null default 'Africa/Porto-Novo',
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists center_operation_audit_date_idx
  on public.center_operation_audit (business_date desc, occurred_at desc);
alter table public.center_operation_audit enable row level security;
revoke all on public.center_operation_audit from anon, authenticated;

create or replace function public.open_aero_center()
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_local timestamp without time zone;
  v_date date;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN','SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE','STAFF','PERSONNEL']::text[]) then
    raise exception 'CENTER_OPERATION_NOT_ALLOWED';
  end if;
  v_local := v_now at time zone 'Africa/Porto-Novo';
  v_date := v_local::date;
  insert into public.operating_days(business_date,status,opened_at,opened_by,closed_at,closed_by,updated_at)
  values(v_date,'open',v_now,v_uid,null,null,v_now)
  on conflict (business_date) do update set
    status='open', opened_at=v_now, opened_by=v_uid,
    closed_at=null, closed_by=null, updated_at=v_now;
  insert into public.center_operation_audit(business_date,action,actor_id,occurred_at)
  values(v_date,'opened',v_uid,v_now);
  return jsonb_build_object('ok',true,'status','open','business_date',v_date,'occurred_at',v_now,'timezone','Africa/Porto-Novo');
end;
$function$;

create or replace function public.close_aero_center()
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_local timestamp without time zone;
  v_date date;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN','SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE','STAFF','PERSONNEL']::text[]) then
    raise exception 'CENTER_OPERATION_NOT_ALLOWED';
  end if;
  v_local := v_now at time zone 'Africa/Porto-Novo';
  v_date := v_local::date;
  update public.operating_days set status='closed',closed_at=v_now,closed_by=v_uid,updated_at=v_now
   where business_date=v_date and status='open';
  if not found then raise exception 'CENTER_NOT_OPEN'; end if;
  insert into public.center_operation_audit(business_date,action,actor_id,occurred_at)
  values(v_date,'closed',v_uid,v_now);
  return jsonb_build_object('ok',true,'status','closed','business_date',v_date,'occurred_at',v_now,'timezone','Africa/Porto-Novo');
end;
$function$;

create or replace function public.get_center_operation_audit(p_limit integer default 50)
returns table(id uuid,business_date date,action text,actor_id uuid,actor_email text,occurred_at timestamptz)
language plpgsql security definer set search_path = ''
as $function$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN']::text[]) then raise exception 'CENTER_AUDIT_DIRECTOR_ONLY'; end if;
  return query
    select a.id,a.business_date,a.action,a.actor_id,u.email,a.occurred_at
    from public.center_operation_audit a
    left join auth.users u on u.id=a.actor_id
    order by a.occurred_at desc
    limit greatest(1,least(coalesce(p_limit,50),200));
end;
$function$;

revoke all on function public.open_aero_center() from public, anon;
revoke all on function public.close_aero_center() from public, anon;
revoke all on function public.get_center_operation_audit(integer) from public, anon;
grant execute on function public.open_aero_center() to authenticated;
grant execute on function public.close_aero_center() to authenticated;
grant execute on function public.get_center_operation_audit(integer) to authenticated;

-- The registered kiosk token remains valid independently of center status.
create or replace function public.is_presence_kiosk_active(p_device_token text)
returns boolean language sql security definer set search_path = ''
as $function$
  select coalesce(
    p_device_token is not null
    and length(p_device_token) >= 40
    and (clock_timestamp() at time zone 'Africa/Porto-Novo')::time >= time '08:30'
    and (clock_timestamp() at time zone 'Africa/Porto-Novo')::time < time '19:00'
    and exists (
      select 1 from public.presence_kiosk_devices d
      where d.token_hash=encode(extensions.digest(convert_to(p_device_token,'UTF8'),'sha256'),'hex')
        and d.revoked_at is null
    ), false
  );
$function$;
revoke all on function public.is_presence_kiosk_active(text) from public;
grant execute on function public.is_presence_kiosk_active(text) to anon, authenticated;


-- Preserve the latest TEST check-in function (including session/penalty/personnel fixes),
-- changing only the kiosk operating-hours gate.
do $migration$
declare
  v_definition text;
  v_old text;
  v_new text;
begin
  v_definition := pg_get_functiondef('public.kiosk_daily_checkin(text,numeric,numeric,numeric)'::regprocedure);
  v_old := 'if loc::time>=time ''19:00'' then raise exception ''STUDENT_CHECKIN_CLOSED''; end if;';
  v_new := 'if loc::time < time ''08:30'' or loc::time >= time ''19:00'' then raise exception ''STUDENT_CHECKIN_CLOSED''; end if;';
  if position(v_old in v_definition) = 0 then
    raise exception 'Expected kiosk close-time check not found; refusing to replace the current check-in function';
  end if;
  v_definition := replace(v_definition, v_old, v_new);
  v_old := 'if not exists(select 1 from public.operating_days od where od.business_date=dt and od.status=''open'') then raise exception ''OPERATING_DAY_CLOSED''; end if;';
  v_definition := replace(v_definition, v_old, '-- Center opening/closing is audited separately; it does not gate student check-in.');
  execute v_definition;
end;
$migration$;
