-- Aéro Service daily automation, scheduled in UTC to match Benin local time (UTC+1).
-- 18:00 UTC = 19:00 Africa/Porto-Novo (close student absences).
-- Reminders run at 08:35 and 20:35 local time so staff have a short grace window.
-- This migration must be tested against the full application schema before production.

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

create or replace function public.notify_operating_day_attention(p_stage text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_local timestamp without time zone;
  v_date date;
  v_type text;
  v_title text;
  v_body text;
  v_inserted integer := 0;
begin
  if p_stage not in ('opening','closing') then
    raise exception 'INVALID_OPERATING_REMINDER_STAGE';
  end if;

  v_local := v_now at time zone 'Africa/Porto-Novo';
  v_date := v_local::date;

  if p_stage = 'opening' then
    if v_local::time < time '08:35' then
      raise exception 'OPENING_REMINDER_TOO_EARLY';
    end if;
    if exists (
      select 1 from public.operating_days
      where business_date = v_date and opened_at is not null
    ) then
      return jsonb_build_object('ok',true,'stage',p_stage,'local_date',v_date,'notifications_queued',0,'reason','already_opened');
    end if;
    v_type := 'operating_day_opening_overdue';
    v_title := 'Ouverture non enregistrée';
    v_body := 'L’ouverture d’Aéro Service n’a pas été enregistrée à l’heure prévue. Vérifiez la présence du personnel et ouvrez l’établissement si nécessaire.';
  else
    if v_local::time < time '20:35' then
      raise exception 'CLOSING_REMINDER_TOO_EARLY';
    end if;
    if exists (
      select 1 from public.operating_days
      where business_date = v_date and status = 'closed' and closed_at is not null
    ) then
      return jsonb_build_object('ok',true,'stage',p_stage,'local_date',v_date,'notifications_queued',0,'reason','already_closed');
    end if;
    v_type := 'operating_day_closing_overdue';
    v_title := 'Fermeture non enregistrée';
    v_body := 'La fermeture d’Aéro Service n’a pas été enregistrée à 20 h 30. Vérifiez la situation et fermez l’établissement si nécessaire.';
  end if;

  insert into public.notifications (
    recipient_id, channel, type, title, body, data, status, created_at
  )
  select distinct
    ur.user_id, 'in_app', v_type, v_title, v_body,
    jsonb_build_object('local_date',v_date,'stage',p_stage,'action_required','verify_operating_day'),
    'pending', v_now
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  where r.code in ('DIRECTOR','ADMIN','PRE_ADMIN')
    and not exists (
      select 1 from public.notifications n
      where n.recipient_id = ur.user_id
        and n.type = v_type
        and n.data ->> 'local_date' = v_date::text
    );

  get diagnostics v_inserted = row_count;
  return jsonb_build_object('ok',true,'stage',p_stage,'local_date',v_date,'notifications_queued',v_inserted,'timezone','Africa/Porto-Novo');
end;
$function$;

revoke all on function public.notify_operating_day_attention(text) from public, anon, authenticated, service_role;

do $schedule$
begin
  perform cron.unschedule(jobid)
  from cron.job
  where jobname in (
    'aero-service-student-absence-closure',
    'aero-service-opening-reminder',
    'aero-service-closing-reminder'
  );

  perform cron.schedule(
    'aero-service-student-absence-closure',
    '0 18 * * *',
    'select public.close_daily_student_absences();'
  );
  perform cron.schedule(
    'aero-service-opening-reminder',
    '35 7 * * *',
    'select public.notify_operating_day_attention(''opening'');'
  );
  perform cron.schedule(
    'aero-service-closing-reminder',
    '35 19 * * *',
    'select public.notify_operating_day_attention(''closing'');'
  );
end;
$schedule$;
