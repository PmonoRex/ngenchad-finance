const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const src=fs.readFileSync(__dirname+'/../app.js','utf8');
const context=vm.createContext({state:{trades:[],securities:[]}});
vm.runInContext(src.slice(src.indexOf('  function units('),src.indexOf('  function money('))+src.slice(src.indexOf('  const roundDiv'),src.indexOf('  async function refreshStockPrices')),context);
const run=s=>vm.runInContext(s,context);
assert.equal(run('decimal(units("9999999999999999.1234"))'),'9999999999999999.1234');
assert.equal(run('decimal(tradeGross(shareUnits("0.1977811"), units("151.43")))'),'29.9500');
context.state.trades=[
{id:'1',security_id:'s',side:'buy',quantity:'1',gross_amount:'100',fees:'1',traded_on:'2026-01-01',created_at:'1'},
{id:'2',security_id:'s',side:'buy',quantity:'1',gross_amount:'200',fees:'1',traded_on:'2026-01-02',created_at:'2'},
{id:'3',security_id:'s',side:'sell',quantity:'0.5',gross_amount:'100',fees:'1',traded_on:'2026-01-03',created_at:'3'}];
assert.equal(run('decimal(portfolioModel("s").cost)'),'226.5000');
assert.equal(run('decimal(portfolioModel("s").realized)'),'23.5000');
assert.equal(run('shareDecimal(portfolioModel("s").shares)'),'1.50000000');
context.state.trades[0].voided_at='now';
assert.equal(run('decimal(portfolioModel("s").cost)'),'100.5000');
context.state.trades[2].quantity='2';assert.throws(()=>run('portfolioModel("s")'),/ขายเกิน/);
assert.equal(run('percentChange(units("184.03"),units("151.43"))'),'+21.53%');
const html=fs.readFileSync(__dirname+'/../index.html','utf8'),ext=fs.readFileSync(__dirname+'/../sessions.js','utf8');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length,'duplicate HTML ids');
for(const match of ext.matchAll(/\$\(['"]([\w-]+)['"]\)/g))assert.ok(ids.includes(match[1]),'missing element '+match[1]);
const csv=ext.slice(ext.indexOf(' function csvCell('),ext.indexOf(' function csv(name'));
vm.runInContext(csv,context);assert.equal(context.csvCell('=HYPERLINK("evil")'),'"\'=HYPERLINK(""evil"")"');
assert.equal(context.csvCell('ชื่อ,"ทดสอบ"'),'"ชื่อ,""ทดสอบ"""');
console.log('Passed: money precision, fractional gross, weighted cost, realized profit, void history, oversell, percentage, CSV safety, HTML bindings');
