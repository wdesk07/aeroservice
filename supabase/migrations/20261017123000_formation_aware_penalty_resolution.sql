CREATE OR REPLACE FUNCTION private.guard_attendance_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_session public.course_sessions%rowtype;
  v_person_type text;
  v_delay integer;
  v_penalty record;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if new.person_id <> (select auth.uid())
     and not public.is_admin_actor()
     and not public.has_any_role(ARRAY['SECRETARIAT','TEACHER','PEDAGOGY'])
  then raise exception 'Unauthorized attendance actor'; end if;

  select * into v_session from public.course_sessions where id=new.session_id;
  if not found then raise exception 'Session not found'; end if;

  if exists(select 1 from public.students where id=new.person_id) then
    v_person_type := 'student';
  elsif exists(select 1 from public.teachers where id=new.person_id) then
    v_person_type := 'teacher';
  elsif exists(select 1 from public.staff where id=new.person_id) then
    v_person_type := 'staff';
  elsif public.has_any_role(ARRAY['SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE','DIRECTOR','ADMIN','PRE_ADMIN','STAFF','PERSONNEL','ACCOUNTING','FINANCE']) then
    v_person_type := 'staff';
  else raise exception 'Person is not registered'; end if;

  new.person_type := v_person_type;
  new.planned_at := v_session.planned_start;
  if new.status='absent' and new.arrived_at is null and lower(coalesce(new.source,''))='kiosk' then
    new.delay_minutes := 0;
    new.access_blocked := true;
    new.created_at := coalesce(new.created_at,now());
    new.updated_at := now();
    return new;
  end if;
  new.arrived_at := coalesce(new.arrived_at,clock_timestamp());
  v_delay := greatest(0,floor(extract(epoch from (new.arrived_at-v_session.planned_start))/60)::integer);
  new.delay_minutes := v_delay;
  -- The kiosk's agreed grace period is 15 minutes: 09:15 is on time, 09:16 is late.
  new.status := case when (v_person_type='staff' and v_delay <= 10) or (v_person_type<>'staff' and v_delay <= 15) then 'on_time' else 'late' end;
  new.access_blocked := false;

  if new.status='late' then
    select pr.id as rule_id,pr.amount_fcfa,pr.blocks_access into v_penalty
    from public.penalty_rules pr
    where pr.active and pr.penalty_type='late_arrival' and pr.application_mode='automatic'
      and (pr.formation_id=v_session.formation_id or pr.formation_id is null)
      and (pr.target_scope='all'
        or (v_person_type='student' and pr.target_scope='students')
        or (v_person_type='staff' and pr.target_scope='staff')
        or (v_person_type='teacher' and pr.target_scope='teacher'))
      and v_delay > greatest(coalesce(pr.tolerance_minutes,0),0)
      and v_delay between pr.min_delay_minutes and coalesce(pr.max_delay_minutes,2147483647)
      and (pr.applies_after_time is null or (new.arrived_at at time zone 'Africa/Porto-Novo')::time > pr.applies_after_time)
      and (pr.effective_from is null or new.arrived_at>=pr.effective_from)
      and (pr.effective_until is null or new.arrived_at<=pr.effective_until)
    order by (pr.formation_id is not null) desc,
      case when (v_person_type='student' and pr.target_scope='students') or (v_person_type='staff' and pr.target_scope='staff') or (v_person_type='teacher' and pr.target_scope='teacher') then 0 else 1 end,
      pr.priority asc,pr.min_delay_minutes desc,pr.created_at desc
    limit 1;
    if found then new.access_blocked := coalesce(v_penalty.blocks_access,false); end if;
  end if;

  new.created_at := coalesce(new.created_at,now());
  new.updated_at := now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.after_attendance_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_penalty record; v_formation_id uuid;
begin
  if new.status='absent' and new.arrived_at is null then
    insert into public.attendance_events(attendance_id,person_id,event_type,occurred_at,source,metadata,created_by)
    values(new.id,new.person_id,'absence_detected',clock_timestamp(),new.source,jsonb_build_object('session_id',new.session_id,'status','absent'),auth.uid());
    return new;
  end if;
  insert into public.attendance_events(attendance_id,person_id,event_type,occurred_at,source,metadata,created_by)
  values(new.id,new.person_id,'pointage',new.arrived_at,new.source,
    jsonb_build_object('session_id',new.session_id,'delay_minutes',new.delay_minutes,'status',new.status),auth.uid());

  if new.status='late' then
    insert into public.attendance_events(attendance_id,person_id,event_type,occurred_at,source,metadata,created_by)
    values(new.id,new.person_id,'late_detected',new.arrived_at,new.source,
      jsonb_build_object('delay_minutes',new.delay_minutes,'access_blocked',new.access_blocked),auth.uid());

    select cs.formation_id into v_formation_id from public.course_sessions cs where cs.id=new.session_id;
    select pr.id as rule_id,pr.amount_fcfa into v_penalty
    from public.penalty_rules pr
    where pr.active and pr.penalty_type='late_arrival' and pr.application_mode='automatic'
      and (pr.formation_id=v_formation_id or pr.formation_id is null)
      and (pr.target_scope='all'
        or (new.person_type='student' and pr.target_scope='students')
        or (new.person_type='staff' and pr.target_scope='staff')
        or (new.person_type='teacher' and pr.target_scope='teacher'))
      and new.delay_minutes > greatest(coalesce(pr.tolerance_minutes,0),0)
      and new.delay_minutes between pr.min_delay_minutes and coalesce(pr.max_delay_minutes,2147483647)
      and (pr.applies_after_time is null or (new.arrived_at at time zone 'Africa/Porto-Novo')::time > pr.applies_after_time)
      and (pr.effective_from is null or new.arrived_at>=pr.effective_from)
      and (pr.effective_until is null or new.arrived_at<=pr.effective_until)
    order by (pr.formation_id is not null) desc,
      case when (new.person_type='student' and pr.target_scope='students') or (new.person_type='staff' and pr.target_scope='staff') or (new.person_type='teacher' and pr.target_scope='teacher') then 0 else 1 end,
      pr.priority asc,pr.min_delay_minutes desc,pr.created_at desc
    limit 1;
    if found and v_penalty.amount_fcfa>0 then
      insert into public.penalties(attendance_id,person_id,rule_id,amount_fcfa,status)
      values(new.id,new.person_id,v_penalty.rule_id,v_penalty.amount_fcfa,'pending');
    end if;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.calculate_penalty(p_person_type text, p_delay_minutes integer, p_at timestamp with time zone DEFAULT now())
 RETURNS TABLE(rule_id uuid, amount_fcfa integer, blocks_access boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select pr.id, pr.amount_fcfa, pr.blocks_access
  from public.penalty_rules pr
  where pr.penalty_type='late_arrival'
    and pr.active=true
    and (pr.target_scope='all'
      or (p_person_type='student' and pr.target_scope='students')
      or (p_person_type='staff' and pr.target_scope='staff')
      or (p_person_type='teacher' and pr.target_scope='teacher')
      or (pr.target_scope is null and pr.person_type=p_person_type))
    and p_delay_minutes > greatest(coalesce(pr.tolerance_minutes,0),0)
    and p_delay_minutes between pr.min_delay_minutes and coalesce(pr.max_delay_minutes,2147483647)
    and (pr.applies_after_time is null or (p_at at time zone 'Africa/Porto-Novo')::time > pr.applies_after_time)
    and (pr.effective_from is null or p_at>=pr.effective_from)
    and (pr.effective_until is null or p_at<=pr.effective_until)
  order by
    case when (p_person_type='student' and pr.target_scope='students') or (p_person_type='staff' and pr.target_scope='staff') or (p_person_type='teacher' and pr.target_scope='teacher') then 0 else 1 end,
    pr.priority asc,pr.min_delay_minutes desc,pr.created_at desc
  limit 1
$function$;
