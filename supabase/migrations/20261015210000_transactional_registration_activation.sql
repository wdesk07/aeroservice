-- Transactional registration approval: an approved learner is immediately eligible for QR check-in.
create or replace function public.review_registration_and_activate_student(
  p_registration_id uuid,
  p_decision text,
  p_comment text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_reg public.registrations%rowtype;
  v_role_id uuid;
  v_student_number text;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (
    select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
    where ur.user_id = v_actor
      and upper(r.code) in ('DIRECTOR','ADMIN','PRE_ADMIN','SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE')
  ) then raise exception 'REGISTRATION_REVIEW_FORBIDDEN'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'INVALID_REGISTRATION_DECISION'; end if;

  select * into v_reg from public.registrations where id = p_registration_id for update;
  if not found then raise exception 'REGISTRATION_NOT_FOUND'; end if;

  update public.registrations
  set status = p_decision,
      reviewed_at = clock_timestamp(),
      reviewed_by = v_actor,
      review_comment = nullif(left(trim(coalesce(p_comment,'')),500),'')
  where id = v_reg.id;

  if p_decision = 'rejected' then
    return jsonb_build_object('ok',true,'status','rejected','person_id',v_reg.person_id);
  end if;

  if not exists (select 1 from public.profiles where id = v_reg.person_id) then
    raise exception 'LEARNER_PROFILE_NOT_FOUND';
  end if;
  if v_reg.formation_id is null or not exists (
    select 1 from public.formations f where f.id = v_reg.formation_id and lower(coalesce(f.status,'active')) = 'active'
  ) then raise exception 'ACTIVE_FORMATION_REQUIRED'; end if;

  update public.profiles set status = 'active' where id = v_reg.person_id;

  select id into v_role_id from public.roles where upper(code) in ('STUDENT','APPRENANT')
  order by case when upper(code)='STUDENT' then 0 else 1 end limit 1;
  if v_role_id is null then raise exception 'STUDENT_ROLE_NOT_CONFIGURED'; end if;
  if not exists (select 1 from public.user_roles where user_id=v_reg.person_id and role_id=v_role_id) then
    insert into public.user_roles(user_id,role_id) values(v_reg.person_id,v_role_id);
  end if;

  v_student_number := 'AS-' || extract(year from current_date)::text || '-' || upper(substr(replace(v_reg.person_id::text,'-',''),1,8));
  insert into public.students(id,student_number,formation_id,group_id,enrollment_date)
  values(v_reg.person_id,v_student_number,v_reg.formation_id,v_reg.group_id,coalesce(v_reg.registration_date,current_date))
  on conflict (id) do update set
    student_number = coalesce(nullif(public.students.student_number,''), excluded.student_number),
    formation_id = coalesce(public.students.formation_id, excluded.formation_id),
    group_id = coalesce(public.students.group_id, excluded.group_id),
    enrollment_date = coalesce(public.students.enrollment_date, excluded.enrollment_date);

  return jsonb_build_object(
    'ok',true,'status','approved','person_id',v_reg.person_id,
    'profile_status','active','student_record_ready',true,'role_code','STUDENT',
    'student_number',v_student_number,'formation_id',v_reg.formation_id
  );
end;
$function$;

revoke all on function public.review_registration_and_activate_student(uuid,text,text) from public, anon;
grant execute on function public.review_registration_and_activate_student(uuid,text,text) to authenticated;
