(() => {
 'use strict';
 const core=window.financeCore;if(!core)return;
 const {$,state,switchView}=core;
 const welcome=document.querySelector('.welcome');
 const actions=document.createElement('div');actions.className='welcome-actions';actions.append($('quick-add'),$('mobile-more'),document.querySelector('.top-right'));welcome.append(actions);
 const form=$('transaction-form'),marker=document.createComment('transaction form position');form.before(marker);
 const message=$('workspace-message'),messageMarker=document.createComment('workspace message position');message.before(messageMarker);
 const dialog=$('quick-entry-dialog');let previousFocus=null;
 function quickAdd(){if(!state.user||state.recovery)return;previousFocus=document.activeElement;$('quick-entry-slot').append(form,message);dialog.showModal();$('transaction-amount').focus();}
 function restoreForm(){marker.after(form);messageMarker.after(message);previousFocus?.focus();}
 $('close-quick-entry').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',restoreForm);
 dialog.addEventListener('click',e=>{if(e.target===dialog){const rect=dialog.getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)dialog.close();}});
 $('mobile-quick-add').addEventListener('click',quickAdd);
 const menu=$('mobile-menu-dialog');$('mobile-more').addEventListener('click',()=>menu.showModal());$('close-mobile-menu').addEventListener('click',()=>menu.close());
 document.querySelectorAll('[data-design-view]').forEach(button=>button.addEventListener('click',()=>{switchView(button.dataset.designView);if(menu.open)menu.close();window.scrollTo({top:0,behavior:'instant'});sync();}));
 document.querySelectorAll('.side-nav [data-view]').forEach(button=>button.addEventListener('click',()=>{window.scrollTo({top:0,behavior:'instant'});sync();}));
 function sync(){
  const signedIn=!$('workspace').hidden;document.body.classList.toggle('is-member',signedIn);
  if(!signedIn){if(dialog.open)dialog.close();if(menu.open)menu.close();}
  const active=document.querySelector('.side-nav .active')?.dataset.view;
  document.querySelectorAll('[data-design-view]').forEach(button=>{button.classList.toggle('active',button.dataset.designView===active);if(button.dataset.designView===active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  $('mobile-more').classList.toggle('active',!['dashboard','transactions','portfolio'].includes(active));
  document.querySelectorAll('.side-nav [data-view]').forEach(button=>{if(button.dataset.view===active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
 }
 new MutationObserver(sync).observe($('workspace'),{attributes:true,attributeFilter:['hidden']});
 new MutationObserver(sync).observe(document.querySelector('.side-nav'),{attributes:true,subtree:true,attributeFilter:['class']});
 new MutationObserver(()=>{if(dialog.open&&message.textContent==='บันทึกรายการแล้ว')dialog.close();}).observe(message,{childList:true,subtree:true,characterData:true});
 // Put the transaction table ahead of the editing form and slip importer.
 const transactions=$('transactions-view'),layout=document.createElement('div');layout.className='transaction-layout';
 const receipt=transactions.querySelector('.receipt-card'),grid=transactions.querySelector('.main-grid'),history=$('transaction-list').closest('section');history.classList.add('transaction-history');layout.append(history,grid,receipt);transactions.append(layout);
 $('notes-search').addEventListener('input',core.renderNotes);
 window.financeDesign={quickAdd};sync();
})();
