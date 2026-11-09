-- Restrict the no-GPS daily QR RPC to personnel only.
-- Keep the currently deployed personnel schedule unchanged pending explicit confirmation.
create or replace function public.qr_daily_checkin_without_gps(p_checkpoint_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
 v_uid uuid := auth.uid();
 v_checkpoint public.checkpoints%rowtype;
 v_person_type text := 'staff';
 v_now timestamptz := clock_timestamp();
 v_local timestamp without time zone;
 v_local_date date;
 v_nominal time without time zone := time '08:30';
 v_cutoff time without time zone := time '08:40';
 v_status text;
 v_minutes integer;
 v_row public.daily_attendance%rowtype;
begin
 if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

 select * into v_checkpoint
 from public.checkpoints
 where id = p_checkpoint_id and active;
 if not found then raise exception 'CHECKPOINT_INACTIVE'; end if;

 if not (
   exists(select 1 from public.staff where id = v_uid)
   or exists(select 1 from public.teachers where id = v_uid)
   or public.has_any_role(array[
     'DIRECTOR','ADMIN','PRE_ADMIN','SECRETARIAT','SECRETARY',
     'SECRETAIRE','SECRÉTAIRE','STAFF','PERSONNEL','ACCOUNTING',
     'FINANCE','PEDAGOGY','PEDAGOGIE','TEACHER','ENSEIGNANT'
   ])
 ) then
   raise exception 'ACTIVE_PERSONNEL_REQUIRED';
 end if;

 v_local := v_now at time zone 'Africa/Porto-Novo';
 v_local_date := v_local::date;

 v_status := case when v_local::time <= v_cutoff then 'on_time' else 'late' end;
 v_minutes := case
   when v_status = 'on_time' then 0
   else greatest(0, ceil(extract(epoch from (v_local::time - v_nominal)) / 60)::integer)
 end;

 insert into public.daily_attendance(
   person_id, local_date, person_type, nominal_time, cutoff_time,
   arrived_at, status, minutes_after_cutoff, checkpoint_id,
   latitude, longitude, location_accuracy_m
 )
 values (
   v_uid, v_local_date, v_person_type, v_nominal, v_cutoff,
   v_now, v_status, v_minutes, p_checkpoint_id, null, null, null
 )
 on conflict(person_id, local_date) do nothing
 returning * into v_row;

 if not found then
   select * into v_row
   from public.daily_attendance
   where person_id = v_uid and local_date = v_local_date;
   return jsonb_build_object(
     'ok', true, 'duplicate', true,
     'daily_attendance_id', v_row.id, 'status', v_row.status,
     'arrived_at', v_row.arrived_at, 'nominal_time', v_row.nominal_time,
     'cutoff_time', v_row.cutoff_time,
     'minutes_after_cutoff', v_row.minutes_after_cutoff,
     'person_type', v_row.person_type
   );
 end if;

 insert into public.attendance_events(
   attendance_id, person_id, event_type, occurred_at, source, metadata, created_by
 )
 values (
   null, v_uid, 'daily_qr_checkin', v_now, 'qr_daily_without_gps',
   jsonb_build_object(
     'daily_attendance_id', v_row.id,
     'local_date', v_local_date,
     'person_type', v_person_type,
     'nominal_time', v_nominal,
     'cutoff_time', v_cutoff,
     'status', v_status,
     'minutes_after_cutoff', v_minutes,
     'checkpoint_id', p_checkpoint_id,
     'gps_skipped', true
   ),
   v_uid
 );

 return jsonb_build_object(
   'ok', true, 'duplicate', false,
   'daily_attendance_id', v_row.id,
   'status', v_status,
   'arrived_at', v_now,
   'nominal_time', v_nominal,
   'cutoff_time', v_cutoff,
   'minutes_after_cutoff', v_minutes,
   'person_type', v_person_type,
   'checkpoint', v_checkpoint.name
 );
end;
$function$;

revoke all on function public.qr_daily_checkin_without_gps(uuid) from public, anon;
grant execute on function public.qr_daily_checkin_without_gps(uuid) to authenticated;
notify pgrst, 'reload schema';
