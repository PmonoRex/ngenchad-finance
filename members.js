(() => {
 'use strict';
 const c=window.financeCore;if(!c)return;
 const {state,db,$,showAuth,say,loadData}=c;
 const redirect=location.origin+location.pathname;
 let profileGeneration=0;
 const message=text=>{$('login-message').textContent=text;};
 function mode(signup){$('login-form').hidden=signup;$('signup-form').hidden=!signup;$('reset-request-form').hidden=true;message('');}
 const googleButton=$('google-login');
 const googleReady=window.APP_CONFIG?.googleLoginEnabled===true;
 googleButton.disabled=!googleReady;
 $('google-login-status').textContent=googleReady?'ใช้บัญชี Google ของคุณเพื่อเข้าสู่ระบบหรือสมัครสมาชิก':'Google Login จะเปิดให้ใช้เมื่อเชื่อมต่อบริการเสร็จ';
 googleButton.addEventListener('click',async()=>{
  if(!googleReady)return;
  googleButton.disabled=true;message('กำลังเปิด Google เพื่อเข้าสู่ระบบ');
  try{const {error}=await db.auth.signInWithOAuth({provider:'google',options:{redirectTo:redirect}});if(error)throw error;}
  catch(error){message(authError(error));googleButton.disabled=false;}
 });
 $('auth-login-tab').addEventListener('click',()=>mode(false));
 $('auth-signup-tab').addEventListener('click',()=>mode(true));
 function authError(error){
  if(error.code==='over_email_send_rate_limit'||error.status===429)return 'ส่งอีเมลบ่อยเกินไป กรุณารอสักครู่แล้วลองอีกครั้ง';
  if(error.code==='email_address_not_authorized'||/sending confirmation email|email.*not authorized/i.test(error.message||''))return 'ระบบส่งอีเมลยืนยันยังไม่พร้อมสำหรับที่อยู่นี้ กรุณาติดต่อเจ้าของเว็บไซต์';
  if(error.code==='signup_disabled')return 'เว็บไซต์ยังไม่เปิดการสมัครสมาชิก กรุณาติดต่อเจ้าของเว็บไซต์';
  if(error.code==='weak_password')return 'รหัสผ่านยังไม่ผ่านเงื่อนไข กรุณาเพิ่มความยาวและความหลากหลาย';
  return 'ดำเนินการไม่สำเร็จ กรุณาตรวจข้อมูลและลองอีกครั้ง';
 }
 $('signup-form').addEventListener('submit',async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;
  try{const password=$('signup-password').value,name=$('signup-name').value.trim();if(password!==$('signup-confirm').value)throw Error('รหัสผ่านทั้งสองช่องไม่ตรงกัน');if(password.length<12||!name)throw Error('กรอกชื่อและรหัสผ่านอย่างน้อย 12 ตัวอักษร');
   message('กำลังสมัครสมาชิก…');const {data,error}=await db.auth.signUp({email:$('signup-email').value.trim(),password,options:{emailRedirectTo:redirect,data:{display_name:name}}});if(error){message(authError(error));return;}
   $('email').value=$('signup-email').value.trim();e.target.reset();
   if(data.session){showAuth(data.user);say('สมัครสมาชิกแล้ว เริ่มเพิ่มบัญชีเงินของคุณในหน้า “บัญชีและหมวด”');}
   else{mode(false);message('หากอีเมลนี้สมัครได้ ระบบจะส่งลิงก์ยืนยันให้ เปิดลิงก์ในอีเมลแล้วกลับมาเข้าสู่ระบบ หากมีบัญชีอยู่แล้วให้เข้าสู่ระบบหรือใช้ลืมรหัสผ่าน');}
  }catch(error){message(error.message||'เชื่อมต่อไม่สำเร็จ');}finally{$('signup-password').value='';$('signup-confirm').value='';button.disabled=false;}
 });
 $('forgot-password').addEventListener('click',()=>{$('reset-request-form').hidden=false;$('reset-email').value=$('email').value;message('กรอกอีเมลเพื่อรับลิงก์ตั้งรหัสผ่านใหม่');});
 $('reset-request-form').addEventListener('submit',async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;try{const {error}=await db.auth.resetPasswordForEmail($('reset-email').value.trim(),{redirectTo:redirect});message(error?authError(error):'หากมีบัญชีที่ใช้ได้ ระบบจะส่งลิงก์ตั้งรหัสผ่านใหม่ไปยังอีเมลนี้');}catch{message('เชื่อมต่อไม่สำเร็จ กรุณาลองอีกครั้ง');}finally{button.disabled=false;}});
 $('resend-confirmation').addEventListener('click',async e=>{const email=$('email').value.trim();if(!email||!$('email').checkValidity()){message('กรอกอีเมลในช่องเข้าสู่ระบบก่อน');return;}e.target.disabled=true;try{const {error}=await db.auth.resend({type:'signup',email,options:{emailRedirectTo:redirect}});message(error?authError(error):'หากบัญชียังรอยืนยัน ระบบจะส่งอีเมลยืนยันอีกครั้ง');}catch{message('เชื่อมต่อไม่สำเร็จ กรุณาลองอีกครั้ง');}finally{e.target.disabled=false;}});
 $('recovery-form').addEventListener('submit',async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;try{const password=$('recovery-password').value;if(password!==$('recovery-confirm').value||password.length<12)throw Error('รหัสผ่านต้องตรงกันและมีอย่างน้อย 12 ตัวอักษร');const {error}=await db.auth.updateUser({password});if(error)throw Error(authError(error));e.target.reset();state.recovery=false;showAuth(state.user);say('บันทึกรหัสผ่านใหม่แล้ว');}catch(error){$('recovery-message').textContent=error.message;}finally{$('recovery-password').value='';$('recovery-confirm').value='';button.disabled=false;}});
 async function session(user){
  const generation=++profileGeneration;$('password-recovery').hidden=!(user&&state.recovery);if(state.recovery){$('workspace').hidden=true;return;}
  $('profile-name').value='';if(!user)return;
  const {data,error}=await db.from('profiles').select('display_name').eq('id',user.id).single();
  if(generation!==profileGeneration||state.user?.id!==user.id)return;
  if(!error){$('profile-name').value=data.display_name;$('user-email').textContent=data.display_name?`${data.display_name} · ${user.email}`:user.email;}
 }
 window.financeMembers={session};void session(state.user);
 $('profile-form').addEventListener('submit',async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;try{const name=$('profile-name').value.trim();if(!name)throw Error('กรุณากรอกชื่อ');const {error}=await db.from('profiles').update({display_name:name}).eq('id',state.user.id);if(error)throw error;await session(state.user);say('บันทึกชื่อแล้ว');}catch(error){say(error.message,true);}finally{button.disabled=false;}});
 $('starter-categories').addEventListener('click',async e=>{e.target.disabled=true;try{const owner_id=state.user.id,defaults=[['อาหาร','expense'],['เดินทาง','expense'],['ที่พัก','expense'],['ซื้อของ','expense'],['สุขภาพ','expense'],['เงินเดือน','income'],['งานเสริม','income'],['ปันผล','income']];const {error}=await db.from('categories').upsert(defaults.map(([name,flow])=>({owner_id,name,flow})),{onConflict:'owner_id,name,flow',ignoreDuplicates:true});if(error)throw error;await loadData();say('เพิ่มหมวดเริ่มต้นแล้ว ไม่เพิ่มหมวดที่มีอยู่ซ้ำ');}catch(error){say(error.message,true);}finally{e.target.disabled=false;}});
})();
