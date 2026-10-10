/* =============================================================
 * DOM 集成测试：在 Node 里真实执行 collect.js
 *   node test/dom-test.js
 * ============================================================= */
'use strict';

const assert = require('assert');
const { createDocument, createEcharts } = require('./dom-stub.js');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? '  → ' + JSON.stringify(detail) : '')); }
}

const URL = 'https://act.mihoyo.com/miliastra_wonderland/developer?mhy_presentation_style=fullscreen&mhy_auth_required=true#/StageData/stageDetail/54461776301';

/* ---- 搭好全局环境 ---- */
const MHY = require('../extension/src/core/data.js');
const doc = createDocument({ echarts: true });

const hosts = doc.querySelectorAll('.echarts-host');
const echarts = createEcharts(hosts);

globalThis.window = globalThis;
globalThis.document = doc;
globalThis.location = { href: URL, hostname: 'act.mihoyo.com', origin: 'https://act.mihoyo.com' };
globalThis.echarts = echarts;

// collect.js 在 require 时会挂到 globalThis.MHYCollect
require('../extension/src/core/collect.js');
const Collect = globalThis.MHYCollect;
const XLSX = require('../extension/src/core/xlsx.js');

console.log('== DOM 采集集成测试 ==');

let data;
try {
  data = Collect.collect({ url: URL, title: doc.title, captured: [] });
  ok('collect() 无异常执行完成', true);
} catch (e) {
  ok('collect() 无异常执行完成', false, String(e && e.stack || e));
  process.exit(1);
}

ok('解析出奇域ID', data.stageId === '54461776301', data.stageId);
ok('页面标题带入', data.pageTitle === '奇匠中心', data.pageTitle);

console.log('-- 概览 --');
ok('奇域名称 = 尘世执政录', data.overview.name === '尘世执政录', data.overview.name);
ok('状态 = 上线中', data.overview.status === '上线中', data.overview.status);
ok('发布时间被规范化', data.overview.publishTime === '2026-09-27 19:02:00', data.overview.publishTime);
ok('奇域热度 = 505', data.overview.heat === '505' || data.overview.heat === 505, data.overview.heat);
ok('平均游玩时长 = 323 秒', data.overview.avgDuration && data.overview.avgDuration.seconds === 323, data.overview.avgDuration);
ok('平均游玩时长文本 = 5分23秒', data.overview.avgDuration && data.overview.avgDuration.text === '5分23秒', data.overview.avgDuration);

console.log('-- 指标卡 --');
const heatMetric = data.metrics.find((m) => m.key === '奇域热度');
const durMetric = data.metrics.find((m) => m.key === '平均游玩时长');
ok('抓到「奇域热度」', !!heatMetric, data.metrics.map((m) => m.key));
ok('抓到「平均游玩时长」', !!durMetric);
ok('热度数值 = 505', heatMetric && heatMetric.number === 505, heatMetric && heatMetric.number);
ok('时长数值 = 323 秒', durMetric && durMetric.number === 323, durMetric && durMetric.number);
ok('时长单位标记为秒', durMetric && durMetric.unit === '秒', durMetric && durMetric.unit);
ok('捕获「较昨日 ↑1」变化量', heatMetric && /较昨日/.test(heatMetric.delta || ''), heatMetric && heatMetric.delta);
ok('两种 DOM 结构的卡片都被识别', data.metrics.length >= 2, data.metrics.length);
const newHeat = data.metrics.find((m) => m.key === '7日新增量');
ok('识别「7日新增量 117」（标题内嵌问号说明）', !!newHeat && newHeat.number === 117, newHeat || data.metrics.map((m) => m.key));
ok('概览带上新增量', data.overview.newHeat === '117', data.overview.newHeat);

console.log('-- ECharts 折线 --');
ok('识别到 2 张趋势图', data.charts.length === 2, data.charts.map((c) => c.title));
const heat = data.charts.find((c) => c.title === '奇域热度');
const dur = data.charts.find((c) => /平均游玩时长/.test(c.title));
ok('图例作为表名（奇域热度）', !!heat);
ok('图例作为表名（平均游玩时长）', !!dur);
ok('热度折线 30 个点', heat && heat.rows.length === 30, heat && heat.rows.length);
ok('热度首点 = 2026-09-10 / 0', heat && heat.rows[0][0] === '2026-09-10' && heat.rows[0][1] === 0, heat && heat.rows[0]);
ok('热度末点 = 2026-10-09 / 505', heat && heat.rows[29][0] === '2026-10-09' && heat.rows[29][1] === 505, heat && heat.rows[29]);
ok('时长折线含峰值 796', dur && dur.rows.some((r) => r[1] === 796), dur && dur.rows[19]);
ok('图表来源标记为 echarts', data.diagnostics.chartSource === 'echarts', data.diagnostics.chartSource);
ok('图表表头 = [日期, 奇域热度]', heat && Array.isArray(heat.header) && heat.header.join(',') === '日期,奇域热度', heat && heat.header);

console.log('-- 顶部信息表 --');
const info = data.tables.find((t) => t.name === '奇域信息');
ok('生成「奇域信息」表', !!info);
ok('信息表含 4 行', info && info.rows.length === 4, info && info.rows);
ok('信息表含奇域ID', info && info.rows.some((r) => r[0] === '奇域ID' && r[1] === '54461776301'));

console.log('-- 数据自检信息 --');
ok('kvPairs 不含面板噪声', !data.diagnostics.kvPairs.some((p) => /导出/.test(p.key)), data.diagnostics.kvPairs);
ok('canvas 计数为 2', data.diagnostics.canvasCount === 2, data.diagnostics.canvasCount);
ok('检测到 ECharts', data.diagnostics.hasEcharts === true);

console.log('-- ECharts 缺失时的 DOM 兜底 --');
const doc2 = createDocument({ echarts: false });
globalThis.document = doc2;
globalThis.echarts = undefined;
let data2;
try {
  data2 = Collect.collect({ url: URL, title: doc2.title, captured: [] });
  ok('无 ECharts 时不抛异常', true);
} catch (e) {
  ok('无 ECharts 时不抛异常', false, String(e && e.message || e));
}
if (data2) {
  ok('概览仍然可用（DOM 路径）', data2.overview.name === '尘世执政录', data2.overview);
  ok('指标仍然可用', data2.metrics.length >= 2, data2.metrics.length);
}

console.log('-- ECharts 实例兜底路径（window.echarts 不可见）--');
const doc3 = createDocument({ echarts: true, instanceKeys: ['ec-inst-0', 'ec-inst-1'] });
globalThis.document = doc3;
const insts3 = Array.from(echarts._instances.values());
globalThis.echarts = { _instances: new Map([['ec-inst-0', insts3[0]], ['ec-inst-1', insts3[1]]]) };
let data3;
try {
  data3 = Collect.collect({ url: URL, title: doc3.title, captured: [] });
  ok('仅有 _echarts_instance_ 属性时也能取到图表', data3.charts.length === 2, data3.charts.map((c) => c.title));
} catch (e) {
  ok('仅有 _echarts_instance_ 属性时也能取到图表', false, String(e && e.message || e));
}

globalThis.document = doc;
globalThis.echarts = echarts;

console.log('-- 从采集结果生成 Excel --');
(async () => {
  const sheets = MHY.buildWorkbook(data);
  const bytes = await XLSX.buildXlsx(sheets);
  ok('采集数据 → 合法 xlsx（>5KB）', bytes.length > 5000, bytes.length);
  ok('ZIP 头正确', bytes[0] === 0x50 && bytes[1] === 0x4b);
  const names = sheets.map((s) => s.name);
  ok('包含趋势表「奇域热度」', names.includes('奇域热度'), names);
  ok('包含「关卡基础数据」', names.includes('关卡基础数据'), names);
  ok('工作表无空行', sheets.every((s) => s.rows.every((r) => Array.isArray(r))));

  console.log('\n' + (fail === 0 ? `全部 ${pass} 项检查通过 ✅` : `${fail} 项失败 / ${pass} 项通过 ❌`));
  if (fail) process.exitCode = 1;
})();
