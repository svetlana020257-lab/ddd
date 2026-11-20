/**
 * Art Mosaic — учёт доходов и расходов мастерской
 * Google Таблица + веб-приложение (телефон и компьютер)
 *
 * Установка:
 * 1. Таблица → Расширения → Apps Script → вставить этот код в Code.gs,
 *    создать HTML-файл Index и вставить в него Index.html.
 * 2. Запустить функцию setup (один раз) — она создаст и оформит листы.
 * 3. Начать развертывание → Новое развертывание → Веб-приложение:
 *    Запуск от имени: «Я», Доступ: «Все». Ссылку отдать Галине.
 */

// ПИН для входа в приложение, например '1234'. Пусто — вход без ПИНа.
const PIN = '';

const SH = { OPS: 'Операции', CAT: 'Категории', SUM: 'Сводка', DASH: 'Дашборд', PAY: 'Платежи', TASK: 'Дела' };
const COLS = ['Дата', 'Тип', 'Категория', 'Сумма', 'Способ оплаты', 'Комментарий', 'Добавлено', 'ID'];

const DEFAULT_INCOME = [
  'Мастер-класс', 'Детский праздник', 'Сертификат', 'Абонемент',
  'Корпоратив', 'Продажа изделий', 'Прочий доход'
];
const DEFAULT_EXPENSE = [
  'Аренда', 'Стекло и смальта', 'Клей, затирка, основы', 'Инструменты',
  'Реклама', 'Связь и интернет', 'Налоги', 'Помощники / зарплата',
  'Упаковка и сувениры', 'Хозрасходы', 'Прочий расход'
];
const DEFAULT_METHODS = ['Наличные', 'Карта', 'Перевод', 'Расчётный счёт'];
const PAY_COLS = ['Дата платежа', 'Название', 'Тип', 'Категория', 'Сумма', 'Повтор', 'Способ оплаты', 'Комментарий', 'Статус', 'Оплачено', 'ID'];
const TASK_COLS = ['Готово', 'Задача', 'Срок', 'Создано', 'Выполнено', 'ID'];
const REPEATS = ['Разово', 'Ежемесячно', 'Еженедельно', 'Ежеквартально', 'Ежегодно'];

const C = {
  ink: '#2B2440', inc: '#1F9D6B', incBg: '#E6F6EE', exp: '#D9485F', expBg: '#FCE9EC',
  pink: '#E86A92', violet: '#7B5EA7', band: '#F8F5FB', line: '#E4DEEC'
};

/* ---------------- Веб-приложение ---------------- */

function doGet() {
  // Ищем HTML-файл приложения под любым из привычных имён
  const names = ['Index', 'index', 'Index.html', 'index.html', 'INDEX'];
  let page = null;
  for (const n of names) {
    try { page = HtmlService.createHtmlOutputFromFile(n); break; } catch (e) {}
  }
  if (!page) {
    return HtmlService.createHtmlOutput(
      '<div style="font-family:sans-serif;max-width:480px;margin:40px auto;padding:20px;line-height:1.5">' +
      '<h2>🐣 Не нашла страницу приложения</h2>' +
      '<p>В проекте Apps Script нет HTML-файла <b>Index</b>.</p>' +
      '<p>Нажмите «+» → <b>HTML</b>, назовите файл <b>Index</b>, вставьте в него код из Index.html, ' +
      'затем «Управление развертываниями» → «Новая версия».</p></div>'
    ).setTitle('Art Mosaic · касса');
  }
  return page
    .setTitle('Art Mosaic · касса')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Мастерская')
    .addItem('Открыть приложение', 'showAppLink')
    .addItem('Настроить / обновить оформление', 'setup')
    .addToUi();
}

function showAppLink() {
  const url = ScriptApp.getService().getUrl();
  const html = url
    ? '<p style="font-family:sans-serif">Ссылка на приложение:</p><p><a href="' + url + '" target="_blank" style="font-family:sans-serif;word-break:break-all">' + url + '</a></p>'
    : '<p style="font-family:sans-serif">Приложение ещё не развернуто: Начать развертывание → Новое развертывание → Веб-приложение.</p>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(420).setHeight(140), 'Мастерская');
}

/* ---------------- API для приложения ---------------- */
// Каждый вызов возвращает полное состояние: операции, платежи, дела, категории.

function apiInit(pin) {
  auth_(pin);
  return state_();
}

// Операции
function apiSave(pin, op) {
  auth_(pin);
  return withLock_(() => writeOp_(validate_(op)));
}

function apiDelete(pin, id) {
  auth_(pin);
  return withLock_(() => {
    const row = findRowIn_(SH.OPS, 8, id);
    if (row) sheet_(SH.OPS).deleteRow(row);
  });
}

// Календарь платежей
function apiPaySave(pin, p) {
  auth_(pin);
  return withLock_(() => {
    const name = String(p.name || '').trim();
    if (!name) throw new Error('Укажите название платежа');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date || '')) throw new Error('Укажите дату платежа');
    const amount = Number(String(p.amount || 0).replace(/\s/g, '').replace(',', '.')) || 0;
    const type = p.type === 'Доход' ? 'Доход' : 'Расход';
    const repeat = REPEATS.indexOf(p.repeat) >= 0 ? p.repeat : 'Разово';
    const vals = [toDate_(p.date), name, type, String(p.cat || ''), amount, repeat,
      String(p.method || ''), String(p.comment || '').trim()];
    const sh = sheet_(SH.PAY);
    if (p.id) {
      const row = findRowIn_(SH.PAY, 11, p.id);
      if (!row) throw new Error('Платёж не найден — возможно, его удалили в таблице');
      sh.getRange(row, 1, 1, 8).setValues([vals]);
    } else {
      sh.appendRow(vals.concat(['Ожидает', '', newId_()]));
    }
  });
}

// Отметить платёж: создаёт операцию в журнале и переносит повторяющийся платёж на следующий срок
function apiPayDone(pin, id, d) {
  auth_(pin);
  return withLock_(() => {
    const row = findRowIn_(SH.PAY, 11, id);
    if (!row) throw new Error('Платёж не найден');
    const p = readPays_().find(x => x.id === String(id));
    const cats = readCats_();
    const fallback = p.type === 'Доход' ? 'Прочий доход' : 'Прочий расход';
    writeOp_(validate_({
      type: p.type,
      cat: p.cat || (p.type === 'Доход' ? cats.income : cats.expense).slice(-1)[0] || fallback,
      amount: d.amount, date: d.date,
      method: d.method || p.method,
      comment: p.name + (p.comment ? ' · ' + p.comment : '')
    }));
    const sh = sheet_(SH.PAY);
    if (p.repeat === 'Разово') {
      sh.getRange(row, 9, 1, 2).setValues([['Оплачено', toDate_(d.date)]]);
    } else {
      sh.getRange(row, 1).setValue(toDate_(nextDate_(p.date, p.repeat)));
      sh.getRange(row, 10).setValue(toDate_(d.date));
    }
  });
}

function apiPayDelete(pin, id) {
  auth_(pin);
  return withLock_(() => {
    const row = findRowIn_(SH.PAY, 11, id);
    if (row) sheet_(SH.PAY).deleteRow(row);
  });
}

// Список дел
function apiTaskSave(pin, t) {
  auth_(pin);
  return withLock_(() => {
    const text = String(t.text || '').trim();
    if (!text) throw new Error('Напишите, что нужно сделать');
    const due = /^\d{4}-\d{2}-\d{2}$/.test(t.due || '') ? toDate_(t.due) : '';
    const sh = sheet_(SH.TASK);
    if (t.id) {
      const row = findRowIn_(SH.TASK, 6, t.id);
      if (!row) throw new Error('Задача не найдена');
      sh.getRange(row, 2, 1, 2).setValues([[text, due]]);
    } else {
      // в листе заранее стоят чекбоксы, поэтому пишем в первую строку после последней задачи
      const last = sh.getLastRow();
      const texts = last > 1 ? sh.getRange(2, 2, last - 1, 1).getValues() : [];
      let row = 2;
      for (let i = texts.length - 1; i >= 0; i--) if (String(texts[i][0]).trim()) { row = i + 3; break; }
      if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 50);
      sh.getRange(row, 1, 1, 6).setValues([[false, text, due, new Date(), '', newId_()]]);
      sh.getRange(row, 1).insertCheckboxes();
    }
  });
}

function apiTaskToggle(pin, id, done) {
  auth_(pin);
  return withLock_(() => {
    const row = findRowIn_(SH.TASK, 6, id);
    if (!row) throw new Error('Задача не найдена');
    sheet_(SH.TASK).getRange(row, 1).setValue(!!done);
    sheet_(SH.TASK).getRange(row, 5).setValue(done ? new Date() : '');
  });
}

function apiTaskDelete(pin, id) {
  auth_(pin);
  return withLock_(() => {
    const row = findRowIn_(SH.TASK, 6, id);
    if (row) sheet_(SH.TASK).deleteRow(row);
  });
}

/* ---------------- Состояние и запись ---------------- */

function state_() {
  const ss = SpreadsheetApp.getActive();
  if (!ss.getSheetByName(SH.PAY)) setupPays_(ss);
  if (!ss.getSheetByName(SH.TASK)) setupTasks_(ss);
  return { cats: readCats_(), ops: readOps_(), pays: readPays_(), tasks: readTasks_(), url: ss.getUrl() };
}

// В режиме бота не перечитываем всю таблицу после записи — так ответ приходит быстрее
let BOT_MODE_ = false;

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const res = fn();
    SpreadsheetApp.flush();
    return BOT_MODE_ ? res : state_();
  } finally {
    lock.releaseLock();
  }
}

function writeOp_(clean) {
  const sh = sheet_(SH.OPS);
  const date = toDate_(clean.date);
  if (clean.id) {
    const row = findRowIn_(SH.OPS, 8, clean.id);
    if (!row) throw new Error('Запись не найдена — возможно, её удалили в таблице');
    sh.getRange(row, 1, 1, 6).setValues([[date, clean.type, clean.cat, clean.amount, clean.method, clean.comment]]);
    return clean.id;
  }
  const id = newId_();
  sh.appendRow([date, clean.type, clean.cat, clean.amount, clean.method, clean.comment, new Date(), id]);
  return id;
}

function newId_() { return Utilities.getUuid().slice(0, 8); }

function tz_() { return SpreadsheetApp.getActive().getSpreadsheetTimeZone(); }

function toDate_(ds) { return Utilities.parseDate(ds, tz_(), 'yyyy-MM-dd'); }

function nextDate_(ds, repeat) {
  const [y, m, d] = ds.split('-').map(Number);
  if (repeat === 'Еженедельно') {
    const t = new Date(Date.UTC(y, m - 1, d + 7));
    return t.toISOString().slice(0, 10);
  }
  const add = repeat === 'Ежеквартально' ? 3 : repeat === 'Ежегодно' ? 12 : 1;
  const last = new Date(Date.UTC(y, m - 1 + add + 1, 0)).getUTCDate(); // последний день нужного месяца
  const t = new Date(Date.UTC(y, m - 1 + add, Math.min(d, last)));
  return t.toISOString().slice(0, 10);
}

function findRowIn_(name, idCol, id) {
  const sh = sheet_(name);
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const ids = sh.getRange(2, idCol, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return 0;
}

function readPays_() {
  const sh = sheet_(SH.PAY), tz = tz_(), last = sh.getLastRow();
  if (last < 2) return [];
  const out = [];
  sh.getRange(2, 1, last - 1, 11).getValues().forEach((r, i) => {
    const name = String(r[1] || '').trim();
    const date = toDateStr_(r[0], tz);
    if (!name || !date) return;
    let id = r[10];
    if (!id) { id = newId_(); sh.getRange(i + 2, 11).setValue(id); }
    out.push({
      id: String(id), date: date, name: name,
      type: /^дох/i.test(String(r[2]).trim()) ? 'Доход' : 'Расход',
      cat: String(r[3] || '').trim(), amount: Number(r[4]) || 0,
      repeat: REPEATS.indexOf(String(r[5]).trim()) >= 0 ? String(r[5]).trim() : 'Разово',
      method: String(r[6] || '').trim(), comment: String(r[7] || '').trim(),
      status: /оплач/i.test(String(r[8])) ? 'Оплачено' : 'Ожидает',
      paid: toDateStr_(r[9], tz)
    });
  });
  return out;
}

function readTasks_() {
  const sh = sheet_(SH.TASK), tz = tz_(), last = sh.getLastRow();
  if (last < 2) return [];
  const out = [];
  sh.getRange(2, 1, last - 1, 6).getValues().forEach((r, i) => {
    const text = String(r[1] || '').trim();
    if (!text) return;
    let id = r[5];
    if (!id) { id = newId_(); sh.getRange(i + 2, 6).setValue(id); }
    out.push({
      id: String(id), text: text, done: r[0] === true,
      due: toDateStr_(r[2], tz),
      created: r[3] instanceof Date ? r[3].getTime() : 0,
      doneAt: r[4] instanceof Date ? r[4].getTime() : 0
    });
  });
  return out;
}

/* ---------------- Внутренние функции ---------------- */

function auth_(pin) {
  if (PIN && String(pin || '') !== String(PIN)) throw new Error('PIN_REQUIRED');
}

function sheet_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('Нет листа «' + name + '». Запустите setup в Apps Script.');
  return sh;
}

function validate_(op) {
  const amount = Number(String(op.amount || '').replace(/\s/g, '').replace(',', '.'));
  if (!(amount > 0)) throw new Error('Сумма должна быть больше нуля');
  if (op.type !== 'Доход' && op.type !== 'Расход') throw new Error('Не выбран тип операции');
  if (!op.cat) throw new Error('Не выбрана категория');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(op.date || '')) throw new Error('Неверная дата');
  return {
    id: op.id ? String(op.id) : '',
    type: op.type,
    cat: String(op.cat).trim(),
    amount: Math.round(amount * 100) / 100,
    method: String(op.method || '').trim(),
    comment: String(op.comment || '').trim(),
    date: op.date
  };
}

function readCats_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SH.CAT);
  if (!sh) { setupCats_(ss); sh = ss.getSheetByName(SH.CAT); }
  const read = () => {
    const last = Math.max(sh.getLastRow(), 2);
    const v = sh.getRange(2, 1, last - 1, 3).getValues();
    const col = i => v.map(r => String(r[i]).trim()).filter(Boolean);
    return { income: col(0), expense: col(1), methods: col(2) };
  };
  let c = read();
  // Пустая колонка — заполняем стандартным списком, чтобы приложение и бот не остались без категорий
  const defs = [DEFAULT_INCOME, DEFAULT_EXPENSE, DEFAULT_METHODS];
  const keys = ['income', 'expense', 'methods'];
  let filled = false;
  keys.forEach((k, i) => {
    if (!c[k].length) {
      sh.getRange(2, i + 1, defs[i].length, 1).setValues(defs[i].map(x => [x]));
      filled = true;
    }
  });
  if (filled) { SpreadsheetApp.flush(); c = read(); }
  return c;
}

// Выпадающий список категорий в «Операциях» — из листа «Категории»
function refreshCatValidation_() {
  const ss = SpreadsheetApp.getActive();
  const ops = ss.getSheetByName(SH.OPS);
  if (!ops) return;
  const c = readCats_();
  const list = c.income.concat(c.expense).filter((x, i, a) => a.indexOf(x) === i);
  if (!list.length) return;
  ops.getRange(2, 3, ops.getMaxRows() - 1, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(true).build());
}

// Если Галина правит лист «Категории» — сразу обновляем выпадающий список в «Операциях»
function onEdit(e) {
  try {
    if (e && e.range && e.range.getSheet().getName() === SH.CAT) refreshCatValidation_();
  } catch (err) {}
}

function readOps_() {
  const ss = SpreadsheetApp.getActive();
  const sh = sheet_(SH.OPS);
  const tz = ss.getSpreadsheetTimeZone();
  const last = sh.getLastRow();
  if (last < 2) return [];
  const vals = sh.getRange(2, 1, last - 1, 8).getValues();
  const out = [];
  vals.forEach((r, i) => {
    const amount = Number(r[3]);
    if (r[3] === '' || isNaN(amount)) return;
    const date = toDateStr_(r[0], tz);
    if (!date) return;
    let id = r[7];
    if (!id) { // строка добавлена вручную в таблице — выдаём ей ID
      id = Utilities.getUuid().slice(0, 8);
      sh.getRange(i + 2, 8).setValue(id);
    }
    out.push({
      id: String(id),
      date: date,
      type: /^дох/i.test(String(r[1]).trim()) ? 'Доход' : 'Расход',
      cat: String(r[2] || '').trim() || 'Без категории',
      amount: amount,
      method: String(r[4] || '').trim(),
      comment: String(r[5] || '').trim(),
      added: r[6] instanceof Date ? r[6].getTime() : 0
    });
  });
  return out;
}

function toDateStr_(d, tz) {
  if (d instanceof Date && !isNaN(d)) return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  const m = String(d).trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return '';
}

/* ---------------- Создание и оформление таблицы ---------------- */

function setup() {
  const ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone('Asia/Novosibirsk');
  setupCats_(ss);
  setupOps_(ss);
  setupSummary_(ss);
  setupPays_(ss);
  setupTasks_(ss);
  setupDashboard_(ss);

  // удалить пустой стандартный лист
  ['Лист1', 'Sheet1'].forEach(n => {
    const s = ss.getSheetByName(n);
    if (s && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s);
  });
  ss.setActiveSheet(ss.getSheetByName(SH.DASH));
}

function header_(range, bg) {
  range.setBackground(bg || C.ink).setFontColor('#FFFFFF').setFontWeight('bold')
    .setFontSize(11).setHorizontalAlignment('center').setVerticalAlignment('middle');
}

function setupOps_(ss) {
  const sh = ss.getSheetByName(SH.OPS) || ss.insertSheet(SH.OPS, 0);
  ensureSize_(sh, 1000, COLS.length);
  sh.getRange(1, 1, 1, COLS.length).setValues([COLS]);
  header_(sh.getRange(1, 1, 1, COLS.length));
  sh.setRowHeight(1, 36);
  sh.setFrozenRows(1);
  [105, 95, 200, 115, 140, 340, 135, 90].forEach((w, i) => sh.setColumnWidth(i + 1, w));

  const n = sh.getMaxRows() - 1;
  sh.getRange(2, 1, n, COLS.length).setFontFamily('Arial').setFontSize(10).setVerticalAlignment('middle');
  sh.getRange(2, 1, n, 1).setNumberFormat('dd.MM.yyyy').setHorizontalAlignment('center');
  sh.getRange(2, 2, n, 1).setHorizontalAlignment('center').setFontWeight('bold');
  sh.getRange(2, 4, n, 1).setNumberFormat('#,##0" ₽"').setFontWeight('bold');
  sh.getRange(2, 5, n, 1).setHorizontalAlignment('center');
  sh.getRange(2, 6, n, 1).setWrap(true);
  sh.getRange(2, 7, n, 2).setFontColor('#9A93A8').setFontSize(9).setHorizontalAlignment('center');
  sh.getRange(2, 7, n, 1).setNumberFormat('dd.MM.yyyy HH:mm');

  sh.getBandings().forEach(b => b.remove());
  sh.getRange(2, 1, n, COLS.length).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false)
    .setFirstRowColor('#FFFFFF').setSecondRowColor(C.band);

  const typeRange = sh.getRange(2, 2, n, 1);
  const sumRange = sh.getRange(2, 4, n, 1);
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Доход')
      .setFontColor(C.inc).setBackground(C.incBg).setRanges([typeRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Расход')
      .setFontColor(C.exp).setBackground(C.expBg).setRanges([typeRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(f_('=$B2="Доход"'))
      .setFontColor(C.inc).setRanges([sumRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(f_('=$B2="Расход"'))
      .setFontColor(C.exp).setRanges([sumRange]).build()
  ]);

  const cat = ss.getSheetByName(SH.CAT);
  typeRange.setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['Доход', 'Расход'], true).setAllowInvalid(false).build());
  sh.getRange(2, 5, n, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(cat.getRange('C2:C30'), true).setAllowInvalid(true).build());

  if (!sh.isColumnHiddenByUser(8)) sh.hideColumns(8);
  refreshCatValidation_();
}

function setupCats_(ss) {
  const sh = ss.getSheetByName(SH.CAT) || ss.insertSheet(SH.CAT);
  ensureSize_(sh, 60, 5);
  sh.getRange('A1:C1').setValues([['Доходы', 'Расходы', 'Способы оплаты']]);
  header_(sh.getRange('A1'), C.inc);
  header_(sh.getRange('B1'), C.exp);
  header_(sh.getRange('C1'), C.ink);
  sh.setRowHeight(1, 36);
  sh.setFrozenRows(1);
  [230, 230, 190, 30, 380].forEach((w, i) => sh.setColumnWidth(i + 1, w));

  const fill = (col, list) => {
    if (sh.getRange(2, col, 59, 1).getValues().some(r => String(r[0]).trim())) return; // уже заполнено
    sh.getRange(2, col, list.length, 1).setValues(list.map(x => [x]));
  };
  fill(1, DEFAULT_INCOME);
  fill(2, DEFAULT_EXPENSE);
  fill(3, DEFAULT_METHODS);

  sh.getRange('A2:C60').setFontSize(11).setVerticalAlignment('middle')
    .setBorder(null, null, null, null, null, true, C.line, SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange('E1').setValue('Как пользоваться').setFontWeight('bold').setFontColor(C.ink).setFontSize(11);
  sh.getRange('E2:E4').setValues([
    ['Списки можно менять: добавлять, удалять, переименовывать.'],
    ['Приложение подхватит изменения при следующем открытии (или кнопкой ↻).'],
    ['Старые записи с переименованной категорией останутся под старым названием.']
  ]).setFontColor('#6B6480').setWrap(true).setVerticalAlignment('top');
}

function setupSummary_(ss) {
  const sh = ss.getSheetByName(SH.SUM) || ss.insertSheet(SH.SUM);
  sh.clear();
  sh.clearConditionalFormatRules();
  ensureSize_(sh, 60, 11);
  const ops = "'" + SH.OPS + "'!";
  const year = Number(Utilities.formatDate(new Date(), 'Asia/Novosibirsk', 'yyyy'));

  sh.getRange('A1:K1').merge().setValue('Сводка · Art Mosaic')
    .setFontSize(18).setFontWeight('bold').setFontColor(C.ink).setVerticalAlignment('middle');
  sh.setRowHeight(1, 44);
  sh.getRange('A3').setValue('Год').setFontWeight('bold').setHorizontalAlignment('right');
  sh.getRange('B3').setValue(year).setFontWeight('bold').setFontSize(13).setBackground('#FFF4D6')
    .setHorizontalAlignment('center').setNote('Поменяйте год — пересчитается вся сводка');
  sh.getRange('C3').setValue('← можно поменять').setFontColor('#9A93A8').setFontStyle('italic');

  sh.getRange('A5:E5').setValues([['Месяц', 'Доходы', 'Расходы', 'Прибыль', 'Маржа']]);
  header_(sh.getRange('A5:E5'));
  const months = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  const rows = months.map((m, i) => {
    const r = 6 + i, k = i + 1;
    const cond = ops + '$A:$A,">="&DATE($B$3,' + k + ',1),' + ops + '$A:$A,"<"&DATE($B$3,' + (k + 1) + ',1)';
    return [
      m,
      '=SUMIFS(' + ops + '$D:$D,' + ops + '$B:$B,"Доход",' + cond + ')',
      '=SUMIFS(' + ops + '$D:$D,' + ops + '$B:$B,"Расход",' + cond + ')',
      '=B' + r + '-C' + r,
      '=IF(B' + r + '=0,"",D' + r + '/B' + r + ')'
    ];
  });
  sh.getRange(6, 1, 12, 5).setValues(rows);
  sh.getRange('A18:E18').setValues([['Итого за год', '=SUM(B6:B17)', '=SUM(C6:C17)', '=B18-C18', '=IF(B18=0,"",D18/B18)']])
    .setFontWeight('bold').setBackground('#EFEAF5');
  sh.getRange('B6:D18').setNumberFormat('#,##0" ₽"');
  sh.getRange('E6:E18').setNumberFormat('0%').setHorizontalAlignment('center');
  sh.getRange('B6:C17').setFontColor('#3A3450');
  sh.getRange('A6:E17').setBorder(null, null, null, null, null, true, C.line, SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange('A6:A18').setFontWeight('bold');

  const q = (type) => '=IFERROR(QUERY(' + ops + 'A2:D,"select C, sum(D) where B=\'' + type +
    '\' and year(A)="&$B$3&" group by C order by sum(D) desc label C \'\', sum(D) \'\'",0),"нет данных")';
  sh.getRange('G5:H5').setValues([['Доходы по категориям', 'за год']]);
  header_(sh.getRange('G5:H5'), C.inc);
  sh.getRange('G6').setFormula(q('Доход'));
  sh.getRange('J5:K5').setValues([['Расходы по категориям', 'за год']]);
  header_(sh.getRange('J5:K5'), C.exp);
  sh.getRange('J6').setFormula(q('Расход'));
  sh.getRange('H6:H40').setNumberFormat('#,##0" ₽"').setFontColor(C.inc).setFontWeight('bold');
  sh.getRange('K6:K40').setNumberFormat('#,##0" ₽"').setFontColor(C.exp).setFontWeight('bold');

  sh.setRowHeight(5, 34);
  [130, 120, 120, 120, 80, 24, 210, 110, 24, 210, 110].forEach((w, i) => sh.setColumnWidth(i + 1, w));
  sh.getRange('A6:K40').setVerticalAlignment('middle').setFontSize(11);

  const profit = sh.getRange('D6:D18');
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(0).setFontColor(C.exp).setRanges([profit]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThan(0).setFontColor(C.inc).setRanges([profit]).build()
  ]);
  sh.setFrozenRows(5);
  sh.setHiddenGridlines(true);
  fixFormulas_(sh);
}

/* ---- Разделитель аргументов в формулах: «,» или «;» (зависит от языка таблицы) ---- */
let SEP_ = '';
function sep_() {
  if (SEP_) return SEP_;
  const ss = SpreadsheetApp.getActive();
  const tmp = ss.insertSheet('tmp_sep_' + Date.now());
  try {
    tmp.getRange('A1').setFormula('=SUM(1,2)');
    SpreadsheetApp.flush();
    SEP_ = tmp.getRange('A1').getValue() === 3 ? ',' : ';';
  } catch (e) {
    SEP_ = ';';
  } finally {
    ss.deleteSheet(tmp);
  }
  return SEP_;
}

// Меняет запятые-разделители на «;», не трогая текст в кавычках
function f_(formula) {
  if (sep_() === ',') return formula;
  let out = '', inStr = false;
  for (const ch of formula) {
    if (ch === '"') inStr = !inStr;
    out += (!inStr && ch === ',') ? ';' : ch;
  }
  return out;
}

// Перезаписывает все формулы листа с правильным разделителем
function fixFormulas_(sh) {
  const r = sh.getDataRange();
  const fs = r.getFormulas();
  fs.forEach((row, i) => row.forEach((fm, j) => {
    if (fm) sh.getRange(i + 1, j + 1).setFormula(f_(fm));
  }));
}

function ensureSize_(sh, rows, cols) {
  if (sh.getMaxRows() < rows) sh.insertRowsAfter(sh.getMaxRows(), rows - sh.getMaxRows());
  if (sh.getMaxColumns() < cols) sh.insertColumnsAfter(sh.getMaxColumns(), cols - sh.getMaxColumns());
}

function setupPays_(ss) {
  const sh = ss.getSheetByName(SH.PAY) || ss.insertSheet(SH.PAY);
  ensureSize_(sh, 300, PAY_COLS.length);
  sh.getRange(1, 1, 1, PAY_COLS.length).setValues([PAY_COLS]);
  header_(sh.getRange(1, 1, 1, PAY_COLS.length), C.violet);
  sh.setRowHeight(1, 36);
  sh.setFrozenRows(1);
  [115, 200, 85, 170, 110, 125, 130, 260, 100, 105, 80].forEach((w, i) => sh.setColumnWidth(i + 1, w));
  const n = sh.getMaxRows() - 1;
  sh.getRange(2, 1, n, PAY_COLS.length).setFontFamily('Arial').setFontSize(10).setVerticalAlignment('middle');
  sh.getRange(2, 1, n, 1).setNumberFormat('dd.MM.yyyy').setHorizontalAlignment('center').setFontWeight('bold');
  sh.getRange(2, 2, n, 1).setFontWeight('bold');
  sh.getRange(2, 3, n, 1).setHorizontalAlignment('center');
  sh.getRange(2, 5, n, 1).setNumberFormat('#,##0" ₽"').setFontWeight('bold');
  sh.getRange(2, 6, n, 1).setHorizontalAlignment('center');
  sh.getRange(2, 9, n, 1).setHorizontalAlignment('center');
  sh.getRange(2, 10, n, 1).setNumberFormat('dd.MM.yyyy').setHorizontalAlignment('center').setFontColor('#9A93A8');
  sh.getRange(2, 11, n, 1).setFontColor('#9A93A8').setFontSize(9);

  sh.getBandings().forEach(b => b.remove());
  sh.getRange(2, 1, n, PAY_COLS.length).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false)
    .setFirstRowColor('#FFFFFF').setSecondRowColor(C.band);

  const all = sh.getRange(2, 1, n, 10);
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(f_('=$I2="Оплачено"'))
      .setFontColor('#B4AEC0').setStrikethrough(true).setRanges([all]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(f_('=AND($I2<>"Оплачено",$A2<>"",$A2<TODAY())'))
      .setBackground(C.expBg).setFontColor(C.exp).setRanges([sh.getRange(2, 1, n, 2)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(f_('=AND($I2<>"Оплачено",$A2<>"",$A2-TODAY()<=3)'))
      .setBackground('#FFF4D6').setRanges([sh.getRange(2, 1, n, 2)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(f_('=$C2="Доход"'))
      .setFontColor(C.inc).setRanges([sh.getRange(2, 3, n, 1), sh.getRange(2, 5, n, 1)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(f_('=$C2="Расход"'))
      .setFontColor(C.exp).setRanges([sh.getRange(2, 3, n, 1), sh.getRange(2, 5, n, 1)]).build()
  ]);
  const list = (arr) => SpreadsheetApp.newDataValidation().requireValueInList(arr, true).setAllowInvalid(false).build();
  sh.getRange(2, 3, n, 1).setDataValidation(list(['Доход', 'Расход']));
  sh.getRange(2, 6, n, 1).setDataValidation(list(REPEATS));
  sh.getRange(2, 9, n, 1).setDataValidation(list(['Ожидает', 'Оплачено']));
  sh.getRange(2, 7, n, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(ss.getSheetByName(SH.CAT).getRange('C2:C30'), true).setAllowInvalid(true).build());
  if (!sh.isColumnHiddenByUser(11)) sh.hideColumns(11);
  sh.getRange('A1').setNote('Повторяющиеся платежи после отметки «Оплачено» в приложении сами переносятся на следующий срок.');
}

function setupTasks_(ss) {
  const sh = ss.getSheetByName(SH.TASK) || ss.insertSheet(SH.TASK);
  ensureSize_(sh, 500, TASK_COLS.length);
  sh.getRange(1, 1, 1, TASK_COLS.length).setValues([TASK_COLS]);
  header_(sh.getRange(1, 1, 1, TASK_COLS.length), C.pink);
  sh.setRowHeight(1, 36);
  sh.setFrozenRows(1);
  [70, 420, 110, 130, 130, 80].forEach((w, i) => sh.setColumnWidth(i + 1, w));
  const n = sh.getMaxRows() - 1;
  sh.getRange(2, 1, n, TASK_COLS.length).setFontFamily('Arial').setFontSize(10).setVerticalAlignment('middle');
  sh.getRange(2, 1, n, 1).insertCheckboxes().setHorizontalAlignment('center');
  sh.getRange(2, 2, n, 1).setWrap(true).setFontSize(11);
  sh.getRange(2, 3, n, 1).setNumberFormat('dd.MM.yyyy').setHorizontalAlignment('center').setFontWeight('bold');
  sh.getRange(2, 4, n, 2).setNumberFormat('dd.MM.yyyy HH:mm').setHorizontalAlignment('center').setFontColor('#9A93A8').setFontSize(9);
  sh.getRange(2, 6, n, 1).setFontColor('#9A93A8').setFontSize(9);
  sh.getBandings().forEach(b => b.remove());
  sh.getRange(2, 1, n, TASK_COLS.length).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false)
    .setFirstRowColor('#FFFFFF').setSecondRowColor(C.band);
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(f_('=$A2=TRUE'))
      .setFontColor('#B4AEC0').setStrikethrough(true).setRanges([sh.getRange(2, 2, n, 2)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(f_('=AND($A2=FALSE,$C2<>"",$C2<TODAY())'))
      .setFontColor(C.exp).setBackground(C.expBg).setRanges([sh.getRange(2, 2, n, 2)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(f_('=AND($A2=FALSE,$C2=TODAY())'))
      .setBackground('#FFF4D6').setRanges([sh.getRange(2, 2, n, 2)]).build()
  ]);
  if (!sh.isColumnHiddenByUser(6)) sh.hideColumns(6);
}

function setupDashboard_(ss) {
  const sh = ss.getSheetByName(SH.DASH) || ss.insertSheet(SH.DASH, 0);
  sh.getCharts().forEach(c => sh.removeChart(c));
  sh.clear();
  sh.clearConditionalFormatRules();
  ensureSize_(sh, 60, 14);
  ss.setActiveSheet(sh);
  ss.moveActiveSheet(1);
  sh.setHiddenGridlines(true);
  sh.getRange('A1:N60').setBackground('#F7F3EF').setFontFamily('Arial');
  [20, 105, 105, 105, 20, 105, 105, 105, 20, 105, 105, 105, 20, 20].forEach((w, i) => sh.setColumnWidth(i + 1, w));

  const ops = "'" + SH.OPS + "'!", pay = "'" + SH.PAY + "'!", task = "'" + SH.TASK + "'!", sum = "'" + SH.SUM + "'!";
  const MS = 'EOMONTH(TODAY(),-1)+1', ME = 'EOMONTH(TODAY(),0)+1';
  const inMonth = ops + '$A:$A,">="&' + MS + ',' + ops + '$A:$A,"<"&' + ME;

  sh.getRange('B1:L1').merge().setFormula('="Art Mosaic · "&PROPER(TEXT(TODAY(),"mmmm yyyy"))')
    .setBackground(C.ink).setFontColor('#FFFFFF').setFontSize(18).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sh.setRowHeight(1, 54);
  sh.getRange('B2:L2').merge().setValue('Всё сложится! · данные обновляются сами из листов «Операции», «Платежи», «Дела»')
    .setFontColor('#9A93A8').setFontSize(9).setHorizontalAlignment('center');

  // карточки
  const card = (row, col, label, formula, color, fmt) => {
    const top = sh.getRange(row, col, 1, 3).merge(), val = sh.getRange(row + 1, col, 1, 3).merge();
    top.setValue(label).setFontSize(10).setFontWeight('bold').setFontColor('#6B6480')
      .setHorizontalAlignment('center').setVerticalAlignment('bottom');
    val.setFormula(formula).setFontSize(22).setFontWeight('bold').setFontColor(color)
      .setHorizontalAlignment('center').setVerticalAlignment('middle').setNumberFormat(fmt || '#,##0" ₽"');
    sh.getRange(row, col, 2, 3).setBackground('#FFFFFF')
      .setBorder(true, true, true, true, false, false, C.line, SpreadsheetApp.BorderStyle.SOLID);
    sh.getRange(row, col, 1, 3).setBorder(true, null, null, null, null, null, color, SpreadsheetApp.BorderStyle.SOLID_THICK);
  };
  sh.setRowHeight(4, 30); sh.setRowHeight(5, 46);
  sh.setRowHeight(7, 30); sh.setRowHeight(8, 46);
  card(4, 2, 'ДОХОДЫ ЗА МЕСЯЦ', '=SUMIFS(' + ops + '$D:$D,' + ops + '$B:$B,"Доход",' + inMonth + ')', C.inc);
  card(4, 6, 'РАСХОДЫ ЗА МЕСЯЦ', '=SUMIFS(' + ops + '$D:$D,' + ops + '$B:$B,"Расход",' + inMonth + ')', C.exp);
  card(4, 10, 'ПРИБЫЛЬ', '=B5-F5', C.ink, '+#,##0" ₽";"−"#,##0" ₽";0" ₽"');
  card(7, 2, 'ЕЩЁ ОПЛАТИТЬ В МЕСЯЦЕ',
    '=SUMIFS(' + pay + '$E:$E,' + pay + '$I:$I,"<>Оплачено",' + pay + '$C:$C,"Расход",' + pay + '$A:$A,"<"&' + ME + ')', '#B07A0C');
  card(7, 6, 'ПРОСРОЧЕНО ПЛАТЕЖЕЙ',
    '=COUNTIFS(' + pay + '$I:$I,"<>Оплачено",' + pay + '$A:$A,"<"&TODAY(),' + pay + '$B:$B,"<>")', C.exp, '0');
  card(7, 10, 'ОТКРЫТЫХ ДЕЛ', '=COUNTIFS(' + task + '$A:$A,FALSE,' + task + '$B:$B,"<>")', C.violet, '0');
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(0).setFontColor(C.exp).setRanges([sh.getRange('J5')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThan(0).setFontColor(C.inc).setRanges([sh.getRange('J5')]).build()
  ]);

  fixFormulas_(sh);

  // графики (данные берутся с листа «Сводка», год — в ячейке Сводка!B3)
  const s = ss.getSheetByName(SH.SUM);
  sh.getRange('B10:L10').merge().setFormula('="Год: "&' + sum + 'B3&"  ·  поменять год можно на листе «Сводка»"')
    .setFontColor('#6B6480').setFontSize(10).setFontWeight('bold');
  const base = (b) => b.setOption('backgroundColor', '#FFFFFF').setOption('fontName', 'Arial')
    .setOption('titleTextStyle', { color: C.ink, fontSize: 14, bold: true }).setOption('width', 470).setOption('height', 300);

  sh.insertChart(base(sh.newChart().setChartType(Charts.ChartType.COLUMN)
    .addRange(s.getRange('A5:C17')).setNumHeaders(1)
    .setOption('title', 'Доходы и расходы по месяцам').setOption('colors', [C.inc, C.exp])
    .setOption('legend', { position: 'bottom' }).setOption('vAxis', { format: '#,##0' }))
    .setPosition(11, 2, 0, 0).build());

  sh.insertChart(base(sh.newChart().setChartType(Charts.ChartType.LINE)
    .addRange(s.getRange('A5:A17')).addRange(s.getRange('D5:D17')).setNumHeaders(1)
    .setOption('title', 'Прибыль по месяцам').setOption('colors', [C.violet]).setOption('curveType', 'function')
    .setOption('pointSize', 6).setOption('legend', { position: 'none' }).setOption('vAxis', { format: '#,##0' }))
    .setPosition(11, 8, 0, 0).build());

  const pie = ['#E86A92', '#3BA8B5', '#F2B544', '#7B5EA7', '#1F9D6B', '#E98A4F', '#5C7FD6', '#C45BAA', '#8AB04A', '#D9485F'];
  sh.insertChart(base(sh.newChart().setChartType(Charts.ChartType.PIE)
    .addRange(s.getRange('G6:H25')).setNumHeaders(0)
    .setOption('title', 'Откуда приходят деньги (за год)').setOption('pieHole', 0.5).setOption('colors', pie)
    .setOption('legend', { position: 'right' }).setOption('pieSliceText', 'percentage'))
    .setPosition(27, 2, 0, 0).build());

  sh.insertChart(base(sh.newChart().setChartType(Charts.ChartType.PIE)
    .addRange(s.getRange('J6:K25')).setNumHeaders(0)
    .setOption('title', 'Куда уходят деньги (за год)').setOption('pieHole', 0.5).setOption('colors', pie.slice().reverse())
    .setOption('legend', { position: 'right' }).setOption('pieSliceText', 'percentage'))
    .setPosition(27, 8, 0, 0).build());

  sh.setFrozenRows(0);
}
