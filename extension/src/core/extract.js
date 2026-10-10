/* =============================================================
 * Miliastra Atlas — 官方接口数据 -> 工作表（结构化提取）
 *
 * 数据来源（只读，页面自己会请求）：
 *   关卡详情  GET  .../data/get_stage_detail?stage_id=xxx    -> today_stats / trend_data / comment_module_info / stage_info
 *   奇匠数据  GET  .../data/get_user_info                    -> today_stats / trend_data
 *   关卡列表  GET  .../data/get_stage_list
 *
 * 设计原则：
 *   1. 以官方接口为准，字段名/单位/中文名全部显式映射，不把原始字段名丢给用户
 *   2. 不导出 cur_invalid / value_type 这类技术字段；无效数据点标注但不混入有效统计
 *   3. 每类指标一张工作表，列名可直接看懂，数值可直接排序/画图
 * ============================================================= */
(function (root, factory) {
  var api = factory(root.MHYData || (typeof require === 'object' ? require('./data.js') : null));
  root.MHYExtract = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (MHY) {
  'use strict';

  /** value_type -> 展示方式 */
  var VALUE_TYPES = {
    METRIC_VALUE_TYPE_NORMAL: { kind: 'number', unit: '' },
    // SCORE 是「按 100 归一」的存储值：10000 -> 100.0
    METRIC_VALUE_TYPE_SCORE: { kind: 'score100', unit: '' },
    METRIC_VALUE_TYPE_SECOND: { kind: 'seconds', unit: '秒' },
    // 以「万分之一」存储的比率：6250 -> 62.5%
    METRIC_VALUE_TYPE_PER_TEN_THOUSAND: { kind: 'per_ten_thousand', unit: '%' }
  };

  /** 关卡级指标：metric_type -> 展示定义 */
  var STAGE_METRICS = {
    METRIC_STAGE_TYPE_STAGE_HOT_SCORE: { name: '奇域热度', sheet: '奇域热度', rank: 0 },
    METRIC_STAGE_TYPE_AVG_TIME: { name: '平均游玩时长', sheet: '平均游玩时长', rank: 1, seconds: true },
    METRIC_STAGE_TYPE_GOOD_RATE: { name: '平均推荐率', sheet: '平均推荐率', rank: 2 },
    METRIC_STAGE_TYPE_REVIEW_TOTAL: { name: '评论数', sheet: '评论数', rank: 3 },
    METRIC_STAGE_TYPE_COVER_CLICK_RATE: { name: '封面点击率', sheet: '封面点击率', rank: 4 },
    METRIC_STAGE_TYPE_ACTIVE_SCORE: { name: '活跃指数', sheet: '活跃指数', rank: 5 },
    METRIC_STAGE_TYPE_LAST_VERSION_ACTIVE_SCORE: { name: '上版本活跃指数', sheet: '上版本活跃指数', rank: 6 }
  };

  /** 用户级指标 */
  var USER_METRICS = {
    METRIC_USER_TYPE_STAGE_HOT_SCORE_TOTAL: { name: '奇域总热度', sheet: '奇域总热度', rank: 0 },
    METRIC_USER_TYPE_STAGE_TOTAL_HOT_RANK: { name: '热度排名', sheet: '热度排名', rank: 1, rankText: true },
    METRIC_USER_TYPE_AVG_STAGE_GOOD_RATE: { name: '平均推荐率', sheet: '平均推荐率', rank: 2 },
    METRIC_USER_TYPE_PLAY_SCALE_CUMULATIVE: { name: '游玩指数', sheet: '游玩指数', rank: 3 },
    METRIC_USER_TYPE_STAGE_TOTAL: { name: '奇域总数', sheet: '奇域总数', rank: 4 },
    METRIC_USER_TYPE_SUBSCRIBER_NUM: { name: '订阅人数', sheet: '订阅人数趋势', rank: 5 }
  };

  var GROUPS = {
    STAGE_METRIC_GROUP_TYPE_PLAY: '游玩数据',
    STAGE_METRIC_GROUP_TYPE_ACTIVE: '活跃指数',
    STAGE_METRIC_GROUP_TYPE_INTERACTION: '互动数据'
  };

  var STATUS_LABELS = {
    GAME_LIST_STATUS_ONLINE: '上线中',
    GAME_LIST_STATUS_OFFLINE: '已下架',
    GAME_LIST_STATUS_AUDITING: '审核中',
    GAME_LIST_STATUS_BANNED: '已封禁'
  };

  /** 单局时长分组的范围文案（group_configs 里是数字区间，这里给出可读标签） */
  function rangeLabel(min, max) {
    var a = Number(min), b = Number(max);
    if (!isFinite(a)) a = 0;
    if (b === -1 || !isFinite(b)) return '>' + a + '分钟';
    if (a === 0) return '≤' + b + '分钟';
    return a + '-' + b + '分钟';
  }

  function metricDef(type, scope) {
    var table = scope === 'user' ? USER_METRICS : STAGE_METRICS;
    return table[type] || { name: type, sheet: type, rank: 99 };
  }

  function valueTypeDef(valueType) {
    return VALUE_TYPES[valueType] || { kind: 'number', unit: '' };
  }

  /**
   * 把存储值按 value_type 转成「数值 + 展示文本」
   * @param {string} raw 存储原值
   * @param {string} valueType
   * @param {Object} [def] 指标定义（rankText 时按名次展示）
   */
  function convertValue(raw, valueType, def) {
    var vt = valueTypeDef(valueType);
    var n = MHY.parseCompactNumber(raw);
    if (n === null) return { num: null, text: MHY.toText(raw), unit: vt.unit };
    if (def && def.rankText) {
      // 热度排名存储为万分位：300 -> 3%
      var pctRank = Math.round(n / 100 * 1000) / 1000;
      return { num: pctRank, text: '前 ' + trimZero(pctRank) + '%', unit: '%' };
    }
    if (vt.kind === 'seconds') {
      var sec = Math.round(n);
      return { num: sec, text: MHY.humanSeconds(sec), unit: '秒' };
    }
    if (vt.kind === 'per_ten_thousand') {
      // 存储值以「万分之一」为单位：6250 -> 62.5%
      var pct = Math.round(n / 100 * 1000) / 1000;
      return { num: pct, text: trimZero(pct) + '%', unit: '%' };
    }
    if (vt.kind === 'score100') {
      var score = Math.round(n / 100 * 100) / 100;
      return { num: score, text: trimZero(score), unit: '' };
    }
    return { num: n, text: MHY.toText(raw), unit: vt.unit };
  }

  /** 变化的数值口径与指标一致（例如推荐率的变化也按 % 解释） */
  function convertDelta(raw, valueType, def) {
    return convertValue(raw, valueType, def).num;
  }

  function trimZero(n) {
    return String(Math.round(n * 1000) / 1000);
  }

  /* ---------------- 关卡详情 ---------------- */

  function extractStageDetail(payload) {
    var data = payload && payload.data;
    if (!data || !data.stage_info) return null;
    var info = data.stage_info;
    var out = {
      scope: 'stage',
      stageId: MHY.toText(info.stage_id),
      name: MHY.toText(info.stage_name),
      status: STATUS_LABELS[info.game_list_status] || MHY.toText(info.game_list_status),
      publishTime: info.latest_online_time ? MHY.fmtDateTime(info.latest_online_time) : '',
      region: MHY.toText(info.region),
      uid: MHY.toText(info.uid),
      coverUrl: MHY.toText(info.cover_url),
      todayStr: MHY.toText(data.today_str),
      today: [],
      series: [],
      metrics: []
    };

    // 今日指标 + 指标分组
    var groupOf = Object.create(null);
    (data.metric_groups || []).forEach(function (g) {
      (g.metric_types || []).forEach(function (mt) { groupOf[mt] = GROUPS[g.group_type] || g.group_type; });
    });

    (data.today_stats || []).forEach(function (s) {
      var def = metricDef(s.metric_type, 'stage');
      var conv = convertValue(s.cur, s.value_type, def);
      out.today.push({
        type: s.metric_type,
        name: def.name,
        group: groupOf[s.metric_type] || '',
        raw: MHY.toText(s.cur),
        num: conv.num,
        text: conv.text,
        unit: conv.unit,
        delta: s.delta_invalid ? '' : convertDelta(s.delta, s.value_type, def),
        invalid: !!s.cur_invalid,
        deltaInvalid: !!s.delta_invalid,
        valueType: s.value_type
      });
    });

    // 趋势
    (data.trend_data || []).forEach(function (t) {
      var def = metricDef(t.metric_type, 'stage');
      out.series.push(buildSeries(t, def, 'stage'));
    });

    // 有效指标汇总（去掉无效的）
    out.metrics = out.today.filter(function (m) { return !m.invalid; });
    return out;
  }

  /* ---------------- 奇匠（创作者）数据 ---------------- */

  function extractUserData(payload) {
    var data = payload && payload.data;
    if (!data || !data.today_stats) return null;
    var out = {
      scope: 'user',
      todayStr: MHY.toText(data.today_str),
      today: [],
      series: [],
      metrics: [],
      subscribeGears: (data.subscribe_gear_config || []).map(function (g) { return { gear: g.gear, threshold: g.threshold }; }),
      subscribeName: ''
    };
    (data.today_stats || []).forEach(function (s) {
      var def = metricDef(s.metric_type, 'user');
      var conv = convertValue(s.cur, s.value_type, def);
      out.today.push({
        type: s.metric_type,
        name: def.name,
        raw: MHY.toText(s.cur),
        num: conv.num,
        text: conv.text,
        unit: conv.unit,
        delta: s.delta_invalid ? '' : convertDelta(s.delta, s.value_type, def),
        invalid: !!s.cur_invalid,
        deltaInvalid: !!s.delta_invalid,
        valueType: s.value_type
      });
    });
    (data.trend_data || []).forEach(function (t) {
      var def = metricDef(t.metric_type, 'user');
      out.series.push(buildSeries(t, def, 'user'));
    });
    out.metrics = out.today.filter(function (m) { return !m.invalid; });
    var sub = out.today.filter(function (m) { return /SUBSCRIBER/.test(m.type); })[0];
    if (sub) out.subscribeName = sub.name + '(' + sub.raw + ')';
    return out;
  }

  /* ---------------- 趋势序列 ---------------- */

  function buildSeries(t, def, scope) {
    var daily = (t.daily_stats && t.daily_stats.length) ? t.daily_stats : null;
    var dates = (t.daily_info && t.daily_info.length && !daily) ? null : null;
    var points = [];

    if (daily) {
      daily.forEach(function (d) {
        var conv = convertValue(d.cur, d.value_type || t.value_type);
        points.push({
          date: MHY.toText(d.date),
          num: conv.num,
          text: conv.text,
          unit: conv.unit,
          delta: MHY.toText(d.delta),
          invalid: !!d.cur_invalid
        });
      });
    } else if ((t.daily_info || []).length && (t.daily_dates || []).length) {
      t.daily_info.forEach(function (v, i) {
        var conv = convertValue(v, t.value_type);
        points.push({ date: MHY.toText(t.daily_dates[i]), num: conv.num, text: conv.text, unit: conv.unit, invalid: false });
      });
    }

    var valid = points.filter(function (p) { return !p.invalid; });

    // 趋势首段全是 0 说明该指标那时还没数据，去掉这些空行，表格更干净
    var start = 0;
    while (start < points.length - 1 && (points[start].invalid || points[start].num === 0)) start++;
    var trimmed = points.slice(start);

    // 7/30 日变化：优先用接口字段，缺失时按有效数据点计算（口径与指标一致）
    function deltaFor(rawValue, invalidFlag, span) {
      if (!invalidFlag && rawValue !== '' && rawValue !== undefined && rawValue !== null) {
        var num = convertDelta(rawValue, t.value_type, def);
        if (num !== null) return { value: num, invalid: false, computed: false };
      }
      var window = valid.slice(-span);
      if (window.length >= 2 && window[0].num !== null && window[window.length - 1].num !== null) {
        var d = Math.round((window[window.length - 1].num - window[0].num) * 1000) / 1000;
        return { value: d, invalid: false, computed: true };
      }
      return { value: '', invalid: true, computed: false };
    }

    return {
      type: t.metric_type,
      scope: scope,
      name: def.name,
      sheet: def.sheet,
      rank: def.rank,
      def: def,
      unit: valueTypeDef(t.value_type).kind === 'per_ten_thousand' ? '%' : (valueTypeDef(t.value_type).unit || ''),
      seconds: valueTypeDef(t.value_type).kind === 'seconds',
      valueType: t.value_type,
      delta7: deltaFor(t.delta_7_day, t.delta_7_day_invalid, 7),
      delta30: deltaFor(t.delta_30_day, t.delta_30_day_invalid, 30),
      points: trimmed,
      allPoints: points,
      validPoints: valid,
      invalidCount: trimmed.length - trimmed.filter(function (p) { return !p.invalid; }).length,
      groups: buildGroups(t.multi_group_dist)
    };
  }

  /** 单局游玩时长分布：多分组 -> 每组每天各区间占比 */
  function buildGroups(dist) {
    if (!dist || !dist.group_data) return [];
    var configs = dist.group_configs || [];
    var out = [];
    Object.keys(dist.group_data).forEach(function (gi) {
      var items = (dist.group_data[gi].daily_items || []);
      if (!items.length) return;
      var cfg = configs.filter(function (c) { return String(c.group_index) === String(gi); })[0];
      var ranges = (cfg && cfg.ranges) || (items[0].buckets || []).map(function (b) { return { min: b.min, max: b.max }; });
      var labels = ranges.map(function (r) { return rangeLabel(r.min, r.max); });
      out.push({
        groupIndex: gi,
        name: cfg && cfg.name_mi18n_key ? cfg.name_mi18n_key : ('分组' + gi),
        labels: labels,
        rows: items.map(function (it) {
          var row = { date: MHY.toText(it.date), counts: [], percents: [] };
          (it.buckets || []).forEach(function (b) {
            row.counts.push(MHY.parseCompactNumber(b.count));
            var p = Number(b.percent);
            row.percents.push(isFinite(p) ? Math.round(p / 100 * 1000) / 1000 : '');
          });
          return row;
        })
      });
    });
    return out;
  }

  /* ---------------- 评论 ---------------- */

  function extractComments(payload) {
    var data = payload && payload.data;
    if (!data || !data.comment_module_info) return null;
    var list = data.comment_module_info.comment_list || [];
    var rows = list.map(function (c) {
      return [
        MHY.toText(c.nickname),
        MHY.toText(c.uid),
        c.comment_unix ? MHY.fmtDateTime(c.comment_unix) : '',
        c.is_recommend === true ? '推荐' : (c.is_recommend === false ? '不推荐' : ''),
        MHY.toText(c.content).replace(/\s+/g, ' '),
        MHY.parseCompactNumber(c.like_num) == null ? '' : MHY.parseCompactNumber(c.like_num),
        MHY.parseCompactNumber(c.reply_num) == null ? '' : MHY.parseCompactNumber(c.reply_num),
        c.floor === undefined ? '' : c.floor
      ];
    });
    return {
      total: MHY.parseCompactNumber(data.comment_module_info.total_comment_num),
      header: ['用户', 'UID', '评论时间', '推荐态度', '评论内容', '点赞数', '回复数', '楼层'],
      rows: rows
    };
  }

  /* ---------------- 关卡列表 ---------------- */

  function extractStageList(payload) {
    var data = payload && (payload.data || payload);
    if (!data) return null;
    var arr = data.stage_list || data.list || data.stage_infos || null;
    if (!Array.isArray(arr)) arr = MHY.findBestArray(data, { minLen: 1 });
    if (!Array.isArray(arr) || !arr.length) return null;
    var header = ['奇域名称', '奇域ID', '状态', '奇域热度', '推荐率', '平均游玩时长(秒)', '平均游玩时长', '发布时间'];
    var rows = arr.map(function (s) {
      var info = s.base_info || s.stage_info || s;
      var stats = s.today_stats || [];
      function stat(re) {
        var hit = stats.filter(function (x) { return re.test(x.metric_type || ''); })[0];
        if (!hit) return { raw: '', num: null, text: '' };
        return { raw: MHY.toText(hit.cur), num: convertValue(hit.cur, hit.value_type).num, text: convertValue(hit.cur, hit.value_type).text };
      }
      var hot = stat(/STAGE_HOT_SCORE$/);
      var good = stat(/GOOD_RATE$/);
      var avg = stat(/AVG_TIME$/);
      return [
        MHY.toText(info.stage_name),
        MHY.toText(info.stage_id),
        STATUS_LABELS[info.game_list_status] || MHY.toText(info.game_list_status),
        hot.num == null ? hot.raw : hot.num,
        good.num == null ? '' : good.num,
        avg.num == null ? '' : avg.num,
        avg.text,
        info.latest_online_time ? MHY.fmtDateTime(info.latest_online_time) : ''
      ];
    });
    return { header: header, rows: rows };
  }

  /* ---------------- 组装工作表 ---------------- */

  function overviewSheet(stage, user) {
    var rows = [['项目', '值']];
    function add(k, v) {
      v = MHY.toText(v);
      if (v !== '') rows.push([k, MHY.coerceNum(v)]);
    }
    if (stage) {
      add('奇域名称', stage.name);
      add('奇域ID', stage.stageId);
      add('状态', stage.status);
      add('发布时间', stage.publishTime);
      stage.metrics.forEach(function (m) {
        if (/平均游玩时长/.test(m.name)) {
          add(m.name, m.text);
          add(m.name + '(秒)', m.num);
        } else {
          add(m.name, m.text);
        }
      });
      add('数据日期', stage.todayStr);
    }
    if (user) {
      user.metrics.forEach(function (m) {
        // 比率类指标已按 % 归一，直接给数值，便于排序与画图
        if (m.unit === '%') add('创作者·' + m.name, m.num == null ? m.text : m.num);
        else add('创作者·' + m.name, m.text);
      });
      if (!stage) add('数据日期', user.todayStr);
    }
    add('导出时间', MHY.fmtDateTime(Date.now()));
    return { name: '数据概况', header: null, rows: rows };
  }

  /**
   * 按导出区间裁剪趋势数据。
   * @param {Object} series buildSeries 结果
   * @param {number} range 7 / 30 / 0(全部)
   */
  function sliceSeries(series, range) {
    if (!range || range <= 0) return series;
    var points = series.allPoints.slice(-range);
    var valid = points.filter(function (p) { return !p.invalid && p.num !== null; });
    // 区间变化量：优先用官方字段；官方没给（invalid）时按该区间首尾有效值计算
    function windowDelta(official) {
      if (official && !official.invalid && official.value !== '' && official.value !== undefined && official.value !== null) {
        return official;
      }
      if (valid.length < 2) return { value: '', invalid: true, computed: false };
      var d = Math.round((valid[valid.length - 1].num - valid[0].num) * 1000) / 1000;
      return { value: d, invalid: false, computed: true };
    }
    return Object.assign({}, series, {
      points: points,
      invalidCount: points.length - points.filter(function (p) { return !p.invalid; }).length,
      delta7: range === 7 ? windowDelta(series.delta7) : series.delta7,
      delta30: range === 30 ? windowDelta(series.delta30) : series.delta30,
      range: range
    });
  }

  /** 指标汇总：一行一个指标，含今日值/区间变化/数据有效性 */
  function summarySheet(scopeName, metrics, series, range) {
    var byType = Object.create(null);
    (series || []).forEach(function (s) { byType[s.type] = s; });
    var changeHeader = range ? ('近' + range + '日变化') : '区间变化';
    var rows = [];
    (metrics || []).forEach(function (m) {
      if (m.invalid) return;
      var s = byType[m.type];
      function cell(d) {
        if (!d || d.invalid) return '';
        return MHY.coerceNum(String(d.value));
      }
      var pick = range === 7 ? (s && s.delta7) : (s && s.delta30);
      rows.push([
        m.name,
        m.num == null ? m.text : m.num,
        m.unit,
        m.delta === '' || m.delta === undefined ? '' : MHY.coerceNum(String(m.delta)),
        cell(pick),
        (pick && pick.computed) ? '按每日数据计算' : '官方接口'
      ]);
    });
    if (!rows.length) return null;
    return {
      name: scopeName + '指标汇总',
      header: ['指标名称', '当日数值', '单位', '较昨日变化', changeHeader, '变化值来源'],
      rows: rows
    };
  }
  /** 页面指标一览：把「游玩数据 / 互动数据 / 活跃指数」等小表合并，避免一张表只放一两行 */
  function pageMetricsSheet(stage) {
    var rows = [];
    (stage.today || []).forEach(function (m) {
      if (m.invalid) return;
      rows.push([
        m.group || '其它',
        m.name,
        m.text,
        m.num === null || m.num === undefined ? '' : m.num,
        m.unit,
        m.delta === '' || m.delta === undefined ? '' : MHY.coerceNum(String(m.delta))
      ]);
    });
    if (!rows.length) return null;
    return {
      name: '页面指标一览',
      header: ['页面分组', '指标', '页面显示值', '数值', '单位', '较昨日变化'],
      rows: rows
    };
  }

  /** 数据说明：口径、有效期、异常，避免用户看不懂数字怎么来的 */
  function notesSheet(stage, user, range, mode, group) {
    var rows = [['说明项', '内容']];
    function add(k, v) { rows.push([k, MHY.toText(v)]); }
    add('数据来源', '米游社千星奇域创作者中心官方数据接口（与页面显示一致）');
    add('数据日期', (stage && stage.todayStr) || (user && user.todayStr) || '');
    add('更新频率', '每天 6:00 更新昨日数据');
    add('导出区间', range ? ('近 ' + range + ' 日（可在面板切换近7日 / 近30日 / 全部）') : '接口返回的全部天数（近 30 天）');
    add('导出模式', mode === 'sheet'
      ? '单表：所有指标按「日期」合并成一张大表，同一天的各指标在同一行，便于筛选 / 透视 / 画图'
      : '分表：按主题拆成多张工作表，便于逐项查看');
    if (mode === 'sheet') {
      var groupNames = { '0': '常规区间（≤1/1-3/3-5/5-7/>7 分钟）', '1': '长区间（≤3/3-6/6-9/9-12/>12 分钟）', '2': '超长区间（≤6/6-13/13-19/19-26/>26 分钟）' };
      add('时长分布区间', groupNames[String(group === undefined ? '0' : group)] || '常规区间');
      add('列合并口径', '同名指标跨系列按日期对齐；接口未返回当日有效值的单元格留空');
    }
    if (stage) {
      add('平均值口径', '「平均游玩时长」为当日所有游玩记录的平均值');
      add('比率口径', '「平均推荐率」「封面点击率」以百分比表示，接口原始值已除以 100');
      add('时间口径', '「发布/评论时间」已按 Asia/Shanghai 转换为可读时间');
      var invalid = stage.today.filter(function (m) { return m.invalid; }).map(function (m) { return m.name; });
      add('当日无效指标', invalid.length ? invalid.join('、') + '（接口标记为无有效数据，未导出）' : '无');
      stage.series.forEach(function (s) {
        if (s.invalidCount) add('缺失数据', s.name + '：' + s.invalidCount + ' 天无有效数据（表中留空，未按 0 计算）');
      });
      if (!stage.series.some(function (s) { return s.invalidCount; })) add('缺失数据', '无');
    }
    if (user) add('奇匠数据', '来自创作者维度接口，含奇域总热度/热度排名/平均推荐率/游玩指数/奇域总数/订阅人数');
    add('导出工具', 'Miliastra Atlas v1.1（浏览器扩展）');
    return { name: '数据说明', header: null, rows: rows };
  }

  /** 每个趋势序列一张表：日期 + 数值 + 中文值 + 变化（无效点标注但保留日期顺序） */
  function seriesSheets(series, opts) {
    opts = opts || {};
    return (series || []).filter(function (s) {
      return s.points && s.points.length;
    }).sort(function (a, b) { return a.rank - b.rank; }).reduce(function (list, s) {
      var header = ['日期', s.name + (s.seconds ? '(秒)' : (s.unit ? '(' + s.unit + ')' : ''))];
      if (s.seconds) header.push(s.name + '(可读)');
      var rows = s.points.map(function (p) {
        if (p.invalid) {
          // 无效数据点：留空而不是写 0，避免污染分析
          var r = [p.date, ''];
          if (s.seconds) r.push('');
          return r;
        }
        var r = [p.date, p.num === null ? p.text : p.num];
        if (s.seconds) r.push(p.text);
        return r;
      });
      list.push({ name: s.sheet, header: header, rows: rows, note: s.invalidCount ? ('含 ' + s.invalidCount + ' 个无效数据点（已留空）') : '' });
      return list;
    }, []);
  }

  /** 单局游玩时长分布：把三套区间（常规/长/超长）导出到同一张表，用「区间组」列区分 */
  function distributionSheets(series) {
    var sheets = [];
    var target = null;
    (series || []).forEach(function (s) {
      if (!target && s.groups && s.groups.length) target = s;
    });
    if (!target) return sheets;

    var groupNames = { '0': '常规区间', '1': '长区间', '2': '超长区间' };
    var groups = target.groups.slice().sort(function (a, b) { return Number(a.groupIndex) - Number(b.groupIndex); });

    // 百分比表与人数表共用同一组表头：[区间组, 日期, 各区间列]
    var labels = [];
    groups.forEach(function (g) {
      g.labels.forEach(function (l) { if (labels.indexOf(l) === -1) labels.push(l); });
    });
    var pctHeader = ['区间组', '日期'].concat(labels.map(function (l) { return l + ' 占比(%)'; }));
    var cntHeader = ['区间组', '日期'].concat(labels.map(function (l) { return l + ' 人数'; }));
    var pctRows = [], cntRows = [];

    groups.forEach(function (g) {
      var gname = groupNames[String(g.groupIndex)] || ('区间组' + (Number(g.groupIndex) + 1));
      g.rows.forEach(function (r) {
        var pr = [gname, r.date], cr = [gname, r.date];
        labels.forEach(function (l, li) {
          var inGroup = g.labels.indexOf(l);
          pr.push(inGroup >= 0 ? r.percents[inGroup] : '');
          cr.push(inGroup >= 0 ? r.counts[inGroup] : '');
        });
        pctRows.push(pr);
        cntRows.push(cr);
      });
    });

    if (pctRows.length) sheets.push({ name: '单局游玩时长分布', header: pctHeader, rows: pctRows });
    if (cntRows.length) sheets.push({ name: '单局时长分布_人数', header: cntHeader, rows: cntRows });
    return sheets;
  }

  function commentSheet(comments) {
    if (!comments || !comments.rows.length) return null;
    return { name: '评论内容', header: comments.header, rows: comments.rows };
  }

  /**
   * 单表模式：把所有指标按日期合并成一张大表。
   * 主干用「接口返回的每日序列」（不受页面 7日/30日 图表的显示范围限制），
   * 因此同一天的奇域热度、时长、评论数、点击率、时长分布占比会落在同一行。
   */
  function buildSingleSheet(stage, user, range, groupIndex) {
    var allSeries = [];
    if (stage) allSeries = allSeries.concat(stage.series);
    if (user) allSeries = allSeries.concat(user.series);
    if (!allSeries.length) return null;

    function hasData(arr) {
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] !== '' && arr[i] !== null && arr[i] !== undefined) return true;
      }
      return false;
    }

    // 日期并集（已按所选区间裁剪）
    var dateSet = Object.create(null);
    var dateOrder = [];
    allSeries.forEach(function (s) {
      (s.points || []).forEach(function (p) {
        if (!p.date || dateSet[p.date]) return;
        dateSet[p.date] = true;
        dateOrder.push(p.date);
      });
    });
    dateOrder.sort();

    // 每个序列 -> { 日期: 数值 }
    var byType = Object.create(null);
    allSeries.forEach(function (s) {
      var m = Object.create(null);
      (s.points || []).forEach(function (p) {
        m[p.date] = (p.invalid || p.num === null || p.num === undefined) ? '' : p.num;
      });
      byType[s.type] = { series: s, map: m };
    });

    // 时长分布：按所选「区间组」取占比列
    var distSeries = null;
    allSeries.forEach(function (s) { if (!distSeries && s.groups && s.groups.length) distSeries = s; });
    var distGroup = null;
    if (distSeries) {
      var want = String(groupIndex === undefined || groupIndex === null ? '0' : groupIndex);
      distGroup = distSeries.groups.filter(function (g) { return String(g.groupIndex) === want; })[0] || distSeries.groups[0];
    }
    var distMap = Object.create(null);
    if (distGroup) {
      distGroup.rows.forEach(function (r) { distMap[r.date] = r.percents; });
    }

    var cols = [];
    if (stage) {
      cols.push({ fixed: true, name: '奇域名称', get: function () { return stage.name; } });
    }
    cols.push({ fixed: true, name: '日期', get: function (date) { return date; } });

    function addSeries(type, colName, kind) {
      var hit = byType[type];
      if (!hit || !hit.series.points.length) return;
      cols.push({
        seriesKey: type,
        kind: kind || '',
        name: colName,
        get: function (date) { return hit.map[date]; }
      });
      if (kind === 'seconds') {
        var pts = Object.create(null);
        (hit.series.points || []).forEach(function (p) { pts[p.date] = p.text; });
        cols.push({
          seriesKey: type,
          kind: 'human',
          name: colName + '(可读)',
          get: function (date) {
            var v = hit.map[date];
            if (v === '' || v === undefined) return '';
            return pts[date] || MHY.humanSeconds(v);
          }
        });
      }
    }

    addSeries('METRIC_STAGE_TYPE_STAGE_HOT_SCORE', '奇域热度');
    addSeries('METRIC_STAGE_TYPE_AVG_TIME', '平均游玩时长(秒)', 'seconds');
    addSeries('METRIC_STAGE_TYPE_REVIEW_TOTAL', '评论数');
    addSeries('METRIC_STAGE_TYPE_COVER_CLICK_RATE', '封面点击率(%)');
    addSeries('METRIC_STAGE_TYPE_GOOD_RATE', '平均推荐率(%)');
    addSeries('METRIC_STAGE_TYPE_ACTIVE_SCORE', '活跃指数');
    addSeries('METRIC_STAGE_TYPE_LAST_VERSION_ACTIVE_SCORE', '上版本活跃指数');
    addSeries('METRIC_USER_TYPE_STAGE_HOT_SCORE_TOTAL', '奇域总热度');
    addSeries('METRIC_USER_TYPE_STAGE_TOTAL_HOT_RANK', '热度排名(%)');
    addSeries('METRIC_USER_TYPE_AVG_STAGE_GOOD_RATE', '创作者平均推荐率(%)');
    addSeries('METRIC_USER_TYPE_PLAY_SCALE_CUMULATIVE', '游玩指数');
    addSeries('METRIC_USER_TYPE_STAGE_TOTAL', '奇域总数');
    addSeries('METRIC_USER_TYPE_SUBSCRIBER_NUM', '订阅人数');

    if (distGroup) {
      distGroup.labels.forEach(function (l, li) {
        cols.push({
          kind: 'dist',
          name: l + ' 占比(%)',
          get: function (date) {
            var row = distMap[date];
            if (!row) return '';
            return row[li] === undefined ? '' : row[li];
          }
        });
      });
    }

    var header = cols.map(function (c) { return c.name; });
    var rows = dateOrder.map(function (date) {
      return cols.map(function (c) { return c.get(date); });
    });

    // 去掉整列都没有有效值的列（例如某指标全程无有效数据）
    var keep = [];
    cols.forEach(function (c, ci) {
      if (c.fixed) { keep.push(ci); return; }
      var vals = rows.map(function (r) { return r[ci]; });
      if (hasData(vals)) keep.push(ci);
    });
    var cols2 = keep.map(function (ci) { return cols[ci]; });
    var header2 = keep.map(function (ci) { return header[ci]; });
    var rows2 = rows.map(function (r) { return keep.map(function (ci) { return r[ci]; }); })
      // 去掉除日期/名称外整行都空的行
      .filter(function (r) {
        for (var i = 0; i < r.length; i++) {
          if (cols2[i].fixed) continue;
          if (r[i] !== '' && r[i] !== null && r[i] !== undefined) return true;
        }
        return false;
      });

    if (!rows2.length) return null;
    return { name: stage ? (stage.name + '_数据总表') : '奇匠数据总表', header: header2, rows: rows2 };
  }

  /**
   * 把关卡详情 + 奇匠数据 + 评论组装成工作表
   * @param {Object} input { stagePayload, userPayload, listPayload, range, mode, group }
   *   range: 7 / 30 / 0(全部) —— 时间窗口
   *   mode : 'sheet'(默认，单张大表) | 'multi'（按主题分表）
   *   group: 单表模式下用哪套时长分布区间组（0 常规 / 1 长 / 2 超长）
   * @returns {Array<{name,header,rows}>}
   */
  function buildSheets(input) {
    input = input || {};
    var range = Number(input.range) || 0;
    var mode = input.mode === 'multi' ? 'multi' : 'sheet';
    var group = input.group === undefined || input.group === null ? '0' : String(input.group);
    var stage = extractStageDetail(input.stagePayload);
    var user = extractUserData(input.userPayload);
    var sheets = [];
    var used = Object.create(null);
    function push(s) {
      if (!s || !s.rows || !s.rows.length) return;
      // 只有极少量数据的独立表没有分析价值，合并到汇总表里（不单独占一张表）
      if (s.header && /日期/.test(String(s.header[0]) + String(s.header[1] || '')) && s.rows.length < 3) return;
      var base = MHY.sanitizeSheetName(s.name);
      var name = base, i = 2;
      while (used[name]) { name = (base.slice(0, 28) + '_' + i).slice(0, 31); i++; }
      used[name] = 1;
      s.name = name;
      sheets.push(s);
    }

    if (!stage && !user) return sheets;

    // —— 单表模式：一张大表（+ 数据概况 + 评论内容 + 数据说明）——
    if (mode === 'sheet') {
      // 先把各序列按所选区间裁剪，再合并
      var stageT = stage
        ? Object.assign({}, stage, { series: stage.series.map(function (s) { return sliceSeries(s, range); }) })
        : null;
      var userT = user
        ? Object.assign({}, user, { series: user.series.map(function (s) { return sliceSeries(s, range); }) })
        : null;
      push(overviewSheet(stage, user));
      push(buildSingleSheet(stageT, userT, range, group));
      if (input.stagePayload) push(commentSheet(extractComments(input.stagePayload)));
      push(notesSheet(stage, user, range, 'sheet', group));
      return sheets;
    }

    push(overviewSheet(stage, user));
    if (stage) {
      push({
        name: '关卡基础数据',
        header: ['项目', '内容'],
        rows: [
          ['奇域名称', stage.name],
          ['奇域ID', stage.stageId],
          ['状态', stage.status],
          ['发布时间', stage.publishTime],
          ['所属分区', stage.region],
          ['数据日期', stage.todayStr]
        ]
      });
      // 游玩 / 互动 / 活跃 等页面上分散的小表合并成一张
      push(pageMetricsSheet(stage));

      var series = stage.series.map(function (s) { return sliceSeries(s, range); });
      push(summarySheet('关卡', stage.today, series, range));
      seriesSheets(series).forEach(push);
      distributionSheets(series).forEach(push);
      push(commentSheet(extractComments(input.stagePayload)));
    }

    if (user) {
    var userSeries = user.series.map(function (s) {
      var sl = sliceSeries(s, range);
      // 奇匠维度与关卡维度可能有同名指标（如「平均推荐率」），加后缀区分
      var clash = stage && stage.series.some(function (x) { return x.name === s.name; });
      if (clash) sl = Object.assign({}, sl, { sheet: s.sheet + '(奇匠)' });
      return sl;
    });
      push(summarySheet('奇匠', user.today, userSeries, range));
      seriesSheets(userSeries).forEach(push);
    }

    push(notesSheet(stage, user, range));
    return sheets;
  }

  return {
    extractStageDetail: extractStageDetail,
    extractUserData: extractUserData,
    extractComments: extractComments,
    extractStageList: extractStageList,
    buildSheets: buildSheets,
    buildSingleSheet: buildSingleSheet,
    convertValue: convertValue,
    STAGE_METRICS: STAGE_METRICS,
    USER_METRICS: USER_METRICS,
    VALUE_TYPES: VALUE_TYPES
  };
});
