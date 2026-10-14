/* Daftarbox IT assets: storage, shared helpers, dialogs, router, data actions. Classic script (works from file://). */
'use strict';
var K = window.KCore;

/* ================= Storage (IndexedDB, falls back to localStorage) ================= */
var DB_NAME = 'daftarbox-it-assets', DB_STORE = 'kv', DB_KEY = 'state', LS_KEY = 'daftarbox-it-assets-v1';
var S = null;           /* the whole app state */
var storeKind = 'IndexedDB';
var idbHandle = null;
var bc = null;
var tabId = Math.random().toString(36).slice(2);

function blankState() {
  return {
    version: 1,
    settings: { org: '', prefix: 'AST-', nextNum: 1, symbol: '₹', decimals: false, salvagePct: 0, life: Object.assign({}, K.DEFAULT_LIFE) },
    assets: [], people: [], licences: [], maintenance: [], locations: []
  };
}
function normalize(o) {
  var b = blankState();
  if (!o || typeof o !== 'object') return b;
  var s = Object.assign({}, b.settings, o.settings || {});
  s.life = Object.assign({}, K.DEFAULT_LIFE, (o.settings && o.settings.life) || {});
  s.nextNum = Math.max(1, parseInt(s.nextNum, 10) || 1);
  s.salvagePct = Math.min(100, Math.max(0, +s.salvagePct || 0));
  if (typeof s.prefix !== 'string') s.prefix = 'AST-';
  b.settings = s;
  ['assets', 'people', 'licences', 'maintenance', 'locations'].forEach(function (k) {
    b[k] = Array.isArray(o[k]) ? o[k].filter(function (x) { return x && typeof x === 'object' && x.id; }) : [];
  });
  /* Backups come from files, so only accept plain ids (keeps them safe to place in links and attributes) */
  var okId = function (x) { return typeof x === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x); };
  ['assets', 'people', 'licences', 'maintenance', 'locations'].forEach(function (k) { b[k] = b[k].filter(function (x) { return okId(x.id); }); });
  b.people.forEach(function (p) { if (!okId(p.locationId)) p.locationId = ''; p.name = String(p.name || 'Unnamed'); });
  b.maintenance = b.maintenance.filter(function (m) { return okId(m.assetId); });
  b.locations.forEach(function (l) { l.name = String(l.name || 'Unnamed'); });
  b.assets.forEach(function (a) {
    if (!okId(a.assignedTo)) a.assignedTo = '';
    if (!okId(a.locationId)) a.locationId = '';
    a.tag = String(a.tag || a.id);
    if (!Array.isArray(a.history)) a.history = [];
    if (K.CATEGORIES.indexOf(a.category) < 0) a.category = 'Other';
    if (K.STATUSES.indexOf(a.status) < 0) a.status = 'In stock';
    a.cost = +a.cost || 0;
  });
  b.licences.forEach(function (l) { l.assigned = Array.isArray(l.assigned) ? l.assigned.filter(okId) : []; l.name = String(l.name || 'Unnamed'); l.seats = Math.max(0, parseInt(l.seats, 10) || 0); l.cost = +l.cost || 0; });
  return b;
}
function idbOpen() {
  return new Promise(function (res, rej) {
    try {
      if (!window.indexedDB) return rej(new Error('no idb'));
      var r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(DB_STORE); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
      r.onblocked = function () { rej(new Error('blocked')); };
    } catch (e) { rej(e); }
  });
}
function idbGet() {
  return new Promise(function (res, rej) {
    try {
      var tx = idbHandle.transaction(DB_STORE, 'readonly');
      var q = tx.objectStore(DB_STORE).get(DB_KEY);
      q.onsuccess = function () { res(q.result); };
      q.onerror = function () { rej(q.error); };
    } catch (e) { rej(e); }
  });
}
function idbPut(val) {
  return new Promise(function (res, rej) {
    try {
      var tx = idbHandle.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(val, DB_KEY);
      tx.oncomplete = function () { res(); };
      tx.onerror = function () { rej(tx.error); };
      tx.onabort = function () { rej(tx.error); };
    } catch (e) { rej(e); }
  });
}
function lsGet() { try { var t = localStorage.getItem(LS_KEY); return t ? JSON.parse(t) : null; } catch (e) { return null; } }
function lsSet(v) { try { localStorage.setItem(LS_KEY, JSON.stringify(v)); return true; } catch (e) { return false; } }

function loadState() {
  return idbOpen().then(function (db) {
    idbHandle = db;
    return idbGet().then(function (v) {
      if (!v) { var ls = lsGet(); if (ls) v = ls; } /* migrate from fallback copy */
      return v;
    });
  }).catch(function () {
    storeKind = 'localStorage';
    return lsGet();
  }).then(function (v) { S = normalize(v); });
}
var saveChain = Promise.resolve();
function persist() {
  var snap = JSON.parse(JSON.stringify(S));
  saveChain = saveChain.then(function () {
    if (idbHandle) return idbPut(snap).catch(function () { if (!lsSet(snap)) throw new Error('save failed'); storeKind = 'localStorage'; });
    if (!lsSet(snap)) throw new Error('save failed');
  }).then(function () {
    try { if (bc) bc.postMessage({ from: tabId, t: 'changed' }); } catch (e) {}
  }).catch(function () {
    toast('Could not save. Your browser storage may be full or blocked. Download a backup now.', 6000);
  });
  return saveChain;
}
function setupSync() {
  try {
    bc = new BroadcastChannel('daftarbox-it-assets');
    bc.onmessage = function (ev) {
      if (!ev.data || ev.data.from === tabId) return;
      loadState().then(function () { if (!document.querySelector('#dlg[open]')) route(); });
    };
  } catch (e) { bc = null; }
}

/* ================= Small helpers ================= */
function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function today() { return K.isoToday(); }
function money(n) { return K.fmtMoney(n, { symbol: S.settings.symbol, decimals: S.settings.decimals }); }
function dt(iso) { return iso ? K.fmtDate(iso) : ''; }
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
function asset(id) { return byId(S.assets, id); }
function person(id) { return byId(S.people, id); }
function loc(id) { return byId(S.locations, id); }
function licence(id) { return byId(S.licences, id); }
function personName(id) { var p = person(id); return p ? p.name : ''; }
function locName(id) { var l = loc(id); return l ? l.name : ''; }
function assetTitle(a) { return [a.brand, a.model].filter(Boolean).join(' ') || a.category; }
function initials(name) { return String(name || '?').trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase(); }
function lifeFor(cat) { var v = S.settings.life[cat]; return v === undefined ? 5 : +v; }
function dep(a, asOf) { return K.depreciation(a.cost, a.purchaseDate, lifeFor(a.category), S.settings.salvagePct, asOf || today()); }
function hasSample() { return ['assets', 'people', 'licences', 'maintenance', 'locations'].some(function (k) { return S[k].some(function (x) { return x.sample; }); }); }
function isEmpty() { return !S.assets.length && !S.people.length && !S.licences.length && !S.locations.length; }
function statusPill(s) {
  var c = { 'In stock': 'ok', 'Assigned': 'acc', 'In repair': 'warn', 'Retired': '', 'Lost': 'bad' }[s] || '';
  return '<span class="pill ' + c + '">' + esc(s) + '</span>';
}
function warrantyPill(iso) {
  if (!iso) return '<span class="mut">—</span>';
  var d = K.daysBetween(today(), iso);
  if (d < 0) return '<span class="pill">Ended ' + esc(dt(iso)) + '</span>';
  if (d <= 30) return '<span class="pill bad">' + esc(dt(iso)) + '</span>';
  if (d <= 90) return '<span class="pill warn">' + esc(dt(iso)) + '</span>';
  return esc(dt(iso));
}
function addHistory(a, k, title, detail) {
  a.history = a.history || [];
  a.history.push({ at: Date.now(), k: k, t: title, d: detail || '' });
}
function download(name, text, type) {
  try {
    var blob = new Blob([text], { type: type || 'text/plain' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url; link.download = name; document.body.appendChild(link); link.click();
    setTimeout(function () { URL.revokeObjectURL(url); link.remove(); }, 1000);
  } catch (e) { toast('Your browser blocked the download.'); }
}
var toastTimer = null;
function toast(msg, ms) {
  var t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('on'); }, ms || 2800);
}
/* Debounce for search boxes */
function debounce(fn, ms) { var h; return function () { var a = arguments, me = this; clearTimeout(h); h = setTimeout(function () { fn.apply(me, a); }, ms); }; }

/* ================= Icons (simple line drawings) ================= */
function ico(name) {
  var p = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    box: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c2 .7 3.5 2.4 3.5 5.2"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M14.5 8.5l2 2"/>',
    wrench: '<path d="M14.5 6.5a4 4 0 0 0 5 5L21 13l-8 8-3-3 8-8-1.5-1.5a4 4 0 0 1-5-5L13 2z" transform="translate(-2 1)"/>',
    pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
    laptop: '<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/>',
    rupee: '<path d="M7 5h10M7 9h10M8 5c5 0 5 8 0 8h-1l7 7"/>',
    trend: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    upload: '<path d="M12 16V5M7 10l5-5 5 5M5 20h14"/>',
    qr: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM20 14v.5M14 20h.5M17 17h4v4"/>',
    print: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="1.5"/><path d="M7 14h10v7H7z"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    out: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v6H4V6h6"/>',
    in: '<path d="M10 14 20 4M10 8v6h6"/><path d="M18 14v6H4V6h6"/>',
    file: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/>',
    shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M16 8V4H4v12h4"/>',
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>'
  }[name] || '';
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
}

/* ================= Dialogs ================= */
var dlg = null;
function openDialog(html, wide) {
  dlg = $('#dlg');
  dlg.className = wide ? 'wide' : '';
  dlg.innerHTML = html;
  if (!dlg.open) { try { dlg.showModal(); } catch (e) { dlg.setAttribute('open', ''); } }
  var f = dlg.querySelector('[autofocus]') || dlg.querySelector('.d-b input:not([type=hidden]):not([disabled]),.d-b select,.d-b textarea,.d-b button');
  if (f) setTimeout(function () { f.focus(); }, 30);
  return dlg;
}
function closeDialog() { if (dlg && dlg.open) dlg.close(); }
function dlgHead(title) {
  return '<div class="d-h"><h2 id="dlgTitle">' + esc(title) + '</h2><button type="button" class="icon-btn x" data-close aria-label="Close">' + ico('x') + '</button></div>';
}
document.addEventListener('click', function (e) {
  if (e.target.closest && e.target.closest('[data-close]')) closeDialog();
});

/* Field spec: {n, l, t, opts, req, h, full, ph, list, min, max, step, v} */
function fieldHtml(f, val) {
  var id = 'f_' + f.n;
  var v = val === undefined || val === null ? '' : val;
  var req = f.req ? ' <span class="req" aria-hidden="true">*</span>' : '';
  var hint = f.h ? '<span class="h" id="' + id + '_h">' + f.h + '</span>' : '';
  var desc = ' aria-describedby="' + id + '_e' + (f.h ? ' ' + id + '_h' : '') + '"';
  var common = ' id="' + id + '" name="' + f.n + '"' + (f.req ? ' aria-required="true"' : '') + desc + (f.ph ? ' placeholder="' + esc(f.ph) + '"' : '') + (f.dis ? ' disabled' : '');
  var input;
  if (f.t === 'note') return '<div class="' + (f.full !== false ? 'full' : '') + '"><p class="' + (f.warn ? 'warn' : 'note') + '">' + f.html + '</p></div>';
  if (f.t === 'select') {
    input = '<select' + common + '>' + (f.opts || []).map(function (o) {
      var ov = Array.isArray(o) ? o[0] : o, ol = Array.isArray(o) ? o[1] : o;
      return '<option value="' + esc(ov) + '"' + (String(ov) === String(v) ? ' selected' : '') + '>' + esc(ol) + '</option>';
    }).join('') + '</select>';
  } else if (f.t === 'textarea') {
    input = '<textarea' + common + ' rows="3">' + esc(v) + '</textarea>';
  } else if (f.t === 'checklist') {
    var sel = Array.isArray(v) ? v : [];
    input = (f.opts || []).length ? '<div class="checklist" role="group" aria-labelledby="' + id + '_l">' + f.opts.map(function (o) {
      return '<label><input type="checkbox" name="' + f.n + '" value="' + esc(o[0]) + '"' + (sel.indexOf(o[0]) >= 0 ? ' checked' : '') + '> ' + esc(o[1]) + (o[2] ? '<small>' + esc(o[2]) + '</small>' : '') + '</label>';
    }).join('') + '</div>' : '<p class="note">' + (f.empty || 'Nothing to choose yet.') + '</p>';
    return '<div class="f ' + (f.full !== false ? 'full' : '') + '" style="margin-bottom:14px"><span id="' + id + '_l" style="font-weight:600;font-size:.92rem;display:block;margin-bottom:6px">' + esc(f.l) + '</span>' + input + '<span class="err" id="' + id + '_e"></span></div>';
  } else if (f.t === 'checkbox') {
    return '<label class="check ' + (f.full !== false ? 'full' : '') + '"><input type="checkbox" name="' + f.n + '" id="' + id + '"' + (v ? ' checked' : '') + '> ' + esc(f.l) + '</label>';
  } else {
    var t = f.t || 'text';
    var extra = (f.min !== undefined ? ' min="' + f.min + '"' : '') + (f.max !== undefined ? ' max="' + f.max + '"' : '') + (f.step !== undefined ? ' step="' + f.step + '"' : '') + (f.list ? ' list="' + id + '_dl"' : '') + (t === 'number' ? ' inputmode="decimal"' : '') + (f.auto ? ' autocomplete="' + f.auto + '"' : ' autocomplete="off"');
    input = '<input type="' + t + '"' + common + extra + ' value="' + esc(v) + '">';
    if (f.list) input += '<datalist id="' + id + '_dl">' + f.list.map(function (x) { return '<option value="' + esc(x) + '">'; }).join('') + '</datalist>';
    if (f.btn) input = '<span class="with-btn">' + input + f.btn + '</span>';
  }
  return '<label class="f ' + (f.full ? 'full' : '') + '" for="' + id + '">' + esc(f.l) + req + input + hint + '<span class="err" id="' + id + '_e" role="alert"></span></label>';
}
function formValues(form, fields) {
  var out = {};
  fields.forEach(function (f) {
    if (f.t === 'note') return;
    if (f.t === 'checklist') { out[f.n] = $$('input[name="' + f.n + '"]:checked', form).map(function (x) { return x.value; }); return; }
    var el = form.elements[f.n]; if (!el) return;
    out[f.n] = f.t === 'checkbox' ? el.checked : String(el.value).trim();
  });
  return out;
}
/* opts: {title, fields, values, submit, wide, intro, onSubmit(vals, force) -> {errors, soft} | true} */
function formDialog(opts) {
  var vals = opts.values || {};
  var html = '<form novalidate>' + dlgHead(opts.title) + '<div class="d-b">' + (opts.intro || '') + '<div class="fgrid">' +
    opts.fields.map(function (f) { return fieldHtml(f, vals[f.n] !== undefined ? vals[f.n] : f.v); }).join('') +
    '</div><p class="status err" id="formMsg" role="alert"></p></div><div class="d-f"><button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" class="btn">' + esc(opts.submit || 'Save') + '</button></div></form>';
  var d = openDialog(html, opts.wide);
  var form = d.querySelector('form');
  var softKey = null;
  if (opts.onOpen) opts.onOpen(form);
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    $$('.err', form).forEach(function (x) { x.textContent = ''; });
    $$('[aria-invalid]', form).forEach(function (x) { x.removeAttribute('aria-invalid'); });
    $('#formMsg', form).textContent = '';
    var v = formValues(form, opts.fields);
    var errors = {};
    opts.fields.forEach(function (f) {
      if (f.req && (v[f.n] === '' || v[f.n] === undefined)) errors[f.n] = 'Please fill this in.';
      if (f.t === 'number' && v[f.n] !== '' && v[f.n] !== undefined) {
        var num = Number(v[f.n]);
        if (!isFinite(num)) errors[f.n] = 'Please enter a number.';
        else if (f.min !== undefined && num < f.min) errors[f.n] = 'Must be ' + f.min + ' or more.';
        else if (f.int && Math.floor(num) !== num) errors[f.n] = 'Please use a whole number.';
      }
      if (f.t === 'email' && v[f.n] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v[f.n])) errors[f.n] = 'This email address looks incomplete.';
    });
    var key = JSON.stringify(v);
    var r = Object.keys(errors).length ? { errors: errors } : opts.onSubmit(v, softKey === key);
    if (r === true || r === undefined) { closeDialog(); return; }
    var first = null;
    Object.keys(r.errors || {}).forEach(function (n) {
      var el = form.elements[n], er = $('#f_' + n + '_e', form);
      if (er) er.textContent = r.errors[n];
      if (el && el.setAttribute) el.setAttribute('aria-invalid', 'true');
      if (!first) first = el && el.focus ? el : null;
    });
    if (r.msg) $('#formMsg', form).textContent = r.msg;
    if (r.soft) { softKey = key; form.querySelector('[type=submit]').textContent = r.softLabel || 'Save anyway'; }
    if (first) first.focus();
  });
  return form;
}
/* Confirm: {title, body, ok, danger, typed} → Promise<boolean> */
function confirmBox(o) {
  return new Promise(function (resolve) {
    var html = '<form novalidate>' + dlgHead(o.title) + '<div class="d-b">' + (o.body || '') +
      (o.typed ? '<label class="f" for="cTyped">Type <b>' + esc(o.typed) + '</b> to confirm<input type="text" id="cTyped" autocomplete="off" autocapitalize="characters"></label>' : '') +
      '</div><div class="d-f"><button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" class="btn' + (o.danger ? ' danger' : '') + '"' + (o.typed ? ' disabled' : '') + '>' + esc(o.ok || 'OK') + '</button></div></form>';
    var d = openDialog(html);
    var form = d.querySelector('form'), done = false;
    if (o.typed) {
      var inp = $('#cTyped', form), btn = form.querySelector('[type=submit]');
      inp.addEventListener('input', function () { btn.disabled = inp.value.trim().toUpperCase() !== o.typed.toUpperCase(); });
      setTimeout(function () { inp.focus(); }, 40);
    } else setTimeout(function () { form.querySelector('[type=submit]').focus(); }, 40);
    form.addEventListener('submit', function (e) { e.preventDefault(); done = true; closeDialog(); resolve(true); });
    d.addEventListener('close', function onc() { d.removeEventListener('close', onc); if (!done) resolve(false); });
  });
}

/* ================= Data actions ================= */
function commit(msg) { persist(); route(); if (msg) toast(msg); }

function findOrCreateLocation(name) {
  name = String(name || '').trim(); if (!name) return '';
  var l = S.locations.filter(function (x) { return K.norm(x.name) === K.norm(name); })[0];
  if (l) return l.id;
  l = { id: uid(), name: name, type: 'Office', city: '', notes: '', created: Date.now() };
  S.locations.push(l); return l.id;
}
function personLabel(p) { return p.name + (p.empId ? ' · ' + p.empId : ''); }
function findOrCreatePerson(label) {
  label = String(label || '').trim(); if (!label) return '';
  var p = S.people.filter(function (x) { return K.norm(personLabel(x)) === K.norm(label) || K.norm(x.name) === K.norm(label) || (x.empId && K.norm(x.empId) === K.norm(label)) || (x.email && K.norm(x.email) === K.norm(label)); })[0];
  if (p) return p.id;
  p = { id: uid(), name: label.replace(/\s·\s.*$/, ''), empId: '', email: '', dept: '', locationId: '', created: Date.now() };
  S.people.push(p); return p.id;
}
function nextTag() { return K.nextFreeTag(S.settings.prefix, S.settings.nextNum, S.assets.map(function (a) { return a.tag; })).tag; }
function bumpCounter(tag) {
  var n = K.tagNumber(tag, S.settings.prefix);
  if (n !== null && n >= S.settings.nextNum) S.settings.nextNum = n + 1;
}
function tagTaken(tag, exceptId) { var t = String(tag).toUpperCase(); return S.assets.some(function (a) { return a.id !== exceptId && String(a.tag).toUpperCase() === t; }); }
function serialDupe(serial, exceptId) {
  if (!serial) return null; var s = String(serial).toUpperCase();
  return S.assets.filter(function (a) { return a.id !== exceptId && a.serial && String(a.serial).toUpperCase() === s; })[0] || null;
}

function doCheckout(a, personId, dateIso, expected, notes) {
  a.assignedTo = personId; a.status = 'Assigned'; a.assignedAt = dateIso || today(); a.expectedReturn = expected || '';
  addHistory(a, 'checkout', 'Checked out to ' + personName(personId), [expected ? 'Expected back ' + dt(expected) : '', notes].filter(Boolean).join('. '));
}
function doCheckin(a, newStatus, notes, locId) {
  var who = personName(a.assignedTo);
  a.assignedTo = ''; a.expectedReturn = ''; a.assignedAt = '';
  a.status = newStatus || 'In stock';
  if (locId !== undefined && locId !== null && locId !== '') a.locationId = locId;
  addHistory(a, 'checkin', 'Checked in' + (who ? ' from ' + who : ''), [newStatus === 'In repair' ? 'Needs repair' : '', notes].filter(Boolean).join('. '));
}

/* ---- Asset form ---- */
var BRANDS = ['Dell', 'HP', 'Lenovo', 'Apple', 'Asus', 'Acer', 'Samsung', 'LG', 'BenQ', 'ViewSonic', 'Canon', 'Epson', 'Brother', 'Cisco', 'Aruba', 'Ubiquiti', 'TP-Link', 'D-Link', 'Netgear', 'Fortinet', 'Sophos', 'Hikvision', 'CP Plus', 'Dahua', 'APC', 'Microtek', 'Luminous', 'Xiaomi', 'OnePlus', 'Synology'];
function uniq(arr) { var seen = {}; return arr.filter(function (x) { if (!x || seen[x.toLowerCase()]) return false; seen[x.toLowerCase()] = 1; return true; }); }
function assetForm(existing, preset) {
  var a = existing || {};
  var isNew = !existing;
  var brands = uniq(S.assets.map(function (x) { return x.brand; }).concat(BRANDS));
  var vendors = uniq(S.assets.map(function (x) { return x.vendor; }).concat(S.maintenance.map(function (m) { return m.vendor; })));
  var locs = S.locations.map(function (l) { return l.name; });
  var statusOpts = K.STATUSES.filter(function (s) { return s !== 'Assigned'; });
  var fields = [
    { n: 'tag', l: 'Asset tag', req: true, h: 'Unique ID printed on the label. We fill in the next number for you.' },
    { n: 'category', l: 'Category', t: 'select', req: true, opts: K.CATEGORIES },
    { n: 'brand', l: 'Brand', list: brands, ph: 'e.g. Dell' },
    { n: 'model', l: 'Model', ph: 'e.g. Latitude 5440' },
    { n: 'serial', l: 'Serial number', ph: 'Printed under the device' },
    { n: 'location', l: 'Location', list: locs, ph: 'e.g. Bengaluru office', h: 'Type a new name to add a location.' },
    { n: 'purchaseDate', l: 'Purchase date', t: 'date' },
    { n: 'cost', l: 'Purchase cost (' + S.settings.symbol + ')', t: 'number', min: 0, step: 'any', ph: '0' },
    { n: 'vendor', l: 'Vendor', list: vendors, ph: 'Who you bought it from' },
    { n: 'invoice', l: 'Invoice number' },
    { n: 'warrantyEnd', l: 'Warranty ends', t: 'date', h: 'We will remind you 90, 60 and 30 days before.' }
  ];
  if (isNew) {
    fields.push({ n: 'status', l: 'Status', t: 'select', opts: statusOpts });
    fields.push({ n: 'assignTo', l: 'Give it to someone now (optional)', list: S.people.map(personLabel), ph: 'Type a name', h: 'Leave empty to keep it in stock.', full: true });
  } else if (a.status === 'Assigned' || a.assignedTo) {
    fields.push({ n: 'statusNote', t: 'note', html: 'This asset is with <b>' + esc(personName(a.assignedTo)) + '</b>. Use <b>Check in</b> to change its status.' });
  } else {
    fields.push({ n: 'status', l: 'Status', t: 'select', opts: statusOpts });
  }
  fields.push({ n: 'notes', l: 'Notes', t: 'textarea', full: true, ph: 'Specs, accessories, anything useful' });
  var values = isNew ? Object.assign({ tag: nextTag(), category: 'Laptop', status: 'In stock' }, preset || {}) :
    Object.assign({}, a, { location: locName(a.locationId), cost: a.cost ? a.cost : '' });
  formDialog({
    title: isNew ? 'Add asset' : 'Edit ' + a.tag, wide: true, fields: fields, values: values, submit: isNew ? 'Add asset' : 'Save changes',
    onSubmit: function (v, force) {
      var errors = {};
      if (tagTaken(v.tag, a.id)) errors.tag = 'Another asset already uses ' + v.tag + '. Tags must be unique.';
      if (!v.brand && !v.model) errors.model = 'Add a brand or model so people can recognise it.';
      if (v.purchaseDate && v.warrantyEnd && v.warrantyEnd < v.purchaseDate) errors.warrantyEnd = 'Warranty cannot end before the purchase date.';
      if (v.purchaseDate && v.purchaseDate > K.addDays(today(), 31)) errors.purchaseDate = 'This date is in the future. Please check it.';
      if (Object.keys(errors).length) return { errors: errors };
      var dupe = serialDupe(v.serial, a.id);
      if (dupe && !force) return { errors: { serial: 'Heads up: ' + dupe.tag + ' (' + assetTitle(dupe) + ') has the same serial number.' }, soft: true, msg: 'Same serial number found. Press "Save anyway" if this is correct.' };
      var target = isNew ? { id: uid(), created: Date.now(), history: [] } : a;
      var before = isNew ? null : JSON.parse(JSON.stringify(a));
      target.tag = v.tag; target.category = v.category; target.brand = v.brand; target.model = v.model; target.serial = v.serial;
      target.purchaseDate = v.purchaseDate; target.cost = v.cost === '' ? 0 : Number(v.cost); target.vendor = v.vendor; target.invoice = v.invoice;
      target.warrantyEnd = v.warrantyEnd; target.locationId = findOrCreateLocation(v.location); target.notes = v.notes;
      if (v.status) target.status = v.status;
      if (isNew) {
        target.assignedTo = ''; target.expectedReturn = '';
        S.assets.push(target);
        addHistory(target, 'created', 'Added to the register', v.status && v.status !== 'In stock' ? 'Status: ' + v.status : '');
        if (v.assignTo) doCheckout(target, findOrCreatePerson(v.assignTo), today(), '', '');
      } else {
        var labels = { tag: 'tag', category: 'category', brand: 'brand', model: 'model', serial: 'serial', purchaseDate: 'purchase date', cost: 'cost', vendor: 'vendor', invoice: 'invoice', warrantyEnd: 'warranty', locationId: 'location', notes: 'notes', status: 'status' };
        var changed = Object.keys(labels).filter(function (k) { return String(before[k] || '') !== String(target[k] || ''); });
        if (changed.indexOf('status') >= 0) addHistory(target, target.status === 'In repair' ? 'repair' : 'status', 'Status changed to ' + target.status, 'Was ' + before.status);
        changed = changed.filter(function (k) { return k !== 'status'; });
        if (changed.length) addHistory(target, 'edited', 'Details edited', 'Changed ' + changed.map(function (k) { return labels[k]; }).join(', '));
      }
      bumpCounter(target.tag);
      commit(isNew ? target.tag + ' added' : 'Changes saved');
      return true;
    }
  });
}

function checkoutForm(a) {
  formDialog({
    title: 'Check out ' + a.tag, submit: 'Check out',
    intro: '<p class="note">' + esc(assetTitle(a)) + (a.serial ? ' · S/N ' + esc(a.serial) : '') + '</p>',
    fields: [
      { n: 'person', l: 'Give to', req: true, list: S.people.map(personLabel), ph: 'Start typing a name', h: 'New names are added to People automatically.', full: true },
      { n: 'date', l: 'Date', t: 'date', v: today() },
      { n: 'expected', l: 'Expected back (optional)', t: 'date', h: 'For loaners and temporary use.' },
      { n: 'location', l: 'Where it will be used', list: S.locations.map(function (l) { return l.name; }), v: locName(a.locationId) },
      { n: 'notes', l: 'Condition and accessories', t: 'textarea', full: true, ph: 'e.g. Good condition, with charger and bag' }
    ],
    onSubmit: function (v) {
      if (v.expected && v.date && v.expected < v.date) return { errors: { expected: 'Return date must be after the check-out date.' } };
      var pid = findOrCreatePerson(v.person);
      if (v.location) a.locationId = findOrCreateLocation(v.location);
      doCheckout(a, pid, v.date, v.expected, v.notes);
      commit(a.tag + ' checked out to ' + personName(pid));
      return true;
    }
  });
}
function checkinForm(a) {
  formDialog({
    title: 'Check in ' + a.tag, submit: 'Check in',
    intro: '<p class="note">Returning from <b>' + esc(personName(a.assignedTo) || 'someone') + '</b>. ' + esc(assetTitle(a)) + '</p>',
    fields: [
      { n: 'cond', l: 'Condition', t: 'select', opts: [['In stock', 'Working, back in stock'], ['In repair', 'Needs repair'], ['Retired', 'Retire it'], ['Lost', 'Not returned / lost']], full: true },
      { n: 'location', l: 'Store it at', list: S.locations.map(function (l) { return l.name; }), v: locName(a.locationId) },
      { n: 'notes', l: 'Notes', t: 'textarea', full: true, ph: 'e.g. Screen scratched, charger missing' }
    ],
    onSubmit: function (v) {
      doCheckin(a, v.cond, v.notes, v.location ? findOrCreateLocation(v.location) : '');
      commit(a.tag + ' checked in');
      return true;
    }
  });
}
function deleteAsset(a) {
  var mCount = S.maintenance.filter(function (m) { return m.assetId === a.id; }).length;
  confirmBox({ title: 'Delete ' + a.tag + '?', ok: 'Delete asset', danger: true,
    body: '<p>This removes <b>' + esc(assetTitle(a)) + '</b> and its history' + (mCount ? ' and ' + plural(mCount, 'maintenance record') : '') + '. This cannot be undone.</p><p class="note">Tip: if the device was scrapped or sold, set its status to <b>Retired</b> instead so the history is kept.</p>' })
    .then(function (ok) {
      if (!ok) return;
      S.assets = S.assets.filter(function (x) { return x !== a; });
      S.maintenance = S.maintenance.filter(function (m) { return m.assetId !== a.id; });
      persist(); location.hash = '#/assets'; toast(a.tag + ' deleted');
    });
}

/* ---- Backup / restore / sample ---- */
function backup() {
  var stamp = today();
  download('daftarbox-it-assets-backup-' + stamp + '.json', JSON.stringify({ app: 'daftarbox-it-assets', version: 1, exported: new Date().toISOString(), data: S }, null, 1), 'application/json');
  toast('Backup downloaded');
}
function restorePick() { var f = $('#restoreFile'); f.value = ''; f.click(); }
function restoreFromFile(file) {
  if (!file) return;
  if (file.size > 50 * 1024 * 1024) { toast('That file is too big to be a backup.'); return; }
  var r = new FileReader();
  r.onload = function () {
    var obj;
    try { obj = JSON.parse(r.result); } catch (e) { toast('This file is not a valid backup (it is not JSON).', 5000); return; }
    var data = obj && obj.app === 'daftarbox-it-assets' ? obj.data : obj;
    if (!data || !Array.isArray(data.assets)) { toast('This does not look like an IT assets backup.', 5000); return; }
    var n = normalize(data);
    confirmBox({ title: 'Restore this backup?', ok: 'Replace my data', danger: true,
      body: '<p>The backup has <b>' + plural(n.assets.length, 'asset') + '</b>, ' + plural(n.people.length, 'person', 'people') + ', ' + plural(n.licences.length, 'licence') + ' and ' + plural(n.locations.length, 'location') + (obj.exported ? ', saved on ' + esc(K.fmtDate(String(obj.exported).slice(0, 10))) : '') + '.</p><p class="warn">Everything currently in this browser will be replaced. Download a backup first if you are not sure.</p>' })
      .then(function (ok) { if (!ok) return; S = n; commit('Backup restored'); });
  };
  r.onerror = function () { toast('Could not read that file.'); };
  r.readAsText(file);
}
function removeSample() {
  var gone = {};
  ['assets', 'people', 'licences', 'maintenance', 'locations'].forEach(function (k) { S[k].forEach(function (x) { if (x.sample) gone[x.id] = 1; }); S[k] = S[k].filter(function (x) { return !x.sample; }); });
  S.assets.forEach(function (a) {
    if (a.assignedTo && gone[a.assignedTo]) { doCheckin(a, 'In stock', 'Sample person removed'); }
    if (a.locationId && gone[a.locationId]) a.locationId = '';
  });
  S.people.forEach(function (p) { if (gone[p.locationId]) p.locationId = ''; });
  S.licences.forEach(function (l) { l.assigned = l.assigned.filter(function (id) { return !gone[id]; }); });
  S.maintenance = S.maintenance.filter(function (m) { return !gone[m.assetId]; });
  var max = 0; S.assets.forEach(function (a) { var n = K.tagNumber(a.tag, S.settings.prefix); if (n > max) max = n; });
  S.settings.nextNum = max + 1;
  commit('Sample data removed');
}
function loadSample() {
  var t = today();
  function ago(days) { return K.addDays(t, -days); }
  function fwd(days) { return K.addDays(t, days); }
  var L = [
    { id: uid(), name: 'Bengaluru HQ', type: 'Office', city: 'Bengaluru', notes: '3rd floor, Koramangala', sample: true },
    { id: uid(), name: 'Pune branch', type: 'Office', city: 'Pune', notes: 'Baner', sample: true },
    { id: uid(), name: 'Server room', type: 'Room', city: 'Bengaluru', notes: 'Inside HQ, key with admin', sample: true },
    { id: uid(), name: 'IT store', type: 'Store', city: 'Bengaluru', notes: 'Spares cupboard', sample: true }
  ];
  var P = [
    ['Ananya Iyer', 'EMP-101', 'Engineering', 0], ['Rohit Sharma', 'EMP-102', 'Sales', 1], ['Fatima Khan', 'EMP-103', 'Finance', 0],
    ['Vikram Reddy', 'EMP-104', 'Engineering', 0], ['Neha Patil', 'EMP-105', 'Operations', 1], ['Arjun Mehta', 'EMP-106', 'Design', 0]
  ].map(function (r) { return { id: uid(), name: r[0], empId: r[1], email: r[0].split(' ')[0].toLowerCase() + '@example.com', dept: r[2], locationId: L[r[3]].id, sample: true }; });
  var rows = [
    /* cat, brand, model, cost, ageDays, warrantyFromNow, loc, person, status */
    ['Laptop', 'Dell', 'Latitude 5440', 78500, 700, 395, 0, 0, 'Assigned'],
    ['Laptop', 'Lenovo', 'ThinkPad E14 Gen 5', 69900, 1070, 25, 1, 1, 'Assigned'],
    ['Laptop', 'Apple', 'MacBook Air M2', 114900, 400, 330, 0, 5, 'Assigned'],
    ['Laptop', 'HP', 'ProBook 440 G10', 64200, 1400, -300, 3, -1, 'In repair'],
    ['Laptop', 'Dell', 'Vostro 3520', 52000, 200, 530, 3, -1, 'In stock'],
    ['Desktop', 'HP', 'Pro Tower 280 G9', 48500, 900, 55, 0, 2, 'Assigned'],
    ['Monitor', 'LG', '24MP400 24"', 9800, 650, 80, 0, 0, 'Assigned'],
    ['Monitor', 'BenQ', 'GW2490 24"', 10400, 300, 800, 3, -1, 'In stock'],
    ['Printer', 'Brother', 'HL-L2321D', 12900, 1200, -100, 1, -1, 'In stock'],
    ['Server', 'Dell', 'PowerEdge T150', 185000, 800, 300, 2, -1, 'In stock'],
    ['Network switch', 'Cisco', 'CBS250-24T-4G', 32500, 950, 45, 2, -1, 'In stock'],
    ['Access point', 'TP-Link', 'Omada EAP650', 11500, 500, 230, 0, -1, 'In stock'],
    ['Firewall', 'Fortinet', 'FortiGate 40F', 54000, 600, 20, 2, -1, 'In stock'],
    ['CCTV camera', 'CP Plus', '4MP Dome', 3400, 450, 280, 0, -1, 'In stock'],
    ['NVR', 'Hikvision', '8-channel NVR', 8900, 450, 280, 2, -1, 'In stock'],
    ['UPS', 'APC', 'Smart-UPS 1500VA', 42000, 1500, -400, 2, -1, 'In stock'],
    ['Phone', 'Samsung', 'Galaxy A35', 30999, 150, 215, 1, 4, 'Assigned'],
    ['Tablet', 'Apple', 'iPad 10th gen', 34900, 1900, -1100, 3, -1, 'Retired']
  ];
  var vendors = ['Croma Business', 'Reliance Digital', 'Supertron Electronics', 'Ingram Micro India', 'Redington'];
  var start = S.settings.nextNum;
  var existing = S.assets.map(function (a) { return a.tag; });
  rows.forEach(function (r, i) {
    var nt = K.nextFreeTag(S.settings.prefix, start, existing); start = nt.n + 1; existing.push(nt.tag);
    var a = { id: uid(), tag: nt.tag, category: r[0], brand: r[1], model: r[2], serial: 'SN' + (482910 + i * 7371).toString(36).toUpperCase() + i, purchaseDate: ago(r[4]), cost: r[3],
      vendor: vendors[i % vendors.length], invoice: 'INV/' + (2300 + i * 13), warrantyEnd: fwd(r[5]), locationId: L[r[6]].id, status: 'In stock', assignedTo: '', expectedReturn: '', notes: '', history: [], sample: true, created: Date.now() };
    a.history.push({ at: Date.now() - r[4] * 86400000, k: 'created', t: 'Added to the register', d: 'Sample data' });
    if (r[8] === 'Assigned') { doCheckout(a, P[r[7]].id, ago(Math.min(r[4], 60)), i === 2 ? ago(5) : '', 'Good condition'); }
    else a.status = r[8];
    if (r[8] === 'In repair') addHistory(a, 'repair', 'Sent for repair', 'Keyboard not working');
    S.assets.push(a);
  });
  S.settings.nextNum = start;
  var A = S.assets.filter(function (a) { return a.sample; });
  S.maintenance.push(
    { id: uid(), assetId: A[3].id, date: ago(6), type: 'Repair', vendor: 'HP authorised service, Indiranagar', cost: 4200, status: 'Open', notes: 'Keyboard replacement', sample: true },
    { id: uid(), assetId: A[9].id, date: ago(90), type: 'Service', vendor: 'Supertron Electronics', cost: 3500, status: 'Done', notes: 'Annual check, fans cleaned, firmware updated', sample: true },
    { id: uid(), assetId: A[15].id, date: ago(40), type: 'Repair', vendor: 'APC service centre', cost: 9800, status: 'Done', notes: 'Battery replaced', sample: true }
  );
  S.licences.push(
    { id: uid(), name: 'Microsoft 365 Business Standard', vendor: 'Microsoft', key: 'Tenant: example.onmicrosoft.com', seats: 5, assigned: P.slice(0, 6).map(function (p) { return p.id; }), cost: 61200, purchaseDate: ago(320), renewalDate: fwd(45), notes: 'Annual plan, billed yearly', sample: true },
    { id: uid(), name: 'Adobe Creative Cloud', vendor: 'Adobe', key: 'ABCD-1234-EFGH-5678', seats: 2, assigned: [P[5].id], cost: 54000, purchaseDate: ago(200), renewalDate: fwd(165), notes: '', sample: true },
    { id: uid(), name: 'Tally Prime Silver', vendor: 'Tally Solutions', key: 'TP-77X1-9QK2-LM44', seats: 1, assigned: [P[2].id], cost: 22500, purchaseDate: ago(700), renewalDate: '', notes: 'Perpetual licence', sample: true },
    { id: uid(), name: 'Quick Heal Endpoint Security', vendor: 'Quick Heal', key: 'QH-2231-0098-7781', seats: 10, assigned: P.map(function (p) { return p.id; }), cost: 18000, purchaseDate: ago(350), renewalDate: fwd(15), notes: '', sample: true }
  );
  S.locations = S.locations.concat(L); S.people = S.people.concat(P);
  if (!S.settings.org) S.settings.org = '';
  commit('Sample data loaded. Remove it any time with one click.');
}

/* ================= Router ================= */
var ROUTES = {};
var currentRoute = '';
function parseHash() {
  var h = location.hash.replace(/^#\/?/, '');
  var qi = h.indexOf('?');
  var path = qi >= 0 ? h.slice(0, qi) : h, qs = qi >= 0 ? h.slice(qi + 1) : '';
  var parts = path.split('/').filter(Boolean).map(function (x) { try { return decodeURIComponent(x); } catch (e) { return x; } });
  var q = {};
  qs.split('&').forEach(function (kv) { if (!kv) return; var p = kv.split('='); try { q[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || '').replace(/\+/g, ' ')); } catch (e) {} });
  return { name: parts[0] || 'dashboard', id: parts[1] || '', q: q };
}
function route() {
  if (!S) return;
  var r = parseHash();
  var fn = ROUTES[r.name] || ROUTES.dashboard;
  var navKey = { asset: 'assets', person: 'people', licence: 'licences', location: 'locations' }[r.name] || r.name;
  $$('.nav a').forEach(function (a) { if (a.getAttribute('data-r') === navKey) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  var key = r.name + '/' + r.id + '/' + (r.q.tool || '');
  var changed = key !== currentRoute;
  currentRoute = key;
  var view = $('#view');
  var y = window.scrollY;
  try { fn(view, r); } catch (e) { console.error(e); view.innerHTML = '<div class="empty" style="margin-top:30px"><h2>Something went wrong</h2><p>' + esc(e.message) + '</p><a class="btn" href="#/">Go to dashboard</a></div>'; }
  var h1 = $('h1', view);
  document.title = (h1 ? h1.textContent + ' – ' : '') + 'IT assets – Daftarbox';
  if (changed) { window.scrollTo(0, 0); if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); } }
  else window.scrollTo(0, y);
}
window.addEventListener('hashchange', route);

/* Global click actions */
document.addEventListener('click', function (e) {
  var b = e.target.closest && e.target.closest('[data-act]');
  if (!b) return;
  var act = b.getAttribute('data-act'), id = b.getAttribute('data-id');
  var fn = ACTIONS[act];
  if (fn) { e.preventDefault(); fn(id, b); }
});
var ACTIONS = {
  backup: backup, restore: restorePick,
  'add-asset': function () { assetForm(null); },
  'edit-asset': function (id) { var a = asset(id); if (a) assetForm(a); },
  'checkout': function (id) { var a = asset(id); if (a) checkoutForm(a); },
  'checkin': function (id) { var a = asset(id); if (a) checkinForm(a); },
  'delete-asset': function (id) { var a = asset(id); if (a) deleteAsset(a); },
  'load-sample': loadSample,
  'remove-sample': function () {
    confirmBox({ title: 'Remove sample data?', ok: 'Remove sample data', danger: true, body: '<p>All records marked as sample are deleted. Anything you added yourself stays.</p>' }).then(function (ok) { if (ok) removeSample(); });
  }
};

function sampleBanner() {
  return hasSample() ? '<div class="banner" role="note">' + ico('spark').replace('<svg', '<svg width="20" height="20"') + '<span>You are looking at <b>sample data</b>. Explore freely, then remove it when you are ready to add your own.</span><button type="button" class="btn small dark" data-act="remove-sample">Remove sample data</button></div>' : '';
}

function boot() {
  $('#restoreFile').addEventListener('change', function () { restoreFromFile(this.files[0]); });
  loadState().then(function () {
    $('#storeKind').textContent = storeKind;
    setupSync();
    route();
  }).catch(function (e) {
    $('#view').innerHTML = '<div class="empty" style="margin-top:30px"><h2>Could not open storage</h2><p>Your browser blocked local storage (private mode can do this). ' + esc(e && e.message) + '</p></div>';
  });
}
document.addEventListener('DOMContentLoaded', boot);
