-- Aéro Service: consolidated finance workspace for the Secretary.
-- Add expense records without changing or deleting historical payments.
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default (timezone('Africa/Porto-Novo', now()))::date,
  category text not null check (category in ('rent','utilities','transport','supplies','maintenance','payroll','communications','administration','other')),
  amount_fcfa integer not null check (amount_fcfa > 0),
  reason text not null check (length(trim(reason)) > 0),
  beneficiary text,
  proof_url text,
  status text not null default 'recorded' check (status in ('recorded','approved','cancelled')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists expenses_expense_date_idx on public.expenses (expense_date desc);
create index if not exists expenses_created_by_idx on public.expenses (created_by);

alter table public.expenses enable row level security;
revoke all on public.expenses from anon;
revoke all on public.expenses from authenticated;
grant select, insert, update on public.expenses to authenticated;

drop policy if exists "expenses read finance roles" on public.expenses;
create policy "expenses read finance roles"
  on public.expenses for select to authenticated
  using (
    private.is_admin_actor()
    or private.has_any_role(array['SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE','ACCOUNTING','FINANCE','DIRECTOR','ADMIN','PRE_ADMIN'])
  );

drop policy if exists "expenses create finance roles" on public.expenses;
create policy "expenses create finance roles"
  on public.expenses for insert to authenticated
  with check (
    created_by = auth.uid()
    and private.has_any_role(array['SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE','DIRECTOR','ADMIN','PRE_ADMIN'])
  );

drop policy if exists "expenses update finance roles" on public.expenses;
create policy "expenses update finance roles"
  on public.expenses for update to authenticated
  using (
    private.has_any_role(array['SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE','DIRECTOR','ADMIN','PRE_ADMIN'])
  )
  with check (
    private.has_any_role(array['SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE','DIRECTOR','ADMIN','PRE_ADMIN'])
  );

comment on table public.expenses is 'Dépenses de l’établissement, gérées dans l’espace financier du Secrétariat. Les écritures sont conservées; aucune politique de suppression n’est accordée.';
