/* Daftarbox Wi-Fi heat mapping: constants, helpers, storage, file import (PDF, image, DXF), project files, sample plan.
   Classic script (no modules) so the page works from file://. Top-level names are shared with editor.js and app.js. */
'use strict';

const BAND_KEYS = ['2.4', '5', '6'];
const BAND_LABEL = { '2.4': '2.4 GHz', '5': '5 GHz', '6': '6 GHz' };
const CHANNELS = {
  '2.4': [1, 6, 11],
  '5': [36, 44, 149, 157, 40, 48, 153, 161],
  '6': [5, 21, 37, 53, 69, 85, 101, 117]
};
const CH_ALL = {
  '2.4': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
  '5': [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 149, 153, 157, 161, 165],
  '6': [1, 5, 9, 13, 17, 21, 25, 29, 33, 37, 41, 45, 49, 53, 57, 61, 65, 69, 73, 77, 81, 85, 89, 93, 97, 101, 117]
};

/* Building wall types: loss (dB per crossing) for inner walls, outer walls; columns are always RCC. */
const WALL_TYPES = {
  brick: { name: 'Brick', inner: { '2.4': 8, '5': 12, '6': 14 }, outer: { '2.4': 12, '5': 18, '6': 21 } },
  aac: { name: 'AAC block', inner: { '2.4': 6, '5': 10, '6': 12 }, outer: { '2.4': 9, '5': 14, '6': 17 } },
  drywall: { name: 'Drywall', inner: { '2.4': 3, '5': 4, '6': 5 }, outer: { '2.4': 12, '5': 18, '6': 21 } },
  concrete: { name: 'Concrete', inner: { '2.4': 15, '5': 22, '6': 26 }, outer: { '2.4': 18, '5': 26, '6': 30 } },
  glass: { name: 'Glass offices', inner: { '2.4': 3, '5': 5, '6': 6 }, outer: { '2.4': 10, '5': 18, '6': 22 } }
};
const COLUMN_LOSS = { '2.4': 18, '5': 26, '6': 30 };
/* Extra materials for walls drawn by hand in Adjust mode, and the help page. */
const DEFAULT_MATERIALS = [
  { id: 'partition', name: 'Cubicle or light partition', loss: { '2.4': 1, '5': 2, '6': 2 }, color: '#9AA5B1' },
  { id: 'drywall', name: 'Drywall or gypsum board', loss: { '2.4': 3, '5': 4, '6': 5 }, color: '#6FA8EE' },
  { id: 'glass', name: 'Glass, clear', loss: { '2.4': 3, '5': 5, '6': 6 }, color: '#3FC6D6' },
  { id: 'glass-tint', name: 'Glass, tinted or low-E', loss: { '2.4': 10, '5': 18, '6': 22 }, color: '#1F8A9E' },
  { id: 'door', name: 'Wooden door', loss: { '2.4': 3, '5': 5, '6': 6 }, color: '#C08A4E' },
  { id: 'aac', name: 'AAC block wall', loss: { '2.4': 6, '5': 10, '6': 12 }, color: '#E0A24C' },
  { id: 'brick', name: 'Brick wall, 4.5 in (115 mm)', loss: { '2.4': 8, '5': 12, '6': 14 }, color: '#D2683C' },
  { id: 'brick9', name: 'Brick wall, 9 in (230 mm)', loss: { '2.4': 12, '5': 18, '6': 21 }, color: '#A8432A' },
  { id: 'concrete', name: 'Concrete or RCC', loss: { '2.4': 15, '5': 22, '6': 26 }, color: '#5E6370' },
  { id: 'metal', name: 'Metal, lift or shaft', loss: { '2.4': 26, '5': 32, '6': 35 }, color: '#2E3340' }
];

/* AP types. watts = typical PoE draw used for the switch power budget. budget = model used in the IT budget page. */
const AP_TYPES = {
  wifi6: { name: 'Wi-Fi 6, indoor', watts: 20, budget: { b: 'TP-Link Omada', t: 'Indoor Wi-Fi 6', m: 'EAP650' },
    bands: { '2.4': { on: true, tx: 17, gain: 3, ch: 1 }, '5': { on: true, tx: 20, gain: 4, ch: 36 }, '6': { on: false, tx: 20, gain: 4, ch: 5 } } },
  wifi7: { name: 'Wi-Fi 7, indoor (tri-band)', watts: 30, budget: { b: 'Ubiquiti UniFi', t: 'Indoor Wi-Fi 7', m: 'U7 Pro' },
    bands: { '2.4': { on: true, tx: 18, gain: 3, ch: 1 }, '5': { on: true, tx: 21, gain: 5, ch: 36 }, '6': { on: true, tx: 21, gain: 5, ch: 5 } } },
  hd: { name: 'High-density (lower power, more APs)', watts: 22, budget: { b: 'TP-Link Omada', t: 'Indoor Wi-Fi 6', m: 'EAP670' },
    bands: { '2.4': { on: true, tx: 11, gain: 3, ch: 1 }, '5': { on: true, tx: 15, gain: 4, ch: 36 }, '6': { on: false, tx: 15, gain: 4, ch: 5 } } }
};
const GOALS = { '-67': 'Calls and video (−67 dBm)', '-72': 'Browsing (−72 dBm)', '-75': 'Basic (−75 dBm)' };
const MOUNTS = { '2.7': 'Ceiling, 2.7 m', '3': 'Ceiling, 3 m', '3.6': 'Ceiling, 3.6 m', '4.5': 'Ceiling, 4.5 m', 'wall': 'Wall, about 2.2 m' };
const PATH_N = 3.0;   // path-loss exponent for furnished offices

/* ---------- small helpers ---------- */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const clone = o => JSON.parse(JSON.stringify(o));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const minus = s => String(s).replace(/-/g, '−');
const fmtDbm = v => minus(Math.round(v)) + ' dBm';
const fmtPct = f => (f >= 0.995 && f < 1 ? '99' : Math.round(f * 100)) + '%';
function fmtLen(m) { if (m == null || !isFinite(m)) return '–'; return m < 10 ? m.toFixed(2) + ' m' : m.toFixed(1) + ' m'; }
function fmtArea(m2) { return Math.round(m2).toLocaleString('en-IN') + ' m²'; }
function fmtSqft(m2) { return Math.round(m2 * 10.7639 / 10) * 10 > 0 ? (Math.round(m2 * 10.7639 / 10) * 10).toLocaleString('en-IN') + ' sq ft' : ''; }
function icon(name, cls) { return `<svg class="i${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="#i-${name}"/></svg>`; }
function slug(s) { return String(s || 'plan').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'plan'; }

let toastTimer = 0;
function toast(msg, isErr) {
  const t = $('#toast');
  t.innerHTML = (isErr ? icon('warn') : icon('check')) + '<span>' + esc(msg) + '</span>';
  t.classList.toggle('err', !!isErr);
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), isErr ? 5200 : 3000);
}
function loading(on, title, sub) {
  const l = $('#loading');
  l.hidden = !on;
  if (on) { $('#loadingT').textContent = title || 'Working'; $('#loadingS').textContent = sub || 'This takes a moment for big files.'; }
}
function ask(title, html, okText, cancelText) {
  const d = $('#msgDlg');
  $('#msgDlgT').textContent = title;
  $('#msgDlgB').innerHTML = html;
  $('#msgOk').textContent = okText || 'OK';
  const c = $('#msgCancel');
  c.hidden = cancelText === false;
  c.textContent = cancelText || 'Cancel';
  return new Promise(res => {
    d.addEventListener('close', function h() { d.removeEventListener('close', h); res(d.returnValue === 'ok'); });
    d.returnValue = '';
    d.showModal();
  });
}
function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = () => res(); s.onerror = () => rej(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
}
function blobToImage(blob) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(blob), img = new Image();
    img.onload = () => res(img);
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('bad image')); };
    img.src = url;
  });
}
function canvasToBlob(c, type, q) { return new Promise(res => c.toBlob(b => res(b), type || 'image/png', q)); }
function blobToDataURL(b) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); }); }
function dataURLToBlob(u) {
  const i = u.indexOf(','), meta = u.slice(5, i), bin = atob(u.slice(i + 1));
  const arr = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) arr[k] = bin.charCodeAt(k);
  return new Blob([arr], { type: meta.split(';')[0] || 'application/octet-stream' });
}
function u8ToB64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
function b64ToU8(b) { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }

/* ---------- storage (IndexedDB, everything in try/catch) ---------- */
const DB = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      try {
        const r = indexedDB.open('daftarbox-wifi', 2);
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('images')) db.createObjectStore('images');
        };
        r.onsuccess = () => { this.db = r.result; res(this.db); };
        r.onerror = () => rej(r.error);
        r.onblocked = () => rej(new Error('blocked'));
      } catch (e) { rej(e); }
    });
  },
  async tx(store, mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode), s = t.objectStore(store);
      let out;
      try { out = fn(s); } catch (e) { rej(e); return; }
      t.oncomplete = () => res(out && 'result' in out ? out.result : out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  },
  putProject(p) { return this.tx('projects', 'readwrite', s => s.put(p)); },
  getProject(id) { return this.tx('projects', 'readonly', s => s.get(id)); },
  listProjects() { return this.tx('projects', 'readonly', s => s.getAll()); },
  putImage(key, blob) { return this.tx('images', 'readwrite', s => s.put(blob, key)); },
  getImage(key) { return this.tx('images', 'readonly', s => s.get(key)); },
  delImage(key) { return this.tx('images', 'readwrite', s => s.delete(key)); },
  async deleteProject(id) {
    await this.tx('projects', 'readwrite', s => s.delete(id));
    await this.tx('images', 'readwrite', s => s.delete(IDBKeyRange.bound(id + '/', id + '/￿')));
  }
};
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }

/* ---------- project factory ---------- */
function newProject(name) {
  return {
    id: uid(), name: name || 'My Wi-Fi plan', created: Date.now(), updated: Date.now(), v: 2,
    floors: [], curFloor: null,
    set: { goal: -67, target: 0.95, apType: 'wifi6', mount: '3', wallType: 'brick', spare: 20 },
    band: '5', view: 'rssi', layout: 'split', client: '', by: ''
  };
}
function newFloor(name, w, h, src) {
  return { id: uid(), name: name || 'Ground floor', imgW: w, imgH: h, src: src || { kind: 'image', name: '' },
    mPerPx: null, scale: null, an: null, walls: [], aps: [] };
}

/* ---------- file import: every importer returns an analysis "source" ----------
   { blob, img, w, h, src:{kind,name}, words:[{text,x0,y0,x1,y1,vertical,conf}] | null, note:{ratio,str} | null,
     ptPerPx (PDF points per image pixel) | null, unitMPerPx (DXF) | null } */
const MAX_SIDE = 3400;
async function importImage(file) {
  let img = await blobToImage(file);
  let blob = file, w = img.naturalWidth, h = img.naturalHeight;
  if (Math.max(w, h) > MAX_SIDE) {
    const k = MAX_SIDE / Math.max(w, h), c = document.createElement('canvas');
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    blob = await canvasToBlob(c, 'image/png');
    img = await blobToImage(blob); w = c.width; h = c.height;
  }
  return { blob, img, w, h, src: { kind: 'image', name: file.name }, words: null, note: null, ptPerPx: null, unitMPerPx: null };
}

const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
async function importPdf(file) {
  loading(true, 'Opening PDF', 'Loading the PDF reader…');
  if (!window.pdfjsLib) {
    await loadScript(PDFJS + 'pdf.min.js');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';  // pdf.js wraps it in a Blob for file://
  }
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await window.pdfjsLib.getDocument({ data }).promise;
  let pageNo = 1;
  if (doc.numPages > 1) {
    loading(false);
    const d = $('#pdfDlg');
    $('#pdfPages').textContent = doc.numPages;
    const inp = $('#pdfPage'); inp.max = doc.numPages; inp.value = 1;
    const ok = await new Promise(res => {
      d.addEventListener('close', function h() { d.removeEventListener('close', h); res(d.returnValue === 'ok'); });
      d.returnValue = ''; d.showModal(); inp.select();
    });
    if (!ok) return null;
    pageNo = clamp(parseInt(inp.value, 10) || 1, 1, doc.numPages);
  }
  loading(true, 'Reading page ' + pageNo, 'Turning the page into a sharp image…');
  const page = await doc.getPage(pageNo);
  const v1 = page.getViewport({ scale: 1 });
  // about 150-160 dpi for A3/A2 sheets: double-line walls end up 8-12 px apart, numbers stay readable
  const scale = clamp(2620 / Math.max(v1.width, v1.height), 1, 5);
  const vp = page.getViewport({ scale });
  const c = document.createElement('canvas');
  c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  // "print" intent renders without requestAnimationFrame, so analysis keeps going in a background tab
  await page.render({ canvasContext: g, viewport: vp, intent: 'print' }).promise;
  // text layer (vector PDFs): dimension numbers and scale notes
  let words = [], allText = '';
  try {
    const tc = await page.getTextContent();
    tc.items.forEach(it => {
      const s = String(it.str || '').trim(); if (!s) return;
      allText += ' ' + s;
      const t = it.transform, p = vp.convertToViewportPoint(t[4], t[5]);
      const len = (it.width || 0) * scale, hh = Math.hypot(t[2], t[3]) * scale || 8;
      const vertical = Math.abs(t[1]) > Math.abs(t[0]);
      const o = vertical ? { x0: p[0] - hh, x1: p[0], y0: p[1] - len, y1: p[1] } : { x0: p[0], x1: p[0] + len, y0: p[1] - hh, y1: p[1] };
      s.split(/\s+/).forEach(tok => { if (/^\d{3,6}$/.test(tok)) words.push(Object.assign({ text: tok, conf: 99, vertical }, roundBox(o))); });
    });
  } catch (e) { /* no text layer */ }
  const notes = WifiAuto.scaleNotes(allText), note = WifiAuto.bestNote(notes);
  const blob = await canvasToBlob(c, 'image/png');
  const img = await blobToImage(blob);
  try { doc.destroy(); } catch (e) { /* ignore */ }
  return { blob, img, w: c.width, h: c.height, src: { kind: 'pdf', name: file.name + (doc.numPages > 1 ? ' (page ' + pageNo + ')' : '') },
    words: words.length ? words : null, note, ptPerPx: 1 / scale, unitMPerPx: null };
}
function roundBox(o) { return { x0: Math.round(o.x0), y0: Math.round(o.y0), x1: Math.round(o.x1), y1: Math.round(o.y1) }; }

/* ---------- DXF ---------- */
// dxf-parser 1.1.2 (MIT): dist/dxf-parser.js is a minified UMD bundle that sets window.DxfParser
const DXF_URLS = ['https://cdn.jsdelivr.net/npm/dxf-parser@1.1.2/dist/dxf-parser.js', 'https://unpkg.com/dxf-parser@1.1.2/dist/dxf-parser.js'];
const INSUNITS_M = { 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1, 14: 0.1 };
async function getDxfParserCtor() {
  const pick = () => { const P = window.DxfParser; return P ? (typeof P === 'function' ? P : (P.default || P.DxfParser)) : null; };
  if (pick()) return pick();
  for (const u of DXF_URLS) { try { await loadScript(u); if (pick()) return pick(); } catch (e) { /* next */ } }
  return null;
}
/* Small built-in reader used when the CDN library can't load. Same output shape as dxf-parser. */
function miniDxfParse(text) {
  const lines = text.split(/\r\n|\r|\n/), pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([parseInt(lines[i].trim(), 10), lines[i + 1].trim()]);
  const out = { header: {}, blocks: {}, entities: [] };
  let i = 0, section = null, block = null, poly = null;
  function readEntity(type) {
    const e = { type, layer: '0' }, verts = []; let v = null;
    i++;
    while (i < pairs.length && pairs[i][0] !== 0) {
      const [c, val] = pairs[i], f = parseFloat(val);
      switch (c) {
        case 8: e.layer = val; break;
        case 2: e.name = val; break;
        case 10: if (type === 'LWPOLYLINE') { v = { x: f, y: 0 }; verts.push(v); } else (e.p = e.p || {}).x = f; break;
        case 20: if (type === 'LWPOLYLINE' && v) v.y = f; else (e.p = e.p || {}).y = f; break;
        case 11: (e.q = e.q || {}).x = f; break;
        case 21: (e.q = e.q || {}).y = f; break;
        case 40: e.r = f; break;
        case 41: e.sx = f; break;
        case 42: if (type === 'LWPOLYLINE' && v) v.bulge = f; else if (type === 'VERTEX') e.bulge = f; else e.sy = f; break;
        case 50: e.a0 = f; break;
        case 51: e.a1 = f; break;
        case 70: e.flags = parseInt(val, 10); break;
        default: break;
      }
      i++;
    }
    if (type === 'LINE' && e.p && e.q) return { type, layer: e.layer, vertices: [e.p, e.q] };
    if (type === 'LWPOLYLINE') return { type, layer: e.layer, vertices: verts, shape: !!(e.flags & 1) };
    if (type === 'ARC') return { type, layer: e.layer, center: e.p, radius: e.r, startAngle: (e.a0 || 0) * Math.PI / 180, endAngle: (e.a1 || 0) * Math.PI / 180 };
    if (type === 'CIRCLE') return { type, layer: e.layer, center: e.p, radius: e.r };
    if (type === 'INSERT') return { type, layer: e.layer, name: e.name, position: e.p || { x: 0, y: 0 }, xScale: e.sx || 1, yScale: e.sy || e.sx || 1, rotation: e.a0 || 0 };
    if (type === 'POLYLINE') return { type, layer: e.layer, vertices: [], shape: !!(e.flags & 1) };
    if (type === 'VERTEX') return { type, x: e.p ? e.p.x : 0, y: e.p ? e.p.y : 0, bulge: e.bulge || 0 };
    return null;
  }
  while (i < pairs.length) {
    const [c, val] = pairs[i];
    if (c === 0 && val === 'SECTION') { section = pairs[i + 1] && pairs[i + 1][1]; i += 2; continue; }
    if (c === 0 && val === 'ENDSEC') { section = null; i++; continue; }
    if (section === 'HEADER') {
      if (c === 9 && val === '$INSUNITS' && pairs[i + 1]) { out.header.$INSUNITS = parseInt(pairs[i + 1][1], 10); i += 2; continue; }
      i++; continue;
    }
    if (section === 'BLOCKS' && c === 0 && val === 'BLOCK') {
      block = { name: '', position: { x: 0, y: 0 }, entities: [] };
      i++;
      while (i < pairs.length && pairs[i][0] !== 0) {
        if (pairs[i][0] === 2) block.name = pairs[i][1];
        if (pairs[i][0] === 10) block.position.x = parseFloat(pairs[i][1]);
        if (pairs[i][0] === 20) block.position.y = parseFloat(pairs[i][1]);
        i++;
      }
      continue;
    }
    if (section === 'BLOCKS' && c === 0 && val === 'ENDBLK') { if (block) out.blocks[block.name] = block; block = null; i++; continue; }
    if ((section === 'ENTITIES' || (section === 'BLOCKS' && block)) && c === 0) {
      const target = section === 'ENTITIES' ? out.entities : block.entities;
      if (val === 'SEQEND') { poly = null; i++; continue; }
      const e = readEntity(val);
      if (!e) continue;
      if (e.type === 'POLYLINE') { poly = e; target.push(e); }
      else if (e.type === 'VERTEX') { if (poly) poly.vertices.push({ x: e.x, y: e.y, bulge: e.bulge }); }
      else target.push(e);
      continue;
    }
    i++;
  }
  return out;
}
// Flat straight segments in drawing units (curves flattened).
function flattenDxf(dxf) {
  const segs = [];
  const mul = (A, B) => [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
  const ap = (M, p) => ({ x: M[0] * p.x + M[2] * p.y + M[4], y: M[1] * p.x + M[3] * p.y + M[5] });
  const push = (M, a, b, layer, curve) => { const p = ap(M, a), q = ap(M, b); if (isFinite(p.x + p.y + q.x + q.y)) segs.push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y, layer, curve }); };
  function arcPts(cx, cy, r, a0, a1) {
    let sweep = a1 - a0; while (sweep <= 0) sweep += Math.PI * 2;
    const n = Math.max(6, Math.ceil(sweep / (Math.PI / 24))), pts = [];
    for (let k = 0; k <= n; k++) { const a = a0 + sweep * k / n; pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }); }
    return pts;
  }
  function bulgePts(p, q, b) {
    const th = 4 * Math.atan(b), d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < 1e-9) return [p, q];
    const r = d / (2 * Math.sin(th / 2)), mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
    const h = r * Math.cos(th / 2), nx = -(q.y - p.y) / d, ny = (q.x - p.x) / d, cx = mx + nx * h, cy = my + ny * h;
    const a0 = Math.atan2(p.y - cy, p.x - cx), a1 = Math.atan2(q.y - cy, q.x - cx);
    const pts = [], n = Math.max(4, Math.ceil(Math.abs(th) / (Math.PI / 24)));
    let sweep = a1 - a0;
    if (th > 0) { while (sweep <= 0) sweep += 2 * Math.PI; } else { while (sweep >= 0) sweep -= 2 * Math.PI; }
    for (let k = 0; k <= n; k++) { const a = a0 + sweep * k / n; pts.push({ x: cx + Math.abs(r) * Math.cos(a), y: cy + Math.abs(r) * Math.sin(a) }); }
    return pts;
  }
  function walk(ents, M, inheritLayer, depth) {
    if (!ents || depth > 6) return;
    for (const e of ents) {
      const layer = (e.layer === '0' || !e.layer) && inheritLayer ? inheritLayer : (e.layer || '0');
      if (segs.length > 400000) return;
      if (e.type === 'LINE' && e.vertices && e.vertices.length >= 2) push(M, e.vertices[0], e.vertices[1], layer, false);
      else if ((e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && e.vertices) {
        const v = e.vertices, n = v.length, closed = !!e.shape;
        for (let k = 0; k < (closed ? n : n - 1); k++) {
          const p = v[k], q = v[(k + 1) % n];
          if (p.bulge) { const pts = bulgePts(p, q, p.bulge); for (let m = 0; m + 1 < pts.length; m++) push(M, pts[m], pts[m + 1], layer, true); }
          else push(M, p, q, layer, false);
        }
      } else if ((e.type === 'ARC' || e.type === 'CIRCLE') && e.center && e.radius) {
        const pts = e.type === 'CIRCLE' ? arcPts(e.center.x, e.center.y, e.radius, 0, Math.PI * 2) : arcPts(e.center.x, e.center.y, e.radius, e.startAngle || 0, e.endAngle || 0);
        for (let m = 0; m + 1 < pts.length; m++) push(M, pts[m], pts[m + 1], layer, true);
      } else if (e.type === 'INSERT' && dxf.blocks && dxf.blocks[e.name]) {
        const b = dxf.blocks[e.name], pos = e.position || { x: 0, y: 0 }, base = b.position || { x: 0, y: 0 };
        const rot = (e.rotation || 0) * Math.PI / 180, sx = e.xScale || 1, sy = e.yScale || 1, c = Math.cos(rot), s = Math.sin(rot);
        walk(b.entities, mul(M, mul([c * sx, s * sx, -s * sy, c * sy, pos.x, pos.y], [1, 0, 0, 1, -base.x, -base.y])), layer, depth + 1);
      }
    }
  }
  walk(dxf.entities, [1, 0, 0, 1, 0, 0], null, 0);
  return segs;
}
function robustExtent(vals) {
  const s = vals.slice().sort((a, b) => a - b), n = s.length;
  const lo = s[0], hi = s[n - 1], p1 = s[Math.floor(n * 0.005)], p99 = s[Math.min(n - 1, Math.floor(n * 0.995))];
  if (hi - lo > 6 * (p99 - p1) && p99 > p1) { const pad = (p99 - p1) * 0.08; return [p1 - pad, p99 + pad]; }
  return [lo, hi];
}
async function importDxf(file) {
  loading(true, 'Opening DXF', 'Reading the drawing…');
  const text = await file.text();
  let parsed = null;
  const Ctor = await getDxfParserCtor();
  if (Ctor) { try { parsed = new Ctor().parseSync(text); } catch (e) { parsed = null; } }
  if (!parsed) parsed = miniDxfParse(text);
  const segs = flattenDxf(parsed);
  if (!segs.length) throw new Error('We could not find any lines in this DXF. Check that it is a 2D floor plan.');
  const xs = [], ys = [];
  for (const s of segs) { xs.push(s.x1, s.x2); ys.push(s.y1, s.y2); }
  const [minX, maxX] = robustExtent(xs), [minY, maxY] = robustExtent(ys);
  const wU = Math.max(1e-6, maxX - minX), hU = Math.max(1e-6, maxY - minY);
  const unitM = INSUNITS_M[parsed.header && parsed.header.$INSUNITS] || null;
  // aim for about 2.4 cm per pixel when the unit is known (walls 8-12 px thick), else a 3000 px sheet
  const pad = 60;
  let k = (3000 - 2 * pad) / Math.max(wU, hU);
  if (unitM) k = clamp(unitM / 0.024, 400 / Math.max(wU, hU), 3400 / Math.max(wU, hU));
  const W = Math.round(wU * k + 2 * pad), H = Math.round(hU * k + 2 * pad);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#1F2430'; g.lineWidth = 1.3; g.lineCap = 'round';
  g.beginPath();
  for (const s of segs) { g.moveTo((s.x1 - minX) * k + pad, (maxY - s.y1) * k + pad); g.lineTo((s.x2 - minX) * k + pad, (maxY - s.y2) * k + pad); }
  g.stroke();
  const blob = await canvasToBlob(c, 'image/png');
  const img = await blobToImage(blob);
  return { blob, img, w: W, h: H, src: { kind: 'dxf', name: file.name }, words: null, note: null, ptPerPx: null, unitMPerPx: unitM ? unitM / k : null };
}

/* ---------- project files (JSON) ---------- */
function floorToJSON(f) {
  const o = clone(Object.assign({}, f, { an: null }));
  if (f.an) o.an = Object.assign({}, f.an, { wall: { w: f.an.wall.w, h: f.an.wall.h, b64: u8ToB64(f.an.wall.data) }, area: { w: f.an.area.w, h: f.an.area.h, b64: u8ToB64(f.an.area.data) } });
  return o;
}
function floorFromJSON(o) {
  if (o.an && o.an.wall && o.an.wall.b64) { o.an.wall.data = b64ToU8(o.an.wall.b64); delete o.an.wall.b64; o.an.area.data = b64ToU8(o.an.area.b64); delete o.an.area.b64; }
  return o;
}
async function projectToFile(p, images) {
  const imgs = {};
  for (const f of p.floors) { const b = images.get(f.id); if (b && b.blob) imgs[f.id] = await blobToDataURL(b.blob); }
  const proj = Object.assign({}, p, { floors: p.floors.map(floorToJSON) });
  return new Blob([JSON.stringify({ format: 'daftarbox-wifi', version: 2, project: proj, images: imgs })], { type: 'application/json' });
}
async function projectFromFile(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { throw new Error('This file is not a valid project file.'); }
  if (!data || data.format !== 'daftarbox-wifi' || !data.project || !Array.isArray(data.project.floors)) throw new Error('This JSON file is not a Wi-Fi plan from this tool.');
  if ((data.version || 1) < 2) throw new Error('This project was saved by an older version of the tool. Please upload the floor plan again.');
  const p = data.project;
  p.id = uid(); p.updated = Date.now();
  p.floors = p.floors.map(floorFromJSON);
  const imgs = new Map();
  for (const f of p.floors) {
    const u = data.images && data.images[f.id];
    if (u) { const blob = dataURLToBlob(u); imgs.set(f.id, { blob, img: await blobToImage(blob) }); }
  }
  return { project: p, images: imgs };
}

/* ---------- sample office ----------
   A made-up plan drawn the way architects draw: double-line brick walls, RCC columns, doors, labels and
   millimetre dimension chains with ticks. It goes through the same automatic pipeline as an upload.
   Pure data so Node tests can rasterise it too. 1 px = 25 mm. */
function samplePlan() {
  const S = 0.025, W = 1700, H = 1400, ox = 300, oy = 260;     // building origin (outer face) in px
  const mm = v => v / 1000 / S;
  const T = mm(230);                                          // 230 mm brick wall
  const prims = [], words = [];
  const BW = 22000, BH = 17000;                               // outer faces 22.0 m x 17.0 m
  // wall: rectangle band between outer faces (x,y,w,h in mm, origin = building outer corner)
  const wall = (x, y, w, h) => prims.push({ t: 'band', x: ox + mm(x), y: oy + mm(y), w: mm(w), h: mm(h) });
  // outer walls with door openings (gaps)
  wall(0, 0, BW, 230); wall(0, BH - 230, 9000, 230); wall(10200, BH - 230, BW - 10200, 230);
  wall(0, 0, 230, BH); wall(BW - 230, 0, 230, BH);
  // inner walls
  wall(8000, 230, 230, 5200); wall(8000, 6400, 230, 2600);              // reception / cabins line
  wall(230, 6000, 7770, 230);                                           // reception bottom
  wall(14000, 230, 230, 4300); wall(14000, 5500, 230, 3500);            // cabins
  wall(14230, 4500, 7540, 230);
  wall(230, 11000, 6800, 230); wall(8000, 11000, 13770, 230);           // south rooms line
  wall(5000, 11230, 230, 5540); wall(12000, 11230, 230, 5540); wall(16500, 11230, 230, 5540);
  wall(8000, 9000, 6230, 230);                                          // meeting room
  // columns 450 x 450 at a 5.5 m grid on the outer walls
  [0, 5500, 11000, 16550, 21550].forEach(x => [0, 8300, 16550].forEach(y => prims.push({ t: 'rect', x: ox + mm(x), y: oy + mm(y), w: mm(450), h: mm(450) })));
  // doors (swing arcs)
  [[8000, 5600, 0], [14000, 4700, 0], [3000, 6000, 1], [9500, 11000, 1], [6000, 11000, 1], [13500, 11000, 1], [18000, 11000, 1]].forEach(d =>
    prims.push({ t: 'arc', x: ox + mm(d[0]), y: oy + mm(d[1]), r: mm(800), vertical: !d[2] }));
  // labels
  [['RECEPTION', 4000, 3000], ['CABIN 1', 11000, 2500], ['CABIN 2', 18000, 2200], ['OPEN OFFICE', 15000, 8000], ['MEETING', 11000, 10000],
    ['PANTRY', 2500, 13500], ['SERVER', 8500, 14000], ['STORE', 14200, 14000], ['WASHROOM', 19200, 14000], ['LOUNGE', 3500, 8500]]
    .forEach(l => prims.push({ t: 'text', s: l[0], x: ox + mm(l[1]), y: oy + mm(l[2]), size: 15 }));
  // dimension chains: horizontal above, vertical on the left, overall dims outside them
  function hchain(y, xs) {
    const yy = oy - y;
    prims.push({ t: 'line', x1: ox + mm(xs[0]), y1: yy, x2: ox + mm(xs[xs.length - 1]), y2: yy, w: 1 });
    xs.forEach(x => { prims.push({ t: 'line', x1: ox + mm(x) - 4, y1: yy + 4, x2: ox + mm(x) + 4, y2: yy - 4, w: 1.6 }); prims.push({ t: 'line', x1: ox + mm(x), y1: yy + 10, x2: ox + mm(x), y2: oy - 8, w: 0.5, light: true }); });
    for (let i = 0; i + 1 < xs.length; i++) {
      const v = String(xs[i + 1] - xs[i]), cx = ox + mm((xs[i] + xs[i + 1]) / 2), tw = v.length * 8;
      prims.push({ t: 'text', s: v, x: cx, y: yy - 6, size: 13 });
      words.push({ text: v, x0: Math.round(cx - tw / 2), x1: Math.round(cx + tw / 2), y0: Math.round(yy - 17), y1: Math.round(yy - 6), vertical: false, conf: 99 });
    }
  }
  function vchain(x, ys) {
    const xx = ox - x;
    prims.push({ t: 'line', x1: xx, y1: oy + mm(ys[0]), x2: xx, y2: oy + mm(ys[ys.length - 1]), w: 1 });
    ys.forEach(y => { prims.push({ t: 'line', x1: xx - 4, y1: oy + mm(y) + 4, x2: xx + 4, y2: oy + mm(y) - 4, w: 1.6 }); prims.push({ t: 'line', x1: xx + 10, y1: oy + mm(y), x2: ox - 8, y2: oy + mm(y), w: 0.5, light: true }); });
    for (let i = 0; i + 1 < ys.length; i++) {
      const v = String(ys[i + 1] - ys[i]), cy = oy + mm((ys[i] + ys[i + 1]) / 2), tw = v.length * 8;
      prims.push({ t: 'text', s: v, x: xx - 6, y: cy, size: 13, rot: -90 });
      words.push({ text: v, x0: Math.round(xx - 17), x1: Math.round(xx - 6), y0: Math.round(cy - tw / 2), y1: Math.round(cy + tw / 2), vertical: true, conf: 99 });
    }
  }
  hchain(60, [0, 5500, 8000, 11000, 14000, 16550, 22000]);
  hchain(110, [0, 22000]);
  vchain(60, [0, 6000, 8300, 11000, 17000]);
  vchain(110, [0, 17000]);
  prims.push({ t: 'text', s: 'SAMPLE OFFICE · GROUND FLOOR PLAN', x: ox + mm(11000), y: oy + mm(17000) + 90, size: 18 });
  return { W, H, mPerPx: S, prims, words, box: { x: ox, y: oy, w: mm(BW), h: mm(BH) } };
}
async function makeSampleSource() {
  const sp = samplePlan();
  const c = document.createElement('canvas'); c.width = sp.W; c.height = sp.H;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, sp.W, sp.H);
  g.strokeStyle = '#1F2430'; g.fillStyle = '#1F2430'; g.lineCap = 'butt';
  for (const p of sp.prims) {
    if (p.t === 'band') { g.lineWidth = 1.4; g.strokeRect(p.x + 0.7, p.y + 0.7, Math.max(0, p.w - 1.4), Math.max(0, p.h - 1.4)); }
    else if (p.t === 'rect') { g.fillRect(p.x, p.y, p.w, p.h); }
    else if (p.t === 'line') { g.strokeStyle = p.light ? '#C9CDD4' : '#1F2430'; g.lineWidth = p.w; g.beginPath(); g.moveTo(p.x1, p.y1); g.lineTo(p.x2, p.y2); g.stroke(); g.strokeStyle = '#1F2430'; }
    else if (p.t === 'arc') { g.lineWidth = 1; g.beginPath(); if (p.vertical) g.arc(p.x, p.y, p.r, -Math.PI / 2, 0); else g.arc(p.x, p.y, p.r, 0, Math.PI / 2); g.stroke(); }
    else if (p.t === 'text') {
      g.save(); g.translate(p.x, p.y); if (p.rot) g.rotate(p.rot * Math.PI / 180);
      g.font = `600 ${p.size}px Archivo, Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = p.rot ? 'bottom' : (p.size <= 13 ? 'bottom' : 'middle');
      g.fillText(p.s, 0, 0); g.restore();
    }
  }
  const blob = await canvasToBlob(c, 'image/png');
  const img = await blobToImage(blob);
  return { blob, img, w: sp.W, h: sp.H, src: { kind: 'sample', name: 'Sample office' }, words: sp.words, note: null, ptPerPx: null, unitMPerPx: null };
}
