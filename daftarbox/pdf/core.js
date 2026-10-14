/* Daftarbox PDF tools – core helpers (no UI). Classic script so it works from file:// too. */
"use strict";

/* ---------- Basics ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmtSize = b => b < 1024 ? b + " B" : b < 1048576 ? (b / 1024).toFixed(1) + " KB" : (b / 1048576).toFixed(1) + " MB";
const baseName = n => n.replace(/\.[^.]+$/, "");
const extOf = n => ((n.match(/\.([^.]+)$/) || [, ""])[1]).toLowerCase();
const plural = (n, w, ws) => n + " " + (n === 1 ? w : (ws || w + "s"));
const pdfBlob = bytes => new Blob([bytes], {type: "application/pdf"});
const canvasBlob = (c, type, q) => new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error("The image couldn't be created. Try a lower quality setting.")), type, q));
const dataUrlBytes = url => Uint8Array.from(atob(url.split(",")[1]), ch => ch.charCodeAt(0));
const hexRgb = h => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ""); const n = m ? parseInt(m[1], 16) : 0; return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const S = (d, extra = "") => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
const ICON = {
  up: S('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  down: S('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  left: S('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
  right: S('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  x: S('<path d="M6 6l12 12M18 6 6 18"/>'),
  rot: S('<path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v5h-5"/>'),
  plus: S('<path d="M12 5v14M5 12h14"/>'),
  check: S('<path d="M5 12.5l4.5 4.5L19 7"/>'),
  lock: S('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  file: S('<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>'),
  dl: S('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  device: S('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>'),
  free: S('<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>'),
  user: S('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>')
};
/* Tool icons: simple line drawings, drawn for this site. */
const DOC = '<path d="M6 3h8l4 4v14H6z"/>';
const TICON = {
  merge: S('<path d="M6 4v5l6 5 6-5V4M12 14v6M9 17l3 3 3-3"/>'),
  split: S('<path d="M12 3v6M12 9l-6 6v6M12 9l6 6v6"/>'),
  organise: S('<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'),
  rotate: S('<path d="M19 12a7 7 0 1 1-2-4.9M19 4v4h-4"/><rect x="9" y="9" width="6" height="6" rx="1"/>'),
  remove: S(DOC + '<path d="M9 13h6"/>'),
  extract: S(DOC + '<path d="M12 17v-6M9 14l3-3 3 3"/>'),
  compress: S('<path d="M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5"/>'),
  repair: S('<path d="M14.5 5.5a4 4 0 0 0-5 5L4 16l4 4 5.5-5.5a4 4 0 0 0 5-5L16 12l-4-4z"/>'),
  pdf2word: S(DOC + '<path d="M9 11l1 6 2-4 2 4 1-6"/>'),
  word2pdf: S('<path d="M4 6l2 10 3-6 3 6 2-10"/><path d="M16 14h5M19 11l3 3-3 3"/>'),
  pdf2jpg: S('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>'),
  jpg2pdf: S(DOC + '<path d="M9 17l2-3 2 2 2-3"/><circle cx="10" cy="10.5" r="1"/>'),
  excel: S('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M10 4v16"/>'),
  pdf2txt: S(DOC + '<path d="M9 11h6M9 14h6M9 17h4"/>'),
  pagenumbers: S(DOC + '<path d="M11 15.5h2M12 12.5v6"/>'),
  watermark: S('<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>'),
  crop: S('<path d="M7 3v14h14M3 7h14v14"/>'),
  edit: S('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>'),
  meta: S('<path d="M4 4h7l9 9-7 7-9-9z"/><circle cx="8.5" cy="8.5" r="1.3"/>'),
  sign: S('<path d="M3 17c3-1 4-9 6-9s0 9 2 9 2-4 4-4 1 3 3 3 2-1 3-1"/><path d="M3 21h18"/>'),
  protect: S('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  ocr: S('<path d="M4 8V4h4M16 4h4v4M4 16v4h4M20 16v4h-4M8 10h8M8 14h5"/>'),
  unlock: S('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>')
};

/* ---------- Library loader (loaded only when a tool needs it) ---------- */
const CDN = {
  pdflib: ["https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js"],
  pdfjs: ["https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js", "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"],
  jszip: ["https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"],
  mammoth: ["https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js"],
  xlsx: ["https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"]
};
const scriptP = {};
function loadScript(url) {
  if (scriptP[url]) return scriptP[url];
  return scriptP[url] = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = url; s.async = false;
    s.onload = res;
    s.onerror = () => { delete scriptP[url]; s.remove(); rej(new Error("A part of this tool didn't load. Check your internet connection, then try again.")); };
    document.head.appendChild(s);
  });
}
async function need(...names) {
  for (const n of names) for (const u of CDN[n]) await loadScript(u);
  if (names.includes("pdfjs") && window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfjs[0];
}

/* ---------- Saving files ---------- */
function saveFile(name, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 10000);
}
function uniqueNames(names) {
  const used = {}; const out = [];
  for (const n of names) {
    let m = n;
    if (used[n]) { const e = extOf(n); m = baseName(n) + "-" + (++used[n]) + (e ? "." + e : ""); }
    else used[n] = 1;
    out.push(m);
  }
  return out;
}
async function zipAll(outs) {
  await need("jszip");
  const z = new JSZip(); const names = uniqueNames(outs.map(o => o.name));
  outs.forEach((o, i) => z.file(names[i], o.blob));
  return z.generateAsync({type: "blob"});
}

/* ---------- PDF helpers ---------- */
async function loadPL(file, opts = {}) {
  let doc;
  try { doc = await PDFLib.PDFDocument.load(await file.arrayBuffer(), {ignoreEncryption: true, ...opts}); }
  catch (e) { throw new Error(file.name + " couldn't be opened as a PDF. It may be damaged (try Repair PDF) or not a real PDF."); }
  if (doc.isEncrypted) throw new Error(file.name + " is password-protected. Open it in your PDF reader, save a copy without the password, then try again.");
  return doc;
}
async function pdfjsOpen(file, extra) {
  await need("pdfjs");
  const data = new Uint8Array(await file.arrayBuffer());
  try { return await pdfjsLib.getDocument({data, isEvalSupported: false, ...(extra || {})}).promise; }
  catch (e) {
    if (e && e.name === "PasswordException") throw new Error(file.name + " is password-protected. Open it in your PDF reader, save a copy without the password, then try again.");
    throw new Error(file.name + " couldn't be read as a PDF. It may be damaged. Try Repair PDF first.");
  }
}
async function renderPage(page, scale) {
  let vp = page.getViewport({scale});
  const maxPx = 14e6;
  if (vp.width * vp.height > maxPx) { scale *= Math.sqrt(maxPx / (vp.width * vp.height)); vp = page.getViewport({scale}); }
  const c = document.createElement("canvas");
  c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  // "print" intent renders without requestAnimationFrame, so long jobs keep going in a background tab
  await page.render({canvasContext: ctx, viewport: vp, intent: "print"}).promise;
  return c;
}
async function subsetPdf(src, idxs) {
  const d = await PDFLib.PDFDocument.create();
  const ps = await d.copyPages(src, idxs);
  ps.forEach(p => d.addPage(p));
  return pdfBlob(await d.save());
}
/* "1-3, 5, 9-7" -> [{label, idx:[0-based]}]. Open ends ("-4", "8-") and descending ranges work. */
function parseRanges(str, total) {
  const s = (str || "").trim();
  if (!s) throw new Error("Enter the pages, for example 1-3, 5.");
  const groups = [];
  for (const raw of s.split(/[,;]+/)) {
    const tok = raw.trim(); if (!tok) continue;
    let a, b; const m = tok.match(/^(\d*)\s*[-–]\s*(\d*)$/);
    if (m && (m[1] || m[2])) { a = m[1] ? +m[1] : 1; b = m[2] ? +m[2] : total; }
    else if (/^\d+$/.test(tok)) { a = b = +tok; }
    else throw new Error('"' + tok + '" isn\'t a page or a range. Use numbers like 2 or 4-7.');
    if (a < 1 || b < 1) throw new Error("Page numbers start at 1.");
    if (a > total || b > total) throw new Error("This PDF has " + plural(total, "page") + ", so page " + Math.max(a, b) + " doesn't exist.");
    const idx = []; const dir = a <= b ? 1 : -1; for (let i = a; i !== b + dir; i += dir) idx.push(i - 1);
    groups.push({label: a === b ? String(a) : a + "-" + b, idx});
  }
  if (!groups.length) throw new Error("Enter the pages, for example 1-3, 5.");
  return groups;
}
const pageSet = (str, total) => (str || "").trim() ? new Set(parseRanges(str, total).flatMap(g => g.idx)) : null;
/* Split every n pages -> groups */
function chunkGroups(total, n) {
  n = Math.max(1, Math.floor(n) || 1); const g = [];
  for (let a = 0; a < total; a += n) { const b = Math.min(total, a + n); const idx = []; for (let i = a; i < b; i++) idx.push(i); g.push({label: a + 1 === b ? String(b) : (a + 1) + "-" + b, idx}); }
  return g;
}
/* The page as the reader sees it (after /Rotate), mapped to PDF space.
   W/H: visible size. pt(vx, vy): visible point, top-left origin -> PDF point.
   vec(dx, dy): visible y-up vector -> PDF vector. Draw with rotate: degrees(r) to appear upright. */
function pageFrame(p) {
  const b = p.getCropBox(); const r = ((p.getRotation().angle % 360) + 360) % 360;
  const side = r === 90 || r === 270; const rad = r * Math.PI / 180;
  const pt = (vx, vy) => r === 90 ? [b.x + vy, b.y + vx] : r === 180 ? [b.x + b.width - vx, b.y + vy]
    : r === 270 ? [b.x + b.width - vy, b.y + b.height - vx] : [b.x + vx, b.y + b.height - vy];
  const vec = (dx, dy) => [dx * Math.cos(rad) - dy * Math.sin(rad), dx * Math.sin(rad) + dy * Math.cos(rad)];
  return {W: side ? b.height : b.width, H: side ? b.width : b.height, r, pt, vec};
}
/* A visible rectangle (top-left origin) -> the PDF-space box that covers it. */
function visRectToBox(F, vx, vy, vw, vh) {
  const [x1, y1] = F.pt(vx, vy), [x2, y2] = F.pt(vx + vw, vy + vh);
  return {x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1)};
}

/* ---------- Text helpers for writing PDFs ---------- */
const encCache = new WeakMap();
/* Replaces characters the standard PDF fonts can't draw (Hindi, emoji…) with "?" and counts them. */
function cleanForFont(font, text) {
  let cache = encCache.get(font); if (!cache) { cache = new Map(); encCache.set(font, cache); }
  const map = {"‑": "-", "−": "-", " ": " ", " ": " ", "​": "", "₹": "Rs."};
  let out = "", bad = 0;
  for (const ch0 of String(text).replace(/\t/g, "    ")) {
    const ch = map[ch0] !== undefined ? map[ch0] : ch0;
    if (!ch) continue;
    let ok = cache.get(ch);
    if (ok === undefined) { try { font.encodeText(ch); font.widthOfTextAtSize(ch, 10); ok = true; } catch (e) { ok = false; } cache.set(ch, ok); }
    if (ok) out += ch; else { out += "?"; bad++; }
  }
  return {text: out, bad};
}
function wrapText(text, font, size, maxW) {
  const words = text.split(" "); const lines = []; let cur = "";
  const fits = s => font.widthOfTextAtSize(s, size) <= maxW;
  for (let w of words) {
    const tryS = cur ? cur + " " + w : w;
    if (fits(tryS)) { cur = tryS; continue; }
    if (cur) { lines.push(cur); cur = ""; }
    while (w.length > 1 && !fits(w)) { let k = w.length; while (k > 1 && !fits(w.slice(0, k))) k--; lines.push(w.slice(0, k)); w = w.slice(k); }
    cur = w;
  }
  if (cur) lines.push(cur);
  return lines;
}

/* ---------- Text extraction (PDF to Word / text) ---------- */
/* Groups pdf.js text items into lines, top to bottom. */
function itemsToLines(items) {
  const lines = [];
  for (const it of items) {
    if (typeof it.str !== "string" || !it.str.length) continue;
    const y = it.transform[5], x = it.transform[4], h = Math.abs(it.transform[3]) || it.height || 10;
    let ln = lines.find(l => Math.abs(l.y - y) < Math.max(2, Math.min(l.h, h) * .5));
    if (!ln) { ln = {y, h, items: []}; lines.push(ln); }
    ln.h = Math.max(ln.h, h); ln.items.push({x, w: it.width || 0, s: it.str, h});
  }
  lines.sort((a, b) => b.y - a.y);
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x); let t = "", end = null;
    for (const it of l.items) {
      if (end !== null && it.x - end > it.h * .2 && !t.endsWith(" ") && !it.s.startsWith(" ")) t += " ";
      t += it.s; end = it.x + it.w;
    }
    l.text = t.replace(/\s+/g, " ").trim();
  }
  return lines.filter(l => l.text);
}
/* Joins lines into paragraphs using gaps, size changes and list markers. */
function linesToParas(lines, med) {
  const paras = []; let cur = null, prev = null;
  for (const l of lines) {
    const big = l.h > med * 1.25;
    const brk = !cur || !prev || (prev.y - l.y) > Math.max(prev.h, l.h) * 1.75 || big !== cur.big || /^[••\-–*]\s|^\d+[.)]\s/.test(l.text);
    if (brk) { cur = {text: l.text, big, h: l.h}; paras.push(cur); }
    else cur.text += (cur.text.endsWith("-") ? "" : " ") + l.text;
    prev = l;
  }
  return paras;
}
async function extractPages(file, prog) {
  const pdf = await pdfjsOpen(file); const pages = [];
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      pages.push(itemsToLines((await page.getTextContent()).items));
      page.cleanup(); prog && prog(i / pdf.numPages);
    }
  } finally { pdf.destroy(); }
  return pages;
}

/* ---------- Word (.docx) writer ---------- */
const xmlEsc = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/[&<>]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;"}[c]));
async function makeDocx(paras) {
  await need("jszip");
  const body = paras.map(p => {
    if (p.pageBreak) return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    const rpr = (p.bold ? "<w:b/>" : "") + (p.sz ? '<w:sz w:val="' + p.sz + '"/><w:szCs w:val="' + p.sz + '"/>' : "");
    return '<w:p><w:pPr><w:spacing w:after="120"/></w:pPr><w:r>' + (rpr ? "<w:rPr>" + rpr + "</w:rPr>" : "") + '<w:t xml:space="preserve">' + xmlEsc(p.text) + "</w:t></w:r></w:p>";
  }).join("");
  const z = new JSZip();
  z.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  z.file("_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  z.file("word/document.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>');
  return z.generateAsync({type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"});
}

/* ---------- Spreadsheet table layout ---------- */
/* Splits columns into groups that each fit the printable width. Widths are clamped to [minW, maxW]. */
function planColumns(natural, avail, minW = 30, maxW = 220) {
  const w = natural.map(n => clamp(n, minW, Math.min(maxW, avail)));
  const groups = []; let cur = [], sum = 0;
  w.forEach((cw, i) => {
    if (cur.length && sum + cw > avail) { groups.push(cur); cur = []; sum = 0; }
    cur.push(i); sum += cw;
  });
  if (cur.length) groups.push(cur);
  return groups.map(cols => {
    return {cols, widths: cols.map(i => w[i])};
  });
}
const looksNumeric = v => /^[-+(]?[₹$€£]?\s?[\d,]*\.?\d+%?\)?$/.test(String(v).trim()) && /\d/.test(v);
function trimRows(rows) {
  rows = rows.map(r => (r || []).map(v => v == null ? "" : String(v)));
  while (rows.length && rows[rows.length - 1].every(v => !v.trim())) rows.pop();
  let cols = 0; for (const r of rows) for (let i = r.length - 1; i >= 0; i--) if (r[i].trim()) { cols = Math.max(cols, i + 1); break; }
  return rows.map(r => { const o = r.slice(0, cols); while (o.length < cols) o.push(""); return o; });
}

/* ---------- Images ---------- */
function trimCanvas(c) {
  const g = c.getContext("2d"); const {width: w, height: h} = c; const d = g.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const pad = 6; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const o = document.createElement("canvas"); o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
  o.getContext("2d").drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height); return o;
}
/* Any browser-readable image file -> {url (PNG data URL), w, h}. Large images are scaled down. */
async function imageToPng(file, maxSide = 2000) {
  let bmp;
  try { bmp = await createImageBitmap(file, {imageOrientation: "from-image"}); }
  catch (e) { throw new Error(file.name + " couldn't be opened as an image. Try a JPG or PNG file."); }
  const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(bmp.width * s)); c.height = Math.max(1, Math.round(bmp.height * s));
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height); bmp.close && bmp.close();
  const url = c.toDataURL("image/png"); const r = {url, w: c.width, h: c.height}; c.width = c.height = 0; return r;
}
/* Embed an image file in a pdf-lib document (JPG and PNG directly, anything else via canvas). */
async function embedImageFile(doc, file) {
  const e = extOf(file.name);
  try {
    if (e === "png") return await doc.embedPng(await file.arrayBuffer());
    if (e === "jpg" || e === "jpeg") return await doc.embedJpg(await file.arrayBuffer());
  } catch (err) { /* fall through to canvas */ }
  return doc.embedPng(dataUrlBytes((await imageToPng(file, 4000)).url));
}
