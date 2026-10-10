/* =============================================================
 * 页面环境(Main World)网络拦截：
 *   - 挂钩 window.fetch 与 XMLHttpRequest
 *   - 把 JSON 响应通过 window.postMessage 交给 content script
 * 说明：只读监听，不改写任何请求/响应，不影响页面正常功能。
 * ============================================================= */
(function () {
  'use strict';
  if (window.__MHY_EXPORT_HOOKED__) return;
  window.__MHY_EXPORT_HOOKED__ = true;

  var CHANNEL = 'mhy-stage-export';
  var MAX_BODY = 200 * 1024;   // 单个响应最多保留 200KB
  var MAX_ITEMS = 400;         // 最多保留 400 条响应
  var INTEREST = /api|get|list|data|stat|detail|overview|trend|chart|report|stage|level|interact|comment/i;
  var dropped = 0;
  var count = 0;

  function endpointOf(url) {
    try {
      var u = new URL(url, location.href);
      var parts = u.pathname.split('/').filter(Boolean);
      var last = parts.length ? parts[parts.length - 1] : u.pathname;
      return last.replace(/\.(json|html?)$/i, '') || u.pathname;
    } catch (e) {
      return String(url || '').slice(0, 80);
    }
  }

  function shortUrl(url) {
    try {
      var u = new URL(url, location.href);
      return u.origin + u.pathname;
    } catch (e) { return String(url || '').slice(0, 120); }
  }

  function shouldKeep(url) {
    var s = String(url || '');
    if (/\.(js|css|png|jpe?g|gif|webp|svg|woff2?|ttf|ico|mp4|mp3|wasm)(\?|$)/i.test(s)) return false;
    return INTEREST.test(s);
  }

  function safeParse(text) {
    try { return JSON.parse(text); } catch (e) { return null; }
  }

  function send(data) {
    try {
      var json = JSON.stringify(data);
      if (json.length > MAX_BODY) {
        // 超大响应：保留身份信息，只截断 body，避免整条数据报废
        var slim = {
          name: data.name,
          url: data.url,
          fullUrl: data.fullUrl,
          time: data.time,
          size: data.size,
          body: {
            __truncated__: true,
            __note__: '响应超过 ' + Math.round(MAX_BODY / 1024) + 'KB，已省略明细',
            preview: String(json).slice(0, 2000)
          }
        };
        json = JSON.stringify(slim);
      }
      window.postMessage({ __mhyExport: true, channel: CHANNEL, payload: JSON.parse(json) }, location.origin);
    } catch (e) {
      dropped++;
    }
  }

  function record(url, text, extra) {
    if (!shouldKeep(url)) return;
    if (count >= MAX_ITEMS) { dropped++; return; }
    var body = safeParse(text);
    if (body === null) return;   // 非 JSON 直接忽略
    count++;
    send({
      name: endpointOf(url),
      url: shortUrl(url),
      fullUrl: String(url).slice(0, 500),
      time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      size: (text && text.length) || 0,
      body: body
    });
  }

  /* ---------- fetch ---------- */
  if (typeof window.fetch === 'function') {
    var origFetch = window.fetch;
    window.fetch = function () {
      var args = Array.prototype.slice.call(arguments);
      var req = args[0];
      var url = '';
      try { url = (typeof req === 'string') ? req : (req && req.url) || ''; } catch (e) { url = ''; }
      var p = origFetch.apply(this, args);
      try {
        p.then(function (res) {
          try {
            if (!res || !res.ok) return;
            var ct = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
            if (ct && !/json|text/i.test(ct)) return;
            res.clone().text().then(function (t) { record(url, t); }).catch(function () {});
          } catch (e) { /* ignore */ }
        }).catch(function () {});
      } catch (e) { /* ignore */ }
      return p;
    };
  }

  /* ---------- XMLHttpRequest ---------- */
  if (window.XMLHttpRequest && window.XMLHttpRequest.prototype) {
    var XHR = window.XMLHttpRequest;
    var origOpen = XHR.prototype.open;
    var origSend = XHR.prototype.send;

    XHR.prototype.open = function (method, url) {
      try { this.__mhyUrl = url; } catch (e) { /* ignore */ }
      return origOpen.apply(this, arguments);
    };

    XHR.prototype.send = function () {
      var xhr = this;
      try {
        xhr.addEventListener('load', function () {
          try {
            if (xhr.status < 200 || xhr.status >= 300) return;
            var rt = xhr.responseType;
            if (rt && rt !== 'text' && rt !== 'json') return;
            var text = rt === 'json' ? JSON.stringify(xhr.response) : xhr.responseText;
            if (typeof text !== 'string' || !text) return;
            record(xhr.__mhyUrl || xhr.responseURL, text);
          } catch (e) { /* ignore */ }
        });
      } catch (e) { /* ignore */ }
      return origSend.apply(this, arguments);
    };
  }

  /* ---------- 状态查询（供调试） ---------- */
  window.addEventListener('message', function (ev) {
    if (ev.source !== window) return;
    var d = ev.data;
    if (!d || d.__mhyExportAsk !== true) return;
    try {
      window.postMessage({
        __mhyExport: true,
        channel: CHANNEL,
        payload: { __status__: true, counted: count, dropped: dropped }
      }, location.origin);
    } catch (e) { /* ignore */ }
  });

  // 通知 content script 钩子已就绪
  try {
    window.postMessage({ __mhyExport: true, channel: CHANNEL, payload: { __ready__: true } }, location.origin);
  } catch (e) { /* ignore */ }
})();
