-- Integration QA. All test users and records are rolled back.
begin;
insert into auth.users(id,email) values ('82836a50-e03f-4fc5-ae85-1b8b8f0b1011','qa1@example.invalid'),('82836a50-e03f-4fc5-ae85-1b8b8f0b1012','qa2@example.invalid');
select set_config('request.jwt.claims','{"sub":"82836a50-e03f-4fc5-ae85-1b8b8f0b1011","role":"authenticated"}',true);
set local role authenticated;
do $$
declare a uuid; thai uuid; s uuid; sell_id uuid; backup jsonb; rejected boolean:=false;
begin
 insert into public.accounts(owner_id,name,kind,currency,opening_balance) values(auth.uid(),'QA USD','broker','USD',1000) returning id into a;
 insert into public.accounts(owner_id,name,kind,currency,opening_balance) values(auth.uid(),'QA THB','bank','THB',100) returning id into thai;
 insert into public.securities(owner_id,market,symbol,name,currency) values(auth.uid(),'US','QA','QA','USD') returning id into s;
 insert into public.investment_trades(owner_id,security_id,side,traded_on,quantity,unit_price,fees,cash_account_id) values(auth.uid(),s,'buy','2026-01-01',1,100,1,a);
 insert into public.investment_trades(owner_id,security_id,side,traded_on,quantity,unit_price,fees,cash_account_id) values(auth.uid(),s,'sell','2026-01-02',0.5,150,1,a) returning id into sell_id;
 insert into public.cash_transactions(owner_id,kind,occurred_on,to_account_id,amount,gross_amount,withheld_tax_amount,income_source,security_id,description) values(auth.uid(),'income','2026-01-03',a,9,10,1,'dividend',s,'QA dividend');
 if (select balance from public.account_balances where account_id=a)<>982 then raise exception 'Balance calculation failed';end if;
 update public.investment_trades set voided_at=now() where id=sell_id;
 if (select balance from public.account_balances where account_id=a)<>908 then raise exception 'Void reversal failed';end if;
 update public.investment_trades set voided_at=null where id=sell_id;
 begin update public.investment_trades set cash_account_id=thai where id=sell_id;exception when others then rejected:=true;end;
 if not rejected then raise exception 'Currency mismatch accepted';end if;
 insert into public.notes(owner_id,title,body,security_id) values(auth.uid(),'QA thesis','note',s);
 insert into public.savings_goals(owner_id,name,currency,target_amount,account_id) values(auth.uid(),'QA goal','USD',2000,a);
 insert into public.monthly_budgets(owner_id,month,currency,amount) values(auth.uid(),'2026-01-01','USD',100);
 backup:=public.export_finance_backup();
 if jsonb_typeof(backup->'tables'->'accounts'->0->'opening_balance')<>'string' then raise exception 'Numeric precision export failed';end if;
 perform set_config('qa.backup',backup::text,true);
end $$;
select set_config('request.jwt.claims','{"sub":"82836a50-e03f-4fc5-ae85-1b8b8f0b1012","role":"authenticated"}',true);
do $$
begin
 if exists(select 1 from public.accounts) or exists(select 1 from public.investment_trades) then raise exception 'Owner isolation failed';end if;
 perform public.restore_finance_backup(current_setting('qa.backup')::jsonb);
 if (select balance from public.account_balances where currency='USD')<>982 then raise exception 'Restored balance mismatch';end if;
 if (select count(*) from public.notes)<>1 or (select count(*) from public.savings_goals)<>1 then raise exception 'Incomplete restore';end if;
 begin
 perform public.restore_finance_backup(current_setting('qa.backup')::jsonb);
 raise exception 'Duplicate restore was accepted';
 exception when others then if sqlerrm not like '%empty account%' then raise;end if;
 end;
end $$;
rollback;
select 'PASS: cash fees, sales, dividends, void reversal, currency validation, RLS isolation, decimal export, complete restore, duplicate protection; all fixtures rolled back' as qa;
