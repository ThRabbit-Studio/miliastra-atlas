/* =============================================================
 * 用「真实抓取到的官方接口响应」构建工作表并校验
 *   node tools/build-from-live.js
 * 输入：test/out/live/discover_*.json（tools/discover.js 抓的）
 * 输出：test/out/真实数据_奇域导出.xlsx + 预览 JSON
 * ============================================================= */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LIVE = path.join(ROOT, 'test', 'out', 'live');
const OUT = path.join(ROOT, 'test', 'out');

const MHY = require(path.join(ROOT, 'extension/src/core/data.js'));
const Extract = require(path.join(ROOT, 'extension/src/core/extract.js'));
const XLSX = require(path.join(ROOT, 'extension/src/core/xlsx.js'));

function loadLive(keyword) {
  if (!fs.existsSync(LIVE)) return null;
  const f = fs.readdirSync(LIVE).filter((x) => x.includes(keyword))[0];
  if (!f) return null;
  const raw = JSON.parse(fs.readFileSync(path.join(LIVE, f), 'utf8'));
  // discover.js 落盘的是裸 body；capture 落盘的是 { url, body }
  return raw.body || raw;
}

const FIXTURE = path.join(ROOT, 'test', 'fixture', 'api');

function loadFixture(name) {
  const p = path.join(FIXTURE, name);
  if (!fs.existsSync(p)) return null;
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  return j && j.retcode === 0 ? j : null;
}

const stagePayload = loadFixture('stage_detail.json') || loadLive('get_stage_detail');
const userPayload = loadFixture('user_info.json') || loadLive('get_user_info');
const listPayload = loadFixture('stage_list.json') || loadLive('get_stage_list');
// 可选：直接指定要分析的奇域 ID（用登录态现拉一份）
const WANT_STAGE = process.argv[2] || '';

(async () => {
  let stage = stagePayload;
  if (WANT_STAGE) {
    const { fetchStageDetail } = require('./api.js');
    stage = await fetchStageDetail(WANT_STAGE);
    console.log('已拉取奇域 ' + WANT_STAGE + ' 的实时数据\n');
  }
  if (!stage && !userPayload) {
    console.error('没有找到接口数据，请先运行：node tools/discover.js');
    process.exit(1);
  }

  const sheets = Extract.buildSheets({ stagePayload: stage, userPayload, listPayload });
  console.log('=== 工作表清单（来自真实接口） ===');
  sheets.forEach((s) => {
    console.log('【' + s.name + '】 ' + s.rows.length + ' 行' + (s.header ? ' | ' + s.header.join(' / ') : '') + (s.note ? '  (' + s.note + ')' : ''));
    s.rows.slice(0, 3).forEach((r) => console.log('     ' + JSON.stringify(r)));
    if (s.rows.length > 3) console.log('     …共 ' + s.rows.length + ' 行');
  });

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, '真实数据_工作表预览.json'), JSON.stringify(sheets, null, 2), 'utf8');

  const bytes = await XLSX.buildXlsx(sheets);
  const p = path.join(OUT, '真实数据_奇域导出.xlsx');
  fs.writeFileSync(p, bytes);
  console.log('\n已生成：' + p + '（' + (bytes.length / 1024).toFixed(1) + ' KB）');
})().catch((e) => { console.error('失败：', e); process.exit(1); });
