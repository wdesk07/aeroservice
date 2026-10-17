
create or replace function public.open_operating_day()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid(); v_now timestamptz:=clock_timestamp(); v_date date:=(clock_timestamp() at time zone 'Africa/Porto-Novo')::date; v_status text;
begin
 if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
 if not public.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN','SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE','STAFF','PERSONNEL']) then raise exception 'KIOSK_ADMIN_REQUIRED'; end if;
 select status into v_status from public.operating_days where business_date=v_date for update;
 if v_status='closed' then raise exception 'OPERATING_DAY_ALREADY_CLOSED'; end if;
 insert into public.operating_days(business_date,status,opened_at,opened_by,updated_at) values(v_date,'open',v_now,v_uid,v_now)
 on conflict(business_date) do update set status='open',opened_at=coalesce(public.operating_days.opened_at,excluded.opened_at),opened_by=coalesce(public.operating_days.opened_by,excluded.opened_by),closed_at=null,closed_by=null,updated_at=v_now;
 return jsonb_build_object('ok',true,'opened',true,'business_date',v_date,'status','open','opened_at',v_now,'timezone','Africa/Porto-Novo');
end;
$$;
revoke all on function public.open_operating_day() from public,anon;
grant execute on function public.open_operating_day() to authenticated;

create or replace function public.close_operating_day()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid(); v_now timestamptz:=clock_timestamp(); v_local timestamp without time zone:=clock_timestamp() at time zone 'Africa/Porto-Novo'; v_date date:=v_local::date; v_status text; v_absence_result jsonb:='{}'::jsonb;
begin
 if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
 if not public.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN','SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE','STAFF','PERSONNEL']) then raise exception 'KIOSK_ADMIN_REQUIRED'; end if;
 select status into v_status from public.operating_days where business_date=v_date for update;
 if v_status is distinct from 'open' then raise exception 'OPERATING_DAY_NOT_OPEN'; end if;
 if v_local::time>=time '19:00' then v_absence_result:=public.close_daily_student_absences(); end if;
 update public.operating_days set status='closed',closed_at=v_now,closed_by=v_uid,updated_at=v_now where business_date=v_date;
 return jsonb_build_object('ok',true,'closed',true,'business_date',v_date,'status','closed','closed_at',v_now,'absence_result',v_absence_result,'kiosk_remains_registered',true);
end;
$$;
revoke all on function public.close_operating_day() from public,anon;
grant execute on function public.close_operating_day() to authenticated;
notify pgrst,'reload schema';
