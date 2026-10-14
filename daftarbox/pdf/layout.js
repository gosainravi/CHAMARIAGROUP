/* Daftarbox PDF tools – text block layout for Edit PDF (pure maths, tested in Node).
   Finds the container of each line (table cell, column or free space), groups lines into paragraphs
   only when they are clearly soft-wrapped, and wraps / fits edited text inside a width. */
"use strict";

const fontKey = f => (f ? f.fam + (f.bold ? "b" : "") + (f.italic ? "i" : "") : "");
const sameColour = (a, b) => !a || !b || Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < .12;

/* The box a line lives in: cell borders from ruling lines, otherwise the free space to the next content or the page margin. */
function lineContainer(ln, rules, others, W, H) {
  const mid = (ln.top + ln.bottom) / 2; let l = null, r = null, t = null, b = null;
  for (const q of rules) {
    if (q.x1 - q.x0 < 1.5) {
      if (q.y0 <= mid && q.y1 >= mid) {
        const x = (q.x0 + q.x1) / 2;
        if (x <= ln.x + .5 && (l === null || x > l)) l = x;
        if (x >= ln.x + ln.w - .5 && (r === null || x < r)) r = x;
      }
    } else if (q.x0 <= ln.x + 1 && q.x1 >= ln.x + Math.min(ln.w, 10)) {
      const y = (q.y0 + q.y1) / 2;
      if (y <= ln.top + ln.size * .3 && (t === null || y > t)) t = y;
      if (y >= ln.bottom - ln.size * .15 && (b === null || y < b)) b = y;
    }
  }
  const cell = l !== null && r !== null && t !== null && b !== null && r - l < W * .95;
  let right = r;
  if (right === null) {
    right = W - Math.max(18, Math.min(ln.x, 72));
    for (const o of others) if (o !== ln && o.bottom > ln.top && o.top < ln.bottom && o.x > ln.x + ln.w - 1 && o.x - ln.size * .6 < right) right = o.x - ln.size * .6;
    right = Math.max(right, ln.x + ln.w);
  }
  let bottom = b;
  if (bottom === null) {
    bottom = H - 18;
    for (const o of others) if (o !== ln && o.top >= ln.bottom - 1 && o.x < right && o.x + o.w > ln.x && o.top < bottom) bottom = o.top;
  }
  return {l: l === null ? ln.x : l, r: right, t: t === null ? ln.top : t, b: Math.max(bottom, ln.bottom), cell, hasL: l !== null, hasR: r !== null};
}

/* Lines -> blocks. A line joins the block above only when it is clearly the continuation of a wrapped paragraph:
   same column/cell, font, size and colour, normal spacing, no border in between, and its first word would not
   have fitted at the end of the line above. Everything else (labels, headings, table cells) stays a single line. */
function buildBlocks(lines, rules, W, H) {
  const L = lines.slice().sort((a, b) => a.top - b.top || a.x - b.x);
  const C = L.map(l => lineContainer(l, rules, L, W, H));
  const used = new Set(); const groups = [];
  const between = (a, b) => rules.some(q => q.y1 - q.y0 < 1.5 && (q.y0 + q.y1) / 2 > a.bottom - 1 && (q.y0 + q.y1) / 2 < b.top + 1 && q.x0 < a.x + a.w && q.x1 > a.x);
  for (let i = 0; i < L.length; i++) {
    if (used.has(i)) continue;
    const g = [i]; used.add(i); let gap = 0;
    for (;;) {
      const li = g[g.length - 1], a = L[li];
      let j = -1;
      for (let k = li + 1; k < L.length; k++) { const c = L[k]; if (c.top > a.top + a.size * .3 && c.x < a.x + a.w && c.x + c.w > a.x) { j = k; break; } }
      if (j < 0 || used.has(j)) break;
      const b = L[j], ca = C[li], cb = C[j], first = L[g[0]];
      const dy = b.base - a.base;
      const ok = Math.abs(b.x - first.x) < a.size * .6 && fontKey(a.font) === fontKey(b.font) && Math.abs(b.size / a.size - 1) < .05 && sameColour(a.color, b.color) &&
        dy >= a.size * 1.0 && dy <= a.size * 1.75 && (!gap || Math.abs(dy - gap) < a.size * .15) && ca.cell === cb.cell &&
        (!ca.cell || (Math.abs(ca.l - cb.l) < 1 && Math.abs(ca.r - cb.r) < 1)) && !between(a, b);
      if (!ok) break;
      const avg = a.w / Math.max(1, a.text.length); const word = (b.text.split(" ")[0] || "").length;
      const innerR = ca.cell ? ca.r - Math.max(1, Math.min(8, first.x - ca.l)) : ca.r;
      /* soft = the next word would not have fitted at the end of this line (a wrapped paragraph); otherwise a real line break, kept as \n */
      const soft = a.x + a.w + avg * (1 + word) > innerR && a.text.split(" ").length >= (ca.cell ? 2 : 4);
      if (!soft && !ca.cell && dy > a.size * 1.5) break;
      g.push(j); used.add(j); g.soft = (g.soft || []).concat(soft); gap = gap ? (gap * (g.length - 2) + dy) / (g.length - 1) : dy;
    }
    groups.push(g);
  }
  return groups.map(g => {
    const ls = g.map(k => L[k]); const c0 = C[g[0]], first = ls[0], last = ls[ls.length - 1];
    const soft = g.soft || []; const anySoft = soft.some(Boolean);
    const own = new Set(ls); const rest = L.filter(o => !own.has(o));
    const cl = lineContainer(last, rules, rest, W, H);
    const sizes = ls.map(l => l.size).sort((a, b) => a - b); const size = sizes[Math.floor(sizes.length / 2)];
    const ox = Math.min(...ls.map(l => l.x)); const maxEnd = Math.max(...ls.map(l => l.x + l.w));
    const ends = ls.map(l => l.x + l.w), starts = ls.map(l => l.x);
    let x = ox, wrapW, align = "left";
    if (c0.cell) {
      const lg = ox - c0.l, rg = c0.r - maxEnd; const pad = clamp(Math.min(lg, rg), 1.5, 8);
      if (rg < lg * .5 && lg > 6) align = "right"; else if (Math.abs(lg - rg) < 2.5 && lg > 6) align = "center";
      if (align !== "left") x = c0.l + pad;
      wrapW = Math.max(maxEnd, c0.r - pad) - x;
    } else if (ls.length > 1 && Math.max(...ends) - Math.min(...ends) < .8 && Math.max(...starts) - Math.min(...starts) > 1.5) {
      align = "right"; wrapW = maxEnd - x;
    } else wrapW = anySoft ? (maxEnd - x) * 1.02 + 1 : Math.max(maxEnd, c0.r) - x;
    const gap = ls.length > 1 ? (last.base - first.base) / (ls.length - 1) : size * 1.2;
    return {lines: ls, x, ox, align0: align, top: Math.min(...ls.map(l => l.top)), bottom: Math.max(...ls.map(l => l.bottom)), base0: first.base, gap, size,
      font: first.font, color: first.color || null, cell: c0.cell, cont: {l: c0.l, r: c0.cell ? c0.r : Math.max(c0.r, maxEnd), t: c0.t, b: c0.cell ? c0.b : cl.b},
      wrapW, maxBottom: c0.cell ? c0.b : cl.b, origText: ls.map((l, i) => (i ? (soft[i - 1] ? " " : "\n") : "") + l.text).join(""), words: ls.flatMap(l => l.words || [])};
  });
}

/* pdf.js often joins pieces of text that share a baseline into one item (for example a label and its value far apart).
   Using the real text-show operations, split such lines wherever there's a wide gap or a cell border between two shows. */
function splitLinesByShows(lines, shows, rules) {
  const vr = (rules || []).filter(q => q.x1 - q.x0 < 1.5 && q.y1 - q.y0 > 4);
  const out = [];
  for (let ln of lines) {
    const sh = shows.filter(s => s.upright && s.codes.length && Math.abs(s.vy - ln.base) < ln.size * .4 && s.vx0 >= ln.x - 1 && s.vx0 < ln.x + ln.w - .5 && s.size > ln.size * .5 && s.size < ln.size * 2)
      .sort((a, b) => a.vx0 - b.vx0);
    const stripS = t => t.replace(/\s+/g, "");
    /* the shows tell the true width when their text is the line's text */
    if (sh.length && stripS(sh.map(s => s.text || "").join("")) === stripS(ln.text)) { const x1 = Math.max(...sh.map(s => s.vx1)); if (x1 > ln.x) ln = {...ln, w: x1 - ln.x}; }
    if (sh.length < 2) { out.push(ln); continue; }
    const groups = [[sh[0]]];
    for (let i = 1; i < sh.length; i++) {
      const prev = groups[groups.length - 1], a = prev[prev.length - 1], b = sh[i];
      const end = Math.max(...prev.map(s => s.vx1)); const gap = b.vx0 - end;
      const ruled = vr.some(q => q.x0 > end - .3 && q.x0 < b.vx0 + .3 && q.y0 < ln.base - ln.size * .3 && q.y1 > ln.base - ln.size * .3);
      if (gap > ln.size * .9 || ruled) groups.push([b]); else prev.push(b);
    }
    if (groups.length < 2) { out.push(ln); continue; }
    /* hand out the line's characters to the groups: by the shows' own text when it matches, else by width */
    const chars = [...ln.text]; const strip = t => t.replace(/\s+/g, "");
    const gt = groups.map(g => strip(g.map(s => s.text || "").join("")));
    let parts = null;
    if (gt.join("") === strip(ln.text)) {
      parts = []; let k = 0;
      for (const t of gt) { let need = [...t].length, s = ""; while (k < chars.length && need > 0) { s += chars[k]; if (!/\s/.test(chars[k])) need--; k++; } parts.push(s); }
      parts[parts.length - 1] += chars.slice(k).join("");
    } else { out.push(ln); continue; } /* can't tell which letters go where: keep the line whole */
    groups.forEach((g, i) => {
      const t = (parts[i] || "").trim(); if (!t) return;
      const x = g[0].vx0, w = Math.max(...g.map(s => s.vx1)) - x;
      out.push({...ln, x, w, text: t});
    });
  }
  return out;
}
/* "L e t t e r s p a c e d" (letter-spaced headings) -> "Letterspaced": only when every word is one letter. */
function unspace(t) {
  const words = t.split(/ {2,}/); const letters = words.flatMap(w => w.split(" "));
  return letters.length > 4 && letters.every(x => [...x].length === 1) && words.length > 1 ? words.map(w => w.replace(/ /g, "")).join(" ") : t;
}

/* Greedy word wrap with any width function; hard breaks (\n) are kept, long words are split. */
function layoutText(text, measure, wrapW) {
  const out = [];
  for (const para of String(text).split("\n")) {
    if (!para) { out.push(""); continue; }
    let cur = "";
    for (const w0 of para.split(" ")) {
      let w = w0;
      const t = cur ? cur + " " + w : w;
      if (measure(t) <= wrapW + 1e-6) { cur = t; continue; }
      if (cur) { out.push(cur); cur = ""; }
      while (w.length > 1 && measure(w) > wrapW + 1e-6) { let k = w.length - 1; while (k > 1 && measure(w.slice(0, k)) > wrapW) k--; out.push(w.slice(0, k)); w = w.slice(k); }
      cur = w;
    }
    out.push(cur);
  }
  return out;
}
/* Largest font size (down to minSize) at which the text fits the box height. measureAt(size) -> (text) -> width. */
function fitSize(text, measureAt, wrapW, maxH, size, lsMul, minSize) {
  const fits = s => layoutText(text, measureAt(s), wrapW).length * s * lsMul <= maxH + .01;
  if (fits(size)) return size;
  let lo = minSize, hi = size;
  if (!fits(lo)) return lo;
  for (let i = 0; i < 18 && hi - lo > .05; i++) { const m = (lo + hi) / 2; if (fits(m)) lo = m; else hi = m; }
  return Math.floor(lo * 10) / 10;
}
/* Snap a value to the nearest candidate within tol. */
function snapTo(v, cands, tol) {
  let best = null, bd = tol;
  for (const c of cands) { const d = Math.abs(c - v); if (d <= bd) { bd = d; best = c; } }
  return best === null ? {v, to: null} : {v: best, to: best};
}
/* Do two rectangles overlap by more than a hair? */
const rectsOverlap = (a, b, eps = .8) => a.x + eps < b.x + b.w && b.x + eps < a.x + a.w && a.y + eps < b.y + b.h && b.y + eps < a.y + a.h;
/* Unit-square image matrix after moving/resizing/rotating its visible box.
   C: original CTM at the Do; vt: user -> visible; O, N: old/new visible rects; quarter: clockwise quarter turns. Returns the cm to insert. */
function imageCm(C, vt, O, N, quarter) {
  const q = ((quarter % 4) + 4) % 4; const odd = q % 2 === 1;
  const sx = N.w / (odd ? O.h : O.w), sy = N.h / (odd ? O.w : O.h);
  const ang = q * Math.PI / 2, co = Math.round(Math.cos(ang)), si = Math.round(Math.sin(ang));
  let T = [1, 0, 0, 1, -(O.x + O.w / 2), -(O.y + O.h / 2)];
  T = csMul(T, [co, si, -si, co, 0, 0]); T = csMul(T, [sx, 0, 0, sy, 0, 0]); T = csMul(T, [1, 0, 0, 1, N.x + N.w / 2, N.y + N.h / 2]);
  const M = csMul(csMul(csMul(C, vt), T), csInv(vt));
  return csMul(M, csInv(C));
}
