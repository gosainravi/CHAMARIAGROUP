/* Daftarbox Wi-Fi heat mapping: map rendering (one or two synced maps), worker jobs, heat colours,
   and the optional Adjust tools (move/add APs, add/erase walls, measure). */
'use strict';

const S = {
  p: null, images: new Map(), savedImgs: new Set(), src: {},
  step: 1, adjust: false, tool: 'move', wallMat: 'inner', sel: null, hover: null, draft: null, cursor: null,
  view: { s: 1, ox: 0, oy: 0 }, fitted: false,
  heat: null, heatDirty: true, heatCache: {}, ovCanvas: null, ovKey: '',
  hist: { u: [], r: [] }, spaceHeld: false, showWalls: false, analysing: false
};
const floor = () => S.p && S.p.floors.find(f => f.id === S.p.curFloor);
const wallType = () => WALL_TYPES[S.p.set.wallType] || WALL_TYPES.brick;
function matLoss(id) {
  if (id === 'inner') return wallType().inner;
  if (id === 'outer') return wallType().outer;
  const m = DEFAULT_MATERIALS.find(x => x.id === id);
  return m ? m.loss : wallType().inner;
}
function matColor(id) { if (id === 'inner') return '#D2683C'; if (id === 'outer') return '#8A3A22'; const m = DEFAULT_MATERIALS.find(x => x.id === id); return m ? m.color : '#D2683C'; }
function mountDz() { const m = S.p.set.mount; return m === 'wall' ? 1.2 : Math.max(0, parseFloat(m) - 1); }

/* ---------- colours (heat colours are content: fixed in both themes) ---------- */
const RAMP = [[-35, [11, 110, 58]], [-50, [31, 163, 74]], [-60, [140, 203, 63]], [-67, [228, 226, 58]], [-72, [246, 176, 51]], [-80, [238, 106, 43]], [-88, [215, 48, 31]]];
const WEAK_RGB = [123, 63, 228];
const ZONES = [[31, 119, 180], [255, 127, 14], [44, 160, 44], [214, 39, 40], [148, 103, 189], [140, 86, 75], [227, 119, 194], [23, 190, 207], [188, 189, 34], [57, 59, 121], [255, 187, 120], [82, 84, 163]];
function rampRGB(v) {
  if (v >= RAMP[0][0]) return RAMP[0][1];
  for (let i = 1; i < RAMP.length; i++) {
    if (v >= RAMP[i][0]) {
      const [v0, c0] = RAMP[i - 1], [v1, c1] = RAMP[i], t = (v0 - v) / (v0 - v1);
      return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t];
    }
  }
  return RAMP[RAMP.length - 1][1];
}
const rgbCss = c => `rgb(${c.map(Math.round).join(',')})`;
const OVERLAP = [[0, WEAK_RGB, 'No AP strong enough'], [1, [228, 226, 58], '1 AP (no backup)'], [2, [31, 163, 74], '2 APs (good for roaming)'], [3, [43, 140, 214], '3 or more APs']];
function legendItems(view, thr) {
  if (view === 'overlap') return OVERLAP.map(o => ({ rgb: o[1], label: o[2] }));
  if (view === 'zones') return [{ rgb: ZONES[0], label: 'Each colour is the area one AP serves' }, { rgb: WEAK_RGB, label: 'Weaker than ' + minus(thr) + ' dBm' }];
  const rows = [[-50, null, 'Excellent', '≥ −50'], [-60, -50, 'Very good', '−60 to −50'], [-67, -60, 'Good for calls and video', '−67 to −60'],
    [-72, -67, 'OK for browsing', '−72 to −67'], [-80, -72, 'Weak', '−80 to −72']];
  const out = [];
  for (const [lo, hi, label, rg] of rows) {
    if (hi != null && hi <= thr) break;
    const mid = hi == null ? -45 : Math.max(thr, (lo + hi) / 2);
    out.push({ rgb: rampRGB(mid), label, range: lo < thr ? `${minus(thr)} to ${minus(hi)}` : rg });
  }
  out.push({ rgb: WEAK_RGB, label: 'Weak spot', range: '< ' + minus(thr) });
  return out;
}
/* One pixel per grid cell. Zones view outlines each AP's area. */
function paintHeat(r, band, view, thr) {
  const b = r && r.bands[band];
  if (!b) return null;
  const gw = r.gw, gh = r.gh;
  const c = document.createElement('canvas'); c.width = gw; c.height = gh;
  const g = c.getContext('2d'), im = g.createImageData(gw, gh), d = im.data;
  for (let i = 0; i < r.mask.length; i++) {
    if (!r.mask[i]) continue;
    let rgb, a = 255;
    if (view === 'overlap') rgb = OVERLAP[Math.min(3, b.count[i] >= 0 ? countAt(b, i, thr) : 0)][1];
    else if (view === 'zones') {
      const ap = b.bestAp[i];
      if (ap < 0 || b.best[i] < thr) rgb = WEAK_RGB;
      else {
        rgb = ZONES[ap % ZONES.length];
        const x = i % gw;
        const edge = (x + 1 < gw && r.mask[i + 1] && b.bestAp[i + 1] !== ap) || (i + gw < r.mask.length && r.mask[i + gw] && b.bestAp[i + gw] !== ap);
        if (edge) rgb = [rgb[0] * 0.35, rgb[1] * 0.35, rgb[2] * 0.35];
      }
    } else rgb = b.best[i] < thr ? WEAK_RGB : rampRGB(b.best[i]);
    const o = i * 4; d[o] = rgb[0]; d[o + 1] = rgb[1]; d[o + 2] = rgb[2]; d[o + 3] = a;
  }
  g.putImageData(im, 0, 0);
  return c;
}
// APs at or above the goal in one cell (count[] is at -67; for other goals use best/second as a fair proxy)
function countAt(b, i, thr) { if (thr === -67) return b.count[i]; return (b.best[i] >= thr ? 1 : 0) + (b.second[i] >= thr ? 1 : 0) + (b.count[i] > 2 ? 1 : 0); }

/* ---------- worker (built from a Blob so it also runs from file://) ---------- */
let worker = null, workerFailed = false, jobSeq = 0;
const jobs = new Map();
function workerMain() {
  /* global M, A */
  self.onmessage = function (e) {
    var d = e.data, tr = [];
    try {
      var r;
      if (d.type === 'grid') {
        r = M.computeGrid(d.p); tr.push(r.mask.buffer);
        for (var k in r.bands) { var o = r.bands[k]; tr.push(o.best.buffer, o.second.buffer, o.bestAp.buffer, o.count.buffer, o.cochan.buffer); }
      } else if (d.type === 'place') {
        r = M.placeAps(d.p, function (f) { self.postMessage({ id: d.id, type: 'progress', f: f }); });
      } else if (d.type === 'analyse') {
        var R = A.analyseRaster(d.p.rgba, d.p.w, d.p.h);
        r = { dark: R.dark, walls: R.walls, cols: R.cols, t: R.t, est: R.est, fp: R.fp ? { mask: R.fp.mask, area: R.fp.area, box: R.fp.box } : null };
        tr.push(R.dark.buffer, R.walls.buffer, R.cols.buffer); if (R.fp) tr.push(R.fp.mask.buffer);
      } else if (d.type === 'masks') {
        var q = d.p; r = A.modelMasks(q.walls, q.cols, q.fp, q.w, q.h, q.t, q.mPerPx, q.cellM);
        tr.push(r.wall.data.buffer, r.area.data.buffer);
      }
      self.postMessage({ id: d.id, type: 'done', r: r }, tr);
    } catch (err) { self.postMessage({ id: d.id, type: 'error', msg: String(err && err.message || err) }); }
  };
}
function getWorker() {
  if (worker || workerFailed) return worker;
  try {
    const src = WifiModelFactory.toString() + '\n' + AutoFactory.toString() + '\nvar M = WifiModelFactory(), A = AutoFactory();\n(' + workerMain.toString() + ')();';
    worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    worker.onmessage = e => {
      const d = e.data, j = jobs.get(d.id);
      if (!j) return;
      if (d.type === 'progress') { if (j.onProgress) j.onProgress(d.f); return; }
      jobs.delete(d.id);
      if (d.type === 'error') j.rej(new Error(d.msg)); else j.res(d.r);
    };
    worker.onerror = ev => {
      if (ev && ev.preventDefault) ev.preventDefault();
      workerFailed = true; worker = null;
      for (const j of jobs.values()) j.retry();
      jobs.clear();
    };
  } catch (e) { workerFailed = true; worker = null; }
  return worker;
}
function runSync(type, p, onProgress) {
  return new Promise((res, rej) => setTimeout(() => {
    try {
      if (type === 'grid') res(WifiModel.computeGrid(p));
      else if (type === 'place') res(WifiModel.placeAps(p, onProgress));
      else if (type === 'analyse') { const R = WifiAuto.analyseRaster(p.rgba, p.w, p.h); res({ dark: R.dark, walls: R.walls, cols: R.cols, t: R.t, est: R.est, fp: R.fp }); }
      else if (type === 'masks') res(WifiAuto.modelMasks(p.walls, p.cols, p.fp, p.w, p.h, p.t, p.mPerPx, p.cellM));
    } catch (e) { rej(e); }
  }, 0));
}
function runJob(type, p, onProgress, transfer) {
  const w = getWorker();
  if (!w) return runSync(type, p, onProgress);
  return new Promise((res, rej) => {
    const id = ++jobSeq;
    jobs.set(id, { res, rej, onProgress, retry: () => runSync(type, p, onProgress).then(res, rej) });
    try { w.postMessage({ type, id, p }, transfer || []); }
    catch (e) { jobs.delete(id); runSync(type, p, onProgress).then(res, rej); }
  });
}

/* ---------- model parameters for a floor ---------- */
function activeBands(f) { return BAND_KEYS.filter(b => f.aps.some(a => a.bands[b] && a.bands[b].on)); }
function canHeat(f) { return !!(f && f.mPerPx && f.aps.length && activeBands(f).length); }
function floorParams(f, extra) {
  const m = f.mPerPx, wt = wallType();
  const p = {
    W: f.imgW * m, H: f.imgH * m, n: PATH_N, dz: mountDz(), bands: activeBands(f),
    aps: f.aps.map(a => ({ x: a.x * m, y: a.y * m, bands: a.bands })),
    walls: f.walls.map(w => ({ ax: w.a.x * m, ay: w.a.y * m, bx: w.b.x * m, by: w.b.y * m, loss: matLoss(w.mat) })),
    areas: [], wallGrid: null, areaMask: null
  };
  if (f.an) {
    const cell = f.an.f * m;
    p.wallGrid = { w: f.an.wall.w, h: f.an.wall.h, cell, data: f.an.wall.data, loss: { 1: wt.inner, 2: wt.outer, 3: COLUMN_LOSS } };
    p.areaMask = { w: f.an.area.w, h: f.an.area.h, cell, data: f.an.area.data };
  }
  const area = f.an ? f.an.areaM2 : p.W * p.H;
  p.cell = Math.max(0.25, Math.sqrt(area / 9000));
  return Object.assign(p, extra || {});
}

/* ---------- heat map scheduling ---------- */
let heatBusy = false, heatPending = null, heatVer = 0, heatApplied = 0;
function requestHeat(draft) {
  const f = floor();
  if (!canHeat(f)) { S.heat = null; S.heatCache = {}; S.heatDirty = false; heatPending = null; if (typeof updateResultsUI === 'function') updateResultsUI(); render(); return; }
  const p = floorParams(f, draft ? { cell: Math.max(0.5, Math.sqrt((f.an ? f.an.areaM2 : 400) / 2500)) } : null);
  const job = { p, fid: f.id, mPerPx: f.mPerPx, v: ++heatVer, draft, apIds: f.aps.map(a => a.id) };
  S.heatDirty = false;
  if (heatBusy) { heatPending = job; return; }
  runHeat(job);
}
async function runHeat(job) {
  heatBusy = true; setBusy(true, 'Calculating');
  try {
    const r = await runJob('grid', job.p);
    if (S.p && job.fid === S.p.curFloor && job.v > heatApplied) {
      heatApplied = job.v;
      Object.assign(r, { fid: job.fid, mPerPx: job.mPerPx, v: job.v, draft: job.draft, apIds: job.apIds });
      S.heat = r; S.heatCache = {};
      if (typeof updateResultsUI === 'function') updateResultsUI();
      render();
    }
  } catch (e) { console.error(e); toast('Could not calculate the heat map.', true); }
  heatBusy = false;
  if (heatPending) { const j = heatPending; heatPending = null; runHeat(j); }
  else setBusy(false);
}
function setBusy(on, txt) { const b = $('#busy'); b.classList.toggle('on', !!on); if (txt) $('#busyT').textContent = txt; }
function heatCanvasFor(band) {
  const key = S.heat.v + '|' + band + '|' + S.p.view + '|' + S.p.set.goal;
  if (!S.heatCache[key]) S.heatCache[key] = paintHeat(S.heat, band, S.p.view, +S.p.set.goal);
  return S.heatCache[key];
}
/* Overlay with the detected floor area (tint) and walls (by class). */
function overlayCanvas(f) {
  if (!f.an) return null;
  const key = f.id + '|' + (S.ovVer || 0);
  if (S.ovKey === key && S.ovCanvas) return S.ovCanvas;
  const W = f.an.wall.w, H = f.an.wall.h, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), im = g.createImageData(W, H), d = im.data, wd = f.an.wall.data, ad = f.an.area.data;
  const col = { 1: [210, 104, 60, 230], 2: [138, 58, 34, 240], 3: [46, 51, 64, 250] };
  for (let i = 0; i < wd.length; i++) {
    const o = i * 4, c2 = wd[i];
    if (c2) { const k = col[c2] || col[1]; d[o] = k[0]; d[o + 1] = k[1]; d[o + 2] = k[2]; d[o + 3] = k[3]; }
    else if (ad[i]) { d[o] = 11; d[o + 1] = 122; d[o + 2] = 158; d[o + 3] = 40; }
  }
  g.putImageData(im, 0, 0);
  S.ovCanvas = c; S.ovKey = key;
  return c;
}
function wallsChanged() { S.ovVer = (S.ovVer || 0) + 1; }

/* ---------- maps (one or two canvases sharing one view) ---------- */
const MAPS = $$('.map').map(el => ({ el, band: el.dataset.band, cv: $('canvas', el), ctx: $('canvas', el).getContext('2d'), w: 0, h: 0, dpr: 1 }));
let raf = 0;
const C = {};
function readColors() {
  const cs = getComputedStyle(document.body);
  ['--accent', '--accent-ink', '--ink', '--bg', '--surface', '--muted', '--line', '--sunk'].forEach(n => { C[n] = cs.getPropertyValue(n).trim(); });
}
function visibleMaps() { return MAPS.filter(m => !m.el.hidden); }
function setLayout() {
  const one = S.step < 3 || S.p.layout !== 'split';
  const band = S.step < 3 ? '5' : (S.p.layout === '2.4' ? '2.4' : S.p.layout === '6' ? '6' : '5');
  MAPS.forEach(m => { m.el.hidden = one ? m.band !== '5' : !(m.band === '2.4' || m.band === '5'); });
  // the single map shows the chosen band
  const single = MAPS.find(m => m.band === '5');
  single.showBand = one ? band : '5';
  $('#maps').dataset.layout = one ? 'single' : 'split';
  requestAnimationFrame(resizeMaps);
}
function resizeMaps() {
  MAPS.forEach(m => {
    if (m.el.hidden) return;
    const r = m.cv.getBoundingClientRect();
    if (!r.width || !r.height) return;
    m.dpr = window.devicePixelRatio || 1; m.w = r.width; m.h = r.height;
    m.cv.width = Math.round(m.w * m.dpr); m.cv.height = Math.round(m.h * m.dpr);
  });
  if (!S.fitted && floor()) fitView();
  render();
}
function fitView() {
  const f = floor(), m = visibleMaps()[0];
  if (!f || !m || !m.w) return;
  // fit the building (if known) with some margin, else the sheet
  const b = f.an && f.an.box ? f.an.box : { x0: 0, y0: 0, x1: f.imgW, y1: f.imgH };
  const pad = 24, bw = (b.x1 - b.x0) * 1.08, bh = (b.y1 - b.y0) * 1.08;
  const s = Math.min((m.w - pad * 2) / bw, (m.h - pad * 2 - 40) / bh);
  S.view.s = s > 0 ? s : 0.1;
  S.view.ox = m.w / 2 - ((b.x0 + b.x1) / 2) * S.view.s;
  S.view.oy = (m.h + 30) / 2 - ((b.y0 + b.y1) / 2) * S.view.s;
  S.fitted = true;
  render();
}
function zoomAt(k, sx, sy) {
  const v = S.view, ns = clamp(v.s * k, 0.02, 40), m = visibleMaps()[0];
  if (sx == null) { sx = m ? m.w / 2 : 300; sy = m ? m.h / 2 : 300; }
  v.ox = sx - (sx - v.ox) * ns / v.s; v.oy = sy - (sy - v.oy) * ns / v.s; v.s = ns;
  render();
}
const toW = p => ({ x: (p.x - S.view.ox) / S.view.s, y: (p.y - S.view.oy) / S.view.s });
const toS = p => ({ x: p.x * S.view.s + S.view.ox, y: p.y * S.view.s + S.view.oy });
function render() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; visibleMaps().forEach(drawMap); updateScaleBar(); }); }

function pill(ctx, text, x, y, opts) {
  opts = opts || {};
  ctx.font = (opts.weight || 650) + ' 12px Archivo, system-ui, sans-serif';
  const w = ctx.measureText(text).width + 14, h = 20, bx = x - w / 2, by = y - h / 2;
  ctx.fillStyle = opts.bg || C['--surface']; ctx.strokeStyle = opts.border || C['--line']; ctx.lineWidth = 1;
  ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(bx, by, w, h, 10); else ctx.rect(bx, by, w, h);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = opts.color || C['--ink']; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(text, bx + 7, y + 0.5);
}
function mapBand(m) { return m.showBand || m.band; }
function drawMap(m) {
  const ctx = m.ctx;
  ctx.setTransform(m.dpr, 0, 0, m.dpr, 0, 0);
  ctx.clearRect(0, 0, m.w, m.h);
  const f = floor(); if (!f) return;
  const { s, ox, oy } = S.view, im = S.images.get(f.id), pw = f.imgW * s, ph = f.imgH * s;
  ctx.save(); ctx.shadowColor = 'rgba(15,18,25,.16)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 3;
  ctx.fillStyle = '#fff'; ctx.fillRect(ox, oy, pw, ph); ctx.restore();
  if (im && im.img) { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(im.img, ox, oy, pw, ph); }
  const band = mapBand(m);
  const showHeat = S.step >= 3 && S.heat && S.heat.fid === f.id && S.heat.bands[band];
  if (showHeat) {
    const hc = heatCanvasFor(band), k = S.heat.cell / S.heat.mPerPx * s;
    ctx.save(); ctx.beginPath(); ctx.rect(ox, oy, pw, ph); ctx.clip();
    ctx.globalAlpha = S.p.view === 'zones' ? 0.6 : 0.66; ctx.imageSmoothingEnabled = S.p.view !== 'zones'; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(hc, ox, oy, S.heat.gw * k, S.heat.gh * k); ctx.restore();
  }
  if ((S.showWalls || S.adjust || S.step === 2) && f.an) {
    const oc = overlayCanvas(f), k = f.an.f * s;
    ctx.save(); ctx.globalAlpha = showHeat ? 0.85 : 0.75; ctx.imageSmoothingEnabled = false;
    ctx.drawImage(oc, ox, oy, f.an.wall.w * k, f.an.wall.h * k); ctx.restore();
  }
  // hand-drawn walls
  ctx.lineCap = 'round';
  for (const w of f.walls) {
    const a = toS(w.a), b = toS(w.b);
    ctx.strokeStyle = matColor(w.mat); ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  // wall draft / measure line
  if (S.draft && S.draft.pts.length) {
    const pts = S.draft.pts.map(toS), cur = S.cursor ? toS(S.cursor) : null;
    ctx.strokeStyle = S.draft.kind === 'wall' ? matColor(S.wallMat) : C['--accent']; ctx.lineWidth = 3;
    ctx.beginPath(); pts.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)); ctx.stroke();
    if (cur) { const l = pts[pts.length - 1]; ctx.setLineDash([7, 5]); ctx.beginPath(); ctx.moveTo(l.x, l.y); ctx.lineTo(cur.x, cur.y); ctx.stroke(); ctx.setLineDash([]); }
    ctx.fillStyle = '#fff'; ctx.strokeStyle = C['--accent']; ctx.lineWidth = 2;
    pts.forEach(q => { ctx.beginPath(); ctx.arc(q.x, q.y, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); });
    if (cur && f.mPerPx) { const lw = S.draft.pts[S.draft.pts.length - 1]; pill(ctx, fmtLen(Math.hypot(S.cursor.x - lw.x, S.cursor.y - lw.y) * f.mPerPx), cur.x + 40, cur.y - 18); }
  }
  // erase brush
  if (S.adjust && S.tool === 'erase' && S.cursor && f.mPerPx && m.hoverOn) {
    const q = toS(S.cursor); ctx.strokeStyle = C['--accent']; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.arc(q.x, q.y, 0.35 / f.mPerPx * s, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  }
  // access points: numbered markers
  if (S.step >= 3) f.aps.forEach((ap, i) => {
    const q = toS(ap), sel = S.sel && S.sel.id === ap.id, hov = S.hover && S.hover.id === ap.id;
    const on = ap.bands[band] && ap.bands[band].on;
    const zc = S.p.view === 'zones' ? rgbCss(ZONES[i % ZONES.length]) : null;
    if (sel) { ctx.beginPath(); ctx.arc(q.x, q.y, 21, 0, Math.PI * 2); ctx.fillStyle = C['--accent']; ctx.globalAlpha = 0.2; ctx.fill(); ctx.globalAlpha = 1; ctx.strokeStyle = C['--accent']; ctx.lineWidth = 2; ctx.stroke(); }
    ctx.beginPath(); ctx.arc(q.x, q.y, hov ? 14 : 13, 0, Math.PI * 2);
    ctx.fillStyle = !on ? '#8A919E' : zc || '#0B7A9E'; ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = '800 12px Archivo, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), q.x, q.y + 0.5);
    if (S.view.s > 0.18 || sel) pill(ctx, ap.name + (on && ap.bands[band] ? ' · ch ' + ap.bands[band].ch : ''), q.x, q.y + 27, sel ? { bg: C['--accent'], border: C['--accent'], color: C['--accent-ink'] } : {});
  });
}
function updateScaleBar() {
  const f = floor(), sb = $('#scalebar');
  if (!f || !f.mPerPx || S.step === 4) { sb.hidden = true; return; }
  const mPerScreenPx = f.mPerPx / S.view.s, target = 110 * mPerScreenPx;
  let L = 0.5; for (const n of [0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 500]) if (n <= target) L = n;
  sb.hidden = false;
  $('#scaleTxt').textContent = L + ' m';
  $('#scaleLine').style.width = (L / mPerScreenPx) + 'px';
  $('#zoomLbl').textContent = Math.round(S.view.s * 100) + '%';
}

/* ---------- geometry ---------- */
function distToSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
  const t = clamp(L ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L : 0, 0, 1);
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
function snapAngle(w, from, free) {
  if (!from || free) return { x: w.x, y: w.y };
  const dx = w.x - from.x, dy = w.y - from.y; if (!dx && !dy) return { x: w.x, y: w.y };
  const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), t = dx * Math.cos(a) + dy * Math.sin(a);
  return { x: from.x + Math.cos(a) * t, y: from.y + Math.sin(a) * t };
}
function hitAp(sp) {
  const f = floor(); if (!f || S.step < 3) return null;
  for (let i = f.aps.length - 1; i >= 0; i--) { const q = toS(f.aps[i]); if (Math.hypot(q.x - sp.x, q.y - sp.y) <= 15) return f.aps[i]; }
  return null;
}

/* ---------- undo / redo (Adjust mode) ---------- */
function snapOf(fid) {
  const f = S.p.floors.find(x => x.id === fid);
  return { fid, aps: clone(f.aps), walls: clone(f.walls), mPerPx: f.mPerPx, scale: clone(f.scale), wall: f.an ? f.an.wall.data.slice() : null };
}
function pushUndo(s) { S.hist.u.push(s); if (S.hist.u.length > 60) S.hist.u.shift(); S.hist.r.length = 0; updUndo(); }
function mark() { const f = floor(); if (f) pushUndo(snapOf(f.id)); }
function restoreSnap(s) {
  const f = S.p.floors.find(x => x.id === s.fid); if (!f) return;
  if (S.p.curFloor !== f.id) switchFloor(f.id);
  f.aps = clone(s.aps); f.walls = clone(s.walls); f.mPerPx = s.mPerPx; f.scale = s.scale;
  if (s.wall && f.an) { f.an.wall.data = s.wall.slice(); wallsChanged(); }
  S.sel = null; S.draft = null;
  changed();
}
function undo() { if (!S.hist.u.length) return; const s = S.hist.u.pop(); S.hist.r.push(snapOf(s.fid)); restoreSnap(s); updUndo(); }
function redo() { if (!S.hist.r.length) return; const s = S.hist.r.pop(); S.hist.u.push(snapOf(s.fid)); restoreSnap(s); updUndo(); }
function updUndo() { $('#undoBtn').disabled = !S.hist.u.length; $('#redoBtn').disabled = !S.hist.r.length; }

/* ---------- AP helpers ---------- */
function makeAp(x, y, type, idx) {
  const t = AP_TYPES[type] || AP_TYPES.wifi6;
  return { id: uid(), name: 'AP-' + idx, x, y, type, bands: clone(t.bands) };
}
function renumberAps(f) { f.aps.forEach((a, i) => { if (/^AP-\d+$/.test(a.name)) a.name = 'AP-' + (i + 1); }); }
/* Channels: 1/6/11 on 2.4 GHz and non-overlapping 5/6 GHz channels, so APs that hear each other differ. */
function assignAllChannels(f) {
  if (!f.mPerPx || !f.aps.length) return;
  const p = floorParams(f), opts = { dz: 0, wallGrid: p.wallGrid };
  BAND_KEYS.forEach(band => {
    const idx = f.aps.map((a, i) => i).filter(i => f.aps[i].bands[band] && f.aps[i].bands[band].on);
    if (!idx.length) return;
    const hear = (i, j) => { const r = WifiModel.rssiPoint(p.aps[idx[j]], band, p.aps[idx[i]].x, p.aps[idx[i]].y, p.walls, p.n, opts); return r == null ? -200 : r; };
    const ch = WifiAuto.assignChannels(idx.length, hear, CHANNELS[band], (a, b) => WifiModel.channelsOverlap(band, a, b));
    idx.forEach((k, n) => { f.aps[k].bands[band].ch = ch[n]; });
  });
}

/* ---------- hints ---------- */
function setHint(text) {
  const h = $('#hint');
  if (text != null) { h.innerHTML = text; return; }
  let t = '';
  if (S.step === 3 && S.adjust) {
    t = { move: icon('cursor', 'sm') + 'Drag an access point to move it. <kbd>Delete</kbd> removes the selected one',
      add: icon('plus', 'sm') + 'Click the plan to add an access point',
      wall: icon('line', 'sm') + (S.draft ? 'Click the next corner. <kbd>Esc</kbd> or double-click to finish' : 'Click to start a wall the scan missed'),
      erase: icon('trash', 'sm') + 'Drag over a wall that isn\'t really there',
      measure: icon('ruler', 'sm') + (S.draft ? 'Now click the other end' : 'Click both ends of a length you know') }[S.tool] || '';
  } else if (S.step === 3) t = icon('info', 'sm') + 'Hover the map to read the signal. Scroll to zoom, drag to move';
  else if (S.step === 1) t = icon('info', 'sm') + 'Drag to move, scroll or pinch to zoom';
  h.innerHTML = t;
}
function setCursor(c) { $('#stage').dataset.cursor = c || ''; }
function baseCursor() {
  if (S.spaceHeld) return 'grab';
  if (S.adjust && (S.tool === 'add' || S.tool === 'wall' || S.tool === 'measure')) return 'cross';
  if (S.adjust && S.tool === 'erase') return 'cross';
  return 'grab';
}

/* ---------- pointer input (both maps) ---------- */
const ptrs = new Map();
let drag = null, down = null, pinch = null, lastDragHeat = 0;
function evPt(e, cv) { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
function eraseAt(w) {
  const f = floor(); if (!f || !f.mPerPx) return;
  const R = 0.35 / f.mPerPx;
  if (f.an) {
    const k = f.an.f, W = f.an.wall.w, H = f.an.wall.h, d = f.an.wall.data, rc = Math.ceil(R / k), ci = Math.floor(w.x / k), cj = Math.floor(w.y / k);
    for (let j = cj - rc; j <= cj + rc; j++) for (let i = ci - rc; i <= ci + rc; i++) {
      if (i < 0 || j < 0 || i >= W || j >= H) continue;
      if (Math.hypot((i + 0.5) * k - w.x, (j + 0.5) * k - w.y) <= R) d[j * W + i] = 0;
    }
    wallsChanged();
  }
  f.walls = f.walls.filter(s => distToSeg(w, s.a, s.b) > R);
}
MAPS.forEach(m => {
  const cv = m.cv;
  cv.addEventListener('pointerdown', e => {
    if (!floor() || S.step === 4) return;
    cv.focus({ preventScroll: true });
    const sp = evPt(e, cv);
    ptrs.set(e.pointerId, sp);
    try { cv.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ }
    if (ptrs.size === 2) {
      drag = null; down = null;
      const [a, b] = [...ptrs.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, s: S.view.s, ox: S.view.ox, oy: S.view.oy };
      return;
    }
    if (ptrs.size > 2 || e.button === 2) return;
    down = { sp, w: toW(sp), moved: false, cv };
    if (e.button === 1 || S.spaceHeld) { e.preventDefault(); drag = { type: 'pan', sp, ox: S.view.ox, oy: S.view.oy }; setCursor('grabbing'); return; }
    const ap = hitAp(sp);
    if (ap) {
      S.sel = { kind: 'ap', id: ap.id };
      if (S.adjust && S.tool === 'move') drag = { type: 'ap', ap, dx: down.w.x - ap.x, dy: down.w.y - ap.y, snap: snapOf(floor().id) };
      else drag = { type: 'maybe', sp, ox: S.view.ox, oy: S.view.oy };
      refreshPanel(); render();
      return;
    }
    if (S.adjust && S.tool === 'erase') { drag = { type: 'erase', snap: snapOf(floor().id) }; eraseAt(down.w); render(); return; }
    drag = { type: 'maybe', sp, ox: S.view.ox, oy: S.view.oy };
  });
  cv.addEventListener('pointermove', e => {
    const sp = evPt(e, cv);
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, sp);
    if (pinch && ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1, cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      const ns = clamp(pinch.s * d / pinch.d, 0.02, 40), wx = (pinch.cx - pinch.ox) / pinch.s, wy = (pinch.cy - pinch.oy) / pinch.s;
      S.view.s = ns; S.view.ox = cx - wx * ns; S.view.oy = cy - wy * ns; render(); return;
    }
    const f = floor(); if (!f) return;
    const w = toW(sp);
    MAPS.forEach(mm => { mm.hoverOn = mm === m; });
    if (drag && down) {
      if (!down.moved && Math.hypot(sp.x - down.sp.x, sp.y - down.sp.y) > 5) down.moved = true;
      if (drag.type === 'erase') { S.cursor = w; eraseAt(w); render(); return; }
      if (!down.moved) return;
      if (drag.type === 'maybe') { drag.type = 'pan'; setCursor('grabbing'); }
      if (drag.type === 'pan') { S.view.ox = drag.ox + sp.x - drag.sp.x; S.view.oy = drag.oy + sp.y - drag.sp.y; render(); return; }
      if (drag.type === 'ap') {
        drag.ap.x = clamp(w.x - drag.dx, 0, f.imgW); drag.ap.y = clamp(w.y - drag.dy, 0, f.imgH);
        setCursor('grabbing');
        const now = performance.now();
        if (now - lastDragHeat > 80) { lastDragHeat = now; requestHeat(true); }
        render(); return;
      }
      return;
    }
    if (S.adjust && (S.tool === 'wall' || S.tool === 'measure' || S.tool === 'erase')) {
      const last = S.draft && S.draft.pts[S.draft.pts.length - 1];
      S.cursor = S.tool === 'erase' ? w : snapAngle(w, last, e.shiftKey || S.tool === 'measure');
      render();
    }
    const ap = hitAp(sp);
    if ((ap && ap.id) !== (S.hover && S.hover.id)) { S.hover = ap ? { id: ap.id } : null; render(); }
    setCursor(ap ? 'pointer' : baseCursor());
    updateTip(e, m, w);
  });
  const end = e => {
    ptrs.delete(e.pointerId);
    if (pinch) { if (ptrs.size < 2) pinch = null; drag = null; down = null; return; }
    if (!drag || !down) { drag = null; down = null; return; }
    const d = drag, moved = down.moved, w0 = down.w;
    drag = null; down = null;
    if (e.type === 'pointercancel') { setCursor(baseCursor()); return; }
    if (d.type === 'maybe' && !moved) handleClick(w0, e);
    else if (d.type === 'ap' && moved) { pushUndo(d.snap); changed(); }
    else if (d.type === 'erase') { pushUndo(d.snap); changed(); }
    setCursor(baseCursor()); render();
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener('pointerleave', () => { $('#tip').classList.remove('on'); m.hoverOn = false; if (!drag && S.hover) { S.hover = null; render(); } });
  cv.addEventListener('dblclick', e => { e.preventDefault(); if (S.draft) finishDraft(); });
  cv.addEventListener('contextmenu', e => { e.preventDefault(); if (S.draft) finishDraft(); });
  cv.addEventListener('wheel', e => {
    if (!floor()) return;
    e.preventDefault();
    const sp = evPt(e, cv), dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomAt(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0018)), sp.x, sp.y);
  }, { passive: false });
});

function handleClick(w, ev) {
  const f = floor(); if (!f) return;
  if (S.step === 3 && S.adjust) {
    if (S.tool === 'add') {
      if (w.x < 0 || w.y < 0 || w.x > f.imgW || w.y > f.imgH) return;
      mark();
      const ap = makeAp(w.x, w.y, S.p.set.apType, f.aps.length + 1);
      f.aps.push(ap); assignAllChannels(f);
      S.sel = { kind: 'ap', id: ap.id };
      changed(); return;
    }
    if (S.tool === 'wall' || S.tool === 'measure') {
      const last = S.draft && S.draft.pts[S.draft.pts.length - 1];
      const p = snapAngle(w, last, (ev && ev.shiftKey) || S.tool === 'measure');
      if (!S.draft) { S.draft = { kind: S.tool, pts: [p] }; setHint(); render(); return; }
      if (S.tool === 'measure') { const a = S.draft.pts[0]; S.draft = null; setHint(); render(); openScaleDialog({ px: Math.hypot(p.x - a.x, p.y - a.y) }); return; }
      if (Math.hypot(p.x - last.x, p.y - last.y) * S.view.s > 3) {
        mark(); f.walls.push({ id: uid(), a: { x: last.x, y: last.y }, b: { x: p.x, y: p.y }, mat: S.wallMat });
        S.draft.pts.push(p); changed();
      }
      return;
    }
  }
  if (S.sel) { S.sel = null; refreshPanel(); render(); }
}
function finishDraft() { S.draft = null; setHint(); render(); }
function deleteSel() {
  const f = floor(); if (!S.sel || !f) return;
  mark();
  f.aps = f.aps.filter(a => a.id !== S.sel.id);
  renumberAps(f);
  S.sel = null; changed();
}
function selectedAp() { const f = floor(); return S.sel && f ? f.aps.find(a => a.id === S.sel.id) : null; }

function updateTip(e, m, w) {
  const tip = $('#tip'), f = floor();
  if (S.step !== 3 || !S.heat || S.heat.fid !== f.id || drag) { tip.classList.remove('on'); return; }
  const r = S.heat, mm = r.mPerPx, i = Math.floor(w.x * mm / r.cell), j = Math.floor(w.y * mm / r.cell), band = mapBand(m);
  const b = r.bands[band];
  if (!b || i < 0 || j < 0 || i >= r.gw || j >= r.gh || !r.mask[j * r.gw + i]) { tip.classList.remove('on'); return; }
  const c = j * r.gw + i, apIdx = b.bestAp[c], ap = apIdx >= 0 ? f.aps.find(a => a.id === r.apIds[apIdx]) : null;
  tip.textContent = BAND_LABEL[band] + ': ' + (b.best[c] <= -120 ? 'no signal' : fmtDbm(b.best[c]) + (ap ? ' from ' + ap.name : ''));
  const sr = $('#stage').getBoundingClientRect();
  tip.style.left = (e.clientX - sr.left) + 'px'; tip.style.top = (e.clientY - sr.top) + 'px';
  tip.classList.add('on');
}

/* ---------- keyboard ---------- */
function typingTarget(t) { return t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable); }
document.addEventListener('keydown', e => {
  if ($('#v-editor').hidden || !floor() || document.querySelector('dialog[open]')) return;
  const typing = typingTarget(e.target), mod = e.ctrlKey || e.metaKey;
  if (mod && !typing && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && !typing && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (typing || mod || e.altKey) return;
  const onMap = MAPS.some(m => m.cv === document.activeElement);
  switch (e.key) {
    case ' ': if (onMap || document.activeElement === document.body) { e.preventDefault(); if (!S.spaceHeld) { S.spaceHeld = true; setCursor('grab'); } } break;
    case 'Escape': if (S.draft) finishDraft(); else if (S.sel) { S.sel = null; refreshPanel(); render(); } break;
    case 'Delete': case 'Backspace': if (S.sel && S.adjust) { e.preventDefault(); deleteSel(); } break;
    case '+': case '=': zoomAt(1.25); break;
    case '-': case '_': zoomAt(0.8); break;
    case '0': fitView(); break;
    case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': {
      if (!onMap) break;
      e.preventDefault();
      const dx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0, dy = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
      const ap = S.adjust ? selectedAp() : null;
      if (ap) { if (!e.repeat) mark(); const st = (e.shiftKey ? 2 : 12) / S.view.s; ap.x = clamp(ap.x + dx * st, 0, floor().imgW); ap.y = clamp(ap.y + dy * st, 0, floor().imgH); changed(); }
      else { S.view.ox -= dx * 60; S.view.oy -= dy * 60; render(); }
      break;
    }
    default: break;
  }
});
document.addEventListener('keyup', e => { if (e.key === ' ') { S.spaceHeld = false; setCursor(baseCursor()); } });
$('#zoomIn').addEventListener('click', () => zoomAt(1.25));
$('#zoomOut').addEventListener('click', () => zoomAt(0.8));
$('#zoomFit').addEventListener('click', fitView);
$('#undoBtn').addEventListener('click', undo);
$('#redoBtn').addEventListener('click', redo);
if (window.ResizeObserver) new ResizeObserver(resizeMaps).observe($('#maps')); else window.addEventListener('resize', resizeMaps);
