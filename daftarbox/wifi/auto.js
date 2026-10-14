/* Daftarbox Wi-Fi: automatic floor-plan analysis. Pure functions (no DOM) so they run on the page, in a Blob worker
   (via AutoFactory.toString()) and in Node tests.

   Raster pipeline (primary; scans and image PDFs):
     dark mask (low-saturation dark pixels, drops coloured stamps) -> estimate line width and the gap of double-line walls
     -> close by the gap so double lines become solid bands -> open with long thin line shapes (H and V) to keep only long
     bands -> keep bands that look like walls (two edges with a light middle, or solid) -> solid columns
     -> footprint: join wall structure across door gaps, keep the largest, fill holes -> coverage area = footprint minus walls.
   Vector helpers (bonus, PDFs with real paths): path extraction from a pdf.js operator list, wall pairing.
   Scale helpers: scale notes ("1:100", 1/8" = 1'-0"), dimension values, OCR matching against the footprint.
   Bill of materials: PoE switch mix and power budget.
*/
function AutoFactory() {
  'use strict';

  /* ---------- binary morphology on Uint8Array (0/1), O(N) with running windows ---------- */
  function dilateH(src, w, h, r) {
    if (r <= 0) return src.slice();
    var out = new Uint8Array(w * h);
    for (var y = 0; y < h; y++) {
      var row = y * w, cnt = 0, x;
      for (x = 0; x < Math.min(r, w); x++) cnt += src[row + x];
      for (x = 0; x < w; x++) {
        if (x + r < w) cnt += src[row + x + r];
        if (x - r - 1 >= 0) cnt -= src[row + x - r - 1];
        out[row + x] = cnt > 0 ? 1 : 0;
      }
    }
    return out;
  }
  function dilateV(src, w, h, r) {
    if (r <= 0) return src.slice();
    var out = new Uint8Array(w * h), cnt = new Int32Array(w), x, y;
    for (y = 0; y < Math.min(r, h); y++) for (x = 0; x < w; x++) cnt[x] += src[y * w + x];
    for (y = 0; y < h; y++) {
      var add = y + r < h ? (y + r) * w : -1, sub = y - r - 1 >= 0 ? (y - r - 1) * w : -1, row = y * w;
      for (x = 0; x < w; x++) {
        if (add >= 0) cnt[x] += src[add + x];
        if (sub >= 0) cnt[x] -= src[sub + x];
        out[row + x] = cnt[x] > 0 ? 1 : 0;
      }
    }
    return out;
  }
  function invert(m) { var o = new Uint8Array(m.length); for (var i = 0; i < m.length; i++) o[i] = m[i] ? 0 : 1; return o; }
  function dilate(m, w, h, rx, ry) { return dilateV(dilateH(m, w, h, rx), w, h, ry == null ? rx : ry); }
  function erode(m, w, h, rx, ry) { return invert(dilate(invert(m), w, h, rx, ry)); }
  function close(m, w, h, rx, ry) { return erode(dilate(m, w, h, rx, ry), w, h, rx, ry); }
  function open(m, w, h, rx, ry) { return dilate(erode(m, w, h, rx, ry), w, h, rx, ry); }
  function or(a, b) { var o = new Uint8Array(a.length); for (var i = 0; i < a.length; i++) o[i] = a[i] | b[i]; return o; }

  /* Connected components (8-connected). Returns {labels:Int32Array, comps:[{id,area,x0,y0,x1,y1}]} */
  function components(m, w, h) {
    var labels = new Int32Array(w * h), comps = [], stack = new Int32Array(w * h), id = 0;
    for (var s = 0; s < m.length; s++) {
      if (!m[s] || labels[s]) continue;
      id++;
      var c = { id: id, area: 0, x0: w, y0: h, x1: 0, y1: 0 }, sp = 0;
      stack[sp++] = s; labels[s] = id;
      while (sp) {
        var p = stack[--sp], x = p % w, y = (p - x) / w;
        c.area++;
        if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
        for (var dy = -1; dy <= 1; dy++) {
          var yy = y + dy; if (yy < 0 || yy >= h) continue;
          for (var dx = -1; dx <= 1; dx++) {
            var xx = x + dx; if (xx < 0 || xx >= w) continue;
            var q = yy * w + xx;
            if (m[q] && !labels[q]) { labels[q] = id; stack[sp++] = q; }
          }
        }
      }
      comps.push(c);
    }
    return { labels: labels, comps: comps };
  }
  // Flood fill background (0 cells) from the image border; returns mask of reached cells.
  function floodOutside(blocked, w, h) {
    var out = new Uint8Array(w * h), stack = new Int32Array(w * h), sp = 0;
    function push(p) { if (!blocked[p] && !out[p]) { out[p] = 1; stack[sp++] = p; } }
    for (var x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (var y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (sp) {
      var p = stack[--sp], px = p % w;
      if (px > 0) push(p - 1); if (px < w - 1) push(p + 1);
      if (p >= w) push(p - w); if (p < (h - 1) * w) push(p + w);
    }
    return out;
  }

  /* ---------- dark mask ---------- */
  // rgba: Uint8ClampedArray. Keeps dark, low-saturation pixels (ink), drops coloured stamps and light scan noise.
  function darkMask(rgba, w, h, thr) {
    thr = thr || 150;
    var m = new Uint8Array(w * h);
    for (var i = 0, p = 0; i < m.length; i++, p += 4) {
      var r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
      var mx = r > g ? (r > b ? r : b) : (g > b ? g : b), mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
      var lum = 0.3 * r + 0.59 * g + 0.11 * b;
      if (lum < thr && (mx - mn) < 70) m[i] = 1;
    }
    return m;
  }

  /* Estimate ink line width and the gap of double-line walls from persistent pairs of thin runs.
     Long walls give the same pair on many consecutive rows/columns, text does not. */
  function estimateLines(m, w, h) {
    var gapHist = new Float64Array(120), lwHist = new Float64Array(16);
    function scan(isRows) {
      var n = isRows ? h : w, len = isRows ? w : h, prev = {};
      for (var a = 0; a < n; a += 1) {
        var cur = {}, runs = [], inRun = false, st = 0;
        for (var b = 0; b <= len; b++) {
          var v = b < len ? (isRows ? m[a * w + b] : m[b * w + a]) : 0;
          if (v && !inRun) { inRun = true; st = b; }
          else if (!v && inRun) { inRun = false; runs.push(st, b - st); }
        }
        for (var k = 0; k + 3 < runs.length; k += 2) {
          var l1 = runs[k + 1], l2 = runs[k + 3];
          if (l1 > 7 || l2 > 7) continue;
          var gap = runs[k + 2] - (runs[k] + l1);
          if (gap < 3 || gap >= 120) continue;
          var key = runs[k] + ':' + gap;
          cur[key] = 1;
          if (prev[key] || prev[(runs[k] - 1) + ':' + gap] || prev[(runs[k] + 1) + ':' + gap]) { gapHist[gap]++; lwHist[l1]++; lwHist[l2]++; }
        }
        prev = cur;
      }
    }
    scan(true); scan(false);
    // smooth and pick the strongest gap (ignore tiny gaps typical of hatching/text below 4 px)
    var bestG = 0, bestV = 0;
    for (var g = 4; g < 118; g++) { var v = gapHist[g - 1] * 0.5 + gapHist[g] + gapHist[g + 1] * 0.5; if (v > bestV) { bestV = v; bestG = g; } }
    var bestL = 2, bl = 0;
    for (var l = 1; l < 16; l++) if (lwHist[l] > bl) { bl = lwHist[l]; bestL = l; }
    return { gap: bestG, lw: bestL, votes: bestV };
  }

  /* Wall bands from the dark mask. Returns {walls (0/1), cols (0/1), t (band thickness px), info} */
  function rasterWalls(dark, w, h, est) {
    var lw = Math.max(1, est.lw), gap = est.gap || 10;
    var t = gap + 2 * lw;                          // band thickness in px
    var rc = Math.ceil(gap / 2) + 1;
    var closed = close(dark, w, h, rc, rc);
    var T = Math.max(2 * lw + 2, Math.min(t - 2, Math.round(t * 0.6)));
    var L = Math.max(4 * t, 30);
    var hr = Math.floor(L / 2), tr = Math.floor(T / 2);
    var hb = open(closed, w, h, hr, tr), vb = open(closed, w, h, tr, hr);
    // keep components that look like walls: across the band, ink at both faces with a light middle, or solid ink
    function filter(band, horiz) {
      var cc = components(band, w, h), keep = new Uint8Array(cc.comps.length + 1);
      cc.comps.forEach(function (c) {
        var along = horiz ? c.x1 - c.x0 + 1 : c.y1 - c.y0 + 1;
        if (along < L) return;
        var good = 0, tot = 0, step = Math.max(1, Math.floor(along / 60));
        for (var u = (horiz ? c.x0 : c.y0); u <= (horiz ? c.x1 : c.y1); u += step) {
          // find band extent across at this position
          var a0 = -1, a1 = -1;
          for (var v = (horiz ? c.y0 : c.x0); v <= (horiz ? c.y1 : c.x1); v++) {
            var p = horiz ? v * w + u : u * w + v;
            if (cc.labels[p] === c.id) { if (a0 < 0) a0 = v; a1 = v; }
          }
          if (a0 < 0) continue;
          tot++;
          var span = a1 - a0 + 1, inkA = 0, inkB = 0, mid = 0, midN = 0;
          for (var v2 = a0; v2 <= a1; v2++) {
            var q = horiz ? v2 * w + u : u * w + v2, d = dark[q];
            if (v2 - a0 < lw + 2) inkA |= d;
            else if (a1 - v2 < lw + 2) inkB |= d;
            else { mid += d; midN++; }
          }
          var midF = midN ? mid / midN : 1;
          if ((inkA && inkB && midF < 0.35) || midF > 0.8 || span <= 2 * lw + 3) good++;
        }
        if (tot && good / tot >= 0.72) keep[c.id] = 1;
      });
      var out = new Uint8Array(w * h);
      for (var i = 0; i < out.length; i++) if (keep[cc.labels[i]]) out[i] = 1;
      return out;
    }
    var walls = or(filter(hb, true), filter(vb, false));
    // solid columns: blobs that survive a square opening of the raw ink
    var cr = Math.max(2, Math.round(t * 0.3));
    var solid = open(dark, w, h, cr, cr), cols = new Uint8Array(w * h);
    var sc = components(solid, w, h);
    sc.comps.forEach(function (c) {
      var bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
      if (bw > 4 * t || bh > 4 * t || bw / bh > 3 || bh / bw > 3) return;
      for (var y = c.y0; y <= c.y1; y++) for (var x = c.x0; x <= c.x1; x++) if (sc.labels[y * w + x] === c.id) cols[y * w + x] = 1;
    });
    return { walls: walls, cols: cols, t: t, lw: lw, gap: gap, L: L };
  }

  /* Building footprint. t = wall band thickness in px (about 0.23 m for brick).
     1. Keep the main wall structure: walls and columns joined across small gaps (~0.6 m); stray text bits and
        dimension junk far from the building drop out. 2. Close across openings and missing walls (~3 m, typical
        column spacing is 4-7 m) and fill holes. The closing doesn't grow the outline, so it sits on the outer faces. */
  function footprint(walls, cols, w, h, t, opts) {
    opts = opts || {};
    var struct = or(walls, cols);
    var jr = Math.max(2, Math.round((opts.joinSmall || 2.6) * t));
    var cc = components(dilate(struct, w, h, jr, jr), w, h);
    var comps = cc.comps.filter(function (c) {
      return !((c.x1 - c.x0) > 0.92 * w && (c.y1 - c.y0) > 0.92 * h && c.area < 0.25 * (c.x1 - c.x0) * (c.y1 - c.y0));
    });
    if (!comps.length) return null;
    var boxA = function (c) { return (c.x1 - c.x0 + 1) * (c.y1 - c.y0 + 1); };
    comps.sort(function (a, b) { return boxA(b) - boxA(a); });
    var keep = {}, mainBox = boxA(comps[0]);
    comps.forEach(function (c) { if (boxA(c) >= 0.3 * mainBox) keep[c.id] = 1; });
    var main = new Uint8Array(w * h), bx0 = w, by0 = h, bx1 = 0, by1 = 0;
    comps.forEach(function (c) { if (keep[c.id]) { bx0 = Math.min(bx0, c.x0); by0 = Math.min(by0, c.y0); bx1 = Math.max(bx1, c.x1); by1 = Math.max(by1, c.y1); } });
    // columns and short walls that sit inside the main structure's box belong to the building too
    for (var yy = by0; yy <= by1; yy++) for (var xx = bx0; xx <= bx1; xx++) { var q = yy * w + xx; if (struct[q]) main[q] = 1; }
    // dilate, fill holes, erode back: fills big enclosed halls that a plain closing leaves open
    var R = Math.max(3, Math.round((opts.joinBig || 13) * t));
    var grown = dilate(main, w, h, R, R);
    var outside = floodOutside(grown, w, h);
    var filled = invert(outside);
    var fp = erode(filled, w, h, R, R), cnt = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (var p = 0; p < fp.length; p++) {
      if (!fp[p] && main[p] && filled[p]) fp[p] = 1;   // keep outer wall bands the erosion shaved
      if (!fp[p]) continue;
      cnt++;
      var x = p % w, y = (p - x) / w;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }    if (!cnt) return null;
    return { mask: fp, area: cnt, box: { x0: x0, y0: y0, x1: x1, y1: y1 }, main: main };
  }
  /* Downsample a 0/1 mask by integer factor f, cell set if any pixel set ("max pooling"). */
  function poolMax(m, w, h, f) {
    var W = Math.ceil(w / f), H = Math.ceil(h / f), o = new Uint8Array(W * H);
    for (var y = 0; y < h; y++) { var oy = ((y / f) | 0) * W, row = y * w; for (var x = 0; x < w; x++) if (m[row + x]) o[oy + ((x / f) | 0)] = 1; }
    return { data: o, w: W, h: H };
  }
  // Fraction pooling: cell set if at least `frac` of its pixels are set.
  function poolFrac(m, w, h, f, frac) {
    var W = Math.ceil(w / f), H = Math.ceil(h / f), cnt = new Uint16Array(W * H), o = new Uint8Array(W * H);
    for (var y = 0; y < h; y++) { var oy = ((y / f) | 0) * W, row = y * w; for (var x = 0; x < w; x++) if (m[row + x]) cnt[oy + ((x / f) | 0)]++; }
    var need = f * f * frac;
    for (var i = 0; i < o.length; i++) o[i] = cnt[i] >= need ? 1 : 0;
    return { data: o, w: W, h: H };
  }

  /* Wall classes for the model: 1 inner wall, 2 outer wall, 3 column/heavy. */
  function wallClasses(walls, cols, fpMask, w, h, t) {
    var cls = new Uint8Array(w * h);
    var outerZone = dilate(invert(fpMask), w, h, Math.ceil(t * 1.2), Math.ceil(t * 1.2));
    for (var i = 0; i < cls.length; i++) {
      if (cols[i] && fpMask[i]) cls[i] = 3;
      else if (walls[i] && (fpMask[i] || outerZone[i])) cls[i] = outerZone[i] ? 2 : 1;
    }
    return cls;
  }

  /* ---------- scale from text ---------- */
  // Returns [{ratio, str}] for "1:100", "SCALE 1 : 50", 1/8" = 1'-0", 1/4"=1'
  function scaleNotes(text) {
    var out = [], m, re = /(?:^|[^\d.])1\s*:\s*(\d{2,4})(?![\d.])/g;
    while ((m = re.exec(text))) { var r = +m[1]; if (r >= 20 && r <= 1000) out.push({ ratio: r, str: '1:' + r }); }
    var re2 = /(\d+(?:\s*\/\s*\d+)?|\d*\.\d+)\s*(?:"|''|in(?:ch)?)\s*=\s*(\d+)\s*(?:'|ft)/gi;
    while ((m = re2.exec(text))) {
      var pin = m[1].indexOf('/') >= 0 ? m[1].split('/').reduce(function (a, b) { return (+a) / (+b); }) : +m[1];
      var ft = +m[2];
      if (pin > 0 && ft > 0) { var R = ft * 12 / pin; if (R >= 20 && R <= 1000) out.push({ ratio: R, str: m[0].replace(/\s+/g, '') }); }
    }
    return out;
  }
  function bestNote(notes) {
    if (!notes.length) return null;
    var cnt = {};
    notes.forEach(function (n) { cnt[n.ratio] = (cnt[n.ratio] || 0) + 1; });
    var best = notes[0];
    notes.forEach(function (n) { if (cnt[n.ratio] > cnt[best.ratio]) best = n; });
    return best;
  }
  // Value of a dimension string in metres, or null.
  function dimValue(s) {
    s = String(s).trim().replace(/′/g, "'").replace(/″/g, '"');
    var m;
    if ((m = /^(\d{1,3})\s*'\s*-?\s*(\d{1,2})?\s*(?:(\d)\/(\d))?\s*"?$/.exec(s))) return +m[1] * 0.3048 + (m[2] ? +m[2] : 0) * 0.0254 + (m[3] ? (+m[3] / +m[4]) * 0.0254 : 0);
    if ((m = /^(\d+(?:\.\d+)?)\s*m$/i.exec(s))) { var v = +m[1]; return v > 0.3 && v < 300 ? v : null; }
    if ((m = /^(\d+)\s*mm$/i.exec(s))) return +m[1] / 1000;
    if ((m = /^\d{3,6}$/.exec(s))) { var v2 = +s; return v2 >= 300 && v2 <= 200000 ? v2 / 1000 : null; }
    if ((m = /^\d{1,2}\.\d{1,3}$/.exec(s))) { var v3 = +s; return v3 >= 0.5 && v3 <= 80 ? v3 : null; }
    return null;
  }

  /* Scale from OCR'd numbers around the footprint.
     words: [{text, x0,y0,x1,y1, vertical:bool}] in image px. box: footprint {x0,y0,x1,y1}.
     Overall dimensions ("21250 O/O") are the largest numbers along each side; match them to the footprint
     width/height and accept when horizontal and vertical agree. */
  function scaleFromOverall(words, box) {
    var bw = box.x1 - box.x0 + 1, bh = box.y1 - box.y0 + 1;
    var H = [], V = [];
    words.forEach(function (wd) {
      var v = dimValue(wd.text);
      if (!v || v < 3) return;
      var cx = (wd.x0 + wd.x1) / 2, cy = (wd.y0 + wd.y1) / 2;
      var outsideX = cx < box.x0 || cx > box.x1, outsideY = cy < box.y0 || cy > box.y1;
      if (!wd.vertical && outsideY && cx > box.x0 - bw * 0.1 && cx < box.x1 + bw * 0.1) H.push(v);
      if (wd.vertical && outsideX && cy > box.y0 - bh * 0.1 && cy < box.y1 + bh * 0.1) V.push(v);
    });
    H.sort(function (a, b) { return b - a; }); V.sort(function (a, b) { return b - a; });
    var best = null;
    H.slice(0, 4).forEach(function (hv) {
      V.slice(0, 4).forEach(function (vv) {
        var sh = hv / bw, sv = vv / bh, diff = Math.abs(sh - sv) / Math.max(sh, sv);
        var score = diff - 0.002 * (hv + vv);   // prefer the biggest (overall) values
        if (diff <= 0.06 && (!best || score < best.score)) best = { mPerPx: (sh + sv) / 2, h: hv, v: vv, diff: diff, score: score };
      });
    });
    if (best) return best;
    // only one side read: accept the largest value when it gives a sensible building size
    var one = H[0] ? { v: H[0], px: bw, axis: 'width' } : V[0] ? { v: V[0], px: bh, axis: 'height' } : null;
    if (one && one.v >= 5) return { mPerPx: one.v / one.px, single: one.axis, h: H[0] || null, v: V[0] || null, diff: null };
    return null;
  }

  /* ---------- OCR of dimension numbers (scans) ---------- */
  // Bands around the footprint where dimension chains live. Left/right bands hold text rotated 90 degrees.
  function ocrPlan(w, h, box) {
    var bw = box.x1 - box.x0, bh = box.y1 - box.y0, m = 0.32;
    var R = [];
    function add(name, x0, y0, x1, y1, rot) {
      x0 = Math.max(0, Math.round(x0)); y0 = Math.max(0, Math.round(y0)); x1 = Math.min(w, Math.round(x1)); y1 = Math.min(h, Math.round(y1));
      if (x1 - x0 > 20 && y1 - y0 > 20) R.push({ name: name, x: x0, y: y0, w: x1 - x0, h: y1 - y0, rot: rot });
    }
    add('top', box.x0 - bw * 0.06, box.y0 - bh * m, box.x1 + bw * 0.06, box.y0 + bh * 0.02, 0);
    add('left', box.x0 - bw * m, box.y0 - bh * 0.06, box.x0 + bw * 0.02, box.y1 + bh * 0.06, 90);
    add('bottom', box.x0 - bw * 0.06, box.y1 - bh * 0.02, box.x1 + bw * 0.06, box.y1 + bh * m, 0);
    add('right', box.x1 - bw * 0.02, box.y0 - bh * 0.06, box.x1 + bw * m, box.y1 + bh * 0.06, 90);
    return R;
  }
  // Greyscale (0..255) with coloured ink (stamps, signatures) turned white.
  function grayOf(rgba, w, h) {
    var g = new Uint8Array(w * h);
    for (var i = 0, p = 0; i < g.length; i++, p += 4) {
      var r = rgba[p], gg = rgba[p + 1], b = rgba[p + 2];
      var mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
      g[i] = (mx - mn) >= 70 ? 255 : Math.round(0.3 * r + 0.59 * gg + 0.11 * b);
    }
    return g;
  }
  /* Cropped grey image for OCR: long straight lines whitened, rotated upright, scaled up smoothly.
     rot 90: text that reads bottom-to-top is turned clockwise to read left-to-right. */
  function ocrImage(gray, dark, w, h, r, scale) {
    scale = scale || 3;
    var cw = r.w, ch = r.h, crop = new Uint8Array(cw * ch), dk = new Uint8Array(cw * ch);
    for (var y = 0; y < ch; y++) for (var x = 0; x < cw; x++) { var q = (r.y + y) * w + r.x + x; crop[y * cw + x] = gray[q]; dk[y * cw + x] = dark[q]; }
    var Lh = open(dk, cw, ch, 22, 0), Lv = open(dk, cw, ch, 0, 22);
    var LL = dilate(or(Lh, Lv), cw, ch, 1, 1);
    for (var i = 0; i < crop.length; i++) if (LL[i]) crop[i] = 255;
    var ow = r.rot ? ch : cw, oh = r.rot ? cw : ch, W = ow * scale, H = oh * scale, img = new Uint8Array(W * H);
    function at(u, v) { // u,v in output (unscaled) coords
      var sx, sy; if (r.rot) { sx = v; sy = ch - 1 - u; } else { sx = u; sy = v; }
      sx = sx < 0 ? 0 : sx >= cw ? cw - 1 : sx; sy = sy < 0 ? 0 : sy >= ch ? ch - 1 : sy;
      return crop[sy * cw + sx];
    }
    for (var yy = 0; yy < H; yy++) {
      var fv = (yy + 0.5) / scale - 0.5, v0 = Math.floor(fv), tv = fv - v0;
      for (var xx = 0; xx < W; xx++) {
        var fu = (xx + 0.5) / scale - 0.5, u0 = Math.floor(fu), tu = fu - u0;
        var val = (at(u0, v0) * (1 - tu) + at(u0 + 1, v0) * tu) * (1 - tv) + (at(u0, v0 + 1) * (1 - tu) + at(u0 + 1, v0 + 1) * tu) * tv;
        img[yy * W + xx] = val;
      }
    }
    return { w: W, h: H, data: img, scale: scale };
  }  // Map an OCR word box from the OCR image back to page pixels.
  function ocrMapWord(wd, r, scale) {
    scale = scale || 3;
    var x0 = wd.x0 / scale, y0 = wd.y0 / scale, x1 = wd.x1 / scale, y1 = wd.y1 / scale, o;
    if (r.rot) o = { x0: r.x + y0, x1: r.x + y1, y0: r.y + (r.h - 1 - x1), y1: r.y + (r.h - 1 - x0) };
    else o = { x0: r.x + x0, x1: r.x + x1, y0: r.y + y0, y1: r.y + y1 };
    o.x0 = Math.round(o.x0); o.y0 = Math.round(o.y0); o.x1 = Math.round(o.x1); o.y1 = Math.round(o.y1);
    o.text = String(wd.text || '').trim(); o.conf = wd.conf; o.vertical = !!r.rot;
    return o;
  }
  /* Scale from OCR'd dimension numbers: find the dimension line beside each number, walk along it to the
     ticks/extension lines on either side, and compare the number (mm) with that span in pixels. */
  function scaleFromDimLines(words, dark, w, h, dbg) {
    var ratios = [], used = [];
    function ink(x, y) { return x >= 0 && y >= 0 && x < w && y < h && dark[y * w + x]; }
    words.forEach(function (wd) {
      if (wd.conf != null && wd.conf < 55) return;
      if (!/^\d{3,6}$/.test(wd.text)) return;
      var v = +wd.text; if (v < 300 || v > 200000) return;
      var vert = wd.vertical;
      // along = direction of the line, across = perpendicular
      var a0 = Math.round(vert ? wd.y0 : wd.x0), a1 = Math.round(vert ? wd.y1 : wd.x1), c0 = Math.round(vert ? wd.x0 : wd.y0), c1 = Math.round(vert ? wd.x1 : wd.y1);
      var th = c1 - c0 + 1, mid = Math.round((a0 + a1) / 2);
      var px = function (al, ac) { return vert ? ink(ac, al) : ink(al, ac); };
      // find a line row/column near the text: long ink run through `mid`
      var best = null;
      for (var d = 1; d <= Math.round(th * 1.6); d++) {
        [c1 + d, c0 - d].forEach(function (ac) {
          if (best) return;
          // the line is often broken under the number: look just beyond both ends of the text
          var l = 0, rr = 0;
          for (var k2 = 3; k2 <= 20; k2++) {
            if (px(a0 - k2, ac) || px(a0 - k2, ac + 1) || px(a0 - k2, ac - 1)) l++;
            if (px(a1 + k2, ac) || px(a1 + k2, ac + 1) || px(a1 + k2, ac - 1)) rr++;
          }
          if (l >= 16 || rr >= 16) best = ac;
        });
        if (best != null) break;
      }
      if (best == null) { if (dbg) dbg.push(wd.text + ' noline'); return; }
      var line = best, lt = line, lb = line;
      // line thickness: grow from the found row while the line continues just beside the text
      var probe = a0 - 6 >= 0 ? a0 - 6 : a1 + 6;
      while (lt - line > -2 && px(probe, lt - 1)) lt--;
      while (lb - line < 2 && px(probe, lb + 1)) lb++;
      function iso(al, ac) { return (px(al, ac) || px(al - 1, ac) || px(al + 1, ac)) && !px(al - 4, ac) && !px(al + 4, ac); }
      function crosses(al) {
        var up = iso(al, lt - 1) || iso(al, lt - 2) || iso(al, lt - 3);
        var dn = iso(al, lb + 1) || iso(al, lb + 2) || iso(al, lb + 3);
        return up && dn;
      }
      function walk(dir) {
        var al = dir < 0 ? a0 - 1 : a1 + 1, gap = 0, last = al, skip = 0;
        while (skip < th * 3 && !(px(al, line) || px(al, line - 1) || px(al, line + 1))) { al += dir; skip++; }
        last = al;
        for (var n = 0; n < 6000; n++, al += dir) {
          var on = px(al, line) || px(al, line - 1) || px(al, line + 1);
          if (!on) { if (++gap > 3) return last; continue; }
          gap = 0; last = al;
          // separator: a tick (short slash) or extension line crosses the line, so there is isolated ink
          // just above and just below it. Text only sits on one side.
          if (crosses(al)) return al;
        }
        return last;
      }
      var e0 = walk(-1), e1 = walk(1), span = e1 - e0;
      if (dbg) dbg.push(wd.text + (vert ? 'V' : 'H') + ' line ' + line + ' span ' + e0 + '..' + e1 + ' = ' + span + ' ratio ' + (v / span).toFixed(2));
      if (span < (a1 - a0) * 1.05 || span < 8) return;
      ratios.push(v / 1000 / span);
      used.push({ text: wd.text, span: span, vertical: vert });
    });
    if (ratios.length < 3) return null;
    var sorted = ratios.slice().sort(function (a, b) { return a - b; });
    // densest cluster within +-4%
    var bestC = null;
    sorted.forEach(function (r0) {
      var inC = sorted.filter(function (r) { return Math.abs(r - r0) / r0 <= 0.04; });
      if (!bestC || inC.length > bestC.length) bestC = inC;
    });
    if (bestC.length < 3 || bestC.length < ratios.length * 0.3) return null;
    var med = bestC[Math.floor(bestC.length / 2)];
    return { mPerPx: med, n: bestC.length, total: ratios.length, used: used.filter(function (u, i) { return Math.abs(ratios[i] - med) / med <= 0.04; }) };
  }

  /* One call for the whole raster analysis. rgba at analysis resolution. Returns masks at full resolution. */
  function analyseRaster(rgba, w, h, progress) {
    var dark = darkMask(rgba, w, h);
    if (progress) progress('walls', 0.2);
    var est = estimateLines(dark, w, h);
    if (!est.gap) est.gap = Math.max(6, Math.round(Math.max(w, h) / 320));
    var rw = rasterWalls(dark, w, h, est);
    if (progress) progress('area', 0.6);
    var fp = footprint(rw.walls, rw.cols, w, h, rw.t);
    return { dark: dark, est: est, walls: rw.walls, cols: rw.cols, t: rw.t, fp: fp };
  }
  /* Masks for the propagation model at roughly `cellM` metres per cell.
     classes: 1 inner wall, 2 outer wall, 3 column. area: floor to cover (footprint minus walls). */
  function modelMasks(walls, cols, fpMask, w, h, t, mPerPx, cellM) {
    var f = Math.max(1, Math.round((cellM || 0.1) / mPerPx));
    var cls = wallClasses(walls, cols, fpMask, w, h, t);
    var W = Math.ceil(w / f), H = Math.ceil(h / f), wg = new Uint8Array(W * H);
    for (var y = 0; y < h; y++) { var oy = ((y / f) | 0) * W, row = y * w; for (var x = 0; x < w; x++) { var c = cls[row + x]; if (c > wg[oy + ((x / f) | 0)]) wg[oy + ((x / f) | 0)] = c; } }
    var free = new Uint8Array(w * h);
    for (var i = 0; i < free.length; i++) free[i] = fpMask[i] && !walls[i] && !cols[i] ? 1 : 0;
    var area = poolFrac(free, w, h, f, 0.5);
    var cnt = 0; for (var k = 0; k < area.data.length; k++) cnt += area.data[k];
    return { f: f, wall: { w: W, h: H, data: wg }, area: { w: area.w, h: area.h, data: area.data }, areaM2: cnt * f * f * mPerPx * mPerPx };
  }
  /* ---------- bill of materials ---------- */
  var SWITCHES = [
    { ports: 8, budget: 120, cost: 11000 },
    { ports: 16, budget: 250, cost: 22000 },
    { ports: 24, budget: 370, cost: 38000 },
    { ports: 48, budget: 740, cost: 70000 }
  ];
  /* Cheapest mix of PoE+ switches with enough ports and PoE budget; ties go to fewer switches. */
  function poeSwitches(ports, watts, list) {
    list = list || SWITCHES;
    if (ports <= 0) return { mix: [], ports: 0, budget: 0, cost: 0 };
    var best = null, maxEach = Math.ceil(ports / 8) + 1;
    function rec(i, counts) {
      if (i === list.length) {
        var p = 0, b = 0, c = 0, n = 0;
        counts.forEach(function (k, j) { p += k * list[j].ports; b += k * list[j].budget; c += k * list[j].cost; n += k; });
        if (p < ports || b < watts) return;
        if (!best || c < best.cost || (c === best.cost && n < best.n) || (c === best.cost && n === best.n && p < best.ports)) best = { counts: counts.slice(), ports: p, budget: b, cost: c, n: n };
        return;
      }
      for (var k = 0; k <= Math.min(maxEach, 12); k++) { counts.push(k); rec(i + 1, counts); counts.pop(); }
    }
    rec(0, []);
    if (!best) return null;
    return { mix: list.map(function (s, j) { return { ports: s.ports, budget: s.budget, count: best.counts[j] }; }).filter(function (x) { return x.count; }), ports: best.ports, budget: best.budget, cost: best.cost, n: best.n };
  }
  function portsNeeded(aps, sparePct) { var spare = Math.ceil(aps * sparePct / 100); return { aps: aps, spare: spare, total: aps + spare }; }

  /* Channel plan: strongest-neighbour APs first, each takes the channel least heard from APs already set. */
  function assignChannels(n, hear, channels, overlap) {
    // hear(i,j) -> dBm of j at i (or -200)
    var order = [], deg = [];
    for (var i = 0; i < n; i++) { var d = 0; for (var j = 0; j < n; j++) if (i !== j && hear(i, j) > -82) d++; deg.push(d); order.push(i); }
    order.sort(function (a, b) { return deg[b] - deg[a]; });
    var ch = new Array(n).fill(0);
    order.forEach(function (i) {
      var best = channels[0], bestCost = Infinity;
      channels.forEach(function (c, ci) {
        var cost = 0;
        for (var j = 0; j < n; j++) if (ch[j] && overlap(c, ch[j])) cost += Math.pow(10, hear(i, j) / 10);
        cost += ci * 1e-12;
        if (cost < bestCost) { bestCost = cost; best = c; }
      });
      ch[i] = best;
    });
    return ch;
  }

  return {
    dilate: dilate, erode: erode, close: close, open: open, components: components, floodOutside: floodOutside,
    darkMask: darkMask, estimateLines: estimateLines, rasterWalls: rasterWalls, footprint: footprint, poolMax: poolMax, poolFrac: poolFrac,
    wallClasses: wallClasses, scaleNotes: scaleNotes, bestNote: bestNote, dimValue: dimValue, scaleFromOverall: scaleFromOverall,
    analyseRaster: analyseRaster, modelMasks: modelMasks, ocrPlan: ocrPlan, ocrImage: ocrImage, grayOf: grayOf, ocrMapWord: ocrMapWord, scaleFromDimLines: scaleFromDimLines, SWITCHES: SWITCHES, poeSwitches: poeSwitches,
    portsNeeded: portsNeeded, assignChannels: assignChannels
  };
}
var WifiAuto = AutoFactory();
if (typeof module !== 'undefined' && module.exports) module.exports = WifiAuto;
