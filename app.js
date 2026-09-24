(() => {
  const $ = id => document.getElementById(id);
  const config = window.APP_CONFIG || {};
  const state = { user: null, accounts: [], balances: [], categories: [], transactions: [], notes: [], templates: [], editTransaction: null, editNote: null, trash: false };
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
      const [accounts, balances, categories, transactions, notes, templates] = await Promise.all([
        allRows('accounts', 'id,name,kind,currency,opening_balance,created_at,archived_at', q => q.order('created_at', { ascending: true })),
        allRows('account_balances', 'account_id,owner_id,currency,balance'),
        allRows('categories', 'id,name,flow', q => q.order('name')),
        allRows('cash_transactions', 'id,kind,occurred_on,from_account_id,to_account_id,category_id,amount,received_amount,description,gross_amount,withheld_tax_amount,income_source,deleted_at,created_at', q => q.order('occurred_on', { ascending: false }).order('created_at', { ascending: false })),
        allRows('notes', 'id,title,body,transaction_id,created_at', q => q.order('created_at', { ascending: false })),
        allRows('quick_templates', 'id,name,kind,account_id,category_id,amount,description,income_source,gross_amount,withheld_tax_amount,created_at', q => q.order('created_at', { ascending: false }))
      ]);
      Object.assign(state, { accounts, balances, categories, transactions, notes, templates });
      renderAll();
    } catch (error) { say(`โหลดข้อมูลไม่สำเร็จ: ${error.message}`, true); }
  }
  function showAuth(user) {
    state.user = user;
    visible('setup', false); visible('login', !user); visible('workspace', !!user); visible('signout', !!user);
    $('status').textContent = user ? 'ข้อมูลส่วนตัว' : 'เข้าสู่ระบบเพื่อดูข้อมูล';
    $('user-email').textContent = user?.email || '';
    if (user) void loadData();
    else { Object.assign(state, { accounts: [], balances: [], categories: [], transactions: [], notes: [], templates: [] }); say(''); }
  }
  function switchView(view) {
    for (const name of ['dashboard', 'transactions', 'accounts', 'notes']) {
      $(`${name}-view`).classList.toggle('active', name === view);
      document.querySelector(`[data-view="${name}"]`).classList.toggle('active', name === view);
    }
    $('view-title').textContent = { dashboard: 'ภาพรวมการเงิน', transactions: 'รายการเงิน', accounts: 'บัญชีและหมวด', notes: 'บันทึก' }[view];
    say('');
  }

  function renderAll() { renderDashboard(); renderAccounts(); renderCategories(); renderTransactions(); renderTemplates(); renderNotes(); }
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
})();
