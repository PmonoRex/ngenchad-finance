-- Read-only checks after running 001_initial.sql.
-- Both result sets should show five protected tables and five owner policies.

select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('profiles', 'accounts', 'categories', 'cash_transactions', 'notes')
order by tablename;

select tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('profiles', 'accounts', 'categories', 'cash_transactions', 'notes')
order by tablename;

-- The first query must report true for every row.
-- Every policy in the second query must target authenticated.
-- For a full isolation test, create two test Auth users and verify each sees only their own rows.
