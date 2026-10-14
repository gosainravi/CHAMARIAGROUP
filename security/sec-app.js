/* Daftarbox Security audit – UI (hash routing, works from file://). Needs sec-data.js and sec-logic.js first. */
(function () {
  'use strict';
  var L = window.SecLogic, D = window.SecData;
  var AREAS = D.AREAS, QS = D.QUESTIONS;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---------- helpers ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function fmtDate(iso, withTime) {
    try {
      var d = new Date(iso), o = { day: 'numeric', month: 'short', year: 'numeric' };
      if (withTime) { o.hour = 'numeric'; o.minute = '2-digit'; }
      return d.toLocaleString('en-IN', o);
    } catch (e) { return String(iso); }
  }
  var KEYS = { a: 'daftarbox-sec-assessments', d: 'daftarbox-sec-checks', draft: 'daftarbox-sec-draft' };
  var storageOk = true;
  function load(k, def) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { storageOk = false; return def; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { storageOk = false; toast('Could not save on this device (storage is full or blocked).'); return false; } }
  function del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  var toastTimer;
  function toast(msg) {
    var t = $('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }
  function confirmBox(msg, okLabel) {
    var dlg = $('#confirm');
    $('#confirm-msg').textContent = msg; $('#confirm-ok').textContent = okLabel || 'Delete';
    return new Promise(function (resolve) {
      if (typeof dlg.showModal !== 'function') { resolve(window.confirm(msg)); return; }
      dlg.returnValue = '';
      dlg.addEventListener('close', function h() { dlg.removeEventListener('close', h); resolve(dlg.returnValue === 'ok'); });
      dlg.showModal();
    });
  }
  function copyText(text) {
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); var ok = false; try { ok = document.execCommand('copy'); } catch (e) { /* ignore */ } ta.remove(); return ok;
    }
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(function () { return true; }, fallback);
    return Promise.resolve(fallback());
  }
  var ICON = {
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/></svg>',
    print: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="7"/></svg>'
  };
  var STATUS = { pass: ['ok', 'Pass'], warn: ['warn', 'Warning'], fail: ['bad', 'Fail'], info: ['info', 'Info'] };
  var EFFORT = { quick: 'Quick win', medium: 'Medium', project: 'Project' };
  var ANSWER = { yes: 'Yes', partly: 'Partly', no: 'No', na: 'Not applicable', unanswered: 'Not answered' };
  var DISCLAIMER = '<p class="warn disclaimer">' + ICON.info + '<span>This is a self-assessment, not a certified audit. It shows where you stand based on your own answers and public DNS records, and does not replace an audit by a CERT-In empanelled auditor or a legal review.</span></p>';

  /* ---------- router ---------- */
  var VIEWS = $$('.view');
  var lastView = null;
  function show(name, title) {
    VIEWS.forEach(function (v) { v.hidden = v.getAttribute('data-view') !== name; });
    var navKey = name === 'report' ? 'reports' : name;
    $$('.nav a').forEach(function (a) { if (a.getAttribute('data-nav') === navKey) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    document.title = (title ? title + ' – ' : '') + 'Security audit – Daftarbox';
    if (lastView !== null) {
      window.scrollTo(0, 0);
      var h = $('.view:not([hidden]) h1'); if (h) { if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    }
    lastView = name;
  }
  function route() {
    var h = (location.hash || '#/').replace(/^#/, '');
    var parts = h.split('/').filter(Boolean).map(function (p) { try { return decodeURIComponent(p); } catch (e) { return p; } });
    var top = parts[0] || '';
    if (!top) { renderHome(); show('home'); return; }
    if (top === 'email') { show('email', 'Email & domain check'); if (parts[1]) startCheck(parts[1], true); return; }
    if (top === 'assess') { renderAssess(parts[1]); return; }
    if (top === 'reports') { renderReports(); show('reports', 'Reports'); return; }
    if (top === 'report' && parts[1] === 'a') { if (renderAssessReport(parts[2])) return; }
    if (top === 'report' && parts[1] === 'd') { if (renderDomainReport(parts[2])) return; }
    if (top === 'compare') { if (renderCompare(parts[1], parts[2])) return; }
    show('notfound', 'Not found');
  }
  window.addEventListener('hashchange', route);

  /* ---------- home ---------- */
  function renderHome() {
    var a = load(KEYS.a, []), d = load(KEYS.d, []), n = a.length + d.length;
    $('#home-report-count').textContent = n ? n + ' saved on this device' : 'Saved on this device';
  }

  /* ======================================================================
     EMAIL & DOMAIN CHECK
     ====================================================================== */
  var running = false;
  $('#dform').addEventListener('submit', function (e) { e.preventDefault(); startCheck($('#dinput').value, false); });
  $$('[data-try]').forEach(function (b) { b.addEventListener('click', function () { $('#dinput').value = b.getAttribute('data-try'); startCheck(b.getAttribute('data-try'), false); }); });

  function setDStatus(html, cls) { var s = $('#dstatus'); s.className = 'status dstatus' + (cls ? ' ' + cls : ''); s.innerHTML = html; }

  function startCheck(raw, fromHash) {
    if (running) return;
    var n = L.normaliseDomain(raw);
    $('#dinput').value = raw;
    if (!n.ok) { setDStatus(esc(n.error), 'err'); $('#dresult').innerHTML = ''; $('#dinput').focus(); return; }
    var d = n.domain;
    $('#dinput').value = d;
    if (!fromHash) { try { history.replaceState(null, '', '#/email/' + encodeURIComponent(d)); } catch (e) { /* file:// in some browsers */ } }
    running = true; $('#dgo').disabled = true; $('#dresult').innerHTML = '';
    var note = n.strippedWww ? ' (we removed “www.” because email settings live on the main domain)' : '';
    setDStatus('<span class="spinner" aria-hidden="true"></span> Checking ' + esc(d) + esc(note) + '…');
    L.gatherDomain(d, function (msg) { setDStatus('<span class="spinner" aria-hidden="true"></span> ' + esc(msg)); })
      .then(function (data) {
        var res = L.evaluateDomain(d, data);
        var rec = { id: uid(), domain: d, date: new Date().toISOString(), result: res };
        var list = load(KEYS.d, []); list.unshift(rec); if (list.length > 60) list.length = 60;
        var saved = save(KEYS.d, list);
        setDStatus(saved ? 'Done. Saved to <a href="#/reports">Reports</a>.' : 'Done.', 'ok');
        $('#dresult').innerHTML = domainResultHtml(rec, { tool: true });
        wireDomainResult($('#dresult'));
        var h = $('#dresult h2'); if (h) { h.setAttribute('tabindex', '-1'); h.focus(); }
      })
      .catch(function (err) {
        var m = err && err.code === 'NXDOMAIN' ? 'We could not find “' + esc(d) + '”. Check the spelling — the domain does not seem to exist.'
          : err && err.code === 'SERVFAIL' ? 'The DNS servers for “' + esc(d) + '” are not answering properly. This can itself stop email from reaching you — ask your DNS host to check.'
          : 'We could not reach the DNS lookup service. Check your internet connection (or a firewall/ad-blocker blocking cloudflare-dns.com and dns.google) and try again.';
        setDStatus(m, 'err');
      })
      .then(function () { running = false; $('#dgo').disabled = false; });
  }

  function sortChecks(checks) {
    var order = { fail: 0, warn: 1, pass: 2, info: 3 };
    return checks.slice().sort(function (a, b) { return order[a.status] - order[b.status]; });
  }

  function gradeWords(g) {
    return { A: 'Excellent — your domain is well protected.', B: 'Good — a few improvements left.', C: 'Fair — some important gaps to close.', D: 'Weak — your domain can likely be misused.', F: 'Poor — urgent fixes needed.' }[g] || '';
  }

  function domainResultHtml(rec, opt) {
    var r = rec.result, c = r.counts;
    var h = '<div class="results">';
    h += '<div class="rhead"><div class="grade g-' + r.grade + '" role="img" aria-label="Grade ' + r.grade + '">' + r.grade + '</div><div class="rhead-main">';
    h += '<h2>' + esc(r.domain) + ' scored ' + r.score + ' / 100</h2><p class="sum" style="margin:0">' + esc(gradeWords(r.grade)) + (r.capped ? ' The grade is held at D because SPF or DMARC is failing.' : '') + '</p>';
    h += '<div class="counts"><span class="pill bad">' + c.fail + ' to fix</span><span class="pill warn">' + c.warn + ' to improve</span><span class="pill ok">' + c.pass + ' passed</span></div>';
    h += '<p class="tiny muted" style="margin:8px 0 0">Checked ' + esc(fmtDate(rec.date, true)) + '</p></div></div>';
    h += '<ul class="chks">';
    sortChecks(r.checks).forEach(function (k) {
      var st = STATUS[k.status];
      h += '<li class="chk"><div class="chk-h"><span class="pill ' + st[0] + '">' + st[1] + '</span><div><b>' + esc(k.name) + '</b><p>' + esc(k.summary) + '</p></div></div>';
      var body = '';
      if (k.found && k.found.length) body += '<h4>What we found</h4><pre class="rec">' + esc(k.found.join('\n')) + '</pre>';
      if (k.details && k.details.length) body += '<ul>' + k.details.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
      if (k.fix) body += '<h4>How to fix</h4><p>' + esc(k.fix.text) + '</p><div class="recwrap"><pre class="rec">' + esc(k.fix.example) + '</pre><button type="button" class="btn ghost small copy noprint" data-copy="' + esc(k.fix.example) + '">Copy</button></div>';
      if (body) h += '<details' + (k.status === 'fail' && opt.tool ? ' open' : '') + '><summary>' + (k.fix && k.status !== 'pass' ? 'Details and how to fix' : 'Details') + '</summary><div class="dbody">' + body + '</div></details>';
      h += '</li>';
    });
    h += '</ul>';
    h += '<div class="later"><h3>Website security headers <span class="badge">Coming with our scanner service</span></h3>' +
      '<p class="muted tiny" style="margin:0">Browsers do not let one website read another website’s security settings, so these need our server-side scanner. They are not part of this grade:</p>' +
      '<ul><li>HTTPS certificate validity and expiry date</li><li>Security headers (HSTS, Content-Security-Policy, X-Frame-Options and more)</li><li>Open ports and exposed services such as Remote Desktop</li><li>Blocklist and email reputation</li></ul></div>';
    if (opt.tool) {
      h += '<div class="results-foot noprint" style="margin-top:18px"><a class="btn" href="#/report/d/' + esc(rec.id) + '">Open printable report</a>' +
        '<a class="btn ghost" href="#/assess">Take the self-assessment</a>' +
        '<button type="button" class="btn ghost" data-again>Check another domain</button></div>';
    }
    h += '</div>';
    return h;
  }

  function wireDomainResult(root) {
    $$('[data-copy]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        copyText(b.getAttribute('data-copy')).then(function (ok) { b.textContent = ok ? 'Copied' : 'Copy failed'; setTimeout(function () { b.textContent = 'Copy'; }, 1600); });
      });
    });
    var again = $('[data-again]', root);
    if (again) again.addEventListener('click', function () { $('#dresult').innerHTML = ''; setDStatus(''); var i = $('#dinput'); i.value = ''; i.focus(); window.scrollTo(0, 0); });
  }

  /* ======================================================================
     SELF-ASSESSMENT
     ====================================================================== */
  function getDraft() { return load(KEYS.draft, null); }
  function setDraft(dr) { dr.updated = new Date().toISOString(); save(KEYS.draft, dr); }
  function answeredCount(answers, areaId) {
    return QS.filter(function (q) { return (!areaId || q.area === areaId) && answers[q.id]; }).length;
  }
  function areaQs(areaId) { return QS.filter(function (q) { return q.area === areaId; }); }

  function renderAssess(sub) {
    var root = $('#assess-root'), dr = getDraft();
    if (sub === 'review' && dr) { renderReview(root, dr); show('assess', 'Review answers'); return; }
    var n = parseInt(sub, 10);
    if (dr && !isNaN(n) && n >= 1 && n <= AREAS.length) { renderStep(root, dr, n - 1); show('assess', AREAS[n - 1].name); return; }
    renderStart(root, dr); show('assess', 'Self-assessment');
  }

  function renderStart(root, dr) {
    var h = '<div class="crumbs"><a href="#/">Security audit</a> › Self-assessment</div>';
    h += '<div class="t-head"><h1 tabindex="-1">Organisation self-assessment</h1><p>Answer ' + QS.length + ' simple questions about how your organisation works today. You get a score for each area and a step-by-step action plan.</p></div>';
    h += '<div class="start-card">';
    if (dr) {
      var cnt = answeredCount(dr.answers || {});
      h += '<div class="resume"><p><b>Welcome back.</b> You have an unfinished assessment' + (dr.org ? ' for <b>' + esc(dr.org) + '</b>' : '') + ' — ' + cnt + ' of ' + QS.length + ' answered.</p>' +
        '<a class="btn" href="#/assess/' + ((dr.step || 0) + 1) + '">Resume</a></div>';
    }
    h += '<form id="startform" novalidate>' +
      '<label class="f">Organisation name<input type="text" id="org" required maxlength="120" autocomplete="organization" value="' + esc(dr ? dr.org : '') + '"><span class="h">Shown on your report.</span></label>' +
      '<label class="f">Your name (optional)<input type="text" id="by" maxlength="80" autocomplete="name" value="' + esc(dr ? dr.by : '') + '"></label>' +
      '<p class="status err" id="starterr" role="alert"></p>' +
      '<button class="btn big" type="submit">' + (dr ? 'Start a new assessment' : 'Start assessment') + '</button></form>';
    h += '<ul class="facts"><li>About 15 minutes</li><li>13 short steps</li><li>Saved as you go</li><li>Nothing is uploaded</li></ul></div>';
    h += '<div style="max-width:560px;margin:18px auto 0">' + DISCLAIMER + '</div>';
    root.innerHTML = h;
    $('#startform').addEventListener('submit', function (e) {
      e.preventDefault();
      var org = $('#org').value.trim();
      if (!org) { $('#starterr').textContent = 'Please type your organisation’s name.'; $('#org').focus(); return; }
      var go = function () { setDraft({ org: org, by: $('#by').value.trim(), answers: {}, step: 0, started: new Date().toISOString() }); if (location.hash === '#/assess/1') route(); else location.hash = '#/assess/1'; }; // same hash fires no hashchange
      if (dr && answeredCount(dr.answers || {}) > 0) confirmBox('This will replace your unfinished assessment (' + answeredCount(dr.answers) + ' answers). Saved reports are not affected.', 'Start new').then(function (ok) { if (ok) go(); });
      else go();
    });
  }

  function progressHtml(dr, stepIdx) {
    var done = answeredCount(dr.answers), pct = Math.round(done / QS.length * 100);
    return '<div class="q-progress"><div class="row"><span>' + (stepIdx == null ? 'Review' : 'Step ' + (stepIdx + 1) + ' of ' + AREAS.length) + '</span><span>' + done + ' of ' + QS.length + ' answered (' + pct + '%)</span></div>' +
      '<div class="bar" role="progressbar" aria-label="Questions answered" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '"><i style="width:' + pct + '%"></i></div></div>';
  }

  function sideHtml(dr, stepIdx) {
    var h = '<aside class="opts" aria-label="Assessment areas"><h2>' + esc(dr.org || 'Your organisation') + '</h2><ul class="arealist">';
    AREAS.forEach(function (a, i) {
      var tot = areaQs(a.id).length, n = answeredCount(dr.answers, a.id);
      h += '<li><button type="button" data-jump="' + (i + 1) + '"' + (i === stepIdx ? ' aria-current="step"' : '') + '><span>' + esc(a.name) + '</span><span class="cnt' + (n === tot ? ' full' : '') + '">' + (n === tot ? '✓ ' : '') + n + '/' + tot + '</span></button></li>';
    });
    h += '</ul><button type="button" class="btn ghost wide" data-review>Review and finish</button>' +
      '<p class="note tiny" style="margin:12px 0 0">Your answers save automatically on this device. Close the page any time and come back to resume.</p></aside>';
    return h;
  }

  function wireSide(root) {
    $$('[data-jump]', root).forEach(function (b) { b.addEventListener('click', function () { location.hash = '#/assess/' + b.getAttribute('data-jump'); }); });
    var r = $('[data-review]', root); if (r) r.addEventListener('click', function () { location.hash = '#/assess/review'; });
  }

  function renderStep(root, dr, idx) {
    var area = AREAS[idx], qs = areaQs(area.id);
    var startNum = QS.indexOf(qs[0]) + 1;
    dr.step = idx; setDraft(dr);
    var h = '<div class="crumbs"><a href="#/">Security audit</a> › <a href="#/assess">Self-assessment</a> › ' + esc(area.name) + '</div>';
    h += '<div style="margin-top:18px">' + progressHtml(dr, idx) + '</div>';
    h += '<div class="work"><div class="box"><div class="box-b" style="padding:20px">';
    h += '<div class="area-head"><h1 class="sr" tabindex="-1">' + esc(area.name) + ' — step ' + (idx + 1) + ' of ' + AREAS.length + '</h1><h2 aria-hidden="true">' + esc(area.name) + '</h2><p>' + esc(area.intro) + '</p></div>';
    qs.forEach(function (q, i) {
      var a = dr.answers[q.id] || '';
      h += '<fieldset class="qq' + (a ? ' done' : '') + '" data-q="' + q.id + '"><legend><span class="qn" aria-hidden="true">' + (startNum + i) + '</span><span>' + esc(q.q) + '</span></legend><div class="ans">';
      ['yes', 'partly', 'no', 'na'].forEach(function (v) {
        h += '<label><input type="radio" name="q-' + q.id + '" value="' + v + '"' + (a === v ? ' checked' : '') + '>' + ANSWER[v] + '</label>';
      });
      h += '</div><details><summary>Why this matters</summary><p>' + esc(q.why) + '</p><p class="ref muted">Based on: ' + esc(q.ref) + '</p></details></fieldset>';
    });
    h += '<div class="q-nav">' + (idx > 0 ? '<a class="btn ghost" href="#/assess/' + idx + '">← Back</a>' : '<a class="btn ghost" href="#/assess">← Start page</a>') +
      (idx < AREAS.length - 1 ? '<a class="btn" href="#/assess/' + (idx + 2) + '">Next: ' + esc(AREAS[idx + 1].name) + ' →</a>' : '<a class="btn" href="#/assess/review">Review and finish →</a>') + '</div>';
    h += '</div></div>' + sideHtml(dr, idx) + '</div>';
    root.innerHTML = h;
    wireSide(root);
    $$('input[type=radio]', root).forEach(function (inp) {
      inp.addEventListener('change', function () {
        var d2 = getDraft() || dr; var id = inp.name.slice(2);
        d2.answers[id] = inp.value; setDraft(d2); dr = d2;
        inp.closest('fieldset').classList.add('done');
        var p = $('.q-progress', root); p.outerHTML = progressHtml(d2, idx);
        var side = $('.opts', root); side.outerHTML = sideHtml(d2, idx); wireSide(root);
      });
    });
  }

  function renderReview(root, dr) {
    var missing = QS.filter(function (q) { return !dr.answers[q.id]; });
    var h = '<div class="crumbs"><a href="#/">Security audit</a> › <a href="#/assess">Self-assessment</a> › Review</div>';
    h += '<div class="t-head"><h1 tabindex="-1">Review and finish</h1><p>' + esc(dr.org) + ' · ' + answeredCount(dr.answers) + ' of ' + QS.length + ' questions answered.</p></div>';
    h += '<div style="max-width:760px;margin:0 auto">' + progressHtml(dr, null);
    h += '<div class="tablewrap"><table class="t"><thead><tr><th scope="col">Area</th><th scope="col" class="num">Answered</th><th scope="col"><span class="sr">Edit</span></th></tr></thead><tbody>';
    AREAS.forEach(function (a, i) {
      var tot = areaQs(a.id).length, n = answeredCount(dr.answers, a.id);
      h += '<tr><td class="name">' + esc(a.name) + '</td><td class="num">' + (n === tot ? '<span class="pill ok">' + n + '/' + tot + '</span>' : '<span class="pill warn">' + n + '/' + tot + '</span>') + '</td><td class="num"><a href="#/assess/' + (i + 1) + '">Edit</a></td></tr>';
    });
    h += '</tbody></table></div>';
    if (missing.length) h += '<p class="warn">' + missing.length + ' question' + (missing.length > 1 ? 's are' : ' is') + ' not answered yet. They will count as “No” in your score — go back and answer them for a fairer result.</p>';
    h += '<div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:10px"><button class="btn" type="button" id="finish" style="font-size:1.1rem;padding:15px 30px">See my results</button><a class="btn ghost" href="#/assess/1">Go back to questions</a></div>';
    h += '<div style="margin-top:22px">' + DISCLAIMER + '</div></div>';
    root.innerHTML = h;
    $('#finish').addEventListener('click', function () {
      if (!answeredCount(dr.answers)) { toast('Answer at least one question first.'); return; }
      var list = load(KEYS.a, []);
      var rec = { id: dr.editingId || uid(), org: dr.org, by: dr.by || '', date: new Date().toISOString(), answers: dr.answers, version: D.VERSION };
      var at = -1; list.forEach(function (x, i) { if (x.id === rec.id) at = i; });
      if (at > -1) list[at] = rec; else list.unshift(rec);
      if (save(KEYS.a, list)) { del(KEYS.draft); location.hash = '#/report/a/' + rec.id; }
    });
  }

  /* ======================================================================
     REPORTS
     ====================================================================== */
  function renderReports() {
    var root = $('#reports-root'), A = load(KEYS.a, []), Dc = load(KEYS.d, []), dr = getDraft();
    var h = '';
    if (!storageOk) h += '<p class="warn">Your browser is blocking storage for this page, so reports cannot be saved here. Try opening the site in a normal (not private) window.</p>';
    if (dr) h += '<div class="resume"><p><b>Unfinished assessment</b>' + (dr.org ? ' for ' + esc(dr.org) : '') + ' — ' + answeredCount(dr.answers || {}) + ' of ' + QS.length + ' answered.</p><a class="btn" href="#/assess/' + ((dr.step || 0) + 1) + '">Resume</a></div>';

    h += '<div class="rep-head"><h2 class="sec-h2">Self-assessments</h2><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost small" id="cmpbtn" disabled>Compare selected (0/2)</button><a class="btn small" href="#/assess">New assessment</a></div></div>';
    if (!A.length) h += '<div class="tablewrap"><p class="empty">No assessments yet. <a href="#/assess">Start your first one</a> — it takes about 15 minutes.</p></div>';
    else {
      h += '<div class="tablewrap"><table class="t"><thead><tr><th scope="col"><span class="sr">Select to compare</span></th><th scope="col">Organisation</th><th scope="col">Date</th><th scope="col" class="num">Score</th><th scope="col">Level</th><th scope="col" class="num">Actions</th></tr></thead><tbody>';
      A.forEach(function (r) {
        var s = L.scoreAssessment(AREAS, QS, r.answers);
        h += '<tr><td><input type="checkbox" class="cmpchk" value="' + esc(r.id) + '" aria-label="Select ' + esc(r.org) + ', ' + esc(fmtDate(r.date)) + ' to compare" style="accent-color:var(--accent);width:18px;height:18px"></td>' +
          '<td class="name">' + esc(r.org) + '</td><td>' + esc(fmtDate(r.date, true)) + '</td><td class="num"><b>' + s.score + '%</b></td><td><span class="lvl ' + s.level.key + '">' + s.level.label + '</span></td>' +
          '<td><div class="acts"><a class="btn small" href="#/report/a/' + esc(r.id) + '">Open</a><button class="btn ghost small" data-del-a="' + esc(r.id) + '" aria-label="Delete assessment for ' + esc(r.org) + '">Delete</button></div></td></tr>';
      });
      h += '</tbody></table></div>';
    }

    h += '<div class="rep-head"><h2 class="sec-h2">Domain checks</h2><a class="btn small" href="#/email">New check</a></div>';
    if (!Dc.length) h += '<div class="tablewrap"><p class="empty">No domain checks yet. <a href="#/email">Check your domain</a> — it takes about 10 seconds.</p></div>';
    else {
      h += '<div class="tablewrap"><table class="t"><thead><tr><th scope="col">Grade</th><th scope="col">Domain</th><th scope="col">Date</th><th scope="col" class="num">Score</th><th scope="col">Findings</th><th scope="col" class="num">Actions</th></tr></thead><tbody>';
      Dc.forEach(function (r) {
        var c = r.result.counts;
        h += '<tr><td><span class="gmini g-' + esc(r.result.grade) + '">' + esc(r.result.grade) + '</span></td><td class="name">' + esc(r.domain) + '</td><td>' + esc(fmtDate(r.date, true)) + '</td><td class="num"><b>' + r.result.score + '</b></td>' +
          '<td><span class="pill bad">' + c.fail + '</span> <span class="pill warn">' + c.warn + '</span> <span class="pill ok">' + c.pass + '</span></td>' +
          '<td><div class="acts"><a class="btn small" href="#/report/d/' + esc(r.id) + '">Open</a><a class="btn ghost small" href="#/email/' + encodeURIComponent(r.domain) + '" aria-label="Check ' + esc(r.domain) + ' again">Re-check</a><button class="btn ghost small" data-del-d="' + esc(r.id) + '" aria-label="Delete check for ' + esc(r.domain) + '">Delete</button></div></td></tr>';
      });
      h += '</tbody></table></div>';
    }
    h += DISCLAIMER;
    root.innerHTML = h;

    var cmpbtn = $('#cmpbtn');
    function sel() { return $$('.cmpchk:checked', root).map(function (c) { return c.value; }); }
    $$('.cmpchk', root).forEach(function (c) {
      c.addEventListener('change', function () {
        var s = sel();
        if (s.length > 2) { c.checked = false; s = sel(); toast('Pick two assessments to compare.'); }
        cmpbtn.disabled = s.length !== 2; cmpbtn.textContent = 'Compare selected (' + s.length + '/2)';
      });
    });
    if (cmpbtn) cmpbtn.addEventListener('click', function () { var s = sel(); if (s.length === 2) location.hash = '#/compare/' + s[0] + '/' + s[1]; });
    $$('[data-del-a]', root).forEach(function (b) { b.addEventListener('click', function () { removeRec(KEYS.a, b.getAttribute('data-del-a'), 'this assessment'); }); });
    $$('[data-del-d]', root).forEach(function (b) { b.addEventListener('click', function () { removeRec(KEYS.d, b.getAttribute('data-del-d'), 'this domain check'); }); });
  }

  function removeRec(key, id, label, after) {
    confirmBox('Delete ' + label + ' from this device? This cannot be undone.').then(function (ok) {
      if (!ok) return;
      save(key, load(key, []).filter(function (r) { return r.id !== id; }));
      toast('Deleted.');
      if (after) after(); else renderReports();
    });
  }

  function findRec(key, id) { var r = null; load(key, []).forEach(function (x) { if (x.id === id) r = x; }); return r; }

  /* ---------- charts (inline SVG, colours from CSS variables via classes) ---------- */
  function ringSvg(pct, label) {
    var r = 68, c = 2 * Math.PI * r, off = c * (1 - pct / 100);
    return '<svg class="ring" viewBox="0 0 170 170" role="img" aria-label="Overall score ' + pct + ' percent, ' + esc(label) + '">' +
      '<circle class="track" cx="85" cy="85" r="' + r + '" fill="none" stroke-width="14"/>' +
      '<circle class="val" cx="85" cy="85" r="' + r + '" fill="none" stroke-width="14" stroke-linecap="round" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '" transform="rotate(-90 85 85)"/>' +
      '<text class="big" x="85" y="88" text-anchor="middle">' + pct + '%</text><text class="small" x="85" y="110" text-anchor="middle">' + esc(label) + '</text></svg>';
  }
  function areaChartSvg(areas) {
    // Two columns of rows on wide screens would need media queries inside SVG; instead labels sit above each bar so it stays readable when scaled down.
    var W = 520, rowH = 42, top = 4, H = top + areas.length * rowH;
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Score by area"><title>Score by area</title>';
    areas.forEach(function (a, i) {
      var y = top + i * rowH, w = a.pct == null ? 0 : Math.max(3, W * a.pct / 100);
      s += '<text class="lbl" x="0" y="' + (y + 13) + '">' + esc(a.name) + '</text>';
      s += '<text class="pct" x="' + W + '" y="' + (y + 13) + '" text-anchor="end">' + (a.pct == null ? 'N/A' : a.pct + '% · ' + a.level.label) + '</text>';
      s += '<rect class="bg" x="0" y="' + (y + 20) + '" width="' + W + '" height="12" rx="6"/>';
      if (a.pct != null) s += '<rect class="b-' + a.level.key + '" x="0" y="' + (y + 20) + '" width="' + w.toFixed(1) + '" height="12" rx="6"><title>' + esc(a.name) + ': ' + a.pct + '% (' + a.level.label + ')</title></rect>';
    });
    return s + '</svg>';
  }
  var LEGEND = '<ul class="legend" aria-label="Maturity levels"><li><i class="k-start"></i>Starting out (under 40%)</li><li><i class="k-dev"></i>Developing (40–69%)</li><li><i class="k-good"></i>Established (70–89%)</li><li><i class="k-strong"></i>Strong (90%+)</li></ul>';

  function areaName(id) { var n = id; AREAS.forEach(function (a) { if (a.id === id) n = a.name; }); return n; }

  function printBtn() { return '<button type="button" class="btn" data-print>' + ICON.print + 'Print / Save as PDF</button>'; }
  function wirePrint(root) { $$('[data-print]', root).forEach(function (b) { b.addEventListener('click', function () { window.print(); }); }); }

  /* ---------- assessment report ---------- */
  function renderAssessReport(id) {
    var r = findRec(KEYS.a, id); if (!r) return false;
    var s = L.scoreAssessment(AREAS, QS, r.answers);
    var root = $('#report-root');
    $('#report-crumb').textContent = r.org;
    var high = s.plan.filter(function (p) { return p.level === 'High'; }).length;
    var quick = s.plan.filter(function (p) { return p.effort === 'quick' && p.level !== 'Low'; }).slice(0, 3);
    var h = '<article class="doc">';
    h += '<p class="print-only tiny muted" style="margin:0 0 10px">Daftarbox · Security self-assessment report</p>';
    h += '<div class="doc-top"><div><p class="kicker">Security self-assessment</p><h1 tabindex="-1">' + esc(r.org) + '</h1><p class="muted" style="margin:0">' + esc(fmtDate(r.date, true)) + (r.by ? ' · Completed by ' + esc(r.by) : '') + ' · ' + QS.length + ' questions, 13 areas</p></div>' +
      '<div class="doc-actions noprint">' + printBtn() + '<button type="button" class="btn ghost" data-edit>Edit answers</button><button type="button" class="btn ghost" data-del>Delete</button></div></div>';
    h += DISCLAIMER;
    h += '<div class="overview">' + ringSvg(s.score, s.level.label) + '<div class="stats">' +
      '<div class="stat"><b>' + s.score + '%</b><span>Overall score</span></div>' +
      '<div class="stat"><b class="lvl ' + s.level.key + '">' + s.level.label + '</b><span>Maturity level</span></div>' +
      '<div class="stat"><b>' + high + '</b><span>High-priority actions</span></div>' +
      '<div class="stat"><b>' + (s.total - s.unanswered) + '/' + s.total + '</b><span>Questions answered</span></div></div></div>';
    if (s.unanswered) h += '<p class="note">' + s.unanswered + ' unanswered question' + (s.unanswered > 1 ? 's were' : ' was') + ' counted as “No”.</p>';
    h += '<h2>Score by area</h2><div class="chart">' + areaChartSvg(s.areas) + '</div>' + LEGEND;

    h += '<h2>Your action plan</h2>';
    if (!s.plan.length) h += '<p>No gaps found — excellent. Repeat this assessment every 6–12 months, and consider an independent audit to confirm.</p>';
    else {
      h += '<p class="muted" style="margin-top:-4px">Ordered by risk: high-weight “No” answers first, then quicker fixes. Tackle the top of the list first.</p>';
      if (quick.length) {
        h += '<ul class="quick" aria-label="Quick wins to start with">' + quick.map(function (p) { return '<li><b>Quick win · ' + esc(areaName(p.area)) + '</b>' + esc(p.fix) + '</li>'; }).join('') + '</ul>';
      }
      h += '<ol class="plan" style="margin-top:14px">';
      s.plan.forEach(function (p) {
        var lv = p.level === 'High' ? 'bad' : p.level === 'Medium' ? 'warn' : '';
        h += '<li><div><div class="tags"><span class="pill ' + lv + '">' + p.level + ' priority</span><span class="eff">' + EFFORT[p.effort] + '</span><span class="eff">' + esc(areaName(p.area)) + '</span><span class="eff">You said: ' + ANSWER[p.answer] + '</span></div>' +
          '<p class="gap">' + esc(p.q) + '</p><p class="fixtxt">' + esc(p.fix) + '</p></div></li>';
      });
      h += '</ol>';
    }
    h += '<h2>All answers</h2><details class="answers" data-printopen><summary>Show every question and answer</summary>';
    AREAS.forEach(function (a) {
      var ar = s.areas.filter(function (x) { return x.id === a.id; })[0];
      h += '<h3>' + esc(a.name) + ' — ' + (ar.pct == null ? 'N/A' : ar.pct + '%') + ' <span class="lvl ' + ar.level.key + '" style="font-size:.85rem">' + ar.level.label + '</span></h3><table class="t"><tbody>';
      areaQs(a.id).forEach(function (q) {
        var v = r.answers[q.id] || 'unanswered', cls = v === 'yes' ? 'ok' : v === 'partly' ? 'warn' : v === 'no' || v === 'unanswered' ? 'bad' : '';
        h += '<tr><td>' + esc(q.q) + '</td><td><span class="pill ' + cls + '">' + ANSWER[v] + '</span></td></tr>';
      });
      h += '</tbody></table>';
    });
    h += '</details>';
    h += '<p class="tiny muted" style="margin-top:26px">Questions draw on ideas from CIS Controls v8 (IG1), NIST CSF 2.0, ISO/IEC 27001 Annex A themes, CERT-In Directions (April 2022) and the DPDP Act 2023 with DPDP Rules 2025. Wording and scoring are Daftarbox’s own. Generated ' + esc(fmtDate(new Date().toISOString(), true)) + '.</p>';
    h += '</article>';
    h += '<div class="noprint" style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px"><a class="btn ghost" href="#/reports">← All reports</a><a class="btn ghost" href="#/email">Check your email domain</a></div>';
    root.innerHTML = h;
    wirePrint(root);
    $('[data-edit]', root).addEventListener('click', function () {
      var go = function () { setDraft({ org: r.org, by: r.by, answers: JSON.parse(JSON.stringify(r.answers)), step: 0, started: r.date, editingId: r.id }); if (location.hash === '#/assess/1') route(); else location.hash = '#/assess/1'; }; // same hash fires no hashchange
      var dr = getDraft();
      if (dr && answeredCount(dr.answers || {}) && dr.editingId !== r.id) confirmBox('You have another unfinished assessment. Editing this report will replace it.', 'Continue').then(function (ok) { if (ok) go(); });
      else go();
    });
    $('[data-del]', root).addEventListener('click', function () { removeRec(KEYS.a, r.id, 'this assessment', function () { location.hash = '#/reports'; }); });
    show('report', r.org + ' report');
    return true;
  }

  /* ---------- domain report ---------- */
  function renderDomainReport(id) {
    var r = findRec(KEYS.d, id); if (!r) return false;
    var root = $('#report-root');
    $('#report-crumb').textContent = r.domain;
    var h = '<article class="doc"><p class="print-only tiny muted" style="margin:0 0 10px">Daftarbox · Email &amp; domain security report</p>';
    h += '<div class="doc-top"><div><p class="kicker">Email &amp; domain security check</p><h1 tabindex="-1">' + esc(r.domain) + '</h1><p class="muted" style="margin:0">Checked ' + esc(fmtDate(r.date, true)) + ' using public DNS records</p></div>' +
      '<div class="doc-actions noprint">' + printBtn() + '<a class="btn ghost" href="#/email/' + encodeURIComponent(r.domain) + '">Check again</a><button type="button" class="btn ghost" data-del>Delete</button></div></div>';
    h += DISCLAIMER;
    h += domainResultHtml(r, { tool: false }).replace('class="results"', 'class="results" style="border:0;padding:0;margin-top:10px"');
    h += '</article><div class="noprint" style="margin-top:16px"><a class="btn ghost" href="#/reports">← All reports</a></div>';
    root.innerHTML = h;
    wirePrint(root); wireDomainResult(root);
    $('[data-del]', root).addEventListener('click', function () { removeRec(KEYS.d, r.id, 'this domain check', function () { location.hash = '#/reports'; }); });
    show('report', r.domain + ' report');
    return true;
  }

  /* ---------- compare ---------- */
  function renderCompare(id1, id2) {
    var a = findRec(KEYS.a, id1), b = findRec(KEYS.a, id2); if (!a || !b) return false;
    if (new Date(a.date) > new Date(b.date)) { var t = a; a = b; b = t; }   // older first
    var sa = L.scoreAssessment(AREAS, QS, a.answers), sb = L.scoreAssessment(AREAS, QS, b.answers);
    var root = $('#report-root');
    $('#report-crumb').textContent = 'Compare';
    function cell(p) { return p == null ? 'N/A' : '<span class="minibar" style="width:' + Math.max(2, p * 0.6) + 'px" aria-hidden="true"></span>' + p + '%'; }
    function delta(x, y) { if (x == null || y == null) return '—'; var d = y - x; return '<span class="delta ' + (d > 0 ? 'up' : d < 0 ? 'down' : '') + '">' + (d > 0 ? '+' : '') + d + '</span>'; }
    var h = '<article class="doc"><p class="print-only tiny muted" style="margin:0 0 10px">Daftarbox · Assessment comparison</p>';
    h += '<div class="doc-top"><div><p class="kicker">Compare assessments</p><h1 tabindex="-1">' + esc(a.org) + (a.org !== b.org ? ' vs ' + esc(b.org) : '') + '</h1>' +
      '<p class="muted" style="margin:0">' + esc(fmtDate(a.date)) + ' → ' + esc(fmtDate(b.date)) + '</p></div><div class="doc-actions noprint">' + printBtn() + '</div></div>';
    h += DISCLAIMER;
    h += '<div class="stats"><div class="stat"><b>' + sa.score + '%</b><span>Earlier · ' + esc(fmtDate(a.date)) + '</span></div><div class="stat"><b>' + sb.score + '%</b><span>Later · ' + esc(fmtDate(b.date)) + '</span></div>' +
      '<div class="stat cmp"><b>' + delta(sa.score, sb.score) + '</b><span>Change in points</span></div><div class="stat"><b>' + sa.plan.length + ' → ' + sb.plan.length + '</b><span>Open actions</span></div></div>';
    h += '<div class="tablewrap"><table class="t cmp"><thead><tr><th scope="col">Area</th><th scope="col">Earlier</th><th scope="col">Later</th><th scope="col" class="num">Change</th></tr></thead><tbody>';
    AREAS.forEach(function (ar, i) {
      h += '<tr><td class="name">' + esc(ar.name) + '</td><td>' + cell(sa.areas[i].pct) + '</td><td>' + cell(sb.areas[i].pct) + '</td><td class="num">' + delta(sa.areas[i].pct, sb.areas[i].pct) + '</td></tr>';
    });
    h += '<tr><td class="name"><b>Overall</b></td><td><b>' + sa.score + '%</b></td><td><b>' + sb.score + '%</b></td><td class="num">' + delta(sa.score, sb.score) + '</td></tr></tbody></table></div>';
    var fixed = sa.plan.filter(function (p) { return !sb.plan.some(function (q) { return q.id === p.id; }); });
    var fresh = sb.plan.filter(function (p) { return !sa.plan.some(function (q) { return q.id === p.id; }); });
    h += '<h2>Gaps closed (' + fixed.length + ')</h2>' + (fixed.length ? '<ul>' + fixed.map(function (p) { return '<li>' + esc(p.q) + '</li>'; }).join('') + '</ul>' : '<p class="muted">None yet.</p>');
    h += '<h2>New gaps (' + fresh.length + ')</h2>' + (fresh.length ? '<ul>' + fresh.map(function (p) { return '<li>' + esc(p.q) + '</li>'; }).join('') + '</ul>' : '<p class="muted">None — nothing has slipped.</p>');
    h += '</article><div class="noprint" style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap"><a class="btn ghost" href="#/reports">← All reports</a><a class="btn ghost" href="#/report/a/' + esc(b.id) + '">Open later report</a></div>';
    root.innerHTML = h;
    wirePrint(root);
    show('report', 'Compare assessments');
    return true;
  }

  /* ---------- print: open collapsed sections so they appear on paper ---------- */
  var reopened = [];
  window.addEventListener('beforeprint', function () {
    reopened = $$('.view:not([hidden]) details:not([open])'); reopened.forEach(function (d) { d.open = true; });
  });
  window.addEventListener('afterprint', function () { reopened.forEach(function (d) { d.open = false; }); reopened = []; });

  route();
})();
