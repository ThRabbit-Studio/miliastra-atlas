/* =============================================================
 * Miliastra Atlas — Service Worker
 * 负责：下载落盘、popup 消息路由、右键菜单
 * ============================================================= */
'use strict';

const MENU_ID = 'mhy-stage-export-run';
// 需与 manifest.content_scripts[0].js 保持一致（顺序不能变）
const CONTENT_FILES = ['src/core/data.js', 'src/core/extract.js', 'src/core/xlsx.js', 'src/core/collect.js', 'src/ui.js', 'src/content.js'];
const TARGET_RE = /^https:\/\/act\.mihoyo\.com\/miliastra_wonderland\//i;

/** 官方数据接口（用浏览器自身登录态直接请求，最准确、最完整） */
const API = {
  basic: 'https://api-micreator.mihoyo.com/kolugc_hch/common/v1/creator/basic_info',
  stageDetail: 'https://api-micreator.mihoyo.com/kolugc_hch/common/v1/data/get_stage_detail',
  stageList: 'https://api-micreator.mihoyo.com/kolugc_hch/common/v1/data/get_stage_list',
  userInfo: 'https://api-micreator.mihoyo.com/kolugc_hch/common/v1/data/get_user_info'
};

async function fetchJson(base, params) {
  const u = new URL(base);
  u.searchParams.set('lang', 'zh-cn');
  u.searchParams.set('game_biz', 'hk4e_cn');
  Object.keys(params || {}).forEach((k) => {
    if (params[k] !== undefined && params[k] !== null && params[k] !== '') u.searchParams.set(k, params[k]);
  });
  const res = await fetch(u.toString(), { credentials: 'include', headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error('接口 ' + u.pathname.split('/').pop() + ' 返回 ' + res.status);
  const json = await res.json();
  return { url: u.toString(), body: json };
}

/** 拉取整套官方数据；个别接口失败不影响其它部分 */
async function fetchBundle(stageId) {
  const errors = [];
  let region = '', uid = '';
  try {
    const b = await fetchJson(API.basic, {});
    const d = (b.body && b.body.data) || {};
    region = d.current_role_account ? d.current_role_account.region : (d.region || '');
    uid = d.current_role_account ? d.current_role_account.uid : (d.uid || '');
    if (b.body && b.body.retcode !== 0) errors.push('未登录或登录已过期（basic_info: ' + b.body.message + '）');
  } catch (e) {
    errors.push('basic_info: ' + e.message);
  }

  const common = { uid: uid, region: region };
  const out = { region: region, uid: uid, stage: null, user: null, list: null, errors: errors };

  try {
    const r = await fetchJson(API.stageDetail, Object.assign({ stage_id: stageId || '' }, common));
    if (r.body && r.body.retcode === 0) out.stage = r.body;
    else errors.push('get_stage_detail: ' + ((r.body && r.body.message) || '返回异常'));
  } catch (e) { errors.push('get_stage_detail: ' + e.message); }

  try {
    const r = await fetchJson(API.userInfo, common);
    if (r.body && r.body.retcode === 0) out.user = r.body;
    else errors.push('get_user_info: ' + ((r.body && r.body.message) || '返回异常'));
  } catch (e) { errors.push('get_user_info: ' + e.message); }

  try {
    const r = await fetchJson(API.stageList, Object.assign({
      stage_name: '', sort_type: 'STAGE_LIST_SORT_BY_POST_TIME_DESC', page_index: 1, page_size: 20
    }, common));
    if (r.body && r.body.retcode === 0) out.list = r.body;
  } catch (e) { /* 列表失败不影响主流程 */ }

  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 按需把 content script 注入到标签页（应对「装扩展前就已打开的页面」） */
async function ensureInjected(tabId, url) {
  if (!TARGET_RE.test(String(url || ''))) {
    return { ok: false, error: '当前页面不是奇域页面，请先打开：数据中心 → 奇域数据' };
  }
  // 先探测是否已经注入过
  const alive = await new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: 'ping' }, (res) => {
      resolve(!chrome.runtime.lastError && res && res.ok === true);
    });
  });
  if (alive) return { ok: true, injected: false };

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
  } catch (e) {
    return { ok: false, error: '注入失败：' + String(e && e.message || e) };
  }
  await sleep(220); // 等脚本挂载监听
  return { ok: true, injected: true };
}

function pad(n, l) { return String(n).padStart(l, '0'); }

function baseName(payload) {
  const id = (payload && payload.stageId) || 'unknown';
  const d = new Date();
  const stamp = `${pad(d.getFullYear(), 4)}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}_${pad(d.getHours(), 2)}${pad(d.getMinutes(), 2)}${pad(d.getSeconds(), 2)}`;
  return `奇域数据_${id}_${stamp}`;
}

function download(url, filename, saveAs) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download({ url, filename, saveAs: !!saveAs }, (id) => {
      const err = chrome.runtime.lastError;
      if (err || typeof id !== 'number') reject(new Error(err ? err.message : '下载未能开始'));
      else resolve(id);
    });
  });
}

function base64ToBlobUrl(base64, mime) {
  const bin = atob(base64 || '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime || 'application/octet-stream' }));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'download') {
    const payload = msg.payload || {};
    const filename = `${baseName(payload)}.${payload.ext || 'xlsx'}`;
    let url = null;
    try {
      url = base64ToBlobUrl(payload.base64, payload.mime);
    } catch (e) {
      // 极老内核不支持 SW 内 createObjectURL -> 交回页面用 data URL 下载
      sendResponse({ ok: false, fallbackInPage: true, filename, error: String(e && e.message || e) });
      return true;
    }
    download(url, filename, true).then(
      (id) => {
        sendResponse({ ok: true, downloadId: id, filename });
        setTimeout(() => URL.revokeObjectURL(url), 120000);
      },
      (err) => {
        sendResponse({ ok: false, error: err.message });
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
    );
    return true;
  }

  if (msg.type === 'fetchData') {
    fetchBundle(msg.stageId).then(
      (data) => sendResponse({ ok: true, data: data }),
      (err) => sendResponse({ ok: false, error: String(err && err.message || err) })
    );
    return true;
  }

  if (msg.type === 'runOnActiveTab') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) { sendResponse({ ok: false, error: '没有找到活动标签页' }); return; }
      const ready = await ensureInjected(tab.id, tab.url);
      if (!ready.ok) { sendResponse(ready); return; }
      chrome.tabs.sendMessage(tab.id, { type: 'runExport' }, (res) => {
        const err = chrome.runtime.lastError;
        if (err) sendResponse({ ok: false, error: '脚本注入后仍未响应，请刷新页面后重试' });
        else sendResponse(Object.assign({ injected: ready.injected }, res || { ok: true }));
      });
    });
    return true;
  }

  if (msg.type === 'state') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) { sendResponse({ ok: false, error: 'no-tab', url: '' }); return; }
      const ready = await ensureInjected(tab.id, tab.url);
      if (!ready.ok) { sendResponse(Object.assign({ ok: false, url: tab.url, state: 'not-target' }, ready)); return; }
      chrome.tabs.sendMessage(tab.id, { type: 'state' }, (res) => {
        if (chrome.runtime.lastError) sendResponse({ ok: false, error: 'no-content-script', url: tab.url });
        else sendResponse(Object.assign({ injected: ready.injected }, res || { ok: false, error: 'no-state' }));
      });
    });
    return true;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  try {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: '导出当前奇域数据为表格',
      contexts: ['page'],
      documentUrlPatterns: ['*://act.mihoyo.com/miliastra_wonderland/*']
    });
  } catch (e) { /* 已存在 */ }
});

if (chrome.contextMenus && chrome.contextMenus.onClicked) {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_ID || !tab || !tab.id) return;
    chrome.tabs.sendMessage(tab.id, { type: 'runExport' }, () => {
      if (chrome.runtime.lastError) {
        // content script 未就绪（例如页面在扩展安装前已打开）
        chrome.tabs.reload(tab.id);
      }
    });
  });
}
