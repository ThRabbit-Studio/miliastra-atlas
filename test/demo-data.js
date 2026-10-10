/* =============================================================
 * 演示数据：完全按扩展运行时 Context 的结构构造
 * 数据来源：用户提供的奇域详情页截图
 * 用途：① Node 端回归测试 ② 生成示例表格 ③ 展示导出结构
 * ============================================================= */
'use strict';

const MHY = require('../extension/src/core/data.js');

const STAGE_ID = '54461776301';
const URL = 'https://act.mihoyo.com/miliastra_wonderland/developer?mhy_presentation_style=fullscreen&mhy_auth_required=true#/StageData/stageDetail/' + STAGE_ID;
const TITLE = '奇匠中心 - 奇域数据';

// 折线数据（近30日 / 截止 2026-10-09），形态对齐截图
const HEAT_POINTS = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  12, 118, 246, 331, 398, 452, 489, 508, 508, 508, 505, 505, 505
];
const DURATION_POINTS = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  12, 180, 796, 301, 205, 223, 208, 205, 201, 203, 199, 198, 200
];

function buildDates(count, endDate) {
  const out = [];
  const end = new Date(endDate + 'T00:00:00');
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(end.getTime() - i * 86400000);
    const p = (n) => String(n).padStart(2, '0');
    out.push(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
  }
  return out;
}

const DATES = buildDates(30, '2026-10-09');

function durationText(sec) {
  if (!sec) return '—';
  return MHY.humanSeconds(sec);
}

function makeContext() {
  const heatMetric = {
    key: '奇域热度', label: '奇域热度', value: '505', number: 505, unit: '', delta: '较昨日 ↑1'
  };
  const avgMetric = {
    key: '平均游玩时长', label: '平均游玩时长', value: '5分23秒', number: 323, unit: '秒', delta: '较昨日 -'
  };

  const charts = [
    {
      index: 0,
      title: '奇域热度',
      xName: '日期',
      yName: '奇域热度',
      header: ['日期', '奇域热度'],
      rows: DATES.map((d, i) => [d, HEAT_POINTS[i]]),
      raw: [{ name: '奇域热度', points: DATES.map((d, i) => ({ label: d, value: HEAT_POINTS[i] })) }]
    },
    {
      index: 1,
      title: '平均游玩时长',
      xName: '日期',
      yName: '平均游玩时长',
      header: ['日期', '平均游玩时长(秒)', '平均游玩时长'],
      rows: DATES.map((d, i) => [d, DURATION_POINTS[i], durationText(DURATION_POINTS[i])]),
      raw: [
        { name: '平均游玩时长(秒)', points: DATES.map((d, i) => ({ label: d, value: DURATION_POINTS[i] })) },
        { name: '平均游玩时长', points: DATES.map((d, i) => ({ label: d, value: durationText(DURATION_POINTS[i]) })) }
      ]
    }
  ];

  const tables = [
    {
      name: '奇域信息',
      header: ['字段', '内容'],
      rows: [
        ['奇域名称', '尘世执政录'],
        ['奇域ID', STAGE_ID],
        ['状态', '上线中'],
        ['发布时间', '2026-09-27 19:02:00']
      ]
    },
    {
      name: 'get_stage_report_overview #1',
      header: ['date', 'heat', 'avg_duration'],
      rows: DATES.slice(-10).map((d, i) => [d, HEAT_POINTS.slice(-10)[i], DURATION_POINTS.slice(-10)[i]])
    }
  ];

  return {
    ok: true,
    url: URL,
    pageTitle: TITLE,
    stageId: STAGE_ID,
    exportedAt: new Date('2026-10-10T21:52:00+08:00').getTime(),
    overview: {
      heat: '505',
      avgDuration: { seconds: 323, text: '5分23秒' },
      status: '上线中',
      publishTime: '2026-09-27 19:02:00',
      name: '尘世执政录',
      stageId: STAGE_ID
    },
    overviewLabels: {
      '奇域热度': { label: '奇域热度', value: '505' },
      '平均游玩时长': { label: '平均游玩时长', value: '5分23秒' },
      '状态': { label: '状态', value: '上线中' },
      '发布时间': { label: '发布时间', value: '2026/09/27 19:02 (UTC+8)' }
    },
    metrics: [heatMetric, avgMetric],
    charts: charts,
    tables: tables,
    sources: [
      { via: '接口', name: 'get_stage_report_overview', url: 'https://act.mihoyo.com/api/...', count: 30, time: '21:52:01' },
      { via: '接口', name: 'get_stage_report_trend', url: 'https://act.mihoyo.com/api/...', count: 30, time: '21:52:01' },
      { via: '页面DOM', name: '奇域信息', url: '', count: 4, time: '' }
    ],
    diagnostics: {
      kvPairs: [
        { key: '奇域热度', rawKey: '奇域热度', value: '505' },
        { key: '平均游玩时长', rawKey: '平均游玩时长', value: '5分23秒' },
        { key: '状态', rawKey: '状态', value: '上线中' },
        { key: '发布时间', rawKey: '发布时间', value: '2026/09/27 19:02 (UTC+8)' }
      ],
      numberGroups: [{ text: HEAT_POINTS.join(' '), values: HEAT_POINTS }],
      chartSource: 'echarts',
      canvasCount: 2,
      metricCount: 2,
      tableCount: 2,
      capturedCount: 2,
      hasEcharts: true,
      stageIdFromUrl: STAGE_ID,
      apiNames: ['get_stage_report_overview', 'get_stage_report_trend']
    }
  };
}

module.exports = { makeContext, STAGE_ID, URL, TITLE, DATES, HEAT_POINTS, DURATION_POINTS };
