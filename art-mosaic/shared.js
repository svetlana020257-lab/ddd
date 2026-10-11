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
    const o = { d: d.design, w: d.who, o: d.what, s: d.sum, t: d.till, n: d.num, f: d.font };
    const b = new TextEncoder().encode(JSON.stringify(o)); let bin = ''; b.forEach(x => bin += String.fromCharCode(x));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decode(s) {
    try {
      s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
      const bin = atob(s), b = Uint8Array.from(bin, ch => ch.charCodeAt(0));
      const o = JSON.parse(new TextDecoder().decode(b));
      return { design: o.d, who: o.w, what: o.o, sum: o.s, till: o.t, num: o.n, font: o.f };
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
  // одностороннее приглашение на ДР, вертикальное 2:3. d = {name, date, t1, t2, bring:[], skip:[]}; front — картинка лица (торт и т.п.)
  const IW = 1800, IH = 2700;
  function drawInvite(canvas, front, d) {
    const c = canvas.getContext('2d'), s = IW / 600;
    const INK = '#2B0F3D', PINK = '#E23C80', VIO = '#7A2E92', MUTED = '#9A7C95', LINE = '#E3C6D6';
    const UNB = 'Unbounded, "Arial Black", sans-serif', MAN = 'Manrope, sans-serif', HAND = "'Caveat', cursive";
    const font = (wt, px, f) => { c.font = `${wt} ${px * s}px ${f}`; };
    const ls = v => { try { c.letterSpacing = v; } catch (e) {} };
    const fit = (t, wt, px, f, maxW) => { do { font(wt, px, f); px -= .5; } while (c.measureText(t).width > maxW * s && px > 8); };
    const sq = (x, y, col, z = 8) => { c.fillStyle = col; c.beginPath(); c.roundRect(x * s, y * s, z * s, z * s, 2 * s); c.fill(); };
    const label = (t, x, y) => { font(500, 10, UNB); c.fillStyle = MUTED; ls(`${2 * s}px`); c.fillText(t, x * s, y * s); ls('0px'); };
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.textBaseline = 'alphabetic'; c.textAlign = 'left';
    c.fillStyle = '#FFFBFD'; c.fillRect(0, 0, IW, IH);
    const fh = 600 * 1419 / 2481; // ≈343
    if (front) c.drawImage(front, 0, 0, IW, fh * s);
    const X = 44, R = 556, M = 306; let y = fh + 62;
    font(800, 36, UNB); c.fillStyle = INK; c.fillText('Приглашение', X * s, y * s);
    font(800, 22, UNB); c.fillStyle = PINK; c.fillText('на день рождения', X * s, (y + 32) * s);
    font(700, 30, HAND); c.fillStyle = PINK; c.textAlign = 'right'; c.fillText('Всё сложится!', R * s, (y + 32) * s); c.textAlign = 'left';
    ['#7A2E92', '#E23C80', '#7C7CFF', '#F7841E', '#FFD92B'].forEach((col, i) => sq(X + i * 14, y + 46, col));
    y += 112;
    const name = (d.name || '').trim(), hi = name ? `${name} ждёт тебя в гости!` : 'Ждём тебя в гости!';
    fit(hi, 700, 42, HAND, R - X); c.fillStyle = VIO; c.fillText(hi, X * s, y * s);
    y += 30; font(600, 15, MAN); c.fillStyle = INK;
    wrap(c, 'Будем собирать мозаику из настоящего стекла — каждый гость унесёт домой свою работу. Опыт не нужен!', (R - X) * s)
      .forEach((l, i) => c.fillText(l, X * s, (y + i * 22) * s));
    y += 76;
    const list = (title, items, x, cols) => {
      label(title, x, y); let yy = y + 26;
      (items || []).filter(Boolean).slice(0, 3).forEach((t, i) => {
        font(600, 14, MAN); const ls_ = wrap(c, t, (M - X - 36) * s);
        sq(x, yy - 10, cols[i % cols.length]); c.fillStyle = INK;
        ls_.forEach((l, j) => c.fillText(l, (x + 16) * s, (yy + j * 19) * s)); yy += ls_.length * 19 + 8;
      });
      return yy;
    };
    const yb = Math.max(list('ВОЗЬМИТЕ С СОБОЙ', d.bring, X, ['#E23C80', '#F7841E', '#FFD92B']), list('НЕ НУЖНО', d.skip, M, ['#7C7CFF', '#7A2E92', '#7C7CFF']));
    y = Math.max(yb + 22, 676);
    label('КОГДА', X, y);
    c.strokeStyle = LINE; c.lineWidth = 1.4 * s;
    const day = fmtLong(d.date), tm = d.t1 ? (d.t2 ? `${d.t1}–${d.t2}` : `в ${d.t1}`) : '';
    const wn = [day, tm].filter(Boolean).join(', ');
    if (wn) { fit(wn, 700, 44, HAND, R - X); c.fillStyle = VIO; c.fillText(wn, X * s, (y + 46) * s); }
    c.beginPath(); c.moveTo(X * s, (y + 58) * s); c.lineTo(R * s, (y + 58) * s); c.stroke();
    // низ: адрес в розовой полосе, как в старых макетах мастерской
    const yb2 = 900 - 84;
    c.fillStyle = '#E23C80'; c.fillRect(0, yb2 * s, IW, IH - yb2 * s);
    font(800, 11, UNB); c.fillStyle = '#FFD3E5'; ls(`${1.6 * s}px`); c.fillText('ГДЕ', X * s, (yb2 + 26) * s); ls('0px');
    font(700, 17, MAN); c.fillStyle = '#FFFFFF'; c.fillText('Комсомольский пр-т, 24, 8 этаж, офис 815', X * s, (yb2 + 50) * s);
    font(600, 13.5, MAN); c.fillStyle = '#FFE3EF'; c.fillText('ART MOSAIC · мозаичная мастерская · +7 913 002-95-52', X * s, (yb2 + 70) * s);
    c.restore();
  }
  function pdfInvite(canvas) {
    const { jsPDF } = window.jspdf, w = 148, h = 222;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [w, h], compress: true });
    doc.addImage(canvas.toDataURL('image/jpeg', .92), 'JPEG', 0, 0, w, h); return doc.output('blob');
  }
  function download(filename, blob) {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  return { W, H, FONTS, DESIGNS, img, thumb, load, fmtSum, fmtDate, fmtLong, when, fontsReady, inviteFontsReady, drawBack, drawFront, drawInvite, pdfInvite, IW, IH, encode, decode, encodeObj, decodeObj, pdf, pdfOne, download };
})();
