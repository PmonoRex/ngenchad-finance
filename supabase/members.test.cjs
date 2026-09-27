const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(__dirname+'/../members.js','utf8');
const elements=new Map(),calls=[];
function el(id){if(!elements.has(id))elements.set(id,{value:'',hidden:false,textContent:'',listeners:{},addEventListener(type,fn){this.listeners[type]=fn},checkValidity(){return true},querySelector(){return this.button||(this.button={disabled:false})},reset(){}});return elements.get(id);}
const state={user:null,recovery:false};
const db={auth:{async signUp(input){calls.push(input);return {data:{session:null},error:null}},async resetPasswordForEmail(){return {error:null}},async resend(){return {error:null}}}};
const context=vm.createContext({window:{financeCore:{state,db,$:el,showAuth(){},say(){},loadData(){}}},location:{origin:'https://pmonorex.github.io',pathname:'/ngenchad-finance/'}});
vm.runInContext(source,context);
async function submit(id){await el(id).listeners.submit({preventDefault(){},target:el(id)});}
(async()=>{
 el('signup-name').value='Test';el('signup-email').value='test@example.invalid';el('signup-password').value='long-password-123';el('signup-confirm').value='different';
 await submit('signup-form');assert.equal(calls.length,0);assert.match(el('login-message').textContent,/ไม่ตรงกัน/);
 el('signup-password').value='long-password-123';el('signup-confirm').value='long-password-123';await submit('signup-form');assert.equal(calls.length,1);assert.equal(calls[0].options.emailRedirectTo,'https://pmonorex.github.io/ngenchad-finance/');assert.equal(el('signup-password').value,'');assert.equal(el('signup-confirm').value,'');assert.match(el('login-message').textContent,/ยืนยัน/);
 const app=fs.readFileSync(__dirname+'/../app.js','utf8');let release;let renders=0;
 const loadContext=vm.createContext({state:{user:{id:'old'},accounts:['new user sentinel']},dataGeneration:0,allRows:()=>new Promise(resolve=>release=resolve),quotes:{key:''},renderAll:()=>renders++,say:()=>{}});
 // Resolve all reads after switching the user; old responses must never replace new state.
 const pending=[];loadContext.allRows=()=>new Promise(resolve=>pending.push(resolve));
 vm.runInContext(app.slice(app.indexOf('  async function loadData()'),app.indexOf('  function showAuth(')),loadContext);
 const request=vm.runInContext('loadData()',loadContext);loadContext.state.user={id:'new'};pending.forEach(resolve=>resolve([]));await request;
 assert.equal(renders,0);assert.equal(loadContext.state.accounts[0],'new user sentinel');
 const storage=new Map([['ngenchad_twelvedata_key:new','fake-key-for-new-user']]);
 const switchState={user:{id:'old'},accounts:[{id:'private'}],transactions:[{amount:'999'}],recovery:false};let redraws=0,clears=0;
 const switchContext=vm.createContext({state:switchState,dataGeneration:0,pendingReceipt:{text:'private'},pendingCashSlip:{text:'private'},quotes:{key:'fake-old-key'},quoteStorageKey:id=>'ngenchad_twelvedata_key:'+id,localStorage:{getItem:key=>storage.get(key),removeItem:key=>storage.delete(key)},$:el,document:{querySelectorAll:()=>[]},resetTransaction(){},resetNote(){},clearStockChart(){},today:()=> '2026-09-27',visible(){},say(){},renderAll:()=>redraws++,loadData:async()=>{},window:{financeExtras:{clear:()=>clears++}}});
 vm.runInContext(app.slice(app.indexOf('  function showAuth('),app.indexOf('  function switchView(')),switchContext);
 switchContext.showAuth({id:'new',email:'new@example.invalid'});assert.equal(switchState.accounts.length,0);assert.equal(switchState.transactions.length,0);assert.equal(switchContext.quotes.key,'fake-key-for-new-user');assert.equal(switchContext.pendingReceipt,null);assert.equal(switchContext.pendingCashSlip,null);assert.equal(clears,1);
 switchContext.showAuth(null);assert.equal(switchContext.quotes.key,'');assert.equal(redraws,2);
 const html=fs.readFileSync(__dirname+'/../index.html','utf8');for(const match of source.matchAll(/\$\(['"]([\w-]+)['"]\)/g))assert.ok(html.includes(`id="${match[1]}"`),'missing '+match[1]);
 console.log('Passed: password mismatch, email confirmation flow, password cleanup, auth redirect, stale-user response isolation, member form bindings, per-user API key and logout cleanup');
})().catch(error=>{console.error(error);process.exitCode=1});
