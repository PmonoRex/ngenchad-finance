(() => {
  const $ = id => document.getElementById(id);
  const config = window.APP_CONFIG || {};
  const state = { user: null, accounts: [], balances: [], categories: [], transactions: [], notes: [], templates: [], securities: [], trades: [], taxProfiles: [], editTransaction: null, editNote: null, trash: false, voidTrades: false };
  const fx = { status: 'idle', rate: null, date: null, source: null };
  const sourceNames = { salary: 'เงินเดือน', freelance: 'งานเสริม', dividend: 'ปันผล', other: 'รายรับอื่น' };
  const kindNames = { income: 'รายรับ', expense: 'รายจ่าย', transfer: 'โอนเงิน' };
  const visible = (id, yes) => { $(id).hidden = !yes; };
  const say = (text, error = false) => { const el = $('workspace-message'); el.textContent = text; el.classList.toggle('error', error); };
  const elem = (tag, text, className) => { const el = document.createElement(tag); if (text != null) el.textContent = text; if (className) el.className = className; return el; };
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

  // Supabase stores NUMERIC(20,4). Use integer units in the browser too.
  function units(raw) {
    const value = String(raw ?? '').trim();
    if (!/^-?\d+(\.\d{1,4})?$/.test(value)) throw new Error('จำนวนเงินต้องมีทศนิยมไม่เกิน 4 ตำแหน่ง');
    const negative = value.startsWith('-');
    const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
    const n = BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0'));
    return negative ? -n : n;
  }
  function decimal(n) {
    const sign = n < 0n ? '-' : '';
    const v = n < 0n ? -n : n;
    return `${sign}${v / 10000n}.${String(v % 10000n).padStart(4, '0')}`;
  }
  function money(raw, currency = 'THB') {
    const n = units(raw);
    const sign = n < 0n ? '−' : '';
    const v = n < 0n ? -n : n;
    const whole = String(v / 10000n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const frac = String(v % 10000n).padStart(4, '0').replace(/0+$/, '');
    return `${sign}${whole}${frac ? '.' + frac : ''} ${currency}`;
  }
  const moneyUnits = (value, currency) => money(decimal(value), currency);
  function positive(raw) { const n = units(raw); if (n <= 0n) throw new Error('จำนวนเงินต้องมากกว่า 0'); return decimal(n); }
  function account(id) { return state.accounts.find(a => a.id === id); }
  function category(id) { return state.categories.find(c => c.id === id); }
  function activeTransactions() { return state.transactions.filter(t => !t.deleted_at); }

  if (!config.supabaseUrl || !config.supabasePublishableKey || !window.supabase) {
    visible('setup', true); $('status').textContent = 'รอการเชื่อม Supabase'; return;
  }
  const db = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey);

  async function allRows(table, columns, configure = q => q) {
    const rows = [];
    for (let start = 0; ; start += 1000) {
      const { data, error } = await configure(db.from(table).select(columns)).range(start, start + 999);
      if (error) throw error;
      rows.push(...data);
      if (data.length < 1000) return rows;
    }
  }
  async function loadData() {
    try {
      const [accounts, balances, categories, transactions, notes, templates, securities, trades, taxProfiles] = await Promise.all([
        allRows('accounts', 'id,name,kind,currency,opening_balance,created_at,archived_at', q => q.order('created_at', { ascending: true })),
        allRows('account_balances', 'account_id,owner_id,currency,balance'),
        allRows('categories', 'id,name,flow', q => q.order('name')),
        allRows('cash_transactions', 'id,kind,occurred_on,from_account_id,to_account_id,category_id,amount,received_amount,description,gross_amount,withheld_tax_amount,income_source,source_fingerprint,deleted_at,created_at', q => q.order('occurred_on', { ascending: false }).order('created_at', { ascending: false })),
        allRows('notes', 'id,title,body,transaction_id,created_at', q => q.order('created_at', { ascending: false })),
        allRows('quick_templates', 'id,name,kind,account_id,category_id,amount,description,income_source,gross_amount,withheld_tax_amount,created_at', q => q.order('created_at', { ascending: false })),
        allRows('securities', 'id,market,symbol,name,currency,last_price,price_as_of,created_at', q => q.order('market').order('symbol')),
        allRows('investment_trades', 'id,security_id,side,traded_on,quantity,unit_price,gross_amount,fees,note,source_fingerprint,voided_at,created_at', q => q.order('traded_on', { ascending: false }).order('created_at', { ascending: false })),
        allRows('tax_profiles', 'tax_year,freelance_mode,freelance_expense,dividend_mode,other_deductions,forecast_salary,forecast_freelance')
      ]);
      Object.assign(state, { accounts, balances, categories, transactions, notes, templates, securities, trades, taxProfiles });
      renderAll();
    } catch (error) { say(`โหลดข้อมูลไม่สำเร็จ: ${error.message}`, true); }
  }
  function showAuth(user) {
    state.user = user;
    visible('setup', false); visible('login', !user); visible('workspace', !!user); visible('signout', !!user);
    $('status').textContent = user ? 'ข้อมูลส่วนตัว' : 'เข้าสู่ระบบเพื่อดูข้อมูล';
    $('user-email').textContent = user?.email || '';
    if (user) void loadData();
    else { Object.assign(state, { accounts: [], balances: [], categories: [], transactions: [], notes: [], templates: [], securities: [], trades: [], taxProfiles: [] }); say(''); }
  }
  function switchView(view) {
    for (const name of ['dashboard', 'transactions', 'portfolio', 'tax', 'accounts', 'notes']) {
      $(`${name}-view`).classList.toggle('active', name === view);
      document.querySelector(`[data-view="${name}"]`).classList.toggle('active', name === view);
    }
    $('view-title').textContent = { dashboard: 'ภาพรวมการเงิน', transactions: 'รายการเงิน', portfolio: 'พอร์ตหุ้น', tax: 'ประมาณการภาษี', accounts: 'บัญชีและหมวด', notes: 'บันทึก' }[view];
    say('');
  }

  function renderAll() { renderDashboard(); renderPortfolio(); renderTax(); renderAccounts(); renderCategories(); renderTransactions(); renderTemplates(); renderNotes(); }
  async function loadExchangeRate() {
    if (fx.status === 'loading') return;
    fx.status = 'loading'; renderAssetSummary();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      let response;
      try { response = await fetch('https://api.frankfurter.dev/v2/rate/usd/thb', { signal: controller.signal }); }
      finally { clearTimeout(timeout); }
      if (!response.ok) throw new Error('โหลดอัตราแลกเปลี่ยนไม่สำเร็จ');
      const data = await response.json();
      if (String(data.base).toUpperCase() !== 'USD' || String(data.quote).toUpperCase() !== 'THB' || !Number.isFinite(Number(data.rate)) || Number(data.rate) < 10 || Number(data.rate) > 100 || !/^20\d{2}-\d{2}-\d{2}$/.test(data.date)) throw new Error('ข้อมูลอัตราแลกเปลี่ยนไม่ถูกต้อง');
      fx.rate = Number(data.rate); fx.date = data.date; fx.source = 'Frankfurter'; fx.status = 'ready';
    } catch {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        let response;
        try { response = await fetch('https://open.er-api.com/v6/latest/USD', { signal: controller.signal }); }
        finally { clearTimeout(timeout); }
        if (!response.ok) throw new Error('โหลดอัตราแลกเปลี่ยนไม่สำเร็จ');
        const data = await response.json();
        const rate = Number(data.rates?.THB);
        const date = new Date(Number(data.time_last_update_unix) * 1000).toISOString().slice(0, 10);
        if (data.result !== 'success' || data.base_code !== 'USD' || !Number.isFinite(rate) || rate < 10 || rate > 100 || !/^20\d{2}-\d{2}-\d{2}$/.test(date)) throw new Error('ข้อมูลอัตราแลกเปลี่ยนไม่ถูกต้อง');
        fx.rate = rate; fx.date = date; fx.source = 'ExchangeRate-API'; fx.status = 'ready';
      } catch { fx.rate = null; fx.date = null; fx.source = null; fx.status = 'error'; }
    }
    renderAssetSummary();
  }
  function renderAssetSummary() {
    const byCurrency = { THB: { cash: 0n, stocks: 0n, missing: 0, accounts: 0 }, USD: { cash: 0n, stocks: 0n, missing: 0, accounts: 0 } };
    let negativeAccounts = 0;
    for (const a of state.accounts.filter(a => !a.archived_at)) {
      const bucket = byCurrency[a.currency]; if (!bucket) continue;
      const balance = units(state.balances.find(b => b.account_id === a.id)?.balance ?? a.opening_balance);
      bucket.cash += balance; bucket.accounts++;
      if (balance < 0n) negativeAccounts++;
    }
    for (const s of state.securities) {
      const bucket = byCurrency[s.currency]; if (!bucket) continue;
      try {
        const holding = portfolioModel(s.id);
        if (holding.shares <= 0n) continue;
        if (s.last_price == null) bucket.missing++;
        else bucket.stocks += tradeGross(holding.shares, units(s.last_price));
      } catch { bucket.missing++; }
    }
    const thbTotal = byCurrency.THB.cash + byCurrency.THB.stocks;
    const usdTotal = byCurrency.USD.cash + byCurrency.USD.stocks;
    const box = $('asset-summary'); box.replaceChildren();
    const hero = elem('div', null, 'asset-total');
    hero.append(elem('span', 'สินทรัพย์รวมประมาณการ (THB)'));
    if (fx.status === 'ready') {
      const rateUnits = BigInt(Math.round(fx.rate * 1000000));
      const converted = roundDiv(usdTotal * rateUnits, 1000000n);
      hero.append(elem('strong', moneyUnits(thbTotal + converted, 'THB')));
      const details = elem('small', `เงินและหุ้น THB ${moneyUnits(thbTotal, 'THB')} + USD ${moneyUnits(usdTotal, 'USD')} × ${fx.rate.toLocaleString('en-US', { maximumFractionDigits: 6 })}`);
      hero.append(details);
    } else {
      hero.append(elem('strong', 'รออัตราแลกเปลี่ยน'));
      hero.append(elem('small', 'แสดงยอดแยกสกุลเงินด้านล่าง'));
    }
    box.append(hero);
    for (const currency of ['THB', 'USD']) {
      const item = byCurrency[currency];
      const card = elem('div', null, 'asset-currency');
      card.append(elem('span', `สินทรัพย์ ${currency}`), elem('strong', moneyUnits(item.cash + item.stocks, currency)));
      card.append(elem('small', `เงินในบัญชี ${moneyUnits(item.cash, currency)} · หุ้นที่มีราคา ${moneyUnits(item.stocks, currency)}`));
      box.append(card);
    }
    const warning = $('asset-warning'); warning.replaceChildren();
    const missing = byCurrency.THB.missing + byCurrency.USD.missing;
    const notes = [];
    if (fx.status === 'ready') notes.push(`อัตรา 1 USD = ${fx.rate.toLocaleString('en-US', { maximumFractionDigits: 6 })} THB ณ ${fx.date} จาก `);
    else if (fx.status === 'loading') notes.push('กำลังโหลดอัตรา USD/THB…');
    else if (fx.status === 'error') notes.push('โหลดอัตรา USD/THB ไม่สำเร็จ จึงยังไม่รวมเป็นบาท');
    if (notes.length) warning.append(elem('span', notes[0]));
    if (fx.status === 'ready') { const link = elem('a', fx.source === 'Frankfurter' ? 'Frankfurter' : 'Rates By Exchange Rate API'); link.href = fx.source === 'Frankfurter' ? 'https://frankfurter.dev/' : 'https://www.exchangerate-api.com'; link.target = '_blank'; link.rel = 'noopener noreferrer'; warning.append(link); }
    if (fx.status === 'error') { const retry = elem('button', 'ลองใหม่', 'outline small'); retry.type = 'button'; retry.addEventListener('click', () => { void loadExchangeRate(); }); warning.append(retry); }
    const caveats = [];
    if (missing) caveats.push(`ยังไม่รวม ${missing} หุ้นที่ไม่มีราคาอ้างอิง`);
    if (negativeAccounts) caveats.push(`มี ${negativeAccounts} บัญชีติดลบ กรุณาตรวจยอดตั้งต้น`);
    caveats.push('รายการซื้อ–ขายหุ้นยังไม่ปรับยอดบัญชีเงินอัตโนมัติ หากยอดบัญชียังไม่หักเงินซื้อหุ้น ยอดรวมอาจสูงกว่าความจริง');
    warning.append(elem('span', `${fx.status === 'ready' || fx.status === 'error' ? ' · ' : ''}${caveats.join(' · ')}`));
  }
  function dashboardCurrency(t) {
    const id = t.kind === 'income' ? t.to_account_id : t.from_account_id;
    return account(id)?.currency;
  }
  function dashboardMonths(count) {
    const now = new Date();
    return Array.from({ length: count }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - count + index + 1, 1);
      return { key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`, label: date.toLocaleDateString('th-TH', { month: 'short', year: '2-digit' }), income: 0n, expense: 0n };
    });
  }
  function dashboardBar(label, value, maximum, currency, tone) {
    const row = elem('div', null, 'dashboard-breakdown-row');
    const head = elem('div', null, 'breakdown-head');
    head.append(elem('span', label), elem('strong', moneyUnits(value, currency)));
    const track = elem('div', null, 'breakdown-track');
    const fill = elem('span', null, tone);
    fill.style.width = `${maximum ? Number(value * 100n / maximum) : 0}%`;
    track.append(fill); row.append(head, track); return row;
  }
  function renderDashboard() {
    renderAssetSummary();
    if (fx.status === 'idle') void loadExchangeRate();
    const currency = $('dashboard-currency').value;
    const months = dashboardMonths(Number($('dashboard-period').value));
    const byMonth = new Map(months.map(m => [m.key, m]));
    const categories = new Map(); const sources = new Map();
    let income = 0n, expense = 0n, withheld = 0n, gross = 0n;
    const recent = [];
    for (const t of activeTransactions()) {
      if (dashboardCurrency(t) !== currency || !byMonth.has(t.occurred_on.slice(0, 7))) continue;
      if (t.kind === 'transfer') continue;
      const value = units(t.amount); const bucket = byMonth.get(t.occurred_on.slice(0, 7));
      if (t.kind === 'income') {
        income += value; bucket.income += value;
        withheld += units(t.withheld_tax_amount || '0'); gross += units(t.gross_amount || t.amount);
        const key = t.income_source || 'other'; sources.set(key, (sources.get(key) || 0n) + value);
      } else if (t.kind === 'expense') {
        expense += value; bucket.expense += value;
        const key = category(t.category_id)?.name || 'ไม่ระบุหมวด'; categories.set(key, (categories.get(key) || 0n) + value);
      }
      recent.push(t);
    }
    let balance = 0n;
    for (const a of state.accounts.filter(a => !a.archived_at && a.currency === currency)) {
      balance += units(state.balances.find(b => b.account_id === a.id)?.balance ?? a.opening_balance);
    }
    const metrics = [
      ['ยอดรวมบัญชี', balance, 'ยอดปัจจุบันของบัญชีสกุลนี้'],
      ['รายรับสุทธิ', income, 'หลังหักภาษี ณ ที่จ่าย'],
      ['รายจ่าย', expense, 'ไม่รวมเงินโอน'],
      ['เงินคงเหลือจากรายการ', income - expense, 'รายรับสุทธิ − รายจ่าย']
    ];
    const cards = $('dashboard-metrics'); cards.replaceChildren();
    for (const [label, value, detail] of metrics) {
      const card = elem('div', null, 'metric-card');
      card.append(elem('span', label), elem('strong', moneyUnits(value, currency)), elem('small', detail)); cards.append(card);
    }
    const chart = $('dashboard-chart'); chart.replaceChildren();
    chart.style.gridTemplateColumns = `repeat(${months.length}, minmax(0, 1fr))`;
    const max = months.reduce((m, x) => [m, x.income, x.expense].reduce((a, b) => a > b ? a : b), 0n);
    for (const month of months) {
      const column = elem('div', null, 'chart-month'); const bars = elem('div', null, 'chart-bars');
      for (const [kind, value] of [['income', month.income], ['expense', month.expense]]) {
        const bar = elem('div', null, `chart-bar ${kind}`);
        bar.style.height = `${value ? Math.max(3, Number(value * 100n / max)) : 0}%`;
        bar.title = `${month.label} ${kind === 'income' ? 'รายรับสุทธิ' : 'รายจ่าย'} ${moneyUnits(value, currency)}`;
        bars.append(bar);
      }
      column.append(bars, elem('span', month.label)); chart.append(column);
    }
    chart.setAttribute('aria-label', months.map(m => `${m.label}: รายรับ ${moneyUnits(m.income, currency)}, รายจ่าย ${moneyUnits(m.expense, currency)}`).join('; '));
    const expenseBox = $('dashboard-categories'); expenseBox.replaceChildren();
    if (!categories.size) expenseBox.append(elem('p', 'ยังไม่มีรายจ่ายในช่วงเวลานี้', 'empty'));
    else for (const [label, value] of [...categories].sort((a, b) => a[1] > b[1] ? -1 : a[1] < b[1] ? 1 : 0).slice(0, 6)) expenseBox.append(dashboardBar(label, value, expense, currency, 'expense-fill'));
    const incomeBox = $('dashboard-sources'); incomeBox.replaceChildren();
    if (!sources.size) incomeBox.append(elem('p', 'ยังไม่มีรายรับในช่วงเวลานี้', 'empty'));
    else for (const [key, value] of [...sources].sort((a, b) => a[1] > b[1] ? -1 : a[1] < b[1] ? 1 : 0)) incomeBox.append(dashboardBar(sourceNames[key] || sourceNames.other, value, income, currency, 'income-fill'));
    $('dashboard-tax').textContent = income ? `รายได้ก่อนหัก ${moneyUnits(gross, currency)} · ภาษีหัก ณ ที่จ่าย ${moneyUnits(withheld, currency)}` : '';
    const recentBox = $('dashboard-recent'); recentBox.replaceChildren();
    recent.sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.created_at.localeCompare(a.created_at));
    if (!recent.length) recentBox.append(elem('p', 'ยังไม่มีรายการในช่วงเวลานี้', 'empty'));
    for (const t of recent.slice(0, 5)) {
      const row = elem('div', null, 'recent-row'); const detail = elem('div');
      detail.append(elem('strong', t.description || category(t.category_id)?.name || kindNames[t.kind]), elem('small', `${t.occurred_on} · ${kindNames[t.kind]}`));
      row.append(detail, elem('strong', `${t.kind === 'income' ? '+' : '−'}${money(t.amount, currency)}`, t.kind === 'income' ? 'positive' : 'negative')); recentBox.append(row);
    }
  }
  const roundDiv = (value, divisor) => (value + divisor / 2n) / divisor;
  function shareUnits(raw) {
    const value = String(raw ?? '').trim();
    if (!/^\d+(\.\d{1,8})?$/.test(value)) throw new Error('จำนวนหุ้นต้องมีทศนิยมไม่เกิน 8 ตำแหน่ง');
    const [whole, fraction = ''] = value.split('.');
    return BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, '0'));
  }
  function shareDecimal(value) { return `${value / 100000000n}.${String(value % 100000000n).padStart(8, '0')}`; }
  const shareText = value => shareDecimal(value).replace(/\.?0+$/, '');
  function security(id) { return state.securities.find(s => s.id === id); }
  function tradeGross(quantity, price) { return roundDiv(quantity * price, 100000000n); }
  function portfolioModel(securityId, extraTrade = null) {
    const trades = state.trades.filter(t => t.security_id === securityId && !t.voided_at);
    if (extraTrade) trades.push(extraTrade);
    trades.sort((a, b) => a.traded_on.localeCompare(b.traded_on) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
    let shares = 0n, cost = 0n, realized = 0n;
    for (const t of trades) {
      const quantity = shareUnits(t.quantity), gross = units(t.gross_amount), fees = units(t.fees);
      if (t.side === 'buy') { shares += quantity; cost += gross + fees; }
      else {
        if (quantity > shares) throw new Error('ขายเกินจำนวนหุ้นที่ถือ ณ วันที่รายการ');
        if (fees > gross) throw new Error('ค่าธรรมเนียมขายเกินมูลค่าขาย');
        const removedCost = quantity === shares ? cost : roundDiv(cost * quantity, shares);
        shares -= quantity; cost -= removedCost; realized += gross - fees - removedCost;
      }
    }
    return { shares, cost, realized };
  }
  function renderPortfolio() {
    const market = $('portfolio-market').value, currency = market === 'SET' ? 'THB' : 'USD';
    const listed = state.securities.filter(s => s.market === market);
    fillSelect($('trade-security'), listed, 'เลือกหุ้น', s => `${s.symbol} · ${s.name}`);
    fillSelect($('price-security'), listed, 'เลือกหุ้น', s => `${s.symbol} · ${s.name}`);
    fillSelect($('chart-security'), listed, 'เลือกหุ้นในพอร์ต (หรือกรอกรหัสเอง)', s => `${s.symbol} · ${s.name}`);
    let totalCost = 0n, totalValue = 0n, totalUnrealized = 0n, totalRealized = 0n, priced = 0, heldCount = 0;
    const holdings = $('portfolio-holdings'); holdings.replaceChildren();
    if (!listed.length) holdings.append(elem('p', 'ยังไม่มีหุ้นในตลาดนี้ เริ่มจากเพิ่มหุ้นด้านล่าง', 'empty'));
    for (const s of listed) {
      let model;
      try { model = portfolioModel(s.id); } catch (error) { holdings.append(elem('p', `${s.symbol}: ${error.message}`, 'error')); continue; }
      const { shares, cost, realized } = model;
      totalRealized += realized;
      if (shares > 0n) { heldCount++; totalCost += cost; }
      const hasPrice = s.last_price != null && shares > 0n;
      const value = hasPrice ? tradeGross(shares, units(s.last_price)) : null;
      if (value != null) { priced++; totalValue += value; totalUnrealized += value - cost; }
      const card = elem('article', null, 'holding-card'); const head = elem('div', null, 'holding-head');
      const title = elem('div'); title.append(elem('strong', s.symbol), elem('small', s.name));
      head.append(title, elem('span', shares ? `${shareText(shares)} หุ้น` : 'ยังไม่ถือ', 'holding-badge')); card.append(head);
      const details = elem('div', null, 'holding-details');
      details.append(elem('span', 'ต้นทุนที่ถือ'), elem('strong', moneyUnits(cost, currency)));
      details.append(elem('span', 'ต้นทุนเฉลี่ย/หุ้น'), elem('strong', shares ? moneyUnits(roundDiv(cost * 100000000n, shares), currency) : '—'));
      details.append(elem('span', 'ราคาอ้างอิง'), elem('strong', s.last_price != null ? `${money(s.last_price, currency)} · ${s.price_as_of}` : 'ยังไม่ระบุ'));
      details.append(elem('span', 'มูลค่า / กำไรที่ยังไม่ขาย'), elem('strong', value != null ? `${moneyUnits(value, currency)} / ${moneyUnits(value - cost, currency)}` : '—'));
      details.append(elem('span', 'กำไรจากการขายแล้ว'), elem('strong', moneyUnits(realized, currency)));
      card.append(details); holdings.append(card);
    }
    const metrics = [
      ['ต้นทุนหุ้นที่ถือ', moneyUnits(totalCost, currency), `${heldCount} หุ้นที่ยังถือ`],
      ['มูลค่าประเมิน', priced ? moneyUnits(totalValue, currency) : '—', `มีราคา ${priced}/${heldCount} หุ้นที่ถือ`],
      ['กำไรที่ยังไม่ขาย', priced ? moneyUnits(totalUnrealized, currency) : '—', 'เฉพาะหุ้นที่มีราคาอ้างอิง'],
      ['กำไรจากการขายแล้ว', moneyUnits(totalRealized, currency), 'ตามต้นทุนเฉลี่ยถ่วงน้ำหนัก']
    ];
    const box = $('portfolio-metrics'); box.replaceChildren();
    for (const [label, value, detail] of metrics) {
      const card = elem('div', null, 'metric-card'); card.append(elem('span', label), elem('strong', value), elem('small', detail)); box.append(card);
    }
    renderTradeList(); updateTradePreview();
  }
  function renderTradeList() {
    const market = $('portfolio-market').value, body = $('trade-list'); body.replaceChildren();
    $('toggle-void-trades').textContent = state.voidTrades ? 'กลับไปรายการปกติ' : 'ดูรายการที่ยกเลิก';
    const rows = state.trades.filter(t => Boolean(t.voided_at) === state.voidTrades && security(t.security_id)?.market === market)
      .sort((a, b) => b.traded_on.localeCompare(a.traded_on) || b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
    if (!rows.length) { const tr = elem('tr'); const td = elem('td', 'ยังไม่มีรายการ', 'empty'); td.colSpan = 7; tr.append(td); body.append(tr); }
    for (const t of rows) {
      const s = security(t.security_id), tr = elem('tr');
      tr.append(elem('td', t.traded_on), elem('td', s.symbol), elem('td', t.side === 'buy' ? 'ซื้อ' : 'ขาย'));
      tr.append(elem('td', shareText(shareUnits(t.quantity)), 'right'), elem('td', money(t.unit_price, s.currency), 'right'));
      const total = units(t.gross_amount) + (t.side === 'buy' ? units(t.fees) : -units(t.fees));
      const moneyCell = elem('td', moneyUnits(total, s.currency), 'right'); moneyCell.title = `ค่าธรรมเนียม ${money(t.fees, s.currency)}${t.note ? ' · ' + t.note : ''}`;
      tr.append(moneyCell);
      const controls = elem('td'); const button = elem('button', state.voidTrades ? 'กู้คืน' : 'ยกเลิก', `outline small${state.voidTrades ? '' : ' danger'}`);
      button.dataset.tradeId = t.id; controls.append(button); tr.append(controls); body.append(tr);
    }
  }
  function updateTradePreview() {
    const target = $('trade-preview'), securityId = $('trade-security').value, s = security(securityId);
    try {
      if (!s || !$('trade-quantity').value || !$('trade-price').value) throw new Error('');
      const quantity = shareUnits($('trade-quantity').value), price = units($('trade-price').value), fees = units($('trade-fees').value || '0');
      if (quantity <= 0n || price <= 0n || fees < 0n) throw new Error('');
      const gross = tradeGross(quantity, price), buy = $('trade-side').value === 'buy';
      if (!buy && fees > gross) throw new Error('ค่าธรรมเนียมเกินยอดขาย');
      target.textContent = `${buy ? 'จ่ายรวม' : 'รับสุทธิ'} ${moneyUnits(buy ? gross + fees : gross - fees, s.currency)} · ก่อนค่าธรรมเนียม ${moneyUnits(gross, s.currency)}`;
    } catch (error) { target.textContent = error.message || 'กรอกหุ้น จำนวน และราคาเพื่อดูยอดโดยประมาณ'; }
  }
  function clearStockChart() {
    $('stock-chart').replaceChildren(elem('p', 'เลือกหุ้นแล้วกดดูกราฟ', 'empty'));
    $('chart-help').textContent = 'กราฟใช้สำหรับดูประกอบการตัดสินใจเท่านั้น ราคาที่คำนวณพอร์ตยังเป็นราคาที่คุณกรอกเอง';
  }
  function renderStockChart() {
    const market = $('portfolio-market').value;
    const symbol = $('chart-symbol').value.trim().toUpperCase();
    if (!/^[A-Z0-9._-]{2,15}:[A-Z0-9._-]{1,20}$/.test(symbol)) throw new Error('กรอกรหัสแบบ ตลาด:หุ้น เช่น NASDAQ:AAPL หรือ SET:PTT');
    const [exchange, ticker] = symbol.split(':');
    if (market === 'SET' && exchange !== 'SET') throw new Error('หุ้นไทยต้องใช้รหัสขึ้นต้น SET:');
    if (market === 'US' && exchange === 'SET') throw new Error('เลือกตลาดหุ้นไทยก่อน');
    const box = $('stock-chart'); box.replaceChildren();
    const link = elem('a', `เปิด ${symbol} บน TradingView`);
    link.href = `https://www.tradingview.com/symbols/${encodeURIComponent(exchange)}-${encodeURIComponent(ticker)}/`;
    link.target = '_blank'; link.rel = 'noopener noreferrer';
    if (market === 'SET') {
      const info = elem('div', null, 'empty');
      info.append(elem('p', 'หุ้นไทย: เปิดกราฟบนเว็บไซต์ TradingView โดยตรง'), link);
      box.append(info);
      $('chart-help').textContent = 'Widget สำหรับ SET ยังไม่อยู่ในรายชื่อตลาดที่ TradingView ให้ใช้กับเว็บภายนอก';
      return;
    }
    const container = elem('div', null, 'tradingview-widget-container');
    const widget = elem('div', null, 'tradingview-widget-container__widget');
    const attribution = elem('div', null, 'tradingview-widget-copyright');
    attribution.append(link, elem('span', ' · กราฟโดย TradingView'));
    const script = document.createElement('script');
    script.type = 'text/javascript'; script.async = true;
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.textContent = JSON.stringify({ autosize: true, symbol, interval: 'D', timezone: 'exchange', theme: 'light', style: '1', locale: 'en', allow_symbol_change: true, hide_side_toolbar: true, withdateranges: true, save_image: false, support_host: 'https://www.tradingview.com' });
    container.append(widget, attribution, script); box.append(container);
    $('chart-help').textContent = `กำลังแสดง ${symbol} · ตรวจรหัสตลาดให้ตรงกับหุ้นจริง ราคากราฟไม่อัปเดตราคาอ้างอิงในพอร์ต`;
  }
  let pendingReceipt = null;
  let receiptBusy = false;
  const receiptStatus = (message, error = false) => { $('receipt-status').textContent = message; $('receipt-status').classList.toggle('error', error); };
  function loadExternalScript(url, globalName) {
    if (window[globalName]) return Promise.resolve(window[globalName]);
    return new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = url; script.async = true;
      script.onload = () => window[globalName] ? resolve(window[globalName]) : reject(new Error('โหลดเครื่องมืออ่านเอกสารไม่สำเร็จ'));
      script.onerror = () => reject(new Error('โหลดเครื่องมืออ่านเอกสารไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วลองใหม่'));
      document.head.append(script);
    });
  }
  async function receiptImage(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.heic') || name.endsWith('.heif') || /heic|heif/.test(file.type)) {
      const converter = await loadExternalScript('https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js', 'heic2any');
      const result = await converter({ blob: file, toType: 'image/png' });
      return Array.isArray(result) ? result[0] : result;
    }
    if (name.endsWith('.pdf') || file.type === 'application/pdf') {
      const pdfjs = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.624/build/pdf.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.624/build/pdf.worker.mjs';
      const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
      try {
        if (pdf.numPages !== 1) throw new Error('รองรับ PDF หลักฐาน 1 หน้าเท่านั้น');
        const page = await pdf.getPage(1);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(2, 2800 / Math.max(base.width, base.height)) });
        const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('แปลง PDF ไม่สำเร็จ')), 'image/png'));
      } finally { await pdf.destroy(); }
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) && !/\.(png|jpe?g|webp)$/.test(name)) throw new Error('รองรับ JPG, PNG, HEIC และ PDF 1 หน้า');
    return file;
  }
  async function fileFingerprint(file) {
    const bytes = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  function fillReceiptReview(data) {
    $('receipt-market').value = data.market || '';
    $('receipt-side').value = data.side || '';
    $('receipt-symbol').value = data.symbol || '';
    $('receipt-date').value = data.tradedOn || '';
    $('receipt-quantity').value = data.quantity || '';
    $('receipt-price').value = data.unitPrice || '';
    $('receipt-fees').value = data.fees || '';
    $('receipt-ocr-text').textContent = data.text || '';
    $('receipt-review').hidden = false;
  }
  function receiptFormData() {
    return {
      market: $('receipt-market').value, side: $('receipt-side').value,
      symbol: $('receipt-symbol').value.trim().toUpperCase(), tradedOn: $('receipt-date').value,
      quantity: $('receipt-quantity').value, unitPrice: $('receipt-price').value,
      fees: $('receipt-fees').value, broker: pendingReceipt?.parsed?.broker || ''
    };
  }
  async function saveImportedTrade(data, fingerprint, auto = false) {
    if (!state.user) throw new Error('กรุณาเข้าสู่ระบบก่อน');
    const { market, side, symbol, tradedOn } = data;
    if (!['US', 'SET'].includes(market) || !['buy', 'sell'].includes(side)) throw new Error('กรุณาตรวจตลาดและประเภทคำสั่ง');
    if (!/^[A-Z0-9._^-]{1,20}$/.test(symbol)) throw new Error('กรุณาตรวจสัญลักษณ์หุ้น');
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(tradedOn)) throw new Error('กรุณาตรวจวันที่ซื้อ–ขาย');
    const quantity = shareUnits(data.quantity), unitPrice = units(data.unitPrice), fees = units(data.fees);
    if (quantity <= 0n || unitPrice <= 0n || fees < 0n) throw new Error('จำนวนหุ้น ราคา หรือค่าธรรมเนียมไม่ถูกต้อง');
    const gross = tradeGross(quantity, unitPrice);
    if (gross <= 0n || (side === 'sell' && fees > gross)) throw new Error('ยอดซื้อขายไม่ถูกต้อง');
    const existing = state.securities.find(s => s.market === market && s.symbol === symbol);
    if (state.trades.some(t => t.source_fingerprint === fingerprint)) throw new Error('หลักฐานนี้เคยบันทึกแล้ว');
    if (existing && state.trades.some(t => t.security_id === existing.id && !t.voided_at && t.side === side && t.traded_on === tradedOn && shareUnits(t.quantity) === quantity && units(t.unit_price) === unitPrice && units(t.fees) === fees)) {
      throw new Error('พบรายการที่มีหุ้น วันที่ จำนวน ราคา และค่าธรรมเนียมตรงกันแล้ว กรุณาตรวจประวัติ');
    }
    if (auto && !data.broker) throw new Error('ต้องตรวจเอกสารก่อนบันทึก');
    let securityId = existing?.id;
    if (!securityId) {
      if (side === 'sell') throw new Error('ยังไม่มีหุ้นนี้ในพอร์ต กรุณาตรวจรายการก่อน');
      const result = await db.from('securities').insert({ owner_id: state.user.id, market, symbol, name: symbol, currency: market === 'SET' ? 'THB' : 'USD' }).select('id').single();
      if (result.error) throw result.error;
      securityId = result.data.id;
    }
    const row = { owner_id: state.user.id, security_id: securityId, side, traded_on: tradedOn, quantity: shareDecimal(quantity), unit_price: decimal(unitPrice), fees: decimal(fees), note: `นำเข้าจากหลักฐาน${data.broker ? ' ' + data.broker : ''}`, source_fingerprint: fingerprint };
    portfolioModel(securityId, { ...row, id: 'zzzzzzzz', gross_amount: decimal(gross), created_at: new Date().toISOString(), voided_at: null });
    const result = await db.from('investment_trades').insert(row);
    if (result.error) throw result.error;
    $('portfolio-market').value = market;
    $('receipt-file').value = '';
    $('receipt-review').hidden = true;
    pendingReceipt = null;
    await loadData();
    receiptStatus(`บันทึก${side === 'buy' ? 'ซื้อ' : 'ขาย'} ${symbol} ${shareText(quantity)} หุ้น วันที่ ${tradedOn} แล้ว`);
    say('บันทึกรายการหุ้นจากหลักฐานแล้ว');
  }
  async function importReceipt(file) {
    if (!file || receiptBusy) return;
    receiptBusy = true; $('receipt-file').disabled = true; $('receipt-review').hidden = true; pendingReceipt = null;
    try {
      if (file.size > 15 * 1024 * 1024) throw new Error('ไฟล์ต้องไม่เกิน 15 MB');
      receiptStatus('กำลังเตรียมเอกสาร…');
      const fingerprint = await fileFingerprint(file);
      if (state.trades.some(t => t.source_fingerprint === fingerprint)) throw new Error('หลักฐานนี้เคยบันทึกแล้ว');
      const image = await receiptImage(file);
      receiptStatus('กำลังอ่านตัวอักษรบนเครื่องของคุณ…');
      const tesseract = await loadExternalScript('https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js', 'Tesseract');
      const worker = await tesseract.createWorker(['tha', 'eng'], 1, { logger: m => { if (m.status === 'recognizing text') receiptStatus(`กำลังอ่านเอกสาร ${Math.round((m.progress || 0) * 100)}%…`); } });
      let ocr;
      try { ocr = (await worker.recognize(image)).data; }
      finally { await worker.terminate(); }
      const parsed = window.TradeReceipt.parse(ocr.text);
      pendingReceipt = { fingerprint, parsed };
      fillReceiptReview(parsed);
      if (parsed.ready && ocr.confidence >= 55) {
        receiptStatus('ข้อมูลครบและยอดตรงกัน กำลังบันทึก…');
        try { await saveImportedTrade(parsed, fingerprint, true); return; }
        catch (error) { receiptStatus(`${error.message} ตรวจข้อมูลด้านล่างก่อนบันทึก`, true); }
      } else {
        const reason = parsed.warnings.length ? parsed.warnings.join(' · ') : 'ความมั่นใจของ OCR ยังต่ำ';
        receiptStatus(`ต้องตรวจข้อมูลก่อนบันทึก: ${reason}`, true);
      }
    } catch (error) { receiptStatus(error.message || 'อ่านเอกสารไม่สำเร็จ', true); }
    finally { receiptBusy = false; $('receipt-file').disabled = false; }
  }
  let pendingCashSlip = null;
  let cashSlipBusy = false;
  const cashSlipStatus = (message, error = false) => { $('cash-slip-status').textContent = message; $('cash-slip-status').classList.toggle('error', error); };
  function cashSlipAccounts(bank) {
    const live = state.accounts.filter(a => !a.archived_at && a.currency === 'THB');
    if (bank === 'dime') return live.filter(a => /dime/i.test(a.name));
    if (bank === 'kbank') return live.filter(a => /kbank|กสิกร|make/i.test(a.name));
    return [];
  }
  function updateCashSlipKind() {
    const kind = $('cash-slip-kind').value;
    $('cash-slip-account-label').firstChild.textContent = kind === 'income' ? 'บัญชีที่รับเงิน' : 'บัญชีที่จ่าย';
    visible('cash-slip-to-wrap', kind === 'transfer'); visible('cash-slip-category-wrap', kind !== 'transfer'); visible('cash-slip-income-wrap', kind === 'income');
    fillSelect($('cash-slip-category'), state.categories.filter(c => c.flow === kind), 'ไม่ระบุหมวด', c => c.name);
  }
  function fillCashSlipReview(parsed) {
    $('cash-slip-kind').value = parsed.kind;
    $('cash-slip-date').value = parsed.date;
    $('cash-slip-amount').value = parsed.amount;
    $('cash-slip-description').value = parsed.description;
    $('cash-slip-ocr-text').textContent = parsed.text;
    const live = state.accounts.filter(a => !a.archived_at && a.currency === 'THB');
    fillSelect($('cash-slip-account'), live, 'เลือกบัญชี THB', a => a.name);
    fillSelect($('cash-slip-to-account'), live, 'เลือกบัญชี THB', a => a.name);
    $('cash-slip-account').value = '';
    $('cash-slip-to-account').value = '';
    const matches = cashSlipAccounts(parsed.bank);
    if (matches.length === 1) $('cash-slip-account').value = matches[0].id;
    updateCashSlipKind();
    $('cash-slip-review').hidden = false;
  }
  function cashSlipFormData() {
    return { kind: $('cash-slip-kind').value, occurred_on: $('cash-slip-date').value,
      amount: $('cash-slip-amount').value, accountId: $('cash-slip-account').value,
      toAccountId: $('cash-slip-to-account').value, categoryId: $('cash-slip-category').value,
      description: $('cash-slip-description').value.trim(), incomeSource: $('cash-slip-income-source').value };
  }
  async function saveCashSlip(data, fingerprint, auto = false) {
    if (!state.user) throw new Error('กรุณาเข้าสู่ระบบก่อน');
    if (!['expense', 'income', 'transfer'].includes(data.kind)) throw new Error('กรุณาตรวจประเภท');
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(data.occurred_on)) throw new Error('กรุณาตรวจวันที่');
    const amount = positive(data.amount);
    const source = account(data.accountId);
    if (!source || source.archived_at || source.currency !== 'THB') throw new Error('กรุณาเลือกบัญชีเงินบาท');
    const destination = data.kind === 'transfer' ? account(data.toAccountId) : null;
    if (data.kind === 'transfer' && (!destination || destination.archived_at || destination.currency !== 'THB' || destination.id === source.id)) throw new Error('กรุณาเลือกบัญชีปลายทางเงินบาทที่ต่างกัน');
    if (!data.description || data.description.length > 500) throw new Error('กรุณาตรวจรายละเอียด');
    if (data.kind === 'income' && !['salary', 'freelance', 'dividend', 'other'].includes(data.incomeSource)) throw new Error('กรุณาเลือกที่มารายได้');
    if (auto && data.kind !== 'expense') throw new Error('ต้องตรวจรายการก่อนบันทึก');
    if (state.transactions.some(t => t.source_fingerprint === fingerprint)) throw new Error('สลิปนี้เคยบันทึกแล้ว');
    if (state.transactions.some(t => !t.deleted_at && t.kind === data.kind && t.occurred_on === data.occurred_on && units(t.amount) === units(amount) && (t.from_account_id || t.to_account_id) === source.id && t.description === data.description)) throw new Error('พบรายการวัน ยอด บัญชี และรายละเอียดตรงกันแล้ว กรุณาตรวจประวัติ');
    const row = { owner_id: state.user.id, kind: data.kind, occurred_on: data.occurred_on, amount,
      description: data.description, category_id: data.kind === 'transfer' ? null : data.categoryId || null,
      from_account_id: data.kind === 'income' ? null : source.id,
      to_account_id: data.kind === 'income' ? source.id : data.kind === 'transfer' ? destination.id : null,
      received_amount: data.kind === 'transfer' ? amount : null,
      gross_amount: data.kind === 'income' ? amount : null, withheld_tax_amount: '0',
      income_source: data.kind === 'income' ? data.incomeSource : null, source_fingerprint: fingerprint };
    const result = await db.from('cash_transactions').insert(row);
    if (result.error) throw result.error;
    $('cash-slip-file').value = ''; $('cash-slip-review').hidden = true; pendingCashSlip = null;
    await loadData();
    cashSlipStatus(`บันทึก${kindNames[data.kind]} ${money(amount)} วันที่ ${data.occurred_on} แล้ว`);
    say('บันทึกรายการจากสลิปแล้ว');
  }
  async function enhanceCashSlip(image, region = [0, 0, 1, 1], threshold = 182) {
    const bitmap = await createImageBitmap(image);
    try {
      const [rx, ry, rw, rh] = region;
      const sourceWidth = Math.round(bitmap.width * rw), sourceHeight = Math.round(bitmap.height * rh);
      const scale = region[2] === 1 ? Math.min(1.5, 3200 / Math.max(bitmap.width, bitmap.height)) : Math.min(3, 3200 / Math.max(sourceWidth, sourceHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(sourceWidth * scale); canvas.height = Math.round(sourceHeight * scale);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(bitmap, Math.round(bitmap.width * rx), Math.round(bitmap.height * ry), sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const luminance = pixels.data[i] * .2126 + pixels.data[i + 1] * .7152 + pixels.data[i + 2] * .0722;
        const value = luminance < threshold ? 0 : 255;
        pixels.data[i] = value; pixels.data[i + 1] = value; pixels.data[i + 2] = value;
      }
      context.putImageData(pixels, 0, 0);
      return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('ปรับภาพสลิปไม่สำเร็จ')), 'image/png'));
    } finally { bitmap.close(); }
  }
  async function importCashSlip(file) {
    if (!file || cashSlipBusy) return;
    cashSlipBusy = true; $('cash-slip-file').disabled = true; $('cash-slip-review').hidden = true; pendingCashSlip = null;
    try {
      if (file.size > 15 * 1024 * 1024) throw new Error('ไฟล์ต้องไม่เกิน 15 MB');
      cashSlipStatus('กำลังเตรียมสลิป…');
      const fingerprint = await fileFingerprint(file);
      if (state.transactions.some(t => t.source_fingerprint === fingerprint)) throw new Error('สลิปนี้เคยบันทึกแล้ว');
      const image = await receiptImage(file);
      cashSlipStatus('กำลังอ่านตัวอักษรบนเครื่องของคุณ…');
      const tesseract = await loadExternalScript('https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js', 'Tesseract');
      const worker = await tesseract.createWorker(['tha', 'eng'], 1, { logger: m => { if (m.status === 'recognizing text') cashSlipStatus(`กำลังอ่านสลิป ${Math.round((m.progress || 0) * 100)}%…`); } });
      let ocr;
      try {
        ocr = (await worker.recognize(image)).data;
        if (!window.CashSlip.parse(ocr.text).date || !window.CashSlip.parse(ocr.text).amount) {
          cashSlipStatus('กำลังปรับความคมชัดและอ่านซ้ำ…');
          const enhanced = await enhanceCashSlip(image);
          const retry = (await worker.recognize(enhanced)).data;
          ocr = { text: `${ocr.text}\n${retry.text}`, confidence: Math.max(ocr.confidence, retry.confidence) };
        }
        let partial = window.CashSlip.parse(ocr.text);
        if (!partial.date || !partial.amount || partial.warnings.some(w => w.startsWith('เดือน'))) {
          const dimensions = await createImageBitmap(image);
          const tall = dimensions.height > dimensions.width * 1.3;
          dimensions.close();
          const dateRegion = tall ? [0.03, 0.78, 0.67, 0.13] : [0.02, 0.02, 0.67, 0.17];
          const moneyRegion = tall ? [0.03, 0.39, 0.67, 0.18] : partial.payment ? [0.03, 0.74, 0.68, 0.13] : [0.02, 0.59, 0.67, 0.20];
          if (!partial.date || partial.warnings.some(w => w.startsWith('เดือน'))) {
            cashSlipStatus('กำลังอ่านเฉพาะส่วนวันที่…');
            const crop = await enhanceCashSlip(image, dateRegion, partial.payment ? 135 : 175);
            ocr.text += `\n${(await worker.recognize(crop)).data.text}`;
          }
          partial = window.CashSlip.parse(ocr.text);
          if (!partial.amount) {
            cashSlipStatus('กำลังอ่านเฉพาะส่วนจำนวนเงิน…');
            const crop = await enhanceCashSlip(image, moneyRegion, partial.bank === 'dime' ? 190 : 135);
            ocr.text += `\n${(await worker.recognize(crop)).data.text}`;
          }
        }
      } finally { await worker.terminate(); }
      const parsed = window.CashSlip.parse(ocr.text);
      pendingCashSlip = { fingerprint, parsed };
      fillCashSlipReview(parsed);
      const matches = cashSlipAccounts(parsed.bank);
      if (parsed.ready && ocr.confidence >= 60 && matches.length === 1) {
        cashSlipStatus('ข้อมูลครบ กำลังบันทึก…');
        try { await saveCashSlip(cashSlipFormData(), fingerprint, true); return; }
        catch (error) { cashSlipStatus(`${error.message} ตรวจข้อมูลด้านล่างก่อนบันทึก`, true); }
      } else cashSlipStatus(`ต้องตรวจข้อมูลก่อนบันทึก: ${[...parsed.warnings, ...(matches.length === 1 ? [] : ['เลือกบัญชีที่ตรงกับสลิป']), ...(ocr.confidence >= 60 ? [] : ['ตัวอักษรอ่านไม่ชัด'])].join(' · ') || 'กรุณาตรวจสลิป'}`, true);
    } catch (error) { cashSlipStatus(error.message || 'อ่านสลิปไม่สำเร็จ', true); }
    finally { cashSlipBusy = false; $('cash-slip-file').disabled = false; }
  }
  const thb = n => moneyUnits(n, 'THB');
  const minBig = (a, b) => a < b ? a : b;
  const maxBig = (a, b) => a > b ? a : b;
  function progressiveTax(netIncome) {
    const tiers = [
      [150000n, 0n], [300000n, 5n], [500000n, 10n], [750000n, 15n],
      [1000000n, 20n], [2000000n, 25n], [5000000n, 30n]
    ];
    let lower = 0n, tax = 0n;
    for (const [limitBaht, rate] of tiers) {
      const upper = limitBaht * 10000n;
      tax += roundDiv(maxBig(0n, minBig(netIncome, upper) - lower) * rate, 100n);
      lower = upper;
    }
    tax += roundDiv(maxBig(0n, netIncome - lower) * 35n, 100n);
    return tax;
  }
  function taxFormData() {
    const nonnegative = id => { const n = units($(id).value || '0'); if (n < 0n) throw new Error('จำนวนเงินภาษีต้องไม่ติดลบ'); return n; };
    return {
      freelance_mode: $('tax-freelance-mode').value,
      freelance_expense: nonnegative('tax-freelance-expense'),
      dividend_mode: $('tax-dividend-mode').value,
      other_deductions: nonnegative('tax-other-deductions'),
      forecast_salary: nonnegative('tax-forecast-salary'),
      forecast_freelance: nonnegative('tax-forecast-freelance')
    };
  }
  function taxLine(container, label, value) {
    const row = elem('div', null, 'tax-line'); row.append(elem('span', label), elem('strong', value)); container.append(row);
  }
  function taxMetric(container, label, value, detail) {
    const card = elem('div', null, 'metric-card');
    card.append(elem('span', label), elem('strong', value), elem('small', detail)); container.append(card);
  }
  function renderTax() {
    const year = Number($('tax-year').value);
    const saved = state.taxProfiles.find(p => p.tax_year === year);
    $('tax-freelance-mode').value = saved?.freelance_mode || 'unclassified';
    $('tax-freelance-expense').value = saved?.freelance_expense || '0';
    $('tax-dividend-mode').value = saved?.dividend_mode || 'unclassified';
    $('tax-other-deductions').value = saved?.other_deductions || '0';
    $('tax-forecast-salary').value = saved?.forecast_salary || '0';
    $('tax-forecast-freelance').value = saved?.forecast_freelance || '0';
    renderTaxCalculation();
  }
  function renderTaxCalculation() {
    const metrics = $('tax-metrics'), breakdown = $('tax-income-breakdown'), warnings = $('tax-warnings'), calc = $('tax-calculation');
    metrics.replaceChildren(); breakdown.replaceChildren(); warnings.replaceChildren(); calc.replaceChildren();
    try {
      const form = taxFormData(), year = Number($('tax-year').value);
      const amounts = { salary: 0n, freelance: 0n, dividend: 0n, other: 0n };
      const withheld = { salary: 0n, freelance: 0n, dividend: 0n, other: 0n };
      const issues = [], dividends = [];
      for (const t of activeTransactions()) {
        if (t.kind !== 'income' || !t.occurred_on.startsWith(`${year}-`)) continue;
        if (dashboardCurrency(t) !== 'THB') { issues.push('มีรายรับสกุลอื่นหรือไม่ทราบสกุลเงิน ต้องตรวจอัตราแลกเปลี่ยนก่อนคำนวณ'); continue; }
        const source = Object.hasOwn(amounts, t.income_source) ? t.income_source : 'other';
        amounts[source] += units(t.gross_amount || t.amount);
        withheld[source] += units(t.withheld_tax_amount || '0');
        if (source === 'dividend') dividends.push(t);
      }
      const salary = amounts.salary + form.forecast_salary;
      const freelance = amounts.freelance + form.forecast_freelance;
      const totalRecorded = Object.values(amounts).reduce((sum, n) => sum + n, 0n);
      if (freelance > 0n && form.freelance_mode === 'unclassified') issues.push('ยังไม่ระบุประเภทงานเสริม จึงหักค่าใช้จ่ายให้ถูกต้องไม่ได้');
      if (form.freelance_mode === 'manual' && form.freelance_expense > freelance) issues.push('ค่าใช้จ่ายงานเสริมที่กรอกมากกว่ารายได้งานเสริม');
      if (amounts.dividend > 0n && form.dividend_mode !== 'thai_final_10') issues.push('ปันผลยังไม่ยืนยันว่าเป็นปันผลไทยที่เลือกเสียภาษี 10% เป็นที่สุด');
      if (amounts.dividend > 0n && form.dividend_mode === 'thai_final_10' && dividends.some(t => units(t.withheld_tax_amount || '0') !== roundDiv(units(t.gross_amount || t.amount), 10n))) issues.push('ปันผลบางรายการไม่ได้บันทึกภาษีหัก ณ ที่จ่าย 10% ของยอดก่อนหัก');
      if (amounts.other > 0n) issues.push('มีรายรับประเภทอื่นที่ยังไม่จัดประเภทภาษี');
      for (const issue of [...new Set(issues)]) warnings.append(elem('p', issue, 'tax-warning'));
      if (!issues.length) warnings.append(elem('p', 'ข้อมูลที่บันทึกอยู่รองรับสูตรพื้นฐานนี้ ตรวจค่าลดหย่อนและเอกสารอีกครั้งก่อนใช้ยื่นภาษี', 'tax-ok'));
      if (form.other_deductions === 0n) warnings.append(elem('p', 'ยังไม่ได้กรอกค่าลดหย่อนอื่น เช่น ประกันสังคมหรือเบี้ยประกันที่ใช้สิทธิ์ได้', 'tax-warning'));
      if (!totalRecorded && !form.forecast_salary && !form.forecast_freelance) warnings.append(elem('p', 'ยังไม่มีรายรับของปีนี้', 'tax-warning'));
      taxLine(breakdown, 'เงินเดือนที่บันทึก', thb(amounts.salary));
      taxLine(breakdown, 'งานเสริมที่บันทึก', thb(amounts.freelance));
      taxLine(breakdown, 'ปันผลที่บันทึก', thb(amounts.dividend));
      if (amounts.other) taxLine(breakdown, 'รายรับอื่นที่ยังไม่จัดประเภท', thb(amounts.other));
      taxLine(breakdown, 'เงินเดือน / งานเสริมคาดว่าจะได้รับเพิ่ม', `${thb(form.forecast_salary)} / ${thb(form.forecast_freelance)}`);
      const actualWithheld = withheld.salary + withheld.freelance;
      taxMetric(metrics, 'รายรับจริงที่บันทึก (THB)', thb(totalRecorded), 'ก่อนหักภาษี ณ ที่จ่าย');
      taxMetric(metrics, 'ภาษีหัก ณ ที่จ่ายที่นำมาเทียบ', thb(actualWithheld), 'เฉพาะเงินเดือนและงานเสริม');
      if (issues.length) {
        taxMetric(metrics, 'ภาษีประมาณการทั้งปี', '—', 'รอจัดประเภทเงินได้ให้ครบ');
        taxMetric(metrics, 'ส่วนต่างจากภาษีที่หักแล้ว', '—', 'ยังสรุปไม่ได้');
        taxLine(calc, 'สถานะ', 'ยังคำนวณทั้งปีไม่ได้ — ดูข้อมูลที่ต้องตรวจด้านบน');
        return;
      }
      const employmentExpense = minBig((salary + (form.freelance_mode === '40_2' ? freelance : 0n)) / 2n, 100000n * 10000n);
      const freelanceExpense = form.freelance_mode === 'manual' ? form.freelance_expense : 0n;
      const totalExpense = employmentExpense + freelanceExpense;
      const personalAllowance = 60000n * 10000n;
      const net = maxBig(0n, salary + freelance - totalExpense - personalAllowance - form.other_deductions);
      const progressive = progressiveTax(net);
      const alternative = freelance >= 120000n * 10000n ? roundDiv(freelance * 5n, 1000n) : 0n;
      const selectedAlternative = alternative > 5000n * 10000n && alternative > progressive;
      const estimated = selectedAlternative ? alternative : progressive;
      taxMetric(metrics, 'ภาษีประมาณการทั้งปี', thb(estimated), 'ตามรายรับจริงและรายรับคาดการณ์ที่กรอก');
      taxMetric(metrics, 'ส่วนต่างจากภาษีที่หักแล้ว', thb(estimated - actualWithheld), 'ค่าลบหมายถึงอาจมีภาษีหักเกิน');
      taxLine(calc, 'รายได้ที่นำมาคำนวณ', thb(salary + freelance));
      taxLine(calc, 'ค่าใช้จ่ายเงินเดือน/ม.40(2)', thb(employmentExpense));
      if (freelanceExpense) taxLine(calc, 'ค่าใช้จ่ายงานเสริมที่กรอก', thb(freelanceExpense));
      taxLine(calc, 'ค่าลดหย่อนส่วนตัว', thb(personalAllowance));
      taxLine(calc, 'ค่าลดหย่อนอื่นที่กรอก', thb(form.other_deductions));
      taxLine(calc, 'เงินได้สุทธิ', thb(net));
      taxLine(calc, 'ภาษีขั้นบันได', thb(progressive));
      if (alternative) taxLine(calc, 'วิธี 0.5% จากงานเสริม (ใช้เมื่อเกิน 5,000 บาทและสูงกว่า)', thb(alternative));
      taxLine(calc, 'ภาษีประมาณการที่ใช้', thb(estimated));
    } catch (error) {
      warnings.append(elem('p', `ตรวจข้อมูลที่กรอก: ${error.message}`, 'tax-warning'));
      taxMetric(metrics, 'ภาษีประมาณการทั้งปี', '—', 'ตรวจตัวเลขในฟอร์ม');
    }
  }
  function fillSelect(select, items, blank, label) {
    const before = select.value;
    select.replaceChildren();
    if (blank != null) select.append(new Option(blank, ''));
    for (const item of items) select.append(new Option(label(item), item.id));
    if ([...select.options].some(o => o.value === before)) select.value = before;
  }
  function renderAccounts() {
    const live = state.accounts.filter(a => !a.archived_at);
    for (const id of ['transaction-account', 'transaction-to-account']) fillSelect($(id), live, 'เลือกบัญชี', a => `${a.name} · ${a.currency}`);
    const box = $('balance-cards'); box.replaceChildren();
    const list = $('accounts'); list.replaceChildren();
    if (!live.length) { box.append(elem('div', 'เริ่มจากเพิ่มบัญชีเงินในหน้า “บัญชีและหมวด”', 'empty')); list.append(elem('p', 'ยังไม่มีบัญชี', 'muted')); }
    for (const a of live) {
      const balance = state.balances.find(b => b.account_id === a.id)?.balance ?? a.opening_balance;
      const card = elem('div', null, 'balance-card'); card.append(elem('small', a.name), elem('strong', money(balance, a.currency)), elem('span', a.kind === 'bank' ? 'ธนาคาร' : a.kind === 'cash' ? 'เงินสด' : 'บัญชีลงทุน', 'kind')); box.append(card);
      const row = elem('div', null, 'item'); const left = elem('div'); left.append(elem('strong', a.name), elem('small', `${a.kind} · ยอดตั้งต้น ${money(a.opening_balance, a.currency)}`)); row.append(left, elem('strong', money(balance, a.currency))); list.append(row);
    }
  }
  function renderCategories() {
    const flow = $('transaction-kind').value;
    fillSelect($('transaction-category'), state.categories.filter(c => c.flow === flow), 'ไม่ระบุหมวด', c => c.name);
    const box = $('categories'); box.replaceChildren();
    if (!state.categories.length) box.append(elem('p', 'ยังไม่มีหมวด', 'muted'));
    for (const c of state.categories) box.append(elem('span', `${c.name} · ${c.flow === 'income' ? 'รายรับ' : 'รายจ่าย'}`, 'chip'));
  }
  function renderTransactions() {
    const query = $('search').value.trim().toLocaleLowerCase(); const filter = $('kind-filter').value;
    const rows = state.transactions.filter(t => Boolean(t.deleted_at) === state.trash && (filter === 'all' || filter === t.kind) && (!query || `${t.description} ${category(t.category_id)?.name || ''} ${kindNames[t.kind]}`.toLocaleLowerCase().includes(query)));
    $('transaction-count').textContent = `${rows.length} รายการ${state.trash ? 'ที่ลบแล้ว' : ''}`;
    $('toggle-trash').textContent = state.trash ? 'กลับไปรายการปกติ' : 'ดูรายการที่ลบ';
    const body = $('transaction-list'); body.replaceChildren();
    if (!rows.length) { const tr = elem('tr'); const td = elem('td', 'ยังไม่มีรายการ', 'empty'); td.colSpan = 5; tr.append(td); body.append(tr); }
    for (const t of rows) {
      const tr = elem('tr');
      tr.append(elem('td', t.occurred_on));
      const detail = elem('td'); detail.append(elem('strong', t.description || category(t.category_id)?.name || kindNames[t.kind]), elem('div', `${kindNames[t.kind]}${t.income_source ? ' · ' + sourceNames[t.income_source] : ''}${category(t.category_id) ? ' · ' + category(t.category_id).name : ''}`, 'sub')); tr.append(detail);
      const from = account(t.from_account_id)?.name; const to = account(t.to_account_id)?.name;
      tr.append(elem('td', t.kind === 'transfer' ? `${from} → ${to}` : (from || to || '—')));
      const currency = account(t.from_account_id || t.to_account_id)?.currency || 'THB';
      const amount = elem('td', `${t.kind === 'income' ? '+' : t.kind === 'expense' ? '−' : ''}${money(t.amount, currency)}`, `right ${t.kind === 'income' ? 'positive' : t.kind === 'expense' ? 'negative' : ''}`);
      tr.append(amount);
      const controls = elem('td'); const buttons = elem('div', null, 'row-actions');
      if (state.trash) { const restore = elem('button', 'กู้คืน', 'outline small'); restore.dataset.restore = t.id; buttons.append(restore); }
      else { const edit = elem('button', 'แก้ไข', 'outline small'); edit.dataset.edit = t.id; const remove = elem('button', 'ลบ', 'outline small danger'); remove.dataset.delete = t.id; buttons.append(edit, remove); }
      controls.append(buttons); tr.append(controls); body.append(tr);
    }
    fillSelect($('note-transaction'), activeTransactions(), 'ไม่ผูกกับรายการ', t => `${t.occurred_on} · ${t.description || kindNames[t.kind]}`);
  }
  function renderTemplates() {
    const box = $('templates'); box.replaceChildren();
    if (!state.templates.length) { box.append(elem('span', 'ยังไม่มีรายการโปรด', 'muted')); return; }
    for (const t of state.templates) { const button = elem('button', `☆ ${t.name}`, 'template'); button.dataset.template = t.id; box.append(button); }
  }
  function renderNotes() {
    const box = $('notes'); box.replaceChildren();
    if (!state.notes.length) { box.append(elem('p', 'ยังไม่มีบันทึก', 'muted')); return; }
    for (const note of state.notes) {
      const card = elem('div', null, 'item'); const content = elem('div'); content.append(elem('strong', note.title));
      if (note.transaction_id) { const t = state.transactions.find(x => x.id === note.transaction_id); if (t) content.append(elem('small', `ผูกกับ ${t.occurred_on} · ${t.description || kindNames[t.kind]}`)); }
      content.append(elem('div', note.body, 'note-body'));
      const edit = elem('button', 'แก้ไข', 'outline small'); edit.dataset.editNote = note.id; card.append(content, edit); box.append(card);
    }
  }

  function updateKind() {
    const kind = $('transaction-kind').value;
    visible('to-account-wrap', kind === 'transfer'); visible('received-wrap', kind === 'transfer'); visible('category-wrap', kind !== 'transfer'); visible('income-fields', kind === 'income'); visible('save-template', kind !== 'transfer');
    $('account-label').firstChild.textContent = kind === 'income' ? 'บัญชีที่รับเงิน' : kind === 'transfer' ? 'บัญชีต้นทาง' : 'บัญชีที่จ่าย';
    $('amount-label').firstChild.textContent = kind === 'income' ? 'ยอดรับสุทธิ' : kind === 'transfer' ? 'ยอดออกจากบัญชีต้นทาง' : 'จำนวนเงิน';
    $('transaction-amount').readOnly = kind === 'income'; $('gross-amount').required = kind === 'income'; $('received-amount').required = kind === 'transfer';
    if (kind === 'income') updateNet();
    renderCategories();
  }
  function updateNet() {
    try {
      const gross = units($('gross-amount').value || '0'); const tax = units($('withheld-tax').value || '0');
      $('transaction-amount').value = gross > tax ? decimal(gross - tax) : '';
    } catch { $('transaction-amount').value = ''; }
  }
  function resetTransaction() {
    state.editTransaction = null; $('transaction-form').reset(); $('transaction-kind').value = 'expense'; $('transaction-date').value = today(); $('withheld-tax').value = '0'; $('transaction-form-title').textContent = 'บันทึกรายการใหม่'; visible('cancel-edit', false); updateKind();
  }
  function formTransaction() {
    const kind = $('transaction-kind').value; const mainId = $('transaction-account').value;
    if (!mainId || !account(mainId)) throw new Error('กรุณาเลือกบัญชี');
    const amount = positive($('transaction-amount').value);
    const data = { kind, occurred_on: $('transaction-date').value, amount, description: $('transaction-description').value.trim(), category_id: kind === 'transfer' ? null : $('transaction-category').value || null, from_account_id: kind === 'income' ? null : mainId, to_account_id: kind === 'income' ? mainId : kind === 'transfer' ? $('transaction-to-account').value : null, received_amount: kind === 'transfer' ? positive($('received-amount').value) : null, gross_amount: null, withheld_tax_amount: '0', income_source: null };
    if (kind === 'transfer') { if (!data.to_account_id || data.to_account_id === mainId) throw new Error('กรุณาเลือกบัญชีปลายทางที่ต่างจากต้นทาง'); }
    if (kind === 'income') {
      const gross = positive($('gross-amount').value); const tax = units($('withheld-tax').value || '0');
      if (tax < 0n || tax >= units(gross)) throw new Error('ภาษีหัก ณ ที่จ่ายต้องน้อยกว่ารายได้ก่อนหัก');
      if (units(amount) !== units(gross) - tax) throw new Error('ยอดรับสุทธิไม่ตรงกับรายได้ก่อนหักลบภาษี');
      data.gross_amount = gross; data.withheld_tax_amount = decimal(tax); data.income_source = $('income-source').value;
    }
    return data;
  }
  function editTransaction(id) {
    const t = state.transactions.find(x => x.id === id); if (!t) return;
    state.editTransaction = id; switchView('transactions');
    $('transaction-kind').value = t.kind; updateKind(); $('transaction-date').value = t.occurred_on; $('transaction-account').value = t.kind === 'income' ? t.to_account_id : t.from_account_id;
    $('transaction-to-account').value = t.kind === 'transfer' ? t.to_account_id : '';
    $('transaction-category').value = t.category_id || '';
    $('transaction-amount').value = t.amount;
    $('received-amount').value = t.received_amount || '';
    $('income-source').value = t.income_source || 'salary'; $('gross-amount').value = t.gross_amount || ''; $('withheld-tax').value = t.withheld_tax_amount || '0';
    $('transaction-description').value = t.description;
    $('transaction-form-title').textContent = 'แก้ไขรายการ'; visible('cancel-edit', true);
    $('transaction-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function resetNote() { state.editNote = null; $('note-form').reset(); $('note-form-title').textContent = 'เพิ่มบันทึก'; visible('cancel-note-edit', false); }

  $('login-form').addEventListener('submit', async event => {
    event.preventDefault(); const button = event.target.querySelector('button'); button.disabled = true; $('login-message').textContent = 'กำลังเข้าสู่ระบบ...';
    const { data, error } = await db.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value });
    button.disabled = false; $('password').value = '';
    if (error) $('login-message').textContent = 'เข้าสู่ระบบไม่สำเร็จ ตรวจอีเมลและรหัสผ่าน';
    else { $('login-message').textContent = ''; showAuth(data.user); }
  });
  $('signout').addEventListener('click', async () => { const { error } = await db.auth.signOut(); if (error) say('ออกจากระบบไม่สำเร็จ', true); else showAuth(null); });
  db.auth.onAuthStateChange((_event, session) => {
    if (session?.user?.id !== state.user?.id) setTimeout(() => showAuth(session?.user || null), 0);
  });
  db.auth.getUser().then(({ data, error }) => showAuth(error ? null : data.user)).catch(() => { visible('login', true); $('login-message').textContent = 'เชื่อม Supabase ไม่สำเร็จ'; });

  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => switchView(b.dataset.view)));
  $('dashboard-currency').addEventListener('change', renderDashboard);
  $('dashboard-period').addEventListener('change', renderDashboard);
  $('dashboard-all').addEventListener('click', () => switchView('transactions'));
  $('portfolio-market').addEventListener('change', () => { $('chart-symbol').value = ''; clearStockChart(); renderPortfolio(); });
  $('chart-security').addEventListener('change', () => {
    const selected = security($('chart-security').value);
    $('chart-symbol').value = selected ? `${selected.market === 'SET' ? 'SET' : 'NASDAQ'}:${selected.symbol}` : '';
    $('chart-help').textContent = selected?.market === 'US' ? 'NASDAQ เป็นเพียงรหัสเริ่มต้น หากหุ้นอยู่ NYSE หรือ AMEX ให้แก้รหัสตลาดก่อนดูกราฟ' : 'หุ้นไทยจะเปิดกราฟบนเว็บไซต์ TradingView';
  });
  $('chart-show').addEventListener('click', () => { try { renderStockChart(); say(''); } catch (error) { say(error.message, true); } });
  $('tax-year').addEventListener('change', renderTax);
  $('tax-profile-form').addEventListener('input', renderTaxCalculation);
  $('tax-profile-form').addEventListener('change', renderTaxCalculation);
  $('tax-profile-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!state.user) return;
    const button = event.target.querySelector('button[type="submit"]'); button.disabled = true;
    try {
      const year = Number($('tax-year').value), form = taxFormData();
      const record = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, typeof value === 'bigint' ? decimal(value) : value]));
      record.updated_at = new Date().toISOString();
      const exists = state.taxProfiles.some(p => p.tax_year === year);
      const result = exists
        ? await db.from('tax_profiles').update(record).eq('owner_id', state.user.id).eq('tax_year', year)
        : await db.from('tax_profiles').insert({ owner_id: state.user.id, tax_year: year, ...record });
      if (result.error) throw result.error;
      await loadData(); say('บันทึกข้อมูลภาษีแล้ว');
    } catch (error) { say(`บันทึกข้อมูลภาษีไม่สำเร็จ: ${error.message}`, true); }
    finally { button.disabled = false; }
  });
  $('receipt-file').addEventListener('change', event => { void importReceipt(event.target.files[0]); });
  $('receipt-review').addEventListener('submit', async event => {
    event.preventDefault(); if (!pendingReceipt || receiptBusy) return;
    const button = event.target.querySelector('button[type="submit"]'); button.disabled = true;
    try { await saveImportedTrade(receiptFormData(), pendingReceipt.fingerprint); }
    catch (error) { receiptStatus(`บันทึกไม่สำเร็จ: ${error.message}`, true); }
    finally { button.disabled = false; }
  });
  $('cash-slip-file').addEventListener('change', event => { void importCashSlip(event.target.files[0]); });
  $('cash-slip-kind').addEventListener('change', updateCashSlipKind);
  $('cash-slip-review').addEventListener('submit', async event => {
    event.preventDefault(); if (!pendingCashSlip || cashSlipBusy) return;
    const button = event.target.querySelector('button[type="submit"]'); button.disabled = true;
    try { await saveCashSlip(cashSlipFormData(), pendingCashSlip.fingerprint); }
    catch (error) { cashSlipStatus(`บันทึกไม่สำเร็จ: ${error.message}`, true); }
    finally { button.disabled = false; }
  });
  for (const id of ['trade-security', 'trade-side', 'trade-quantity', 'trade-price', 'trade-fees']) $(id).addEventListener('input', updateTradePreview);
  $('toggle-void-trades').addEventListener('click', () => { state.voidTrades = !state.voidTrades; renderTradeList(); });
  $('security-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!state.user) return; const button = event.target.querySelector('button[type="submit"]'); button.disabled = true;
    try {
      const market = $('portfolio-market').value, symbol = $('security-symbol').value.trim().toUpperCase(), name = $('security-name').value.trim();
      if (!/^[A-Z0-9._^-]{1,20}$/.test(symbol)) throw new Error('สัญลักษณ์ใช้ตัวอักษรอังกฤษ ตัวเลข จุด ขีดกลาง หรือขีดล่าง');
      if (!name) throw new Error('กรุณาใส่ชื่อหุ้น');
      const { error } = await db.from('securities').insert({ owner_id: state.user.id, market, symbol, name, currency: market === 'SET' ? 'THB' : 'USD' });
      if (error) throw error; event.target.reset(); await loadData(); say(`เพิ่ม ${symbol} แล้ว`);
    } catch (error) { say(`เพิ่มหุ้นไม่สำเร็จ: ${error.message}`, true); } finally { button.disabled = false; }
  });
  $('price-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!state.user) return; const button = event.target.querySelector('button[type="submit"]'); button.disabled = true;
    try {
      const id = $('price-security').value, s = security(id); if (!s || s.market !== $('portfolio-market').value) throw new Error('กรุณาเลือกหุ้น');
      const price = units($('latest-price').value); if (price < 0n) throw new Error('ราคาต้องไม่ติดลบ');
      const { error } = await db.from('securities').update({ last_price: decimal(price), price_as_of: $('price-date').value }).eq('id', id);
      if (error) throw error; await loadData(); say(`อัปเดตราคา ${s.symbol} แล้ว`);
    } catch (error) { say(`อัปเดตราคาไม่สำเร็จ: ${error.message}`, true); } finally { button.disabled = false; }
  });
  $('trade-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!state.user) return; const button = event.target.querySelector('button[type="submit"]'); button.disabled = true;
    try {
      const securityId = $('trade-security').value, s = security(securityId); if (!s || s.market !== $('portfolio-market').value) throw new Error('กรุณาเลือกหุ้น');
      const quantity = shareUnits($('trade-quantity').value), unitPrice = units(positive($('trade-price').value));
      if (quantity <= 0n) throw new Error('จำนวนหุ้นต้องมากกว่า 0');
      const fees = units($('trade-fees').value || '0'); if (fees < 0n) throw new Error('ค่าธรรมเนียมต้องไม่ติดลบ');
      const gross = tradeGross(quantity, unitPrice); if (gross <= 0n) throw new Error('มูลค่าซื้อขายต้องมากกว่า 0');
      const side = $('trade-side').value; if (side === 'sell' && fees > gross) throw new Error('ค่าธรรมเนียมขายเกินมูลค่าขาย');
      const data = { owner_id: state.user.id, security_id: securityId, side, traded_on: $('trade-date').value, quantity: shareDecimal(quantity), unit_price: decimal(unitPrice), fees: decimal(fees), note: $('trade-note').value.trim() };
      portfolioModel(securityId, { ...data, id: 'zzzzzzzz', gross_amount: decimal(gross), created_at: new Date().toISOString(), voided_at: null });
      const { error } = await db.from('investment_trades').insert(data); if (error) throw error;
      event.target.reset(); $('trade-date').value = today(); $('trade-fees').value = '0'; await loadData(); say('บันทึกรายการหุ้นแล้ว');
    } catch (error) { say(`บันทึกรายการหุ้นไม่สำเร็จ: ${error.message}`, true); } finally { button.disabled = false; }
  });
  $('trade-list').addEventListener('click', async event => {
    const button = event.target.closest('[data-trade-id]'); if (!button) return;
    const t = state.trades.find(x => x.id === button.dataset.tradeId); if (!t) return; button.disabled = true;
    const { error } = await db.from('investment_trades').update({ voided_at: t.voided_at ? null : new Date().toISOString() }).eq('id', t.id);
    if (error) say(`เปลี่ยนสถานะรายการหุ้นไม่สำเร็จ: ${error.message}`, true);
    else { await loadData(); say(t.voided_at ? 'กู้คืนรายการหุ้นแล้ว' : 'ยกเลิกรายการหุ้นแล้ว กู้คืนได้'); }
    button.disabled = false;
  });
  $('quick-add').addEventListener('click', () => { switchView('transactions'); $('transaction-form').scrollIntoView({ behavior: 'smooth' }); $('transaction-amount').focus(); });
  $('transaction-kind').addEventListener('change', updateKind);
  $('gross-amount').addEventListener('input', updateNet); $('withheld-tax').addEventListener('input', updateNet);
  $('search').addEventListener('input', renderTransactions); $('kind-filter').addEventListener('change', renderTransactions);
  $('toggle-trash').addEventListener('click', () => { state.trash = !state.trash; renderTransactions(); });
  $('cancel-edit').addEventListener('click', resetTransaction); $('cancel-note-edit').addEventListener('click', resetNote);

  $('account-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!state.user) return; const button = event.target.querySelector('button'); button.disabled = true;
    try {
      const name = $('account-name').value.trim(); if (!name) throw new Error('กรุณาใส่ชื่อบัญชี');
      const opening_balance = decimal(units($('opening-balance').value));
      const { error } = await db.from('accounts').insert({ owner_id: state.user.id, name, kind: $('account-kind').value, currency: $('account-currency').value, opening_balance });
      if (error) throw error; event.target.reset(); $('opening-balance').value = '0'; await loadData(); say('เพิ่มบัญชีแล้ว');
    } catch (error) { say(`เพิ่มบัญชีไม่สำเร็จ: ${error.message}`, true); } finally { button.disabled = false; }
  });
  $('category-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!state.user) return; const button = event.target.querySelector('button'); button.disabled = true;
    try {
      const name = $('category-name').value.trim(); if (!name) throw new Error('กรุณาใส่ชื่อหมวด');
      const { error } = await db.from('categories').insert({ owner_id: state.user.id, name, flow: $('category-flow').value });
      if (error) throw error; event.target.reset(); await loadData(); say('เพิ่มหมวดแล้ว');
    } catch (error) { say(`เพิ่มหมวดไม่สำเร็จ: ${error.message}`, true); } finally { button.disabled = false; }
  });
  $('transaction-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!state.user) return; const button = $('save-transaction'); button.disabled = true;
    try {
      const data = formTransaction();
      const result = state.editTransaction ? await db.from('cash_transactions').update(data).eq('id', state.editTransaction) : await db.from('cash_transactions').insert({ ...data, owner_id: state.user.id });
      if (result.error) throw result.error; resetTransaction(); await loadData(); say('บันทึกรายการแล้ว');
    } catch (error) { say(`บันทึกไม่สำเร็จ: ${error.message}`, true); } finally { button.disabled = false; }
  });
  $('transaction-list').addEventListener('click', async event => {
    const button = event.target.closest('button'); if (!button) return;
    if (button.dataset.edit) { editTransaction(button.dataset.edit); return; }
    const id = button.dataset.delete || button.dataset.restore; if (!id) return; button.disabled = true;
    const { error } = await db.from('cash_transactions').update({ deleted_at: button.dataset.delete ? new Date().toISOString() : null }).eq('id', id);
    if (error) say(`เปลี่ยนสถานะรายการไม่สำเร็จ: ${error.message}`, true); else { await loadData(); say(button.dataset.delete ? 'ย้ายรายการไปที่รายการที่ลบแล้ว กู้คืนได้' : 'กู้คืนรายการแล้ว'); }
    button.disabled = false;
  });
  $('save-template').addEventListener('click', async () => {
    if (!state.user) return;
    try {
      const data = formTransaction(); if (data.kind === 'transfer') throw new Error('รายการโปรดรองรับรายรับและรายจ่าย');
      const name = data.description || category(data.category_id)?.name || kindNames[data.kind];
      const { error } = await db.from('quick_templates').insert({ owner_id: state.user.id, name, kind: data.kind, account_id: $('transaction-account').value, category_id: data.category_id, amount: data.amount, description: data.description, income_source: data.income_source, gross_amount: data.gross_amount, withheld_tax_amount: data.withheld_tax_amount });
      if (error) throw error; await loadData(); say('บันทึกรายการโปรดแล้ว');
    } catch (error) { say(`บันทึกรายการโปรดไม่สำเร็จ: ${error.message}`, true); }
  });
  $('templates').addEventListener('click', event => {
    const button = event.target.closest('[data-template]'); if (!button) return;
    const t = state.templates.find(x => x.id === button.dataset.template); if (!t) return;
    resetTransaction(); $('transaction-kind').value = t.kind; updateKind(); $('transaction-account').value = t.account_id; $('transaction-category').value = t.category_id || ''; $('transaction-description').value = t.description;
    $('income-source').value = t.income_source || 'salary'; $('gross-amount').value = t.gross_amount || ''; $('withheld-tax').value = t.withheld_tax_amount || '0'; $('transaction-amount').value = t.amount;
    $('transaction-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('note-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!state.user) return; const button = event.target.querySelector('button[type="submit"]'); button.disabled = true;
    try {
      const data = { title: $('note-title').value.trim(), body: $('note-body').value, transaction_id: $('note-transaction').value || null, updated_at: new Date().toISOString() };
      if (!data.title) throw new Error('กรุณาใส่หัวข้อ');
      const result = state.editNote ? await db.from('notes').update(data).eq('id', state.editNote) : await db.from('notes').insert({ ...data, owner_id: state.user.id });
      if (result.error) throw result.error; resetNote(); await loadData(); say('บันทึกโน้ตแล้ว');
    } catch (error) { say(`บันทึกโน้ตไม่สำเร็จ: ${error.message}`, true); } finally { button.disabled = false; }
  });
  $('notes').addEventListener('click', event => {
    const button = event.target.closest('[data-edit-note]'); if (!button) return; const note = state.notes.find(n => n.id === button.dataset.editNote); if (!note) return;
    state.editNote = note.id; $('note-title').value = note.title; $('note-body').value = note.body; $('note-transaction').value = note.transaction_id || ''; $('note-form-title').textContent = 'แก้ไขบันทึก'; visible('cancel-note-edit', true); $('note-form').scrollIntoView({ behavior: 'smooth' });
  });
  resetTransaction();
  $('trade-date').value = today(); $('price-date').value = today();
})();
