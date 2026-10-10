/* =============================================================
 * Miliastra Atlas — 零依赖 XLSX 写入器
 * 用 CompressionStream('deflate-raw') + 手写 ZIP 容器生成合法的 .xlsx
 * 不依赖 JSZip / SheetJS，不触发远程代码加载（MV3 要求）。
 * ============================================================= */
(function (root) {
  'use strict';

  var TE = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

  function utf8(str) {
    if (TE) return TE.encode(str);
    // 极简 UTF-8 兜底（仅用于没有 TextEncoder 的环境）
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
  }

  /* ---------- CRC32 ---------- */
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* ---------- 压缩 ---------- */
  function supportsCompression() {
    return typeof CompressionStream === 'function' && typeof Response === 'function' && typeof Blob === 'function';
  }

  /** @returns {Promise<{method:number, data:Uint8Array}>} method: 8=deflate, 0=store */
  async function compressRaw(bytes) {
    if (!supportsCompression()) return { method: 0, data: bytes };
    try {
      var cs = new CompressionStream('deflate-raw');
      var stream = new Blob([bytes]).stream().pipeThrough(cs);
      var buf = await new Response(stream).arrayBuffer();
      var out = new Uint8Array(buf);
      if (out.length >= bytes.length) return { method: 0, data: bytes }; // 压不动就直存
      return { method: 8, data: out };
    } catch (e) {
      try {
        var cs2 = new CompressionStream('deflate');
        var s2 = new Blob([bytes]).stream().pipeThrough(cs2);
        var b2 = await new Response(s2).arrayBuffer();
        var o2 = new Uint8Array(b2);
        if (o2.length > 6 && o2[0] === 0x78) {
          var raw = o2.slice(2, o2.length - 4); // 剥掉 zlib 头尾 -> raw deflate
          return { method: 8, data: raw };
        }
      } catch (e2) { /* ignore */ }
      return { method: 0, data: bytes };
    }
  }

  /* ---------- ZIP 容器 ---------- */
  function dosDateTime(d) {
    d = d || new Date();
    var time = ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) | ((d.getSeconds() / 2) & 0x1F);
    var date = (((d.getFullYear() - 1980) & 0x7F) << 9) | (((d.getMonth() + 1) & 0x0F) << 5) | (d.getDate() & 0x1F);
    return { time: time >>> 0, date: date >>> 0 };
  }

  /**
   * @param {Array<{name:string, data:Uint8Array}>} files
   * @returns {Promise<Uint8Array>}
   */
  async function zip(files) {
    var parts = [];
    var central = [];
    var offset = 0;
    var stamp = dosDateTime(new Date());

    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var nameBytes = utf8(f.name);
      var crc = crc32(f.data);
      var comp = await compressRaw(f.data);
      var compSize = comp.data.length;
      var uncompSize = f.data.length;

      var lh = new Uint8Array(30 + nameBytes.length);
      var lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);              // version needed
      lv.setUint16(6, 0x0800, true);          // flag: UTF-8 文件名
      lv.setUint16(8, comp.method, true);     // 0 store / 8 deflate
      lv.setUint16(10, stamp.time, true);
      lv.setUint16(12, stamp.date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, compSize, true);
      lv.setUint32(22, uncompSize, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      lh.set(nameBytes, 30);

      parts.push(lh, comp.data);

      var ch = new Uint8Array(46 + nameBytes.length);
      var cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, comp.method, true);
      cv.setUint16(12, stamp.time, true);
      cv.setUint16(14, stamp.date, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, compSize, true);
      cv.setUint32(24, uncompSize, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      ch.set(nameBytes, 46);
      central.push(ch);

      offset += lh.length + comp.data.length;
    }

    var centralSize = 0;
    central.forEach(function (c) { centralSize += c.length; });

    var eocd = new Uint8Array(22);
    var ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    var all = parts.concat(central, [eocd]);
    var total = 0;
    all.forEach(function (p) { total += p.length; });
    var out = new Uint8Array(total);
    var pos = 0;
    all.forEach(function (p) { out.set(p, pos); pos += p.length; });
    return out;
  }

  /* ---------- XML ---------- */
  function escXml(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function colLetter(i) {
    var s = '';
    i = i + 1;
    while (i > 0) {
      var r = (i - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      i = Math.floor((i - 1) / 26);
    }
    return s;
  }

  function isNumericCell(v) {
    if (typeof v === 'number') return isFinite(v);
    if (typeof v !== 'string') return false;
    var s = v.trim();
    if (!s || s.length > 15) return false;
    if (/^0\d/.test(s)) return false;          // 前导零：保持文本
    return /^-?(0|[1-9]\d{0,13})(\.\d+)?$/.test(s);
  }

  function cellXml(ref, value, styleId) {
    if (value === null || value === undefined || value === '') {
      return '<c r="' + ref + '"' + (styleId ? ' s="' + styleId + '"' : '') + '/>';
    }
    if (isNumericCell(value)) {
      var n = typeof value === 'number' ? value : Number(String(value).trim());
      return '<c r="' + ref + '"' + (styleId ? ' s="' + styleId + '"' : '') + '><v>' + n + '</v></c>';
    }
    return '<c r="' + ref + '"' + (styleId ? ' s="' + styleId + '"' : '') + ' t="inlineStr"><is><t xml:space="preserve">' +
      escXml(value) + '</t></is></c>';
  }

  function cellText(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (v instanceof Date) return v.toISOString();
    try { return JSON.stringify(v); } catch (e) { return String(v); }
  }

  function sheetXml(sheet) {
    var header = sheet.header && sheet.header.length ? sheet.header.map(cellText) : null;
    var rows = sheet.rows || [];
    var body = header ? [header].concat(rows) : rows;

    // 列宽（按显示宽度粗估，中文算 2）
    var widths = [];
    body.forEach(function (row) {
      (row || []).forEach(function (cell, ci) {
        var text = cellText(cell);
        var w = 0;
        for (var i = 0; i < text.length; i++) w += text.charCodeAt(i) > 0x2E80 ? 2 : 1;
        widths[ci] = Math.max(widths[ci] || 0, Math.min(w, 60));
      });
    });

    var cols = widths.map(function (w, i) {
      return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + Math.max(8, Math.min(w + 2, 64)) + '" customWidth="1"/>';
    }).join('');

    var sheetData = body.map(function (row, ri) {
      var r = ri + 1;
      var isHeader = header && ri === 0;
      var cells = (row || []).map(function (val, ci) {
        var ref = colLetter(ci) + r;
        var style = isHeader ? 2 : 0;              // 2=加粗表头
        if (!isHeader && typeof val === 'number') style = 3;  // 3=数字格式
        return cellXml(ref, val === undefined ? '' : val, style);
      }).join('');
      return '<row r="' + r + '">' + cells + '</row>';
    }).join('');

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheetViews><sheetView workbookViewId="0">' +
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
      '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' +
      '</sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="16.5"/>' +
      (cols ? '<cols>' + cols + '</cols>' : '') +
      '<sheetData>' + sheetData + '</sheetData>' +
      '</worksheet>';
  }

  var STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="4">' +
    '<font><sz val="11"/><color theme="1"/><name val="等线"/></font>' +
    '<font><b/><sz val="11"/><color theme="1"/><name val="等线"/></font>' +
    '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="等线"/></font>' +
    '<font><sz val="11"/><color theme="1"/><name val="等线"/></font>' +
    '</fonts>' +
    '<fills count="3">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FF4472C4"/><bgColor indexed="64"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="4">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1">' +
    '<alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="常规" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  /* ---------- 打包 xlsx ---------- */

  /**
   * @param {Array<{name:string, header?:string[], rows:Array<Array>}>} sheets
   * @returns {Promise<Uint8Array>}
   */
  async function buildXlsx(sheets) {
    sheets = (sheets || []).filter(Boolean);
    if (!sheets.length) sheets = [{ name: 'Sheet1', rows: [] }];

    var names = [];
    var used = Object.create(null);
    sheets.forEach(function (s, i) {
      var base = String(s.name || ('Sheet' + (i + 1))).replace(/[\\\/?*\[\]:]/g, '_').slice(0, 31) || ('Sheet' + (i + 1));
      var n = base, k = 2;
      while (used[n]) { n = (base.slice(0, 28) + '_' + k).slice(0, 31); k++; }
      used[n] = 1;
      names.push(n);
    });

    var files = [];
    files.push({ name: '[Content_Types].xml', data: utf8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map(function (s, i) {
        return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
      }).join('') +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      '</Types>') });

    files.push({ name: '_rels/.rels', data: utf8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
      '</Relationships>') });

    files.push({ name: 'docProps/core.xml', data: utf8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
      'xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>奇域数据导出</dc:title>' +
      '<dc:creator>Miliastra Atlas</dc:creator>' +
      '<cp:lastModifiedBy>Miliastra Atlas</cp:lastModifiedBy>' +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' + new Date().toISOString().replace(/\.\d+Z$/, 'Z') + '</dcterms:created>' +
      '</cp:coreProperties>') });

    files.push({ name: 'docProps/app.xml', data: utf8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ' +
      'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
      '<Application>Miliastra Atlas</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop>' +
      '<HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>工作表</vt:lpstr></vt:variant>' +
      '<vt:variant><vt:i4>' + sheets.length + '</vt:i4></vt:variant></vt:vector></HeadingPairs>' +
      '<TitlesOfParts><vt:vector size="' + sheets.length + '" baseType="lpstr">' +
      names.map(function (n) { return '<vt:lpstr>' + escXml(n) + '</vt:lpstr>'; }).join('') +
      '</vt:vector></TitlesOfParts><Company></Company><LinksUpToDate>false</LinksUpToDate>' +
      '<SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0300</AppVersion>' +
      '</Properties>') });

    files.push({ name: 'xl/workbook.xml', data: utf8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<workbookPr/><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="20000" windowHeight="12000"/></bookViews>' +
      '<sheets>' +
      sheets.map(function (s, i) {
        return '<sheet name="' + escXml(names[i]) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
      }).join('') +
      '</sheets><calcPr calcId="171027"/></workbook>') });

    files.push({ name: 'xl/_rels/workbook.xml.rels', data: utf8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map(function (s, i) {
        return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
      }).join('') +
      '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>') });

    files.push({ name: 'xl/styles.xml', data: utf8(STYLES_XML) });

    sheets.forEach(function (s, i) {
      files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: utf8(sheetXml(s)) });
    });

    return await zip(files);
  }

  /* ---------- CSV ---------- */
  function csvCell(v) {
    var s = v === null || v === undefined ? '' : String(v);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  /**
   * 多工作表 -> 单个 CSV（用空行 + 表名分隔）
   * @returns {string}
   */
  function buildCsv(sheets) {
    var out = [];
    (sheets || []).forEach(function (s, idx) {
      if (!s) return;
      if (idx > 0) out.push('');
      out.push('# ' + (s.name || ('Sheet' + (idx + 1))));
      var body = (s.header && s.header.length) ? [s.header].concat(s.rows || []) : (s.rows || []);
      body.forEach(function (row) {
        out.push((row || []).map(csvCell).join(','));
      });
    });
    return out.join('\r\n');
  }

  var API = {
    buildXlsx: buildXlsx,
    buildCsv: buildCsv,
    crc32: crc32,
    utf8: utf8,
    supportsCompression: supportsCompression
  };

  root.MHYXlsx = API;
  if (typeof module === 'object' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
