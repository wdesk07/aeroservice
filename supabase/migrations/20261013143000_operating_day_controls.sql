-- Aéro Service: controlled opening and closing of the establishment.
-- Safe to commit to the feature branch; do not apply to production before testing.
create table if not exists public.operating_days (
  business_date date primary key,
  status text not null default 'closed' check (status in ('open','closed')),
  opened_at timestamptz,
  opened_by uuid references auth.users(id) on delete restrict,
  closed_at timestamptz,
  closed_by uuid references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  check ((status = 'closed') or (opened_at is not null and opened_by is not null))
);

alter table public.operating_days enable row level security;
revoke all on public.operating_days from anon, authenticated;
grant select on public.operating_days to authenticated;

drop policy if exists "operating day read authorized roles" on public.operating_days;
create policy "operating day read authorized roles"
  on public.operating_days for select to authenticated
  using (
    private.is_admin_actor()
    or private.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN','SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE','STAFF','PERSONNEL'])
  );

create or replace function public.get_operating_day_status()
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_today date := (now() at time zone 'Africa/Porto-Novo')::date;
  v_row public.operating_days%rowtype;
begin
  if auth.uid() is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;
  if not (
    private.is_admin_actor()
    or private.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN','SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE','STAFF','PERSONNEL'])
  ) then
    raise exception 'OPERATING_STATUS_FORBIDDEN';
  end if;

  select * into v_row from public.operating_days where business_date = v_today;
  if not found then
    return jsonb_build_object(
      'business_date', v_today,
      'status', 'not_opened',
      'opened_at', null,
      'opened_by', null,
      'closed_at', null,
      'closed_by', null,
      'local_time', to_char(now() at time zone 'Africa/Porto-Novo', 'HH24:MI:SS')
    );
  end if;
  return jsonb_build_object(
    'business_date', v_row.business_date,
    'status', v_row.status,
    'opened_at', v_row.opened_at,
    'opened_by', v_row.opened_by,
    'closed_at', v_row.closed_at,
    'closed_by', v_row.closed_by,
    'local_time', to_char(now() at time zone 'Africa/Porto-Novo', 'HH24:MI:SS')
  );
end;
$$;

create or replace function public.operate_aero_service(p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_today date := (now() at time zone 'Africa/Porto-Novo')::date;
  v_user uuid := auth.uid();
  v_row public.operating_days%rowtype;
begin
  if v_user is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;
  if lower(coalesce(p_action, '')) not in ('open','close') then
    raise exception 'INVALID_OPERATING_ACTION';
  end if;

  -- Only management and the pre-approved secretariat can perform these actions.
  -- Regular personnel, teachers and learners cannot open/close the establishment.
  if not (
    private.is_admin_actor()
    or private.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN','SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE'])
  ) then
    raise exception 'OPERATING_ACTION_FORBIDDEN';
  end if;

  insert into public.operating_days (business_date, status)
  values (v_today, 'closed')
  on conflict (business_date) do nothing;

  select * into v_row
  from public.operating_days
  where business_date = v_today
  for update;

  if lower(p_action) = 'open' then
    if v_row.opened_at is not null and v_row.closed_at is null then
      raise exception 'ALREADY_OPEN';
    end if;
    if v_row.closed_at is not null then
      raise exception 'ALREADY_CLOSED_TODAY';
    end if;
    update public.operating_days
      set status = 'open', opened_at = now(), opened_by = v_user,
          updated_at = now()
      where business_date = v_today
      returning * into v_row;
  else
    if v_row.opened_at is null then
      raise exception 'NOT_OPENED_YET';
    end if;
    if v_row.closed_at is not null then
      raise exception 'ALREADY_CLOSED';
    end if;
    update public.operating_days
      set status = 'closed', closed_at = now(), closed_by = v_user,
          updated_at = now()
      where business_date = v_today
      returning * into v_row;
  end if;

  return jsonb_build_object(
    'business_date', v_row.business_date,
    'status', v_row.status,
    'opened_at', v_row.opened_at,
    'opened_by', v_row.opened_by,
    'closed_at', v_row.closed_at,
    'closed_by', v_row.closed_by,
    'local_time', to_char(now() at time zone 'Africa/Porto-Novo', 'HH24:MI:SS')
  );
end;
$$;

revoke all on function public.get_operating_day_status() from public, anon;
revoke all on function public.operate_aero_service(text) from public, anon;
grant execute on function public.get_operating_day_status() to authenticated;
grant execute on function public.operate_aero_service(text) to authenticated;

comment on table public.operating_days is 'Historique journalier de l’ouverture et de la fermeture d’Aéro Service. Une seule ligne par date locale, sans suppression d’historique.';
