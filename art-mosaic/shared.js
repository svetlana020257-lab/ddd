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
  function download(filename, blob) {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  return { W, H, FONTS, DESIGNS, img, thumb, load, fmtSum, fmtDate, fontsReady, drawBack, drawFront, encode, decode, pdf, download };
})();
