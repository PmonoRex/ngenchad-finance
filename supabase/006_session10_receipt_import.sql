-- Session 10: fractional shares and idempotent client-side receipt import.
-- Apply after 004_session7_portfolio.sql. Existing trades remain intact.

begin;

-- Generated gross_amount depends on quantity and is safely recalculated from the preserved rows.
alter table public.investment_trades drop column gross_amount;
alter table public.investment_trades alter column quantity type numeric(20,8);
alter table public.investment_trades
  add column gross_amount numeric(20,4) generated always as (round(quantity * unit_price, 4)) stored;

-- SHA-256 of the source file; no receipt image, account number, or order number is stored.
alter table public.investment_trades
  add column source_fingerprint text check (source_fingerprint ~ '^[0-9a-f]{64}$');
create unique index investment_trades_receipt_fingerprint_idx
  on public.investment_trades(owner_id, source_fingerprint)
  where source_fingerprint is not null;

commit;
