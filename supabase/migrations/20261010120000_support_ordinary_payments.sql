-- Add first-class support for ordinary payments alongside penalty settlements.
-- Existing records default to "penalty" so their business meaning is preserved.
alter table public.payments
  add column if not exists payment_type text not null default 'penalty';

alter table public.payments
  add constraint payments_payment_type_check
  check (payment_type in ('penalty', 'ordinary'));

create or replace function private.guard_payment_server_fields()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_person uuid;
  v_amount integer;
begin
  if tg_op = 'INSERT' then
    if new.payment_type not in ('penalty', 'ordinary') then
      raise exception 'INVALID_PAYMENT_TYPE';
    end if;

    if new.payment_type = 'penalty' then
      if new.penalty_id is null then
        raise exception 'PENALTY_REQUIRED';
      end if;

      select p.person_id, p.amount_fcfa
        into v_person, v_amount
        from public.penalties p
       where p.id = new.penalty_id
       for share;

      if v_person is null or v_amount is null then
        raise exception 'PENALTY_NOT_FOUND';
      end if;

      if not exists (
        select 1 from public.penalties p
        where p.id = new.penalty_id and p.status = 'pending' and p.amount_fcfa > 0
      ) then
        raise exception 'PENALTY_NOT_PAYABLE';
      end if;

      -- Never trust client-supplied beneficiary or amount for penalty settlements.
      new.person_id := v_person;
      new.amount_fcfa := v_amount;
    elsif new.payment_type = 'ordinary' then
      if new.penalty_id is not null then
        raise exception 'ORDINARY_PAYMENT_CANNOT_REFERENCE_PENALTY';
      end if;
      if new.person_id is null then
        raise exception 'PAYMENT_PERSON_REQUIRED';
      end if;
      if new.amount_fcfa is null or new.amount_fcfa <= 0 then
        raise exception 'INVALID_PAYMENT_AMOUNT';
      end if;
    end if;

    new.received_at := clock_timestamp();
    new.received_by := (select auth.uid());
    new.status := 'pending';
    -- A receipt is issued only after validation.
    new.receipt_number := null;
  elsif tg_op = 'UPDATE' and new.status = 'validated' and old.status <> 'validated' then
    new.validated_at := clock_timestamp();
    new.validated_by := (select auth.uid());
  elsif tg_op = 'UPDATE' and old.status in ('validated', 'refused') then
    raise exception 'FINAL_PAYMENT_IMMUTABLE';
  end if;

  return new;
end;
$function$;

create or replace function private.guard_payment_mutation()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if tg_op = 'UPDATE' then
    if new.payment_type is distinct from old.payment_type
       or new.penalty_id is distinct from old.penalty_id
       or new.person_id is distinct from old.person_id
       or new.amount_fcfa is distinct from old.amount_fcfa
    then
      raise exception 'Payment identity and amount are immutable';
    end if;

    if new.status = 'validated' then
      if not public.is_admin_actor()
         and not public.has_any_role(array['SECRETARIAT','ACCOUNTING']) then
        raise exception 'Unauthorized payment validation';
      end if;

      if new.payment_type = 'penalty'
         and new.amount_fcfa <> (
           select p.amount_fcfa from public.penalties p where p.id = new.penalty_id
         ) then
        raise exception 'Payment amount must equal penalty amount';
      end if;

      if new.validated_by is null then
        raise exception 'validated_by is required for a validated payment';
      end if;
      if new.validated_at is null then
        raise exception 'validated_at is required for a validated payment';
      end if;
    end if;
  end if;

  return new;
end;
$function$;

comment on column public.payments.payment_type is
  'Payment classification: penalty settlement or ordinary payment. Existing rows are preserved as penalty settlements.';
