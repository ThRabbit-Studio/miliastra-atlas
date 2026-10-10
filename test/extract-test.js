/* =============================================================
 * 官方接口数据 -> 工作表 的回归测试
 * 用 test/fixture/api/ 下真实抓取的接口响应（已脱敏为普通数据）做断言。
 *   node test/extract-test.js
 * 没有 fixture 时自动跳过（并提示运行 node tools/discover.js）。
 * ============================================================= */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixture', 'api');
const MHY = require(path.join(ROOT, 'extension/src/core/data.js'));
const Extract = require(path.join(ROOT, 'extension/src/core/extract.js'));
const XLSX = require(path.join(ROOT, 'extension/src/core/xlsx.js'));

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? '  → ' + JSON.stringify(detail) : '')); }
}

function fixture(name) {
  const p = path.join(FIX, name);
  if (!fs.existsSync(p)) return null;
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  return j && j.retcode === 0 ? j : null;
}

const stage = fixture('stage_detail.json');
const user = fixture('user_info.json');
const list = fixture('stage_list.json');

console.log('== 官方接口提取测试 ==');
if (!stage) {
  console.log('  ! 未找到 test/fixture/api/stage_detail.json，跳过（先运行 node tools/discover.js）');
  process.exit(0);
}

/* ---------------- 值转换 ---------------- */
console.log('-- 单位与值转换 --');
ok('NORMAL 原样: 505', Extract.convertValue('505', 'METRIC_VALUE_TYPE_NORMAL').num === 505);
ok('SECOND: 323 -> 5分23秒', Extract.convertValue('323', 'METRIC_VALUE_TYPE_SECOND').text === '5分23秒');
ok('PER_TEN_THOUSAND: 259 -> 2.59%', Extract.convertValue('259', 'METRIC_VALUE_TYPE_PER_TEN_THOUSAND').num === 2.59,
  Extract.convertValue('259', 'METRIC_VALUE_TYPE_PER_TEN_THOUSAND'));
ok('SCORE: 10000 -> 100', Extract.convertValue('10000', 'METRIC_VALUE_TYPE_SCORE').num === 100,
  Extract.convertValue('10000', 'METRIC_VALUE_TYPE_SCORE'));
ok('热度排名按名次展示', Extract.convertValue('300', 'METRIC_VALUE_TYPE_PER_TEN_THOUSAND', { rankText: true }).text === '前 3%',
  Extract.convertValue('300', 'METRIC_VALUE_TYPE_PER_TEN_THOUSAND', { rankText: true }).text);

/* ---------------- 关卡详情 ---------------- */
console.log('-- 关卡详情 --');
const st = Extract.extractStageDetail(stage);
ok('解析出关卡名', st && st.name === '尘世执政录', st && st.name);
ok('解析出状态（枚举中文化）', st.status === '上线中', st.status);
ok('发布时间可读', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(st.publishTime), st.publishTime);
ok('数据日期取自接口', st.todayStr === '2026-10-09', st.todayStr);

const byName = {};
st.today.forEach((m) => { byName[m.name] = m; });
ok('奇域热度 = 505', byName['奇域热度'] && byName['奇域热度'].num === 505, byName['奇域热度']);
ok('奇域热度较昨日 = -1', byName['奇域热度'] && byName['奇域热度'].delta === -1, byName['奇域热度'] && byName['奇域热度'].delta);
ok('平均游玩时长 = 323 秒', byName['平均游玩时长'] && byName['平均游玩时长'].num === 323);
ok('平均游玩时长可读 = 5分23秒', byName['平均游玩时长'] && byName['平均游玩时长'].text === '5分23秒');
ok('评论数 = 5', byName['评论数'] && byName['评论数'].num === 5);
ok('封面点击率 = 2.59%', byName['封面点击率'] && byName['封面点击率'].num === 2.59, byName['封面点击率']);
ok('封面点击率变化 = -0.35%（按比率口径）', byName['封面点击率'] && byName['封面点击率'].delta === -0.35, byName['封面点击率'] && byName['封面点击率'].delta);
ok('无值指标被标记 invalid（不导出）', st.today.some((m) => m.invalid) && !st.metrics.some((m) => m.invalid));

const sHeat = st.series.filter((s) => /STAGE_HOT_SCORE$/.test(s.type))[0];
const sDur = st.series.filter((s) => /AVG_TIME$/.test(s.type))[0];
const sClick = st.series.filter((s) => /COVER_CLICK_RATE$/.test(s.type))[0];
ok('热度趋势为 30 天', sHeat.allPoints.length === 30, sHeat.allPoints.length);
ok('热度趋势砍掉了开头全 0 的空行', sHeat.points.length < 30 && sHeat.points[0].num > 0, { len: sHeat.points.length, first: sHeat.points[0] });
ok('热度末点 = 505', sHeat.points[sHeat.points.length - 1].num === 505);
ok('封面点击率趋势末点 = 2.59%', sClick.points[sClick.points.length - 1].num === 2.59);
ok('封面点击率有无效数据点会被留空', sClick.invalidCount >= 0 && sClick.points.every((p) => typeof p.invalid === 'boolean'));
ok('平均时长 7 日变化按每日数据补算', sDur.delta7.computed === true && sDur.delta7.value === -25, sDur.delta7);
ok('平均时长 30 日变化有值', typeof sDur.delta30.value === 'number' && sDur.delta30.value !== 0, sDur.delta30);

console.log('-- 单局游玩时长分布 --');
const sDist = st.series.filter((s) => s.groups && s.groups.length)[0];
ok('解析出分布分组', !!sDist);
const g0 = sDist.groups[0];
ok('区间标签可读', g0.labels.join(',') === '≤1分钟,1-3分钟,3-5分钟,5-7分钟,>7分钟', g0.labels);
ok('占比合计约 100%', (() => {
  const r = g0.rows.find((x) => x.percents.every((p) => typeof p === 'number' && p > 0));
  if (!r) return false;
  const sum = r.percents.reduce((a, b) => a + b, 0);
  return Math.abs(sum - 100) < 0.5;
})(), g0.rows[0]);

console.log('-- 评论内容 --');
const comments = Extract.extractComments(stage);
ok('评论总数 = 5', comments && comments.total === 5, comments && comments.total);
ok('评论条数 = 5', comments.rows.length === 5, comments.rows.length);
ok('评论字段齐全且中文化', comments.header.join(',') === '用户,UID,评论时间,推荐态度,评论内容,点赞数,回复数,楼层', comments.header);
ok('评论时间已转为可读时间', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(comments.rows[0][2])), comments.rows[0][2]);
ok('推荐态度中文化', ['推荐', '不推荐'].includes(comments.rows[0][3]), comments.rows[0][3]);
ok('评论内容非空且无换行', comments.rows[0][4].length > 0 && !/\n/.test(comments.rows[0][4]));

/* ---------------- 奇匠数据 ---------------- */
console.log('-- 奇匠（创作者）数据 --');
const us = Extract.extractUserData(user);
ok('解析出创作者指标', us && us.today.length >= 5, us && us.today.length);
const uByName = {};
us.today.forEach((m) => { uByName[m.name] = m; });
ok('奇域总热度 = 581', uByName['奇域总热度'] && uByName['奇域总热度'].num === 581, uByName['奇域总热度']);
ok('平均推荐率 = 62.5%', uByName['平均推荐率'] && uByName['平均推荐率'].num === 62.5, uByName['平均推荐率']);
ok('游玩指数 = 100（10000/100）', uByName['游玩指数'] && uByName['游玩指数'].num === 100, uByName['游玩指数']);
ok('奇域总数 = 8', uByName['奇域总数'] && uByName['奇域总数'].num === 8);
ok('热度排名 = 前 3%', uByName['热度排名'] && uByName['热度排名'].text === '前 3%', uByName['热度排名'] && uByName['热度排名'].text);
ok('有订阅人数趋势', us.series.some((s) => /SUBSCRIBER/.test(s.type)), us.series.map((s) => s.type));
const subs = us.series.filter((s) => /SUBSCRIBER/.test(s.type))[0];
ok('订阅人数末值 = 533', subs.points[subs.points.length - 1].num === 533, subs.points.slice(-2));
ok('订阅档位解析', us.subscribeGears.length === 3, us.subscribeGears);

/* ---------------- 组装工作表 ---------------- */
console.log('-- 分表模式：工作表组装（全部区间）--');
const sheets = Extract.buildSheets({ stagePayload: stage, userPayload: user, listPayload: list, mode: 'multi' });
const names = sheets.map((s) => s.name);
console.log('   工作表：' + names.join('、'));
['数据概况', '关卡基础数据', '页面指标一览', '关卡指标汇总',
  '奇域热度', '平均游玩时长', '评论数', '封面点击率',
  '单局游玩时长分布', '单局时长分布_人数', '评论内容',
  '奇匠指标汇总', '奇域总热度', '平均推荐率(奇匠)', '游玩指数', '奇域总数', '订阅人数趋势', '数据说明']
  .forEach((n) => ok('包含工作表「' + n + '」', names.includes(n), names));

ok('不再有「活跃指数」这种一两行的独立小表', !names.includes('活跃指数'), names);
ok('不再导出「订阅档位」「奇域列表」这类非分析表', !names.includes('订阅档位') && !names.includes('奇域列表'), names);
ok('奇匠/关卡同名的「平均推荐率」已区分命名', names.filter((n) => /平均推荐率/.test(n)).length === 1, names.filter((n) => /平均推荐率/.test(n)));
ok('不包含接口原始数据/调试表', !names.some((n) => /数据来源|全部数据|diagnostic|api|raw/i.test(n)), names);
ok('表名唯一且不超长', (() => {
  const set = new Set();
  return names.every((n) => n.length <= 31 && !set.has(n) && (set.add(n) || true));
})());

/* ---------------- 用户新要求：分布三个区间全导出 ---------------- */
console.log('-- 单局游玩时长分布（三套区间）--');
const dist = sheets.find((s) => s.name === '单局游玩时长分布');
ok('分布表用「区间组」区分三套区间', dist.header[0] === '区间组' && dist.header[1] === '日期', dist.header.slice(0, 2));
const groupVals = Array.from(new Set(dist.rows.map((r) => r[0])));
ok('三套区间都导出（常规/长/超长）', groupVals.length === 3, groupVals);
ok('区间组名称可读', groupVals.join(',') === '常规区间,长区间,超长区间', groupVals);
ok('常规区间列齐全', ['≤1分钟 占比(%)', '1-3分钟 占比(%)', '3-5分钟 占比(%)', '5-7分钟 占比(%)', '>7分钟 占比(%)']
  .every((h) => dist.header.includes(h)), dist.header);
ok('长区间列齐全', ['≤3分钟 占比(%)', '3-6分钟 占比(%)', '6-9分钟 占比(%)', '9-12分钟 占比(%)', '>12分钟 占比(%)']
  .every((h) => dist.header.includes(h)), dist.header);
ok('超长区间列齐全', ['≤6分钟 占比(%)', '6-13分钟 占比(%)', '13-19分钟 占比(%)', '19-26分钟 占比(%)', '>26分钟 占比(%)']
  .every((h) => dist.header.includes(h)), dist.header);
ok('每个区间组都有数据行', groupVals.every((g) => dist.rows.filter((r) => r[0] === g).length > 1));
ok('不适用本组的单元格为空（不混用区间）', (() => {
  const r = dist.rows.find((x) => x[0] === '长区间');
  if (!r) return false;
  const idx1 = dist.header.indexOf('≤1分钟 占比(%)');
  const idx3 = dist.header.indexOf('≤3分钟 占比(%)');
  return r[idx1] === '' && typeof r[idx3] === 'number';
})(), dist.rows.find((x) => x[0] === '长区间'));
const cnt = sheets.find((s) => s.name === '单局时长分布_人数');
ok('人数表也含三套区间', Array.from(new Set(cnt.rows.map((r) => r[0]))).length === 3);

/* ---------------- 用户新要求：可选择导出区间 ---------------- */
console.log('-- 导出区间选择（近7日 / 近30日 / 全部）--');
const s30 = Extract.buildSheets({ stagePayload: stage, userPayload: user, range: 30, mode: 'multi' });
const s7 = Extract.buildSheets({ stagePayload: stage, userPayload: user, range: 7, mode: 'multi' });
const heat30 = s30.find((s) => s.name === '奇域热度');
const heat7 = s7.find((s) => s.name === '奇域热度');
ok('近30日：热度趋势 30 行', heat30.rows.length === 30, heat30.rows.length);
ok('近7日：热度趋势 7 行', heat7.rows.length === 7, heat7.rows.length);
ok('近7日首行 = 2026-10-03', String(heat7.rows[0][0]) === '2026-10-03', heat7.rows[0]);
ok('逐日数据两区间末值一致', heat7.rows[heat7.rows.length - 1][1] === heat30.rows[heat30.rows.length - 1][1]);
const sum30 = s30.find((s) => s.name === '关卡指标汇总');
const sum7 = s7.find((s) => s.name === '关卡指标汇总');
ok('近30日汇总表头写「近30日变化」', sum30.header.includes('近30日变化'), sum30.header);
ok('近7日汇总表头写「近7日变化」', sum7.header.includes('近7日变化'), sum7.header);
const h7row = sum7.rows.find((r) => r[0] === '奇域热度');
ok('近7日 奇域热度变化 = 117（官方口径）', h7row && h7row[4] === 117, h7row);
ok('区间变化标注来源', h7row && ['官方接口', '按每日数据计算'].includes(h7row[5]), h7row);
ok('分布表两区间都一样（接口固定返回 30 天分布）',
  s7.find((s) => s.name === '单局游玩时长分布').rows.length === s30.find((s) => s.name === '单局游玩时长分布').rows.length);

/* ---------------- 用户新要求：单表模式（按日期合并成一张大表） ---------------- */
console.log('-- 单表模式（按日期合并）--');
const single = Extract.buildSheets({ stagePayload: stage, userPayload: user, range: 30, mode: 'sheet', group: '0' });
const singleNames = single.map((s) => s.name);
ok('单表模式分为：概况 + 数据总表 + 评论内容 + 说明', single.length === 4, singleNames);
const big = single.find((s) => /数据总表/.test(s.name));
ok('生成「数据总表」', !!big, singleNames);
ok('表名带奇域名', big.name.indexOf('尘世执政录') === 0, big.name);
ok('一行为一天（30 天 = 30 行）', big.rows.length === 30, big.rows.length);
ok('首列是奇域名称，第二列是日期', big.header[0] === '奇域名称' && big.header[1] === '日期', big.header.slice(0, 2));
ok('奇域热度在表内', big.header.indexOf('奇域热度') > 0, big.header);
ok('平均游玩时长同时给秒与可读值', big.header.includes('平均游玩时长(秒)') && big.header.includes('平均游玩时长(秒)(可读)'), big.header);
ok('评论数与封面点击率在表内', big.header.includes('评论数') && big.header.includes('封面点击率(%)'), big.header);
ok('分布占比列按所选区间组（常规 5 列）',
  ['≤1分钟 占比(%)', '1-3分钟 占比(%)', '3-5分钟 占比(%)', '5-7分钟 占比(%)', '>7分钟 占比(%)'].every((h) => big.header.includes(h)), big.header);
ok('默认不含长区间列（未选该组）', !big.header.includes('≤3分钟 占比(%)'), big.header);
ok('同一天的指标落在同一行（热度 505 与时长 323 同行）', (() => {
  const r = big.rows.find((x) => x[big.header.indexOf('日期')] === '2026-10-09');
  if (!r) return false;
  const heat = r[big.header.indexOf('奇域热度')];
  const dur = r[big.header.indexOf('平均游玩时长(秒)')];
  const durText = r[big.header.indexOf('平均游玩时长(秒)(可读)')];
  return heat === 505 && dur === 323 && durText === '5分23秒';
})(), big.rows[big.rows.length - 1]);
ok('列名无重复', new Set(big.header).size === big.header.length, big.header.length + ' vs ' + new Set(big.header).size);
ok('分布占比合计约 100%', (() => {
  const i0 = big.header.indexOf('≤1分钟 占比(%)');
  const row = big.rows.find((r) => typeof r[i0] === 'number' && r[i0] > 0);
  if (!row) return false;
  const sum = big.header.map((h, i) => (/占比\(%\)$/.test(h) ? row[i] : 0)).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
  return Math.abs(sum - 100) < 0.5;
})());

const bigGroup1 = Extract.buildSheets({ stagePayload: stage, userPayload: user, range: 30, mode: 'sheet', group: '1' }).find((s) => /数据总表/.test(s.name));
ok('切换区间组 -> 换成该组列', bigGroup1 && bigGroup1.header.includes('≤3分钟 占比(%)') && !bigGroup1.header.includes('≤1分钟 占比(%)'),
  bigGroup1 && bigGroup1.header.filter((h) => /分钟 占比/.test(h)));
const big7 = Extract.buildSheets({ stagePayload: stage, userPayload: user, range: 7, mode: 'sheet', group: '0' }).find((s) => /数据总表/.test(s.name));
ok('单表模式也支持区间（近7日 = 7 行）', big7.rows.length === 7, big7.rows.length);
ok('单表模式仍保留评论内容表',
  single.some((s) => s.name === '评论内容' && s.rows.length === 5), singleNames);
ok('数据说明写明单表口径',
  single.find((s) => s.name === '数据说明').rows.some((r) => /单表/.test(String(r[1]))), '');

console.log('-- 分表模式回归 --');
const multi = Extract.buildSheets({ stagePayload: stage, userPayload: user, range: 30, mode: 'multi' });
ok('分表模式工作表数量明显更多', multi.length > 12, multi.length);
ok('分表模式含各趋势表', ['奇域热度', '平均游玩时长', '评论内容'].every((n) => multi.some((s) => s.name === n)), multi.map((s) => s.name));

const ov = sheets.find((s) => s.name === '数据概况');
ok('概况含奇域名与ID', ov.rows.some((r) => r[0] === '奇域名称' && r[1] === '尘世执政录') &&
  ov.rows.some((r) => r[0] === '奇域ID' && String(r[1]) === '54461776301'), ov.rows.slice(0, 4));

const commentSheet = sheets.find((s) => s.name === '评论内容');
ok('评论工作表行数 = 5', commentSheet.rows.length === 5);
ok('评论工作表无技术字段', !commentSheet.header.some((h) => MHY.isNoiseField(h)), commentSheet.header);

const dist2 = sheets.find((s) => s.name === '单局游玩时长分布');
ok('分布表首两列为「区间组/日期」', dist2.header[0] === '区间组' && dist2.header[1] === '日期', dist2.header.slice(0, 2));
ok('分布表无重复列名', new Set(dist2.header).size === dist2.header.length, dist2.header.length + ' vs ' + new Set(dist2.header).size);

const trend = sheets.find((s) => s.name === '奇域热度');
ok('热度趋势表首行是真实数据（不含空点）', trend.rows[0][1] > 0, trend.rows[0]);
ok('趋势表第二列是数字', typeof trend.rows[0][1] === 'number');

const notes = sheets.find((s) => s.name === '数据说明');
ok('数据说明含口径与缺失说明', notes.rows.some((r) => /口径/.test(r[0])) && notes.rows.some((r) => /缺失数据/.test(r[0])), notes.rows.map((r) => r[0]));

/* ---------------- 端到端生成 xlsx ---------------- */
(async () => {
  console.log('-- 生成 xlsx --');
  const bytes = await XLSX.buildXlsx(sheets);
  ok('生成合法 ZIP/xlsx', bytes[0] === 0x50 && bytes[1] === 0x4b && bytes.length > 3000, bytes.length);
  const outDir = path.join(ROOT, 'test', 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const p = path.join(outDir, 'miliastra-atlas-sample.xlsx');
  fs.writeFileSync(p, bytes);
  console.log('   已写入 ' + p + '（' + (bytes.length / 1024).toFixed(1) + ' KB）');

  console.log('\n' + (fail === 0 ? `全部 ${pass} 项检查通过 ✅` : `${fail} 项失败 / ${pass} 项通过 ❌`));
  process.exit(fail ? 1 : 0);
})();
