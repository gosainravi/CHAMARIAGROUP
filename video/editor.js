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
  split:ICON('<path d="M12 3v18"/><path d="M4 7h5v10H4zM15 7h5v10h-5z"/>'),
  del:ICON('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  ripple:ICON('<path d="M3 8h6v8H3zM15 8h6v8h-6z"/><path d="M11 12h2M13 10l-2 2 2 2"/>'),
  dup:ICON('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>'),
  addtext:ICON('<path d="M5 6V4h14v2M12 4v16M9 20h6"/>'),
  marker:ICON('<path d="M6 3h12v12l-6 6-6-6z"/>'),
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
const snapshot = () => JSON.stringify({tracks, clips, texts, textTrack, markers});
function commit() { undoS.push(snapshot()); if (undoS.length > 200) undoS.shift(); redoS.length = 0; syncUndo(); }
function pushSnap(s) { if (s !== snapshot()) { undoS.push(s); redoS.length = 0; syncUndo(); } }
function restore(s) { const o = JSON.parse(s); ({tracks, clips, texts, textTrack} = o); markers = o.markers || []; if (sel && !findSel()) sel = null; refresh(); }
function undo() { if (!undoS.length) return; redoS.push(snapshot()); restore(undoS.pop()); syncUndo(); }
function redo() { if (!redoS.length) return; undoS.push(snapshot()); restore(redoS.pop()); syncUndo(); }
function syncUndo() { $('[data-act="undo"]').disabled = !undoS.length; $('[data-act="redo"]').disabled = !redoS.length; }
function findSel() { if (!sel) return null; return sel.type === "clip" ? clips.find(c => c.id === sel.id) : texts.find(x => x.id === sel.id); }
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
  const fxc = !noFx && c.fx && c.fx.length && window.FX ? FX.render(el, srcW(el), srcH(el), sx, sy, sw, sh, Math.abs(w), Math.abs(h), c.fx, t, H / 1080) : null;
  const put = () => fxc ? g.drawImage(fxc, 0, 0, fxc.width, fxc.height, -w / 2, -h / 2, w, h) : g.drawImage(el, sx, sy, sw, sh, -w / 2, -h / 2, w, h);
  const rr = (c.rad || 0) * Math.min(w, h) / 2, bd = (c.bd || 0) * W;
  if (rr || bd) { g.save(); g.beginPath(); g.roundRect ? g.roundRect(-w / 2, -h / 2, w, h, rr) : g.rect(-w / 2, -h / 2, w, h); g.clip(); put(); g.restore();
    if (bd) { g.filter = "none"; g.lineWidth = bd; g.strokeStyle = c.bdc || "#ffffff"; g.beginPath(); g.roundRect ? g.roundRect(-w / 2, -h / 2, w, h, rr) : g.rect(-w / 2, -h / 2, w, h); g.stroke(); } }
  else put();
  g.restore();
}
let noFx = false; /* true while the green-screen colour picker samples the untouched picture */

/* ---------- Drawing ---------- */
function drawFrame(g, W, H, t, pool) {
  g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
  const ents = entries(t);
  for (let i = tracks.length - 1; i >= 0; i--) {
    const tr = tracks[i]; if (tr.kind !== "v" || tr.hide) continue;
    const e = ents.find(k => k.c.tr === tr.id && !k.tail); if (!e) continue;
    const el = pool.pool.get(e.c.id); if (!ready(el)) continue;
    if (e.pr === undefined) { drawClip(g, W, H, e.c, el, t); continue; }
    const tail = ents.find(k => k.tail && k.c.tr === tr.id), tel = tail && pool.pool.get(tail.c.id), hasT = tail && ready(tel);
    const pr = e.pr, ty = e.c.tin.type, drawPrev = (a = 1, dx = 0) => { if (hasT) drawClip(g, W, H, tail.c, tel, endOf(tail.c) - 1e-3, a, dx); };
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
function textBox(g, W, H, x) {
  if (x.shape) { const bw = x.w * W, bh = (x.shape === "line" || x.shape === "arrow") ? Math.max(x.sw * H / 100 * 3, H * .03) : x.h * H; return {fs:H * .05, lines:[], lh:0, pad:0, bw, bh, cx:x.x * W, l:x.x * W - bw / 2, t:x.y * H - bh / 2}; }
  const fs = Math.max(8, x.size / 100 * H);
  g.font = `${x.bold ? 800 : 500} ${fs}px ${FONTS[x.font] || FONTS.sans}`;
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
  drawFrame(g, cv.width, cv.height, T, pv);
  if (sel && sel.type === "text") { const x = findSel(); if (x && T >= x.s && T < x.e) { const b = textBox(g, cv.width, cv.height, x); g.save(); g.setLineDash([6, 4]); g.strokeStyle = "#fff"; g.lineWidth = 2; g.strokeRect(b.l - 2, b.t - 2, b.bw + 4, b.bh + 4); g.restore(); } }
}
let seekGen = 0;
async function showFrame() {
  sizeViewer();
  const gen = ++seekGen, ents = entries(T);
  pv.pool.forEach((el, id) => { if (el.pause && !ents.some(e => e.c.id === id)) el.pause(); });
  await Promise.all(ents.filter(e => trk(e.c.tr).kind === "v").map(e => seekEl(pv.get(e.c), Math.min(e.local + 0.001, media.get(e.c.m).dur - 0.001))));
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
function syncEls(pool, t, opts = {}) {
  const ents = entries(t);
  pool.pool.forEach((el, id) => { if (el.pause && !ents.some(e => e.c.id === id) && !el.paused) el.pause(); });
  for (const {c, local:want, mix, tail} of ents) {
    if (media.get(c.m).kind === "i") { pool.get(c); continue; }
    const tr = trk(c.tr), el = pool.get(c);
    const gain = tr.mute ? 0 : clamp(valAt(c, "vol", tail ? endOf(c) - 1e-3 : t) * (tail ? 1 : fadeMul(c, t)) * mix, 0, 1);
    if (opts.gain) opts.gain(c, el, gain); else { el.muted = gain === 0; el.volume = gain; }
    if (el.playbackRate !== c.speed) el.playbackRate = c.speed;
    el.preservesPitch = true;
    if (el.paused) { if (el.readyState >= 1) el.currentTime = want; el.play().catch(() => {}); }
    else if (Math.abs(el.currentTime - want) > 0.25) el.currentTime = want;
  }
}
function play() {
  if (!clips.length && !texts.length) return;
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
  bin.innerHTML = [...media.values()].map(m => `<div class="m" draggable="true" data-m="${m.id}" title="${esc(m.name)}"><canvas width="160" height="90"></canvas><span>${m.kind === "i" ? "Photo" : short(m.dur)}</span><b>${m.kind === "a" ? "♪ " : ""}${esc(m.name)}</b><button class="add" data-add="${m.id}" title="Add to the end of the main track" aria-label="Add ${esc(m.name)} to the timeline">+</button></div>`).join("") || "";
  $$(".m", bin).forEach(el => {
    const m = media.get(el.dataset.m), gg = $("canvas", el).getContext("2d");
    gg.fillStyle = m.kind === "a" ? "#123528" : "#111"; gg.fillRect(0, 0, 160, 90);
    const t = m.thumbs[Math.min(m.thumbs.length - 1, 1)];
    if (t) { const k = Math.min(160 / t.width, 90 / t.height); gg.drawImage(t, (160 - t.width * k) / 2, (90 - t.height * k) / 2, t.width * k, t.height * k); }
    if (m.kind === "a" && m.peaks) { gg.fillStyle = "#3ecf8e"; for (let x = 0; x < 160; x++) { const p = m.peaks[Math.floor(x / 160 * m.peaks.length)] || 0; gg.fillRect(x, 45 - p * 38, 1, Math.max(1, p * 76)); } }
    el.addEventListener("dragstart", e => { e.dataTransfer.setData("text/x-media", m.id); e.dataTransfer.effectAllowed = "copy"; });
  });
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
      el.className = "clip" + (sel && sel.id === c.id ? " sel" : ""); el.dataset.id = c.id; el.dataset.type = "clip";
      el.style.left = c.start * pps + "px"; el.style.width = Math.max(4, L * pps) + "px";
      el.appendChild(clipCanvas(c, Math.min(16000, Math.max(4, Math.round(L * pps))), H, t.kind));
      const kfs = c.kf ? [...new Set(Object.values(c.kf).flat().map(p => Math.round(p.t * 1000) / 1000))] : [];
      el.insertAdjacentHTML("beforeend", `${c.fi ? `<i class="fade in" style="width:${c.fi * pps}px"></i>` : ""}${c.fo ? `<i class="fade out" style="width:${c.fo * pps}px"></i>` : ""}${c.tin && c.tin.type ? `<i class="trn" style="width:${c.tin.d * pps}px" title="${c.tin.type} transition"></i>` : ""}${kfs.map(k => `<i class="kfd" style="left:${k * pps}px"></i>`).join("")}<span class="lab">${c.fx && c.fx.length ? "✦ " : ""}${c.col && (c.col.p !== "none" || c.col.b !== 1 || c.col.c !== 1 || c.col.s !== 1 || c.col.h || c.col.bl) ? "◐ " : ""}${esc(m.name)}${c.speed !== 1 ? " · " + c.speed + "×" : ""}${c.vol === 0 && m.kind !== "i" ? " · muted" : ""}</span><div class="h l" data-h="l"></div><div class="h r" data-h="r"></div>`);
      row.appendChild(el);
    });
  }
  $('[data-act="export"]').disabled = !clips.length;
  $(".viewer .hint").hidden = clips.length > 0 || texts.length > 0;
}
function refresh() { pv.prune(); renderTimeline(); renderProps(); renderMarkers(); setT(T); }
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
  const onMove = ev => {
    const dx = ev.clientX - x0; if (!moved && Math.abs(dx) < 4) return; moved = true;
    const dt = dx / pps;
    if (isText) {
      if (h === "l") o.s = clamp(snapT(o0.s + dt, o), 0, o.e - 1 / FPS);
      else if (h === "r") o.e = Math.max(o.s + 1 / FPS, snapT(o0.e + dt, o));
      else { const L = o0.e - o0.s; let ns = snapT(o0.s + dt, o); const ne = snapT(o0.e + dt, o); if (Math.abs(ne - (o0.e + dt)) < Math.abs(ns - (o0.s + dt))) ns = ne - L; o.s = Math.max(0, ns); o.e = o.s + L; }
    } else {
      const m = media.get(o.m);
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
    if (!isText && overlaps(o)) { Object.assign(o, o0); toast("Clips can't overlap on the same track. Drop it on a free spot or another track."); }
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
  box.innerHTML = FX.CATS.map(cat => { const items = FX.LIB.filter(e => e.cat === cat && (!q || e.name.toLowerCase().includes(q) || cat.toLowerCase().includes(q)));
    return items.length ? `<h4>${cat}</h4><div class="fxg">${items.map(e => `<button draggable="true" data-fx="${e.id}"${e.id === "chromakey" ? ' class="key"' : ""} title="Add ${e.name} to the selected clip">${e.name}</button>`).join("")}</div>` : ""; }).join("")
    || `<p class="empty-note">No effect matches "${esc(q)}".</p>`;
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
  if (sel.type === "clip") {
    const m = media.get(o.m), isV = trk(o.tr).kind === "v";
    box.innerHTML = `<div class="f"><span class="l">${o.tr} · ${isV ? "Video" : "Audio"} clip</span><span style="font-size:.84rem;word-break:break-all">${esc(m.name)}</span></div>
      <div class="sec"><b>Timing</b>
      <div class="row2"><div class="f"><label>Starts at</label><input type="text" data-k="start" value="${tc(o.start)}"></div><div class="f"><label>Duration</label><input type="text" value="${tc(len(o))}" readonly></div></div>
      <div class="row2"><div class="f"><label>Source in</label><input type="text" data-k="a" value="${tc(o.a)}"></div><div class="f"><label>Source out</label><input type="text" data-k="b" value="${tc(o.b)}"></div></div>
      <div class="row2"><button class="btn ghost small" data-act="setin">Trim start here</button><button class="btn ghost small" data-act="setout">Trim end here</button></div>
      <div class="f" style="margin-top:10px"><label>Speed</label><select data-k="speed">${[.25, .5, .75, 1, 1.25, 1.5, 2, 3, 4].map(s => `<option value="${s}"${s === o.speed ? " selected" : ""}>${s}×</option>`).join("")}</select></div></div>
      ${m.kind !== "i" ? `<div class="sec"><b>Audio</b>${rngK("vol", "Volume", 0, 1, .05, o, pct)}${isV && m.kind === "v" ? `<button class="btn ghost small wide" data-act="detach">Detach audio to its own track</button>` : ""}</div>` : ""}
      <div class="sec"><b>Fade</b><div class="row2">${rng("fi", "Fade in", 0, 3, .1, o.fi || 0, v => (+v).toFixed(1) + "s")}${rng("fo", "Fade out", 0, 3, .1, o.fo || 0, v => (+v).toFixed(1) + "s")}</div></div>
      <div class="sec"><b>Transition in</b><div class="row2"><div class="f"><label>Type</label><select data-k="tin.type">${[["", "None (cut)"], ["dissolve", "Cross dissolve"], ["black", "Dip to black"], ["white", "Dip to white"], ["wipe", "Wipe"], ["slide", "Slide"], ["zoom", "Zoom in"]].map(([v, l]) => `<option value="${v}"${((o.tin && o.tin.type) || "") === v ? " selected" : ""}>${l}</option>`).join("")}</select></div>
        ${rng("tin.d", "Length", .2, 3, .1, (o.tin && o.tin.d) || 1, v => (+v).toFixed(1) + "s")}</div>
        <p class="empty-note" style="font-size:.76rem;margin:0">${prevAdj(o) ? "Blends from the clip just before this one on " + o.tr + "." : "No clip right before this one, so it blends from the tracks underneath."}</p></div>
      ${isV ? `<div class="sec"><b>Transform <span style="text-transform:none;letter-spacing:0;font-weight:500">· ◆ adds a keyframe at the playhead</span></b>${rngK("op", "Opacity", 0, 1, .01, o, pct)}${rngK("sc", "Scale", .1, 3, .01, o, pct)}${rngK("x", "Position X", -1, 1, .005, o, pct)}${rngK("y", "Position Y", -1, 1, .005, o, pct)}${rngK("rot", "Rotation", -180, 180, 1, o, v => Math.round(v) + "°")}
        <div class="row2"><button class="btn ghost small" data-act="resetxf">Reset</button><button class="btn ghost small" data-act="clearkf">Clear keyframes</button></div></div>
      ${fxSection(o)}
      <div class="sec"><b>Picture in picture</b>
        <div class="pipg">${[["tl", "↖ Top left"], ["tr", "↗ Top right"], ["bl", "↙ Bottom left"], ["br", "↘ Bottom right"], ["left", "◧ Left half"], ["right", "◨ Right half"], ["center", "▣ Centre small"], ["full", "⛶ Full frame"]].map(([v, l]) => `<button class="btn ghost small" data-pip="${v}">${l}</button>`).join("")}</div>
        ${rng("bd", "Border", 0, .02, .001, o.bd || 0, v => Math.round(v * 1000) / 10 + "%")}
        <div class="row2"><div class="f"><label>Border colour</label><input type="color" data-k="bdc" value="${o.bdc || "#ffffff"}" style="width:100%;height:31px;border:1px solid var(--line);border-radius:6px;padding:2px;background:var(--bg)"></div>${rng("rad", "Rounded corners", 0, 1, .01, o.rad || 0, pct)}</div>
        <p class="empty-note" style="font-size:.76rem;margin:0">Put this clip on a track above another clip (V2 over V1) to see both.</p></div>
      <div class="sec"><b>Crop, rotate & fit</b>
        <div class="f"><label>Fit in frame</label><select data-k="fit">${[["contain", "Fit (show everything)"], ["cover", "Fill (crop edges)"], ["blur", "Fit on blurred background"]].map(([v, l]) => `<option value="${v}"${(o.fit || "contain") === v ? " selected" : ""}>${l}</option>`).join("")}</select></div>
        <div class="row2" style="margin-bottom:8px"><button class="btn ghost small" data-act="rotl">⟲ Rotate left</button><button class="btn ghost small" data-act="rotr">⟳ Rotate right</button></div>
        <div class="row2" style="margin-bottom:10px"><button class="btn ghost small" data-act="fliph" aria-pressed="${!!o.fh}">⇋ Flip horizontal</button><button class="btn ghost small" data-act="flipv" aria-pressed="${!!o.fv}">⇵ Flip vertical</button></div>
        <div class="row2">${["l", "r", "t", "b"].map(s => rng("cr." + s, "Crop " + {l:"left", r:"right", t:"top", b:"bottom"}[s], 0, .45, .005, (o.cr || {})[s] || 0, pct)).join("")}</div></div>
      <div class="sec"><b>Colour</b><div class="f"><label>Look</label><select data-k="col.p">${[["none", "Original"], ["bw", "Black & white"], ["sepia", "Sepia"], ["warm", "Warm"], ["cool", "Cool"], ["vivid", "Vivid"], ["fade", "Faded film"], ["drama", "Dramatic"]].map(([v, l]) => `<option value="${v}"${col(o).p === v ? " selected" : ""}>${l}</option>`).join("")}</select></div>
        ${rng("col.b", "Brightness", .3, 2, .01, col(o).b, pct)}${rng("col.c", "Contrast", .3, 2, .01, col(o).c, pct)}${rng("col.s", "Saturation", 0, 3, .01, col(o).s, pct)}${rng("col.h", "Hue", -180, 180, 1, col(o).h, v => Math.round(v) + "°")}${rng("col.bl", "Blur", 0, 20, .5, col(o).bl, v => v)}
        <button class="btn ghost small wide" data-act="resetcol">Reset colour</button></div>
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
      <div class="row2"><div class="f"><label>Font</label><select data-k="font">${[["sans", "Sans"], ["serif", "Serif"], ["mono", "Mono"], ["hand", "Hand"]].map(([v, l]) => `<option value="${v}"${o.font === v ? " selected" : ""}>${l}</option>`).join("")}</select></div>
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
  if (k.startsWith("fx.")) {
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
  else if (k === "text" || k === "color" || k === "font" || k === "anim") o[k] = raw;
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
  const list = clips.filter(c => media.get(c.m).kind !== "i" && !trk(c.tr).mute && endOf(c) > from && c.start < to);
  let n = 0;
  for (const c of list) {
    const buf = await decodeMedia(media.get(c.m)); onp(++n / list.length * .5); if (!buf) continue;
    const src = oc.createBufferSource(), gn = oc.createGain(); src.buffer = buf; src.playbackRate.value = c.speed;
    src.connect(gn).connect(oc.destination);
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
      await Promise.all(ents.filter(e => trk(e.c.tr).kind === "v").map(e => seekEl(pool.get(e.c), Math.min(e.local + .001, media.get(e.c.m).dur - .001))));
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
  const gainFor = (cl, el, v) => {
    if (!ac) { el.muted = true; return; }
    let gn = gains.get(cl.id);
    if (!gn) { gn = ac.createGain(); ac.createMediaElementSource(el).connect(gn).connect(dest); gains.set(cl.id, gn); }
    gn.gain.value = v;
  };
  const rec = new MediaRecorder(new MediaStream(tracksOut), Object.assign({videoBitsPerSecond:Math.round(clamp(W * H * FPS * bpp, 2e5, 25e6)), audioBitsPerSecond:192000}, mime ? {mimeType:mime} : {}));
  const chunks = []; rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise(r => { rec.onstop = r; });
  try {
    /* Prepare every clip in range, then pre-seek the ones that start the export. */
    const inRange = clips.filter(k => endOf(k) > from && k.start < to);
    await Promise.all(inRange.map(k => { const el = pool.get(k); return el.tagName === "IMG" ? seekEl(el, 0) : el.readyState >= 1 ? 0 : waitFor(el, "loadedmetadata").catch(() => {}); }));
    if (ctl.cancel) throw new Error("Cancelled");
    await Promise.all(entries(from).map(e => seekEl(pool.get(e.c), e.local)));
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
let toastT = 0;
function toast(msg) { const t = $(".toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 2400); }
function setTool(tl) { tool = tl; document.body.classList.toggle("razor", tl === "razor"); $('[data-act="tool-select"]').setAttribute("aria-pressed", String(tl === "select")); $('[data-act="tool-razor"]').setAttribute("aria-pressed", String(tl === "razor")); }
$$("[data-act]").forEach(b => { const k = b.dataset.act; if (IC[k] && b.classList.contains("ib")) b.innerHTML = IC[k]; });
/* ---------- Report a bug: emailed through FormSubmit (the site has no server); falls back to the visitor's email app.
   The destination address lives in <meta name="report-to"> in editor.html. ---------- */
const bugTo = () => (($('meta[name="report-to"]') || {}).content || "").trim();
const bugDlg = $(".bugdlg"), bugForm = $(".bugform");
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
  freeze:freezeFrame, bug:openBug,
  rotl:() => clipSet(o => { o.qt = ((o.qt || 0) + 3) % 4; }), rotr:() => clipSet(o => { o.qt = ((o.qt || 0) + 1) % 4; }),
  fliph:() => clipSet(o => { o.fh = !o.fh; }), flipv:() => clipSet(o => { o.fv = !o.fv; }),
  snapshot:saveFrame,
  addv:() => addTrack("v"), adda:() => addTrack("a"),
  "tool-select":() => setTool("select"), "tool-razor":() => setTool("razor"),
  zin:() => setZoom(Math.min(100, +zm.value + 8)), zout:() => setZoom(Math.max(0, +zm.value - 8)),
  snap:() => { snapOn = !snapOn; $('[data-act="snap"]').setAttribute("aria-pressed", String(snapOn)); toast(snapOn ? "Snapping on" : "Snapping off"); }
};
document.addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (b && ACTS[b.dataset.act]) { ACTS[b.dataset.act](); return; }
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
document.addEventListener("change", e => { if (e.target.matches("[data-fxadd]") && e.target.value) { const id = e.target.value; e.target.value = ""; applyFx(id); } });
$(".fxsearch").addEventListener("input", renderFxLib);
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
    arrowup:() => jumpEdit(-1), arrowdown:() => jumpEdit(1), home:() => step(-1e9), end:() => step(1e9), s:split, m:addMarker, v:() => setTool("select"), c:() => setTool("razor"), b:() => setTool("razor"),
    delete:() => del(e.shiftKey), backspace:() => del(e.shiftKey), t:() => addText("sub"), "+":ACTS.zin, "=":ACTS.zin, "-":ACTS.zout, escape:() => { setTool("select"); sel = null; renderTimeline(); renderProps(); paint(); }};
  if (map[lk]) { e.preventDefault(); if (document.activeElement && document.activeElement.type === "range") document.activeElement.blur(); map[lk](); }
});
scroller.addEventListener("wheel", e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); setZoom(clamp(+zm.value - Math.sign(e.deltaY) * 6, 0, 100), xToT(e.clientX)); } }, {passive:false});
window.addEventListener("resize", () => renderTimeline());
window.addEventListener("beforeunload", e => { if (clips.length) { e.preventDefault(); e.returnValue = ""; } });
setPlayBtn(); setTool("select"); pps = ppsFromZoom(+zm.value); renderTimeline(); renderProps(); updateTime(); sizeViewer(); paint();
