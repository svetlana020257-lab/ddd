// Общая логика сертификатов Art Mosaic: шрифты, отрисовка оборота, кодирование ссылки
const AM = (() => {
  const W = 2481, H = 1419, S = W / 794;
  const FONTS = [['caveat', 'Caveat', '700', 1.55], ['marck', 'Marck Script', '400', 1.35], ['bad', 'Bad Script', '400', 1.1], ['comfortaa', 'Comfortaa', '700', 1.0]];
  const DESIGNS = [['phrase', 'Всё сложится'], ['phrase_cap', 'Всё сложится + подпись'], ['logo', 'Логотип'], ['logo_cap', 'Логотип + подпись'], ['cake', 'С днём рождения'], ['phoenix', 'Феникс'], ['phoenix_phrase', 'Феникс + «Всё сложится»']];
  const img = k => 'img/' + k + '.jpg';
  const thumb = k => 'img/t_' + k + '.jpg';
  const load = src => new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = src; });
  const fmtSum = v => { const n = Math.round(+v || 0); return n ? n.toLocaleString('ru-RU').replace(/ |,/g, ' ') + ' ₽' : ''; };
  const fmtDate = v => { if (!v) return ''; const [y, m, d] = v.split('-'); return `${d}.${m}.${y}`; };
  function fitText(ctx, text, x, y, maxW, size, weight, family, color) {
    let s = size; ctx.fillStyle = color;
    do { ctx.font = `${weight} ${s * S}px ${family}`; if (ctx.measureText(text).width <= maxW * S) break; s -= .5; } while (s > 10);
    ctx.fillText(text, x * S, y * S);
  }
  async function fontsReady() {
    try { await Promise.all(['700 20px Caveat', '400 20px "Marck Script"', '400 20px "Bad Script"', '700 20px Comfortaa'].map(f => document.fonts.load(f, 'Дарье ₽ 0123'))); } catch (e) {}
  }
  // d = {who, what, sum, till(YYYY-MM-DD), num, font}
  function drawBack(canvas, backImg, d) {
    const c = canvas.getContext('2d'); c.drawImage(backImg, 0, 0, W, H); c.textBaseline = 'alphabetic';
    const F = FONTS.find(f => f[0] === d.font) || FONTS[0], fam = `'${F[1]}', cursive`, w = F[2], k = F[3], col = '#7A2E92';
    fitText(c, (d.who || '').trim(), 150, 178, 600, 20 * k, w, fam, col);
    fitText(c, (d.what || '').trim(), 150, 241, 600, 20 * k, w, fam, col);
    fitText(c, fmtSum(d.sum), 150, 304, 286, 20 * k, w, fam, '#2B0F3D');
    fitText(c, fmtDate(d.till), 464, 304, 286, 20 * k, w, fam, col);
    fitText(c, (d.num || '').trim(), 672, 51, 80, 12, 700, fam, col);
  }
  function drawFront(canvas, frontImg) { canvas.getContext('2d').drawImage(frontImg, 0, 0, W, H); }
  // компактная ссылка: JSON -> UTF-8 -> base64url
  function encode(d) {
    const o = { d: d.design, w: d.who, o: d.what, s: d.sum, t: d.till, n: d.num, f: d.font }; if (d.one) o.x = 1;
    const b = new TextEncoder().encode(JSON.stringify(o)); let bin = ''; b.forEach(x => bin += String.fromCharCode(x));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decode(s) {
    try {
      s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
      const bin = atob(s), b = Uint8Array.from(bin, ch => ch.charCodeAt(0));
      const o = JSON.parse(new TextDecoder().decode(b));
      return { design: o.d, who: o.w, what: o.o, sum: o.s, till: o.t, num: o.n, font: o.f, one: !!o.x };
    } catch (e) { return null; }
  }
  function pdf(frontCanvas, backCanvas) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [210, 120], compress: true });
    doc.addImage(frontCanvas.toDataURL('image/jpeg', .92), 'JPEG', 0, 0, 210, 120);
    doc.addPage([210, 120], 'landscape');
    doc.addImage(backCanvas.toDataURL('image/jpeg', .92), 'JPEG', 0, 0, 210, 120);
    return doc.output('blob');
  }
  // одна страница: лицо сверху, оборот снизу — удобно переслать одним файлом
  function pdfOne(frontCanvas, backCanvas) {
    const { jsPDF } = window.jspdf, gap = 6, ph = 120 * 2 + gap;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [210, ph], compress: true });
    doc.setFillColor(255, 242, 247); doc.rect(0, 0, 210, ph, 'F');
    doc.addImage(frontCanvas.toDataURL('image/jpeg', .9), 'JPEG', 0, 0, 210, 120);
    doc.addImage(backCanvas.toDataURL('image/jpeg', .9), 'JPEG', 0, 120 + gap, 210, 120);
    return doc.output('blob');
  }
  // универсальная компактная ссылка для любых данных
  function encodeObj(o) {
    const b = new TextEncoder().encode(JSON.stringify(o)); let bin = ''; b.forEach(x => bin += String.fromCharCode(x));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeObj(s) {
    try {
      s = (s || '').replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
      const b = Uint8Array.from(atob(s), ch => ch.charCodeAt(0)); return JSON.parse(new TextDecoder().decode(b));
    } catch (e) { return null; }
  }
  const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const fmtLong = v => { if (!v) return ''; const [, m, d] = v.split('-'); return `${+d} ${MONTHS[+m - 1]}`; };
  function when(d) {
    const t = d.t1 ? (d.t2 ? `${d.t1}–${d.t2}` : `в ${d.t1}`) : '';
    return [fmtLong(d.date), t].filter(Boolean).join(', ');
  }
  function wrap(ctx, text, maxW) {
    const out = [];
    for (const para of String(text || '').split(/\n/)) {
      let line = '';
      for (const w of para.split(/\s+/).filter(Boolean)) {
        const t = line ? line + ' ' + w : w;
        if (ctx.measureText(t).width <= maxW || !line) line = t; else { out.push(line); line = w; }
      }
      out.push(line);
    }
    return out;
  }
  async function inviteFontsReady() {
    try { await Promise.all(['800 20px Unbounded', '500 20px Unbounded', '700 20px Manrope', '600 20px Manrope'].map(f => document.fonts.load(f, 'Приглашение ART 0123'))); } catch (e) {}
    return fontsReady();
  }
  // приглашение на ДР одной стороной, формат карточки сертификата. Слева торт из плитки (f_cake), справа плашка с текстом —
  // она закрывает надпись «С днём рождения», т.к. гостя не поздравляют, а приглашают. d = {name, date, t1, t2, note}
  function drawInvite(canvas, front, d) {
    const c = canvas.getContext('2d'), s = S;
    const INK = '#2B0F3D', PINK = '#E23C80', VIO = '#7A2E92', MUTED = '#9A7C95', LINE = '#E3C6D6';
    const UNB = 'Unbounded, "Arial Black", sans-serif', MAN = 'Manrope, sans-serif', HAND = "'Caveat', cursive";
    const font = (wt, px, f) => { c.font = `${wt} ${px * s}px ${f}`; };
    const ls = v => { try { c.letterSpacing = v; } catch (e) {} };
    const fit = (t, wt, px, f, maxW) => { do { font(wt, px, f); px -= .5; } while (c.measureText(t).width > maxW * s && px > 8); };
    const label = (t, x, y) => { font(500, 8, UNB); c.fillStyle = MUTED; ls(`${1.5 * s}px`); c.fillText(t, x * s, y * s); ls('0px'); };
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.textBaseline = 'alphabetic'; c.textAlign = 'left';
    if (front) c.drawImage(front, 0, 0, W, H); else { c.fillStyle = '#FBE3EE'; c.fillRect(0, 0, W, H); }
    const PX = 350, PY = 24, PW = 426, PH = 406;
    c.shadowColor = 'rgba(122,46,146,.22)'; c.shadowBlur = 18 * s; c.shadowOffsetY = 4 * s;
    c.fillStyle = '#FFFBFD'; c.beginPath(); c.roundRect(PX * s, PY * s, PW * s, PH * s, 14 * s); c.fill();
    c.shadowColor = 'transparent'; c.shadowBlur = 0; c.shadowOffsetY = 0;
    const X = PX + 26, R = PX + PW - 24;
    font(800, 24, UNB); c.fillStyle = INK; c.fillText('Приглашение', X * s, 66 * s);
    font(800, 15.5, UNB); c.fillStyle = PINK; c.fillText('на день рождения', X * s, 89 * s);
    ['#7A2E92', '#E23C80', '#7C7CFF', '#F7841E', '#FFD92B'].forEach((col, i) => { c.fillStyle = col; c.beginPath(); c.roundRect((X + i * 11) * s, 98 * s, 7 * s, 7 * s, 1.6 * s); c.fill(); });
    const name = (d.name || '').trim(), hi = name ? `${name} ждёт тебя в гости!` : 'Ждём тебя в гости!';
    fit(hi, 700, 29, HAND, R - X); c.fillStyle = VIO; c.fillText(hi, X * s, 142 * s);
    label('КОГДА', X, 172);
    const day = fmtLong(d.date), tm = d.t1 ? (d.t2 ? `${d.t1}–${d.t2}` : `в ${d.t1}`) : '';
    const wn = [day, tm].filter(Boolean).join(', ');
    if (wn) { fit(wn, 700, 29, HAND, R - X); c.fillStyle = VIO; c.fillText(wn, X * s, 201 * s); }
    c.strokeStyle = LINE; c.lineWidth = 1.2 * s; c.beginPath(); c.moveTo(X * s, 209 * s); c.lineTo(R * s, 209 * s); c.stroke();
    label('ГДЕ', X, 234);
    font(700, 13, MAN); c.fillStyle = INK; c.fillText('Комсомольский пр-т, 24', X * s, 252 * s);
    font(600, 11.5, MAN); c.fillStyle = MUTED; c.fillText('8 этаж · офис 815', X * s, 268 * s);
    const note = (d.note || '').trim();
    if (note) { let px = 12; let ln; do { font(600, px, MAN); ln = wrap(c, note, (R - X) * s); px -= .5; } while (ln.length > 3 && px > 8);
      c.fillStyle = INK; ln.slice(0, 3).forEach((l, i) => c.fillText(l, X * s, (300 + i * px * 1.45) * s)); }
    font(800, 9, UNB); c.fillStyle = INK; ls(`${1 * s}px`); c.fillText('ART MOSAIC', X * s, 398 * s); ls('0px');
    font(600, 10, MAN); c.fillStyle = MUTED; c.fillText('+7 913 002-95-52', X * s, 412 * s);
    font(700, 26, HAND); c.fillStyle = PINK; c.textAlign = 'right'; c.fillText('Всё сложится!', R * s, 410 * s);
    c.restore();
  }
  // сертификат одной стороной: слева феникс или торт из плитки, справа плашка с полями (закрывает надпись на исходной картинке)
  // d = {who, what, sum, till, num, font}
  function drawCert1(canvas, front, d) {
    const c = canvas.getContext('2d'), s = S;
    const INK = '#2B0F3D', PINK = '#E23C80', VIO = '#7A2E92', MUTED = '#9A7C95', LINE = '#E3C6D6';
    const UNB = 'Unbounded, "Arial Black", sans-serif', MAN = 'Manrope, sans-serif';
    const F = FONTS.find(f => f[0] === d.font) || FONTS[0], HAND = `'${F[1]}', cursive`, HW = F[2], k = F[3];
    const font = (wt, px, f) => { c.font = `${wt} ${px * s}px ${f}`; };
    const ls = v => { try { c.letterSpacing = v; } catch (e) {} };
    const fit = (t, wt, px, f, maxW) => { do { font(wt, px, f); px -= .5; } while (c.measureText(t).width > maxW * s && px > 8); };
    const label = (t, x, y) => { font(500, 8, UNB); c.fillStyle = MUTED; ls(`${1.5 * s}px`); c.fillText(t, x * s, y * s); ls('0px'); };
    const line = (a, b, y) => { c.strokeStyle = LINE; c.lineWidth = 1.2 * s; c.beginPath(); c.moveTo(a * s, y * s); c.lineTo(b * s, y * s); c.stroke(); };
    const val = (t, x, y, maxW, col) => { if (!t) return; fit(t, HW, 21 * k, HAND, maxW); c.fillStyle = col; c.fillText(t, x * s, y * s); };
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.textBaseline = 'alphabetic'; c.textAlign = 'left';
    if (front) c.drawImage(front, 0, 0, W, H); else { c.fillStyle = '#FBE3EE'; c.fillRect(0, 0, W, H); }
    const PX = 366, PY = 24, PW = 410, PH = 406;
    c.shadowColor = 'rgba(122,46,146,.22)'; c.shadowBlur = 18 * s; c.shadowOffsetY = 4 * s;
    c.fillStyle = '#FFFBFD'; c.beginPath(); c.roundRect(PX * s, PY * s, PW * s, PH * s, 14 * s); c.fill();
    c.shadowColor = 'transparent'; c.shadowBlur = 0; c.shadowOffsetY = 0;
    const X = PX + 26, R = PX + PW - 24, MID = X + (R - X) / 2 + 6;
    font(800, 23, UNB); c.fillStyle = INK; c.fillText('Подарочный', X * s, 66 * s);
    c.fillStyle = PINK; c.fillText('сертификат', X * s, 93 * s);
    ['#7A2E92', '#E23C80', '#7C7CFF', '#F7841E', '#FFD92B'].forEach((col, i) => { c.fillStyle = col; c.beginPath(); c.roundRect((X + i * 11) * s, 103 * s, 7 * s, 7 * s, 1.6 * s); c.fill(); });
    const num = (d.num || '').trim();
    if (num) { font(500, 8, UNB); c.fillStyle = MUTED; c.textAlign = 'right'; c.fillText('№', (R - 54) * s, 52 * s); c.textAlign = 'left'; line(R - 50, R, 56); val(num, R - 48, 52, 48, VIO); }
    label('ДЛЯ КОГО', X, 136); line(X, R, 172); val((d.who || '').trim(), X, 166, R - X, VIO);
    label('НА ЧТО', X, 190); line(X, R, 226); val((d.what || '').trim(), X, 220, R - X, VIO);
    label('НОМИНАЛ', X, 244); line(X, MID - 14, 280); val(fmtSum(d.sum), X, 274, MID - 14 - X, INK);
    label('ДЕЙСТВУЕТ ДО', MID, 244); line(MID, R, 280); val(fmtDate(d.till), MID, 274, R - MID, VIO);
    font(700, 11.5, MAN); c.fillStyle = INK; c.fillText('Запишитесь заранее', X * s, 322 * s);
    const w1 = c.measureText('Запишитесь заранее ').width;
    font(600, 11.5, MAN); c.fillStyle = MUTED; c.fillText('по телефону +7 913 002-95-52', X * s + w1, 322 * s);
    c.fillText('Комсомольский пр-т, 24 · 8 этаж · офис 815', X * s, 339 * s);
    font(800, 9, UNB); c.fillStyle = INK; ls(`${1 * s}px`); c.fillText('ART MOSAIC', X * s, 404 * s); ls('0px');
    font(600, 10, MAN); c.fillStyle = MUTED; c.fillText('мозаичная мастерская', X * s, 417 * s);
    if (d.design !== 'brand') { font(700, 26, "'Caveat', cursive"); c.fillStyle = PINK; c.textAlign = 'right'; c.fillText('Всё сложится!', R * s, 414 * s); }
    c.restore();
  }
  function pdfInvite(canvas) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [210, 120], compress: true });
    doc.addImage(canvas.toDataURL('image/jpeg', .92), 'JPEG', 0, 0, 210, 120); return doc.output('blob');
  }

  function download(filename, blob) {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  return { W, H, FONTS, DESIGNS, img, thumb, load, fmtSum, fmtDate, fmtLong, when, fontsReady, inviteFontsReady, drawBack, drawFront, drawInvite, drawCert1, pdfInvite, encode, decode, encodeObj, decodeObj, pdf, pdfOne, download };
})();
