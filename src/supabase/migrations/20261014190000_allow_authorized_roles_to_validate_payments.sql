-- Align the database-level payment validation guard with the existing payments UPDATE RLS policy.
-- Keep the pending-only transition, immutable identity/amount checks, and penalty-payable checks intact.
create or replace function private.guard_payment_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE' then
    if new.payment_type is distinct from old.payment_type
       or new.penalty_id is distinct from old.penalty_id
       or new.person_id is distinct from old.person_id
       or new.amount_fcfa is distinct from old.amount_fcfa then
      raise exception 'Payment identity and amount are immutable';
    end if;

    if new.status = 'validated' and old.status is distinct from 'validated' then
      if not public.is_admin_actor()
         and not public.has_any_role(array[
           'ACCOUNTING', 'FINANCE', 'SECRETARIAT', 'SECRETARY',
           'SECRETAIRE', 'SECRÉTAIRE', 'DIRECTOR', 'ADMIN', 'PRE_ADMIN'
         ]) then
        raise exception 'Unauthorized payment validation';
      end if;

      if new.payment_type = 'penalty' and not exists (
        select 1 from public.penalties p
        where p.id = new.penalty_id
          and p.status = 'pending'
          and p.amount_fcfa = new.amount_fcfa
      ) then
        raise exception 'PENALTY_NOT_PAYABLE';
      end if;
    end if;
  end if;

  return new;
end;
$function$;
