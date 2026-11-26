/* Daftarbox Video Studio: multi-track, frame-accurate video editor. Everything runs in the browser; nothing is uploaded. */
"use strict";
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[c]));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const uid = () => Math.random().toString(36).slice(2, 9);
const AC = window.AudioContext || window.webkitAudioContext;
const ICON = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const IC = {
  undo:ICON('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  redo:ICON('<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>'),
  play:ICON('<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>'),
  pause:ICON('<rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor"/><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor"/>'),
  start:ICON('<path d="M6 5v14"/><path d="M18 5 9 12l9 7z"/>'),
  end:ICON('<path d="M18 5v14"/><path d="M6 5l9 7-9 7z"/>'),
  prevf:ICON('<path d="M15 6l-6 6 6 6"/>'),
  nextf:ICON('<path d="M9 6l6 6-6 6"/>'),
  back1s:ICON('<path d="M11 6l-6 6 6 6"/><path d="M19 6l-6 6 6 6"/>'),
  fwd1s:ICON('<path d="M5 6l6 6-6 6"/><path d="M13 6l6 6-6 6"/>'),
  prevedit:ICON('<path d="M5 5v14"/><path d="M19 6l-6 6 6 6"/><path d="M13 12H7"/>'),
  nextedit:ICON('<path d="M19 5v14"/><path d="M5 6l6 6-6 6"/><path d="M11 12h6"/>'),
  snap:ICON('<path d="M6 3v7a6 6 0 0 0 12 0V3"/><path d="M6 7h4M14 7h4"/>'),
  "tool-select":ICON('<path d="M5 3l14 8-6 1.5L10 19z"/>'),
  "tool-razor":ICON('<circle cx="6" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M8.2 7.8 20 18M8.2 16.2 20 6"/>'),
  "tool-ripple":ICON('<path d="M4 6v12M4 12h7M8 9l3 3-3 3"/><rect x="13" y="7" width="7" height="10" rx="1"/>'),
  "tool-slip":ICON('<rect x="3" y="7" width="18" height="10" rx="1"/><path d="M9 12h6M9 12l2-2M9 12l2 2M15 12l-2-2M15 12l-2 2"/>'),
  "tool-fwd":ICON('<path d="M5 5v14"/><rect x="8" y="7" width="5" height="10" rx="1"/><rect x="15" y="7" width="5" height="10" rx="1"/><path d="M8 4h12"/><path d="M17 2l3 2-3 2"/>'),
  split:ICON('<path d="M12 3v18"/><path d="M4 7h5v10H4zM15 7h5v10h-5z"/>'),
  del:ICON('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  ripple:ICON('<path d="M3 8h6v8H3zM15 8h6v8h-6z"/><path d="M11 12h2M13 10l-2 2 2 2"/>'),
  dup:ICON('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>'),
  addtext:ICON('<path d="M5 6V4h14v2M12 4v16M9 20h6"/>'),
  marker:ICON('<path d="M6 3h12v12l-6 6-6-6z"/>'),
  adj:ICON('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 15l3-4 3 3 2-2 2 3"/><circle cx="16" cy="9" r="1.3"/><path d="M3 9h3M18 19v2M6 19v2"/>'),
  zin:ICON('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4M8 11h6M11 8v6"/>'),
  zout:ICON('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4M8 11h6"/>'),
  eye:ICON('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeoff:ICON('<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.9M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/>'),
  vol:ICON('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6"/>'),
  mute:ICON('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/>'),
  lock:ICON('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  unlock:ICON('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>'),
  x:ICON('<path d="M6 6l12 12M18 6 6 18"/>')
};

/* ---------- Time ---------- */
let FPS = 30;
const fq = t => Math.round(t * FPS) / FPS;
const tc = t => { const f = Math.round(Math.max(0, t) * FPS), fr = f % FPS, s = Math.floor(f / FPS); const p = n => String(n).padStart(2, "0"); return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}:${p(fr)}`; };
const short = t => { const m = Math.floor(t / 60), s = Math.round((t - m * 60) * 10) / 10; return m + ":" + (s < 10 ? "0" : "") + (Number.isInteger(s) ? s : s.toFixed(1)); };
function parseTC(str) {
  const p = String(str).trim().split(":").map(Number); if (!p.length || p.some(isNaN)) return NaN;
  if (p.length === 4) return p[0] * 3600 + p[1] * 60 + p[2] + p[3] / FPS;
  return p.reduce((s, x) => s * 60 + x, 0);
}

/* ---------- Project state ----------
   tracks: display order top to bottom. Video tracks composite bottom-up (V1 under V2).
   clips:  {id, m, tr, start, a, b, speed, vol, op, sc, x, y}   start = timeline seconds, a/b = source in/out
   texts:  {id, text, s, e, x, y, size, color, bg, bold, font} on the text track */
const media = new Map();
let tracks = [{id:"V2", kind:"v", hide:false, mute:false, lock:false}, {id:"V1", kind:"v", hide:false, mute:false, lock:false}, {id:"A1", kind:"a", hide:false, mute:false, lock:false}, {id:"A2", kind:"a", hide:false, mute:false, lock:false}];
let clips = [], texts = [], textTrack = {hide:false, lock:false}, markers = [];
let sel = null, T = 0, playing = false, snapOn = true, pps = 40, tool = "select";
const undoS = [], redoS = [];

const len = c => (c.b - c.a) / c.speed;
const endOf = c => c.start + len(c);
const total = () => Math.max(0, ...clips.map(endOf), ...texts.map(x => x.e));
const trk = id => tracks.find(t => t.id === id);
const localAt = (c, t) => clamp(c.a + (t - c.start) * c.speed, c.a, c.b);
const activeAt = t => clips.filter(c => t >= c.start - 1e-4 && t < endOf(c) - 1e-4);
const snapshot = () => JSON.stringify({tracks, clips, texts, textTrack, markers, master});
function commit() { undoS.push(snapshot()); if (undoS.length > 200) undoS.shift(); redoS.length = 0; syncUndo(); }
function pushSnap(s) { if (s !== snapshot()) { undoS.push(s); redoS.length = 0; syncUndo(); } }
function restore(s) { const o = JSON.parse(s); ({tracks, clips, texts, textTrack} = o); markers = o.markers || []; if (o.master) master = o.master; if (pvMix) pvMix.update(); if (sel && !findSel()) sel = null; refresh(); }
function undo() { if (!undoS.length) return; redoS.push(snapshot()); restore(undoS.pop()); syncUndo(); }
function redo() { if (!redoS.length) return; undoS.push(snapshot()); restore(redoS.pop()); syncUndo(); }
function syncUndo() { $('[data-act="undo"]').disabled = !undoS.length; $('[data-act="redo"]').disabled = !redoS.length; }
function findSel() { if (!sel) return null; if (sel.type === "track") return sel.id === "master" ? master : trk(sel.id) || null; return sel.type === "clip" ? clips.find(c => c.id === sel.id) : texts.find(x => x.id === sel.id); }
const overlaps = (c, tr = c.tr, st = c.start) => clips.some(o => o !== c && o.tr === tr && st < endOf(o) - 1e-6 && st + len(c) > o.start + 1e-6);

/* ---------- Frame size ---------- */
function outSize(maxShort = 1080) {
  const asp = $(".aspect").value;
  let w = 1280, h = 720;
  if (asp === "auto") { const c = clips.find(k => media.get(k.m).kind === "v"); if (c) { const m = media.get(c.m); w = m.w; h = m.h; } }
  else [w, h] = asp.split(":").map(Number);
  const k = maxShort / Math.min(w, h);
  return [Math.round(w * k / 2) * 2, Math.round(h * k / 2) * 2];
}

/* ---------- Media elements ----------
   Every clip gets its own media element so overlapping clips from the same file play independently. */
function makePool(holder) {
  const pool = new Map();
  return {
    pool,
    get(c) {
      let el = pool.get(c.id);
      const m = media.get(c.m);
      if (el && el._src === m.url) return el;
      if (m.kind === "i") { el = new Image(); el.src = m.url; el._src = m.url; pool.set(c.id, el); return el; }
      el = document.createElement(m.kind === "v" && trk(c.tr).kind === "v" ? "video" : "audio");
      el.preload = "auto"; el.playsInline = true; el.src = m.url; el._src = m.url;
      holder.appendChild(el); pool.set(c.id, el); return el;
    },
    prune() { for (const [id, el] of pool) if (!clips.some(c => c.id === id)) { kill(el); pool.delete(id); } },
    pauseAll() { pool.forEach(el => el.pause && el.pause()); },
    destroy() { pool.forEach(kill); pool.clear(); }
  };
}
const hiddenBox = () => { const d = document.createElement("div"); d.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;overflow:hidden;opacity:0;pointer-events:none"; document.body.appendChild(d); return d; };
const pv = makePool(hiddenBox());
function kill(el) { if (el.pause) { el.pause(); el.removeAttribute("src"); el.load(); } el.remove(); }
function seekEl(el, t) {
  if (el.tagName === "IMG") return el.complete ? Promise.resolve() : new Promise(r => { el.onload = el.onerror = r; });
  return new Promise(r => {
    const go = () => {
      if (Math.abs(el.currentTime - t) < 0.0005 && el.readyState >= 2) return r();
      const done = () => { el.removeEventListener("seeked", done); clearTimeout(tm); r(); };
      const tm = setTimeout(done, 3000);
      el.addEventListener("seeked", done); el.currentTime = t;
    };
    if (el.readyState >= 1) go(); else el.addEventListener("loadedmetadata", go, {once:true});
  });
}

/* ---------- Animation, colour, fades, transitions ---------- */
const ANIM = ["op", "sc", "x", "y", "rot", "vol"];
const ease = p => p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
function valAt(c, k, t) {
  const kf = c.kf && c.kf[k];
  if (!kf || !kf.length) return c[k] ?? (k === "rot" ? 0 : 0);
  const r = t - c.start;
  if (r <= kf[0].t) return kf[0].v;
  for (let i = 1; i < kf.length; i++) if (r <= kf[i].t) { const a = kf[i - 1], b = kf[i]; return a.v + (b.v - a.v) * ease((r - a.t) / (b.t - a.t || 1)); }
  return kf[kf.length - 1].v;
}
const fadeMul = (c, t) => { let m = 1; if (c.fi) m = Math.min(m, (t - c.start) / c.fi); if (c.fo) m = Math.min(m, (endOf(c) - t) / c.fo); return clamp(m, 0, 1); };
const PRESET = {none:"", bw:"grayscale(1)", sepia:"sepia(.85)", warm:"sepia(.25) saturate(1.25)", cool:"hue-rotate(-14deg) saturate(1.1) brightness(1.03)", vivid:"saturate(1.55) contrast(1.12)", fade:"contrast(.85) brightness(1.08) saturate(.75)", drama:"contrast(1.35) saturate(.85) brightness(.92)"};
function colorFilter(c, W) {
  const k = c.col; if (!k) return "";
  let f = PRESET[k.p] || "";
  if (k.b !== 1) f += ` brightness(${k.b})`; if (k.c !== 1) f += ` contrast(${k.c})`; if (k.s !== 1) f += ` saturate(${k.s})`;
  if (k.h) f += ` hue-rotate(${k.h}deg)`; if (k.bl) f += ` blur(${(k.bl * W / 1000).toFixed(2)}px)`;
  return f.trim();
}
const prevAdj = c => clips.find(o => o !== c && o.tr === c.tr && Math.abs(endOf(o) - c.start) < 1.01 / FPS);
/* Everything that must be on screen / audible at time t: the active clips plus the outgoing clip of any transition in progress. */
function entries(t) {
  const out = activeAt(t).map(c => ({c, local:localAt(c, t), mix:1}));
  for (const e of [...out]) {
    const c = e.c; if (!c.tin || !c.tin.type) continue;
    const d = c.tin.d, pr = (t - c.start) / d; if (pr >= 1) continue;
    e.pr = pr;
    const p = prevAdj(c); if (!p) continue;
    const m = media.get(p.m);
    out.push({c:p, local:m.kind === "i" ? 0 : Math.min(p.b + (t - c.start) * p.speed, m.dur - .04), tail:true, pr, mix:1 - pr});
  }
  return out;
}
const srcW = el => el.videoWidth || el.naturalWidth || 0, srcH = el => el.videoHeight || el.naturalHeight || 0;
const ready = el => el && srcW(el) && (el.tagName === "IMG" ? el.complete : el.readyState >= 2);
function drawClip(g, W, H, c, el, t, alpha = 1, dx = 0, sMul = 1) {
  if (c.mask && c.mask.on && !drawClip.inMask) { /* draw the clip on its own layer, then keep only the masked part */
    const L = maskLayer(W, H); L.g.clearRect(0, 0, W, H);
    drawClip.inMask = true; try { drawClip(L.g, W, H, c, el, t, alpha, dx, sMul); } finally { drawClip.inMask = false; }
    applyMask(L.g, W, H, c.mask); g.drawImage(L.c, 0, 0); return;
  }
  const sc = valAt(c, "sc", t) * sMul, op = valAt(c, "op", t) * fadeMul(c, t) * alpha, rot = valAt(c, "rot", t);
  if (op <= 0.001) return;
  /* crop is a source rectangle in fractions; fit is contain / cover / blur (contain over a blurred fill) */
  const cr = c.cr || {l:0, r:0, t:0, b:0}, sx = cr.l * srcW(el), sy = cr.t * srcH(el);
  const sw = Math.max(1, srcW(el) * (1 - cr.l - cr.r)), sh = Math.max(1, srcH(el) * (1 - cr.t - cr.b));
  const qt = ((c.qt || 0) % 2) === 1, bw = qt ? sh : sw, bh = qt ? sw : sh; /* quarter turns swap width and height */
  const fit = c.fit || "contain", base = fit === "cover" ? Math.max(W / bw, H / bh) : Math.min(W / bw, H / bh);
  const k = base * sc, w = sw * k, h = sh * k;
  g.save(); g.globalAlpha = clamp(op, 0, 1);
  const f = colorFilter(c, W);
  if (fit === "blur") {
    const kb = Math.max(W / bw, H / bh); g.save(); g.filter = `blur(${Math.round(W / 40)}px) brightness(.8) ${f}`.trim();
    g.translate(W / 2, H / 2); g.rotate((c.qt || 0) * Math.PI / 2); g.drawImage(el, sx, sy, sw, sh, -sw * kb / 2 * 1.08, -sh * kb / 2 * 1.08, sw * kb * 1.08, sh * kb * 1.08); g.restore();
  }
  if (f) g.filter = f;
  g.translate(W / 2 + valAt(c, "x", t) * W + dx, H / 2 + valAt(c, "y", t) * H);
  g.rotate((rot + (c.qt || 0) * 90) * Math.PI / 180);
  if (c.fh || c.fv) g.scale(c.fh ? -1 : 1, c.fv ? -1 : 1);
  /* clip effects run on the GPU (fx.js) and come back as a canvas of exactly the drawn size */
  const gu = !noFx && !noGrade ? gradeU(c) : null;
  const fxc = !noFx && ((c.fx && c.fx.length) || gu) && window.FX ? FX.render(el, srcW(el), srcH(el), sx, sy, sw, sh, Math.abs(w), Math.abs(h), noFx ? [] : c.fx, t, H / 1080, gu) : null;
  const put = () => fxc ? g.drawImage(fxc, 0, 0, fxc.width, fxc.height, -w / 2, -h / 2, w, h) : g.drawImage(el, sx, sy, sw, sh, -w / 2, -h / 2, w, h);
  const rr = (c.rad || 0) * Math.min(w, h) / 2, bd = (c.bd || 0) * W;
  if (rr || bd) { g.save(); g.beginPath(); g.roundRect ? g.roundRect(-w / 2, -h / 2, w, h, rr) : g.rect(-w / 2, -h / 2, w, h); g.clip(); put(); g.restore();
    if (bd) { g.filter = "none"; g.lineWidth = bd; g.strokeStyle = c.bdc || "#ffffff"; g.beginPath(); g.roundRect ? g.roundRect(-w / 2, -h / 2, w, h, rr) : g.rect(-w / 2, -h / 2, w, h); g.stroke(); } }
  else put();
  g.restore();
}
let noFx = false; /* true while the green-screen colour picker samples the untouched picture */
let noGrade = false, beforeAfter = false; /* before/after view on the monitor only */

/* ---------- Colour grading model ----------
   c.gr = {exp, con, hi, sh, sat, vib, temp, tnt, hue, lift:{x,y,l}, gam:{x,y,l}, gain:{x,y,l}, lut, lamt}
   Wheels: x,y inside the unit circle pick a hue and strength; l is the brightness slider under the wheel. */
const luts = new Map(); /* id -> {name, n, rgb}; kept outside undo history like media */
const defGrade = () => ({exp:0, con:0, hi:0, sh:0, sat:1, vib:0, temp:0, tnt:0, hue:0, lift:{x:0, y:0, l:0}, gam:{x:0, y:0, l:0}, gain:{x:0, y:0, l:0}, lut:"", lamt:1});
function hueRGB(deg) { /* same hues as the drawn wheels: HSL with full saturation, 50% lightness */
  const h = ((deg % 360) + 360) % 360 / 60, x = 1 - Math.abs(h % 2 - 1);
  const [r, g2, b] = h < 1 ? [1, x, 0] : h < 2 ? [x, 1, 0] : h < 3 ? [0, 1, x] : h < 4 ? [0, x, 1] : h < 5 ? [x, 0, 1] : [1, 0, x];
  return [r, g2, b];
}
function wheelVec(wv, kScale, lScale, base) {
  const rad = Math.min(1, Math.hypot(wv.x, wv.y)), deg = Math.atan2(wv.y, wv.x) * 180 / Math.PI;
  const c = hueRGB(deg), l = .299 * c[0] + .587 * c[1] + .114 * c[2];
  return c.map(ch => base + (ch - l) * rad * kScale + (wv.l || 0) * lScale);
}
const gradeIsDefault = gr => !gr || JSON.stringify({...defGrade(), ...gr, lut:gr.lut || ""}) === JSON.stringify(defGrade());
function gradeU(c) {
  const gr = c.gr; if (gradeIsDefault(gr)) return null;
  return {exp:gr.exp, con:gr.con, hi:gr.hi, sh:gr.sh, sat:gr.sat, vib:gr.vib, temp:gr.temp, tnt:gr.tnt, hue:gr.hue,
    lift:wheelVec(gr.lift, .3, .25, 0), gam:wheelVec(gr.gam, .5, .45, 1), gain:wheelVec(gr.gain, .6, .5, 1),
    lut:gr.lut && luts.has(gr.lut) ? gr.lut : null, lamt:gr.lamt};
}
const hueXY = (deg, r) => ({x:Math.cos(deg * Math.PI / 180) * r, y:Math.sin(deg * Math.PI / 180) * r});
const LOOKS = {
  natural:{name:"Original", g:{}},
  tealorange:{name:"Teal & orange", g:{con:.12, sat:1.1, lift:{...hueXY(185, .45), l:0}, gain:{...hueXY(30, .35), l:0}}},
  warm:{name:"Warm film", g:{temp:.55, sat:1.05, con:.05, gain:{...hueXY(40, .2), l:0}}},
  cool:{name:"Cool night", g:{temp:-.55, exp:-.15, sat:.9, gain:{...hueXY(215, .25), l:0}}},
  moody:{name:"Moody", g:{exp:-.2, con:.25, sat:.75, sh:-.15, lift:{...hueXY(190, .3), l:0}}},
  bleach:{name:"Bleach bypass", g:{sat:.45, con:.35, hi:.1}},
  vintage:{name:"Vintage fade", g:{sat:.8, con:-.12, lift:{...hueXY(40, .2), l:.12}, gain:{...hueXY(50, .2), l:-.05}}},
  vivid:{name:"Vivid pop", g:{sat:1.3, vib:.4, con:.15}},
  bwfilm:{name:"Black & white film", g:{sat:0, con:.3, hi:.05}}
};
function lookOf(gr) { if (gradeIsDefault(gr)) return "natural"; for (const [k, L] of Object.entries(LOOKS)) if (k !== "natural" && JSON.stringify({...defGrade(), ...L.g}) === JSON.stringify({...defGrade(), ...gr, lut:"", lamt:1})) return k; return ""; }
function gradeSection(o) {
  const gr = {...defGrade(), ...(o.gr || {})}, sl = (k, l, min, max, st, fmt) => rng("gr." + k, l, min, max, st, gr[k], fmt);
  const sgn = v => (v > 0 ? "+" : "") + Math.round(v * 100);
  const lk = lookOf(o.gr);
  const wheel = (k, l) => `<div class="wh"><canvas class="wheel" data-w="${k}" width="132" height="132" aria-label="${l} colour wheel: drag to tint, double-click to reset"></canvas><span>${l}</span>
    <input type="range" min="-1" max="1" step="0.01" value="${gr[k].l}" data-k="gr.${k}.l" aria-label="${l} brightness" title="${l} brightness"></div>`;
  return `<div class="sec grsec"><b>Colour grading${gradeIsDefault(o.gr) ? "" : " ●"}</b>
    <div class="f"><label>Look</label><select data-grlook>${lk ? "" : `<option value="" selected>Custom</option>`}${Object.entries(LOOKS).map(([k, L]) => `<option value="${k}"${k === lk ? " selected" : ""}>${L.name}</option>`).join("")}</select></div>
    <div class="wheels">${wheel("lift", "Lift (shadows)")}${wheel("gam", "Gamma (mids)")}${wheel("gain", "Gain (highlights)")}</div>
    <p class="empty-note" style="font-size:.72rem;margin:2px 0 10px">Drag inside a wheel to tint that range; double-click it to reset. The slider under it makes that range darker or brighter.</p>
    ${sl("exp", "Exposure", -2, 2, .05, v => (v > 0 ? "+" : "") + (+v).toFixed(2) + " EV")}${sl("con", "Contrast", -1, 1, .01, sgn)}${sl("hi", "Highlights", -1, 1, .01, sgn)}${sl("sh", "Shadows", -1, 1, .01, sgn)}
    ${sl("sat", "Saturation", 0, 2, .01, pct)}${sl("vib", "Vibrance", -1, 1, .01, sgn)}${sl("temp", "Temperature", -1, 1, .01, v => v > .005 ? "warmer " + Math.round(v * 100) : v < -.005 ? "cooler " + Math.round(-v * 100) : "0")}
    ${sl("tnt", "Tint", -1, 1, .01, v => v > .005 ? "magenta " + Math.round(v * 100) : v < -.005 ? "green " + Math.round(-v * 100) : "0")}${sl("hue", "Hue shift", -180, 180, 1, v => Math.round(v) + "°")}
    <div class="f"><label>LUT (.cube file)</label><div style="display:flex;gap:6px"><select data-k="gr.lut" style="flex:1"><option value="">None</option>${[...luts].map(([id, L]) => `<option value="${id}"${gr.lut === id ? " selected" : ""}>${esc(L.name)}</option>`).join("")}</select><button class="btn ghost small" data-act="lutimport">Import…</button></div></div>
    ${gr.lut ? sl("lamt", "LUT strength", 0, 1, .01, pct) : ""}
    <div class="row2" style="margin-top:4px"><button class="btn ghost small" data-act="gcopy">Copy grade</button><button class="btn ghost small" data-act="gpaste"${gradeClip ? "" : " disabled"}>Paste grade</button></div>
    <div class="row2" style="margin-top:6px"><button class="btn ghost small" data-act="gall">Apply to all clips</button><button class="btn ghost small" data-act="greset">Reset grade</button></div>
    ${o.col && (o.col.p !== "none" || o.col.b !== 1 || o.col.c !== 1 || o.col.s !== 1 || o.col.h || o.col.bl) ? `<button class="btn ghost small wide" data-act="resetcol" style="margin-top:6px">Remove old quick colour settings</button>` : ""}
  </div>`;
}
function drawWheels() {
  const o = findSel(); if (!o || !o.gr && !$(".wheel")) return;
  const gr = {...defGrade(), ...((o && o.gr) || {})};
  $$(".wheel").forEach(cvw => {
    const w = cvw.width, R = w / 2 - 4, gg = cvw.getContext("2d");
    if (!cvw._bg) {
      const img = gg.createImageData(w, w);
      for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
        const dx = x - w / 2, dy = w / 2 - y, d = Math.hypot(dx, dy) / R, i = (y * w + x) * 4;
        if (d > 1) { img.data[i + 3] = 0; continue; }
        const c = hueRGB(Math.atan2(dy, dx) * 180 / Math.PI), s = Math.min(1, d) * .85;
        img.data[i] = (c[0] * s + (1 - s) * .5) * 255; img.data[i + 1] = (c[1] * s + (1 - s) * .5) * 255; img.data[i + 2] = (c[2] * s + (1 - s) * .5) * 255; img.data[i + 3] = 255;
      }
      cvw._bg = img;
    }
    gg.putImageData(cvw._bg, 0, 0);
    const v = gr[cvw.dataset.w], px = w / 2 + v.x * R, py = w / 2 - v.y * R;
    gg.strokeStyle = "rgba(0,0,0,.35)"; gg.beginPath(); gg.moveTo(w / 2 - 6, w / 2); gg.lineTo(w / 2 + 6, w / 2); gg.moveTo(w / 2, w / 2 - 6); gg.lineTo(w / 2, w / 2 + 6); gg.stroke();
    gg.lineWidth = 2; gg.strokeStyle = "#fff"; gg.fillStyle = "rgba(0,0,0,.4)"; gg.beginPath(); gg.arc(px, py, 6, 0, Math.PI * 2); gg.fill(); gg.stroke();
  });
}
let gradeClip = null;
function wheelAt(cvw, e) {
  const r = cvw.getBoundingClientRect(), R = r.width / 2 - 4 * r.width / cvw.width;
  let x = (e.clientX - r.left - r.width / 2) / R, y = -(e.clientY - r.top - r.height / 2) / R; const d = Math.hypot(x, y); if (d > 1) { x /= d; y /= d; }
  return {x:Math.round(x * 1000) / 1000, y:Math.round(y * 1000) / 1000};
}
document.addEventListener("pointerdown", e => {
  const cvw = e.target.closest && e.target.closest(".wheel"); if (!cvw) return;
  const o = findSel(); if (!o || sel.type !== "clip") return;
  e.preventDefault(); const snap0 = snapshot(); o.gr = {...defGrade(), ...(o.gr || {})}; const k = cvw.dataset.w;
  const mv = ev => { Object.assign(o.gr[k] = {...o.gr[k]}, wheelAt(cvw, ev)); drawWheels(); if (!playing) paint(); };
  mv(e);
  const up = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); pushSnap(snap0); renderTimeline(); const sc = $(".panel.right").scrollTop; renderProps(); $(".panel.right").scrollTop = sc; };
  window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
});
document.addEventListener("dblclick", e => {
  const cvw = e.target.closest && e.target.closest(".wheel"); if (!cvw) return;
  const o = findSel(); if (!o || !o.gr) return; commit(); o.gr[cvw.dataset.w] = {x:0, y:0, l:o.gr[cvw.dataset.w].l || 0}; const sc = $(".panel.right").scrollTop; renderProps(); $(".panel.right").scrollTop = sc; renderTimeline(); if (!playing) paint();
});
/* .cube LUT import */
function parseCube(text) {
  let n = 0, min = [0, 0, 0], max = [1, 1, 1]; const vals = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim(); if (!line || line[0] === "#") continue;
    const parts = line.split(/\s+/);
    if (/^LUT_1D_SIZE$/i.test(parts[0])) throw new Error("This is a 1D LUT. Please use a 3D .cube LUT.");
    if (/^LUT_3D_SIZE$/i.test(parts[0])) { n = +parts[1]; continue; }
    if (/^DOMAIN_MIN$/i.test(parts[0])) { min = parts.slice(1, 4).map(Number); continue; }
    if (/^DOMAIN_MAX$/i.test(parts[0])) { max = parts.slice(1, 4).map(Number); continue; }
    if (/^[A-Z_]/i.test(parts[0])) continue;
    if (parts.length >= 3) for (let i = 0; i < 3; i++) vals.push((+parts[i] - min[i]) / ((max[i] - min[i]) || 1));
  }
  if (!n || n < 2 || n > 65) throw new Error("This file has no LUT_3D_SIZE (or an unusual size).");
  if (vals.length < n * n * n * 3 || vals.some(v => !isFinite(v))) throw new Error("The LUT file looks incomplete or damaged.");
  return {n, rgb:new Float32Array(vals.slice(0, n * n * n * 3))};
}
const lutIn = document.createElement("input"); lutIn.type = "file"; lutIn.accept = ".cube"; lutIn.hidden = true; document.body.appendChild(lutIn);
lutIn.addEventListener("change", async () => {
  const f = lutIn.files[0]; lutIn.value = ""; if (!f) return;
  const o = findSel();
  try {
    const L = parseCube(await f.text()), id = uid();
    luts.set(id, {name:f.name.replace(/\.cube$/i, ""), n:L.n, rgb:L.rgb});
    if (!FX.setLut(id, L.n, L.rgb)) throw new Error("Your browser can't apply LUTs (WebGL is off).");
    if (o && sel.type === "clip") { commit(); o.gr = {...defGrade(), ...(o.gr || {}), lut:id, lamt:1}; }
    refresh(); showSec("Colour grading"); toast(`LUT "${f.name}" loaded (${L.n}×${L.n}×${L.n})`);
  } catch (err) { toast(err.message || "Couldn't read that LUT file"); }
});

/* ---------- Scopes ---------- */
let scopeMode = "", scopeAt = 0;
const scopeSmall = document.createElement("canvas"); scopeSmall.width = 240; scopeSmall.height = 135;
function scopesTick(force) {
  if (!scopeMode) return;
  const now = performance.now(); if (!force && now - scopeAt < 120) return; scopeAt = now;
  const out = $(".scopes canvas"), sg = out.getContext("2d"), W = out.width, H = out.height;
  const s = scopeSmall.getContext("2d", {willReadFrequently:true}); s.drawImage(cv, 0, 0, scopeSmall.width, scopeSmall.height);
  const d = s.getImageData(0, 0, scopeSmall.width, scopeSmall.height).data, sw = scopeSmall.width, shh = scopeSmall.height;
  sg.fillStyle = "#0b0c0e"; sg.fillRect(0, 0, W, H);
  sg.strokeStyle = "#ffffff18"; sg.lineWidth = 1; sg.font = "9px system-ui"; sg.fillStyle = "#ffffff55";
  const plot = sg.createImageData(W, H), P = plot.data;
  const add = (x, y, r, g2, b) => { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 4; P[i] = Math.min(255, P[i] + r); P[i + 1] = Math.min(255, P[i + 1] + g2); P[i + 2] = Math.min(255, P[i + 2] + b); P[i + 3] = 255; };
  if (scopeMode === "wave" || scopeMode === "parade") {
    for (let y = 0; y < shh; y++) for (let x = 0; x < sw; x++) {
      const i = (y * sw + x) * 4, r = d[i], g2 = d[i + 1], b = d[i + 2];
      if (scopeMode === "wave") { const l = .299 * r + .587 * g2 + .114 * b; add(x / sw * W, (1 - l / 255) * (H - 1), 18, 40, 18); }
      else { const third = W / 3; add(x / sw * third, (1 - r / 255) * (H - 1), 40, 6, 6); add(third + x / sw * third, (1 - g2 / 255) * (H - 1), 6, 40, 6); add(2 * third + x / sw * third, (1 - b / 255) * (H - 1), 8, 12, 45); }
    }
    for (let i = P.length - 1; i > 0; i -= 4) if (!P[i]) { P[i - 3] = 11; P[i - 2] = 12; P[i - 1] = 14; P[i] = 255; }
    sg.putImageData(plot, 0, 0);
    [0, .25, .5, .75, 1].forEach(q => { const y = Math.round((1 - q) * (H - 1)) + .5; sg.beginPath(); sg.moveTo(0, y); sg.lineTo(W, y); sg.stroke(); });
  } else if (scopeMode === "hist") {
    const hr = new Uint32Array(256), hg = new Uint32Array(256), hb = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) { hr[d[i]]++; hg[d[i + 1]]++; hb[d[i + 2]]++; }
    const mx = Math.max(1, ...[...hr, ...hg, ...hb].slice(1, 255));
    sg.globalCompositeOperation = "lighter";
    [[hr, "#ff4d4d"], [hg, "#4dff6a"], [hb, "#4d7dff"]].forEach(([h, c2]) => { sg.fillStyle = c2 + "99"; sg.beginPath(); sg.moveTo(0, H); for (let k = 0; k < 256; k++) sg.lineTo(k / 255 * W, H - Math.min(1, h[k] / mx) * (H - 4)); sg.lineTo(W, H); sg.fill(); });
    sg.globalCompositeOperation = "source-over";
  } else if (scopeMode === "vector") {
    const cx = W / 2, cy = H / 2, R = H / 2 - 6;
    for (let i = 0; i < d.length; i += 4) { const r = d[i] / 255, g2 = d[i + 1] / 255, b = d[i + 2] / 255; const cb = -.169 * r - .331 * g2 + .5 * b, cr = .5 * r - .419 * g2 - .081 * b; add(cx + cb * R * 2, cy - cr * R * 2, 30 + d[i] / 10, 30 + d[i + 1] / 10, 30 + d[i + 2] / 10); }
    for (let i = P.length - 1; i > 0; i -= 4) if (!P[i]) { P[i - 3] = 11; P[i - 2] = 12; P[i - 1] = 14; P[i] = 255; }
    sg.putImageData(plot, 0, 0);
    sg.beginPath(); sg.arc(cx, cy, R, 0, Math.PI * 2); sg.stroke(); sg.beginPath(); sg.moveTo(cx - R, cy); sg.lineTo(cx + R, cy); sg.moveTo(cx, cy - R); sg.lineTo(cx, cy + R); sg.stroke();
    /* skin-tone line (about 123° on a vectorscope) */
    sg.strokeStyle = "#ffb36655"; sg.beginPath(); sg.moveTo(cx, cy); sg.lineTo(cx + Math.cos(-123 * Math.PI / 180) * R, cy + Math.sin(-123 * Math.PI / 180) * R); sg.stroke();
  }
}
function setScope(mode) {
  scopeMode = mode; const box = $(".scopes"); box.hidden = !mode;
  $('[data-act="scopes"]').setAttribute("aria-pressed", String(!!mode)); if (mode) { $(".scopes select").value = mode; scopesTick(true); }
}

/* two reusable full-frame layers for transitions (outgoing / incoming) */
const trLayers = [];
function trCanvases(W, H) {
  while (trLayers.length < 2) { const c = document.createElement("canvas"); trLayers.push({c, g:c.getContext("2d")}); }
  trLayers.forEach(l => { if (l.c.width !== W || l.c.height !== H) { l.c.width = W; l.c.height = H; } });
  return trLayers;
}

/* ---------- Drawing ---------- */
function drawFrame(g, W, H, t, pool) {
  g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
  const ents = entries(t);
  for (let i = tracks.length - 1; i >= 0; i--) {
    const tr = tracks[i]; if (tr.kind !== "v" || tr.hide) continue;
    const e = ents.find(k => k.c.tr === tr.id && !k.tail); if (!e) continue;
    if (media.get(e.c.m).kind === "adj") { drawAdjustment(g, W, H, e.c, t); continue; }
    const el = pool.pool.get(e.c.id); if (!ready(el)) continue;
    if (e.pr === undefined) { drawClip(g, W, H, e.c, el, t); continue; }
    const tail = ents.find(k => k.tail && k.c.tr === tr.id), tel = tail && pool.pool.get(tail.c.id), hasT = tail && ready(tel);
    const pr = e.pr, ty = e.c.tin.type, drawPrev = (a = 1, dx = 0) => { if (hasT) drawClip(g, W, H, tail.c, tel, endOf(tail.c) - 1e-3, a, dx); };
    /* GPU transitions: draw each side full-frame (with its own position, crop and effects), then blend in a shader */
    if (window.FX && FX.trById[ty]) {
      const [A, B] = trCanvases(W, H);
      A.g.clearRect(0, 0, W, H); B.g.clearRect(0, 0, W, H);
      if (hasT) drawClip(A.g, W, H, tail.c, tel, endOf(tail.c) - 1e-3);
      drawClip(B.g, W, H, e.c, el, t);
      const out = FX.transition(A.c, B.c, W, H, ty, pr, t);
      if (out) { g.drawImage(out, 0, 0, W, H); continue; }
    }
    if (ty === "dissolve") { drawPrev(); drawClip(g, W, H, e.c, el, t, pr); }
    else if (ty === "black" || ty === "white") {
      if (pr < .5) drawPrev(); else drawClip(g, W, H, e.c, el, t);
      g.save(); g.globalAlpha = 1 - Math.abs(pr * 2 - 1); g.fillStyle = ty === "black" ? "#000" : "#fff"; g.fillRect(0, 0, W, H); g.restore();
    } else if (ty === "wipe") { drawPrev(); g.save(); g.beginPath(); g.rect(0, 0, W * ease(pr), H); g.clip(); drawClip(g, W, H, e.c, el, t); g.restore(); }
    else if (ty === "slide") { const p = ease(pr); drawPrev(1, -p * W); drawClip(g, W, H, e.c, el, t, 1, (1 - p) * W); }
    else if (ty === "zoom") { drawPrev(1 - pr); drawClip(g, W, H, e.c, el, t, pr, 0, .6 + .4 * ease(pr)); }
    else drawClip(g, W, H, e.c, el, t);
  }
  if (!textTrack.hide) for (const x of texts) if (t >= x.s && t < x.e) drawText(g, W, H, x, t);
}
const FONTS = {sans:"Archivo, system-ui, sans-serif", serif:"Georgia, 'Times New Roman', serif", mono:"Consolas, ui-monospace, monospace", hand:"'Comic Sans MS', 'Segoe Print', cursive"};
/* Google Fonts, loaded only when picked. b = also has a bold (700) weight. */
const GFONTS = [
  ["Poppins", "Popular", 1], ["Montserrat", "Popular", 1], ["Roboto", "Popular", 1], ["Open Sans", "Popular", 1], ["Lato", "Popular", 1], ["Raleway", "Popular", 1],
  ["Oswald", "Bold & display", 1], ["Bebas Neue", "Bold & display", 0], ["Anton", "Bold & display", 0], ["Teko", "Bold & display", 1], ["Righteous", "Bold & display", 0], ["Bangers", "Bold & display", 0],
  ["Playfair Display", "Elegant", 1], ["Merriweather", "Elegant", 1], ["Lobster", "Script & fun", 0], ["Pacifico", "Script & fun", 0], ["Dancing Script", "Script & fun", 1], ["Caveat", "Script & fun", 1], ["Permanent Marker", "Script & fun", 0],
  ["Noto Sans Devanagari", "Hindi (Devanagari)", 1], ["Hind", "Hindi (Devanagari)", 1], ["Mukta", "Hindi (Devanagari)", 1], ["Baloo 2", "Hindi (Devanagari)", 1], ["Kalam", "Hindi (Devanagari)", 1], ["Rozha One", "Hindi (Devanagari)", 0], ["Yatra One", "Hindi (Devanagari)", 0]
];
GFONTS.forEach(([n]) => { FONTS["g:" + n] = `"${n}", Archivo, sans-serif`; });
const fontState = {};
function ensureFont(key) {
  if (!key || !key.startsWith("g:")) return Promise.resolve();
  const name = key.slice(2), f = GFONTS.find(x => x[0] === name); if (!f) return Promise.resolve();
  if (fontState[name]) return fontState[name];
  const link = document.createElement("link"); link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, "+")}${f[2] ? ":wght@400;700" : ""}&display=swap`;
  document.head.appendChild(link);
  return (fontState[name] = new Promise(res => { link.onload = res; link.onerror = res; })
    .then(() => Promise.all([document.fonts.load(`400 48px "${name}"`), f[2] ? document.fonts.load(`700 48px "${name}"`) : null]))
    .catch(() => {}).then(() => { if (!playing) paint(); }));
}
function fontOptions(cur) {
  const basic = [["sans", "Sans"], ["serif", "Serif"], ["mono", "Mono"], ["hand", "Hand"]].map(([v, l]) => `<option value="${v}"${cur === v ? " selected" : ""}>${l}</option>`).join("");
  const groups = [...new Set(GFONTS.map(f => f[1]))].map(gname => `<optgroup label="${gname}">${GFONTS.filter(f => f[1] === gname).map(([n]) => `<option value="g:${n}"${cur === "g:" + n ? " selected" : ""}>${n}</option>`).join("")}</optgroup>`).join("");
  return `<optgroup label="Built in">${basic}</optgroup>${groups}`;
}
function textBox(g, W, H, x) {
  if (x.shape) { const bw = x.w * W, bh = (x.shape === "line" || x.shape === "arrow") ? Math.max(x.sw * H / 100 * 3, H * .03) : x.h * H; return {fs:H * .05, lines:[], lh:0, pad:0, bw, bh, cx:x.x * W, l:x.x * W - bw / 2, t:x.y * H - bh / 2}; }
  const fs = Math.max(8, x.size / 100 * H);
  if (x.font && x.font.startsWith("g:") && !fontState[x.font.slice(2)]) ensureFont(x.font);
  g.font = `${x.bold ? 700 : 500} ${fs}px ${FONTS[x.font] || FONTS.sans}`;
  const lines = String(x.text || " ").split("\n"), lh = fs * 1.2;
  const tw = Math.max(...lines.map(l => g.measureText(l).width)), pad = fs * .35;
  const bw = tw + pad * 2, bh = lines.length * lh + pad * 2;
  return {fs, lines, lh, pad, bw, bh, cx:x.x * W, l:x.x * W - bw / 2, t:x.y * H - bh / 2};
}
function drawText(g, W, H, x, t = x.s + 1) {
  g.save();
  const b = textBox(g, W, H, x);
  if (x.anim && x.anim !== "none") {
    const D = Math.min(.5, (x.e - x.s) / 3), pin = clamp((t - x.s) / D, 0, 1), pout = clamp((x.e - t) / D, 0, 1), p = ease(Math.min(pin, pout));
    g.globalAlpha = p;
    if (x.anim === "up") g.translate(0, (1 - p) * H * .06);
    if (x.anim === "pop") { const s = .6 + .4 * p; g.translate(b.cx, x.y * H); g.scale(s, s); g.translate(-b.cx, -x.y * H); }
    if (x.anim === "type" && !x.shape) { const n = Math.round(String(x.text).length * clamp((t - x.s) / Math.max(.3, (x.e - x.s) * .6), 0, 1)); b.lines = String(x.text).slice(0, n).split("\n"); g.globalAlpha = pout; }
  }
  if (x.shape) { drawShape(g, W, H, x, b); g.restore(); return; }
  if (x.bg) { g.fillStyle = x.bgc || "rgba(0,0,0,.6)"; g.beginPath(); g.roundRect ? g.roundRect(b.l, b.t, b.bw, b.bh, b.fs * .2) : g.rect(b.l, b.t, b.bw, b.bh); g.fill(); }
  g.fillStyle = x.color; g.textAlign = "center"; g.textBaseline = "middle";
  if (!x.bg) { g.lineWidth = b.fs * .12; g.strokeStyle = "rgba(0,0,0,.75)"; g.lineJoin = "round"; }
  b.lines.forEach((l, i) => { const y = b.t + b.pad + b.lh * (i + .5); if (!x.bg) g.strokeText(l, b.cx, y); g.fillText(l, b.cx, y); });
  g.restore();
}

function drawShape(g, W, H, x, b) {
  g.globalAlpha *= x.op ?? 1;
  g.translate(b.cx, x.y * H); if (x.rot) g.rotate(x.rot * Math.PI / 180);
  const w = b.bw, h = b.bh, lw = (x.sw || 0) * H / 100;
  g.fillStyle = x.color; g.strokeStyle = x.sc || "#ffffff"; g.lineWidth = lw; g.lineJoin = "round"; g.lineCap = "round";
  g.beginPath();
  if (x.shape === "rect") { const r = (x.rad || 0) * Math.min(w, h) / 2; g.roundRect ? g.roundRect(-w / 2, -h / 2, w, h, r) : g.rect(-w / 2, -h / 2, w, h); }
  else if (x.shape === "ellipse") g.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
  else if (x.shape === "triangle") { g.moveTo(0, -h / 2); g.lineTo(w / 2, h / 2); g.lineTo(-w / 2, h / 2); g.closePath(); }
  else if (x.shape === "star") { for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? .45 : 1; g.lineTo(Math.cos(a) * w / 2 * r, Math.sin(a) * h / 2 * r); } g.closePath(); }
  else if (x.shape === "line" || x.shape === "arrow") {
    const L = Math.max(lw, H * .004); g.lineWidth = L; g.strokeStyle = x.color;
    g.moveTo(-w / 2, 0); g.lineTo(w / 2 - (x.shape === "arrow" ? L * 1.5 : 0), 0); g.stroke();
    if (x.shape === "arrow") { g.beginPath(); g.fillStyle = x.color; g.moveTo(w / 2, 0); g.lineTo(w / 2 - L * 4, -L * 2.6); g.lineTo(w / 2 - L * 4, L * 2.6); g.closePath(); g.fill(); }
    return;
  }
  if (x.fill !== false) g.fill();
  if (lw > 0) g.stroke();
}
const SHAPES = {rect:"Rectangle", ellipse:"Circle", triangle:"Triangle", star:"Star", line:"Line", arrow:"Arrow"};
function addShape(kind) {
  commit();
  const s = fq(T), sq = kind === "ellipse" || kind === "star" || kind === "triangle", ln = kind === "line" || kind === "arrow";
  const [W, H] = outSize(1080), x = {id:uid(), shape:kind, text:SHAPES[kind], s, e:s + 3, x:.5, y:.5, w:sq ? .2 * H / W : .3, h:sq ? .2 : .14,
    color:ln ? "#ffd54a" : "#4f8cff", fill:true, sc:"#ffffff", sw:ln ? .8 : 0, rad:.15, rot:0, op:1, anim:"none"};
  texts.push(x); sel = {type:"text", id:x.id}; refresh();
}

/* ---------- Markers ---------- */
const MKC = {red:"#ff5d5d", yellow:"#ffd54a", green:"#3ecf8e", blue:"#4f8cff", purple:"#b67cff"};
function addMarker() {
  const t = fq(T); if (markers.some(m => Math.abs(m.t - t) < .5 / FPS)) return toast("There's already a marker here");
  commit(); markers.push({id:uid(), t, label:"Marker " + (markers.length + 1), color:"yellow"}); markers.sort((a, b) => a.t - b.t);
  refresh(); toast("Marker added at " + tc(t));
}
function renderMarkers() {
  const box = $(".mklist"); if (!box) return;
  box.innerHTML = markers.length ? markers.map(m => `<div class="mkrow"><i style="background:${MKC[m.color]}"></i><button class="mkt" data-go="${m.id}" title="Jump to marker">${tc(m.t)}</button><input value="${esc(m.label)}" data-ml="${m.id}" aria-label="Marker name"><select data-mc="${m.id}" aria-label="Marker colour">${Object.keys(MKC).map(c => `<option${c === m.color ? " selected" : ""}>${c}</option>`).join("")}</select><button class="ib" data-mdel="${m.id}" aria-label="Delete marker">${IC.x}</button></div>`).join("")
    : `<p class="empty-note">No markers yet. Press <kbd>M</kbd> or the button above to drop one at the playhead: handy for beats, cues and spots to fix.</p>`;
}

/* ---------- Monitor ---------- */
const cv = $(".view"), g = cv.getContext("2d");
function sizeViewer() { const [w, h] = outSize(720); if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; } const [W, H] = outSize(1080); $(".fsize").textContent = `${W}×${H} · ${FPS} fps`; }
function paint() {
  noGrade = beforeAfter; drawFrame(g, cv.width, cv.height, T, pv); noGrade = false;
  if (beforeAfter) { g.save(); g.font = `600 ${Math.round(cv.height / 28)}px system-ui`; g.fillStyle = "rgba(0,0,0,.6)"; const tw = g.measureText("Original (before grade)").width; g.fillRect(10, 10, tw + 20, cv.height / 20 + 8); g.fillStyle = "#fff"; g.textBaseline = "top"; g.fillText("Original (before grade)", 20, 16); g.restore(); }
  if (sel && sel.type === "text") { const x = findSel(); if (x && T >= x.s && T < x.e) { const b = textBox(g, cv.width, cv.height, x); g.save(); g.setLineDash([6, 4]); g.strokeStyle = "#fff"; g.lineWidth = 2; g.strokeRect(b.l - 2, b.t - 2, b.bw + 4, b.bh + 4); g.restore(); } }
  if (sel && sel.type === "clip") { const c = findSel(); if (c && c.mask && c.mask.on && T >= c.start && T < endOf(c)) { g.save(); g.setLineDash([8, 5]); g.lineWidth = 2; g.strokeStyle = "#ffd54a"; maskPath(g, cv.width, cv.height, {...defMask(), ...c.mask}); g.stroke(); g.restore(); } }
  scopesTick();
}
let seekGen = 0;
async function showFrame() {
  sizeViewer();
  const gen = ++seekGen, ents = entries(T);
  pv.pool.forEach((el, id) => { if (el.pause && !ents.some(e => e.c.id === id)) el.pause(); });
  await Promise.all(ents.filter(e => trk(e.c.tr).kind === "v" && media.get(e.c.m).kind !== "adj").map(e => seekEl(pv.get(e.c), Math.min(e.local + 0.001, media.get(e.c.m).dur - 0.001))));
  if (gen === seekGen) paint();
}
function setT(t, show = true) {
  T = clamp(fq(t), 0, Math.max(total(), 0)); updateTime();
  if (show && !playing) showFrame();
  const o = findSel(); /* keep animated values in the inspector in step with the playhead */
  if (!playing && o && o.kf && sel.type === "clip" && !$(".props").contains(document.activeElement)) renderProps();
}
function updateTime() {
  $(".tc.cur").textContent = tc(T); $(".tc.dur").textContent = tc(total());
  const x = T * pps; $(".ph").style.left = x + "px";
  if (playing) { const sc = scroller; if (x > sc.scrollLeft + sc.clientWidth - 40 || x < sc.scrollLeft) sc.scrollLeft = x - 40; }
}

/* ---------- Playback: a master clock drives every active clip ---------- */
let rafId = 0, clock0 = 0, T0 = 0;

/* ---------- Audio mixer ----------
   One graph shape, used for playback, video export and MP3/WAV export:
   clip gain → track strip [low-cut → EQ (low/mid/high) → compressor → dry + reverb send + echo send → pan → fader → mute/solo gate → meters]
            → master [limiter → fader → meters] → output.
   Settings live on each track as tr.mix and on `master`; both are part of undo history. */
const defMix = () => ({vol:0, pan:0, solo:false, hp:{on:false, f:80}, eq:{on:false, lo:0, mid:0, hi:0}, comp:{on:false, thr:-18, ratio:3}, rev:{on:false, mix:.25, size:2}, echo:{on:false, time:.3, fb:.3, mix:.25}});
let master = {vol:0, limiter:true};
const mixOf = tr => { tr.mix = tr.mix || defMix(); for (const [k, v] of Object.entries(defMix())) if (tr.mix[k] === undefined) tr.mix[k] = v; return tr.mix; };
const dbToGain = db => db <= -60 ? 0 : Math.pow(10, db / 20);
const impulseCache = new Map();
function impulse(ctx, secs) {
  const key = ctx.sampleRate + ":" + secs.toFixed(1); if (impulseCache.has(key)) return impulseCache.get(key);
  const len = Math.max(1, Math.round(ctx.sampleRate * secs)), b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4); }
  impulseCache.set(key, b); return b;
}
function makeMixer(ctx, out) {
  const M = {ctx, strips:new Map()};
  const mIn = ctx.createGain(), lim = ctx.createDynamicsCompressor(), mFader = ctx.createGain(), mSplit = ctx.createChannelSplitter(2);
  const mAn = [ctx.createAnalyser(), ctx.createAnalyser()]; mAn.forEach(a => { a.fftSize = 1024; });
  const limDry = ctx.createGain(), limWet = ctx.createGain();
  mIn.connect(limDry).connect(mFader); mIn.connect(lim).connect(limWet).connect(mFader); mFader.connect(out); /* browsers add make-up gain inside compressors, so "off" must bypass them */ mFader.connect(mSplit); mSplit.connect(mAn[0], 0); mSplit.connect(mAn[1], 1);
  M.master = {an:mAn};
  M.strip = id => {
    if (M.strips.has(id)) return M.strips.get(id);
    const n = {in:ctx.createGain(), hp:ctx.createBiquadFilter(), lo:ctx.createBiquadFilter(), mid:ctx.createBiquadFilter(), hi:ctx.createBiquadFilter(), comp:ctx.createDynamicsCompressor(), compDry:ctx.createGain(), compWet:ctx.createGain(),
      post:ctx.createGain(), dry:ctx.createGain(), revSend:ctx.createGain(), conv:ctx.createConvolver(), echoSend:ctx.createGain(), delay:ctx.createDelay(2), fb:ctx.createGain(),
      pan:ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain(), fader:ctx.createGain(), gate:ctx.createGain(), split:ctx.createChannelSplitter(2), an:[ctx.createAnalyser(), ctx.createAnalyser()]};
    n.hp.type = "highpass"; n.hp.Q.value = .7071; n.lo.type = "lowshelf"; n.lo.frequency.value = 200; n.mid.type = "peaking"; n.mid.frequency.value = 1500; n.mid.Q.value = .9; n.hi.type = "highshelf"; n.hi.frequency.value = 5000;
    n.an.forEach(a => { a.fftSize = 1024; });
    n.in.connect(n.hp).connect(n.lo).connect(n.mid).connect(n.hi); n.hi.connect(n.compDry).connect(n.post); n.hi.connect(n.comp).connect(n.compWet).connect(n.post);
    n.post.connect(n.dry).connect(n.pan);
    n.post.connect(n.revSend).connect(n.conv).connect(n.pan);
    n.post.connect(n.echoSend).connect(n.delay); n.delay.connect(n.fb).connect(n.delay); n.delay.connect(n.pan);
    n.pan.connect(n.fader).connect(n.gate); n.gate.connect(mIn); n.gate.connect(n.split); n.split.connect(n.an[0], 0); n.split.connect(n.an[1], 1);
    M.strips.set(id, n); M.update(); return n;
  };
  M.update = () => {
    const anySolo = tracks.some(t => t.mix && t.mix.solo);
    for (const [id, n] of M.strips) {
      const tr = trk(id); if (!tr) { n.gate.gain.value = 0; continue; }
      const x = mixOf(tr), now = ctx.currentTime;
      const set = (p, v) => { if (!n._ready) { p.value = v; return; } try { p.setTargetAtTime(v, now, .015); } catch (e) { p.value = v; } }; /* new strips jump straight to their settings (no glide from the default 1) */
      set(n.hp.frequency, x.hp.on ? x.hp.f : 10);
      set(n.lo.gain, x.eq.on ? x.eq.lo : 0); set(n.mid.gain, x.eq.on ? x.eq.mid : 0); set(n.hi.gain, x.eq.on ? x.eq.hi : 0);
      n.comp.threshold.value = x.comp.thr; n.comp.ratio.value = x.comp.ratio; n.comp.knee.value = 6; n.comp.attack.value = .01; n.comp.release.value = .2; set(n.compWet.gain, x.comp.on ? 1 : 0); set(n.compDry.gain, x.comp.on ? 0 : 1);
      set(n.post.gain, 1); /* the browser compressor already adds its own make-up gain */
      if (x.rev.on) { if (n._rs !== x.rev.size) { n.conv.buffer = impulse(ctx, x.rev.size); n._rs = x.rev.size; } set(n.revSend.gain, x.rev.mix); } else set(n.revSend.gain, 0);
      set(n.echoSend.gain, x.echo.on ? x.echo.mix : 0); set(n.delay.delayTime, x.echo.time); set(n.fb.gain, x.echo.on ? Math.min(.9, x.echo.fb) : 0);
      if (n.pan.pan) set(n.pan.pan, x.pan);
      set(n.fader.gain, dbToGain(x.vol));
      set(n.gate.gain, tr.mute || (anySolo && !x.solo) ? 0 : 1);
      n._ready = true;
    }
    lim.threshold.value = -1; lim.ratio.value = 20; lim.knee.value = 0; lim.attack.value = .002; lim.release.value = .12; limWet.gain.value = master.limiter ? 1 : 0; limDry.gain.value = master.limiter ? 0 : 1;
    mFader.gain.value = dbToGain(master.vol);
  };
  M.update();
  return M;
}
/* Playback mixer: created on the first Play (browsers only start audio after a click). */
let pvMix = null;
function ensurePreviewMixer() {
  if (pvMix || !AC) return pvMix;
  const ctx = new AC(); pvMix = makeMixer(ctx, ctx.destination); return pvMix;
}
/* Send one media element into a track strip of mixer M (creates its source node once). */
function routeEl(M, el, c, gain) {
  if (!el._srcNode || el._ctx !== M.ctx) { el._srcNode = M.ctx.createMediaElementSource(el); el._ctx = M.ctx; el._g = M.ctx.createGain(); el._srcNode.connect(el._g); el._tr = null; }
  if (el._tr !== c.tr) { try { el._g.disconnect(); } catch (e) { /* not connected yet */ } el._g.connect(M.strip(c.tr).in); el._tr = c.tr; }
  el._g.gain.value = gain; el.muted = false; el.volume = 1;
}
function meterDb(an) {
  const buf = new Float32Array(an.fftSize); an.getFloatTimeDomainData(buf);
  let pk = 0, sq = 0; for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > pk) pk = v; sq += buf[i] * buf[i]; }
  const rms = Math.sqrt(sq / buf.length), db = v => v > 0 ? 20 * Math.log10(v) : -90;
  return {peak:db(pk), rms:db(rms)};
}

function syncEls(pool, t, opts = {}) {
  const ents = entries(t);
  pool.pool.forEach((el, id) => { if (el.pause && !ents.some(e => e.c.id === id) && !el.paused) el.pause(); });
  for (const {c, local:want, mix, tail} of ents) {
    if (media.get(c.m).kind === "adj") continue;
    if (media.get(c.m).kind === "i") { pool.get(c); continue; }
    const tr = trk(c.tr), el = pool.get(c);
    const gain = clamp(valAt(c, "vol", tail ? endOf(c) - 1e-3 : t) * (tail ? 1 : fadeMul(c, t)) * mix, 0, 2); /* track mute/solo happen in the mixer */
    if (opts.gain) opts.gain(c, el, gain);
    else if (pvMix) routeEl(pvMix, el, c, gain);
    else { el.muted = gain === 0 || tr.mute; el.volume = Math.min(1, gain); }
    if (el.playbackRate !== c.speed) el.playbackRate = c.speed;
    el.preservesPitch = true;
    if (el.paused) { if (el.readyState >= 1) el.currentTime = want; el.play().catch(() => {}); }
    else if (Math.abs(el.currentTime - want) > 0.25) el.currentTime = want;
  }
}
function play() {
  if (!clips.length && !texts.length) return;
  const M = ensurePreviewMixer(); if (M && M.ctx.state !== "running") M.ctx.resume().catch(() => {});
  if (T >= total() - 1 / FPS) T = 0;
  playing = true; setPlayBtn(); clock0 = performance.now(); T0 = T;
  const tick = () => {
    if (!playing) return;
    T = T0 + (performance.now() - clock0) / 1000;
    if (T >= total()) { T = total(); pause(); return; }
    syncEls(pv, T); updateTime(); paint();
    rafId = requestAnimationFrame(tick);
  };
  tick();
}
function pause() { playing = false; cancelAnimationFrame(rafId); pv.pauseAll(); setPlayBtn(); T = clamp(fq(T), 0, total()); updateTime(); showFrame(); }
const toggle = () => playing ? pause() : play();
function setPlayBtn() { const b = $('[data-act="play"]'); b.innerHTML = playing ? IC.pause : IC.play; b.setAttribute("aria-label", playing ? "Pause" : "Play"); }
function step(d) { if (playing) pause(); setT(T + d); }
function editPoints() { const s = new Set([0, total()]); clips.forEach(c => { s.add(fq(c.start)); s.add(fq(endOf(c))); }); texts.forEach(x => { s.add(fq(x.s)); s.add(fq(x.e)); }); markers.forEach(m => s.add(fq(m.t))); return [...s].sort((a, b) => a - b); }
function jumpEdit(dir) { const p = editPoints(), cur = fq(T); const n = dir > 0 ? p.find(x => x > cur + 1e-6) : [...p].reverse().find(x => x < cur - 1e-6); if (n !== undefined) step(n - T); }

/* ---------- Import ---------- */
function waitFor(el, ev, ms = 20000) {
  return new Promise((res, rej) => {
    const ok = () => { off(); res(); }, bad = () => { off(); rej(new Error("load")); };
    const tm = setTimeout(bad, ms), off = () => { clearTimeout(tm); el.removeEventListener(ev, ok); el.removeEventListener("error", bad); };
    el.addEventListener(ev, ok); el.addEventListener("error", bad);
  });
}
async function fixDur(el) {
  if (isFinite(el.duration) && el.duration > 0) return;
  el.currentTime = 1e7;
  await Promise.race([new Promise(r => el.addEventListener("durationchange", r, {once:true})), sleep(3000)]);
  el.currentTime = 0; await sleep(50);
}
/* ---------- Import: browser-native formats open directly; everything else goes through ffmpeg (WebAssembly, in this tab) ---------- */
const VID_X = "mp4|m4v|mov|webm|mkv|ogv|avi|wmv|asf|flv|f4v|mpg|mpeg|mpe|m2v|mts|m2ts|ts|vob|3gp|3g2|divx|xvid|rm|rmvb|dv|mxf|y4m|hevc|h264|h265|qt|ogm|nut";
const AUD_X = "mp3|m4a|wav|ogg|oga|aac|flac|opus|wma|amr|aiff|aif|aifc|ac3|eac3|ape|mka|caf|au|snd|ra|m4b|mp2|mpa|wv|tta|dts|spx|gsm|voc|3ga";
const IMG_X = "png|jpe?g|jfif|gif|webp|svg|bmp|ico|avif|tiff?|tga|psd|dds|ppm|pgm|pbm|pcx|sgi|xbm|exr|jp2|j2k|jxl|heic|heif";
const ext = n => ((String(n).match(/\.([^.]+)$/) || [, ""])[1]).toLowerCase();
function kindOf(f) {
  const e = ext(f.name), t = f.type || "";
  if (new RegExp(`^(${IMG_X})$`).test(e) || t.startsWith("image/")) return "i";
  if (new RegExp(`^(${AUD_X})$`).test(e) || t.startsWith("audio/")) return "a";
  if (new RegExp(`^(${VID_X})$`).test(e) || t.startsWith("video/")) return "v";
  return "?";
}
async function probeNative(f, want) {
  const url = URL.createObjectURL(f), el = document.createElement(want === "v" ? "video" : "audio");
  el.preload = "auto"; el.muted = true; el.src = url;
  try {
    await waitFor(el, "loadedmetadata", 12000); await fixDur(el);
    if (want === "v") { if (!el.videoWidth) throw new Error("no picture"); await seekEl(el, Math.min(.2, el.duration / 2)); if (el.readyState < 2) throw new Error("can't decode"); }
    if (!(el.duration > 0)) throw new Error("no length");
    return {url, dur:el.duration, w:el.videoWidth || 0, h:el.videoHeight || 0};
  } catch (e) { URL.revokeObjectURL(url); return null; }
  finally { el.removeAttribute("src"); el.load(); }
}
async function addFiles(files) {
  const n0 = media.size;
  try { await addFilesNow(files); } finally { const n = media.size - n0; if (n) toast(`${n} file${n > 1 ? "s" : ""} added to Media. Click + to add a file to the end of V1, or drag it onto the track you want.`); }
}
async function addFilesNow(files) {
  for (const f0 of files) {
    let f = f0, k = kindOf(f);
    if (k === "?") k = "v"; /* unknown extension: let ffmpeg work out what it is */
    if (k === "i") {
      let blob = f;
      const img = new Image(), u = URL.createObjectURL(f); img.src = u;
      const ok = await img.decode().then(() => true, () => false); URL.revokeObjectURL(u);
      if (!ok) { blob = await convert(f, "i"); if (!blob) continue; }
      await addImage(blob, f.name); continue;
    }
    let info = await probeNative(f, k);
    if (!info) {
      const out = await convert(f, k); if (!out) continue;
      info = await probeNative(out, k);
      if (!info && k === "v") { /* maybe it was audio only */ const a = await probeNative(out, "a"); if (a) { k = "a"; info = a; } }
      if (!info) { toast(`Couldn't read ${f.name}, even after converting it`); continue; }
      f = out;
    }
    const kind = k === "v" && info.w ? "v" : "a";
    const m = {id:uid(), name:f0.name, url:info.url, kind, dur:info.dur, w:info.w, h:info.h, thumbs:[], step:Math.max(.5, info.dur / 400), peaks:null};
    media.set(m.id, m); renderBin();
    if (kind === "v") makeThumbs(m);
    makePeaks(m, f);
  }
}
let ffmpegP = null;
async function blobURL(url, type) { const r = await fetch(url); if (!r.ok) throw new Error(url); return URL.createObjectURL(new Blob([await r.arrayBuffer()], {type})); }
function getFFmpeg() {
  return ffmpegP || (ffmpegP = (async () => {
    const B = "https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/umd/", E = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/";
    await loadLib(B + "ffmpeg.js");
    const ff = new window.FFmpegWASM.FFmpeg();
    /* The worker must be same-origin, so it's served from vendor/ffmpeg; the big core comes from the CDN as blobs. */
    await ff.load({classWorkerURL:new URL("vendor/ffmpeg/worker.js", location.href).href, coreURL:await blobURL(E + "ffmpeg-core.js", "text/javascript"), wasmURL:await blobURL(E + "ffmpeg-core.wasm", "application/wasm")});
    return ff;
  })().catch(e => { ffmpegP = null; throw e; }));
}
const conv = (msg, p) => { const el = $(".conv"); el.hidden = !msg; el.querySelector("span").textContent = msg || ""; const pr = el.querySelector("progress"); if (p == null) pr.removeAttribute("value"); else pr.value = p; };
let convQ = Promise.resolve();
function convert(f, k) { const run = convQ.then(() => convertNow(f, k)); convQ = run.catch(() => {}); return run; }
async function convertNow(f, k) {
  if (f.size > 1.8 * 1073741824) { toast(`${f.name} is too big to convert in the browser (over 1.8 GB)`); return null; }
  let ff;
  try { conv(`Getting the converter ready for ${f.name} (one-time, about 30 MB)…`); ff = await getFFmpeg(); }
  catch (e) { conv(null); toast("Couldn't load the converter. Check your internet connection and try again."); return null; }
  const inName = "in." + (ext(f.name) || "bin"), out = k === "v" ? "out.mp4" : k === "a" ? "out.mp3" : "out.png";
  const args = k === "v" ? ["-i", inName, "-map", "0:v:0?", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "20", "-pix_fmt", "yuv420p", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out]
    : k === "a" ? ["-i", inName, "-vn", "-c:a", "libmp3lame", "-b:a", "256k", out] : ["-i", inName, "-frames:v", "1", out];
  const onP = ({progress}) => conv(`Converting ${f.name} so the editor can use it… ${Math.round(clamp(progress, 0, 1) * 100)}%`, clamp(progress, 0, 1));
  try {
    conv(`Converting ${f.name} so the editor can use it…`, 0); ff.on("progress", onP);
    await ff.writeFile(inName, new Uint8Array(await f.arrayBuffer()));
    const code = await ff.exec(args);
    const data = await ff.readFile(out).catch(() => null);
    if (code !== 0 || !data || !data.length) throw new Error("ffmpeg failed");
    toast(`Converted ${f.name}`);
    return new File([data.buffer], f.name.replace(/\.[^.]+$/, "") + out.slice(3), {type:k === "v" ? "video/mp4" : k === "a" ? "audio/mpeg" : "image/png"});
  } catch (e) { console.error(e); toast(`Couldn't convert ${f.name}. The file may be damaged or use a very unusual format.`); return null; }
  finally { ff.off("progress", onP); ff.deleteFile(inName).catch(() => {}); ff.deleteFile(out).catch(() => {}); conv(null); }
}
/* Photos and logos become still clips. They can be stretched to any length. */
async function addImage(blob, name, insertAt = false) {
  const url = URL.createObjectURL(blob), img = new Image(); img.src = url;
  try { await img.decode(); } catch (e) { toast(`Can't open ${name}`); return null; }
  const m = {id:uid(), name, url, kind:"i", dur:3600, still:5, w:img.naturalWidth || 640, h:img.naturalHeight || 360, thumbs:[], step:1e9, peaks:null};
  const th = 50, tw = Math.max(1, Math.round(th * m.w / m.h)), c = document.createElement("canvas"); c.width = tw; c.height = th; c.getContext("2d").drawImage(img, 0, 0, tw, th); m.thumbs.push(c);
  media.set(m.id, m); renderBin();
  if (insertAt !== false) insertMedia(m.id);
  return m;
}
async function freezeFrame() {
  const o = findSel();
  if (!o || sel.type !== "clip" || media.get(o.m).kind !== "v" || T < o.start || T >= endOf(o)) return toast("Select a video clip and put the playhead on the frame to freeze");
  const el = pv.get(o); await seekEl(el, localAt(o, T) + .001);
  const c = document.createElement("canvas"); c.width = el.videoWidth; c.height = el.videoHeight; c.getContext("2d").drawImage(el, 0, 0);
  const blob = await new Promise(r => c.toBlob(r, "image/png"));
  const m = await addImage(blob, "Freeze " + tc(T) + ".png", false); if (!m) return;
  commit();
  const at = fq(T), D = 2, right = splitClip(o, at);
  clips.forEach(k => { if (k.tr === o.tr && k !== o && k.start >= at - 1e-4) k.start = fq(k.start + D); });
  const still = {...o, id:uid(), m:m.id, start:at, a:0, b:D, speed:1, vol:0, tin:null, fi:0, fo:0, kf:null};
  clips.push(still); sel = {type:"clip", id:still.id}; refresh(); toast("Added a 2-second freeze frame" + (right ? "" : ""));
}
async function makeThumbs(m) {
  const v = document.createElement("video"); v.muted = true; v.preload = "auto"; v.src = m.url;
  try { await waitFor(v, "loadedmetadata"); } catch (e) { return; }
  const th = 50, tw = Math.round(th * m.w / m.h); let last = 0;
  for (let t = 0; t < m.dur; t += m.step) {
    await seekEl(v, Math.min(t + m.step / 2, m.dur - .01));
    const c = document.createElement("canvas"); c.width = tw; c.height = th; c.getContext("2d").drawImage(v, 0, 0, tw, th);
    m.thumbs.push(c);
    if (m.thumbs.length === 2) renderBin();
    if (performance.now() - last > 500) { last = performance.now(); renderTimeline(); }
  }
  v.removeAttribute("src"); v.load(); renderBin(); renderTimeline();
}
async function makePeaks(m, f) {
  if (!AC || f.size > 300 * 1048576) return;
  try {
    const ac = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 2, 44100);
    const buf = await ac.decodeAudioData(await f.arrayBuffer());
    const d = buf.getChannelData(0), per = Math.floor(buf.sampleRate / 100), n = Math.floor(d.length / per), pk = new Float32Array(n);
    for (let i = 0; i < n; i++) { let mx = 0; for (let j = i * per, e = j + per; j < e; j += 4) { const a = Math.abs(d[j]); if (a > mx) mx = a; } pk[i] = mx; }
    m.peaks = pk; renderTimeline(); if (m.kind === "a") renderBin();
  } catch (e) { /* no audio track, or a format the decoder can't read */ }
}
function renderBin() {
  const bin = $(".bin");
  bin.innerHTML = [...media.values()].filter(m => m.kind !== "adj").map(m => `<div class="m" draggable="true" data-m="${m.id}" title="${esc(m.name)}"><canvas width="160" height="90"></canvas><span>${m.kind === "i" ? "Photo" : short(m.dur)}</span><b>${m.kind === "a" ? "♪ " : ""}${esc(m.name)}</b><button class="add" data-add="${m.id}" title="Add to the end of the main track" aria-label="Add ${esc(m.name)} to the timeline">+</button><button class="srcb" data-srcopen="${m.id}" title="Open in the source monitor (or double-click): mark In/Out, then insert or overwrite" aria-label="Open ${esc(m.name)} in the source monitor">In/Out</button></div>`).join("") || "";
  $$(".m", bin).forEach(el => {
    const m = media.get(el.dataset.m), gg = $("canvas", el).getContext("2d");
    gg.fillStyle = m.kind === "a" ? "#123528" : "#111"; gg.fillRect(0, 0, 160, 90);
    const t = m.thumbs[Math.min(m.thumbs.length - 1, 1)];
    if (t) { const k = Math.min(160 / t.width, 90 / t.height); gg.drawImage(t, (160 - t.width * k) / 2, (90 - t.height * k) / 2, t.width * k, t.height * k); }
    if (m.kind === "a" && m.peaks) { gg.fillStyle = "#3ecf8e"; for (let x = 0; x < 160; x++) { const p = m.peaks[Math.floor(x / 160 * m.peaks.length)] || 0; gg.fillRect(x, 45 - p * 38, 1, Math.max(1, p * 76)); } }
    el.addEventListener("dragstart", e => { e.dataTransfer.setData("text/x-media", m.id); e.dataTransfer.effectAllowed = "copy"; });
    el.addEventListener("dblclick", e => { if (!e.target.closest("button")) openSource(m.id); });
  });
}

/* ---------- Clip helpers shared by the source monitor and adjustment layers ---------- */
function makeClip(mid) {
  const m = media.get(mid);
  return {id:uid(), m:mid, tr:null, start:0, a:0, b:m.kind === "i" ? m.still : m.kind === "adj" ? 5 : m.dur, speed:1, vol:m.kind === "i" || m.kind === "adj" ? 0 : 1, op:1, sc:1, x:0, y:0, rot:0, fi:0, fo:0, tin:null, kf:null, col:null};
}
const mainTrack = kind => kind === "v" ? tracks.filter(t => t.kind === "v").pop() : tracks.find(t => t.kind === "a");
/* Make room at [at, at+L) on a track: split clips that straddle the edges, then either push later clips (insert)
   or remove what is inside (overwrite). */
function cutRegion(trId, at, L, mode) {
  const on = () => clips.filter(c => c.tr === trId);
  for (const edge of mode === "insert" ? [at] : [at, at + L]) { const c = on().find(k => edge > k.start + 1e-4 && edge < endOf(k) - 1e-4); if (c) splitClip(c, edge); }
  if (mode === "insert") on().forEach(c => { if (c.start >= at - 1e-4) c.start = fq(c.start + L); });
  else clips = clips.filter(c => !(c.tr === trId && c.start >= at - 1e-4 && c.start < at + L - 1e-4));
}
function placeFromSource(mid, a, b, mode) {
  const m = media.get(mid), kind = m.kind === "a" ? "a" : "v", tr = mainTrack(kind);
  if (tr.lock) return toast(`${tr.id} is locked. Unlock it first.`);
  const c = makeClip(mid); c.a = a; c.b = b; c.tr = tr.id;
  const L = len(c), end = Math.max(0, ...clips.filter(k => k.tr === tr.id).map(endOf));
  commit();
  if (mode === "append") c.start = end;
  else { c.start = fq(T); cutRegion(tr.id, c.start, L, mode); }
  clips.push(c); sel = {type:"clip", id:c.id}; refresh(); fitOnce();
  toast(`${mode === "insert" ? "Inserted" : mode === "overwrite" ? "Overwrote" : "Appended"} ${tc(L)} of ${m.name} on ${tr.id}`);
}

/* ---------- Source monitor: preview a file, mark In / Out, then insert, overwrite or append ---------- */
const srcDlg = document.createElement("dialog"); srcDlg.className = "srcmon"; document.body.appendChild(srcDlg);
let srcM = null, srcEl = null, srcIn = 0, srcOut = 0, srcRaf = 0;
function openSource(mid) {
  const m = media.get(mid); if (!m || m.kind === "adj") return;
  if (playing) pause();
  srcM = m; srcIn = m.srcIn ?? 0; srcOut = m.srcOut ?? (m.kind === "i" ? m.still : m.dur);
  const isI = m.kind === "i";
  srcDlg.innerHTML = `<div class="sm-h"><b>Source</b><span>${esc(m.name)}</span><button class="ib" data-src="close" aria-label="Close source monitor">✕</button></div>
    <div class="sm-view">${isI ? `<img alt="" src="${m.url}">` : m.kind === "a" ? `<canvas class="sm-wave" width="640" height="160"></canvas>` : `<video playsinline preload="auto" src="${m.url}"></video>`}</div>
    ${isI ? `<div class="f"><label>Length on the timeline</label><input type="text" class="sm-len" value="${tc(srcOut - srcIn)}"></div>` : `
    <div class="sm-bar"><div class="sm-range"></div><input type="range" class="sm-scrub" min="0" max="${m.dur}" step="${1 / FPS}" value="${srcIn}" aria-label="Position in source"></div>
    <div class="sm-tc"><span class="sm-cur">${tc(srcIn)}</span><span>In <b class="sm-in">${tc(srcIn)}</b> · Out <b class="sm-out">${tc(srcOut)}</b> · Length <b class="sm-len2">${tc(srcOut - srcIn)}</b></span></div>
    <div class="sm-ctl"><button class="btn ghost small" data-src="prev" title="Previous frame (←)">◀ Frame</button><button class="btn small" data-src="play" title="Play / pause (Space)">Play</button><button class="btn ghost small" data-src="next" title="Next frame (→)">Frame ▶</button>
      <span class="sp"></span><button class="btn ghost small" data-src="in" title="Mark In (I)">Mark In (I)</button><button class="btn ghost small" data-src="out" title="Mark Out (O)">Mark Out (O)</button><button class="btn ghost small" data-src="clear" title="Clear In and Out">Clear</button></div>`}
    <div class="acts"><button class="btn ghost small" data-src="close">Cancel</button><button class="btn ghost small" data-src="append" title="Add after the last clip">Append to end</button><button class="btn ghost small" data-src="overwrite" title="Replace what is at the playhead">Overwrite at playhead</button><button class="btn small" data-src="insert" title="Push later clips to make room">Insert at playhead</button></div>`;
  srcEl = $("video", srcDlg);
  if (srcEl) { srcEl.muted = false; srcEl.addEventListener("loadeddata", () => { srcEl.currentTime = srcIn; }, {once:true}); }
  if (m.kind === "a") { const wv = $(".sm-wave", srcDlg), wg = wv.getContext("2d"); wg.fillStyle = "#0b0c0e"; wg.fillRect(0, 0, 640, 160); if (m.peaks) { wg.fillStyle = "#6ee7b0"; for (let x = 0; x < 640; x++) { const p = m.peaks[Math.floor(x / 640 * m.peaks.length)] || 0; wg.fillRect(x, 80 - p * 72, 1, Math.max(1, p * 144)); } } srcEl = document.createElement("audio"); srcEl.src = m.url; srcEl.preload = "auto"; srcDlg.appendChild(srcEl); srcEl.hidden = true; }
  srcUpdate(); srcDlg.showModal();
}
function srcUpdate() {
  if (!srcM || srcM.kind === "i") return;
  const cur = srcEl ? srcEl.currentTime : srcIn, D = srcM.dur || 1;
  const set = (s, v) => { const e = $(s, srcDlg); if (e) e.textContent = v; };
  set(".sm-cur", tc(cur)); set(".sm-in", tc(srcIn)); set(".sm-out", tc(srcOut)); set(".sm-len2", tc(srcOut - srcIn));
  const sc = $(".sm-scrub", srcDlg); if (sc && document.activeElement !== sc) sc.value = cur;
  const rg = $(".sm-range", srcDlg); if (rg) { rg.style.left = srcIn / D * 100 + "%"; rg.style.width = Math.max(.3, (srcOut - srcIn) / D * 100) + "%"; }
}
function srcLoop() { cancelAnimationFrame(srcRaf); srcUpdate(); if (srcEl && !srcEl.paused) { if (srcEl.currentTime >= srcOut - .02 && srcOut < srcM.dur - .05) { srcEl.pause(); srcEl.currentTime = srcOut; } srcRaf = requestAnimationFrame(srcLoop); } else { const b = $('[data-src="play"]', srcDlg); if (b) b.textContent = "Play"; } }
function srcStep(d) { if (!srcEl) return; srcEl.pause(); srcEl.currentTime = clamp(fq(srcEl.currentTime + d), 0, srcM.dur); setTimeout(srcUpdate, 60); }
function srcAct(a) {
  if (a === "close") { srcDlg.close(); return; }
  if (a === "play") { if (!srcEl) return; if (srcEl.paused) { if (srcEl.currentTime >= srcOut - .03) srcEl.currentTime = srcIn; srcEl.play().catch(() => {}); $('[data-src="play"]', srcDlg).textContent = "Pause"; srcLoop(); } else srcEl.pause(); return; }
  if (a === "prev") return srcStep(-1 / FPS);
  if (a === "next") return srcStep(1 / FPS);
  if (a === "in") { srcIn = fq(srcEl.currentTime); if (srcOut <= srcIn + 1 / FPS) srcOut = srcM.dur; srcUpdate(); return; }
  if (a === "out") { srcOut = fq(srcEl.currentTime); if (srcOut <= srcIn + 1 / FPS) srcIn = 0; srcUpdate(); return; }
  if (a === "clear") { srcIn = 0; srcOut = srcM.dur; srcUpdate(); return; }
  if (["insert", "overwrite", "append"].includes(a)) {
    let ina = srcIn, outb = srcOut;
    if (srcM.kind === "i") { const L = parseTC($(".sm-len", srcDlg).value); if (!(L > 0)) return toast("Use a length like 00:00:05:00"); ina = 0; outb = L; }
    if (outb - ina < 1 / FPS) return toast("Mark an Out point after the In point");
    srcM.srcIn = srcIn; srcM.srcOut = srcOut; if (srcEl) srcEl.pause(); srcDlg.close();
    placeFromSource(srcM.id, ina, outb, a);
  }
}
srcDlg.addEventListener("click", e => { const b = e.target.closest("[data-src]"); if (b) srcAct(b.dataset.src); });
srcDlg.addEventListener("input", e => { if (e.target.matches(".sm-scrub") && srcEl) { srcEl.pause(); srcEl.currentTime = +e.target.value; setTimeout(srcUpdate, 40); } });
srcDlg.addEventListener("keydown", e => {
  if (e.target.matches("input[type=text]")) return;
  const k = e.key.toLowerCase(), map = {i:"in", o:"out", " ":"play", arrowleft:"prev", arrowright:"next"};
  if (map[k]) { e.preventDefault(); srcAct(map[k]); }
});
srcDlg.addEventListener("close", () => { if (srcEl) srcEl.pause(); cancelAnimationFrame(srcRaf); });

/* ---------- Adjustment layer: its effects and grade apply to everything below it ---------- */
media.set("__adj", {id:"__adj", name:"Adjustment layer", url:"", kind:"adj", dur:36000, w:0, h:0, thumbs:[], step:1e9, peaks:null});
function addAdjustment() {
  const vs = tracks.filter(t => t.kind === "v"), L = 5, at = fq(T);
  const c = makeClip("__adj"); c.start = at; c.b = L;
  let tr = vs.slice(0, -1).reverse().find(t => !t.lock && !overlaps(c, t.id)); /* first free layer above V1 */
  commit(); if (!tr) tr = addTrack("v", true);
  c.tr = tr.id; clips.push(c); sel = {type:"clip", id:c.id};
  refresh(); showSec("Effects"); toast(`Adjustment layer added on ${tr.id}: add effects or a grade and they apply to everything below it`);
}
function drawAdjustment(g, W, H, c, t) {
  const gu = gradeU(c), list = c.fx || [];
  if (!window.FX || (!gu && !list.some(f => f.on !== false)) || noFx) return;
  const out = FX.render(g.canvas, W, H, 0, 0, W, H, W, H, list, t, H / 1080, noGrade ? null : gu);
  if (!out) return;
  g.save(); g.globalAlpha = clamp(valAt(c, "op", t) * fadeMul(c, t), 0, 1);
  const mk = c.mask && c.mask.on;
  if (mk) { const L = maskLayer(W, H); L.g.clearRect(0, 0, W, H); L.g.drawImage(out, 0, 0, W, H); applyMask(L.g, W, H, c.mask); g.drawImage(L.c, 0, 0); }
  else g.drawImage(out, 0, 0, W, H);
  g.restore();
}

/* ---------- Masks: show (or hide) only part of a clip, in frame coordinates ---------- */
const defMask = () => ({on:false, shape:"ellipse", x:.5, y:.5, w:.5, h:.6, feather:.04, inv:false});
let maskL = null;
function maskLayer(W, H) { if (!maskL) { const c = document.createElement("canvas"); maskL = {c, g:c.getContext("2d")}; } if (maskL.c.width !== W || maskL.c.height !== H) { maskL.c.width = W; maskL.c.height = H; } return maskL; }
function maskPath(g, W, H, mk) {
  const cx = mk.x * W, cy = mk.y * H, w = mk.w * W, h = mk.h * H; g.beginPath();
  if (mk.shape === "rect") g.rect(cx - w / 2, cy - h / 2, w, h); else g.ellipse(cx, cy, Math.max(1, w / 2), Math.max(1, h / 2), 0, 0, Math.PI * 2);
}
function applyMask(g, W, H, mk) {
  g.save(); g.globalCompositeOperation = mk.inv ? "destination-out" : "destination-in";
  if (mk.feather > 0) g.filter = `blur(${Math.round(mk.feather * Math.min(W, H))}px)`;
  g.fillStyle = "#fff"; maskPath(g, W, H, mk); g.fill(); g.restore();
}

/* Put media on the first track of its kind that is free at time `at`; add a track if none is. */
/* Put media on ONE track only: the track it was dropped on, or the main track (V1 / A1) for the + button.
   It never jumps to another layer and never creates tracks by itself. */
function insertMedia(mid, at = null, trId = null) {
  const m = media.get(mid), kind = m.kind === "a" ? "a" : "v";
  const c = {id:uid(), m:mid, tr:null, start:0, a:0, b:m.kind === "i" ? m.still : m.dur, speed:1, vol:m.kind === "i" ? 0 : 1, op:1, sc:1, x:0, y:0, rot:0, fi:0, fo:0, tin:null, kf:null, col:null};
  const main = kind === "v" ? tracks.filter(t => t.kind === "v").pop() : tracks.find(t => t.kind === "a");
  const tr = (trId && trk(trId) && trk(trId).kind === kind) ? trk(trId) : main;
  if (tr.lock) return toast(`${tr.id} is locked. Unlock it to add clips.`);
  const trackEnd = Math.max(0, ...clips.filter(o => o.tr === tr.id).map(endOf));
  if (at === null) c.start = trackEnd; /* + button: add after the last clip on the track */
  else {
    c.start = Math.ceil(Math.max(0, at) * FPS - 1e-3) / FPS;
    const near = clips.find(o => o.tr === tr.id && endOf(o) > c.start && endOf(o) - c.start <= 1.01 / FPS);
    if (near) c.start = endOf(near);
    if (overlaps(c, tr.id)) { c.start = trackEnd; toast(`No room there, so it went to the end of ${tr.id}`); }
  }
  commit();
  c.tr = tr.id; clips.push(c); sel = {type:"clip", id:c.id};
  refresh(); fitOnce();
  return c;
}
function addTrack(kind, silent) {
  if (!silent) commit();
  const n = tracks.filter(t => t.kind === kind).length + 1, id = (kind === "v" ? "V" : "A") + n;
  const t = {id, kind, hide:false, mute:false, lock:false};
  if (kind === "v") tracks.unshift(t); else tracks.push(t);
  if (!silent) refresh();
  return t;
}
function removeTrack(id) {
  const t = trk(id), same = tracks.filter(k => k.kind === t.kind);
  if (same.length <= 1) return toast("Keep at least one track of each kind");
  if (clips.some(c => c.tr === id) && !confirm(`Remove track ${id} and the clips on it?`)) return;
  commit(); tracks = tracks.filter(k => k !== t); clips = clips.filter(c => c.tr !== id); refresh();
}

/* ---------- Editing ---------- */
function splitClip(c, t) {
  const st = fq(t), L = c.a + (st - c.start) * c.speed;
  if (L - c.a < 1 / FPS || c.b - L < 1 / FPS) return null;
  const d = {...c, id:uid(), a:L, start:st, tin:null, fi:0}; c.b = L; c.fo = 0;
  if (c.kf) { const off = st - c.start; d.kf = {}; for (const k in c.kf) d.kf[k] = c.kf[k].map(p => ({t:p.t - off, v:p.v})); }
  clips.push(d); return d;
}
function split() {
  const o = findSel();
  if (o && sel.type === "text") {
    if (T > o.s + 1 / FPS && T < o.e - 1 / FPS) { commit(); const y = {...o, id:uid(), s:T}; o.e = T; texts.push(y); sel = {type:"text", id:y.id}; refresh(); return; }
  }
  /* A selected clip under the playhead splits alone; otherwise every unlocked clip under the playhead splits. */
  let targets = o && sel.type === "clip" && T > o.start && T < endOf(o) ? [o] : activeAt(T).filter(c => !trk(c.tr).lock);
  if (!targets.length) return toast("Move the playhead over a clip to split it");
  commit(); let last = null;
  targets.forEach(c => { const d = splitClip(c, T); if (d) last = d; });
  if (last) sel = {type:"clip", id:last.id};
  refresh(); toast("Split at " + tc(T));
}
function del(ripple = false) {
  const o = findSel(); if (!o) return toast("Select a clip or text first");
  commit();
  if (sel.type === "clip") {
    clips = clips.filter(c => c !== o);
    if (ripple) { const L = len(o); clips.forEach(c => { if (c.tr === o.tr && c.start >= endOf(o) - 1e-6) c.start = fq(c.start - L); }); }
  } else texts = texts.filter(x => x !== o);
  sel = null; refresh();
}
function dup() {
  const o = findSel(); if (!o) return toast("Select a clip or text first");
  commit();
  if (sel.type === "clip") {
    const c = {...o, id:uid(), start:endOf(o)};
    if (overlaps(c)) { const free = tracks.find(t => t.kind === trk(o.tr).kind && !t.lock && !overlaps(c, t.id)); c.tr = free ? free.id : addTrack(trk(o.tr).kind, true).id; }
    clips.push(c); sel = {type:"clip", id:c.id};
  } else { const L = o.e - o.s, x = {...o, id:uid(), s:o.e, e:o.e + L}; texts.push(x); sel = {type:"text", id:x.id}; }
  refresh();
}
const TPL = {
  title:{text:"Your title", size:11, bold:true, bg:false, y:.45, font:"sans"},
  sub:{text:"Your caption", size:5.5, bold:false, bg:true, y:.86, font:"sans"},
  lower:{text:"Name Surname\nRole or place", size:4.5, bold:true, bg:true, y:.8, x:.24, font:"sans", bgc:"rgba(79,140,255,.9)"},
  plain:{text:"Your text", size:7, bold:false, bg:false, y:.5, font:"sans"}
};
function addText(kind = "sub") {
  commit();
  const s = fq(T), x = {id:uid(), s, e:s + 3, x:.5, y:.82, size:7, color:"#ffffff", bg:true, bold:true, font:"sans", bgc:"rgba(0,0,0,.6)", ...TPL[kind]};
  texts.push(x); sel = {type:"text", id:x.id}; refresh();
  setTimeout(() => { const ta = $(".props textarea"); if (ta) { ta.focus(); ta.select(); } }, 30);
}
function detachAudio() {
  const o = findSel(); if (!o || sel.type !== "clip") return;
  const m = media.get(o.m); if (m.kind !== "v") return;
  commit();
  const a = {...o, id:uid(), tr:null, op:1, sc:1, x:0, y:0};
  const tr = tracks.find(t => t.kind === "a" && !t.lock && !overlaps(a, t.id)) || addTrack("a", true);
  a.tr = tr.id; clips.push(a); o.vol = 0; sel = {type:"clip", id:a.id}; refresh(); toast("Audio moved to " + tr.id);
}
function trimTo(which) {
  const o = findSel(); if (!o || sel.type !== "clip") return;
  if (T <= o.start || T >= endOf(o)) return toast("Put the playhead inside this clip first");
  commit(); const L = localAt(o, T);
  if (which === "in") { o.a = L; o.start = fq(T); } else o.b = L;
  refresh();
}

/* ---------- Timeline ---------- */
const scroller = $(".tlscroll"), inner = $(".tlinner"), ruler = $(".ruler"), rows = $(".rows"), heads = $(".tlheads"), zm = $(".zm");
const ppsFromZoom = z => 4 * Math.pow(600 / 4, z / 100);
const zoomFromPps = p => clamp(100 * Math.log(p / 4) / Math.log(600 / 4), 0, 100);
function setZoom(z, keepT = T) { const rel = keepT * pps - scroller.scrollLeft; zm.value = z; pps = ppsFromZoom(+z); renderTimeline(); updateTime(); scroller.scrollLeft = keepT * pps - rel; }
function fit() { const D = total() || 10; setZoom(zoomFromPps((scroller.clientWidth - 40) / D), 0); scroller.scrollLeft = 0; }
let fitted = false; const fitOnce = () => { if (!fitted && total() > 0) { fitted = true; fit(); } };

function renderRuler(width) {
  const steps = [1 / FPS, 2 / FPS, 5 / FPS, 10 / FPS, .5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const maj = steps.find(s => s * pps >= 80) || 600, sub = maj <= 10 / FPS ? 1 / FPS : maj / 5;
  let h = ""; const n = Math.ceil(width / pps / sub);
  for (let i = 0; i <= n && i < 8000; i++) {
    const t = i * sub, isMaj = Math.abs(t / maj - Math.round(t / maj)) < 1e-6;
    h += `<i class="tk ${isMaj ? "maj" : "min"}" style="left:${t * pps}px"></i>`;
    if (isMaj) h += `<span class="lb" style="left:${t * pps}px">${maj < 1 ? tc(t).slice(3) : short(t)}</span>`;
  }
  if (pps / FPS >= 5 && sub > 1 / FPS) {
    const f0 = Math.floor(scroller.scrollLeft / pps * FPS), f1 = Math.ceil((scroller.scrollLeft + scroller.clientWidth) / pps * FPS);
    for (let f = f0; f <= f1; f++) h += `<i class="tk fr" style="left:${f / FPS * pps}px"></i>`;
  }
  h += markers.map(m => `<b class="mk" data-mk="${m.id}" style="left:${m.t * pps}px;--c:${MKC[m.color]}" title="${esc(m.label)} · ${tc(m.t)}"></b>`).join("");
  ruler.innerHTML = h;
}
function clipCanvas(c, W, H, kind) {
  const m = media.get(c.m), can = document.createElement("canvas"); can.width = W; can.height = H; can.className = "thc"; can.style.width = W + "px";
  const gg = can.getContext("2d");
  if (kind === "v" && m.thumbs.length) {
    const tw = Math.round(H * m.w / m.h);
    for (let x = 0; x < W; x += tw) { const lt = c.a + (x + tw / 2) / pps * c.speed, th = m.thumbs[Math.min(m.thumbs.length - 1, Math.floor(lt / m.step))]; if (th) gg.drawImage(th, x, 0, tw, H); }
  } else if (m.peaks) {
    gg.fillStyle = c.vol === 0 || trk(c.tr).mute ? "#ffffff40" : "#6ee7b0"; const mid = H / 2 + 4, amp = (H - 14) / 2 * Math.min(1.6, c.vol || .05);
    for (let x = 0; x < W; x++) { const lt = c.a + x / pps * c.speed, p = m.peaks[Math.floor(lt * 100)] || 0; gg.fillRect(x, mid - p * amp, 1, Math.max(1, p * amp * 2)); }
  }
  return can;
}
function renderTimeline() {
  const width = Math.max(scroller.clientWidth, total() * pps + 300);
  inner.style.width = width + "px";
  renderRuler(width);
  /* Track headers */
  heads.innerHTML = `<div class="rh"></div><div class="th-row t"><span>T1</span><button class="ib" data-th="hide" data-id="T" title="Show / hide text" aria-label="Show or hide text">${textTrack.hide ? IC.eyeoff : IC.eye}</button><button class="ib" data-th="lock" data-id="T" title="Lock" aria-label="Lock text track">${textTrack.lock ? IC.lock : IC.unlock}</button></div>` +
    tracks.map(t => `<div class="th-row ${t.kind}"><span>${t.id}</span>${t.kind === "v" ? `<button class="ib" data-th="hide" data-id="${t.id}" title="Show / hide" aria-label="Show or hide ${t.id}">${t.hide ? IC.eyeoff : IC.eye}</button>` : ""}<button class="ib" data-th="mute" data-id="${t.id}" title="Mute" aria-label="Mute ${t.id}">${t.mute ? IC.mute : IC.vol}</button><button class="ib" data-th="lock" data-id="${t.id}" title="Lock" aria-label="Lock ${t.id}">${t.lock ? IC.lock : IC.unlock}</button><button class="ib" data-th="rm" data-id="${t.id}" title="Remove track" aria-label="Remove ${t.id}">${IC.x}</button></div>`).join("");
  /* Rows */
  rows.innerHTML = "";
  const trow = document.createElement("div"); trow.className = "track t" + (textTrack.hide ? " off" : ""); trow.dataset.track = "T"; rows.appendChild(trow);
  /* overlapping text/shape layers stack into lanes so none hides another */
  const laneEnd = [], lane = new Map();
  [...texts].sort((a, b) => a.s - b.s).forEach(x => { let i = laneEnd.findIndex(e => e <= x.s + 1e-4); if (i < 0) { i = laneEnd.length; laneEnd.push(0); } laneEnd[i] = x.e; lane.set(x.id, i); });
  const lanes = Math.max(1, laneEnd.length), tH = lanes * 28 + 6;
  trow.style.height = tH + "px"; $(".th-row.t", heads).style.height = tH + "px";
  texts.forEach(x => {
    const el = document.createElement("div");
    el.style.top = 3 + lane.get(x.id) * 28 + "px"; el.style.bottom = "auto"; el.style.height = "25px";
    el.className = "clip txt" + (sel && sel.id === x.id ? " sel" : ""); el.dataset.id = x.id; el.dataset.type = "text";
    el.style.left = x.s * pps + "px"; el.style.width = Math.max(6, (x.e - x.s) * pps) + "px";
    el.innerHTML = `<span class="lab">${x.shape ? "◆ " + SHAPES[x.shape] : "T " + esc(x.text.split("\n")[0])}</span><div class="h l" data-h="l"></div><div class="h r" data-h="r"></div>`;
    trow.appendChild(el);
  });
  for (const t of tracks) {
    const row = document.createElement("div"); row.className = `track ${t.kind}` + (t.hide || t.mute ? " off" : ""); row.dataset.track = t.id; rows.appendChild(row);
    const H = t.kind === "v" ? 46 : 34;
    clips.filter(c => c.tr === t.id).forEach(c => {
      const m = media.get(c.m), L = len(c), el = document.createElement("div");
      el.className = "clip" + (m.kind === "adj" ? " adj" : "") + (sel && sel.id === c.id ? " sel" : ""); el.dataset.id = c.id; el.dataset.type = "clip";
      el.style.left = c.start * pps + "px"; el.style.width = Math.max(4, L * pps) + "px";
      el.appendChild(clipCanvas(c, Math.min(16000, Math.max(4, Math.round(L * pps))), H, t.kind));
      const kfs = c.kf ? [...new Set(Object.values(c.kf).flat().map(p => Math.round(p.t * 1000) / 1000))] : [];
      el.insertAdjacentHTML("beforeend", `${c.fi ? `<i class="fade in" style="width:${c.fi * pps}px"></i>` : ""}${c.fo ? `<i class="fade out" style="width:${c.fo * pps}px"></i>` : ""}${c.tin && c.tin.type ? `<i class="trn" style="width:${c.tin.d * pps}px" title="${c.tin.type} transition"></i>` : ""}${kfs.map(k => `<i class="kfd" style="left:${k * pps}px"></i>`).join("")}<span class="lab">${c.fx && c.fx.length ? "✦ " : ""}${(c.col && (c.col.p !== "none" || c.col.b !== 1 || c.col.c !== 1 || c.col.s !== 1 || c.col.h || c.col.bl)) || !gradeIsDefault(c.gr) ? "◐ " : ""}${esc(m.name)}${c.speed !== 1 ? " · " + c.speed + "×" : ""}${c.vol === 0 && m.kind !== "i" && m.kind !== "adj" ? " · muted" : ""}</span><div class="h l" data-h="l"></div><div class="h r" data-h="r"></div>`);
      row.appendChild(el);
    });
  }
  $('[data-act="export"]').disabled = !clips.length;
  $(".viewer .hint").hidden = clips.length > 0 || texts.length > 0;
}
function refresh() { pv.prune(); renderTimeline(); renderProps(); renderMarkers(); if (pvMix) pvMix.update(); if (mixerOn) renderMixer(); setT(T); }
scroller.addEventListener("scroll", () => { if (pps / FPS >= 5) renderRuler(inner.offsetWidth); }, {passive:true});

const xToT = clientX => Math.max(0, (clientX - inner.getBoundingClientRect().left) / pps);
function snapT(t, ignore) {
  if (!snapOn) return fq(t);
  const pts = [0, T]; clips.forEach(c => { if (c !== ignore) pts.push(c.start, endOf(c)); }); texts.forEach(x => { if (x !== ignore) pts.push(x.s, x.e); });
  let best = null, bd = 8 / pps; for (const p of pts) { const d = Math.abs(p - t); if (d < bd) { bd = d; best = p; } }
  return best !== null ? best : fq(t);
}
function scrub(e) {
  if (playing) pause();
  const mv = ev => setT(xToT(ev.clientX)); mv(e);
  const up = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); };
  window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
}
ruler.addEventListener("pointerdown", e => { const mk = e.target.closest(".mk"); if (mk) { const m = markers.find(k => k.id === mk.dataset.mk); if (m) { if (playing) pause(); setT(m.t); } return; } scrub(e); });
const rowAt = y => $$(".track", rows).find(r => { const b = r.getBoundingClientRect(); return y >= b.top && y < b.bottom; });

rows.addEventListener("pointermove", e => { if (tool === "razor") $(".razorline").style.left = snapT(xToT(e.clientX)) * pps + "px"; });
rows.addEventListener("pointerdown", e => {
  const el = e.target.closest(".clip");
  if (!el) { sel = null; renderTimeline(); renderProps(); scrub(e); return; }
  e.preventDefault(); if (playing) pause();
  const isText = el.dataset.type === "text";
  const o = isText ? texts.find(k => k.id === el.dataset.id) : clips.find(k => k.id === el.dataset.id); if (!o) return;
  const locked = isText ? textTrack.lock : trk(o.tr).lock;
  sel = {type:isText ? "text" : "clip", id:o.id};
  if (tool === "razor" && !locked) {
    const t = snapT(xToT(e.clientX), null); commit();
    if (isText) { if (t > o.s + 1 / FPS && t < o.e - 1 / FPS) { const y = {...o, id:uid(), s:t}; o.e = t; texts.push(y); } }
    else splitClip(o, t);
    T = t; refresh(); return;
  }
  $$(".clip.sel", rows).forEach(k => k.classList.remove("sel")); el.classList.add("sel");
  if (locked) { renderProps(); setT(xToT(e.clientX)); return; }
  const h = e.target.dataset.h, x0 = e.clientX, snap0 = snapshot(), o0 = {...o};
  let moved = false;
  /* ripple: later clips on this track; track-forward: every clip and text that starts at or after this one */
  const later = !isText ? clips.filter(k => k !== o && k.tr === o.tr && k.start >= endOf(o0) - 1e-4).map(k => [k, k.start]) : [];
  const fwdGroup = !isText && tool === "fwd" && !h ? [...clips.filter(k => k !== o && k.start >= o0.start - 1e-4 && !trk(k.tr).lock).map(k => [k, k.start]), ...texts.filter(x => x.s >= o0.start - 1e-4 && !textTrack.lock).map(x => [x, x.s])] : [];
  const onMove = ev => {
    const dx = ev.clientX - x0; if (!moved && Math.abs(dx) < 4) return; moved = true;
    const dt = dx / pps;
    if (isText) {
      if (h === "l") o.s = clamp(snapT(o0.s + dt, o), 0, o.e - 1 / FPS);
      else if (h === "r") o.e = Math.max(o.s + 1 / FPS, snapT(o0.e + dt, o));
      else { const L = o0.e - o0.s; let ns = snapT(o0.s + dt, o); const ne = snapT(o0.e + dt, o); if (Math.abs(ne - (o0.e + dt)) < Math.abs(ns - (o0.s + dt))) ns = ne - L; o.s = Math.max(0, ns); o.e = o.s + L; }
    } else {
      const m = media.get(o.m);
      if (tool === "ripple" && h) { /* ripple trim: the clip keeps its start; everything after it on the track follows the new end */
        if (h === "l") { o.start = o0.start; o.a = clamp(o0.a + dt * o.speed, 0, o0.b - o.speed / FPS); }
        else o.b = clamp(o0.b + dt * o.speed, o0.a + o.speed / FPS, m.dur);
        o.a = Math.round(o.a * FPS) / FPS; o.b = Math.max(o.a + o.speed / FPS, Math.round(o.b * FPS) / FPS);
        const d = len(o) - len(o0); later.forEach(([k, s0]) => { k.start = Math.max(0, s0 + d); });
      } else if (tool === "slip" && !h) { /* slip: same place and length on the timeline, different part of the source */
        if (m.kind === "i" || m.kind === "adj") { toast("Slip works on video and audio clips"); return; }
        const span = o0.b - o0.a; o.a = clamp(Math.round((o0.a - dt * o.speed) * FPS) / FPS, 0, Math.max(0, m.dur - span)); o.b = o.a + span;
        T = clamp(T, o.start, endOf(o) - 1 / FPS);
      } else if (tool === "fwd" && !h) { /* move this clip and everything after it */
        const ns = Math.max(0, snapT(o0.start + dt, o)); let d = ns - o0.start;
        const minStart = Math.min(...fwdGroup.map(([, s0]) => s0), o0.start); if (minStart + d < 0) d = -minStart;
        o.start = o0.start + d; fwdGroup.forEach(([k, s0]) => { if ("s" in k && "e" in k && !("tr" in k)) { const L = k.e - k.s; k.s = s0 + d; k.e = k.s + L; } else k.start = s0 + d; });
      } else
      if (h === "l") { /* trim the head: start moves with the in point */
        const nt = clamp(snapT(o0.start + dt, o), o0.start - o0.a / o.speed, endOf(o0) - 1 / FPS);
        o.start = nt; o.a = o0.a + (nt - o0.start) * o.speed;
      } else if (h === "r") { const ne = clamp(snapT(endOf(o0) + dt, o), o.start + 1 / FPS, o.start + (m.dur - o.a) / o.speed); o.b = o.a + (ne - o.start) * o.speed; }
      else {
        let ns = snapT(o0.start + dt, o); const ne = snapT(endOf(o0) + dt, o);
        if (Math.abs(ne - (endOf(o0) + dt)) < Math.abs(ns - (o0.start + dt))) ns = ne - len(o);
        o.start = Math.max(0, ns);
        const r = rowAt(ev.clientY); if (r && r.dataset.track !== "T") { const t2 = trk(r.dataset.track); if (t2.kind === trk(o0.tr).kind && !t2.lock) o.tr = t2.id; }
      }
    }
    renderTimeline(); const ne2 = $(`.clip[data-id="${o.id}"]`, rows);
    if (ne2) { ne2.classList.add("sel"); if (!h) ne2.classList.add("dragging"); if (!isText && overlaps(o)) ne2.classList.add("bad"); }
    if (h) setT(h === "l" ? (isText ? o.s : o.start) : (isText ? o.e : endOf(o)) - 1 / FPS); else paint();
  };
  const onUp = ev => {
    window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp);
    if (!moved) { renderProps(); setT(xToT(ev.clientX)); return; }
    const movedSet = [o, ...later.map(([k]) => k), ...fwdGroup.map(([k]) => k)].filter(k => "tr" in k);
    if (!isText && movedSet.some(k => overlaps(k))) { restore(snap0); toast(tool === "fwd" ? "That would run into a clip that isn't moving. Try a smaller move." : "Clips can't overlap on the same track. Drop it on a free spot or another track."); return; }
    pushSnap(snap0); refresh();
  };
  window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp);
});
heads.addEventListener("click", e => {
  const b = e.target.closest("[data-th]"); if (!b) return;
  const k = b.dataset.th, id = b.dataset.id;
  if (k === "rm") return removeTrack(id);
  commit();
  const t = id === "T" ? textTrack : trk(id); t[k] = !t[k];
  refresh();
});
/* Drag from the media bin to a track */
rows.addEventListener("dragover", e => {
  if (![...e.dataTransfer.types].includes("text/x-media")) return;
  e.preventDefault(); e.dataTransfer.dropEffect = "copy";
  $$(".track.drop-ok", rows).forEach(r => r.classList.remove("drop-ok")); const r = rowAt(e.clientY); if (r) r.classList.add("drop-ok");
});
rows.addEventListener("dragleave", () => $$(".track.drop-ok", rows).forEach(r => r.classList.remove("drop-ok")));
rows.addEventListener("drop", e => {
  const id = e.dataTransfer.getData("text/x-media"); if (!id) return; e.preventDefault();
  $$(".track.drop-ok", rows).forEach(r => r.classList.remove("drop-ok"));
  const r = rowAt(e.clientY), m = media.get(id), want = m.kind === "a" ? "a" : "v";
  const tr = r && r.dataset.track !== "T" && trk(r.dataset.track).kind === want ? r.dataset.track : null;
  insertMedia(id, snapT(xToT(e.clientX), null), tr);
});

/* Drag text on the monitor */
cv.addEventListener("pointerdown", e => {
  const r = cv.getBoundingClientRect(), px = (e.clientX - r.left) / r.width * cv.width, py = (e.clientY - r.top) / r.height * cv.height;
  const hit = [...texts].reverse().find(x => { if (T < x.s || T >= x.e) return false; const b = textBox(g, cv.width, cv.height, x); return px >= b.l && px <= b.l + b.bw && py >= b.t && py <= b.t + b.bh; });
  if (!hit) return;
  e.preventDefault(); if (playing) pause();
  sel = {type:"text", id:hit.id}; renderTimeline(); renderProps(); paint();
  if (textTrack.lock) return;
  const ox = hit.x, oy = hit.y, x0 = e.clientX, y0 = e.clientY, snap0 = snapshot();
  const mv = ev => { hit.x = clamp(ox + (ev.clientX - x0) / r.width, 0, 1); hit.y = clamp(oy + (ev.clientY - y0) / r.height, 0, 1); paint(); };
  const up = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); pushSnap(snap0); renderProps(); };
  window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
});

/* ---------- Inspector ---------- */
const rng = (k, label, min, max, st, v, fmt) => `<div class="f"><label>${label} <output>${fmt(v)}</output></label><input type="range" min="${min}" max="${max}" step="${st}" value="${v}" data-k="${k}"></div>`;
const pct = v => Math.round(v * 100) + "%";
const DEFCOL = {p:"none", b:1, c:1, s:1, h:0, bl:0};
const col = o => o.col || DEFCOL;
const relT = o => clamp(T - o.start, 0, len(o));
const kfAt = (o, k) => o.kf && o.kf[k] ? o.kf[k].find(p => Math.abs(p.t - relT(o)) < .5 / FPS) : null;
function rngK(k, label, min, max, st, o, fmt) {
  const v = valAt(o, k, clamp(T, o.start, endOf(o))), has = o.kf && o.kf[k] && o.kf[k].length;
  return `<div class="f"><label><span>${label} <output>${fmt(v)}</output></span><span class="kfbtn">${has ? `<button data-kf="prev" data-kk="${k}" title="Previous keyframe" aria-label="Previous ${label} keyframe">‹</button>` : ""}<button data-kf="toggle" data-kk="${k}" class="${kfAt(o, k) ? "on" : ""}" title="Add / remove keyframe at playhead" aria-label="Toggle ${label} keyframe">◆</button>${has ? `<button data-kf="next" data-kk="${k}" title="Next keyframe" aria-label="Next ${label} keyframe">›</button>` : ""}</span></label><input type="range" min="${min}" max="${max}" step="${st}" value="${v}" data-k="${k}"></div>`;
}
function setKf(o, k, v) {
  o.kf = o.kf || {}; const arr = o.kf[k] = o.kf[k] || [], r = Math.round(relT(o) * FPS) / FPS;
  const p = arr.find(q => Math.abs(q.t - r) < .5 / FPS); if (p) p.v = v; else { arr.push({t:r, v}); arr.sort((a, b) => a.t - b.t); }
}
function kfAction(act, k) {
  const o = findSel(); if (!o || sel.type !== "clip") return;
  if (act === "toggle") {
    if (T < o.start || T > endOf(o)) return toast("Put the playhead inside this clip first");
    commit(); const p = kfAt(o, k);
    if (p) { o.kf[k] = o.kf[k].filter(q => q !== p); if (!o.kf[k].length) { delete o.kf[k]; } }
    else setKf(o, k, valAt(o, k, T));
    refresh(); return;
  }
  const arr = (o.kf && o.kf[k]) || [], r = relT(o);
  const n = act === "next" ? arr.find(p => p.t > r + .5 / FPS) : [...arr].reverse().find(p => p.t < r - .5 / FPS);
  if (n) { setT(o.start + n.t); renderProps(); }
}
/* ---------- Effects UI ---------- */
function fxFmt(p) { return v => p.opts ? p.opts[Math.round(v)] : p.u === "°" ? Math.round(v) + "°" : p.px ? (+v).toFixed(p.step < 1 ? 1 : 0) + " px" : Math.abs(p.max) <= 1 && p.min >= -1 ? Math.round(v * 100) + "%" : (+v).toFixed(p.step < 1 ? (p.step < .1 ? 2 : 1) : 0); }
function fxSection(o) {
  if (!window.FX) return "";
  const list = o.fx || [];
  const opts = FX.CATS.map(cat => `<optgroup label="${cat}">${FX.LIB.filter(e => e.cat === cat).map(e => `<option value="${e.id}">${e.name}</option>`).join("")}</optgroup>`).join("");
  return `<div class="sec"><b>Effects${list.length ? ` (${list.length})` : ""}</b>
    <div class="f"><select data-fxadd aria-label="Add an effect"><option value="">+ Add an effect…</option>${opts}</select></div>
    ${list.map((e, i) => { const d = FX.byId[e.id]; if (!d) return "";
      return `<div class="fxcard${e.on === false ? " off" : ""}"><div class="fxh"><label><input type="checkbox" data-k="fx.${i}.on"${e.on !== false ? " checked" : ""} aria-label="Turn ${d.name} on or off"><b>${d.name}</b></label>
        <button data-fxmv="${i}:-1" title="Move up" aria-label="Move ${d.name} up"${i ? "" : " disabled"}>↑</button><button data-fxmv="${i}:1" title="Move down" aria-label="Move ${d.name} down"${i < list.length - 1 ? "" : " disabled"}>↓</button><button data-fxdel="${i}" title="Remove effect" aria-label="Remove ${d.name}">✕</button></div>
        ${d.params.map(p => p.opts ? `<div class="f"><label>${p.l}</label><select data-k="fx.${i}.${p.k}">${p.opts.map((l, n) => `<option value="${n}"${Math.round(e[p.k]) === n ? " selected" : ""}>${l}</option>`).join("")}</select></div>`
          : rng(`fx.${i}.${p.k}`, p.l, p.min, p.max, p.step, e[p.k] ?? p.def, fxFmt(p))).join("")}
        ${(d.cols || []).map(cdef => `<div class="f"><label>${cdef.l}</label><div style="display:flex;gap:6px"><input type="color" data-k="fx.${i}.${cdef.k}" value="${e[cdef.k] || cdef.def}" style="flex:1;height:31px;border:1px solid var(--line);border-radius:6px;padding:2px;background:var(--surface)">${cdef.pick ? `<button class="btn ghost small" data-fxpick="${i}" title="Click the background colour in the monitor">Pick from video</button>` : ""}</div></div>`).join("")}
      </div>`; }).join("")}
    ${list.length ? "" : `<p class="empty-note" style="font-size:.76rem;margin:0">Blur, glow, vintage film, green screen and more. Or use the Effects tab on the left.</p>`}</div>`;
}
function maskSection(o) {
  const mk = {...defMask(), ...(o.mask || {})}, ms = (k, l, min, max, st, fmt) => rng("mask." + k, l, min, max, st, mk[k], fmt);
  return `<div class="sec"><b>Mask</b><label class="fxon"><input type="checkbox" data-k="mask.on"${mk.on ? " checked" : ""}> Show only part of this ${media.get(o.m).kind === "adj" ? "effect" : "clip"}</label>
    ${mk.on ? `<div class="row2"><div class="f"><label>Shape</label><select data-k="mask.shape"><option value="ellipse"${mk.shape === "ellipse" ? " selected" : ""}>Ellipse</option><option value="rect"${mk.shape === "rect" ? " selected" : ""}>Rectangle</option></select></div>
      <div class="f"><span class="l">Invert</span><label class="fxon" style="margin:6px 0 0"><input type="checkbox" data-k="mask.inv"${mk.inv ? " checked" : ""}> Hide inside instead</label></div></div>
      ${ms("x", "Centre X", 0, 1, .005, pct)}${ms("y", "Centre Y", 0, 1, .005, pct)}${ms("w", "Width", .02, 1.5, .005, pct)}${ms("h", "Height", .02, 1.5, .005, pct)}${ms("feather", "Soft edge", 0, .25, .005, pct)}
      <p class="empty-note" style="font-size:.74rem;margin:0">The dashed outline on the monitor shows the mask while this clip is selected.</p>` : ""}</div>`;
}
function trOptions(cur) {
  const groups = window.FX ? FX.TRCATS.map(cat => `<optgroup label="${cat}">${FX.TR.filter(x => x.cat === cat).map(x => `<option value="${x.id}"${cur === x.id ? " selected" : ""}>${x.name}</option>`).join("")}</optgroup>`).join("") : "";
  return `<option value=""${cur ? "" : " selected"}>None (cut)</option>` + groups;
}
/* Put a transition at the start of a clip (blending from the clip before it on the same track). */
function applyTr(id, clip) {
  const o = clip || (sel && sel.type === "clip" ? findSel() : null);
  if (!o || trk(o.tr).kind !== "v") return toast("Select the video or photo clip the transition should lead into");
  commit(); o.tin = {type:id, d:Math.min((o.tin && o.tin.d) || 1, len(o))}; sel = {type:"clip", id:o.id};
  refresh(); showSec("Transition"); toast(`${FX.trById[id].name} added at the start of ${media.get(o.m).name}` + (prevAdj(o) ? "" : " (no clip right before it, so it blends from the tracks below)"));
}
function trAll() {
  const o = findSel(); if (!o || !o.tin || !o.tin.type) return;
  const cuts = clips.filter(c => c !== o && trk(c.tr).kind === "v" && prevAdj(c));
  if (!cuts.length) return toast("There are no other cuts between clips yet");
  commit(); cuts.forEach(c => { c.tin = {type:o.tin.type, d:Math.min(o.tin.d, len(c), len(prevAdj(c)))}; });
  refresh(); toast(`${FX.trById[o.tin.type].name} applied to ${cuts.length} cut${cuts.length > 1 ? "s" : ""}`);
}
function applyFx(id, clip) {
  if (!window.FX || !FX.supported()) return toast("Effects need a browser with WebGL (graphics card support).");
  const o = clip || (sel && sel.type === "clip" ? findSel() : null);
  if (!o || trk(o.tr).kind !== "v") return toast("Select a video or photo clip on the timeline first");
  commit(); o.fx = [...(o.fx || []), FX.defaults(id)]; sel = {type:"clip", id:o.id};
  refresh(); showSec("Effects"); toast(FX.byId[id].name + " added to " + media.get(o.m).name);
}
function renderFxLib() {
  const box = $(".fxlib"); if (!box || !window.FX) return;
  const q = ($(".fxsearch").value || "").trim().toLowerCase();
  const trHtml = FX.TRCATS.map(cat => { const items = FX.TR.filter(x => !q || x.name.toLowerCase().includes(q) || cat.toLowerCase().includes(q) || "transition".includes(q)).filter(x => x.cat === cat);
    return items.length ? `<h4>Transition · ${cat}</h4><div class="fxg">${items.map(x => `<button draggable="true" data-tr="${x.id}" class="tr" title="Add ${x.name} at the start of the selected clip">${x.name}</button>`).join("")}</div>` : ""; }).join("");
  box.innerHTML = trHtml + FX.CATS.map(cat => { const items = FX.LIB.filter(e => e.cat === cat && (!q || e.name.toLowerCase().includes(q) || cat.toLowerCase().includes(q)));
    return items.length ? `<h4>${cat}</h4><div class="fxg">${items.map(e => `<button draggable="true" data-fx="${e.id}"${e.id === "chromakey" ? ' class="key"' : ""} title="Add ${e.name} to the selected clip">${e.name}</button>`).join("")}</div>` : ""; }).join("")
    || "";
  if (!box.innerHTML.trim()) box.innerHTML = `<p class="empty-note">Nothing matches "${esc(q)}".</p>`;
}
let pickFx = null;
function startPick(i) { pickFx = i; document.body.classList.add("picking"); if (playing) pause(); toast("Click the background colour you want to remove, in the monitor"); }
cv.addEventListener("pointerdown", e => {
  if (pickFx === null) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const o = findSel(), i = pickFx; pickFx = null; document.body.classList.remove("picking");
  if (!o || !o.fx || !o.fx[i]) return;
  const r = cv.getBoundingClientRect(), x = Math.round((e.clientX - r.left) / r.width * cv.width), y = Math.round((e.clientY - r.top) / r.height * cv.height);
  noFx = true; paint(); const px = g.getImageData(clamp(x, 0, cv.width - 1), clamp(y, 0, cv.height - 1), 1, 1).data; noFx = false;
  commit(); o.fx[i].k1 = "#" + [px[0], px[1], px[2]].map(n => n.toString(16).padStart(2, "0")).join(""); refresh(); toast("Key colour set to " + o.fx[i].k1);
}, true);
function renderProps() {
  const box = $(".props"), o = findSel();
  if (!o) {
    const [W, H] = outSize(1080);
    box.innerHTML = `<div class="sec" style="border:0;margin-top:0;padding-top:0"><b>Timeline</b>
      <div class="f"><span class="l">Frame size <output>${W}×${H}</output></span></div><div class="f"><span class="l">Frame rate <output>${FPS} fps</output></span></div>
      <div class="f"><span class="l">Length <output>${tc(total())}</output></span></div><div class="f"><span class="l">Clips <output>${clips.length} · text ${texts.length}</output></span></div></div>
      <p class="empty-note">Select a clip or text to edit it.<br><br>Put the playhead where you want to cut and press <kbd>S</kbd>, or pick the razor <kbd>C</kbd> and click a clip. Use <kbd>←</kbd> <kbd>→</kbd> to move one frame.</p>`;
    return;
  }
  if (sel.type === "track") { box.innerHTML = trackAudioProps(o); return; }
  if (sel.type === "clip" && media.get(o.m).kind === "adj") {
    box.innerHTML = `<div class="f"><span class="l">${o.tr} · Adjustment layer</span><span style="font-size:.8rem;color:var(--muted)">Effects and colour grading here change every layer underneath, for as long as this clip lasts.</span></div>
      <div class="sec"><b>Timing</b><div class="row2"><div class="f"><label>Starts at</label><input type="text" data-k="start" value="${tc(o.start)}"></div><div class="f"><label>Length</label><input type="text" data-k="b" value="${tc(o.b)}"></div></div></div>
      <div class="sec"><b>Strength</b>${rngK("op", "Effect strength", 0, 1, .01, o, pct)}<div class="row2">${rng("fi", "Fade in", 0, 3, .1, o.fi || 0, v => (+v).toFixed(1) + "s")}${rng("fo", "Fade out", 0, 3, .1, o.fo || 0, v => (+v).toFixed(1) + "s")}</div></div>
      ${fxSection(o)}${gradeSection(o)}${maskSection(o)}
      <div class="sec"><div class="row3"><button class="btn ghost small" data-act="split">Split</button><button class="btn ghost small" data-act="dup">Copy</button><button class="btn ghost small" data-act="del">Delete</button></div></div>`;
    return;
  }
  if (sel.type === "clip") {
    const m = media.get(o.m), isV = trk(o.tr).kind === "v";
    box.innerHTML = `<div class="f"><span class="l">${o.tr} · ${isV ? "Video" : "Audio"} clip</span><span style="font-size:.84rem;word-break:break-all">${esc(m.name)}</span></div>
      <div class="sec"><b>Timing</b>
      <div class="row2"><div class="f"><label>Starts at</label><input type="text" data-k="start" value="${tc(o.start)}"></div><div class="f"><label>Duration</label><input type="text" value="${tc(len(o))}" readonly></div></div>
      <div class="row2"><div class="f"><label>Source in</label><input type="text" data-k="a" value="${tc(o.a)}"></div><div class="f"><label>Source out</label><input type="text" data-k="b" value="${tc(o.b)}"></div></div>
      <div class="row2"><button class="btn ghost small" data-act="setin">Trim start here</button><button class="btn ghost small" data-act="setout">Trim end here</button></div>
      <div class="f" style="margin-top:10px"><label>Speed</label><select data-k="speed">${[.25, .5, .75, 1, 1.25, 1.5, 2, 3, 4].map(s => `<option value="${s}"${s === o.speed ? " selected" : ""}>${s}×</option>`).join("")}</select></div></div>
      ${m.kind !== "i" ? `<div class="sec"><b>Audio</b>${rngK("vol", "Volume", 0, 2, .05, o, pct)}${isV && m.kind === "v" ? `<button class="btn ghost small wide" data-act="detach">Detach audio to its own track</button>` : ""}</div>` : ""}
      <div class="sec"><b>Fade</b><div class="row2">${rng("fi", "Fade in", 0, 3, .1, o.fi || 0, v => (+v).toFixed(1) + "s")}${rng("fo", "Fade out", 0, 3, .1, o.fo || 0, v => (+v).toFixed(1) + "s")}</div></div>
      <div class="sec"><b>Transition in</b><div class="row2"><div class="f"><label>Type</label><select data-k="tin.type">${trOptions((o.tin && o.tin.type) || "")}</select></div>
        ${rng("tin.d", "Length", .2, 3, .1, (o.tin && o.tin.d) || 1, v => (+v).toFixed(1) + "s")}</div>
        <p class="empty-note" style="font-size:.76rem;margin:0">${prevAdj(o) ? "Blends from the clip just before this one on " + o.tr + "." : "No clip right before this one, so it blends from the tracks underneath."}</p>
        ${o.tin && o.tin.type ? `<button class="btn ghost small wide" data-act="trall" style="margin-top:8px">Apply this transition to every cut</button>` : ""}</div>
      ${isV ? `<div class="sec"><b>Transform <span style="text-transform:none;letter-spacing:0;font-weight:500">· ◆ adds a keyframe at the playhead</span></b>${rngK("op", "Opacity", 0, 1, .01, o, pct)}${rngK("sc", "Scale", .1, 3, .01, o, pct)}${rngK("x", "Position X", -1, 1, .005, o, pct)}${rngK("y", "Position Y", -1, 1, .005, o, pct)}${rngK("rot", "Rotation", -180, 180, 1, o, v => Math.round(v) + "°")}
        <div class="row2"><button class="btn ghost small" data-act="resetxf">Reset</button><button class="btn ghost small" data-act="clearkf">Clear keyframes</button></div></div>
      ${fxSection(o)}
      <div class="sec"><b>Picture in picture</b>
        <div class="pipg">${[["tl", "↖ Top left"], ["tr", "↗ Top right"], ["bl", "↙ Bottom left"], ["br", "↘ Bottom right"], ["left", "◧ Left half"], ["right", "◨ Right half"], ["center", "▣ Centre small"], ["full", "⛶ Full frame"]].map(([v, l]) => `<button class="btn ghost small" data-pip="${v}">${l}</button>`).join("")}</div>
        ${rng("bd", "Border", 0, .02, .001, o.bd || 0, v => Math.round(v * 1000) / 10 + "%")}
        <div class="row2"><div class="f"><label>Border colour</label><input type="color" data-k="bdc" value="${o.bdc || "#ffffff"}" style="width:100%;height:31px;border:1px solid var(--line);border-radius:6px;padding:2px;background:var(--bg)"></div>${rng("rad", "Rounded corners", 0, 1, .01, o.rad || 0, pct)}</div>
        <p class="empty-note" style="font-size:.76rem;margin:0">Put this clip on a track above another clip (V2 over V1) to see both.</p></div>
      ${maskSection(o)}
      <div class="sec"><b>Crop, rotate & fit</b>
        <div class="f"><label>Fit in frame</label><select data-k="fit">${[["contain", "Fit (show everything)"], ["cover", "Fill (crop edges)"], ["blur", "Fit on blurred background"]].map(([v, l]) => `<option value="${v}"${(o.fit || "contain") === v ? " selected" : ""}>${l}</option>`).join("")}</select></div>
        <div class="row2" style="margin-bottom:8px"><button class="btn ghost small" data-act="rotl">⟲ Rotate left</button><button class="btn ghost small" data-act="rotr">⟳ Rotate right</button></div>
        <div class="row2" style="margin-bottom:10px"><button class="btn ghost small" data-act="fliph" aria-pressed="${!!o.fh}">⇋ Flip horizontal</button><button class="btn ghost small" data-act="flipv" aria-pressed="${!!o.fv}">⇵ Flip vertical</button></div>
        <div class="row2">${["l", "r", "t", "b"].map(s => rng("cr." + s, "Crop " + {l:"left", r:"right", t:"top", b:"bottom"}[s], 0, .45, .005, (o.cr || {})[s] || 0, pct)).join("")}</div></div>
      ${gradeSection(o)}
      ${m.kind === "v" ? `<div class="sec"><button class="btn ghost small wide" data-act="freeze">Freeze this frame (2 s)</button></div>` : ""}` : ""}
      <div class="sec"><div class="row3"><button class="btn ghost small" data-act="split">Split</button><button class="btn ghost small" data-act="del">Delete</button><button class="btn ghost small" data-act="ripple" title="Delete and close the gap">Ripple</button></div></div>`;
  } else if (o.shape) {
    const ln = o.shape === "line" || o.shape === "arrow", cl = (k, l, v) => `<div class="f"><label>${l}</label><input type="color" data-k="${k}" value="${v}" style="width:100%;height:31px;border:1px solid var(--line);border-radius:6px;padding:2px;background:var(--bg)"></div>`;
    box.innerHTML = `<div class="f"><span class="l">T1 · Shape</span></div>
      <div class="f"><label>Shape</label><select data-k="shape">${Object.entries(SHAPES).map(([v, l]) => `<option value="${v}"${o.shape === v ? " selected" : ""}>${l}</option>`).join("")}</select></div>
      <div class="sec"><b>Timing</b><div class="row2"><div class="f"><label>Starts</label><input type="text" data-k="s" value="${tc(o.s)}"></div><div class="f"><label>Ends</label><input type="text" data-k="e" value="${tc(o.e)}"></div></div>
        <div class="f"><label>Animation</label><select data-k="anim">${[["none", "None"], ["fade", "Fade in & out"], ["up", "Rise up"], ["pop", "Pop"]].map(([v, l]) => `<option value="${v}"${(o.anim || "none") === v ? " selected" : ""}>${l}</option>`).join("")}</select></div></div>
      <div class="sec"><b>Style</b><div class="row2">${cl("color", ln ? "Colour" : "Fill", o.color)}${ln ? "" : cl("sc", "Outline", o.sc || "#ffffff")}</div>
        ${ln ? "" : `<label style="display:flex;gap:6px;align-items:center;font-size:.84rem;margin-bottom:8px"><input type="checkbox" data-k="fill"${o.fill !== false ? " checked" : ""}> Filled (untick for an outline only)</label>`}
        ${rng("sw", ln ? "Thickness" : "Outline width", 0, 4, .1, o.sw || 0, v => (+v).toFixed(1))}${o.shape === "rect" ? rng("rad", "Rounded corners", 0, 1, .01, o.rad || 0, pct) : ""}${rng("op", "Opacity", 0, 1, .01, o.op ?? 1, pct)}</div>
      <div class="sec"><b>Size & position</b>${rng("w", ln ? "Length" : "Width", .02, 1.2, .005, o.w, pct)}${ln ? "" : rng("h", "Height", .02, 1.2, .005, o.h, pct)}${rng("rot", "Rotation", -180, 180, 1, o.rot || 0, v => Math.round(v) + "°")}${rng("x", "Left ↔ right", 0, 1, .01, o.x, pct)}${rng("y", "Top ↕ bottom", 0, 1, .01, o.y, pct)}<p class="empty-note" style="font-size:.78rem;margin:0">Or drag it on the monitor.</p></div>
      <div class="sec"><div class="row3"><button class="btn ghost small" data-act="split">Split</button><button class="btn ghost small" data-act="dup">Copy</button><button class="btn ghost small" data-act="del">Delete</button></div></div>`;
  } else {
    box.innerHTML = `<div class="f"><span class="l">T1 · Text</span></div><div class="f"><label>Text</label><textarea data-k="text">${esc(o.text)}</textarea></div>
      <div class="sec"><b>Timing</b><div class="row2"><div class="f"><label>Starts</label><input type="text" data-k="s" value="${tc(o.s)}"></div><div class="f"><label>Ends</label><input type="text" data-k="e" value="${tc(o.e)}"></div></div></div>
      <div class="sec"><b>Style</b>
      <div class="row2"><div class="f"><label>Font</label><select data-k="font">${fontOptions(o.font || "sans")}</select></div>
      <div class="f"><label>Colour</label><input type="color" data-k="color" value="${o.color}" style="width:100%;height:31px;border:1px solid var(--line);border-radius:6px;padding:2px;background:var(--bg)"></div></div>
      ${rng("size", "Size", 2, 25, .5, o.size, v => v)}
      <div class="f"><label>Animation</label><select data-k="anim">${[["none", "None"], ["fade", "Fade in & out"], ["up", "Rise up"], ["pop", "Pop"], ["type", "Typewriter"]].map(([v, l]) => `<option value="${v}"${(o.anim || "none") === v ? " selected" : ""}>${l}</option>`).join("")}</select></div>
      <div class="row2"><label style="display:flex;gap:6px;align-items:center;font-size:.84rem"><input type="checkbox" data-k="bg"${o.bg ? " checked" : ""}> Background box</label><label style="display:flex;gap:6px;align-items:center;font-size:.84rem"><input type="checkbox" data-k="bold"${o.bold ? " checked" : ""}> Bold</label></div></div>
      <div class="sec"><b>Position</b>${rng("x", "Left ↔ right", 0, 1, .01, o.x, pct)}${rng("y", "Top ↕ bottom", 0, 1, .01, o.y, pct)}<p class="empty-note" style="font-size:.78rem;margin:0">Or drag the text on the monitor.</p></div>
      <div class="sec"><div class="row3"><button class="btn ghost small" data-act="split">Split</button><button class="btn ghost small" data-act="dup">Copy</button><button class="btn ghost small" data-act="del">Delete</button></div></div>`;
  }
}
let propSnap = null;
const props = $(".props");
props.addEventListener("focusin", () => { propSnap = snapshot(); });
props.addEventListener("pointerdown", () => { propSnap = snapshot(); });
const TIMEK = ["a", "b", "s", "e", "start"];
props.addEventListener("input", e => {
  const k = e.target.dataset.k, o = findSel(); if (!k || !o || TIMEK.includes(k)) return;
  const raw = e.target.value, num = +raw;
  let shown = raw;
  if (k.startsWith("mask.")) {
    const p = k.slice(5); o.mask = {...defMask(), ...(o.mask || {})};
    o.mask[p] = e.target.type === "checkbox" ? e.target.checked : p === "shape" ? raw : num;
    if (p === "on" || p === "shape") { const sc = $(".panel.right").scrollTop; renderProps(); $(".panel.right").scrollTop = sc; }
    else { const f = e.target.closest(".f"), out = f && $("output", f); if (out) out.textContent = pct(num); }
    renderTimeline(); if (!playing) paint(); return;
  }
  if (k.startsWith("mx.")) {
    const parts = k.split(".").slice(1), obj = sel.id === "master" ? master : mixOf(o);
    const val = e.target.type === "checkbox" ? e.target.checked : num;
    if (parts.length === 2) obj[parts[0]] = {...obj[parts[0]], [parts[1]]:val}; else obj[parts[0]] = val;
    if (pvMix) pvMix.update();
    const f = e.target.closest(".f"), out = f && $("output", f);
    if (out && e.target.type === "range") { const fm = {vol:fmtDb, pan:panTxt, f:v => Math.round(v) + " Hz", thr:v => Math.round(v) + " dB", ratio:v => (+v).toFixed(1) + ":1", mix:pct, fb:pct, size:v => (+v).toFixed(1) + " s", time:v => (+v).toFixed(2) + " s", lo:v => (v > 0 ? "+" : "") + v.toFixed(1) + " dB", mid:v => (v > 0 ? "+" : "") + v.toFixed(1) + " dB", hi:v => (v > 0 ? "+" : "") + v.toFixed(1) + " dB"}; out.textContent = (fm[parts[parts.length - 1]] || (v => v))(num); }
    if (mixerOn) { const st = $(`.strip[data-strip="${sel.id}"]`); if (st && parts[0] === "vol") { $(".fader", st).value = num; $(".db", st).textContent = fmtDb(num); } if (st && parts[0] === "pan") { $(".panr", st).value = num; $(".pn", st).textContent = panTxt(num); } }
    return;
  }
  if (k.startsWith("gr.")) {
    o.gr = {...defGrade(), ...(o.gr || {})}; const parts = k.split(".");
    if (parts.length === 3) { o.gr[parts[1]] = {...o.gr[parts[1]], [parts[2]]:num}; shown = num; }
    else if (parts[1] === "lut") o.gr.lut = raw;
    else { o.gr[parts[1]] = num; const f = e.target.closest(".f"); const fmtEl = f && $("output", f); if (fmtEl) shown = fmtEl.textContent; }
    if (parts[1] !== "lut") { const f = e.target.closest(".f"); if (f && $("output", f)) { const fmts = {exp:v => (v > 0 ? "+" : "") + v.toFixed(2) + " EV", sat:pct, lamt:pct, hue:v => Math.round(v) + "°"}; shown = (fmts[parts[1]] || (v => (v > 0 ? "+" : "") + Math.round(v * 100)))(num); } }
  }
  else if (k.startsWith("fx.")) {
    const [, i, pk] = k.split("."), fe = o.fx && o.fx[+i]; if (!fe) return;
    const d = FX.byId[fe.id], p = d.params.find(q => q.k === pk);
    if (pk === "on") { fe.on = e.target.checked; e.target.closest(".fxcard").classList.toggle("off", !fe.on); }
    else if (pk === "k1" || pk === "k2") fe[pk] = raw;
    else { fe[pk] = num; shown = p ? fxFmt(p)(num) : num; }
  }
  else if (k.startsWith("cr.")) { o.cr = {l:0, r:0, t:0, b:0, ...(o.cr || {})}; o.cr[k.slice(3)] = num; shown = pct(num); }
  else if (k === "fit") o.fit = raw;
  else if (k === "shape" || k === "sc" && sel.type === "text" || k === "bdc") o[k] = raw;
  else if (k === "fill") o.fill = e.target.checked;
  else if (k.startsWith("col.")) { o.col = {...col(o)}; const kk = k.slice(4); o.col[kk] = kk === "p" ? raw : num; shown = kk === "h" ? Math.round(num) + "°" : kk === "bl" ? num : pct(num); }
  else if (k.startsWith("tin.")) { o.tin = {type:"", d:1, ...(o.tin || {})}; if (k === "tin.type") o.tin.type = raw; else { o.tin.d = Math.min(num, len(o)); shown = o.tin.d.toFixed(1) + "s"; } }
  else if (k === "fi" || k === "fo") { o[k] = Math.min(num, len(o) / 2); shown = o[k].toFixed(1) + "s"; }
  else if (k === "text" || k === "color" || k === "font" || k === "anim") { o[k] = raw; if (k === "font") ensureFont(raw); }
  else if (k === "bg" || k === "bold") o[k] = e.target.checked;
  else if (sel.type === "clip" && ANIM.includes(k) && o.kf && o.kf[k] && o.kf[k].length) {
    if (T < o.start || T > endOf(o)) { toast("Move the playhead inside the clip to change an animated value"); return; }
    setKf(o, k, num); shown = k === "rot" ? Math.round(num) + "°" : pct(num);
  }
  else { o[k] = num; shown = k === "rot" ? Math.round(num) + "°" : ["vol", "op", "sc", "x", "y", "w", "h", "rad"].includes(k) ? pct(num) : k === "bd" ? Math.round(num * 1000) / 10 + "%" : num; }
  if (k === "speed" && sel.type === "clip" && overlaps(o)) { o.speed = +JSON.parse(propSnap).clips.find(c => c.id === o.id).speed; e.target.value = o.speed; toast("Not enough room on the track for that speed"); }
  const out = e.target.closest(".f") && $("output", e.target.closest(".f"));
  if (out && e.target.type === "range") out.textContent = shown;
  renderTimeline(); if (!playing) paint();
});
props.addEventListener("change", e => {
  const k = e.target.dataset.k, o = findSel(); if (!k || !o) return;
  if (TIMEK.includes(k)) {
    const v = parseTC(e.target.value);
    if (isNaN(v)) toast("Use a time like 00:00:05:12 or 1:20");
    else {
      const old = {...o};
      if (k === "a") o.a = clamp(v, 0, o.b - 1 / FPS);
      if (k === "b") o.b = clamp(v, o.a + 1 / FPS, media.get(o.m).dur);
      if (k === "start") o.start = fq(Math.max(0, v));
      if (k === "s") o.s = clamp(v, 0, o.e - 1 / FPS);
      if (k === "e") o.e = Math.max(o.s + 1 / FPS, v);
      if (sel.type === "clip" && overlaps(o)) { Object.assign(o, old); toast("That would overlap another clip on this track"); }
    }
  }
  if (propSnap) pushSnap(propSnap); propSnap = snapshot();
  refresh();
});

/* ---------- Quick tools: the familiar one-job tools, mapped onto Studio features ---------- */
function pickClip(kind = "v") {
  const o = findSel(); if (o && sel.type === "clip" && (kind === "any" || trk(o.tr).kind === kind)) return o;
  const c = clips.filter(k => kind === "any" || trk(k.tr).kind === kind).sort((a, b) => Math.abs(a.start - T) - Math.abs(b.start - T))[0];
  if (!c) { toast(kind === "a" ? "Add some audio first" : "Import a video first"); return null; }
  sel = {type:"clip", id:c.id}; renderTimeline(); renderProps(); return c;
}
function showSec(title) {
  const s = $$(".props .sec").find(x => x.querySelector("b") && x.querySelector("b").textContent.startsWith(title)); if (!s) return;
  s.scrollIntoView({behavior:"smooth", block:"center"}); s.classList.remove("flash"); void s.offsetWidth; s.classList.add("flash");
}
function exportAs(fmt, extra) { if (!clips.length) return toast("Import a video first"); openExport(); const f = $(".fmt", dlg); if ([...f.options].some(o => o.value === fmt)) f.value = fmt; if (extra) extra(); dlg.onchange(); }
const QT = {
  trim:() => { if (pickClip("any")) { showSec("Timing"); toast("Drag a clip's edges to trim, or put the playhead on a frame and press S to cut there"); } },
  compress:() => exportAs("video", () => { $(".br", dlg).value = ".022"; $(".q", dlg).value = "720"; }),
  resize:() => { $(".aspect").focus(); if (pickClip("v")) showSec("Crop"); toast("Pick a frame shape at the top, then Fit / Fill / Blurred background and crop here"); },
  rotate:() => { if (pickClip("v")) showSec("Crop"); },
  speed:() => { if (pickClip("any")) { showSec("Timing"); const s = $('.props [data-k="speed"]'); if (s) s.focus(); } },
  audio:() => { if (pickClip("v")) showSec("Audio"); toast("Set volume to 0 to mute. Import music and it goes on an audio track."); },
  merge:() => { toast("Choose the clips to join. They're added one after another."); mergeNext = true; fileIn.click(); },
  text:() => addText("sub"),
  logo:() => { toast("Choose a logo or photo. It goes on a video track above your clip."); logoNext = true; fileIn.accept = "image/*"; fileIn.click(); setTimeout(() => { fileIn.accept = ACCEPT; }, 1000); },
  greenscreen:() => { const o = pickClip("v"); if (!o) return; if (!(o.fx || []).some(f => f.id === "chromakey")) applyFx("chromakey", o); else showSec("Effects"); toast("Use \u201cPick from video\u201d and click the green, then adjust Similarity"); },
  gif:() => exportAs("gif"), extract:() => exportAs("mp3"), frame:() => saveFrame()
};
let mergeNext = false, logoNext = false;
function pipPreset(kind) {
  clipSet(o => {
    const [W, H] = outSize(1080), m = media.get(o.m), cr = o.cr || {l:0, r:0, t:0, b:0};
    let mw = m.w * (1 - cr.l - cr.r), mh = m.h * (1 - cr.t - cr.b); if ((o.qt || 0) % 2) [mw, mh] = [mh, mw];
    const k0 = Math.min(W / mw, H / mh), cw = mw * k0 / W, ch = mh * k0 / H, mx = .03, my = .03 * W / H;
    let s = .32, x = 0, y = 0;
    if (kind === "full") s = 1;
    else if (kind === "center") s = .5;
    else if (kind === "left" || kind === "right") { s = Math.min(1, .5 / cw); x = kind === "left" ? -.25 : .25; }
    else { x = (kind[1] === "l" ? -1 : 1) * (.5 - mx - cw * s / 2); y = (kind[0] === "t" ? -1 : 1) * (.5 - my - ch * s / 2); }
    o.fit = "contain"; o.sc = s; o.x = x; o.y = y; if (o.kf) ["sc", "x", "y"].forEach(k => delete o.kf[k]);
    if (kind !== "full" && !o.bd) { o.bd = .004; o.rad = .08; }
    if (kind === "full") { o.bd = 0; o.rad = 0; }
  });
}
function clipSet(fn) { const o = findSel(); if (!o || sel.type !== "clip") return toast("Select a clip first"); commit(); fn(o); refresh(); }
function download(blob, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000); }
const projName = () => ($(".pname").value.trim() || "video").replace(/[\\/:*?"<>|]+/g, "-");
/* Save the frame under the playhead at full export size. */
async function saveFrame() {
  if (playing) pause();
  const [W, H] = outSize(1080), c = document.createElement("canvas"); c.width = W; c.height = H;
  await showFrame(); drawFrame(c.getContext("2d"), W, H, T, pv);
  const blob = await new Promise(r => c.toBlob(r, "image/png"));
  download(blob, `${projName()}-${tc(T).replace(/:/g, "-")}.png`); toast("Saved the frame as PNG");
}

/* ---------- Audio-only export: mixes every audible clip offline (faster than real time) ---------- */
const decoded = new Map();
async function decodeMedia(m) {
  if (decoded.has(m.id)) return decoded.get(m.id);
  const p = (async () => { const ab = await (await fetch(m.url)).arrayBuffer(); const ac = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(2, 2, 48000); return ac.decodeAudioData(ab); })().catch(() => null);
  decoded.set(m.id, p); return p;
}
async function mixAudio(from, to, onp) {
  const rate = 48000, D = to - from, oc = new OfflineAudioContext(2, Math.ceil(D * rate), rate);
  const list = clips.filter(c => media.get(c.m).kind !== "i" && media.get(c.m).kind !== "adj" && endOf(c) > from && c.start < to);
  const OM = makeMixer(oc, oc.destination);
  let n = 0;
  for (const c of list) {
    const buf = await decodeMedia(media.get(c.m)); onp(++n / list.length * .5); if (!buf) continue;
    const src = oc.createBufferSource(), gn = oc.createGain(); src.buffer = buf; src.playbackRate.value = c.speed;
    src.connect(gn).connect(OM.strip(c.tr).in);
    /* volume, keyframes and fades as automation, sampled every 50 ms */
    const s0 = Math.max(c.start, from), s1 = Math.min(endOf(c), to);
    for (let t = s0; t <= s1 + 1e-6; t += .05) gn.gain.setValueAtTime(clamp(valAt(c, "vol", t) * fadeMul(c, t), 0, 2), t - from);
    src.start(s0 - from, localAt(c, s0), (s1 - s0) * c.speed);
  }
  const out = await oc.startRendering(); onp(1); return out;
}
function wavBlob(buf) {
  const ch = buf.numberOfChannels, len = buf.length, dv = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const w = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); dv.setUint32(4, 36 + len * ch * 2, true); w(8, "WAVEfmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true);
  dv.setUint32(24, buf.sampleRate, true); dv.setUint32(28, buf.sampleRate * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true); w(36, "data"); dv.setUint32(40, len * ch * 2, true);
  const data = [...Array(ch)].map((_, i) => buf.getChannelData(i)); let o = 44;
  for (let i = 0; i < len; i++) for (let k = 0; k < ch; k++) { dv.setInt16(o, clamp(data[k][i], -1, 1) * 32767, true); o += 2; }
  return new Blob([dv], {type:"audio/wav"});
}
const libs = {};
function loadLib(src) { return libs[src] || (libs[src] = new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => { delete libs[src]; rej(new Error("Couldn't load the encoder. Check your internet connection and try again.")); }; document.head.appendChild(s); })); }
async function mp3Blob(buf, kbps, onp) {
  await loadLib("https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js");
  const enc = new window.lamejs.Mp3Encoder(2, buf.sampleRate, kbps), L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L, out = [], blk = 1152;
  const i16 = a => { const r = new Int16Array(a.length); for (let i = 0; i < a.length; i++) r[i] = clamp(a[i], -1, 1) * 32767; return r; };
  for (let i = 0; i < L.length; i += blk) { const d = enc.encodeBuffer(i16(L.subarray(i, i + blk)), i16(R.subarray(i, i + blk))); if (d.length) out.push(new Uint8Array(d)); if (i % (blk * 200) === 0) { onp(i / L.length); await sleep(0); } }
  const e = enc.flush(); if (e.length) out.push(new Uint8Array(e));
  return new Blob(out, {type:"audio/mpeg"});
}

/* ---------- GIF export: steps through the timeline frame by frame (exact frames, not real time) ---------- */
async function renderGif(from, to, width, fps, ctl, onp) {
  if (!window._gifenc) { /* gifenc's browser build is CommonJS: hand it an exports object */
    /* run it in its own function scope: its top-level names (e.g. clamp) would clash with ours */
    try { const src = await (await fetch("https://cdn.jsdelivr.net/npm/gifenc@1.0.3/dist/gifenc.js")).text(), ex = {}; new Function("exports", src)(ex); window._gifenc = ex; }
    catch (e) { throw new Error("Couldn't load the GIF maker. Check your internet connection and try again."); }
    if (!window._gifenc || !window._gifenc.GIFEncoder) { window._gifenc = null; throw new Error("The GIF maker couldn't start. Reload and try again."); }
  }
  const {GIFEncoder, quantize, applyPalette} = window._gifenc;
  const [W0, H0] = outSize(1080), W = Math.round(width / 2) * 2, H = Math.round(W * H0 / W0 / 2) * 2;
  const c = document.createElement("canvas"); c.width = W; c.height = H; const gg = c.getContext("2d", {willReadFrequently:true});
  const holder = hiddenBox(), pool = makePool(holder), gif = GIFEncoder(), n = Math.max(1, Math.round((to - from) * fps));
  try {
    for (let i = 0; i < n; i++) {
      if (ctl.cancel) throw new Error("Cancelled");
      const t = from + i / fps, ents = entries(t);
      await Promise.all(ents.filter(e => trk(e.c.tr).kind === "v" && media.get(e.c.m).kind !== "adj").map(e => seekEl(pool.get(e.c), Math.min(e.local + .001, media.get(e.c.m).dur - .001))));
      drawFrame(gg, W, H, t, pool);
      const px = gg.getImageData(0, 0, W, H).data, pal = quantize(px, 256);
      gif.writeFrame(applyPalette(px, pal), W, H, {palette:pal, delay:Math.round(1000 / fps)});
      onp((i + 1) / n);
    }
    gif.finish(); return new Blob([gif.bytes()], {type:"image/gif"});
  } finally { pool.destroy(); holder.remove(); }
}

/* ---------- Export: replays the timeline in real time into MediaRecorder ---------- */
function pickMime() {
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return null;
  for (const m of ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"])
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) { /* ignore */ }
  return "";
}
const dlg = $(".exp"); let exporting = null;
function openExport() {
  if (playing) pause();
  const mime = pickMime();
  const fmt = mime === null ? null : mime && mime.includes("mp4") ? "MP4" : "WebM";
  dlg.innerHTML = `<h3>Export</h3>
    <div class="f"><label>Save as</label><select class="fmt">${fmt ? `<option value="video">Video (${fmt})</option>` : ""}<option value="gif">GIF (looping, no sound)</option><option value="mp3">Audio only · MP3</option><option value="wav">Audio only · WAV</option></select></div>
    <div class="f"><label>Range</label><select class="rg"><option value="all">Whole timeline (${tc(total())})</option>${sel && sel.type === "clip" ? `<option value="sel">Selected clip only</option>` : ""}</select></div>
    <div class="opt-video"><div class="f"><label>Resolution</label><select class="q"><option value="1080" selected>1080p Full HD</option><option value="720">720p HD</option><option value="480">480p</option><option value="360">360p</option><option value="1440">1440p 2K</option></select></div>
      <div class="f"><label>File size (compression)</label><select class="br"><option value=".14">Best quality · larger file</option><option value=".09" selected>Balanced</option><option value=".045">Small file</option><option value=".022">Smallest file (for WhatsApp / email)</option></select></div></div>
    <div class="opt-gif" hidden><div class="row2"><div class="f"><label>Width</label><select class="gw"><option value="320">320 px</option><option value="480" selected>480 px</option><option value="640">640 px</option></select></div><div class="f"><label>Frames per second</label><select class="gf"><option value="8">8</option><option value="12" selected>12</option><option value="15">15</option></select></div></div></div>
    <div class="opt-mp3" hidden><div class="f"><label>MP3 quality</label><select class="kb"><option value="128">128 kbps</option><option value="192" selected>192 kbps</option><option value="320">320 kbps</option></select></div></div>
    <p class="empty-note est"></p>
    <div class="acts"><button class="btn ghost small" data-x="close">Cancel</button><button class="btn small" data-x="go">Start export</button></div>`;
  const upd = () => {
    const f = $(".fmt", dlg).value, o = findSel(), D = $(".rg", dlg).value === "sel" && o ? len(o) : total();
    $(".opt-video", dlg).hidden = f !== "video"; $(".opt-gif", dlg).hidden = f !== "gif"; $(".opt-mp3", dlg).hidden = f !== "mp3";
    let note = "";
    if (f === "video") { const [W, H] = outSize(+$(".q", dlg).value), mb = (W * H * FPS * +$(".br", dlg).value + 192000) * D / 8 / 1048576; note = `${W}×${H} · ${FPS} fps · about ${mb.toFixed(mb < 10 ? 1 : 0)} MB. Video export plays the timeline in real time, so keep this tab open and in front.`; }
    if (f === "gif") note = D > 20 ? "GIFs longer than 20 seconds get very big. Pick a shorter range or select one clip." : "Made frame by frame. Takes a little while.";
    if (f === "mp3" || f === "wav") note = "Mixes every audio and video track (volume, fades, mutes). Much faster than real time.";
    $(".est", dlg).textContent = note;
  };
  dlg.onchange = upd; upd();
  dlg.showModal();
}
dlg.addEventListener("click", async e => {
  const x = e.target.dataset.x;
  if (x === "close") { if (exporting) exporting.cancel = true; dlg.close(); }
  if (x !== "go") return;
  const f = $(".fmt", dlg).value, q = +$(".q", dlg).value, br = +$(".br", dlg).value, gw = +$(".gw", dlg).value, gf = +$(".gf", dlg).value, kb = +$(".kb", dlg).value;
  const rg = $(".rg", dlg).value, o = findSel();
  const from = rg === "sel" && o ? o.start : 0, to = rg === "sel" && o ? endOf(o) : total();
  dlg.innerHTML = `<h3>Exporting…</h3><progress max="1" value="0"></progress><p class="empty-note st">Getting clips ready</p><div class="acts"><button class="btn ghost small" data-x="close">Cancel</button></div>`;
  const ctl = exporting = {cancel:false};
  const onp = p => { $("progress", dlg).value = p; $(".st", dlg).textContent = `${Math.round(p * 100)}%` + (f === "video" ? ` · ${tc(p * (to - from))} of ${tc(to - from)}` : ""); };
  try {
    let blob, ext, info, prev;
    if (f === "video") { const res = await render(q, from, to, ctl, onp, br); blob = res.blob; ext = res.ext; info = `${res.W}×${res.H}`; prev = "video"; }
    else if (f === "gif") { blob = await renderGif(from, to, gw, gf, ctl, onp); ext = "gif"; info = `${gw} px wide · ${gf} fps`; prev = "img"; }
    else { const buf = await mixAudio(from, to, p => onp(f === "mp3" ? p * .5 : p)); if (ctl.cancel) throw new Error("Cancelled"); blob = f === "mp3" ? await mp3Blob(buf, kb, p => onp(.5 + p * .5)) : wavBlob(buf); ext = f; info = f === "mp3" ? kb + " kbps" : "48 kHz stereo"; prev = "audio"; }
    const url = URL.createObjectURL(blob), name = projName() + "." + ext;
    dlg.innerHTML = `<h3>Your ${f === "video" ? "video" : f === "gif" ? "GIF" : "audio"} is ready</h3><p class="empty-note">${info} · ${(blob.size / 1048576).toFixed(1)} MB</p>${prev === "img" ? `<img src="${url}" alt="GIF preview" style="max-width:100%;border-radius:6px">` : `<${prev} src="${url}" controls playsinline style="width:100%"></${prev}>`}
      <div class="acts"><button class="btn ghost small" data-x="close">Close</button><a class="btn small" href="${url}" download="${esc(name)}">Download</a></div>`;
  } catch (err) {
    if (ctl.cancel) { dlg.close(); toast("Export cancelled"); }
    else { console.error(err); dlg.innerHTML = `<h3>Export stopped</h3><p class="empty-note">${esc(err.message || "Something went wrong")}</p><div class="acts"><button class="btn small" data-x="close">Close</button></div>`; }
  } finally { exporting = null; }
});
dlg.addEventListener("cancel", () => { if (exporting) exporting.cancel = true; });
async function render(shortSide, from, to, ctl, onp, bpp = .09) {
  const [W, H] = outSize(shortSide), D = to - from, mime = pickMime();
  const c = document.createElement("canvas"); c.width = W; c.height = H; const gg = c.getContext("2d");
  const vt = c.captureStream(FPS).getVideoTracks(), tracksOut = [...vt];
  const holder = hiddenBox(), pool = makePool(holder);
  let ac = null, dest = null; const gains = new Map();
  if (AC) { ac = new AC(); dest = ac.createMediaStreamDestination(); tracksOut.push(...dest.stream.getAudioTracks()); await ac.resume(); }
  const exMix = ac ? makeMixer(ac, dest) : null;
  const gainFor = (cl, el, v) => { if (!exMix) { el.muted = true; return; } routeEl(exMix, el, cl, v); };
  const rec = new MediaRecorder(new MediaStream(tracksOut), Object.assign({videoBitsPerSecond:Math.round(clamp(W * H * FPS * bpp, 2e5, 25e6)), audioBitsPerSecond:192000}, mime ? {mimeType:mime} : {}));
  const chunks = []; rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise(r => { rec.onstop = r; });
  try {
    /* Prepare every clip in range, then pre-seek the ones that start the export. */
    const inRange = clips.filter(k => endOf(k) > from && k.start < to && media.get(k.m).kind !== "adj");
    await Promise.all(inRange.map(k => { const el = pool.get(k); return el.tagName === "IMG" ? seekEl(el, 0) : el.readyState >= 1 ? 0 : waitFor(el, "loadedmetadata").catch(() => {}); }));
    if (ctl.cancel) throw new Error("Cancelled");
    await Promise.all(entries(from).filter(e => media.get(e.c.m).kind !== "adj").map(e => seekEl(pool.get(e.c), e.local)));
    drawFrame(gg, W, H, from, pool);
    rec.start(1000);
    const t0 = performance.now();
    await new Promise((res, rej) => {
      let done = false;
      const fin = err => { if (done) return; done = true; clearInterval(guard); err ? rej(err) : res(); };
      const tick = () => {
        if (done) return;
        if (ctl.cancel) return fin(new Error("Cancelled"));
        const t = from + (performance.now() - t0) / 1000;
        if (t >= to) return fin();
        syncEls(pool, t, {gain:gainFor}); drawFrame(gg, W, H, t, pool); onp(clamp((t - from) / D, 0, 1));
      };
      const loopF = () => { tick(); if (!done) requestAnimationFrame(loopF); };
      const guard = setInterval(tick, 1000 / FPS);
      loopF();
    });
    pool.pauseAll(); rec.stop(); await stopped;
    const type = (rec.mimeType || mime || "video/webm").split(";")[0], blob = new Blob(chunks, {type});
    if (!blob.size) throw new Error("The export came out empty. Keep this tab in front while it runs.");
    return {blob, ext:type.includes("mp4") ? "mp4" : "webm", W, H};
  } finally {
    try { if (rec.state !== "inactive") rec.stop(); } catch (e) { /* ignore */ }
    tracksOut.forEach(t => t.stop()); pool.destroy(); holder.remove(); if (ac) ac.close().catch(() => {});
  }
}

/* ---------- Wiring ---------- */

/* ---------- Mixer view ---------- */
let mixerOn = false, meterRaf = 0;
const meterHold = new Map();
const fmtDb = v => v <= -60 ? "−∞ dB" : (v > 0 ? "+" : "") + (+v).toFixed(1) + " dB";
const panTxt = v => Math.abs(v) < .02 ? "C" : (v < 0 ? "L" : "R") + Math.round(Math.abs(v) * 100);
const fxCount = x => ["hp", "eq", "comp", "rev", "echo"].filter(k => x[k] && x[k].on).length;
function renderMixer() {
  const box = $(".mixer"); if (!box) return;
  const strip = t => { const x = mixOf(t), on = sel && sel.type === "track" && sel.id === t.id, n = fxCount(x);
    return `<div class="strip${on ? " sel" : ""}${t.mute ? " muted" : ""}" data-strip="${t.id}">
      <div class="sn"><b>${t.id}</b><small>${t.kind === "v" ? "video sound" : "audio"}</small></div>
      <div class="sbody"><canvas class="meter" data-meter="${t.id}" width="24" height="140" aria-hidden="true"></canvas><input type="range" class="fader" min="-60" max="12" step="0.5" value="${x.vol}" data-mx="${t.id}.vol" aria-label="${t.id} volume" title="Double-click for 0 dB"></div>
      <output class="db">${fmtDb(x.vol)}</output>
      <input type="range" class="panr" min="-1" max="1" step="0.05" value="${x.pan}" data-mx="${t.id}.pan" aria-label="${t.id} pan" title="Pan (double-click for centre)"><span class="pn">${panTxt(x.pan)}</span>
      <div class="ms"><button data-mute="${t.id}" aria-pressed="${!!t.mute}" title="Mute">M</button><button data-solo="${t.id}" aria-pressed="${!!x.solo}" title="Solo">S</button></div>
      <button class="fxb${n ? " on" : ""}" data-strip-fx="${t.id}">FX${n ? ` (${n})` : ""}</button></div>`; };
  box.innerHTML = `<div class="strips">${tracks.map(strip).join("")}
    <div class="strip master${sel && sel.type === "track" && sel.id === "master" ? " sel" : ""}" data-strip="master">
      <div class="sn"><b>Master</b><small>output</small></div>
      <div class="sbody"><canvas class="meter" data-meter="master" width="24" height="140" aria-hidden="true"></canvas><input type="range" class="fader" min="-60" max="12" step="0.5" value="${master.vol}" data-mx="master.vol" aria-label="Master volume" title="Double-click for 0 dB"></div>
      <output class="db">${fmtDb(master.vol)}</output>
      <button class="lim${master.limiter ? " on" : ""}" data-limiter title="Stops the final mix from clipping">Limiter ${master.limiter ? "on" : "off"}</button>
      <button class="fxb" data-strip-fx="master">Settings</button></div></div>
    <p class="mixnote">${pvMix ? "" : "Meters start moving after you press Play. "}Click FX on a track to add EQ, compression, reverb or echo. Everything here is also in the export.</p>`;
  if (!meterRaf) meterLoop();
}
function drawMeter(cvm, L, R, id) {
  const gg = cvm.getContext("2d"), W = cvm.width, H = cvm.height, y = db => H - (Math.max(-60, Math.min(6, db)) + 60) / 66 * H;
  gg.fillStyle = "#0b0c0e"; gg.fillRect(0, 0, W, H);
  const hold = meterHold.get(id) || {l:-90, r:-90, clip:0};
  [[L, 1, "l"], [R, W / 2 + 1, "r"]].forEach(([lv, x, k]) => {
    const grd = gg.createLinearGradient(0, H, 0, 0); grd.addColorStop(0, "#2fbf71"); grd.addColorStop(.72, "#2fbf71"); grd.addColorStop(.85, "#e8c547"); grd.addColorStop(1, "#ff4d4d");
    gg.fillStyle = grd; const top = y(lv.rms + 3); gg.fillRect(x, top, W / 2 - 2, H - top);
    hold[k] = Math.max(lv.peak, hold[k] - .6); gg.fillStyle = "#fff"; gg.fillRect(x, y(hold[k]), W / 2 - 2, 1.5);
    if (lv.peak > -0.3) hold.clip = 90;
  });
  if (hold.clip > 0) { hold.clip--; gg.fillStyle = "#ff4d4d"; gg.fillRect(0, 0, W, 4); }
  gg.fillStyle = "#ffffff30"; [0, -6, -12, -24, -48].forEach(db => gg.fillRect(0, y(db), W, 1));
  meterHold.set(id, hold);
}
function meterLoop() {
  cancelAnimationFrame(meterRaf); meterRaf = 0;
  if (!mixerOn) return;
  const silent = {peak:-90, rms:-90};
  $$(".mixer .meter").forEach(cvm => {
    const id = cvm.dataset.meter;
    let L = silent, R = silent;
    if (pvMix && playing) { const an = id === "master" ? pvMix.master.an : pvMix.strips.has(id) ? pvMix.strips.get(id).an : null; if (an) { L = meterDb(an[0]); R = meterDb(an[1]); } }
    drawMeter(cvm, L, R, id);
  });
  meterRaf = requestAnimationFrame(meterLoop);
}
function setView(mix) {
  mixerOn = mix; $(".tlbody").hidden = mix; $(".mixer").hidden = !mix;
  $('[data-act="view-tl"]').setAttribute("aria-pressed", String(!mix)); $('[data-act="view-mix"]').setAttribute("aria-pressed", String(mix));
  if (mix) renderMixer(); else { cancelAnimationFrame(meterRaf); meterRaf = 0; renderTimeline(); }
}
let mixSnap = null;
document.addEventListener("pointerdown", e => { if (e.target.closest && e.target.closest("[data-mx]")) mixSnap = snapshot(); });
document.addEventListener("input", e => {
  const k = e.target.dataset && e.target.dataset.mx; if (!k) return;
  const [id, key] = k.split("."), obj = id === "master" ? master : mixOf(trk(id)), v = +e.target.value;
  obj[key] = v;
  const st = e.target.closest(".strip"); if (st) { if (key === "vol") $(".db", st).textContent = fmtDb(v); if (key === "pan") $(".pn", st).textContent = panTxt(v); }
  if (pvMix) pvMix.update();
});
document.addEventListener("change", e => { if (e.target.dataset && e.target.dataset.mx) { if (mixSnap) pushSnap(mixSnap); mixSnap = null; if (sel && sel.type === "track") renderProps(); } });
document.addEventListener("dblclick", e => {
  const f = e.target.closest && e.target.closest("[data-mx]"); if (!f) return;
  const [id, key] = f.dataset.mx.split("."), obj = id === "master" ? master : mixOf(trk(id));
  commit(); obj[key] = 0; renderMixer(); if (pvMix) pvMix.update(); if (sel && sel.type === "track") renderProps();
});
document.addEventListener("click", e => {
  const m = e.target.closest("[data-mute]"); if (m) { const t = trk(m.dataset.mute); commit(); t.mute = !t.mute; refresh(); return; }
  const s2 = e.target.closest("[data-solo]"); if (s2) { const x = mixOf(trk(s2.dataset.solo)); commit(); x.solo = !x.solo; refresh(); return; }
  const l = e.target.closest("[data-limiter]"); if (l) { commit(); master.limiter = !master.limiter; refresh(); return; }
  const fx = e.target.closest("[data-strip-fx]"); if (fx) { sel = {type:"track", id:fx.dataset.stripFx}; renderTimeline(); renderProps(); renderMixer(); return; }
  const pre = e.target.closest("[data-mixpreset]"); if (pre) { const t = findSel(); if (!t || sel.id === "master") return; const x = mixOf(t), P = MIX_PRESETS[pre.dataset.mixpreset]; commit(); Object.assign(x, JSON.parse(JSON.stringify(P.set(x)))); refresh(); toast(P.name + " applied to " + t.id); }
});
const MIX_PRESETS = {
  voice:{name:"Voice clarity", set:x => ({hp:{on:true, f:90}, eq:{on:true, lo:-2, mid:3, hi:2}, comp:{on:true, thr:-20, ratio:3}})},
  podcast:{name:"Podcast", set:x => ({hp:{on:true, f:100}, eq:{on:true, lo:1, mid:2, hi:3}, comp:{on:true, thr:-24, ratio:4}})},
  music:{name:"Warm music", set:x => ({eq:{on:true, lo:3, mid:-1, hi:2}, comp:{on:true, thr:-14, ratio:2}})},
  rumble:{name:"Remove rumble", set:x => ({hp:{on:true, f:120}})},
  room:{name:"Big room", set:x => ({rev:{on:true, mix:.35, size:3}})},
  reset:{name:"Clean (no effects)", set:x => { const d = defMix(); return {hp:d.hp, eq:d.eq, comp:d.comp, rev:d.rev, echo:d.echo}; }}
};
function trackAudioProps(t) {
  if (sel.id === "master") return `<div class="f"><span class="l">Master output</span></div>
    <div class="sec"><b>Output</b>${rng("mx.vol", "Volume", -60, 12, .5, master.vol, fmtDb)}
    <label style="display:flex;gap:8px;align-items:center;font-size:.84rem"><input type="checkbox" data-k="mx.limiter"${master.limiter ? " checked" : ""}> Limiter (stops the final mix from clipping)</label></div>`;
  const x = mixOf(t), chk = (k, on, l) => `<label class="fxon"><input type="checkbox" data-k="mx.${k}.on"${on ? " checked" : ""}> ${l}</label>`;
  const hz = v => Math.round(v) + " Hz", db = v => (v > 0 ? "+" : "") + (+v).toFixed(1) + " dB", sec = v => (+v).toFixed(2) + " s";
  return `<div class="f"><span class="l">${t.id} · ${t.kind === "v" ? "sound of the video clips" : "audio track"}</span><span style="font-size:.78rem;color:var(--muted)">These settings apply to every clip on ${t.id}.</span></div>
    <div class="sec"><b>Level</b>${rng("mx.vol", "Volume", -60, 12, .5, x.vol, fmtDb)}${rng("mx.pan", "Pan", -1, 1, .05, x.pan, panTxt)}</div>
    <div class="sec"><b>Presets</b><div class="mixpre">${Object.entries(MIX_PRESETS).map(([k, P]) => `<button class="btn ghost small" data-mixpreset="${k}">${P.name}</button>`).join("")}</div></div>
    <div class="sec"><b>Low-cut</b>${chk("hp", x.hp.on, "Remove low rumble")}${rng("mx.hp.f", "Cut below", 20, 300, 1, x.hp.f, hz)}</div>
    <div class="sec"><b>Equaliser</b>${chk("eq", x.eq.on, "On")}${rng("mx.eq.lo", "Bass (200 Hz)", -12, 12, .5, x.eq.lo, db)}${rng("mx.eq.mid", "Mids (1.5 kHz)", -12, 12, .5, x.eq.mid, db)}${rng("mx.eq.hi", "Treble (5 kHz)", -12, 12, .5, x.eq.hi, db)}</div>
    <div class="sec"><b>Compressor</b>${chk("comp", x.comp.on, "Even out loud and quiet parts")}${rng("mx.comp.thr", "Threshold", -50, 0, 1, x.comp.thr, v => Math.round(v) + " dB")}${rng("mx.comp.ratio", "Ratio", 1, 12, .5, x.comp.ratio, v => (+v).toFixed(1) + ":1")}</div>
    <div class="sec"><b>Reverb</b>${chk("rev", x.rev.on, "Room sound")}${rng("mx.rev.mix", "Amount", 0, 1, .01, x.rev.mix, pct)}${rng("mx.rev.size", "Room size", .5, 6, .1, x.rev.size, v => (+v).toFixed(1) + " s")}</div>
    <div class="sec"><b>Echo</b>${chk("echo", x.echo.on, "Repeat")}${rng("mx.echo.time", "Delay", .05, 1.5, .01, x.echo.time, sec)}${rng("mx.echo.fb", "Repeats", 0, .9, .01, x.echo.fb, pct)}${rng("mx.echo.mix", "Amount", 0, 1, .01, x.echo.mix, pct)}</div>`;
}

let toastT = 0;
function toast(msg) { const t = $(".toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 2400); }
const TOOL_TIPS = {select:"", razor:"Razor: click a clip to cut it", ripple:"Ripple: trim a clip edge and everything after it moves to close the gap", slip:"Slip: drag inside a clip to change which part of the video it shows", fwd:"Track select forward: drag a clip and everything after it (on all tracks) moves together"};
function setTool(tl) {
  tool = tl; ["razor", "ripple", "slip", "fwd"].forEach(k => document.body.classList.toggle("tool-" + k, tl === k)); document.body.classList.toggle("razor", tl === "razor");
  ["select", "razor", "ripple", "slip", "fwd"].forEach(k => { const b = $(`[data-act="tool-${k}"]`); if (b) b.setAttribute("aria-pressed", String(tl === k)); });
  if (TOOL_TIPS[tl]) toast(TOOL_TIPS[tl]);
}
$$("[data-act]").forEach(b => { const k = b.dataset.act; if (IC[k] && b.classList.contains("ib")) b.innerHTML = IC[k]; });
/* ---------- Report a bug: emailed through FormSubmit (the site has no server); falls back to the visitor's email app.
   The destination address lives in <meta name="report-to"> in editor.html. ---------- */
const bugTo = () => (($('meta[name="report-to"]') || {}).content || "").trim();
const bugDlg = $(".bugdlg"), bugForm = $(".bugform");
if (!bugTo()) $('[data-act="bug"]').hidden = true; /* no destination set yet: don't show a button that can't send */
function openBug() { if (playing) pause(); $(".bugmsg").textContent = ""; $(".bugmsg").className = "bugmsg"; bugDlg.showModal(); $("#bug-txt").focus(); }
function bugDetails() {
  return [`Page: ${location.href.split("#")[0]}`, `Browser: ${navigator.userAgent}`, `Screen: ${innerWidth}x${innerHeight} @${devicePixelRatio}x`,
    `Project: ${clips.length} clips, ${texts.length} text/shapes, ${tracks.length} tracks, length ${tc(total())}, frame ${outSize(1080).join("x")} ${FPS} fps`, `Time: ${new Date().toISOString()}`].join("\n");
}
bugDlg.addEventListener("click", e => { if (e.target.dataset.bug === "close") bugDlg.close(); });
bugForm.addEventListener("submit", async e => {
  e.preventDefault();
  const msg = $(".bugmsg"), txt = $("#bug-txt").value.trim(), mail = $("#bug-mail").value.trim(), btn = $('button[type="submit"]', bugForm);
  if (txt.length < 5) { msg.className = "bugmsg err"; msg.textContent = "Please describe the problem first."; $("#bug-txt").focus(); return; }
  if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) { msg.className = "bugmsg err"; msg.textContent = "That email address doesn't look right."; $("#bug-mail").focus(); return; }
  const BUG_TO = bugTo();
  if (!BUG_TO) { msg.className = "bugmsg err"; msg.textContent = "Bug reports aren't set up yet on this site."; return; }
  const details = bugForm.details.checked ? bugDetails() : "(not included)";
  btn.disabled = true; msg.className = "bugmsg"; msg.textContent = "Sending…";
  try {
    const r = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(BUG_TO)}`, {method:"POST", headers:{"Content-Type":"application/json", Accept:"application/json"},
      body:JSON.stringify({_subject:"Daftarbox Video Studio: bug report", _template:"box", _captcha:"false", message:txt, reply_to:mail || "(not given)", ...(mail ? {_replyto:mail} : {}), details})});
    const j = await r.json().catch(() => ({}));
    if (!r.ok || String(j.success) !== "true") throw new Error(j.message || "send failed");
    msg.className = "bugmsg ok"; msg.textContent = "Thanks! Your report was sent."; bugForm.reset(); bugForm.details.checked = true;
    setTimeout(() => { if (bugDlg.open) bugDlg.close(); }, 1800);
  } catch (err) {
    msg.className = "bugmsg err"; msg.textContent = "Couldn't send from here, so your email app was opened with the report filled in. Please press Send there.";
    location.href = `mailto:${BUG_TO}?subject=${encodeURIComponent("Daftarbox Video Studio: bug report")}&body=${encodeURIComponent(txt + "\n\nReply to: " + (mail || "-") + "\n\n" + details)}`;
  } finally { btn.disabled = false; }
});

const ACTS = {
  play:toggle, start:() => step(-1e9), end:() => step(1e9), prevf:() => step(-1 / FPS), nextf:() => step(1 / FPS),
  back1s:() => step(-1), fwd1s:() => step(1), prevedit:() => jumpEdit(-1), nextedit:() => jumpEdit(1),
  split, del:() => del(false), ripple:() => del(true), dup, addtext:() => addText("sub"), undo, redo, fit, export:openExport, marker:addMarker,
  setin:() => trimTo("in"), setout:() => trimTo("out"), detach:detachAudio,
  resetxf:() => { const o = findSel(); if (o) { commit(); Object.assign(o, {op:1, sc:1, x:0, y:0, rot:0}); if (o.kf) ["op", "sc", "x", "y", "rot"].forEach(k => delete o.kf[k]); refresh(); } },
  clearkf:() => { const o = findSel(); if (o && o.kf) { commit(); o.kf = null; refresh(); } },
  resetcol:() => { const o = findSel(); if (o) { commit(); o.col = null; refresh(); } },
  freeze:freezeFrame, bug:openBug, trall:trAll, adj:addAdjustment,
  "view-tl":() => setView(false), "view-mix":() => setView(true),
  lutimport:() => { if (!window.FX || !FX.supported()) return toast("LUTs need WebGL (graphics card support)."); lutIn.click(); },
  gcopy:() => { const o = findSel(); if (!o || sel.type !== "clip") return; gradeClip = JSON.parse(JSON.stringify({...defGrade(), ...(o.gr || {})})); renderProps(); showSec("Colour grading"); toast("Grade copied"); },
  gpaste:() => { const o = findSel(); if (!o || !gradeClip) return; commit(); o.gr = JSON.parse(JSON.stringify(gradeClip)); refresh(); showSec("Colour grading"); toast("Grade pasted"); },
  gall:() => { const o = findSel(); if (!o) return; const gr = JSON.parse(JSON.stringify({...defGrade(), ...(o.gr || {})})); const n = clips.filter(c => c !== o && trk(c.tr).kind === "v"); if (!n.length) return toast("There are no other video clips"); commit(); n.forEach(c => { c.gr = JSON.parse(JSON.stringify(gr)); }); refresh(); showSec("Colour grading"); toast(`Grade applied to ${n.length} more clip${n.length > 1 ? "s" : ""}`); },
  greset:() => { const o = findSel(); if (o && o.gr) { commit(); o.gr = null; refresh(); showSec("Colour grading"); } },
  ba:() => { beforeAfter = !beforeAfter; $('[data-act="ba"]').setAttribute("aria-pressed", String(beforeAfter)); if (!playing) paint(); },
  scopes:() => setScope(scopeMode ? "" : "wave"),
  rotl:() => clipSet(o => { o.qt = ((o.qt || 0) + 3) % 4; }), rotr:() => clipSet(o => { o.qt = ((o.qt || 0) + 1) % 4; }),
  fliph:() => clipSet(o => { o.fh = !o.fh; }), flipv:() => clipSet(o => { o.fv = !o.fv; }),
  snapshot:saveFrame,
  addv:() => addTrack("v"), adda:() => addTrack("a"),
  "tool-select":() => setTool("select"), "tool-razor":() => setTool("razor"), "tool-ripple":() => setTool("ripple"), "tool-slip":() => setTool("slip"), "tool-fwd":() => setTool("fwd"),
  zin:() => setZoom(Math.min(100, +zm.value + 8)), zout:() => setZoom(Math.max(0, +zm.value - 8)),
  snap:() => { snapOn = !snapOn; $('[data-act="snap"]').setAttribute("aria-pressed", String(snapOn)); toast(snapOn ? "Snapping on" : "Snapping off"); }
};
document.addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (b && ACTS[b.dataset.act]) { ACTS[b.dataset.act](); return; }
  const so = e.target.closest("[data-srcopen]"); if (so) { openSource(so.dataset.srcopen); return; }
  const trb = e.target.closest("[data-tr]"); if (trb) { applyTr(trb.dataset.tr); return; }
  const fxb = e.target.closest("[data-fx]"); if (fxb) { applyFx(fxb.dataset.fx); return; }
  const fxd = e.target.closest("[data-fxdel]"); if (fxd) { const o = findSel(); if (o && o.fx) { commit(); o.fx.splice(+fxd.dataset.fxdel, 1); refresh(); showSec("Effects"); } return; }
  const fxm = e.target.closest("[data-fxmv]"); if (fxm) { const o = findSel(), [i, dd] = fxm.dataset.fxmv.split(":").map(Number), j = i + dd; if (o && o.fx && o.fx[j]) { commit(); [o.fx[i], o.fx[j]] = [o.fx[j], o.fx[i]]; refresh(); showSec("Effects"); } return; }
  const fxp = e.target.closest("[data-fxpick]"); if (fxp) { startPick(+fxp.dataset.fxpick); return; }
  const pp = e.target.closest("[data-pip]"); if (pp) { pipPreset(pp.dataset.pip); return; }
  const sh = e.target.closest("[data-shape]"); if (sh) { addShape(sh.dataset.shape); return; }
  const go = e.target.closest("[data-go]"); if (go) { const m = markers.find(k => k.id === go.dataset.go); if (m) { if (playing) pause(); setT(m.t); } return; }
  const md = e.target.closest("[data-mdel]"); if (md) { commit(); markers = markers.filter(k => k.id !== md.dataset.mdel); refresh(); return; }
  const kb = e.target.closest("[data-kf]"); if (kb) { e.preventDefault(); kfAction(kb.dataset.kf, kb.dataset.kk); return; }
  const a = e.target.closest("[data-add]"); if (a) { insertMedia(a.dataset.add); return; }
  const tp = e.target.closest("[data-tpl]"); if (tp) addText(tp.dataset.tpl);
  const q = e.target.closest("[data-qt]"); if (q && QT[q.dataset.qt]) QT[q.dataset.qt]();
  const tab = e.target.closest("[data-tab]");
  if (tab) { $$("[data-tab]").forEach(k => k.setAttribute("aria-selected", String(k === tab))); $$("[data-pane]").forEach(p => { p.hidden = p.dataset.pane !== tab.dataset.tab; }); }
});
zm.addEventListener("input", () => setZoom(+zm.value));
document.addEventListener("change", e => {
  if (e.target.matches("[data-grlook]")) { const o = findSel(); const L = LOOKS[e.target.value]; if (!o || !L) return; commit(); o.gr = e.target.value === "natural" ? null : {...defGrade(), ...JSON.parse(JSON.stringify(L.g)), lut:(o.gr && o.gr.lut) || "", lamt:(o.gr && o.gr.lamt) ?? 1}; refresh(); showSec("Colour grading"); }
  if (e.target.matches(".scopes select")) setScope(e.target.value);
});
document.addEventListener("change", e => { if (e.target.matches("[data-fxadd]") && e.target.value) { const id = e.target.value; e.target.value = ""; applyFx(id); } });
$(".fxsearch").addEventListener("input", renderFxLib);
document.addEventListener("dragstart", e => { const t2 = e.target.closest && e.target.closest("[data-tr]"); if (t2) { e.dataTransfer.setData("text/x-tr", t2.dataset.tr); e.dataTransfer.effectAllowed = "copy"; } });
rows.addEventListener("dragover", e => { if ([...e.dataTransfer.types].includes("text/x-tr") && e.target.closest(".clip:not(.txt)")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } });
rows.addEventListener("drop", e => { const id = e.dataTransfer.getData("text/x-tr"); if (!id) return; e.preventDefault(); const cl = e.target.closest(".clip:not(.txt)"); const c = cl && clips.find(k => k.id === cl.dataset.id); if (c) applyTr(id, c); });
document.addEventListener("dragstart", e => { const b = e.target.closest && e.target.closest("[data-fx]"); if (b) { e.dataTransfer.setData("text/x-fx", b.dataset.fx); e.dataTransfer.effectAllowed = "copy"; } });
rows.addEventListener("dragover", e => { if ([...e.dataTransfer.types].includes("text/x-fx")) { const cl = e.target.closest(".clip:not(.txt)"); if (cl) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } } });
rows.addEventListener("drop", e => { const id = e.dataTransfer.getData("text/x-fx"); if (!id) return; e.preventDefault(); const cl = e.target.closest(".clip:not(.txt)"); const c = cl && clips.find(k => k.id === cl.dataset.id); if (c) applyFx(id, c); });
renderFxLib();
document.addEventListener("change", e => {
  const l = e.target.dataset.ml, c = e.target.dataset.mc; if (!l && !c) return;
  const m = markers.find(k => k.id === (l || c)); if (!m) return;
  commit(); if (l) m.label = e.target.value.trim() || m.label; else m.color = e.target.value; refresh();
});
$(".fps").addEventListener("change", e => { FPS = +e.target.value; setT(T); renderTimeline(); renderProps(); });
$(".aspect").addEventListener("change", () => { showFrame(); renderProps(); });
const fileIn = $(".drop input"), ACCEPT = fileIn.accept;
fileIn.addEventListener("change", async () => {
  const files = [...fileIn.files], merge = mergeNext, logo = logoNext; fileIn.value = ""; mergeNext = logoNext = false;
  const before = new Set(media.keys()); await addFiles(files);
  if (logo) { /* logo / photo overlay: goes on the layer above the main track, at the playhead */
    for (const [id, m] of media) if (!before.has(id) && m.kind === "i") {
      const vs = tracks.filter(t => t.kind === "v"); const up = vs.length > 1 ? vs[vs.length - 2] : addTrack("v", true);
      const c = insertMedia(id, T, up.id); if (c) { c.sc = .25; c.x = .36; c.y = -.36; refresh(); }
    }
    return;
  }
  if (!merge) return;
  /* Merge: line the new videos up one after another at the end of V1 */
  for (const [id, m] of media) {
    if (before.has(id) || m.kind !== "v" || clips.some(c => c.m === id)) continue;
    const v1 = tracks.filter(t => t.kind === "v").pop().id, end = Math.max(0, ...clips.filter(c => c.tr === v1).map(endOf));
    insertMedia(id, end, v1);
  }
  fit();
});
$(".drop").addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileIn.click(); } });
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes("Files");
["dragenter", "dragover"].forEach(ev => document.addEventListener(ev, e => { if (hasFiles(e)) { e.preventDefault(); $(".drop").classList.add("over"); } }));
["dragleave", "drop"].forEach(ev => document.addEventListener(ev, () => $(".drop").classList.remove("over")));
document.addEventListener("drop", e => { if (e.dataTransfer?.files?.length) { e.preventDefault(); addFiles([...e.dataTransfer.files]); } });
document.addEventListener("keydown", e => {
  if (e.target.closest("input:not([type=range]):not([type=checkbox]),textarea,select,[contenteditable]") || dlg.open) return;
  const k = e.key, mod = e.ctrlKey || e.metaKey, lk = k.toLowerCase();
  if (mod && lk === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && lk === "y") { e.preventDefault(); redo(); return; }
  if (mod && lk === "d") { e.preventDefault(); dup(); return; }
  if (mod) return;
  const map = {" ":toggle, arrowleft:() => step(e.shiftKey ? -1 : -1 / FPS), arrowright:() => step(e.shiftKey ? 1 : 1 / FPS), ",":() => step(-1 / FPS), ".":() => step(1 / FPS),
    arrowup:() => jumpEdit(-1), arrowdown:() => jumpEdit(1), home:() => step(-1e9), end:() => step(1e9), s:split, m:addMarker, v:() => setTool("select"), c:() => setTool("razor"), b:() => setTool("razor"), r:() => setTool("ripple"), y:() => setTool("slip"), a:() => setTool("fwd"),
    delete:() => del(e.shiftKey), backspace:() => del(e.shiftKey), t:() => addText("sub"), "+":ACTS.zin, "=":ACTS.zin, "-":ACTS.zout, escape:() => { setTool("select"); sel = null; renderTimeline(); renderProps(); paint(); }};
  if (map[lk]) { e.preventDefault(); if (document.activeElement && document.activeElement.type === "range") document.activeElement.blur(); map[lk](); }
});
scroller.addEventListener("wheel", e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); setZoom(clamp(+zm.value - Math.sign(e.deltaY) * 6, 0, 100), xToT(e.clientX)); } }, {passive:false});
window.addEventListener("resize", () => renderTimeline());
/* The studio never scrolls sideways: undo any nudge from focus jumps or sideways trackpad swipes. */
const noSideScroll = () => { if (scrollX) scrollTo(0, scrollY); if (document.body.scrollLeft) document.body.scrollLeft = 0; if (document.documentElement.scrollLeft) document.documentElement.scrollLeft = 0; };
window.addEventListener("scroll", noSideScroll, {passive:true}); document.body.addEventListener("scroll", noSideScroll, {passive:true});
window.addEventListener("beforeunload", e => { if (clips.length) { e.preventDefault(); e.returnValue = ""; } });
{ const rp0 = renderProps; renderProps = (...args) => { rp0(...args); drawWheels(); }; } /* colour wheels are canvases: redraw after the inspector changes */
setPlayBtn(); setTool("select"); pps = ppsFromZoom(+zm.value); renderTimeline(); renderProps(); updateTime(); sizeViewer(); paint();
