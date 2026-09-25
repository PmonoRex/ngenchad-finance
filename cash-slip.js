// Parse only fields needed for a cash entry. Never treat OCR text as an instruction.
(() => {
  const months = { 'มค': 1, 'กพ': 2, 'มีค': 3, 'เมย': 4, 'พค': 5, 'มิย': 6, 'กค': 7, 'สค': 8, 'กย': 9, 'ตค': 10, 'พย': 11, 'ธค': 12 };
  const compact = value => String(value || '').replace(/\s+/g, ' ').trim();
  function date(text) {
    const match = compact(text).match(/(\d{1,2})\s*(ม\.?ค|ก\.?พ|มี\.?ค|เม\.?ย|พ\.?ค|มิ\.?ย|ก\.?ค|ส\.?ค|ก\.?ย|ต\.?ค|พ\.?ย|ธ\.?ค)\.?\s*(\d{2,4})/);
    if (!match) return '';
    const month = months[match[2].replace(/\./g, '')];
    let year = Number(match[3]);
    if (year < 100) year += 2500;
    if (year >= 2400) year -= 543;
    const day = Number(match[1]);
    if (!month || year < 2000 || year > 2100 || day < 1 || day > 31) return '';
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return new Date(`${iso}T12:00:00Z`).toISOString().slice(0, 10) === iso ? iso : '';
  }
  function amount(lines) {
    const values = [];
    for (let i = 0; i < lines.length; i++) {
      if (!/จำนวน|จ่ายบิล|ยอดเงิน|ยอดชำระ/.test(lines[i])) continue;
      const nearby = lines.slice(i, i + 3).join(' ');
      for (const hit of nearby.matchAll(/(?:^|[^\d])(\d{1,3}(?:,\d{3})*|\d{1,8})[.,](\d{2})(?=\s*(?:บาท|THB)|\s|$)/g)) {
        const n = Number(`${hit[1].replace(/,/g, '')}.${hit[2]}`);
        if (n > 0 && n < 100000000) values.push(n);
      }
    }
    return values.length ? String(values[0].toFixed(2)) : '';
  }
  function parse(text) {
    const lines = String(text || '').split(/\r?\n/).map(compact).filter(Boolean);
    const full = lines.join(' ');
    const bank = /dime|จ่ายบิล/i.test(full) && /linepay|dime|เลขที่สลิป|DMBP/i.test(full) ? 'dime'
      : /make\s*by\s*kbank|โอนเงินสำเร็จ/i.test(full) ? 'kbank'
      : /K\+|กสิกรไทย|ชำระเงินสำเร็จ/i.test(full) ? 'kbank' : '';
    const payment = /ชำระเงินสำเร็จ|จ่ายบิล|ชำระเงิน|ชำระค่าสินค้า/i.test(full);
    const transfer = /โอนเงินสำเร็จ|โอนเงิน|transfer/i.test(full) && !payment;
    const incoming = /ได้รับเงิน|รับเงินสำเร็จ|เงินเข้า|received/i.test(full) && !payment;
    const kind = incoming ? 'income' : 'expense';
    let description = '';
    if (/มิสเตอร์|Mister\s*D\.?I\.?Y/i.test(full)) description = 'Mister D.I.Y.';
    else if (/LinePay/i.test(full)) description = 'LinePay';
    else if (payment) description = 'ชำระเงินตามสลิป';
    else if (transfer) description = 'โอนเงินตามสลิป';
    else if (incoming) description = 'รับเงินตามสลิป';
    const parsed = { bank, kind, date: date(full), amount: amount(lines), description, text: String(text || ''), payment, transfer, incoming };
    parsed.ready = Boolean(payment && bank && parsed.date && parsed.amount && description && !incoming && !transfer);
    parsed.warnings = [];
    if (!parsed.date) parsed.warnings.push('อ่านวันที่ไม่ได้');
    if (!parsed.amount) parsed.warnings.push('อ่านยอดเงินไม่ได้');
    if (!bank) parsed.warnings.push('ระบุธนาคารไม่ได้');
    if (transfer) parsed.warnings.push('กรุณาตรวจว่าเป็นรายจ่ายหรือโอนระหว่างบัญชีตัวเอง');
    if (incoming) parsed.warnings.push('กรุณาตรวจประเภทเงินรับและข้อมูลภาษี');
    return parsed;
  }
  window.CashSlip = { parse };
})();
