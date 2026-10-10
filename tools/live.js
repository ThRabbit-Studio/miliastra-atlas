/* =============================================================
 * 实况抓取工具（用本机 Chrome + 独立调试 profile）
 *
 *   node tools/live.js login     # 打开登录页，你登录一次（登录态存到 .debug-profile）
 *   node tools/live.js capture   # 复用登录态，抓真实接口响应 + 页面结构，落盘到 test/out/live
 *   node tools/live.js open      # 只打开页面，浏览器保持运行（方便你手动切到某个奇域）
 *
 * 只读：不修改页面数据，不上传任何东西。所有响应原样落盘供分析。
 * ============================================================= */
'use strict';

const fs = require('fs');
const path = require('path');

const PROFILE = path.join(__dirname, '..', '.debug-profile');
const OUT = path.join(__dirname, '..', 'test', 'out', 'live');
const CMD = process.argv[2] || 'capture';
const HEADED = CMD === 'login' || CMD === 'open' || process.argv.includes('--head');

const BASE = 'https://act.mihoyo.com/miliastra_wonderland/developer?mhy_presentation_style=fullscreen&mhy_auth_required=true';
const PAGES = {
  stageDetail: BASE + '#/StageData/stageDetail/54461776301',
  creatorOverview: BASE + '#/StageData/stageData'
};

function loadPlaywright() {
  for (const c of ['playwright', 'playwright-core']) {
    try { return require(c); } catch (e) { /* next */ }
  }
  return null;
}

function findBrowser() {
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';
  return [
    path.join(pf86, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(pf, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(local, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(pf86, 'Microsoft\\Edge\\Application\\msedge.exe'),
    path.join(pf, 'Microsoft\\Edge\\Application\\msedge.exe')
  ].find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } });
}

function safeName(s) {
  return String(s).replace(/^https?:\/\//, '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
}

async function launch(headless) {
  const pw = loadPlaywright();
  if (!pw) throw new Error('未安装 playwright：npm install playwright');
  fs.mkdirSync(PROFILE, { recursive: true });
  const ctx = await pw.chromium.launchPersistentContext(PROFILE, {
    headless,
    executablePath: findBrowser(),
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    acceptDownloads: true,
    args: ['--disable-blink-features=AutomationControlled']
  });
  return ctx;
}

/* ---------------- login ---------------- */
async function doLogin() {
  const ctx = await launch(false);
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(PAGES.creatorOverview, { waitUntil: 'domcontentloaded' }).catch(() => {});
  console.log('浏览器已打开，请在窗口里完成登录（扫码或账号）。');
  console.log('登录成功后本脚本会自动检测并退出；也可以直接关掉窗口。\n');

  const started = Date.now();
  let loggedIn = false;
  while (Date.now() - started < 10 * 60 * 1000) {
    await page.waitForTimeout(2500);
    try {
      if (page.isClosed()) break;
      const r = await page.evaluate(async () => {
        try {
          const res = await fetch('https://api-micreator.mihoyo.com/kolugc_hch/common/v1/creator/basic_info', { credentials: 'include' });
          const j = await res.json();
          return { retcode: j.retcode, message: j.message, data: j.data };
        } catch (e) { return { error: String(e) }; }
      });
      if (r && r.retcode === 0) {
        loggedIn = true;
        console.log('登录成功 ✓  profile 已保存：' + PROFILE);
        console.log('basic_info = ' + JSON.stringify(r.data));
        break;
      }
    } catch (e) { /* 页面导航中，忽略 */ }
  }
  if (!loggedIn) console.log('未检测到登录成功（超时或窗口已关闭）。稍后可再运行 login。');
  await ctx.close();
}

/* ---------------- capture ---------------- */
async function doCapture() {
  const ctx = await launch(!HEADED);
  const page = ctx.pages()[0] || await ctx.newPage();
  fs.mkdirSync(OUT, { recursive: true });

  const records = [];
  page.on('response', async (res) => {
    try {
      const url = res.url();
      if (!/mihoyo\.com/.test(url)) return;
      if (res.status() >= 400) return;
      const ct = (res.headers()['content-type'] || '');
      const body = await res.text().catch(() => null);
      if (body === null) return;
      const isJson = /json/i.test(ct) || /^[[{]/.test(body.trim());
      if (!isJson) return;
      let json = null;
      try { json = JSON.parse(body); } catch (e) { return; }
      const req = res.request();
      records.push({
        url: url.split('?')[0],
        fullUrl: url,
        method: req.method(),
        postData: (() => { try { return req.postData(); } catch (e) { return null; } })(),
        status: res.status(),
        size: body.length,
        time: new Date().toISOString(),
        body: json
      });
    } catch (e) { /* ignore */ }
  });

  const structure = {};
  for (const [name, url] of Object.entries(PAGES)) {
    console.log('打开 ' + name + ' …');
    records.length = 0;
    await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(9000);

    // 页面结构快照（给选择器/文案用）
    structure[name] = await page.evaluate(() => {
      function outline(el, depth, maxDepth) {
        if (!el || depth > maxDepth) return null;
        const kids = Array.from(el.children);
        return {
          tag: el.tagName.toLowerCase(),
          cls: typeof el.className === 'string' ? el.className.slice(0, 80) : '',
          text: (el.children.length === 0 ? (el.textContent || '').trim().slice(0, 60) : ''),
          kids: kids.slice(0, 40).map((k) => outline(k, depth + 1, maxDepth)).filter(Boolean)
        };
      }
      return {
        url: location.href,
        title: document.title,
        bodyText: (document.body ? document.body.innerText : '').replace(/\n{2,}/g, '\n').slice(0, 6000),
        canvases: document.querySelectorAll('canvas').length,
        tables: document.querySelectorAll('table').length,
        hasEcharts: typeof window.echarts === 'object',
        chartCount: (() => { try { return (window.echarts && window.echarts._instances) ? (window.echarts._instances.size || 0) : 0; } catch (e) { return 0; } })(),
        tree: document.body ? outline(document.body, 0, 4) : null
      };
    });

    // 页面上的可点标签（近7日/近30日 等）——顺手把这些也点一遍，抓不同区间的数据
    const tabs = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('button,div,span,li').forEach((el) => {
        const t = (el.textContent || '').trim();
        if (el.children.length > 2) return;
        if (/^(近7日|近30日|近90日|近3日|全部|常规区间|自定义)$/.test(t)) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) out.push({ text: t, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
        }
      });
      return out;
    });
    structure[name].tabs = tabs;

    const snapshots = {};
    for (const tab of tabs) {
      const before = records.length;
      await page.mouse.click(tab.x, tab.y).catch(() => {});
      await page.waitForTimeout(4000);
      snapshots[tab.text] = records.slice(before).map((r) => ({ url: r.url, body: r.body }));
    }

    // 落盘本页所有响应
    records.forEach((r, i) => {
      const key = safeName(name + '__' + (r.url.split('/').slice(-2).join('_')) + '__' + i);
      fs.writeFileSync(path.join(OUT, key + '.json'), JSON.stringify({ url: r.fullUrl, method: r.method, postData: r.postData, status: r.status, body: r.body }, null, 2), 'utf8');
    });
    fs.writeFileSync(path.join(OUT, name + '__structure.json'), JSON.stringify(structure[name], null, 2), 'utf8');
    if (Object.keys(snapshots).length) fs.writeFileSync(path.join(OUT, name + '__tabs.json'), JSON.stringify(snapshots, null, 2), 'utf8');

    const pageRecs = records.slice();
    fs.writeFileSync(path.join(OUT, name + '__api_index.json'), JSON.stringify(pageRecs.map((r) => ({
      url: r.url, method: r.method, status: r.status, size: r.size,
      topKeys: r.body && typeof r.body === 'object' ? Object.keys(r.body).slice(0, 15) : [],
      retcode: r.body && r.body.retcode
    })), null, 2), 'utf8');
    console.log('  ' + name + '：捕获 ' + pageRecs.length + ' 个 JSON 响应，页面文本 ' + structure[name].bodyText.length + ' 字');
  }

  console.log('\n结果目录：' + OUT);
  if (HEADED) console.log('浏览器保持打开，你可以手动切到目标奇域页面；按 Ctrl+C 结束。');
  else await ctx.close();

  if (HEADED) await new Promise(() => {});
}

(async () => {
  if (CMD === 'login') await doLogin();
  else if (CMD === 'open') {
    const ctx = await launch(false);
    const page = ctx.pages()[0] || await ctx.newPage();
    await page.goto(PAGES.creatorOverview, { waitUntil: 'domcontentloaded' }).catch(() => {});
    console.log('浏览器已打开。完成操作后按 Ctrl+C 关闭。');
    await new Promise(() => {});
  } else await doCapture();
})().catch((e) => { console.error('失败：', e); process.exit(1); });
