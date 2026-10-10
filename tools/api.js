/* =============================================================
 * 官方接口客户端（Node 侧，调试/工具用）
 * 复用 .debug-profile 里的登录态（Cookie 存在 profile 的 Cookies 文件里，
 * 这里直接用 Playwright 的 request context 读取，不需要额外登录）。
 * ============================================================= */
'use strict';

const fs = require('fs');
const path = require('path');

const PROFILE = path.join(__dirname, '..', '.debug-profile');
const BASE = 'https://api-micreator.mihoyo.com/kolugc_hch/common/v1';
const COMMON = { lang: 'zh-cn', game_biz: 'hk4e_cn' };

function loadPlaywright() {
  for (const c of ['playwright', 'playwright-core']) { try { return require(c); } catch (e) { /* next */ } }
  throw new Error('未安装 playwright：npm install playwright');
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

let ctxPromise = null;
async function context() {
  if (!ctxPromise) {
    const pw = loadPlaywright();
    ctxPromise = pw.chromium.launchPersistentContext(PROFILE, {
      headless: true,
      executablePath: findBrowser(),
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai'
    });
  }
  return ctxPromise;
}

async function closeContext() {
  if (ctxPromise) {
    const ctx = await ctxPromise;
    await ctx.close();
    ctxPromise = null;
  }
}

async function get(pathname, params) {
  const ctx = await context();
  const u = new URL(BASE + pathname);
  Object.assign({}, COMMON);
  Object.entries(Object.assign({}, COMMON, params || {})).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
  });
  const res = await ctx.request.get(u.toString());
  if (!res.ok()) throw new Error(pathname + ' HTTP ' + res.status());
  return await res.json();
}

async function basicInfo() {
  const j = await get('/creator/basic_info');
  const d = (j && j.data) || {};
  const acc = d.current_role_account || {};
  return { retcode: j.retcode, message: j.message, region: acc.region || d.region || '', uid: acc.uid || d.uid || '', raw: j };
}

async function auth() {
  const b = await basicInfo();
  if (b.retcode !== 0) throw new Error('未登录：' + b.message);
  return { region: b.region, uid: b.uid };
}

async function fetchStageDetail(stageId) {
  const a = await auth();
  return await get('/data/get_stage_detail', Object.assign({ stage_id: stageId }, a));
}
async function fetchUserInfo() {
  const a = await auth();
  return await get('/data/get_user_info', a);
}
async function fetchStageList(page, pageSize) {
  const a = await auth();
  return await get('/data/get_stage_list', Object.assign({ page: page || 1, page_size: pageSize || 50 }, a));
}

module.exports = { basicInfo, auth, fetchStageDetail, fetchUserInfo, fetchStageList, get, closeContext };
