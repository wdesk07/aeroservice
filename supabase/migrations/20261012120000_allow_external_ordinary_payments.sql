-- Correct ordinary-payment validation for external payers.
-- The application intentionally supports receipts for payers who do not have
-- an Aéro Service account. Keep penalty settlements bound to their penalty
-- record and retain server-controlled status, timestamps and receipt numbers.
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
      -- An ordinary payment may be made by an external payer without a platform
      -- account. Require a person OR a non-empty external payer name.
      if new.person_id is null and nullif(btrim(new.payer_name), '') is null then
        raise exception 'PAYMENT_PAYER_REQUIRED';
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
    -- The database, not the browser, issues the receipt only on validation.
    new.receipt_number := 'AS-' || to_char(clock_timestamp(), 'YYYYMMDD') || '-' ||
      upper(replace(new.id::text, '-', ''));
  elsif tg_op = 'UPDATE' and old.status in ('validated', 'refused') then
    raise exception 'FINAL_PAYMENT_IMMUTABLE';
  end if;

  return new;
end;
$function$;
