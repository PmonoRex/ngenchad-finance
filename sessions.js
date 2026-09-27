(() => {
 'use strict';
 const c=window.financeCore; if(!c)return;
 const {state,db,$,elem,units,decimal,money,moneyUnits,shareUnits,shareText,portfolioModel,fillSelect,account,security,say,loadData,switchView,today}=c;
 const tables=['accounts','categories','securities','cash_transactions','investment_trades','notes','quick_templates','tax_profiles','savings_goals','monthly_budgets'];
 let goals=[],budgets=[],selectedStock=null,editGoal=null,editBudget=null,pendingBackup=null,generation=0;
 const liveAccounts=()=>state.accounts.filter(a=>!a.archived_at);
 const action=(label,key,value)=>{const b=elem('button',label,'outline small');b.type='button';b.dataset[key]=value;return b;};
 function cashPickers(){
  const s=security($('trade-security').value);
  fillSelect($('trade-cash-account'),liveAccounts().filter(a=>a.currency===s?.currency),'ไม่ปรับเงินสด',a=>`${a.name} · ${a.currency}`);
  fillSelect($('receipt-cash-account'),liveAccounts(),'ไม่ปรับเงินสด',a=>`${a.name} · ${a.currency}`);
  fillSelect($('dividend-security'),state.securities,'เลือกหุ้น',s=>`${s.symbol} · ${s.currency}`);
  fillSelect($('note-security'),state.securities,'ไม่ผูกกับหุ้น',s=>`${s.symbol} · ${s.market}`);
  dividendAccounts();
  fillSelect($('goal-account'),liveAccounts().filter(a=>a.currency===$('goal-currency').value),'กรอกยอดออมเอง',a=>a.name);
  fillSelect($('budget-category'),state.categories.filter(a=>a.flow==='expense'),'รายจ่ายทุกหมวด',a=>a.name);
 }
 function dividendAccounts(){const s=security($('dividend-security').value);fillSelect($('dividend-account'),liveAccounts().filter(a=>a.currency===s?.currency),'เลือกบัญชีสกุลเดียวกับหุ้น',a=>a.name);}
 function tradeLinks(){
  $("trade-list").querySelectorAll("[data-cash-link-controls]").forEach(el=>el.remove());
  for(const t of state.trades){const b=$('trade-list').querySelector(`[data-trade-id="${t.id}"]`);if(!b)continue;
   const s=security(t.security_id),cell=b.parentElement;
   const select=elem('select');select.setAttribute('aria-label',`บัญชีเงินสด ${s.symbol} ${t.traded_on}`);
   select.append(new Option('ไม่ปรับเงินสด',''));for(const a of liveAccounts().filter(a=>a.currency===s.currency))select.append(new Option(a.name,a.id));
   select.value=t.cash_account_id||'';select.dataset.linkAccount=t.id;
   const amount=units(t.gross_amount)+(t.side==='buy'?units(t.fees):-units(t.fees));
   const caption=elem('small',`${t.side==='buy'?'หัก':'เพิ่ม'}เงินสด ${moneyUnits(amount,s.currency)} เมื่อผูกบัญชี`);
   const wrap=elem('div');wrap.dataset.cashLinkControls='';cell.append(wrap);wrap.append(select,caption,action('บันทึกบัญชี','linkTrade',t.id));
  }
 }
 function detail(){
  const s=security(selectedStock);$('stock-detail').hidden=!s;if(!s)return;
  $('stock-detail-title').textContent=`${s.symbol} · ${s.name}`;const box=$('stock-detail-body');box.replaceChildren();
  const m=portfolioModel(s.id);box.append(elem('p',`ถือ ${shareText(m.shares)} หุ้น · ต้นทุน ${moneyUnits(m.cost,s.currency)} · กำไรจากขาย ${moneyUnits(m.realized,s.currency)}`));
  box.append(elem('h4','ประวัติซื้อ–ขาย'));
  for(const t of state.trades.filter(t=>t.security_id===s.id))box.append(elem('p',`${t.traded_on} · ${t.side==='buy'?'ซื้อ':'ขาย'} ${shareText(shareUnits(t.quantity))} @ ${money(t.unit_price,s.currency)}${t.voided_at?' · ยกเลิกแล้ว':''} · ${t.note||''}`));
  const dividends=state.transactions.filter(t=>t.security_id===s.id&&!t.deleted_at);
  box.append(elem('h4','ปันผลที่บันทึก'));for(const t of dividends)box.append(elem('p',`${t.occurred_on} · รับสุทธิ ${money(t.amount,s.currency)} · หักภาษี ${money(t.withheld_tax_amount,s.currency)}`));
  if(!dividends.length)box.append(elem('p','ยังไม่มีปันผล','muted'));
  box.append(elem('h4','บันทึกการลงทุน'));for(const n of state.notes.filter(n=>n.security_id===s.id)){box.append(elem('strong',n.title),elem('p',n.body,'note-body'));}
 }
 function progressRow(name,saved,target,currency){
  const row=elem('div',null,'planning-row');row.append(elem('strong',name),elem('p',`${moneyUnits(saved,currency)} / ${moneyUnits(target,currency)}`));
  const bar=elem('progress');bar.max=100;bar.value=Number(saved*10000n/target)/100;bar.setAttribute('aria-label',name);row.append(bar,elem('small',`${(Number(saved*10000n/target)/100).toFixed(1)}%`));return row;
 }
 function renderPlanning(){
  $('goals').replaceChildren();$('goal-summary').replaceChildren();$('budgets').replaceChildren();
  if(!goals.length)$('goal-summary').append(elem('p','เพิ่มเป้าหมายในหน้า “เป้าหมายและงบ”','muted'));
  for(const g of goals){
   const bal=state.balances.find(b=>b.account_id===g.account_id);const saved=units(g.account_id?(bal?.balance||'0'):g.saved_amount),target=units(g.target_amount);
   const row=progressRow(g.name,saved,target,g.currency);if(g.target_on)row.append(elem('small',`วันเป้าหมาย ${g.target_on}`));
   row.append(action('แก้ไข','editGoal',g.id),action('ลบ','deleteGoal',g.id));$('goals').append(row);
   $('goal-summary').append(progressRow(g.name,saved,target,g.currency));
  }
  for(const b of budgets){const spent=state.transactions.filter(t=>!t.deleted_at&&t.kind==='expense'&&t.occurred_on.slice(0,7)===b.month.slice(0,7)&&account(t.from_account_id)?.currency===b.currency&&(!b.category_id||t.category_id===b.category_id)).reduce((sum,t)=>sum+units(t.amount),0n);
   const row=progressRow(`${b.month.slice(0,7)} · ${state.categories.find(x=>x.id===b.category_id)?.name||'ทุกหมวด'}`,spent,units(b.amount),b.currency);
   row.append(elem('p',spent>units(b.amount)?`เกินงบ ${moneyUnits(spent-units(b.amount),b.currency)}`:`เหลือ ${moneyUnits(units(b.amount)-spent,b.currency)}`,spent>units(b.amount)?'negative':'positive'),action('แก้ไข','editBudget',b.id),action('ลบ','deleteBudget',b.id));$('budgets').append(row);
  }
 }
 async function render(){cashPickers();tradeLinks();detail();const current=++generation,uid=state.user?.id;if(!uid)return;
  const results=await Promise.all([db.from('savings_goals').select('*').order('created_at'),db.from('monthly_budgets').select('*').order('month',{ascending:false})]);
  if(current!==generation||state.user?.id!==uid)return;
  if(results.some(r=>r.error)){say('โหลดเป้าหมายและงบไม่สำเร็จ กรุณาตรวจการเชื่อมต่อ',true);return;}
  goals=results[0].data;budgets=results[1].data;renderPlanning();
 }
 window.financeExtras={render,portfolio:tradeLinks};
 $('trade-security').addEventListener('change',cashPickers);
 $('portfolio-market').addEventListener('change',()=>{cashPickers();tradeLinks();});
 $('toggle-void-trades').addEventListener('click',tradeLinks);
 $('dividend-security').addEventListener('change',dividendAccounts);
 $('goal-currency').addEventListener('change',cashPickers);
 $('goal-account').addEventListener('change',()=>{$('goal-saved').disabled=!!$('goal-account').value;});
 $('trade-list').addEventListener('click',async e=>{
  const b=e.target.closest('[data-link-trade]');if(!b)return;b.disabled=true;
  try{const id=b.dataset.linkTrade,value=$('trade-list').querySelector(`[data-link-account="${id}"]`).value||null;
   const {error}=await db.from('investment_trades').update({cash_account_id:value}).eq('id',id);if(error)throw error;await loadData();say('บันทึกบัญชีและคำนวณยอดเงินสดใหม่แล้ว');
  }catch(err){say(err.message,true);}finally{b.disabled=false;}
 });
 $('portfolio-holdings').addEventListener('click',e=>{const b=e.target.closest('[data-stock-detail]');if(!b)return;selectedStock=b.dataset.stockDetail;detail();$('stock-detail').scrollIntoView({behavior:'smooth'});});
 $('stock-detail-chart').addEventListener('click',()=>{$('chart-security').value=selectedStock;$('chart-security').dispatchEvent(new Event('change'));$('stock-chart').scrollIntoView({behavior:'smooth'});$('chart-show').click();});
 $('stock-detail-note').addEventListener('click',()=>{switchView('notes');$('cancel-note-edit').click();$('note-security').value=selectedStock;$('note-title').focus();});
 $('dividend-date').value=today();$('budget-month').value=today().slice(0,7);
 $('dividend-form').addEventListener('submit',async e=>{e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;
  try{const s=security($('dividend-security').value),a=account($('dividend-account').value),gross=units($('dividend-gross').value),tax=units($('dividend-tax').value);
   if(!s||!a||a.currency!==s.currency||gross<=0n||tax<0n||tax>=gross)throw Error('ตรวจหุ้น บัญชี ยอดปันผล และภาษี');
   const {error}=await db.from('cash_transactions').insert({owner_id:state.user.id,kind:'income',occurred_on:$('dividend-date').value,to_account_id:a.id,amount:decimal(gross-tax),gross_amount:decimal(gross),withheld_tax_amount:decimal(tax),income_source:'dividend',security_id:s.id,description:`ปันผล ${s.symbol}`});if(error)throw error;e.target.reset();$('dividend-date').value=today();$('dividend-tax').value='0';await loadData();say('บันทึกปันผลและเพิ่มเงินสดสุทธิแล้ว');
  }catch(err){say(err.message,true);}finally{b.disabled=false;}
 });
 async function savePlanning(e,kind){e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;
  try{let row,id,table;
   if(kind==='goal'){table='savings_goals';id=editGoal;row={name:$('goal-name').value.trim(),currency:$('goal-currency').value,target_amount:decimal(units($('goal-target').value)),saved_amount:decimal(units($('goal-saved').value||'0')),account_id:$('goal-account').value||null,target_on:$('goal-date').value||null};}
   else{table='monthly_budgets';id=editBudget;row={month:$('budget-month').value+'-01',currency:$('budget-currency').value,category_id:$('budget-category').value||null,amount:decimal(units($('budget-amount').value))};}
   const result=id?await db.from(table).update(row).eq('id',id):await db.from(table).insert({...row,owner_id:state.user.id});if(result.error)throw result.error;
   e.target.reset();editGoal=null;editBudget=null;$('goal-saved').disabled=false;$('budget-month').value=today().slice(0,7);await render();say('บันทึกแผนแล้ว');
  }catch(err){say(err.message,true);}finally{button.disabled=false;}
 }
 $('goal-form').addEventListener('submit',e=>savePlanning(e,'goal'));$('budget-form').addEventListener('submit',e=>savePlanning(e,'budget'));
 $('planning-view').addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;
  const d=b.dataset;if(d.editGoal){const g=goals.find(x=>x.id===d.editGoal);editGoal=g.id;$('goal-name').value=g.name;$('goal-currency').value=g.currency;cashPickers();$('goal-target').value=g.target_amount;$('goal-saved').value=g.saved_amount;$('goal-account').value=g.account_id||'';$('goal-saved').disabled=!!g.account_id;$('goal-date').value=g.target_on||'';$('goal-name').focus();}
  if(d.editBudget){const g=budgets.find(x=>x.id===d.editBudget);editBudget=g.id;$('budget-month').value=g.month.slice(0,7);$('budget-currency').value=g.currency;$('budget-category').value=g.category_id||'';$('budget-amount').value=g.amount;$('budget-amount').focus();}
  if(d.deleteGoal||d.deleteBudget){b.disabled=true;const {error}=await db.from(d.deleteGoal?'savings_goals':'monthly_budgets').delete().eq('id',d.deleteGoal||d.deleteBudget);if(error)say(error.message,true);else await render();b.disabled=false;}
 });
 function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type})),a=elem('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
 function csvCell(value){let s=String(value??'');if(/^[\s]*[=+\-@]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
 function csv(name,headers,rows){download(name,'\ufeff'+[headers,...rows].map(r=>r.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8');}
 $('cash-csv').addEventListener('click',()=>csv(`cash-${today()}.csv`,['วันที่','ประเภท','รายละเอียด','ต้นทาง','ปลายทาง','สกุลเงิน','ยอดสุทธิ','ก่อนภาษี','ภาษี','หุ้น','สถานะ'],state.transactions.map(t=>[t.occurred_on,t.kind,t.description,account(t.from_account_id)?.name,account(t.to_account_id)?.name,account(t.from_account_id||t.to_account_id)?.currency,t.amount,t.gross_amount,t.withheld_tax_amount,security(t.security_id)?.symbol,t.deleted_at?'deleted':'active'])));
 $('trades-csv').addEventListener('click',()=>csv(`trades-${today()}.csv`,['วันที่','หุ้น','ตลาด','ประเภท','จำนวน','ราคา','มูลค่า','ค่าธรรมเนียม','สกุลเงิน','บัญชีเงินสด','หมายเหตุ','สถานะ'],state.trades.map(t=>[t.traded_on,security(t.security_id)?.symbol,security(t.security_id)?.market,t.side,t.quantity,t.unit_price,t.gross_amount,t.fees,security(t.security_id)?.currency,account(t.cash_account_id)?.name,t.note,t.voided_at?'void':'active'])));
 $('backup-download').addEventListener('click',async e=>{e.target.disabled=true;$('data-status').textContent='กำลังสร้างไฟล์สำรอง…';try{const {data,error}=await db.rpc('export_finance_backup');if(error)throw error;download(`ngenchad-backup-${today()}.json`,JSON.stringify(data,null,2),'application/json');$('data-status').textContent='สร้างไฟล์สำรองแล้ว เก็บไฟล์นี้ในที่ส่วนตัว';}catch(err){$('data-status').textContent=err.message;}finally{e.target.disabled=false;}});
 $('restore-file').addEventListener('change',async e=>{pendingBackup=null;$('restore-confirm').disabled=true;try{const file=e.target.files[0];if(!file)return;if(file.size>20*1024*1024)throw Error('ไฟล์เกิน 20 MB');const b=JSON.parse(await file.text());if(b.format!=='ngenchad-finance'||b.version!==1||!b.tables||tables.some(t=>!Array.isArray(b.tables[t])))throw Error('รูปแบบไฟล์สำรองไม่ถูกต้อง');pendingBackup=b;$('restore-preview').textContent=`สำรองเมื่อ ${b.exported_at||'ไม่ระบุ'}\n`+tables.map(t=>`${t}: ${b.tables[t].length} รายการ`).join('\n');$('restore-confirm').disabled=false;}catch(err){$('restore-preview').textContent=err.message;}});
 $('restore-confirm').addEventListener('click',async e=>{if(!pendingBackup)return;e.target.disabled=true;try{const {error}=await db.rpc('restore_finance_backup',{payload:pendingBackup});if(error)throw error;pendingBackup=null;$('restore-preview').textContent='กู้คืนข้อมูลสำเร็จ';await loadData();}catch(err){$('restore-preview').textContent=`กู้คืนไม่สำเร็จ: ${err.message}`;}finally{e.target.disabled=!pendingBackup;}});
 void render();
})();
