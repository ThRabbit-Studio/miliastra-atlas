/* =============================================================
 * 浏览器扩展环境冒烟测试
 *   用假 chrome API + DOM 桩加载 content_scripts 全部文件，
 *   验证：脚本无语法/引用错误、消息通道接通、按需注入正确、能真正产出下载数据。
 *   node test/chrome-stub-test.js
 * ============================================================= */
'use strict';

const { createDocument } = require('./dom-stub.js');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? '  → ' + JSON.stringify(detail) : '')); }
}

const URL = 'https://act.mihoyo.com/miliastra_wonderland/developer?mhy_presentation_style=fullscreen&mhy_auth_required=true#/StageData/stageDetail/54461776301';
const doc = createDocument({ echarts: true });
const sentMessages = [];
const listeners = {};

globalThis.window = globalThis;
globalThis.document = doc;
globalThis.location = { href: URL, hostname: 'act.mihoyo.com', origin: 'https://act.mihoyo.com' };
const blobUrl = { created: 0, revoked: 0 };
globalThis.URL = function () {};
globalThis.URL.createObjectURL = () => { blobUrl.created++; return 'blob:fake/' + blobUrl.created; };
globalThis.URL.revokeObjectURL = () => { blobUrl.revoked++; };
globalThis.atob = (b64) => Buffer.from(b64, 'base64').toString('binary');
globalThis.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
globalThis.Blob = class Blob {
  constructor(parts, o) {
    this.parts = parts;
    this.type = (o && o.type) || '';
    this.size = parts.reduce((n, p) => n + (p.length || p.byteLength || 0), 0);
  }
};
globalThis.addEventListener = (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); };
globalThis.removeEventListener = () => {};

/* ---- 可编程的 chrome 桩（支持多监听器、tabs、scripting） ---- */
const chromeStub = {
  _msgListeners: [],
  _tabs: [],
  _injectCalls: [],
  _sendToTab: null,
  runtime: {
    lastError: null,
    getURL: (p) => 'chrome-extension://testid/' + p,
    sendMessage: (msg, cb) => { sentMessages.push(msg); cb({ ok: true, downloadId: 1, filename: 'fake.xlsx' }); },
    onMessage: { addListener: (fn) => { chromeStub._msgListeners.push(fn); } },
    onInstalled: { addListener: () => {} }
  },
  tabs: {
    query: (q, cb) => cb(chromeStub._tabs),
    sendMessage: (tabId, msg, cb) => {
      if (chromeStub._sendToTab) { chromeStub._sendToTab(tabId, msg, cb); return; }
      cb(undefined);
    },
    create: () => {}
  },
  scripting: {
    executeScript: async (opts) => { chromeStub._injectCalls.push(opts); return [{ result: null }]; }
  },
  contextMenus: {
    create: () => {},
    onClicked: { addListener: () => {} }
  }
};
globalThis.chrome = chromeStub;

console.log('== 扩展环境冒烟测试 ==');

/* ---- manifest 校验 ---- */
let manifest = null;
try {
  manifest = JSON.parse(require('fs').readFileSync(__dirname + '/../extension/manifest.json', 'utf8'));
  ok('manifest.json 是合法 JSON', true);
} catch (e) {
  ok('manifest.json 是合法 JSON', false, String(e.message));
}

const EXPECTED_FILES = ['src/core/data.js', 'src/core/extract.js', 'src/core/xlsx.js', 'src/core/collect.js', 'src/ui.js', 'src/content.js'];

if (manifest) {
  ok('manifest_version = 3', manifest.manifest_version === 3);
  ok('声明 downloads 权限', (manifest.permissions || []).includes('downloads'));
  ok('声明 scripting 权限（用于按需注入）', (manifest.permissions || []).includes('scripting'));
  ok('content_scripts 按依赖顺序加载', JSON.stringify(manifest.content_scripts[0].js) === JSON.stringify(EXPECTED_FILES),
    manifest.content_scripts[0].js);
  ok('接口域已加入 host_permissions', (manifest.host_permissions || []).some((h) => h.includes('api-micreator.mihoyo.com')),
    manifest.host_permissions);
  ok('匹配 act.mihoyo.com 奇域页面', manifest.content_scripts[0].matches.some((m) => m.includes('miliastra')));
  ok('inject.js 声明为 web_accessible_resource', manifest.web_accessible_resources[0].resources.includes('src/inject.js'));
  ok('run_at = document_start', manifest.content_scripts[0].run_at === 'document_start');
  const refs = [];
  Object.values(manifest.icons).forEach((p) => refs.push(p));
  Object.values(manifest.action.default_icon).forEach((p) => refs.push(p));
  const fs = require('fs');
  ok('图标文件都存在', refs.every((p) => fs.existsSync(__dirname + '/../extension/' + p)), refs);
  ok('popup 文件存在', fs.existsSync(__dirname + '/../extension/' + manifest.action.default_popup));
  ok('background 文件存在', fs.existsSync(__dirname + '/../extension/' + manifest.background.service_worker));
}

/* ---- 按 Chrome 的顺序加载 content_scripts ---- */
const scripts = manifest ? manifest.content_scripts[0].js : [];
for (const s of scripts) {
  try {
    require('../extension/' + s);
    ok('加载 ' + s + ' 无异常', true);
  } catch (e) {
    ok('加载 ' + s + ' 无异常', false, String(e && e.message || e));
  }
}
ok('模块挂载：MHYData', typeof globalThis.MHYData === 'object');
ok('模块挂载：MHYXlsx', typeof globalThis.MHYXlsx === 'object');
ok('模块挂载：MHYCollect', typeof globalThis.MHYCollect === 'object');
ok('模块挂载：MHYExtract', typeof globalThis.MHYExtract === 'object');
ok('模块挂载：MHYUI', typeof globalThis.MHYUI === 'object');
ok('content.js 注册了 runtime 消息监听', chromeStub._msgListeners.length >= 1);
ok('content.js 注册了 window message 监听（接口拦截通道）', Array.isArray(listeners['message']) && listeners['message'].length > 0);

// 注入钩子 + 防重复标记
const injected = doc.documentElement.children.filter((c) => c.tagName === 'SCRIPT' && c.getAttribute('data-mhy-export-inject') === '1');
ok('尝试注入 src/inject.js', injected.length === 1 && String(injected[0].src || '').includes('src/inject.js'),
  injected.map((s) => s.src));
const guards = doc.querySelectorAll('meta').filter((m) => m.getAttribute('data-mhy-export-guard') === '1');
ok('注入防重复标记（DOM 级，可跨 content script 世界）', guards.length >= 1, guards.length);

/* ---- 消息入口 ---- */
(async () => {
  const fn = chromeStub._msgListeners[0];
  ok('content.js 处理 ping（background 用它探测是否已注入）',
    await new Promise((res) => fn({ type: 'ping' }, {}, res)).then((r) => r && r.ok === true));

  let response = null;
  fn({ type: 'runExport' }, {}, (r) => { response = r; });
  ok('runExport 立即回执', response && response.ok === true, response);

  const state = await new Promise((res) => fn({ type: 'state' }, {}, res));
  ok('state 返回页面信息', state && state.ok === true && state.stageId === '54461776301', state);

  await new Promise((r) => setTimeout(r, 500));
  const dl = sentMessages.find((m) => m.type === 'download');
  ok('向 background 发出了 download 请求', !!dl, sentMessages.map((m) => m.type));
  ok('导出前请求官方接口数据', sentMessages.some((m) => m.type === 'fetchData'), sentMessages.map((m) => m.type));
  if (dl) {
    const p = dl.payload;
    ok('xlsx 的 MIME 正确', p.mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', p.mime);
    ok('文件名含奇域名称与时间戳', /^奇域数据_54461776301_尘世执政录_\d{8}_\d{6}\.xlsx$/.test(p.filename), p.filename);
    const bytes = Buffer.from(p.base64, 'base64');
    ok('base64 解出的是合法 xlsx/ZIP', bytes[0] === 0x50 && bytes[1] === 0x4b && bytes.length > 3000, bytes.length);
    ok('文件名不含 Windows 非法字符', !/[\\/:*?"<>|]/.test(p.filename), p.filename);
  }

  /* ---- 接口拦截通道 ---- */
  const winMsg = listeners['message'][0];
  const fakeApi = {
    name: 'get_stage_report_overview',
    url: 'https://act.mihoyo.com/api/stage/report',
    size: 100,
    body: { list: [{ date: '2026-10-08', heat: 505 }, { date: '2026-10-09', heat: 505 }] }
  };
  winMsg({ source: globalThis, origin: 'https://act.mihoyo.com', data: { __mhyExport: true, channel: 'mhy-stage-export', payload: fakeApi } });
  const state2 = await new Promise((res) => fn({ type: 'state' }, {}, res));
  ok('接口数据被计入缓存', state2.captured === 1, state2);

  /* ---- background：按需注入 ---- */
  console.log('-- background 按需注入（装扩展前已打开的页面）--');
  try {
    require('../extension/src/background.js');
    ok('background.js 加载无异常', true);
  } catch (e) {
    ok('background.js 加载无异常', false, String(e && e.message || e));
  }
  const bgFn = chromeStub._msgListeners.find((l) => l !== fn);
  ok('background 注册了消息监听', typeof bgFn === 'function');

  const TARGET = 'https://act.mihoyo.com/miliastra_wonderland/developer#/StageData/stageDetail/54461776301';

  // 场景 1：未注入 + 目标页面 -> 自动注入
  chromeStub._tabs = [{ id: 7, url: TARGET }];
  chromeStub._injectCalls = [];
  chromeStub._sendToTab = (tabId, msg, cb) => {
    if (msg.type === 'ping') { globalThis.chrome.runtime.lastError = { message: 'no receiver' }; cb(undefined); globalThis.chrome.runtime.lastError = null; return; }
    cb({ ok: true, url: TARGET, stageId: '54461776301', captured: 0 });
  };
  const r1 = await new Promise((res) => bgFn({ type: 'state' }, {}, res));
  ok('未注入时自动 executeScript 注入', chromeStub._injectCalls.length === 1, chromeStub._injectCalls.length);
  ok('注入的文件顺序与 manifest 一致',
    JSON.stringify(chromeStub._injectCalls[0] && chromeStub._injectCalls[0].files) === JSON.stringify(EXPECTED_FILES),
    chromeStub._injectCalls[0] && chromeStub._injectCalls[0].files);
  ok('注入后 state 正常返回', r1 && r1.ok === true && r1.stageId === '54461776301', r1);

  // 场景 2：已注入 -> 不重复注入
  chromeStub._injectCalls = [];
  chromeStub._sendToTab = (tabId, msg, cb) => {
    if (msg.type === 'ping') { cb({ ok: true, url: TARGET }); return; }
    cb({ ok: true, url: TARGET, stageId: '54461776301', isDetail: true, captured: 2 });
  };
  const r2 = await new Promise((res) => bgFn({ type: 'state' }, {}, res));
  ok('已注入时不重复注入', chromeStub._injectCalls.length === 0, chromeStub._injectCalls.length);
  ok('已注入时直接取到状态', r2 && r2.ok === true && r2.captured === 2, r2);

  // 场景 3：非目标页面 -> 明确提示、不注入
  chromeStub._tabs = [{ id: 8, url: 'https://www.example.com/' }];
  chromeStub._injectCalls = [];
  const r3 = await new Promise((res) => bgFn({ type: 'runOnActiveTab' }, {}, res));
  ok('非奇域页面不注入并给出提示', chromeStub._injectCalls.length === 0 && r3 && /不是奇域页面/.test(r3.error || ''), r3);

  // 场景 4：目标页面未注入 + 点导出 -> 先注入再导出
  chromeStub._tabs = [{ id: 9, url: TARGET }];
  chromeStub._injectCalls = [];
  chromeStub._sendToTab = (tabId, msg, cb) => {
    if (msg.type === 'ping') { globalThis.chrome.runtime.lastError = { message: 'no receiver' }; cb(undefined); globalThis.chrome.runtime.lastError = null; return; }
    cb({ ok: true });
  };
  const r4 = await new Promise((res) => bgFn({ type: 'runOnActiveTab' }, {}, res));
  ok('点导出时会先注入再触发导出', chromeStub._injectCalls.length === 1 && r4 && r4.ok === true && r4.injected === true,
    { calls: chromeStub._injectCalls.length, r4 });

  /* ---- background：fetchData 消息（真实网络，可能未登录） ---- */
  const fetchReq = await new Promise((res) => bgFn({ type: 'fetchData', stageId: '54461776301' }, {}, res));
  ok('fetchData 有响应（未登录时会带错误说明）', fetchReq && (fetchReq.ok === true || typeof fetchReq.error === 'string'),
    fetchReq && (fetchReq.error || 'ok'));

  console.log('\n' + (fail === 0 ? `全部 ${pass} 项检查通过 ✅` : `${fail} 项失败 / ${pass} 项通过 ❌`));
  process.exit(fail ? 1 : 0);
})();
