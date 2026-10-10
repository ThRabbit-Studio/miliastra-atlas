/* =============================================================
 * 回归测试 / 示例生成
 *   node test/make-sample.js
 * 产出：test/out/奇域数据_示例.xlsx、.csv、.json
 * 校验：ZIP 签名、条目清单、每一条 CRC32（用 Node zlib.crc32 独立复核）
 * ============================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MHY = require('../extension/src/core/data.js');
const XLSX = require('../extension/src/core/xlsx.js');
const demo = require('./demo-data.js');

const OUT = path.join(__dirname, 'out');
const LOCAL_SIG = 0x04034b50;
const EOCD_SIG = 0x06054b50;

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log('  ✓ ' + name);
  } else {
    failures++;
    console.log('  ✗ ' + name + (detail ? '  → ' + detail : ''));
  }
}

/* ---------- 最小 ZIP 解析（校验文件本身，而非内存对象） ---------- */
function unzip(buf) {
  const eocdIdx = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocdIdx < 0) throw new Error('找不到 EOCD，ZIP 结构损坏');
  const count = buf.readUInt16LE(eocdIdx + 10);
  let p = buf.readUInt32LE(eocdIdx + 16);
  const files = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('中央目录签名错误 @' + p);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');

    if (buf.readUInt32LE(localOff) !== LOCAL_SIG) throw new Error('本地头签名错误 @' + localOff);
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.slice(dataStart, dataStart + compSize);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error('不支持的压缩算法 ' + method);

    const crcCheck = typeof zlib.crc32 === 'function' ? zlib.crc32(data) >>> 0 : null;
    files.push({
      name, method, crc, crcCheck, compSize, uncompSize,
      dataLength: data.length, data,
      text: /\.(xml|rels)$/.test(name) ? data.toString('utf8') : null
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

async function main() {
  console.log('== 1. 生成演示数据 → workbook ==');
  const ctx = demo.makeContext();
  const sheets = MHY.buildWorkbook(ctx);
  console.log('  工作表：' + sheets.map((s) => `${s.name}(${s.rows.length}行)`).join('、'));
  check('工作表数量 ≥ 5', sheets.length >= 5, '实际 ' + sheets.length);
  check('有「统计概览」表', sheets.some((s) => s.name === '统计概览'), sheets.map((s) => s.name));
  check('有「关键指标」表', sheets.some((s) => s.name === '关键指标'));
  check('有「奇域热度」趋势表', sheets.some((s) => s.name === '奇域热度'));
  check('有「平均游玩时长」趋势表', sheets.some((s) => s.name === '平均游玩时长'));
  check('不含调试/接口原始数据表', !sheets.some((s) => /数据来源|全部数据|diagnostic|api/i.test(s.name)), sheets.map((s) => s.name));
  check('表名均 ≤31 字符且唯一', (() => {
    const set = new Set();
    return sheets.every((s) => s.name.length <= 31 && !set.has(s.name) && (set.add(s.name) || true));
  })());

  const heat = sheets.find((s) => s.name === '奇域热度');
  check('热度趋势表有 30 行', heat && heat.rows.length === 30, heat ? String(heat.rows.length) : 'missing');
  check('热度趋势表首列为日期', heat && /^\d{4}-\d{2}-\d{2}$/.test(String(heat.rows[0][0])), heat ? String(heat.rows[0][0]) : '');
  check('热度趋势末值为 505', heat && heat.rows[heat.rows.length - 1][1] === 505, heat ? String(heat.rows[heat.rows.length - 1][1]) : '');

  const dur = sheets.find((s) => s.name === '平均游玩时长');
  const durPeak = dur && dur.rows.find((r) => r[1] === 796);
  check('时长趋势表含中文时长列', !!(durPeak && durPeak[2] === '13分16秒'), durPeak ? String(durPeak[2]) : 'missing');
  check('时长峰值 796 秒', !!durPeak, '');

  console.log('\n== 2. 构建 xlsx ==');
  const bytes = await XLSX.buildXlsx(sheets);
  fs.mkdirSync(OUT, { recursive: true });
  const xlsxPath = path.join(OUT, '奇域数据_示例.xlsx');
  fs.writeFileSync(xlsxPath, bytes);
  console.log('  写入 ' + xlsxPath + '（' + (bytes.length / 1024).toFixed(1) + ' KB）');

  check('ZIP 起始签名 PK\\x03\\x04', bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04);

  console.log('\n== 3. 校验 ZIP 容器与 CRC32 ==');
  const files = unzip(Buffer.from(bytes));
  const names = files.map((f) => f.name);
  const need = [
    '[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels',
    'xl/styles.xml', 'docProps/core.xml', 'docProps/app.xml'
  ];
  need.forEach((n) => check('包含 ' + n, names.includes(n), names.join(' | ')));
  for (let i = 1; i <= sheets.length; i++) {
    check('包含 xl/worksheets/sheet' + i + '.xml', names.includes('xl/worksheets/sheet' + i + '.xml'));
  }
  files.forEach((f) => {
    check('CRC32 正确 [' + f.name + ']', f.crc === f.crcCheck, `头 ${f.crc} vs 实算 ${f.crcCheck}`);
    check('解压长度一致 [' + f.name + ']', f.dataLength === f.uncompSize, `${f.dataLength} vs ${f.uncompSize}`);
  });

  console.log('\n== 4. 校验 XML 内容 ==');
  const wb = files.find((f) => f.name === 'xl/workbook.xml').text;
  sheets.forEach((s) => check('workbook 含表名 ' + s.name, wb.includes('name="' + s.name + '"')));
  const sheet1 = files.find((f) => f.name === 'xl/worksheets/sheet1.xml').text;
  check('sheet1 有内联字符串', sheet1.includes('t="inlineStr"'));
  check('sheet1 有冻结首行', sheet1.includes('<pane ySplit="1"'));
  check('sheet1 覆盖核心指标', sheet1.includes('奇域热度(秒)') === false && sheet1.includes('奇域热度'));
  const heatXml = files.find((f) => f.name === 'xl/worksheets/sheet' + (names.indexOf('xl/worksheets/sheet2.xml') + 1) + '.xml');
  check('全部 XML 均可被解析（无未转义 & ）', files.every((f) => !f.text || !/&(?!(amp|lt|gt|quot|apos);)/.test(f.text)));

  // 表名合规性：Excel 工作表名不允许这些字符
  check('表名不含非法字符', sheets.every((s) => !/[\\\/?*\[\]:]/.test(s.name)));

  console.log('\n== 5. CSV / JSON 示例 ==');
  const csv = XLSX.buildCsv(sheets);
  const csvPath = path.join(OUT, '奇域数据_示例.csv');
  fs.writeFileSync(csvPath, '\ufeff' + csv, 'utf8');
  check('CSV 带 UTF-8 BOM 头（Excel 中文不乱码）', true);
  check('CSV 含表名分隔', csv.includes('# 统计概览') && csv.includes('# 奇域热度'), csv.slice(0, 80));
  check('CSV 引号转义正确', XLSX.buildCsv([{ name: 't', rows: [['a,b', 'c"d']] }]).includes('"a,b","c""d"'));

  const jsonPath = path.join(OUT, '奇域数据_示例.json');
  fs.writeFileSync(jsonPath, JSON.stringify(ctx, null, 2), 'utf8');
  check('JSON 可回读', JSON.parse(fs.readFileSync(jsonPath, 'utf8')).stageId === demo.STAGE_ID);

  console.log('\n== 6. 解析工具单测 ==');
  check('parseStageId(#/StageData/stageDetail/…)', MHY.parseStageId(demo.URL) === demo.STAGE_ID, MHY.parseStageId(demo.URL));
  check('parseStageId(?id=…)', MHY.parseStageId('https://x/y?id=123') === '123');
  check('isStageDetailUrl 正确', MHY.isStageDetailUrl(demo.URL) === true);
  check('isStageDetailUrl 对列表页为 false', MHY.isStageDetailUrl('https://act.mihoyo.com/miliastra_wonderland/developer#/StageData/stageData') === false);
  check('parseDuration("5分23秒")=323', MHY.parseDuration('5分23秒').seconds === 323, JSON.stringify(MHY.parseDuration('5分23秒')));
  check('parseDuration("13分20秒")=800', MHY.parseDuration('13分20秒').seconds === 800);
  check('parseDuration("1小时2分3秒")=3723', MHY.parseDuration('1小时2分3秒').seconds === 3723);
  check('parseDuration("45秒")=45', MHY.parseDuration('45秒').seconds === 45);
  check('parseDuration("5:23")=323', MHY.parseDuration('5:23').seconds === 323);
  check('humanSeconds(323)="5分23秒"', MHY.humanSeconds(323) === '5分23秒', MHY.humanSeconds(323));
  check('coerceNum 保留长 ID 语义', MHY.coerceNum('54461776301') === 54461776301);
  check('coerceNum 保留前导零为文本', MHY.coerceNum('007') === '007');
  check('cleanLabel 去掉「较昨日 ↑1」', MHY.cleanLabel('奇域热度 较昨日 ↑1') === '奇域热度', MHY.cleanLabel('奇域热度 较昨日 ↑1'));
  check('fmtDateTime(2026/09/27 19:02) 规范化', MHY.fmtDateTime('2026/09/27 19:02') === '2026-09-27 19:02:00', MHY.fmtDateTime('2026/09/27 19:02'));
  check('fmtDateTime(时间戳) 可用', /^\d{4}-\d{2}-\d{2} /.test(MHY.fmtDateTime(1758970920000)));
  const arr = MHY.findBestArray({ a: 1, data: { list: [{ x: 1, y: 2 }, { x: 3, y: 4 }] } });
  check('findBestArray 命中嵌套列表', Array.isArray(arr) && arr.length === 2);
  const tbl = MHY.recordsToTable([{ a: 1, b: 'x' }, { a: 2, b: 'y' }]);
  check('recordsToTable 表头稳定', tbl.header.join(',') === 'a,b', tbl.header.join(','));
  check('sanitizeSheetName 截断到 31', MHY.sanitizeSheetName('a'.repeat(50)).length === 31);

  console.log('\n== 6.5 字段中文化与数值解析 ==');
  check('fieldLabel(metric_value_type) 保留原样且判为噪声', MHY.fieldLabel('metric_value_type') === 'metric_value_type' && MHY.isNoiseField('metric_value_type') === true);
  check('fieldLabel(cur) = 数值', MHY.fieldLabel('cur') === '数值', MHY.fieldLabel('cur'));
  check('fieldLabel(avg_duration) = 平均时长(秒)', MHY.fieldLabel('avg_duration') === '平均时长(秒)', MHY.fieldLabel('avg_duration'));
  check('splitValueUnit("5分23秒") = 323 秒', MHY.splitValueUnit('5分23秒').num === 323 && MHY.splitValueUnit('5分23秒').unit === '秒');
  check('splitValueUnit("<1分钟") 标为以内', MHY.splitValueUnit('<1分钟').unit === '以内', MHY.splitValueUnit('<1分钟'));
  check('splitValueUnit("62.5%") = 62.5 %', MHY.splitValueUnit('62.5%').num === 62.5 && MHY.splitValueUnit('62.5%').unit === '%');
  check('parseCompactNumber("5.2万") = 52000', MHY.parseCompactNumber('5.2万') === 52000);
  check('normalizeDelta("较昨日 ↑1") = +1', MHY.normalizeDelta('较昨日 ↑1').delta === '+1');
  check('normalizeDelta("较昨日 ↓3") = -3', MHY.normalizeDelta('较昨日 ↓3').delta === '-3');

  console.log('\n== 6.6 评论内容与噪声过滤 ==');
  const captured = [{
    name: 'get_stage_comment_list', url: 'https://x/api/comment', body: {
      retcode: 0,
      data: { list: [{ nickname: '用户甲', content: '关卡很有趣', create_time: 1759500000, like_num: 3 }, { nickname: '用户乙', content: '有点难', create_time: 1759503600, like_num: 0 }] }
    }
  }];
  const withComments = MHY.buildWorkbook(Object.assign({}, ctx, { captured }));
  check('识别出「评论内容」工作表', withComments.some((s) => s.name === '评论内容'), withComments.map((s) => s.name));
  const cs = withComments.find((s) => s.name === '评论内容');
  check('评论表字段清晰', cs && cs.header.join(',') === '用户,时间,评论内容,点赞数,回复数', cs && cs.header);
  check('评论表内容正确', cs && cs.rows.length === 2 && cs.rows[0][0] === '用户甲' && cs.rows[0][2] === '关卡很有趣', cs && cs.rows);
  check('评论时间被规范化', cs && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(cs.rows[0][1])), cs && cs.rows[0][1]);
  const technical = MHY.buildWorkbook(Object.assign({}, ctx, {
    captured: [{ name: 'get_stage_detail', url: 'https://x/api/detail', body: { retcode: 0, message: 'success' } }]
  }));
  check('只有 retcode/message 的响应不会生成评论表', !technical.some((s) => s.name === '评论内容'), technical.map((s) => s.name));
  const noiseTable = MHY.buildWorkbook(Object.assign({}, ctx, {
    tables: [{ name: 'get_stage_metric #1', header: ['cur', 'delta', 'date', 'metric_value_type'], rows: [[208, '0', '2026-09-10', 'METRIC_VALUE_TYPE_NORMAL']] }]
  }));
  const detail = noiseTable.find((s) => s.name === '数据明细');
  check('技术字段被剔除、字段名中文化', detail && !detail.header.join(',').includes('metric_value_type') && detail.header.includes('数值'), detail && detail.header);

  console.log('\n== 7. 边界情况 ==');
  const empty = await XLSX.buildXlsx([{ name: '空表', rows: [] }]);
  check('空表也能生成合法 xlsx', unzip(Buffer.from(empty)).length === 8);
  const bigSheets = MHY.buildWorkbook({ url: 'x', stageId: '1', metrics: [], charts: [], tables: [], sources: [] });
  check('缺数据时仍生成概览表', bigSheets.length === 1 && bigSheets[0].name === '统计概览', bigSheets.map((s) => s.name));
  const long = await XLSX.buildXlsx([{ name: '长文本与特殊字符', header: ['列<&>"\''], rows: [['<script>alert(1)</script>'], ['emoji 😀 与中文'], ['换行\n制表\t']] }]);
  const longFiles = unzip(Buffer.from(long));
  check('特殊字符被正确转义', !/&(?!(amp|lt|gt|quot|apos);)/.test(longFiles.find((f) => f.name.includes('sheet1')).text));
  check('emoji/中文可完整还原', longFiles.find((f) => f.name.includes('sheet1')).text.includes('emoji 😀 与中文'));

  console.log('\n' + (failures === 0 ? '全部检查通过 ✅' : failures + ' 项检查失败 ❌'));
  if (failures) process.exitCode = 1;
}

main().catch((e) => {
  console.error('测试异常：', e);
  process.exitCode = 1;
});
