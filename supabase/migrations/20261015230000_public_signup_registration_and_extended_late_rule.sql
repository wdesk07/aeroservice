-- TEST/production migration: create a real pending registration for public learner signups.
-- Signup must never claim a request was sent when only an Auth user exists.
create or replace function public.handle_public_learner_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_formation_id uuid;
  v_display_name text;
  v_first_name text;
  v_last_name text;
  v_registration_number text;
begin
  if coalesce(v_meta->>'signup_flow','') <> 'public_learner' then
    return new;
  end if;

  if coalesce(v_meta->>'formation_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'ACTIVE_FORMATION_REQUIRED';
  end if;
  v_formation_id := (v_meta->>'formation_id')::uuid;
  if not exists (
    select 1 from public.formations f
    where f.id = v_formation_id and lower(coalesce(f.status,'active')) = 'active'
  ) then
    raise exception 'ACTIVE_FORMATION_REQUIRED';
  end if;

  v_display_name := nullif(trim(coalesce(v_meta->>'display_name','')), '');
  v_first_name := nullif(trim(coalesce(v_meta->>'first_name','')), '');
  v_last_name := nullif(trim(coalesce(v_meta->>'last_name','')), '');
  if v_display_name is null then
    v_display_name := trim(concat_ws(' ', v_first_name, v_last_name));
  end if;

  insert into public.profiles(id,email,display_name,first_name,last_name,status)
  values(new.id,new.email,v_display_name,v_first_name,v_last_name,'pending')
  on conflict (id) do update set
    email = excluded.email,
    display_name = coalesce(public.profiles.display_name, excluded.display_name),
    first_name = coalesce(public.profiles.first_name, excluded.first_name),
    last_name = coalesce(public.profiles.last_name, excluded.last_name),
    status = case when lower(coalesce(public.profiles.status,'')) = 'active' then 'active' else 'pending' end;

  v_registration_number := 'AS-' || extract(year from current_date)::text || '-' ||
    upper(substr(replace(new.id::text,'-',''),1,8));

  if not exists (select 1 from public.registrations r where r.person_id = new.id) then
    insert into public.registrations(
      registration_number,person_id,formation_id,registration_date,status,submitted_at
    ) values (
      v_registration_number,new.id,v_formation_id,current_date,'submitted',clock_timestamp()
    );
  end if;

  return new;
end;
$function$;

drop trigger if exists on_public_learner_signup on auth.users;
create trigger on_public_learner_signup
after insert on auth.users
for each row execute function public.handle_public_learner_signup();

-- Repair existing public signups that were created before the trigger existed.
do $backfill$
declare
  u record;
  v_formation_id uuid;
  v_display_name text;
  v_first_name text;
  v_last_name text;
begin
  for u in
    select au.id, au.email, au.raw_user_meta_data
    from auth.users au
    where au.raw_user_meta_data->>'signup_flow' = 'public_learner'
      and not exists (select 1 from public.registrations r where r.person_id = au.id)
  loop
    if coalesce(u.raw_user_meta_data->>'formation_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_formation_id := (u.raw_user_meta_data->>'formation_id')::uuid;
    else
      continue;
    end if;
    if not exists (select 1 from public.formations f where f.id=v_formation_id and lower(coalesce(f.status,'active'))='active') then
      continue;
    end if;

    v_display_name := nullif(trim(coalesce(u.raw_user_meta_data->>'display_name','')), '');
    v_first_name := nullif(trim(coalesce(u.raw_user_meta_data->>'first_name','')), '');
    v_last_name := nullif(trim(coalesce(u.raw_user_meta_data->>'last_name','')), '');
    if v_display_name is null then v_display_name := trim(concat_ws(' ',v_first_name,v_last_name)); end if;

    insert into public.profiles(id,email,display_name,first_name,last_name,status)
    values(u.id,u.email,v_display_name,v_first_name,v_last_name,'pending')
    on conflict (id) do nothing;

    insert into public.registrations(registration_number,person_id,formation_id,registration_date,status,submitted_at)
    values(
      'AS-' || extract(year from current_date)::text || '-' || upper(substr(replace(u.id::text,'-',''),1,8)),
      u.id,v_formation_id,current_date,'submitted',clock_timestamp()
    ) on conflict do nothing;
  end loop;
end;
$backfill$;

-- The Director's confirmed rule is 2,000 FCFA for every delay above 30 minutes,
-- including delays above 60 minutes; extend the existing 31–60 minute rule.
update public.penalty_rules
set max_delay_minutes = null
where active = true
  and penalty_type = 'late_arrival'
  and application_mode = 'automatic'
  and target_scope in ('students','all')
  and min_delay_minutes = 31
  and max_delay_minutes = 60
  and amount_fcfa = 2000;
