create unique index if not exists penalties_one_per_daily_attendance
on public.penalties(daily_attendance_id) where daily_attendance_id is not null;

create or replace function public.apply_daily_attendance_penalty()
returns trigger language plpgsql security definer set search_path='' as $$
declare
 r public.penalty_rules%rowtype;
 delay_m integer;
 local_arrival timestamp without time zone;
begin
 if new.person_type <> 'student' or new.status <> 'late' or new.arrived_at is null or new.nominal_time is null then return new; end if;
 local_arrival:=new.arrived_at at time zone 'Africa/Porto-Novo';
 delay_m:=greatest(0,floor(extract(epoch from ((local_arrival::date+local_arrival::time)-(local_arrival::date+new.nominal_time)))/60)::integer);
 select pr.* into r from public.penalty_rules pr
 where pr.active=true and pr.application_mode='automatic' and pr.penalty_type='late_arrival'
 and (pr.target_scope='all' or pr.target_scope='students')
 and delay_m >= coalesce(pr.min_delay_minutes,0)+coalesce(pr.tolerance_minutes,0)
 and (pr.max_delay_minutes is null or delay_m<=pr.max_delay_minutes)
 and (pr.effective_from is null or new.arrived_at>=pr.effective_from)
 and (pr.effective_until is null or new.arrived_at<=pr.effective_until)
 and (pr.applies_after_time is null or local_arrival::time>pr.applies_after_time)
 order by pr.priority asc,pr.created_at desc limit 1;
 if found and not exists(select 1 from public.penalties p where p.daily_attendance_id=new.id) then
  insert into public.penalties(person_id,amount_fcfa,status,penalty_type,description,rule_id,daily_attendance_id)
  values(new.person_id,r.amount_fcfa,'pending','late_arrival',
   coalesce(nullif(trim(r.description),''),'Retard à une séance de formation')||format(' — arrivée %s, début prévu %s, retard %s minute(s)',to_char(local_arrival,'HH24:MI'),to_char(new.nominal_time,'HH24:MI'),delay_m),
   r.id,new.id);
 end if;
 return new;
end; $$;
drop trigger if exists trg_daily_attendance_apply_penalty on public.daily_attendance;
create trigger trg_daily_attendance_apply_penalty after insert on public.daily_attendance
for each row execute function public.apply_daily_attendance_penalty();