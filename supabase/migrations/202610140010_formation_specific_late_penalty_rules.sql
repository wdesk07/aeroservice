alter table public.penalty_rules add column if not exists formation_id uuid null references public.formations(id) on delete restrict;
create index if not exists penalty_rules_formation_active_idx on public.penalty_rules (formation_id, active, priority) where formation_id is not null;
create or replace function public.apply_daily_attendance_penalty()
returns trigger language plpgsql security definer set search_path='' as $$
declare
 r public.penalty_rules%rowtype;
 v_student_formation_id uuid;
 v_student_group_id uuid;
 v_session_formation_id uuid;
 v_session_group_id uuid;
 delay_m integer;
 local_arrival timestamp without time zone;
begin
 if new.person_type <> 'student' or new.status <> 'late' or new.arrived_at is null or new.nominal_time is null then return new; end if;
 select s.formation_id,s.group_id into v_student_formation_id,v_student_group_id from public.students s where s.id=new.person_id;
 if v_student_group_id is not null then
   select cs.formation_id,cs.group_id into v_session_formation_id,v_session_group_id from public.course_sessions cs
   where cs.session_date=new.local_date and cs.group_id=v_student_group_id and cs.planned_start=new.nominal_time
     and cs.status not in ('cancelled','canceled') order by cs.planned_start asc limit 1;
 end if;
 if v_session_formation_id is null and v_student_formation_id is not null then
   select cs.formation_id,cs.group_id into v_session_formation_id,v_session_group_id from public.course_sessions cs
   where cs.session_date=new.local_date and cs.group_id is null and cs.formation_id=v_student_formation_id
     and cs.planned_start=new.nominal_time and cs.status not in ('cancelled','canceled')
   order by cs.planned_start asc limit 1;
 end if;
 local_arrival:=new.arrived_at at time zone 'Africa/Porto-Novo';
 delay_m:=greatest(0,floor(extract(epoch from ((local_arrival::date+local_arrival::time)-(local_arrival::date+new.nominal_time)))/60)::integer);
 select pr.* into r from public.penalty_rules pr
 where pr.active=true and pr.application_mode='automatic' and pr.penalty_type='late_arrival'
 and (pr.target_scope='all' or pr.target_scope='students')
 and (pr.formation_id is null or pr.formation_id=coalesce(v_session_formation_id,v_student_formation_id))
 and delay_m>=coalesce(pr.min_delay_minutes,0)+coalesce(pr.tolerance_minutes,0)
 and (pr.max_delay_minutes is null or delay_m<=pr.max_delay_minutes)
 and (pr.effective_from is null or new.arrived_at>=pr.effective_from)
 and (pr.effective_until is null or new.arrived_at<=pr.effective_until)
 and (pr.applies_after_time is null or local_arrival::time>pr.applies_after_time)
 order by (pr.formation_id is not null) desc,pr.priority asc,pr.created_at desc limit 1;
 if found and not exists(select 1 from public.penalties p where p.daily_attendance_id=new.id) then
   insert into public.penalties(person_id,amount_fcfa,status,penalty_type,description,rule_id,daily_attendance_id)
   values(new.person_id,r.amount_fcfa,'pending','late_arrival',
     coalesce(nullif(trim(r.description),''),'Retard à une séance de formation')||
     format(' — arrivée %s, début prévu %s, retard %s minute(s)',to_char(local_arrival,'HH24:MI'),to_char(new.nominal_time,'HH24:MI'),delay_m),
     r.id,new.id);
 end if;
 return new;
end; $$;
revoke all on function public.apply_daily_attendance_penalty() from public;
revoke all on function public.apply_daily_attendance_penalty() from anon;
revoke all on function public.apply_daily_attendance_penalty() from authenticated;