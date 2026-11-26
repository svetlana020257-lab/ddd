/* Продажа сертификата прямо из конструктора:
   номер выдаёт Google Таблица (без повторов с любого устройства), продажа пишется в доходы кассы.
   Подключение: <script src="sale.js"></script> после shared.js, затем AMSale.init({...}) и await AMSale.ensure() перед выдачей. */
(function () {
  const API_URL = 'https://script.google.com/macros/s/AKfycbz19KS3-W0EvcN7TiCvM9X8OfRSwnRg3XLOn_BgSkLpnRVidH1QG6mpGF8m-eTLZkCKow/exec';
  const APP_URL = 'app/';
  const METHODS = ['Наличные', 'Карта', 'Перевод', 'Расчётный счёт'];
  const $ = id => document.getElementById(id);
  const pin = () => { try { return JSON.parse(localStorage.getItem('am_pin') || '""') || ''; } catch (e) { return ''; } };

  function call(fn, ...args) {
    const url = API_URL + '?api=' + encodeURIComponent(fn) + '&pin=' + encodeURIComponent(pin()) +
      '&args=' + encodeURIComponent(JSON.stringify(args)) + '&_=' + Date.now();
    return fetch(url, { redirect: 'follow' }).then(r => { if (!r.ok) throw new Error('сервер ответил ' + r.status); return r.json(); })
      .then(j => { if (!j.ok) throw new Error(j.error === 'PIN_REQUIRED' ? 'нужен ПИН — откройте приложение мастерской и войдите' : (j.error || 'ошибка')); return j.data; });
  }

  let O = null, kind = 'Сумма', method = '', issued = null, sentKey = '';

  const css = `
.sale{border:1.5px solid var(--line);border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:12px;background:color-mix(in srgb,var(--pink) 4%,var(--panel))}
.sale .top{display:flex;align-items:center;gap:10px;font-weight:800}
.sale .top input{width:20px;height:20px;accent-color:var(--pink)}
.sale .seg{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.sale .seg button,.sale .meth button{font:inherit;font-size:13px;font-weight:700;border:1.5px solid var(--line);background:transparent;color:var(--ink);border-radius:10px;padding:9px;cursor:pointer}
.sale .seg button[aria-pressed=true],.sale .meth button[aria-pressed=true]{background:var(--pink);border-color:var(--pink);color:#fff}
.sale .meth{display:flex;flex-wrap:wrap;gap:6px}
.sale .meth button{padding:6px 11px;border-radius:999px}
.sale .st{font-size:12.5px;font-weight:700;color:var(--muted)}
.sale .st.ok{color:#2E8B57}
.sale[data-off] .body{display:none}
.tabs a.app{color:var(--violet);border-color:var(--line)}`;

  function ui() {
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const tabs = document.querySelector('.tabs');
    if (tabs) { const a = document.createElement('a'); a.href = APP_URL + '#cert'; a.className = 'app'; a.textContent = '← Приложение'; tabs.prepend(a); }
    const box = document.createElement('div');
    box.className = 'sale'; box.id = 'sale';
    box.innerHTML = `
      <label class="top"><input type="checkbox" id="s_on" checked> Записать продажу в кассу</label>
      <div class="body" style="display:flex;flex-direction:column;gap:12px">
        <div class="seg" id="s_kind"><button type="button" data-k="Сумма" aria-pressed="true">На сумму</button><button type="button" data-k="Мастер-класс" aria-pressed="false">На мастер-класс</button></div>
        <div class="row">
          <label class="f"><span class="lab">Кто купил</span><input type="text" id="s_buyer" maxlength="60" placeholder="необязательно"></label>
          <label class="f"><span class="lab">Оплачено, ₽</span><input type="number" id="s_price" min="0" step="100" inputmode="numeric" placeholder="= номиналу"></label>
        </div>
        <label class="f"><span class="lab">Телефон</span><input type="text" id="s_phone" inputmode="tel" maxlength="20" placeholder="необязательно"></label>
        <div class="f"><span class="lab">Способ оплаты</span><div class="meth" id="s_meth">${METHODS.map(m => `<button type="button" data-m="${m}" aria-pressed="false">${m}</button>`).join('')}</div></div>
      </div>
      <div class="st" id="s_st">Номер выдаст таблица при скачивании или создании ссылки</div>`;
    const first = document.querySelector('#form .actions');
    first.parentNode.insertBefore(box, first);
    $('s_on').onchange = () => { box.toggleAttribute('data-off', !$('s_on').checked); status(); };
    $('s_kind').onclick = e => { const b = e.target.closest('button'); if (!b) return; kind = b.dataset.k;
      [...$('s_kind').children].forEach(x => x.setAttribute('aria-pressed', x === b)); };
    $('s_meth').onclick = e => { const b = e.target.closest('button'); if (!b) return;
      method = method === b.dataset.m ? '' : b.dataset.m;
      [...$('s_meth').children].forEach(x => x.setAttribute('aria-pressed', x.dataset.m === method)); };
  }

  function status(t, ok) {
    const el = $('s_st'); if (!el) return;
    if (t) { el.textContent = t; el.className = 'st' + (ok ? ' ok' : ''); return; }
    if (!$('s_on').checked) { el.textContent = 'Продажа не запишется. Номер — из поля выше.'; el.className = 'st'; return; }
    el.textContent = issued ? '✓ №' + issued.num + ' записан в таблицу' : 'Номер выдаст таблица при скачивании или создании ссылки';
    el.className = 'st' + (issued ? ' ok' : '');
  }

  function payload() {
    const d = O.getData();
    return { kind, sum: d.sum, who: d.who, what: d.what, till: d.till, buyer: $('s_buyer').value.trim(),
      phone: $('s_phone').value.trim(), price: $('s_price').value, method };
  }

  // Перед выдачей: записать новый сертификат (или поправить уже записанный). true — можно выдавать
  async function ensure() {
    if (!$('s_on').checked) return true;
    const p = payload(), key = JSON.stringify(p);
    if (issued && key === sentKey) return true;
    status('Записываю в таблицу…');
    try {
      const body = issued ? Object.assign({ id: issued.id, num: issued.num }, p) : Object.assign({ pay: true }, p);
      const r = await call('apiCertSave', body);
      issued = r.issued; sentKey = key;
      O.setNum(issued.num);
      status();
      return true;
    } catch (e) {
      status('Не записалось: ' + e.message);
      return confirm('Не получилось записать сертификат в таблицу (' + e.message + ').\n\nВыдать сертификат с номером из поля без записи? Тогда внесите его потом в приложении: Сертификаты → «＋ Записать».');
    }
  }

  // «Следующий сертификат» — начинаем заново
  function reset() {
    issued = null; sentKey = ''; $('s_buyer').value = ''; $('s_phone').value = ''; $('s_price').value = '';
    status(); preview();
  }

  function preview() {
    call('apiCertNext').then(n => { if (!issued) { O.setNum(n); status('Следующий номер в таблице — №' + n); } }).catch(() => {});
  }

  window.AMSale = {
    init(o) { O = o; ui(); preview(); },
    ensure, reset,
    isIssued: () => !!issued
  };
})();
