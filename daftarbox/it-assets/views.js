/* Daftarbox IT assets: screens (dashboard, assets, people, licences, maintenance, locations). */
'use strict';

function pageHead(o) {
  return (o.back ? '<a class="back" href="' + o.back[0] + '">← ' + esc(o.back[1]) + '</a>' : '') +
    '<div class="ph"><div>' + (o.eyebrow ? '<span class="eyebrow">' + esc(o.eyebrow) + '</span>' : '') + '<h1>' + esc(o.title) + '</h1>' + (o.sub ? '<p>' + o.sub + '</p>' : '') + '</div>' +
    (o.acts ? '<div class="acts">' + o.acts + '</div>' : '') + '</div>';
}
function emptyBox(o) {
  return '<div class="empty' + (o.sm ? ' sm' : '') + '"><div class="art">' + ico(o.icon || 'box') + '</div><h2>' + esc(o.title) + '</h2><p>' + o.text + '</p>' + (o.acts ? '<div class="acts">' + o.acts + '</div>' : '') + (o.extra || '') + '</div>';
}
function barChart(items, max, cls) {
  if (!items.length) return '<p class="mut" style="margin:0;color:var(--muted)">Nothing to show yet.</p>';
  max = max || Math.max.apply(null, items.map(function (i) { return i[1]; })) || 1;
  return '<div class="bars">' + items.map(function (i) {
    var w = Math.max(i[1] ? 1.5 : 0, i[1] / max * 100);
    var link = i[3] ? '<a href="' + i[3] + '" style="color:inherit">' + esc(i[0]) + '</a>' : esc(i[0]);
    return '<div class="bar"><span class="lb" title="' + esc(i[0]) + '">' + link + '</span><svg viewBox="0 0 100 14" preserveAspectRatio="none" role="img" aria-label="' + esc(i[0]) + ': ' + i[1] + '"><rect class="tr" x="0" y="0" width="100" height="14" rx="3"/><rect class="fl ' + (i[2] || cls || '') + '" x="0" y="0" width="' + w.toFixed(2) + '" height="14" rx="3"/></svg><span class="v">' + i[1] + '</span></div>';
  }).join('') + '</div>';
}
var STATUS_CLS = { 'In stock': 's-ok', 'Assigned': '', 'In repair': 's-warn', 'Retired': 's-mut', 'Lost': 's-bad' };

/* ================= Dashboard ================= */
ROUTES.dashboard = function (view) {
  var org = S.settings.org;
  if (isEmpty()) {
    view.innerHTML = '<div class="p-hero"><span class="eyebrow">IT asset register</span><h1>Know who has every laptop, licence and cable.</h1><p>One simple list for your company’s hardware and software: who has it, when the warranty ends, what it is worth today.</p></div>' +
      emptyBox({ title: 'Your register is empty', icon: 'laptop', text: 'Add your first device, or load sample data to see how everything works. Sample data is clearly marked and you can remove it in one click.',
        acts: '<button class="btn" type="button" data-act="add-asset">' + ico('plus') + 'Add your first asset</button><button class="btn ghost" type="button" data-act="load-sample">Load sample data</button><a class="btn ghost" href="#/reports">Import from a spreadsheet</a>',
        extra: '<div class="steps"><div><b>1. Add assets</b>Laptops, monitors, switches, CCTV, UPS. Each gets a tag like ' + esc(K.makeTag(S.settings.prefix, 1)) + '.</div><div><b>2. Check out to people</b>See who holds what. Offboarding becomes a one-click checklist.</div><div><b>3. Stay ahead</b>Warranty, licence renewal and overdue return reminders on this page.</div></div>' });
    return;
  }
  var t = today();
  var A = S.assets;
  var active = A.filter(function (a) { return a.status !== 'Retired' && a.status !== 'Lost'; });
  var cnt = function (s) { return A.filter(function (a) { return a.status === s; }).length; };
  var totalCost = A.reduce(function (s, a) { return s + (+a.cost || 0); }, 0);
  var book = active.reduce(function (s, a) { return s + dep(a, t).book; }, 0);
  var tiles = [
    ['box', A.length, 'Total assets', '#/assets', 'hero'],
    ['user', cnt('Assigned'), 'Assigned', '#/assets?status=Assigned'],
    ['check', cnt('In stock'), 'In stock', '#/assets?status=In%20stock'],
    ['wrench', cnt('In repair'), 'In repair', '#/assets?status=In%20repair'],
    ['rupee', money(totalCost), 'Total purchase value', '#/reports'],
    ['trend', money(book), 'Current value after depreciation', '#/reports?tool=depreciation']
  ];
  var catItems = K.CATEGORIES.map(function (c) { return [c, A.filter(function (a) { return a.category === c; }).length, '', '#/assets?cat=' + encodeURIComponent(c)]; }).filter(function (i) { return i[1]; }).sort(function (a, b) { return b[1] - a[1]; });
  var stItems = K.STATUSES.map(function (s) { return [s, cnt(s), STATUS_CLS[s], '#/assets?status=' + encodeURIComponent(s)]; });
  var at = K.attention(S, t);
  var att = '';
  function li(dot, href, title, sub) { return '<li><span class="dot ' + dot + '"></span><span class="tx"><a href="' + href + '">' + title + '</a><small>' + sub + '</small></span></li>'; }
  [30, 60, 90].forEach(function (band) {
    var rows = at.warranty.filter(function (w) { return w.band === band; });
    if (!rows.length) return;
    att += '<p class="att-group">Warranty ends within ' + band + ' days</p><ul class="att">' + rows.map(function (w) {
      return li(band === 30 ? 'bad' : '', '#/asset/' + w.asset.id, esc(w.asset.tag) + ' · ' + esc(assetTitle(w.asset)), 'Ends ' + esc(dt(w.asset.warrantyEnd)) + ' (' + (w.days === 0 ? 'today' : 'in ' + plural(w.days, 'day')) + ')');
    }).join('') + '</ul>';
  });
  if (at.licences.length) att += '<p class="att-group">Licences to renew</p><ul class="att">' + at.licences.map(function (x) {
    return li(x.days <= 15 ? 'bad' : '', '#/licences?open=' + x.licence.id, esc(x.licence.name), x.days < 0 ? 'Expired on ' + esc(dt(x.licence.renewalDate)) : 'Renews ' + esc(dt(x.licence.renewalDate)) + ' (' + (x.days === 0 ? 'today' : 'in ' + plural(x.days, 'day')) + ')');
  }).join('') + '</ul>';
  if (at.over.length) att += '<p class="att-group">Licences over their seat limit</p><ul class="att">' + at.over.map(function (x) {
    return li('bad', '#/licences?open=' + x.licence.id, esc(x.licence.name), x.used + ' people use ' + plural(+x.licence.seats, 'seat') + '. Buy ' + x.extra + ' more or free up seats.');
  }).join('') + '</ul>';
  if (at.overdue.length) att += '<p class="att-group">Overdue for return</p><ul class="att">' + at.overdue.map(function (x) {
    return li('bad', '#/asset/' + x.asset.id, esc(x.asset.tag) + ' · ' + esc(assetTitle(x.asset)), 'With ' + esc(personName(x.asset.assignedTo)) + ', due ' + esc(dt(x.asset.expectedReturn)) + ' (' + plural(x.days, 'day') + ' late)');
  }).join('') + '</ul>';
  var openRepairs = S.maintenance.filter(function (m) { return m.status === 'Open'; });
  if (openRepairs.length) att += '<p class="att-group">Open repairs</p><ul class="att">' + openRepairs.map(function (m) {
    var a = asset(m.assetId);
    return li('', '#/maintenance', esc(a ? a.tag + ' · ' + assetTitle(a) : 'Asset'), esc(m.type) + ' since ' + esc(dt(m.date)) + (m.vendor ? ' at ' + esc(m.vendor) : ''));
  }).join('') + '</ul>';
  var attCount = at.warranty.length + at.licences.length + at.over.length + at.overdue.length + openRepairs.length;

  var recent = [];
  A.forEach(function (a) { (a.history || []).forEach(function (h) { recent.push({ a: a, h: h }); }); });
  recent.sort(function (x, y) { return y.h.at - x.h.at; });
  recent = recent.slice(0, 6);

  view.innerHTML = sampleBanner() + pageHead({ eyebrow: org || 'Overview', title: 'Dashboard', sub: 'Everything that needs your eye, in one place.',
      acts: '<button class="btn" type="button" data-act="add-asset">' + ico('plus') + 'Add asset</button><a class="btn ghost" href="#/people">' + ico('users') + 'People</a>' }) +
    '<div class="tiles">' + tiles.map(function (x) {
      return '<a class="tile ' + (x[4] || '') + '" href="' + x[3] + '"><span class="ic">' + ico(x[0]) + '</span><b>' + esc(x[1]) + '</b><span>' + esc(x[2]) + '</span></a>';
    }).join('') + '</div>' +
    '<div class="grid3"><div>' +
      '<div class="grid2" style="margin-bottom:0">' +
        '<section class="card"><div class="card-h"><h2>By category</h2><span class="sub">' + plural(A.length, 'asset') + '</span></div><div class="card-b">' + barChart(catItems) + '</div></section>' +
        '<section class="card"><div class="card-h"><h2>By status</h2></div><div class="card-b">' + barChart(stItems) + '</div></section>' +
      '</div>' +
      '<section class="card" style="margin-top:16px"><div class="card-h"><h2>Recent activity</h2><a href="#/assets" class="sub">All assets →</a></div><div class="card-b">' +
        (recent.length ? '<ul class="timeline">' + recent.map(function (r) {
          return '<li class="k-' + esc(r.h.k) + '"><b><a href="#/asset/' + r.a.id + '" style="color:inherit">' + esc(r.a.tag) + '</a> · ' + esc(r.h.t) + '</b><small>' + esc(K.fmtDateTime(r.h.at)) + '</small>' + (r.h.d ? '<p>' + esc(r.h.d) + '</p>' : '') + '</li>';
        }).join('') + '</ul>' : '<p style="margin:0;color:var(--muted)">No activity yet.</p>') +
      '</div></section>' +
    '</div>' +
    '<section class="card"><div class="card-h"><h2>Needs attention</h2>' + (attCount ? '<span class="pill bad">' + attCount + '</span>' : '') + '</div><div class="card-b">' +
      (att || '<p class="allgood">' + ico('check') + 'All clear. No warranties, renewals or returns due soon.</p>') +
    '</div></section></div>';
};

/* ================= Assets list ================= */
var AF = { q: '', cat: '', status: '', loc: '', person: '', sort: 'tag', dir: 1 };
ROUTES.assets = function (view, r) {
  if (r.q.status !== undefined || r.q.cat !== undefined || r.q.loc !== undefined || r.q.person !== undefined) {
    AF = { q: '', cat: r.q.cat || '', status: r.q.status || '', loc: r.q.loc || '', person: r.q.person || '', sort: AF.sort, dir: AF.dir };
    history.replaceState(null, '', '#/assets');
  }
  var acts = '<button class="btn" type="button" data-act="add-asset">' + ico('plus') + 'Add asset</button><a class="btn ghost" href="#/reports?tool=import">' + ico('upload') + 'Import</a><a class="btn ghost" href="#/reports?tool=labels">' + ico('qr') + 'Labels</a>';
  if (!S.assets.length) {
    view.innerHTML = sampleBanner() + pageHead({ title: 'Assets', sub: 'All your hardware in one list.' }) +
      emptyBox({ title: 'No assets yet', icon: 'laptop', text: 'Start with the devices people use every day: laptops, desktops and monitors. You can import a spreadsheet too.',
        acts: '<button class="btn" type="button" data-act="add-asset">' + ico('plus') + 'Add asset</button><a class="btn ghost" href="#/reports?tool=import">Import from CSV</a><button class="btn ghost" type="button" data-act="load-sample">Load sample data</button>' });
    return;
  }
  var opt = function (list, cur, all) { return '<option value="">' + all + '</option>' + list.map(function (o) { var v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o; return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join(''); };
  var cols = [['tag', 'Tag'], ['model', 'Asset'], ['category', 'Category'], ['status', 'Status'], ['person', 'Assigned to'], ['loc', 'Location'], ['warranty', 'Warranty'], ['cost', 'Cost']];
  view.innerHTML = sampleBanner() + pageHead({ title: 'Assets', sub: 'Search, filter and open any device to see its full history.', acts: acts }) +
    '<section class="card"><div class="toolbar" role="search">' +
      '<label class="sr" for="aq">Search assets</label><input type="search" id="aq" placeholder="Search tag, model, serial, person…" value="' + esc(AF.q) + '">' +
      '<label class="sr" for="fcat">Category</label><select id="fcat">' + opt(K.CATEGORIES, AF.cat, 'All categories') + '</select>' +
      '<label class="sr" for="fst">Status</label><select id="fst">' + opt(K.STATUSES, AF.status, 'All statuses') + '</select>' +
      '<label class="sr" for="floc">Location</label><select id="floc">' + opt(S.locations.map(function (l) { return [l.id, l.name]; }), AF.loc, 'All locations') + '</select>' +
      '<label class="sr" for="fpp">Assigned to</label><select id="fpp">' + opt([['_none', 'Nobody (unassigned)']].concat(S.people.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (p) { return [p.id, p.name]; })), AF.person, 'Anyone') + '</select>' +
      '<button type="button" class="btn ghost small" id="fclear">Clear</button><span class="count" id="acount" aria-live="polite"></span>' +
    '</div><div class="tscroll"><table class="t rt"><thead><tr>' + cols.map(function (c) {
      return '<th scope="col" data-k="' + c[0] + '"' + (c[0] === 'cost' ? ' class="num"' : '') + '><button type="button">' + c[1] + ' <span aria-hidden="true" class="arr"></span></button></th>';
    }).join('') + '<th scope="col"><span class="sr">Actions</span></th></tr></thead><tbody id="arows"></tbody></table></div></section>';
  var draw = function () {
    var q = K.norm(AF.q);
    var rows = S.assets.filter(function (a) {
      if (AF.cat && a.category !== AF.cat) return false;
      if (AF.status && a.status !== AF.status) return false;
      if (AF.loc && a.locationId !== AF.loc) return false;
      if (AF.person === '_none' && a.assignedTo) return false;
      if (AF.person && AF.person !== '_none' && a.assignedTo !== AF.person) return false;
      if (q) {
        var hay = K.norm([a.tag, a.brand, a.model, a.serial, a.category, a.vendor, a.invoice, personName(a.assignedTo), locName(a.locationId), a.notes].join(' '));
        if (q.split(' ').some(function (w) { return hay.indexOf(w) < 0; })) return false;
      }
      return true;
    });
    var key = {
      tag: function (a) { var n = K.tagNumber(a.tag, S.settings.prefix); return n === null ? a.tag.toLowerCase() : ('000000000' + n).slice(-9); },
      model: function (a) { return assetTitle(a).toLowerCase(); }, category: function (a) { return a.category; }, status: function (a) { return a.status; },
      person: function (a) { return personName(a.assignedTo).toLowerCase() || '~'; }, loc: function (a) { return locName(a.locationId).toLowerCase() || '~'; },
      warranty: function (a) { return a.warrantyEnd || '9999'; }, cost: function (a) { return +a.cost || 0; }
    }[AF.sort] || function (a) { return a.tag; };
    rows.sort(function (x, y) { var a = key(x), b = key(y); return (a < b ? -1 : a > b ? 1 : 0) * AF.dir; });
    $('#acount').textContent = rows.length === S.assets.length ? plural(rows.length, 'asset') : rows.length + ' of ' + S.assets.length;
    $$('th[data-k]', view).forEach(function (th) {
      var k = th.getAttribute('data-k');
      if (k === AF.sort) { th.setAttribute('aria-sort', AF.dir > 0 ? 'ascending' : 'descending'); $('.arr', th).textContent = AF.dir > 0 ? '↑' : '↓'; }
      else { th.removeAttribute('aria-sort'); $('.arr', th).textContent = ''; }
    });
    $('#arows').innerHTML = rows.length ? rows.map(function (a) {
      return '<tr><td class="first" data-l="Tag"><a class="tag" href="#/asset/' + a.id + '">' + esc(a.tag) + '</a></td>' +
        '<td data-l="Asset"><a class="rowlink" href="#/asset/' + a.id + '">' + esc(assetTitle(a)) + '</a>' + (a.serial ? '<br><span class="mut">S/N ' + esc(a.serial) + '</span>' : '') + '</td>' +
        '<td data-l="Category">' + esc(a.category) + '</td><td data-l="Status">' + statusPill(a.status) + '</td>' +
        '<td data-l="Assigned to">' + (a.assignedTo ? '<a href="#/person/' + a.assignedTo + '">' + esc(personName(a.assignedTo)) + '</a>' : '<span class="mut">—</span>') + '</td>' +
        '<td data-l="Location">' + (esc(locName(a.locationId)) || '<span class="mut">—</span>') + '</td>' +
        '<td data-l="Warranty">' + warrantyPill(a.warrantyEnd) + '</td><td data-l="Cost" class="num">' + (a.cost ? esc(money(a.cost)) : '<span class="mut">—</span>') + '</td>' +
        '<td class="acts">' + (a.assignedTo ? '<button class="btn ghost small" type="button" data-act="checkin" data-id="' + a.id + '">Check in</button>' :
          (a.status === 'In stock' ? '<button class="btn ghost small" type="button" data-act="checkout" data-id="' + a.id + '">Check out</button>' : '')) +
        ' <button class="icon-btn" type="button" data-act="edit-asset" data-id="' + a.id + '" aria-label="Edit ' + esc(a.tag) + '" title="Edit">' + ico('edit') + '</button></td></tr>';
    }).join('') : '<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--muted)">No assets match these filters. <button type="button" class="linkish" id="fclear2">Clear filters</button></td></tr>';
    var c2 = $('#fclear2'); if (c2) c2.onclick = clear;
  };
  function clear() { AF.q = AF.cat = AF.status = AF.loc = AF.person = ''; $('#aq').value = ''; ['#fcat', '#fst', '#floc', '#fpp'].forEach(function (s) { $(s).value = ''; }); draw(); }
  $('#aq').addEventListener('input', debounce(function () { AF.q = this.value; draw(); }, 120));
  [['#fcat', 'cat'], ['#fst', 'status'], ['#floc', 'loc'], ['#fpp', 'person']].forEach(function (p) { $(p[0]).addEventListener('change', function () { AF[p[1]] = this.value; draw(); }); });
  $('#fclear').addEventListener('click', clear);
  $$('th[data-k] button', view).forEach(function (b) {
    b.addEventListener('click', function () { var k = b.parentNode.getAttribute('data-k'); if (AF.sort === k) AF.dir = -AF.dir; else { AF.sort = k; AF.dir = 1; } draw(); });
  });
  draw();
};

/* ================= Asset detail ================= */
ROUTES.asset = function (view, r) {
  var a = asset(r.id);
  if (!a) { view.innerHTML = pageHead({ back: ['#/assets', 'All assets'], title: 'Asset not found' }) + emptyBox({ title: 'This asset no longer exists', text: 'It may have been deleted.', acts: '<a class="btn" href="#/assets">Back to assets</a>' }); return; }
  var d = dep(a);
  var main = a.assignedTo ? '<button class="btn" type="button" data-act="checkin" data-id="' + a.id + '">' + ico('in') + 'Check in</button>' :
    (a.status === 'In stock' ? '<button class="btn" type="button" data-act="checkout" data-id="' + a.id + '">' + ico('out') + 'Check out</button>' : '');
  var acts = main + '<button class="btn ghost" type="button" data-act="edit-asset" data-id="' + a.id + '">' + ico('edit') + 'Edit</button>' +
    '<button class="btn ghost" type="button" data-act="add-maint" data-id="' + a.id + '">' + ico('wrench') + 'Log repair</button>' +
    '<button class="btn ghost" type="button" data-act="label-one" data-id="' + a.id + '">' + ico('qr') + 'Label</button>' +
    '<button class="icon-btn" type="button" data-act="delete-asset" data-id="' + a.id + '" aria-label="Delete asset" title="Delete">' + ico('trash') + '</button>';
  var item = function (l, v) { return '<div><dt>' + l + '</dt><dd>' + (v || '<span style="color:var(--muted)">—</span>') + '</dd></div>'; };
  var maint = S.maintenance.filter(function (m) { return m.assetId === a.id; }).sort(function (x, y) { return y.date < x.date ? -1 : 1; });
  var hist = (a.history || []).slice().sort(function (x, y) { return y.at - x.at; });
  var who = a.assignedTo ? person(a.assignedTo) : null;
  view.innerHTML = pageHead({ back: ['#/assets', 'All assets'], eyebrow: a.tag, title: assetTitle(a), sub: esc(a.category) + ' · ' + statusPill(a.status) + (a.serial ? ' · S/N <span class="mono">' + esc(a.serial) + '</span>' : ''), acts: acts }) +
    '<div class="grid3"><div>' +
      (who ? '<section class="card" style="margin-bottom:16px"><div class="card-b who"><span class="avatar lg">' + esc(initials(who.name)) + '</span><div style="flex:1;min-width:0"><b>With <a href="#/person/' + who.id + '">' + esc(who.name) + '</a></b><br><span style="color:var(--muted);font-size:.9rem">Since ' + esc(dt(a.assignedAt)) + (a.expectedReturn ? ' · due back ' + esc(dt(a.expectedReturn)) + (a.expectedReturn < today() ? ' <span class="pill bad">Overdue</span>' : '') : '') + '</span></div></div></section>' : '') +
      '<section class="card"><div class="card-h"><h2>Details</h2></div><div class="card-b"><dl class="dl">' +
        item('Asset tag', '<span class="mono">' + esc(a.tag) + '</span>') + item('Category', esc(a.category)) + item('Brand', esc(a.brand)) + item('Model', esc(a.model)) +
        item('Serial number', a.serial ? '<span class="mono">' + esc(a.serial) + '</span>' : '') + item('Location', a.locationId ? '<a href="#/locations">' + esc(locName(a.locationId)) + '</a>' : '') +
        item('Purchase date', esc(dt(a.purchaseDate))) + item('Purchase cost', a.cost ? esc(money(a.cost)) : '') + item('Vendor', esc(a.vendor)) + item('Invoice number', esc(a.invoice)) +
        item('Warranty ends', a.warrantyEnd ? warrantyPill(a.warrantyEnd) : '') + item('Value today', a.cost && a.purchaseDate ? esc(money(d.book)) + '<br><small style="color:var(--muted);font-weight:400">' + lifeFor(a.category) + '-year life, ' + (d.fullyDepreciated ? 'fully depreciated' : esc(money(d.annual)) + ' a year') + '</small>' : '') +
      '</dl>' + (a.notes ? '<p class="note" style="margin:16px 0 0;white-space:pre-wrap">' + esc(a.notes) + '</p>' : '') + '</div></section>' +
      '<section class="card"><div class="card-h"><h2>Maintenance</h2><button class="btn ghost small" type="button" data-act="add-maint" data-id="' + a.id + '">' + ico('plus') + 'Add record</button></div>' +
        (maint.length ? '<div class="tscroll"><table class="t rt"><thead><tr><th>Date</th><th>Type</th><th>Vendor</th><th>Status</th><th class="num">Cost</th><th><span class="sr">Actions</span></th></tr></thead><tbody>' + maint.map(maintRow).join('') + '</tbody></table></div>' :
          '<div class="card-b"><p style="margin:0;color:var(--muted)">No repairs or services logged. Use <b>Log repair</b> when this device goes for service.</p></div>') +
      '</section>' +
    '</div><section class="card"><div class="card-h"><h2>History</h2><span class="sub">' + plural(hist.length, 'event') + '</span></div><div class="card-b">' +
      (hist.length ? '<ul class="timeline">' + hist.map(function (h) { return '<li class="k-' + esc(h.k) + '"><b>' + esc(h.t) + '</b><small>' + esc(K.fmtDateTime(h.at)) + '</small>' + (h.d ? '<p>' + esc(h.d) + '</p>' : '') + '</li>'; }).join('') + '</ul>' : '<p style="margin:0;color:var(--muted)">No history yet.</p>') +
    '</div></section></div>';
};

/* ================= People ================= */
function personAssets(id) { return S.assets.filter(function (a) { return a.assignedTo === id; }); }
function personLicences(id) { return S.licences.filter(function (l) { return l.assigned.indexOf(id) >= 0; }); }
function personForm(p) {
  var isNew = !p; p = p || {};
  var depts = uniq(S.people.map(function (x) { return x.dept; }).concat(['Engineering', 'Sales', 'Marketing', 'Finance', 'HR', 'Operations', 'Design', 'Support', 'Admin']));
  formDialog({
    title: isNew ? 'Add person' : 'Edit ' + p.name, submit: isNew ? 'Add person' : 'Save changes',
    fields: [
      { n: 'name', l: 'Full name', req: true, full: true, auto: 'off' },
      { n: 'empId', l: 'Employee ID', ph: 'e.g. EMP-107' },
      { n: 'email', l: 'Work email', t: 'email', ph: 'name@company.in' },
      { n: 'dept', l: 'Department', list: depts },
      { n: 'location', l: 'Location', list: S.locations.map(function (l) { return l.name; }) }
    ],
    values: Object.assign({}, p, { location: locName(p.locationId) }),
    onSubmit: function (v, force) {
      if (v.empId) {
        var dupe = S.people.filter(function (x) { return x.id !== p.id && x.empId && K.norm(x.empId) === K.norm(v.empId); })[0];
        if (dupe) return { errors: { empId: dupe.name + ' already has this employee ID.' } };
      }
      if (!force) {
        var same = S.people.filter(function (x) { return x.id !== p.id && K.norm(x.name) === K.norm(v.name); })[0];
        if (same) return { errors: { name: 'Someone called ' + same.name + ' is already in the list.' }, soft: true, msg: 'Press "Save anyway" if this is a different person.' };
      }
      var t = isNew ? { id: uid(), created: Date.now() } : p;
      t.name = v.name; t.empId = v.empId; t.email = v.email; t.dept = v.dept; t.locationId = findOrCreateLocation(v.location);
      if (isNew) S.people.push(t);
      commit(isNew ? v.name + ' added' : 'Changes saved');
      return true;
    }
  });
}
function returnAll(p) {
  var as = personAssets(p.id), ls = personLicences(p.id);
  if (!as.length && !ls.length) { toast(p.name + ' has nothing to return.'); return; }
  formDialog({
    title: 'Return everything from ' + p.name, submit: 'Return all', wide: true,
    intro: '<p class="note">Use this when someone leaves or changes role. Untick anything that was not handed back.</p>',
    fields: [
      { n: 'assets', l: 'Assets to check in (' + as.length + ')', t: 'checklist', opts: as.map(function (a) { return [a.id, a.tag + ' · ' + assetTitle(a), a.category]; }), v: as.map(function (a) { return a.id; }), empty: 'No assets with this person.' },
      { n: 'lic', l: 'Licence seats to free up (' + ls.length + ')', t: 'checklist', opts: ls.map(function (l) { return [l.id, l.name, l.vendor]; }), v: ls.map(function (l) { return l.id; }), empty: 'No licences assigned.' },
      { n: 'loc', l: 'Store returned assets at', list: S.locations.map(function (l) { return l.name; }) },
      { n: 'notes', l: 'Note for the history log', ph: 'e.g. Exit on 30 Sep, all items checked' }
    ],
    onSubmit: function (v) {
      var locId = v.loc ? findOrCreateLocation(v.loc) : '';
      v.assets.forEach(function (id) { var a = asset(id); if (a) doCheckin(a, 'In stock', ['Returned during offboarding', v.notes].filter(Boolean).join('. '), locId); });
      v.lic.forEach(function (id) { var l = licence(id); if (l) l.assigned = l.assigned.filter(function (x) { return x !== p.id; }); });
      commit(plural(v.assets.length, 'asset') + ' and ' + plural(v.lic.length, 'licence seat') + ' returned');
      return true;
    }
  });
}
ACTIONS['add-person'] = function () { personForm(null); };
ACTIONS['edit-person'] = function (id) { var p = person(id); if (p) personForm(p); };
ACTIONS['return-all'] = function (id) { var p = person(id); if (p) returnAll(p); };
ACTIONS['delete-person'] = function (id) {
  var p = person(id); if (!p) return;
  var as = personAssets(id), ls = personLicences(id);
  confirmBox({ title: 'Remove ' + p.name + '?', ok: 'Remove person', danger: true,
    body: '<p>' + (as.length || ls.length ? 'Their ' + plural(as.length, 'asset') + ' will be checked in and ' + plural(ls.length, 'licence seat') + ' freed. ' : '') + 'Asset history keeps their name.</p>' })
    .then(function (ok) {
      if (!ok) return;
      as.forEach(function (a) { doCheckin(a, 'In stock', 'Person removed from the list'); });
      ls.forEach(function (l) { l.assigned = l.assigned.filter(function (x) { return x !== id; }); });
      S.people = S.people.filter(function (x) { return x.id !== id; });
      persist(); location.hash = '#/people'; toast(p.name + ' removed');
    });
};
ROUTES.people = function (view) {
  var acts = '<button class="btn" type="button" data-act="add-person">' + ico('plus') + 'Add person</button>';
  if (!S.people.length) {
    view.innerHTML = sampleBanner() + pageHead({ title: 'People', sub: 'Employees who can hold assets and licences.' }) +
      emptyBox({ title: 'No people yet', icon: 'users', text: 'Add the people you hand devices to. You can also just type a new name while checking out an asset.', acts: acts });
    return;
  }
  view.innerHTML = sampleBanner() + pageHead({ title: 'People', sub: 'See what each person holds. Open someone to offboard them in one step.', acts: acts }) +
    '<section class="card"><div class="toolbar"><label class="sr" for="pq">Search people</label><input type="search" id="pq" placeholder="Search name, ID, email, department…"><span class="count" id="pcount"></span></div>' +
    '<div class="tscroll"><table class="t rt"><thead><tr><th>Name</th><th>Employee ID</th><th>Department</th><th>Location</th><th class="num">Assets</th><th class="num">Licences</th><th><span class="sr">Actions</span></th></tr></thead><tbody id="prows"></tbody></table></div></section>';
  var draw = function (q) {
    q = K.norm(q || '');
    var rows = S.people.filter(function (p) { return !q || K.norm([p.name, p.empId, p.email, p.dept, locName(p.locationId)].join(' ')).indexOf(q) >= 0; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
    $('#pcount').textContent = plural(rows.length, 'person', 'people');
    $('#prows').innerHTML = rows.map(function (p) {
      var na = personAssets(p.id).length, nl = personLicences(p.id).length;
      return '<tr><td class="first" data-l="Name"><span class="who"><span class="avatar">' + esc(initials(p.name)) + '</span><span><a class="rowlink" href="#/person/' + p.id + '">' + esc(p.name) + '</a>' + (p.email ? '<br><span class="mut">' + esc(p.email) + '</span>' : '') + '</span></span></td>' +
        '<td data-l="Employee ID">' + (esc(p.empId) || '<span class="mut">—</span>') + '</td><td data-l="Department">' + (esc(p.dept) || '<span class="mut">—</span>') + '</td>' +
        '<td data-l="Location">' + (esc(locName(p.locationId)) || '<span class="mut">—</span>') + '</td><td data-l="Assets" class="num">' + na + '</td><td data-l="Licences" class="num">' + nl + '</td>' +
        '<td class="acts"><a class="btn ghost small" href="#/person/' + p.id + '">Open</a></td></tr>';
    }).join('') || '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--muted)">Nobody matches that search.</td></tr>';
  };
  $('#pq').addEventListener('input', debounce(function () { draw(this.value); }, 120));
  draw('');
};
ROUTES.person = function (view, r) {
  var p = person(r.id);
  if (!p) { view.innerHTML = pageHead({ back: ['#/people', 'All people'], title: 'Person not found' }) + emptyBox({ title: 'This person is no longer in the list', text: 'They may have been removed.', acts: '<a class="btn" href="#/people">Back to people</a>' }); return; }
  var as = personAssets(p.id), ls = personLicences(p.id);
  var value = as.reduce(function (s, a) { return s + (+a.cost || 0); }, 0);
  var past = S.assets.filter(function (a) { return a.assignedTo !== p.id && (a.history || []).some(function (h) { return h.k === 'checkout' && h.t === 'Checked out to ' + p.name; }); });
  view.innerHTML = pageHead({ back: ['#/people', 'All people'], eyebrow: p.empId || 'Person', title: p.name, sub: [esc(p.dept), esc(locName(p.locationId)), p.email ? '<a href="mailto:' + esc(p.email) + '">' + esc(p.email) + '</a>' : ''].filter(Boolean).join(' · '),
      acts: '<button class="btn" type="button" data-act="return-all" data-id="' + p.id + '"' + (as.length || ls.length ? '' : ' disabled') + '>' + ico('in') + 'Return all assets</button><button class="btn ghost" type="button" data-act="give-asset" data-id="' + p.id + '">' + ico('out') + 'Give an asset</button><button class="btn ghost" type="button" data-act="edit-person" data-id="' + p.id + '">' + ico('edit') + 'Edit</button><button class="icon-btn" type="button" data-act="delete-person" data-id="' + p.id + '" aria-label="Remove person" title="Remove">' + ico('trash') + '</button>' }) +
    '<div class="tiles"><div class="tile"><span class="ic">' + ico('laptop') + '</span><b>' + as.length + '</b><span>Assets held</span></div><div class="tile"><span class="ic">' + ico('key') + '</span><b>' + ls.length + '</b><span>Licence seats</span></div><div class="tile"><span class="ic">' + ico('rupee') + '</span><b>' + esc(money(value)) + '</b><span>Purchase value held</span></div></div>' +
    '<section class="card"><div class="card-h"><h2>Assets with ' + esc(p.name.split(' ')[0]) + '</h2></div>' +
      (as.length ? '<div class="tscroll"><table class="t rt"><thead><tr><th>Tag</th><th>Asset</th><th>Since</th><th>Due back</th><th><span class="sr">Actions</span></th></tr></thead><tbody>' + as.map(function (a) {
        return '<tr><td class="first" data-l="Tag"><a class="tag" href="#/asset/' + a.id + '">' + esc(a.tag) + '</a></td><td data-l="Asset">' + esc(assetTitle(a)) + ' <span class="mut">' + esc(a.category) + '</span></td><td data-l="Since">' + esc(dt(a.assignedAt)) + '</td><td data-l="Due back">' + (a.expectedReturn ? (a.expectedReturn < today() ? '<span class="pill bad">' + esc(dt(a.expectedReturn)) + '</span>' : esc(dt(a.expectedReturn))) : '<span class="mut">—</span>') + '</td><td class="acts"><button class="btn ghost small" type="button" data-act="checkin" data-id="' + a.id + '">Check in</button></td></tr>';
      }).join('') + '</tbody></table></div>' : '<div class="card-b"><p style="margin:0;color:var(--muted)">Nothing assigned right now.</p></div>') + '</section>' +
    '<section class="card"><div class="card-h"><h2>Licences</h2><a class="sub" href="#/licences">Manage licences →</a></div>' +
      (ls.length ? '<div class="tscroll"><table class="t rt"><thead><tr><th>Software</th><th>Vendor</th><th>Renews</th></tr></thead><tbody>' + ls.map(function (l) {
        return '<tr><td class="first" data-l="Software"><a class="rowlink" href="#/licences?open=' + l.id + '">' + esc(l.name) + '</a></td><td data-l="Vendor">' + (esc(l.vendor) || '—') + '</td><td data-l="Renews">' + (l.renewalDate ? esc(dt(l.renewalDate)) : 'Perpetual') + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<div class="card-b"><p style="margin:0;color:var(--muted)">No licences assigned.</p></div>') + '</section>' +
    (past.length ? '<section class="card"><div class="card-h"><h2>Previously held</h2></div><div class="card-b"><p style="margin:0">' + past.map(function (a) { return '<a class="tag mono" href="#/asset/' + a.id + '">' + esc(a.tag) + '</a> ' + esc(assetTitle(a)); }).join(' · ') + '</p></div></section>' : '');
};
ACTIONS['give-asset'] = function (id) {
  var p = person(id); if (!p) return;
  var stock = S.assets.filter(function (a) { return a.status === 'In stock'; });
  if (!stock.length) { toast('No assets are in stock right now.'); return; }
  formDialog({
    title: 'Give an asset to ' + p.name, submit: 'Check out',
    fields: [
      { n: 'asset', l: 'Asset in stock', t: 'select', req: true, full: true, opts: [['', 'Choose…']].concat(stock.map(function (a) { return [a.id, a.tag + ' · ' + assetTitle(a) + ' (' + a.category + ')']; })) },
      { n: 'expected', l: 'Expected back (optional)', t: 'date' },
      { n: 'notes', l: 'Condition and accessories', ph: 'e.g. With charger' }
    ],
    onSubmit: function (v) {
      var a = asset(v.asset); if (!a) return { errors: { asset: 'Please choose an asset.' } };
      if (v.expected && v.expected < today()) return { errors: { expected: 'Pick a date in the future.' } };
      doCheckout(a, p.id, today(), v.expected, v.notes); commit(a.tag + ' given to ' + p.name); return true;
    }
  });
};

/* ================= Licences ================= */
function licenceForm(l) {
  var isNew = !l; l = l || {};
  formDialog({
    title: isNew ? 'Add licence' : 'Edit ' + l.name, submit: isNew ? 'Add licence' : 'Save changes', wide: true,
    fields: [
      { n: 'name', l: 'Software name', req: true, ph: 'e.g. Microsoft 365 Business Basic' },
      { n: 'vendor', l: 'Vendor', list: uniq(S.licences.map(function (x) { return x.vendor; }).concat(['Microsoft', 'Google', 'Adobe', 'Zoho', 'Tally Solutions', 'Quick Heal', 'Autodesk', 'Atlassian', 'Slack', 'Zoom'])) },
      { n: 'key', l: 'Licence key or account', full: true, h: 'Hidden on screen until you press Show. Stored only in this browser.' },
      { n: 'seats', l: 'Seats bought', t: 'number', req: true, min: 1, step: 1, int: true, v: 1 },
      { n: 'cost', l: 'Cost (' + S.settings.symbol + ')', t: 'number', min: 0, step: 'any' },
      { n: 'purchaseDate', l: 'Purchase date', t: 'date' },
      { n: 'renewalDate', l: 'Renewal or expiry date', t: 'date', h: 'Leave empty for perpetual licences.' },
      { n: 'notes', l: 'Notes', t: 'textarea', full: true, ph: 'Billing cycle, admin portal, contact' }
    ],
    values: Object.assign({}, l, { cost: l.cost || '' }),
    onSubmit: function (v) {
      if (v.purchaseDate && v.renewalDate && v.renewalDate < v.purchaseDate) return { errors: { renewalDate: 'Renewal date cannot be before purchase.' } };
      var t = isNew ? { id: uid(), assigned: [], created: Date.now() } : l;
      t.name = v.name; t.vendor = v.vendor; t.key = v.key; t.seats = parseInt(v.seats, 10); t.cost = v.cost === '' ? 0 : Number(v.cost);
      t.purchaseDate = v.purchaseDate; t.renewalDate = v.renewalDate; t.notes = v.notes;
      if (isNew) S.licences.push(t);
      commit(isNew ? v.name + ' added' : 'Changes saved');
      if (!isNew && t.assigned.length > t.seats) toast('Heads up: ' + t.assigned.length + ' people use ' + plural(t.seats, 'seat') + '.', 4000);
      return true;
    }
  });
}
function seatsForm(l) {
  if (!S.people.length) { toast('Add people first, then assign seats.'); location.hash = '#/people'; return; }
  formDialog({
    title: 'Assign seats: ' + l.name, submit: 'Save seats', wide: false,
    intro: '<p class="note" id="seatNote"></p>',
    fields: [{ n: 'who', l: 'People using this licence', t: 'checklist', opts: S.people.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (p) { return [p.id, p.name, p.dept]; }), v: l.assigned }],
    onOpen: function (form) {
      var upd = function () {
        var n = $$('input[name=who]:checked', form).length;
        var note = $('#seatNote', form);
        note.className = n > l.seats ? 'warn' : 'note';
        note.textContent = n + ' of ' + l.seats + ' seats selected' + (n > l.seats ? '. That is ' + (n - l.seats) + ' more than you bought.' : '.');
      };
      form.addEventListener('change', upd); upd();
    },
    onSubmit: function (v, force) {
      if (v.who.length > l.seats && !force) return { soft: true, msg: 'You are using more seats than you bought. Save anyway?', softLabel: 'Save anyway' };
      l.assigned = v.who; commit('Seats updated'); return true;
    }
  });
}
ACTIONS['add-licence'] = function () { licenceForm(null); };
ACTIONS['edit-licence'] = function (id) { var l = licence(id); if (l) licenceForm(l); };
ACTIONS['seats'] = function (id) { var l = licence(id); if (l) seatsForm(l); };
ACTIONS['show-key'] = function (id, btn) {
  var l = licence(id); if (!l) return;
  var code = btn.parentNode.querySelector('code');
  var shown = btn.getAttribute('aria-pressed') === 'true';
  code.textContent = shown ? K.maskKey(l.key) : l.key;
  btn.setAttribute('aria-pressed', shown ? 'false' : 'true'); btn.textContent = shown ? 'Show' : 'Hide';
};
ACTIONS['copy-key'] = function (id) {
  var l = licence(id); if (!l) return;
  try { navigator.clipboard.writeText(l.key).then(function () { toast('Key copied'); }, function () { toast('Copy blocked by the browser. Use Show and copy by hand.'); }); }
  catch (e) { toast('Copy blocked by the browser. Use Show and copy by hand.'); }
};
ACTIONS['delete-licence'] = function (id) {
  var l = licence(id); if (!l) return;
  confirmBox({ title: 'Delete ' + l.name + '?', ok: 'Delete licence', danger: true, body: '<p>This removes the licence and its seat assignments. This cannot be undone.</p>' })
    .then(function (ok) { if (!ok) return; S.licences = S.licences.filter(function (x) { return x.id !== id; }); commit('Licence deleted'); });
};
ROUTES.licences = function (view, r) {
  var acts = '<button class="btn" type="button" data-act="add-licence">' + ico('plus') + 'Add licence</button>';
  if (!S.licences.length) {
    view.innerHTML = sampleBanner() + pageHead({ title: 'Licences', sub: 'Software subscriptions and keys.' }) +
      emptyBox({ title: 'No licences yet', icon: 'key', text: 'Track Microsoft 365, Google Workspace, Adobe, Tally, antivirus and more. We warn you before renewals and when seats run out.', acts: acts });
    return;
  }
  var t = today();
  var totalCost = S.licences.reduce(function (s, l) { return s + (+l.cost || 0); }, 0);
  var seats = S.licences.reduce(function (s, l) { return s + (+l.seats || 0); }, 0);
  var used = S.licences.reduce(function (s, l) { return s + l.assigned.length; }, 0);
  var list = S.licences.slice().sort(function (a, b) { return (a.renewalDate || '9999') < (b.renewalDate || '9999') ? -1 : 1; });
  view.innerHTML = sampleBanner() + pageHead({ title: 'Licences', sub: 'Who uses which software, and when to renew.', acts: acts }) +
    '<div class="tiles"><div class="tile"><span class="ic">' + ico('key') + '</span><b>' + S.licences.length + '</b><span>Licences</span></div><div class="tile"><span class="ic">' + ico('users') + '</span><b>' + used + ' / ' + seats + '</b><span>Seats in use</span></div><div class="tile"><span class="ic">' + ico('rupee') + '</span><b>' + esc(money(totalCost)) + '</b><span>Total cost</span></div></div>' +
    list.map(function (l) {
      var n = l.assigned.length, over = n > l.seats, days = l.renewalDate ? K.daysBetween(t, l.renewalDate) : null;
      var ren = l.renewalDate ? (days < 0 ? '<span class="pill bad">Expired ' + esc(dt(l.renewalDate)) + '</span>' : days <= 60 ? '<span class="pill ' + (days <= 15 ? 'bad' : 'warn') + '">Renews ' + esc(dt(l.renewalDate)) + '</span>' : 'Renews ' + esc(dt(l.renewalDate))) : '<span class="pill">Perpetual</span>';
      return '<section class="card" id="lic-' + l.id + '"><div class="card-h"><div><h2>' + esc(l.name) + '</h2><span class="sub">' + esc(l.vendor || 'No vendor') + (l.cost ? ' · ' + esc(money(l.cost)) : '') + (l.purchaseDate ? ' · bought ' + esc(dt(l.purchaseDate)) : '') + '</span></div>' +
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' + ren + (over ? ' <span class="pill bad">Over by ' + (n - l.seats) + '</span>' : '') + '</div></div>' +
        '<div class="card-b"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;align-items:start">' +
          '<div><div style="font-size:.78rem;font-weight:650;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Seats</div><div class="seats"><div class="meter' + (over ? ' over' : '') + '" role="img" aria-label="' + n + ' of ' + l.seats + ' seats used"><i style="width:' + Math.min(100, l.seats ? n / l.seats * 100 : 100).toFixed(1) + '%"></i></div><b>' + n + ' / ' + l.seats + '</b></div>' +
            '<p style="margin:8px 0 0;font-size:.9rem;color:var(--muted)">' + (n ? l.assigned.map(function (id) { return '<a href="#/person/' + id + '">' + esc(personName(id) || 'Unknown') + '</a>'; }).join(', ') : 'Nobody assigned yet.') + '</p></div>' +
          '<div><div style="font-size:.78rem;font-weight:650;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Licence key</div>' +
            (l.key ? '<span class="keybox"><code>' + esc(K.maskKey(l.key)) + '</code><button type="button" class="btn ghost small" data-act="show-key" data-id="' + l.id + '" aria-pressed="false">Show</button><button type="button" class="btn ghost small" data-act="copy-key" data-id="' + l.id + '">Copy</button></span>' : '<span style="color:var(--muted)">Not saved</span>') +
            (l.notes ? '<p style="margin:8px 0 0;font-size:.9rem;color:var(--muted);white-space:pre-wrap">' + esc(l.notes) + '</p>' : '') + '</div>' +
        '</div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px"><button type="button" class="btn small" data-act="seats" data-id="' + l.id + '">' + ico('users') + 'Assign seats</button><button type="button" class="btn ghost small" data-act="edit-licence" data-id="' + l.id + '">Edit</button><button type="button" class="btn ghost small danger-t" data-act="delete-licence" data-id="' + l.id + '">Delete</button></div></div></section>';
    }).join('');
  if (r.q.open) { var el = document.getElementById('lic-' + r.q.open); if (el) setTimeout(function () { el.scrollIntoView({ block: 'start' }); el.style.borderColor = 'var(--accent)'; }, 30); }
};

/* ================= Maintenance ================= */
var MAINT_TYPES = ['Repair', 'Service', 'Upgrade', 'Inspection', 'Cleaning', 'Other'];
function maintRow(m) {
  var a = asset(m.assetId);
  return '<tr><td data-l="Date" class="first">' + esc(dt(m.date)) + '</td>' +
    (maintRow.withAsset ? '<td data-l="Asset">' + (a ? '<a class="tag" href="#/asset/' + a.id + '">' + esc(a.tag) + '</a> ' + esc(assetTitle(a)) : '<span class="mut">Deleted asset</span>') + '</td>' : '') +
    '<td data-l="Type">' + esc(m.type) + (m.notes ? '<br><span class="mut">' + esc(m.notes) + '</span>' : '') + '</td><td data-l="Vendor">' + (esc(m.vendor) || '<span class="mut">—</span>') + '</td>' +
    '<td data-l="Status">' + (m.status === 'Open' ? '<span class="pill warn">Open</span>' : '<span class="pill ok">Done</span>') + '</td>' +
    '<td data-l="Cost" class="num">' + (m.cost ? esc(money(m.cost)) : '<span class="mut">—</span>') + '</td>' +
    '<td class="acts">' + (m.status === 'Open' ? '<button type="button" class="btn ghost small" data-act="maint-done" data-id="' + m.id + '">Mark done</button> ' : '') +
    '<button type="button" class="icon-btn" data-act="edit-maint" data-id="' + m.id + '" aria-label="Edit record" title="Edit">' + ico('edit') + '</button> <button type="button" class="icon-btn" data-act="delete-maint" data-id="' + m.id + '" aria-label="Delete record" title="Delete">' + ico('trash') + '</button></td></tr>';
}
function maintForm(m, assetId) {
  var isNew = !m; m = m || {};
  if (!S.assets.length) { toast('Add an asset first.'); return; }
  var opts = [['', 'Choose an asset…']].concat(S.assets.slice().sort(function (a, b) { return a.tag < b.tag ? -1 : 1; }).map(function (a) { return [a.id, a.tag + ' · ' + assetTitle(a)]; }));
  formDialog({
    title: isNew ? 'Log repair or service' : 'Edit maintenance record', submit: 'Save', wide: true,
    fields: [
      { n: 'assetId', l: 'Asset', t: 'select', opts: opts, req: true, full: true },
      { n: 'date', l: 'Date', t: 'date', req: true },
      { n: 'type', l: 'Type', t: 'select', opts: MAINT_TYPES },
      { n: 'vendor', l: 'Done by', list: uniq(S.maintenance.map(function (x) { return x.vendor; }).concat(S.assets.map(function (x) { return x.vendor; }))), ph: 'Service centre or technician' },
      { n: 'cost', l: 'Cost (' + S.settings.symbol + ')', t: 'number', min: 0, step: 'any' },
      { n: 'status', l: 'Status', t: 'select', opts: [['Open', 'Open (still with the vendor)'], ['Done', 'Done']], h: 'Open repairs mark the asset as In repair.' },
      { n: 'notes', l: 'What was done', t: 'textarea', full: true, ph: 'e.g. Battery replaced under warranty' }
    ],
    values: Object.assign({ date: today(), type: 'Repair', status: 'Done', assetId: assetId || '' }, m, { cost: m.cost || '' }),
    onSubmit: function (v) {
      var a = asset(v.assetId);
      if (!a) return { errors: { assetId: 'Please choose an asset.' } };
      var t = isNew ? { id: uid(), created: Date.now() } : m;
      var wasOpen = !isNew && m.status === 'Open';
      t.assetId = v.assetId; t.date = v.date; t.type = v.type; t.vendor = v.vendor; t.cost = v.cost === '' ? 0 : Number(v.cost); t.status = v.status; t.notes = v.notes;
      if (isNew) S.maintenance.push(t);
      var summary = [v.vendor ? 'At ' + v.vendor : '', v.notes, t.cost ? money(t.cost) : ''].filter(Boolean).join('. ');
      if (v.status === 'Open' && !wasOpen && (a.status === 'In stock' || a.status === 'Assigned')) {
        a.statusBeforeRepair = a.status; a.status = 'In repair';
        addHistory(a, 'repair', 'Sent for ' + v.type.toLowerCase(), summary);
      } else if (v.status === 'Done' && wasOpen) finishRepair(a, t, summary);
      else if (isNew) addHistory(a, 'repair', v.type + ' logged', summary);
      commit(isNew ? 'Maintenance record saved' : 'Changes saved');
      return true;
    }
  });
}
function finishRepair(a, m, summary) {
  if (a.status === 'In repair' && !S.maintenance.some(function (x) { return x !== m && x.assetId === a.id && x.status === 'Open'; }))
    a.status = a.assignedTo ? 'Assigned' : 'In stock';
  addHistory(a, 'repair', m.type + ' finished', summary || '');
}
ACTIONS['add-maint'] = function (id) { maintForm(null, id); };
ACTIONS['edit-maint'] = function (id) { var m = byId(S.maintenance, id); if (m) maintForm(m); };
ACTIONS['maint-done'] = function (id) {
  var m = byId(S.maintenance, id); if (!m) return;
  m.status = 'Done'; var a = asset(m.assetId); if (a) finishRepair(a, m, m.vendor ? 'At ' + m.vendor : '');
  commit('Marked done' + (a ? '. ' + a.tag + ' is ' + a.status.toLowerCase() : ''));
};
ACTIONS['delete-maint'] = function (id) {
  confirmBox({ title: 'Delete this record?', ok: 'Delete', danger: true, body: '<p>The maintenance record is removed. The asset history keeps its note.</p>' })
    .then(function (ok) { if (!ok) return; S.maintenance = S.maintenance.filter(function (x) { return x.id !== id; }); commit('Record deleted'); });
};
ROUTES.maintenance = function (view) {
  var acts = '<button class="btn" type="button" data-act="add-maint">' + ico('plus') + 'Log repair or service</button>';
  if (!S.maintenance.length) {
    view.innerHTML = sampleBanner() + pageHead({ title: 'Maintenance', sub: 'Repairs, services and upgrades.' }) +
      emptyBox({ title: 'No repairs logged', icon: 'wrench', text: S.assets.length ? 'When a device goes for repair or an annual service, log it here. Open repairs show the asset as In repair until you mark them done.' : 'Add assets first, then log repairs and services against them.',
        acts: S.assets.length ? acts : '<button class="btn" type="button" data-act="add-asset">' + ico('plus') + 'Add asset</button>' });
    return;
  }
  var list = S.maintenance.slice().sort(function (a, b) { return a.status !== b.status ? (a.status === 'Open' ? -1 : 1) : (a.date < b.date ? 1 : -1); });
  var spend = S.maintenance.reduce(function (s, m) { return s + (+m.cost || 0); }, 0);
  var yr = today().slice(0, 4);
  var spendYr = S.maintenance.filter(function (m) { return (m.date || '').slice(0, 4) === yr; }).reduce(function (s, m) { return s + (+m.cost || 0); }, 0);
  maintRow.withAsset = true;
  view.innerHTML = sampleBanner() + pageHead({ title: 'Maintenance', sub: 'Every repair and service, with cost.', acts: acts }) +
    '<div class="tiles"><div class="tile"><span class="ic">' + ico('wrench') + '</span><b>' + S.maintenance.filter(function (m) { return m.status === 'Open'; }).length + '</b><span>Open now</span></div><div class="tile"><span class="ic">' + ico('rupee') + '</span><b>' + esc(money(spendYr)) + '</b><span>Spent in ' + yr + '</span></div><div class="tile"><span class="ic">' + ico('chart') + '</span><b>' + esc(money(spend)) + '</b><span>Spent all time</span></div></div>' +
    '<section class="card"><div class="tscroll"><table class="t rt"><thead><tr><th>Date</th><th>Asset</th><th>Type</th><th>Done by</th><th>Status</th><th class="num">Cost</th><th><span class="sr">Actions</span></th></tr></thead><tbody>' + list.map(maintRow).join('') + '</tbody></table></div></section>';
  maintRow.withAsset = false;
};

/* ================= Locations ================= */
function locationForm(l) {
  var isNew = !l; l = l || {};
  formDialog({
    title: isNew ? 'Add location' : 'Edit ' + l.name, submit: 'Save',
    fields: [
      { n: 'name', l: 'Name', req: true, full: true, ph: 'e.g. Mumbai office, 2nd floor' },
      { n: 'type', l: 'Type', t: 'select', opts: ['Office', 'Floor', 'Room', 'Store', 'Data centre', 'Warehouse', 'Remote / home', 'Other'] },
      { n: 'city', l: 'City', list: ['Bengaluru', 'Mumbai', 'Delhi', 'Gurugram', 'Noida', 'Hyderabad', 'Chennai', 'Pune', 'Kolkata', 'Ahmedabad', 'Jaipur', 'Kochi'] },
      { n: 'notes', l: 'Address or notes', t: 'textarea', full: true }
    ],
    values: l,
    onSubmit: function (v) {
      var dupe = S.locations.filter(function (x) { return x.id !== l.id && K.norm(x.name) === K.norm(v.name); })[0];
      if (dupe) return { errors: { name: 'A location with this name already exists.' } };
      var t = isNew ? { id: uid(), created: Date.now() } : l;
      t.name = v.name; t.type = v.type; t.city = v.city; t.notes = v.notes;
      if (isNew) S.locations.push(t);
      commit(isNew ? v.name + ' added' : 'Changes saved'); return true;
    }
  });
}
ACTIONS['add-location'] = function () { locationForm(null); };
ACTIONS['edit-location'] = function (id) { var l = loc(id); if (l) locationForm(l); };
ACTIONS['delete-location'] = function (id) {
  var l = loc(id); if (!l) return;
  var na = S.assets.filter(function (a) { return a.locationId === id; }).length, np = S.people.filter(function (p) { return p.locationId === id; }).length;
  confirmBox({ title: 'Delete ' + l.name + '?', ok: 'Delete location', danger: true, body: '<p>' + (na || np ? plural(na, 'asset') + ' and ' + plural(np, 'person', 'people') + ' will have no location. ' : '') + 'Nothing else is deleted.</p>' })
    .then(function (ok) {
      if (!ok) return;
      S.assets.forEach(function (a) { if (a.locationId === id) a.locationId = ''; });
      S.people.forEach(function (p) { if (p.locationId === id) p.locationId = ''; });
      S.locations = S.locations.filter(function (x) { return x.id !== id; });
      commit('Location deleted');
    });
};
ROUTES.locations = function (view) {
  var acts = '<button class="btn" type="button" data-act="add-location">' + ico('plus') + 'Add location</button>';
  if (!S.locations.length) {
    view.innerHTML = sampleBanner() + pageHead({ title: 'Locations', sub: 'Offices, floors, rooms and stores.' }) +
      emptyBox({ title: 'No locations yet', icon: 'pin', text: 'Add your offices and rooms so you can find devices quickly. Locations are also created when you type a new one on an asset.', acts: acts });
    return;
  }
  view.innerHTML = sampleBanner() + pageHead({ title: 'Locations', sub: 'Where your assets and people are.', acts: acts }) +
    '<section class="card"><div class="tscroll"><table class="t rt"><thead><tr><th>Name</th><th>Type</th><th>City</th><th class="num">Assets</th><th class="num">People</th><th class="num">Value</th><th><span class="sr">Actions</span></th></tr></thead><tbody>' +
    S.locations.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (l) {
      var as = S.assets.filter(function (a) { return a.locationId === l.id; });
      var np = S.people.filter(function (p) { return p.locationId === l.id; }).length;
      return '<tr><td class="first" data-l="Name"><b>' + esc(l.name) + '</b>' + (l.notes ? '<br><span class="mut">' + esc(l.notes) + '</span>' : '') + '</td><td data-l="Type">' + esc(l.type || '') + '</td><td data-l="City">' + (esc(l.city) || '<span class="mut">—</span>') + '</td>' +
        '<td data-l="Assets" class="num">' + (as.length ? '<a href="#/assets?loc=' + l.id + '">' + as.length + '</a>' : '0') + '</td><td data-l="People" class="num">' + np + '</td><td data-l="Value" class="num">' + esc(money(as.reduce(function (s, a) { return s + (+a.cost || 0); }, 0))) + '</td>' +
        '<td class="acts"><button type="button" class="icon-btn" data-act="edit-location" data-id="' + l.id + '" aria-label="Edit ' + esc(l.name) + '" title="Edit">' + ico('edit') + '</button> <button type="button" class="icon-btn" data-act="delete-location" data-id="' + l.id + '" aria-label="Delete ' + esc(l.name) + '" title="Delete">' + ico('trash') + '</button></td></tr>';
    }).join('') + '</tbody></table></div></section>';
};
