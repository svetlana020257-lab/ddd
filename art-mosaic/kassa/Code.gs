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
const PAY_COLS = ['Дата платежа', 'Название', 'Тип', 'Категория', 'Сумма', 'Повтор', 'Способ оплаты', 'Комментарий', 'Статус', 'Оплачено', 'ID', 'Календарь'];
const TASK_COLS = ['Готово', 'Задача', 'Срок', 'Создано', 'Выполнено', 'ID', 'Календарь', 'Повтор'];
const TASK_REPEATS = ['Разово', 'Ежедневно', 'Еженедельно', 'Ежемесячно', 'Ежеквартально', 'Ежегодно'];
const REPEATS = ['Разово', 'Ежемесячно', 'Еженедельно', 'Ежеквартально', 'Ежегодно'];

const C = {
  ink: '#2B2440', inc: '#1F9D6B', incBg: '#E6F6EE', exp: '#D9485F', expBg: '#FCE9EC',
  pink: '#E86A92', violet: '#7B5EA7', band: '#F8F5FB', line: '#E4DEEC'
};

/* ---------------- Веб-приложение ---------------- */

function doGet() {
  // Страница приложения встроена в этот файл (константа INDEX_HTML внизу) — отдельный HTML-файл не нужен
  return HtmlService.createHtmlOutput(INDEX_HTML)
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
      syncPayRow_(row);
    } else {
      sh.appendRow(vals.concat(['Ожидает', '', newId_()]));
      syncPayRow_(sh.getLastRow());
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
      // оставляем в календаре отметку об оплаченном сроке, а событие платежа переезжает на следующий
      calSafe_(() => cal_().createAllDayEvent('✅ ' + (p.type === 'Доход' ? '💰 ' : '💳 ') + p.name + ' — ' + rub_(d.amount),
        dayDate_(p.date), { description: 'Оплачено ' + d.date.split('-').reverse().join('.') }).removeAllReminders());
      sh.getRange(row, 1).setValue(toDate_(nextDate_(p.date, p.repeat)));
      sh.getRange(row, 10).setValue(toDate_(d.date));
    }
    syncPayRow_(row);
  });
}

function apiPayDelete(pin, id) {
  auth_(pin);
  return withLock_(() => {
    const row = findRowIn_(SH.PAY, 11, id);
    if (row) { deleteEventAt_(SH.PAY, row, 12); sheet_(SH.PAY).deleteRow(row); }
  });
}

// Список дел
function apiTaskSave(pin, t) {
  auth_(pin);
  return withLock_(() => {
    const text = String(t.text || '').trim();
    if (!text) throw new Error('Напишите, что нужно сделать');
    const repeat = TASK_REPEATS.indexOf(t.repeat) > 0 ? t.repeat : 'Разово';
    // у повторяющегося дела обязательно есть срок — по умолчанию сегодня
    const dueStr = /^\d{4}-\d{2}-\d{2}$/.test(t.due || '') ? t.due : (repeat !== 'Разово' ? Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd') : '');
    const due = dueStr ? toDate_(dueStr) : '';
    const sh = sheet_(SH.TASK);
    if (t.id) {
      const row = findRowIn_(SH.TASK, 6, t.id);
      if (!row) throw new Error('Задача не найдена');
      sh.getRange(row, 2, 1, 2).setValues([[text, due]]);
      sh.getRange(row, 8).setValue(repeat);
      syncTaskRow_(row);
    } else {
      // в листе заранее стоят чекбоксы, поэтому пишем в первую строку после последней задачи
      const last = sh.getLastRow();
      const texts = last > 1 ? sh.getRange(2, 2, last - 1, 1).getValues() : [];
      let row = 2;
      for (let i = texts.length - 1; i >= 0; i--) if (String(texts[i][0]).trim()) { row = i + 3; break; }
      if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 50);
      sh.getRange(row, 1, 1, 6).setValues([[false, text, due, new Date(), '', newId_()]]);
      sh.getRange(row, 8).setValue(repeat);
      sh.getRange(row, 1).insertCheckboxes();
      syncTaskRow_(row);
    }
  });
}

function addTaskRow_(text, dueStr, repeat) {
  const sh = sheet_(SH.TASK);
  const last = sh.getLastRow();
  const texts = last > 1 ? sh.getRange(2, 2, last - 1, 1).getValues() : [];
  let row = 2;
  for (let i = texts.length - 1; i >= 0; i--) if (String(texts[i][0]).trim()) { row = i + 3; break; }
  if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 50);
  sh.getRange(row, 1, 1, 6).setValues([[false, text, dueStr ? toDate_(dueStr) : '', new Date(), '', newId_()]]);
  sh.getRange(row, 8).setValue(repeat || 'Разово');
  sh.getRange(row, 1).insertCheckboxes();
  syncTaskRow_(row);
  return row;
}

function apiTaskToggle(pin, id, done) {
  auth_(pin);
  return withLock_(() => {
    const row = findRowIn_(SH.TASK, 6, id);
    if (!row) throw new Error('Задача не найдена');
    const sh = sheet_(SH.TASK);
    sh.getRange(row, 1).setValue(!!done);
    sh.getRange(row, 5).setValue(done ? new Date() : '');
    syncTaskRow_(row);
    // повторяющееся дело: выполненное остаётся в истории, следующее создаётся с новым сроком
    if (done) {
      const t = readTasks_().find(x => x.id === String(id));
      if (t && t.repeat !== 'Разово' && t.due) {
        const today = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
        let next = nextDate_(t.due, t.repeat);
        while (next <= today) next = nextDate_(next, t.repeat);
        const exists = readTasks_().some(x => !x.done && x.text === t.text && x.due === next);
        if (!exists) {
          addTaskRow_(t.text, next, t.repeat);
        }
        return next;
      }
    }
    return '';
  });
}

function apiTaskDelete(pin, id) {
  auth_(pin);
  return withLock_(() => {
    const row = findRowIn_(SH.TASK, 6, id);
    if (row) { deleteEventAt_(SH.TASK, row, 7); sheet_(SH.TASK).deleteRow(row); }
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
  if (repeat === 'Ежедневно') return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
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
  sh.getRange(2, 1, last - 1, 8).getValues().forEach((r, i) => {
    const text = String(r[1] || '').trim();
    if (!text) return;
    let id = r[5];
    if (!id) { id = newId_(); sh.getRange(i + 2, 6).setValue(id); }
    out.push({
      id: String(id), text: text, done: r[0] === true,
      due: toDateStr_(r[2], tz),
      created: r[3] instanceof Date ? r[3].getTime() : 0,
      doneAt: r[4] instanceof Date ? r[4].getTime() : 0,
      repeat: TASK_REPEATS.indexOf(String(r[7]).trim()) > 0 ? String(r[7]).trim() : 'Разово'
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
  [115, 200, 85, 170, 110, 125, 130, 260, 100, 105, 80, 80].forEach((w, i) => sh.setColumnWidth(i + 1, w));
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
  sh.hideColumns(11, 2);
  sh.getRange('A1').setNote('Повторяющиеся платежи после отметки «Оплачено» в приложении сами переносятся на следующий срок.');
}

function setupTasks_(ss) {
  const sh = ss.getSheetByName(SH.TASK) || ss.insertSheet(SH.TASK);
  ensureSize_(sh, 500, TASK_COLS.length);
  sh.getRange(1, 1, 1, TASK_COLS.length).setValues([TASK_COLS]);
  header_(sh.getRange(1, 1, 1, TASK_COLS.length), C.pink);
  sh.setRowHeight(1, 36);
  sh.setFrozenRows(1);
  [70, 420, 110, 130, 130, 80, 80, 120].forEach((w, i) => sh.setColumnWidth(i + 1, w));
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
  sh.hideColumns(6, 2);
  sh.getRange(2, 8, n, 1).setHorizontalAlignment('center').setFontColor(C.violet).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(TASK_REPEATS, true).setAllowInvalid(false).build());
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

/* ---------------- Google Календарь ---------------- */
// Платежи и дела со сроком попадают в отдельный календарь «Art Mosaic · Феня».
// Им можно поделиться с Галиной: Google Календарь → настройки календаря → «Открыть доступ».

const CAL_NAME = 'Art Mosaic · Феня';
const CAL_TZ = 'Asia/Novosibirsk';

function cal_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('CAL_ID');
  let cal = id ? CalendarApp.getCalendarById(id) : null;
  if (!cal) {
    cal = CalendarApp.getCalendarsByName(CAL_NAME)[0] || CalendarApp.createCalendar(CAL_NAME, { timeZone: CAL_TZ });
    try { cal.setColor('#E86A92'); } catch (e) {}
    props.setProperty('CAL_ID', cal.getId());
  }
  return cal;
}

// Ошибка календаря не должна ломать запись в таблицу
function calSafe_(fn) {
  try { return fn(); } catch (e) { console.error('Календарь: ' + e); return null; }
}

function dayDate_(ds) {                       // 'yyyy-MM-dd' → дата (полдень, чтобы не съехать из-за часовых поясов)
  const [y, m, d] = ds.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

function rub_(n) { return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'; }

function eventById_(cal, id) {
  if (!id) return null;
  try { return cal.getEventById(String(id)); } catch (e) { return null; }
}

function deleteEventAt_(sheetName, row, col) {
  calSafe_(() => {
    const id = sheet_(sheetName).getRange(row, col).getValue();
    const ev = eventById_(cal_(), id);
    if (ev) ev.deleteEvent();
  });
}

function syncPayRow_(row) {
  calSafe_(() => {
    const sh = sheet_(SH.PAY), tz = tz_();
    const r = sh.getRange(row, 1, 1, 12).getValues()[0];
    const ds = toDateStr_(r[0], tz), name = String(r[1] || '').trim();
    const cal = cal_();
    let ev = eventById_(cal, r[11]);
    if (!ds || !name) { if (ev) ev.deleteEvent(); sh.getRange(row, 12).setValue(''); return; }
    const inc = /^дох/i.test(String(r[2])), paid = /оплач/i.test(String(r[8]));
    const title = (paid ? '✅ ' : '') + (inc ? '💰 ' : '💳 ') + name + (Number(r[4]) ? ' — ' + rub_(r[4]) : '');
    const desc = [
      inc ? 'Ожидаем поступление' : 'Платёж',
      r[3] ? 'Категория: ' + r[3] : '', r[6] ? 'Способ: ' + r[6] : '',
      r[5] && r[5] !== 'Разово' ? 'Повтор: ' + r[5] : '', r[7] ? '💬 ' + r[7] : '',
      '', 'Отметить оплату — в приложении или кнопкой у Фени в Telegram'
    ].filter((x, i, a) => x || (i > 0 && a[i - 1])).join('\n');
    if (ev) {
      ev.setTitle(title); ev.setAllDayDate(dayDate_(ds)); ev.setDescription(desc);
    } else {
      ev = cal.createAllDayEvent(title, dayDate_(ds), { description: desc });
      sh.getRange(row, 12).setValue(ev.getId());
    }
    ev.removeAllReminders();
    if (!paid) { ev.addPopupReminder(15 * 60); ev.addPopupReminder(0); }   // накануне в 9:00 и в сам день
  });
}

function syncTaskRow_(row) {
  calSafe_(() => {
    const sh = sheet_(SH.TASK), tz = tz_();
    const r = sh.getRange(row, 1, 1, 8).getValues()[0];
    const text = String(r[1] || '').trim(), ds = toDateStr_(r[2], tz), done = r[0] === true;
    const cal = cal_();
    let ev = eventById_(cal, r[6]);
    if (!text || !ds) { if (ev) ev.deleteEvent(); sh.getRange(row, 7).setValue(''); return; }
    const rep = TASK_REPEATS.indexOf(String(r[7] || '').trim()) > 0;
    const title = (done ? '✔ ' : '📝 ') + text + (rep ? ' ↻' : '');
    if (ev) {
      ev.setTitle(title); ev.setAllDayDate(dayDate_(ds));
    } else {
      ev = cal.createAllDayEvent(title, dayDate_(ds), { description: 'Дело из списка Фени' });
      sh.getRange(row, 7).setValue(ev.getId());
    }
    ev.removeAllReminders();
    if (!done) ev.addPopupReminder(15 * 60);
  });
}

// Событие со временем (поставка, встреча, МК) — прямо в календарь, без таблицы
function addCalEvent_(title, ds, startHm, minutes, desc) {
  const cal = cal_();
  if (!startHm) return cal.createAllDayEvent(title, dayDate_(ds), { description: desc || '' });
  const start = Utilities.parseDate(ds + ' ' + startHm, CAL_TZ, 'yyyy-MM-dd HH:mm');
  const end = new Date(start.getTime() + (minutes || 60) * 60000);
  const ev = cal.createEvent(title, start, end, { description: desc || '' });
  ev.removeAllReminders(); ev.addPopupReminder(60); ev.addPopupReminder(24 * 60);
  return ev;
}

// События на ближайшие дни — для Фени
function calEvents_(fromDs, days) {
  return calSafe_(() => {
    const from = Utilities.parseDate(fromDs + ' 00:00', CAL_TZ, 'yyyy-MM-dd HH:mm');
    const to = new Date(from.getTime() + days * 86400000);
    return cal_().getEvents(from, to).map(e => ({
      id: e.getId(), title: e.getTitle(), allDay: e.isAllDayEvent(),
      day: Utilities.formatDate(e.isAllDayEvent() ? e.getAllDayStartDate() : e.getStartTime(), CAL_TZ, 'yyyy-MM-dd'),
      start: e.isAllDayEvent() ? '' : Utilities.formatDate(e.getStartTime(), CAL_TZ, 'HH:mm'),
      end: e.isAllDayEvent() ? '' : Utilities.formatDate(e.getEndTime(), CAL_TZ, 'HH:mm')
    }));
  }) || [];
}

// Запустить ОДИН раз из редактора: создаст календарь и перенесёт в него все платежи и дела со сроком
function setupCalendar() {
  const ss = SpreadsheetApp.getActive();
  setupPays_(ss); setupTasks_(ss);                       // добавит колонку «Календарь»
  const cal = cal_();
  const pay = sheet_(SH.PAY), task = sheet_(SH.TASK);
  for (let r = 2; r <= pay.getLastRow(); r++) if (String(pay.getRange(r, 2).getValue()).trim()) syncPayRow_(r);
  for (let r = 2; r <= task.getLastRow(); r++) if (String(task.getRange(r, 2).getValue()).trim()) syncTaskRow_(r);
  console.log('Календарь готов: ' + cal.getName());
  console.log('Поделиться с Галиной: calendar.google.com → слева «' + CAL_NAME + '» → ⋮ → «Настройки и общий доступ» → «Открыть доступ отдельным пользователям» → её почта');
}

/* ---------------- Календарь в приложении ---------------- */

// События месяца из календаря (кроме платежей и дел — они приходят из таблицы)
function monthEvents_(ym) {
  const [y, m] = ym.split('-').map(Number);
  const days = new Date(y, m, 0).getDate();
  return calEvents_(ym + '-01', days).filter(e => !/^(✅|💳|💰|📝|✔)/.test(e.title));
}

function calOk_() { return !!calSafe_(() => cal_().getId()); }

function apiEvents(pin, ym) {
  auth_(pin);
  return { events: monthEvents_(ym), ok: calOk_() };
}

function apiEventAdd(pin, e) {
  auth_(pin);
  const title = String(e.title || '').trim();
  if (!title) throw new Error('Напишите название события');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || '')) throw new Error('Укажите дату');
  const start = /^\d{2}:\d{2}$/.test(e.start || '') ? e.start : '';
  addCalEvent_(title, e.date, start, Number(e.minutes) || 60, String(e.desc || '') || 'Добавлено в приложении');
  return { events: monthEvents_(e.date.slice(0, 7)), ok: true };
}

function apiEventDelete(pin, id, ym) {
  auth_(pin);
  const ev = eventById_(cal_(), id);
  if (ev) ev.deleteEvent();
  return { events: monthEvents_(ym), ok: true };
}


/* ======== СТРАНИЦА ПРИЛОЖЕНИЯ (собрано из Index.html, вручную не править) ======== */
const INDEX_HTML = "<!DOCTYPE html>\n<html lang=\"ru\">\n<head>\n<base target=\"_top\">\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n<meta name=\"theme-color\" content=\"#2B2440\">\n<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n<link href=\"https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap\" rel=\"stylesheet\">\n<style>\n  :root{\n    --ink:#2B2440; --ink2:#6B6480; --mute:#9A93A8; --line:#ECE6F2;\n    --bg:#F7F3EF; --card:#FFFFFF;\n    --inc:#1F9D6B; --incbg:#E6F6EE; --exp:#D9485F; --expbg:#FCE9EC;\n    --pink:#E86A92; --gold:#F2B544; --teal:#3BA8B5; --violet:#7B5EA7;\n    --r:18px;\n  }\n  *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}\n  html,body{margin:0;background:var(--bg);color:var(--ink);font-family:Manrope,system-ui,-apple-system,sans-serif;font-size:16px}\n  button,input,textarea{font-family:inherit;font-size:inherit;color:inherit}\n  button{cursor:pointer;border:0;background:none}\n  .hidden{display:none!important}\n\n  #app{max-width:560px;margin:0 auto;min-height:100vh;padding-bottom:calc(84px + env(safe-area-inset-bottom))}\n\n  /* шапка */\n  .top{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:12px;padding:14px 18px;\n       background:var(--ink);color:#fff;border-radius:0 0 22px 22px;box-shadow:0 6px 20px rgba(43,36,64,.18)}\n  .logo{width:38px;height:38px;flex:none;display:grid;grid-template-columns:1fr 1fr;gap:3px;transform:rotate(-8deg)}\n  .logo i{border-radius:4px;display:block}\n  .logo i:nth-child(1){background:var(--pink);clip-path:polygon(0 0,100% 0,0 100%)}\n  .logo i:nth-child(2){background:var(--gold)}\n  .logo i:nth-child(3){background:var(--teal)}\n  .logo i:nth-child(4){background:var(--violet);clip-path:polygon(100% 0,100% 100%,0 100%)}\n  .brand{font-weight:800;font-size:18px;letter-spacing:.2px}\n  .sub{font-size:12px;opacity:.7}\n  .top .grow{flex:1}\n  .icon-btn{width:40px;height:40px;border-radius:12px;background:rgba(255,255,255,.1);color:#fff;font-size:20px;display:grid;place-items:center}\n  .icon-btn.spin{animation:spin 1s linear infinite}\n  @keyframes spin{to{transform:rotate(360deg)}}\n\n  main{padding:16px}\n  .tab{display:none}\n  .tab.active{display:block;animation:fade .2s ease}\n  @keyframes fade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}\n\n  .card{background:var(--card);border-radius:var(--r);padding:16px;box-shadow:0 1px 0 var(--line),0 4px 16px rgba(43,36,64,.05);margin-bottom:14px}\n  .lbl{display:block;font-size:12px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--mute);margin:16px 2px 8px}\n  .lbl:first-child{margin-top:0}\n\n  /* тип */\n  .seg{display:grid;grid-template-columns:1fr 1fr;background:#EFEAF4;border-radius:14px;padding:4px;gap:4px}\n  .seg button{padding:12px;border-radius:11px;font-weight:700;color:var(--ink2);transition:.15s}\n  .seg button.on.inc{background:var(--inc);color:#fff;box-shadow:0 4px 12px rgba(31,157,107,.3)}\n  .seg button.on.exp{background:var(--exp);color:#fff;box-shadow:0 4px 12px rgba(217,72,95,.3)}\n\n  /* сумма */\n  .amount{display:flex;align-items:baseline;justify-content:center;gap:8px;padding:18px 0 6px}\n  .amount input{width:100%;max-width:300px;border:0;outline:0;background:transparent;text-align:center;\n    font-size:44px;font-weight:800;letter-spacing:-1px}\n  .amount input::placeholder{color:#D6D0DF}\n  .amount span{font-size:28px;font-weight:700;color:var(--mute)}\n  body.t-inc .amount input{color:var(--inc)}\n  body.t-exp .amount input{color:var(--exp)}\n\n  /* чипсы */\n  .chips{display:flex;flex-wrap:wrap;gap:8px}\n  .chip{padding:9px 14px;border-radius:999px;background:#F3EFF7;color:var(--ink);font-weight:600;font-size:14px;border:1.5px solid transparent;transition:.12s}\n  .chip.on{background:var(--ink);color:#fff}\n  body.t-inc #cats .chip.on{background:var(--inc)}\n  body.t-exp #cats .chip.on{background:var(--exp)}\n  .dates{display:flex;gap:8px;align-items:center;flex-wrap:wrap}\n  .dates input{flex:1;min-width:150px;padding:8px 12px;border-radius:12px;border:1.5px solid var(--line);background:#fff;font-weight:600;font-size:15px}\n  textarea{width:100%;border:1.5px solid var(--line);border-radius:14px;padding:12px;resize:vertical;outline:0;background:#fff;font-size:15px}\n  textarea:focus,.dates input:focus{border-color:var(--violet)}\n\n  .primary{width:100%;margin-top:18px;padding:16px;border-radius:16px;background:var(--ink);color:#fff;font-weight:800;font-size:17px;\n    box-shadow:0 8px 20px rgba(43,36,64,.25);transition:.15s}\n  body.t-inc .primary{background:var(--inc);box-shadow:0 8px 20px rgba(31,157,107,.3)}\n  body.t-exp .primary{background:var(--exp);box-shadow:0 8px 20px rgba(217,72,95,.3)}\n  .primary:disabled{opacity:.6}\n  .edit-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}\n  .ghost,.danger{padding:13px;border-radius:14px;font-weight:700}\n  .ghost{background:#EFEAF4}\n  .danger{background:var(--expbg);color:var(--exp)}\n  .edit-badge{display:inline-block;margin-bottom:10px;padding:5px 10px;border-radius:8px;background:#FFF4D6;color:#8A6510;font-size:13px;font-weight:700}\n\n  .mini{display:flex;justify-content:space-between;gap:10px;font-size:14px;color:var(--ink2)}\n  .mini b{font-weight:800}\n\n  /* месяц */\n  .month{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}\n  .month button{width:44px;height:44px;border-radius:14px;background:#fff;font-size:22px;font-weight:700;box-shadow:0 1px 0 var(--line)}\n  .month .title{font-weight:800;font-size:19px}\n\n  .totals{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px}\n  .tot{background:#fff;border-radius:14px;padding:10px 12px;box-shadow:0 1px 0 var(--line)}\n  .tot small{display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--mute)}\n  .tot b{display:block;font-size:16px;font-weight:800;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n\n  /* журнал */\n  .day{font-size:13px;font-weight:700;color:var(--mute);margin:16px 4px 6px;display:flex;justify-content:space-between}\n  .op{display:flex;align-items:center;gap:12px;background:#fff;border-radius:14px;padding:12px 14px;margin-bottom:6px;box-shadow:0 1px 0 var(--line);width:100%;text-align:left}\n  .op:active{transform:scale(.99)}\n  .dot{width:36px;height:36px;border-radius:11px;display:grid;place-items:center;font-weight:800;flex:none}\n  .dot.inc{background:var(--incbg);color:var(--inc)}\n  .dot.exp{background:var(--expbg);color:var(--exp)}\n  .op .mid{flex:1;min-width:0}\n  .op .cat{font-weight:700;font-size:15px}\n  .op .com{font-size:13px;color:var(--ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n  .op .sum{font-weight:800;white-space:nowrap}\n  .op .sum.inc{color:var(--inc)} .op .sum.exp{color:var(--exp)}\n  .empty{text-align:center;color:var(--mute);padding:40px 10px}\n  .empty div{font-size:38px;margin-bottom:6px}\n\n  /* итоги */\n  .big{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px}\n  .kpi{border-radius:var(--r);padding:16px;color:#fff}\n  .kpi small{font-size:12px;font-weight:700;opacity:.85;text-transform:uppercase;letter-spacing:.5px}\n  .kpi b{display:block;font-size:22px;font-weight:800;margin-top:4px}\n  .kpi.inc{background:linear-gradient(135deg,#1F9D6B,#35B989)}\n  .kpi.exp{background:linear-gradient(135deg,#D9485F,#EC6C7F)}\n  .profit{background:var(--ink);color:#fff;border-radius:var(--r);padding:16px 18px;display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}\n  .profit small{opacity:.7;font-weight:600}\n  .profit b{font-size:24px;font-weight:800}\n  .bars h3{margin:0 0 12px;font-size:15px}\n  .bar{margin-bottom:10px}\n  .bar .t{display:flex;justify-content:space-between;font-size:14px;margin-bottom:4px;gap:8px}\n  .bar .t span:first-child{font-weight:600}\n  .bar .t span:last-child{font-weight:800;white-space:nowrap}\n  .bar .track{height:8px;border-radius:6px;background:#F1ECF5;overflow:hidden}\n  .bar .fill{height:100%;border-radius:6px}\n  table.year{width:100%;border-collapse:collapse;font-size:14px}\n  table.year th{font-size:11px;text-transform:uppercase;color:var(--mute);text-align:right;padding:6px 4px;letter-spacing:.4px}\n  table.year th:first-child,table.year td:first-child{text-align:left}\n  table.year td{padding:9px 4px;border-top:1px solid var(--line);text-align:right;font-weight:600;white-space:nowrap}\n  table.year tr.cur td{background:#F6F2FA}\n  table.year tr{cursor:pointer}\n  table.year tfoot td{font-weight:800;border-top:2px solid var(--ink)}\n  .inc-t{color:var(--inc)} .exp-t{color:var(--exp)}\n  .link-btn{display:block;text-align:center;padding:14px;border-radius:14px;background:#fff;color:var(--ink);font-weight:700;text-decoration:none;box-shadow:0 1px 0 var(--line)}\n\n  /* нижнее меню */\n  nav.bottom{position:fixed;left:0;right:0;bottom:0;z-index:6;display:flex;justify-content:center;\n    background:rgba(255,255,255,.94);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);\n    border-top:1px solid var(--line);padding:8px 8px calc(8px + env(safe-area-inset-bottom))}\n  nav.bottom .in{display:grid;grid-template-columns:repeat(5,1fr);width:100%;max-width:560px;gap:6px}\n  nav.bottom button{position:relative;padding:8px 2px;border-radius:12px;color:var(--mute);font-size:11px;font-weight:700;display:flex;flex-direction:column;align-items:center;gap:2px}\n  nav.bottom button .ic{font-size:22px;line-height:1}\n  nav.bottom button.on{color:var(--ink);background:#F3EFF7}\n\n  nav.bottom .badge{position:absolute;top:3px;left:calc(50% + 6px);min-width:17px;height:17px;padding:0 4px;border-radius:9px;\n    background:var(--exp);color:#fff;font-size:10px;line-height:17px;font-weight:800}\n\n  /* платежи и дела */\n  .head-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:10px}\n  .head-row h2{margin:0;font-size:21px;font-weight:800}\n  .add-btn{padding:10px 14px;border-radius:12px;background:var(--ink);color:#fff;font-weight:700;font-size:14px;white-space:nowrap}\n  .group{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.6px;margin:18px 4px 8px;color:var(--mute)}\n  .group.red{color:var(--exp)} .group.amber{color:#B07A0C}\n  .pay{display:flex;align-items:center;gap:12px;background:#fff;border-radius:14px;padding:10px 12px;margin-bottom:6px;box-shadow:0 1px 0 var(--line)}\n  .pay.overdue{box-shadow:inset 3px 0 0 var(--exp),0 1px 0 var(--line)}\n  .pay.soon{box-shadow:inset 3px 0 0 var(--gold),0 1px 0 var(--line)}\n  .cal{width:46px;flex:none;text-align:center;border-radius:11px;background:#F3EFF7;padding:5px 0}\n  .cal b{display:block;font-size:19px;font-weight:800;line-height:1.1}\n  .cal small{font-size:10px;font-weight:700;text-transform:uppercase;color:var(--ink2)}\n  .pay.overdue .cal{background:var(--expbg);color:var(--exp)}\n  .pay .mid{flex:1;min-width:0;text-align:left}\n  .pay .nm{font-weight:700;font-size:15px}\n  .pay .meta{font-size:12px;color:var(--ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n  .pay .am{font-weight:800;white-space:nowrap;font-size:15px}\n  .done-btn{width:40px;height:40px;flex:none;border-radius:12px;background:var(--incbg);color:var(--inc);font-size:20px;font-weight:800}\n  .done-btn.exp{background:var(--expbg);color:var(--exp)}\n  .rep{display:inline-block;font-size:10px;font-weight:800;padding:1px 6px;border-radius:6px;background:#EFEAF5;color:var(--violet);margin-left:4px;vertical-align:2px}\n  .banner{display:flex;align-items:center;gap:10px;background:#FFF4D6;color:#7A5608;border-radius:14px;padding:12px 14px;margin-bottom:14px;font-weight:600;font-size:14px;width:100%;text-align:left}\n  .banner.red{background:var(--expbg);color:var(--exp)}\n  .banner b{font-weight:800}\n\n  .task-new{display:flex;gap:8px;margin-bottom:6px}\n  .task-new input[type=text]{flex:1;min-width:0;padding:13px 14px;border-radius:14px;border:1.5px solid var(--line);background:#fff;outline:0;font-size:15px}\n  .task-new input[type=text]:focus{border-color:var(--violet)}\n  .task-new button{width:50px;border-radius:14px;background:var(--ink);color:#fff;font-size:24px;font-weight:700}\n  .task-opts{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:6px}\n  .task-opts .chip{padding:6px 11px;font-size:13px}\n  .task-opts input[type=date]{padding:5px 9px;border-radius:10px;border:1.5px solid var(--line);background:#fff;font-size:13px;font-weight:600}\n  .task{display:flex;align-items:center;gap:12px;background:#fff;border-radius:14px;padding:12px 14px;margin-bottom:6px;box-shadow:0 1px 0 var(--line)}\n  .check{width:26px;height:26px;flex:none;border-radius:50%;border:2px solid #CFC7DA;display:grid;place-items:center;color:#fff;font-size:14px;font-weight:900;transition:.15s}\n  .task.done .check{background:var(--inc);border-color:var(--inc)}\n  .task .tx{flex:1;min-width:0;text-align:left;font-size:15px;font-weight:600;line-height:1.3;word-break:break-word}\n  .task.done .tx{color:var(--mute);text-decoration:line-through;font-weight:500}\n  .due{font-size:12px;font-weight:800;padding:3px 8px;border-radius:8px;background:#F3EFF7;color:var(--ink2);white-space:nowrap}\n  .due.red{background:var(--expbg);color:var(--exp)} .due.amber{background:#FFF4D6;color:#8A6510}\n  .toggle-done{width:100%;padding:12px;margin-top:8px;border-radius:12px;color:var(--ink2);font-weight:700;background:#EFEAF4}\n\n  /* календарь */\n  .calhead{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}\n  .calhead .title{font-weight:800;font-size:17px}\n  .calhead button{width:38px;height:38px;border-radius:12px;background:#F3EFF7;font-size:20px;font-weight:700}\n  .cgrid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}\n  .cgrid .wd{font-size:11px;font-weight:800;color:var(--mute);text-align:center;padding:2px 0 4px;text-transform:uppercase}\n  .cgrid .wd.we{color:var(--pink)}\n  .cday{aspect-ratio:1/1;border-radius:12px;background:#FAF7FC;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font-weight:700;font-size:15px;position:relative;border:2px solid transparent}\n  .cday.out{opacity:.35}\n  .cday.today{background:#FFF4D6}\n  .cday.sel{border-color:var(--ink);background:#fff}\n  .cday .dots{display:flex;gap:3px;height:6px}\n  .cday .dots i{width:6px;height:6px;border-radius:50%}\n  .d-exp{background:var(--exp)} .d-inc{background:var(--inc)} .d-task{background:var(--violet)} .d-ev{background:var(--teal)}\n  .legend{display:flex;flex-wrap:wrap;gap:10px;margin-top:10px;font-size:11px;color:var(--ink2);font-weight:600}\n  .legend span{display:flex;align-items:center;gap:4px} .legend i{width:8px;height:8px;border-radius:50%;display:inline-block}\n  .dayhead{display:flex;justify-content:space-between;align-items:baseline;margin:16px 4px 8px}\n  .dayhead b{font-size:16px} .dayhead small{color:var(--ink2);font-weight:600}\n  .ditem{display:flex;align-items:center;gap:10px;background:#fff;border-radius:12px;padding:10px 12px;margin-bottom:6px;box-shadow:0 1px 0 var(--line)}\n  .ditem .tm{font-weight:800;font-size:13px;color:var(--teal);min-width:44px}\n  .ditem .tx{flex:1;min-width:0;font-weight:600;font-size:14px;text-align:left}\n  .ditem .tx small{display:block;font-weight:500;color:var(--ink2);font-size:12px}\n  .ditem .x{width:32px;height:32px;border-radius:10px;background:#F3EFF7;color:var(--ink2);font-weight:800}\n  .dadd{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px}\n  .dadd button{padding:10px 4px;border-radius:12px;background:#fff;font-weight:700;font-size:13px;box-shadow:0 1px 0 var(--line)}\n  .calwarn{font-size:12px;color:#8A6510;background:#FFF4D6;border-radius:10px;padding:8px 10px;margin-top:10px}\n\n  /* модальное окно */\n  .modal{position:fixed;inset:0;z-index:25;background:rgba(43,36,64,.45);display:flex;align-items:flex-end;justify-content:center}\n  .modal .panel{width:100%;max-width:560px;max-height:92vh;overflow:auto;background:var(--bg);border-radius:22px 22px 0 0;\n    padding:18px 16px calc(18px + env(safe-area-inset-bottom));animation:up .22s ease}\n  @keyframes up{from{transform:translateY(40px);opacity:.5}to{transform:none;opacity:1}}\n  .modal h3{margin:0 0 4px;font-size:19px;font-weight:800}\n  .modal .hint{font-size:13px;color:var(--ink2);margin:6px 2px 0}\n  .field{width:100%;padding:12px 14px;border-radius:14px;border:1.5px solid var(--line);background:#fff;outline:0;font-size:16px;font-weight:600}\n  .field:focus{border-color:var(--violet)}\n  .field.big{font-size:26px;font-weight:800}\n  .modal .seg{margin-top:4px}\n  @media (min-width:700px){ .modal{align-items:center} .modal .panel{border-radius:22px} }\n\n  /* тост, оверлеи */\n  #toast{position:fixed;left:50%;bottom:calc(96px + env(safe-area-inset-bottom));transform:translateX(-50%) translateY(20px);opacity:0;\n    background:var(--ink);color:#fff;padding:12px 18px;border-radius:14px;font-weight:600;font-size:14px;z-index:20;transition:.25s;max-width:90vw;text-align:center;pointer-events:none}\n  #toast.show{opacity:1;transform:translateX(-50%) translateY(0)}\n  #toast.err{background:var(--exp)}\n  .overlay{position:fixed;inset:0;z-index:30;background:var(--bg);display:grid;place-items:center;padding:24px}\n  .pinbox{width:100%;max-width:320px;text-align:center}\n  .pinbox .logo{margin:0 auto 16px;width:56px;height:56px}\n  .pinbox input{width:100%;text-align:center;font-size:30px;letter-spacing:10px;padding:14px;border-radius:16px;border:2px solid var(--line);outline:0;background:#fff;font-weight:800}\n  .loading{text-align:center;color:var(--mute);padding:60px 0}\n  .loading .logo{margin:0 auto 14px;animation:spin 2.4s linear infinite}\n\n  @media (min-width:700px){\n    .amount input{font-size:52px}\n  }\n</style>\n</head>\n<body class=\"t-inc\">\n<div id=\"app\">\n  <header class=\"top\">\n    <div class=\"logo\"><i></i><i></i><i></i><i></i></div>\n    <div class=\"grow\"><div class=\"brand\">Art Mosaic</div><div class=\"sub\">доходы и расходы мастерской</div></div>\n    <button id=\"refreshBtn\" class=\"icon-btn\" title=\"Обновить из таблицы\">↻</button>\n  </header>\n\n  <main>\n    <div id=\"boot\" class=\"loading\"><div class=\"logo\"><i></i><i></i><i></i><i></i></div>Загружаю данные…</div>\n\n    <!-- ДОБАВИТЬ -->\n    <section id=\"tab-add\" class=\"tab\">\n      <button id=\"payBanner\" class=\"banner hidden\"></button>\n      <div class=\"card\">\n        <div id=\"editBadge\" class=\"edit-badge hidden\">✎ Редактирование записи</div>\n        <div class=\"seg\" id=\"typeSeg\">\n          <button data-type=\"Доход\" class=\"inc on\">＋ Доход</button>\n          <button data-type=\"Расход\" class=\"exp\">− Расход</button>\n        </div>\n        <div class=\"amount\">\n          <input id=\"amount\" inputmode=\"decimal\" placeholder=\"0\" autocomplete=\"off\" enterkeyhint=\"done\">\n          <span>₽</span>\n        </div>\n      </div>\n\n      <div class=\"card\">\n        <label class=\"lbl\">Дата</label>\n        <div class=\"dates\">\n          <button class=\"chip\" data-shift=\"0\">Сегодня</button>\n          <button class=\"chip\" data-shift=\"-1\">Вчера</button>\n          <input type=\"date\" id=\"date\">\n        </div>\n\n        <label class=\"lbl\">Категория</label>\n        <div id=\"cats\" class=\"chips\"></div>\n\n        <label class=\"lbl\">Способ оплаты</label>\n        <div id=\"methods\" class=\"chips\"></div>\n\n        <label class=\"lbl\">Комментарий</label>\n        <textarea id=\"comment\" rows=\"2\" placeholder=\"Например: МК «Ваза», 3 человека\"></textarea>\n\n        <button id=\"saveBtn\" class=\"primary\">Сохранить</button>\n        <div id=\"editRow\" class=\"edit-row hidden\">\n          <button id=\"cancelEdit\" class=\"ghost\">Отмена</button>\n          <button id=\"delBtn\" class=\"danger\">Удалить</button>\n        </div>\n      </div>\n\n      <div class=\"card mini\" id=\"todayLine\"></div>\n    </section>\n\n    <!-- ЖУРНАЛ -->\n    <section id=\"tab-log\" class=\"tab\">\n      <div class=\"month\">\n        <button data-step=\"-1\">‹</button><div class=\"title js-month\"></div><button data-step=\"1\">›</button>\n      </div>\n      <div class=\"totals\" id=\"logTotals\"></div>\n      <div id=\"logList\"></div>\n    </section>\n\n    <!-- ПЛАТЕЖИ -->\n    <section id=\"tab-pay\" class=\"tab\">\n      <div class=\"card\">\n        <div class=\"calhead\"><button id=\"calPrev\">‹</button><div class=\"title\" id=\"calTitle\"></div><button id=\"calNext\">›</button></div>\n        <div class=\"cgrid\" id=\"calGrid\"></div>\n        <div class=\"legend\">\n          <span><i class=\"d-exp\"></i>оплатить</span><span><i class=\"d-inc\"></i>ждём деньги</span>\n          <span><i class=\"d-task\"></i>дела</span><span><i class=\"d-ev\"></i>события</span>\n        </div>\n        <div id=\"calWarn\"></div>\n      </div>\n      <div class=\"dayhead\"><b id=\"dayTitle\"></b><small id=\"dayCash\"></small></div>\n      <div id=\"dayList\"></div>\n      <div class=\"dadd\">\n        <button id=\"dAddEv\">＋ Событие</button><button id=\"dAddPay\">＋ Платёж</button><button id=\"dAddTask\">＋ Дело</button>\n      </div>\n\n      <div class=\"head-row\" style=\"margin-top:24px\"><h2>Платежи</h2><button class=\"add-btn\" id=\"payAdd\">＋ Платёж</button></div>\n      <div class=\"totals\" id=\"payTotals\"></div>\n      <div id=\"payList\"></div>\n    </section>\n\n    <!-- ДЕЛА -->\n    <section id=\"tab-task\" class=\"tab\">\n      <div class=\"head-row\"><h2>Дела</h2></div>\n      <div class=\"task-new\">\n        <input type=\"text\" id=\"taskText\" placeholder=\"Что нужно сделать?\" enterkeyhint=\"done\" autocomplete=\"off\">\n        <button id=\"taskAdd\">＋</button>\n      </div>\n      <div class=\"task-opts\" id=\"taskOpts\">\n        <span style=\"font-size:13px;color:var(--mute);font-weight:700\">Срок:</span>\n        <button class=\"chip on\" data-due=\"\">без срока</button>\n        <button class=\"chip\" data-due=\"0\">сегодня</button>\n        <button class=\"chip\" data-due=\"1\">завтра</button>\n        <input type=\"date\" id=\"taskDue\">\n      </div>\n      <div class=\"task-opts\" id=\"taskRep\">\n        <span style=\"font-size:13px;color:var(--mute);font-weight:700\">Повтор:</span>\n        <button class=\"chip on\" data-rep=\"Разово\">нет</button>\n        <button class=\"chip\" data-rep=\"Ежедневно\">каждый день</button>\n        <button class=\"chip\" data-rep=\"Еженедельно\">неделя</button>\n        <button class=\"chip\" data-rep=\"Ежемесячно\">месяц</button>\n        <button class=\"chip\" data-rep=\"Ежеквартально\">квартал</button>\n        <button class=\"chip\" data-rep=\"Ежегодно\">год</button>\n      </div>\n      <div id=\"taskList\"></div>\n    </section>\n\n    <!-- ИТОГИ -->\n    <section id=\"tab-sum\" class=\"tab\">\n      <div class=\"month\">\n        <button data-step=\"-1\">‹</button><div class=\"title js-month\"></div><button data-step=\"1\">›</button>\n      </div>\n      <div class=\"big\">\n        <div class=\"kpi inc\"><small>Доходы</small><b id=\"kInc\">0 ₽</b></div>\n        <div class=\"kpi exp\"><small>Расходы</small><b id=\"kExp\">0 ₽</b></div>\n      </div>\n      <div class=\"profit\"><small>Прибыль за месяц</small><b id=\"kProfit\">0 ₽</b></div>\n      <div class=\"card bars\" id=\"incBars\"></div>\n      <div class=\"card bars\" id=\"expBars\"></div>\n      <div class=\"card\">\n        <h3 style=\"margin:0 0 8px;font-size:15px\" id=\"yearTitle\"></h3>\n        <table class=\"year\" id=\"yearTable\"></table>\n      </div>\n      <a id=\"sheetLink\" class=\"link-btn\" target=\"_blank\" href=\"#\">Открыть Google Таблицу ↗</a>\n    </section>\n  </main>\n\n  <nav class=\"bottom\"><div class=\"in\">\n    <button data-tab=\"add\" class=\"on\"><span class=\"ic\">＋</span>Добавить</button>\n    <button data-tab=\"log\"><span class=\"ic\">☰</span>Журнал</button>\n    <button data-tab=\"pay\"><span class=\"ic\">▦</span>Календарь<span class=\"badge hidden\" id=\"payBadge\"></span></button>\n    <button data-tab=\"task\"><span class=\"ic\">✓</span>Дела<span class=\"badge hidden\" id=\"taskBadge\"></span></button>\n    <button data-tab=\"sum\"><span class=\"ic\">∑</span>Итоги</button>\n  </div></nav>\n</div>\n\n<div id=\"pinScreen\" class=\"overlay hidden\">\n  <div class=\"pinbox\">\n    <div class=\"logo\"><i></i><i></i><i></i><i></i></div>\n    <h2 style=\"margin:0 0 6px\">Art Mosaic</h2>\n    <p style=\"color:var(--ink2);margin:0 0 18px\">Введите ПИН-код</p>\n    <input id=\"pinInput\" type=\"password\" inputmode=\"numeric\" autocomplete=\"off\" maxlength=\"8\">\n    <button id=\"pinBtn\" class=\"primary\">Войти</button>\n  </div>\n</div>\n<div id=\"modal\" class=\"modal hidden\"><div class=\"panel\" id=\"modalPanel\"></div></div>\n<div id=\"toast\"></div>\n\n<script>\nconst MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];\nconst MONTHS_GEN = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];\nconst WD = ['вс','пн','вт','ср','чт','пт','сб'];\nconst PALETTE = ['#E86A92','#3BA8B5','#F2B544','#7B5EA7','#1F9D6B','#E98A4F','#5C7FD6','#C45BAA','#8AB04A','#D9485F'];\n\nconst $ = s => document.querySelector(s);\nconst $$ = s => Array.from(document.querySelectorAll(s));\nconst store = {\n  get(k, d){ try{ const v = localStorage.getItem('am_'+k); return v ? JSON.parse(v) : d; }catch(e){ return d; } },\n  set(k, v){ try{ localStorage.setItem('am_'+k, JSON.stringify(v)); }catch(e){} }\n};\n\nconst S = {\n  ops: [], pays: [], tasks: [], cats: {income:[], expense:[], methods:[]}, url: '#',\n  taskDue: '', taskRep: 'Разово', showDone: false,\n  calMonth: todayStr().slice(0,7), calDay: todayStr(), events: {}, calOk: true,\n  type: 'Доход', cat: '', method: store.get('method',''), date: todayStr(),\n  editId: null, month: todayStr().slice(0,7), pin: store.get('pin',''), busy: false\n};\n\n/* ---------- утилиты ---------- */\nfunction todayStr(shift){\n  const d = new Date(); d.setDate(d.getDate() + (shift||0));\n  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');\n}\nfunction money(n, sign){\n  const s = Math.abs(n).toLocaleString('ru-RU',{maximumFractionDigits:2}) + ' ₽';\n  if (!sign) return (n<0?'−':'') + s;\n  return (n<0?'− ':'+ ') + s;\n}\nfunction esc(s){ return String(s).replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c])); }\nfunction monthTitle(ym){ const [y,m] = ym.split('-'); return MONTHS[+m-1] + ' ' + y; }\nfunction shiftMonth(ym, k){ let [y,m] = ym.split('-').map(Number); m += k; while(m<1){m+=12;y--} while(m>12){m-=12;y++} return y+'-'+String(m).padStart(2,'0'); }\nfunction dayTitle(ds){\n  const d = new Date(ds+'T12:00:00');\n  const t = todayStr(), y = todayStr(-1);\n  const base = d.getDate()+' '+MONTHS_GEN[d.getMonth()]+', '+WD[d.getDay()];\n  return ds===t ? 'Сегодня · '+base : ds===y ? 'Вчера · '+base : base;\n}\nfunction toast(msg, err){\n  const t = $('#toast'); t.textContent = msg; t.className = 'show' + (err?' err':'');\n  clearTimeout(toast._t); toast._t = setTimeout(()=> t.className = err?'err':'', 2600);\n}\nfunction call(fn, ...args){\n  return new Promise((res, rej) => google.script.run.withSuccessHandler(res).withFailureHandler(rej)[fn](...args));\n}\nfunction errText(e){ return (e && e.message ? e.message : String(e)).replace(/^Error:\\s*/,''); }\n\n/* ---------- загрузка ---------- */\nasync function load(quiet){\n  const btn = $('#refreshBtn'); btn.classList.add('spin');\n  try{\n    const r = await call('apiInit', S.pin);\n    applyData(r);\n    saveCache();\n    if (quiet === 'manual') toast('Данные обновлены');\n  }catch(e){\n    const m = errText(e);\n    if (m.includes('PIN_REQUIRED')) { showPin(); }\n    else { S.loadError = m; renderCats(); toast('Нет связи с таблицей: ' + m, true); }\n  }finally{\n    btn.classList.remove('spin');\n    $('#boot').classList.add('hidden');\n    if (!$$('.tab.active').length) switchTab('add');\n  }\n}\nfunction saveCache(){ store.set('cache', {ops:S.ops, pays:S.pays, tasks:S.tasks, cats:S.cats, url:S.url}); }\nfunction applyData(r){\n  S.loadError = '';\n  S.ops = r.ops || S.ops; S.pays = r.pays || S.pays; S.tasks = r.tasks || S.tasks;\n  S.cats = r.cats || S.cats; S.url = r.url || S.url;\n  $('#sheetLink').href = S.url;\n  renderAll();\n}\n\n/* ---------- ПИН ---------- */\nfunction showPin(){ $('#pinScreen').classList.remove('hidden'); setTimeout(()=>$('#pinInput').focus(), 100); }\n$('#pinBtn').onclick = async () => {\n  S.pin = $('#pinInput').value.trim();\n  try{\n    const r = await call('apiInit', S.pin);\n    store.set('pin', S.pin);\n    $('#pinScreen').classList.add('hidden');\n    applyData(r);\n  }catch(e){ toast(errText(e).includes('PIN_REQUIRED') ? 'Неверный ПИН' : errText(e), true); }\n};\n$('#pinInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('#pinBtn').click(); });\n\n/* ---------- вкладки ---------- */\nfunction switchTab(name){\n  $$('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-'+name));\n  $$('nav.bottom button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));\n  window.scrollTo({top:0});\n  if (name === 'log') renderLog();\n  if (name === 'sum') renderSum();\n  if (name === 'pay') { renderPays(); renderCal(); loadEvents(S.calMonth); }\n  if (name === 'task') renderTasks();\n}\n$$('nav.bottom button').forEach(b => b.onclick = () => switchTab(b.dataset.tab));\n$$('.month button').forEach(b => b.onclick = () => { S.month = shiftMonth(S.month, +b.dataset.step); renderLog(); renderSum(); });\n$('#refreshBtn').onclick = () => load('manual');\n\n/* ---------- форма ---------- */\nfunction setType(t){\n  S.type = t;\n  document.body.className = t === 'Доход' ? 't-inc' : 't-exp';\n  $$('#typeSeg button').forEach(b => b.classList.toggle('on', b.dataset.type === t));\n  const list = t === 'Доход' ? S.cats.income : S.cats.expense;\n  if (!list.includes(S.cat)) S.cat = '';\n  renderCats();\n}\n$$('#typeSeg button').forEach(b => b.onclick = () => setType(b.dataset.type));\n\nfunction setDate(ds){\n  S.date = ds; $('#date').value = ds;\n  $$('.dates .chip').forEach(c => c.classList.toggle('on', todayStr(+c.dataset.shift) === ds));\n}\n$$('.dates .chip').forEach(c => c.onclick = () => setDate(todayStr(+c.dataset.shift)));\n$('#date').onchange = e => setDate(e.target.value || todayStr());\n\nfunction renderCats(){\n  const list = (S.type === 'Доход' ? S.cats.income : S.cats.expense).slice();\n  if (S.cat && !list.includes(S.cat)) list.push(S.cat);\n  $('#cats').innerHTML = list.map(c => `<button class=\"chip${c===S.cat?' on':''}\" data-v=\"${esc(c)}\">${esc(c)}</button>`).join('')\n    || (S.loadError\n      ? `<span style=\"color:var(--exp);font-size:14px\">⚠️ Не загрузилось из таблицы: ${esc(S.loadError)}<br>Нажмите ↻ или пришлите этот текст Светлане</span>`\n      : '<span style=\"color:var(--mute);font-size:14px\">Загружаю категории… если долго — нажмите ↻</span>');\n  $$('#cats .chip').forEach(b => b.onclick = () => { S.cat = S.cat === b.dataset.v ? '' : b.dataset.v; renderCats(); });\n}\nfunction renderMethods(){\n  const list = S.cats.methods.slice();\n  if (S.method && !list.includes(S.method)) list.push(S.method);\n  $('#methods').innerHTML = list.map(c => `<button class=\"chip${c===S.method?' on':''}\" data-v=\"${esc(c)}\">${esc(c)}</button>`).join('');\n  $$('#methods .chip').forEach(b => b.onclick = () => {\n    S.method = S.method === b.dataset.v ? '' : b.dataset.v;\n    if (!S.editId) store.set('method', S.method);\n    renderMethods();\n  });\n}\n\nfunction resetForm(){\n  S.editId = null; S.cat = '';\n  $('#amount').value = ''; $('#comment').value = '';\n  $('#editBadge').classList.add('hidden'); $('#editRow').classList.add('hidden');\n  $('#saveBtn').textContent = 'Сохранить';\n  S.method = store.get('method','');\n  setDate(todayStr()); renderCats(); renderMethods();\n}\n\nfunction editOp(id){\n  const op = S.ops.find(o => o.id === id); if (!op) return;\n  S.editId = id; S.cat = op.cat; S.method = op.method;\n  setType(op.type); setDate(op.date);\n  $('#amount').value = String(op.amount).replace('.', ',');\n  $('#comment').value = op.comment;\n  renderCats(); renderMethods();\n  $('#editBadge').classList.remove('hidden'); $('#editRow').classList.remove('hidden');\n  $('#saveBtn').textContent = 'Сохранить изменения';\n  switchTab('add');\n}\n$('#cancelEdit').onclick = () => { resetForm(); switchTab('log'); };\n\n$('#amount').addEventListener('input', e => {\n  let v = e.target.value.replace(/[^\\d.,\\s]/g,'').replace('.', ',');\n  const parts = v.split(','); if (parts.length > 2) v = parts[0] + ',' + parts.slice(1).join('');\n  e.target.value = v;\n});\n\n$('#saveBtn').onclick = async () => {\n  if (S.busy) return;\n  const amount = parseFloat($('#amount').value.replace(/\\s/g,'').replace(',', '.'));\n  if (!(amount > 0)) { toast('Введите сумму', true); $('#amount').focus(); return; }\n  if (!S.cat) { toast('Выберите категорию', true); return; }\n  const op = { id: S.editId, type: S.type, amount, cat: S.cat, method: S.method, comment: $('#comment').value, date: S.date };\n  const btn = $('#saveBtn'), label = btn.textContent;\n  S.busy = true; btn.disabled = true; btn.textContent = 'Сохраняю…';\n  try{\n    const r = await call('apiSave', S.pin, op);\n    const wasEdit = !!S.editId;\n    applyData(r); saveCache();\n    toast((wasEdit ? 'Изменено: ' : 'Записано: ') + money(op.type==='Доход'?amount:-amount, true) + ' · ' + op.cat);\n    resetForm();\n    if (wasEdit) switchTab('log');\n  }catch(e){\n    btn.textContent = label;\n    toast('Не сохранилось: ' + errText(e), true);\n  }finally{\n    S.busy = false; btn.disabled = false;\n    if (btn.textContent === 'Сохраняю…') btn.textContent = S.editId ? 'Сохранить изменения' : 'Сохранить';\n  }\n};\n\n$('#delBtn').onclick = async () => {\n  if (!S.editId || S.busy) return;\n  if (!confirm('Удалить эту запись из таблицы?')) return;\n  S.busy = true;\n  try{\n    const r = await call('apiDelete', S.pin, S.editId);\n    applyData(r); saveCache();\n    toast('Запись удалена'); resetForm(); switchTab('log');\n  }catch(e){ toast('Не удалилось: ' + errText(e), true); }\n  finally{ S.busy = false; }\n};\n\n/* ---------- подсчёты ---------- */\nfunction opsOfMonth(ym){ return S.ops.filter(o => o.date.slice(0,7) === ym); }\nfunction totals(list){\n  const inc = list.filter(o=>o.type==='Доход').reduce((s,o)=>s+o.amount,0);\n  const exp = list.filter(o=>o.type==='Расход').reduce((s,o)=>s+o.amount,0);\n  return {inc, exp, profit: inc-exp};\n}\n\nfunction renderToday(){\n  const t = totals(S.ops.filter(o => o.date === todayStr()));\n  const m = totals(opsOfMonth(todayStr().slice(0,7)));\n  $('#todayLine').innerHTML =\n    `<div>Сегодня<br><b class=\"inc-t\">${money(t.inc,true)}</b> · <b class=\"exp-t\">${money(-t.exp,true)}</b></div>\n     <div style=\"text-align:right\">${MONTHS[new Date().getMonth()]}: прибыль<br><b class=\"${m.profit<0?'exp-t':'inc-t'}\">${money(m.profit)}</b></div>`;\n}\n\nfunction renderLog(){\n  $$('.js-month').forEach(el => el.textContent = monthTitle(S.month));\n  const list = opsOfMonth(S.month).sort((a,b) => b.date.localeCompare(a.date) || b.added - a.added);\n  const t = totals(list);\n  $('#logTotals').innerHTML =\n    `<div class=\"tot\"><small>Доходы</small><b class=\"inc-t\">${money(t.inc)}</b></div>\n     <div class=\"tot\"><small>Расходы</small><b class=\"exp-t\">${money(t.exp)}</b></div>\n     <div class=\"tot\"><small>Прибыль</small><b class=\"${t.profit<0?'exp-t':''}\">${money(t.profit)}</b></div>`;\n  if (!list.length){\n    $('#logList').innerHTML = '<div class=\"empty\"><div>🧩</div>В этом месяце пока нет записей</div>';\n    return;\n  }\n  let html = '', cur = '';\n  list.forEach(o => {\n    if (o.date !== cur){\n      cur = o.date;\n      const d = totals(list.filter(x => x.date === cur));\n      html += `<div class=\"day\"><span>${dayTitle(cur)}</span><span>${money(d.profit, true)}</span></div>`;\n    }\n    const inc = o.type === 'Доход';\n    const sub = [o.method, o.comment].filter(Boolean).join(' · ');\n    html += `<button class=\"op\" data-id=\"${esc(o.id)}\">\n      <div class=\"dot ${inc?'inc':'exp'}\">${inc?'＋':'−'}</div>\n      <div class=\"mid\"><div class=\"cat\">${esc(o.cat)}</div>${sub?`<div class=\"com\">${esc(sub)}</div>`:''}</div>\n      <div class=\"sum ${inc?'inc':'exp'}\">${money(inc?o.amount:-o.amount, true)}</div>\n    </button>`;\n  });\n  $('#logList').innerHTML = html;\n  $$('#logList .op').forEach(b => b.onclick = () => editOp(b.dataset.id));\n}\n\nfunction bars(title, list, color){\n  const by = {};\n  list.forEach(o => by[o.cat] = (by[o.cat]||0) + o.amount);\n  const rows = Object.entries(by).sort((a,b) => b[1]-a[1]);\n  if (!rows.length) return `<h3>${title}</h3><div style=\"color:var(--mute);font-size:14px\">Нет записей</div>`;\n  const max = rows[0][1], total = rows.reduce((s,r)=>s+r[1],0);\n  return `<h3>${title}</h3>` + rows.map(([c,v],i) => `\n    <div class=\"bar\"><div class=\"t\"><span>${esc(c)}</span><span>${money(v)} <span style=\"color:var(--mute);font-weight:600\">· ${Math.round(v/total*100)}%</span></span></div>\n    <div class=\"track\"><div class=\"fill\" style=\"width:${Math.max(3, v/max*100)}%;background:${color==='inc'?PALETTE[(i+4)%PALETTE.length]:PALETTE[i%PALETTE.length]}\"></div></div></div>`).join('');\n}\n\nfunction renderSum(){\n  $$('.js-month').forEach(el => el.textContent = monthTitle(S.month));\n  const list = opsOfMonth(S.month), t = totals(list);\n  $('#kInc').textContent = money(t.inc);\n  $('#kExp').textContent = money(t.exp);\n  $('#kProfit').textContent = money(t.profit);\n  $('#kProfit').style.color = t.profit < 0 ? '#FF9AA9' : '#8EF0C4';\n  $('#incBars').innerHTML = bars('Доходы по категориям', list.filter(o=>o.type==='Доход'), 'inc');\n  $('#expBars').innerHTML = bars('Расходы по категориям', list.filter(o=>o.type==='Расход'), 'exp');\n\n  const y = S.month.slice(0,4);\n  $('#yearTitle').textContent = 'По месяцам · ' + y;\n  let rows = '', sum = {inc:0,exp:0,profit:0};\n  for (let m = 1; m <= 12; m++){\n    const ym = y + '-' + String(m).padStart(2,'0');\n    const tt = totals(opsOfMonth(ym));\n    if (!tt.inc && !tt.exp && ym !== S.month) continue;\n    sum.inc += tt.inc; sum.exp += tt.exp; sum.profit += tt.profit;\n    rows += `<tr data-ym=\"${ym}\" class=\"${ym===S.month?'cur':''}\"><td>${MONTHS[m-1]}</td>\n      <td class=\"inc-t\">${money(tt.inc)}</td><td class=\"exp-t\">${money(tt.exp)}</td>\n      <td class=\"${tt.profit<0?'exp-t':''}\">${money(tt.profit)}</td></tr>`;\n  }\n  $('#yearTable').innerHTML = `<thead><tr><th>Месяц</th><th>Доход</th><th>Расход</th><th>Прибыль</th></tr></thead>\n    <tbody>${rows}</tbody>\n    <tfoot><tr><td>Итого</td><td class=\"inc-t\">${money(sum.inc)}</td><td class=\"exp-t\">${money(sum.exp)}</td><td>${money(sum.profit)}</td></tr></tfoot>`;\n  $$('#yearTable tbody tr').forEach(r => r.onclick = () => { S.month = r.dataset.ym; renderSum(); renderLog(); });\n}\n\n/* ---------- общие помощники ---------- */\nconst MON_SHORT = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];\nfunction daysFromToday(ds){\n  const a = new Date(ds+'T12:00:00'), b = new Date(todayStr()+'T12:00:00');\n  return Math.round((a - b) / 86400000);\n}\nfunction dueLabel(ds){\n  const n = daysFromToday(ds), d = new Date(ds+'T12:00:00');\n  if (n === 0) return 'сегодня';\n  if (n === 1) return 'завтра';\n  if (n === -1) return 'вчера';\n  return d.getDate()+' '+MON_SHORT[d.getMonth()];\n}\nfunction chipsHtml(list, val, name){\n  return list.map(c => `<button class=\"chip${c===val?' on':''}\" data-${name}=\"${esc(c)}\">${esc(c)}</button>`).join('');\n}\nfunction bindChips(root, name, onPick){\n  root.querySelectorAll('[data-'+name+']').forEach(b => b.onclick = () => {\n    root.querySelectorAll('[data-'+name+']').forEach(x => x.classList.toggle('on', x === b && !b.classList.contains('on')));\n    onPick(b.classList.contains('on') ? b.dataset[name] : '');\n  });\n}\nfunction openModal(html){ $('#modalPanel').innerHTML = html; $('#modal').classList.remove('hidden'); }\nfunction closeModal(){ $('#modal').classList.add('hidden'); $('#modalPanel').innerHTML = ''; }\n$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });\nasync function run(fn, args, okMsg, btn){\n  if (S.busy) return false;\n  S.busy = true; let label;\n  if (btn){ label = btn.textContent; btn.disabled = true; btn.textContent = 'Сохраняю…'; }\n  try{\n    const r = await call(fn, S.pin, ...args);\n    applyData(r); saveCache();\n    if (okMsg) toast(okMsg);\n    return true;\n  }catch(e){\n    toast(errText(e), true);\n    return false;\n  }finally{\n    S.busy = false;\n    if (btn){ btn.disabled = false; btn.textContent = label; }\n  }\n}\n\n/* ---------- календарь платежей ---------- */\nconst REPEATS = ['Разово','Ежемесячно','Еженедельно','Ежеквартально','Ежегодно'];\nconst REP_SHORT = {'Ежемесячно':'каждый месяц','Еженедельно':'каждую неделю','Ежеквартально':'раз в квартал','Ежегодно':'раз в год'};\n\nfunction pendingPays(){ return S.pays.filter(p => p.status !== 'Оплачено').sort((a,b) => a.date.localeCompare(b.date)); }\n\nfunction renderPays(){\n  const list = pendingPays();\n  const ym = todayStr().slice(0,7);\n  const month = list.filter(p => p.date.slice(0,7) <= ym);\n  const out = month.filter(p => p.type==='Расход').reduce((s,p)=>s+p.amount,0);\n  const inn = month.filter(p => p.type==='Доход').reduce((s,p)=>s+p.amount,0);\n  const overdue = list.filter(p => daysFromToday(p.date) < 0);\n  $('#payTotals').innerHTML =\n    `<div class=\"tot\"><small>Оплатить до конца месяца</small><b class=\"exp-t\">${money(out)}</b></div>\n     <div class=\"tot\"><small>Ожидаем поступлений</small><b class=\"inc-t\">${money(inn)}</b></div>\n     <div class=\"tot\"><small>Просрочено</small><b class=\"${overdue.length?'exp-t':''}\">${overdue.length}</b></div>`;\n  if (!list.length){\n    $('#payList').innerHTML = '<div class=\"empty\"><div>📅</div>Платежей пока нет.<br>Добавьте аренду, налоги, закупки —<br>приложение напомнит о сроках.</div>';\n    return;\n  }\n  const groups = [\n    ['Просрочено', 'red', p => daysFromToday(p.date) < 0],\n    ['Сегодня и ближайшие 7 дней', 'amber', p => { const n = daysFromToday(p.date); return n >= 0 && n <= 7; }],\n    ['Позже в этом месяце', '', p => daysFromToday(p.date) > 7 && p.date.slice(0,7) === ym],\n    ['Следующие месяцы', '', p => daysFromToday(p.date) > 7 && p.date.slice(0,7) > ym]\n  ];\n  let html = '';\n  groups.forEach(([title, cls, f]) => {\n    const g = list.filter(f); if (!g.length) return;\n    html += `<div class=\"group ${cls}\">${title}</div>`;\n    g.forEach(p => {\n      const n = daysFromToday(p.date), d = new Date(p.date+'T12:00:00');\n      const inc = p.type === 'Доход';\n      const meta = [n<0 ? 'просрочен на '+(-n)+' дн.' : dueLabel(p.date), p.cat, p.method].filter(Boolean).join(' · ');\n      html += `<div class=\"pay ${n<0?'overdue':n<=3?'soon':''}\">\n        <div class=\"cal\"><b>${d.getDate()}</b><small>${MON_SHORT[d.getMonth()]}</small></div>\n        <button class=\"mid\" data-edit=\"${esc(p.id)}\">\n          <div class=\"nm\">${esc(p.name)}${p.repeat!=='Разово'?`<span class=\"rep\">↻ ${REP_SHORT[p.repeat]}</span>`:''}</div>\n          <div class=\"meta\">${esc(meta)}</div>\n        </button>\n        <div class=\"am ${inc?'inc-t':'exp-t'}\">${p.amount ? money(p.amount) : '—'}</div>\n        <button class=\"done-btn ${inc?'':'exp'}\" data-done=\"${esc(p.id)}\" title=\"${inc?'Получено':'Оплачено'}\">✓</button>\n      </div>`;\n    });\n  });\n  $('#payList').innerHTML = html;\n  $$('#payList [data-edit]').forEach(b => b.onclick = () => payForm(S.pays.find(p => p.id === b.dataset.edit)));\n  $$('#payList [data-done]').forEach(b => b.onclick = () => payDoneForm(S.pays.find(p => p.id === b.dataset.done)));\n}\n$('#payAdd').onclick = () => payForm(null);\n\nfunction payForm(p, presetDate){\n  const f = Object.assign({id:'', name:'', type:'Расход', cat:'', amount:'', date:presetDate || todayStr(), repeat:'Ежемесячно', method:'', comment:''}, p || {});\n  const catsOf = t => t === 'Доход' ? S.cats.income : S.cats.expense;\n  openModal(`\n    <h3>${p ? 'Платёж' : 'Новый платёж'}</h3>\n    <label class=\"lbl\" style=\"margin-top:12px\">Название</label>\n    <input class=\"field\" id=\"pName\" value=\"${esc(f.name)}\" placeholder=\"Например: Аренда студии\">\n    <div class=\"seg\" id=\"pType\" style=\"margin-top:12px\">\n      <button data-type=\"Расход\" class=\"exp\">− Нужно оплатить</button>\n      <button data-type=\"Доход\" class=\"inc\">＋ Ожидаем деньги</button>\n    </div>\n    <div style=\"display:grid;grid-template-columns:1fr 1fr;gap:10px\">\n      <div><label class=\"lbl\">Сумма, ₽</label><input class=\"field\" id=\"pAmount\" inputmode=\"decimal\" value=\"${f.amount?String(f.amount).replace('.',','):''}\" placeholder=\"0\"></div>\n      <div><label class=\"lbl\">Дата</label><input class=\"field\" id=\"pDate\" type=\"date\" value=\"${f.date}\"></div>\n    </div>\n    <label class=\"lbl\">Повтор</label><div class=\"chips\" id=\"pRep\">${chipsHtml(REPEATS, f.repeat, 'rep')}</div>\n    <label class=\"lbl\">Категория</label><div class=\"chips\" id=\"pCat\"></div>\n    <label class=\"lbl\">Способ оплаты</label><div class=\"chips\" id=\"pMeth\">${chipsHtml(S.cats.methods, f.method, 'meth')}</div>\n    <label class=\"lbl\">Комментарий</label><input class=\"field\" id=\"pCom\" value=\"${esc(f.comment)}\" placeholder=\"Необязательно\">\n    <button class=\"primary\" id=\"pSave\" style=\"background:var(--ink)\">Сохранить</button>\n    <div class=\"edit-row\">\n      <button class=\"ghost\" id=\"pCancel\">Отмена</button>\n      ${p ? '<button class=\"danger\" id=\"pDel\">Удалить</button>' : '<span></span>'}\n    </div>`);\n  const drawType = () => {\n    $$('#pType button').forEach(b => b.classList.toggle('on', b.dataset.type === f.type));\n    if (f.cat && !catsOf(f.type).includes(f.cat) && !(p && p.cat === f.cat)) f.cat = '';\n    const list = catsOf(f.type).slice(); if (f.cat && !list.includes(f.cat)) list.push(f.cat);\n    $('#pCat').innerHTML = chipsHtml(list, f.cat, 'cat');\n    bindChips($('#pCat'), 'cat', v => f.cat = v);\n  };\n  $$('#pType button').forEach(b => b.onclick = () => { f.type = b.dataset.type; drawType(); });\n  drawType();\n  bindChips($('#pRep'), 'rep', v => { f.repeat = v || 'Разово'; if (!v) $('#pRep [data-rep=\"Разово\"]').classList.add('on'); });\n  bindChips($('#pMeth'), 'meth', v => f.method = v);\n  $('#pCancel').onclick = closeModal;\n  $('#pSave').onclick = async () => {\n    const data = Object.assign({}, f, {\n      name: $('#pName').value, amount: $('#pAmount').value, date: $('#pDate').value, comment: $('#pCom').value\n    });\n    if (await run('apiPaySave', [data], p ? 'Платёж обновлён' : 'Платёж добавлен', $('#pSave'))) closeModal();\n  };\n  if (p) $('#pDel').onclick = async () => {\n    if (!confirm('Удалить платёж «'+p.name+'»' + (p.repeat!=='Разово' ? ' и все его повторы' : '') + '?')) return;\n    if (await run('apiPayDelete', [p.id], 'Платёж удалён')) closeModal();\n  };\n}\n\nfunction payDoneForm(p){\n  const inc = p.type === 'Доход';\n  let method = p.method;\n  const next = p.repeat !== 'Разово' ? nextDateJs(p.date, p.repeat) : '';\n  openModal(`\n    <h3>${inc ? 'Деньги получены' : 'Платёж оплачен'}</h3>\n    <div class=\"hint\">${esc(p.name)} — запишется в журнал как ${inc ? 'доход' : 'расход'}${p.cat ? ' «'+esc(p.cat)+'»' : ''}</div>\n    <label class=\"lbl\" style=\"margin-top:14px\">Сумма, ₽</label>\n    <input class=\"field big ${inc?'inc-t':'exp-t'}\" id=\"dAmount\" inputmode=\"decimal\" value=\"${p.amount?String(p.amount).replace('.',','):''}\" placeholder=\"0\">\n    <label class=\"lbl\">Дата оплаты</label>\n    <input class=\"field\" id=\"dDate\" type=\"date\" value=\"${todayStr()}\">\n    <label class=\"lbl\">Способ оплаты</label><div class=\"chips\" id=\"dMeth\">${chipsHtml(S.cats.methods, method, 'meth')}</div>\n    ${next ? `<div class=\"hint\" style=\"margin-top:12px\">↻ Следующий срок: <b>${dueLabel(next)} ${next.slice(0,4)}</b></div>` : ''}\n    <button class=\"primary\" id=\"dSave\" style=\"background:${inc?'var(--inc)':'var(--exp)'}\">${inc ? 'Получено' : 'Оплачено'} — записать</button>\n    <div class=\"edit-row\" style=\"grid-template-columns:1fr\"><button class=\"ghost\" id=\"dCancel\">Отмена</button></div>`);\n  bindChips($('#dMeth'), 'meth', v => method = v);\n  $('#dCancel').onclick = closeModal;\n  $('#dSave').onclick = async () => {\n    const amount = parseFloat($('#dAmount').value.replace(/\\s/g,'').replace(',', '.'));\n    if (!(amount > 0)) { toast('Введите сумму', true); return; }\n    const ok = await run('apiPayDone', [p.id, {amount, date: $('#dDate').value || todayStr(), method}],\n      (inc ? 'Получено: ' : 'Оплачено: ') + money(amount) + ' · записано в журнал', $('#dSave'));\n    if (ok) closeModal();\n  };\n}\n\nfunction nextDateJs(ds, repeat){\n  const [y,m,d] = ds.split('-').map(Number);\n  let t;\n  if (repeat === 'Ежедневно') t = new Date(Date.UTC(y, m-1, d+1));\n  else if (repeat === 'Еженедельно') t = new Date(Date.UTC(y, m-1, d+7));\n  else {\n    const add = repeat === 'Ежеквартально' ? 3 : repeat === 'Ежегодно' ? 12 : 1;\n    const last = new Date(Date.UTC(y, m-1+add+1, 0)).getUTCDate();\n    t = new Date(Date.UTC(y, m-1+add, Math.min(d, last)));\n  }\n  return t.toISOString().slice(0,10);\n}\n\n/* ---------- список дел ---------- */\nfunction setTaskDue(v){\n  S.taskDue = v;\n  $$('#taskOpts .chip').forEach(c => c.classList.toggle('on',\n    (c.dataset.due === '' && !v) || (c.dataset.due !== '' && v && todayStr(+c.dataset.due) === v)));\n  $('#taskDue').value = v || '';\n}\n$$('#taskOpts .chip').forEach(c => c.onclick = () => setTaskDue(c.dataset.due === '' ? '' : todayStr(+c.dataset.due)));\n$('#taskDue').onchange = e => setTaskDue(e.target.value);\n\nconst TASK_REP = [['Разово','нет'],['Ежедневно','каждый день'],['Еженедельно','неделя'],['Ежемесячно','месяц'],['Ежеквартально','квартал'],['Ежегодно','год']];\nconst TASK_REP_LONG = {'Ежедневно':'каждый день','Еженедельно':'каждую неделю','Ежемесячно':'каждый месяц','Ежеквартально':'раз в квартал','Ежегодно':'раз в год'};\nfunction setTaskRep(v){\n  S.taskRep = v;\n  $$('#taskRep .chip').forEach(c => c.classList.toggle('on', c.dataset.rep === v));\n}\n$$('#taskRep .chip').forEach(c => c.onclick = () => setTaskRep(c.dataset.rep));\nfunction repChips(id, val){\n  return `<div class=\"chips\" id=\"${id}\">${TASK_REP.map(r => `<button class=\"chip${r[0]===val?' on':''}\" data-rep=\"${r[0]}\">${r[1]}</button>`).join('')}</div>`;\n}\nfunction bindRep(id, onPick){\n  $$('#'+id+' .chip').forEach(b => b.onclick = () => { $$('#'+id+' .chip').forEach(x => x.classList.toggle('on', x === b)); onPick(b.dataset.rep); });\n}\n\nasync function addTask(){\n  const text = $('#taskText').value.trim();\n  if (!text) { $('#taskText').focus(); return; }\n  const ok = await run('apiTaskSave', [{text, due: S.taskDue, repeat: S.taskRep}],\n    S.taskRep !== 'Разово' ? 'Регулярное дело добавлено ↻' : 'Задача добавлена');\n  if (ok){ $('#taskText').value = ''; setTaskDue(''); setTaskRep('Разово'); }\n}\n$('#taskAdd').onclick = addTask;\n$('#taskText').addEventListener('keydown', e => { if (e.key === 'Enter') addTask(); });\n\nfunction taskHtml(t){\n  let due = '';\n  if (t.due && !t.done){\n    const n = daysFromToday(t.due);\n    due = `<span class=\"due ${n<0?'red':n===0?'amber':''}\">${dueLabel(t.due)}</span>`;\n  }\n  return `<div class=\"task ${t.done?'done':''}\">\n    <button class=\"check\" data-check=\"${esc(t.id)}\">${t.done?'✓':''}</button>\n    <button class=\"tx\" data-tedit=\"${esc(t.id)}\">${esc(t.text)}${t.repeat && t.repeat!=='Разово' && !t.done ? `<span class=\"rep\">↻ ${TASK_REP_LONG[t.repeat]}</span>` : ''}</button>${due}</div>`;\n}\n\nfunction renderTasks(){\n  const open = S.tasks.filter(t => !t.done).sort((a,b) =>\n    (a.due||'9999') .localeCompare(b.due||'9999') || a.created - b.created);\n  const done = S.tasks.filter(t => t.done).sort((a,b) => b.doneAt - a.doneAt);\n  let html = '';\n  if (!open.length) html += '<div class=\"empty\"><div>✨</div>Все дела сделаны</div>';\n  const over = open.filter(t => t.due && daysFromToday(t.due) < 0);\n  const today = open.filter(t => t.due && daysFromToday(t.due) === 0);\n  const later = open.filter(t => t.due && daysFromToday(t.due) > 0);\n  const nodate = open.filter(t => !t.due);\n  [['Просрочено','red',over],['Сегодня','amber',today],['Скоро','',later],['Без срока','',nodate]].forEach(([title,cls,g]) => {\n    if (!g.length) return;\n    html += `<div class=\"group ${cls}\">${title}</div>` + g.map(taskHtml).join('');\n  });\n  if (done.length){\n    html += `<button class=\"toggle-done\" id=\"toggleDone\">${S.showDone ? 'Скрыть выполненные' : 'Выполненные ('+done.length+')'}</button>`;\n    if (S.showDone) html += '<div style=\"margin-top:8px\">' + done.slice(0,40).map(taskHtml).join('') + '</div>';\n  }\n  $('#taskList').innerHTML = html;\n  $$('#taskList [data-check]').forEach(b => b.onclick = () => toggleTask(b.dataset.check));\n  $$('#taskList [data-tedit]').forEach(b => b.onclick = () => taskForm(S.tasks.find(t => t.id === b.dataset.tedit)));\n  const td = $('#toggleDone'); if (td) td.onclick = () => { S.showDone = !S.showDone; renderTasks(); };\n}\n\nasync function toggleTask(id){\n  const t = S.tasks.find(x => x.id === id); if (!t) return;\n  const was = t.done;\n  t.done = !was; t.doneAt = Date.now();          // сразу показываем, потом сохраняем\n  renderTasks(); renderBadges();\n  try{\n    const r = await call('apiTaskToggle', S.pin, id, t.done);\n    applyData(r); saveCache();\n    if (t.done && t.repeat && t.repeat !== 'Разово' && t.due){\n      let next = nextDateJs(t.due, t.repeat); while (next <= todayStr()) next = nextDateJs(next, t.repeat);\n      toast('✓ Сделано · ↻ следующее — ' + dueLabel(next));\n    }\n  }catch(e){\n    t.done = was; renderTasks(); renderBadges();\n    toast('Не сохранилось: ' + errText(e), true);\n  }\n}\n\nfunction taskForm(t){\n  openModal(`\n    <h3>Задача</h3>\n    <label class=\"lbl\" style=\"margin-top:12px\">Что сделать</label>\n    <textarea class=\"field\" id=\"tText\" rows=\"3\">${esc(t.text)}</textarea>\n    <label class=\"lbl\">Срок</label>\n    <input class=\"field\" id=\"tDue\" type=\"date\" value=\"${t.due||''}\">\n    <label class=\"lbl\">Повтор</label>${repChips('tRep', t.repeat || 'Разово')}\n    <button class=\"primary\" id=\"tSave\" style=\"background:var(--ink)\">Сохранить</button>\n    <div class=\"edit-row\"><button class=\"ghost\" id=\"tCancel\">Отмена</button><button class=\"danger\" id=\"tDel\">Удалить</button></div>`);\n  let rep = t.repeat || 'Разово';\n  bindRep('tRep', v => rep = v);\n  $('#tCancel').onclick = closeModal;\n  $('#tSave').onclick = async () => {\n    if (await run('apiTaskSave', [{id:t.id, text:$('#tText').value, due:$('#tDue').value, repeat: rep}], 'Задача обновлена', $('#tSave'))) closeModal();\n  };\n  $('#tDel').onclick = async () => {\n    if (!confirm('Удалить задачу?')) return;\n    if (await run('apiTaskDelete', [t.id], 'Задача удалена')) closeModal();\n  };\n}\n\n/* ---------- календарь ---------- */\nconst WD_SHORT = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];\nconst EV_KINDS = [['🚚','Поставка'],['🤝','Встреча'],['🎨','МК'],['🎉','Праздник'],['📞','Созвон'],['📌','Другое']];\n\nasync function loadEvents(ym, force){\n  if (S.events[ym] && !force) return;\n  try{\n    const r = await call('apiEvents', S.pin, ym);\n    S.events[ym] = r.events || []; S.calOk = r.ok !== false;\n    renderCal();\n  }catch(e){ S.calOk = false; renderCal(); }\n}\n\nfunction dayItems(ds){\n  return {\n    pays: S.pays.filter(p => p.date === ds && p.status !== 'Оплачено'),\n    tasks: S.tasks.filter(t => t.due === ds),\n    events: (S.events[ds.slice(0,7)] || []).filter(e => e.day === ds).sort((a,b) => (a.start||'').localeCompare(b.start||'')),\n    ops: S.ops.filter(o => o.date === ds)\n  };\n}\n\nfunction renderCal(){\n  if (!$('#calGrid')) return;\n  const [y, m] = S.calMonth.split('-').map(Number);\n  $('#calTitle').textContent = MONTHS[m-1] + ' ' + y;\n  const first = new Date(y, m-1, 1), shift = (first.getDay() + 6) % 7;\n  const start = new Date(y, m-1, 1 - shift);\n  let html = WD_SHORT.map((w,i) => `<div class=\"wd${i>4?' we':''}\">${w}</div>`).join('');\n  const today = todayStr();\n  for (let i = 0; i < 42; i++){\n    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);\n    const ds = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');\n    if (i >= 35 && d.getMonth() !== m-1) break;\n    const it = dayItems(ds);\n    const dots = [];\n    if (it.pays.some(p => p.type==='Расход')) dots.push('d-exp');\n    if (it.pays.some(p => p.type==='Доход')) dots.push('d-inc');\n    if (it.tasks.some(t => !t.done)) dots.push('d-task');\n    if (it.events.length) dots.push('d-ev');\n    html += `<button class=\"cday${d.getMonth()!==m-1?' out':''}${ds===today?' today':''}${ds===S.calDay?' sel':''}\" data-ds=\"${ds}\">\n      ${d.getDate()}<span class=\"dots\">${dots.map(c=>`<i class=\"${c}\"></i>`).join('')}</span></button>`;\n  }\n  $('#calGrid').innerHTML = html;\n  $$('#calGrid .cday').forEach(b => b.onclick = () => {\n    S.calDay = b.dataset.ds;\n    if (S.calDay.slice(0,7) !== S.calMonth){ S.calMonth = S.calDay.slice(0,7); loadEvents(S.calMonth); }\n    renderCal();\n  });\n  $('#calWarn').innerHTML = S.calOk ? '' : '<div class=\"calwarn\">Google Календарь ещё не подключён — платежи и дела видны, а события появятся после запуска setupCalendar в Apps Script.</div>';\n  renderDay();\n}\n\nfunction renderDay(){\n  const ds = S.calDay, it = dayItems(ds);\n  $('#dayTitle').textContent = dayTitle(ds);\n  const t = totals(it.ops);\n  $('#dayCash').innerHTML = [t.inc ? `<span class=\"inc-t\">+${money(t.inc)}</span>` : '', t.exp ? `<span class=\"exp-t\">−${money(t.exp)}</span>` : ''].filter(Boolean).join(' · ');\n  let html = '';\n  it.events.forEach(e => {\n    html += `<div class=\"ditem\"><span class=\"tm\">${e.start || 'весь день'}</span>\n      <div class=\"tx\">${esc(e.title)}${e.end ? `<small>до ${e.end}</small>` : ''}</div>\n      <button class=\"x\" data-evdel=\"${esc(e.id)}\" title=\"Убрать\">✕</button></div>`;\n  });\n  it.pays.forEach(p => {\n    const inc = p.type === 'Доход';\n    html += `<div class=\"ditem\"><span class=\"tm\" style=\"color:${inc?'var(--inc)':'var(--exp)'}\">${inc?'💰':'💳'}</span>\n      <button class=\"tx\" data-pedit=\"${esc(p.id)}\">${esc(p.name)}<small>${p.amount?money(p.amount):'сумма не указана'}${p.repeat!=='Разово'?' · ↻ '+REP_SHORT[p.repeat]:''}</small></button>\n      <button class=\"done-btn ${inc?'':'exp'}\" data-pdone=\"${esc(p.id)}\" style=\"width:36px;height:36px\">✓</button></div>`;\n  });\n  it.tasks.forEach(tk => {\n    html += `<div class=\"ditem task ${tk.done?'done':''}\" style=\"padding:10px 12px\"><button class=\"check\" data-check=\"${esc(tk.id)}\">${tk.done?'✓':''}</button>\n      <button class=\"tx\" data-tedit=\"${esc(tk.id)}\">${esc(tk.text)}</button></div>`;\n  });\n  if (!html) html = '<div style=\"text-align:center;color:var(--mute);font-size:14px;padding:14px 0\">На этот день ничего нет 🐣</div>';\n  $('#dayList').innerHTML = html;\n  $$('#dayList [data-evdel]').forEach(b => b.onclick = async () => {\n    if (!confirm('Убрать событие из календаря?')) return;\n    try{ const r = await call('apiEventDelete', S.pin, b.dataset.evdel, S.calDay.slice(0,7)); S.events[S.calDay.slice(0,7)] = r.events; renderCal(); toast('Убрала из календаря'); }\n    catch(e){ toast(errText(e), true); }\n  });\n  $$('#dayList [data-pedit]').forEach(b => b.onclick = () => payForm(S.pays.find(p => p.id === b.dataset.pedit)));\n  $$('#dayList [data-pdone]').forEach(b => b.onclick = () => payDoneForm(S.pays.find(p => p.id === b.dataset.pdone)));\n  $$('#dayList [data-check]').forEach(b => b.onclick = async () => { await toggleTask(b.dataset.check); renderCal(); });\n  $$('#dayList [data-tedit]').forEach(b => b.onclick = () => taskForm(S.tasks.find(t => t.id === b.dataset.tedit)));\n}\n\n$('#calPrev').onclick = () => { S.calMonth = shiftMonth(S.calMonth, -1); S.calDay = S.calMonth + '-01'; renderCal(); loadEvents(S.calMonth); };\n$('#calNext').onclick = () => { S.calMonth = shiftMonth(S.calMonth, 1); S.calDay = S.calMonth + '-01'; renderCal(); loadEvents(S.calMonth); };\n$('#dAddPay').onclick = () => payForm(null, S.calDay);\n$('#dAddTask').onclick = () => openTaskNew(S.calDay);\n$('#dAddEv').onclick = () => eventForm(S.calDay);\n\nfunction openTaskNew(ds){\n  openModal(`<h3>Новое дело</h3>\n    <label class=\"lbl\" style=\"margin-top:12px\">Что сделать</label>\n    <textarea class=\"field\" id=\"ntText\" rows=\"2\" placeholder=\"Например: заказать клей\"></textarea>\n    <label class=\"lbl\">Срок</label><input class=\"field\" id=\"ntDue\" type=\"date\" value=\"${ds}\">\n    <label class=\"lbl\">Повтор</label>${repChips('ntRep', 'Разово')}\n    <button class=\"primary\" id=\"ntSave\" style=\"background:var(--ink)\">Добавить</button>\n    <div class=\"edit-row\" style=\"grid-template-columns:1fr\"><button class=\"ghost\" id=\"ntCancel\">Отмена</button></div>`);\n  let rep = 'Разово';\n  bindRep('ntRep', v => rep = v);\n  $('#ntCancel').onclick = closeModal;\n  $('#ntSave').onclick = async () => {\n    if (await run('apiTaskSave', [{text: $('#ntText').value, due: $('#ntDue').value, repeat: rep}], 'Дело добавлено', $('#ntSave'))) { closeModal(); renderCal(); }\n  };\n  setTimeout(() => $('#ntText').focus(), 100);\n}\n\nfunction eventForm(ds){\n  let kind = EV_KINDS[0], minutes = 60;\n  const durs = [[30,'30 мин'],[60,'1 ч'],[120,'2 ч'],[180,'3 ч']];\n  openModal(`<h3>Событие в календарь</h3>\n    <label class=\"lbl\" style=\"margin-top:12px\">Что</label>\n    <div class=\"chips\" id=\"eKind\">${EV_KINDS.map((k,i) => `<button class=\"chip${i===0?' on':''}\" data-k=\"${i}\">${k[0]} ${k[1]}</button>`).join('')}</div>\n    <input class=\"field\" id=\"eTitle\" style=\"margin-top:10px\" placeholder=\"Например: стекло от «Витраж-Сиб»\">\n    <div style=\"display:grid;grid-template-columns:1fr 1fr;gap:10px\">\n      <div><label class=\"lbl\">Дата</label><input class=\"field\" id=\"eDate\" type=\"date\" value=\"${ds}\"></div>\n      <div><label class=\"lbl\">Время</label><input class=\"field\" id=\"eTime\" type=\"time\" placeholder=\"весь день\"></div>\n    </div>\n    <label class=\"lbl\">Длительность</label>\n    <div class=\"chips\" id=\"eDur\">${durs.map(d => `<button class=\"chip${d[0]===60?' on':''}\" data-m=\"${d[0]}\">${d[1]}</button>`).join('')}</div>\n    <div class=\"hint\">Без времени — событие на весь день. Напоминание придёт за час и накануне.</div>\n    <label class=\"lbl\">Заметка</label><input class=\"field\" id=\"eDesc\" placeholder=\"Необязательно\">\n    <button class=\"primary\" id=\"eSave\" style=\"background:var(--teal)\">Добавить в календарь</button>\n    <div class=\"edit-row\" style=\"grid-template-columns:1fr\"><button class=\"ghost\" id=\"eCancel\">Отмена</button></div>`);\n  $$('#eKind .chip').forEach(b => b.onclick = () => { kind = EV_KINDS[+b.dataset.k]; $$('#eKind .chip').forEach(x => x.classList.toggle('on', x === b)); });\n  $$('#eDur .chip').forEach(b => b.onclick = () => { minutes = +b.dataset.m; $$('#eDur .chip').forEach(x => x.classList.toggle('on', x === b)); });\n  $('#eCancel').onclick = closeModal;\n  $('#eSave').onclick = async () => {\n    const extra = $('#eTitle').value.trim();\n    const label = kind[1] === 'Другое' ? '' : kind[1];\n    const title = (kind[0] + ' ' + [label, extra].filter(Boolean).join(' ')).trim();\n    if (!extra && kind[1] === 'Другое') { toast('Напишите, что за событие', true); return; }\n    const date = $('#eDate').value || ds;\n    const btn = $('#eSave'); btn.disabled = true; btn.textContent = 'Сохраняю…';\n    try{\n      const r = await call('apiEventAdd', S.pin, {title, date, start: $('#eTime').value, minutes, desc: $('#eDesc').value});\n      S.events[date.slice(0,7)] = r.events; S.calDay = date; S.calMonth = date.slice(0,7);\n      closeModal(); renderCal(); toast('🗓 Добавила в календарь');\n    }catch(e){ toast(errText(e), true); btn.disabled = false; btn.textContent = 'Добавить в календарь'; }\n  };\n}\n\n/* ---------- значки и напоминания ---------- */\nfunction renderBadges(){\n  const urgentPays = pendingPays().filter(p => daysFromToday(p.date) <= 3);\n  const nowPays = urgentPays.filter(p => daysFromToday(p.date) <= 0);\n  const urgentTasks = S.tasks.filter(t => !t.done && t.due && daysFromToday(t.due) <= 0);\n  const pb = $('#payBadge'), tb = $('#taskBadge');\n  pb.textContent = urgentPays.length; pb.classList.toggle('hidden', !urgentPays.length);\n  tb.textContent = urgentTasks.length; tb.classList.toggle('hidden', !urgentTasks.length);\n\n  const ban = $('#payBanner');\n  if (urgentPays.length){\n    const over = nowPays.some(p => daysFromToday(p.date) < 0);\n    const names = urgentPays.slice(0,3).map(p => p.name + ' — ' + dueLabel(p.date)).join(', ');\n    ban.className = 'banner' + (over ? ' red' : '');\n    ban.innerHTML = `<span style=\"font-size:20px\">${over?'⚠️':'📅'}</span><span><b>${over?'Платежи требуют внимания':'Скоро платежи'}:</b> ${esc(names)}${urgentPays.length>3?' и ещё '+(urgentPays.length-3):''}</span>`;\n    ban.onclick = () => switchTab('pay');\n  } else ban.className = 'banner hidden';\n}\n\nfunction renderAll(){\n  setType(S.type); renderMethods(); renderToday();\n  renderLog(); renderSum(); renderPays(); renderTasks(); renderBadges(); renderCal();\n}\n\n\n/* ---------- старт ---------- */\nsetDate(todayStr());\nconst cache = store.get('cache', null);\nif (cache){ applyData(cache); $('#boot').classList.add('hidden'); switchTab('add'); }\nload();\n</script>\n</body>\n</html>\n";
