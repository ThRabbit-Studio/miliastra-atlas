/* =============================================================
 * 网络拦截层测试：在 Node 里真实执行 inject.js
 * 验证 fetch / XMLHttpRequest 的响应能被捕获并投递
 *   node test/inject-test.js
 * ============================================================= */
'use strict';

const fs = require('fs');
const vm = require('vm');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? '  → ' + JSON.stringify(detail) : '')); }
}

const posted = [];
const listeners = {};

/** 触发页面上注册的 message 处理器（模拟浏览器派发事件） */
function firePageMessage(data, source) {
  (listeners['message'] || []).forEach((fn) => fn({ source: source, data: data }));
}

/* ---------- 搭一个页面环境 ---------- */
function makeEnv() {
  const env = {};
  env.location = {
    href: 'https://act.mihoyo.com/miliastra_wonderland/developer#/StageData/stageDetail/54461776301',
    origin: 'https://act.mihoyo.com'
  };
  env.URL = URL;
  env.JSON = JSON;
  env.Date = Date;
  env.console = console;
  env.Array = Array;
  env.String = String;
  env.Object = Object;
  env.setTimeout = setTimeout;
  env.postMessage = (msg) => { posted.push(msg); };
  env.addEventListener = (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); };
  env.removeEventListener = () => {};

  env.__byUrl = {};
  // fetch 桩：按 URL 片段可覆写响应
  env.fetch = function (url) {
    const reqUrl = String(url);
    let body = env.__fetchBody;
    let ct = env.__fetchCt;
    Object.keys(env.__byUrl).forEach((frag) => {
      if (reqUrl.includes(frag)) { body = env.__byUrl[frag].body; ct = env.__byUrl[frag].ct; }
    });
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: (k) => (k.toLowerCase() === 'content-type' ? ct : null) },
      clone() { return { text: () => Promise.resolve(body), json: () => Promise.resolve(JSON.parse(body)) }; },
      text: () => Promise.resolve(body),
      json: () => Promise.resolve(JSON.parse(body))
    });
  };
  env.__fetchBody = '';
  env.__fetchCt = 'application/json';

  function FakeXHR() { this._l = {}; }
  FakeXHR.prototype.open = function () {};
  FakeXHR.prototype.send = function () {};
  FakeXHR.prototype.addEventListener = function (t, fn) { (this._l[t] = this._l[t] || []).push(fn); };
  FakeXHR.prototype._fire = function (t) { (this._l[t] || []).forEach((fn) => fn()); };
  env.XMLHttpRequest = FakeXHR;

  env.window = env;
  const ctx = vm.createContext(env);
  vm.runInContext(fs.readFileSync(__dirname + '/../extension/src/inject.js', 'utf8'), ctx, { filename: 'inject.js' });
  // vm.createContext 返回的是代理对象，不等于 context 内部的 window；
  // 事件 source 比较需要 context 内部的真实引用，因此单独取出来。
  env.__win = vm.runInContext('window', ctx);
  env.__fetch = env.__win.fetch.bind(env.__win);
  return env;
}

function payloads() { return posted.map((m) => m.payload).filter((p) => p && !p.__ready__); }

(async () => {
  console.log('== inject.js 网络拦截测试 ==');

  // --- 1. 加载与就绪信号 ---
  const env = makeEnv();
  ok('加载后立即发送 __ready__ 信号', posted.some((m) => m.payload && m.payload.__ready__ === true));
  ok('消息带正确 channel', posted[0].channel === 'mhy-stage-export', posted[0].channel);
  ok('钩子标记已设置', env.__MHY_EXPORT_HOOKED__ === true);
  ok('重复加载不会二次挂钩', (() => {
    const before = posted.length;
    vm.runInContext(fs.readFileSync(__dirname + '/../extension/src/inject.js', 'utf8'), vm.createContext(env), { filename: 'inject.js' });
    return posted.length === before;
  })());

  // --- 2. fetch 捕获 JSON ---
  env.__fetchBody = JSON.stringify({ retcode: 0, data: { list: [{ date: '2026-10-09', heat: 505 }] } });
  env.__fetchCt = 'application/json; charset=utf-8';
  const res = await env.__fetch('https://act.mihoyo.com/api/stage/get_report?stage_id=54461776301');
  const json = await res.json();
  await new Promise((r) => setTimeout(r, 30));
  const ps = payloads().filter((p) => p.url);
  ok('fetch 响应被捕获', ps.length === 1, ps.map((p) => p.name));
  ok('原始响应未被破坏（业务不受影响）', json && json.retcode === 0);
  if (ps[0]) {
    ok('接口名从路径提取', ps[0].name === 'get_report', ps[0].name);
    ok('URL 去掉了查询串', ps[0].url === 'https://act.mihoyo.com/api/stage/get_report', ps[0].url);
    ok('JSON body 被完整解析', ps[0].body && ps[0].body.retcode === 0 && ps[0].body.data.list[0].heat === 505, ps[0].body);
    ok('记录了响应时间', typeof ps[0].time === 'string' && /\d{2}:\d{2}:\d{2}/.test(ps[0].time), ps[0].time);
  }

  // --- 3. 静态资源过滤 ---
  const beforeFilter = payloads().length;
  env.__fetchBody = '{"a":1}';
  env.__fetchCt = 'image/png';
  env.__fetch('https://act.mihoyo.com/img/logo.png');
  env.__fetch('https://act.mihoyo.com/static/app.abc123.js');
  env.__fetch('https://act.mihoyo.com/static/font.woff2');
  await new Promise((r) => setTimeout(r, 30));
  ok('图片/JS/字体等静态资源被过滤', payloads().length === beforeFilter, payloads().slice(beforeFilter).map((p) => p.url));

  // --- 4. 非 JSON 响应（HTML）忽略 ---
  env.__fetchBody = '<!DOCTYPE html><html>...';
  env.__fetchCt = 'text/html';
  env.__fetch('https://act.mihoyo.com/api/whatever/page');
  await new Promise((r) => setTimeout(r, 30));
  ok('HTML 响应被忽略', payloads().length === beforeFilter, payloads().slice(beforeFilter).map((p) => p.url));

  // --- 5. text/plain 响应忽略（只收 JSON） ---
  env.__byUrl['/api/plain'] = { body: 'ok', ct: 'text/plain' };
  const beforePlain = payloads().length;
  await env.__fetch('https://act.mihoyo.com/api/plain');
  await new Promise((r) => setTimeout(r, 30));
  ok('text/plain 响应被忽略（只收 JSON）', payloads().length === beforePlain, payloads().slice(beforePlain).map((p) => p.name));

  // --- 6. XHR 捕获 ---
  const xhr = new env.XMLHttpRequest();
  xhr.open('GET', 'https://act.mihoyo.com/api/stage/interaction?stage_id=1');
  xhr.status = 200;
  xhr.responseText = JSON.stringify({ retcode: 0, data: { total: 1234 } });
  const beforeXhr = payloads().length;
  xhr.send();
  xhr._fire('load');
  await new Promise((r) => setTimeout(r, 10));
  const xp = payloads().slice(beforeXhr);
  ok('XHR 响应被捕获', xp.length === 1, xp.map((p) => p.name));
  if (xp[0]) {
    ok('XHR 接口名正确', xp[0].name === 'interaction', xp[0].name);
    ok('XHR body 正确', xp[0].body.data.total === 1234, xp[0].body);
  }

  const xhr2 = new env.XMLHttpRequest();
  xhr2.open('GET', 'https://act.mihoyo.com/api/stage/failed');
  xhr2.status = 500;
  xhr2.responseText = '{"error":"boom"}';
  const before5xx = payloads().length;
  xhr2.send();
  xhr2._fire('load');
  await new Promise((r) => setTimeout(r, 10));
  ok('HTTP 500 不采集', payloads().length === before5xx);

  // --- 7. 状态查询 ---
  const beforeAsk = posted.length;
  firePageMessage({ __mhyExportAsk: true }, env.__win);
  const statusMsg = posted.slice(beforeAsk).map((m) => m.payload).find((p) => p && p.__status__);
  ok('响应状态查询', !!statusMsg && statusMsg.counted >= 2, statusMsg);

  // --- 8. 超大响应保护 ---
  const huge = JSON.stringify({ blob: 'x'.repeat(300 * 1024) });
  const xhr3 = new env.XMLHttpRequest();
  xhr3.open('GET', 'https://act.mihoyo.com/api/stage/huge_data');
  xhr3.status = 200;
  xhr3.responseText = huge;
  const beforeHuge = posted.length;
  xhr3.send();
  xhr3._fire('load');
  await new Promise((r) => setTimeout(r, 10));
  const hugeMsg = posted.slice(beforeHuge).map((m) => m.payload).find((p) => p && p.url && p.url.includes('huge'));
  ok('超大响应被截断，但保留接口身份',
    !!hugeMsg && hugeMsg.body && hugeMsg.body.__truncated__ === true && hugeMsg.name === 'huge_data',
    hugeMsg && { name: hugeMsg.name, url: hugeMsg.url, keys: Object.keys(hugeMsg.body || {}) });

  console.log('\n' + (fail === 0 ? `全部 ${pass} 项检查通过 ✅` : `${fail} 项失败 / ${pass} 项通过 ❌`));
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('测试异常：', e);
  process.exit(1);
});
