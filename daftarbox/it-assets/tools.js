/* Daftarbox IT assets: reports, CSV import/export, QR labels, depreciation, settings. */
'use strict';

/* ---------- Lazy script loader (CDN libraries) ---------- */
var QR_URL = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js'; /* MIT licence */
var scriptCache = {};
function loadScript(url) {
  if (scriptCache[url]) return scriptCache[url];
  scriptCache[url] = new Promise(function (res, rej) {
    var s = document.createElement('script');
    s.src = url; s.async = true; s.crossOrigin = 'anonymous'; s.referrerPolicy = 'no-referrer';
    s.onload = function () { res(); };
    s.onerror = function () { delete scriptCache[url]; s.remove(); rej(new Error('Could not load ' + url)); };
    document.head.appendChild(s);
  });
  return scriptCache[url];
}
function qrSvg(text) {
  var qr = window.qrcode(0, 'M');
  qr.addData(String(text)); qr.make();
  var n = qr.getModuleCount(), m = 2, d = '';
  for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (qr.isDark(r, c)) d += 'M' + (c + m) + ' ' + (r + m) + 'h1v1h-1z';
  var size = n + m * 2;
  return '<svg viewBox="0 0 ' + size + ' ' + size + '" shape-rendering="crispEdges" role="img" aria-label="QR code for ' + esc(text) + '"><rect width="' + size + '" height="' + size + '" fill="#fff"/><path fill="#000" d="' + d + '"/></svg>';
}

/* ---------- CSV exports ---------- */
function fileStamp() { return today(); }
function exportAssets() {
  var t = today();
  var rows = [['Asset tag', 'Category', 'Brand', 'Model', 'Serial number', 'Status', 'Assigned to', 'Employee ID', 'Location', 'Purchase date', 'Purchase cost', 'Vendor', 'Invoice number', 'Warranty end', 'Expected return', 'Value today', 'Notes']];
  S.assets.forEach(function (a) {
    var p = person(a.assignedTo);
    rows.push([a.tag, a.category, a.brand, a.model, a.serial, a.status, p ? p.name : '', p ? p.empId : '', locName(a.locationId), a.purchaseDate, +a.cost || 0, a.vendor, a.invoice, a.warrantyEnd, a.expectedReturn || '', Math.round(dep(a, t).book), a.notes]);
  });
  download('assets-' + fileStamp() + '.csv', K.toCSV(rows), 'text/csv'); toast(plural(S.assets.length, 'asset') + ' exported');
}
function exportLicences(withKeys) {
  var head = ['Software', 'Vendor', 'Seats bought', 'Seats used', 'Assigned to', 'Cost', 'Purchase date', 'Renewal date', 'Notes'];
  if (withKeys) head.splice(2, 0, 'Licence key');
  var rows = [head];
  S.licences.forEach(function (l) {
    var r = [l.name, l.vendor, l.seats, l.assigned.length, l.assigned.map(personName).filter(Boolean).join('; '), +l.cost || 0, l.purchaseDate, l.renewalDate, l.notes];
    if (withKeys) r.splice(2, 0, l.key || '');
    rows.push(r);
  });
  download('licences-' + fileStamp() + '.csv', K.toCSV(rows), 'text/csv'); toast(plural(S.licences.length, 'licence') + ' exported');
}
function exportPeople() {
  var rows = [['Name', 'Employee ID', 'Email', 'Department', 'Location', 'Assets held', 'Licences']];
  S.people.forEach(function (p) {
    rows.push([p.name, p.empId, p.email, p.dept, locName(p.locationId), personAssets(p.id).map(function (a) { return a.tag; }).join('; '), personLicences(p.id).map(function (l) { return l.name; }).join('; ')]);
  });
  download('people-' + fileStamp() + '.csv', K.toCSV(rows), 'text/csv'); toast(plural(S.people.length, 'person', 'people') + ' exported');
}
function exportMaint() {
  var rows = [['Date', 'Asset tag', 'Asset', 'Type', 'Done by', 'Status', 'Cost', 'Notes']];
  S.maintenance.forEach(function (m) { var a = asset(m.assetId); rows.push([m.date, a ? a.tag : '', a ? assetTitle(a) : '', m.type, m.vendor, m.status, +m.cost || 0, m.notes]); });
  download('maintenance-' + fileStamp() + '.csv', K.toCSV(rows), 'text/csv'); toast(plural(S.maintenance.length, 'record') + ' exported');
}
function downloadTemplate() {
  var rows = [K.IMPORT_FIELDS.map(function (f) { return f.label; }),
    ['', 'Laptop', 'Dell', 'Latitude 5440', 'ABC1234', '15/04/2025', '78500', 'Croma Business', 'INV/2291', '14/04/2028', 'Bengaluru HQ', 'In stock', '', 'With charger'],
    ['', 'Monitor', 'LG', '24MP400', 'LG998877', '02/01/2025', '9800', '', '', '01/01/2028', 'Bengaluru HQ', 'Assigned', 'Ananya Iyer', '']];
  download('asset-import-template.csv', K.toCSV(rows), 'text/csv');
}
ACTIONS['export-assets'] = exportAssets;
ACTIONS['export-people'] = exportPeople;
ACTIONS['export-maint'] = exportMaint;
ACTIONS['export-licences'] = function () {
  if (!S.licences.some(function (l) { return l.key; })) { exportLicences(false); return; }
  formDialog({ title: 'Export licences', submit: 'Download CSV',
    fields: [{ n: 'keys', l: 'Include licence keys in the file', t: 'checkbox' }, { n: 'n', t: 'note', html: 'Keys are left out by default so the file is safe to share.' }],
    onSubmit: function (v) { exportLicences(v.keys); return true; } });
};
ACTIONS['template'] = downloadTemplate;
ACTIONS['label-one'] = function (id) { LBL.sel = [id]; LBL.scope = 'pick'; location.hash = '#/reports?tool=labels'; };

/* ================= Reports router ================= */
ROUTES.reports = function (view, r) {
  var tool = r.q.tool || '';
  if (tool === 'import') return renderImport(view);
  if (tool === 'labels') return renderLabels(view);
  if (tool === 'depreciation') return renderDep(view);
  var card = function (icon, title, text, acts) { return '<div class="tool"><span class="ic">' + ico(icon) + '</span><h3>' + title + '</h3><p>' + text + '</p><div class="acts">' + acts + '</div></div>'; };
  var dis = function (n) { return n ? '' : ' disabled'; };
  view.innerHTML = pageHead({ title: 'Reports & tools', sub: 'Get data in and out, print labels, and see what your hardware is worth today.' }) +
    '<div class="tools">' +
      card('upload', 'Import assets from CSV', 'Bring in your existing Excel or Google Sheets list. Match the columns, check the preview, then import.', '<a class="btn small" href="#/reports?tool=import">Start import</a><button type="button" class="btn ghost small" data-act="template">Template</button>') +
      card('qr', 'Print asset labels', 'QR code labels on an A4 sheet. Scan the code with any phone to read the asset tag.', '<a class="btn small" href="#/reports?tool=labels">Make labels</a>') +
      card('trend', 'Depreciation report', 'Straight-line value of every asset, by category, on any date. Export for your accountant.', '<a class="btn small" href="#/reports?tool=depreciation">Open report</a>') +
    '</div>' +
    '<section class="card"><div class="card-h"><h2>Export to CSV</h2><span class="sub">Opens in Excel, Google Sheets or Numbers</span></div><div class="card-b" style="display:flex;gap:10px;flex-wrap:wrap">' +
      '<button type="button" class="btn ghost" data-act="export-assets"' + dis(S.assets.length) + '>' + ico('download') + 'Assets (' + S.assets.length + ')</button>' +
      '<button type="button" class="btn ghost" data-act="export-licences"' + dis(S.licences.length) + '>' + ico('download') + 'Licences (' + S.licences.length + ')</button>' +
      '<button type="button" class="btn ghost" data-act="export-people"' + dis(S.people.length) + '>' + ico('download') + 'People (' + S.people.length + ')</button>' +
      '<button type="button" class="btn ghost" data-act="export-maint"' + dis(S.maintenance.length) + '>' + ico('download') + 'Maintenance (' + S.maintenance.length + ')</button>' +
    '</div></section>' +
    '<section class="card"><div class="card-h"><h2>Full backup</h2></div><div class="card-b"><p style="margin:0 0 12px;color:var(--muted)">A backup file holds everything, including history and settings. Keep one somewhere safe, or use it to move to another computer.</p><div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" class="btn" data-act="backup">' + ico('download') + 'Download backup</button><button type="button" class="btn ghost" data-act="restore">' + ico('upload') + 'Restore from backup</button></div></div></section>';
};

/* ================= Import ================= */
var IMP = { step: 1, name: '', rows: null, headers: null, map: null, results: null };
function renderImport(view) {
  var steps = ['Choose file', 'Match columns', 'Check and import'];
  var head = pageHead({ back: ['#/reports', 'Reports & tools'], title: 'Import assets', sub: 'Works with CSV files saved from Excel, Google Sheets or any other tool. Dates can be DD/MM/YYYY.' }) +
    '<ol class="stepper" aria-label="Import steps" style="list-style:none;padding:0">' + steps.map(function (s, i) { return '<li style="display:contents"><span' + (IMP.step === i + 1 ? ' aria-current="step"' : '') + '>' + (i + 1) + '. ' + s + '</span></li>'; }).join('') + '</ol>';
  if (IMP.step === 1 || !IMP.rows) {
    IMP.step = 1;
    view.innerHTML = head + '<section class="card"><div class="card-b"><div class="drop" id="drop"><div class="art" style="width:56px;height:56px;margin:0 auto 10px;border-radius:16px;background:var(--accent-soft);color:var(--accent);display:grid;place-items:center">' + ico('file') + '</div>' +
      '<label class="btn" for="csvIn" style="font-size:1.05rem;padding:14px 28px">' + ico('upload') + 'Choose CSV file</label><input type="file" id="csvIn" accept=".csv,.txt,text/csv" class="sr">' +
      '<p>or drop it here. First row should be column names. In Excel use <b>File → Save as → CSV UTF-8</b>.</p><p class="status err" id="impErr" role="alert"></p></div>' +
      '<p style="margin:14px 0 0;font-size:.9rem;color:var(--muted)">Not sure about the format? <button type="button" class="linkish" data-act="template">Download a template</button> with example rows.</p></div></section>';
    var drop = $('#drop');
    var take = function (file) {
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) { $('#impErr').textContent = 'This file is over 10 MB. Split it into smaller files.'; return; }
      if (/\.xlsx?$/i.test(file.name)) { $('#impErr').textContent = 'This is an Excel file. Please save it as CSV first (File → Save as → CSV UTF-8).'; return; }
      var fr = new FileReader();
      fr.onload = function () {
        var rows = K.parseCSV(fr.result);
        if (rows.length < 2) { $('#impErr').textContent = 'We could not find any rows below the header in this file.'; return; }
        if (rows.length > 5001) { $('#impErr').textContent = 'That is more than 5,000 rows. Please split the file.'; return; }
        IMP.name = file.name; IMP.headers = rows[0].map(function (h, i) { return String(h).trim() || 'Column ' + (i + 1); }); IMP.rows = rows.slice(1);
        IMP.map = K.guessMapping(IMP.headers); IMP.step = 2; route();
      };
      fr.onerror = function () { $('#impErr').textContent = 'Could not read that file.'; };
      fr.readAsText(file);
    };
    $('#csvIn').addEventListener('change', function () { take(this.files[0]); });
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('drag'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('drag'); }); });
    drop.addEventListener('drop', function (e) { take(e.dataTransfer.files[0]); });
    return;
  }
  if (IMP.step === 2) {
    var first = IMP.rows[0] || [];
    view.innerHTML = head + '<section class="card"><div class="card-h"><h2>Match your columns</h2><span class="sub">' + esc(IMP.name) + ' · ' + plural(IMP.rows.length, 'row') + '</span></div><div class="card-b">' +
      '<p class="note">We guessed the matches. Change any that look wrong, or pick “Skip” for fields you do not have. You need at least a brand, model or serial number column.</p>' +
      K.IMPORT_FIELDS.map(function (f) {
        var cur = IMP.map[f.key];
        return '<div class="maprow"><label for="m_' + f.key + '">' + esc(f.label) + '</label><select id="m_' + f.key + '" data-k="' + f.key + '"><option value="">— Skip —</option>' +
          IMP.headers.map(function (h, i) { return '<option value="' + i + '"' + (cur === i ? ' selected' : '') + '>' + esc(h) + '</option>'; }).join('') + '</select>' +
          '<span class="ex" id="ex_' + f.key + '">' + (cur !== undefined && first[cur] ? 'e.g. ' + esc(first[cur]) : '') + '</span></div>';
      }).join('') +
      (K.IMPORT_FIELDS.some(function (f) { return f.key === 'tag'; }) ? '<p style="margin:12px 0 0;font-size:.88rem;color:var(--muted)">Rows without an asset tag get the next free tag (' + esc(nextTag()) + ', …).</p>' : '') +
      '<p class="status err" id="mapErr" role="alert"></p><div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px"><button type="button" class="btn" id="mapNext">Check rows</button><button type="button" class="btn ghost" id="mapBack">Choose another file</button></div></div></section>';
    $$('.maprow select', view).forEach(function (s) {
      s.addEventListener('change', function () {
        var k = s.getAttribute('data-k');
        if (s.value === '') delete IMP.map[k]; else IMP.map[k] = +s.value;
        $('#ex_' + k).textContent = s.value !== '' && first[+s.value] ? 'e.g. ' + first[+s.value] : '';
      });
    });
    $('#mapBack').addEventListener('click', function () { IMP = { step: 1 }; route(); });
    $('#mapNext').addEventListener('click', function () {
      if (IMP.map.brand === undefined && IMP.map.model === undefined && IMP.map.serial === undefined) { $('#mapErr').textContent = 'Please match at least one of Brand, Model or Serial number.'; return; }
      var used = {}, clash = null;
      Object.keys(IMP.map).forEach(function (k) { var i = IMP.map[k]; if (used[i]) clash = IMP.headers[i]; used[i] = 1; });
      if (clash) { $('#mapErr').textContent = 'The column “' + clash + '” is matched to two fields. Pick it once.'; return; }
      IMP.results = K.validateImport(IMP.rows, IMP.map, {
        existingTags: S.assets.map(function (a) { return a.tag; }), existingSerials: S.assets.map(function (a) { return a.serial; }),
        people: S.people, locations: S.locations
      });
      IMP.step = 3; route();
    });
    return;
  }
  /* step 3 */
  var res = IMP.results;
  var ok = res.filter(function (x) { return !x.errors.length; });
  var bad = res.filter(function (x) { return x.errors.length; });
  var warn = res.filter(function (x) { return !x.errors.length && x.warnings.length; });
  var issues = bad.concat(warn).sort(function (a, b) { return a.line - b.line; });
  view.innerHTML = head +
    '<div class="tiles"><div class="tile"><span class="ic">' + ico('check') + '</span><b>' + ok.length + '</b><span>Ready to import</span></div><div class="tile"><span class="ic">' + ico('alert') + '</span><b>' + bad.length + '</b><span>Rows with errors (skipped)</span></div><div class="tile"><span class="ic">' + ico('spark') + '</span><b>' + warn.length + '</b><span>Rows with notes</span></div></div>' +
    (issues.length ? '<section class="card"><div class="card-h"><h2>Problems by row</h2><span class="sub">Row numbers match your spreadsheet</span></div><div class="card-b"><ul class="issues">' + issues.slice(0, 300).map(function (x) {
      return '<li><b>Row ' + x.line + '</b>' + x.errors.map(function (e) { return '<span class="e">' + esc(e) + '</span> '; }).join('') + x.warnings.map(function (w) { return '<span class="w">' + esc(w) + '</span> '; }).join('') + '</li>';
    }).join('') + (issues.length > 300 ? '<li>…and ' + (issues.length - 300) + ' more rows.</li>' : '') + '</ul></div></section>' : '') +
    '<section class="card"><div class="card-h"><h2>Preview</h2><span class="sub">' + (ok.length > 20 ? 'First 20 of ' + ok.length : plural(ok.length, 'row')) + '</span></div>' +
    (ok.length ? '<div class="tscroll"><table class="t rt"><thead><tr><th>Row</th><th>Tag</th><th>Asset</th><th>Category</th><th>Serial</th><th>Status</th><th>Purchased</th><th class="num">Cost</th></tr></thead><tbody>' + ok.slice(0, 20).map(function (x) {
      var d = x.data;
      return '<tr><td data-l="Row" class="first">' + x.line + '</td><td data-l="Tag">' + (d.tag ? '<span class="tag">' + esc(d.tag) + '</span>' : '<span class="mut">auto</span>') + '</td><td data-l="Asset">' + esc([d.brand, d.model].filter(Boolean).join(' ')) + '</td><td data-l="Category">' + esc(d.category) + '</td><td data-l="Serial">' + esc(d.serial) + '</td><td data-l="Status">' + statusPill(d.status) + '</td><td data-l="Purchased">' + esc(dt(d.purchaseDate)) + '</td><td data-l="Cost" class="num">' + (d.cost ? esc(money(d.cost)) : '') + '</td></tr>';
    }).join('') + '</tbody></table></div>' : '<div class="card-b"><p style="margin:0;color:var(--muted)">No rows can be imported. Fix the problems above in your spreadsheet and try again.</p></div>') + '</section>' +
    '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px"><button type="button" class="btn" id="doImp"' + (ok.length ? '' : ' disabled') + '>' + ico('upload') + 'Import ' + plural(ok.length, 'asset') + '</button><button type="button" class="btn ghost" id="impBack">Back to columns</button></div>';
  $('#impBack').addEventListener('click', function () { IMP.step = 2; route(); });
  $('#doImp').addEventListener('click', function () {
    var reserved = S.assets.map(function (a) { return a.tag; }).concat(ok.map(function (x) { return x.data.tag; }).filter(Boolean));
    var n = S.settings.nextNum;
    ok.forEach(function (x) {
      var d = x.data, tag = d.tag;
      if (!tag) { var nt = K.nextFreeTag(S.settings.prefix, n, reserved); tag = nt.tag; n = nt.n + 1; reserved.push(tag); }
      var a = { id: uid(), tag: tag, category: d.category, brand: d.brand, model: d.model, serial: d.serial, purchaseDate: d.purchaseDate, cost: d.cost, vendor: d.vendor, invoice: d.invoice,
        warrantyEnd: d.warrantyEnd, locationId: d.locationId || findOrCreateLocation(d.locationName), status: d.status, assignedTo: '', expectedReturn: '', notes: d.notes, history: [], created: Date.now() };
      addHistory(a, 'created', 'Imported from ' + IMP.name, 'Row ' + x.line);
      if (d.assignedTo && person(d.assignedTo)) doCheckout(a, d.assignedTo, today(), '', 'Imported');
      S.assets.push(a); bumpCounter(tag);
    });
    var count = ok.length;
    IMP = { step: 1 };
    persist(); location.hash = '#/assets'; toast(plural(count, 'asset') + ' imported');
  });
}

/* ================= Labels ================= */
var LAYOUTS = { s: { name: 'Small: 3 across, 24 per A4', cols: 3, lh: '32mm', qr: '24mm', per: 24 }, m: { name: 'Medium: 2 across, 14 per A4', cols: 2, lh: '36mm', qr: '30mm', per: 14 }, l: { name: 'Large: 2 across, 10 per A4', cols: 2, lh: '50mm', qr: '42mm', per: 10 } };
var LBL = { scope: 'all', cat: '', loc: '', layout: 's', sel: [], serial: true };
function labelAssets() {
  if (LBL.scope === 'pick') return S.assets.filter(function (a) { return LBL.sel.indexOf(a.id) >= 0; });
  return S.assets.filter(function (a) { return (!LBL.cat || a.category === LBL.cat) && (!LBL.loc || a.locationId === LBL.loc) && a.status !== 'Retired' && a.status !== 'Lost'; });
}
function labelHtml(a) {
  return '<div class="lbl">' + qrSvg(a.tag) + '<div class="lt"><div class="o">' + esc(S.settings.org || 'Property of the company') + '</div><div class="g">' + esc(a.tag) + '</div><div class="m">' + esc(assetTitle(a)) + '</div>' + (LBL.serial && a.serial ? '<div class="s">S/N ' + esc(a.serial) + '</div>' : '') + '</div></div>';
}
function renderLabels(view) {
  if (!S.assets.length) { view.innerHTML = pageHead({ back: ['#/reports', 'Reports & tools'], title: 'Asset labels' }) + emptyBox({ title: 'No assets to label', icon: 'qr', text: 'Add some assets first.', acts: '<button class="btn" type="button" data-act="add-asset">' + ico('plus') + 'Add asset</button>' }); return; }
  var opt = function (list, cur, all) { return '<option value="">' + all + '</option>' + list.map(function (o) { var v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o; return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join(''); };
  view.innerHTML = pageHead({ back: ['#/reports', 'Reports & tools'], title: 'Asset labels', sub: 'Print on plain A4 paper or A4 sticker sheets. Each QR code holds the asset tag.' }) +
    '<div class="work"><section class="card"><div class="card-h"><h2>Preview</h2><span class="sub" id="lcount"></span></div><div class="card-b tscroll" id="lprev"><p style="color:var(--muted)">Loading QR code maker…</p></div></section>' +
    '<aside class="opts"><h2>Options</h2>' +
      '<label class="f" for="lscope">Which assets<select id="lscope"><option value="all"' + (LBL.scope !== 'pick' ? ' selected' : '') + '>By filter below</option><option value="pick"' + (LBL.scope === 'pick' ? ' selected' : '') + '>Pick one by one</option></select></label>' +
      '<div id="lfilters"><label class="f" for="lcat">Category<select id="lcat">' + opt(K.CATEGORIES, LBL.cat, 'All categories') + '</select></label>' +
      '<label class="f" for="lloc">Location<select id="lloc">' + opt(S.locations.map(function (l) { return [l.id, l.name]; }), LBL.loc, 'All locations') + '</select><span class="h">Retired and lost assets are left out.</span></label></div>' +
      '<div id="lpick" class="f"><span style="font-weight:600;font-size:.92rem">Assets</span><div class="checklist" style="margin-top:6px">' + S.assets.slice().sort(function (a, b) { return a.tag < b.tag ? -1 : 1; }).map(function (a) {
        return '<label><input type="checkbox" value="' + a.id + '"' + (LBL.sel.indexOf(a.id) >= 0 ? ' checked' : '') + '> <span class="mono">' + esc(a.tag) + '</span> <small>' + esc(assetTitle(a)) + '</small></label>';
      }).join('') + '</div></div>' +
      '<label class="f" for="llay">Label size<select id="llay">' + Object.keys(LAYOUTS).map(function (k) { return '<option value="' + k + '"' + (LBL.layout === k ? ' selected' : '') + '>' + LAYOUTS[k].name + '</option>'; }).join('') + '</select></label>' +
      '<label class="check"><input type="checkbox" id="lser"' + (LBL.serial ? ' checked' : '') + '> Show serial number</label>' +
      (S.settings.org ? '' : '<p class="note">Tip: add your organisation name in <a href="#/settings">Settings</a> to print it on each label.</p>') +
      '<button type="button" class="btn wide" id="lprint" disabled>' + ico('print') + 'Print labels</button><p class="status" id="lstat" role="status"></p>' +
    '</aside></div>';
  var draw = function () {
    $('#lfilters').hidden = LBL.scope === 'pick'; $('#lpick').hidden = LBL.scope !== 'pick';
    var list = labelAssets(), L = LAYOUTS[LBL.layout];
    var pages = Math.ceil(list.length / L.per);
    $('#lcount').textContent = list.length ? plural(list.length, 'label') + ' · ' + plural(pages, 'A4 page') : '';
    $('#lprint').disabled = !list.length || !window.qrcode;
    if (!window.qrcode) return;
    if (!list.length) { $('#lprev').innerHTML = '<p style="margin:0;color:var(--muted)">No assets match. Change the options on the right.</p>'; return; }
    var shown = list.slice(0, L.per);
    $('#lprev').innerHTML = '<div class="label-sheet" style="--cols:' + L.cols + ';--lh:' + L.lh + ';--qr:' + L.qr + '">' + shown.map(labelHtml).join('') + '</div>' + (list.length > shown.length ? '<p style="margin:10px 0 0;font-size:.88rem;color:var(--muted)">Showing the first page. All ' + list.length + ' labels will print.</p>' : '');
  };
  $('#lscope').addEventListener('change', function () { LBL.scope = this.value; draw(); });
  $('#lcat').addEventListener('change', function () { LBL.cat = this.value; draw(); });
  $('#lloc').addEventListener('change', function () { LBL.loc = this.value; draw(); });
  $('#llay').addEventListener('change', function () { LBL.layout = this.value; draw(); });
  $('#lser').addEventListener('change', function () { LBL.serial = this.checked; draw(); });
  $('#lpick').addEventListener('change', function () { LBL.sel = $$('#lpick input:checked').map(function (x) { return x.value; }); draw(); });
  $('#lprint').addEventListener('click', function () {
    var list = labelAssets(), L = LAYOUTS[LBL.layout];
    $('#printArea').innerHTML = '<div class="label-sheet" style="--cols:' + L.cols + ';--lh:' + L.lh + ';--qr:' + L.qr + '">' + list.map(labelHtml).join('') + '</div>';
    document.body.classList.add('printing');
    var done = function () { document.body.classList.remove('printing'); $('#printArea').innerHTML = ''; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(function () { window.print(); setTimeout(function () { if (document.body.classList.contains('printing') && !matchMedia('print').matches) done(); }, 1500); }, 50);
  });
  draw();
  if (!window.qrcode) loadScript(QR_URL).then(function () { if ($('#lprev')) draw(); }).catch(function () {
    if ($('#lprev')) $('#lprev').innerHTML = '<p class="warn">The QR code maker could not load. Labels need an internet connection the first time. Check your connection and reload this page.</p>';
  });
}

/* ================= Depreciation ================= */
var DEP = { asOf: '', retired: false, cat: '' };
function depRows(asOf) {
  return S.assets.filter(function (a) { return (DEP.retired || (a.status !== 'Retired' && a.status !== 'Lost')) && (!DEP.cat || a.category === DEP.cat); })
    .map(function (a) { return { a: a, d: dep(a, asOf), ok: !!(a.cost && a.purchaseDate) }; });
}
function renderDep(view) {
  var asOf = DEP.asOf || today();
  var rows = depRows(asOf);
  var good = rows.filter(function (r) { return r.ok; }), missing = rows.length - good.length;
  var sum = function (k) { return good.reduce(function (s, r) { return s + r.d[k]; }, 0); };
  var byCat = {};
  good.forEach(function (r) { var c = r.a.category; byCat[c] = byCat[c] || { n: 0, cost: 0, acc: 0, book: 0 }; byCat[c].n++; byCat[c].cost += r.d.cost; byCat[c].acc += r.d.accumulated; byCat[c].book += r.d.book; });
  var y = Number(asOf.slice(0, 4));
  view.innerHTML = pageHead({ back: ['#/reports', 'Reports & tools'], title: 'Depreciation report', sub: 'Straight-line method: cost spread evenly over the useful life of each category' + (S.settings.salvagePct ? ', keeping ' + S.settings.salvagePct + '% as scrap value' : '') + '. Change lives in <a href="#/settings">Settings</a>.',
      acts: '<button type="button" class="btn ghost" id="depCsv">' + ico('download') + 'Export CSV</button><button type="button" class="btn ghost" onclick="window.print()">' + ico('print') + 'Print</button>' }) +
    '<section class="card" style="margin-bottom:16px"><div class="toolbar" style="border-bottom:0">' +
      '<label for="depAs" style="font-weight:600;font-size:.9rem">Value as on</label><input type="date" id="depAs" value="' + esc(asOf) + '" style="padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg)">' +
      '<button type="button" class="btn ghost small" id="depFy">31 Mar ' + (Number(asOf.slice(5, 7)) > 3 ? y + 1 : y) + ' (year end)</button>' +
      '<label class="sr" for="depCat">Category</label><select id="depCat"><option value="">All categories</option>' + K.CATEGORIES.map(function (c) { return '<option' + (DEP.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' +
      '<label class="check" style="margin:0"><input type="checkbox" id="depRet"' + (DEP.retired ? ' checked' : '') + '> Include retired and lost</label>' +
    '</div></section>' +
    '<div class="tiles"><div class="tile"><span class="ic">' + ico('rupee') + '</span><b>' + esc(money(sum('cost'))) + '</b><span>Purchase cost</span></div><div class="tile"><span class="ic">' + ico('chart') + '</span><b>' + esc(money(sum('accumulated'))) + '</b><span>Depreciated so far</span></div><div class="tile hero"><span class="ic">' + ico('trend') + '</span><b>' + esc(money(sum('book'))) + '</b><span>Value on ' + esc(dt(asOf)) + '</span></div></div>' +
    (missing ? '<p class="warn">' + plural(missing, 'asset') + ' left out because the purchase date or cost is missing.</p>' : '') +
    '<section class="card"><div class="card-h"><h2>By category</h2></div><div class="tscroll"><table class="t rt"><thead><tr><th>Category</th><th class="num">Life</th><th class="num">Assets</th><th class="num">Cost</th><th class="num">Depreciated</th><th class="num">Value now</th></tr></thead><tbody>' +
      Object.keys(byCat).sort().map(function (c) { var b = byCat[c]; return '<tr><td class="first" data-l="Category">' + esc(c) + '</td><td class="num" data-l="Life">' + lifeFor(c) + ' yrs</td><td class="num" data-l="Assets">' + b.n + '</td><td class="num" data-l="Cost">' + esc(money(b.cost)) + '</td><td class="num" data-l="Depreciated">' + esc(money(b.acc)) + '</td><td class="num" data-l="Value now"><b>' + esc(money(b.book)) + '</b></td></tr>'; }).join('') +
      (good.length ? '' : '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:20px">No assets with both a cost and a purchase date.</td></tr>') +
    '</tbody></table></div></section>' +
    (good.length ? '<section class="card"><div class="card-h"><h2>Asset by asset</h2></div><div class="tscroll"><table class="t rt"><thead><tr><th>Tag</th><th>Asset</th><th>Purchased</th><th class="num">Cost</th><th class="num">Per year</th><th class="num">Depreciated</th><th class="num">Value now</th></tr></thead><tbody>' +
      good.sort(function (x, z) { return x.a.purchaseDate < z.a.purchaseDate ? -1 : 1; }).map(function (r) {
        return '<tr><td class="first" data-l="Tag"><a class="tag" href="#/asset/' + r.a.id + '">' + esc(r.a.tag) + '</a></td><td data-l="Asset">' + esc(assetTitle(r.a)) + '<br><span class="mut">' + esc(r.a.category) + ' · ' + lifeFor(r.a.category) + ' yrs</span></td><td data-l="Purchased">' + esc(dt(r.a.purchaseDate)) + '</td><td class="num" data-l="Cost">' + esc(money(r.d.cost)) + '</td><td class="num" data-l="Per year">' + esc(money(r.d.annual)) + '</td><td class="num" data-l="Depreciated">' + esc(money(r.d.accumulated)) + '</td><td class="num" data-l="Value now"><b>' + esc(money(r.d.book)) + '</b>' + (r.d.fullyDepreciated ? '<br><span class="pill">Fully depreciated</span>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div></section>' : '') +
    '<p style="font-size:.85rem;color:var(--muted);margin-top:14px">This is a management estimate, not a tax computation. Your accountant may use the written-down value method or different lives for the Income Tax Act.</p>';
  $('#depAs').addEventListener('change', function () { if (K.isIso(this.value)) { DEP.asOf = this.value; route(); } });
  $('#depFy').addEventListener('click', function () { DEP.asOf = (Number(asOf.slice(5, 7)) > 3 ? y + 1 : y) + '-03-31'; route(); });
  $('#depCat').addEventListener('change', function () { DEP.cat = this.value; route(); });
  $('#depRet').addEventListener('change', function () { DEP.retired = this.checked; route(); });
  $('#depCsv').addEventListener('click', function () {
    var out = [['Asset tag', 'Category', 'Brand', 'Model', 'Status', 'Purchase date', 'Cost', 'Useful life (years)', 'Salvage %', 'Depreciation per year', 'Depreciated to ' + asOf, 'Value on ' + asOf]];
    good.forEach(function (r) { out.push([r.a.tag, r.a.category, r.a.brand, r.a.model, r.a.status, r.a.purchaseDate, r.d.cost, lifeFor(r.a.category), S.settings.salvagePct, Math.round(r.d.annual), Math.round(r.d.accumulated), Math.round(r.d.book)]); });
    download('depreciation-' + asOf + '.csv', K.toCSV(out), 'text/csv'); toast('Report exported');
  });
}

/* ================= Settings ================= */
ROUTES.settings = function (view) {
  var st = S.settings;
  var bytes = 0; try { bytes = new Blob([JSON.stringify(S)]).size; } catch (e) {}
  view.innerHTML = pageHead({ title: 'Settings', sub: 'Your organisation, asset tags, money and data.' }) +
    '<form id="setForm" novalidate><div class="grid2">' +
      '<section class="card"><div class="card-h"><h2>Organisation and tags</h2></div><div class="card-b">' +
        '<label class="f" for="sOrg">Organisation name<input type="text" id="sOrg" value="' + esc(st.org) + '" placeholder="e.g. Acme Technologies Pvt Ltd" maxlength="80"><span class="h">Shown on the dashboard and printed on labels.</span></label>' +
        '<div class="row2"><label class="f" for="sPre">Asset tag prefix<input type="text" id="sPre" value="' + esc(st.prefix) + '" maxlength="12" autocomplete="off"></label>' +
        '<label class="f" for="sNum">Next number<input type="number" id="sNum" min="1" step="1" value="' + st.nextNum + '"></label></div>' +
        '<p class="note" id="sTagPrev"></p>' +
      '</div></section>' +
      '<section class="card"><div class="card-h"><h2>Money</h2></div><div class="card-b">' +
        '<label class="f" for="sSym">Currency display<select id="sSym">' + [['₹', '₹ 1,25,000'], ['Rs.', 'Rs. 1,25,000'], ['INR', 'INR 1,25,000']].map(function (o) { return '<option value="' + o[0] + '"' + (st.symbol === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
        '<label class="check"><input type="checkbox" id="sDec"' + (st.decimals ? ' checked' : '') + '> Show paise (two decimals)</label>' +
        '<label class="f" for="sSal">Scrap value at end of life (%)<input type="number" id="sSal" min="0" max="100" step="1" value="' + st.salvagePct + '"><span class="h">Often 0% or 5%. Used in depreciation.</span></label>' +
      '</div></section>' +
    '</div>' +
    '<section class="card" style="margin-bottom:16px"><div class="card-h"><h2>Useful life by category</h2><span class="sub">Years, for straight-line depreciation</span></div><div class="card-b"><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:0 14px">' +
      K.CATEGORIES.map(function (c, i) { return '<label class="f" for="life' + i + '">' + esc(c) + '<input type="number" id="life' + i + '" data-cat="' + esc(c) + '" min="0" max="50" step="0.5" value="' + lifeFor(c) + '"></label>'; }).join('') +
      '</div><p class="note" style="margin:0">Defaults follow common Indian practice (3 years for computers and phones, 6 for servers and network gear). Set 0 to treat as expensed.</p></div></section>' +
    '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:28px"><button type="submit" class="btn">Save settings</button><button type="button" class="btn ghost" id="sReset">Reset lives to defaults</button><span class="status" id="sStat" role="status" style="margin:0"></span></div></form>' +
    '<section class="card"><div class="card-h"><h2>Your data</h2><span class="sub">' + esc(storeKind) + ' · about ' + Math.max(1, Math.round(bytes / 1024)) + ' KB</span></div><div class="card-b">' +
      '<p style="margin:0 0 12px;color:var(--muted)">Everything is saved in this browser only. Clearing browsing data or using another computer means starting fresh, so download a backup regularly.</p>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" class="btn" data-act="backup">' + ico('download') + 'Download backup</button><button type="button" class="btn ghost" data-act="restore">' + ico('upload') + 'Restore from backup</button>' +
      '<button type="button" class="btn ghost" id="sPersist">' + ico('shield') + 'Ask browser to keep my data</button>' +
      (hasSample() ? '<button type="button" class="btn ghost" data-act="remove-sample">Remove sample data</button>' : (isEmpty() ? '<button type="button" class="btn ghost" data-act="load-sample">Load sample data</button>' : '')) + '</div></div></section>' +
    '<section class="card" style="border-color:color-mix(in srgb,var(--danger) 45%,var(--line))"><div class="card-h"><h2 style="color:var(--danger)">Delete all data</h2></div><div class="card-b"><p style="margin:0 0 12px;color:var(--muted)">Removes every asset, person, licence, record, location and setting from this browser. Download a backup first.</p><button type="button" class="btn danger" id="sWipe">' + ico('trash') + 'Delete all data</button></div></section>';
  var prev = function () {
    var p = $('#sPre').value.trim(), n = parseInt($('#sNum').value, 10) || 1;
    $('#sTagPrev').innerHTML = 'Next asset tag: <b class="mono">' + esc(K.nextFreeTag(p, n, S.assets.map(function (a) { return a.tag; })).tag) + '</b>. Existing tags are not changed.';
  };
  $('#sPre').addEventListener('input', prev); $('#sNum').addEventListener('input', prev); prev();
  $('#setForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var stat = $('#sStat'); stat.className = 'status err';
    var pre = $('#sPre').value.trim();
    if (/[\s,;"]/.test(pre)) { stat.textContent = 'The prefix cannot contain spaces, commas or quotes.'; $('#sPre').focus(); return; }
    var num = Number($('#sNum').value);
    if (!(num >= 1) || Math.floor(num) !== num) { stat.textContent = 'Next number must be a whole number of 1 or more.'; $('#sNum').focus(); return; }
    var sal = Number($('#sSal').value);
    if (!(sal >= 0 && sal <= 100)) { stat.textContent = 'Scrap value must be between 0 and 100%.'; $('#sSal').focus(); return; }
    var life = {}, bad = null;
    $$('[data-cat]', view).forEach(function (inp) { var v = Number(inp.value); if (inp.value === '' || !(v >= 0 && v <= 50)) bad = bad || inp; life[inp.getAttribute('data-cat')] = v; });
    if (bad) { stat.textContent = 'Useful life must be between 0 and 50 years.'; bad.focus(); return; }
    st.org = $('#sOrg').value.trim(); st.prefix = pre; st.nextNum = num; st.symbol = $('#sSym').value; st.decimals = $('#sDec').checked; st.salvagePct = sal; st.life = life;
    persist(); stat.className = 'status ok'; stat.textContent = 'Saved.'; toast('Settings saved');
  });
  $('#sReset').addEventListener('click', function () { $$('[data-cat]', view).forEach(function (inp) { inp.value = K.DEFAULT_LIFE[inp.getAttribute('data-cat')]; }); $('#sStat').className = 'status'; $('#sStat').textContent = 'Defaults filled in. Press Save to keep them.'; });
  $('#sPersist').addEventListener('click', function () {
    try {
      if (!navigator.storage || !navigator.storage.persist) { toast('Your browser does not support this. Keep regular backups.'); return; }
      navigator.storage.persist().then(function (ok) { toast(ok ? 'Done. The browser will not clear this data on its own.' : 'The browser said no. Keep regular backups.', 4500); });
    } catch (e) { toast('Your browser does not support this. Keep regular backups.'); }
  });
  $('#sWipe').addEventListener('click', function () {
    confirmBox({ title: 'Delete all data?', ok: 'Delete everything', danger: true, typed: 'DELETE',
      body: '<p>This deletes <b>' + plural(S.assets.length, 'asset') + '</b>, ' + plural(S.people.length, 'person', 'people') + ', ' + plural(S.licences.length, 'licence') + ' and all history from this browser. It cannot be undone.</p><p><button type="button" class="linkish" data-act="backup">Download a backup first</button></p>' })
      .then(function (ok) { if (!ok) return; S = blankState(); persist(); location.hash = '#/'; route(); toast('All data deleted'); });
  });
};
