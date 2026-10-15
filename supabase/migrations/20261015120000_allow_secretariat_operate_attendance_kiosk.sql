CREATE OR REPLACE FUNCTION public.open_operating_day_and_activate_kiosk(p_name text DEFAULT 'Borne officielle Aéro Service'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_uid uuid := auth.uid();
 v_now timestamptz := clock_timestamp();
 v_local timestamp without time zone;
 v_date date;
 v_token text;
 v_device_id uuid;
 v_name text := left(trim(coalesce(p_name, 'Borne officielle Aéro Service')), 80);
 v_day public.operating_days%rowtype;
begin
 if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
 if not public.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN','SECRETARIAT','SECRETARY']::text[]) then raise exception 'KIOSK_ADMIN_REQUIRED'; end if;
 if v_name = '' then v_name := 'Borne officielle Aéro Service'; end if;
 v_local := v_now at time zone 'Africa/Porto-Novo';
 v_date := v_local::date;
 select * into v_day from public.operating_days where business_date=v_date for update;
 if found and v_day.status='closed' and v_day.closed_at is not null then raise exception 'OPERATING_DAY_ALREADY_CLOSED'; end if;
 update public.presence_kiosk_devices set revoked_at=v_now where revoked_at is null;
 v_token := encode(extensions.gen_random_bytes(32),'hex');
 insert into public.presence_kiosk_devices(name,token_hash,activated_by)
 values(v_name,encode(extensions.digest(convert_to(v_token,'UTF8'),'sha256'),'hex'),v_uid)
 returning id into v_device_id;
 insert into public.operating_days(business_date,status,opened_at,opened_by,closed_at,closed_by,updated_at)
 values(v_date,'open',v_now,v_uid,null,null,v_now)
 on conflict (business_date) do update
 set status='open',
 opened_at=coalesce(public.operating_days.opened_at,excluded.opened_at),
 opened_by=coalesce(public.operating_days.opened_by,excluded.opened_by),
 closed_at=null,closed_by=null,updated_at=v_now;
 return jsonb_build_object('ok',true,'opened',true,'business_date',v_date,'status','open',
 'device_id',v_device_id,'device_name',v_name,'device_token',v_token,'opened_at',v_now,'timezone','Africa/Porto-Novo');
end;
$function$;

CREATE OR REPLACE FUNCTION public.close_operating_day_and_revoke_kiosk(p_device_id uuid DEFAULT null)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_uid uuid := auth.uid();
 v_now timestamptz := clock_timestamp();
 v_local timestamp without time zone;
 v_date date;
 v_day public.operating_days%rowtype;
 v_revoked integer := 0;
 v_absences jsonb := null;
begin
 if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
 if not public.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN','SECRETARIAT','SECRETARY']::text[]) then raise exception 'KIOSK_ADMIN_REQUIRED'; end if;
 v_local := v_now at time zone 'Africa/Porto-Novo';
 v_date := v_local::date;
 select * into v_day from public.operating_days where business_date=v_date for update;
 if not found or v_day.status <> 'open' then raise exception 'OPERATING_DAY_NOT_OPEN'; end if;
 if v_local::time >= time '19:00' then v_absences := public.close_daily_student_absences(); end if;
 update public.operating_days set status='closed',closed_at=v_now,closed_by=v_uid,updated_at=v_now where business_date=v_date;
 update public.presence_kiosk_devices set revoked_at=v_now where revoked_at is null;
 get diagnostics v_revoked = row_count;
 return jsonb_build_object('ok',true,'closed',true,'business_date',v_date,'status','closed',
 'closed_at',v_now,'devices_revoked',v_revoked,'absences',v_absences,'timezone','Africa/Porto-Novo');
end;
$function$;
