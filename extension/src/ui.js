/* =============================================================
 * Miliastra Atlas — 页面悬浮面板（Shadow DOM，样式与页面完全隔离）
 * ============================================================= */
(function (root) {
  'use strict';

  var doc = root.document;
  var host = null;
  var shadow = null;
  var ui = {};
  var statusTimer = null;

  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}',
    '.wrap{position:fixed;right:18px;bottom:18px;z-index:2147483646;display:flex;flex-direction:column;align-items:flex-end;gap:10px}',
    '.fab{display:flex;align-items:center;gap:8px;border:none;cursor:pointer;padding:11px 16px;border-radius:24px;',
    'background:linear-gradient(135deg,#4c8dff,#2f5fe0);color:#fff;font-size:14px;font-weight:600;',
    'box-shadow:0 6px 20px rgba(47,95,224,.42);transition:transform .15s ease}',
    '.fab:hover{transform:translateY(-2px)}',
    '.fab:active{transform:translateY(0)}',
    '.panel{width:352px;max-height:70vh;overflow:auto;background:#fff;color:#1f2430;border-radius:14px;',
    'box-shadow:0 14px 44px rgba(15,23,42,.24);border:1px solid #e6eaf2;padding:14px 14px 12px;display:none}',
    '.panel.show{display:block}',
    '.hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}',
    '.hd h1{font-size:15px;margin:0;font-weight:700;letter-spacing:.2px}',
    '.hd .x{border:none;background:#f1f4fa;color:#5b6478;width:24px;height:24px;border-radius:8px;cursor:pointer;font-size:14px;line-height:1}',
    '.sub{font-size:12px;color:#7b869c;margin:2px 0 10px;line-height:1.6;word-break:break-all;white-space:pre-line}',
    '.row{display:flex;gap:8px;margin-bottom:8px}',
    '.row.wrap-row{flex-wrap:wrap}',
    '.rlabel{font-size:12px;color:#7b869c;align-self:center;margin-right:2px;white-space:nowrap}',
    'button.rng{flex:1;padding:7px 6px;font-size:12px}',
    'button.rng.on{background:linear-gradient(135deg,#4c8dff,#2f5fe0);border-color:transparent;color:#fff}',
    'button.act{flex:1;min-width:96px;border:1px solid #d8e0ef;background:#f7f9fd;color:#243043;font-size:13px;',
    'padding:9px 10px;border-radius:10px;cursor:pointer;font-weight:600;transition:all .15s ease;white-space:nowrap}',
    'button.act:hover{background:#edf3ff;border-color:#b9cdf7}',
    'button.act:disabled{opacity:.5;cursor:not-allowed}',
    'button.act.primary{background:linear-gradient(135deg,#4c8dff,#2f5fe0);border-color:transparent;color:#fff}',
    'button.act.primary:hover{filter:brightness(1.06)}',
    '.stat{font-size:12px;line-height:1.65;color:#54607a;background:#f6f8fc;border:1px solid #e8edf6;',
    'border-radius:10px;padding:9px 10px;margin-top:4px;white-space:pre-wrap;word-break:break-all;max-height:190px;overflow:auto}',
    '.stat b{color:#243043}',
    '.tip{font-size:11.5px;color:#98a2b8;margin-top:8px;line-height:1.5}',
    '.toast{position:fixed;right:18px;bottom:82px;z-index:2147483647;background:rgba(23,28,39,.92);color:#fff;',
    'font-size:12.5px;padding:9px 13px;border-radius:10px;max-width:320px;line-height:1.5;display:none}',
    '.toast.show{display:block}',
    '.badge{display:inline-block;padding:1px 7px;border-radius:999px;background:#e8f0ff;color:#2f5fe0;font-size:11px;margin-right:4px}'
  ].join('');

  function el(tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function btn(cls, text) {
    var b = el('button', cls, text);
    b.type = 'button';
    return b;
  }

  function mount() {
    if (host && doc.documentElement && doc.documentElement.contains(host)) return;
    host = doc.createElement('div');
    host.setAttribute('data-mhy-export-ui', '1');
    host.style.cssText = 'all:initial;position:static';
    shadow = host.attachShadow({ mode: 'open' });

    var style = doc.createElement('style');
    style.textContent = CSS;

    var wrap = el('div', 'wrap');

    ui.fab = btn('fab', '');
    var fabIcon = el('span', '', '⤓');
    var fabText = el('span', '', '导出奇域数据');
    ui.fab.appendChild(fabIcon);
    ui.fab.appendChild(fabText);
    ui.fab.title = '导出当前奇域数据';

    ui.panel = el('div', 'panel');

    var hd = el('div', 'hd');
    var h1 = el('h1', '', '奇域数据导出');
    ui.close = btn('x', '✕');
    ui.close.title = '收起';
    hd.appendChild(h1);
    hd.appendChild(ui.close);

    ui.sub = el('div', 'sub', '正在读取页面…');

    var rowRange = el('div', 'row');
    var rangeLabel = el('span', 'rlabel', '导出区间');
    rowRange.appendChild(rangeLabel);
    ui.rangeBtns = {};
    [['7', '近7日'], ['30', '近30日'], ['0', '全部']].forEach(function (pair, idx) {
      var b = btn('act rng' + (idx === 1 ? ' on' : ''), pair[1]);
      b.addEventListener('click', function () {
        Object.keys(ui.rangeBtns).forEach(function (k) { ui.rangeBtns[k].classList.remove('on'); });
        b.classList.add('on');
        ui.range = Number(pair[0]);
        if (typeof ui.onRange === 'function') ui.onRange(ui.range);
      });
      ui.rangeBtns[pair[0]] = b;
      rowRange.appendChild(b);
    });

    var row1 = el('div', 'row');
    ui.xlsx = btn('act primary', '导出 Excel (.xlsx)');
    ui.csv = btn('act', '导出 CSV');
    row1.appendChild(ui.xlsx);
    row1.appendChild(ui.csv);

    var row2 = el('div', 'row wrap-row');
    ui.json = btn('act', '导出 JSON');
    ui.diag = btn('act', '数据自检');
    ui.reload = btn('act', '刷新数据');
    row2.appendChild(ui.json);
    row2.appendChild(ui.diag);
    row2.appendChild(ui.reload);

    ui.stat = el('div', 'stat', '点击「导出 Excel」即可下载当前奇域的全部数据表格。');

    var tip = el('div', 'tip', '数据来源：页面接口响应（自动拦截）+ 页面可视化。若某项为空，请先点击页面上的「游玩数据 / 活跃指数 / 互动数据」等标签，再点「刷新数据」。');

    ui.panel.appendChild(hd);
    ui.panel.appendChild(ui.sub);
    ui.panel.appendChild(rowRange);
    ui.panel.appendChild(row1);
    ui.panel.appendChild(row2);
    ui.panel.appendChild(ui.stat);
    ui.panel.appendChild(tip);

    ui.toast = el('div', 'toast', '');

    wrap.appendChild(ui.fab);
    wrap.appendChild(ui.panel);
    wrap.appendChild(ui.toast);

    shadow.appendChild(style);
    shadow.appendChild(wrap);
    (doc.body || doc.documentElement).appendChild(host);

    ui.fab.addEventListener('click', function () { togglePanel(); });
    ui.close.addEventListener('click', function () { ui.panel.classList.remove('show'); });
    [
      ['xlsx', 'xlsx'], ['csv', 'csv'], ['json', 'json'], ['diag', 'diag'], ['reload', 'reload']
    ].forEach(function (pair) {
      var b = ui[pair[0]];
      if (!b) return;
      b.addEventListener('click', function () {
        if (typeof ui.onAction === 'function') ui.onAction(pair[1]);
      });
    });
  }

  function togglePanel(force) {
    mount();
    if (!ui.panel) return;
    var show = typeof force === 'boolean' ? force : !ui.panel.classList.contains('show');
    ui.panel.classList.toggle('show', show);
    if (show && typeof ui.onOpen === 'function') ui.onOpen();
  }

  function toast(text, ms) {
    mount();
    if (!ui.toast) return;
    ui.toast.textContent = text;
    ui.toast.classList.add('show');
    clearTimeout(statusTimer);
    statusTimer = unref(setTimeout(function () { if (ui.toast) ui.toast.classList.remove('show'); }, ms || 2800));
  }

  function setSub(text) { mount(); if (ui.sub) ui.sub.textContent = text === undefined || text === null ? '' : String(text); }
  function setStat(text) { mount(); if (ui.stat) ui.stat.textContent = text; }
  function setBusy(busy, label) {
    mount();
    ['xlsx', 'csv', 'json', 'diag', 'reload'].forEach(function (k) {
      if (ui[k]) ui[k].disabled = !!busy;
    });
    if (busy) toast(label || '正在处理…', 20000);
    else toast('完成', 1200);
  }

  /** 浏览器里是空操作；Node 测试里让定时器不阻塞进程退出 */
  function unref(t) {
    try { if (t && typeof t.unref === 'function') t.unref(); } catch (e) { /* ignore */ }
    return t;
  }

  function setRange(range) {
    mount();
    if (!ui.rangeBtns) return;
    var key = String(range === undefined || range === null ? 30 : range);
    if (!ui.rangeBtns[key]) key = '30';
    Object.keys(ui.rangeBtns).forEach(function (k) { ui.rangeBtns[k].classList.toggle('on', k === key); });
    ui.range = Number(key);
  }

  root.MHYUI = {
    mount: mount,
    togglePanel: togglePanel,
    toast: toast,
    setSub: setSub,
    setStat: setStat,
    setBusy: setBusy,
    setRange: setRange,
    getRange: function () { return ui.range === undefined ? 30 : ui.range; },
    on: function (name, fn) { ui[name] = fn; }
  };

  if (typeof module === 'object' && module.exports) module.exports = root.MHYUI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
