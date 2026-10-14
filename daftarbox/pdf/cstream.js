/* Daftarbox PDF tools – reading and rewriting PDF page content streams.
   Used by Edit PDF to find where each piece of text is drawn, which font it uses, where table borders are,
   to truly remove edited text (not just cover it) and to write new text with the PDF's own font.
   Pure functions take bytes; the pdf-lib glue at the bottom needs the PDFLib global. */
"use strict";

/* ---------- Matrices ---------- */
const csMul = (m1, m2) => [m1[0] * m2[0] + m1[1] * m2[2], m1[0] * m2[1] + m1[1] * m2[3], m1[2] * m2[0] + m1[3] * m2[2], m1[2] * m2[1] + m1[3] * m2[3],
  m1[4] * m2[0] + m1[5] * m2[2] + m2[4], m1[4] * m2[1] + m1[5] * m2[3] + m2[5]];
/* PDF convention: a point p maps through M as [x y 1] x M */
const csApply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const csInv = m => { const d = m[0] * m[3] - m[1] * m[2]; if (!d) return [1, 0, 0, 1, 0, 0]; return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d]; };
const CS_ID = [1, 0, 0, 1, 0, 0];

/* ---------- Tokenizer ---------- */
const CS_WS = new Uint8Array(256); [0, 9, 10, 12, 13, 32].forEach(c => { CS_WS[c] = 1; });
const CS_DL = new Uint8Array(256); "()<>[]{}/%".split("").forEach(c => { CS_DL[c.charCodeAt(0)] = 1; });
const csLatin = (b, s, e) => { let t = ""; for (let i = s; i < e; i++) t += String.fromCharCode(b[i]); return t; };
function csTokenize(b) {
  const toks = []; let i = 0; const n = b.length;
  while (i < n) {
    const c = b[i];
    if (CS_WS[c]) { i++; continue; }
    if (c === 37) { while (i < n && b[i] !== 10 && b[i] !== 13) i++; continue; }
    const s = i;
    if (c === 40) {
      let depth = 1; i++; const out = [];
      while (i < n && depth) {
        let ch = b[i];
        if (ch === 92) {
          i++; ch = b[i];
          if (ch === 110) out.push(10); else if (ch === 114) out.push(13); else if (ch === 116) out.push(9); else if (ch === 98) out.push(8); else if (ch === 102) out.push(12);
          else if (ch >= 48 && ch <= 55) { let v = ch - 48, k = 1; while (k < 3 && b[i + 1] >= 48 && b[i + 1] <= 55) { i++; v = v * 8 + b[i] - 48; k++; } out.push(v & 255); }
          else if (ch === 13) { if (b[i + 1] === 10) i++; }
          else if (ch !== 10) out.push(ch);
          i++; continue;
        }
        if (ch === 40) depth++;
        else if (ch === 41 && !--depth) { i++; break; }
        out.push(ch); i++;
      }
      toks.push({t: "str", v: out, s, e: i}); continue;
    }
    if (c === 60) {
      if (b[i + 1] === 60) { toks.push({t: "<<", s, e: i + 2}); i += 2; continue; }
      i++; let hex = ""; while (i < n && b[i] !== 62) { if (!CS_WS[b[i]]) hex += String.fromCharCode(b[i]); i++; } i++;
      if (hex.length % 2) hex += "0"; const out = []; for (let k = 0; k < hex.length; k += 2) out.push(parseInt(hex.substr(k, 2), 16) || 0);
      toks.push({t: "str", v: out, hex: true, s, e: i}); continue;
    }
    if (c === 62 && b[i + 1] === 62) { toks.push({t: ">>", s, e: i + 2}); i += 2; continue; }
    if (c === 91 || c === 93 || c === 123 || c === 125) { toks.push({t: String.fromCharCode(c), s, e: i + 1}); i++; continue; }
    if (c === 47) {
      i++; while (i < n && !CS_WS[b[i]] && !CS_DL[b[i]]) i++;
      toks.push({t: "name", v: csLatin(b, s + 1, i).replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), s, e: i}); continue;
    }
    while (i < n && !CS_WS[b[i]] && !CS_DL[b[i]]) i++;
    if (i === s) { i++; continue; }
    const w = csLatin(b, s, i);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) toks.push({t: "num", v: parseFloat(w), s, e: i});
    else if (w === "true" || w === "false" || w === "null") toks.push({t: "kw", v: w, s, e: i});
    else {
      const tk = {t: "op", v: w, s, e: i}; toks.push(tk);
      if (w === "ID") { /* inline image data: skip to EI */
        let j = i + 1; while (j < n - 1 && !(b[j] === 69 && b[j + 1] === 73 && CS_WS[b[j - 1]] && (j + 2 >= n || CS_WS[b[j + 2]]))) j++;
        i = Math.min(n, j + 2); tk.e = i; tk.v = "ID-EI";
      }
    }
  }
  return toks;
}

/* ---------- Interpreter: text shows, ruling lines, images ---------- */
/* res: {font(name) -> info|null, xobj(name) -> {kind: "image"} | {kind: "form", toks, matrix, res} | null}
   Positions are in default user space. */
function csInterpret(toks, res, opts = {}) {
  const out = opts.out || {shows: [], rules: [], images: []};
  const inForm = !!opts.inForm, depth = opts.depth || 0;
  let gs = {ctm: opts.ctm || CS_ID, fill: [0, 0, 0], Tc: 0, Tw: 0, Th: 1, TL: 0, font: null, fname: "", Tfs: 0, Ts: 0, Tr: 0};
  const stack = []; let Tm = CS_ID, Tlm = CS_ID;
  let ops = []; let argStart = -1; const arrStack = [];
  let path = [], cur = null, start = null;
  const num = k => { const v = ops[ops.length - k]; return v && v.t === "num" ? v.v : 0; };
  const pushRule = (x0, y0, x1, y1, soft) => {
    const a = csApply(gs.ctm, x0, y0), b2 = csApply(gs.ctm, x1, y1);
    out.rules.push({x0: a[0], y0: a[1], x1: b2[0], y1: b2[1], soft: !!soft});
  };
  const show = (tk, items, extra) => {
    const f = gs.font; const M = csMul(Tm, gs.ctm); const st = csApply(M, 0, gs.Ts);
    let tx = 0, nTotal = 0, codesAll = [];
    for (const el of items) {
      if (el.t === "num") { tx += -el.v / 1000 * gs.Tfs * gs.Th; nTotal += el.v; continue; }
      if (el.t !== "str") continue;
      const codes = f ? f.codes(el.v) : el.v; codesAll = codesAll.concat(codes);
      for (const code of codes) {
        const w0 = (f ? f.width(code) : 500) / 1000; const ws = code === 32 && (!f || f.single) ? gs.Tw : 0;
        tx += (w0 * gs.Tfs + gs.Tc + ws) * gs.Th;
        nTotal += gs.Tfs ? -1000 * (w0 * gs.Tfs + gs.Tc + ws) / gs.Tfs : 0;
      }
    }
    const en = csApply(M, tx, gs.Ts);
    out.shows.push({op: tk.v, s: argStart >= 0 ? argStart : tk.s, e: tk.e, x0: st[0], y0: st[1], x1: en[0], y1: en[1],
      size: gs.Tfs * Math.hypot(M[2], M[3]), dir: [M[0], M[1]], fname: gs.fname, font: f, color: gs.fill.slice(), n: nTotal, Tfs: gs.Tfs,
      Tr: gs.Tr, codes: codesAll, inForm, extra: extra || null});
    Tm = csMul([1, 0, 0, 1, tx, 0], Tm);
  };
  for (let i = 0; i < toks.length; i++) {
    const tk = toks[i];
    if (tk.t !== "op") {
      if (argStart < 0) argStart = tk.s;
      if (tk.t === "[") { arrStack.push({items: [], s: tk.s}); continue; }
      if (tk.t === "]") { const a = arrStack.pop(); if (!a) continue; const v = {t: "arr", v: a.items, s: a.s, e: tk.e}; if (arrStack.length) arrStack[arrStack.length - 1].items.push(v); else ops.push(v); continue; }
      if (arrStack.length) { arrStack[arrStack.length - 1].items.push(tk); continue; }
      if (tk.t === "<<") { let d = 1; while (i + 1 < toks.length && d) { i++; if (toks[i].t === "<<") d++; else if (toks[i].t === ">>") d--; } ops.push({t: "dict"}); continue; }
      ops.push(tk); continue;
    }
    const op = tk.v;
    switch (op) {
      case "q": stack.push({...gs, fill: gs.fill.slice()}); break;
      case "Q": if (stack.length) gs = stack.pop(); break;
      case "cm": if (ops.length >= 6) gs.ctm = csMul([num(6), num(5), num(4), num(3), num(2), num(1)], gs.ctm); break;
      case "BT": Tm = Tlm = CS_ID; break;
      case "ET": break;
      case "Td": Tlm = csMul([1, 0, 0, 1, num(2), num(1)], Tlm); Tm = Tlm; break;
      case "TD": gs.TL = -num(1); Tlm = csMul([1, 0, 0, 1, num(2), num(1)], Tlm); Tm = Tlm; break;
      case "Tm": Tm = Tlm = [num(6), num(5), num(4), num(3), num(2), num(1)]; break;
      case "T*": Tlm = csMul([1, 0, 0, 1, 0, -gs.TL], Tlm); Tm = Tlm; break;
      case "Tc": gs.Tc = num(1); break;
      case "Tw": gs.Tw = num(1); break;
      case "Tz": gs.Th = num(1) / 100; break;
      case "TL": gs.TL = num(1); break;
      case "Ts": gs.Ts = num(1); break;
      case "Tr": gs.Tr = num(1); break;
      case "Tf": { const nm = ops[ops.length - 2]; gs.fname = nm && nm.t === "name" ? nm.v : ""; gs.Tfs = num(1); gs.font = gs.fname ? res.font(gs.fname) : null; break; }
      case "Tj": { const s = ops[ops.length - 1]; if (s) show(tk, [s]); break; }
      case "TJ": { const a = ops[ops.length - 1]; if (a && a.t === "arr") show(tk, a.v); break; }
      case "'": { Tlm = csMul([1, 0, 0, 1, 0, -gs.TL], Tlm); Tm = Tlm; const s = ops[ops.length - 1]; if (s) show(tk, [s]); break; }
      case "\"": { gs.Tw = num(3); gs.Tc = num(2); Tlm = csMul([1, 0, 0, 1, 0, -gs.TL], Tlm); Tm = Tlm; const s = ops[ops.length - 1]; if (s) show(tk, [s], {aw: gs.Tw, ac: gs.Tc}); break; }
      case "g": gs.fill = [num(1), num(1), num(1)]; break;
      case "rg": gs.fill = [num(3), num(2), num(1)]; break;
      case "k": { const c = num(4), m = num(3), y = num(2), kk = num(1); gs.fill = [(1 - c) * (1 - kk), (1 - m) * (1 - kk), (1 - y) * (1 - kk)]; break; }
      case "cs": gs.fill = [0, 0, 0]; break;
      case "sc": case "scn": {
        const nums = ops.filter(o => o.t === "num").map(o => o.v);
        if (nums.length === 1) gs.fill = [nums[0], nums[0], nums[0]]; else if (nums.length === 3) gs.fill = nums.slice(); else if (nums.length === 4) { const [c, m, y, kk] = nums; gs.fill = [(1 - c) * (1 - kk), (1 - m) * (1 - kk), (1 - y) * (1 - kk)]; }
        break;
      }
      case "m": cur = start = [num(2), num(1)]; break;
      case "l": { const p = [num(2), num(1)]; if (cur) path.push([cur[0], cur[1], p[0], p[1]]); cur = p; break; }
      case "c": cur = [num(2), num(1)]; break;
      case "v": case "y": cur = [num(2), num(1)]; break;
      case "h": if (cur && start) path.push([cur[0], cur[1], start[0], start[1]]); cur = start; break;
      case "re": { const x = num(4), y = num(3), w = num(2), h = num(1); path.push({re: [x, y, w, h]}); cur = start = [x, y]; break; }
      case "S": case "s": case "f": case "F": case "f*": case "B": case "B*": case "b": case "b*": {
        const stroke = /^[SsBb]/.test(op);
        for (const seg of path) {
          if (seg.re) {
            const [x, y, w, h] = seg.re; const aw = Math.abs(w), ah = Math.abs(h);
            if (ah <= 3 && aw > 3) pushRule(x, y + h / 2, x + w, y + h / 2);
            else if (aw <= 3 && ah > 3) pushRule(x + w / 2, y, x + w / 2, y + h);
            else if (aw > 3 && ah > 3) { const soft = !stroke; pushRule(x, y, x + w, y, soft); pushRule(x, y + h, x + w, y + h, soft); pushRule(x, y, x, y + h, soft); pushRule(x + w, y, x + w, y + h, soft); }
          } else if (stroke) pushRule(seg[0], seg[1], seg[2], seg[3]);
        }
        path = []; cur = start = null; break;
      }
      case "n": path = []; cur = start = null; break;
      case "Do": {
        const nm = ops[ops.length - 1]; const x = nm && nm.t === "name" ? res.xobj(nm.v) : null;
        if (x && x.kind === "image") {
          const c = gs.ctm; out.images.push({pw: x.pw, ph: x.ph, name: nm.v, ctm: c.slice(), s: nm.s, e: tk.e, inForm, corners: [csApply(c, 0, 0), csApply(c, 1, 0), csApply(c, 0, 1), csApply(c, 1, 1)]});
        } else if (x && x.kind === "form" && depth < 4) {
          csInterpret(x.toks, x.res, {out, inForm: true, depth: depth + 1, ctm: csMul(x.matrix, gs.ctm)});
        }
        break;
      }
      default: break;
    }
    ops = []; argStart = -1;
  }
  return out;
}

/* ---------- Removing text shows without moving anything else ---------- */
/* A removed show is replaced by an equivalent empty move ([-n] TJ), so text that follows keeps its exact position. */
function csReplacement(sh) {
  const n = Math.round(sh.n * 1000) / 1000; const mv = n ? "[" + n + "] TJ" : "";
  if (sh.op === "'") return "T* " + mv;
  if (sh.op === "\"") return sh.extra.aw + " Tw " + sh.extra.ac + " Tc T* " + mv;
  return mv;
}
function csSplice(bytes, edits) {
  edits = edits.slice().sort((a, b) => a.s - b.s);
  const parts = []; let pos = 0, len = 0;
  for (const ed of edits) {
    if (ed.s < pos) continue;
    parts.push(bytes.subarray(pos, ed.s)); const r = new Uint8Array([...ed.text].map(ch => ch.charCodeAt(0) & 255)); parts.push(r); pos = ed.e;
  }
  parts.push(bytes.subarray(pos));
  for (const p of parts) len += p.length;
  const outB = new Uint8Array(len); let o = 0; for (const p of parts) { outB.set(p, o); o += p.length; }
  return outB;
}

/* ---------- Fonts: widths, codes, ToUnicode ---------- */
function utf16beHex(hex) { let s = ""; for (let i = 0; i + 3 < hex.length; i += 4) s += String.fromCharCode(parseInt(hex.substr(i, 4), 16)); if (hex.length === 2) s = String.fromCharCode(parseInt(hex, 16)); return s; }
/* ToUnicode CMap text -> {map: Map(code -> string), bytes: code length} */
function parseToUnicode(text) {
  const map = new Map(); let bytes = 1;
  const hexes = s => [...s.matchAll(/<([0-9a-fA-F\s]*)>|\[|\]/g)].map(m => m[0] === "[" || m[0] === "]" ? m[0] : m[1].replace(/\s/g, ""));
  for (const m of text.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g)) { const h = hexes(m[1]); if (h[0]) bytes = Math.max(1, h[0].length / 2); }
  for (const m of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    const h = hexes(m[1]); for (let i = 0; i + 1 < h.length; i += 2) { map.set(parseInt(h[i], 16), utf16beHex(h[i + 1])); bytes = Math.max(bytes, h[i].length / 2); }
  }
  for (const m of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const h = hexes(m[1]); let i = 0;
    while (i + 2 < h.length) {
      const lo = parseInt(h[i], 16), hi = parseInt(h[i + 1], 16); bytes = Math.max(bytes, h[i].length / 2);
      if (h[i + 2] === "[") { let k = i + 3, c = lo; while (k < h.length && h[k] !== "]") { map.set(c++, utf16beHex(h[k])); k++; } i = k + 1; }
      else { const d = h[i + 2]; const base = utf16beHex(d); for (let c = lo; c <= hi && c - lo < 65536; c++) { const last = base.charCodeAt(base.length - 1) + (c - lo); map.set(c, base.slice(0, -1) + String.fromCharCode(last)); } i += 3; }
    }
  }
  return {map, bytes};
}
/* Type0 /W array -> Map(cid -> width) */
function parseCidWidths(arr) {
  const w = new Map(); let i = 0;
  while (i < arr.length) {
    const a = arr[i];
    if (Array.isArray(arr[i + 1])) { arr[i + 1].forEach((v, k) => w.set(a + k, v)); i += 2; }
    else { const b = arr[i + 1], v = arr[i + 2]; for (let c = a; c <= b && c - a < 65536; c++) w.set(c, v); i += 3; }
  }
  return w;
}
/* WinAnsi codes for characters outside ASCII (enough for typing in English/European text). */
const WIN_ANSI = {0x20AC: 128, 0x201A: 130, 0x192: 131, 0x201E: 132, 0x2026: 133, 0x2020: 134, 0x2021: 135, 0x2C6: 136, 0x2030: 137, 0x160: 138, 0x2039: 139, 0x152: 140, 0x17D: 142,
  0x2018: 145, 0x2019: 146, 0x201C: 147, 0x201D: 148, 0x2022: 149, 0x2013: 150, 0x2014: 151, 0x2DC: 152, 0x2122: 153, 0x161: 154, 0x203A: 155, 0x153: 156, 0x17E: 158, 0x178: 159};
const WIN_REV = (() => { const r = {}; for (const k in WIN_ANSI) r[WIN_ANSI[k]] = String.fromCharCode(+k); return r; })();
/* A single-byte code as a character, assuming WinAnsi (the usual encoding of simple fonts). */
const csWinChar = c => c >= 32 && c < 127 ? String.fromCharCode(c) : c >= 160 && c < 256 ? String.fromCharCode(c) : (WIN_REV[c] || "");
/* Builds a font helper. raw: {type0, firstChar, widths[], missing, cidWidths Map, dw, toUni {map, bytes}, encoding, baseFont, flags, embedded} */
function csMakeFont(raw) {
  const single = !raw.type0; const cb = single ? 1 : (raw.toUni && raw.toUni.bytes === 1 ? 1 : 2);
  const f = {
    single, type0: !!raw.type0, baseFont: raw.baseFont || "", embedded: !!raw.embedded, flags: raw.flags || 0, toUni: raw.toUni ? raw.toUni.map : null,
    width(code) {
      if (single) { const i = code - (raw.firstChar || 0); const v = raw.widths && raw.widths[i]; return v != null ? v : (raw.missing || (raw.std ? raw.std(code) : 500)); }
      const v = raw.cidWidths && raw.cidWidths.get(code); return v != null ? v : (raw.dw != null ? raw.dw : 1000);
    },
    codes(bytes) { if (cb === 1) return Array.from(bytes); const o = []; for (let i = 0; i + 1 < bytes.length; i += 2) o.push(bytes[i] << 8 | bytes[i + 1]); return o; },
    decode(codes) { return codes.map(c => f.toUni && f.toUni.has(c) ? f.toUni.get(c) : (single ? csWinChar(c) : "")).join(""); },
    /* unicode text -> codes using only glyphs the (often subset) font is known to contain; null if impossible */
    encode(text, known) {
      if (!f.rev) {
        f.rev = new Map();
        if (f.toUni) for (const [c, u] of f.toUni) if (u.length === 1 && !f.rev.has(u) && f.width(c) > 0) f.rev.set(u, c);
      }
      const out = [];
      for (const ch of text) {
        let c = f.rev.get(ch);
        if (c == null && single && (!f.toUni || known && known.has(ch))) {
          const u = ch.charCodeAt(0); const cand = u < 128 ? u : (WIN_ANSI[u] || (u >= 160 && u < 256 ? u : null));
          if (cand != null && (!f.embedded || (known && known.has(ch)))) c = cand;
        }
        if (c == null && ch === " " && single) c = 32;
        if (c == null) return null;
        out.push(c);
      }
      return out;
    },
    hex(codes) { return "<" + codes.map(c => c.toString(16).toUpperCase().padStart(cb * 2, "0")).join("") + ">"; },
    widthOf(codes, size) { let w = 0; for (const c of codes) w += f.width(c); return w / 1000 * size; }
  };
  return f;
}

/* ---------- Writing text with any font ---------- */
/* One line of text as content-stream operators. o: {font: resource name, size, color [r,g,b] 0-1, tm [6], tz %, hex, bold, tj (TJ array string, optional)} */
function csTextOps(o) {
  const n = v => (Math.round(v * 1000) / 1000).toString();
  let s = "BT\n" + o.color.map(n).join(" ") + " rg\n/" + o.font + " " + n(o.size) + " Tf\n";
  if (o.tz && Math.abs(o.tz - 100) > .2) s += n(o.tz) + " Tz\n";
  if (o.invisible) s += "3 Tr\n"; else if (o.bold) s += "2 Tr " + n(o.size * .03) + " w " + o.color.map(n).join(" ") + " RG\n";
  s += o.tm.map(n).join(" ") + " Tm\n" + (o.tj ? "[" + o.tj + "] TJ" : o.hex + " Tj") + "\nET\n";
  return s;
}
/* Text matrix for upright text at a visible point, using pageFrame (rotation) and an optional italic slant. */
function csTm(F, vx, vy, slant = 0) {
  const [x, y] = F.pt(vx, vy); const [c, s] = F.vec(1, 0); const [ux, uy] = F.vec(slant, 1);
  return [c, s, ux, uy, x, y];
}

/* ---------- pdf-lib glue ---------- */
const csName = o => o ? String(o.toString()).replace(/^\//, "") : "";
function csStreamBytes(obj) {
  const L = PDFLib;
  if (obj instanceof L.PDFRawStream) return L.decodePDFRawStream(obj).decode();
  if (obj && typeof obj.getContents === "function") return obj.getContents();
  if (obj && typeof obj.getUnencodedContents === "function") return obj.getUnencodedContents();
  return new Uint8Array(0);
}
const csNum = o => o && typeof o.asNumber === "function" ? o.asNumber() : (o && typeof o.value === "function" ? o.value() : 0);
const csArr = (ctx, o) => { const a = ctx.lookup(o); return a instanceof PDFLib.PDFArray ? a.asArray().map(x => ctx.lookup(x)) : []; };
function csFontFromDict(ctx, dict) {
  const L = PDFLib; const get = (d, k) => d ? ctx.lookup(d.get(L.PDFName.of(k))) : null;
  const sub = csName(get(dict, "Subtype")); const raw = {baseFont: csName(get(dict, "BaseFont"))};
  let desc = get(dict, "FontDescriptor");
  const tu = get(dict, "ToUnicode");
  if (tu && !(tu instanceof L.PDFName)) { try { raw.toUni = parseToUnicode(csLatin(csStreamBytes(tu), 0, csStreamBytes(tu).length)); } catch (e) { raw.toUni = null; } }
  if (sub === "Type0") {
    raw.type0 = true; const df = csArr(ctx, dict.get(L.PDFName.of("DescendantFonts")))[0];
    if (df) {
      desc = get(df, "FontDescriptor"); const dw = get(df, "DW"); raw.dw = dw ? csNum(dw) : 1000;
      const W = get(df, "W"); const flat = o => o instanceof L.PDFArray ? o.asArray().map(x => flat(ctx.lookup(x))) : csNum(o);
      raw.cidWidths = W ? parseCidWidths(flat(W)) : new Map();
    }
  } else {
    raw.firstChar = csNum(get(dict, "FirstChar")); const W = get(dict, "Widths"); raw.widths = W ? csArr(ctx, W).map(csNum) : null;
    if (!raw.widths && raw.baseFont) {
      /* standard 14 font without widths: measure with pdf-lib's built-in metrics when available */
      try { const std = L.StandardFonts[Object.keys(L.StandardFonts).find(k => L.StandardFonts[k] === raw.baseFont)]; if (std && L.StandardFontEmbedder) { const em = L.StandardFontEmbedder.for(std); raw.std = code => { try { return em.widthOfTextAtSize(csWinChar(code) || " ", 1000); } catch (e) { return 500; } }; } } catch (e) { /* fall back */ }
    }
  }
  if (desc) {
    raw.missing = csNum(get(desc, "MissingWidth")) || 0; raw.flags = csNum(get(desc, "Flags"));
    raw.embedded = !!(get(desc, "FontFile") || get(desc, "FontFile2") || get(desc, "FontFile3"));
  }
  if (sub === "Type3") return null;
  return csMakeFont(raw);
}
function csResources(ctx, resDict) {
  const L = PDFLib; const fonts = {}, xobjs = {};
  const sub = k => resDict ? ctx.lookup(resDict.get(L.PDFName.of(k))) : null;
  const fd = sub("Font"), xd = sub("XObject");
  return {
    dict: resDict,
    fontRef(name) { return fd ? fd.get(L.PDFName.of(name)) : null; },
    font(name) {
      if (!(name in fonts)) { let f = null; try { const d = fd && ctx.lookup(fd.get(L.PDFName.of(name))); if (d instanceof L.PDFDict) f = csFontFromDict(ctx, d); } catch (e) { f = null; } fonts[name] = f; }
      return fonts[name];
    },
    xobj(name) {
      if (name in xobjs) return xobjs[name];
      let r = null;
      try {
        const x = xd && ctx.lookup(xd.get(L.PDFName.of(name)));
        if (x && x.dict) {
          const st = csName(x.dict.lookup(L.PDFName.of("Subtype")));
          if (st === "Image") r = {kind: "image", pw: csNum(x.dict.lookup(L.PDFName.of("Width"))), ph: csNum(x.dict.lookup(L.PDFName.of("Height")))};
          else if (st === "Form") {
            const m = x.dict.lookup(L.PDFName.of("Matrix")); const fr = x.dict.lookup(L.PDFName.of("Resources"));
            r = {kind: "form", toks: csTokenize(csStreamBytes(x)), matrix: m ? csArr(ctx, m).map(csNum) : CS_ID, res: fr instanceof L.PDFDict ? csResources(ctx, fr) : this};
          }
        }
      } catch (e) { r = null; }
      xobjs[name] = r; return r;
    }
  };
}
/* Everything about one page's content. vt = pdf.js viewport.transform at scale 1 (user space -> visible). */
function csReadPage(doc, index, vt) {
  const L = PDFLib; const ctx = doc.context; const page = doc.getPage(index); const node = page.node;
  const c = node.Contents(); const list = c instanceof L.PDFArray ? c.asArray().map(r => ctx.lookup(r)) : c ? [c] : [];
  const chunks = list.map(csStreamBytes); let len = 0; chunks.forEach(b => { len += b.length + 1; });
  const bytes = new Uint8Array(len); let o = 0; chunks.forEach(b => { bytes.set(b, o); o += b.length; bytes[o++] = 10; });
  const res = csResources(ctx, node.Resources());
  const toks = csTokenize(bytes); const r = csInterpret(toks, res);
  const V = (x, y) => csApply(vt, x, y);
  for (const sh of r.shows) {
    const a = V(sh.x0, sh.y0), b = V(sh.x1, sh.y1); sh.vx0 = a[0]; sh.vy = a[1]; sh.vx1 = b[0];
    const d = V(sh.x0 + sh.dir[0], sh.y0 + sh.dir[1]); sh.upright = Math.abs(d[1] - a[1]) < Math.abs(d[0] - a[0]) * .05 && d[0] > a[0];
    sh.text = sh.font ? sh.font.decode(sh.codes) : "";
  }
  const rules = r.rules.map(q => { const a = V(q.x0, q.y0), b = V(q.x1, q.y1); return {x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]), soft: q.soft}; })
    .filter(q => (q.x1 - q.x0 > 4 && q.y1 - q.y0 < 1.5) || (q.y1 - q.y0 > 4 && q.x1 - q.x0 < 1.5));
  const images = r.images.map(im => { const pts = im.corners.map(p => V(p[0], p[1])); const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]); return {...im, vx: Math.min(...xs), vy: Math.min(...ys), vw: Math.max(...xs) - Math.min(...xs), vh: Math.max(...ys) - Math.min(...ys)}; });
  return {bytes, toks, shows: r.shows, rules, images, res};
}
/* Which shows belong to a line (visible coords: x, w, base, size). */
function csShowsForLine(shows, ln) {
  return shows.filter(sh => sh.upright && sh.codes.length && Math.abs(sh.vy - ln.base) < ln.size * .4 && sh.size > ln.size * .6 && sh.size < ln.size * 1.6 &&
    sh.vx0 >= ln.x - ln.size * .4 && sh.vx0 < ln.x + ln.w - ln.size * .1);
}
/* Rewrites a page: removes the given shows, wraps the original content in q/Q and appends extra operators. */
function csWritePage(doc, index, pg, removeShows, extraOps, moreEdits) {
  const L = PDFLib; const ctx = doc.context; const node = doc.getPage(index).node;
  const edits = removeShows.filter(sh => !sh.inForm && sh.Tfs).map(sh => ({s: sh.s, e: sh.e, text: csReplacement(sh)}));
  const body = csSplice(pg.bytes, edits.concat(moreEdits || []));
  const tail = new Uint8Array([..."\nQ\n" + (extraOps || "")].map(ch => ch.charCodeAt(0) & 255));
  const all = new Uint8Array(2 + body.length + tail.length); all.set([113, 10], 0); all.set(body, 2); all.set(tail, 2 + body.length);
  const ref = ctx.register(ctx.flateStream(all));
  node.set(L.PDFName.of("Contents"), ref);
  return edits.length;
}
/* Filled rectangle in visible coordinates (upright on rotated pages). */
function csRectOps(F, vx, vy, w, h, color) {
  const n = v => (Math.round(v * 1000) / 1000).toString();
  const [x, y] = F.pt(vx, vy + h); const [c, s] = F.vec(1, 0);
  return "q " + color.map(n).join(" ") + " rg " + [c, s, -s, c, x, y].map(n).join(" ") + " cm 0 0 " + n(w) + " " + n(h) + " re f Q\n";
}
/* Makes sure the page's resources can reach a font (for fonts found inside form XObjects). Returns the name to use. */
function csEnsureFontName(doc, index, fontRef, wanted) {
  const L = PDFLib; const node = doc.getPage(index).node; const res = node.Resources();
  let fd = res.lookup(L.PDFName.of("Font"));
  if (!fd) { fd = doc.context.obj({}); res.set(L.PDFName.of("Font"), fd); }
  const existing = fd.get(L.PDFName.of(wanted));
  if (existing && (existing === fontRef || String(existing) === String(fontRef))) return wanted;
  let name = "DbxF" + Math.floor(Math.random() * 1e6); fd.set(L.PDFName.of(name), fontRef); return name;
}

/* Lines with character formatting: each run gets its own font face, size, colour and underline. */
async function csStyledLines(doc, index, F, ed, shows, helpers, stat) {
  const n = v => (Math.round(v * 1000) / 1000).toString(); let ops = "";
  const src = shows.find(sh => sh.font && !sh.inForm); const of = ed.keepFont && src ? src.font : null;
  const known = of ? new Set([...ed.origLines.map(l => l.text || "").join("")]) : null;
  const stdNames = {};
  const faceFor = async (bold, ital) => {
    if (of && bold === !!ed.bold && ital === !!ed.italic) return {font: of, fname: src.fname, own: true};
    const v = helpers.variant && src && src.font ? helpers.variant(src.font.baseFont, bold, ital) : null;
    if (v) return {font: v.font, fname: v.fname, own: true};
    return null;
  };
  for (let li = 0; li < ed.lineRuns.length; li++) {
    const segs = ed.lineRuns[li].map(s => ({...s, text: s.text}));
    const last = segs[segs.length - 1]; if (last) last.text = last.text.replace(/\s+$/, "");
    const pieces = [];
    for (const sg of segs) {
      const st = sg.st || {}; const bold = st.bold != null ? st.bold : !!ed.bold, ital = st.italic != null ? st.italic : !!ed.italic;
      const size = st.size || ed.size; const color = st.color ? hexRgb(st.color) : ed.color;
      const face = await faceFor(bold, ital); const std = await helpers.getStd(ed.stdFam, bold, ital);
      for (const ch of sg.text) {
        let codes = face ? face.font.encode(ch, face.font === of ? known : null) : null; let kind = codes ? "o" : "s";

        const l = pieces[pieces.length - 1];
        if (l && l.kind === kind && l.face === face && l.std === std && l.size === size && csKey2(l.color) === csKey2(color) && l.underline === !!st.underline) { l.text += ch; if (codes) l.codes.push(...codes); }
        else pieces.push({kind, face, std, size, color, underline: !!st.underline, text: ch, codes: codes ? codes.slice() : []});
      }
    }
    for (const p of pieces) p.w = p.kind === "o" ? p.face.font.widthOf(p.codes, p.size) : p.std.widthOfTextAtSize(p.text.replace(/[^\u0000-\u00ff\u2000-\u20ff]/g, "?"), p.size) * (ed.hscale || 1);
    const lw = pieces.reduce((a, p) => a + p.w, 0);
    const off = ed.align === "center" ? (ed.wrap - lw) / 2 : ed.align === "right" ? ed.wrap - lw : 0;
    let x = ed.x0 + Math.max(0, off); const base = ed.base0 + li * ed.gap;
    for (const p of pieces) {
      let fname, hex;
      if (p.kind === "o") { fname = p.face.fname; hex = p.face.font.hex(p.codes); }
      else { fname = stdNames[p.std.name] || (stdNames[p.std.name] = helpers.stdName(p.std)); hex = "<" + [...p.text].map(ch => { const c = cleanForFont(p.std, ch).text; return p.std.encodeText(c).toString().replace(/[<>]/g, ""); }).join("") + ">"; }
      ops += csTextOps({font: fname, size: p.size, color: p.color, tm: csTm(F, x, base), hex, tz: p.kind === "o" ? 100 : (ed.hscale || 1) * 100, invisible: !!ed.invisible});
      stat.written.push({text: p.text, font: fname, x, base, size: p.size});
      if (p.underline && !ed.invisible) ops += csRectOps(F, x, base + p.size * .1, p.w, Math.max(.4, p.size * .05), p.color); /* standard underline position -0.1 em, thickness 0.05 em */
      x += p.w;
    }
  }
  return ops;
}
const csKey2 = c => (c || []).map(v => Math.round(v * 1000)).join(",");
/* ---------- Applying text edits to one page ----------
   edit: {isNew, origLines:[{x,w,base,size}], cover:{x,y,w,h}|null, bg:[0-1 rgb], lines:[string], x0, base0, gap, size, wrap, align,
          color:[0-1 rgb], keepFont: bool, bold, italic, synthBold, slant, underline, stdFam}
   helpers: {getStd(fam,bold,italic) -> Promise<pdf-lib font>, stdName(font) -> resource name, image(edit) -> Promise<{bytes, top, w, h}>|null}
   Old text is removed from the content stream; new text is written with the line's own font where it has the characters,
   and a matching standard font only for characters it lacks. */
async function csApplyTextEdits(doc, index, pg, F, edits, helpers) {
  const stat = {replaced: 0, covered: 0, similar: 0, images: 0, written: []};
  const remove = []; let ops = "";
  const n = v => (Math.round(v * 1000) / 1000).toString();
  for (const ed of edits) {
    let shows = [];
    if (!ed.isNew && pg) for (const ln of ed.origLines) shows = shows.concat(csShowsForLine(pg.shows, ln));
    shows = [...new Set(shows)];
    if (!ed.isNew) {
      const removable = shows.filter(sh => !sh.inForm && sh.Tfs);
      const covW = removable.reduce((a, sh) => a + Math.abs(sh.vx1 - sh.vx0), 0), lineW = ed.origLines.reduce((a, l) => a + l.w, 0);
      remove.push(...removable);
      const full = removable.length && removable.length === shows.length && covW >= lineW * .85;
      if (full) stat.replaced += ed.origLines.length;
      else if (ed.cover) { ops += csRectOps(F, ed.cover.x, ed.cover.y, ed.cover.w, ed.cover.h, ed.bg); stat.covered += ed.origLines.length; }
    }
    const lines = ed.lines.map(l => l.replace(/\s+$/, ""));
    if (!lines.some(l => l.trim())) continue;
    /* formatted runs; Indian scripts still go through the picture path (formatting can't be shaped there) */
    if (ed.lineRuns && !/[^\u0000-\u024F\u2000-\u206F\u20A0-\u20CF\u2100-\u214F]/.test(lines.join(""))) { ops += await csStyledLines(doc, index, F, ed, shows, helpers, stat); continue; }
    const src = shows.find(sh => sh.font && !sh.inForm);
    const of = ed.keepFont && src ? src.font : null;
    const known = of ? new Set([...ed.origLines.map(l => l.text || "").join("")]) : null;
    const std = await helpers.getStd(ed.stdFam, ed.bold, ed.italic);
    /* split each line into runs: original font where it can, else the standard font */
    const plan = [];
    let needImage = false, usedStd = false;
    for (const l of lines) {
      const runs = [];
      for (const ch of l) {
        let codes = of ? of.encode(ch, known) : null; let font = "o";
        if (!codes) { if (cleanForFont(std, ch).bad) { needImage = true; break; } font = "s"; usedStd = true; }
        const last = runs[runs.length - 1];
        if (last && last.font === font) { last.text += ch; if (codes) last.codes.push(...codes); }
        else runs.push({font, text: ch, codes: codes ? codes.slice() : []});
      }
      if (needImage) break;
      for (const r of runs) r.w = r.font === "o" ? of.widthOf(r.codes, ed.size) : std.widthOfTextAtSize(r.text, ed.size) * (ed.hscale || 1);
      plan.push(runs);
    }
    if (needImage) {
      const im = helpers.image ? await helpers.image(ed) : null;
      if (im) { const png = await doc.embedPng(im.bytes); const nm = doc.getPage(index).node.newXObject("DbxT", png.ref).toString().replace(/^\//, ""); const [x, y] = F.pt(ed.x0, ed.base0 + im.top + im.h); const [c, s] = F.vec(1, 0); ops += "q " + [c * im.w, s * im.w, -s * im.h, c * im.h, x, y].map(n).join(" ") + " cm /" + nm + " Do Q\n"; stat.images++; }
      continue;
    }
    if (of && usedStd) stat.similar++;
    else if (!of && !ed.isNew && ed.keepFont) stat.similar++;
    const stdNm = usedStd || !of ? helpers.stdName(std) : null;
    plan.forEach((runs, i) => {
      if (!runs.length) return;
      const lw = runs.reduce((a, r) => a + r.w, 0);
      const off = ed.align === "center" ? (ed.wrap - lw) / 2 : ed.align === "right" ? ed.wrap - lw : 0;
      let x = ed.x0 + Math.max(0, off); const base = ed.base0 + i * ed.gap;
      for (const r of runs) {
        const isO = r.font === "o";
        ops += csTextOps({font: isO ? src.fname : stdNm, size: ed.size, color: ed.color, tm: csTm(F, x, base, ed.slant || 0), hex: isO ? of.hex(r.codes) : "<" + [...r.text].map(ch => { const c = std.encodeText(ch).toString(); return c.replace(/[<>]/g, ""); }).join("") + ">", bold: ed.synthBold, tz: isO ? 100 : (ed.hscale || 1) * 100, invisible: !!ed.invisible});
        stat.written.push({text: r.text, font: isO ? src.fname : stdNm, x, base, size: ed.size});
        x += r.w;
      }
      if (ed.underline && !ed.invisible) ops += csRectOps(F, ed.x0 + Math.max(0, off), base + ed.size * .1, lw, Math.max(.4, ed.size * .06), ed.color);
    });
  }
  return {remove, ops, stat};
}
