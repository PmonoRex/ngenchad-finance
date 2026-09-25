/* Parse OCR text from trade confirmations. Never executes text from the document. */
(function (root) {
  'use strict';
  const months = { 'ม.ค': 1, 'ก.พ': 2, 'มี.ค': 3, 'เม.ย': 4, 'พ.ค': 5, 'มิ.ย': 6, 'ก.ค': 7, 'ส.ค': 8, 'ก.ย': 9, 'ต.ค': 10, 'พ.ย': 11, 'ธ.ค': 12 };
  const clean = text => String(text || '').replace(/[,\u200b]/g, '').replace(/[๐-๙]/g, c => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(c))).replace(/\r/g, '');
  const number = value => { const n = String(value || '').replace(/\s/g, '').replace(/,/g, ''); return /^\d+(?:\.\d+)?$/.test(n) ? n : ''; };
  const linesOf = text => clean(text).split(/\n+/).map(s => s.trim()).filter(Boolean);
  function afterLabel(lines, pattern, maxAhead = 2) {
    const re = new RegExp(pattern, 'i');
    for (let i = 0; i < lines.length; i++) {
      if (!re.test(lines[i])) continue;
      for (let j = i; j <= Math.min(lines.length - 1, i + maxAhead); j++) {
        const part = j === i ? lines[j].replace(re, '') : lines[j];
        const matches = [...part.matchAll(/\b(\d+(?:\.\d{1,8})?)\b/g)];
        const match = matches.find(m => part[m.index + m[0].length] !== '%');
        if (match) return number(match[1]);
      }
    }
    return '';
  }
  function parseDate(lines) {
    const ordered = [...lines.filter(s => /สำเร็จ|completed|executed/i.test(s)), ...lines];
    for (const rawLine of ordered) {
      const line = rawLine.replace(/ก\.?ุย\./g, 'ก.ย.').replace(/ก\.ุย\./g, 'ก.ย.');
      let m = line.match(/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/);
      if (m) return iso(+m[1], +m[2], +m[3]);
      m = line.match(/\b(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2}|\d{2})\b/);
      if (m) return iso(year(+m[3]), +m[2], +m[1]);
      m = line.match(/(\d{1,2})\s*(ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)\s*(\d{2,4})/);
      if (m) {
        const token = m[2].replace(/\s/g, '').replace(/\.$/, '');
        const month = months[token];
        if (month) return iso(year(+m[3]), month, +m[1]);
      }
    }
    return '';
  }
  function year(y) { return y >= 2400 ? y - 543 : y < 100 ? (y >= 50 ? y + 1957 : y + 2000) : y; }
  function iso(y, m, d) {
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() + 1 === m && date.getUTCDate() === d
      ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : '';
  }
  function parse(text) {
    const lines = linesOf(text);
    const full = lines.join('\n');
    const market = /NASDAQ|NYSE|AMEX|สหรัฐ|USD/i.test(full) ? 'US' : /SET|THB|หุ้นไทย/.test(full) ? 'SET' : '';
    const header = lines.slice(0, 12).join(' ');
    const side = /(?:ซื้อ|buy|purchase)/i.test(header) ? 'buy' : /(?:ขาย|sell)/i.test(header) ? 'sell' : '';
    let symbol = (header.match(/(?:ซื้อ|ขาย|buy|sell)\s+([A-Z][A-Z0-9.\-]{0,9})\b/i) || [])[1] || '';
    symbol = symbol.toUpperCase();
    let quantity = afterLabel(lines, 'จำนวนหุ้น|quantity|shares');
    if (!quantity) quantity = (full.match(/\b0\.\d{5,8}\b/) || [])[0] || '';
    const unitPrice = afterLabel(lines, 'ราคาที่ได้จริง|ราคาต่อหุ้น|execution price|fill price|price per share');
    const statedGross = afterLabel(lines, 'มูลค่าหุ้น|มูลค่าซื้อขาย|trade value|share value');
    const commission = afterLabel(lines, 'ค่าคอมมิช(?:ชั่น|ชัน)|commission|brokerage');
    const vat = afterLabel(lines, 'ภาษีมูลค่าเพิ่ม|VAT|sales tax');
    const tradedOn = parseDate(lines);
    const fees = commission && vat ? (Math.round((Number(commission) + Number(vat)) * 10000) / 10000).toFixed(4) : '';
    const warnings = [];
    if (!market) warnings.push('ไม่ทราบตลาดหุ้น');
    if (!side) warnings.push('ไม่ทราบว่าซื้อหรือขาย');
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) warnings.push('อ่านชื่อย่อหุ้นไม่ชัด');
    if (!tradedOn) warnings.push('อ่านวันที่ซื้อขายไม่ชัด');
    if (!quantity || !/^\d+(?:\.\d{1,8})?$/.test(quantity) || Number(quantity) <= 0) warnings.push('อ่านจำนวนหุ้นไม่ชัด');
    if (!unitPrice || !/^\d+(?:\.\d{1,4})?$/.test(unitPrice) || Number(unitPrice) <= 0) warnings.push('อ่านราคาต่อหุ้นไม่ชัด');
    if (!commission || !vat) warnings.push('อ่านค่าคอมมิชชั่นหรือ VAT ไม่ครบ');
    if (!statedGross) warnings.push('ไม่มีมูลค่าหุ้นสำหรับตรวจยอด');
    if (quantity && unitPrice && statedGross && Math.abs(Number(quantity) * Number(unitPrice) - Number(statedGross)) > 0.02) warnings.push('จำนวนหุ้น × ราคาไม่ตรงกับมูลค่าหุ้นในเอกสาร');
    if (/ยกเลิกคำสั่ง|cancelled|canceled/i.test(full)) warnings.push('เอกสารอาจเป็นคำสั่งที่ยกเลิก');
    const dime = /Dime!|Dime\b/i.test(full);
    if (!dime) warnings.push('เอกสารจากโบรกเกอร์ที่ยังไม่ได้ตรวจรูปแบบ');
    return { market, side, symbol, tradedOn, quantity, unitPrice, fees, statedGross, commission, vat, broker: dime ? 'Dime!' : '', warnings, ready: warnings.length === 0, text: full };
  }
  root.TradeReceipt = { parse };
})(typeof window !== 'undefined' ? window : globalThis);
