/* =============================================================
 * 登录态 / 页面可达性探测
 *   用本机 Chrome + 独立调试 profile（userDataDir），不碰日常浏览器。
 *   node tools/probe.js [--head]
 * 首次运行若未登录，脚本会把浏览器留在登录页并提示你登录。
 * ============================================================= */
'use strict';

const fs = require('fs');
const path = require('path');

const PROFILE = path.join(__dirname, '..', '.debug-profile');
const OUT = path.join(__dirname, '..', 'test', 'out', 'probe');
const HEAD = process.argv.includes('--head');

const URLS = {
  stage: 'https://act.mihoyo.com/miliastra_wonderland/developer?mhy_presentation_style=fullscreen&mhy_auth_required=true#/StageData/stageDetail/54461776301',
  overview: 'https://act.mihoyo.com/miliastra_wonderland/developer?mhy_presentation_style=fullscreen&mhy_auth_required=true#/StageData/stageData'
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
  const list = [
    path.join(pf86, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(pf, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(local, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(pf86, 'Microsoft\\Edge\\Application\\msedge.exe'),
    path.join(pf, 'Microsoft\\Edge\\Application\\msedge.exe')
  ];
  return list.find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } });
}

(async () => {
  const pw = loadPlaywright();
  if (!pw) { console.error('未安装 playwright：npm install playwright'); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });

  const exe = findBrowser();
  const ctx = await pw.chromium.launchPersistentContext(PROFILE, {
    headless: !HEAD,
    executablePath: exe,
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    args: ['--disable-blink-features=AutomationControlled']
  });

  const page = ctx.pages()[0] || await ctx.newPage();
  const captured = [];
  const apiLog = [];

  page.on('response', async (res) => {
    try {
      const url = res.url();
      if (!/mihoyo\.com/.test(url)) return;
      const ct = (res.headers()['content-type'] || '');
      if (!/json/i.test(ct)) return;
      const body = await res.text().catch(() => '');
      let json = null;
      try { json = JSON.parse(body); } catch (e) { /* ignore */ }
      apiLog.push({ url: url.split('?')[0], status: res.status(), method: res.request().method(), size: body.length });
      if (json) captured.push({ url: url.split('?')[0], fullUrl: url, body: json });
    } catch (e) { /* ignore */ }
  });

  const report = { browser: exe, profile: PROFILE, headless: !HEAD, pages: [] };

  for (const [name, url] of Object.entries(URLS)) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(6000);
      const info = await page.evaluate(() => {
        const txt = document.body ? document.body.innerText : '';
        return {
          url: location.href,
          title: document.title,
          textLen: txt.length,
          hasLoginWord: /登录|扫码|通行证|账号/.test(txt),
          hasDataWord: /热度|游玩|奇域/.test(txt),
          cookies: document.cookie.length,
          canvases: document.querySelectorAll('canvas').length,
          tables: document.querySelectorAll('table').length,
          textSample: txt.replace(/\s+/g, ' ').slice(0, 600)
        };
      });
      report.pages.push(Object.assign({ name }, info));
    } catch (e) {
      report.pages.push({ name, error: String(e && e.message || e) });
    }
  }

  report.api = apiLog;
  report.apiWithBody = captured.map((c) => ({ url: c.url, keys: Object.keys(c.body || {}).slice(0, 12), preview: JSON.stringify(c.body).slice(0, 400) }));
  fs.writeFileSync(path.join(OUT, 'probe.json'), JSON.stringify(report, null, 2), 'utf8');

  // 把原始响应也落盘，便于分析真实字段
  captured.forEach((c, i) => {
    const safe = c.url.replace(/^https?:\/\//, '').replace(/[^A-Za-z0-9._-]/g, '_');
    fs.writeFileSync(path.join(OUT, 'api_' + i + '_' + safe + '.json'), JSON.stringify(c.body, null, 2), 'utf8');
  });

  console.log(JSON.stringify({
    browser: report.browser,
    pages: report.pages.map((p) => ({ name: p.name, url: p.url, title: p.title, textLen: p.textLen, login: p.hasLoginWord, data: p.hasDataWord, canvases: p.canvases, tables: p.tables, error: p.error })),
    jsonApiCount: report.api.length,
    api: report.api.slice(0, 30)
  }, null, 2));

  if (!HEAD) {
    await ctx.close();
  } else {
    console.log('\n浏览器保持打开（--head）。登录后请再运行：node tools/probe.js');
  }
})().catch((e) => { console.error('探测失败：', e); process.exit(1); });
