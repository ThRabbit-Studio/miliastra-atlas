/* Miliastra Atlas — popup */
'use strict';

const $ = (id) => document.getElementById(id);

function show(cls, text) {
  const el = $('msg');
  el.className = 'tip ' + (cls || '');
  el.textContent = text;
}

function send(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
      else resolve(res || { ok: false, error: '无响应' });
    });
  });
}

function refresh() {
  $('pageState').textContent = '检测中…';
  $('pageState').className = '';
  $('export').disabled = true;
  send({ type: 'state' }).then((res) => {
    const el = $('pageState');
    if (res && res.ok) {
      $('stageId').textContent = res.stageId || '—';
      $('captured').textContent = (res.captured || 0) + ' 条';
      $('export').disabled = false;
      if (res.isDetail) {
        el.textContent = res.injected ? '已自动注入 ✓' : '奇域详情页 ✓';
        el.className = 'ok';
        show('ok', res.injected
          ? '刚为这个页面注入了脚本，可以直接导出。'
          : '已就绪。点上方按钮即可导出。');
      } else {
        el.textContent = '非详情页';
        el.className = 'warn';
        show('warn', '请进入：数据中心 → 奇域数据 → 点开某个奇域，再回来导出。');
      }
      return;
    }
    $('stageId').textContent = '—';
    $('captured').textContent = '—';
    if (res && res.state === 'not-target') {
      el.textContent = '不是奇域页面';
      el.className = 'warn';
      show('warn', '当前标签页不是 act.mihoyo.com 的奇域页面。请先打开奇域数据页面，或点下方按钮。');
    } else {
      el.textContent = '无法连接';
      el.className = 'err';
      show('err', '无法与页面通信：' + ((res && res.error) || '未知原因') + '（可刷新页面后重试）');
    }
  });
}

$('export').addEventListener('click', () => {
  $('export').disabled = true;
  show('', '正在导出…若弹出「另存为」对话框，请选择保存位置。');
  send({ type: 'runOnActiveTab' }).then((res) => {
    $('export').disabled = false;
    if (res && res.ok) {
      show('ok', res.injected
        ? '已自动注入脚本并触发导出，请看页面右下角面板。'
        : '已触发导出，请在页面右下角面板查看结果。');
      setTimeout(() => window.close(), 1400);
    } else {
      show('err', '导出失败：' + ((res && res.error) || '未知错误'));
    }
  });
});

$('refresh').addEventListener('click', refresh);

$('open').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://act.mihoyo.com/miliastra_wonderland/developer?mhy_presentation_style=fullscreen&mhy_auth_required=true#/StageData/stageData' });
  window.close();
});

refresh();
