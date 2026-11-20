/**
 * Феня — птенец феникса, помощница мастерской Art Mosaic (Telegram-бот)
 * Файл кладётся рядом с Code.gs в том же проекте Apps Script.
 *
 * Настройка:
 * 1. @BotFather → /newbot → скопировать токен в BOT_TOKEN.
 * 2. Развернуть веб-приложение (как для приложения) и запустить setupBot один раз.
 * 3. Написать боту /start — он ответит вашим ID. Вписать ID в ALLOWED_IDS,
 *    сохранить, обновить развертывание (Управление развертываниями → Новая версия).
 */

const BOT_TOKEN = '';           // токен от @BotFather
// Рабочая ссылка веб-приложения (заканчивается на /exec)
const WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbz19KS3-W0EvcN7TiCvM9X8OfRSwnRg3XLOn_BgSkLpnRVidH1QG6mpGF8m-eTLZkCKow/exec';
// Адрес посредника Cloudflare (https://….workers.dev). Если пусто — Telegram пишет прямо в WEBAPP_URL
const PROXY_URL = '';
const ALLOWED_IDS = [];         // ID тех, кому можно пользоваться ботом (свои ID — только в Apps Script)
const MORNING_HOUR = 9;         // во сколько присылать утреннюю сводку (по Новосибирску)
const MONTH_GOAL = 0;           // цель по выручке на месяц, например 150000. 0 — без цели
                                // (по мере выручки Феня «собирается» из плиток)

const BOT_NAME = 'Феня · Art Mosaic';
const BOT_ABOUT = 'Птенец феникса из мастерской Art Mosaic. Считаю доходы и расходы, помню про платежи и дела. Всё сложится!';
const BOT_DESCRIPTION = 'Чирик! Я Феня 🐣🧩\nПтенец феникса из мозаичной мастерской Art Mosaic.\n\nЗаписываю доходы и расходы, напоминаю о платежах и делах — и всё складываю в таблицу. Нажмите «Старт»!';

// Фразы Фени — выбираются случайно, чтобы не повторяться
const SAY = {
  inc: ['ещё один осколочек на месте 🧩', 'копилка звякнула 💗', 'складывается!', 'чирик-чирик, денежка пришла 🐣', 'перышко к перышку 🪶'],
  exp: ['записала, всё под контролем 🪶', 'учла 🧩', 'на хорошее дело — значит, вернётся', 'отметила, не волнуйся'],
  morning: ['Чирик! Доброе утро ☀️', 'Доброе утро! Феня на связи 🐣', 'Просыпаемся! ☀️🧩'],
  plus: ['Месяц в плюсе — расправляю крылышки 🔥', 'В плюсе! Всё складывается 💗'],
  minus: ['Пока в минусе, но это только начало — всё сложится 🪶', 'Расходы обгоняют, но мы догоним 💪']
};
function say_(k) { const a = SAY[k]; return a[Math.floor(Math.random() * a.length)]; }

// «Собранность» Фени: доля месячной цели плитками
function goalBar_(inc) {
  if (!MONTH_GOAL) return '';
  const pct = Math.min(100, Math.round(inc / MONTH_GOAL * 100));
  const n = Math.min(10, Math.floor(pct / 10));
  return '\n🐣 Феня собрана на <b>' + pct + '%</b>\n' + '🟪'.repeat(n) + '⬜'.repeat(10 - n) +
    (pct >= 100 ? '\n🔥 Цель месяца достигнута — я настоящий феникс!' : '\nдо цели ' + money_(MONTH_GOAL - inc));
}

const KB = {
  keyboard: [['📊 Сегодня', '📈 Месяц'], ['📅 Платежи', '✅ Дела'], ['❓ Помощь']],
  resize_keyboard: true, is_persistent: true
};

/* ---------------- Вход: сообщения от Telegram ---------------- */

function doPost(e) {
  if (!e || !e.postData) return ok_();   // запуск вручную из редактора — ничего не делаем
  try {
    BOT_MODE_ = true;
    const upd = JSON.parse(e.postData.contents);
    // Telegram иногда присылает одно и то же обновление повторно — пропускаем дубли
    const cache = CacheService.getScriptCache();
    const key = 'upd_' + upd.update_id;
    if (cache.get(key)) return ok_();
    cache.put(key, '1', 21600);

    console.log('Пришло: ' + JSON.stringify(upd).slice(0, 300));
    if (upd.message) onMessage_(upd.message);
    if (upd.callback_query) onCallback_(upd.callback_query);
  } catch (err) {
    console.error(err);
    reportError_(null, err);
  }
  return ok_();
}

// HtmlService отвечает Telegram кодом 200 (ContentService даёт 302 и очередь из повторов)
function ok_() { return HtmlService.createHtmlOutput('ok'); }

function allowed_(id) { return ALLOWED_IDS.map(String).indexOf(String(id)) >= 0; }

function onMessage_(m) {
  const chat = m.chat.id;
  const text = String(m.text || '').trim();
  if (!allowed_(m.from.id)) {
    send_(chat, 'Чирик! 🐣 Я Феня из мастерской Art Mosaic.\nПока я вас не знаю. Ваш ID: <code>' + m.from.id + '</code> — передайте его Светлане, и я начну помогать.');
    return;
  }
  try {
    const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
    const isItem = l => /^[+\-−–]\s*\d/.test(l) || /^(дело|задача|сделать)[\s:,-]/i.test(l);
    if (lines.length > 1 && lines.filter(isItem).length >= 1 && isItem(lines[0])) return addBatch_(chat, lines);
    if (/^(дело|задача|сделать)[\s:,-]/i.test(text)) return addTask_(chat, text);
    if (/^[+\-−–]\s*\d/.test(text)) return addOp_(chat, text);
    if (/^\/start|^\/help|помощь$/i.test(text)) return send_(chat, HELP_, KB);
    if (/^\/today|^📊|^сегодня$/i.test(text)) return send_(chat, reportToday_(), KB);
    if (/^\/month|^📈|^месяц$/i.test(text)) return send_(chat, reportMonth_(), KB);
    if (/^\/pays|^📅|^платежи$/i.test(text)) return sendPays_(chat);
    if (/^\/tasks|^✅|^дела$/i.test(text)) return sendTasks_(chat);
    send_(chat, 'Чирик? Не поняла 🙈 Вот как со мной можно:\n\n' + HELP_SHORT_, KB);
  } catch (err) {
    console.error(err);
    reportError_(chat, err);
  }
}

const HELP_SHORT_ =
  'Доход: <code>+4500 мк карта ваза, 3 чел</code>\n' +
  'Расход: <code>-1800 стекло перевод</code>\n' +
  'Задача: <code>дело заказать клей завтра</code>';

const HELP_ =
  'Чирик! Я <b>Феня</b> 🐣🧩 — птенец феникса из Art Mosaic.\n' +
  'Слежу за денежками мастерской, напоминаю о платежах и делах. Всё сложится!\n\n' +
  '<b>Записать доход или расход</b> — сумма со знаком, дальше как удобно:\n' +
  '<code>+4500 мк карта ваза, 3 чел</code>\n<code>-1800 стекло перевод</code>\n<code>-500 вчера такси</code>\n\n' +
  'Можно <b>несколько сразу</b> — каждая запись с новой строки (и дела тоже).\n\n' +
  'Категорию и способ оплаты узнаю по началу слова (мк, праздник, сертиф, аренда, стекло…; нал, карта, перевод). ' +
  'Если не узнаю — предложу выбрать кнопкой. «Вчера» или дата <code>15.11</code> меняют дату.\n\n' +
  '<b>Добавить дело:</b> <code>дело позвонить поставщику завтра</code>\n' +
  'Срок: сегодня, завтра, послезавтра или дата <code>25.11</code>.\n\n' +
  '<b>Кнопки внизу</b> — итоги дня и месяца, платежи (можно отметить оплату) и список дел.\n' +
  'Каждое утро в ' + MORNING_HOUR + ':00 прилетаю со сводкой и напоминаю о платежах ☀️';

/* ---------------- Доходы и расходы ---------------- */

function norm_(s) { return String(s).toLowerCase().replace(/ё/g, 'е').replace(/[.,!?;:«»"()]/g, ''); }

function initials_(s) { return norm_(s).split(/[\s\-/]+/).filter(Boolean).map(w => w[0]).join(''); }

function matchIn_(list, tok) {
  if (tok.length < 2) return '';
  for (const item of list) {
    if (tok.length >= 2 && tok === initials_(item) && tok.length === initials_(item).length && tok.length >= 2) return item;
  }
  if (tok.length < 3) return '';
  const head = tok.slice(0, 4);
  for (const item of list) {
    if (norm_(item).split(/[\s\-/,]+/).some(w => w.length >= 3 && w.startsWith(head))) return item;
  }
  return '';
}

function parseDateWord_(tok) {
  const tz = tz_();
  const shift = { 'сегодня': 0, 'вчера': -1, 'позавчера': -2, 'завтра': 1, 'послезавтра': 2 }[tok];
  if (shift !== undefined) {
    return Utilities.formatDate(new Date(Date.now() + shift * 86400000), tz, 'yyyy-MM-dd');
  }
  const m = tok.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?$/);
  if (m) {
    let y = m[3] ? +m[3] : +Utilities.formatDate(new Date(), tz, 'yyyy');
    if (y < 100) y += 2000;
    return y + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  }
  return '';
}

function today_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); }

// «10.000», «10 000», «10,5», «1.500,50», «10к» → число
function parseAmount_(raw, text) {
  let t = String(raw).replace(/\s/g, '').replace(/[.,]$/, '');
  if (/^\d{1,3}([.,]\d{3})+$/.test(t)) t = t.replace(/[.,]/g, '');           // 10.000 / 1,500,000
  else if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.'); // 1.500,50
  else t = t.replace(',', '.');
  let n = Number(t);
  if (/^[+\-−–]\s*[\d\s.,]+\s*(к|тыс)/i.test(text)) n *= 1000;                 // 10к, 5 тыс
  return n;
}

// Короткие слова → по какому слову искать категорию
const ALIASES = {
  'зп': 'зарплата', 'зарплата': 'зарплата', 'зарплату': 'зарплата', 'помощник': 'помощники',
  'мк': 'мастер', 'др': 'праздник', 'днюха': 'праздник', 'сертик': 'сертификат',
  'аренду': 'аренда', 'смальту': 'смальта', 'клей': 'клей', 'затирка': 'затирка', 'основа': 'основы',
  'налог': 'налоги', 'усн': 'налоги', 'интернет': 'интернет', 'связь': 'связь', 'реклама': 'реклама', 'таргет': 'реклама'
};

// Разбирает одну строку «±сумма слова…» → операция (cat может быть пустой) или текст ошибки
function parseOp_(text, cats) {
  const m = text.match(/^([+\-−–])\s*(\d[\d\s.,]*)\s*(?:₽|р\.?|руб\.?|к|тыс\.?)?(?=\s|$)\s*(.*)$/i);
  if (!m) return { error: 'не разобрала сумму' };
  const type = m[1] === '+' ? 'Доход' : 'Расход';
  const amount = parseAmount_(m[2], text);
  if (!(amount > 0)) return { error: 'не разобрала сумму' };
  const catList = type === 'Доход' ? cats.income : cats.expense;
  let cat = '', method = '', date = today_();
  const rest = [];
  m[3].split(/\s+/).filter(Boolean).forEach(raw => {
    const tok = norm_(raw);
    const d = parseDateWord_(raw.toLowerCase().replace(/ё/g, 'е').replace(/[,!?;:)]+$/, ''));
    if (d) { date = d; return; }
    if (!method) { const x = matchIn_(cats.methods, tok) || (/^(рс|р\/с|безнал|счет)/.test(raw.toLowerCase().replace(/ё/g, 'е')) ? cats.methods.find(v => /сч[её]т/i.test(v)) || '' : ''); if (x) { method = x; return; } }
    if (!cat) { const x = matchIn_(catList, ALIASES[tok] || tok); if (x) { cat = x; return; } }
    rest.push(raw);
  });
  return { type: type, amount: amount, cat: cat, method: method, date: date, comment: rest.join(' ').replace(/^[,\s—-]+/, '') };
}

// Спросить категорию кнопками. У каждой операции свой ключ — можно ждать ответа сразу по нескольким
function askCategory_(chat, op, cats) {
  const pid = Utilities.getUuid().slice(0, 6);
  CacheService.getScriptCache().put('pend_' + pid, JSON.stringify(op), 21600);
  const catList = op.type === 'Доход' ? cats.income : cats.expense;
  const rows = [];
  catList.forEach((c, i) => {
    if (i % 2 === 0) rows.push([]);
    rows[rows.length - 1].push({ text: c, callback_data: 'cat:' + pid + ':' + i });
  });
  rows.push([{ text: '✖ Не записывать', callback_data: 'cat:' + pid + ':x' }]);
  send_(chat, (op.type === 'Доход' ? '＋ ' : '− ') + money_(op.amount) +
    (op.comment ? ' (' + esc_(op.comment) + ')' : '') + ' — а куда это записать? 🐣', { inline_keyboard: rows });
}

function addOp_(chat, text) {
  const cats = readCats_();
  const op = parseOp_(text, cats);
  if (op.error) return send_(chat, 'Не разобрала сумму 🙈 Пример: <code>-10000 зп Света</code>');
  if (!op.cat) return askCategory_(chat, op, cats);
  saveOp_(chat, op);
}

// Несколько строк в одном сообщении: каждая строка — своя операция или дело
function addBatch_(chat, lines) {
  const cats = readCats_();
  const saved = [], ask = [], tasks = [], bad = [];
  lines.forEach(line => {
    if (/^(дело|задача|сделать)[\s:,-]/i.test(line)) { const t = taskFrom_(line); if (t) { apiTaskSave(PIN, t); tasks.push(t); } return; }
    if (!/^[+\-−–]\s*\d/.test(line)) { bad.push(line); return; }
    const op = parseOp_(line, cats);
    if (op.error) { bad.push(line); return; }
    if (!op.cat) { ask.push(op); return; }
    op.id = apiSave(PIN, op);
    saved.push(op);
  });

  let txt = '';
  if (saved.length) {
    const t = totals_(saved);
    txt += '✅ <b>Записала ' + saved.length + '</b>\n' + saved.map(o =>
      (o.type === 'Доход' ? '＋ ' : '− ') + money_(o.amount) + ' · ' + esc_(o.cat) +
      (o.method ? ' · ' + o.method : '') + (o.date !== today_() ? ' · ' + dmy_(o.date) : '') +
      (o.comment ? ' — ' + esc_(o.comment) : '')).join('\n') +
      '\n\nДоходы ' + money_(t.inc) + ' · расходы ' + money_(t.exp) + '\n<i>' + say_(t.profit >= 0 ? 'inc' : 'exp') + '</i>\n';
  }
  if (tasks.length) txt += (txt ? '\n' : '') + '📝 <b>Запомнила дела</b>\n' +
    tasks.map(t => '• ' + esc_(t.text) + (t.due ? ' — ' + dueWord_(t.due) : '')).join('\n') + '\n';
  if (bad.length) txt += (txt ? '\n' : '') + '🙈 Не поняла:\n' + bad.map(l => '• ' + esc_(l)).join('\n') +
    '\n<i>Строка должна начинаться с + или − и суммы, или со слова «дело»</i>\n';
  if (ask.length) txt += (txt ? '\n' : '') + 'Ещё ' + ask.length + ' — спрошу категорию ниже 👇';

  let kb = null;
  if (saved.length) {
    const key = Utilities.getUuid().slice(0, 8);
    CacheService.getScriptCache().put('batch_' + key, saved.map(o => o.id).join(','), 21600);
    kb = { inline_keyboard: [[{ text: '↩ Отменить все (' + saved.length + ')', callback_data: 'undoall:' + key }]] };
  }
  if (txt) send_(chat, txt.trim(), kb || KB);
  ask.forEach(op => askCategory_(chat, op, cats));
}

function saveOp_(chat, op, editMsgId) {
  const savedId = apiSave(PIN, op);
  const sign = op.type === 'Доход' ? '＋' : '−';
  const line = '✅ ' + sign + ' ' + money_(op.amount) + ' · ' + op.cat +
    (op.method ? ' · ' + op.method : '') +
    (op.date !== today_() ? ' · ' + dmy_(op.date) : '') +
    (op.comment ? '\n💬 ' + esc_(op.comment) : '') +
    '\n<i>' + say_(op.type === 'Доход' ? 'inc' : 'exp') + '</i>';
  const kb = { inline_keyboard: [[{ text: '↩ Отменить', callback_data: 'undo:' + savedId }]] };
  if (editMsgId) edit_(chat, editMsgId, line, kb); else send_(chat, line, kb);
}

/* ---------------- Задачи ---------------- */

function taskFrom_(text) {
  const words = text.replace(/^(дело|задача|сделать)[\s:,-]+/i, '').split(/\s+/).filter(Boolean);
  let due = '';
  // срок ищем в конце фразы: «… завтра», «… до 25.11»
  for (let k = 0; k < 2 && words.length; k++) {
    const last = words[words.length - 1].toLowerCase().replace(/[,!?;:)]+$/, '');
    const d = parseDateWord_(last);
    if (d && !due) { due = d; words.pop(); continue; }
    if (due && /^(до|к|на)$/.test(last)) { words.pop(); }
    break;
  }
  const t = words.join(' ').trim();
  return t ? { text: t, due: due } : null;
}

function addTask_(chat, text) {
  const t = taskFrom_(text);
  if (!t) return send_(chat, 'А что сделать? 🐣 Например: <code>дело заказать клей завтра</code>');
  apiTaskSave(PIN, t);
  send_(chat, '📝 Запомнила: ' + esc_(t.text) + (t.due ? ' — <b>' + dueWord_(t.due) + '</b>' : '') + '\n<i>напомню, не забуду 🪶</i>', KB);
}

function sendTasks_(chat, editMsgId) {
  const open = readTasks_().filter(t => !t.done)
    .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.created - b.created);
  if (!open.length) {
    const txt = '✨ Все дела сделаны — можно и полетать 🐣';
    return editMsgId ? edit_(chat, editMsgId, txt) : send_(chat, txt, KB);
  }
  const list = open.slice(0, 20);
  let txt = '<b>✅ Дела</b>\n\n';
  list.forEach((t, i) => {
    const n = t.due ? daysFrom_(t.due) : null;
    const mark = n === null ? '' : n < 0 ? ' 🔴 ' + dueWord_(t.due) : n === 0 ? ' 🟡 сегодня' : ' · ' + dueWord_(t.due);
    txt += (i + 1) + '. ' + esc_(t.text) + mark + '\n';
  });
  if (open.length > list.length) txt += '…и ещё ' + (open.length - list.length) + ' в приложении\n';
  txt += '\nСделали? Нажмите номер — вычеркну ✓';
  const rows = [];
  list.forEach((t, i) => {
    if (i % 5 === 0) rows.push([]);
    rows[rows.length - 1].push({ text: '✓ ' + (i + 1), callback_data: 'task:' + t.id });
  });
  const kb = { inline_keyboard: rows };
  editMsgId ? edit_(chat, editMsgId, txt, kb) : send_(chat, txt, kb);
}

/* ---------------- Платежи ---------------- */

function sendPays_(chat, editMsgId) {
  const list = readPays_().filter(p => p.status !== 'Оплачено')
    .sort((a, b) => a.date.localeCompare(b.date))
    .filter(p => daysFrom_(p.date) <= 14);
  if (!list.length) {
    const txt = '📅 Ближайшие 2 недели платить ничего не нужно — красота 🐣';
    return editMsgId ? edit_(chat, editMsgId, txt) : send_(chat, txt, KB);
  }
  let txt = '<b>📅 Платежи на 2 недели</b>\n\n';
  const rows = [];
  list.forEach(p => {
    const n = daysFrom_(p.date);
    const icon = n < 0 ? '🔴' : n <= 3 ? '🟡' : '⚪️';
    const inc = p.type === 'Доход';
    txt += icon + ' <b>' + dueWord_(p.date) + '</b> — ' + esc_(p.name) + ' — ' +
      (p.amount ? (inc ? '+' : '') + money_(p.amount) : 'сумма не указана') +
      (n < 0 ? ' <i>(просрочен)</i>' : '') + '\n';
    if (p.amount && rows.length < 10) {
      rows.push([{ text: (inc ? '✓ Получено: ' : '✓ Оплачено: ') + p.name.slice(0, 22) + ' · ' + money_(p.amount), callback_data: 'pay:' + p.id }]);
    }
  });
  txt += '\nКнопка записывает полную сумму сегодняшним числом. Другая сумма или дата — в приложении.';
  editMsgId ? edit_(chat, editMsgId, txt, { inline_keyboard: rows }) : send_(chat, txt, { inline_keyboard: rows });
}

/* ---------------- Кнопки под сообщениями ---------------- */

function onCallback_(q) {
  const chat = q.message.chat.id, msg = q.message.message_id;
  if (!allowed_(q.from.id)) return answer_(q.id, 'Нет доступа');
  const [kind, val] = String(q.data).split(':');
  try {
    if (kind === 'cat') {
      const parts = String(q.data).split(':');          // cat:<pid>:<номер|x>
      const pid = parts[1], pick = parts[2];
      const cache = CacheService.getScriptCache();
      const raw = cache.get('pend_' + pid);
      if (!raw) { answer_(q.id, 'Устарело'); return edit_(chat, msg, '⌛ Кнопки устарели — отправьте запись ещё раз'); }
      if (pick === 'x') { cache.remove('pend_' + pid); answer_(q.id, 'Не записываю'); return edit_(chat, msg, '✖ Не записано'); }
      const op = JSON.parse(raw);
      const cats = readCats_();
      op.cat = (op.type === 'Доход' ? cats.income : cats.expense)[+pick];
      cache.remove('pend_' + pid);
      answer_(q.id, 'Записываю…');
      return saveOp_(chat, op, msg);
    }
    if (kind === 'undoall') {
      const ids = (CacheService.getScriptCache().get('batch_' + val) || '').split(',').filter(Boolean);
      if (!ids.length) { answer_(q.id, 'Уже нельзя отменить — удалите в приложении'); return; }
      ids.forEach(id => apiDelete(PIN, id));
      CacheService.getScriptCache().remove('batch_' + val);
      answer_(q.id, 'Отменено');
      return edit_(chat, msg, '↩ Отменила ' + ids.length + ' ' + (ids.length < 5 ? 'записи' : 'записей') + ', будто и не было 🪶');
    }
    if (kind === 'undo') {
      apiDelete(PIN, val);
      answer_(q.id, 'Удалено');
      return edit_(chat, msg, '<s>' + esc_(q.message.text.split('\n')[0].replace(/^✅\s*/, '')) + '</s>\n↩ Отменила, будто и не было 🪶');
    }
    if (kind === 'task') {
      const t = readTasks_().find(x => x.id === val);
      apiTaskToggle(PIN, val, true);
      answer_(q.id, t ? '✓ ' + t.text.slice(0, 40) : 'Готово');
      return sendTasks_(chat, msg);
    }
    if (kind === 'pay') {
      const p = readPays_().find(x => x.id === val);
      if (!p || p.status === 'Оплачено') { answer_(q.id, 'Уже отмечено'); return sendPays_(chat, msg); }
      apiPayDone(PIN, val, { amount: p.amount, date: today_(), method: p.method });
      answer_(q.id, 'Записано в журнал');
      send_(chat, '✅ ' + (p.type === 'Доход' ? 'Получено' : 'Оплачено') + ': ' + esc_(p.name) + ' · ' + money_(p.amount) +
        '\nЗаписала в журнал 🧩' +
        (p.repeat !== 'Разово' ? '\n↻ В следующий раз напомню к ' + dmy_(nextDate_(p.date, p.repeat)) : ''));
      return sendPays_(chat, msg);
    }
    if (kind === 'open') { answer_(q.id, ''); return sendPays_(chat); }
    answer_(q.id, '');
  } catch (err) {
    answer_(q.id, 'Ошибка: ' + (err.message || err));
  }
}

/* ---------------- Отчёты ---------------- */

function totals_(ops) {
  const inc = ops.filter(o => o.type === 'Доход').reduce((s, o) => s + o.amount, 0);
  const exp = ops.filter(o => o.type === 'Расход').reduce((s, o) => s + o.amount, 0);
  return { inc: inc, exp: exp, profit: inc - exp };
}

function reportToday_() {
  const d = today_();
  const ops = readOps_().filter(o => o.date === d).sort((a, b) => a.added - b.added);
  if (!ops.length) return '📊 <b>Сегодня</b>\n\nПока ни одного осколочка 🐣 Записывайте — я посчитаю.';
  const t = totals_(ops);
  let txt = '📊 <b>Сегодня, ' + dmy_(d) + '</b>\n\n';
  ops.forEach(o => {
    txt += (o.type === 'Доход' ? '🟢 +' : '🔴 −') + money_(o.amount) + ' ' + esc_(o.cat) +
      (o.method ? ' · ' + o.method : '') + (o.comment ? ' — ' + esc_(o.comment) : '') + '\n';
  });
  txt += '\nДоходы: <b>' + money_(t.inc) + '</b>\nРасходы: <b>' + money_(t.exp) + '</b>\nИтог дня: <b>' + signed_(t.profit) + '</b>';
  return txt;
}

function reportMonth_() {
  const ym = today_().slice(0, 7);
  const ops = readOps_().filter(o => o.date.slice(0, 7) === ym);
  const t = totals_(ops);
  const MON = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  let txt = '📈 <b>' + MON[+ym.slice(5) - 1] + ' ' + ym.slice(0, 4) + '</b>\n\n' +
    '🟢 Доходы: <b>' + money_(t.inc) + '</b>\n🔴 Расходы: <b>' + money_(t.exp) + '</b>\n' +
    '💰 Прибыль: <b>' + signed_(t.profit) + '</b>\n';
  const top = (type) => {
    const by = {};
    ops.filter(o => o.type === type).forEach(o => by[o.cat] = (by[o.cat] || 0) + o.amount);
    return Object.keys(by).sort((a, b) => by[b] - by[a]).slice(0, 6).map(c => '  • ' + esc_(c) + ' — ' + money_(by[c])).join('\n');
  };
  if (t.inc) txt += '\n<b>Доходы по категориям</b>\n' + top('Доход') + '\n';
  if (t.exp) txt += '\n<b>Расходы по категориям</b>\n' + top('Расход') + '\n';
  const out = readPays_().filter(p => p.status !== 'Оплачено' && p.type === 'Расход' && p.date.slice(0, 7) <= ym)
    .reduce((s, p) => s + p.amount, 0);
  if (out) txt += '\n📅 Ещё оплатить в этом месяце: <b>' + money_(out) + '</b>\n';
  txt += goalBar_(t.inc);
  if (t.inc || t.exp) txt += '\n\n<i>' + say_(t.profit >= 0 ? 'plus' : 'minus') + '</i>';
  return txt;
}

/* ---------------- Утренняя сводка ---------------- */

function botMorning() {
  if (!BOT_TOKEN || !ALLOWED_IDS.length) return;
  const y = Utilities.formatDate(new Date(Date.now() - 86400000), tz_(), 'yyyy-MM-dd');
  const t = totals_(readOps_().filter(o => o.date === y));
  const pays = readPays_().filter(p => p.status !== 'Оплачено' && daysFrom_(p.date) <= 3)
    .sort((a, b) => a.date.localeCompare(b.date));
  const tasks = readTasks_().filter(x => !x.done && x.due && daysFrom_(x.due) <= 0);

  let txt = '<b>' + say_('morning') + '</b>\n';
  if (t.inc || t.exp) txt += '\nВчера: +' + money_(t.inc) + ' / −' + money_(t.exp) + ' → <b>' + signed_(t.profit) + '</b>\n';
  if (pays.length) {
    txt += '\n📅 <b>Платежи</b>\n' + pays.map(p => (daysFrom_(p.date) < 0 ? '🔴 ' : '🟡 ') + dueWord_(p.date) + ' — ' +
      esc_(p.name) + (p.amount ? ' · ' + money_(p.amount) : '')).join('\n') + '\n';
  }
  if (tasks.length) {
    txt += '\n✅ <b>Дела на сегодня</b>\n' + tasks.map(x => (daysFrom_(x.due) < 0 ? '🔴 ' : '• ') + esc_(x.text)).join('\n') + '\n';
  }
  if (!pays.length && !tasks.length && !t.inc && !t.exp) return; // нечего сообщать
  const ym = today_().slice(0, 7);
  txt += goalBar_(totals_(readOps_().filter(o => o.date.slice(0, 7) === ym)).inc);
  txt += '\n\n<i>Хорошего дня! Всё сложится 💗</i>';
  ALLOWED_IDS.forEach(id => send_(id, txt, pays.length ? { inline_keyboard: [[{ text: '📅 Открыть платежи', callback_data: 'open:pays' }]] } : KB));
}

/* ---------------- Установка ---------------- */

function setupBot() {
  if (!BOT_TOKEN) throw new Error('Впишите BOT_TOKEN в начале файла Bot.gs');
  const url = WEBAPP_URL || ScriptApp.getService().getUrl();
  if (!url || !/\/exec$/.test(url)) throw new Error('Впишите в WEBAPP_URL ссылку веб-приложения, которая заканчивается на /exec');
  const hook = PROXY_URL || url;
  const r = tg_('setWebhook', { url: hook, drop_pending_updates: true, allowed_updates: ['message', 'callback_query'] });
  tg_('setMyCommands', { commands: [
    { command: 'today', description: 'Итоги дня' },
    { command: 'month', description: 'Итоги месяца' },
    { command: 'pays', description: 'Платежи' },
    { command: 'tasks', description: 'Дела' },
    { command: 'help', description: 'Как пользоваться' }
  ] });
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'botMorning').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('botMorning').timeBased().everyDays(1).atHour(MORNING_HOUR).inTimezone('Asia/Novosibirsk').create();
  tg_('setMyName', { name: BOT_NAME });
  tg_('setMyShortDescription', { short_description: BOT_ABOUT });
  tg_('setMyDescription', { description: BOT_DESCRIPTION });
  console.log('Webhook: ' + r);
}

/* ---------------- Telegram и форматирование ---------------- */

function tg_(method, payload) {
  const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/' + method, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  const txt = res.getContentText();
  if (res.getResponseCode() !== 200) console.error('Telegram ' + method + ': ' + txt);
  return txt;
}

// Ошибку — простым текстом (без HTML), чтобы Telegram точно её принял
function reportError_(chat, err) {
  const text = '⚠️ Феня споткнулась: ' + (err && err.message ? err.message : err) +
    (err && err.stack ? '\n' + String(err.stack).split('\n').slice(0, 3).join('\n') : '');
  const to = chat ? [chat] : ALLOWED_IDS.slice(0, 1);
  to.forEach(id => tg_('sendMessage', { chat_id: id, text: text.slice(0, 3500) }));
}

function send_(chat, text, markup) {
  const p = { chat_id: chat, text: text, parse_mode: 'HTML', disable_web_page_preview: true };
  if (markup) p.reply_markup = markup;
  const r = tg_('sendMessage', p);
  if (r.indexOf('"ok":true') < 0) {           // не прошло — шлём без оформления и сообщаем причину
    delete p.parse_mode;
    p.text = text.replace(/<[^>]+>/g, '');
    const r2 = tg_('sendMessage', p);
    if (r2.indexOf('"ok":true') < 0) tg_('sendMessage', { chat_id: chat, text: '⚠️ Telegram не принял ответ: ' + r2.slice(0, 300) });
  }
  return r;
}

function edit_(chat, msgId, text, markup) {
  const p = { chat_id: chat, message_id: msgId, text: text, parse_mode: 'HTML', disable_web_page_preview: true };
  if (markup) p.reply_markup = markup;
  return tg_('editMessageText', p);
}

function answer_(id, text) { tg_('answerCallbackQuery', { callback_query_id: id, text: text || '' }); }

function esc_(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function money_(n) {
  const neg = n < 0; n = Math.abs(Math.round(n * 100) / 100);
  const [i, f] = String(n).split('.');
  return (neg ? '−' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (f ? ',' + (f + '0').slice(0, 2) : '') + ' ₽';
}

function signed_(n) { return (n > 0 ? '+' : '') + money_(n); }

function dmy_(ds) { return ds.slice(8, 10) + '.' + ds.slice(5, 7); }

function daysFrom_(ds) {
  const a = Date.UTC(+ds.slice(0, 4), +ds.slice(5, 7) - 1, +ds.slice(8, 10));
  const t = today_();
  const b = Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10));
  return Math.round((a - b) / 86400000);
}

function dueWord_(ds) {
  const n = daysFrom_(ds);
  if (n === 0) return 'сегодня';
  if (n === 1) return 'завтра';
  if (n === -1) return 'вчера';
  return dmy_(ds);
}

// Проверка: куда Telegram шлёт сообщения и были ли ошибки. Запустить и посмотреть журнал выполнения.
function checkBot() {
  const info = JSON.parse(tg_('getWebhookInfo', {})).result || {};
  console.log('Адрес: ' + (info.url || '— не задан'));
  console.log('Ждут доставки: ' + (info.pending_update_count || 0));
  console.log(info.last_error_message
    ? 'Последняя ошибка: ' + info.last_error_message + ' (' + new Date(info.last_error_date * 1000) + ')'
    : 'Ошибок доставки нет');
  const want = PROXY_URL || WEBAPP_URL;
  console.log(info.url === want ? '✅ Адрес правильный' + (PROXY_URL ? ' (через посредника)' : '') : '⚠️ Адрес не тот — запустите setupBot');
}
