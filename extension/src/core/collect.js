/* =============================================================
 * Miliastra Atlas — 页面数据采集（DOM + 网络拦截 + ECharts 实例）
 * ============================================================= */
(function (root) {
  'use strict';

  var MHY = root.MHYData;

  /* ---------------- 字段字典 ---------------- */

  var LABEL_MAP = {
    '奇域热度': 'heat',
    '热度': 'heat',
    '奇域热度值': 'heat',
    '7日新增量': 'newHeat7d',
    '30日新增量': 'newHeat30d',
    '新增量': 'newHeat7d',
    '平均游玩时长': 'avgDuration',
    '人均游玩时长': 'avgDuration',
    '平均时长': 'avgDuration',
    '游玩人数': 'playerCount',
    '总游玩人数': 'playerCount',
    '新增游玩人数': 'newPlayerCount',
    '单局游玩时长': 'roundDuration',
    '单局游玩时长分布': 'roundDurationDist',
    '常规区间': 'roundDurationRange',
    '活跃指数': 'activeIndex',
    '活跃度': 'activeIndex',
    '互动数据': 'interaction',
    '互动量': 'interaction',
    '互动总数': 'interaction',
    '奇域评价': 'rating',
    '评分': 'rating',
    '评价': 'rating',
    '评论数': 'commentCount',
    '收藏数': 'favoriteCount',
    '点赞数': 'likeCount',
    '分享数': 'shareCount',
    '奇域ID': 'stageId',
    '奇域id': 'stageId',
    'ID': 'stageId',
    '名称': 'name',
    '奇域名称': 'name',
    '状态': 'status',
    '发布时间': 'publishTime',
    '更新时间': 'updateTime',
    '作者': 'author',
    '创作者': 'author',
    'UID': 'authorUid'
  };

  var NOISE = /^(较昨日|较前日|较上周|新增|数据更新|更新时间|序号)$/;

  var TIME_LABEL = /(发布|更新|创建|导出|时间|日期|截止)$/;
  var DURATION_LABEL = /(时长|耗时|用时)/;

  /* ---------------- 文本工具 ---------------- */

  function clean(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/[\u200b-\u200f\ufeff]/g, '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\s*\n\s*/g, '\n')
      .trim();
  }

  function inline(el) {
    return clean(el && el.textContent);
  }

  function visible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    if (el.closest && el.closest('[data-mhy-export-ui]')) return false;
    var r = el.getBoundingClientRect();
    return (r.width > 0 && r.height > 0) || el.children.length > 0;
  }

  function looksLikeValue(s) {
    s = clean(s);
    if (!s || s.length > 40) return false;
    if (NOISE.test(s)) return false;
    if (/^(较昨日|较前日|较上周)/.test(s)) return false;
    return true;
  }

  function matchesTimeLabel(label) {
    return TIME_LABEL.test(clean(label));
  }

  function matchesDurationLabel(label) {
    return DURATION_LABEL.test(clean(label));
  }

  /* ---------------- DOM 采集 ---------------- */

  /**
   * 收集 "标签 / 值" 卡片（含 "较昨日 ↑1" 这类小字）
   * 取值时只看每个子元素自己的文本（不含其嵌套子元素），
   * 否则 "值 + 较昨日" 会被拼在一起（如 "5分23秒较昨日 -"）。
   */
  function collectPairs(scope) {
    var doc = scope || document;
    var all = doc.querySelectorAll('div,li,section,article,td,th,p,span,h1,h2,h3,h4,h5,label,a');
    var out = [];
    var seen = typeof WeakSet === 'function' ? new WeakSet() : null;
    var limit = 4000;

    function ownText(el) {
      var s = '';
      var nodes = el.childNodes || [];
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].nodeType === 3) s += nodes[i].nodeValue || '';
      }
      return clean(s);
    }

    for (var i = 0; i < all.length && i < limit; i++) {
      var el = all[i];
      if (!visible(el)) continue;
      var kids = el.children;
      if (kids.length < 2 || kids.length > 4) continue;

      var first = inline(kids[0]);
      if (!looksLikeValue(first) || !MHY.cleanLabel(first)) continue;
      // 跳过导航类元素（如侧边栏「首页 / 数据中心」）
      if (el.closest && el.closest('nav, aside, header, footer, [class*="menu"], [class*="Menu"], [class*="nav"], [class*="Nav"], [class*="tab"], [class*="Tab"]')) continue;
      var linkKids = 0;
      for (var lk = 0; lk < kids.length; lk++) if (kids[lk].tagName === 'A') linkKids++;
      if (linkKids >= 2) continue;

      // 值：跳过 "较昨日 / ↑↓" 这类变化量小字，取最后一个有效子元素
      var value = '';
      var target = null;
      for (var k = 0; k < kids.length; k++) {
        var t = ownText(kids[k]);
        if (!t && kids[k].children.length) {
          // 值被包了一层（如 <div class="vwrap"><span>5分23秒</span><span>较昨日 -</span></div>）
          t = inline(kids[k]).split('\n').map(clean).filter(Boolean)[0] || '';
        }
        if (!t) continue;
        if (/^(较昨日|较前日|较上周|[↑↓])/.test(t)) continue;
        var cl = MHY.cleanLabel(t);
        if (!cl) continue;                    // 例如 "2026/09/27 19:02 (UTC+8)" 清洗后为空
        value = cl;
        target = kids[k];
      }
      if (!looksLikeValue(value)) continue;
      if (value === first) continue;

      if (seen && target && target.nodeType === 1) {
        if (seen.has(target)) continue;
        seen.add(target);
      }
      out.push({
        key: MHY.cleanLabel(first),
        rawKey: first,
        value: value,
        el: target
      });
    }
    return out;
  }

  /** 收集 "1 0 5 0 / 0 0 0 0 0 0 0 0" 这类数字组，交由 ECharts 判定归属 */
  function collectNumberGroups() {
    var out = [];
    var nodes = document.querySelectorAll('div,span,p,section');
    for (var i = 0; i < nodes.length && i < 4000; i++) {
      var el = nodes[i];
      if (!visible(el)) continue;
      var t = inline(el);
      if (!t || t.length > 60) continue;
      if (!/^[\d\s.\-+,]+$/.test(t)) continue;
      var parts = t.split(/[\s,]+/).filter(Boolean).map(Number).filter(function (n) { return isFinite(n); });
      if (parts.length < 4) continue;
      out.push({ el: el, values: parts, text: t });
    }
    return out;
  }

  /** 取 "较昨日 / ↑1 / +3% / -2" 之类的变化量 */
  function findDelta(el) {
    if (!el) return '';
    var best = '';
    var cands = [el];
    // 变化量小字常与「值」平级（同一个卡片容器里），因此把父节点的子元素也纳入范围
    if (el.parentElement && el.parentElement.children) {
      cands = cands.concat(Array.prototype.slice.call(el.parentElement.children));
    }
    cands = cands.concat(Array.prototype.slice.call(el.children || []));
    var seen = [];
    cands.forEach(function (c) {
      if (!c || seen.indexOf(c) !== -1) return;
      seen.push(c);
      var fn = c.querySelectorAll ? c.querySelectorAll('*') : [];
      var list = fn.length ? Array.prototype.slice.call(fn) : [];
      list.push(c);
      for (var i = 0; i < list.length; i++) {
        var t = inline(list[i]);
        if (!t || t.length > 24) continue;
        if (!/(较昨日|较前日|较上周|[↑↓]|\+\d|-\d)/.test(t)) continue;
        if (list[i].children.length > 1) continue;
        if (t.length > best.length) best = t;
      }
    });
    return clean(best);
  }

  /* ---------------- ECharts ---------------- */

  function round3(n) {
    return Math.round(n * 1000) / 1000;
  }

  /** x 轴刻度/日期值 -> 单元格文本（数字刻度原样保留） */
  function coerceLabel(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number' || typeof v === 'boolean') return v;
    if (MHY.isObj(v)) {
      if (v.value !== undefined) return coerceLabel(v.value);
      if (v.name !== undefined) return String(v.name);
      if (v.label !== undefined) return String(v.label);
    }
    var s = String(v);
    // 形如 2026-09-27 / 2026/09/27 的日期统一成 YYYY-MM-DD
    var m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(s);
    if (m) {
      var mm = String(m[2]).length === 1 ? '0' + m[2] : m[2];
      var dd = String(m[3]).length === 1 ? '0' + m[3] : m[3];
      return m[1] + '-' + mm + '-' + dd;
    }
    return s;
  }

  function getCharts() {
    var out = [];
    var seen = [];
    function push(inst) {
      if (!inst || typeof inst.getOption !== 'function') return;
      if (seen.indexOf(inst) !== -1) return;
      seen.push(inst);
      out.push(inst);
    }
    try {
      var echarts = root.echarts;
      if (echarts) {
        if (typeof echarts.getInstanceByDom === 'function') {
          var canvases = document.querySelectorAll('canvas');
          for (var i = 0; i < canvases.length; i++) {
            var host = canvases[i].parentElement;
            var inst = null;
            for (var up = 0; up < 3 && host && !inst; up++) {
              try { inst = echarts.getInstanceByDom(host); } catch (e) { inst = null; }
              host = host.parentElement;
            }
            push(inst);
          }
        }
        if (echarts._instances) {
          var vals = (typeof echarts._instances === 'object' && echarts._instances)
            ? (typeof Map !== 'undefined' && echarts._instances instanceof Map ? Array.from(echarts._instances.values()) : Object.keys(echarts._instances).map(function (k) { return echarts._instances[k]; }))
            : [];
          vals.forEach(push);
        }
      }
    } catch (e) { /* ignore */ }

    // 兜底：ECharts 会在容器 DOM 上写 _echarts_instance_ 属性，
    // 即使 window.echarts 被模块化打包（打不到全局）也能借它取回实例。
    if (!out.length) {
      try {
        var nodes = document.querySelectorAll('[_echarts_instance_]');
        for (var n = 0; n < nodes.length; n++) {
          var el = nodes[n];
          var key = el.getAttribute && el.getAttribute('_echarts_instance_');
          if (!key) continue;
          var inst2 = null;
          var ec = root.echarts;
          if (ec && ec._instances && typeof ec._instances.get === 'function') inst2 = ec._instances.get(key);
          push(inst2);
        }
      } catch (e) { /* ignore */ }
    }

    return out.filter(function (inst) {
      try {
        var op = inst.getOption();
        return !!(op && op.series && op.series.length);
      } catch (e) { return false; }
    });
  }

  function pickAxisLabel(cfg) {
    if (!cfg) return '';
    // 轴名优先；没有轴名才退回数据首值（并避免把日期当成列名）
    if (typeof cfg.name === 'string' && cfg.name.trim()) return cfg.name.trim();
    var d = cfg.data;
    if (Array.isArray(d) && d.length) {
      var v = MHY.fmtDateLabel(d[0]);
      var s = (typeof v === 'string' || typeof v === 'number') ? String(v) : '';
      if (s && !/^\d{4}[-/]\d{1,2}/.test(s) && !/^\d+$/.test(s)) return s;
    }
    return '';
  }

  function chartFromInstance(inst, index) {
    var op;
    try { op = inst.getOption(); } catch (e) { return null; }
    if (!op || !op.series || !op.series.length) return null;

    var xAxes = op.xAxis || [];
    var yAxes = op.yAxis || [];
    var xName = '';
    for (var xi = 0; xi < xAxes.length; xi++) { xName = pickAxisLabel(xAxes[xi]); if (xName) break; }
    if (!xName) xName = '日期';

    var multiSeries = op.series.length > 1;
    var columns = [];
    var seriesData = [];

    op.series.forEach(function (s, si) {
      var yAxisIdx = typeof s.yAxisIndex === 'number' ? s.yAxisIndex : 0;
      var yCfg = yAxes[yAxisIdx] || yAxes[0] || null;
      var name = clean(
        (s.name && String(s.name).trim()) ||
        (yCfg && yCfg.name) ||
        (multiSeries ? ('系列' + (si + 1)) : '')
      ) || (multiSeries ? ('系列' + (si + 1)) : '数值');
      if (multiSeries && yAxes.length > 1) name = name + '(轴' + (yAxisIdx + 1) + ')';

      // 优先用 series 原始数据（不依赖坐标系，主题/渲染器差异都不影响），
      // 折线图 series.data 的顺序即为 x 轴顺序。
      var rows = [];
      var raw = Array.isArray(s.data) ? s.data : [];
      if (raw.length) {
        rows = raw.map(function (v) {
          var value = v;
          if (Array.isArray(v)) value = v.length > 1 ? v[1] : v[0];
          else if (v && typeof v === 'object') value = (v.value !== undefined ? v.value : v);
          if (Array.isArray(value)) value = value[1];
          return { label: null, value: Number(value) };
        });
      } else {
        // 兜底：从实例的坐标数据取（真实 ECharts 的 getData() 返回坐标点）
        try {
          rows = MHY.normalizeSeries(typeof inst.getData === 'function' ? inst.getData() : null) || [];
        } catch (e) { rows = []; }
        if (!rows.length) {
          var data = s.data || [];
          rows = data.map(function (v, i) {
            var value = Array.isArray(v) ? v[1] : v;
            return { label: i, value: Number(value) };
          });
        }
      }
      seriesData.push({ name: name, rows: rows, stack: s.stack || '', yAxisIndex: yAxisIdx });

      columns.push(name);
    });

    // 统一行数：以最长序列为准，按索引对齐 x 轴
    var maxLen = 0;
    seriesData.forEach(function (s) { maxLen = Math.max(maxLen, s.rows.length); });
    if (!maxLen) return null;

    // x 轴类别标签（series.data 与 xAxis.data 按索引一一对应）
    var xData = (xAxes[0] && Array.isArray(xAxes[0].data)) ? xAxes[0].data : [];
    var rows = [];
    for (var i = 0; i < maxLen; i++) {
      var row = [];
      seriesData.forEach(function (s, si) {
        var pt = s.rows[i];
        if (si === 0) {
          var xv = xData[i] !== undefined ? xData[i] : (pt ? pt.label : i);
          if (xv === null || xv === undefined) xv = i;
          row.push(coerceLabel(xv));
        }
        var val = pt && pt.value !== null && pt.value !== undefined && isFinite(Number(pt.value)) ? round3(Number(pt.value)) : '';
        row.push(val);
      });
      rows.push(row);
    }

    var titles = [xName].concat(columns);
    var legend = '';
    try {
      var legendCfg = op.legend && op.legend[0];
      if (legendCfg && Array.isArray(legendCfg.data) && legendCfg.data.length) legend = legendCfg.data.join('/');
    } catch (e) { /* ignore */ }

    var yName = (yAxes[0] && yAxes[0].name) || '';
    return {
      index: index,
      title: clean(legend || columns.join('/') || ('趋势图' + (index + 1))),
      xName: xName,
      yName: clean(yName) || (columns[0] || '数值'),
      header: titles,
      columns: columns,
      rows: rows,
      raw: seriesData.map(function (s) {
        return { name: s.name, scale: s.scale, points: s.rows.map(function (p) { return { label: MHY.fmtDateLabel(p.label), value: p.value }; }) };
      })
    };
  }

  /* ---------------- 图表兜底：从数字组重建 ---------------- */

  function chartsFromNumberGroups(groups) {
    var charts = [];
    groups.forEach(function (g) {
      if (!g.values.length) return;
      var title = '';
      var node = g.el;
      for (var up = 0; up < 5 && node; up++) {
        var head = node.querySelector ? node.querySelector('h1,h2,h3,h4,h5,[class*="title"],[class*="Title"]') : null;
        if (head && head !== g.el) {
          var t = inline(head);
          if (t && t.length < 30 && !/^\d/.test(t)) { title = t; break; }
        }
        node = node.parentElement;
      }
      charts.push({
        index: charts.length,
        title: title || ('图表' + (charts.length + 1)),
        xName: '序号',
        yName: '数值',
        header: ['序号', '数值'],
        rows: g.values.map(function (v, i) { return [i + 1, v]; }),
        partial: true,
        raw: null
      });
    });
    return charts;
  }

  /* ---------------- 表格采集 ---------------- */

  function collectTables() {
    var out = [];
    var tables = document.querySelectorAll('table');
    for (var i = 0; i < tables.length && i < 8; i++) {
      var t = tables[i];
      var rowEls = t.querySelectorAll('tr');
      if (rowEls.length < 1) continue;
      var rows = [];
      for (var r = 0; r < rowEls.length && r < 2000; r++) {
        var cells = rowEls[r].querySelectorAll('th,td');
        if (!cells.length) continue;
        var row = [];
        for (var c = 0; c < cells.length && c < 80; c++) row.push(inline(cells[c]));
        rows.push(row);
      }
      if (!rows.length) continue;
      var first = rows[0];
      var hasHeader = first.some(function (v) { return v && !/^\d+(\.\d+)?$/.test(v); });
      var hasTh = !!t.querySelector('th');
      if (!hasTh && first.some(function (v) { return !v; })) hasHeader = false;
      if (!hasTh && first.length >= 2) {
        // 数据行的首格通常是 ID / 日期 / 短序号：这里判断为数据而不是表头
        if (/^\d{4}[-/]/.test(first[0]) || /^\d{5,}$/.test(first[0])) hasHeader = false;
      }
      out.push({
        name: '页面表格' + (i + 1),
        header: hasHeader ? first : first.map(function (_, ci) { return '列' + (ci + 1); }),
        rows: hasHeader ? rows.slice(1) : rows
      });
    }
    return out;
  }

  /* ---------------- 主：组装 ---------------- */

  function buildMetrics(pairs) {
    var metrics = [];
    var index = {};
    pairs.forEach(function (p) {
      var key = p.key;
      if (!key || key.length > 24) return;
      var value = p.value;
      var m = {
        key: key,
        label: p.rawKey || key,
        value: value,
        number: null,
        unit: '',
        delta: findDelta(p.el),
        el: p.el
      };
      if (matchesTimeLabel(key)) {
        var dt = MHY.fmtDateTime(value);
        m.number = dt;
        m.unit = 'datetime';
        m.time = dt;
      } else if (matchesDurationLabel(key) || /^\d+分\d+秒?$/.test(value) || /^\d+秒$/.test(value)) {
        var dur = MHY.parseDuration(value);
        if (dur.seconds != null) { m.number = dur.seconds; m.unit = '秒'; m.duration = dur.text; }
      } else {
        var num = MHY.coerceNum(value);
        if (typeof num === 'number') {
          m.number = num;
          var unitMatch = clean(value).match(/[^\d.,\s\-+]+$/);
          if (unitMatch && unitMatch[0] && unitMatch[0] !== clean(value)) m.unit = unitMatch[0];
        }
      }
      metrics.push(m);
      if (!(key in index)) index[key] = m;
    });
    return { list: metrics, index: index };
  }

  /**
   * 解析详情页顶部信息表的「单元格文本」。
   * 各个 td 的文本可能是 "奇域ID 54461776301" 这种「字段 + 值」拼接，
   * 也可能因为图片/名称写在同一个 td 里而把名称一起带出来。
   * @returns {Array<[字段, 值]>}
   */
  function parseInfoCells(cells) {
    var out = [];
    cells.forEach(function (text, ci) {
      var t = clean(text);
      if (!t) return;
      // 字段名白名单（含可能的别名）
      var re = /(奇域ID|奇域id|作品ID|状态|发布时间|更新时间|所属分区|分类|标签|作者|创作者|UID)\s*[:：]?\s*/g;
      var matches = [];
      var m;
      while ((m = re.exec(t)) !== null) {
        matches.push({ label: clean(m[1]), valueStart: m.index + m[0].length, labelStart: m.index });
      }
      if (!matches.length) {
        // 没识别到字段：第一个 td 视为名称
        if (ci === 0) out.push(['奇域名称', t.length > 80 ? t.slice(0, 80) : t]);
        else out.push(['信息' + (ci + 1), t]);
        return;
      }
      if (matches[0].labelStart > 0) {
        var namePart = clean(t.slice(0, matches[0].labelStart));
        if (namePart && namePart.length <= 80) out.push(['奇域名称', namePart]);
      }
      matches.forEach(function (mm, i) {
        var end = (i + 1 < matches.length) ? matches[i + 1].labelStart : t.length;
        var value = clean(t.slice(mm.valueStart, end));
        value = value.replace(/^[\s:：]+|[\s,，;；]+$/g, '');
        if (!value) return;
        out.push([mm.label, value.length > 120 ? value.slice(0, 120) : value]);
      });
    });
    // 去重（同一字段保留首个非空值）
    var seen = Object.create(null);
    return out.filter(function (r) {
      if (seen[r[0]]) return false;
      seen[r[0]] = 1;
      return true;
    });
  }

  /**
   * @param {Object} opts { url, title, captured }
   * @returns {Object} workbook 上下文
   */
  function collect(opts) {
    opts = opts || {};
    var url = opts.url || (location && location.href) || '';
    var title = opts.title || (document && document.title) || '';
    var stageId = MHY.parseStageId(url);

    var pairs = collectPairs();
    var groups = collectNumberGroups();
    var mRes = buildMetrics(pairs);
    var metrics = mRes.list;
    var idx = mRes.index;

    var charts = [];
    var chartSource = 'none';
    try {
      var insts = getCharts();
      if (insts.length) {
        chartSource = 'echarts';
        insts.forEach(function (inst, i) {
          var c = chartFromInstance(inst, i);
          if (c) charts.push(c);
        });
      }
    } catch (e) { /* ignore */ }
    if (!charts.length && groups.length) {
      charts = chartsFromNumberGroups(groups);
      chartSource = 'heuristic';
    }

    // ---- 顶部信息卡（表格形式）----
    var tables = [];
    var infoRows = [];
    try {
      var trs = document.querySelectorAll('tr');
      for (var i = 0; i < trs.length && !infoRows.length; i++) {
        var cells = [];
        trs[i].querySelectorAll('th,td').forEach(function (td) { cells.push(inline(td)); });
        var joined = cells.join(' ');
        if (cells.length >= 2 && (stageId && joined.indexOf(stageId) !== -1)) {
          infoRows = cells;
        }
      }
    } catch (e) { /* ignore */ }

    if (infoRows.length) {
      var infoHeader = ['字段', '内容'];
      var parsed = parseInfoCells(infoRows);
      var hasName = parsed.some(function (r) { return r[0] === '奇域名称'; });
      if (!hasName) {
        var nameMetric0 = idx['奇域名称'] || idx['名称'];
        if (nameMetric0) parsed.unshift(['奇域名称', nameMetric0.value]);
      }
      if (!parsed.some(function (r) { return /ID/i.test(r[0]); }) && stageId) parsed.push(['奇域ID', stageId]);
      if (parsed.length) tables.push({ name: '奇域信息', header: infoHeader, rows: parsed });
    }

    // ---- 网络拦截到的数据 ----
    var sources = [];
    var captured = opts.captured || [];
    var tableSeq = 0;
    captured.forEach(function (cap) {
      var body = cap.body;
      var label = cap.name || cap.url || '';
      var arr = MHY.findBestArray(body, { minLen: 2, maxDepth: 8 });
      if (Array.isArray(body) && body.length && MHY.isPlain(body[0])) arr = body;
      if (arr && arr.length) {
        var table = MHY.recordsToTable(arr);
        if (table.rows.length) {
          tableSeq++;
          tables.push({
            name: label + ' #' + tableSeq,
            header: table.header,
            rows: table.rows
          });
          sources.push({ via: '接口', name: label, url: cap.url, count: arr.length, time: cap.time });
          return;
        }
      }
      // 单个对象里的标量字段 -> 两列
      var scalars = [];
      if (MHY.isPlain(body)) {
        Object.keys(body).forEach(function (k) {
          var v = body[k];
          if (MHY.isObj(v)) return;
          if (v === null || v === undefined || v === '') return;
          scalars.push([k, MHY.coerceNum(MHY.toText(v))]);
        });
      }
      if (scalars.length) {
        tableSeq++;
        tables.push({ name: label + ' #' + tableSeq, header: ['字段', '值'], rows: scalars });
        sources.push({ via: '接口', name: label, url: cap.url, count: scalars.length, time: cap.time });
      }
    });

    // 页面表格
    collectTables().forEach(function (t) {
      tables.push(t);
      sources.push({ via: '页面DOM', name: t.name, url: '', count: t.rows.length, time: '' });
    });

    // ---- 概览字段 ----
    function pick() {
      for (var i = 0; i < arguments.length; i++) {
        var m = idx[arguments[i]];
        if (m && m.value) return m;
      }
      return null;
    }
    var heatM = pick('奇域热度', '热度');
    var avgM = pick('平均游玩时长', '人均游玩时长');
    var newHeatM = pick('7日新增量', '30日新增量', '新增量');
    var statusM = pick('状态');
    var pubM = pick('发布时间');
    var nameM = pick('奇域名称', '名称');

    var overview = {};
    if (heatM) overview.heat = heatM.value;
    if (newHeatM) overview.newHeat = newHeatM.value;
    if (avgM) overview.avgDuration = avgM.number != null ? { seconds: avgM.number, text: avgM.duration || avgM.value } : avgM.value;
    if (statusM) overview.status = statusM.value;
    if (pubM) overview.publishTime = pubM.time || pubM.value;
    if (nameM) overview.name = nameM.value;
    if (stageId) overview.stageId = stageId;
    tables.forEach(function (t) {
      if (t.name !== '奇域信息') return;
      t.rows.forEach(function (r) {
        if (/奇域名称|名称/.test(r[0]) && !overview.name) overview.name = r[1];
        if (/状态/.test(r[0]) && !overview.status) overview.status = r[1];
        if (/发布时间/.test(r[0]) && !overview.publishTime) overview.publishTime = MHY.fmtDateTime(r[1]);
      });
    });

    var overviewLabels = {};
    [heatM, avgM, statusM, pubM, nameM].forEach(function (m) {
      if (m) overviewLabels[m.key] = { label: m.label, value: m.value };
    });

    var diagnostics = {
      kvPairs: pairs.map(function (p) {
        return { key: p.key, rawKey: p.rawKey, value: p.value };
      }),
      numberGroups: groups.map(function (g) { return { text: g.text, values: g.values }; }),
      chartSource: chartSource,
      canvasCount: document.querySelectorAll('canvas').length,
      metricCount: metrics.length,
      tableCount: tables.length,
      capturedCount: captured.length,
      hasEcharts: !!root.echarts,
      stageIdFromUrl: stageId,
      apiNames: captured.map(function (c) { return c.name; })
    };

    return {
      ok: true,
      url: url,
      pageTitle: title,
      stageId: stageId,
      exportedAt: Date.now(),
      overview: overview,
      overviewLabels: overviewLabels,
      metrics: metrics.map(function (m) {
        return { key: m.key, label: m.label, value: m.value, number: m.number, unit: m.unit, delta: m.delta };
      }),
      charts: charts,
      tables: tables,
      sources: sources,
      captured: captured.map(function (c) {
        return { name: c.name, url: c.url, time: c.time, size: c.size, body: c.body };
      }),
      diagnostics: diagnostics
    };
  }

  root.MHYCollect = { collect: collect, collectPairs: collectPairs, getCharts: getCharts, collectTables: collectTables };

  if (typeof module === 'object' && module.exports) module.exports = root.MHYCollect;
})(typeof globalThis !== 'undefined' ? globalThis : this);
