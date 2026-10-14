/* Daftarbox PDF tools – reading the text on a page (text layer or OCR) and turning it into editable blocks.
   The first half is pure maths (tested in Node). The second half talks to pdf.js and tesseract.js. */
"use strict";

/* ---------- Pure helpers ---------- */
/* Font metrics (em units) of the browser fonts we show while editing: ascent, descent. */
const FONT_METRICS = {sans: [.905, .212], serif: [.891, .216], mono: [.833, .300]};
/* Where the baseline sits from the top of a CSS line box of height `gap`. */
const cssBaselineOffset = (fam, size, gap) => { const [a, d] = FONT_METRICS[fam] || FONT_METRICS.sans; return (gap - (a + d) * size) / 2 + a * size; };
/* Multiply two PDF matrices (same as pdf.js Util.transform). */
const mulMatrix = (m1, m2) => [m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1], m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
  m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5]];
/* Guess family/bold/italic from an embedded font name like "ABCDEF+Arial-BoldMT", or a CSS generic family. */
function fontFromName(name, generic) {
  const n = String(name || "").replace(/^[A-Z]{6}\+/, "");
  const bold = /bold|black|heavy|semibold|demi/i.test(n), italic = /italic|oblique/i.test(n);
  let fam = null;
  if (/courier|mono|consol|typewriter|lucidaconsole/i.test(n)) fam = "mono";
  else if (/times|roman|serif(?!.*sans)|georgia|garamond|cambria|book ?antiqua|palatino|minion|baskerville/i.test(n) && !/sans/i.test(n)) fam = "serif";
  else if (/arial|helvetica|calibri|verdana|tahoma|segoe|roboto|sans|gill|futura|frutiger|lato|open ?sans|myriad|univers|franklin/i.test(n)) fam = "sans";
  const sure = !!fam;
  if (!fam) fam = /mono/i.test(generic || "") ? "mono" : /^serif$/i.test(generic || "") ? "serif" : "sans";
  return {fam, bold, italic, sure};
}
/* pdf.js text items -> runs in visible page coordinates (top-left origin, points).
   vt = viewport.transform at scale 1. Only upright, horizontal text is kept. */
function itemsToRuns(items, vt, fontInfo) {
  const runs = []; const vs = Math.hypot(vt[0], vt[1]) || 1;
  for (const it of items) {
    if (typeof it.str !== "string" || !it.str || !it.transform) continue;
    const m = mulMatrix(vt, it.transform);
    const size = Math.hypot(m[2], m[3]); if (size < 2) continue;
    if (Math.abs(m[1]) > Math.abs(m[0]) * .05 || m[0] <= 0 || m[3] >= 0) continue; /* rotated, mirrored or upside down */
    runs.push({x: m[4], base: m[5], w: (it.width || 0) * vs, size, str: it.str, pfn: it.fontName, font: fontInfo ? fontInfo(it.fontName) : fontFromName("", "")});
  }
  return runs;
}
/* Runs -> lines. Runs on the same baseline join when the gap is small; a big gap starts a new line (columns, tables). */
function runsToLines(runs, rules) {
  /* vertical ruling lines (table cell borders) always split a line */
  const vr = (rules || []).filter(q => q.x1 - q.x0 < 1.5 && q.y1 - q.y0 > 4);
  const crosses = (x0, x1, base, size) => vr.some(q => q.x0 > x0 - .3 && q.x0 < x1 + .3 && q.y0 < base - size * .3 && q.y1 > base - size * .3);
  const sorted = runs.slice().sort((a, b) => a.base - b.base || a.x - b.x);
  const lines = [];
  for (const r of sorted) {
    const blank = !r.str.trim();
    let ln = null;
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i];
      if (r.base - l.base > Math.max(l.size, r.size)) break;
      if (Math.abs(l.base - r.base) > Math.min(l.size, r.size) * .35) continue;
      if (Math.max(l.size, r.size) / Math.min(l.size, r.size) > 1.35) continue;
      const gap = r.x - (l.x + l.w);
      if (gap < -l.size * .6 || gap > Math.max(l.size, r.size) * 1.4) continue;
      if (vr.length && crosses(l.x + l.w, r.x, r.base, r.size)) continue;
      ln = l; break;
    }
    if (!ln) {
      if (blank) continue;
      lines.push({x: r.x, w: r.w, base: r.base, size: r.size, text: r.str, font: r.font, pfn: r.pfn, sizes: [r.size]});
      continue;
    }
    const gap = r.x - (ln.x + ln.w);
    if (gap > Math.min(ln.size, r.size) * .15 && !/\s$/.test(ln.text) && !/^\s/.test(r.str)) ln.text += " ";
    ln.text += r.str; ln.w = Math.max(ln.w, r.x + r.w - ln.x);
    if (!blank) { ln.sizes.push(r.size); if (r.str.trim().length > 2 && r.size >= ln.size) ln.font = r.font; }
  }
  for (const l of lines) {
    l.text = l.text.replace(/\s+/g, " ").trim();
    l.size = l.sizes.sort((a, b) => a - b)[Math.floor(l.sizes.length / 2)];
    l.top = l.base - l.size * .88; l.bottom = l.base + l.size * .24; delete l.sizes;
  }
  return lines.filter(l => l.text);
}
/* OCR lines (tesseract, in canvas pixels at `sc` px per point) -> lines in points. */
function ocrToLines(ocrLines, sc) {
  const out = [];
  for (const L of ocrLines) {
    const text = String(L.text || "").replace(/\s+/g, " ").trim(); if (!text || !L.bbox) continue;
    const b = L.bbox; const bl = L.baseline;
    const base = (bl && isFinite(bl.y0) && isFinite(bl.y1) && bl.y0 > b.y0) ? (bl.y0 + bl.y1) / 2 : b.y1 - (b.y1 - b.y0) * .2;
    const h = b.y1 - b.y0;
    const size = clamp((base - b.y0) / .74, h * .6, h * 1.15) / sc;
    const words = (L.words || []).filter(w => w.bbox && String(w.text || "").trim()).map(w => ({text: w.text, conf: w.confidence, x0: w.bbox.x0 / sc, y0: w.bbox.y0 / sc, x1: w.bbox.x1 / sc, y1: w.bbox.y1 / sc}));
    out.push({x: b.x0 / sc, w: (b.x1 - b.x0) / sc, top: b.y0 / sc, bottom: b.y1 / sc, base: base / sc, size, text, font: {fam: "sans", bold: false, italic: false, sure: false}, words, conf: L.confidence});
  }
  return out;
}
/* Lines -> blocks. A following line joins a block when it has the same left edge, size and style and sits right below. */
function linesToBlocks(lines) {
  const sorted = lines.slice().sort((a, b) => a.top - b.top || a.x - b.x);
  const blocks = [];
  const fk = f => f.fam + (f.bold ? "b" : "") + (f.italic ? "i" : "");
  for (const l of sorted) {
    let host = null;
    for (let i = blocks.length - 1; i >= 0 && i >= blocks.length - 6; i--) {
      const b = blocks[i]; const last = b.src[b.src.length - 1];
      const dy = l.base - last.base;
      if (dy < l.size * .9 || dy > Math.max(l.size, last.size) * 1.85) continue;
      if (Math.abs(l.x - b.x) > l.size * .8) continue;
      if (Math.abs(l.size / b.size - 1) > .12 || fk(l.font) !== fk(b.font)) continue;
      if (b.src.length > 1 && Math.abs(dy - b.gap) > b.size * .3) continue;
      host = b; break;
    }
    if (host) {
      host.gap = host.src.length === 1 ? l.base - host.src[0].base : (l.base - host.src[0].base) / host.src.length;
      host.src.push(l); host.lines.push(l.text);
      host.x = Math.min(host.x, l.x); host.w = Math.max(...host.src.map(s => s.x + s.w)) - host.x; host.bottom = Math.max(host.bottom, l.bottom);
      if (l.words) host.words.push(...l.words);
    } else blocks.push({x: l.x, w: l.w, top: l.top, bottom: l.bottom, base0: l.base, gap: l.size * 1.2, size: l.size, font: l.font, lines: [l.text], src: [l], words: l.words ? l.words.slice() : []});
  }
  for (const b of blocks) { b.top = Math.min(...b.src.map(s => s.top)); delete b.src; }
  return blocks;
}
/* Background and text colour around/inside a box. img: {data, width, height}; rect in pixels. Colours are [r,g,b] 0-255. */
function sampleColors(img, x, y, w, h) {
  const W = img.width, H = img.height, d = img.data;
  const px = (i, j) => { i = clamp(Math.round(i), 0, W - 1); j = clamp(Math.round(j), 0, H - 1); const k = (j * W + i) * 4; return [d[k], d[k + 1], d[k + 2]]; };
  const ring = []; const m = 3; const sx = Math.max(1, (w + 2 * m) / 48), sy = Math.max(1, (h + 2 * m) / 12);
  for (let i = x - m; i <= x + w + m; i += sx) ring.push(px(i, y - m), px(i, y + h + m));
  for (let j = y - m; j <= y + h + m; j += sy) ring.push(px(x - m, j), px(x + w + m, j));
  const buckets = new Map();
  for (const c of ring) { const key = (c[0] >> 4) + "," + (c[1] >> 4) + "," + (c[2] >> 4); const b = buckets.get(key) || []; b.push(c); buckets.set(key, b); }
  let best = []; for (const b of buckets.values()) if (b.length > best.length) best = b;
  const avg = list => [0, 1, 2].map(k => Math.round(list.reduce((s, c) => s + c[k], 0) / list.length));
  const bg = best.length ? avg(best) : [255, 255, 255];
  const dist = c => Math.abs(c[0] - bg[0]) + Math.abs(c[1] - bg[1]) + Math.abs(c[2] - bg[2]);
  const inside = []; const ix = Math.max(1, w / 80), iy = Math.max(1, h / 24);
  for (let j = y; j < y + h; j += iy) for (let i = x; i < x + w; i += ix) { const c = px(i, j); const dd = dist(c); if (dd > 90) inside.push([c, dd]); }
  inside.sort((a, b) => b[1] - a[1]);
  const fg = inside.length ? avg(inside.slice(0, Math.max(1, Math.ceil(inside.length * .3))).map(e => e[0])) : (bg[0] + bg[1] + bg[2] > 384 ? [0, 0, 0] : [255, 255, 255]);
  return {bg, fg};
}
/* Word-wrap with any width function. */
function wrapMeasured(text, measure, maxW) {
  const words = text.split(" "); const lines = []; let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (!cur || measure(t) <= maxW) cur = t; else { lines.push(cur); cur = w; }
  }
  lines.push(cur);
  return lines;
}
/* Fit edited text into the original box: keep the size if it fits, otherwise shrink a little (down to minScale),
   and only wrap/grow when shrinking isn't enough. measure(str, size) -> width. */
function fitText(text, measure, maxW, size, maxLines, minScale = .72) {
  const paras = String(text).split("\n");
  const layout = (s, wrap) => paras.flatMap(p => wrap && p ? wrapMeasured(p, t => measure(t, s), maxW) : [p]);
  const fits = (ls, s) => ls.length <= Math.max(maxLines, paras.length) && ls.every(l => measure(l, s) <= maxW * 1.01);
  const multi = maxLines > 1;
  for (let s = size; s >= size * minScale - 1e-9; s *= .96) {
    const ls = layout(s, multi);
    if (fits(ls, s)) return {size: s, lines: ls, overflow: false};
  }
  const s = size * minScale;
  return {size: s, lines: layout(s, true), overflow: true};
}
/* Choose the standard family whose width best matches the original text. widthAt1(fam, str) -> width at size 1. */
function pickFamily(lines, origW, size, widthAt1, hint) {
  const longest = lines.reduce((a, b) => b.length > a.length ? b : a, "");
  if (!longest || !origW) return hint || "sans";
  let best = hint || "sans", bestErr = Infinity;
  for (const fam of ["sans", "serif", "mono"]) {
    const w = widthAt1(fam, longest) * size; const err = Math.abs(Math.log(w / origW));
    if (err < bestErr - .02) { bestErr = err; best = fam; }
  }
  return best;
}
/* Visible rectangle -> pdf-lib draw options (bottom-left origin, rotation) using pageFrame. */
function visDrawBox(F, vx, vy, w, h) { const [x, y] = F.pt(vx, vy + h); return {x, y, width: w, height: h, rotate: PDFLib.degrees(F.r)}; }
/* OCR words with a baseline, in points, for the invisible text layer. */
function ocrWordsPt(ocrLines, sc) {
  const out = [];
  for (const L of ocrLines) {
    const bl = L.baseline, b = L.bbox; if (!b) continue;
    const baseAt = x => bl && bl.x1 > bl.x0 && bl.y0 > b.y0 ? bl.y0 + (bl.y1 - bl.y0) * (x - bl.x0) / (bl.x1 - bl.x0) : b.y1 - (b.y1 - b.y0) * .2;
    for (const w of L.words || []) {
      const t = String(w.text || "").trim(); if (!t || !w.bbox) continue;
      const wb = w.bbox; const base = clamp(baseAt((wb.x0 + wb.x1) / 2), wb.y0 + 1, wb.y1);
      out.push({text: t, conf: w.confidence, x0: wb.x0 / sc, y0: wb.y0 / sc, x1: wb.x1 / sc, y1: wb.y1 / sc, base: base / sc});
    }
  }
  return out;
}

/* ---------- Browser side: OCR with tesseract.js (Apache-2.0), loaded only when needed ---------- */
CDN.tesseract = ["https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js"];
const TESS = {worker: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js", core: "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1"};
let ocrW = null, ocrLang = "", ocrProg = null, ocrStarting = null;
async function ocrWorker(lang) {
  if (ocrW && ocrLang === lang) return ocrW;
  if (ocrStarting && ocrStarting.lang === lang) return ocrStarting.p;
  await ocrStop();
  const p = (async () => {
    await need("tesseract");
    try {
      const w = await Tesseract.createWorker(lang.split("+"), 1, {workerPath: TESS.worker, corePath: TESS.core, cacheMethod: "none", logger: m => ocrProg && ocrProg(m)});
      ocrW = w; ocrLang = lang; return w;
    } catch (e) {
      console.error(e);
      const err = new Error(location.protocol === "file:"
        ? "The text reader (OCR) couldn't start. Browsers often block it when the page is opened straight from a file on your computer. Open the site through its web address and try again."
        : "The text reader (OCR) couldn't start. Check your internet connection, then try again.");
      err.ocrStart = true; throw err;
    } finally { ocrStarting = null; }
  })();
  ocrStarting = {lang, p};
  return p;
}
async function ocrStop() {
  const w = ocrW; ocrW = null; ocrLang = ""; ocrProg = null;
  if (w) { try { await w.terminate(); } catch (e) { /* already stopped */ } }
}
async function ocrCanvas(canvas, lang, onProgress) {
  const w = await ocrWorker(lang); ocrProg = onProgress || null;
  try { return (await w.recognize(canvas, {}, {blocks: true, text: true})).data; }
  finally { ocrProg = null; }
}
const ocrDataLines = data => data && data.blocks ? data.blocks.flatMap(b => (b.paragraphs || []).flatMap(p => p.lines || [])) : (data && data.lines) || [];
const countChars = items => items.reduce((s, i) => s + String(i.str || "").replace(/\s/g, "").length, 0);

/* Read one page: its real text if it has some, otherwise OCR (if allowed). Returns {source, blocks}. */
async function recognizePage(pdf, n, {ocr = true, lang = "eng", dpi = 250, onProgress} = {}) {
  const page = await pdf.getPage(n); const vp1 = page.getViewport({scale: 1});
  try {
    const tc = await page.getTextContent();
    if (countChars(tc.items) >= 8) {
      const c = await renderPage(page, 1.5); const sc = c.width / vp1.width;
      const fontInfo = name => {
        let real = "", bold = false;
        try { if (page.commonObjs.has(name)) { const f = page.commonObjs.get(name); real = f.name || ""; bold = !!(f.bold || f.black); } } catch (e) { /* font not loaded */ }
        const fi = fontFromName(real, (tc.styles[name] || {}).fontFamily); if (bold) fi.bold = true; return fi;
      };
      const blocks = linesToBlocks(runsToLines(itemsToRuns(tc.items, vp1.transform, fontInfo)));
      addColours(blocks, c, sc); c.width = c.height = 0;
      return {source: "text", blocks};
    }
    if (!ocr) return {source: "none", blocks: []};
    const c = await renderPage(page, dpi / 72); const sc = c.width / vp1.width;
    try {
      const data = await ocrCanvas(c, lang, onProgress);
      const blocks = linesToBlocks(ocrToLines(ocrDataLines(data), sc));
      addColours(blocks, c, sc);
      return {source: "ocr", blocks, text: data.text || ""};
    } finally { c.width = c.height = 0; }
  } finally { page.cleanup(); }
}
function addColours(blocks, canvas, sc) {
  if (!blocks.length) return;
  const img = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
  for (const b of blocks) { const k = sampleColors(img, b.x * sc, b.top * sc, b.w * sc, (b.bottom - b.top) * sc); b.bg = k.bg; b.fg = k.fg; }
}

/* ---------- Devanagari text layers in visual order ----------
   Many PDFs store Hindi glyphs in the order they are drawn, so extracted text reads "िलिमटेड" instead of "लिमिटेड".
   indicRepair() puts the common cases back in logical order; indicSuspect() says whether a line still looks wrong. */
const DEV_C = "[क-हक़-य़]";
const DEV_SIGN = "[ऀ-ःऺ-ौॎॏॕ-ॗॢॣ]";
function indicRepair(t) {
  if (!/[ऀ-ॿ]/.test(t)) return t;
  let s = t;
  /* reph drawn after its syllable ("डसर्"): move र् back in front of that syllable */
  s = s.replace(new RegExp("इर्(?!" + DEV_C + ")", "g"), "ई");                       /* इ + reph glyph = ई */
  s = s.replace(new RegExp("((?:" + DEV_C + "़?्)*" + DEV_C + "़?" + DEV_SIGN + "*)र्(?!" + DEV_C + ")", "g"), "र्$1");
  s = s.replace(new RegExp("((?:" + DEV_C + "\\u093C?\\u094D)*" + DEV_C + "\\u093C?)\\u0930\\u094D\\u0930", "g"), "\u0930\u094D$1\u0930");   /* "ऑडर्र" -> "ऑर्डर" */
  s = s.replace(new RegExp("([\\u0900-\\u097F])[ \\u00A0]+(?!\\u093F)(" + DEV_SIGN + ")", "g"), "$1$2");     /* "प्र ाइवेट"; a word-initial i-matra belongs to the next word */
  s = s.replace(new RegExp("्[  ]+(?=" + DEV_C + ")", "g"), "्");                           /* "ध् यान" */
  /* pre-base i-matra drawn before its consonant cluster: move it after the cluster */
  s = s.replace(new RegExp("ि((?:" + DEV_C + "़?्)*" + DEV_C + "़?)", "g"), "$1ि");
  return s;
}
function indicSuspect(t) {
  if (!/[ऀ-ॿ]/.test(t)) return false;
  return new RegExp("(^|[\\s(।])" + DEV_SIGN).test(t) || new RegExp("र्(?!" + DEV_C + ")").test(t);
}

/* Similarity of two strings, 0..1 (Levenshtein on characters, spaces ignored). */
function textSim(a, b) {
  a = [...String(a).replace(/\s+/g, "")]; b = [...String(b).replace(/\s+/g, "")];
  if (!a.length && !b.length) return 1; if (!a.length || !b.length) return 0;
  let prev = Array.from({length: b.length + 1}, (_, j) => j);
  for (let x = 1; x <= a.length; x++) { const cur = [x]; for (let y = 1; y <= b.length; y++) cur[y] = Math.min(prev[y] + 1, cur[y - 1] + 1, prev[y - 1] + (a[x - 1] === b[y - 1] ? 0 : 1)); prev = cur; }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}
