(() => {
 'use strict';
 const core=window.financeCore;if(!core)return;
 const {$,state,switchView}=core;
 function render(){
  const panel=$('getting-started');
  const steps=[
   {title:'เพิ่มบัญชีเงิน',body:'เลือก THB หรือ USD และใส่ยอดตั้งต้นของบัญชี',done:state.accounts.some(a=>!a.archived_at),view:'accounts',target:'account-name'},
   {title:'ตั้งหมวดรายรับและรายจ่าย',body:'เพิ่มเอง หรือใช้ปุ่มเพิ่มหมวดเริ่มต้นในหน้าบัญชี',done:state.categories.some(c=>c.flow==='income')&&state.categories.some(c=>c.flow==='expense'),view:'accounts',target:'starter-categories'},
   {title:'บันทึกรายการแรก',body:'เริ่มจากรายรับหรือรายจ่าย แล้วตรวจยอดบนหน้าภาพรวม',done:state.transactions.some(t=>!t.deleted_at&&(t.kind==='income'||t.kind==='expense')),view:'transactions',target:'transaction-amount'}
  ];
  const completed=steps.filter(s=>s.done).length;
  panel.hidden=!state.user||!state.dataReady||completed===steps.length;
  const list=$('onboarding-steps');list.replaceChildren();
  $('onboarding-progress').textContent=`${completed} / ${steps.length} ขั้นตอน`;
  if(panel.hidden)return;
  steps.forEach((step,index)=>{
   const row=document.createElement('li');row.className=step.done?'step-complete':'';
   const number=document.createElement('span');number.className='step-number';number.textContent=step.done?'✓':String(index+1);number.setAttribute('aria-hidden','true');
   const content=document.createElement('div'),title=document.createElement('strong'),body=document.createElement('p');title.textContent=step.title;body.textContent=step.body;content.append(title,body);
   const action=document.createElement('button');action.type='button';action.className='outline small';action.textContent=step.done?'เสร็จแล้ว':'เริ่มขั้นตอนนี้';action.disabled=step.done||index===2&&!steps[0].done;
   action.addEventListener('click',()=>{switchView(step.view);const target=$(step.target);target.scrollIntoView({block:'center',behavior:'smooth'});target.focus({preventScroll:true});});row.append(number,content,action);list.append(row);
  });
 }
 window.financeOnboarding={render};render();
})();
