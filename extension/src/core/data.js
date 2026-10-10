/* =============================================================
 * Miliastra Atlas — 数据解析/清洗
 * 纯函数模块，浏览器(content script) 与 Node(测试) 双端可用。
 * ============================================================= */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MHYData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ---------- 基础工具 ---------- */

  function isObj(v) { return v !== null && typeof v === 'object'; }
  function isPlain(v) { return isObj(v) && !Array.isArray(v); }

  function toText(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return String(v);
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (v instanceof Date) return v.toISOString();
    try {
      var s = JSON.stringify(v);
      return s === undefined ? String(v) : s;
    } catch (e) { return String(v); }
  }

  /** 能安全转成数字才转（保留 "54461776301" 这类长 ID 的数字语义） */
  function coerceNum(v) {
    if (typeof v === 'number') return isFinite(v) ? v : toText(v);
    if (typeof v !== 'string') return v;
    var s = v.trim();
    if (!s) return '';
    if (/^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(s)) {
      var n = Number(s);
      if (isFinite(n)) return n;
    }
    return v;
  }

  function trimLabel(label) {
    return String(label || '')
      .replace(/[\u200b-\u200f\ufeff]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** 去掉"较昨日 ↑1""30日新增量"这类噪声，得到干净字段名 */
  function cleanLabel(label) {
    var s = trimLabel(label);
    s = s.replace(/[（(][^）)]*[）)]\s*$/g, '');
    s = s.replace(/较(昨日|前日|上周|上期|昨日同期)\s*[↑↓+\-]?\s*[\d.%]*\s*$/g, '');
    s = s.replace(/[↑↓]\s*[\d.%]*\s*$/g, '');
    s = s.replace(/^["'「『]|["'」』]$/g, '');
    return trimLabel(s);
  }

  /** 数值单位归一 */
  var SECOND_UNITS = { '秒': 1, 's': 1, '秒/s': 1, '分钟': 60, '分': 60, 'min': 60, 'm': 60, '小时': 3600, 'h': 3600, '时': 3600 };
  var MS_UNITS = { '毫秒': 1, 'ms': 1 };

  function humanSeconds(sec) {
    sec = Math.round(Number(sec) || 0);
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    if (h) return h + '小时' + m + '分' + s + '秒';
    if (m) return m + '分' + s + '秒';
    return s + '秒';
  }

  /**
   * 解析中文时长："5分23秒" / "13分20秒" / "2小时5分" / "45秒" / "5:23" / "1:02:03"
   * @returns {{seconds:number|null, text:string}}
   */
  function parseDuration(v) {
    if (v === null || v === undefined) return { seconds: null, text: '' };
    var text = trimLabel(v);
    if (!text) return { seconds: null, text: '' };

    // 纯数字：按秒处理
    if (/^\d+(\.\d+)?$/.test(text)) {
      var n = Number(text);
      return { seconds: n, text: humanSeconds(n) };
    }
    // hh:mm:ss / mm:ss
    var colon = text.match(/^(\d{1,3}):(\d{1,2})(?::(\d{1,2}))?$/);
    if (colon) {
      var sec = colon[3] !== undefined
        ? (+colon[1]) * 3600 + (+colon[2]) * 60 + (+colon[3])
        : (+colon[1]) * 60 + (+colon[2]);
      return { seconds: sec, text: humanSeconds(sec) };
    }
    // 中文单位
    if (/[秒分时小]/.test(text)) {
      var total = 0, matched = false, re = /(\d+(?:\.\d+)?)\s*(小时|时|分钟|分|秒|毫秒|ms|s|min|h)/g, m;
      while ((m = re.exec(text)) !== null) {
        matched = true;
        var unit = m[2];
        var mult = MS_UNITS[unit] ? 0.001 : (SECOND_UNITS[unit] || 1);
        total += (+m[1]) * mult;
      }
      if (matched) {
        var secs = Math.round(total);
        return { seconds: secs, text: humanSeconds(secs) };
      }
    }
    return { seconds: null, text: text };
  }

  /** 从 ECharts 的 axis label 猜出该轴值的单位倍数 */
  function scaleFromLabel(label) {
    var s = trimLabel(label);
    var m = /^(\d+(?:\.\d+)?)\s*(小时|时|分钟|分|秒|毫秒|ms|s|min|h|次|条|个)?$/i.exec(s);
    if (!m) return 1;
    var v = Number(m[1]);
    var unit = m[2] ? m[2].toLowerCase() : '';
    if (MS_UNITS[m[2]]) return v * 0.001;
    if (unit === '小时' || unit === '时' || unit === 'h') return v * 3600;
    if (unit === '分钟' || unit === '分' || unit === 'min') return v * 60;
    return v;
  }

  /** 把 ECharts 折线还原为 [{label:number, value:number}] */
  function normalizeSeries(rows) {
    var out = [];
    (rows || []).forEach(function (r, i) {
      var label = Array.isArray(r) ? r[0] : (r && r.label !== undefined ? r.label : i);
      var value = Array.isArray(r) ? r[1] : (r ? r.value : r);
      if (Array.isArray(value)) value = value[1];
      var n = Number(value);
      out.push({ label: label, value: isFinite(n) ? n : null });
    });
    return out;
  }

  function fmtDateLabel(v) {
    if (isObj(v)) {
      if (typeof v.value === 'number') return v.value;
      if (v.name !== undefined) return v.name;
      if (v.label !== undefined) return v.label;
      var s = JSON.stringify(v);
      return s;
    }
    return v;
  }

  /* ---------- URL / 主键 ---------- */

  /**
   * 从各种形态的页面 URL 中解出奇域(关卡)ID。
   * 支持 #/StageData/stageDetail/54461776301 与 ?id= / ?stage_id=
   */
  function parseStageId(url) {
    var s = String(url || '');
    var pats = [
      /stageDetail\/([A-Za-z0-9_-]+)/i,
      /stage_id=([A-Za-z0-9_-]+)/i,
      /[?&#]id=([A-Za-z0-9_-]+)/i,
      /stageId[=/]([A-Za-z0-9_-]+)/i
    ];
    for (var i = 0; i < pats.length; i++) {
      var m = pats[i].exec(s);
      if (m && m[1]) return decodeURIComponent(m[1]);
    }
    return '';
  }

  function isTargetUrl(url) {
    var s = String(url || '');
    return /act\.mihoyo\.com/i.test(s) && /miliastra_wonderland/i.test(s);
  }

  function isStageDetailUrl(url) {
    return isTargetUrl(url) && /StageData\/stageDetail\//i.test(String(url || ''));
  }

  /** 时间戳/字符串 -> 'YYYY-MM-DD HH:mm:ss'（浏览器本地时区） */
  function fmtDateTime(v) {
    if (v === null || v === undefined || v === '') return '';
    var d = null;
    if (v instanceof Date) d = v;
    else if (typeof v === 'number' || /^\d{9,13}$/.test(String(v))) {
      var n = Number(v);
      if (n < 1e12) n *= 1000;
      d = new Date(n);
    } else {
      var s = String(v).trim();
      var p = /^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s);
      if (p) {
        d = new Date(+p[1], +p[2] - 1, +p[3], +p[4], +p[5], +(p[6] || 0));
      } else {
        var d2 = new Date(s.replace(/-/g, '/'));
        if (!isNaN(d2.getTime())) d = d2;
      }
    }
    if (!d || isNaN(d.getTime())) return toText(v);
    return pad(d.getFullYear(), 4) + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2) +
      ' ' + pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2) + ':' + pad(d.getSeconds(), 2);
  }

  function pad(n, len) {
    var s = String(n);
    while (s.length < len) s = '0' + s;
    return s;
  }

  function fmtDateOnly(v) {
    var s = fmtDateTime(v);
    return s ? s.slice(0, 10) : '';
  }

  function nowStamp() {
    var d = new Date();
    return pad(d.getFullYear(), 4) + pad(d.getMonth() + 1, 2) + pad(d.getDate(), 2) +
      '_' + pad(d.getHours(), 2) + pad(d.getMinutes(), 2) + pad(d.getSeconds(), 2);
  }

  function safeFileName(s) {
    return String(s || 'export').replace(/[\\/:*?"<>|\r\n\t]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 100) || 'export';
  }

  /* ---------- JSON 深挖 ---------- */

  var ARRAY_KEYS = /^(list|items|rows|data_list|datalist|records|record_list|points|series|logs)$/i;

  /** 深度优先找出体积最大的"对象数组"，用于兜底提取表格 */
  function findBestArray(obj, opts) {
    opts = opts || {};
    var minLen = opts.minLen || 2;
    var maxDepth = opts.maxDepth || 8;
    var best = null;
    var seen = 0;

    function scoreArr(arr) {
      if (!Array.isArray(arr) || arr.length < minLen) return -1;
      var objCount = 0;
      for (var i = 0; i < Math.min(arr.length, 20); i++) if (isPlain(arr[i])) objCount++;
      if (objCount < Math.min(arr.length, 20)) return -1;
      var keys = Object.keys(arr[0] || {}).length;
      return arr.length * Math.max(1, keys); // 行数 × 列数
    }

    function walk(node, depth) {
      if (seen++ > 20000 || depth > maxDepth || !isObj(node)) return;
      if (Array.isArray(node)) {
        var sc = scoreArr(node);
        if (sc > 0 && (!best || sc > best.score)) best = { array: node, score: sc, path: best && best.path };
        for (var i = 0; i < Math.min(node.length, 3); i++) walk(node[i], depth + 1);
        return;
      }
      var keys = Object.keys(node);
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        var val = node[key];
        if (Array.isArray(val) && ARRAY_KEYS.test(key)) {
          var s2 = scoreArr(val);
          if (s2 > 0 && (!best || s2 * 1.5 > best.score)) best = { array: val, score: s2 * 1.5 };
        }
        walk(val, depth + 1);
      }
    }
    walk(obj, 0);
    return best ? best.array : null;
  }

  /** 对象数组 -> 表头 + 行（表头顺序稳定） */
  function recordsToTable(records, headerMap) {
    if (!Array.isArray(records) || !records.length) return { header: [], rows: [] };
    var header = [];
    var seen = Object.create(null);
    records.forEach(function (rec) {
      if (!isPlain(rec)) return;
      Object.keys(rec).forEach(function (k) {
        if (seen[k]) return;
        seen[k] = 1;
        var v = rec[k];
        if (isObj(v) && !Array.isArray(v)) return; // 嵌套对象单独展开
        header.push(k);
      });
    });
    // 嵌套对象/数组也展开成列
    records.forEach(function (rec) {
      if (!isPlain(rec)) return;
      Object.keys(rec).forEach(function (k) {
        var v = rec[k];
        if (!isObj(v)) return;
        var name = k;
        if (seen[name]) return;
        seen[name] = 1;
        header.push(name);
      });
    });
    var rows = records.map(function (rec) {
      if (!isPlain(rec)) return [toText(rec)];
      return header.map(function (h) {
        var v = rec[h];
        if (Array.isArray(v)) return v.length <= 6 ? v.join(', ') : '[' + v.length + ' 项]';
        if (isPlain(v)) return toText(v);
        if (headerMap && headerMap[h]) return headerMap[h](v, rec);
        return coerceNum(toText(v));
      });
    });
    return { header: header, rows: rows };
  }

  /* ---------- 字段中文化 / 噪声过滤 ---------- */

  var FIELD_LABELS = {
    date: '日期', time: '时间', day: '日期', timestamp: '时间戳', ts: '时间戳',
    cur: '数值', value: '数值', num: '数值', count: '数量', total: '合计',
    delta: '环比变化', rate: '比率', ratio: '比率', percent: '百分比', score: '评分',
    type: '类型', id: 'ID', uid: '用户ID', avatar: '头像', nickname: '昵称', nick: '昵称',
    name: '名称', title: '标题', content: '内容', text: '文本', comment: '评论',
    stage_id: '奇域ID', stage_name: '奇域名称', level_id: '关卡ID',
    metric: '指标', metric_type: '指标类型', metric_key: '指标',
    duration: '时长', avg_duration: '平均时长(秒)', play_time: '游玩时长(秒)',
    heat: '热度', hot: '热度', recommend: '推荐', recommend_rate: '推荐率',
    play_index: '游玩指数', stage_count: '奇域总数', subscribe: '订阅人数', subscribe_count: '订阅人数',
    subscribe_num: '订阅人数', favorite: '收藏数', like: '点赞数', share: '分享数',
    comment_count: '评论数', ctr: '封面点击率', click: '点击数', exposure: '曝光数',
    show_count: '曝光数', click_count: '点击数', cover_ctr: '封面点击率',
    retcode: '返回码', message: '提示信息', msg: '提示信息'
  };

  /** 技术性/调试性字段，不导出到表格 */
  var NOISE_FIELDS = /^(value_type|metric_value_type|cur_invalid|invalid|is_valid|__|_)\w*/i;

  function fieldLabel(key) {
    var k = String(key || '');
    if (FIELD_LABELS[k]) return FIELD_LABELS[k];
    var low = k.toLowerCase();
    if (FIELD_LABELS[low]) return FIELD_LABELS[low];
    // 去掉常见前后缀后再试
    var stripped = low.replace(/^(cur|current|total|avg|average)_/, '').replace(/_(value|num|count|rate|list)$/, '');
    if (FIELD_LABELS[stripped]) return FIELD_LABELS[stripped];
    return k;
  }

  function isNoiseField(key) {
    return NOISE_FIELDS.test(String(key || '').trim());
  }

  /* ---------- 表格装配 ---------- */

  function str(v) { return v === null || v === undefined ? '' : String(v); }

  var SEC = { day: 86400, hour: 3600, minute: 60 };

  /** 把 "5.2万" / "1,234" / "3.5%" 解析成数字 */
  function parseCompactNumber(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = str(v).trim().replace(/,/g, '').replace(/\s+/g, '');
    if (!s) return null;
    var m = /^(-?\d+(?:\.\d+)?)(万|亿|千|k|K|w|W)?(%?)$/.exec(s);
    if (!m) return null;
    var n = parseFloat(m[1]);
    if (!isFinite(n)) return null;
    var unit = m[2];
    if (unit === '万' || unit === 'w' || unit === 'W') n *= 1e4;
    else if (unit === '亿') n *= 1e8;
    else if (unit === '千' || unit === 'k' || unit === 'K') n *= 1e3;
    return n;
  }

  /**
   * 从指标卡的原始文本里拆出「数值 + 单位」。
   * "5分23秒" -> {num: 323, unit: '秒'}；"<1分钟" -> {num: 1, unit: '分钟以内'}；"117" -> {num: 117}
   */
  function splitValueUnit(raw, hint) {
    var text = trimLabel(raw);
    if (!text) return { num: null, unit: '' };
    // "<1分钟" 这类阈值写法：先处理，避免被时长解析吞掉
    if (/^[<＜≦≤]/.test(text)) {
      var inner = parseCompactNumber(text.replace(/^[<＜≦≤]\s*/, ''));
      var innerDur = parseDuration(text.replace(/^[<＜≦≤]\s*/, ''));
      return { num: innerDur.seconds != null ? innerDur.seconds : inner, unit: '以内', text: text, threshold: true };
    }
    var dur = parseDuration(text);
    if (dur.seconds != null && /[秒分时]|:/.test(text)) {
      return { num: dur.seconds, unit: '秒', text: dur.text };
    }
    var pm = /^(-?\d+(?:\.\d+)?)\s*(%|％)?\s*(.*)$/.exec(text.replace(/,/g, ''));
    if (pm) {
      var num = parseCompactNumber(text);
      var unit = (pm[3] || '').trim();
      if (pm[2]) unit = '%' + unit;
      return { num: num == null ? null : num, unit: unit, text: text };
    }
    return { num: parseCompactNumber(text), unit: hint || '', text: text };
  }

  /** 变化量文本归一："较昨日 ↑1" -> {label:'较昨日', delta:'+1'} */
  function normalizeDelta(raw) {
    var s = trimLabel(raw);
    if (!s) return { label: '', delta: '' };
    var m = /^(较昨日|较前日|较上周|较上期|环比)?\s*([↑↓+\-]?)\s*([\d.,]+%?)?\s*(.*)$/.exec(s);
    if (!m) return { label: '', delta: s };
    var sign = m[2] === '↓' ? '-' : (m[2] === '↑' ? '+' : '');
    var num = m[3] || '';
    var delta = num ? (sign + num) : (m[4] || '');
    return { label: m[1] || '', delta: delta };
  }

  /** 指标卡工作表：一行一个指标，数值与单位分列，便于排序/画图 */
  function buildMetricsSheet(metrics) {
    var order = [], map = Object.create(null);
    (metrics || []).forEach(function (m) {
      if (!m || !m.key) return;
      if (map[m.key]) return;
      map[m.key] = m;
      order.push(m.key);
    });
    var rows = [];
    order.forEach(function (key) {
      var m = map[key];
      var raw = str(m.value);
      if (!raw) return;
      var su = splitValueUnit(raw, m.unit === 'datetime' ? '' : m.unit);
      var num = m.unit === 'datetime' ? '' : su.num;
      var d = normalizeDelta(m.delta);
      rows.push([
        key,
        raw,
        num === null || num === undefined ? '' : num,
        m.unit === 'datetime' ? '' : (su.unit || ''),
        d.label,
        d.delta
      ]);
    });
    if (!rows.length) return null;
    return { name: '关键指标', header: ['指标名称', '页面显示值', '数值', '单位', '对比口径', '变化量'], rows: rows };
  }

  var TREND_ORDER = ['奇域总热度', '奇域热度', '平均游玩时长', '单局游玩时长分布', '平均推荐率', '游玩指数', '奇域总数', '订阅人数趋势', '评论数', '封面点击率', '活跃指数'];

  function trendRank(name) {
    var s = str(name);
    for (var i = 0; i < TREND_ORDER.length; i++) {
      if (s.indexOf(TREND_ORDER[i]) !== -1) return i;
    }
    return TREND_ORDER.length;
  }

  /** 折线/柱状图 -> 独立工作表，列名中文化，纵列字段名带上单位 */
  function buildChartSheets(charts) {
    var sheets = [];
    (charts || []).forEach(function (c, i) {
      if (!c || !c.rows || !c.rows.length) return;
      var name = sanitizeSheetName(c.title || ('趋势图' + (i + 1)));

      if (c.header && c.header.length && Array.isArray(c.rows[0])) {
        var header = c.header.map(function (h, hi) {
          var label = fieldLabel(h);
          if (hi === 0) return label;                       // 首列是日期/序号
          if (/秒|时长/.test(str(h)) && !/\(秒\)|\（秒\）/.test(str(h))) label = label + '(秒)';
          return label;
        });
        sheets.push({
          name: name,
          header: header,
          rows: c.rows.map(function (r) {
            return r.map(function (v) { return v === null || v === undefined ? '' : coerceNum(toText(v)); });
          })
        });
        return;
      }
      // 旧结构 [{label,value}]
      sheets.push({
        name: name,
        header: [fieldLabel(c.xName || '日期'), c.yName || '数值'],
        rows: (c.rows || []).map(function (r) {
          return [coerceNum(toText(fmtDateLabel(r.label))), r.value == null ? '' : r.value];
        })
      });
    });
    // 按用户关注的顺序排列
    sheets.sort(function (a, b) { return trendRank(a.name) - trendRank(b.name); });
    return sheets;
  }

  /** 页面上的信息类表格（奇域信息等）单独成表 */
  function buildInfoSheets(tables) {
    return (tables || []).filter(function (t) {
      return t && t.rows && t.rows.length && /信息|基础|概况/.test(str(t.name));
    }).map(function (t) {
      return { name: '关卡基础数据', header: (t.header || ['字段', '内容']).map(function (h, i) { return i === 0 ? '字段' : '内容'; }), rows: t.rows };
    });
  }

  function isDataTable(t) {
    if (!t || !t.rows || !t.rows.length) return false;
    if (/信息|基础/.test(str(t.name))) return false;
    // 接口返回的单对象键值对（retcode/message）不算数据
    var header = (t.header || []).map(str);
    if (header.length === 2 && header[0] === '字段' && header[1] === '值') {
      var keys = t.rows.map(function (r) { return str(r[0]).toLowerCase(); });
      if (keys.length <= 6 && keys.every(function (k) { return /retcode|message|msg|success|error/.test(k); })) return false;
    }
    return true;
  }

  /** 清洗数据表的列：中文化 + 去掉技术字段 + 全空列删除 */
  function cleanTable(table) {
    var header = (table.header || []).map(function (h) { return str(h); });
    var keep = [];
    header.forEach(function (h, i) {
      if (isNoiseField(h)) return;
      keep.push(i);
    });
    var newHeader = keep.map(function (i) { return fieldLabel(header[i]); });
    var rows = table.rows.map(function (r) {
      return keep.map(function (i) { return r[i] === undefined ? '' : r[i]; });
    });
    // 删除整列为空的列
    var nonEmpty = newHeader.map(function (_, ci) {
      return rows.some(function (r) { return str(r[ci]) !== ''; });
    });
    var idx = [];
    nonEmpty.forEach(function (ok, ci) { if (ok) idx.push(ci); });
    return {
      header: idx.map(function (ci) { return newHeader[ci]; }),
      rows: rows.map(function (r) { return idx.map(function (ci) { return r[ci]; }); })
    };
  }

  /** 明细数据：只导出页面上的明细表格（接口原始响应不进表），列名中文化 */
  function buildDetailSheets(ctx) {
    var sheets = [];
    var tables = (ctx && ctx.tables) || [];
    var detail = tables.filter(isDataTable).slice(0, 8);
    if (!detail.length) return sheets;

    // 合并表：数据类别 + 序号 + 所有出现过的列
    var columns = [];
    detail.forEach(function (t) {
      var c = cleanTable(t);
      c.header.forEach(function (h) { if (columns.indexOf(h) === -1) columns.push(h); });
    });
    var combined = [];
    detail.forEach(function (t) {
      var c = cleanTable(t);
      c.rows.forEach(function (r, i) {
        var row = [str(t.name), i + 1];
        columns.forEach(function (h) {
          var ci = c.header.indexOf(h);
          row.push(ci >= 0 ? r[ci] : '');
        });
        combined.push(row);
      });
    });
    if (combined.length) {
      sheets.push({ name: '数据明细', header: ['数据类别', '序号'].concat(columns), rows: combined });
    }

    // 每种明细再单独一张表（行数不太多时）
    if (detail.length > 1 && detail.length <= 6) {
      detail.forEach(function (t) {
        var c = cleanTable(t);
        if (!c.header.length || !c.rows.length) return;
        sheets.push({ name: sanitizeSheetName(t.name), header: c.header, rows: c.rows });
      });
    }
    return sheets;
  }

  /* ---------- 评论内容 ---------- */

  var COMMENT_SHEETS = [
    { name: '评论内容', re: /comment|reply|evaluate|feedback|评价|评论/i },
    { name: '互动数据', re: /interact|like|favorite|collect|share|点赞|收藏|分享/i }
  ];
  var COMMENT_TEXT_KEYS = ['content', 'text', 'comment', 'comment_content', 'message', 'reply_content', 'evaluate_content', 'content_text'];
  var AUTHOR_KEYS = ['nickname', 'nick', 'user_name', 'username', 'author', 'name', 'uid', 'user_id', 'avatar'];
  var TIME_KEYS = ['time', 'create_time', 'created_at', 'timestamp', 'date', 'post_time', 'publish_time'];

  function pickKey(rec, keys) {
    for (var i = 0; i < keys.length; i++) {
      if (rec && rec[keys[i]] !== undefined && rec[keys[i]] !== null && str(rec[keys[i]]) !== '') return keys[i];
    }
    return null;
  }

  function isCommentArray(arr) {
    if (!Array.isArray(arr) || !arr.length) return false;
    var hits = 0, total = Math.min(arr.length, 10);
    for (var i = 0; i < total; i++) {
      var rec = arr[i];
      if (!isPlain(rec)) continue;
      if (pickKey(rec, COMMENT_TEXT_KEYS)) hits++;
    }
    return hits >= Math.max(1, Math.ceil(total * 0.6));
  }

  function commentsToSheet(arr, name) {
    var rows = [];
    arr.forEach(function (rec) {
      if (!isPlain(rec)) return;
      var textKey = pickKey(rec, COMMENT_TEXT_KEYS);
      if (!textKey) return;
      var authorKey = pickKey(rec, AUTHOR_KEYS);
      var timeKey = pickKey(rec, TIME_KEYS);
      var timeVal = timeKey ? rec[timeKey] : '';
      if (timeKey && /^(time|create_time|created_at|timestamp|post_time|publish_time)$/.test(timeKey)) {
        timeVal = fmtDateTime(timeVal);
      }
      var author = authorKey ? str(rec[authorKey]) : '';
      if (authorKey && /uid|user_id/i.test(authorKey) && !author) author = '';
      rows.push([
        author,
        str(timeVal),
        str(rec[textKey]).replace(/\s+/g, ' ').slice(0, 2000),
        rec.like_num !== undefined ? coerceNum(str(rec.like_num)) : (rec.like !== undefined ? coerceNum(str(rec.like)) : ''),
        rec.reply_num !== undefined ? coerceNum(str(rec.reply_num)) : (rec.reply_count !== undefined ? coerceNum(str(rec.reply_count)) : '')
      ]);
    });
    if (!rows.length) return null;
    return { name: name, header: ['用户', '时间', '评论内容', '点赞数', '回复数'], rows: rows };
  }

  /** 从接口响应里挑出评论/互动类数组 */
  function buildCommentSheets(captured) {
    var sheets = [];
    var used = Object.create(null);
    (captured || []).forEach(function (cap) {
      var body = cap && cap.body;
      if (!body) return;
      var label = str(cap.name || cap.url || '') + ' ' + str(cap.url || '');
      var target = null;
      COMMENT_SHEETS.forEach(function (c) {
        if (!target && c.re.test(label)) target = c.name;
      });
      var arrays = [];
      (function walk(node, depth) {
        if (depth > 6 || !node) return;
        if (Array.isArray(node)) {
          if (isCommentArray(node)) arrays.push(node);
          for (var i = 0; i < Math.min(node.length, 2); i++) walk(node[i], depth + 1);
          return;
        }
        if (!isPlain(node)) return;
        Object.keys(node).forEach(function (k) { walk(node[k], depth + 1); });
      })(body, 0);
      arrays.forEach(function (arr) {
        var n = 0;
        var base = target || '评论内容';
        var name = base;
        while (used[name]) { n++; name = (base.slice(0, 28) + '_' + n).slice(0, 31); }
        used[name] = 1;
        var sheet = commentsToSheet(arr, name);
        if (sheet) sheets.push(sheet);
      });
    });
    return sheets;
  }

  /** 概览区块的补充项（页面标签里能读到、但没进 overview 的） */
  function buildExtraSummaryRows(ctx, skip) {
    var rows = [];
    var seen = Object.create(null);
    (skip || []).forEach(function (s) { seen[str(s)] = 1; });
    var pairs = (ctx && ctx.diagnostics && ctx.diagnostics.kvPairs) || [];
    pairs.forEach(function (p) {
      var key = str(p && p.key);
      var val = str(p && p.value);
      if (!key || !val || key.length > 20 || val.length > 200) return;
      if (seen[key] || isNoiseField(key)) return;
      if (/^(首页|论坛|学院|资产中心|退出|登录|注册)/.test(key)) return;
      seen[key] = 1;
      rows.push([key, coerceNum(val)]);
    });
    return rows;
  }

  function buildSummaryRows(ctx) {
    var ov = (ctx && ctx.overview) || {};
    var rows = [['项目', '值']];
    function add(k, v) {
      v = toText(v);
      if (v !== '') rows.push([k, coerceNum(v)]);
    }
    add('奇域名称', ov.name || '');
    add('奇域ID', (ctx && ctx.stageId) || ov.stageId || '');
    add('状态', ov.status || '');
    add('发布时间', ov.publishTime || '');
    add('奇域热度', ov.heat !== undefined ? ov.heat : '');
    add('近期新增量', ov.newHeat !== undefined ? ov.newHeat : '');
    if (ov.avgDuration) {
      if (typeof ov.avgDuration === 'object' && ov.avgDuration.seconds != null) {
        add('平均游玩时长', ov.avgDuration.text);
        add('平均游玩时长(秒)', ov.avgDuration.seconds);
      } else {
        add('平均游玩时长', ov.avgDuration);
      }
    }
    add('游玩人数', ov.playerCount !== undefined ? ov.playerCount : '');
    add('新增游玩人数', ov.newPlayerCount !== undefined ? ov.newPlayerCount : '');
    add('活跃指数', ov.activeIndex !== undefined ? ov.activeIndex : '');
    add('互动数据', ov.interaction !== undefined ? ov.interaction : '');
    add('奇域评价', ov.rating !== undefined ? ov.rating : '');
    add('数据时间', ov.dataTime || '');
    add('导出时间', fmtDateTime(ctx && ctx.exportedAt ? ctx.exportedAt : Date.now()));

    // 页面上其它有意义的「标签: 值」一并带上（过滤导航类噪声）
    var skip = ['奇域名称', '奇域ID', '状态', '发布时间', '奇域热度', '平均游玩时长', '平均游玩时长(秒)', '近期新增量'];
    buildExtraSummaryRows(ctx, skip).forEach(function (r) { rows.push(r); });
    add('数据来源页', ctx && ctx.url);
    return rows;
  }

  function sanitizeSheetName(name) {
    var s = str(name).replace(/[\\\/?*\[\]:]/g, '_').replace(/^\s+|\s+$/g, '').slice(0, 31);
    return s || 'Sheet';
  }

  /**
   * 组装所有工作表。
   * 结构（按用户要看的顺序）：统计概览 → 关卡基础数据 → 各趋势 → 关键指标 → 互动数据 → 评论内容 → 数据明细
   * 不包含：接口原始响应、调试数据、页面导航文字。
   * @returns {Array<{name:string, header:string[], rows:Array[]}>}
   */
  function buildWorkbook(ctx) {
    ctx = ctx || {};
    var used = Object.create(null);
    var sheets = [];
    function push(sheet) {
      if (!sheet) return;
      var base = sanitizeSheetName(sheet.name);
      var name = base, i = 2;
      while (used[name]) { name = (base.slice(0, 28) + '_' + i).slice(0, 31); i++; }
      used[name] = 1;
      sheet.name = name;
      sheets.push(sheet);
    }

    push({ name: '统计概览', header: null, rows: buildSummaryRows(ctx) });

    var chartSheets = buildChartSheets(ctx.charts, used);
    var commentSheets = buildCommentSheets(ctx.captured || []);
    // 评论类工作表插到关键指标之前，趋势之后
    var infoSheets = buildInfoSheets(ctx.tables);
    var detailSheets = buildDetailSheets(ctx, used);

    infoSheets.forEach(push);
    chartSheets.forEach(push);
    push(buildMetricsSheet(ctx.metrics));
    commentSheets.forEach(push);
    detailSheets.forEach(push);
    return sheets;
  }

  return {
    // utils
    isObj: isObj, isPlain: isPlain, toText: toText, coerceNum: coerceNum,
    trimLabel: trimLabel, cleanLabel: cleanLabel, parseDuration: parseDuration,
    humanSeconds: humanSeconds, scaleFromLabel: scaleFromLabel,
    normalizeSeries: normalizeSeries, fmtDateLabel: fmtDateLabel,
    findBestArray: findBestArray, recordsToTable: recordsToTable,
    fieldLabel: fieldLabel, isNoiseField: isNoiseField,
    parseCompactNumber: parseCompactNumber, splitValueUnit: splitValueUnit,
    normalizeDelta: normalizeDelta, isCommentArray: isCommentArray, commentsToSheet: commentsToSheet,
    // url/time
    parseStageId: parseStageId, isTargetUrl: isTargetUrl, isStageDetailUrl: isStageDetailUrl,
    fmtDateTime: fmtDateTime, fmtDateOnly: fmtDateOnly, nowStamp: nowStamp, safeFileName: safeFileName,
    // workbook
    buildWorkbook: buildWorkbook, sanitizeSheetName: sanitizeSheetName
  };
});
