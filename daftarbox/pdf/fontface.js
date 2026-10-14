/* Daftarbox PDF tools – use a PDF's own embedded font in the editor.
   pdf.js converts each embedded font to a web font whose glyphs sit in private code points. We rewrite the font's
   character map so normal Unicode letters point at the right glyphs, then load it as a FontFace. Typing in the editor
   then shows exactly the PDF's typeface, size and letter widths. Pure functions (tested in Node) plus a small browser part. */
"use strict";

const ffU16 = (b, o) => b[o] << 8 | b[o + 1];
const ffU32 = (b, o) => (b[o] << 24 >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const ffI16 = (b, o) => { const v = ffU16(b, o); return v & 0x8000 ? v - 0x10000 : v; };
function ffTables(b) {
  const n = ffU16(b, 4); const t = {};
  for (let i = 0; i < n; i++) { const o = 12 + i * 16; const tag = String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]); t[tag] = {offset: ffU32(b, o + 8), length: ffU32(b, o + 12)}; }
  return t;
}
/* cmap table -> Map(codePoint -> glyph id), from format 4 / 12 / 6 / 0 subtables. */
function ffReadCmap(b, off) {
  const n = ffU16(b, off + 2); const map = new Map();
  const subs = [];
  for (let i = 0; i < n; i++) { const o = off + 4 + i * 8; subs.push({pid: ffU16(b, o), eid: ffU16(b, o + 2), off: off + ffU32(b, o + 4)}); }
  const rank = s => (s.pid === 3 && s.eid === 10 ? 0 : s.pid === 3 && s.eid === 1 ? 1 : s.pid === 0 ? 2 : s.pid === 3 && s.eid === 0 ? 3 : 4);
  subs.sort((a, c) => rank(a) - rank(c));
  for (const s of subs) {
    const f = ffU16(b, s.off);
    if (f === 4) {
      const segX2 = ffU16(b, s.off + 6), seg = segX2 / 2; const ends = s.off + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
      for (let i = 0; i < seg; i++) {
        const end = ffU16(b, ends + i * 2), start = ffU16(b, starts + i * 2), delta = ffI16(b, deltas + i * 2), ro = ffU16(b, ranges + i * 2);
        for (let c = start; c <= end && c !== 0xFFFF; c++) {
          let g;
          if (!ro) g = (c + delta) & 0xFFFF;
          else { const p = ranges + i * 2 + ro + (c - start) * 2; g = ffU16(b, p); if (g) g = (g + delta) & 0xFFFF; }
          if (g && !map.has(c)) map.set(c, g);
        }
      }
    } else if (f === 12) {
      const ng = ffU32(b, s.off + 12);
      for (let i = 0; i < ng; i++) { const o = s.off + 16 + i * 12; const a = ffU32(b, o), e = ffU32(b, o + 4), g = ffU32(b, o + 8); for (let c = a; c <= e && c - a < 65536; c++) if (!map.has(c)) map.set(c, g + c - a); }
    } else if (f === 6) {
      const first = ffU16(b, s.off + 6), cnt = ffU16(b, s.off + 8);
      for (let i = 0; i < cnt; i++) { const g = ffU16(b, s.off + 10 + i * 2); if (g && !map.has(first + i)) map.set(first + i, g); }
    } else if (f === 0) {
      for (let i = 0; i < 256; i++) { const g = b[s.off + 6 + i]; if (g && !map.has(i)) map.set(i, g); }
    }
    if (map.size) break;
  }
  return map;
}
/* Map(codePoint -> gid) -> a cmap table (3,1 format 4, plus 3,10 format 12 for code points above U+FFFF). */
function ffBuildCmap(m) {
  const bmp = [...m].filter(([c]) => c < 0xFFFF).sort((a, c) => a[0] - c[0]);
  const astral = [...m].filter(([c]) => c > 0xFFFF).sort((a, c) => a[0] - c[0]);
  /* merge runs where both code and gid increase by one */
  const segs = [];
  for (const [c, g] of bmp) { const l = segs[segs.length - 1]; if (l && c === l.e + 1 && g - c === l.d) l.e = c; else segs.push({s: c, e: c, d: g - c}); }
  segs.push({s: 0xFFFF, e: 0xFFFF, d: 1});
  const n = segs.length, len4 = 16 + n * 8;
  const t4 = new Uint8Array(len4); const dv = new DataView(t4.buffer);
  let sr = 1, es = 0; while (sr * 2 <= n) { sr *= 2; es++; }
  dv.setUint16(0, 4); dv.setUint16(2, len4); dv.setUint16(4, 0); dv.setUint16(6, n * 2); dv.setUint16(8, sr * 2); dv.setUint16(10, es); dv.setUint16(12, (n - sr) * 2);
  segs.forEach((s, i) => { dv.setUint16(14 + i * 2, s.e); dv.setUint16(16 + n * 2 + i * 2, s.s); dv.setUint16(16 + n * 4 + i * 2, s.d & 0xFFFF); dv.setUint16(16 + n * 6 + i * 2, 0); });
  let t12 = null;
  if (astral.length) {
    t12 = new Uint8Array(16 + astral.length * 12); const d2 = new DataView(t12.buffer);
    d2.setUint16(0, 12); d2.setUint32(4, t12.length); d2.setUint32(12, astral.length);
    astral.forEach(([c, g], i) => { d2.setUint32(16 + i * 12, c); d2.setUint32(20 + i * 12, c); d2.setUint32(24 + i * 12, g); });
  }
  const nsub = t12 ? 2 : 1; const head = 4 + nsub * 8;
  const out = new Uint8Array(head + len4 + (t12 ? t12.length : 0)); const d = new DataView(out.buffer);
  d.setUint16(0, 0); d.setUint16(2, nsub);
  d.setUint16(4, 3); d.setUint16(6, 1); d.setUint32(8, head);
  if (t12) { d.setUint16(12, 3); d.setUint16(14, 10); d.setUint32(16, head + len4); out.set(t12, head + len4); }
  out.set(t4, head);
  return out;
}
/* Rebuild an sfnt with one table replaced. */
function ffReplaceTable(b, tag, data) {
  const t = ffTables(b); t[tag] = {data};
  const tags = Object.keys(t).sort();
  const n = tags.length; let off = 12 + n * 16;
  const parts = tags.map(k => { const d = t[k].data || b.subarray(t[k].offset, t[k].offset + t[k].length); const o = off; off += (d.length + 3) & ~3; return {k, d, o}; });
  const out = new Uint8Array(off); const dv = new DataView(out.buffer);
  out.set(b.subarray(0, 4), 0); let sr = 1, es = 0; while (sr * 2 <= n) { sr *= 2; es++; }
  dv.setUint16(4, n); dv.setUint16(6, sr * 16); dv.setUint16(8, es); dv.setUint16(10, n * 16 - sr * 16);
  parts.forEach((p, i) => {
    const o = 12 + i * 16; for (let j = 0; j < 4; j++) out[o + j] = p.k.charCodeAt(j);
    out.set(p.d, p.o); let sum = 0; for (let j = 0; j < p.d.length; j += 4) sum = (sum + ((p.d[j] << 24 >>> 0) + ((p.d[j + 1] || 0) << 16) + ((p.d[j + 2] || 0) << 8) + (p.d[j + 3] || 0))) >>> 0;
    dv.setUint32(o + 4, sum); dv.setUint32(o + 8, p.o); dv.setUint32(o + 12, p.d.length);
  });
  return out;
}
/* Rewrites advance widths (hmtx) so every glyph is exactly as wide as the PDF says. widths: Map(gid -> advance in font units). */
function ffFixWidths(b, widths) {
  const t = ffTables(b); if (!t.hmtx || !t.hhea || !t.maxp || !t.head) return b;
  const ng = ffU16(b, t.maxp.offset + 4), nhm = ffU16(b, t.hhea.offset + 34);
  const out = new Uint8Array(ng * 4); const dv = new DataView(out.buffer); let lastAdv = 0;
  for (let g = 0; g < ng; g++) {
    let adv, lsb;
    if (g < nhm) { adv = ffU16(b, t.hmtx.offset + g * 4); lsb = ffI16(b, t.hmtx.offset + g * 4 + 2); lastAdv = adv; }
    else { adv = lastAdv; const o = t.hmtx.offset + nhm * 4 + (g - nhm) * 2; lsb = o + 1 < t.hmtx.offset + t.hmtx.length ? ffI16(b, o) : 0; }
    if (widths.has(g)) adv = clampU16(Math.round(widths.get(g)));
    dv.setUint16(g * 4, adv); dv.setInt16(g * 4 + 2, lsb);
  }
  let r = ffReplaceTable(b, "hmtx", out);
  const t2 = ffTables(r); const hh = new Uint8Array(r.subarray(t2.hhea.offset, t2.hhea.offset + t2.hhea.length)); hh[34] = ng >> 8; hh[35] = ng & 255;
  return ffReplaceTable(r, "hhea", hh);
}
const clampU16 = v => Math.max(0, Math.min(65535, v));
/* pdf.js font object (needs fontExtraProperties) -> {bytes, chars: Set of characters the font can show} or null. */
function ffRemapPdfjsFont(f) {
  if (!f || !f.data || f.isType3Font || !f.toFontChar) return null;
  const b = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data);
  const t = ffTables(b); if (!t.cmap) return null;
  const cmap = ffReadCmap(b, t.cmap.offset);
  const uni = f.toUnicode && (f.toUnicode._map || f.toUnicode.map) || [];
  const out = new Map(); const chars = new Set(); const wmap = new Map();
  const upm = t.head ? ffU16(b, t.head.offset + 18) : 1000; const fm = f.fontMatrix && f.fontMatrix[0] ? f.fontMatrix[0] * 1000 : 1;
  const tfc = f.toFontChar;
  const codes = Array.isArray(tfc) ? tfc.map((v, i) => i) : Object.keys(tfc).map(Number);
  let space = null;
  for (let code = 0; code < uni.length; code++) if (uni[code] === " " && f.widths && typeof f.widths[code] === "number") { space = f.widths[code] * fm / 1000; break; }
  for (const code of codes) {
    const fc = tfc[code]; if (fc == null) continue;
    const g = cmap.get(fc); if (!g) continue;
    let u = uni[code]; if (typeof u !== "string" || !u) continue;
    if ([...u].length !== 1) continue;
    const cp = u.codePointAt(0); if (cp < 32 || out.has(cp)) continue;
    out.set(cp, g); chars.add(u);
    const w = f.widths && f.widths[code]; if (typeof w === "number" && w >= 0) wmap.set(g, w * fm / 1000 * upm);
    if (cp === 0x20) out.set(0xA0, g);
  }
  if (!out.size) return null;
  try { let bytes = ffReplaceTable(b, "cmap", ffBuildCmap(out)); if (wmap.size) bytes = ffFixWidths(bytes, wmap); return {bytes, chars, space: chars.has(" ") ? null : space}; } catch (e) { return null; }
}

/* ---------- browser part ---------- */
const ffCache = new Map();
/* Returns {family, chars} for a pdf.js font name on this document, or null when the font can't be used. */
async function ffLoadPageFont(page, fontName, docKey) {
  const key = docKey + "|" + fontName;
  if (ffCache.has(key)) return ffCache.get(key);
  const p = (async () => {
    try {
      if (!page.commonObjs.has(fontName)) return null;
      const r = ffRemapPdfjsFont(page.commonObjs.get(fontName)); if (!r) return null;
      const family = "dbxf_" + (docKey + "_" + fontName).replace(/[^a-z0-9_]/gi, "_");
      const ff = new FontFace(family, r.bytes); await ff.load(); document.fonts.add(ff);
      return {family, chars: r.chars, space: r.space};
    } catch (e) { console.warn("font", fontName, e); return null; }
  })();
  ffCache.set(key, p);
  return p;
}
/* Exact baseline position inside a line box for any CSS font, measured by the browser. */
const ffBaseCache = new Map();
function ffBaseline(fontCss, px, lineH) {
  const k = fontCss + "|" + px.toFixed(2) + "|" + lineH.toFixed(2);
  if (ffBaseCache.has(k)) return ffBaseCache.get(k);
  const d = document.createElement("div");
  Object.assign(d.style, {position: "absolute", left: "-9999px", top: "0", font: fontCss, fontSize: px + "px", lineHeight: lineH + "px", whiteSpace: "pre", visibility: "hidden"});
  d.innerHTML = 'Hg<span style="display:inline-block;width:0;height:0;vertical-align:baseline"></span>';
  /* attached to <html>, not <body>: the full-screen editor hides the body's other children */
  document.documentElement.appendChild(d); const v = d.lastChild.offsetTop; d.remove();
  if (ffBaseCache.size > 500) ffBaseCache.clear();
  ffBaseCache.set(k, v); return v;
}
