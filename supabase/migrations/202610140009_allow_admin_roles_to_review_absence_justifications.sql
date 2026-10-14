create or replace function public.review_absence_justification(
  p_justification_id uuid,
  p_decision text,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user uuid := auth.uid();
  v_row public.absence_justifications%rowtype;
  v_now timestamptz := clock_timestamp();
  v_attendance_id uuid;
begin
  if v_user is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;

  if not public.has_any_role(array['DIRECTOR','ADMIN','PRE_ADMIN']::text[]) then
    raise exception 'ADMIN_REVIEW_REQUIRED';
  end if;

  if lower(coalesce(p_decision,'')) not in ('approved','rejected') then
    raise exception 'INVALID_JUSTIFICATION_DECISION';
  end if;

  select * into v_row
  from public.absence_justifications
  where id = p_justification_id
  for update;

  if not found then raise exception 'JUSTIFICATION_NOT_FOUND'; end if;
  if v_row.status <> 'pending' then raise exception 'JUSTIFICATION_ALREADY_REVIEWED'; end if;

  update public.absence_justifications
    set status = lower(p_decision),
        reviewed_by = v_user,
        reviewed_at = v_now,
        review_comment = nullif(trim(coalesce(p_comment,'')),'')
    where id = p_justification_id
    returning * into v_row;

  if lower(p_decision) = 'approved' then
    update public.daily_attendance
      set status = 'regularized'
      where person_id = v_row.person_id
        and local_date = (v_row.submitted_at at time zone 'Africa/Porto-Novo')::date
        and status = 'absent'
      returning id into v_attendance_id;

    insert into public.attendance_events(
      attendance_id, person_id, event_type, occurred_at, source, metadata, created_by
    ) values (
      null, v_row.person_id, 'regularized', v_now, 'absence_justification_review',
      jsonb_build_object(
        'justification_id',v_row.id,
        'decision','approved',
        'daily_attendance_id',v_attendance_id,
        'review_comment',v_row.review_comment,
        'previous_status','absent'
      ), v_user
    );
  end if;

  insert into public.notifications(
    recipient_id, channel, type, title, body, data, status, created_at
  ) values (
    v_row.person_id, 'in_app', 'absence_justification_result',
    case when lower(p_decision) = 'approved' then 'Justification d’absence approuvée' else 'Justification d’absence refusée' end,
    case when lower(p_decision) = 'approved'
      then 'La Direction a approuvé votre justification d’absence.'
      else 'La Direction a refusé votre justification d’absence. Consultez le commentaire ou contactez le secrétariat.'
    end,
    jsonb_build_object('justification_id',v_row.id,'decision',lower(p_decision),'comment',v_row.review_comment),
    'pending', v_now
  );

  return jsonb_build_object(
    'ok',true,'justification_id',v_row.id,'status',v_row.status,
    'reviewed_at',v_row.reviewed_at,'daily_attendance_regularized',v_attendance_id is not null
  );
end;
$function$;

revoke all on function public.review_absence_justification(uuid,text,text) from public;
revoke all on function public.review_absence_justification(uuid,text,text) from anon;
grant execute on function public.review_absence_justification(uuid,text,text) to authenticated, service_role;
