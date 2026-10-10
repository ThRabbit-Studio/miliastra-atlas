/* =============================================================
 * 交互式路由/接口发现：用真实 UI 路径进入页面，枚举所有接口与路由
 *   node tools/discover.js
 * 输出：test/out/live/discover.json + 每个接口的响应体
 * ============================================================= */
'use strict';

const fs = require('fs');
const path = require('path');

const PROFILE = path.join(__dirname, '..', '.debug-profile');
const OUT = path.join(__dirname, '..', 'test', 'out', 'live');

function loadPlaywright() {
  for (const c of ['playwright', 'playwright-core']) { try { return require(c); } catch (e) { /* next */ } }
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
function safe(s) { return String(s).replace(/^https?:\/\//, '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 110); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const pw = loadPlaywright();
  const ctx = await pw.chromium.launchPersistentContext(PROFILE, {
    headless: true,
    executablePath: findBrowser(),
    viewport: { width: 1440, height: 1000 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai'
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  fs.mkdirSync(OUT, { recursive: true });

  const api = [];
  page.on('response', async (res) => {
    try {
      const url = res.url();
      if (!/api-micreator|act\.mihoyo/.test(url)) return;
      const ct = res.headers()['content-type'] || '';
      const body = await res.text().catch(() => null);
      if (!body) return;
      let json = null;
      try { json = JSON.parse(body); } catch (e) { if (!/json/i.test(ct)) return; }
      if (!json) return;
      api.push({ url: url.split('?')[0], fullUrl: url, method: res.request().method(), status: res.status(), size: body.length, body: json });
    } catch (e) { /* ignore */ }
  });

  const log = [];
  const routeHits = {};

  async function snap(tag) {
    const info = await page.evaluate(() => {
      const txt = document.body ? document.body.innerText : '';
      return {
        url: location.href,
        hash: location.hash,
        text: txt.replace(/\n{2,}/g, '\n').slice(0, 2500),
        canvases: document.querySelectorAll('canvas').length,
        svgs: document.querySelectorAll('svg').length,
        charts: (() => { try { return window.echarts && window.echarts._instances ? (window.echarts._instances.size || 0) : 0; } catch (e) { return 0; } })()
      };
    });
    log.push(Object.assign({ tag }, info));
    routeHits[info.hash] = (routeHits[info.hash] || 0) + 1;
    console.log('[' + tag + '] hash=' + info.hash + ' canvas=' + info.canvases + ' text=' + info.text.length);
    return info;
  }

  async function clickByText(text, opts) {
    const handle = await page.evaluateHandle((t) => {
      const nodes = Array.from(document.querySelectorAll('a,div,span,li,button,p'));
      const hit = nodes.filter((el) => (el.textContent || '').trim() === t && el.children.length <= 2)
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter((x) => x.r.width > 0 && x.r.height > 0)
        .sort((a, b) => (a.r.width * a.r.height) - (b.r.width * b.r.height))[0];
      return hit ? hit.el : null;
    }, text);
    const el = handle.asElement();
    if (!el) return false;
    try { await el.click({ timeout: 5000 }); } catch (e) { return false; }
    await sleep(opts && opts.wait || 3500);
    return true;
  }

  // 从首页开始，走真实导航
  await page.goto('https://act.mihoyo.com/miliastra_wonderland/developer?mhy_presentation_style=fullscreen&mhy_auth_required=true', { waitUntil: 'domcontentloaded' });
  await sleep(7000);
  await snap('home');

  for (const label of ['数据中心', '奇匠数据', '奇域数据']) {
    const before = api.length;
    const okClick = await clickByText(label);
    const info = await snap('click:' + label + (okClick ? '' : '(未找到)'));
    console.log('   本步新增接口: ' + api.slice(before).map((a) => a.url.split('/').pop()).join(', ') || '（无）');
  }

  // 奇域数据 -> 列表页，点第一个奇域进入详情
  const beforeDetail = api.length;
  const clicked = await page.evaluateHandle(() => {
    const cands = Array.from(document.querySelectorAll('div,li,tr,a'))
      .filter((el) => /\d{8,}/.test(el.textContent || '') && el.children.length < 8)
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter((x) => x.r.width > 60 && x.r.height > 20);
    cands.sort((a, b) => (a.r.width * a.r.height) - (b.r.width * b.r.height));
    return cands[0] ? cands[0].el : null;
  });
  const detailEl = clicked.asElement();
  if (detailEl) {
    await detailEl.click({ timeout: 5000 }).catch(() => {});
    await sleep(6000);
    await snap('click:奇域列表第一项');
    console.log('   新增接口: ' + api.slice(beforeDetail).map((a) => a.url.split('/').pop()).join(', '));
  } else {
    await snap('奇域列表(未找到条目)');
  }

  // 落盘
  fs.writeFileSync(path.join(OUT, 'discover.json'), JSON.stringify({ log, routeHits }, null, 2), 'utf8');
  const seen = new Set();
  api.forEach((a, i) => {
    const key = a.url;
    if (seen.has(key + a.method)) return;
    seen.add(key + a.method);
    fs.writeFileSync(path.join(OUT, 'discover_' + safe(a.url.split('//')[1]) + '.json'), JSON.stringify(a.body, null, 2), 'utf8');
  });
  fs.writeFileSync(path.join(OUT, 'discover_api_index.json'), JSON.stringify(api.map((a) => ({ url: a.url, method: a.method, status: a.status, size: a.size, retcode: a.body && a.body.retcode })), null, 2), 'utf8');

  console.log('\n=== 访问到的路由 ===');
  Object.keys(routeHits).forEach((h) => console.log('  ' + h + '  ×' + routeHits[h]));
  console.log('\n=== 捕获的接口（去重） ===');
  const uniq = new Map();
  api.forEach((a) => uniq.set(a.method + ' ' + a.url, a));
  uniq.forEach((a, k) => console.log('  ' + k + '  size=' + a.size));

  await ctx.close();
})().catch((e) => { console.error('发现失败：', e); process.exit(1); });
