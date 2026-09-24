-- Session 3: personal finance foundation for Supabase Postgres.
-- Run once in a new Supabase project's SQL Editor.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now()
);

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  return new;
end;
$$;

create trigger create_profile_after_signup
after insert on auth.users
for each row execute function public.create_profile_for_new_user();

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  kind text not null check (kind in ('bank', 'cash', 'broker')),
  currency text not null default 'THB' check (currency ~ '^[A-Z]{3}$'),
  opening_balance numeric(20,4) not null default 0,
  opened_on date not null default current_date,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (owner_id, id)
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  flow text not null check (flow in ('income', 'expense')),
  created_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, name, flow)
);

create table public.cash_transactions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('income', 'expense', 'transfer')),
  occurred_on date not null,
  from_account_id uuid,
  to_account_id uuid,
  category_id uuid,
  amount numeric(20,4) not null check (amount > 0),
  received_amount numeric(20,4),
  description text not null default '' check (length(description) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id),
  foreign key (owner_id, from_account_id) references public.accounts(owner_id, id),
  foreign key (owner_id, to_account_id) references public.accounts(owner_id, id),
  foreign key (owner_id, category_id) references public.categories(owner_id, id),
  check (
    (kind = 'income' and from_account_id is null and to_account_id is not null and received_amount is null)
    or (kind = 'expense' and from_account_id is not null and to_account_id is null and received_amount is null)
    or (kind = 'transfer' and from_account_id is not null and to_account_id is not null
        and from_account_id <> to_account_id and category_id is null
        and received_amount is not null and received_amount > 0)
  )
);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 160),
  body text not null default '',
  transaction_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (owner_id, transaction_id) references public.cash_transactions(owner_id, id) on delete set null (transaction_id)
);

-- Account ownership is checked by composite foreign keys as well as RLS.
-- Transfers carry both source and destination amounts, allowing different account currencies.
create index accounts_owner_idx on public.accounts(owner_id);
create index categories_owner_idx on public.categories(owner_id);
create index cash_transactions_owner_date_idx on public.cash_transactions(owner_id, occurred_on desc);
create index notes_owner_date_idx on public.notes(owner_id, created_at desc);

create or replace function public.validate_cash_transaction()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  category_flow text;
begin
  if new.category_id is not null then
    select flow into category_flow
    from public.categories
    where id = new.category_id and owner_id = new.owner_id;
    if category_flow is distinct from new.kind then
      raise exception 'Category flow does not match transaction kind';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger validate_cash_transaction_before_write
before insert or update on public.cash_transactions
for each row execute function public.validate_cash_transaction();

alter table public.profiles enable row level security;
alter table public.accounts enable row level security;
alter table public.categories enable row level security;
alter table public.cash_transactions enable row level security;
alter table public.notes enable row level security;

create policy profile_owner on public.profiles
for all to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy account_owner on public.accounts
for all to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy category_owner on public.categories
for all to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy transaction_owner on public.cash_transactions
for all to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy note_owner on public.notes
for all to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

revoke all on public.profiles, public.accounts, public.categories, public.cash_transactions, public.notes from anon;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.accounts, public.categories, public.cash_transactions, public.notes to authenticated;
revoke execute on function public.create_profile_for_new_user() from public, anon, authenticated;
revoke execute on function public.validate_cash_transaction() from public, anon, authenticated;
