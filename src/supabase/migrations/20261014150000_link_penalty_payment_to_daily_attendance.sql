-- Additive test-branch schema support for late-attendance settlement.
-- Does not remove or rewrite existing records.
alter table public.penalties
  add column if not exists penalty_type text not null default 'other',
  add column if not exists description text,
  add column if not exists rule_id uuid,
  add column if not exists daily_attendance_id uuid references public.daily_attendance(id) on delete restrict;

create index if not exists penalties_daily_attendance_id_idx
  on public.penalties(daily_attendance_id);

create or replace function public.sync_validated_penalty_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_penalty public.penalties%rowtype;
  v_actor uuid;
  v_person_name text;
begin
  if new.status = 'validated'
     and old.status is distinct from new.status
     and new.payment_type = 'penalty'
     and new.penalty_id is not null then
    select * into v_penalty
    from public.penalties
    where id = new.penalty_id
    for update;

    if found and v_penalty.status = 'pending'
       and new.amount_fcfa >= v_penalty.amount_fcfa then
      update public.penalties
      set status = 'paid'
      where id = v_penalty.id and status = 'pending';

      if v_penalty.daily_attendance_id is not null then
        update public.daily_attendance
        set status = 'regularized'
        where id = v_penalty.daily_attendance_id
          and person_id = v_penalty.person_id
          and status = 'late';

        if found then
          v_actor := coalesce(new.validated_by, auth.uid());
          insert into public.attendance_events(
            attendance_id, person_id, event_type, occurred_at, source, metadata, created_by
          ) values (
            null, v_penalty.person_id, 'regularized', coalesce(new.validated_at, now()),
            'payment_validation',
            jsonb_build_object(
              'daily_attendance_id', v_penalty.daily_attendance_id,
              'penalty_id', v_penalty.id,
              'payment_id', new.id,
              'amount_fcfa', new.amount_fcfa,
              'status', 'regularized'
            ), v_actor
          );

          select coalesce(
            nullif(trim(p.display_name), ''),
            nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
            p.email,
            'Apprenant'
          ) into v_person_name
          from public.profiles p
          where p.id = v_penalty.person_id;

          insert into public.notifications(
            recipient_id, channel, type, title, body, data, status
          ) values (
            v_penalty.person_id, 'in_app', 'attendance_regularized',
            'Situation régularisée',
            'Votre situation a été régularisée. Vous avez maintenant accès aux cours.',
            jsonb_build_object(
              'daily_attendance_id', v_penalty.daily_attendance_id,
              'penalty_id', v_penalty.id,
              'payment_id', new.id,
              'status', 'regularized'
            ), 'pending'
          );
        end if;
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_validated_penalty_payment on public.payments;
create trigger trg_sync_validated_penalty_payment
after update of status on public.payments
for each row
execute function public.sync_validated_penalty_payment();

revoke all on function public.sync_validated_penalty_payment() from public, anon, authenticated;
