-- Sessions 8–9: user-entered assumptions for annual Thai tax estimates.
-- Apply once after 004_session7_portfolio.sql. No existing finance rows change.

create table public.tax_profiles (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tax_year integer not null check (tax_year between 2025 and 2100),
  freelance_mode text not null default 'unclassified'
    check (freelance_mode in ('unclassified', '40_2', 'manual')),
  freelance_expense numeric(20,4) not null default 0 check (freelance_expense >= 0),
  dividend_mode text not null default 'unclassified'
    check (dividend_mode in ('unclassified', 'thai_final_10', 'manual_review')),
  other_deductions numeric(20,4) not null default 0 check (other_deductions >= 0),
  forecast_salary numeric(20,4) not null default 0 check (forecast_salary >= 0),
  forecast_freelance numeric(20,4) not null default 0 check (forecast_freelance >= 0),
  updated_at timestamptz not null default now(),
  primary key (owner_id, tax_year)
);

alter table public.tax_profiles enable row level security;
create policy tax_profile_owner on public.tax_profiles
  for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

revoke all on public.tax_profiles from anon, authenticated;
grant select, insert on public.tax_profiles to authenticated;
grant update (freelance_mode, freelance_expense, dividend_mode,
  other_deductions, forecast_salary, forecast_freelance, updated_at)
  on public.tax_profiles to authenticated;
