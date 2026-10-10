/* =============================================================
 * Miliastra Atlas — Content Script
 *   1) 注入页面环境钩子（拦截接口响应）
 *   2) 采集页面可视化数据
 *   3) 悬浮面板：导出 xlsx / csv / json
 * ============================================================= */
(function () {
  'use strict';
  if (window.__MHY_CONTENT_LOADED__) return;
  window.__MHY_CONTENT_LOADED__ = true;

  var CHANNEL = 'mhy-stage-export';
  var MHY = window.MHYData;
  var XLSX = window.MHYXlsx;
  var Collect = window.MHYCollect;
  var Extract = window.MHYExtract;
  var UI = window.MHYUI;

  if (!MHY || !XLSX || !Collect || !UI) {
    console.warn('[Miliastra Atlas] 依赖模块未加载，已退出');
    return;
  }

  var utf8 = XLSX.utf8;          // 字符串 -> Uint8Array
  var MAX_CELLS = 150000;        // 单元格总量上限，超出截断（防止内存/文件过大）
  var captured = [];             // 页面接口响应缓存
  var capturedIndex = {};        // key -> index，按接口去重（保留最大一份）
  var lastData = null;
  var lastHref = location.href;
  var hooked = false;

  /** 浏览器里是空操作；Node 测试里让定时器不阻塞进程退出 */
  function unref(t) {
    try { if (t && typeof t.unref === 'function') t.unref(); } catch (e) { /* ignore */ }
    return t;
  }

  /* ---------------- 注入页面钩子 ---------------- */
  function registerContentGuard() {
    return collectTarget().map(function (n) {
      var g = document.createElement('meta');
      g.setAttribute('data-mhy-export-guard', '1');
      n.appendChild(g);
      return g;
    });
  }

  function collectTarget() {
    var out = [];
    if (document.head) out.push(document.head);
    if (document.documentElement) out.push(document.documentElement);
    return out;
  }

  function injectPageHook() {
    if (document.querySelector && document.querySelector('script[data-mhy-export-inject]')) { hooked = true; return; }
    try {
      var url = chrome.runtime.getURL('src/inject.js');
      var s = document.createElement('script');
      s.src = url;
      s.async = false;
      s.setAttribute('data-mhy-export-inject', '1');
      var target = document.head || document.documentElement;
      target.appendChild(s);
      registerContentGuard();
      hooked = true;
    } catch (e) {
      console.warn('[Miliastra Atlas] 注入页面钩子失败：', e);
    }
  }

  /* ---------------- 接收接口数据 ---------------- */
  function isTargetHost() {
    try { return /act\.mihoyo\.com$/i.test(location.hostname); } catch (e) { return false; }
  }

  window.addEventListener('message', function (ev) {
    if (ev.source !== window) return;
    if (isTargetHost() && ev.origin !== location.origin) return;
    var d = ev.data;
    if (!d || d.__mhyExport !== true || d.channel !== CHANNEL) return;
    var p = d.payload;
    if (!p) return;
    if (p.__ready__) { hooked = true; return; }
    if (p.__status__) return;
    if (!p.url || p.body === undefined) return;

    var key = String(p.url) + '|' + String(p.name);
    var idx = capturedIndex[key];
    var size = p.size || JSON.stringify(p.body).length;
    if (idx !== undefined) {
      if (size <= (captured[idx].size || 0)) return;
      captured[idx] = p;
    } else {
      captured.push(p);
      capturedIndex[key] = captured.length - 1;
    }
    if (captured.length > 400) {
      captured.shift();
      capturedIndex = {};
      captured.forEach(function (c, i) { capturedIndex[String(c.url) + '|' + String(c.name)] = i; });
    }
  });

  /* ---------------- 采集 ---------------- */
  function harvest(force) {
    if (!force && lastData && Date.now() - lastData.exportedAt < 3500) return lastData;
    lastData = Collect.collect({
      url: location.href,
      title: document.title,
      captured: captured
    });
    return lastData;
  }

  function stamp() {
    var d = new Date();
    var p = function (n, l) { return String(n).padStart(l, '0'); };
    return p(d.getFullYear(), 4) + p(d.getMonth() + 1, 2) + p(d.getDate(), 2) + '_' +
      p(d.getHours(), 2) + p(d.getMinutes(), 2) + p(d.getSeconds(), 2);
  }

  /** 向 background 请求官方接口数据（用浏览器登录态，最完整） */
  function fetchOfficial() {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage({ type: 'fetchData', stageId: MHY.parseStageId(location.href) }, function (res) {
          if (chrome.runtime.lastError) { resolve(null); return; }
          resolve(res && res.ok ? res.data : null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  /**
   * 组装工作表：
   *   优先用官方接口数据（extract.js，结构化、含 30 天全量）
   *   接口不可用时退回页面可视化采集（collect.js）
   */
  function buildSheetsFor(data, official, range) {
    if (official && Extract && (official.stage || official.user)) {
      var sheets = null;
      try {
        sheets = Extract.buildSheets({
          stagePayload: official.stage,
          userPayload: official.user,
          listPayload: official.list,
          range: range
        });
      } catch (e) {
        console.error('[Miliastra Atlas] 接口数据解析失败，退回页面采集：', e);
      }
      if (sheets && sheets.length) return { sheets: sheets, source: 'official', errors: official.errors || [] };
    }
    var fallback = MHY.buildWorkbook(data);
    if (range) fallback = clampToRange(fallback, range);
    return { sheets: fallback, source: 'page', errors: (official && official.errors) || [] };
  }

  /** 页面兜底数据也支持区间选择：只保留末 N 天的趋势行 */
  function clampToRange(sheets, range) {
    var cut = function (d) {
      var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d));
      if (!m) return null;
      return Date.UTC(+m[1], +m[2] - 1, +m[3]);
    };
    return (sheets || []).map(function (s) {
      if (!s.header || !/日期/.test(String(s.header[0]))) return s;
      var dates = s.rows.map(function (r) { return cut(r[0]); }).filter(function (x) { return x !== null; });
      if (!dates.length) return s;
      var max = Math.max.apply(null, dates);
      var min = max - (range - 1) * 86400000;
      return {
        name: s.name,
        header: s.header,
        rows: s.rows.filter(function (r) {
          var t = cut(r[0]);
          return t === null || t >= min;
        })
      };
    }).filter(function (s) { return !s.header || !/日期/.test(String(s.header[0])) || s.rows.length >= 1; });
  }

  function fileBase(data, official) {
    var stage = official && official.stage && official.stage.data && official.stage.data.stage_info;
    var id = (stage && stage.stage_id) || data.stageId || 'unknown';
    var name = (stage && stage.stage_name) || (data.overview && data.overview.name) || '';
    var n = MHY.safeFileName('奇域数据_' + id + (name ? '_' + name : '') + '_' + stamp());
    return n;
  }

  function clampSheets(sheets) {
    var budget = MAX_CELLS;
    var truncated = 0;
    var out = [];
    (sheets || []).forEach(function (s) {
      if (!s) return;
      var cols = (s.header && s.header.length) || (s.rows[0] ? s.rows[0].length : 0);
      var maxRows = Math.max(1, Math.floor(budget / Math.max(1, cols)));
      if (s.rows.length > maxRows) {
        truncated += s.rows.length - maxRows;
        out.push({ name: s.name, header: s.header, rows: s.rows.slice(0, maxRows) });
      } else {
        out.push(s);
      }
      budget -= Math.min(s.rows.length, maxRows) * Math.max(1, cols);
      if (budget <= 0) budget = 1;
    });
    return { sheets: out, truncated: truncated };
  }

  function toBase64(bytes) {
    var chunk = 0x8000;
    var parts = [];
    for (var i = 0; i < bytes.length; i += chunk) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)));
    }
    return btoa(parts.join(''));
  }

  function downloadViaBackground(payload) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage({ type: 'download', payload: payload }, function (res) {
          if (chrome.runtime.lastError) { resolve({ ok: false, error: chrome.runtime.lastError.message }); return; }
          resolve(res || { ok: false, error: '无响应' });
        });
      } catch (e) {
        resolve({ ok: false, error: String(e && e.message || e) });
      }
    });
  }

  /** 页面内下载兜底（Service Worker 无法创建 Blob URL 时使用） */
  function downloadInPage(base64, filename, mime) {
    var bin = atob(base64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 4000);
    return { ok: true, filename: filename, via: 'page' };
  }

  function save(payload) {
    return downloadViaBackground(payload).then(function (res) {
      if (res && res.ok) return res;
      var errText = String((res && res.error) || '');
      // Service Worker 无法创建 Blob URL 时才改走页面内下载
      if (res && res.fallbackInPage) {
        return downloadInPage(payload.base64, res.filename || payload.filename || 'export', payload.mime);
      }
      if (res && res.error) throw new Error(errText);
      // 完全没有响应（例如 Service Worker 被回收）：页面内兜底
      return downloadInPage(payload.base64, payload.filename || 'export', payload.mime);
    });
  }

  /* ---------------- 面板文案 ---------------- */
  function updateSub(data) {
    var parts = [];
    if (data.stageId) parts.push('[奇域ID ' + data.stageId + ']');
    parts.push((data.overview && data.overview.name) ? data.overview.name : '奇域数据');
    var extra = [];
    if (data.charts && data.charts.length) extra.push('趋势图 ' + data.charts.length);
    if (data.tables && data.tables.length) extra.push('表格 ' + data.tables.length);
    if (data.metrics && data.metrics.length) extra.push('指标 ' + data.metrics.length);
    extra.push('接口 ' + captured.length);
    var text = parts.join(' ') + '\n' + extra.join(' · ');
    if (!MHY.isStageDetailUrl(location.href)) {
      text += '\n提示：当前不是「某个奇域详情」页，请进入 数据中心 → 奇域数据 → 点开某个奇域';
    }
    UI.setSub(text);
  }

  function overviewText(data) {
    var ov = data.overview || {};
    var out = [];
    if (ov.name) out.push('奇域名称：' + ov.name);
    if (ov.stageId) out.push('奇域ID：' + ov.stageId);
    if (ov.status) out.push('状态：' + ov.status);
    if (ov.publishTime) out.push('发布时间：' + ov.publishTime);
    if (ov.heat !== undefined) out.push('奇域热度：' + ov.heat);
    if (ov.newHeat !== undefined) out.push('近期新增量：' + ov.newHeat);
    if (ov.avgDuration) out.push('平均游玩时长：' + (ov.avgDuration.text || ov.avgDuration));
    if (data.charts && data.charts.length) {
      out.push('趋势数据：' + data.charts.map(function (c) { return c.title + '(' + c.rows.length + '点)'; }).join('、'));
    }
    return out.join('\n');
  }

  function diagnosticsText(data) {
    var d = data.diagnostics || {};
    var lines = [];
    lines.push('页面匹配：' + (MHY.isStageDetailUrl(location.href) ? '是（奇域详情页）' : '否'));
    lines.push('URL 解析出的奇域ID：' + (data.stageId || '（未解析到）'));
    lines.push('图表来源：' + d.chartSource + '（canvas ' + d.canvasCount + ' 个 / ECharts ' + (d.hasEcharts ? '已加载' : '未检测到') + '）');
    lines.push('已拦截接口：' + d.capturedCount + ' 条' + (d.apiNames && d.apiNames.length ? ' → ' + d.apiNames.slice(0, 8).join(', ') : ''));
    lines.push('识别到「标签:值」：' + d.metricCount + ' 个');
    lines.push('识别到表格：' + d.tableCount + ' 张');
    if (data.charts && data.charts.length) {
      lines.push('— 趋势图 —');
      data.charts.forEach(function (c, i) {
        var first = (c.raw && c.raw[0] && c.raw[0].points || []).slice(0, 3).map(function (p) { return p.value; });
        lines.push((i + 1) + '. ' + c.title + '：' + c.rows.length + ' 个点' + (c.partial ? '（DOM 兜底）' : '') +
          (first.length ? ' 前值 ' + first.join(', ') : ''));
      });
    }
    if (d.kvPairs && d.kvPairs.length) {
      lines.push('— 页面「标签:值」清单（前 15 条）—');
      d.kvPairs.slice(0, 15).forEach(function (p) {
        lines.push('· ' + p.rawKey + ' = ' + p.value);
      });
      if (d.kvPairs.length > 15) lines.push('… 共 ' + d.kvPairs.length + ' 条');
    }
    if (d.numberGroups && d.numberGroups.length) {
      lines.push('— 页面数字组（前 5 条）—');
      d.numberGroups.slice(0, 5).forEach(function (g) {
        lines.push('· ' + g.values.length + ' 个值：' + g.values.slice(0, 8).join(', '));
      });
    }
    return lines.join('\n');
  }

  function doExport(kind) {
    if (kind === 'diag') {
      var d0 = harvest(true);
      UI.setStat(diagnosticsText(d0));
      updateSub(d0);
      return;
    }
    if (kind === 'reload') {
      var d1 = harvest(true);
      UI.setStat(overviewText(d1) + '\n\n已完成重新采集。');
      updateSub(d1);
      UI.toast('已重新采集当前页面数据');
      return;
    }

    var data = harvest(true);
    var range = UI.getRange ? UI.getRange() : 30;
    var rangeText = range ? ('近 ' + range + ' 日') : '全部天数';
    UI.setBusy(true, '正在向官方接口取数…');
    UI.setStat('正在向官方接口取数（导出区间：' + rangeText + '）…');
    var t0 = Date.now();

    fetchOfficial().then(function (official) {
      var builtPack = buildSheetsFor(data, official, range);
      var built = clampSheets(builtPack.sheets);
      var sheets = built.sheets;
      var base = fileBase(data, official);
      var note = builtPack.source === 'official'
        ? ('数据来源：官方接口 · 导出区间：' + rangeText + ' · ' + sheets.length + ' 个工作表')
        : ('数据来源：页面采集（接口不可用时兜底） · 导出区间：' + rangeText);
      if (builtPack.errors && builtPack.errors.length) note += '\n接口提示：' + builtPack.errors.join('；');

      if (kind === 'json') {
        var dump = official
          ? { source: 'official', stageId: data.stageId, exportedAt: Date.now(), official: official, page: data }
          : { source: 'page', stageId: data.stageId, exportedAt: Date.now(), page: data };
        var text = JSON.stringify(dump, null, 2);
        return save({
          base64: toBase64(utf8(text)), ext: 'json', mime: 'application/json;charset=utf-8',
          stageId: data.stageId, filename: base + '.json'
        }).then(function (r) { done(r, note, text.length, t0); });
      }

      if (kind === 'csv') {
        var csv = '\ufeff' + XLSX.buildCsv(sheets);
        return save({
          base64: toBase64(utf8(csv)), ext: 'csv', mime: 'text/csv;charset=utf-8',
          stageId: data.stageId, filename: base + '.csv'
        }).then(function (r) { done(r, note, csv.length, t0, built.truncated); });
      }

      return XLSX.buildXlsx(sheets).then(function (bytes) {
        return save({
          base64: toBase64(bytes), ext: 'xlsx',
          mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          stageId: data.stageId, filename: base + '.xlsx'
        }).then(function (r) { done(r, note, bytes.length, t0, built.truncated); });
      });
    }).catch(function (e) { fail(e); });
  }

  function done(res, what, size, t0, truncated) {
    UI.setBusy(false);
    var msg = '已导出：' + (res && res.filename ? res.filename : what) +
      '\n' + what +
      '\n大小：' + (size / 1024).toFixed(1) + ' KB，耗时 ' + (Date.now() - t0) + ' ms' +
      (truncated ? '\n注意：数据量过大，已截断 ' + truncated + ' 行' : '');
    UI.setStat(msg + '\n\n' + overviewText(lastData || {}));
    UI.toast('已下载：' + (res && res.filename ? res.filename : what), 3600);
  }

  function fail(e) {
    UI.setBusy(false);
    var msg = '导出失败：' + String(e && e.message || e) +
      '\n可尝试：① 刷新页面后重试；② 用「导出 CSV」代替；③ 点击「数据自检」把结果发我。';
    UI.setStat(msg);
    UI.toast('导出失败，请查看面板提示', 5000);
    console.error('[Miliastra Atlas]', e);
  }

  /* ---------------- SPA 路由变化 ---------------- */
  function watchRoute() {
    unref(setInterval(function () {
      if (location.href === lastHref) return;
      lastHref = location.href;
      lastData = null;
      captured = [];
      capturedIndex = {};
      injectPageHook();
      UI.setStat('检测到页面切换，已清空缓存。可在页面加载完成后点击「刷新数据」。');
    }, 800));
    window.addEventListener('popstate', function () { lastHref = ''; });
    window.addEventListener('hashchange', function () { lastHref = ''; });
  }

  /* ---------------- 消息入口（popup / 右键菜单） ---------------- */
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'ping') {
      sendResponse({ ok: true, url: location.href });
      return true;
    }
    if (msg.type === 'runExport') {
      UI.togglePanel(true);
      doExport('xlsx');
      sendResponse({ ok: true, page: location.href, captured: captured.length });
      return true;
    }
    if (msg.type === 'state') {
      sendResponse({
        ok: true,
        url: location.href,
        isDetail: MHY.isStageDetailUrl(location.href),
        stageId: MHY.parseStageId(location.href),
        captured: captured.length
      });
      return true;
    }
  });

  /* ---------------- 启动 ---------------- */
  function boot() {
    injectPageHook();
    try {
      UI.mount();
      UI.on('onAction', doExport);
      UI.on('onRange', function (r) {
        try { window.localStorage.setItem('mhy-export-range', String(r)); } catch (e) { /* ignore */ }
        UI.toast(r ? ('导出区间已切换为近 ' + r + ' 日') : '导出区间已切换为全部天数', 1800);
      });
      // 记住上次选择
      try {
        var saved = window.localStorage.getItem('mhy-export-range');
        if (saved !== null && UI.setRange) UI.setRange(Number(saved));
      } catch (e) { /* ignore */ }
      UI.on('onOpen', function () {
        var d = harvest(false);
        updateSub(d);
        UI.setStat(overviewText(d) || '未读取到概览数据，请确认已进入某个奇域/奇匠数据页。');
      });
    } catch (e) {
      console.warn('[Miliastra Atlas] 面板挂载失败，导出功能仍可通过扩展图标使用：', e);
    }
    // 页面首次渲染后再自动探测一次
    unref(setTimeout(function () {
      try {
        var d = harvest(false);
        updateSub(d);
        if (d.stageId) UI.toast('Miliastra Atlas已就绪：点击右下角按钮导出表格', 4200);
      } catch (e) { /* ignore */ }
    }, 1500));
    watchRoute();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
