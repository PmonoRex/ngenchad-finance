-- Hide securities from the watchlist without deleting trade history.
-- A security with open shares stays visible in the app; the UI only archives flat positions.
alter table public.securities
  add column if not exists archived_at timestamptz;

grant update (archived_at) on public.securities to authenticated;
