/* Daftarbox PDF tools – understanding scanned pages for Edit PDF.
   Finds table/column borders in the page image, splits OCR lines at those borders and at wide gaps, and estimates each
   piece's real font size (from letter heights, not line boxes), family, width scaling, weight and colours.
   Pure functions on pixel data and OCR results, so they run in the browser and in Node tests. */
"use strict";

/* Cap height and x-height (em units) of the fonts we draw with: Arial/Helvetica, Times, Courier.
   In the browser these are replaced by values measured from the actual fonts (scanUseFontMetrics). */
const SCAN_METRICS = {sans: {cap: .716, xh: .519}, serif: {cap: .662, xh: .448}, mono: {cap: .571, xh: .423}};
function scanUseFontMetrics(measureBox) {
  for (const fam of Object.keys(SCAN_METRICS)) {
    try { const cap = measureBox(fam, "H"), xh = measureBox(fam, "x"); if (cap > .3 && cap < 1 && xh > .2 && xh < cap) SCAN_METRICS[fam] = {cap, xh}; } catch (e) { /* keep defaults */ }
  }
}
const scanMedian = a => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/* RGBA image -> luminance array and the paper brightness (90th percentile). */
function scanGray(img) {
  const n = img.width * img.height, g = new Uint8Array(n), d = img.data, hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) { const v = (d[i * 4] * 77 + d[i * 4 + 1] * 150 + d[i * 4 + 2] * 29) >> 8; g[i] = v; hist[v]++; }
  let acc = 0, paper = 255, ink = 0, inkSet = false;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (!inkSet && acc >= n * .005) { ink = v; inkSet = true; } if (acc >= n * .9) { paper = v; break; } }
  /* "mid" is half-way between ink and paper: edges of blurred or resampled glyphs are measured where a reader sees them */
  return {g, w: img.width, h: img.height, paper, ink, dark: Math.min(150, paper - 70), mid: Math.round((paper + Math.min(ink, paper - 80)) / 2)};
}
/* Long thin dark lines: table borders and column dividers. Returns pixel coordinates. */
function scanRules(G, opts = {}) {
  const {g, w, h, dark} = G; const minV = opts.minV || Math.max(36, Math.round(h * .02)), minH = opts.minH || Math.max(36, Math.round(w * .03));
  const maxThick = opts.maxThick || Math.max(4, Math.round(w / 300)), gapOK = opts.gap || 2;
  const runs = (len, step, at) => { /* runs of dark pixels along a scan line, tolerating tiny breaks */
    const out = []; let s = -1, last = -10;
    for (let i = 0; i < len; i++) { if (at(i) < dark) { if (s < 0 || i - last > gapOK + 1) { if (s >= 0 && last - s + 1 >= step) out.push([s, last]); s = i; } last = i; } }
    if (s >= 0 && last - s + 1 >= step) out.push([s, last]);
    return out;
  };
  const vCand = [], hCand = [];
  for (let x = 0; x < w; x++) for (const [a, b] of runs(h, minV, y => g[y * w + x])) vCand.push({x, a, b});
  for (let y = 0; y < h; y++) for (const [a, b] of runs(w, minH, x => g[y * w + x])) hCand.push({y, a, b});
  /* merge neighbouring scan lines into one rule and drop thick shapes (photos, filled boxes) */
  const merge = (cand, key) => {
    cand.sort((p, q) => p[key] - q[key] || p.a - q.a); const out = [];
    for (const c of cand) {
      const r = out.find(o => c[key] - o.k1 <= 1 && c.a < o.b && c.b > o.a && Math.min(c.b - c.a, o.b - o.a) / Math.max(c.b - c.a, o.b - o.a) > .6);
      if (r) { r.k1 = c[key]; r.a = Math.min(r.a, c.a); r.b = Math.max(r.b, c.b); } else out.push({k0: c[key], k1: c[key], a: c.a, b: c.b});
    }
    return out.filter(o => o.k1 - o.k0 + 1 <= maxThick);
  };
  return {v: merge(vCand, "x").map(o => ({x: (o.k0 + o.k1) / 2, y0: o.a, y1: o.b})), h: merge(hCand, "y").map(o => ({y: (o.k0 + o.k1) / 2, x0: o.a, x1: o.b}))};
}
/* Pixel rules -> the rule objects the layout code uses (points). */
const scanRulesToPt = (R, sc) => R.v.map(r => ({x0: r.x / sc, x1: r.x / sc, y0: r.y0 / sc, y1: r.y1 / sc})).concat(R.h.map(r => ({x0: r.x0 / sc, x1: r.x1 / sc, y0: r.y / sc, y1: r.y / sc})));

/* x-height / cap-height ratio from symbol boxes (NaN when unknown). */
function scanXCap(words) {
  const caps = [], xs = [];
  for (const w of words) for (const s of w.symbols || []) { const h = s.y1 - s.y0; if (/^[A-PR-Z]$/.test(s.text) && !/[JQ]/.test(s.text)) caps.push(h); else if (/^[acemnorsuvwxz]$/.test(s.text)) xs.push(h); }
  return caps.length >= 2 && xs.length >= 3 ? scanMedian(xs) / scanMedian(caps) : NaN;
}
/* Letter heights -> font size. symbols/words in points. */
function scanSize(words, fam) {
  const M = SCAN_METRICS[fam] || SCAN_METRICS.sans; const caps = [], xs = [], xflat = [];
  for (const w of words) {
    if (w.symbols && w.symbols.length) {
      for (const s of w.symbols) { const t = s.text || ""; const hgt = s.y1 - s.y0; if (hgt <= 0) continue; if (/^[A-PR-Z0-9]$/.test(t) && !/[JQ]/.test(t)) caps.push(hgt); else if (/^[acemnorsuvwxz]$/.test(t)) { xs.push(hgt); if (/^[xzvwu]$/.test(t)) xflat.push(hgt); } }
    } else {
      const t = w.text || ""; const hgt = w.y1 - w.y0;
      if (/^[A-PR-Z0-9.:\-\/&#%+=]+$/.test(t) && /[A-Z0-9]/.test(t) && !/[JQ]/.test(t)) caps.push(hgt);
      else if (/^[acemnorsuvwxz.:\-]+$/.test(t) && /[a-z]/.test(t)) xs.push(hgt);
    }
  }
  /* flat-topped letters (x z v w u) have no overshoot, so they give the cleanest x-height */
  const c = scanMedian(caps), x = xflat.length >= 2 ? scanMedian(xflat) : scanMedian(xs);
  const sc = isFinite(c) ? c / M.cap : NaN, sx = isFinite(x) ? x / M.xh : NaN;
  /* capital letters and digits are the most reliable measure; x-height only helps when there are few capitals */
  if (isFinite(sc) && caps.length >= 3) return sc;
  if (isFinite(sc) && isFinite(sx)) return Math.abs(sc / sx - 1) < .25 ? (sc * caps.length * 3 + sx * xs.length) / (caps.length * 3 + xs.length) /* capitals are taller, so a pixel of blur matters less */ : (caps.length >= 2 ? sc : sx);
  if (isFinite(sc)) return sc;
  if (isFinite(sx)) return sx;
  /* last resort: words with ascenders span ~0.72 em from baseline to top */
  const hs = words.map(w => (w.base || w.y1) - w.y0).filter(v => v > 0); return scanMedian(hs) / .74;
}
/* Split one OCR line (points) into pieces at column borders and wide gaps. */
function scanSplitLine(words, vRules) {
  if (!words.length) return [];
  const ws = words.slice().sort((a, b) => a.x0 - b.x0);
  const gaps = []; for (let i = 1; i < ws.length; i++) gaps.push(ws[i].x0 - ws[i - 1].x1);
  const med = scanMedian(gaps.filter(g => g > 0)) || 0;
  const em = scanSize(ws, "sans") || (ws[0].y1 - ws[0].y0);
  const segs = [[ws[0]]];
  for (let i = 1; i < ws.length; i++) {
    const a = ws[i - 1], b = ws[i], gap = b.x0 - a.x1; const mid = (Math.min(a.y0, b.y0) + Math.max(a.y1, b.y1)) / 2;
    const ruled = vRules.some(r => r.x0 > a.x1 - .6 && r.x0 < b.x0 + .6 && r.y0 < mid && r.y1 > mid);
    const wide = gap > 2 * em || (gap > 1.5 * med && gap > .8 * em && gaps.length > 1);
    if (ruled || wide) segs.push([b]); else segs[segs.length - 1].push(b);
  }
  return segs;
}
/* Width-based family choice and horizontal scale. measure(fam, bold, text, size) -> advance width in points. */
/* Serif is only considered when the letter shapes say so (x-height / cap height clearly below a sans font's ~0.72),
   because a condensed sans and a serif font can have the same width. */
function scanFamily(text, inkW, size, bold, measure, uniform, xcap, contrast) {
  const target = inkW + size * .08; /* ink width is a little narrower than the advance width */
  if (contrast > 1.7 && !uniform) { const w = measure("serif", bold, text, size); if (w > 0) return {fam: "serif", hscale: clamp(target / w, .6, 1.4)}; }
  const fams = ["sans"]; if ((xcap && xcap < .7) || contrast > 1.45) fams.push("serif"); if (uniform) fams.push("mono");
  let best = "sans", bestErr = Infinity, bestR = 1;
  for (const f of fams) {
    const w = measure(f, bold, text, size); if (!(w > 0)) continue;
    const r = target / w; let err = Math.abs(Math.log(r)); if (f !== "sans") err += .04;
    if (err < bestErr) { bestErr = err; best = f; bestR = r; }
  }
  return {fam: best, hscale: clamp(bestR, .6, 1.4)};
}
/* Average darkness of glyph boxes (for bold detection) and the ink colour. img: RGBA, G: gray, boxes in pixels. */
function scanInk(img, G, boxes) {
  let darkN = 0, all = 0; const rs = [], gs = [], bs = [];
  for (const b of boxes) {
    const x0 = Math.max(0, Math.floor(b.x0)), x1 = Math.min(G.w - 1, Math.ceil(b.x1)), y0 = Math.max(0, Math.floor(b.y0)), y1 = Math.min(G.h - 1, Math.ceil(b.y1));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * G.w + x; all++;
      if (G.g[i] < G.dark) { darkN++; if ((darkN & 1) === 0) rs.push(i); }
    }
  }
  /* ink colour: the darker part of the stroke pixels (edge pixels are mixed with paper) */
  rs.sort((a, b) => G.g[a] - G.g[b]); const core = rs.slice(0, Math.max(1, Math.ceil(rs.length * .4)));
  const ch = k => scanMedian(core.map(i => img.data[i * 4 + k]));
  return {density: all ? darkN / all : 0, color: rs.length ? [ch(0), ch(1), ch(2)] : [30, 30, 30]};
}
/* Paper colour right around a box (pixels): median of the light pixels in a thin ring just outside it. */
function scanPaper(img, G, b) {
  const r = [], g = [], bl = []; const x0 = Math.floor(b.x0) - 5, x1 = Math.ceil(b.x1) + 5, y0 = Math.floor(b.y0) - 5, y1 = Math.ceil(b.y1) + 5;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (x < 0 || y < 0 || x >= G.w || y >= G.h) continue;
    const inner = x > b.x0 - 2 && x < b.x1 + 2 && y > b.y0 - 2 && y < b.y1 + 2; if (inner) continue;
    const i = y * G.w + x; if (G.g[i] < G.dark + 30) continue;
    r.push(img.data[i * 4]); g.push(img.data[i * 4 + 1]); bl.push(img.data[i * 4 + 2]);
  }
  return r.length ? [scanMedian(r), scanMedian(g), scanMedian(bl)].map(Math.round) : [G.paper, G.paper, G.paper];
}
/* Stroke contrast: typical thickness of vertical stems (horizontal dark runs) / of horizontal strokes (vertical dark runs).
   Sans-serif fonts are close to 1; serif fonts such as Times have thin horizontals and score about 2 or more. */
function scanContrast(G, boxes) {
  const vt = [], ht = [];
  for (const bx of boxes) {
    const x0 = Math.max(0, Math.floor(bx.x0)), x1 = Math.min(G.w - 1, Math.ceil(bx.x1)), y0 = Math.max(0, Math.floor(bx.y0)), y1 = Math.min(G.h - 1, Math.ceil(bx.y1));
    const w = x1 - x0 + 1, h = y1 - y0 + 1; if (w < 3 || h < 3) continue;
    const H = new Uint16Array(w * h), V = new Uint16Array(w * h), dk = (x, y) => G.g[(y0 + y) * G.w + x0 + x] < G.dark;
    for (let y = 0; y < h; y++) { let s = 0; for (let x = 0; x <= w; x++) { if (x < w && dk(x, y)) continue; for (let k = s; k < x; k++) H[y * w + k] = x - s; s = x + 1; } }
    for (let x = 0; x < w; x++) { let s = 0; for (let y = 0; y <= h; y++) { if (y < h && dk(x, y)) continue; for (let k = s; k < y; k++) V[k * w + x] = y - s; s = y + 1; } }
    for (let i = 0; i < w * h; i++) { const hh = H[i], vv = V[i]; if (!hh) continue; if (vv >= 2.5 * hh) vt.push(hh); else if (hh >= 2.5 * vv) ht.push(vv); }
  }
  const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN;
  const mv = mean(vt), mh = mean(ht);
  return vt.length > 30 && ht.length > 15 && mh > 0 ? mv / mh : 1;
}
/* Tighten a box to the dark pixels inside it (OCR boxes are often a pixel or two loose). Pixel coordinates. */
function scanTight(G, b, pad = 1) {
  const x0 = Math.max(0, Math.floor(b.x0)), x1 = Math.min(G.w - 1, Math.ceil(b.x1)), y0 = Math.max(0, Math.floor(b.y0) - pad), y1 = Math.min(G.h - 1, Math.ceil(b.y1) + pad);
  let ty0 = Infinity, ty1 = -1, tx0 = Infinity, tx1 = -1;
  const th = G.mid || G.dark;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (G.g[y * G.w + x] < th) { if (y < ty0) ty0 = y; if (y > ty1) ty1 = y; if (x < tx0) tx0 = x; if (x > tx1) tx1 = x; }
  if (ty1 < 0) return b;
  /* sub-pixel top/bottom: how much of the row just outside the edge is covered by ink (anti-aliasing) */
  const ink = Math.min(G.ink, G.paper - 80), span = Math.max(1, G.paper - ink);
  const cover = y => { if (y < 0 || y >= G.h) return 0; let mn = 255; for (let x = tx0; x <= tx1; x++) mn = Math.min(mn, G.g[y * G.w + x]); return clamp((G.paper - mn) / span, 0, 1); };
  const ct = ty0 > y0 ? cover(ty0 - 1) : 0, cb = ty1 < y1 ? cover(ty1 + 1) : 0;
  const ft = clamp(cover(ty0), 0, 1), fb = clamp(cover(ty1), 0, 1);
  return {x0: tx0, y0: ty0 + (1 - ft) - (ft >= .99 ? ct : 0), x1: tx1 + 1, y1: ty1 + fb + (fb >= .99 ? cb : 0)};
}
/* OCR lines (tesseract, pixels at sc px/pt) + page image -> editable lines with size, family, scale, weight and colours. */
function scanLines(ocrLines, sc, img, G, rulesPt, measure) {
  const vRules = rulesPt.filter(r => r.x1 - r.x0 < 1.5);
  const out = [];
  for (const L of ocrLines) {
    const bl = L.baseline, lb = L.bbox; if (!lb) continue;
    const baseAt = x => bl && bl.x1 > bl.x0 && bl.y0 > lb.y0 ? bl.y0 + (bl.y1 - bl.y0) * (x - bl.x0) / (bl.x1 - bl.x0) : lb.y1 - (lb.y1 - lb.y0) * .2;
    const words = (L.words || []).filter(w => w.bbox && String(w.text || "").trim()).map(w => ({
      src: w, lineBaseline: bl, text: String(w.text).trim(), conf: w.confidence, x0: w.bbox.x0 / sc, y0: w.bbox.y0 / sc, x1: w.bbox.x1 / sc, y1: w.bbox.y1 / sc, base: baseAt((w.bbox.x0 + w.bbox.x1) / 2) / sc, px: w.bbox,
      symbols: (w.symbols || []).filter(s => s.bbox && s.text).map(s => { const t = G ? scanTight(G, s.bbox) : s.bbox; return {text: s.text, x0: t.x0 / sc, y0: t.y0 / sc, x1: t.x1 / sc, y1: t.y1 / sc}; })}));
    for (const seg of scanSplitLine(words, vRules)) {
      const text = seg.map(w => w.text).join(" ");
      const x = Math.min(...seg.map(w => w.x0)), x1 = Math.max(...seg.map(w => w.x1));
      const base = scanMedian(seg.map(w => w.base));
      const ink = img ? scanInk(img, G, seg.map(w => w.px)) : {density: 0, color: [30, 30, 30]};
      const symW = seg.flatMap(w => w.symbols.filter(s => /[A-Za-z]/.test(s.text)).map(s => s.x1 - s.x0));
      const uniform = symW.length >= 6 && (() => { const m = symW.reduce((a, b) => a + b, 0) / symW.length; const sd = Math.sqrt(symW.reduce((a, b) => a + (b - m) ** 2, 0) / symW.length); return sd / m < .18; })();
      out.push({words: seg, text, x, w: x1 - x, ink: x1 - x, top: Math.min(...seg.map(w => w.y0)), bottom: Math.max(...seg.map(w => w.y1)), base,
        density: ink.density, color: ink.color.map(v => v / 255), uniform, contrast: img ? scanContrast(G, seg.map(w => w.px)) : 1, conf: scanMedian(seg.map(w => w.conf))});
    }
  }
  /* weight: clearly darker strokes than the page's typical text */
  const medD = scanMedian(out.map(l => l.density).filter(v => v > 0));
  for (const l of out) {
    l.bold = out.length >= 4 && l.density > medD * 1.35;
    let fam = "sans", size = scanSize(l.words, fam);
    if (measure && isFinite(size) && size > 2) {
      const f = scanFamily(l.text, l.ink, size, l.bold, measure, l.uniform, scanXCap(l.words), l.contrast); fam = f.fam;
      size = scanSize(l.words, fam) || size;
      l.hscale = scanFamily(l.text, l.ink, size, l.bold, (ff, b, t, s) => ff === fam ? measure(ff, b, t, s) : NaN, false).hscale;
    } else l.hscale = 1;
    l.size = isFinite(size) && size > 2 ? size : Math.max(4, (l.bottom - l.top) * .7);
    l.font = {fam, bold: l.bold, italic: false, sure: true};
  }
  /* pieces on the same row with nearly the same size get exactly the same size */
  for (const l of out) {
    const row = out.filter(o => Math.abs(o.base - l.base) < Math.max(1.5, l.size * .2) && Math.abs(o.size / l.size - 1) < .07 && o.font.fam === l.font.fam && o.bold === l.bold);
    if (row.length > 1) l.sizeRow = scanMedian(row.map(o => o.size));
  }
  for (const l of out) {
    if (l.sizeRow) { l.size = l.sizeRow; delete l.sizeRow; }
    if (measure) { const w = measure(l.font.fam, l.bold, l.text, l.size); if (w > 0) l.hscale = clamp((l.ink + l.size * .08) / w, .6, 1.4); }
  }
  return out;
}

/* ---------- Phone photos of documents: find the page, flatten perspective, even out the lighting ---------- */
/* Otsu threshold of a luminance array. */
function scanOtsu(g) {
  const h = new Float64Array(256); for (let i = 0; i < g.length; i++) h[g[i]]++;
  let sum = 0; for (let v = 0; v < 256; v++) sum += v * h[v];
  let wB = 0, sB = 0, best = 0, th = 128; const n = g.length;
  for (let v = 0; v < 256; v++) { wB += h[v]; if (!wB) continue; const wF = n - wB; if (!wF) break; sB += v * h[v]; const mB = sB / wB, mF = (sum - sB) / wF; const between = wB * wF * (mB - mF) ** 2; if (between > best) { best = between; th = v; } }
  return th;
}
/* The page as a quadrilateral [tl, tr, br, bl] (pixels) in a luminance image, or null when the whole picture is the page. */
function scanFindPage(g, w, h) {
  const th = scanOtsu(g); const mask = new Uint8Array(w * h); for (let i = 0; i < g.length; i++) mask[i] = g[i] > th ? 1 : 0;
  /* largest bright connected region */
  const lab = new Int32Array(w * h); let best = 0, bestN = 0, cur = 0; const stack = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || lab[i]) continue; cur++; let sp = 0, cnt = 0; stack[sp++] = i; lab[i] = cur;
    while (sp) { const k = stack[--sp]; cnt++; const x = k % w, y = (k / w) | 0;
      if (x > 0 && mask[k - 1] && !lab[k - 1]) { lab[k - 1] = cur; stack[sp++] = k - 1; } if (x < w - 1 && mask[k + 1] && !lab[k + 1]) { lab[k + 1] = cur; stack[sp++] = k + 1; }
      if (y > 0 && mask[k - w] && !lab[k - w]) { lab[k - w] = cur; stack[sp++] = k - w; } if (y < h - 1 && mask[k + w] && !lab[k + w]) { lab[k + w] = cur; stack[sp++] = k + w; } }
    if (cnt > bestN) { bestN = cnt; best = cur; }
  }
  if (bestN < w * h * .2) return null;
  let tl = null, tr = null, br = null, bl = null, s1 = Infinity, s2 = -Infinity, d1 = -Infinity, d2 = Infinity;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (lab[y * w + x] !== best) continue; const a = x + y, d = x - y;
    if (a < s1) { s1 = a; tl = [x, y]; } if (a > s2) { s2 = a; br = [x + 1, y + 1]; } if (d > d1) { d1 = d; tr = [x + 1, y]; } if (d < d2) { d2 = d; bl = [x, y + 1]; }
  }
  const q = [tl, tr, br, bl]; const area = Math.abs(q.reduce((s, p, i) => { const r = q[(i + 1) % 4]; return s + p[0] * r[1] - r[0] * p[1]; }, 0)) / 2;
  if (area > w * h * .92) return null; /* page fills the picture: it's a scan, leave it alone */
  return q;
}
/* Homography mapping the output rectangle (0..W, 0..H) onto the quadrilateral. */
function scanHomography(q, W, H) {
  const [p0, p1, p2, p3] = q; const src = [[0, 0], [W, 0], [W, H], [0, H]]; const dst = [p0, p1, p2, p3];
  const A = [], bb = [];
  for (let i = 0; i < 4; i++) { const [x, y] = src[i], [u, v] = dst[i]; A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); bb.push(u); A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); bb.push(v); }
  for (let c = 0; c < 8; c++) { let piv = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r; [A[c], A[piv]] = [A[piv], A[c]]; [bb[c], bb[piv]] = [bb[piv], bb[c]];
    for (let r = 0; r < 8; r++) { if (r === c) continue; const f = A[r][c] / A[c][c]; for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k]; bb[r] -= f * bb[c]; } }
  const hm = bb.map((v, i) => v / A[i][i]); return [...hm, 1];
}
/* Warp an RGBA image so the quadrilateral becomes a W x H rectangle (bilinear). */
function scanWarp(img, q, W, H) {
  const m = scanHomography(q, W, H); const out = new Uint8ClampedArray(W * H * 4); const sw = img.width, sh = img.height, d = img.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const z = m[6] * x + m[7] * y + m[8], u = (m[0] * x + m[1] * y + m[2]) / z, v = (m[3] * x + m[4] * y + m[5]) / z;
    const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0; const o = (y * W + x) * 4;
    if (x0 < 0 || y0 < 0 || x0 >= sw - 1 || y0 >= sh - 1) { out[o] = out[o + 1] = out[o + 2] = 255; out[o + 3] = 255; continue; }
    const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
    for (let c = 0; c < 3; c++) out[o + c] = (d[i00 + c] * (1 - fx) + d[i10 + c] * fx) * (1 - fy) + (d[i01 + c] * (1 - fx) + d[i11 + c] * fx) * fy;
    out[o + 3] = 255;
  }
  return {width: W, height: H, data: out};
}
/* Even out uneven lighting: divide by a smooth estimate of the paper brightness (text removed by a max filter). */
function scanFlatten(img) {
  const W = img.width, H = img.height, d = img.data, S = 16; const bw = Math.ceil(W / S), bh = Math.ceil(H / S);
  const bg = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) { const v = []; for (let y = by * S; y < Math.min(H, by * S + S); y += 2) for (let x = bx * S; x < Math.min(W, bx * S + S); x += 2) { const i = (y * W + x) * 4; v.push((d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8); } v.sort((a, b) => a - b); bg[by * bw + bx] = v[Math.floor(v.length * .9)] || 255; }
  /* max filter then box blur, both 3 cells wide */
  const pass = (src, f) => { const o = new Float32Array(bw * bh); for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { let acc = f === "max" ? 0 : 0, n = 0; for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) { const xx = x + i, yy = y + j; if (xx < 0 || yy < 0 || xx >= bw || yy >= bh) continue; const v = src[yy * bw + xx]; if (f === "max") acc = Math.max(acc, v); else { acc += v; n++; } } o[y * bw + x] = f === "max" ? acc : acc / n; } return o; };
  const smooth = pass(pass(bg, "max"), "avg"); const target = 245;
  const out = new Uint8ClampedArray(d.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const gx = clamp(x / S - .5, 0, bw - 1), gy = clamp(y / S - .5, 0, bh - 1), x0 = Math.floor(gx), y0 = Math.floor(gy), x1 = Math.min(bw - 1, x0 + 1), y1 = Math.min(bh - 1, y0 + 1), fx = gx - x0, fy = gy - y0;
    const b = (smooth[y0 * bw + x0] * (1 - fx) + smooth[y0 * bw + x1] * fx) * (1 - fy) + (smooth[y1 * bw + x0] * (1 - fx) + smooth[y1 * bw + x1] * fx) * fy;
    const k = target / Math.max(40, b); const i = (y * W + x) * 4;
    out[i] = d[i] * k; out[i + 1] = d[i + 1] * k; out[i + 2] = d[i + 2] * k; out[i + 3] = 255;
  }
  return {width: W, height: H, data: out};
}
/* Full pipeline for a photo: returns {img, quad} or null when no correction is needed. Detection runs on a small copy. */
function scanStraighten(img) {
  const s = Math.min(1, 900 / Math.max(img.width, img.height)); const w = Math.max(1, Math.round(img.width * s)), h = Math.max(1, Math.round(img.height * s));
  const g = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (Math.min(img.height - 1, Math.floor(y / s)) * img.width + Math.min(img.width - 1, Math.floor(x / s))) * 4; g[y * w + x] = (img.data[i] * 77 + img.data[i + 1] * 150 + img.data[i + 2] * 29) >> 8; }
  const q0 = scanFindPage(g, w, h); if (!q0) return null;
  const q = q0.map(([x, y]) => [x / s, y / s]); const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const W = Math.round(Math.max(dist(q[0], q[1]), dist(q[3], q[2]))), H = Math.round(Math.max(dist(q[0], q[3]), dist(q[1], q[2])));
  return {img: scanDenoise(scanFlatten(scanWarp(img, q, W, H))), quad: q};
}
/* Light noise removal on flat areas only (3x3 average where the neighbourhood varies by less than `range`), so text edges stay sharp. */
function scanDenoise(img, range = 24) {
  const W = img.width, H = img.height, d = img.data, o = new Uint8ClampedArray(d);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = (y * W + x) * 4; let mn = 255, mx = 0;
    for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) { const v = d[i + (j * W + k) * 4 + 1]; if (v < mn) mn = v; if (v > mx) mx = v; }
    if (mx - mn > range) continue;
    for (let c = 0; c < 3; c++) { let s = 0; for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) s += d[i + (j * W + k) * 4 + c]; o[i + c] = s / 9; }
  }
  return {width: W, height: H, data: o};
}
