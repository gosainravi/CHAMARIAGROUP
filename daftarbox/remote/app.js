/* Remote access portal – UI. Classic script, works from file:// and http. Depends on logic.js (window.RemoteLogic). */
(function () {
  'use strict';
  var L = window.RemoteLogic;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var SOON = 'Available when connection service goes live';

  /* ---------- Storage (always wrapped) ---------- */
  var P = 'daftarbox.remote.';
  function load(k, def) {
    try { var v = localStorage.getItem(P + k); return v == null ? def : JSON.parse(v); } catch (e) { return def; }
  }
  function save(k, v) {
    try { localStorage.setItem(P + k, JSON.stringify(v)); return true; } catch (e) { return false; }
  }

  /* ---------- Toast ---------- */
  var toastEl = $('#toast'), toastT;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove('show'); }, 2600);
  }

  function copy(text, what) {
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) { }
      document.body.removeChild(ta);
      toast(ok ? what + ' copied' : 'Could not copy. Please select it and copy by hand.');
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { toast(what + ' copied'); }, fallback);
    } else fallback();
  }

  /* ---------- Dialogs ---------- */
  function openDlg(d) { if (d.showModal) { if (!d.open) d.showModal(); } else d.setAttribute('open', ''); }
  function closeDlg(d) { if (d.close) d.close(); else d.removeAttribute('open'); }
  document.addEventListener('click', function (e) {
    var c = e.target.closest('[data-close]');
    if (c) { var d = c.closest('dialog'); if (d) closeDlg(d); }
  });
  var cfCb = null;
  function confirmDlg(title, text, okLabel, cb) {
    $('#cf-title').textContent = title; $('#cf-text').textContent = text; $('#cf-ok').textContent = okLabel;
    cfCb = cb; openDlg($('#dlg-confirm'));
  }
  $('#cf-ok').addEventListener('click', function () { closeDlg($('#dlg-confirm')); if (cfCb) cfCb(); cfCb = null; });

  /* "Coming soon" controls */
  document.addEventListener('click', function (e) {
    var s = e.target.closest('.soon');
    if (s) { e.preventDefault(); toast(s.getAttribute('data-tip') || SOON); }
  });

  /* ---------- Router ---------- */
  var TITLES = { '': 'Connect', preview: 'Screen preview', devices: 'Devices', history: 'Session history', settings: 'Settings', download: 'Download', safety: 'Stay safe' };
  var current = null;
  function route() {
    var r = (location.hash || '').replace(/^#\/?/, '').split(/[/?]/)[0];
    if (!(r in TITLES)) r = '';
    $$('.view').forEach(function (v) { v.hidden = v.getAttribute('data-view') !== r; });
    $$('.nav a').forEach(function (a) {
      if (a.getAttribute('data-r') === r) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.title = (r ? TITLES[r] + ' · ' : '') + 'Remote access – Daftarbox';
    if (r === 'devices') renderDevices();
    if (r === 'history') renderHistory();
    if (current !== null && current !== r) {
      window.scrollTo(0, 0);
      var h = $('.view[data-view="' + r + '"] h1'); if (h) h.focus({ preventScroll: true });
    }
    current = r;
  }
  window.addEventListener('hashchange', route);

  /* ---------- Connect: Get help ---------- */
  var myId = load('id', null);
  if (!myId || !L.checkId(myId).ok) { myId = L.genId(); save('id', myId); }
  $('#my-id').textContent = L.formatId(myId);
  $('#copy-id').addEventListener('click', function () { copy(myId, 'ID'); });

  var otp = L.genOtp(), otpHidden = false;
  function showOtp() {
    $('#otp').textContent = otpHidden ? '••••-••••' : otp;
    var b = $('#show-otp');
    b.setAttribute('aria-pressed', String(otpHidden));
    b.setAttribute('aria-label', otpHidden ? 'Show password' : 'Hide password');
    b.setAttribute('data-tip', otpHidden ? 'Show' : 'Hide');
    b.querySelector('use').setAttribute('href', otpHidden ? '#i-eye' : '#i-eyeoff');
  }
  showOtp();
  $('#show-otp').addEventListener('click', function () { otpHidden = !otpHidden; showOtp(); });
  $('#new-otp').addEventListener('click', function () { otp = L.genOtp(); showOtp(); toast('New password made. The old one no longer works.'); });
  $('#copy-otp').addEventListener('click', function () { copy(otp, 'Password'); });

  var MODE_TXT = { control: 'They can see your screen and use your mouse and keyboard.', view: 'They can only see your screen. They can’t click or type.' };
  function setMode(m) {
    $$('[data-mode]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-mode') === m)); });
    $('#mode-desc').textContent = MODE_TXT[m];
  }
  var mode = load('mode', 'control'); if (!MODE_TXT[mode]) mode = 'control'; setMode(mode);
  $$('[data-mode]').forEach(function (b) {
    b.addEventListener('click', function () { mode = b.getAttribute('data-mode'); setMode(mode); save('mode', mode); });
  });

  /* ---------- Connect: Help someone ---------- */
  var partner = $('#partner'), pMsg = $('#partner-msg'), P_HINT = pMsg.textContent;
  function liveFormat(input) {
    input.addEventListener('input', function () {
      var before = input.value, caret = input.selectionStart, digitsBefore = L.digitsOnly(before.slice(0, caret)).length;
      var f = L.formatId(before); input.value = f;
      var pos = 0, seen = 0; while (pos < f.length && seen < digitsBefore) { if (/\d/.test(f[pos])) seen++; pos++; }
      try { input.setSelectionRange(pos, pos); } catch (e) { }
    });
  }
  liveFormat(partner);
  partner.addEventListener('input', function () {
    partner.removeAttribute('aria-invalid'); pMsg.className = 'field-msg';
    var d = L.digitsOnly(partner.value);
    pMsg.textContent = d.length === 9 ? (L.checkId(d).ok ? 'Looks good.' : L.checkId(d).msg) : P_HINT;
    if (d.length === 9 && !L.checkId(d).ok) pMsg.className = 'field-msg err';
  });
  function devices() { return load('devices', []); }
  function startConnect(id) {
    var dev = devices().filter(function (x) { return x.id === id; })[0];
    $('#dc-id').textContent = L.formatId(id);
    $('#dc-name').textContent = dev ? ' (' + dev.name + ')' : '';
    openDlg($('#dlg-connect'));
  }
  $('#connect-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var c = L.checkId(partner.value);
    if (c.ok && c.id === myId) c = { ok: false, msg: 'That’s this device’s own ID. Type the ID shown on the other computer.' };
    if (!c.ok) {
      partner.setAttribute('aria-invalid', 'true'); pMsg.className = 'field-msg err'; pMsg.textContent = c.msg; partner.focus(); return;
    }
    startConnect(c.id);
  });
  function renderRecent() {
    var list = devices().slice(0, 4), box = $('#recent');
    $('#recent-wrap').hidden = !list.length; box.textContent = '';
    list.forEach(function (d) {
      var b = document.createElement('button'); b.type = 'button';
      b.innerHTML = '<svg class="i sm"><use href="#i-monitor"/></svg>';
      b.appendChild(document.createTextNode(d.name));
      b.setAttribute('aria-label', 'Use ID of ' + d.name);
      b.addEventListener('click', function () {
        partner.value = L.formatId(d.id); partner.dispatchEvent(new Event('input')); partner.focus();
      });
      box.appendChild(b);
    });
  }

  /* ---------- Screen preview ---------- */
  var stream = null, shareStart = 0, tick = null;
  var vid = $('#vid'), shareMsg = $('#share-msg'), SHARE_HINT = shareMsg.textContent;
  function canShare() { return !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia); }
  if (!canShare()) {
    shareMsg.textContent = 'This browser can’t share its screen. Try Chrome, Edge or Firefox on a computer.';
    $('#start-share').disabled = true;
  }
  var QUALITY = { auto: { frameRate: 24 }, best: { frameRate: 30, width: { ideal: 1920 } }, fast: { frameRate: 10, width: { max: 1280 } } };
  function applyQuality() {
    if (!stream) return;
    var t = stream.getVideoTracks()[0];
    if (t && t.applyConstraints) t.applyConstraints(QUALITY[$('#quality').value] || {}).catch(function () { toast('Your browser kept its own quality setting.'); });
  }
  $('#quality').addEventListener('change', applyQuality);
  function setSharingUi(on) {
    vid.hidden = !on; $('#screen-empty').hidden = on; $('#who').hidden = !on; $('#alert-bar').hidden = !on;
    $('#tb-end').disabled = !on; $('#tb-full').disabled = !on;
    $('#st-state').textContent = on ? 'Sharing (preview)' : 'Not sharing';
    if (!on) { $('#st-size').textContent = '–'; $('#st-fps').textContent = '–'; }
  }
  function updateStats() {
    $('#alert-time').textContent = L.fmtDuration((Date.now() - shareStart) / 1000);
    var t = stream && stream.getVideoTracks()[0]; if (!t || !t.getSettings) return;
    var s = t.getSettings();
    if (s.width) $('#st-size').textContent = s.width + ' × ' + s.height;
    if (s.frameRate) $('#st-fps').textContent = Math.round(s.frameRate) + ' fps';
  }
  function startShare() {
    if (stream || !canShare()) return;
    shareMsg.textContent = 'Waiting for you to pick a screen…';
    navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 24 }, audio: false }).then(function (s) {
      stream = s; shareStart = Date.now(); vid.srcObject = s;
      var p = vid.play(); if (p && p.catch) p.catch(function () { });
      s.getVideoTracks()[0].addEventListener('ended', function () { stopShare('Browser'); });
      setSharingUi(true); applyQuality(); updateStats(); tick = setInterval(updateStats, 1000);
      shareMsg.textContent = SHARE_HINT;
      toast('Preview started. Only you can see this.');
    }, function (err) {
      var n = err && err.name;
      shareMsg.textContent = n === 'NotAllowedError' ? 'Sharing was cancelled. Press Start preview to try again.'
        : n === 'NotFoundError' ? 'No screen was found to share.'
        : 'Your browser could not start sharing. Try Chrome, Edge or Firefox on a computer.';
    });
  }
  function stopShare(by) {
    if (!stream) return;
    var end = Date.now();
    stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null; vid.srcObject = null; clearInterval(tick);
    if (document.fullscreenElement) { try { document.exitFullscreen(); } catch (e) { } }
    setSharingUi(false);
    addHistory({ start: shareStart, end: end, type: 'Preview', with: 'This device (local preview)', access: 'View only', endedBy: by });
    toast('Preview ended. Logged in History.');
  }
  $('#start-share').addEventListener('click', startShare);
  $('#tb-end').addEventListener('click', function () { stopShare('You'); });
  $('#alert-end').addEventListener('click', function () { stopShare('You'); });
  $('#tb-full').addEventListener('click', function () {
    var el = $('#screen');
    if (el.requestFullscreen) el.requestFullscreen().catch(function () { toast('Full screen is not allowed here.'); });
  });
  $('#tb-view').addEventListener('click', function () { toast('View mode is on. Control comes with the app.'); });
  function openReport() { openDlg($('#dlg-report')); }
  $('#tb-report').addEventListener('click', openReport);
  $('#alert-report').addEventListener('click', openReport);
  window.addEventListener('pagehide', function () { if (stream) stopShare('Page closed'); });

  /* ---------- History ---------- */
  function history() {
    var h = load('history', []);
    return Array.isArray(h) ? h : [];
  }
  function addHistory(entry) {
    var list = history(); list.unshift(entry);
    list = L.pruneHistory(list, +settings.keep || 0).slice(0, 500);
    save('history', list);
    if (current === 'history') renderHistory();
  }
  function fmtWhen(ms) {
    try { return new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }); }
    catch (e) { return new Date(ms).toString(); }
  }
  function renderHistory() {
    var list = history(), body = $('#his-body');
    body.textContent = '';
    var total = 0; list.forEach(function (h) { total += Math.max(0, (h.end - h.start) / 1000); });
    $('#his-stats').innerHTML = '';
    [[list.length, 'Sessions'], [L.fmtDuration(total), 'Total time'], [list.filter(function (h) { return h.type !== 'Preview'; }).length, 'Real sessions (after launch)']]
      .forEach(function (s) {
        var d = document.createElement('div'); d.className = 'stat';
        var b = document.createElement('b'); b.textContent = s[0];
        var sp = document.createElement('span'); sp.textContent = s[1];
        d.appendChild(b); d.appendChild(sp); $('#his-stats').appendChild(d);
      });
    var empty = !list.length;
    $('#his-empty').hidden = !empty; $('#his-table-wrap').hidden = empty;
    $('#his-csv').disabled = empty; $('#his-clear').disabled = empty;
    list.forEach(function (h) {
      var tr = document.createElement('tr');
      [['When', fmtWhen(h.start)], ['Type', h.type], ['With', h.with], ['Access', h.access], ['Length', L.fmtDuration((h.end - h.start) / 1000)], ['Ended by', h.endedBy]]
        .forEach(function (c, i) {
          var td = document.createElement('td'); td.setAttribute('data-l', c[0]);
          if (i === 1) { var p = document.createElement('span'); p.className = 'pill'; p.textContent = c[1]; td.appendChild(p); }
          else td.textContent = c[1];
          if (i === 4) td.className = 'num';
          tr.appendChild(td);
        });
      body.appendChild(tr);
    });
  }
  $('#his-csv').addEventListener('click', function () {
    var rows = [['Start', 'End', 'Type', 'With', 'Access', 'Length (seconds)', 'Ended by']];
    history().forEach(function (h) {
      rows.push([new Date(h.start).toISOString(), new Date(h.end).toISOString(), h.type, h.with, h.access, Math.round((h.end - h.start) / 1000), h.endedBy]);
    });
    var blob = new Blob(['﻿' + L.toCsv(rows)], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'remote-sessions-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast('CSV file saved');
  });
  $('#his-clear').addEventListener('click', function () {
    confirmDlg('Clear history?', 'This removes all sessions listed here from this browser. It can’t be undone.', 'Clear history', function () {
      save('history', []); renderHistory(); toast('History cleared');
    });
  });

  /* ---------- Devices ---------- */
  var devQ = '', devGroup = '', editing = null;
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function renderDevices() {
    var all = devices();
    var groups = {}; all.forEach(function (d) { if (d.group) groups[d.group] = 1; });
    var gnames = Object.keys(groups).sort();
    if (devGroup && devGroup !== '*un' && !groups[devGroup]) devGroup = '';
    var chips = $('#dev-groups'); chips.textContent = '';
    if (all.length) {
      [['', 'All']].concat(gnames.map(function (g) { return [g, g]; })).concat([['*un', 'Unattended']]).forEach(function (g) {
        var b = document.createElement('button'); b.type = 'button'; b.textContent = g[1];
        b.setAttribute('aria-pressed', String(devGroup === g[0]));
        b.addEventListener('click', function () { devGroup = g[0]; renderDevices(); });
        chips.appendChild(b);
      });
    }
    var dl = $('#group-list'); dl.textContent = '';
    gnames.forEach(function (g) { var o = document.createElement('option'); o.value = g; dl.appendChild(o); });

    var q = devQ.toLowerCase().trim(), qd = L.digitsOnly(q);
    var list = all.filter(function (d) {
      if (devGroup === '*un' && !d.unattended) return false;
      if (devGroup && devGroup !== '*un' && d.group !== devGroup) return false;
      if (!q) return true;
      return (d.name + ' ' + d.group + ' ' + d.notes).toLowerCase().indexOf(q) >= 0 || (qd && d.id.indexOf(qd) >= 0);
    });
    var ul = $('#dev-list'); ul.textContent = '';
    list.forEach(function (d) { ul.appendChild(devCard(d)); });
    $('#dev-empty').hidden = all.length > 0;
    $('#dev-nomatch').hidden = !all.length || list.length > 0;
    $('#dev-count').textContent = all.length ? list.length + ' of ' + all.length + ' devices shown' : '';
    renderRecent();
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function devCard(d) {
    var li = el('li', 'dcard');
    var h = el('div', 'dcard-h');
    var ico = el('div', 'ico'); ico.innerHTML = '<svg class="i"><use href="#i-monitor"/></svg>';
    var t = el('div', 'min0'); t.appendChild(el('h3', '', d.name)); t.appendChild(el('div', 'did', L.formatId(d.id)));
    h.appendChild(ico); h.appendChild(t); li.appendChild(h);
    var meta = el('div', 'meta');
    if (d.group) meta.appendChild(el('span', 'pill', d.group));
    meta.appendChild(el('span', d.unattended ? 'pill ok' : 'pill', d.unattended ? 'Unattended on' : 'Needs approval'));
    li.appendChild(meta);
    if (d.notes) li.appendChild(el('p', 'notes', d.notes));
    var f = el('div', 'dcard-f');
    var c = el('button', 'btn small'); c.type = 'button'; c.innerHTML = '<svg class="i sm"><use href="#i-link"/></svg>Connect';
    c.setAttribute('aria-label', 'Connect to ' + d.name);
    c.addEventListener('click', function () { startConnect(d.id); });
    var e = el('button', 'icon-btn'); e.type = 'button'; e.innerHTML = '<svg class="i sm"><use href="#i-edit"/></svg>';
    e.setAttribute('aria-label', 'Edit ' + d.name); e.addEventListener('click', function () { openDevForm(d); });
    var x = el('button', 'icon-btn'); x.type = 'button'; x.innerHTML = '<svg class="i sm"><use href="#i-trash"/></svg>';
    x.setAttribute('aria-label', 'Delete ' + d.name);
    x.addEventListener('click', function () {
      confirmDlg('Delete device?', '“' + d.name + '” will be removed from your devices.', 'Delete', function () {
        save('devices', devices().filter(function (y) { return y.key !== d.key; })); renderDevices(); toast('Device deleted');
      });
    });
    f.appendChild(c); f.appendChild(e); f.appendChild(x); li.appendChild(f);
    return li;
  }
  var devForm = $('#dev-form');
  liveFormat(devForm.elements.id);
  function setErr(name, msg) {
    var inp = devForm.elements[name], m = $('#e-' + name);
    m.textContent = msg || '';
    if (msg) inp.setAttribute('aria-invalid', 'true'); else inp.removeAttribute('aria-invalid');
  }
  function openDevForm(d) {
    editing = d || null;
    $('#dd-title').textContent = d ? 'Edit device' : 'Add device';
    devForm.elements.name.value = d ? d.name : '';
    devForm.elements.id.value = d ? L.formatId(d.id) : '';
    devForm.elements.group.value = d ? d.group : (devGroup && devGroup !== '*un' ? devGroup : '');
    devForm.elements.notes.value = d ? d.notes : '';
    devForm.elements.unattended.checked = d ? d.unattended : false;
    setErr('name'); setErr('id');
    openDlg($('#dlg-dev'));
    devForm.elements.name.focus();
  }
  devForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = devForm.elements;
    var r = L.cleanDevice({ name: f.name.value, id: f.id.value, group: f.group.value, notes: f.notes.value, unattended: f.unattended.checked });
    var list = devices();
    if (r.ok) {
      var dup = list.filter(function (x) { return x.id === r.device.id && (!editing || x.key !== editing.key); })[0];
      if (dup) { r.ok = false; r.errs.id = 'You already saved this ID as “' + dup.name + '”.'; }
    }
    setErr('name', r.errs.name); setErr('id', r.errs.id);
    if (!r.ok) { (r.errs.name ? f.name : f.id).focus(); return; }
    if (editing) {
      list = list.map(function (x) { return x.key === editing.key ? Object.assign({ key: x.key, added: x.added }, r.device) : x; });
    } else {
      list.unshift(Object.assign({ key: uid(), added: Date.now() }, r.device));
    }
    if (!save('devices', list)) { toast('Could not save. Your browser storage may be full or turned off.'); return; }
    closeDlg($('#dlg-dev')); renderDevices(); toast(editing ? 'Device updated' : 'Device saved');
  });
  $('#add-dev').addEventListener('click', function () { openDevForm(null); });
  $$('[data-act="add-dev"]').forEach(function (b) { b.addEventListener('click', function () { openDevForm(null); }); });
  $('#dev-q').addEventListener('input', function () { devQ = this.value; renderDevices(); });
  $('#dev-clear').addEventListener('click', function () { devQ = ''; devGroup = ''; $('#dev-q').value = ''; renderDevices(); $('#dev-q').focus(); });

  /* ---------- Settings ---------- */
  var DEFAULTS = { approve: true, trustedOnly: false, unattended: false, timeout: '30',
    p_control: true, p_files: true, p_clip: true, p_audio: false, p_restart: false,
    record: false, blank: false, keep: '90', sound: true, popup: true, email: false };
  var settings = Object.assign({}, DEFAULTS, load('settings', {}));
  var sf = $('#settings');
  function fillSettings() {
    Object.keys(DEFAULTS).forEach(function (k) {
      var i = sf.elements[k]; if (!i) return;
      if (i.type === 'checkbox') i.checked = !!settings[k]; else i.value = String(settings[k]);
    });
    sf.elements.p_screen.checked = true;
    syncSettingsUi();
  }
  function syncSettingsUi() {
    $('#approve-warn').hidden = settings.approve;
    $('#un-box').hidden = !settings.unattended;
  }
  var savedT;
  sf.addEventListener('change', function (e) {
    var i = e.target; if (!i.name || !(i.name in DEFAULTS)) return;
    settings[i.name] = i.type === 'checkbox' ? i.checked : i.value;
    var ok = save('settings', settings);
    syncSettingsUi();
    if (i.name === 'keep') save('history', L.pruneHistory(history(), +settings.keep || 0));
    var st = $('#set-status');
    st.className = 'status ' + (ok ? 'ok' : 'err');
    st.textContent = ok ? 'Saved' : 'Could not save. Browser storage may be turned off.';
    clearTimeout(savedT); savedT = setTimeout(function () { st.textContent = ''; }, 2000);
  });
  $('#set-reset').addEventListener('click', function () {
    confirmDlg('Reset settings?', 'All settings go back to the safest defaults.', 'Reset', function () {
      settings = Object.assign({}, DEFAULTS); save('settings', settings); fillSettings(); toast('Settings reset');
    });
  });
  $$('[data-jump]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault(); var t = document.getElementById(a.getAttribute('data-jump'));
      if (t) { t.scrollIntoView({ behavior: 'smooth', block: 'start' }); var h = t.querySelector('h2'); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); } }
    });
  });

  /* Unattended password */
  var pw = $('#un-pw'), pw2 = $('#un-pw2');
  function updateMeter() {
    var s = L.strength(pw.value);
    $('#meter').setAttribute('data-s', pw.value ? String(Math.max(1, s.score)) : '0');
    $('#meter-label').textContent = 'Strength: ' + s.label;
    var tips = $('#pw-tips'); tips.textContent = '';
    if (pw.value) s.tips.slice(0, 3).forEach(function (t) { tips.appendChild(el('li', '', t)); });
    $('#un-status').textContent = '';
  }
  pw.addEventListener('input', updateMeter);
  pw2.addEventListener('input', function () { $('#un-status').textContent = ''; });
  $('#un-show').addEventListener('click', function () {
    var show = pw.type === 'password';
    pw.type = pw2.type = show ? 'text' : 'password';
    this.setAttribute('aria-pressed', String(show));
    this.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    this.querySelector('use').setAttribute('href', show ? '#i-eyeoff' : '#i-eye');
  });
  $('#un-check').addEventListener('click', function () {
    var s = L.strength(pw.value), st = $('#un-status');
    if (!s.ok) { st.className = 'status err'; st.textContent = 'Not strong enough yet. Use 12 or more characters and mix letters, numbers and symbols.'; pw.focus(); return; }
    if (pw.value !== pw2.value) { st.className = 'status err'; st.textContent = 'The two passwords don’t match.'; pw2.focus(); return; }
    st.className = 'status ok'; st.textContent = 'Strong password. Set the same one in the desktop app when it’s out.';
  });

  /* ---------- Start ---------- */
  fillSettings();
  save('history', L.pruneHistory(history(), +settings.keep || 0));
  renderRecent();
  route();
})();
