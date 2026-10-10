/* =============================================================
 * 极简 DOM 桩：让 collect.js 能在 Node 里被真实执行
 * 支持的选择器子集：tag / .class / #id / [attr] / [attr=value] / 后代组合 / 逗号
 * ============================================================= */
'use strict';

class ClassList {
  constructor(el) { this.el = el; }
  get list() { return (this.el._cls || '').split(/\s+/).filter(Boolean); }
  add(c) { const l = this.list; if (!l.includes(c)) l.push(c); this.el._cls = l.join(' '); }
  remove(c) { this.el._cls = this.list.filter((x) => x !== c).join(' '); }
  contains(c) { return this.list.includes(c); }
  toggle(c, force) { const has = this.contains(c); const want = force === undefined ? !has : !!force; if (want) this.add(c); else this.remove(c); }
}

/** 真实文本节点（用于模拟浏览器 childNodes 里的 #text） */
class TextNode {
  constructor(text) { this.nodeType = 3; this.nodeValue = String(text); this.parentElement = null; }
  get textContent() { return this.nodeValue; }
  set textContent(v) { this.nodeValue = String(v); }
}

class Element {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.nodeType = 1;
    this.childNodes = [];
    this.attributes = {};
    this.style = {};
    this._cls = '';
    this.classList = new ClassList(this);
    this._listeners = {};
  }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get className() { return this._cls; }
  set className(v) { this._cls = String(v); }
  get id() { return this.attributes.id || ''; }
  get textContent() {
    let s = '';
    for (const n of this.childNodes) s += (n.nodeType === 3 ? n.nodeValue : n.textContent);
    return s;
  }
  set textContent(v) {
    this.childNodes = [];
    if (v !== undefined && v !== null && String(v) !== '') {
      const t = new TextNode(v);
      t.parentElement = this;
      this.childNodes.push(t);
    }
  }
  setAttribute(k, v) {
    this.attributes[k] = String(v);
    if (k === 'class') this._cls = String(v);
  }
  getAttribute(k) { return this.attributes[k] === undefined ? null : this.attributes[k]; }
  hasAttribute(k) { return k in this.attributes; }
  appendChild(c) {
    if (c.parentElement && c.parentElement !== this) c.parentElement.removeChild(c);
    c.parentElement = this;
    this.childNodes.push(c);
    return c;
  }
  removeChild(c) {
    const i = this.childNodes.indexOf(c);
    if (i >= 0) this.childNodes.splice(i, 1);
    c.parentElement = null;
  }
  remove() { if (this.parentElement) this.parentElement.removeChild(this); }
  addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }
  removeEventListener() {}
  dispatch(t, ev) { (this._listeners[t] || []).forEach((fn) => fn(ev || {})); }
  getBoundingClientRect() { return { x: 0, y: 0, width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20 }; }
  closest(sel) {
    let n = this;
    while (n) { if (n.matches && n.matches(sel)) return n; n = n.parentElement; }
    return null;
  }
  contains(el) {
    let n = el;
    while (n) { if (n === this) return true; n = n.parentElement; }
    return false;
  }
  attachShadow() {
    this.shadowRoot = new Element('shadow-root');
    this.shadowRoot.mode = 'open';
    return this.shadowRoot;
  }
  querySelectorAll(sel) { return queryAll(this, sel); }
  querySelector(sel) { const r = this.querySelectorAll(sel); return r[0] || null; }

  matches(sel) {
    sel = sel.trim();
    if (sel.endsWith('*')) sel = sel.slice(0, -1).trim();
    return sel.split(',').map((s) => s.trim()).filter(Boolean).some((part) => {
      const steps = part.split(/\s+/).filter(Boolean);
      const last = steps[steps.length - 1];
      if (!matchSimple(this, last)) return false;
      let node = this.parentElement;
      for (let i = steps.length - 2; i >= 0; i--) {
        let found = false;
        while (node) {
          if (matchSimple(node, steps[i])) { found = true; node = node.parentElement; break; }
          node = node.parentElement;
        }
        if (!found) return false;
      }
      return true;
    });
  }
}

function matchSimple(el, sel) {
  sel = sel.trim();
  if (!sel || sel === '*') return true;
  const attrRe = /\[([^\]=]+)(?:=("?)([^"\]]*)\2)?\]/g;
  let m;
  while ((m = attrRe.exec(sel)) !== null) {
    const name = m[1];
    if (!el.hasAttribute(name)) return false;
    if (m[3] !== undefined && el.getAttribute(name) !== m[3]) return false;
  }
  sel = sel.replace(attrRe, '');
  const idMatch = sel.match(/#([\w-]+)/);
  if (idMatch && el.id !== idMatch[1]) return false;
  const clsMatches = sel.match(/\.([\w-]+)/g) || [];
  for (const c of clsMatches) if (!el.classList.contains(c.slice(1))) return false;
  const tag = sel.replace(/[.#][\w-]+/g, '').trim();
  if (tag === '*') return true;
  if (tag && el.tagName !== tag.toUpperCase()) return false;
  return true;
}

function walk(el, out) {
  for (const c of el.children) { out.push(c); walk(c, out); }
}

function queryAll(rootEl, sel) {
  const all = [];
  walk(rootEl, all);
  const parts = sel.split(',').map((s) => s.trim()).filter(Boolean);
  const res = [];
  for (const el of all) {
    if (parts.some((p) => el.matches(p))) res.push(el);
  }
  return res;
}

/* ---------------- 构建页面 ---------------- */

function build(spec, doc) {
  if (typeof spec === 'string') { const e = new Element('span'); e.textContent = spec; return e; }
  const el = new Element(spec.tag || 'div');
  if (spec.cls) el.className = spec.cls;
  if (spec.attrs) Object.keys(spec.attrs).forEach((k) => el.setAttribute(k, spec.attrs[k]));
  if (spec.text !== undefined) el.textContent = spec.text;
  (spec.children || []).forEach((c) => el.appendChild(build(c, doc)));
  return el;
}

/**
 * 模拟截图里的奇域详情页
 * @param {Object} opts { echarts: 是否提供 echarts 实例 }
 */
function createDocument(opts) {
  opts = opts || {};
  const doc = {
    title: '奇匠中心',
    readyState: 'complete',
    _listeners: {},
    documentElement: new Element('html'),
    body: new Element('body'),
    createElement: (t) => new Element(t),
    addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
    removeEventListener() {},
    getElementById: () => null,
    dispatch(t, ev) { (this._listeners[t] || []).forEach((fn) => fn(ev || {})); }
  };
  doc.documentElement.appendChild(doc.body);
  doc.querySelectorAll = (sel) => queryAll(doc.documentElement, sel);
  doc.querySelector = (sel) => doc.querySelectorAll(sel)[0] || null;

  const canvasCount = opts.echarts === false ? 0 : 2;
  if (opts.instanceKeys && opts.instanceKeys.length) {
    doc._instanceKeys = opts.instanceKeys;
  }

  const page = build({
    tag: 'div', cls: 'page', children: [
      { tag: 'div', cls: 'side', children: [{ tag: 'a', text: '首页' }, { tag: 'a', text: '数据中心' }] },
      { tag: 'div', cls: 'main', children: [
        // 顶部信息卡（表格形态）
        { tag: 'table', cls: 'info-table', children: [
          { tag: 'tr', children: [
            { tag: 'td', children: [{ tag: 'img', attrs: { src: 'x.png' } }, { tag: 'div', text: '尘世执政录' }] },
            { tag: 'td', text: '奇域ID 54461776301' },
            { tag: 'td', text: '状态 上线中' },
            { tag: 'td', text: '发布时间 2026/09/27 19:02 (UTC+8)' }
          ] }
        ] },
        // 指标卡（两种常见 DOM 结构都放进去）
        { tag: 'div', cls: 'card', children: [
          { tag: 'div', cls: 'label', text: '奇域热度' },
          { tag: 'div', cls: 'value', text: '505' },
          { tag: 'div', cls: 'delta', text: '较昨日 ↑1' }
        ] },
        { tag: 'div', cls: 'card', children: [
          { tag: 'div', cls: 'label', text: '平均游玩时长' },
          { tag: 'div', cls: 'vwrap', children: [
            { tag: 'span', cls: 'value', text: '5分23秒' },
            { tag: 'span', cls: 'delta', text: '较昨日 -' }
          ] }
        ] },
        // 图表标题 + 内嵌问号说明（真实页面形态："7日新增量 ⓘ"）
        { tag: 'div', cls: 'chart-head', children: [
          { tag: 'div', cls: 'chart-title', children: [
            { tag: 'span', text: '7日新增量' },
            { tag: 'span', cls: 'help', text: '?' },
            { tag: 'span', cls: 'num', text: '117' }
          ] }
        ] },
        // 图表容器
        { tag: 'div', cls: 'chart', children: [canvas0(canvasCount)] },
        { tag: 'div', cls: 'chart', children: [canvas1(canvasCount)] }
      ] }
    ]
  }, doc);
  doc.body.appendChild(page);
  if (opts.instanceKeys && opts.instanceKeys.length) {
    const hosts2 = doc.querySelectorAll('.echarts-host');
    hosts2.forEach((h, i) => {
      if (opts.instanceKeys[i]) h.setAttribute('_echarts_instance_', opts.instanceKeys[i]);
    });
  }
  return doc;
}

function canvas0(show) {
  const d = { tag: 'div', cls: 'echarts-host', children: [] };
  if (show) d.children.push({ tag: 'canvas', attrs: { 'data-idx': '0' } });
  return d;
}
function canvas1(show) {
  const d = { tag: 'div', cls: 'echarts-host', children: [] };
  if (show) d.children.push({ tag: 'canvas', attrs: { 'data-idx': '1' } });
  return d;
}

/** 假 ECharts 实例 */
function createEcharts(canvases) {
  const instances = new Map();
  canvases.forEach((host, i) => {
    instances.set(host, i === 0 ? heatInstance() : durInstance());
  });
  return {
    _instances: instances,
    getInstanceByDom(el) { return instances.get(el) || null; }
  };
}

function heatInstance() {
  const dates = [];
  const d = new Date('2026-09-10T00:00:00');
  for (let i = 0; i < 30; i++) {
    const t = new Date(d.getTime() + i * 86400000);
    dates.push(t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'));
  }
  const values = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 12, 118, 246, 331, 398, 452, 489, 508, 508, 508, 505, 505, 505];
  return {
    getOption: () => ({
      legend: [{ data: ['奇域热度'] }],
      xAxis: [{ type: 'category', data: dates }],
      yAxis: [{ type: 'value', axisLabel: { formatter: '{value}' } }],
      series: [{ name: '奇域热度', type: 'line', data: values }]
    }),
    getData: () => dates.map((d, i) => [d, values[i]])
  };
}

function durInstance() {
  const dates = [];
  const d = new Date('2026-09-10T00:00:00');
  for (let i = 0; i < 30; i++) {
    const t = new Date(d.getTime() + i * 86400000);
    dates.push(t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'));
  }
  const values = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 12, 180, 796, 301, 205, 223, 208, 205, 201, 203, 199, 198, 200];
  return {
    getOption: () => ({
      legend: [{ data: ['平均游玩时长'] }],
      xAxis: [{ type: 'category', data: dates }],
      yAxis: [{ type: 'value', name: '时长', axisLabel: { formatter: (v) => (v >= 60 ? (v / 60).toFixed(0) + '分钟' : v + '秒') } }],
      series: [{ name: '平均游玩时长', type: 'line', data: values }]
    }),
    getData: () => dates.map((d, i) => [d, values[i]])
  };
}

module.exports = { Element, createDocument, createEcharts, queryAll };
