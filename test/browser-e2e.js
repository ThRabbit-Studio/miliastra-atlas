/* =============================================================
 * 真实浏览器端到端测试（Playwright + 真实 Chromium）
 *
 *  A. 复刻页面（本地 HTTP，真实 ECharts）：
 *     注入扩展的 content_scripts，真实执行 DOM 采集 + ECharts 读取 + XLSX 生成。
 *  B. 奇域详情页 URL（https://act.mihoyo.com/...，请求被本地路由拦截）：
 *     模拟 chrome.* API，真实执行「点击导出 → 生成 base64 → 交给下载」整条链路。
 *
 *   node test/browser-e2e.js
 * ============================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

const OUT = path.join(__dirname, 'out');
const FIXTURE = path.join(__dirname, 'fixture');
const EXT = path.join(__dirname, '..', 'extension');
const TARGET_URL = 'https://act.mihoyo.com/miliastra_wonderland/developer?mhy_presentation_style=fullscreen&mhy_auth_required=true#/StageData/stageDetail/54461776301';

let pass = 0, fail = 0, skipped = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? '  → ' + JSON.stringify(detail) : '')); }
}
function skip(name, why) {
  skipped++;
  console.log('  - ' + name + '（跳过：' + why + '）');
}

function loadPlaywright() {
  const candidates = ['playwright', 'playwright-core'];
  for (const c of candidates) {
    try { return require(c); } catch (e) { /* next */ }
  }
  return null;
}

function serve(dir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      const file = path.join(dir, urlPath === '/' ? 'page.html' : urlPath.replace(/^\/+/, ''));
      if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
      }
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css' };
      res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const CONTENT_SCRIPTS = ['src/core/data.js', 'src/core/extract.js', 'src/core/xlsx.js', 'src/core/collect.js', 'src/ui.js', 'src/content.js'];
const PAGE_HTML = fs.readFileSync(path.join(FIXTURE, 'page.html'), 'utf8');
const ECHARTS_JS = fs.readFileSync(path.join(FIXTURE, 'echarts.min.js'), 'utf8');

/** 直接复用系统已安装的 Chrome / Edge，不额外下载浏览器内核 */
function findInstalledBrowser() {
  const local = process.env.LOCALAPPDATA || '';
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const candidates = [
    process.env.MHY_E2E_BROWSER,
    path.join(pf86, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(pf, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(local, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(pf86, 'Microsoft\\Edge\\Application\\msedge.exe'),
    path.join(pf, 'Microsoft\\Edge\\Application\\msedge.exe')
  ].filter(Boolean);
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch (e) { /* next */ }
  }
  return null;
}

function installChromeShim(officialData) {
  const sent = [];
  const listeners = [];
  let urlCounter = 0;
  const blobRegistry = new Map();
  const chrome = {
    runtime: {
      lastError: null,
      getURL: (p) => 'chrome-extension://test-extension-id/' + p,
      sendMessage: (msg, cb) => {
        sent.push(msg);
        // 模拟 background：按 stageId 返回官方接口数据（与真实行为一致）
        if (msg && msg.type === 'fetchData') {
          const wanted = msg.stageId;
          const fixtureId = officialData && officialData.stage && officialData.stage.data
            && officialData.stage.data.stage_info && officialData.stage.data.stage_info.stage_id;
          const match = !!(officialData && wanted && String(wanted) === String(fixtureId));
          if (typeof window !== 'undefined' && window.__test) window.__test.fetchIds = (window.__test.fetchIds || []).concat([String(wanted) + ' vs ' + String(fixtureId) + ' => ' + match]);
          setTimeout(() => cb(match
            ? { ok: true, data: officialData }
            : { ok: true, data: { stage: null, user: officialData ? officialData.user : null, list: null, errors: wanted ? ['该奇域无数据'] : ['未解析到奇域ID'] } }), 0);
          return;
        }
        if (msg && msg.type === 'download') {
          // 模拟 background service worker：把 base64 还原成 Blob URL 并交给 <a download>
          let url = null;
          try {
            const bin = atob(msg.payload.base64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            const blob = new Blob([bytes], { type: msg.payload.mime });
            url = 'blob:' + location.origin + '/' + (++urlCounter);
            blobRegistry.set(url, { blob, filename: msg.payload.filename });
          } catch (e) { /* ignore */ }
          setTimeout(() => cb({ ok: true, downloadId: 1, filename: msg.payload.filename, url }), 0);
          return;
        }
        setTimeout(() => cb({ ok: true }), 0);
      },
      onMessage: { addListener: (fn) => listeners.push(fn) }
    }
  };
  window.chrome = chrome;
  window.__test = { sent, listeners, blobRegistry, errors: [] };
  window.addEventListener('error', (e) => window.__test.errors.push(String(e.message)));
}

(async () => {
  console.log('== 真实浏览器端到端测试 ==');

  const pw = loadPlaywright();
  if (!pw) { skip('浏览器 E2E', '未安装 playwright（npm install playwright）'); process.exit(0); }

  let browser = null;
  const exe = findInstalledBrowser();
  const launchAttempts = [];
  if (exe) launchAttempts.push({ executablePath: exe });
  launchAttempts.push({ channel: 'chrome' }, { channel: 'msedge' }, {});
  let launchError = null;
  for (const opts of launchAttempts) {
    try {
      browser = await pw.chromium.launch(Object.assign({ headless: true }, opts));
      console.log('  使用浏览器：' + (opts.executablePath || opts.channel || 'playwright 内置 chromium'));
      break;
    } catch (e) {
      launchError = e;
    }
  }
  if (!browser) {
    skip('浏览器 E2E', '无法启动本机浏览器：' + String(launchError && launchError.message).split('\n')[0]);
    process.exit(0);
  }

  const { server, port } = await serve(FIXTURE);
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message)));

  // chrome.* API 桩要在任何页面导航之前装好；
  // 同时把真实抓取的官方接口响应喂给 fetchData，验证「官方接口优先」这条主路径
  const officialData = (() => {
    const dir = path.join(FIXTURE, 'api');
    function load(n) {
      const p = path.join(dir, n);
      if (!fs.existsSync(p)) return null;
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      return j && j.retcode === 0 ? j : null;
    }
    const stage = load('stage_detail.json');
    if (!stage) return null;
    return { stage, user: load('user_info.json'), list: load('stage_list.json'), errors: [], region: 'cn_gf01', uid: '100000001' };
  })();
  await page.addInitScript(installChromeShim, officialData);

  // 所有 act.mihoyo.com 的请求都路由到本地复刻页面，这样 location.href 就是真正的奇域详情页 URL
  await page.route('https://act.mihoyo.com/**', async (route) => {
    const u = new URL(route.request().url());
    const name = u.pathname.split('/').pop();
    if (name && name.endsWith('.js')) {
      const local = path.join(FIXTURE, name);
      if (fs.existsSync(local)) {
        await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: fs.readFileSync(local) });
        return;
      }
    }
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE_HTML });
  });

  /* ---------- A. 详情页 URL 下的真实采集与生成 ---------- */
  console.log('-- A. 真实 Chromium 采集与生成 --');
  await page.goto(TARGET_URL, { waitUntil: 'load' });
  await page.waitForFunction('window.__PAGE_READY__ === true', { timeout: 30000 });
  ok('复刻页面加载完成，ECharts 已初始化', await page.evaluate(() => typeof window.echarts.init === 'function'));
  ok('页面存在 2 个 canvas', await page.evaluate(() => document.querySelectorAll('canvas').length === 2));
  ok('页面 URL 是奇域详情页', page.url().includes('/StageData/stageDetail/54461776301'), page.url());

  for (const f of CONTENT_SCRIPTS) await page.addScriptTag({ content: fs.readFileSync(path.join(EXT, f), 'utf8') });
  ok('content script 注入成功', await page.evaluate(() => !!(window.MHYCollect && window.MHYXlsx && window.MHYData)));
  ok('悬浮面板已挂载到真实 DOM', await page.evaluate(() => !!document.querySelector('[data-mhy-export-ui]')));
  ok('面板有导出区间按钮（近7日/近30日/全部）', await page.evaluate(() => {
    const host = document.querySelector('[data-mhy-export-ui]');
    if (!host || !host.shadowRoot) return false;
    const txt = host.shadowRoot.textContent || '';
    return ['近7日', '近30日', '全部'].every((t) => txt.indexOf(t) !== -1);
  }));
  ok('默认区间为近 30 日', await page.evaluate(() => window.MHYUI.getRange() === 30));

  const collected = await page.evaluate(() => JSON.parse(JSON.stringify(
    window.MHYCollect.collect({ url: location.href, title: document.title, captured: [] })
  )));
  ok('采集：奇域名称', collected.overview.name === '尘世执政录', collected.overview);
  ok('采集：状态', collected.overview.status === '上线中', collected.overview.status);
  ok('采集：发布时间规范化', collected.overview.publishTime === '2026-09-27 19:02:00', collected.overview.publishTime);
  ok('采集：奇域热度 505', String(collected.overview.heat) === '505', collected.overview.heat);
  ok('采集：平均游玩时长 323 秒', collected.overview.avgDuration && collected.overview.avgDuration.seconds === 323, collected.overview.avgDuration);
  ok('ECharts 真读：2 张折线图', collected.charts.length === 2, collected.charts.map((c) => c.title));
  const heat = collected.charts.find((c) => c.title === '奇域热度');
  ok('ECharts 真读：30 个数据点', heat && heat.rows.length === 30, heat && heat.rows.length);
  ok('ECharts 真读：末值 505 / 日期 2026-10-09', heat && heat.rows[29][1] === 505 && heat.rows[29][0] === '2026-10-09', heat && heat.rows[29]);
  ok('ECharts 真读：表头 [日期, 奇域热度]', heat && heat.header[0] === '日期' && heat.header[1] === '奇域热度', heat && heat.header);

  const built = await page.evaluate(async (data) => {
    const sheets = window.MHYData.buildWorkbook(data);
    const bytes = await window.MHYXlsx.buildXlsx(sheets);
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return { base64: btoa(bin), size: bytes.length, sheets: sheets.map((s) => s.name), hasCS: typeof CompressionStream === 'function' };
  }, collected);
  ok('真实浏览器支持 CompressionStream（真压缩）', built.hasCS === true);
  ok('真实生成 xlsx 且体积合理', built.size > 5000, built.size);
  ok('工作表齐全（面向分析的结构）',
    ['统计概览', '关卡基础数据', '奇域热度', '平均游玩时长', '关键指标'].every((n) => built.sheets.includes(n)), built.sheets);
  ok('不含接口原始/调试数据表', !built.sheets.some((n) => /数据来源|全部数据|diagnostic|api/i.test(n)), built.sheets);

  fs.mkdirSync(OUT, { recursive: true });
  const xlsxPath = path.join(OUT, '浏览器E2E_奇域数据.xlsx');
  fs.writeFileSync(xlsxPath, Buffer.from(built.base64, 'base64'));
  const buf = fs.readFileSync(xlsxPath);
  ok('落盘文件是合法 ZIP 且大小一致', buf[0] === 0x50 && buf[1] === 0x4b && buf.length === built.size, buf.length + ' vs ' + built.size);

  const csv = await page.evaluate((data) => '\ufeff' + window.MHYXlsx.buildCsv(window.MHYData.buildWorkbook(data)), collected);
  fs.writeFileSync(path.join(OUT, '浏览器E2E_奇域数据.csv'), csv, 'utf8');
  ok('CSV 含表名与数据', csv.includes('# 统计概览') && csv.includes('奇域热度') && csv.includes('505'));

  /* ---------- B. 模拟 chrome API，跑完整导出链路 ---------- */
  console.log('-- B. 完整导出链路（runExport → background download）--');
  // 切换导出区间到「近7日」，验证面板控件真的生效
  const rangeSwitched = await page.evaluate(() => {
    const host = document.querySelector('[data-mhy-export-ui]');
    const root = host && host.shadowRoot;
    if (!root) return null;
    const btn = Array.from(root.querySelectorAll('button')).filter((b) => (b.textContent || '').trim() === '近7日')[0];
    if (!btn) return null;
    btn.click();
    return window.MHYUI.getRange();
  });
  ok('点击「近7日」后面板区间生效', rangeSwitched === 7, rangeSwitched);
  // background 的 ensureInjected() 会先 ping 探测是否已注入：已注入时必须回 ok，避免重复注入
  const pingOk = await page.evaluate(() => new Promise((resolve) => {
    const fn = window.__test.listeners[0];
    if (!fn) { resolve(null); return; }
    let done = false;
    const ret = fn({ type: 'ping' }, {}, (r) => { done = true; resolve(r); });
    setTimeout(() => { if (!done) resolve({ timeout: true, returned: ret }); }, 2000);
  }));
  ok('ping 探测返回已就绪（background 不会重复注入）', pingOk && pingOk.ok === true, pingOk);

  // 通过扩展的 runtime 消息入口触发真实导出（等价于点 popup / 右键菜单）
  const triggered = await page.evaluate(() => {
    const fn = window.__test.listeners[0];
    if (!fn) return { error: 'no-listener' };
    let res = null;
    fn({ type: 'runExport' }, {}, (r) => { res = r; });
    return { res };
  });
  ok('runExport 消息被 content script 接收', triggered && triggered.res && triggered.res.ok === true, triggered);
  await page.waitForFunction('window.__test.sent.some(m => m.type === "download")', { timeout: 20000 }).catch(() => {});
  const dl = await page.evaluate(() => {
    const m = window.__test.sent.find((x) => x.type === 'download');
    if (!m) return null;
    return { mime: m.payload.mime, ext: m.payload.ext, filename: m.payload.filename, size: Math.round(m.payload.base64.length * 3 / 4) };
  });
  ok('触发导出后向 background 发出 download 请求', !!dl, await page.evaluate(() => window.__test.sent.map((m) => m.type)));
  ok('导出前先向 background 请求官方接口数据', await page.evaluate(() => window.__test.sent.some((m) => m.type === 'fetchData')),
    await page.evaluate(() => window.__test.sent.map((m) => m.type)));
  const pageHadError = await page.evaluate(() => window.__test.errors || []);
  ok('导出过程无异常', pageHadError.length === 0, pageHadError.slice(0, 2));
  if (dl) {
    ok('MIME 为 xlsx', dl.mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', dl.mime);
    ok('文件名为 奇域数据_奇域ID_名称_时间.xlsx', /^奇域数据_54461776301_尘世执政录_\d{8}_\d{6}\.xlsx$/.test(dl.filename), dl.filename);
    ok('导出体积合理（>8KB）', dl.size > 8000, dl.size);
  }

  // 官方接口路径产出的 xlsx 应包含只有接口数据才有的结构化工作表
  if (dl && officialData) {
    const b64 = await page.evaluate(() => {
      const m = window.__test.sent.find((x) => x.type === 'download');
      return m.payload.base64;
    });
    const buf = Buffer.from(b64, 'base64');
    const officialXlsx = path.join(OUT, '浏览器E2E_官方接口.xlsx');
    fs.writeFileSync(officialXlsx, buf);
    ok('官方接口导出文件已落盘且体积合理', buf.length > 8000, buf.length);
    // 官方接口版含 22 张工作表（页面兜底版只有 5 张），体积差异明显；
    // 工作表 XML 是 deflate 压缩的，因此这里用体积区分来源。
    ok('体积明显大于页面兜底版（说明走的是官方接口全量数据）', buf.length > 18000, buf.length);
  }

  ok('全程无页面 JS 报错', pageErrors.length === 0, pageErrors.slice(0, 3));

  await browser.close();
  server.close();

  console.log('  产物：' + xlsxPath);
  console.log('\n' + (fail === 0 ? `全部 ${pass} 项检查通过 ✅` : `${fail} 项失败 / ${pass} 项通过 ❌`) + (skipped ? `（跳过 ${skipped} 项）` : ''));
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('E2E 异常：', e);
  process.exit(1);
});
