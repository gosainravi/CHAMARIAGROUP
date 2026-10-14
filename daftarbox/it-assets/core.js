/* Daftarbox IT assets: pure helpers (no DOM). Works as a classic browser script and in Node for tests. */
'use strict';
(function (root) {
  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  var CATEGORIES = ['Laptop','Desktop','Monitor','Printer','Server','Network switch','Access point','Firewall','Router','CCTV camera','NVR','UPS','Phone','Tablet','Other'];
  var STATUSES = ['In stock','Assigned','In repair','Retired','Lost'];
  var DEFAULT_LIFE = { 'Laptop':3,'Desktop':3,'Monitor':3,'Printer':5,'Server':6,'Network switch':6,'Access point':6,'Firewall':6,'Router':6,'CCTV camera':5,'NVR':5,'UPS':5,'Phone':3,'Tablet':3,'Other':5 };

  /* ---------- Dates (ISO YYYY-MM-DD strings, compared in UTC) ---------- */
  function pad(n, w) { n = String(n); while (n.length < (w || 2)) n = '0' + n; return n; }
  function isoFromParts(y, m, d) {
    y = +y; m = +m; d = +d;
    if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
    var dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return y + '-' + pad(m) + '-' + pad(d);
  }
  function isoToday(now) {
    var d = now || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function isIso(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && isoFromParts(s.slice(0,4), s.slice(5,7), s.slice(8,10)) === s; }
  function toUTC(iso) { return Date.UTC(+iso.slice(0,4), +iso.slice(5,7) - 1, +iso.slice(8,10)); }
  function daysBetween(a, b) { return Math.round((toUTC(b) - toUTC(a)) / 86400000); }
  function addDays(iso, n) {
    var d = new Date(toUTC(iso) + n * 86400000);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function fmtDate(iso) {
    if (!iso || !isIso(String(iso).slice(0, 10))) return '';
    iso = String(iso).slice(0, 10);
    return iso.slice(8, 10) + ' ' + MONTHS[+iso.slice(5, 7) - 1] + ' ' + iso.slice(0, 4);
  }
  function fmtDateTime(ts) {
    var d = new Date(ts); if (isNaN(d)) return '';
    var h = d.getHours(), ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12;
    return pad(d.getDate()) + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() + ', ' + h + ':' + pad(d.getMinutes()) + ' ' + ap;
  }
  /* Accepts 2026-03-15, 15/03/2026, 15-03-2026, 15.03.2026, 15 Mar 2026, 15-Mar-26, Excel serial numbers. Day comes first (Indian style). */
  function parseDateLoose(s) {
    if (s === null || s === undefined) return null;
    s = String(s).trim();
    if (!s) return null;
    var m;
    if ((m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[T ].*)?$/))) return isoFromParts(m[1], m[2], m[3]);
    if ((m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2}|\d{4})$/))) return isoFromParts(m[3].length === 2 ? '20' + m[3] : m[3], m[2], m[1]);
    if ((m = s.match(/^(\d{1,2})[\s\-\/]*([A-Za-z]{3,9})[\s\-\/,]*(\d{2}|\d{4})$/))) {
      var mi = MONTHS.map(function (x) { return x.toLowerCase(); }).indexOf(m[2].slice(0, 3).toLowerCase());
      if (mi < 0) return null;
      return isoFromParts(m[3].length === 2 ? '20' + m[3] : m[3], mi + 1, m[1]);
    }
    if ((m = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/))) {
      var mj = MONTHS.map(function (x) { return x.toLowerCase(); }).indexOf(m[1].slice(0, 3).toLowerCase());
      if (mj < 0) return null;
      return isoFromParts(m[3], mj + 1, m[2]);
    }
    if (/^\d{5}$/.test(s)) { /* Excel serial date */
      var n = +s; if (n < 20000 || n > 80000) return null;
      var d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
      return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
    }
    return null;
  }

  /* ---------- Money ---------- */
  function parseMoney(s) {
    if (s === null || s === undefined) return null;
    if (typeof s === 'number') return isFinite(s) ? s : NaN;
    s = String(s).trim();
    if (!s) return null;
    s = s.replace(/^(₹|rs\.?|inr)\s*/i, '').replace(/\s*(₹|rs\.?|inr)$/i, '').replace(/[,\s]/g, '').replace(/\/-$/, '');
    if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
    return parseFloat(s);
  }
  function fmtNumber(n, decimals) {
    return new Intl.NumberFormat('en-IN', { minimumFractionDigits: decimals || 0, maximumFractionDigits: decimals || 0 }).format(n || 0);
  }
  function fmtMoney(n, opts) {
    opts = opts || {};
    var sym = opts.symbol === undefined ? '₹' : opts.symbol;
    var dec = opts.decimals ? 2 : 0;
    var v = Math.round((+n || 0) * (dec ? 100 : 1)) / (dec ? 100 : 1);
    var neg = v < 0;
    var s = fmtNumber(Math.abs(v), dec);
    var sep = sym && /[A-Za-z.]$/.test(sym) ? ' ' : '';
    return (neg ? '-' : '') + sym + sep + s;
  }

  /* ---------- Depreciation: straight line, optional salvage % ---------- */
  function depreciation(cost, purchaseDate, lifeYears, salvagePct, asOf) {
    cost = +cost || 0;
    lifeYears = +lifeYears > 0 ? +lifeYears : 0;
    var salvage = cost * Math.min(Math.max(+salvagePct || 0, 0), 100) / 100;
    var out = { cost: cost, salvage: salvage, annual: 0, accumulated: 0, book: cost, ageYears: 0, fullyDepreciated: false, endDate: null };
    if (!cost || !isIso(purchaseDate)) return out;
    if (!lifeYears) { out.accumulated = cost - salvage; out.book = salvage; out.fullyDepreciated = true; return out; }
    var days = Math.max(0, daysBetween(purchaseDate, asOf));
    var lifeDays = lifeYears * 365.25;
    var frac = Math.min(1, days / lifeDays);
    out.ageYears = days / 365.25;
    out.annual = (cost - salvage) / lifeYears;
    out.accumulated = (cost - salvage) * frac;
    out.book = cost - out.accumulated;
    out.fullyDepreciated = frac >= 1;
    out.endDate = addDays(purchaseDate, Math.round(lifeDays));
    return out;
  }

  /* ---------- Asset tags ---------- */
  function makeTag(prefix, n, width) { return (prefix || '') + pad(n, width || 4); }
  function tagNumber(tag, prefix) {
    tag = String(tag || ''); prefix = prefix || '';
    if (prefix && tag.toUpperCase().indexOf(prefix.toUpperCase()) !== 0) return null;
    var rest = tag.slice(prefix.length);
    return /^\d+$/.test(rest) ? parseInt(rest, 10) : null;
  }
  function nextFreeTag(prefix, startN, existingTags) {
    var used = {}; (existingTags || []).forEach(function (t) { used[String(t).toUpperCase()] = 1; });
    var n = Math.max(1, startN || 1), tag;
    for (var i = 0; i < 1000000; i++) { tag = makeTag(prefix, n); if (!used[tag.toUpperCase()]) return { tag: tag, n: n }; n++; }
    return { tag: makeTag(prefix, n), n: n };
  }

  /* ---------- CSV ---------- */
  function parseCSV(text) {
    text = String(text || '');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    var delim = ',';
    var firstLine = text.split(/\r?\n/, 1)[0] || '';
    var counts = { ',': (firstLine.match(/,/g) || []).length, ';': (firstLine.match(/;/g) || []).length, '\t': (firstLine.match(/\t/g) || []).length };
    if (counts[';'] > counts[','] && counts[';'] >= counts['\t']) delim = ';';
    else if (counts['\t'] > counts[',']) delim = '\t';
    var rows = [], row = [], field = '', i = 0, q = false, c;
    while (i < text.length) {
      c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } q = false; i++; continue; }
        field += c; i++; continue;
      }
      if (c === '"' && field === '') { q = true; i++; continue; }
      if (c === delim) { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return String(x).trim() !== ''; }); });
  }
  function csvCell(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return isFinite(v) ? String(v) : '';
    var s = String(v);
    /* Stop spreadsheet apps from running text as a formula */
    if (/^[=+@\t\r]/.test(s) || /^-[^\d.]/.test(s)) s = "'" + s;
    if (/[",\r\n]/.test(s) || /^\s|\s$/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function toCSV(rows) { return '﻿' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n'; }

  /* ---------- Import: mapping and validation ---------- */
  var IMPORT_FIELDS = [
    { key: 'tag', label: 'Asset tag', words: ['asset tag', 'tag', 'asset id', 'asset no', 'asset number', 'asset code'] },
    { key: 'category', label: 'Category', words: ['category', 'type', 'asset type', 'device type', 'kind'] },
    { key: 'brand', label: 'Brand', words: ['brand', 'make', 'manufacturer', 'oem'] },
    { key: 'model', label: 'Model', words: ['model', 'model name', 'model no', 'model number', 'description', 'name'] },
    { key: 'serial', label: 'Serial number', words: ['serial', 'serial number', 'serial no', 'sn', 's/n', 'service tag'] },
    { key: 'purchaseDate', label: 'Purchase date', words: ['purchase date', 'purchased', 'bought on', 'date of purchase', 'invoice date', 'purchase'] },
    { key: 'cost', label: 'Purchase cost', words: ['cost', 'purchase cost', 'price', 'amount', 'value', 'purchase price'] },
    { key: 'vendor', label: 'Vendor', words: ['vendor', 'supplier', 'seller', 'dealer'] },
    { key: 'invoice', label: 'Invoice number', words: ['invoice', 'invoice number', 'invoice no', 'bill no', 'bill number', 'po'] },
    { key: 'warrantyEnd', label: 'Warranty end', words: ['warranty', 'warranty end', 'warranty expiry', 'warranty until', 'warranty date', 'amc end'] },
    { key: 'location', label: 'Location', words: ['location', 'office', 'site', 'room', 'branch'] },
    { key: 'status', label: 'Status', words: ['status', 'state', 'condition'] },
    { key: 'assignedTo', label: 'Assigned to', words: ['assigned to', 'assignee', 'user', 'employee', 'owner', 'custodian', 'person'] },
    { key: 'notes', label: 'Notes', words: ['notes', 'note', 'remarks', 'comments', 'comment'] }
  ];
  function norm(s) { return String(s || '').toLowerCase().replace(/[_\-.#:]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function guessMapping(headers) {
    var map = {}, taken = {};
    IMPORT_FIELDS.forEach(function (f) {
      var best = -1, bestScore = 0;
      headers.forEach(function (h, i) {
        if (taken[i]) return;
        var n = norm(h), score = 0;
        f.words.forEach(function (w) {
          if (n === w) score = Math.max(score, 3);
          else if (n.indexOf(w) === 0 && w.length > 2) score = Math.max(score, 2);
          else if (w.length > 3 && n.indexOf(w) >= 0) score = Math.max(score, 1);
        });
        if (score > bestScore) { bestScore = score; best = i; }
      });
      if (best >= 0) { map[f.key] = best; taken[best] = 1; }
    });
    return map;
  }
  function matchFrom(list, value) {
    var v = norm(value); if (!v) return null;
    for (var i = 0; i < list.length; i++) if (norm(list[i]) === v) return list[i];
    var aliases = { 'notebook': 'Laptop', 'pc': 'Desktop', 'cpu': 'Desktop', 'workstation': 'Desktop', 'display': 'Monitor', 'switch': 'Network switch', 'ap': 'Access point', 'wifi': 'Access point', 'wi fi': 'Access point', 'camera': 'CCTV camera', 'cctv': 'CCTV camera', 'dvr': 'NVR', 'mobile': 'Phone', 'smartphone': 'Phone', 'ipad': 'Tablet', 'utm': 'Firewall', 'issued': 'Assigned', 'in use': 'Assigned', 'allocated': 'Assigned', 'available': 'In stock', 'spare': 'In stock', 'stock': 'In stock', 'repair': 'In repair', 'under repair': 'In repair', 'faulty': 'In repair', 'scrapped': 'Retired', 'disposed': 'Retired', 'missing': 'Lost', 'stolen': 'Lost' };
    if (aliases[v] && list.indexOf(aliases[v]) >= 0) return aliases[v];
    return null;
  }
  /* ctx: { existingTags:[], existingSerials:[], people:[{id,name,email,empId}], locations:[{id,name}] }
     returns rows: [{ line, data, errors:[], warnings:[] }] */
  function validateImport(rows, mapping, ctx) {
    ctx = ctx || {};
    var tagSeen = {}, serialSeen = {};
    (ctx.existingTags || []).forEach(function (t) { tagSeen[String(t).toUpperCase()] = 'already in your list'; });
    var exSerial = {}; (ctx.existingSerials || []).forEach(function (s) { if (s) exSerial[String(s).toUpperCase()] = 1; });
    var people = ctx.people || [], locs = ctx.locations || [];
    function get(r, k) { var i = mapping[k]; return i === undefined || i === null || i === '' ? '' : String(r[i] === undefined ? '' : r[i]).trim(); }
    return rows.map(function (r, idx) {
      var line = idx + 2; /* row 1 is the header */
      var e = [], w = [], d = {};
      d.tag = get(r, 'tag');
      if (d.tag) {
        var k = d.tag.toUpperCase();
        if (tagSeen[k]) e.push('Asset tag ' + d.tag + ' is ' + (tagSeen[k] === 1 ? 'used twice in this file' : tagSeen[k]) + '.');
        else tagSeen[k] = 1;
      }
      var catRaw = get(r, 'category');
      d.category = matchFrom(CATEGORIES, catRaw);
      if (!catRaw) { d.category = 'Other'; w.push('No category, saved as Other.'); }
      else if (!d.category) { d.category = 'Other'; w.push('Category "' + catRaw + '" not recognised, saved as Other.'); }
      d.brand = get(r, 'brand'); d.model = get(r, 'model'); d.serial = get(r, 'serial');
      d.vendor = get(r, 'vendor'); d.invoice = get(r, 'invoice'); d.notes = get(r, 'notes');
      if (!d.brand && !d.model && !d.serial) e.push('Needs at least a brand, model or serial number.');
      if (d.serial) {
        var sk = d.serial.toUpperCase();
        if (exSerial[sk]) w.push('Serial ' + d.serial + ' already exists in your list.');
        else if (serialSeen[sk]) w.push('Serial ' + d.serial + ' appears more than once in this file.');
        serialSeen[sk] = 1;
      }
      ['purchaseDate', 'warrantyEnd'].forEach(function (dk) {
        var raw = get(r, dk);
        d[dk] = '';
        if (raw) { var iso = parseDateLoose(raw); if (iso) d[dk] = iso; else e.push((dk === 'purchaseDate' ? 'Purchase date' : 'Warranty end') + ' "' + raw + '" is not a date we understand. Try DD/MM/YYYY.'); }
      });
      var costRaw = get(r, 'cost');
      d.cost = 0;
      if (costRaw) { var c = parseMoney(costRaw); if (isNaN(c) || c < 0) e.push('Cost "' + costRaw + '" is not a valid amount.'); else d.cost = c; }
      var stRaw = get(r, 'status');
      d.status = stRaw ? matchFrom(STATUSES, stRaw) : 'In stock';
      if (!d.status) { d.status = 'In stock'; w.push('Status "' + stRaw + '" not recognised, saved as In stock.'); }
      var locRaw = get(r, 'location');
      d.locationName = locRaw;
      d.locationId = '';
      if (locRaw) {
        var lm = locs.filter(function (l) { return norm(l.name) === norm(locRaw); })[0];
        if (lm) d.locationId = lm.id; else w.push('New location "' + locRaw + '" will be added.');
      }
      var asg = get(r, 'assignedTo');
      d.assignedTo = '';
      if (asg) {
        var pm = people.filter(function (p) { return norm(p.name) === norm(asg) || (p.email && norm(p.email) === norm(asg)) || (p.empId && norm(p.empId) === norm(asg)); })[0];
        if (pm) { d.assignedTo = pm.id; d.status = 'Assigned'; }
        else { w.push('Person "' + asg + '" not found in People, so the asset was not assigned.'); if (d.status === 'Assigned') d.status = 'In stock'; }
      } else if (d.status === 'Assigned') { d.status = 'In stock'; w.push('Marked Assigned but no person given, saved as In stock.'); }
      return { line: line, data: d, errors: e, warnings: w };
    });
  }

  /* ---------- Needs attention ---------- */
  function attention(state, today) {
    var out = { warranty: [], licences: [], over: [], overdue: [] };
    (state.assets || []).forEach(function (a) {
      if (a.status === 'Retired' || a.status === 'Lost') return;
      if (isIso(a.warrantyEnd)) {
        var dw = daysBetween(today, a.warrantyEnd);
        if (dw >= 0 && dw <= 90) out.warranty.push({ asset: a, days: dw, band: dw <= 30 ? 30 : dw <= 60 ? 60 : 90 });
      }
      if (a.status === 'Assigned' && isIso(a.expectedReturn) && daysBetween(a.expectedReturn, today) > 0)
        out.overdue.push({ asset: a, days: daysBetween(a.expectedReturn, today) });
    });
    (state.licences || []).forEach(function (l) {
      if (isIso(l.renewalDate)) {
        var dl = daysBetween(today, l.renewalDate);
        if (dl <= 60) out.licences.push({ licence: l, days: dl });
      }
      var used = (l.assigned || []).length;
      if (+l.seats >= 0 && used > +l.seats) out.over.push({ licence: l, used: used, extra: used - (+l.seats) });
    });
    out.warranty.sort(function (a, b) { return a.days - b.days; });
    out.licences.sort(function (a, b) { return a.days - b.days; });
    out.overdue.sort(function (a, b) { return b.days - a.days; });
    return out;
  }

  function maskKey(k) {
    k = String(k || ''); if (!k) return '';
    if (k.length <= 4) return '••••';
    return k.slice(0, 0) + '•••• •••• ' + k.slice(-4);
  }

  var api = {
    MONTHS: MONTHS, CATEGORIES: CATEGORIES, STATUSES: STATUSES, DEFAULT_LIFE: DEFAULT_LIFE, IMPORT_FIELDS: IMPORT_FIELDS,
    pad: pad, isoToday: isoToday, isIso: isIso, daysBetween: daysBetween, addDays: addDays, fmtDate: fmtDate, fmtDateTime: fmtDateTime,
    parseDateLoose: parseDateLoose, parseMoney: parseMoney, fmtNumber: fmtNumber, fmtMoney: fmtMoney, depreciation: depreciation,
    makeTag: makeTag, tagNumber: tagNumber, nextFreeTag: nextFreeTag, parseCSV: parseCSV, csvCell: csvCell, toCSV: toCSV,
    guessMapping: guessMapping, matchFrom: matchFrom, validateImport: validateImport, attention: attention, maskKey: maskKey, norm: norm
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KCore = api;
})(typeof window !== 'undefined' ? window : this);
