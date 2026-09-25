-- Session 11: prevent importing the same cash slip twice.
-- Only the SHA-256 file fingerprint is retained, never the slip image or account number.
alter table public.cash_transactions
  add column if not exists source_fingerprint text
  check (source_fingerprint ~ '^[0-9a-f]{64}$');

create unique index if not exists cash_transactions_slip_fingerprint_idx
  on public.cash_transactions(owner_id, source_fingerprint)
  where source_fingerprint is not null;
