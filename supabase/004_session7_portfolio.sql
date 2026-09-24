-- Session 7: manual stock trade ledger and price marks.
-- Apply once after 003_session4.sql. Existing cash data is untouched.

create table public.securities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  market text not null check (market in ('SET', 'US')),
  symbol text not null check (symbol ~ '^[A-Z0-9._^-]{1,20}$'),
  name text not null check (length(trim(name)) between 1 and 120),
  currency text not null check (currency in ('THB', 'USD')),
  last_price numeric(20,4) check (last_price >= 0),
  price_as_of date,
  created_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, market, symbol),
  check ((market = 'SET' and currency = 'THB') or (market = 'US' and currency = 'USD')),
  check ((last_price is null and price_as_of is null) or (last_price is not null and price_as_of is not null))
);

create table public.investment_trades (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  security_id uuid not null,
  side text not null check (side in ('buy', 'sell')),
  traded_on date not null,
  quantity numeric(20,4) not null check (quantity > 0),
  unit_price numeric(20,4) not null check (unit_price > 0),
  gross_amount numeric(20,4) generated always as (round(quantity * unit_price, 4)) stored,
  fees numeric(20,4) not null default 0 check (fees >= 0),
  note text not null default '' check (length(note) <= 500),
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (owner_id, security_id) references public.securities(owner_id, id),
  check (round(quantity * unit_price, 4) > 0),
  check (side = 'buy' or fees <= round(quantity * unit_price, 4))
);

create index securities_owner_idx on public.securities(owner_id, market, symbol);
create index investment_trades_owner_security_date_idx
  on public.investment_trades(owner_id, security_id, traded_on, created_at, id);

-- Validate the whole active timeline, including backdated entries and restored trades.
-- A trade's economic fields are immutable; only voided_at may be updated.
create or replace function public.validate_investment_trade_history()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from (
      select sum(case when side = 'buy' then quantity else -quantity end)
        over (order by traded_on, created_at, id rows between unbounded preceding and current row) as held
      from public.investment_trades
      where owner_id = new.owner_id and security_id = new.security_id and voided_at is null
    ) timeline where held < 0
  ) then
    raise exception 'Sale exceeds shares held at trade date';
  end if;
  return new;
end;
$$;

create trigger validate_investment_trade_after_write
  after insert or update on public.investment_trades
  for each row execute function public.validate_investment_trade_history();

alter table public.securities enable row level security;
alter table public.investment_trades enable row level security;

create policy security_owner on public.securities
  for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy investment_trade_owner on public.investment_trades
  for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

revoke all on public.securities, public.investment_trades from anon, authenticated;
grant select, insert on public.securities to authenticated;
grant update (name, last_price, price_as_of) on public.securities to authenticated;
grant select, insert on public.investment_trades to authenticated;
grant update (voided_at) on public.investment_trades to authenticated;
revoke execute on function public.validate_investment_trade_history() from public, anon, authenticated;
