/* Daftarbox Wi-Fi heat mapping: routing, the automatic analysis pipeline, results, report and bill of materials. */
'use strict';

/* ---------- change pipeline and saving ---------- */
function changed() {
  if (!S.p) return;
  S.p.updated = Date.now();
  S.heatDirty = true;
  if (S.step >= 3) requestHeat();
  refreshPanel(); updateSteps(); render(); scheduleSave();
}
let saveT = 0;
function setSaved(state) {
  const el = $('#savedState');
  el.classList.toggle('err', state === 'err');
  el.innerHTML = state === 'saving' ? 'Saving…' : state === 'ok' ? icon('check', 'sm') + 'Saved' : state === 'err' ? icon('warn', 'sm') + 'Not saved' : '';
  el.title = state === 'err' ? 'This browser blocks saving. Download the project file in step 4 to keep it.' : '';
}
function scheduleSave() { clearTimeout(saveT); setSaved('saving'); saveT = setTimeout(saveNow, 800); }
function makeThumb() {
  const f = S.p.floors[0], im = f && S.images.get(f.id);
  if (!im || !im.img) return '';
  try {
    const b = f.an && f.an.box ? f.an.box : { x0: 0, y0: 0, x1: f.imgW, y1: f.imgH };
    const c = document.createElement('canvas'); c.width = 144; c.height = 104;
    const g = c.getContext('2d'), bw = b.x1 - b.x0, bh = b.y1 - b.y0, k = Math.min(140 / bw, 100 / bh);
    g.fillStyle = '#fff'; g.fillRect(0, 0, 144, 104);
    g.drawImage(im.img, b.x0, b.y0, bw, bh, (144 - bw * k) / 2, (104 - bh * k) / 2, bw * k, bh * k);
    return c.toDataURL('image/jpeg', 0.75);
  } catch (e) { return ''; }
}
async function saveNow() {
  if (!S.p) return;
  try {
    for (const f of S.p.floors) {
      const key = S.p.id + '/' + f.id, im = S.images.get(f.id);
      if (!S.savedImgs.has(key) && im && im.blob) { await DB.putImage(key, im.blob); S.savedImgs.add(key); }
    }
    const rec = Object.assign({}, S.p, { thumb: makeThumb() });
    await DB.putProject(rec);
    lsSet('kw-last', S.p.id);
    setSaved('ok');
  } catch (e) { console.warn(e); setSaved('err'); }
}

/* ---------- routing ---------- */
function route() {
  const h = location.hash || '#/';
  const m = /^#\/edit\/(\d)/.exec(h);
  if (m) {
    if (!S.p) {
      const last = lsGet('kw-last');
      if (last) openProject(last, +m[1]).catch(() => { location.hash = '#/'; });
      else location.hash = '#/';
      return;
    }
    showEditor(+m[1]); return;
  }
  showView(h.indexOf('#/projects') === 0 ? 'projects' : h.indexOf('#/help') === 0 ? 'help' : 'start');
}
function showView(name) {
  ['start', 'projects', 'help'].forEach(v => { $('#v-' + v).hidden = v !== name; });
  $('#v-editor').hidden = true;
  document.body.classList.remove('editing');
  $$('.nav a').forEach(a => { if (a.dataset.nav === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  if (name === 'projects') renderProjects();
  if (name === 'start') renderRecent();
  document.title = (name === 'projects' ? 'My projects' : name === 'help' ? 'How it works' : 'Wi-Fi heat map planner') + ' – Daftarbox';
  window.scrollTo(0, 0);
}
function showEditor(step) {
  ['start', 'projects', 'help'].forEach(v => { $('#v-' + v).hidden = true; });
  $('#v-editor').hidden = false;
  document.body.classList.add('editing');
  $$('.nav a').forEach(a => a.removeAttribute('aria-current'));
  document.title = S.p.name + ' – Wi-Fi plan – Daftarbox';
  syncProjectUI();
  setStep(step);
}
const go = n => { const h = '#/edit/' + n; if (location.hash === h) { if (S.p) showEditor(n); } else location.hash = h; };

/* ---------- steps ---------- */
function setStep(n) {
  const f = floor();
  n = clamp(n | 0, 1, 4);
  if (n >= 3 && f && !f.an && !S.analysing) n = 2;
  S.step = n; S.draft = null; S.cursor = null; S.hover = null;
  if (n !== 3) setAdjust(false);
  $$('.pn').forEach(p => p.classList.toggle('on', +p.dataset.pn === n));
  $$('#stepList button').forEach(b => { if (+b.dataset.step === n) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); });
  $('#doc').hidden = n !== 4;
  $('#maps').style.visibility = n === 4 ? 'hidden' : '';
  $('#zoomctl').hidden = n === 4;
  setLayout();
  if (n === 3 && f && (S.heatDirty || !S.heat || S.heat.fid !== f.id || S.heat.draft)) requestHeat();
  if (n === 4) buildReport(false);
  refreshPanel(); updateSteps(); setHint(); setCursor(baseCursor()); updateResultsUI(); render();
  const pn = $('.pn.on .pn-b'); if (pn) pn.scrollTop = 0;
}
function updateSteps() {
  const f = floor();
  const ok = !!(f && f.an && f.mPerPx);
  const done = { 1: !!f, 2: ok, 3: ok && f.aps.length > 0, 4: false };
  $$('#stepList button').forEach(b => {
    const s = +b.dataset.step;
    b.classList.toggle('done', !!done[s]);
    b.disabled = (s >= 3 && !ok) || (s === 2 && !f);
  });
}
function setAdjust(on) {
  S.adjust = !!on;
  $('#adjustBox').hidden = !on;
  $('#adjustBtn').setAttribute('aria-expanded', String(!!on));
  $('#adjustBtn').innerHTML = on ? icon('check') + 'Done fixing' : icon('edit') + 'Fix walls or AP positions';
  if (!on) { S.draft = null; S.tool = 'move'; }
  syncTools(); setHint(); setCursor(baseCursor()); render();
}
function setTool(t) { S.tool = t; S.draft = null; syncTools(); setHint(); setCursor(baseCursor()); render(); }
function syncTools() {
  $$('#toolGrid button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === S.tool)));
  $('#wallMatBox').hidden = S.tool !== 'wall';
}

/* ---------- panels ---------- */
function opts(obj, cur) { return Object.entries(obj).map(([k, v]) => `<option value="${k}" ${String(k) === String(cur) ? 'selected' : ''}>${esc(typeof v === 'string' ? v : v.name)}</option>`).join(''); }
function syncProjectUI() {
  $('#projName').value = S.p.name;
  $('#floorSel').innerHTML = S.p.floors.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('');
  $('#floorSel').value = S.p.curFloor;
  const st = S.p.set;
  $('#setGoal').innerHTML = opts(GOALS, st.goal);
  $('#setTarget').value = String(st.target);
  $('#setAp').innerHTML = opts(AP_TYPES, st.apType);
  $('#setMount').innerHTML = opts(MOUNTS, st.mount);
  $('#setWalls').innerHTML = opts(WALL_TYPES, st.wallType);
  $('#setSpare').value = String(st.spare);
  $('#wallMat').innerHTML = `<option value="inner">Inner wall (${esc(wallType().name)})</option><option value="outer">Outer wall</option>` +
    DEFAULT_MATERIALS.filter(m => ['glass', 'glass-tint', 'drywall', 'concrete', 'metal'].includes(m.id)).map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
  $('#repClient').value = S.p.client || ''; $('#repBy').value = S.p.by || '';
  updUndo();
}
function refreshPanel() {
  const f = floor(); if (!f) return;
  const m = f.mPerPx;
  if (S.step === 1) {
    $('#planInfo').innerHTML = `<dt>File</dt><dd>${esc(f.src.name || '–')}</dd><dt>Image</dt><dd>${f.imgW} × ${f.imgH} px</dd>` +
      `<dt>Scale</dt><dd>${m ? (m * 1000).toFixed(1) + ' mm per px' : 'Not found yet'}</dd>` +
      `<dt>Floor area</dt><dd>${f.an && m ? fmtArea(f.an.areaM2) : '–'}</dd><dt>Access points</dt><dd>${f.aps.length}</dd>`;
    if (document.activeElement !== $('#floorName')) $('#floorName').value = f.name;
    $('#delFloorBtn').hidden = S.p.floors.length < 2;
  }
  if (S.step === 3) {
    $('#apCount').textContent = f.aps.length ? '(' + f.aps.length + ')' : '';
    $('#apList').innerHTML = f.aps.map((a, i) => `<li><button type="button" data-ap="${a.id}" aria-pressed="${!!(S.sel && S.sel.id === a.id)}"><span class="dot">${i + 1}</span>` +
      `<span class="nm">${esc(a.name)}</span><span class="sub">${BAND_KEYS.filter(b => a.bands[b] && a.bands[b].on).map(b => 'ch ' + a.bands[b].ch).join(' · ')}</span></button></li>`).join('');
    const ap = S.adjust ? selectedAp() : null;
    $('#apEdit').hidden = !ap;
    if (ap && !$('#apEdit').contains(document.activeElement)) {
      $('#apName').value = ap.name;
      $('#apCh5').innerHTML = CH_ALL['5'].map(c => `<option ${+c === +ap.bands['5'].ch ? 'selected' : ''}>${c}</option>`).join('');
      $('#apCh24').innerHTML = CH_ALL['2.4'].map(c => `<option ${+c === +ap.bands['2.4'].ch ? 'selected' : ''}>${c}</option>`).join('');
    }
    renderFacts(f);
  }
  if (S.step === 4) {
    const bands = activeBands(f);
    $('#pngBtns').innerHTML = !canHeat(f) ? '<p class="mini" style="margin:0">Nothing to export yet.</p>' :
      bands.filter(b => b !== '6').map(b => `<button class="btn ghost" type="button" data-png="${b}">${icon('download')}${BAND_LABEL[b]} heat map (PNG)</button>`).join('') +
      `<button class="btn ghost" type="button" data-png="5" data-view="zones">${icon('download')}Each AP's area (PNG)</button>`;
  }
}
function renderFacts(f) {
  const sc = f.scale || {};
  $('#facts').innerHTML =
    `<li>${icon('ruler', 'sm')}<span class="tx"><b>${esc(sc.label || 'Scale set')}</b><span>${f.mPerPx ? (f.mPerPx * 1000).toFixed(1) + ' mm per pixel' : ''}${sc.detail ? ' · ' + esc(sc.detail) : ''}</span></span><button class="linkbtn" type="button" data-act="scale">Change</button></li>` +
    `<li>${icon('area', 'sm')}<span class="tx"><b>${f.an ? fmtArea(f.an.areaM2) + ' to cover' : '–'}</b><span>${f.an ? fmtSqft(f.an.areaM2) + ' · building about ' + bldSize(f) : ''}</span></span></li>` +
    `<li>${icon('wall', 'sm')}<span class="tx"><b>${esc(wallType().name)} walls</b><span>Detected from the drawing${f.walls.length ? ' + ' + f.walls.length + ' added by hand' : ''}</span></span><button class="linkbtn" type="button" data-act="walls">Show</button></li>`;
}
function bldSize(f) { const b = f.an.box, m = f.mPerPx; return ((b.x1 - b.x0) * m).toFixed(1) + ' × ' + ((b.y1 - b.y0) * m).toFixed(1) + ' m'; }

/* ---------- results UI (hero card, captions, legend, channels) ---------- */
function bandStats(r, band, thr) {
  const b = r && r.bands[band]; if (!b) return null;
  const st = WifiModel.coverageStats(b.best, r.mask, [thr, -72]);
  return { g: st.frac[0], ok: st.frac[1], area: st.cells * r.cell * r.cell };
}
const klass = f => f >= 0.95 ? 'good' : f >= 0.85 ? 'meh' : 'bad';
function legendHTML(view, thr) {
  return '<div class="legend">' + legendItems(view, thr).map(it =>
    `<div><span class="sw" style="background:${rgbCss(it.rgb)}"></span><span>${esc(it.label)}</span>${it.range ? `<span class="rg">${esc(it.range)}</span>` : ''}</div>`).join('') + '</div>';
}
function updateResultsUI() {
  if (!S.p) return;
  const f = floor(); if (!f) return;
  const thr = +S.p.set.goal, r = S.heat && S.heat.fid === f.id ? S.heat : null;
  $$('#layoutSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.layout === S.p.layout)));
  $$('#viewSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === S.p.view)));
  $('#legend').innerHTML = legendHTML(S.p.view, thr);
  // captions
  const cap = band => { if (!r || !r.bands[band] || S.step < 3) return ''; const s = bandStats(r, band, thr); return `${BAND_LABEL[band]} · <b>${fmtPct(s.g)}</b> at ${minus(thr)} dBm`; };
  const single = MAPS.find(m => m.band === '5');
  $('#cap24').innerHTML = cap('2.4');
  $('#cap5').innerHTML = S.step < 3 ? '' : cap(single.showBand || '5');
  // hero
  const s5 = r && bandStats(r, '5', thr), s24 = r && bandStats(r, '2.4', thr);
  $('#heroCard').innerHTML = `<div class="big">${f.aps.length}<small>access point${f.aps.length === 1 ? '' : 's'}</small></div>` +
    `<p>${esc(AP_TYPES[S.p.set.apType].name)} · goal ${esc(GOALS[S.p.set.goal])}</p>` +
    (s5 ? `<div class="chips2"><span class="chip ${klass(s5.g)}">5 GHz ${fmtPct(s5.g)}</span><span class="chip ${klass(s24 ? s24.g : 0)}">2.4 GHz ${s24 ? fmtPct(s24.g) : '–'}</span></div>` : '<div class="chips2"><span class="chip">Calculating…</span></div>');
  // channels
  if (S.step === 3) {
    const ws = channelWarnings(f);
    $('#chanWarn').innerHTML = ws.length ? ws.slice(0, 8).map(w => `<li>${icon('warn', 'sm')}<span>${esc(w)}</span></li>`).join('') :
      `<li class="okk">${icon('check', 'sm')}<span>Channels picked so neighbouring APs don't clash.</span></li>`;
  }
  updateSteps();
}
function channelWarnings(f) {
  if (!f.mPerPx || f.aps.length < 2) return [];
  const p = floorParams(f), out = [];
  activeBands(f).forEach(b => {
    WifiModel.channelConflicts(p.aps, p.walls, p.n, b, { wallGrid: p.wallGrid }).forEach(c => {
      out.push(`${f.aps[c.a].name} and ${f.aps[c.b].name} share ${BAND_LABEL[b]} channel ${f.aps[c.a].bands[b].ch} and hear each other (${fmtDbm(c.rssi)}).`);
    });
  });
  return out;
}

/* ---------- import ---------- */
let fileMode = 'new';
async function handleFile(file, mode) {
  if (!file) return;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const st = $('#startStatus'); st.textContent = ''; st.className = 'status';
  if (ext === 'dwg') {
    await ask('DWG files can\'t be opened here yet', '<p style="margin:0 0 10px">Browsers can\'t read AutoCAD DWG files. Converting takes a minute:</p><ol style="margin:0;padding-left:20px;line-height:1.7"><li>Open the drawing in AutoCAD or DWG TrueView.</li><li>Choose <b>File › Save As › DXF</b>, or plot the floor to <b>PDF</b>.</li><li>Upload that file here.</li></ol>', 'Got it', false);
    return;
  }
  if (ext === 'json') { await importProjectFile(file); return; }
  let src = null;
  try {
    loading(true, 'Opening your plan', 'This takes a moment for big files.');
    if (ext === 'pdf' || file.type === 'application/pdf') src = await importPdf(file);
    else if (ext === 'dxf') src = await importDxf(file);
    else if (/^(jpe?g|png|webp|gif|bmp)$/.test(ext) || /^image\//.test(file.type)) src = await importImage(file);
    else throw new Error('We can open PDF, JPG, PNG, WebP and DXF files. This one looks like .' + ext + '.');
  } catch (e) {
    loading(false); console.error(e);
    const msg = /load/i.test(e.message) ? 'Could not load the file reader. Check your internet connection and try again.' : (e.message || 'Could not open this file.');
    if (mode === 'new') { st.textContent = msg; st.className = 'status err'; }
    toast(msg, true); return;
  }
  loading(false);
  if (!src) return;
  startFloorFromSource(src, mode, file.name);
}
function startFloorFromSource(src, mode, fileName) {
  let f;
  if (mode === 'replace' && floor()) {
    f = floor();
    Object.assign(f, { imgW: src.w, imgH: src.h, src: src.src, mPerPx: null, scale: null, an: null, walls: [], aps: [] });
  } else {
    if (mode === 'new' || !S.p) {
      const base = (fileName || 'My Wi-Fi plan').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
      S.p = newProject(base ? base.charAt(0).toUpperCase() + base.slice(1) : 'My Wi-Fi plan');
      S.images = new Map(); S.savedImgs = new Set(); S.hist = { u: [], r: [] };
    }
    f = newFloor(S.p.floors.length ? 'Floor ' + (S.p.floors.length + 1) : 'Ground floor', src.w, src.h, src.src);
    S.p.floors.push(f); S.p.curFloor = f.id;
  }
  S.images.set(f.id, { blob: src.blob, img: src.img });
  S.savedImgs.delete(S.p.id + '/' + f.id);
  S.src[f.id] = src;
  S.sel = null; S.heat = null; S.heatDirty = true; S.fitted = false; wallsChanged();
  scheduleSave();
  analyseFloor(f);
}
async function importProjectFile(file) {
  try {
    loading(true, 'Opening project', '');
    const { project, images } = await projectFromFile(file);
    S.p = project; S.images = images; S.savedImgs = new Set(); S.hist = { u: [], r: [] }; S.src = {};
    S.sel = null; S.heat = null; S.heatDirty = true; S.fitted = false; wallsChanged();
    if (!S.p.floors.find(f => f.id === S.p.curFloor)) S.p.curFloor = S.p.floors[0] && S.p.floors[0].id;
    loading(false);
    if (!S.p.curFloor) throw new Error('This project has no floors.');
    await saveNow();
    go(floor().an ? 3 : 1); toast('Project opened.');
  } catch (e) { loading(false); toast(e.message || 'Could not open this project file.', true); }
}
async function openProject(id, step) {
  const rec = await DB.getProject(id);
  if (!rec) throw new Error('missing');
  if ((rec.v || 1) < 2) { toast('This project was made with an older version. Please upload the floor plan again.', true); throw new Error('old'); }
  delete rec.thumb;
  loading(true, 'Opening project', '');
  const images = new Map(), saved = new Set();
  for (const f of rec.floors) {
    try { const blob = await DB.getImage(rec.id + '/' + f.id); if (blob) { images.set(f.id, { blob, img: await blobToImage(blob) }); saved.add(rec.id + '/' + f.id); } } catch (e) { /* missing */ }
  }
  loading(false);
  S.p = rec; S.images = images; S.savedImgs = saved; S.hist = { u: [], r: [] }; S.src = {};
  if (!S.p.floors.find(f => f.id === S.p.curFloor)) S.p.curFloor = S.p.floors[0].id;
  S.sel = null; S.heat = null; S.heatDirty = true; S.fitted = false; wallsChanged();
  lsSet('kw-last', id);
  const f = floor();
  go(step && f.an ? step : f.an ? 3 : 1);
}
async function startSample() {
  loading(true, 'Drawing a sample office', '');
  const src = await makeSampleSource();
  loading(false);
  S.p = null;
  startFloorFromSource(src, 'new', 'Sample office');
}
function switchFloor(id) {
  if (!S.p.floors.find(f => f.id === id)) return;
  S.p.curFloor = id; S.sel = null; S.draft = null;
  S.heat = null; S.heatDirty = true; S.fitted = false; wallsChanged();
  $('#floorSel').value = id;
  const f = floor();
  if (!f.an) { go(2); if (S.src[f.id]) analyseFloor(f); return; }
  fitView();
  if (S.step >= 3) requestHeat();
  if (S.step === 4) buildReport(false);
  refreshPanel(); updateSteps(); updateResultsUI(); setHint(); render(); scheduleSave();
}

/* ---------- the automatic pipeline ---------- */
const CHECK = [['read', 'Reading the drawing'], ['walls', 'Finding walls'], ['area', 'Finding the floor area'], ['scale', 'Finding the scale'], ['aps', 'Placing access points'], ['cov', 'Calculating coverage']];
const chk = {};
function checkReset() { CHECK.forEach(([k]) => { chk[k] = { st: 'todo', dt: '' }; }); drawChecklist(); }
function checkSet(k, st, dt) { chk[k] = { st, dt: dt != null ? dt : chk[k].dt }; drawChecklist(); }
function drawChecklist() {
  $('#checklist').innerHTML = CHECK.map(([k, label]) => {
    const c = chk[k] || { st: 'todo', dt: '' };
    const ic = c.st === 'active' ? '<span class="spin"></span>' : c.st === 'done' ? icon('check') : c.st === 'fail' ? icon('warn') : '';
    return `<li class="${c.st}"><span class="st">${ic}</span><span class="lb">${label}</span><span class="dt">${esc(c.dt)}</span></li>`;
  }).join('');
}
async function analyseFloor(f) {
  const src = S.src[f.id];
  S.analysing = true;
  checkReset(); $('#anNote').textContent = ''; $('#toResultsBtn').disabled = true;
  go(2);
  await new Promise(r => setTimeout(r, 30));
  let cur = 'read';
  try {
    checkSet('read', 'active');
    const im = S.images.get(f.id).img, w = f.imgW, h = f.imgH;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(im, 0, 0, w, h);
    const rgba = g.getImageData(0, 0, w, h).data;
    checkSet('read', 'done', `${w.toLocaleString('en-IN')} × ${h.toLocaleString('en-IN')} px`);

    cur = 'walls'; checkSet('walls', 'active');
    const R = await runJob('analyse', { rgba, w, h }, null, [rgba.buffer]);
    let wallPx = 0; for (let i = 0; i < R.walls.length; i += 7) wallPx += R.walls[i];
    if (wallPx < 50) checkSet('walls', 'fail', 'No clear walls. Coverage assumes open space.');
    else checkSet('walls', 'done', R.est.gap ? `Double-line walls, about ${R.t} px thick` : 'Walls found');

    cur = 'area'; checkSet('area', 'active');
    let fp = R.fp;
    if (!fp || fp.area < w * h * 0.01) {
      const mx = Math.round(w * 0.06), my = Math.round(h * 0.06), mask = new Uint8Array(w * h);
      for (let y = my; y < h - my; y++) mask.fill(1, y * w + mx, y * w + w - mx);
      fp = { mask, area: (w - 2 * mx) * (h - 2 * my), box: { x0: mx, y0: my, x1: w - mx, y1: h - my } };
      checkSet('area', 'fail', 'Outline not clear, using most of the sheet');
    } else checkSet('area', 'done', 'Building outline found');
    // provisional overlay so the plan shows what we found while the scale is worked out
    const guess = 0.23 / Math.max(4, R.t);
    const prov = await runJob('masks', { walls: R.walls, cols: R.cols, fp: fp.mask, w, h, t: R.t, mPerPx: guess, cellM: 0.1 });
    f.an = { f: prov.f, t: R.t, box: fp.box, fpArea: fp.area, wall: prov.wall, area: prov.area, areaM2: prov.areaM2 };
    wallsChanged(); S.fitted = false; fitView(); render();

    cur = 'scale'; checkSet('scale', 'active');
    let sc = await findScale(f, src, R, fp, msg => checkSet('scale', 'active', msg));
    if (!sc) {
      checkSet('scale', 'active', 'One quick question…');
      sc = await askFloorSize(f, guess);
      if (!sc) throw new Error('Scale needed to continue.');
    }
    f.mPerPx = sc.mPerPx; f.scale = { method: sc.method, label: sc.label, detail: sc.detail || '' };
    checkSet('scale', 'done', sc.label);
    const mk = await runJob('masks', { walls: R.walls, cols: R.cols, fp: fp.mask, w, h, t: R.t, mPerPx: f.mPerPx, cellM: 0.1 });
    f.an = { f: mk.f, t: R.t, box: fp.box, fpArea: fp.area, wall: mk.wall, area: mk.area, areaM2: mk.areaM2 };
    wallsChanged();
    checkSet('area', chk.area.st === 'fail' ? 'fail' : 'done', `${fmtArea(mk.areaM2)} · ${fmtSqft(mk.areaM2)} · building about ${bldSize(f)}`);

    cur = 'aps'; checkSet('aps', 'active');
    await placeFloor(f, p => checkSet('aps', 'active', Math.round(p * 100) + '%'));
    checkSet('aps', 'done', `${f.aps.length} access point${f.aps.length === 1 ? '' : 's'} (${AP_TYPES[S.p.set.apType].name})`);

    cur = 'cov'; checkSet('cov', 'active');
    const r = await runJob('grid', floorParams(f));
    Object.assign(r, { fid: f.id, mPerPx: f.mPerPx, v: ++heatVer, apIds: f.aps.map(a => a.id) });
    heatApplied = r.v; S.heat = r; S.heatCache = {}; S.heatDirty = false;
    const s5 = bandStats(r, '5', +S.p.set.goal), s24 = bandStats(r, '2.4', +S.p.set.goal);
    checkSet('cov', 'done', `5 GHz ${s5 ? fmtPct(s5.g) : '–'} · 2.4 GHz ${s24 ? fmtPct(s24.g) : '–'} at ${minus(S.p.set.goal)} dBm`);
    S.analysing = false;
    $('#toResultsBtn').disabled = false;
    scheduleSave();
    setTimeout(() => { if (location.hash === '#/edit/2' && floor() === f) go(3); }, 900);
  } catch (e) {
    console.error(e);
    S.analysing = false;
    checkSet(cur, 'fail', e.message || 'Something went wrong');
    $('#anNote').innerHTML = 'Try another copy of the drawing, ideally a PDF straight from the architect. <a href="#/">Upload again</a>';
    toast(e.message === 'Scale needed to continue.' ? 'We need the floor size to continue.' : 'Could not finish reading the drawing.', true);
  }
}

/* Scale: DXF units → dimension text (PDF text layer) → scale note → OCR of dimensions on scans → one question. */
async function findScale(f, src, R, fp, say) {
  const w = f.imgW, h = f.imgH;
  if (src && src.unitMPerPx) return { mPerPx: src.unitMPerPx, method: 'dxf', label: 'Scale read from the DXF file' };
  if (src && src.words && src.words.length) {
    const s = WifiAuto.scaleFromDimLines(src.words, R.dark, w, h);
    if (s) return { mPerPx: s.mPerPx, method: 'dims', label: `Scale found from ${s.n} dimensions on the drawing`, detail: dimsDetail(s) };
  }
  if (src && src.note && src.ptPerPx) {
    return { mPerPx: 0.0254 / 72 * src.note.ratio * src.ptPerPx, method: 'note', label: `Scale ${src.note.str} read from the drawing` };
  }
  if (!fp || (src && src.src && src.src.kind === 'sample')) return null;
  try {
    say('Reading the dimension numbers…');
    const words = await ocrDimensions(R, w, h, fp.box, say);
    const s = WifiAuto.scaleFromDimLines(words, R.dark, w, h);
    if (s) return { mPerPx: s.mPerPx, method: 'ocr', label: `Scale found from ${s.n} dimensions on the drawing`, detail: dimsDetail(s) };
    const o = WifiAuto.scaleFromOverall(words, fp.box);
    if (o) return { mPerPx: o.mPerPx, method: 'overall', label: 'Scale from the overall dimensions', detail: (o.h ? 'width ' + Math.round(o.h * 1000).toLocaleString('en-IN') + ' mm' : '') + (o.v ? (o.h ? ', ' : '') + 'depth ' + Math.round(o.v * 1000).toLocaleString('en-IN') + ' mm' : '') };
  } catch (e) { console.warn('OCR failed', e); }
  return null;
}
function dimsDetail(s) {
  const big = s.used.slice().sort((a, b) => +b.text - +a.text)[0];
  return big ? 'e.g. ' + (+big.text).toLocaleString('en-IN') + ' mm' : '';
}
const TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/';
let tessWorker = null;
async function ocrDimensions(R, w, h, box, say) {
  if (!window.Tesseract) { say('Loading the text reader…'); await loadScript(TESS + 'tesseract.min.js'); }
  if (!tessWorker) {
    say('Starting the text reader (first time downloads about 5 MB)…');
    tessWorker = await window.Tesseract.createWorker('eng', 1, {
      workerPath: TESS + 'worker.min.js',
      corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
      langPath: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int'
    });
    await tessWorker.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: '11', user_defined_dpi: '300' });
  }
  // the grey image is needed for OCR; rebuild it from the plan image
  const im = S.images.get(floor().id).img, c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(im, 0, 0, w, h);
  const gray = WifiAuto.grayOf(g.getImageData(0, 0, w, h).data, w, h);
  const plan = WifiAuto.ocrPlan(w, h, box), words = [];
  for (let k = 0; k < plan.length; k++) {
    const r = plan[k];
    say(`Reading dimensions (${k + 1} of ${plan.length})…`);
    const img = WifiAuto.ocrImage(gray, R.dark, w, h, r, 3);
    const oc = document.createElement('canvas'); oc.width = img.w; oc.height = img.h;
    const og = oc.getContext('2d'), id = og.createImageData(img.w, img.h);
    for (let i = 0; i < img.data.length; i++) { const o = i * 4; id.data[o] = id.data[o + 1] = id.data[o + 2] = img.data[i]; id.data[o + 3] = 255; }
    og.putImageData(id, 0, 0);
    const res = await tessWorker.recognize(oc);
    (res.data.words || []).forEach(x => words.push(WifiAuto.ocrMapWord({ text: x.text, conf: x.confidence, x0: x.bbox.x0, y0: x.bbox.y0, x1: x.bbox.x1, y1: x.bbox.y1 }, r, 3)));
    // stop early once both directions agree
    const s = WifiAuto.scaleFromDimLines(words, R.dark, w, h);
    if (s && s.n >= 8 && s.used.some(u => u.vertical) && s.used.some(u => !u.vertical)) break;
  }
  return words;
}

/* The one question when the scale can't be found, and the "Change" dialog. */
function scaleDialog(title, intro, units, val, unit) {
  const d = $('#scaleDlg');
  $('#scaleDlgT').textContent = title; $('#scaleDlgP').textContent = intro;
  $('#scaleUnit').innerHTML = units.map(([k, l]) => `<option value="${k}" ${k === unit ? 'selected' : ''}>${l}</option>`).join('');
  $('#scaleVal').value = val;
  return new Promise(res => {
    d.addEventListener('close', function hnd() { d.removeEventListener('close', hnd); res(d.returnValue === 'ok' ? { v: parseFloat($('#scaleVal').value), unit: $('#scaleUnit').value } : null); });
    d.returnValue = ''; d.showModal(); $('#scaleVal').select();
  });
}
const SIZE_UNITS = [['sqft', 'Floor area in sq ft'], ['m2', 'Floor area in m²'], ['wm', 'Building width in m'], ['wft', 'Building width in ft']];
function mPerPxFrom(f, v, unit, px) {
  if (!(v > 0)) return null;
  const b = f.an.box, bw = b.x1 - b.x0 + 1;
  if (unit === 'sqft') return Math.sqrt(v / 10.7639 / f.an.fpArea);
  if (unit === 'm2') return Math.sqrt(v / f.an.fpArea);
  if (unit === 'wm') return v / bw;
  if (unit === 'wft') return v * 0.3048 / bw;
  if (unit === 'lm') return v / px;
  if (unit === 'lft') return v * 0.3048 / px;
  return null;
}
async function askFloorSize(f, guess) {
  const sqft = Math.max(100, Math.round(f.an.fpArea * guess * guess * 10.7639 / 50) * 50);
  const r = await scaleDialog('About how big is this floor?', 'We couldn\'t read the scale from this drawing. A rough size is enough; you can change it later.', SIZE_UNITS, sqft, 'sqft');
  if (!r) return null;
  const m = mPerPxFrom(f, r.v, r.unit);
  return m ? { mPerPx: m, method: 'asked', label: 'Scale from the floor size you gave', detail: r.v.toLocaleString('en-IN') + ' ' + ({ sqft: 'sq ft', m2: 'm²', wm: 'm wide', wft: 'ft wide' }[r.unit]) } : null;
}
async function openScaleDialog(o) {
  const f = floor(); if (!f || !f.an) return;
  let r, m;
  if (o && o.px) {
    r = await scaleDialog('How long is that line?', 'Type the real length of the line you drew.', [['lm', 'Metres'], ['lft', 'Feet']], f.mPerPx ? +(o.px * f.mPerPx).toFixed(2) : '', 'lm');
    if (!r) return;
    m = mPerPxFrom(f, r.v, r.unit, o.px);
  } else {
    const bw = f.an.box.x1 - f.an.box.x0 + 1;
    r = await scaleDialog('Change the scale', 'Give one real size and we\'ll rescale. The building outline we found is used for widths and areas.', SIZE_UNITS, +(bw * f.mPerPx).toFixed(2), 'wm');
    if (!r) return;
    m = mPerPxFrom(f, r.v, r.unit);
  }
  if (!m) { toast('That size doesn\'t look right.', true); return; }
  mark();
  const k = (m / f.mPerPx);
  f.mPerPx = m; f.an.areaM2 *= k * k;
  f.scale = { method: 'manual', label: 'Scale set by you', detail: r.v.toLocaleString('en-IN') + ' ' + ({ sqft: 'sq ft', m2: 'm²', wm: 'm wide', wft: 'ft wide', lm: 'm line', lft: 'ft line' }[r.unit]) };
  await replan();
  toast(`Scale updated. Building about ${bldSize(f)}.`);
}

/* ---------- AP placement ---------- */
async function placeFloor(f, progress) {
  const st = S.p.set, t = AP_TYPES[st.apType] || AP_TYPES.wifi6;
  const p = floorParams(f, { band: '5', threshold: +st.goal, target: +st.target, maxNew: 80, preset: { bands: t.bands }, minSpacing: 4,
    evalCell: Math.max(0.4, Math.sqrt(f.an.areaM2 / 5000)), maxCands: 240 });
  p.aps = [];
  const r = await runJob('place', p, progress);
  f.aps = r.added.map((c, i) => makeAp(c.x / f.mPerPx, c.y / f.mPerPx, st.apType, i + 1));
  assignAllChannels(f);
  f.placed = { frac: r.frac };
}
let replanT = 0;
function replanSoon() { clearTimeout(replanT); replanT = setTimeout(replan, 250); }
async function replan() {
  const f = floor(); if (!f || !f.an || !f.mPerPx) return;
  setBusy(true, 'Placing access points');
  try { await placeFloor(f); } catch (e) { console.error(e); toast('Could not place access points.', true); }
  S.sel = null;
  changed();
}

/* ---------- export images ---------- */
const VIEW_NAME = { rssi: 'Signal strength', zones: 'Area served by each AP', overlap: 'AP overlap', plan: 'Floor plan and access points' };
async function resultFor(f) {
  if (S.heat && S.heat.fid === f.id && !S.heat.draft && !S.heatDirty) return S.heat;
  if (!canHeat(f)) return null;
  const r = await runJob('grid', floorParams(f));
  return Object.assign(r, { fid: f.id, mPerPx: f.mPerPx, apIds: f.aps.map(a => a.id), v: -1 });
}
function renderExport(f, r, band, view, maxW) {
  const img = S.images.get(f.id).img, thr = +S.p.set.goal;
  const b = f.an.box, mg = Math.round(Math.max(b.x1 - b.x0, b.y1 - b.y0) * 0.05);
  const cx0 = Math.max(0, b.x0 - mg), cy0 = Math.max(0, b.y0 - mg), cx1 = Math.min(f.imgW, b.x1 + mg), cy1 = Math.min(f.imgH, b.y1 + mg);
  const cw = cx1 - cx0, ch = cy1 - cy0, k = (maxW || 1400) / cw, PW = Math.round(cw * k), PH = Math.round(ch * k);
  const M = 28, head = 70, foot = 92, u = PW / 1000;
  const c = document.createElement('canvas'); c.width = PW + 2 * M; c.height = head + PH + foot;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#15181E'; g.font = `800 ${Math.round(22 * u + 6)}px Archivo, Segoe UI, Arial, sans-serif`; g.textBaseline = 'alphabetic';
  g.fillText(view === 'plan' ? VIEW_NAME.plan : `${VIEW_NAME[view]}, ${BAND_LABEL[band]}`, M, 34);
  g.fillStyle = '#596070'; g.font = `500 ${Math.round(11 * u + 6)}px Archivo, Segoe UI, Arial, sans-serif`;
  const st = bandStats(r, band, thr);
  g.fillText(`${S.p.name} · ${f.name} · ${f.aps.length} APs${st ? ' · ' + fmtPct(st.g) + ' of the floor at ' + minus(thr) + ' dBm or better' : ''}`, M, 56);
  g.drawImage(img, cx0, cy0, cw, ch, M, head, PW, PH);
  const hc = view === 'plan' ? null : paintHeat(r, band, view, thr);
  if (hc) {
    const kk = r.cell / r.mPerPx * k;
    g.save(); g.beginPath(); g.rect(M, head, PW, PH); g.clip();
    g.globalAlpha = 0.62; g.imageSmoothingEnabled = view !== 'zones';
    g.drawImage(hc, M - cx0 * k, head - cy0 * k, r.gw * kk, r.gh * kk); g.restore();
  }
  g.strokeStyle = '#D8DBE2'; g.lineWidth = 1; g.strokeRect(M + 0.5, head + 0.5, PW - 1, PH - 1);
  f.aps.forEach((a, i) => {
    const x = M + (a.x - cx0) * k, y = head + (a.y - cy0) * k, R = 11 * Math.max(1, u);
    g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2); g.fillStyle = view === 'zones' ? rgbCss(ZONES[i % ZONES.length]) : '#0B7A9E'; g.fill();
    g.lineWidth = 2.5; g.strokeStyle = '#fff'; g.stroke();
    g.fillStyle = '#fff'; g.font = `800 ${Math.round(R)}px Archivo, Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(i + 1), x, y + 0.5);
    g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  });
  // legend and scale bar
  let lx = M, ly = head + PH + 28;
  g.font = `600 ${Math.round(9 * u + 6)}px Archivo, Segoe UI, Arial, sans-serif`;
  (view === 'plan' ? [] : legendItems(view, thr)).forEach(it => {
    const label = it.label + (it.range ? ' (' + it.range + ')' : ''), lw = 26 + g.measureText(label).width + 18;
    if (lx + lw > c.width - M - 120) { lx = M; ly += 22; }
    g.fillStyle = rgbCss(it.rgb); g.fillRect(lx, ly - 11, 18, 12);
    g.fillStyle = '#15181E'; g.fillText(label, lx + 24, ly);
    lx += lw;
  });
  let L = 1; for (const n of [1, 2, 5, 10, 20, 50]) if (n / f.mPerPx * k <= PW / 5) L = n;
  const bw = L / f.mPerPx * k, bx = c.width - M - bw, by = head + PH + 30;
  g.strokeStyle = '#15181E'; g.lineWidth = 2; g.beginPath(); g.moveTo(bx, by - 6); g.lineTo(bx, by); g.lineTo(bx + bw, by); g.lineTo(bx + bw, by - 6); g.stroke();
  g.fillStyle = '#15181E'; g.textAlign = 'center'; g.fillText(L + ' m', bx + bw / 2, by - 10); g.textAlign = 'left';
  g.fillStyle = '#8A919E'; g.font = `500 ${Math.round(8 * u + 6)}px Archivo, Segoe UI, Arial, sans-serif`;
  g.fillText('Predicted coverage, not a site survey · Made with Daftarbox', M, c.height - 16);
  return c;
}
async function exportPng(band, view) {
  const f = floor();
  try {
    loading(true, 'Making the image', '');
    const r = await resultFor(f);
    if (!r || !r.bands[band]) throw new Error('Nothing to export for this band yet.');
    const blob = await canvasToBlob(renderExport(f, r, band, view || 'rssi', 1800), 'image/png');
    loading(false);
    downloadBlob(blob, `${slug(S.p.name)}-${slug(f.name)}-${view === 'zones' ? 'ap-areas' : band + 'ghz'}.png`);
    toast('Image downloaded.');
  } catch (e) { loading(false); toast(e.message || 'Could not make the image.', true); }
}

/* ---------- bill of materials ---------- */
function bom() {
  const types = {}; let n = 0, watts = 0;
  S.p.floors.forEach(f => f.aps.forEach(a => { const t = AP_TYPES[a.type] || AP_TYPES.wifi6; types[a.type || 'wifi6'] = (types[a.type || 'wifi6'] || 0) + 1; n++; watts += t.watts; }));
  const ports = WifiAuto.portsNeeded(n, +S.p.set.spare);
  const sw = WifiAuto.poeSwitches(ports.total, watts);
  return { n, types, watts, ports, sw };
}
function swName(s) { return `${s.ports}-port PoE+ switch`; }

/* ---------- report (on screen and print) ---------- */
let reportSeq = 0;
async function buildReport(forPrint) {
  const seq = ++reportSeq, body = forPrint ? null : $('#docBody');
  if (body) body.innerHTML = '<p class="meta"><span class="spin" style="display:inline-block;vertical-align:-2px;margin-right:8px"></span>Preparing the report…</p>';
  const p = S.p, date = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }), thr = +p.set.goal;
  const B = bom();
  let html = `<h1>${esc(p.name)}</h1><p class="meta">Wi-Fi plan · ${date}${p.client ? ' · For ' + esc(p.client) : ''}${p.by ? ' · By ' + esc(p.by) : ''}</p>`;
  const totalArea = p.floors.reduce((s, f) => s + (f.an ? f.an.areaM2 : 0), 0);
  html += `<div class="kp"><div><b>${B.n}</b><span>access points</span></div><div><b>${B.ports.total}</b><span>PoE ports incl. spare</span></div>` +
    `<div><b>${B.sw ? B.sw.n : '–'}</b><span>PoE+ switch${B.sw && B.sw.n === 1 ? '' : 'es'}</span></div><div><b>${fmtArea(totalArea)}</b><span>floor area (${fmtSqft(totalArea)})</span></div></div>`;
  html += `<p class="note math">Goal: ${esc(GOALS[p.set.goal])} on 5 GHz across ${Math.round(p.set.target * 100)}% of the floor. ${esc(AP_TYPES[p.set.apType].name)}, ${esc(MOUNTS[p.set.mount]).toLowerCase()}. ${esc(wallType().name)} walls. Predicted coverage, not a site survey.</p>`;

  // bill of materials
  html += '<h2>Bill of materials</h2><table><thead><tr><th>Item</th><th class="n">Qty</th><th>How we got it</th></tr></thead><tbody>';
  Object.entries(B.types).forEach(([k, q]) => { html += `<tr><td>Access point, ${esc(AP_TYPES[k].name)}</td><td class="n">${q}</td><td class="math">Placed to reach ${minus(thr)} dBm on 5 GHz across ${Math.round(p.set.target * 100)}% of each floor</td></tr>`; });
  html += `<tr><td>PoE switch ports needed</td><td class="n">${B.ports.total}</td><td class="math">${B.n} APs + ${p.set.spare}% spare (${B.ports.spare}, rounded up) = ${B.ports.total}</td></tr>`;
  if (B.sw) B.sw.mix.forEach(s => { html += `<tr><td>${swName(s)}</td><td class="n">${s.count}</td><td class="math">Typical PoE budget ${s.budget} W each</td></tr>`; });
  html += `<tr><td>PoE power check</td><td class="n">${B.watts} W</td><td class="math">${Object.entries(B.types).map(([k, q]) => `${q} × ${AP_TYPES[k].watts} W`).join(' + ')} = ${B.watts} W, against ${B.sw ? B.sw.budget : 0} W available${B.sw && B.sw.budget >= B.watts ? ' (OK)' : ''}</td></tr>`;
  html += `<tr><td>Cat6 cable runs</td><td class="n">${B.n}</td><td class="math">One run per access point. Keep each run under 90 m.</td></tr></tbody></table>`;
  html += `<p class="note math">Switch power budgets and AP power draw are typical values (8-port 120 W, 16-port 250 W, 24-port 370 W, 48-port 740 W; Wi-Fi 6 AP about 20 W, Wi-Fi 7 AP about 30 W). Check the models you buy.</p>`;

  // per floor
  let fi = 0;
  for (const f of p.floors) {
    if (seq !== reportSeq) return;
    const r = f.an && f.mPerPx ? await resultFor(f) : null;
    html += `<h2 class="${forPrint && fi++ ? 'pb' : ''}">${esc(f.name)}</h2>`;
    if (!r) { html += '<p class="math">Not analysed yet.</p>'; continue; }
    const s5 = bandStats(r, '5', thr), s24 = bandStats(r, '2.4', thr);
    html += `<p class="math">${f.aps.length} access points · ${fmtArea(f.an.areaM2)} to cover · building about ${bldSize(f)} · 5 GHz ${s5 ? fmtPct(s5.g) : '–'} and 2.4 GHz ${s24 ? fmtPct(s24.g) : '–'} at ${minus(thr)} dBm · ${esc((f.scale && f.scale.label) || '')}</p>`;
    const imgW = forPrint ? 1100 : 900;
    const pic = (band, view, cap) => `<figure><img alt="${esc(cap)}" src="${renderExport(f, r, band, view, imgW).toDataURL('image/jpeg', 0.86)}"><figcaption>${esc(cap)}</figcaption></figure>`;
    html += '<div class="figs">' + (r.bands['2.4'] ? pic('2.4', 'rssi', '2.4 GHz signal') : '') + (r.bands['5'] ? pic('5', 'rssi', '5 GHz signal') : '') + '</div>';
    html += '<div class="figs" style="margin-top:12px">' + pic('5', 'plan', 'Floor plan with numbered access points') + pic('5', 'zones', 'Area served by each access point (5 GHz)') + '</div>';
    const ox = f.an.box.x0, oy = f.an.box.y0, m = f.mPerPx;
    html += '<h3>Access points</h3><table><thead><tr><th>#</th><th>Name</th><th class="n">Position (m)</th><th>5 GHz</th><th>2.4 GHz</th>' + (activeBands(f).includes('6') ? '<th>6 GHz</th>' : '') + '</tr></thead><tbody>' +
      f.aps.map((a, i) => `<tr><td>${i + 1}</td><td>${esc(a.name)}</td><td class="n">${((a.x - ox) * m).toFixed(1)}, ${((a.y - oy) * m).toFixed(1)}</td>` +
        ['5', '2.4'].concat(activeBands(f).includes('6') ? ['6'] : []).map(b => { const v = a.bands[b]; return `<td>${v && v.on ? `ch ${v.ch} · ${v.tx} dBm` : 'Off'}</td>`; }).join('') + '</tr>').join('') + '</tbody></table>';
    html += '<p class="math">Positions are measured from the top-left corner of the building outline.</p>';
    const ws = channelWarnings(f);
    if (ws.length) html += '<h3>Channel notes</h3><ul>' + ws.map(w => `<li>${esc(w)}</li>`).join('') + '</ul>';
  }
  html += `<h2 class="${forPrint ? 'pb' : ''}">How this was worked out</h2><ul>
    <li>Walls, columns and the floor area were found automatically in the drawing. ${esc(wallType().name)} walls: ${wallType().inner['5']} dB at 5 GHz inside, ${wallType().outer['5']} dB for outer walls, ${COLUMN_LOSS['5']} dB for columns.</li>
    <li>Signal = transmit power + antenna gain − loss over the first metre − 10 × ${PATH_N.toFixed(1)} × log10(distance) − wall losses. APs are ${esc(MOUNTS[p.set.mount]).toLowerCase()}; devices at desk height.</li>
    <li>Access points were placed where they cover the most floor, spread out and away from walls, until ${Math.round(p.set.target * 100)}% of the floor reached ${minus(thr)} dBm on 5 GHz.</li>
    <li>Channels use 1, 6 and 11 on 2.4 GHz and non-overlapping 20 MHz channels on 5 GHz, so APs that hear each other differ.</li>
    <li>Floors are worked out one at a time. Signal between floors is not included.</li>
    <li>This is a prediction. Confirm with a walk-through survey after installation.</li></ul>
    <p class="math">Made with Daftarbox Wi-Fi heat mapping.</p>`;
  if (seq !== reportSeq) return;
  if (body) body.innerHTML = html;
  return html;
}
async function printReport() {
  try {
    loading(true, 'Preparing your report', 'Drawing the maps…');
    const html = await buildReport(true);
    const rep = $('#report');
    rep.innerHTML = '<div class="rep">' + html + '</div>';
    await Promise.all($$('img', rep).map(i => i.decode ? i.decode().catch(() => { }) : Promise.resolve()));
    loading(false);
    document.body.classList.add('printing');
    const done = () => { document.body.classList.remove('printing'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => { window.print(); setTimeout(done, 1000); }, 60);
  } catch (e) { loading(false); console.error(e); toast('Could not prepare the report.', true); }
}

/* ---------- IT project budget hand-off ---------- */
function addToBudget() {
  const B = bom();
  if (!B.n) { toast('No access points to add yet.', true); return; }
  let projects = {};
  try { projects = JSON.parse(localStorage.getItem('itbudget.projects.v1') || '{}') || {}; } catch (e) { projects = {}; }
  const ap = Object.entries(B.types).map(([k, q]) => Object.assign({ qty: q, price: null }, AP_TYPES[k].budget));
  // the budget catalogue has 8- and 24-port TP-Link PoE+ switches: 16 ports -> one 24-port, 48 ports -> two 24-port
  let p8 = 0, p24 = 0;
  (B.sw ? B.sw.mix : []).forEach(s => { if (s.ports === 8) p8 += s.count; else if (s.ports === 48) p24 += 2 * s.count; else p24 += s.count; });
  const sw = [];
  if (p8) sw.push({ qty: p8, b: 'TP-Link', t: 'PoE managed', m: 'TL-SG2210MP, 8-port PoE+', price: null });
  if (p24) sw.push({ qty: p24, b: 'TP-Link', t: 'PoE managed', m: 'TL-SG3428MP, 24-port PoE+', price: null });
  const id = 'p' + Date.now().toString(36);
  projects[id] = { id, name: S.p.name + ' (Wi-Fi)', rows: { ws: [], ap, sw, cam: [], nvr: [], ups: [] }, set: { ppw: '1', run: 30, cont: 5, gst: true }, over: {}, updated: Date.now() };
  if (!lsSet('itbudget.projects.v1', JSON.stringify(projects))) { toast('This browser blocks saving, so we couldn\'t pass the list on.', true); return; }
  toast('Added to the IT budget as a new project.');
  window.open('../budget/index.html', '_blank');
}

/* ---------- project lists ---------- */
async function listProjects() { try { return (await DB.listProjects()).filter(p => (p.v || 1) >= 2).sort((a, b) => b.updated - a.updated); } catch (e) { return null; } }
function projItem(p) {
  const aps = p.floors.reduce((s, f) => s + f.aps.length, 0);
  const when = new Date(p.updated).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  return `<li class="pitem">${p.thumb ? `<img src="${p.thumb}" alt="">` : '<span class="ph"></span>'}<div class="meta"><b>${esc(p.name)}</b><span>${p.floors.length} floor${p.floors.length === 1 ? '' : 's'} · ${aps} AP${aps === 1 ? '' : 's'} · ${when}</span></div>` +
    `<div class="acts"><button class="btn small" type="button" data-open="${p.id}">Open</button><button class="icon-btn" type="button" data-del="${p.id}" aria-label="Delete ${esc(p.name)}" title="Delete">${icon('trash')}</button></div></li>`;
}
async function renderProjects() {
  const list = await listProjects();
  $('#projList').innerHTML = list ? list.map(projItem).join('') : '';
  $('#projEmpty').hidden = !!(list && list.length);
  if (!list) $('#projEmpty').querySelector('p').textContent = 'Saving is blocked in this browser (private mode?). Download project files from the report step instead.';
}
async function renderRecent() {
  const list = await listProjects();
  $('#recent').hidden = !(list && list.length);
  if (list) $('#recentList').innerHTML = list.slice(0, 3).map(projItem).join('');
}

/* ---------- wiring ---------- */
document.addEventListener('click', async e => {
  const o = e.target.closest('[data-open]'), d = e.target.closest('[data-del]'), g = e.target.closest('[data-go]'), a = e.target.closest('[data-act]');
  if (o) openProject(o.dataset.open).catch(() => { });
  if (d) {
    if (await ask('Delete this project?', '<p style="margin:0">It will be removed from this browser. This can\'t be undone.</p>', 'Delete')) {
      try { await DB.deleteProject(d.dataset.del); } catch (er) { /* ignore */ }
      if (S.p && S.p.id === d.dataset.del) S.p = null;
      renderProjects(); renderRecent(); toast('Project deleted.');
    }
  }
  if (g && !g.disabled) go(+g.dataset.go);
  if (a && a.dataset.act === 'scale') openScaleDialog();
  if (a && a.dataset.act === 'walls') { S.showWalls = !S.showWalls; $('#showWallsBtn').setAttribute('aria-pressed', String(S.showWalls)); a.textContent = S.showWalls ? 'Hide' : 'Show'; render(); }
});
function wire() {
  const fin = $('#fileIn');
  $('#pickBtn').addEventListener('click', () => fin.click());
  fin.addEventListener('change', () => { const f = fin.files[0]; fin.value = ''; handleFile(f, 'new'); });
  $('#sampleBtn').addEventListener('click', startSample);
  $('#openJsonBtn').addEventListener('click', () => $('#jsonIn').click());
  $('#jsonIn').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) importProjectFile(f); });
  const fin2 = $('#fileIn2');
  fin2.addEventListener('change', () => { const f = fin2.files[0]; fin2.value = ''; handleFile(f, fileMode); });
  $('#addFloorBtn').addEventListener('click', () => { fileMode = 'addFloor'; fin2.click(); });
  $('#replacePlanBtn').addEventListener('click', () => { fileMode = 'replace'; fin2.click(); });
  $('#reanalyseBtn').addEventListener('click', async () => {
    const f = floor();
    if (!S.src[f.id]) S.src[f.id] = { src: f.src, words: null, note: null, ptPerPx: null, unitMPerPx: null };
    analyseFloor(f);
  });

  // drag and drop anywhere
  let depth = 0;
  const drop = $('#drop');
  const hasFiles = e => e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf('Files') >= 0;
  document.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); depth++; drop.classList.add('drag'); });
  document.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  document.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) drop.classList.remove('drag'); });
  document.addEventListener('drop', async e => {
    if (!hasFiles(e)) return;
    e.preventDefault(); depth = 0; drop.classList.remove('drag');
    const f = e.dataTransfer.files[0]; if (!f) return;
    if (!$('#v-editor').hidden && S.p && !/\.json$/i.test(f.name)) {
      if (await ask('Add as a new floor?', `<p style="margin:0">Add <b>${esc(f.name)}</b> as another floor of this project?</p>`, 'Add floor')) handleFile(f, 'addFloor');
    } else handleFile(f, 'new');
  });

  $('#projName').addEventListener('input', e => { S.p.name = e.target.value || 'My Wi-Fi plan'; document.title = S.p.name + ' – Wi-Fi plan – Daftarbox'; scheduleSave(); });
  $('#floorSel').addEventListener('change', e => switchFloor(e.target.value));
  $$('#stepList button').forEach(b => b.addEventListener('click', () => { if (!b.disabled) go(+b.dataset.step); }));
  $('#floorName').addEventListener('input', e => { floor().name = e.target.value || 'Floor'; $('#floorSel').selectedOptions[0].textContent = floor().name; scheduleSave(); });
  $('#delFloorBtn').addEventListener('click', async () => {
    if (S.p.floors.length < 2) return;
    const f = floor();
    if (!(await ask('Delete this floor?', `<p style="margin:0"><b>${esc(f.name)}</b> and its access points will be removed.</p>`, 'Delete floor'))) return;
    S.p.floors = S.p.floors.filter(x => x.id !== f.id);
    S.images.delete(f.id); S.hist = { u: [], r: [] }; updUndo();
    try { await DB.delImage(S.p.id + '/' + f.id); } catch (e) { /* ignore */ }
    syncProjectUI(); switchFloor(S.p.floors[0].id); toast('Floor deleted.');
  });
  $('#toResultsBtn').addEventListener('click', () => go(3));

  // results
  $('#layoutSeg').addEventListener('click', e => { const b = e.target.closest('[data-layout]'); if (!b) return; S.p.layout = b.dataset.layout; S.fitted = false; setLayout(); updateResultsUI(); scheduleSave(); });
  $('#viewSeg').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (!b) return; S.p.view = b.dataset.view; updateResultsUI(); render(); scheduleSave(); });
  const setting = (id, key, num) => $(id).addEventListener('change', e => { S.p.set[key] = num ? +e.target.value : e.target.value; syncProjectUI(); S.heatCache = {}; replanSoon(); });
  setting('#setGoal', 'goal', true); setting('#setTarget', 'target', true); setting('#setAp', 'apType'); setting('#setMount', 'mount'); setting('#setWalls', 'wallType');
  $('#apList').addEventListener('click', e => {
    const b = e.target.closest('[data-ap]'); if (!b) return;
    S.sel = { kind: 'ap', id: b.dataset.ap };
    const ap = selectedAp(), q = toS(ap), m = visibleMaps()[0];
    if (m && (q.x < 0 || q.y < 0 || q.x > m.w || q.y > m.h)) { S.view.ox += m.w / 2 - q.x; S.view.oy += m.h / 2 - q.y; }
    refreshPanel(); render();
  });
  $('#adjustBtn').addEventListener('click', () => setAdjust(!S.adjust));
  $('#toolGrid').addEventListener('click', e => { const b = e.target.closest('[data-tool]'); if (b) setTool(b.dataset.tool); });
  $('#wallMat').addEventListener('change', e => { S.wallMat = e.target.value; });
  $('#replaceBtn').addEventListener('click', async () => { if (await ask('Place access points again?', '<p style="margin:0">Your moved and added access points will be replaced by a fresh automatic layout.</p>', 'Place again')) { mark(); replan(); } });
  $('#showWallsBtn').addEventListener('click', e => { S.showWalls = !S.showWalls; e.currentTarget.setAttribute('aria-pressed', String(S.showWalls)); render(); });
  $('#delApBtn').addEventListener('click', deleteSel);
  $('#apName').addEventListener('change', e => { const ap = selectedAp(); if (!ap) return; mark(); ap.name = e.target.value.trim() || ap.name; changed(); });
  $('#apCh5').addEventListener('change', e => { const ap = selectedAp(); if (!ap) return; mark(); ap.bands['5'].ch = +e.target.value; changed(); });
  $('#apCh24').addEventListener('change', e => { const ap = selectedAp(); if (!ap) return; mark(); ap.bands['2.4'].ch = +e.target.value; changed(); });

  // report
  $('#setSpare').addEventListener('change', e => { S.p.set.spare = +e.target.value; scheduleSave(); buildReport(false); });
  $('#repClient').addEventListener('change', e => { S.p.client = e.target.value; scheduleSave(); buildReport(false); });
  $('#repBy').addEventListener('change', e => { S.p.by = e.target.value; scheduleSave(); buildReport(false); });
  $('#pngBtns').addEventListener('click', e => { const b = e.target.closest('[data-png]'); if (b) exportPng(b.dataset.png, b.dataset.view || 'rssi'); });
  $('#exportJsonBtn').addEventListener('click', async () => {
    try { downloadBlob(await projectToFile(S.p, S.images), slug(S.p.name) + '.wifi.json'); toast('Project file downloaded.'); }
    catch (e) { toast('Could not make the project file.', true); }
  });
  $('#budgetBtn').addEventListener('click', addToBudget);
  $('#printBtn').addEventListener('click', printReport);

  $('#helpMats tbody').innerHTML = Object.values(WALL_TYPES).map(t => `<tr><td>${esc(t.name)}</td><td class="num">${t.inner['2.4']} / ${t.inner['5']} dB</td><td class="num">${t.outer['2.4']} / ${t.outer['5']} dB</td></tr>`).join('') +
    `<tr><td>Columns (RCC)</td><td class="num">${COLUMN_LOSS['2.4']} / ${COLUMN_LOSS['5']} dB</td><td class="num">–</td></tr>`;
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readColors(); render(); }); } catch (e) { /* old browsers */ }
  window.addEventListener('hashchange', route);
  window.addEventListener('beforeunload', () => { if (S.p) { clearTimeout(saveT); saveNow(); } });
}

readColors();
wire();
route();
