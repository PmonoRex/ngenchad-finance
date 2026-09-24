-- Session 4: income details, soft deletion, quick templates, and live account balances.
-- Apply after 001_initial.sql. Existing user data is preserved.

alter table public.cash_transactions
  add column gross_amount numeric(20,4),
  add column withheld_tax_amount numeric(20,4) not null default 0,
  add column income_source text,
  add column deleted_at timestamptz;

alter table public.cash_transactions
  add constraint cash_income_fields_check check (
    (kind = 'income'
      and income_source in ('salary', 'freelance', 'dividend', 'other')
      and gross_amount is not null and gross_amount > 0
      and withheld_tax_amount >= 0 and withheld_tax_amount < gross_amount
      and amount = gross_amount - withheld_tax_amount)
    or
    (kind in ('expense', 'transfer')
      and income_source is null and gross_amount is null and withheld_tax_amount = 0)
  );

create table public.quick_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  kind text not null check (kind in ('income', 'expense')),
  account_id uuid not null,
  category_id uuid,
  amount numeric(20,4) not null check (amount > 0),
  description text not null default '' check (length(description) <= 500),
  income_source text check (income_source in ('salary', 'freelance', 'dividend', 'other')),
  gross_amount numeric(20,4),
  withheld_tax_amount numeric(20,4) not null default 0,
  created_at timestamptz not null default now(),
  foreign key (owner_id, account_id) references public.accounts(owner_id, id),
  foreign key (owner_id, category_id) references public.categories(owner_id, id),
  check (
    (kind = 'income' and income_source is not null and gross_amount is not null
      and gross_amount > 0 and withheld_tax_amount >= 0 and withheld_tax_amount < gross_amount
      and amount = gross_amount - withheld_tax_amount)
    or (kind = 'expense' and income_source is null and gross_amount is null and withheld_tax_amount = 0)
  )
);

create index quick_templates_owner_idx on public.quick_templates(owner_id, created_at desc);
create or replace function public.validate_quick_template()
returns trigger language plpgsql set search_path = '' as $$
declare category_flow text;
begin
  if new.category_id is not null then
    select flow into category_flow from public.categories
    where id = new.category_id and owner_id = new.owner_id;
    if category_flow is distinct from new.kind then
      raise exception 'Category flow does not match template kind';
    end if;
  end if;
  return new;
end;
$$;
create trigger validate_quick_template_before_write
  before insert or update on public.quick_templates
  for each row execute function public.validate_quick_template();
alter table public.quick_templates enable row level security;
create policy quick_template_owner on public.quick_templates
  for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
revoke all on public.quick_templates from anon;
grant select, insert, update, delete on public.quick_templates to authenticated;
revoke execute on function public.validate_quick_template() from public, anon, authenticated;

-- security_invoker ensures the view uses each signed-in user's RLS policies.
create view public.account_balances with (security_invoker = true) as
select a.id as account_id, a.owner_id, a.currency,
  a.opening_balance + coalesce(sum(
    case when t.to_account_id = a.id
      then case when t.kind = 'transfer' then t.received_amount else t.amount end
      else 0 end
    - case when t.from_account_id = a.id then t.amount else 0 end
  ), 0) as balance
from public.accounts a
left join public.cash_transactions t
  on t.owner_id = a.owner_id
  and t.deleted_at is null
  and (t.from_account_id = a.id or t.to_account_id = a.id)
group by a.id, a.owner_id, a.currency, a.opening_balance;

revoke all on public.account_balances from anon;
grant select on public.account_balances to authenticated;
