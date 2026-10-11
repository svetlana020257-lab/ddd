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
  // оборот приглашения. d = {occ, greet, text, date, t1, t2, sign, font}; tiles — img/bg.jpg для мозаичной кромки
  function drawInvite(canvas, tiles, d) {
    const c = canvas.getContext('2d'), s = S;
    const F = FONTS.find(f => f[0] === d.font) || FONTS[0], fam = `'${F[1]}', cursive`, w = F[2], k = F[3];
    const INK = '#2B0F3D', PINK = '#E23C80', VIO = '#7A2E92', MUTED = '#9A7C95', LINE = '#EBD3E0';
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.textBaseline = 'alphabetic'; c.textAlign = 'left';
    c.fillStyle = '#FFFBFD'; c.fillRect(0, 0, W, H);
    // мозаичная кромка слева
    if (tiles) { const sw = Math.round(tiles.height * 58 / 454); c.drawImage(tiles, 0, 0, sw, tiles.height, 0, 0, 58 * s, H); }
    const X = 98, R = 750;
    const font = (wt, px, f) => { c.font = `${wt} ${px * s}px ${f}`; };
    const ls = v => { try { c.letterSpacing = v; } catch (e) {} };
    // заголовок
    font(800, 30, 'Unbounded, "Arial Black", sans-serif'); c.fillStyle = INK; ls('0px'); c.fillText('Приглашение', X * s, 74 * s);
    const occ = (d.occ || '').trim();
    if (occ) { let px = 19; do { font(800, px, 'Unbounded, "Arial Black", sans-serif'); px -= .5; } while (c.measureText(occ).width > (R - X) * s && px > 10); c.fillStyle = PINK; c.fillText(occ, X * s, 102 * s); }
    ['#7A2E92', '#E23C80', '#7C7CFF', '#F7841E', '#FFD92B'].forEach((col, i) => { c.fillStyle = col; c.beginPath(); c.roundRect ? c.roundRect((X + i * 13) * s, 114 * s, 9 * s, 9 * s, 2 * s) : c.rect((X + i * 13) * s, 114 * s, 9 * s, 9 * s); c.fill(); });
    // обращение
    const greet = (d.greet || '').trim(); let y = 170;
    if (greet) { let px = 25 * k; do { font(w, px, fam); px -= .5; } while (c.measureText(greet).width > (R - X) * s && px > 10); c.fillStyle = VIO; c.fillText(greet, X * s, y * s); y += 12; }
    // основной текст: подбираем кегль, чтобы влезло до блока «когда/где»
    const top = y + 10, bottom = 318; let px = 19 * k, lines, lh;
    do { font(w, px, fam); lh = px * 1.28; lines = wrap(c, d.text, (R - X) * s); px -= .5; } while ((lines.length * lh > bottom - top) && px > 9);
    c.fillStyle = INK; lines.forEach((l, i) => c.fillText(l, X * s, (top + lh * (i + .82)) * s));
    // когда / где
    font(500, 8.5, 'Unbounded, sans-serif'); c.fillStyle = MUTED; ls(`${1.6 * s}px`);
    c.fillText('КОГДА', X * s, 340 * s); c.fillText('ГДЕ', 440 * s, 340 * s); ls('0px');
    c.strokeStyle = LINE; c.lineWidth = 1.2 * s;
    [[X, 404], [440, R]].forEach(([a, b]) => { c.beginPath(); c.moveTo(a * s, 380 * s); c.lineTo(b * s, 380 * s); c.stroke(); });
    const wn = when(d); if (wn) { let p = 20 * k; do { font(w, p, fam); p -= .5; } while (c.measureText(wn).width > (404 - X) * s && p > 9); c.fillStyle = VIO; c.fillText(wn, X * s, 372 * s); }
    font(700, 12.5, 'Manrope, sans-serif'); c.fillStyle = INK; c.fillText('Комсомольский пр-т, 24', 440 * s, 360 * s);
    font(600, 11, 'Manrope, sans-serif'); c.fillStyle = MUTED; c.fillText('8 этаж · офис 815', 440 * s, 375 * s);
    // низ: мастерская + подпись
    font(800, 9.5, 'Unbounded, sans-serif'); c.fillStyle = INK; ls(`${1 * s}px`); c.fillText('ART MOSAIC', X * s, 424 * s); ls('0px');
    font(600, 10, 'Manrope, sans-serif'); c.fillStyle = MUTED; c.fillText('мозаичная мастерская · +7 913 002-95-52', X * s, 438 * s);
    const sign = (d.sign || '').trim();
    if (sign) { let p = 27 * k; do { font(w, p, fam); p -= .5; } while (c.measureText(sign).width > 260 * s && p > 10); c.fillStyle = PINK; c.textAlign = 'right'; c.fillText(sign, R * s, 432 * s); }
    c.restore();
  }
  // универсальный бланк приглашения на ДР: текст общий, имя/дата/время — пустые строки, вписать от руки или в телефоне
  function drawInviteBlank(canvas, tiles) {
    const c = canvas.getContext('2d'), s = S;
    const INK = '#2B0F3D', PINK = '#E23C80', VIO = '#7A2E92', MUTED = '#9A7C95', LINE = '#D9B8CB';
    const font = (wt, px, f) => { c.font = `${wt} ${px * s}px ${f}`; };
    const ls = v => { try { c.letterSpacing = v; } catch (e) {} };
    const UNB = 'Unbounded, "Arial Black", sans-serif', MAN = 'Manrope, sans-serif', HAND = "'Caveat', cursive";
    c.setTransform(1, 0, 0, 1, 0, 0); c.textBaseline = 'alphabetic'; c.textAlign = 'left';
    c.fillStyle = '#FFFBFD'; c.fillRect(0, 0, W, H);
    if (tiles) { const sw = Math.round(tiles.height * 58 / 454); c.drawImage(tiles, 0, 0, sw, tiles.height, 0, 0, 58 * s, H); }
    const X = 98, R = 750;
    font(800, 30, UNB); c.fillStyle = INK; c.fillText('Приглашение', X * s, 70 * s);
    font(800, 19, UNB); c.fillStyle = PINK; c.fillText('на день рождения', X * s, 97 * s);
    ['#7A2E92', '#E23C80', '#7C7CFF', '#F7841E', '#FFD92B'].forEach((col, i) => { c.fillStyle = col; c.beginPath(); c.roundRect((X + i * 13) * s, 109 * s, 9 * s, 9 * s, 2 * s); c.fill(); });
    font(700, 36, HAND); c.fillStyle = VIO; c.fillText('Привет!', X * s, 160 * s);
    font(700, 26, HAND); c.fillStyle = INK;
    ['Приглашаю тебя на мой день рождения в мозаичную мастерскую', 'Art Mosaic! Будем собирать мозаику из настоящего стекла —', 'каждый унесёт домой свою работу. Всё сложится!']
      .forEach((l, i) => c.fillText(l, X * s, (192 + i * 25) * s));
    const label = (t, x, y) => { font(500, 8.5, UNB); c.fillStyle = MUTED; ls(`${1.6 * s}px`); c.fillText(t, x * s, y * s); ls('0px'); };
    const line = (a, b, y) => { c.strokeStyle = LINE; c.lineWidth = 1.4 * s; c.beginPath(); c.moveTo(a * s, y * s); c.lineTo(b * s, y * s); c.stroke(); };
    label('ИМЕНИННИК', X, 286); line(X, R, 318);
    label('ДАТА', X, 346); line(X, 290, 378);
    label('ВРЕМЯ', 314, 346); line(314, 440, 378);
    label('ГДЕ', 470, 346);
    font(700, 12.5, MAN); c.fillStyle = INK; c.fillText('Комсомольский пр-т, 24', 470 * s, 362 * s);
    font(600, 11, MAN); c.fillStyle = MUTED; c.fillText('8 этаж · офис 815', 470 * s, 377 * s);
    font(800, 9.5, UNB); c.fillStyle = INK; ls(`${1 * s}px`); c.fillText('ART MOSAIC', X * s, 424 * s); ls('0px');
    font(600, 10, MAN); c.fillStyle = MUTED; c.fillText('мозаичная мастерская · +7 913 002-95-52', X * s, 438 * s);
    font(700, 26, HAND); c.fillStyle = PINK; c.textAlign = 'right'; c.fillText('Ждём тебя!', R * s, 434 * s); c.textAlign = 'left';
  }
  function download(filename, blob) {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  return { W, H, FONTS, DESIGNS, img, thumb, load, fmtSum, fmtDate, fmtLong, when, fontsReady, inviteFontsReady, drawBack, drawFront, drawInvite, drawInviteBlank, encode, decode, encodeObj, decodeObj, pdf, pdfOne, download };
})();
