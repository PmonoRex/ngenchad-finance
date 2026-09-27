-- Sessions 14–18. Apply after 008. Existing trades remain unlinked.
begin;
alter table public.investment_trades add column cash_account_id uuid,
 add foreign key (owner_id,cash_account_id) references public.accounts(owner_id,id);
grant update (cash_account_id) on public.investment_trades to authenticated;
alter table public.cash_transactions add column security_id uuid,
 add foreign key (owner_id,security_id) references public.securities(owner_id,id),
 add check (security_id is null or (kind='income' and income_source='dividend'));
alter table public.notes add column security_id uuid,
 add foreign key (owner_id,security_id) references public.securities(owner_id,id);
create function public.validate_trade_cash_account() returns trigger language plpgsql set search_path='' as $$
begin
 if new.cash_account_id is not null and not exists (
 select 1 from public.accounts a join public.securities s on s.owner_id=a.owner_id
 where a.owner_id=new.owner_id and a.id=new.cash_account_id and s.id=new.security_id
 and a.currency=s.currency and a.archived_at is null) then
 raise exception 'Cash account must be active and match stock currency'; end if;
 return new;
end; $$;
create trigger validate_trade_cash_account before insert or update on public.investment_trades
 for each row execute function public.validate_trade_cash_account();
revoke execute on function public.validate_trade_cash_account() from public,anon,authenticated;
create or replace view public.account_balances with (security_invoker=true) as
select a.id account_id,a.owner_id,a.currency,a.opening_balance+coalesce(m.balance,0) balance
from public.accounts a left join (
 select owner_id,account_id,sum(delta) balance from (
 select owner_id,to_account_id account_id,case when kind='transfer' then received_amount else amount end delta
 from public.cash_transactions where deleted_at is null and to_account_id is not null
 union all select owner_id,from_account_id,-amount from public.cash_transactions
 where deleted_at is null and from_account_id is not null
 union all select owner_id,cash_account_id,case when side='buy' then -gross_amount-fees else gross_amount-fees end
 from public.investment_trades where voided_at is null and cash_account_id is not null
 ) movements group by owner_id,account_id
) m on m.owner_id=a.owner_id and m.account_id=a.id;
create function public.validate_dividend_currency() returns trigger language plpgsql set search_path='' as $$
begin
 if new.security_id is not null and not exists(select 1 from public.accounts a join public.securities s on s.owner_id=a.owner_id
 where a.owner_id=new.owner_id and a.id=new.to_account_id and s.id=new.security_id and a.currency=s.currency) then
 raise exception 'Dividend account currency must match stock'; end if; return new;
end; $$;
create trigger dividend_currency before insert or update on public.cash_transactions for each row execute function public.validate_dividend_currency();
revoke execute on function public.validate_dividend_currency() from public,anon,authenticated;
create table public.savings_goals (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 name text not null check(length(trim(name)) between 1 and 120),currency text not null check(currency in ('THB','USD')),
 target_amount numeric(20,4) not null check(target_amount>0),saved_amount numeric(20,4) not null default 0 check(saved_amount>=0),
 account_id uuid,target_on date,created_at timestamptz not null default now(),
 foreign key(owner_id,account_id) references public.accounts(owner_id,id)
);
create table public.monthly_budgets (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 month date not null check(extract(day from month)=1),currency text not null check(currency in ('THB','USD')),
 category_id uuid,amount numeric(20,4) not null check(amount>0),created_at timestamptz not null default now(),
 foreign key(owner_id,category_id) references public.categories(owner_id,id)
);
create unique index monthly_budget_scope on public.monthly_budgets(owner_id,month,currency,coalesce(category_id,'00000000-0000-0000-0000-000000000000'::uuid));
alter table public.savings_goals enable row level security;
alter table public.monthly_budgets enable row level security;
create policy goals_owner on public.savings_goals for all to authenticated using(auth.uid()=owner_id) with check(auth.uid()=owner_id);
create policy budgets_owner on public.monthly_budgets for all to authenticated using(auth.uid()=owner_id) with check(auth.uid()=owner_id);
grant select,insert,update,delete on public.savings_goals,public.monthly_budgets to authenticated;
-- Validate planning references with the same ownership and currency rules.
create function public.validate_planning_reference() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_table_name='savings_goals' then
 if new.account_id is not null and not exists(select 1 from public.accounts where owner_id=new.owner_id and id=new.account_id and currency=new.currency) then raise exception 'Goal account currency mismatch'; end if;
 else
 if new.category_id is not null and not exists(select 1 from public.categories where owner_id=new.owner_id and id=new.category_id and flow='expense') then raise exception 'Budget requires expense category'; end if;
 end if; return new;
end; $$;
create trigger goal_reference before insert or update on public.savings_goals for each row execute function public.validate_planning_reference();
create trigger budget_reference before insert or update on public.monthly_budgets for each row execute function public.validate_planning_reference();
revoke execute on function public.validate_planning_reference() from public,anon,authenticated;
-- Atomic restore: whitelist tables, keep caller RLS, never accept another owner.
create or replace function public.restore_finance_backup(payload jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare tab text; cols text; row_count bigint; rows jsonb; uid uuid:=auth.uid(); ids jsonb:='{}'::jsonb; item jsonb; field text; transformed jsonb; id_prefix text:=left(gen_random_uuid()::text,24); id_sequence bigint:=0;
begin
 if uid is null or (payload->>'format') is distinct from 'ngenchad-finance' or (payload->>'version') is distinct from '1' or jsonb_typeof(payload->'tables') is distinct from 'object' then raise exception 'Invalid backup'; end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
 foreach tab in array array['accounts','categories','securities','cash_transactions','investment_trades','notes','quick_templates','tax_profiles','savings_goals','monthly_budgets'] loop
 execute format('select count(*) from public.%I where owner_id=$1',tab) into row_count using uid;
 if row_count>0 then raise exception 'Restore requires an empty account'; end if;
 if jsonb_typeof(payload->'tables'->tab) is distinct from 'array' then raise exception 'Missing backup table %',tab; end if;
 end loop;
 -- Remap every primary UUID and its references; safe even in the same project.
 foreach tab in array array['accounts','categories','securities','cash_transactions','investment_trades','notes','quick_templates','tax_profiles','savings_goals','monthly_budgets'] loop
 for item in select value from jsonb_array_elements(payload->'tables'->tab) order by value->>'id' loop
 if item ? 'id' then id_sequence:=id_sequence+1;ids:=ids||jsonb_build_object(item->>'id',(id_prefix||lpad(to_hex(id_sequence),12,'0'))::uuid);end if;
 end loop; end loop;
 foreach tab in array array['accounts','categories','securities','cash_transactions','investment_trades','notes','quick_templates','tax_profiles','savings_goals','monthly_budgets'] loop
 select string_agg(quote_ident(column_name),',' order by ordinal_position) into cols from information_schema.columns
 where table_schema='public' and table_name=tab and is_generated='NEVER';
 rows:='[]'::jsonb;
 for item in select value from jsonb_array_elements(payload->'tables'->tab) loop
 transformed:=item||jsonb_build_object('owner_id',uid);
 for field in select key from jsonb_object_keys(item) key where key='id' or key like '%\_id' escape '\' loop
 if field<>'owner_id' and ids ? (item->>field) then transformed:=jsonb_set(transformed,array[field],ids->(item->>field));end if;
 end loop;
 rows:=rows||jsonb_build_array(transformed);
 end loop;
 -- Trades must restore chronologically so the existing oversell trigger remains valid.
 if tab='investment_trades' then
 select coalesce(jsonb_agg(value order by value->>'traded_on',value->>'created_at',value->>'id'),'[]'::jsonb) into rows from jsonb_array_elements(rows);
 end if;
 execute format('insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I,$1)',tab,cols,cols,tab) using rows;
 end loop;
end; $$;
revoke execute on function public.restore_finance_backup(jsonb) from public,anon;
grant execute on function public.restore_finance_backup(jsonb) to authenticated;
-- Export in one server statement, stringify NUMERIC to preserve every decimal.
create function public.export_finance_backup() returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare tab text; cols text; rows jsonb; result jsonb:='{}'::jsonb;
begin
 if auth.uid() is null then raise exception 'Login required'; end if;
 -- Remap every primary UUID and its references; safe even in the same project.
 foreach tab in array array['accounts','categories','securities','cash_transactions','investment_trades','notes','quick_templates','tax_profiles','savings_goals','monthly_budgets'] loop
 for item in select value from jsonb_array_elements(payload->'tables'->tab) order by value->>'id' loop
 if item ? 'id' then id_sequence:=id_sequence+1;ids:=ids||jsonb_build_object(item->>'id',(id_prefix||lpad(to_hex(id_sequence),12,'0'))::uuid);end if;
 end loop; end loop;
 foreach tab in array array['accounts','categories','securities','cash_transactions','investment_trades','notes','quick_templates','tax_profiles','savings_goals','monthly_budgets'] loop
 select string_agg(format('%I%s',column_name,case when data_type='numeric' then '::text as '||quote_ident(column_name) else '' end),',' order by ordinal_position) into cols
 from information_schema.columns where table_schema='public' and table_name=tab and column_name<>'owner_id';
 execute format('select coalesce(jsonb_agg(to_jsonb(r)),''[]''::jsonb) from (select %s from public.%I where owner_id=$1) r',cols,tab) into rows using auth.uid();
 result:=result||jsonb_build_object(tab,rows);
 end loop;
 return jsonb_build_object('format','ngenchad-finance','version',1,'exported_at',now(),'tables',result);
end; $$;
revoke execute on function public.export_finance_backup() from public,anon;
grant execute on function public.export_finance_backup() to authenticated;
commit;
