-- Finalize the three official Aéro Service weekly schedules and server-side kiosk sync.
-- Stable formation codes are used instead of generated UUIDs. Existing attendance is preserved.

update public.formations
set name='Agent de voyage 2 ans', updated_at=now()
where code='AGENT_VOYAGE' and name='Agent de voyage';

update public.formation_weekly_schedule
set active=false
where formation_id=(select id from public.formations where code='AGENT_VOYAGE' limit 1);

insert into public.formation_weekly_schedule
  (formation_id,weekday_iso,subject,planned_start,planned_end,active)
select f.id,v.weekday_iso,v.subject,v.planned_start::time,v.planned_end::time,true
from public.formations f
cross join (values
 (1,'Anglais','09:00','11:00'),
 (1,'Cours de vente','12:00','14:00'),
 (3,'Anglais','09:00','11:00'),
 (3,'Billetterie','12:00','14:00'),
 (5,'Anglais','09:00','11:00'),
 (5,'Tourisme','12:00','14:00')
) as v(weekday_iso,subject,planned_start,planned_end)
where f.code='AGENT_VOYAGE'
on conflict (formation_id,weekday_iso,subject,planned_start,planned_end)
do update set active=true;

update public.formation_weekly_schedule s
set active=true
from public.formations f
where f.id=s.formation_id and f.code='HOTESSE_AIR'
and (
 (s.weekday_iso=1 and ((s.subject='Anglais' and s.planned_start='09:00' and s.planned_end='11:00')
   or (s.subject='PNC' and s.planned_start='12:00' and s.planned_end='14:00')
   or (s.subject='Anglais' and s.planned_start='15:00' and s.planned_end='17:00')
   or (s.subject='Vente' and s.planned_start='17:00' and s.planned_end='19:00')))
 or (s.weekday_iso=3 and ((s.subject='Anglais' and s.planned_start='09:00' and s.planned_end='11:00')
   or (s.subject='PNC' and s.planned_start='12:00' and s.planned_end='14:00')
   or (s.subject='Anglais' and s.planned_start='15:00' and s.planned_end='17:00')
   or (s.subject='Billetterie' and s.planned_start='17:00' and s.planned_end='19:00')))
 or (s.weekday_iso=5 and s.subject='Anglais' and
   ((s.planned_start='09:00' and s.planned_end='11:00') or (s.planned_start='12:00' and s.planned_end='14:00')))
);

update public.formation_weekly_schedule s
set active=true
from public.formations f
where f.id=s.formation_id and f.code='AGENT_VOYAGE_UNI_2EME'
and (
 (s.weekday_iso=1 and ((s.subject='Billetterie' and s.planned_start='14:00' and s.planned_end='16:30')
   or (s.subject='Anglais' and s.planned_start='17:00' and s.planned_end='19:00')))
 or (s.weekday_iso=3 and ((s.subject='Amadeus' and s.planned_start='14:00' and s.planned_end='16:30')
   or (s.subject='Anglais' and s.planned_start='17:00' and s.planned_end='19:00')))
 or (s.weekday_iso=5 and ((s.subject='Informatique' and s.planned_start='14:00' and s.planned_end='16:30')
   or (s.subject='Anglais' and s.planned_start='17:00' and s.planned_end='19:00')))
);

-- The general learner cutoff is the session start + 15 minutes: 09:15 is on time, 09:16 is late.
update public.penalty_rules
set applies_after_time=null,tolerance_minutes=15,amount_fcfa=1000,
    min_delay_minutes=1,max_delay_minutes=null,blocks_access=true
where active=true and formation_id is null and target_scope in ('students','all')
  and application_mode='automatic' and penalty_type='late_arrival';

insert into public.penalty_rules
  (person_type,penalty_type,description,target_scope,application_mode,applies_after_time,
   min_delay_minutes,max_delay_minutes,tolerance_minutes,amount_fcfa,blocks_access,priority,active)
select 'student','late_arrival','Retard à une séance de formation','students','automatic',null,
       1,null,15,1000,true,100,true
where not exists (
  select 1 from public.penalty_rules r
  where r.active and r.formation_id is null and r.target_scope in ('students','all')
    and r.application_mode='automatic' and r.penalty_type='late_arrival'
);

-- Build the current and next seven local days immediately.
do $$
declare d date;
begin
 for d in select generate_series(
   (clock_timestamp() at time zone 'Africa/Porto-Novo')::date,
   (clock_timestamp() at time zone 'Africa/Porto-Novo')::date+7,
   interval '1 day')::date
 loop
   perform public.materialize_formation_sessions_for_date(d);
   perform public.refresh_session_attendance_for_date(d);
 end loop;
end $$;

create or replace function public.sync_daily_formation_sessions()
returns void language plpgsql security definer set search_path=''
as $$
declare d date := (clock_timestamp() at time zone 'Africa/Porto-Novo')::date;
begin
 perform public.materialize_formation_sessions_for_date(d);
 perform public.refresh_session_attendance_for_date(d);
end;
$$;
revoke all on function public.sync_daily_formation_sessions() from public,anon,authenticated;

do $$
begin
 if not exists(select 1 from cron.job where jobname='aero-materialize-daily-formation-sessions') then
   perform cron.schedule('aero-materialize-daily-formation-sessions','5 23 * * *','select public.sync_daily_formation_sessions();');
 end if;
end $$;
