/*!
 * ScanMatch 1.0 - glyph-cloning text replacement for scanned document images.
 * Daftarbox PDF editor. Browser classic script + Node (CommonJS). No dependencies.
 * Fonts used for missing characters are OFL/Apache web fonts loaded lazily (see setFontLoader).
 *
 * =====================================================================================
 * INTEGRATION NOTE (for the editor)
 * =====================================================================================
 * ScanMatch never touches the PDF. It works on the page *image* at scan resolution and
 * returns a small patch image that the editor overlays on the page.
 *
 *  1. Rasterise the scanned page at its native resolution (for an image-only PDF page: draw
 *     the embedded image 1:1, or render with pdf.js at scale = imageWidthPx / pageWidthPt).
 *     Keep that canvas (or its ImageData) as `pageImg`. All coordinates below are pixels of
 *     this image (origin top-left).
 *  2. Run OCR (tesseract.js 5: recognize(img, {}, {blocks:true})) and convert the result:
 *        var symbols = ScanMatch.symbolsFromTesseract(result.data);
 *     (or build [{ch,x0,y0,x1,y1,conf,wordId,lineId}] yourself).
 *  3. Once per page:  var lib = ScanMatch.buildLibrary(pageImg, symbols);
 *     Optional, async, only needed when users type characters that never occur on the page:
 *        await ScanMatch.prepareFallback(lib);       // loads candidate web fonts, picks best
 *  4. When the user edits a run of OCR words (one line), pass those words' symbols:
 *        var r = ScanMatch.replaceSegment(pageImg, wordsOrSymbols, newText, lib,
 *                                         { align: 'left' | 'right' | 'center' });
 *     r.patch is a canvas of r.w x r.h pixels that belongs at (r.x, r.y) on the page image.
 *     - Overlay it as an image at native resolution: in PDF units
 *          xPt = r.x * pageWidthPt / imageWidthPx, yPt(top) = r.y * pageHeightPt / imageHeightPx
 *       (pdf-lib: page.drawImage(png, {x:xPt, y:pageHeightPt - yPt - hPt, width:wPt, height:hPt})).
 *     - For subsequent edits of the same page, first draw the patch onto pageImg (so the next
 *       patch is computed against the edited page) - do not rebuild the library.
 *     - Keep the invisible OCR text layer in sync: replace the old words' text with newText and
 *       use r.report.glyphs (per-character boxes in page pixels) for the new character boxes.
 *     - r.report.usedFallbackChars lists characters that were drawn with a matched font rather
 *       than cloned; r.report.overflow tells you when the new text is wider than opts.maxWidth;
 *       r.report.collision is true when the new text runs into ink outside the segment (e.g. the next
 *       word) - pass the whole line as the segment (or shorten the text) in that case.
 *     - Default opts.preserveUnchanged = true: the unchanged prefix/suffix of the segment keeps its
 *       original pixels (shifted sub-pixel if the width changes); only changed characters are cloned.
 *       Pass the words in OCR reading order (the same objects/ids that went into buildLibrary, so
 *       the segment is matched to its style cluster by wordId).
 *  5. ScanMatch is synchronous except prepareFallback/loadFonts. A typical 20-char edit takes
 *     well under 250 ms; buildLibrary on a 200 dpi A4 page < 2 s (run it off the input path).
 *     prepareFallback costs about 1-1.5 s of CPU per style cluster after the fonts are loaded; call
 *     it in the background after buildLibrary, or only for the cluster being edited:
 *        ScanMatch.prepareFallback(lib, { clusters: [analyzeSegment(...).cluster] }).
 *     If a missing character is typed before that, replaceSegment matches the cluster
 *     synchronously with whatever fonts are already registered (generic sans-serif if none).
 *  6. OCR symbol boxes are repaired against the ink (tesseract's LSTM symbol boxes are often
 *     shifted); word boxes and the text must be right. Classes seen only as merged/touching ink,
 *     or (after prepareFallback) rare classes that disagree with the matched font (OCR
 *     mislabels), are drawn with the matched font instead of being cloned.
 *
 *  Environment hooks:
 *    ScanMatch.setCanvasFactory((w,h) => canvas)   // Node: require('@napi-rs/canvas').createCanvas
 *    ScanMatch.setFontLoader(spec => Promise<cssFamily|null>)   // control web-font loading
 *    ScanMatch.registerFont(spec, cssFamily)       // tell ScanMatch about an already loaded font
 *  Default browser font loader: FontFace from
 *    https://cdn.jsdelivr.net/fontsource/fonts/<id>@latest/latin-<weight>-<style>.woff2
 *
 * Coordinates: pixel index space (pixel (i,j) is sampled at x=i, y=j). OCR boxes are taken as
 * [x0,x1) x [y0,y1) and only need to be approximately right - glyph ink is re-measured.
 * =====================================================================================
 */
(function (root) {
  'use strict';

  var VERSION = '1.0.0';

  // ------------------------------------------------------------------------------------
  // Environment
  // ------------------------------------------------------------------------------------
  var _canvasFactory = null;
  var _fontLoader = null;
  var _fonts = {};          // key -> {spec, family, capRatio, xRatio}
  var FLAGS = { repair: true, variants: true, speck: true, maskNet: true, touchClip: true };   // internal switches (diagnostics)

  function createCanvas(w, h) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    if (_canvasFactory) return _canvasFactory(w, h);
    if (typeof document !== 'undefined' && document.createElement) {
      var c = document.createElement('canvas'); c.width = w; c.height = h; return c;
    }
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    if (typeof require === 'function') {
      var mods = ['@napi-rs/canvas', 'canvas'];
      for (var i = 0; i < mods.length; i++) {
        try { var m = require(mods[i]); if (m && m.createCanvas) { _canvasFactory = m.createCanvas; return m.createCanvas(w, h); } } catch (e) { /* next */ }
      }
    }
    throw new Error('ScanMatch: no canvas implementation available; call ScanMatch.setCanvasFactory(fn)');
  }

  function ctx2d(c) { return c.getContext('2d', { willReadFrequently: true }) || c.getContext('2d'); }

  // ------------------------------------------------------------------------------------
  // Small utilities
  // ------------------------------------------------------------------------------------
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function median(arr) {
    var n = arr.length; if (!n) return NaN;
    var a = Float64Array.from(arr).sort();
    return n % 2 ? a[(n - 1) >> 1] : 0.5 * (a[n / 2 - 1] + a[n / 2]);
  }
  function percentile(arr, p) {
    var n = arr.length; if (!n) return NaN;
    var a = Float64Array.from(arr).sort();
    var k = clamp(p * (n - 1), 0, n - 1), i = Math.floor(k), f = k - i;
    return i + 1 < n ? a[i] * (1 - f) + a[i + 1] * f : a[i];
  }
  function iqMean(arr) {   // interquartile mean (continuous, robust)
    var n = arr.length; if (!n) return NaN; if (n < 4) return median(arr);
    var a = Float64Array.from(arr).sort(), i0 = Math.floor(n * 0.25), i1 = Math.ceil(n * 0.75), s = 0;
    for (var i = i0; i < i1; i++) s += a[i]; return s / (i1 - i0);
  }
  function mean(arr) { var s = 0; for (var i = 0; i < arr.length; i++) s += arr[i]; return arr.length ? s / arr.length : NaN; }
  function rng(seed) {
    var a = (seed >>> 0) || 0x9e3779b9;
    return function () {
      a = (a + 0x6D2B79F5) | 0; var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gaussRand(r) {
    var u = 0, v = 0; while (u === 0) u = r(); v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function erf(x) {
    var s = x < 0 ? -1 : 1; x = Math.abs(x);
    var t = 1 / (1 + 0.3275911 * x);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }
  function Phi(x) { return 0.5 * (1 + erf(x / Math.SQRT2)); }
  var PHI_T = new Float32Array(12001); for (var _i = 0; _i <= 12000; _i++) PHI_T[_i] = Phi((_i - 6000) / 1000);
  function PhiT(x) { if (x <= -6) return 0; if (x >= 6) return 1; var f = (x + 6) * 1000, i = f | 0, t = f - i; return PHI_T[i] * (1 - t) + PHI_T[i + 1] * t; }
  function now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }
  function hex2(v) { v = clamp(Math.round(v), 0, 255); return (v < 16 ? '0' : '') + v.toString(16); }
  function rgbCss(c) { return '#' + hex2(c[0]) + hex2(c[1]) + hex2(c[2]); }
  function chars(str) { return Array.from ? Array.from(String(str)) : String(str).split(''); }
  function isSpace(ch) { return /\s/.test(ch); }

  var FLAT_BASE = 'ABDEFHIKLMNPRTVWXYZbdfhiklmnrtuvwxz12457';
  var DESC_CH = 'gjpqyQ,;()[]{}|@$_';
  var NOT_BASE = '-~*"\'^`=+°:•·';
  var FLAT_CAP = 'BDEFHIKLMNPRTXZ157';
  var CAP_CH = 'ABCDEFGHIJKLMNOPRSTUVWXYZ0123456789';
  var X_FLAT = 'uvwxz';
  var X_CH = 'acemnorsuvwxz';
  function isBaseChar(ch) { return /[A-Za-z0-9.]/.test(ch) && DESC_CH.indexOf(ch) < 0 && NOT_BASE.indexOf(ch) < 0; }

  // ------------------------------------------------------------------------------------
  // Image access
  // ------------------------------------------------------------------------------------
  function imgSize(img) {
    return { w: img.width || img.naturalWidth || img.videoWidth || 0, h: img.height || img.naturalHeight || img.videoHeight || 0 };
  }
  var _drawCache = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;
  function asCanvas(img) {
    if (img.getContext) return img;
    if (_drawCache && _drawCache.has(img)) return _drawCache.get(img);
    var s = imgSize(img), c = createCanvas(s.w, s.h);
    ctx2d(c).drawImage(img, 0, 0);
    if (_drawCache) _drawCache.set(img, c);
    return c;
  }
  /** Read an RGBA block (clipped to the image). Returns {data, x, y, w, h}. */
  function getRGBA(img, x, y, w, h) {
    var S = imgSize(img);
    var x0 = clamp(Math.floor(x), 0, S.w), y0 = clamp(Math.floor(y), 0, S.h);
    var x1 = clamp(Math.ceil(x + w), 0, S.w), y1 = clamp(Math.ceil(y + h), 0, S.h);
    var rw = Math.max(0, x1 - x0), rh = Math.max(0, y1 - y0), out;
    if (img.data && !img.getContext) {
      out = new Uint8ClampedArray(rw * rh * 4);
      for (var j = 0; j < rh; j++) out.set(img.data.subarray(((y0 + j) * S.w + x0) * 4, ((y0 + j) * S.w + x0 + rw) * 4), j * rw * 4);
    } else {
      out = rw && rh ? ctx2d(asCanvas(img)).getImageData(x0, y0, rw, rh).data : new Uint8ClampedArray(0);
    }
    return { data: out, x: x0, y: y0, w: rw, h: rh };
  }
  function rgbaToCanvas(data, w, h) {
    var c = createCanvas(w, h), g = ctx2d(c), id = g.createImageData(w, h);
    id.data.set(data); g.putImageData(id, 0, 0); return c;
  }
  function grayOf(d, n) {
    var g = new Float32Array(n);
    for (var i = 0, k = 0; i < n; i++, k += 4) g[i] = 0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2];
    return g;
  }

  // ------------------------------------------------------------------------------------
  // Paper estimation (cell grid, bilinear)
  // ------------------------------------------------------------------------------------
  function paperGrid(gray, w, h, cell, skip) {
    var nx = Math.max(1, Math.ceil(w / cell)), ny = Math.max(1, Math.ceil(h / cell));
    var v = new Float32Array(nx * ny), hist = new Int32Array(256), hist2 = new Int32Array(256);
    var minN = cell * cell * 0.12;
    for (var cy = 0; cy < ny; cy++) for (var cx = 0; cx < nx; cx++) {
      hist.fill(0); var n = 0;
      var xa = cx * cell, xb = Math.min(w, xa + cell), ya = cy * cell, yb = Math.min(h, ya + cell);
      for (var y = ya; y < yb; y++) for (var x = xa, i = y * w + xa; x < xb; x++, i++) {
        if (skip && skip[i]) continue;
        var gv = gray[i]; hist[gv < 0 ? 0 : (gv > 255 ? 255 : gv | 0)]++; n++;
      }
      if (n < minN) { v[cy * nx + cx] = NaN; continue; }
      var tgt = 0.85 * n, acc = 0, b = 0; for (; b < 256; b++) { acc += hist[b]; if (acc >= tgt) break; }
      var thr = b - Math.max(10, 0.12 * b), m = 0; hist2.fill(0);
      for (var k = Math.max(0, Math.ceil(thr)); k < 256; k++) { hist2[k] = hist[k]; m += hist[k]; }
      acc = 0; var b2 = 0; for (; b2 < 256; b2++) { acc += hist2[b2]; if (acc >= m / 2) break; }
      v[cy * nx + cx] = b2 + 0.5;
    }
    fillNaNGrid(v, nx, ny, 200);
    if (nx >= 3 && ny >= 3) v = medianGrid(v, nx, ny);
    return { cell: cell, nx: nx, ny: ny, v: v, w: w, h: h, ox: 0, oy: 0 };
  }
  function fillNaNGrid(v, nx, ny, def) {
    var any = false, ok = false, i;
    for (i = 0; i < v.length; i++) { if (isNaN(v[i])) any = true; else ok = true; }
    if (!any) return;
    if (!ok) { v.fill(def); return; }
    for (var it = 0; it < nx + ny && any; it++) {
      any = false; var c = Float32Array.from(v);
      for (var y = 0; y < ny; y++) for (var x = 0; x < nx; x++) {
        i = y * nx + x; if (!isNaN(c[i])) continue;
        var s = 0, k = 0;
        if (x > 0 && !isNaN(c[i - 1])) { s += c[i - 1]; k++; }
        if (x < nx - 1 && !isNaN(c[i + 1])) { s += c[i + 1]; k++; }
        if (y > 0 && !isNaN(c[i - nx])) { s += c[i - nx]; k++; }
        if (y < ny - 1 && !isNaN(c[i + nx])) { s += c[i + nx]; k++; }
        if (k) v[i] = s / k; else any = true;
      }
    }
  }
  function medianGrid(v, nx, ny) {
    var o = new Float32Array(v.length), t = [];
    for (var y = 0; y < ny; y++) for (var x = 0; x < nx; x++) {
      t.length = 0;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        var xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= nx || yy >= ny) continue; t.push(v[yy * nx + xx]);
      }
      o[y * nx + x] = median(t);
    }
    return o;
  }
  function gridSample(G, x, y) {
    var fx = (x - G.ox + 0.5) / G.cell - 0.5, fy = (y - G.oy + 0.5) / G.cell - 0.5;
    var ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    var x0 = clamp(ix, 0, G.nx - 1), x1 = clamp(ix + 1, 0, G.nx - 1), y0 = clamp(iy, 0, G.ny - 1), y1 = clamp(iy + 1, 0, G.ny - 1);
    var v = G.v, nx = G.nx;
    return (v[y0 * nx + x0] * (1 - tx) + v[y0 * nx + x1] * tx) * (1 - ty) + (v[y1 * nx + x0] * (1 - tx) + v[y1 * nx + x1] * tx) * ty;
  }
  function gridFill(G, ox, oy, w, h) {
    var out = new Float32Array(w * h);
    for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) out[j * w + i] = gridSample(G, ox + i, oy + j);
    return out;
  }

  // ------------------------------------------------------------------------------------
  // Morphology, connected components, ruling lines
  // ------------------------------------------------------------------------------------
  function dilate(m, w, h, r) {
    if (r <= 0) return Uint8Array.from(m);
    var t = new Uint8Array(w * h), o = new Uint8Array(w * h), x, y;
    for (y = 0; y < h; y++) {           // horizontal pass (running count)
      var row = y * w, cnt = 0;
      for (x = 0; x < Math.min(r, w); x++) cnt += m[row + x] ? 1 : 0;
      for (x = 0; x < w; x++) {
        if (x + r < w && m[row + x + r]) cnt++;
        if (x - r - 1 >= 0 && m[row + x - r - 1]) cnt--;
        t[row + x] = cnt > 0 ? 1 : 0;
      }
    }
    for (x = 0; x < w; x++) {
      var c2 = 0;
      for (y = 0; y < Math.min(r, h); y++) c2 += t[y * w + x];
      for (y = 0; y < h; y++) {
        if (y + r < h && t[(y + r) * w + x]) c2++;
        if (y - r - 1 >= 0 && t[(y - r - 1) * w + x]) c2--;
        o[y * w + x] = c2 > 0 ? 1 : 0;
      }
    }
    return o;
  }
  function cc8(bin, w, h) {
    var n = w * h, lab = new Int32Array(n), stack = new Int32Array(n), comps = [], id = 0;
    for (var i = 0; i < n; i++) {
      if (!bin[i] || lab[i]) continue;
      id++; var sp = 0; stack[sp++] = i; lab[i] = id;
      var area = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
      while (sp) {
        var p = stack[--sp], px = p % w, py = (p - px) / w; area++;
        if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
        for (var dy = -1; dy <= 1; dy++) {
          var yy = py + dy; if (yy < 0 || yy >= h) continue;
          for (var dx = -1; dx <= 1; dx++) {
            var xx = px + dx; if (xx < 0 || xx >= w) continue;
            var q = yy * w + xx; if (bin[q] && !lab[q]) { lab[q] = id; stack[sp++] = q; }
          }
        }
      }
      comps.push({ id: id, area: area, x0: x0, y0: y0, x1: x1, y1: y1 });
    }
    return { lab: lab, comps: comps };
  }
  /** Long dark runs -> ruling lines. Returns Uint8Array: bit1 horizontal, bit2 vertical. */
  function detectLines(dark, w, h, Lh, Lv) {
    var out = new Uint8Array(w * h), x, y, k, gap, end, start;
    for (y = 0; y < h; y++) {
      var row = y * w; x = 0;
      while (x < w) {
        if (!dark[row + x]) { x++; continue; }
        start = x; end = x; gap = 0;
        for (k = x + 1; k < w; k++) { if (dark[row + k]) { end = k; gap = 0; } else if (++gap > 1) break; }
        if (end - start + 1 >= Lh) for (k = start; k <= end; k++) out[row + k] |= 1;
        x = end + 1;
      }
    }
    for (x = 0; x < w; x++) {
      y = 0;
      while (y < h) {
        if (!dark[y * w + x]) { y++; continue; }
        start = y; end = y; gap = 0;
        for (k = y + 1; k < h; k++) { if (dark[k * w + x]) { end = k; gap = 0; } else if (++gap > 1) break; }
        if (end - start + 1 >= Lv) for (k = start; k <= end; k++) out[k * w + x] |= 2;
        y = end + 1;
      }
    }
    return out;
  }
  function lineBandOf(lines, w, h, r) {
    var hb = new Uint8Array(w * h), vb = new Uint8Array(w * h);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var v = lines[y * w + x]; if (!v) continue;
      if (v & 1) for (var dy = -r; dy <= r; dy++) { var yy = y + dy; if (yy >= 0 && yy < h) hb[yy * w + x] = 1; }
      if (v & 2) for (var dx = -r; dx <= r; dx++) { var xx = x + dx; if (xx >= 0 && xx < w) vb[y * w + xx] = 1; }
    }
    return { h: hb, v: vb };
  }

  // ------------------------------------------------------------------------------------
  // Resampling (separable Keys cubic), blur, EDT
  // ------------------------------------------------------------------------------------
  function cubicW(t) {          // Lanczos-3 (name kept): flat passband, so sub-pixel shifts do not blur glyphs
    t = Math.abs(t);
    if (t < 1e-6) return 1;
    if (t >= 3) return 0;
    var pt = Math.PI * t;
    return 3 * Math.sin(pt) * Math.sin(pt / 3) / (pt * pt);
  }
  /** dest(u,v) = src(ax*u + bx, ay*v + by), zero outside, cubic, clamped to [0,1]. */
  function resampleSep(src, sw, sh, W, H, ax, bx, ay, by) {
    var tmp = new Float32Array(W * sh), out = new Float32Array(W * H), u, v, k, y;
    var hsx = ax > 1 ? ax : 1, hsy = ay > 1 ? ay : 1;   // widen kernel when minifying
    for (u = 0; u < W; u++) {
      var x = ax * u + bx, ix = Math.floor(x), f = x - ix, r = Math.ceil(3 * hsx);
      var ws = [], xs = [], wsum = 0;
      for (k = -r + 1; k <= r; k++) { var xx = ix + k; var wv = cubicW((xx - x) / hsx); if (wv === 0) continue; wsum += wv; if (xx < 0 || xx >= sw) continue; ws.push(wv); xs.push(xx); }
      if (!ws.length) continue;
      for (k = 0; k < ws.length; k++) ws[k] /= wsum;
      for (y = 0; y < sh; y++) {
        var s = 0, row = y * sw; for (k = 0; k < ws.length; k++) s += src[row + xs[k]] * ws[k];
        tmp[y * W + u] = s;
      }
    }
    for (v = 0; v < H; v++) {
      var yy0 = ay * v + by, iy = Math.floor(yy0), r2 = Math.ceil(3 * hsy);
      var wy = [], ys = [], ws2 = 0;
      for (k = -r2 + 1; k <= r2; k++) { var yv = iy + k; var w2 = cubicW((yv - yy0) / hsy); if (w2 === 0) continue; ws2 += w2; if (yv < 0 || yv >= sh) continue; wy.push(w2); ys.push(yv); }
      if (!wy.length) continue;
      for (k = 0; k < wy.length; k++) wy[k] /= ws2;
      for (u = 0; u < W; u++) {
        var s2 = 0; for (k = 0; k < wy.length; k++) s2 += tmp[ys[k] * W + u] * wy[k];
        out[v * W + u] = s2 < 0 ? 0 : (s2 > 1 ? 1 : s2);
      }
    }
    return out;
  }
  function gaussKernel(sigma) {
    var r = Math.max(1, Math.ceil(3 * sigma)), k = new Float32Array(2 * r + 1), s = 0;
    for (var i = -r; i <= r; i++) { k[i + r] = Math.exp(-i * i / (2 * sigma * sigma)); s += k[i + r]; }
    for (i = 0; i < k.length; i++) k[i] /= s;
    return k;
  }
  function gaussBlur(A, w, h, sigma) {
    if (!(sigma > 0.05)) return Float32Array.from(A);
    var k = gaussKernel(sigma), r = (k.length - 1) >> 1, t = new Float32Array(w * h), o = new Float32Array(w * h), x, y, i;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      var s = 0; for (i = -r; i <= r; i++) { var xx = x + i; if (xx >= 0 && xx < w) s += A[y * w + xx] * k[i + r]; }
      t[y * w + x] = s;
    }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      var s2 = 0; for (i = -r; i <= r; i++) { var yy = y + i; if (yy >= 0 && yy < h) s2 += t[yy * w + x] * k[i + r]; }
      o[y * w + x] = s2;
    }
    return o;
  }
  var EDT_INF = 1e20;
  function edt1d(f, n, d, v, z) {
    var k = 0, q, s; v[0] = 0; z[0] = -EDT_INF; z[1] = EDT_INF;
    for (q = 1; q < n; q++) {
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = EDT_INF;
    }
    k = 0;
    for (q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
  }
  /** Squared Euclidean distance from every pixel to the nearest pixel with on[i]==1. */
  function edt2(on, W, H) {
    var g = new Float64Array(W * H), n = Math.max(W, H), f = new Float64Array(n), d = new Float64Array(n),
      v = new Int32Array(n), z = new Float64Array(n + 1), x, y;
    for (var i = 0; i < W * H; i++) g[i] = on[i] ? 0 : EDT_INF;
    for (x = 0; x < W; x++) {
      for (y = 0; y < H; y++) f[y] = g[y * W + x];
      edt1d(f, H, d, v, z);
      for (y = 0; y < H; y++) g[y * W + x] = d[y];
    }
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) f[x] = g[y * W + x];
      edt1d(f, W, d, v, z);
      for (x = 0; x < W; x++) g[y * W + x] = d[x];
    }
    return g;
  }
  function upsampleBilinear(A, w, h, S) {
    var W = w * S, H = h * S, o = new Float32Array(W * H);
    for (var Y = 0; Y < H; Y++) {
      var fy = (Y + 0.5) / S - 0.5, iy = Math.floor(fy), ty = fy - iy, y0 = clamp(iy, 0, h - 1), y1 = clamp(iy + 1, 0, h - 1);
      for (var X = 0; X < W; X++) {
        var fx = (X + 0.5) / S - 0.5, ix = Math.floor(fx), tx = fx - ix, x0 = clamp(ix, 0, w - 1), x1 = clamp(ix + 1, 0, w - 1);
        o[Y * W + X] = (A[y0 * w + x0] * (1 - tx) + A[y0 * w + x1] * tx) * (1 - ty) + (A[y1 * w + x0] * (1 - tx) + A[y1 * w + x1] * tx) * ty;
      }
    }
    return o;
  }
  /**
   * Stroke width samples (px) from the distance transform of the ink: alpha is upsampled 4x,
   * thresholded at 0.5, EDT'd, and ridge (local-maximum) distances are converted to widths.
   */
  function inkCrop(A, w, h, thr, pad) {   // crop to the bbox of values > thr (+pad); returns null when empty
    var x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) if (A[y * w + x] > thr) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return null;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
    var cw = x1 - x0 + 1, ch = y1 - y0 + 1, o = new Float32Array(cw * ch);
    for (var j = 0; j < ch; j++) for (var i = 0; i < cw; i++) o[j * cw + i] = A[(j + y0) * w + i + x0];
    return { a: o, w: cw, h: ch, x0: x0, y0: y0 };
  }
  function strokeSamples(A0, w0, h0, out) {
    var C0 = inkCrop(A0, w0, h0, 0.3, 2); if (!C0) return out;
    var A = C0.a, w = C0.w, h = C0.h;
    var S = 4, W = w * S, H = h * S, up = upsampleBilinear(A, w, h, S), bg = new Uint8Array(W * H), any = false;
    for (var i = 0; i < W * H; i++) { if (up[i] < 0.5) bg[i] = 1; else any = true; }
    if (!any) return out;
    var d2 = edt2(bg, W, H);
    for (var y = 1; y < H - 1; y++) for (var x = 1; x < W - 1; x++) {
      var p = y * W + x; if (bg[p]) continue;
      var dv = d2[p]; if (dv < 1) continue;
      if (dv >= d2[p - 1] && dv >= d2[p + 1] && dv >= d2[p - W] && dv >= d2[p + W] &&
        dv >= d2[p - W - 1] && dv >= d2[p - W + 1] && dv >= d2[p + W - 1] && dv >= d2[p + W + 1]) {
        out.push((2 * Math.sqrt(dv) - 0.5) / S);
      }
    }
    return out;
  }
  function fitErf(xs, vs, rising) {
    var n = xs.length, c0 = xs[0];
    for (var i = 1; i < n; i++) {
      var a0 = vs[i - 1], a1 = vs[i];
      if ((a0 - 0.5) * (a1 - 0.5) <= 0 && a0 !== a1) { c0 = xs[i - 1] + (0.5 - a0) / (a1 - a0) * (xs[i] - xs[i - 1]); break; }
    }
    var best = 1e9, bs = 1, bc = c0;
    function sse(s, c) {
      var e = 0;
      for (var j = 0; j < n; j++) { var m = PhiT((xs[j] - c) / s); if (!rising) m = 1 - m; var r = m - vs[j]; e += r * r; }
      return e;
    }
    for (var s = 0.3; s <= 3.0001; s += 0.1) for (var dc = -0.3; dc <= 0.3001; dc += 0.1) { var e = sse(s, c0 + dc); if (e < best) { best = e; bs = s; bc = c0 + dc; } }
    var s0 = bs, cc0 = bc;
    for (var s2 = Math.max(0.25, s0 - 0.1); s2 <= s0 + 0.1001; s2 += 0.01) for (var d2 = -0.06; d2 <= 0.0601; d2 += 0.03) { var e2 = sse(s2, cc0 + d2); if (e2 < best) { best = e2; bs = s2; bc = cc0 + d2; } }
    return bs;
  }
  /**
   * Gaussian blur sigma samples (px). Each stroke cross-section (row or column run of ink between
   * paper on both sides) is fitted with a blurred box: a(x) = Phi((x-a)/s) - Phi((x-b)/s), i.e. two
   * erf edges. Only sections crossing near-perpendicular edges are used (diagonals would inflate s).
   * Pixel integration (1/12 px^2) is removed from the fitted s.
   */
  function edgeSamples(A, w, h, out, maxN) {
    maxN = maxN || 1e9;
    var xs = [], vs = [];
    function fitBox(n, peak) {
      var cm = 0, mm = 0, j; for (j = 0; j < n; j++) { cm += xs[j] * vs[j]; mm += vs[j]; }
      var c = cm / mm, best = 1e9, bs = 0, bw = 0, bc = c;
      function sse(s, wd, cc) {
        var a = cc - wd / 2, b = cc + wd / 2, e = 0;
        for (var k = 0; k < n; k++) {      // pixel-integrated blurred box (4 sub-samples)
          var m = 0; for (var q = -0.375; q < 0.5; q += 0.25) { var t = xs[k] + q; m += PhiT((t - a) / s) - PhiT((t - b) / s); }
          var r = 0.25 * m - vs[k]; e += r * r;
        }
        return e;
      }
      var w0 = Math.max(0.6, mm);   // area under profile ~ stroke width
      for (var s = 0.15; s <= 2.6; s += 0.15) for (var wd = Math.max(0.4, w0 - 1.2); wd <= w0 + 1.2; wd += 0.3) { var e = sse(s, wd, c); if (e < best) { best = e; bs = s; bw = wd; } }
      var s0 = bs, w1 = bw;
      for (var s2 = Math.max(0.08, s0 - 0.15); s2 <= s0 + 0.1501; s2 += 0.03) for (var w2 = Math.max(0.3, w1 - 0.3); w2 <= w1 + 0.3001; w2 += 0.1) for (var dc = -0.1; dc <= 0.1001; dc += 0.1) {
        var e2 = sse(s2, w2, c + dc); if (e2 < best) { best = e2; bs = s2; bw = w2; bc = c + dc; }
      }
      return { s: bs, w: bw, err: best / n };
    }
    function scan(len, count, at, perp) {
      for (var line = 0; line < count; line++) {
        var x = 0;
        while (x < len) {
          if (at(line, x) <= 0.12) { x++; continue; }
          var st = x; while (x < len && at(line, x) > 0.12) x++;
          var en = x - 1;                       // run [st, en], paper at st-1 and en+1
          if (st === 0 || en >= len - 1 || en - st > 12) continue;
          var peak = 0, pi = st, k;
          for (k = st; k <= en; k++) if (at(line, k) > peak) { peak = at(line, k); pi = k; }
          if (peak < 0.75) continue;
          var ok = true;                         // single peak (allow a flat top)
          for (k = st + 1; k <= pi && ok; k++) if (at(line, k) < at(line, k - 1) - 0.1) ok = false;
          for (k = pi + 1; k <= en && ok; k++) if (at(line, k) > at(line, k - 1) + 0.1) ok = false;
          if (!ok) continue;
          // edge direction check at both 0.5 crossings: across-gradient must dominate along-gradient
          var good = true;
          for (k = st; k <= en + 1 && good; k++) {
            var a0 = at(line, k - 1), a1 = at(line, k);
            if ((a0 - 0.5) * (a1 - 0.5) < 0 || (a1 === 0.5)) {
              var kk = Math.abs(a1 - a0) > 0 ? k : k;
              var g = perp(line, kk), gx = Math.abs(a1 - a0);
              if (!(g >= 0) || g > 0.35 * gx) good = false;
            }
          }
          if (!good) continue;
          xs.length = 0; vs.length = 0;
          for (k = st - 1; k <= en + 1; k++) { xs.push(k); vs.push(at(line, k)); }
          var F = fitBox(xs.length, peak);
          if (F.err > 0.004 || F.w < 0.8) continue;
          out.push(F.s);
          if (out.length >= maxN) return;
        }
      }
    }
    // perpendicular gradient: central difference along the other axis at the crossing pixel
    scan(w, h, function (y, x) { return x < 0 || x >= w ? 0 : A[y * w + x]; }, function (y, x) {
      if (y <= 0 || y >= h - 1) return -1; return 0.5 * Math.abs(A[(y + 1) * w + x] - A[(y - 1) * w + x]);
    });
    if (out.length < maxN) scan(h, w, function (x, y) { return y < 0 || y >= h ? 0 : A[y * w + x]; }, function (x, y) {
      if (x <= 0 || x >= w - 1) return -1; return 0.5 * Math.abs(A[y * w + x + 1] - A[y * w + x - 1]);
    });
    return out;
  }  function edgesOf(A, w, h) {
    var mx = 0, i; for (i = 0; i < A.length; i++) if (A[i] > mx) mx = A[i];
    var th = Math.min(0.5, 0.5 * mx), l = Infinity, r = -Infinity, t = Infinity, b = -Infinity, x, y, p;
    if (mx <= 0) return null;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) { p = y * w + x; if (A[p] >= th) { var lp = x > 0 ? (x - 1) + (th - A[p - 1]) / (A[p] - A[p - 1]) : x; if (lp < l) l = lp; break; } }
      for (x = w - 1; x >= 0; x--) { p = y * w + x; if (A[p] >= th) { var rp = x < w - 1 ? x + (A[p] - th) / (A[p] - A[p + 1]) : x; if (rp > r) r = rp; break; } }
    }
    for (x = 0; x < w; x++) {
      for (y = 0; y < h; y++) { p = y * w + x; if (A[p] >= th) { var tp = y > 0 ? (y - 1) + (th - A[p - w]) / (A[p] - A[p - w]) : y; if (tp < t) t = tp; break; } }
      for (y = h - 1; y >= 0; y--) { p = y * w + x; if (A[p] >= th) { var bp = y < h - 1 ? y + (A[p] - th) / (A[p] - A[p + w]) : y; if (bp > b) b = bp; break; } }
    }
    return { l: l, r: r, t: t, b: b, max: mx };
  }
  function ncc(a, b) {
    var n = a.length, ma = 0, mb = 0, i; for (i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
    var sab = 0, saa = 0, sbb = 0; for (i = 0; i < n; i++) { var x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
    return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
  }

  // ------------------------------------------------------------------------------------
  // Surfaces: gray + paper model + ruling lines over a page or a region
  // ------------------------------------------------------------------------------------
  function makeSurface(px, grid, inkRatio, opts) {
    opts = opts || {};
    var n = px.w * px.h, S = { ox: px.x, oy: px.y, w: px.w, h: px.h, rgba: px.data, gray: grayOf(px.data, n) };
    S.grid = grid || paperGrid(S.gray, S.w, S.h, opts.cell || 32);
    if (!grid) { S.grid.ox = S.ox; S.grid.oy = S.oy; }
    S.inkRatio = inkRatio;
    return S;
  }
  function surfPaperArray(S) {
    if (!S._P) S._P = gridFill(S.grid, S.ox, S.oy, S.w, S.h);
    return S._P;
  }
  function surfAlphaAll(S) {
    if (S._A) return S._A;
    var P = surfPaperArray(S), n = S.w * S.h, A = new Float32Array(n), k = 1 - S.inkRatio;
    for (var i = 0; i < n; i++) { var a = (P[i] - S.gray[i]) / (P[i] * k); A[i] = a < 0 ? 0 : (a > 1 ? 1 : a); }
    S._A = A; return A;
  }
  function surfLines(S, Lh, Lv) {
    var A = surfAlphaAll(S), n = S.w * S.h, dark = new Uint8Array(n);
    for (var i = 0; i < n; i++) dark[i] = A[i] > 0.45 ? 1 : 0;
    S.lines = detectLines(dark, S.w, S.h, Lh, Lv);
    var band = new Uint8Array(n), b = lineBandOf(S.lines, S.w, S.h, 1);
    for (i = 0; i < n; i++) band[i] = b.h[i] | b.v[i];
    S.lineBand = band;
    return S.lines;
  }
  // alpha crop in surface coordinates; page surfaces compute lazily (no full-page alpha array)
  function surfAlpha(S, x0, y0, w, h, zeroLines) {
    var A = new Float32Array(w * h), k = 1 - S.inkRatio, full = S._A;
    for (var j = 0; j < h; j++) {
      var y = y0 + j;
      for (var i = 0; i < w; i++) {
        var x = x0 + i, p = y * S.w + x, a;
        if (full) a = full[p];
        else { var P = gridSample(S.grid, x + S.ox, y + S.oy); a = (P - S.gray[p]) / (P * k); a = a < 0 ? 0 : (a > 1 ? 1 : a); }
        if (zeroLines && S.lineBand && S.lineBand[p]) a = 0;
        A[j * w + i] = a;
      }
    }
    return A;
  }

  // ------------------------------------------------------------------------------------
  // Symbol refinement: OCR box -> measured glyph (components, sub-pixel edges, centroid)
  // ------------------------------------------------------------------------------------
  function refineSymbol(S, s, e) {
    e = e || 3;
    var bx0 = Math.max(0, Math.floor(s.x0 - S.ox) - e), by0 = Math.max(0, Math.floor(s.y0 - S.oy) - e);
    var bx1 = Math.min(S.w, Math.ceil(s.x1 - S.ox) + e), by1 = Math.min(S.h, Math.ceil(s.y1 - S.oy) + e);
    var cw = bx1 - bx0, chh = by1 - by0; if (cw < 2 || chh < 2) return null;
    var A = surfAlpha(S, bx0, by0, cw, chh, true), n = cw * chh, i;
    var bin = new Uint8Array(n); for (i = 0; i < n; i++) bin[i] = A[i] > 0.4 ? 1 : 0;
    var L = cc8(bin, cw, chh);
    if (!L.comps.length) return null;
    var ox0 = s.x0 - S.ox - bx0 - 1, ox1 = s.x1 - S.ox - bx0 + 1, oy0 = s.y0 - S.oy - by0 - 1, oy1 = s.y1 - S.oy - by0 + 1;
    var inside = new Int32Array(L.comps.length + 1);
    for (var y = 0; y < chh; y++) for (var x = 0; x < cw; x++) {
      var id = L.lab[y * cw + x]; if (id && x >= ox0 && x < ox1 && y >= oy0 && y < oy1) inside[id]++;
    }
    var keep = new Uint8Array(L.comps.length + 1), nk = 0, touch = false, best = -1, bestIn = 0;
    L.comps.forEach(function (c) {
      if (inside[c.id] >= 0.5 * c.area) {
        keep[c.id] = 1; nk++;
        if (c.x0 === 0 || c.y0 === 0 || c.x1 === cw - 1 || c.y1 === chh - 1) touch = true;
      }
      if (inside[c.id] > bestIn) { bestIn = inside[c.id]; best = c.id; }
    });
    var clip = false;
    if (!nk) {
      L.comps.forEach(function (c) { if (inside[c.id] >= 0.25 * c.area) { keep[c.id] = 1; nk++; } });
      if (!nk) { if (best < 0) return null; keep[best] = 1; nk = 1; }
      clip = true;
    }
    // drop specks (salt noise) that happen to fall inside the box: tiny relative to the main component
    var maxA = 0; L.comps.forEach(function (c) { if (keep[c.id] && c.area > maxA) maxA = c.area; });
    L.comps.forEach(function (c) { if (FLAGS.speck && keep[c.id] && c.area < Math.max(2, 0.06 * maxA) && nk > 1) { keep[c.id] = 0; nk--; } });
    var m = new Uint8Array(n); for (i = 0; i < n; i++) m[i] = keep[L.lab[i]];
    if (touch || clip) {   // component shared with a neighbour (kerning / touching print): keep own OCR columns only
      var cx0 = Math.max(0, Math.floor(ox0)), cx1 = Math.min(cw, Math.ceil(ox1));
      for (var yy = 0; yy < chh; yy++) for (var xx = 0; xx < cw; xx++) if (xx < cx0 || xx >= cx1) m[yy * cw + xx] = 0;
      touch = true;
    }
    var other = new Uint8Array(n); for (i = 0; i < n; i++) other[i] = bin[i] && !m[i] ? 1 : 0;
    var sm = dilate(m, cw, chh, 3), od = dilate(other, cw, chh, 1), mass = 0, sx = 0, sy = 0;
    for (i = 0; i < n; i++) if (od[i] && !m[i]) sm[i] = 0;
    if (touch && FLAGS.touchClip) {   // merged component: the soft skirt must not re-include the neighbour's ink
      var kx0 = Math.max(0, Math.floor(ox0) - 1), kx1 = Math.min(cw, Math.ceil(ox1) + 1);
      for (var y2 = 0; y2 < chh; y2++) for (var x2 = 0; x2 < cw; x2++) if (x2 < kx0 || x2 >= kx1) sm[y2 * cw + x2] = 0;
    }
    for (i = 0; i < n; i++) {
      if (!sm[i]) { A[i] = 0; continue; }
      var a = A[i]; mass += a; sx += a * (i % cw); sy += a * ((i / cw) | 0);
    }
    var E = edgesOf(A, cw, chh); if (!E || mass <= 0) return null;
    if (touch) {   // merged with neighbours/underline: never let measured extents run far outside the OCR box
      var tol = Math.max(2, 0.25 * (s.y1 - s.y0));
      E.l = Math.max(E.l, ox0 - tol); E.r = Math.min(E.r, ox1 + tol); E.t = Math.max(E.t, oy0 - tol); E.b = Math.min(E.b, oy1 + tol);
    }
    return {
      ch: s.ch, conf: s.conf, wordId: s.wordId, lineId: s.lineId, src: s,
      bx0: bx0, by0: by0, cw: cw, chh: chh, A: A, m: m, nComp: nk, touch: touch,
      l: E.l + bx0, r: E.r + bx0, t: E.t + by0, b: E.b + by0, cx: sx / mass + bx0, cy: sy / mass + by0, mass: mass
    };
  }

  /**
   * Symbol-box repair. OCR engines (tesseract LSTM in particular) often return symbol boxes that are
   * shifted, merged or degenerate even when the word box and text are right. The word's ink is split
   * into glyph blobs (8-connected components merged by horizontal overlap; isolated specks dropped;
   * touching glyphs split at column-profile minima; broken ones merged) and the characters are
   * assigned to blobs in reading order. Returns new symbol objects (ids/conf preserved), or the input
   * when the OCR boxes already agree with the ink or the blob count cannot be reconciled.
   */
  function repairWord(S, ws) {
    var n = ws.length; if (!n) return ws;
    var ux0 = Infinity, uy0 = Infinity, ux1 = -Infinity, uy1 = -Infinity;
    ws.forEach(function (s) { ux0 = Math.min(ux0, s.x0); uy0 = Math.min(uy0, s.y0); ux1 = Math.max(ux1, s.x1); uy1 = Math.max(uy1, s.y1); });
    var wb = ws[0].wordBox;
    if (wb) { ux0 = Math.min(ux0, wb.x0); uy0 = Math.min(uy0, wb.y0); ux1 = Math.max(ux1, wb.x1); uy1 = Math.max(uy1, wb.y1); }
    var hh = uy1 - uy0; if (!(hh > 2)) return ws;
    var padX = Math.ceil(0.4 * hh) + 2, padY = 2;
    var bx0 = Math.max(0, Math.floor(ux0 - S.ox) - padX), by0 = Math.max(0, Math.floor(uy0 - S.oy) - padY);
    var bx1 = Math.min(S.w, Math.ceil(ux1 - S.ox) + padX), by1 = Math.min(S.h, Math.ceil(uy1 - S.oy) + padY);
    var cw = bx1 - bx0, chh = by1 - by0; if (cw < 3 || chh < 3) return ws;
    var A = surfAlpha(S, bx0, by0, cw, chh, true), bin = new Uint8Array(cw * chh), i, k;
    for (i = 0; i < A.length; i++) bin[i] = A[i] > 0.4 ? 1 : 0;
    var L = cc8(bin, cw, chh), ix0 = ux0 - S.ox - bx0 - 1, ix1 = ux1 - S.ox - bx0 + 1;
    var comps = L.comps.filter(function (c) {
      var cx = (c.x0 + c.x1) / 2; return cx >= ix0 && cx <= ix1 && c.y1 >= padY - 1 && c.y0 <= chh - padY;
    });
    if (!comps.length) return ws;
    var blobs = [];
    comps.sort(function (a, b) { return a.x0 - b.x0; }).forEach(function (c) {
      var hit = null;
      blobs.forEach(function (b) { var ov = Math.min(b.x1, c.x1) - Math.max(b.x0, c.x0) + 1; if (ov >= 0.5 * Math.min(b.x1 - b.x0 + 1, c.x1 - c.x0 + 1)) hit = b; });
      if (hit) { hit.x0 = Math.min(hit.x0, c.x0); hit.x1 = Math.max(hit.x1, c.x1); hit.y0 = Math.min(hit.y0, c.y0); hit.y1 = Math.max(hit.y1, c.y1); hit.area += c.area; }
      else blobs.push({ x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1, area: c.area });
    });
    blobs.sort(function (a, b) { return (a.x0 + a.x1) - (b.x0 + b.x1); });
    if (blobs.length > n) {
      var ma = median(blobs.map(function (b) { return b.area; }));
      var order = blobs.slice().sort(function (a, b) { return a.area - b.area; });
      for (k = 0; k < order.length && blobs.length > n; k++) if (order[k].area < 0.12 * ma) blobs.splice(blobs.indexOf(order[k]), 1);
    }
    while (blobs.length > n) {
      var bi = 0, bg = Infinity;
      for (k = 0; k + 1 < blobs.length; k++) { var gap = blobs[k + 1].x0 - blobs[k].x1; if (gap < bg) { bg = gap; bi = k; } }
      var a = blobs[bi], b = blobs[bi + 1];
      blobs.splice(bi, 2, { x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1), y0: Math.min(a.y0, b.y0), y1: Math.max(a.y1, b.y1), area: a.area + b.area });
    }
    var guard = 0;
    while (blobs.length < n && guard++ < 4 * n) {
      var wi = 0, ww = -1;
      blobs.forEach(function (b, j) { var wd = b.x1 - b.x0 + 1; if (wd > ww) { ww = wd; wi = j; } });
      var B = blobs[wi]; if (ww < 4) break;
      var best = -1, bv = Infinity;
      for (var x = B.x0 + Math.floor(0.25 * ww); x <= B.x1 - Math.floor(0.25 * ww); x++) {
        var v = 0; for (var y = B.y0; y <= B.y1; y++) v += A[y * cw + x];
        v += 0.02 * Math.abs(x - (B.x0 + B.x1) / 2);
        if (v < bv) { bv = v; best = x; }
      }
      if (best < 0) break;
      blobs.splice(wi, 1, { x0: B.x0, x1: best - 1, y0: B.y0, y1: B.y1, area: B.area / 2 }, { x0: best, x1: B.x1, y0: B.y0, y1: B.y1, area: B.area / 2 });
    }
    if (blobs.length !== n) return ws;
    // decide whether the OCR boxes are unreasonable; accurate boxes are kept as they are
    var isL = function (q) { return /[A-Za-z0-9]/.test(q.ch); };
    var lw = ws.filter(isL).map(function (q) { return q.x1 - q.x0; }), medW = lw.length ? median(lw) : 0, unreasonable = 0;
    ws.forEach(function (q, j) {
      var qw = q.x1 - q.x0;
      if (isL(q) && (q.y1 - q.y0 < 0.35 * hh || qw < 1)) unreasonable++;                 // degenerate
      if (isL(q) && lw.length >= 3 && qw > 2.2 * medW) unreasonable++;                    // swallowed neighbours
      if (j) { var p = ws[j - 1], ov = Math.min(p.x1, q.x1) - Math.max(p.x0, q.x0); if (ov > 0.6 * Math.max(1, Math.min(p.x1 - p.x0, qw))) unreasonable++; }
    });
    var uncovered = blobs.filter(function (b) {
      var cx = (b.x0 + b.x1) / 2 + bx0 + S.ox;
      return !ws.some(function (q) { return cx >= q.x0 - 1 && cx <= q.x1 + 1; });
    }).length;
    var out = ws.map(function (q, j) {
      var b = blobs[j], r = {}; for (var key in q) r[key] = q[key];
      r.x0 = b.x0 + bx0 + S.ox; r.y0 = b.y0 + by0 + S.oy; r.x1 = b.x1 + 1 + bx0 + S.ox; r.y1 = b.y1 + 1 + by0 + S.oy;
      r.ocrBox = { x0: q.x0, y0: q.y0, x1: q.x1, y1: q.y1 };
      return r;
    });
    var doIt = unreasonable > 0 || uncovered >= Math.max(1, Math.ceil(0.25 * n));
    if (doIt && FLAGS.log) FLAGS.log.push({ text: ws.map(function (q) { return q.ch; }).join(''), unreasonable: unreasonable, uncovered: uncovered });
    return doIt ? out : ws;
  }
  function repairSymbols(S, syms) {
    var byW = new Map(), order = [];
    syms.forEach(function (s, i) { var k = s.wordId != null ? s.wordId : 'i' + i; if (!byW.has(k)) { byW.set(k, []); order.push(k); } byW.get(k).push(s); });
    var out = [], nRep = 0;
    order.forEach(function (k) { var ws = byW.get(k), r = repairWord(S, ws); if (r !== ws) nRep++; out.push.apply(out, r); });
    out.repairedWords = nRep;
    return out;
  }

  function fitBaseline(glyphs) {
    var pts = [];
    var flat = glyphs.filter(function (g) { return FLAT_BASE.indexOf(g.ch) >= 0; });
    var base = glyphs.filter(function (g) { return isBaseChar(g.ch); });
    var use = flat.length >= 2 ? flat : (base.length ? base : glyphs.filter(function (g) { return DESC_CH.indexOf(g.ch) < 0; }));
    if (!use.length) use = glyphs;
    use.forEach(function (g) { pts.push([g.cx, g.b]); });
    if (!pts.length) return null;
    var hEst = median(glyphs.map(function (g) { return g.b - g.t; })) || 10;
    function fit(P, allowSlope) {
      var xm = mean(P.map(function (p) { return p[0]; })), ym = mean(P.map(function (p) { return p[1]; })), sxx = 0, sxy = 0;
      P.forEach(function (p) { sxx += (p[0] - xm) * (p[0] - xm); sxy += (p[0] - xm) * (p[1] - ym); });
      var span = Math.max.apply(null, P.map(function (p) { return p[0]; })) - Math.min.apply(null, P.map(function (p) { return p[0]; }));
      var slope = (allowSlope && sxx > 0 && span > 4 * hEst) ? clamp(sxy / sxx, -0.035, 0.035) : 0;
      return { a: slope ? ym : median(P.map(function (p) { return p[1]; })), slope: slope, xc: xm };
    }
    var B = fit(pts, pts.length >= 3);
    for (var it = 0; it < 2; it++) {
      var tol = Math.max(0.9, 0.06 * hEst);
      var keep = pts.filter(function (p) { return Math.abs(p[1] - (B.a + B.slope * (p[0] - B.xc))) <= tol; });
      if (keep.length >= Math.max(1, pts.length * 0.5) && keep.length < pts.length) { pts = keep; B = fit(pts, pts.length >= 3); }
    }
    B.n = pts.length;
    return B;
  }
  function baseAt(B, x) { return B.a + B.slope * (x - B.xc); }
  function lineMetrics(glyphs, B) {
    function h(set) {
      return glyphs.filter(function (g) { return set.indexOf(g.ch) >= 0; }).map(function (g) { return baseAt(B, g.cx) - g.t; });
    }
    var cf = h(FLAT_CAP), ca = h(CAP_CH), xf = h(X_FLAT), xa = h(X_CH);
    var asc = h('bdhkl');
    var capH = cf.length >= 2 ? median(cf) : (ca.length ? median(ca) : (asc.length >= 2 ? 0.97 * median(asc) : NaN));
    var xH = xf.length >= 2 ? median(xf) : (xa.length ? median(xa) : NaN);
    return { capH: capH, xH: xH, nCap: ca.length || (asc.length >= 2 ? 2 : 0), nX: xa.length };
  }
  function strokeAT(glyphs) {      // area / total-variation stroke estimate (cheap, blur-robust)
    var sa = 0, tv = 0;
    glyphs.forEach(function (g) {
      var A = g.A, w = g.cw, h = g.chh;
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
        var p = y * w + x; sa += A[p];
        if (x + 1 < w) tv += Math.abs(A[p + 1] - A[p]);
        if (y + 1 < h) tv += Math.abs(A[p + w] - A[p]);
      }
    });
    return tv > 0 ? 2 * sa / (tv * Math.PI / 4) : NaN;
  }

  /** Stroke contrast (vertical-stem width / horizontal-bar thickness) and slant of a word's glyphs. */
  function shapeFeatures(glyphs) {
    var hr = [], vr = [], sl = [];
    glyphs.forEach(function (g) {
      if (!/[A-Za-z0-9]/.test(g.ch) || 'AVWXYvwxyk7KMNZz2'.indexOf(g.ch) >= 0) return;
      var A = g.A, w = g.cw, h = g.chh, x, y, m, sxy = 0, syy = 0, sm = 0, mx = 0, my = 0;
      for (y = 0; y < h; y++) { m = 0; for (x = 0; x <= w; x++) { var a = x < w ? A[y * w + x] : 0; if (a > 0.2) m += a; else if (m) { hr.push(m); m = 0; } } }
      for (x = 0; x < w; x++) { m = 0; for (y = 0; y <= h; y++) { var b = y < h ? A[y * w + x] : 0; if (b > 0.2) m += b; else if (m) { vr.push(m); m = 0; } } }
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) { var c = A[y * w + x]; sm += c; mx += c * x; my += c * y; }
      if (sm <= 0 || 'AVWXYvwxyk/\\<>7KMNZz2'.indexOf(g.ch) >= 0) return;
      mx /= sm; my /= sm;
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) { var d = A[y * w + x]; sxy += d * (x - mx) * (y - my); syy += d * (y - my) * (y - my); }
      if (syy > 0) sl.push(-sxy / syy);
    });
    function trimMean(v) { if (!v.length) return NaN; var md = median(v); var k = v.filter(function (t) { return t <= 2.2 * md; }); return mean(k); }
    var a = trimMean(hr), b = trimMean(vr);
    return { contrast: a > 0 && b > 0 ? a / b : 1, slant: sl.length ? median(sl) : 0 };
  }

  // ------------------------------------------------------------------------------------
  // Symbol normalisation
  // ------------------------------------------------------------------------------------
  function normSymbol(s, wordId, lineId) {
    var b = s.bbox || s;
    return {
      ch: s.ch != null ? String(s.ch) : String(s.text != null ? s.text : ''),
      x0: +b.x0, y0: +b.y0, x1: +b.x1, y1: +b.y1,
      conf: s.conf != null ? +s.conf : (s.confidence != null ? +s.confidence : 100),
      baseline: s.baseline, wordId: s.wordId != null ? s.wordId : wordId, lineId: s.lineId != null ? s.lineId : lineId,
      wordBox: s.wordBox || null
    };
  }
  /** Flatten tesseract.js 5 `data` (blocks->paragraphs->lines->words->symbols or data.symbols). */
  function symbolsFromTesseract(data) {
    var out = [], wid = 0, lid = 0;
    if (data && data.blocks && data.blocks.length) {
      data.blocks.forEach(function (bl) {
        (bl.paragraphs || []).forEach(function (pa) {
          (pa.lines || []).forEach(function (ln) {
            lid++;
            (ln.words || []).forEach(function (wd) {
              wid++;
              var wb = wd.bbox ? { x0: wd.bbox.x0, y0: wd.bbox.y0, x1: wd.bbox.x1, y1: wd.bbox.y1 } : null;
              (wd.symbols || []).forEach(function (sy) {
                var s = normSymbol(sy, 'w' + wid, 'l' + lid); s.wordBox = wb;
                if (s.ch && !isSpace(s.ch)) out.push(s);
              });
            });
          });
        });
      });
      return out;
    }
    var words = (data && data.words) || [];
    words.forEach(function (wd) {
      wid++;
      var lkey = wd.line ? (wd.line.bbox ? wd.line.bbox.x0 + ',' + wd.line.bbox.y0 : 'l') : 'l';
      (wd.symbols || []).forEach(function (sy) { var s = normSymbol(sy, 'w' + wid, 'l' + lkey); if (s.ch && !isSpace(s.ch)) out.push(s); });
    });
    return out;
  }
  function autoGroup(syms) {
    // assign lineId / wordId where missing (y-overlap lines, gap-split words)
    var need = syms.some(function (s) { return s.lineId == null; });
    if (need) {
      var sorted = syms.slice().sort(function (a, b) { return (a.y0 + a.y1) - (b.y0 + b.y1); }), lines = [];
      sorted.forEach(function (s) {
        var cy = (s.y0 + s.y1) / 2, h = s.y1 - s.y0, L = null;
        for (var i = lines.length - 1; i >= 0 && i >= lines.length - 3; i--) if (Math.abs(lines[i].cy - cy) < 0.5 * Math.max(h, lines[i].h)) { L = lines[i]; break; }
        if (!L) { L = { cy: cy, h: h, items: [], id: 'L' + lines.length }; lines.push(L); }
        L.items.push(s); L.cy = (L.cy * (L.items.length - 1) + cy) / L.items.length; L.h = Math.max(L.h, h);
        if (s.lineId == null) s.lineId = L.id;
      });
    }
    if (syms.some(function (s) { return s.wordId == null; })) {
      var byLine = {};
      syms.forEach(function (s) { (byLine[s.lineId] = byLine[s.lineId] || []).push(s); });
      Object.keys(byLine).forEach(function (k) {
        var L = byLine[k].sort(function (a, b) { return a.x0 - b.x0; }), hh = median(L.map(function (s) { return s.y1 - s.y0; })), w = 0;
        L.forEach(function (s, i) { if (i && s.x0 - L[i - 1].x1 > 0.35 * hh) w++; if (s.wordId == null) s.wordId = k + ':' + w; });
      });
    }
    return syms;
  }
  /** Accepts words [{text, symbols:[...]}] (tesseract shape), or a flat symbol array. */
  function normWords(words) {
    var syms = [], text = [], map = [];
    if (!words) return { syms: syms, text: '', map: map };
    if (!Array.isArray(words)) words = [words];
    var flat = words.length && words[0] && !words[0].symbols && (words[0].ch != null || (words[0].text != null && String(words[0].text).length === 1));
    if (flat) {
      var arr = words.map(function (s) { return normSymbol(s); }).filter(function (s) { return s.ch && !isSpace(s.ch); });
      // keep OCR reading order when word ids are present (x0 sorting can swap overlapping boxes)
      if (arr.some(function (s) { return s.wordId == null; })) arr.sort(function (a, b) { return a.x0 - b.x0; });
      var hh = median(arr.map(function (s) { return s.y1 - s.y0; })) || 10;
      arr.forEach(function (s, i) {
        if (i) {
          var newWord = s.wordId != null && arr[i - 1].wordId != null ? s.wordId !== arr[i - 1].wordId : (s.x0 - arr[i - 1].x1 > 0.35 * hh);
          if (newWord) { text.push(' '); map.push(-1); }
        }
        syms.push(s); text.push(s.ch); map.push(syms.length - 1);
      });
    } else {
      words.forEach(function (wd, wi) {
        if (wi) { text.push(' '); map.push(-1); }
        var wsy = (wd.symbols || []).map(function (s) { return normSymbol(s, wd.wordId != null ? wd.wordId : wd.id, wd.lineId); })
          .filter(function (s) { return s.ch && !isSpace(s.ch); });
        if (!wsy.length && wd.bbox) wsy = [{ ch: wd.text || '', x0: wd.bbox.x0, y0: wd.bbox.y0, x1: wd.bbox.x1, y1: wd.bbox.y1, conf: wd.confidence || 100, whole: true }];
        wsy.forEach(function (s) { syms.push(s); chars(s.ch).forEach(function (c, k) { text.push(c); map.push(k === 0 ? syms.length - 1 : -2); }); });
      });
    }
    return { syms: syms, text: text.join(''), map: map };
  }

  // ------------------------------------------------------------------------------------
  // Library
  // ------------------------------------------------------------------------------------
  /**
   * Build a glyph library from a scanned page and its OCR symbol boxes.
   * @param {HTMLCanvasElement|OffscreenCanvas|ImageData|{width,height,data}} img page image at scan resolution
   * @param {Array<{ch:string,x0:number,y0:number,x1:number,y1:number,conf?:number,baseline?:number,wordId?:*,lineId?:*}>} symbols
   *        OCR character boxes in page pixels (see symbolsFromTesseract)
   * @param {{minConf?:number, maxInstances?:number}} [opts]
   * @returns {Object} lib - opaque library: {clusters:[{capH,xH,sizePx,strokeWeight,blurSigma,slant,classes,...}], inkRatio, blurSigma, stats, ...}
   */
  function buildLibrary(img, symbols, opts) {
    opts = opts || {};
    var t0 = now(), minConf = opts.minConf != null ? opts.minConf : 55, maxInst = opts.maxInstances || 31;
    var syms = autoGroup((symbols || []).map(function (s) { return normSymbol(s); }).filter(function (s) {
      return s.ch && s.ch.length && !isSpace(s.ch) && s.x1 > s.x0 && s.y1 > s.y0;
    }));
    var size = imgSize(img);
    var symH = median(syms.map(function (s) { return s.y1 - s.y0; })) || 16;
    var px = getRGBA(img, 0, 0, size.w, size.h);
    var cell = clamp(Math.round(symH * 1.6), 16, 48);
    var S = makeSurface(px, null, 0.2, { cell: cell });
    // ink ratio: per line, 3rd percentile of gray/paper inside OCR boxes; 20th pct over lines
    var byLineS = {};
    syms.forEach(function (s) { (byLineS[s.lineId] = byLineS[s.lineId] || []).push(s); });
    var lineRatios = [];
    Object.keys(byLineS).forEach(function (k) {
      var vals = [];
      byLineS[k].forEach(function (s) {
        var x0 = clamp(Math.floor(s.x0), 0, S.w - 1), x1 = clamp(Math.ceil(s.x1), 0, S.w), y0 = clamp(Math.floor(s.y0), 0, S.h - 1), y1 = clamp(Math.ceil(s.y1), 0, S.h);
        var step = Math.max(1, Math.floor((x1 - x0) * (y1 - y0) / 60));
        for (var i = 0, n = (x1 - x0) * (y1 - y0); i < n; i += step) {
          var x = x0 + i % (x1 - x0), y = y0 + Math.floor(i / (x1 - x0));
          vals.push(S.gray[y * S.w + x] / gridSample(S.grid, x, y));
        }
      });
      if (vals.length >= 20) lineRatios.push(percentile(vals, 0.03));
    });
    S.inkRatio = clamp(lineRatios.length ? percentile(lineRatios, 0.2) : 0.2, 0.02, 0.85);
    // ruling lines (page level, without materialising alpha)
    var n = S.w * S.h, dark = new Uint8Array(n), kk = 1 - 0.45 * (1 - S.inkRatio);
    for (var y = 0; y < S.h; y++) {
      var fy = (y + 0.5) / S.grid.cell - 0.5, iy = Math.floor(fy), ty = fy - iy, ya = clamp(iy, 0, S.grid.ny - 1), yb = clamp(iy + 1, 0, S.grid.ny - 1);
      var rowv = new Float32Array(S.grid.nx);
      for (var cx = 0; cx < S.grid.nx; cx++) rowv[cx] = S.grid.v[ya * S.grid.nx + cx] * (1 - ty) + S.grid.v[yb * S.grid.nx + cx] * ty;
      for (var x = 0; x < S.w; x++) {
        var fx = (x + 0.5) / S.grid.cell - 0.5, ix = Math.floor(fx), tx = fx - ix;
        var P = rowv[clamp(ix, 0, S.grid.nx - 1)] * (1 - tx) + rowv[clamp(ix + 1, 0, S.grid.nx - 1)] * tx;
        dark[y * S.w + x] = S.gray[y * S.w + x] < P * kk ? 1 : 0;
      }
    }
    var Lmin = Math.max(30, Math.round(3.2 * symH));
    S.lines = detectLines(dark, S.w, S.h, Lmin, Lmin);
    var lb = lineBandOf(S.lines, S.w, S.h, 1); S.lineBand = new Uint8Array(n);
    for (var i = 0; i < n; i++) S.lineBand[i] = lb.h[i] | lb.v[i];
    lb = null; dark = null;
    var nLinePx = 0; for (i = 0; i < n; i++) if (S.lines[i]) nLinePx++;

    // repair OCR symbol boxes, then refine
    if (FLAGS.repair) syms = repairSymbols(S, syms);
    var stats = { symbols: syms.length, repairedWords: syms.repairedWords, refined: 0, rejected: { conf: 0, blank: 0, merged: 0, size: 0, shape: 0 } };
    var R = [];
    syms.forEach(function (s) {
      var g = refineSymbol(S, s, 3);
      if (!g) { stats.rejected.blank++; return; }
      R.push(g);
    });
    stats.refined = R.length;
    // lines
    var linesG = {}, lines = {};
    R.forEach(function (g) { (linesG[g.lineId] = linesG[g.lineId] || []).push(g); });
    Object.keys(linesG).forEach(function (k) {
      var G = linesG[k], B = fitBaseline(G); if (!B) return;
      var M = lineMetrics(G, B);
      lines[k] = { a: B.a, slope: B.slope, xc: B.xc, capH: M.capH, xH: M.xH, nCap: M.nCap, nX: M.nX, n: G.length };
      G.forEach(function (g) { g.line = lines[k]; g.base = baseAt(lines[k], g.cx); });
    });
    // default cap/x ratio
    var ratios = []; Object.keys(lines).forEach(function (k) { var L = lines[k]; if (L.capH > 0 && L.xH > 0) ratios.push(L.capH / L.xH); });
    var capX = ratios.length ? clamp(median(ratios), 1.2, 1.7) : 1.4;
    Object.keys(lines).forEach(function (k) {
      var L = lines[k];
      if (!(L.capH > 0)) L.capH = L.xH > 0 ? L.xH * capX : median(linesG[k].map(function (g) { return g.b - g.t; }));
      if (!(L.xH > 0)) L.xH = L.capH / capX;
    });
    // words
    var wordsG = {}, words = [];
    R.forEach(function (g) { if (g.line) (wordsG[g.wordId] = wordsG[g.wordId] || []).push(g); });
    Object.keys(wordsG).forEach(function (k) {
      var G = wordsG[k].sort(function (a, b) { return a.cx - b.cx; }), L = G[0].line;
      var caps = G.filter(function (g) { return CAP_CH.indexOf(g.ch) >= 0 && g.ch !== 'Q'; }).map(function (g) { return g.base - g.t; });
      var xs = G.filter(function (g) { return X_CH.indexOf(g.ch) >= 0; }).map(function (g) { return g.base - g.t; });
      var capW = caps.length >= 2 ? median(caps) : L.capH, hasCap = caps.length >= 2 || L.nCap >= 2;
      if (!(capW > 0)) capW = L.capH;
      var SF = L.sf || (L.sf = shapeFeatures(linesG[G[0].lineId]));
      words.push({ id: k, glyphs: G, line: L, lineId: G[0].lineId, capH: capW, hasCap: hasCap, nOwnCaps: caps.length, xH: xs.length >= 2 ? median(xs) : L.xH, hasX: xs.length >= 2 || L.nX >= 2, stroke: strokeAT(G) / capW, contrast: SF.contrast, slant: SF.slant });
      if (G.length < 3) { var lst = L.lst || (L.lst = strokeAT(linesG[G[0].lineId]) / L.capH); words[words.length - 1].stroke = lst; }
    });
    // class-relative width
    var relW = {};
    words.forEach(function (w) { w.glyphs.forEach(function (g) { (relW[g.ch] = relW[g.ch] || []).push((g.r - g.l) / w.capH); }); });
    var relMed = {}; Object.keys(relW).forEach(function (c) { relMed[c] = median(relW[c]); });
    words.forEach(function (w) {
      var v = w.glyphs.filter(function (g) { return relMed[g.ch] > 0.15 && relW[g.ch].length >= 3; }).map(function (g) { return (g.r - g.l) / w.capH / relMed[g.ch]; });
      w.wv = v;
    });
    var lineW = {};
    words.forEach(function (w) { (lineW[w.lineId] = lineW[w.lineId] || []).push.apply(lineW[w.lineId], w.wv); });
    words.forEach(function (w) { var v = lineW[w.lineId]; w.width = v.length ? median(v) : 1; });
    // cluster words by size, weight, width, stroke contrast and slant
    var clusters = [];
    var TOL = { capH: 0.08, stroke: 0.22, width: 0.09, contrast: 0.25, slant: 0.11 };
    function dist(w, c) {
      var d = (w.hasCap && c.nCap) || !(w.hasX && c.nX) ? Math.abs(Math.log(w.capH / c.capH)) / TOL.capH : Math.abs(Math.log(w.xH / c.xH)) / TOL.capH;
      if (w.stroke > 0 && c.stroke > 0) d = Math.max(d, Math.abs(w.stroke - c.stroke) / (TOL.stroke * c.stroke));
      d = Math.max(d, Math.abs(Math.log(w.width / c.width)) / TOL.width);
      d = Math.max(d, Math.abs(Math.log(w.contrast / c.contrast)) / TOL.contrast);
      d = Math.max(d, Math.abs(w.slant - c.slant) / TOL.slant);
      return d;   // <= 1 means compatible on every feature
    }
    function addTo(c, w) {
      var k = w.glyphs.length, t = c.n + k;
      ['width', 'contrast', 'slant'].forEach(function (f) { c[f] = (c[f] * c.n + w[f] * k) / t; });
      if (w.hasCap) { c.capH = c.nCap ? (c.capH * c.nCap + w.capH * k) / (c.nCap + k) : w.capH; c.nCap += k; } else if (!c.nCap) c.capH = (c.capH * c.n + w.capH * k) / t;
      if (w.hasX) { c.xH = c.nX ? (c.xH * c.nX + w.xH * k) / (c.nX + k) : w.xH; c.nX += k; } else if (!c.nX) c.xH = (c.xH * c.n + w.xH * k) / t;
      if (w.stroke > 0) c.stroke = c.stroke > 0 ? (c.stroke * c.n + w.stroke * k) / t : w.stroke;
      c.n = t; c.members.push(w); c.hasCap = c.nCap > 0; c.hasX = c.nX > 0;
    }
    function newCluster(w) { var c = { capH: w.capH, xH: w.xH, nCap: 0, nX: 0, stroke: w.stroke, width: w.width, contrast: w.contrast, slant: w.slant, n: 0, members: [], words: [] }; clusters.push(c); return c; }
    var big = words.filter(function (w) { return w.glyphs.length >= 3; }).sort(function (a, b) { return b.glyphs.length - a.glyphs.length; });
    big.forEach(function (w) {
      var best = null, bd = 1;
      clusters.forEach(function (c) { var d = dist(w, c); if (d <= bd) { bd = d; best = c; } });
      addTo(best || newCluster(w), w);
    });
    // merge clusters whose centres are compatible (greedy order can split a style)
    for (var changed = true; changed;) {
      changed = false;
      for (var a = 0; a < clusters.length && !changed; a++) for (var b = a + 1; b < clusters.length && !changed; b++) {
        if (dist(clusters[b], clusters[a]) <= 1.0) {
          var ca = clusters[a], cb = clusters[b];
          cb.members.forEach(function (w) { addTo(ca, w); });
          clusters.splice(b, 1); changed = true;
        }
      }
    }
    // final assignment of big words to nearest compatible centre
    big.forEach(function (w) {
      var best = null, bd = 1e9;
      clusters.forEach(function (c) { var d = dist(w, c); if (d < bd) { bd = d; best = c; } });
      w.cluster = bd <= 1.6 ? best : null;
    });
    // short words (and unmatched ones): take the style of the nearest big word on the same visual line
    words.forEach(function (w) {
      if (w.cluster) return;
      var g0 = w.glyphs[0], bx = (w.glyphs[0].l + w.glyphs[w.glyphs.length - 1].r) / 2, by = g0.base, best = null, bd = 1e9;
      big.forEach(function (o) {
        if (!o.cluster) return;
        var ob = baseAt(o.line, bx);
        if (Math.abs(ob - by) > 0.35 * o.capH) return;
        if (Math.abs(Math.log(Math.max(1, w.glyphs[0].b - w.glyphs[0].t) / o.capH)) > 1.2) return;
        var dx = Math.max(0, o.glyphs[0].l - bx, bx - o.glyphs[o.glyphs.length - 1].r);
        if (dx < bd) { bd = dx; best = o.cluster; }
      });
      if (best && bd < 12 * best.capH) { w.cluster = best; return; }
      var bc = null, bd2 = 1e9;
      clusters.forEach(function (c) { var d = Math.abs(Math.log(w.capH / c.capH)); if (d < bd2) { bd2 = d; bc = c; } });
      w.cluster = bc && bd2 < 0.15 ? bc : newCluster(w);
    });
    words.forEach(function (w) { if (w.cluster) w.cluster.words.push(w); });
    clusters = clusters.filter(function (c) { return c.words.length; });
    if (opts.debug) stats.words = words.map(function (w) { return { id: w.id, n: w.glyphs.length, capH: +w.capH.toFixed(2), stroke: +(w.stroke || 0).toFixed(3), width: +w.width.toFixed(3), contrast: +w.contrast.toFixed(3), slant: +w.slant.toFixed(3), cluster: clusters.indexOf(w.cluster) }; });

    var lib = {
      version: VERSION, width: size.w, height: size.h, inkRatio: S.inkRatio, clusters: [], wordCluster: {}, wordScale: {}, lines: lines,
      paperGrid: { cell: S.grid.cell, nx: S.grid.nx, ny: S.grid.ny, v: S.grid.v, ox: 0, oy: 0 }, linePx: nLinePx, symH: symH, stats: stats
    };
    // page colour stats
    var paperVals = [[], [], []], inkVals = [[], [], []], noiseVals = [], rr = rng(7);
    for (var t = 0; t < 4000; t++) {
      var qx = Math.floor(rr() * S.w), qy = Math.floor(rr() * S.h), q = qy * S.w + qx, Pq = gridSample(S.grid, qx, qy);
      if (S.gray[q] > Pq * (1 - 0.12 * (1 - S.inkRatio)) && !S.lineBand[q]) {
        paperVals[0].push(px.data[q * 4]); paperVals[1].push(px.data[q * 4 + 1]); paperVals[2].push(px.data[q * 4 + 2]);
        noiseVals.push(S.gray[q] - Pq);
      }
    }
    R.forEach(function (g, gi) {
      if (gi % 3) return;
      for (var p = 0; p < g.A.length; p += 2) if (g.A[p] >= 0.9) {
        var xx = g.bx0 + p % g.cw, yy = g.by0 + Math.floor(p / g.cw), qq = (yy * S.w + xx) * 4;
        inkVals[0].push(px.data[qq]); inkVals[1].push(px.data[qq + 1]); inkVals[2].push(px.data[qq + 2]);
      }
    });
    lib.paperRGB = paperVals[0].length ? [median(paperVals[0]), median(paperVals[1]), median(paperVals[2])] : [255, 255, 255];
    lib.inkRGB = inkVals[0].length ? [median(inkVals[0]), median(inkVals[1]), median(inkVals[2])] : [0, 0, 0];
    var nm = median(noiseVals); lib.paperNoise = noiseVals.length ? 1.4826 * median(noiseVals.map(function (v) { return Math.abs(v - nm); })) : 2;

    // page-level blur pool
    var pageBlur = [];
    R.forEach(function (g, gi) { if (pageBlur.length < 400 && gi % 3 === 0) edgeSamples(g.A, g.cw, g.chh, pageBlur, 400); });
    lib.blurSigma = pageBlur.length ? median(pageBlur) : 0.8;

    clusters.forEach(function (c, ci) {
      lib.clusters.push(buildCluster(c, ci, lib, stats, minConf, maxInst));
      c.words.forEach(function (w) { lib.wordCluster[w.id] = ci; w.line.cluster = w.line.cluster != null ? w.line.cluster : ci; });
    });
    lib.stats.ms = Math.round(now() - t0);
    return lib;
  }

  function buildCluster(c, ci, lib, stats, minConf, maxInst) {
    var cl = {
      id: ci, classes: {}, pairs: {}, L: {}, R: {}, meanL: 0, meanR: 0, nWords: c.words.length, nGlyphs: 0,
      capH: 0, xH: 0, sizePx: 0, strokeWeight: 0, blurSigma: lib.blurSigma, slant: 0, wordGap: 0, linePitch: 0, inkNoise: 0, fallback: null
    };
    var all = [], capS = [], xS = [];
    c.words.forEach(function (w) {
      w.glyphs.forEach(function (g) {
        all.push(g);
        if (FLAT_CAP.indexOf(g.ch) >= 0 || (CAP_CH.indexOf(g.ch) >= 0)) capS.push(g.base - g.t);
        if (X_CH.indexOf(g.ch) >= 0) xS.push(g.base - g.t);
      });
    });
    cl.nGlyphs = all.length;
    cl.capH = capS.length ? median(capS) : c.capH;
    cl.xH = xS.length ? median(xS) : cl.capH / 1.4;
    cl.sizePx = cl.capH / 0.716;
    // size normalisation: instances from lines of a slightly different size are scaled to the cluster
    c.words.forEach(function (w) {
      var lc = w.nOwnCaps >= 3 ? w.capH : (w.line && w.line.capH > 0 ? w.line.capH : w.capH), k = cl.capH / lc;   // own caps beat a (possibly mixed) OCR line
      if (!(k > 0.8 && k < 1.25) || Math.abs(Math.log(k)) < 0.06) k = 1;   // only clearly different sizes (line estimates are noisy)
      w.glyphs.forEach(function (g) { g.k = k; });
      lib.wordScale[w.id] = 1 / k;   // size of this word relative to the cluster (used again at render time)
    });
    // stroke + blur from page crops
    var st = [], bl = [];
    all.forEach(function (g, i) { if (i % Math.max(1, Math.floor(all.length / 150)) === 0) strokeSamples(g.A, g.cw, g.chh, st); });
    all.forEach(function (g, i) { if (bl.length < 250 && i % Math.max(1, Math.floor(all.length / 80)) === 0) edgeSamples(g.A, g.cw, g.chh, bl, 250); });
    cl.strokeWeight = st.length ? iqMean(st) : cl.capH * 0.12;
    cl.blurSigma = bl.length >= 12 ? median(bl) : lib.blurSigma;
    cl.blurSamples = bl.length;
    var margin = Math.max(3, Math.ceil(2.5 * cl.blurSigma + 1.5));
    // classes
    var byCh = {};
    all.forEach(function (g) { (byCh[g.ch] = byCh[g.ch] || []).push(g); });
    var resid = [];
    Object.keys(byCh).forEach(function (ch) {
      var G = byCh[ch].filter(function (g) { if (g.conf < minConf) { stats.rejected.conf++; return false; } return true; });
      if (!G.length) G = byCh[ch].slice();
      var clean = G.filter(function (g) { return !g.touch; }), weak = false;
      if (clean.length) { stats.rejected.merged += G.length - clean.length; G = clean; } else weak = true;
      if (G.length >= 3) {
        var mw = median(G.map(function (g) { return g.r - g.l; })), mh = median(G.map(function (g) { return g.b - g.t; }));
        var mc = median(G.map(function (g) { return g.nComp; }));
        var ok = G.filter(function (g) {
          return Math.abs((g.r - g.l) - mw) <= Math.max(1.5, 0.2 * mw) && Math.abs((g.b - g.t) - mh) <= Math.max(1.5, 0.2 * mh) && Math.abs(g.nComp - mc) <= 1;
        });
        stats.rejected.size += G.length - ok.length;
        if (ok.length) G = ok;
      }
      if (G.length > maxInst) G = G.slice().sort(function (a, b) { return b.conf - a.conf; }).slice(0, maxInst);
      var T = buildTemplate(G, margin, stats);
      if (T) { T.weak = weak || T.suspect; cl.classes[ch] = T; if (T.resid >= 0) resid.push(T.resid); }
    });
    cl.inkNoise = resid.length ? median(resid) : 0.05;
    // pairs
    var gaps = {}, allGaps = [];
    c.words.forEach(function (w) {
      var G = w.glyphs;
      for (var i = 1; i < G.length; i++) {
        var a = G[i - 1], b = G[i]; if (a.touch || b.touch) continue;
        var gap = (b.l - a.r) * (a.k || 1); if (Math.abs(gap) > cl.capH) continue;
        (gaps[a.ch + '\u0001' + b.ch] = gaps[a.ch + '\u0001' + b.ch] || []).push(gap); allGaps.push(gap);
      }
    });
    var meanGap = allGaps.length ? median(allGaps) : cl.capH * 0.12;
    Object.keys(gaps).forEach(function (k) { cl.pairs[k] = { gap: median(gaps[k]), n: gaps[k].length }; });
    var Lc = {}, Rc = {}, keys = Object.keys(cl.pairs);
    keys.forEach(function (k) { var p = k.split('\u0001'); Lc[p[1]] = meanGap / 2; Rc[p[0]] = meanGap / 2; });
    for (var it = 0; it < 25; it++) {
      var sR = {}, nR = {}, sL = {}, nL = {};
      keys.forEach(function (k) { var p = k.split('\u0001'), q = cl.pairs[k]; sR[p[0]] = (sR[p[0]] || 0) + q.n * (q.gap - Lc[p[1]]); nR[p[0]] = (nR[p[0]] || 0) + q.n; });
      Object.keys(sR).forEach(function (a) { Rc[a] = (sR[a] + meanGap / 2) / (nR[a] + 1); });
      keys.forEach(function (k) { var p = k.split('\u0001'), q = cl.pairs[k]; sL[p[1]] = (sL[p[1]] || 0) + q.n * (q.gap - Rc[p[0]]); nL[p[1]] = (nL[p[1]] || 0) + q.n; });
      Object.keys(sL).forEach(function (b) { Lc[b] = (sL[b] + meanGap / 2) / (nL[b] + 1); });
    }
    cl.L = Lc; cl.R = Rc;
    cl.meanL = Object.keys(Lc).length ? median(Object.keys(Lc).map(function (k) { return Lc[k]; })) : meanGap / 2;
    cl.meanR = Object.keys(Rc).length ? median(Object.keys(Rc).map(function (k) { return Rc[k]; })) : meanGap / 2;
    cl.meanGap = meanGap;
    // word gaps and line pitch
    var wg = [], byLine = {};
    c.words.forEach(function (w) { (byLine[w.lineId] = byLine[w.lineId] || []).push(w); });
    Object.keys(byLine).forEach(function (k) {
      var W = byLine[k].sort(function (a, b) { return a.glyphs[0].l - b.glyphs[0].l; });
      for (var i = 1; i < W.length; i++) {
        var gp = (W[i].glyphs[0].l - W[i - 1].glyphs[W[i - 1].glyphs.length - 1].r) * (W[i].glyphs[0].k || 1);
        if (gp > 0 && gp < 1.2 * cl.capH) wg.push(gp);
      }
    });
    cl.wordGap = wg.length ? median(wg) : 0.42 * cl.capH;
    var bases = Object.keys(byLine).map(function (k) { return byLine[k][0].line.a; }).sort(function (a, b) { return a - b; }), pitches = [];
    for (var j = 1; j < bases.length; j++) { var d = bases[j] - bases[j - 1]; if (d > 1.1 * cl.capH && d < 3 * cl.capH) pitches.push(d); }
    cl.linePitch = pitches.length ? median(pitches) : 1.75 * cl.capH;
    cl.slant = estimateSlant(cl);
    // template stroke/blur (for diagnostics)
    var ts = [], tb = [];
    Object.keys(cl.classes).forEach(function (k) { var T = cl.classes[k]; strokeSamples(T.tpl, T.W, T.H, ts); if (tb.length < 300) edgeSamples(T.tpl, T.W, T.H, tb, 300); });
    cl.tplStroke = ts.length ? iqMean(ts) : cl.strokeWeight;
    cl.tplBlur = tb.length ? median(tb) : cl.blurSigma;
    // compensate registration softening of median templates (mild Laplacian sharpening)
    if (tb.length >= 12 && cl.tplBlur > cl.blurSigma * 1.04) {
      var extra = Math.max(0, cl.tplBlur * cl.tplBlur - cl.blurSigma * cl.blurSigma);
      Object.keys(cl.classes).forEach(function (k) { var T = cl.classes[k]; T.tpl = sharpen(T.tpl, T.W, T.H, 0.5 * extra); if (T.variants) T.variants.forEach(function (v, vi) { v.tpl = vi === 0 ? T.tpl : sharpen(v.tpl, T.W, T.H, 0.5 * extra); }); });
      tb = []; Object.keys(cl.classes).forEach(function (k) { var T = cl.classes[k]; if (tb.length < 300) edgeSamples(T.tpl, T.W, T.H, tb, 300); });
      cl.tplBlurSharpened = tb.length ? median(tb) : cl.tplBlur;
    }
    return cl;
  }
  function sharpen(A, w, h, k) {
    var o = new Float32Array(w * h);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var p = y * w + x, c = A[p];
      var lap = (x > 0 ? A[p - 1] : 0) + (x < w - 1 ? A[p + 1] : 0) + (y > 0 ? A[p - w] : 0) + (y < h - 1 ? A[p + w] : 0) - 4 * c;
      var v = c - k * lap; o[p] = v < 0 ? 0 : (v > 1 ? 1 : v);
    }
    return o;
  }

  function buildTemplate(G, margin, stats) {
    if (!G.length) return null;
    var ascM = 0, descM = 0, lwM = 0, rwM = 0;
    G.forEach(function (g) {
      var k = g.k || 1;
      ascM = Math.max(ascM, (g.base - g.t) * k); descM = Math.max(descM, (g.b - g.base) * k);
      lwM = Math.max(lwM, (g.cx - g.l) * k); rwM = Math.max(rwM, (g.r - g.cx) * k);
    });
    var W = Math.ceil(lwM + rwM) + 2 * margin + 3, H = Math.ceil(ascM + Math.max(0, descM)) + 2 * margin + 3;
    var cxg = margin + 1 + Math.ceil(lwM), byg = margin + 1 + Math.ceil(ascM);
    function crop(g) { var k = g.k || 1; return resampleSep(g.A, g.cw, g.chh, W, H, 1 / k, g.cx - cxg / k - g.bx0, 1 / k, g.base - byg / k - g.by0); }
    var stack = G.map(crop), use = G.map(function (_, i) { return i; });
    function combine(idx) {
      var out = new Float32Array(W * H), k = idx.length, tmp = new Float32Array(k);
      for (var p = 0; p < W * H; p++) {
        if (k === 1) { out[p] = stack[idx[0]][p]; continue; }
        if (k === 2) { out[p] = 0.5 * (stack[idx[0]][p] + stack[idx[1]][p]); continue; }
        for (var i = 0; i < k; i++) tmp[i] = stack[idx[i]][p];
        tmp.sort(); out[p] = k % 2 ? tmp[(k - 1) >> 1] : 0.5 * (tmp[k / 2 - 1] + tmp[k / 2]);
      }
      return out;
    }
    var rep = combine(use), suspect = false;
    if (use.length === 2 && ncc(stack[0], stack[1]) < 0.75) {   // two disagreeing instances (likely an OCR mislabel)
      use = [G[0].conf >= G[1].conf ? 0 : 1]; rep = combine(use); suspect = true;
    }
    if (use.length >= 4) {
      var sc = use.map(function (i) { return ncc(stack[i], rep); }), ms = median(sc);
      var keep = use.filter(function (i, j) { return sc[j] >= Math.max(0.6, ms - 0.15); });
      if (keep.length < use.length && keep.length >= 2) { stats.rejected.shape += use.length - keep.length; use = keep; rep = combine(use); }
    }
    // shape-inconsistent class (two similar fonts merged into one style cluster): split into variants
    var variants = null;
    if (use.length >= 4 && FLAGS.variants) {
      var sc2 = use.map(function (i) { return ncc(stack[i], rep); });
      if (median(sc2) < 0.93) {
        var seed = use[sc2.indexOf(Math.min.apply(null, sc2))], A = [seed], B = use.filter(function (i) { return i !== seed; });
        for (var it = 0; it < 4 && B.length; it++) {
          var rA = combine(A), rB = combine(B), nA = [], nB = [];
          use.forEach(function (i) { (ncc(stack[i], rA) > ncc(stack[i], rB) ? nA : nB).push(i); });
          if (!nA.length || !nB.length) break;
          A = nA; B = nB;
        }
        if (A.length >= 2 && B.length >= 2) {
          var tA = combine(A), tB = combine(B);
          if (ncc(tA, tB) < 0.92) {
            var mk = function (grp, t) { var L = {}; grp.forEach(function (i) { L[G[i].lineId] = 1; }); return { tpl: t, lines: L, n: grp.length }; };
            variants = [mk(A, tA), mk(B, tB)].sort(function (a, b) { return b.n - a.n; });
            rep = variants[0].tpl;
          }
        }
      }
    }
    var res = [];
    if (use.length >= 3) use.forEach(function (i) {   // ink noise from glyph interiors only (edges carry registration error)
      var s = stack[i];
      for (var y = 1; y < H - 1; y++) for (var x = 1; x < W - 1; x++) { var p = y * W + x; if (rep[p] > 0.9 && rep[p - 1] > 0.85 && rep[p + 1] > 0.85 && rep[p - W] > 0.85 && rep[p + W] > 0.85) res.push(s[p] - rep[p]); }
    });
    var Gu = use.map(function (i) { return G[i]; });
    return {
      ch: G[0].ch, n: Gu.length, W: W, H: H, cxg: cxg, byg: byg, tpl: rep, variants: variants, suspect: suspect,
      lOff: median(Gu.map(function (g) { return (g.l - g.cx) * (g.k || 1); })), rOff: median(Gu.map(function (g) { return (g.r - g.cx) * (g.k || 1); })),
      top: median(Gu.map(function (g) { return (g.base - g.t) * (g.k || 1); })), bottom: median(Gu.map(function (g) { return (g.b - g.base) * (g.k || 1); })),
      mass: median(Gu.map(function (g) { return g.mass; })), nComp: median(Gu.map(function (g) { return g.nComp; })),
      resid: res.length ? Math.sqrt(mean(res.map(function (v) { return v * v; }))) : -1
    };
  }
  function estimateSlant(cl) {
    var set = 'lIdbhk1HILTEFNMDBPR|ft', T = [];
    Object.keys(cl.classes).forEach(function (k) { if (set.indexOf(k) >= 0) T.push(cl.classes[k]); });
    if (!T.length) return 0;
    var best = -1, bt = 0;
    for (var t = -0.35; t <= 0.3501; t += 0.025) {
      var score = 0;
      T.forEach(function (g) {
        var cols = new Float64Array(g.W + 40);
        for (var v = 0; v < g.H; v++) for (var u = 0; u < g.W; u++) {
          var a = g.tpl[v * g.W + u]; if (a < 0.05) continue;
          var xx = Math.round(u + t * (v - g.byg)) + 20; if (xx >= 0 && xx < cols.length) cols[xx] += a;
        }
        for (var i = 0; i < cols.length; i++) score += cols[i] * cols[i];
      });
      if (score > best + 1e-9) { best = score; bt = t; }
    }
    return Math.abs(bt) < 0.03 ? 0 : bt;
  }

  // ------------------------------------------------------------------------------------
  // Fonts (fallback for characters missing from the library)
  // ------------------------------------------------------------------------------------
  var FONT_FAMILIES = [
    { id: 'arimo', family: 'Arimo', generic: 'sans', note: 'metric-compatible Arial/Helvetica' },
    { id: 'roboto-condensed', family: 'Roboto Condensed', generic: 'sans' },
    { id: 'pt-sans-narrow', family: 'PT Sans Narrow', generic: 'sans' },
    { id: 'archivo-narrow', family: 'Archivo Narrow', generic: 'sans' },
    { id: 'oswald', family: 'Oswald', generic: 'sans', note: 'very condensed' },
    { id: 'roboto', family: 'Roboto', generic: 'sans' },
    { id: 'open-sans', family: 'Open Sans', generic: 'sans' },
    { id: 'noto-sans', family: 'Noto Sans', generic: 'sans' },
    { id: 'carlito', family: 'Carlito', generic: 'sans', note: 'metric-compatible Calibri' },
    { id: 'tinos', family: 'Tinos', generic: 'serif', note: 'metric-compatible Times New Roman' },
    { id: 'caladea', family: 'Caladea', generic: 'serif', note: 'metric-compatible Cambria' },
    { id: 'cousine', family: 'Cousine', generic: 'mono', note: 'metric-compatible Courier New' }
  ];
  var FONT_CANDIDATES = [];
  FONT_FAMILIES.forEach(function (f) {
    [400, 700].forEach(function (wt) { FONT_CANDIDATES.push({ id: f.id, family: f.family, generic: f.generic, weight: wt, style: 'normal' }); });
  });
  [['arimo', 'Arimo', 'sans'], ['tinos', 'Tinos', 'serif']].forEach(function (f) { FONT_CANDIDATES.push({ id: f[0], family: f[1], generic: f[2], weight: 400, style: 'italic' }); });
  function fontKey(spec) { return spec.id + '-' + (spec.weight || 400) + '-' + (spec.style || 'normal'); }
  function defaultFontLoader(spec) {
    if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) return Promise.resolve(null);
    var fam = 'ScanMatch ' + spec.family;
    var url = 'https://cdn.jsdelivr.net/fontsource/fonts/' + spec.id + '@latest/latin-' + (spec.weight || 400) + '-' + (spec.style || 'normal') + '.woff2';
    try {
      var ff = new FontFace(fam, 'url(' + url + ')', { weight: String(spec.weight || 400), style: spec.style || 'normal' });
      return ff.load().then(function (f) { document.fonts.add(f); return fam; }, function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }
  /**
   * Register a font that is already usable by the canvas (FontFace added, or GlobalFonts.registerFromPath in Node).
   * @param {{id:string,family:string,weight?:number,style?:string,generic?:string}} spec
   * @param {string} cssFamily family name to use in ctx.font
   */
  function registerFont(spec, cssFamily) {
    var k = fontKey(spec);
    _fonts[k] = { key: k, spec: spec, family: cssFamily || spec.family, weight: spec.weight || 400, style: spec.style || 'normal' };
    measureFont(_fonts[k]);
    return _fonts[k];
  }
  /** Load font specs (default: FONT_CANDIDATES) with the configured loader. Resolves to registered records. */
  function loadFonts(specs) {
    specs = specs || FONT_CANDIDATES;
    var loader = _fontLoader || defaultFontLoader;
    return Promise.all(specs.map(function (sp) {
      var k = fontKey(sp); if (_fonts[k]) return Promise.resolve(_fonts[k]);
      return Promise.resolve().then(function () { return loader(sp); }).then(function (fam) {
        if (!fam) return null; return registerFont(sp, typeof fam === 'string' ? fam : (fam.family || sp.family));
      }, function () { return null; });
    })).then(function (r) { return r.filter(Boolean); });
  }
  var _scratch = null;
  function scratch(w, h) {
    w = Math.min(Math.ceil(w), 4096); h = Math.min(Math.ceil(h), 4096);
    if (!_scratch || _scratch.width < w || _scratch.height < h) {
      _scratch = createCanvas(Math.max(w, 256), Math.max(h, 256));   // sized to the request, never accumulated
    }
    return _scratch;
  }
  function fontCss(F, px) { return (F.style === 'italic' ? 'italic ' : '') + F.weight + ' ' + px.toFixed(3) + 'px "' + F.family + '"'; }
  function measureFont(F) {
    var hi = renderHi('H', F, 100, 1, 1, 0, 0), e = hi && edgesOf(hi.a, hi.W, hi.H);
    F.capRatio = e && e.max > 0 ? (hi.baseY - e.t) / 100 : 0.716;
    var hx = renderHi('x', F, 100, 1, 1, 0, 0), ex = hx && edgesOf(hx.a, hx.W, hx.H);
    F.xRatio = ex && ex.max > 0 ? (hx.baseY - ex.t) / 100 : 0.52;
    if (!(F.capRatio > 0.3 && F.capRatio < 1.2)) F.capRatio = 0.716;
  }
  /** Render one glyph on a scratch canvas. Returns alpha at SS x resolution with pen/baseline positions. */
  var _hiCache = new Map();
  function renderHi(ch, F, sizePx, SS, scaleX, slant, phaseX) {
    var key = F.key + '|' + ch + '|' + sizePx.toFixed(2) + '|' + SS + '|' + scaleX.toFixed(3) + '|' + (slant || 0).toFixed(3) + '|' + (Math.round((phaseX || 0) * 8) / 8);
    var hit = _hiCache.get(key); if (hit) return hit;
    var r = renderHi0(ch, F, sizePx, SS, scaleX, slant, Math.round((phaseX || 0) * 8) / 8);
    if (_hiCache.size > 3000) _hiCache.clear();
    _hiCache.set(key, r); return r;
  }
  function renderHi0(ch, F, sizePx, SS, scaleX, slant, phaseX) {
    var fs = sizePx * SS, c0 = scratch(64, 64), g0 = ctx2d(c0);
    g0.setTransform(1, 0, 0, 1, 0, 0); g0.font = fontCss(F, fs);
    var adv = g0.measureText(ch).width;
    var padL = Math.ceil(fs * 0.35 + Math.abs(slant) * fs) + 2 * SS;
    var W = Math.ceil((adv * scaleX + fs * 0.7 + Math.abs(slant) * fs * 1.2) / SS + 6) * SS, H = Math.ceil((fs * 1.8) / SS + 4) * SS;
    var c = scratch(W, H), g = ctx2d(c);
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H);
    var px = Math.round(padL / SS) * SS + phaseX * SS, py = Math.round(fs * 1.25 / SS) * SS + SS / 2;   // baseline on a pixel centre
    g.setTransform(scaleX, 0, -slant, 1, px, py); g.font = fontCss(F, fs); g.fillStyle = '#000'; g.textBaseline = 'alphabetic';
    g.fillText(ch, 0, 0);
    g.setTransform(1, 0, 0, 1, 0, 0);
    var d = g.getImageData(0, 0, W, H).data, a = new Float32Array(W * H);
    for (var i = 0; i < W * H; i++) a[i] = d[i * 4 + 3] / 255;
    return { a: a, W: W, H: H, penX: px, baseY: py, adv: adv * scaleX, SS: SS };
  }
  function downsample(a, W, H, SS) {
    var w = W / SS, h = H / SS, o = new Float32Array(w * h), inv = 1 / (SS * SS);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var s = 0; for (var j = 0; j < SS; j++) { var row = (y * SS + j) * W + x * SS; for (var i = 0; i < SS; i++) s += a[row + i]; }
      o[y * w + x] = s * inv;
    }
    return o;
  }
  /** Morphological thicken (delta>0) / thin (delta<0), delta in hi-res pixels, via EDT. */
  function morph(a0, W0, H0, delta) {
    if (Math.abs(delta) < 0.2) return a0;
    var C0 = inkCrop(a0, W0, H0, 0.02, Math.ceil(Math.abs(delta)) + 2); if (!C0) return a0;
    var r0 = morphFull(C0.a, C0.w, C0.h, delta), out = new Float32Array(W0 * H0);
    for (var j = 0; j < C0.h; j++) for (var i = 0; i < C0.w; i++) out[(j + C0.y0) * W0 + i + C0.x0] = r0[j * C0.w + i];
    return out;
  }
  function morphFull(a, W, H, delta) {
    var n = W * H, on = new Uint8Array(n), o = new Float32Array(n), i, d2;
    if (delta > 0) {
      for (i = 0; i < n; i++) on[i] = a[i] >= 0.5 ? 1 : 0;
      d2 = edt2(on, W, H); var t2 = delta * delta;
      for (i = 0; i < n; i++) o[i] = on[i] ? 1 : (d2[i] <= t2 ? 1 : (d2[i] <= (delta + 1) * (delta + 1) ? clamp(delta + 1 - Math.sqrt(d2[i]), 0, 1) : 0));
    } else {
      for (i = 0; i < n; i++) on[i] = a[i] < 0.5 ? 1 : 0;
      d2 = edt2(on, W, H); var e = -delta;
      for (i = 0; i < n; i++) { if (on[i]) { o[i] = 0; continue; } var dd = Math.sqrt(d2[i]); o[i] = dd > e + 1 ? 1 : clamp(dd - e, 0, 1); }
    }
    return o;
  }
  /**
   * Degradation model: font glyph -> scanned-looking alpha (stroke adjust, pixel integration, blur).
   * Returns {a,w,h,penX,baseY} at 1x with penX/baseY in index space of the returned array.
   */
  var _dgCache = new Map();
  function degradeGlyph(ch, F, p) {
    var key = F.key + '|' + ch + '|' + p.sizePx.toFixed(2) + '|' + (p.scaleX || 1).toFixed(3) + '|' + (p.slant || 0).toFixed(3) + '|' + (Math.round((p.phase || 0) * 8) / 8) + '|' + (p.deltaHi || 0).toFixed(2) + '|' + (p.sigma || 0).toFixed(3);
    var hit = _dgCache.get(key); if (hit) return hit;
    var r = degradeGlyph0(ch, F, p);
    if (_dgCache.size > 3000) _dgCache.clear();
    _dgCache.set(key, r); return r;
  }
  function degradeGlyph0(ch, F, p) {
    // supersampling adapts to size (deltaHi is in quarter-pixel units regardless of SS)
    var SS = p.sizePx > 120 ? 1 : (p.sizePx > 44 ? 2 : (p.sizePx > 30 ? 3 : 4)), hi = renderHi(ch, F, p.sizePx, SS, p.scaleX || 1, p.slant || 0, p.phase || 0);
    var a = morph(hi.a, hi.W, hi.H, (p.deltaHi || 0) * SS / 4);
    var lo = downsample(a, hi.W, hi.H, SS), w = hi.W / SS, h = hi.H / SS;
    lo = gaussBlur(lo, w, h, p.sigma || 0);
    return { a: lo, w: w, h: h, penX: hi.penX / SS - 0.5, baseY: hi.baseY / SS - 0.5, adv: hi.adv / SS };
  }
  function binIoU(A, aw, ah, ax, ay, B, bw, bh, bx, by) {
    // A anchor (ax,ay), B anchor (bx,by): overlay anchors, IoU of (alpha>=0.5)
    var dx = Math.round(bx - ax), dy = Math.round(by - ay), inter = 0, uni = 0;
    var x0 = Math.min(0, -dx), y0 = Math.min(0, -dy), x1 = Math.max(aw, bw - dx), y1 = Math.max(ah, bh - dy);
    for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) {
      var va = (x >= 0 && y >= 0 && x < aw && y < ah) ? A[y * aw + x] >= 0.5 : false;
      var xb = x + dx, yb = y + dy;
      var vb = (xb >= 0 && yb >= 0 && xb < bw && yb < bh) ? B[yb * bw + xb] >= 0.5 : false;
      if (va || vb) { uni++; if (va && vb) inter++; }
    }
    return uni ? inter / uni : 0;
  }
  /** Soft IoU (sum min / sum max) after sub-pixel alignment of centroid x and baseline. */
  function alignedSoftIoU(T, gl) {
    var cxG = centroidX(gl.a, gl.w, gl.h);
    var B = resampleSep(gl.a, gl.w, gl.h, T.W, T.H, 1, cxG - T.cxg, 1, gl.baseY - T.byg);
    var mn = 0, mx = 0;
    for (var i = 0; i < B.length; i++) { var a = T.tpl[i], b = B[i]; mn += a < b ? a : b; mx += a > b ? a : b; }
    // ink of the candidate falling outside the template grid counts as mismatch
    var tot = 0; for (i = 0; i < gl.a.length; i++) tot += gl.a[i];
    var inB = 0; for (i = 0; i < B.length; i++) inB += B[i];
    mx += Math.max(0, tot - inB);
    return mx > 0 ? mn / mx : 0;
  }
  function centroidX(A, w, h) { var s = 0, m = 0; for (var i = 0; i < A.length; i++) { s += A[i] * (i % w); m += A[i]; } return m > 0 ? s / m : w / 2; }
  function inkW(A, w, h) { var e = edgesOf(A, w, h); return e ? e.r - e.l : 0; }
  /**
   * Template-match every registered font against the cluster's library glyphs (IoU of binarised
   * shapes at equal cap height, after fitting a horizontal scale). Stores and returns cl.fallback.
   */
  function matchCluster(cl, lib, opts) {
    opts = opts || {};
    var fonts = Object.keys(_fonts).map(function (k) { return _fonts[k]; }).filter(function (F) { return F.key !== '__generic-400-normal'; });
    if (!fonts.length || !(cl.capH >= 4 && cl.capH <= 400)) return null;
    var cls = Object.keys(cl.classes).filter(function (k) { return /[A-Za-z0-9]/.test(k); })
      .sort(function (a, b) { return cl.classes[b].n - cl.classes[a].n; }).slice(0, opts.maxClasses || 12);
    if (!cls.length) cls = Object.keys(cl.classes).slice(0, 10);
    if (!cls.length) return null;
    function evalFont(F, use, calibrate) {
      var sizePx = cl.capH / F.capRatio, p = { sizePx: sizePx, scaleX: 1, slant: cl.slant, sigma: cl.blurSigma, deltaHi: 0 };
      function fitSx() {
        var ratios = [];
        use.forEach(function (k) { var T = cl.classes[k], gl = degradeGlyph(k, F, p), fw = inkW(gl.a, gl.w, gl.h); if (fw > 1) ratios.push((T.rOff - T.lOff) / fw * p.scaleX); });
        p.scaleX = ratios.length ? clamp(median(ratios), 0.55, 1.4) : 1;
      }
      fitSx();
      if (calibrate) {
        for (var it = 0; it < calibrate; it++) {
          var st = []; use.slice(0, 5).forEach(function (k) { var g = degradeGlyph(k, F, p); strokeSamples(g.a, g.w, g.h, st); });
          if (!st.length) break;
          p.deltaHi = clamp(p.deltaHi + (cl.strokeWeight - iqMean(st)) * 2, -10, 10);
          p.sizePx = (cl.capH - p.deltaHi / 2) / F.capRatio;
        }
        fitSx();
      }
      var sc = 0, wsum = 0;
      use.forEach(function (k) {
        var T = cl.classes[k], gl = degradeGlyph(k, F, p);
        var iou = alignedSoftIoU(T, gl);
        var wt = Math.sqrt(T.n); sc += iou * wt; wsum += wt;
      });
      var iouM = wsum ? sc / wsum : 0;
      return { key: F.key, family: F.spec.family, cssFamily: F.family, weight: F.weight, style: F.style, scaleX: p.scaleX, deltaHi: p.deltaHi,
        iou: iouM, sizePx: p.sizePx, score: iouM - 0.12 * Math.abs(Math.log(p.scaleX)) - 0.03 * Math.abs(p.deltaHi) / 4 };
    }
    var stage1 = fonts.map(function (F) { return evalFont(F, cls.slice(0, 5), 1); }).sort(function (a, b) { return b.score - a.score; });
    var ranking = stage1.slice(0, opts.finalists || 5).map(function (r) { return evalFont(_fonts[r.key], cls, 2); });
    ranking.sort(function (a, b) { return b.score - a.score; });
    var best = ranking[0], F = _fonts[best.key];
    var fb = { key: best.key, family: best.family, weight: best.weight, style: best.style, score: best.iou, prior: best.score, scaleX: best.scaleX,
      sizePx: best.sizePx, sigma: cl.blurSigma, deltaHi: best.deltaHi, ranking: ranking.slice(0, 6).map(function (r) { return { family: r.family, weight: r.weight, score: r.iou, scaleX: r.scaleX }; }) };
    calibrateFallback(cl, fb, F, cls);
    cl.fallback = fb; cl._fontTrack = null;
    // OCR mislabels: a class whose template disagrees with the matched font's glyph is not cloned
    fb.rejectedClasses = [];
    if (fb.score > 0.6 && opts.validateClasses !== false) {
      var ious = {};
      Object.keys(cl.classes).forEach(function (k) {
        if (!/[A-Za-z0-9]/.test(k)) return;
        var gl = degradeGlyph(k, F, { sizePx: fb.sizePx, scaleX: fb.scaleX, slant: cl.slant, sigma: fb.sigma, deltaHi: fb.deltaHi });
        ious[k] = alignedSoftIoU(cl.classes[k], gl);
      });
      var mi = median(Object.keys(ious).map(function (k) { return ious[k]; }));
      Object.keys(ious).forEach(function (k) {   // only rare classes that are clear outliers (frequent ones are reliable medians)
        var T = cl.classes[k];
        if (T.n <= 2 && ious[k] < 0.6 * mi) { T.weak = true; T.fontIoU = ious[k]; fb.rejectedClasses.push(k); }
      });
    }
    return fb;
  }  function calibrateFallback(cl, fb, F, cls) {
    var test = cls.slice(0, 8);
    for (var it = 0; it < 4; it++) {
      var st = [];
      test.forEach(function (k) { var g = degradeGlyph(k, F, { sizePx: fb.sizePx, scaleX: fb.scaleX, slant: cl.slant, sigma: fb.sigma, deltaHi: fb.deltaHi }); strokeSamples(g.a, g.w, g.h, st); });
      if (!st.length) break;
      var m = iqMean(st), err = cl.strokeWeight - m;
      fb.measuredStroke = m;
      if (Math.abs(err) < 0.02 * cl.strokeWeight) break;
      fb.deltaHi = clamp(fb.deltaHi + err * 4 / 2, -10, 10);
      fb.sizePx = (cl.capH - fb.deltaHi / 2) / F.capRatio;
    }
    for (var ib = 0; ib < 4; ib++) {
      var bl = [];
      test.slice(0, 6).forEach(function (k) { [0, 0.5].forEach(function (ph) { var g = degradeGlyph(k, F, { sizePx: fb.sizePx, scaleX: fb.scaleX, slant: cl.slant, sigma: fb.sigma, deltaHi: fb.deltaHi, phase: ph }); edgeSamples(g.a, g.w, g.h, bl, 800); }); });
      if (bl.length < 6) break;
      var mb = median(bl); fb.measuredBlur = mb;
      if (!(mb > 0.05) || Math.abs(mb - cl.blurSigma) <= 0.03 * cl.blurSigma) break;
      // measured blur^2 ~ sigma^2 + c  ->  adjust sigma^2 by the squared error
      var s2 = fb.sigma * fb.sigma + (cl.blurSigma * cl.blurSigma - mb * mb);
      fb.sigma = clamp(Math.sqrt(Math.max(0.0025, s2)), 0.05, 4);
    }
  }
  /**
   * Load candidate fonts (via the font loader) and pick the best fallback font per style cluster.
   * @param {Object} lib
   * @param {{candidates?:Array, clusters?:number[]}} [opts] clusters: only match these cluster indices
   * @returns {Promise<Array>} per-cluster fallback descriptors
   */
  function prepareFallback(lib, opts) {
    opts = opts || {};
    return loadFonts(opts.candidates).then(function () {
      return lib.clusters.map(function (cl, i) { return opts.clusters && opts.clusters.indexOf(i) < 0 ? cl.fallback : matchCluster(cl, lib, opts); });
    });
  }
  function fallbackFor(cl, lib) {
    if (cl.fallback && _fonts[cl.fallback.key]) return cl.fallback;
    if (Object.keys(_fonts).length) return matchCluster(cl, lib);
    // nothing loaded: generic CSS family
    var F = _fonts.__generic || registerFont({ id: '__generic', family: 'sans-serif', weight: 400 }, 'sans-serif');
    _fonts.__generic = F;
    cl.fallback = { key: F.key, family: 'sans-serif', weight: 400, style: 'normal', score: 0, scaleX: 0.85, sizePx: cl.capH / F.capRatio, sigma: cl.blurSigma, deltaHi: 0, generic: true };
    calibrateFallback(cl, cl.fallback, F, Object.keys(cl.classes).filter(function (k) { return /[a-z0-9]/i.test(k); }).slice(0, 8));
    return cl.fallback;
  }

  // ------------------------------------------------------------------------------------
  // Layout and rendering
  // ------------------------------------------------------------------------------------
  function hasFonts() { return Object.keys(_fonts).some(function (k) { return k.indexOf('__generic') !== 0; }); }
  function pairGap(cl, a, b) {
    var p = cl.pairs[a + '\u0001' + b];
    var lr = (cl.R[a] != null ? cl.R[a] : cl.meanR) + (cl.L[b] != null ? cl.L[b] : cl.meanL);
    if (!p) return lr;
    if (p.n >= 3) return p.gap;
    // few observations: trust them only when they agree with the sidebearing model
    var tol = Math.max(0.8, 0.06 * cl.capH);
    if (Math.abs(p.gap - lr) > tol) return lr;
    return (p.gap * p.n + lr) / (p.n + 1);
  }
  function fbMetrics(ch, cl, lib, s) {
    var fb = fallbackFor(cl, lib), F = _fonts[fb.key];
    var g = degradeGlyph(ch, F, { sizePx: fb.sizePx * s, scaleX: fb.scaleX, slant: cl.slant, sigma: fb.sigma, deltaHi: fb.deltaHi * s, phase: 0 });
    var e = edgesOf(g.a, g.w, g.h);
    return { fb: fb, F: F, l: e ? e.l - g.penX : 0, r: e ? e.r - g.penX : g.adv, adv: g.adv };
  }
  /** Ink gap between two characters from the matched font's own advances and kerning (scaled like the fallback glyphs). */
  function fontGap(cl, lib, a, b, s) {
    var ma = fbMetrics(a, cl, lib, s), mb = fbMetrics(b, cl, lib, s), F = ma.F, fb = ma.fb;
    var g0 = ctx2d(scratch(64, 64)); g0.setTransform(1, 0, 0, 1, 0, 0); g0.font = fontCss(F, fb.sizePx * s);
    var penB = (g0.measureText(a + b).width - g0.measureText(b).width) * fb.scaleX;
    var gap = penB + mb.l - ma.r;
    // track like the print: shift by the cluster's mean gap minus the font's mean gap for common pairs
    if (cl._fontTrack == null) {
      var d = [], ks = Object.keys(cl.pairs).filter(function (k) { return cl.pairs[k].n >= 2; }).slice(0, 12);
      ks.forEach(function (k) {
        var p = k.split('\u0001'); if (!cl.classes[p[0]] || !cl.classes[p[1]]) return;
        var A = fbMetrics(p[0], cl, lib, 1), B = fbMetrics(p[1], cl, lib, 1), g1 = ctx2d(scratch(64, 64));
        g1.setTransform(1, 0, 0, 1, 0, 0); g1.font = fontCss(F, fb.sizePx);
        var pb = (g1.measureText(p[0] + p[1]).width - g1.measureText(p[1]).width) * fb.scaleX;
        d.push(cl.pairs[k].gap - (pb + B.l - A.r));
      });
      cl._fontTrack = d.length ? median(d) : 0;
    }
    return gap + cl._fontTrack * s;
  }
  /** Lay out a text run: returns items with ink extents relative to the first ink-left (px). */
  function layoutRun(text, cl, lib, s, spaceScale) {
    var items = [], prev = null, spaces = 0, cs = chars(text);
    for (var i = 0; i < cs.length; i++) {
      var ch = cs[i];
      if (isSpace(ch)) { spaces++; continue; }
      var T = cl.classes[ch], it = { ch: ch, idx: i };
      if (T && T.weak && hasFonts()) T = null;      // only merged instances: prefer the matched font
      if (T) { it.type = 'lib'; it.T = T; it.w = (T.rOff - T.lOff) * s; }
      else { var m = fbMetrics(ch, cl, lib, s); it.type = 'fb'; it.m = m; it.w = m.r - m.l; }
      if (!prev) it.l = spaces ? spaces * cl.wordGap * s : 0;
      else if (spaces) it.l = prev.r + (cl.wordGap + (spaces - 1) * cl.wordGap * 0.8) * s * (spaceScale || 1);
      else if (it.type === 'lib' && prev.type === 'lib') it.l = prev.r + pairGap(cl, prev.ch, ch) * s;
      else it.l = prev.r + fontGap(cl, lib, prev.ch, ch, s);
      it.r = it.l + it.w; items.push(it); prev = it; spaces = 0;
    }
    return { items: items, width: items.length ? items[items.length - 1].r : 0 };
  }
  // Paint glyph alphas into a Float32 canvas (additive, clipped); positions in that canvas' coords
  function paintItems(items, cl, lib, s, A, W, H, ox, oy, baseFn, report, lineId) {
    items.forEach(function (it) {
      var x0, y0, gw, gh, ga, by;
      if (it.type === 'lib') {
        var T = it.T, cx = it.l - T.lOff * s, tpl = T.tpl;        // centroid page x
        if (T.variants && lineId != null) T.variants.forEach(function (v) { if (v.lines[lineId]) tpl = v.tpl; });
        by = baseFn(cx);
        if (Math.abs(s - 1) < 1e-3) {
          x0 = Math.floor(cx - T.cxg); y0 = Math.floor(by - T.byg); gw = T.W + 1; gh = T.H + 1;
          ga = resampleSep(tpl, T.W, T.H, gw, gh, 1, x0 - (cx - T.cxg), 1, y0 - (by - T.byg));
        } else {
          x0 = Math.floor(cx - T.cxg * s); y0 = Math.floor(by - T.byg * s); gw = Math.ceil(T.W * s) + 2; gh = Math.ceil(T.H * s) + 2;
          ga = resampleSep(tpl, T.W, T.H, gw, gh, 1 / s, (x0 - cx) / s + T.cxg, 1 / s, (y0 - by) / s + T.byg);
        }
      } else if (it.type === 'fb') {
        var m = it.m, penX = it.l - m.l;
        by = baseFn(penX);
        var ph = penX - Math.floor(penX), F = m.F, fb = m.fb;
        var g = degradeGlyph(it.ch, F, { sizePx: fb.sizePx * s, scaleX: fb.scaleX, slant: cl.slant, sigma: fb.sigma, deltaHi: fb.deltaHi * s, phase: ph });
        // g.penX corresponds to floor(penX)+ph; vertical: shift by fractional baseline using resample
        x0 = Math.floor(penX) - Math.round(g.penX - ph);
        var yShift = by - g.baseY; y0 = Math.floor(yShift);
        gw = g.w; gh = g.h + 1;
        ga = resampleSep(g.a, g.w, g.h, gw, gh, 1, 0, 1, -(yShift - y0));
        if (report) report.usedFallbackChars.push(it.ch);
      } else if (it.type === 'orig') {
        // moved original glyph pixels
        var o = it.orig, dx = it.l - o.l;
        x0 = Math.floor(o.bx0 + dx); y0 = o.by0; gw = o.cw + 1; gh = o.chh;
        ga = resampleSep(o.A, o.cw, o.chh, gw, gh, 1, x0 - (o.bx0 + dx), 1, 0);
      }
      var gx0 = x0 - ox, gy0 = y0 - oy, bx = Infinity, byy = Infinity, bx1 = -Infinity, by1 = -Infinity;
      for (var y = 0; y < gh; y++) {
        var Y = gy0 + y; if (Y < 0 || Y >= H) continue;
        for (var x = 0; x < gw; x++) {
          var X = gx0 + x; if (X < 0 || X >= W) continue;
          var v = ga[y * gw + x]; if (v <= 0) continue;
          var q = Y * W + X, t = A[q] + v; A[q] = t > 1 ? 1 : t;
          if (v > 0.25) { if (X < bx) bx = X; if (X > bx1) bx1 = X; if (Y < byy) byy = Y; if (Y > by1) by1 = Y; }
        }
      }
      if (report && bx1 >= bx) report.glyphs.push({ ch: it.ch, type: it.type, x0: bx + ox, y0: byy + oy, x1: bx1 + ox + 1, y1: by1 + oy + 1 });
    });
  }

  /**
   * Render text with cloned glyphs (and matched-font fallback glyphs) at a segment's style.
   * @param {string} text
   * @param {Object} style from analyzeSegment (needs cluster, capHeight, baselineY, x; optional baselineSlope, inkColor)
   * @param {Object} lib
   * @param {{x?:number, maxWidth?:number, wrap?:boolean, align?:'left'|'right'|'center', lineHeight?:number}} [opts]
   * @returns {{canvas, x:number, y:number, w:number, h:number, usedFallbackChars:string[], overflow:boolean, width:number, alpha:Float32Array, glyphs:Array}}
   */
  function renderText(text, style, lib, opts) {
    opts = opts || {};
    var cl = lib.clusters[style.cluster] || lib.clusters[0];
    var s = style.capHeight > 0 ? style.capHeight / cl.capH : 1; if (Math.abs(s - 1) < 0.015) s = 1;
    var lines = [String(text)], maxW = opts.maxWidth, overflow = false;
    var lay = lines.map(function (t) { return layoutRun(t, cl, lib, s); });
    if (maxW && lay[0].width > maxW) {
      if (opts.wrap) {
        var wordsT = String(text).split(/\s+/), cur = '', out = [];
        wordsT.forEach(function (wd) {
          var trial = cur ? cur + ' ' + wd : wd;
          if (cur && layoutRun(trial, cl, lib, s).width > maxW) { out.push(cur); cur = wd; } else cur = trial;
        });
        if (cur) out.push(cur);
        lines = out; lay = lines.map(function (t) { return layoutRun(t, cl, lib, s); });
      }
      overflow = lay.some(function (L) { return L.width > maxW; });
    }
    var pitch = opts.lineHeight || cl.linePitch * s;
    var x = opts.x != null ? opts.x : style.x, slope = style.baselineSlope || 0, y0b = style.baselineY;
    var top = Math.floor(y0b - cl.capH * s * 1.6 - 4), bottom = Math.ceil(y0b + (lines.length - 1) * pitch + cl.capH * s * 0.7 + 6);
    var maxWidth = Math.max.apply(null, lay.map(function (L) { return L.width; }));
    var left = Math.floor(x - cl.capH * s - 8 - (opts.align === 'right' ? maxWidth : opts.align === 'center' ? maxWidth / 2 : 0));
    var W = Math.ceil(maxWidth + 2 * cl.capH * s + 16 + Math.abs(slope) * maxWidth), H = bottom - top + Math.ceil(Math.abs(slope) * maxWidth) + 2;
    if (opts.align === 'right' || opts.align === 'center') W += maxWidth;
    var A = new Float32Array(W * H), report = { usedFallbackChars: [], glyphs: [] };
    lay.forEach(function (L, li) {
      var area = maxW || L.width, startX = x;
      if (opts.align === 'right') startX = (maxW ? x + maxW : x) - L.width;
      else if (opts.align === 'center') startX = (maxW ? x + maxW / 2 : x) - L.width / 2;
      L.items.forEach(function (it) { it.l += startX; it.r += startX; });
      var by = y0b + li * pitch;
      paintItems(L.items, cl, lib, s, A, W, H, left, top, function (px) { return by + slope * (px - x); }, report, style.lineId);
    });
    // trim
    var bx0 = W, by0 = H, bx1 = -1, by1 = -1;
    for (var yy = 0; yy < H; yy++) for (var xx = 0; xx < W; xx++) if (A[yy * W + xx] > 0.003) { if (xx < bx0) bx0 = xx; if (xx > bx1) bx1 = xx; if (yy < by0) by0 = yy; if (yy > by1) by1 = yy; }
    if (bx1 < 0) { bx0 = 0; by0 = 0; bx1 = 0; by1 = 0; }
    var tw = bx1 - bx0 + 1, th = by1 - by0 + 1, ta = new Float32Array(tw * th);
    for (yy = 0; yy < th; yy++) for (xx = 0; xx < tw; xx++) ta[yy * tw + xx] = A[(yy + by0) * W + xx + bx0];
    var ink = style.inkColor || lib.inkRGB, rgba = new Uint8ClampedArray(tw * th * 4);
    for (var i = 0; i < tw * th; i++) { rgba[i * 4] = ink[0]; rgba[i * 4 + 1] = ink[1]; rgba[i * 4 + 2] = ink[2]; rgba[i * 4 + 3] = Math.round(ta[i] * 255); }
    var uniq = report.usedFallbackChars.filter(function (c, k, a) { return a.indexOf(c) === k; });
    return {
      canvas: rgbaToCanvas(rgba, tw, th), x: left + bx0, y: top + by0, w: tw, h: th, alpha: ta,
      usedFallbackChars: uniq, overflow: overflow, width: maxWidth, lines: lines.length, glyphs: report.glyphs,
      fallbackFont: uniq.length && cl.fallback ? cl.fallback.family + ' ' + cl.fallback.weight : null
    };
  }

  // ------------------------------------------------------------------------------------
  // Inpainting
  // ------------------------------------------------------------------------------------
  /**
   * Core fill. R: {w,h,rgba}; A: alpha; lines: ruling-line bits; mask: 1 = fill.
   * Returns {r,g,b} Float32 planes (whole region) with only mask pixels changed.
   */
  function inpaintCore(R, A, lines, mask, o) {
    o = o || {};
    var w = R.w, h = R.h, n = w * h, d = R.rgba, i, x, y, c;
    var outR = new Float32Array(n), outG = new Float32Array(n), outB = new Float32Array(n), planes = [outR, outG, outB];
    for (i = 0; i < n; i++) { outR[i] = d[i * 4]; outG[i] = d[i * 4 + 1]; outB[i] = d[i * 4 + 2]; }
    var rb = o.lineBand != null ? o.lineBand : 2;
    var band = lineBandOf(lines, w, h, rb), hb = band.h, vb = band.v;
    var bad = new Uint8Array(n);
    for (i = 0; i < n; i++) bad[i] = (mask[i] || A[i] > 0.1 || hb[i] || vb[i]) ? 1 : 0;
    // smooth paper field per channel (cell medians of clean paper)
    var cell = o.cell || 12, nx = Math.max(1, Math.ceil(w / cell)), ny = Math.max(1, Math.ceil(h / cell));
    var P = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
    for (c = 0; c < 3; c++) {
      var gv = new Float32Array(nx * ny);
      for (var cy = 0; cy < ny; cy++) for (var cx = 0; cx < nx; cx++) {
        var vals = [];
        for (y = cy * cell; y < Math.min(h, cy * cell + cell); y++) for (x = cx * cell; x < Math.min(w, cx * cell + cell); x++) { i = y * w + x; if (!bad[i]) vals.push(d[i * 4 + c]); }
        gv[cy * nx + cx] = vals.length >= cell * cell * 0.15 ? median(vals) : NaN;
      }
      fillNaNGrid(gv, nx, ny, 230);
      var G = { cell: cell, nx: nx, ny: ny, v: gv, ox: 0, oy: 0 };
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) P[c][y * w + x] = gridSample(G, x, y);
    }
    // paper noise (for synthetic fallback)
    var res = [];
    for (i = 0; i < n; i += 3) if (!bad[i]) res.push(0.299 * (d[i * 4] - P[0][i]) + 0.587 * (d[i * 4 + 1] - P[1][i]) + 0.114 * (d[i * 4 + 2] - P[2][i]));
    var sigP = res.length > 20 ? 1.4826 * median(res.map(Math.abs)) : (o.paperNoise || 2);
    // integral image of bad pixels for clean-tile search
    var I = new Int32Array((w + 1) * (h + 1));
    for (y = 0; y < h; y++) { var rs = 0; for (x = 0; x < w; x++) { rs += bad[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + rs; } }
    function clean(sx, sy, T) { if (sx < 0 || sy < 0 || sx + T > w || sy + T > h) return false; return I[(sy + T) * (w + 1) + sx + T] - I[sy * (w + 1) + sx + T] - I[(sy + T) * (w + 1) + sx] + I[sy * (w + 1) + sx] === 0; }
    // mask bbox
    var mx0 = w, my0 = h, mx1 = -1, my1 = -1;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) if (mask[y * w + x]) { if (x < mx0) mx0 = x; if (x > mx1) mx1 = x; if (y < my0) my0 = y; if (y > my1) my1 = y; }
    if (mx1 < 0) return { planes: planes, P: P, sigP: sigP };
    var r = rng(o.seed || 12345), T = o.tile || 8, noiseAmt = o.noise != null ? o.noise : 1;
    for (var ty = my0; ty <= my1; ty += T) for (var tx = mx0; tx <= mx1; tx += T) {
      var has = false;
      for (y = ty; y < Math.min(h, ty + T) && !has; y++) for (x = tx; x < Math.min(w, tx + T); x++) if (mask[y * w + x]) { has = true; break; }
      if (!has) continue;
      // pick, among up to 4 clean nearby tiles, the one whose texture std is closest to the paper noise
      var sx = -1, sy = -1, found = 0, bestD = Infinity;
      for (var at = 0; at < 120 && found < 4; at++) {
        var rad = T * (2 + Math.floor(at / 8) * 2);
        var cx2 = tx + Math.round((r() * 2 - 1) * rad), cy2 = ty + Math.round((r() * 2 - 1) * rad);
        if (!clean(cx2, cy2, T)) continue;
        found++;
        var s1 = 0, s2 = 0, nn = 0;
        for (var yy3 = cy2; yy3 < cy2 + T; yy3++) for (var xx3 = cx2; xx3 < cx2 + T; xx3++) { var q3 = yy3 * w + xx3, rv3 = R.gray ? R.gray[q3] - (0.299 * P[0][q3] + 0.587 * P[1][q3] + 0.114 * P[2][q3]) : 0; s1 += rv3; s2 += rv3 * rv3; nn++; }
        var sd3 = Math.sqrt(Math.max(0, s2 / nn - (s1 / nn) * (s1 / nn))), dd = Math.abs(sd3 - sigP) + Math.abs(s1 / nn) * 0.5;
        if (dd < bestD) { bestD = dd; sx = cx2; sy = cy2; }
      }
      for (y = ty; y < Math.min(h, ty + T); y++) for (x = tx; x < Math.min(w, tx + T); x++) {
        i = y * w + x; if (!mask[i]) continue;
        if (sx >= 0) {
          var j = (sy + y - ty) * w + (sx + x - tx);
          for (c = 0; c < 3; c++) planes[c][i] = P[c][i] + noiseAmt * (d[j * 4 + c] - P[c][j]);
        } else {
          var nz = gaussRand(r) * sigP * noiseAmt;
          for (c = 0; c < 3; c++) planes[c][i] = P[c][i] + nz;
        }
      }
    }
    // ruling lines: extend across the hole along their direction
    function endVals(xa, ya, stepx, stepy, out) {   // median of up to 3 pixels beyond (xa,ya)
      for (c = 0; c < 3; c++) {
        var v = [];
        for (var k = 0; k < 3; k++) {
          var xx = xa + stepx * k, yy = ya + stepy * k; if (xx < 0 || yy < 0 || xx >= w || yy >= h) break;
          var q = yy * w + xx; if (mask[q]) break; v.push(d[q * 4 + c]);
        }
        out[c] = v.length ? median(v) : NaN;
      }
      return out;
    }
    var lv = [0, 0, 0], rv = [0, 0, 0], filledH = new Uint8Array(n);
    for (y = 0; y < h; y++) {
      x = 0;
      while (x < w) {
        if (!(mask[y * w + x] && hb[y * w + x])) { x++; continue; }
        var xs = x; while (x < w && mask[y * w + x]) x++;
        var xe = x - 1, xl = xs - 1, xr = xe + 1;
        if (xl < 0 || xr >= w || !hb[y * w + xl] || !hb[y * w + xr]) continue;
        endVals(xl, y, -1, 0, lv); endVals(xr, y, 1, 0, rv);
        if (isNaN(lv[0]) || isNaN(rv[0])) continue;
        for (var xx = xs; xx <= xe; xx++) {
          if (!hb[y * w + xx]) continue;
          var t = (xx - xl) / (xr - xl), nz2 = gaussRand(r) * sigP * 0.5 * noiseAmt;
          for (c = 0; c < 3; c++) planes[c][y * w + xx] = lv[c] * (1 - t) + rv[c] * t + nz2;
          filledH[y * w + xx] = 1;
        }
      }
    }
    for (x = 0; x < w; x++) {
      y = 0;
      while (y < h) {
        if (!(mask[y * w + x] && vb[y * w + x])) { y++; continue; }
        var ys = y; while (y < h && mask[y * w + x]) y++;
        var ye = y - 1, yu = ys - 1, yd = ye + 1;
        if (yu < 0 || yd >= h || !vb[yu * w + x] || !vb[yd * w + x]) continue;
        endVals(x, yu, 0, -1, lv); endVals(x, yd, 0, 1, rv);
        if (isNaN(lv[0]) || isNaN(rv[0])) continue;
        for (var yy2 = ys; yy2 <= ye; yy2++) {
          if (!vb[yy2 * w + x]) continue;
          var t2 = (yy2 - yu) / (yd - yu), nz3 = gaussRand(r) * sigP * 0.5 * noiseAmt, q2 = yy2 * w + x;
          for (c = 0; c < 3; c++) { var v2 = lv[c] * (1 - t2) + rv[c] * t2 + nz3; planes[c][q2] = filledH[q2] ? Math.min(planes[c][q2], v2) : v2; }
        }
      }
    }
    return { planes: planes, P: P, sigP: sigP };
  }

  function normMask(mask, size) {
    // -> {x,y,w,h,data}
    if (mask && mask.data && mask.w != null) return mask;
    var rects = Array.isArray(mask) ? mask : [mask];
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    rects.forEach(function (r) {
      var a = r.x0 != null ? r : { x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h };
      x0 = Math.min(x0, a.x0); y0 = Math.min(y0, a.y0); x1 = Math.max(x1, a.x1); y1 = Math.max(y1, a.y1);
    });
    x0 = clamp(Math.floor(x0), 0, size.w); y0 = clamp(Math.floor(y0), 0, size.h); x1 = clamp(Math.ceil(x1), 0, size.w); y1 = clamp(Math.ceil(y1), 0, size.h);
    var w = x1 - x0, h = y1 - y0, data = new Uint8Array(Math.max(0, w * h));
    rects.forEach(function (r) {
      var a = r.x0 != null ? r : { x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h };
      for (var y = Math.max(y0, Math.floor(a.y0)); y < Math.min(y1, Math.ceil(a.y1)); y++)
        for (var x = Math.max(x0, Math.floor(a.x0)); x < Math.min(x1, Math.ceil(a.x1)); x++) data[(y - y0) * w + x - x0] = 1;
    });
    return { x: x0, y: y0, w: w, h: h, data: data };
  }
  /**
   * Remove pixels under `mask` and fill with paper texture; ruling lines crossing the hole are
   * continued. Only mask pixels change.
   * @param {*} img page image
   * @param {{x,y,w,h,data:Uint8Array}|Array<{x0,y0,x1,y1}>|{x0,y0,x1,y1}} mask page-pixel mask or rectangles
   * @param {{lib?:Object, capH?:number, seed?:number, noise?:number, pad?:number}} [opts]
   * @returns {{canvas, x:number, y:number, w:number, h:number}}
   */
  function inpaint(img, mask, opts) {
    opts = opts || {};
    var size = imgSize(img), M = normMask(mask, size);
    var capH = opts.capH || (opts.lib && opts.lib.symH ? opts.lib.symH * 0.75 : Math.max(8, M.h * 0.7));
    var ctxPad = Math.round(Math.max(48, 3.5 * capH));
    var px = getRGBA(img, M.x - ctxPad, M.y - ctxPad, M.w + 2 * ctxPad, M.h + 2 * ctxPad);
    var useLib = opts.lib && opts.lib.width === size.w && opts.lib.height === size.h;
    var S = makeSurface(px, useLib ? opts.lib.paperGrid : null, useLib ? opts.lib.inkRatio : 0.2, { cell: clamp(Math.round(capH * 2), 16, 48) });
    if (!useLib) S.inkRatio = estimateInkRatio(S);
    var A = surfAlphaAll(S), L = Math.max(20, Math.round(2.5 * capH));
    surfLines(S, L, L);
    var m = new Uint8Array(S.w * S.h);
    for (var y = 0; y < M.h; y++) for (var x = 0; x < M.w; x++) {
      if (!M.data[y * M.w + x]) continue;
      var X = M.x + x - S.ox, Y = M.y + y - S.oy; if (X >= 0 && Y >= 0 && X < S.w && Y < S.h) m[Y * S.w + X] = 1;
    }
    var out = inpaintCore(S, A, S.lines, m, opts);
    var pad = opts.pad != null ? opts.pad : 1;
    var rx = clamp(M.x - pad - S.ox, 0, S.w), ry = clamp(M.y - pad - S.oy, 0, S.h), rx1 = clamp(M.x + M.w + pad - S.ox, 0, S.w), ry1 = clamp(M.y + M.h + pad - S.oy, 0, S.h);
    var c = planesToCanvas(out.planes, S.w, rx, ry, rx1 - rx, ry1 - ry);
    return { canvas: c, x: rx + S.ox, y: ry + S.oy, w: rx1 - rx, h: ry1 - ry };
  }
  function estimateInkRatio(S) {
    var P = surfPaperArray(S), v = [];
    for (var i = 0; i < S.w * S.h; i += 2) v.push(S.gray[i] / P[i]);
    var r = percentile(v, 0.005);
    return clamp(r < 0.9 ? r : 0.25, 0.02, 0.85);
  }
  function planesToCanvas(planes, W, x0, y0, w, h) {
    var d = new Uint8ClampedArray(w * h * 4);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var i = (y + y0) * W + x + x0, k = (y * w + x) * 4;
      d[k] = planes[0][i]; d[k + 1] = planes[1][i]; d[k + 2] = planes[2][i]; d[k + 3] = 255;
    }
    return rgbaToCanvas(d, w, h);
  }

  // ------------------------------------------------------------------------------------
  // Segment analysis
  // ------------------------------------------------------------------------------------
  function segmentContext(img, seg, lib, extra) {
    extra = extra || {};
    var size = imgSize(img), syms = seg.syms;
    var bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    syms.forEach(function (s) { bx0 = Math.min(bx0, s.x0); by0 = Math.min(by0, s.y0); bx1 = Math.max(bx1, s.x1); by1 = Math.max(by1, s.y1); });
    var hEst = Math.max(6, median(syms.map(function (s) { return s.y1 - s.y0; })) || lib.symH || 16);
    var mx = Math.round(Math.max(48, 3.5 * hEst)), my = Math.round(Math.max(32, 2.6 * hEst));
    var x0 = bx0 - mx - (extra.left || 0), x1 = bx1 + mx + (extra.right || 0);
    var px = getRGBA(img, x0, by0 - my, x1 - x0, (by1 - by0) + 2 * my);
    var useLib = lib.width === size.w && lib.height === size.h;
    var S = makeSurface(px, useLib ? lib.paperGrid : null, lib.inkRatio, { cell: clamp(Math.round(hEst * 2), 16, 48) });
    surfAlphaAll(S);
    var Lm = Math.max(30, Math.round(3.2 * (lib.symH || hEst)));
    surfLines(S, Lm, Lm);
    if (!extra.noRepair && FLAGS.repair) {   // same repair as buildLibrary (per word, reading order preserved)
      var rs2 = repairSymbols(S, syms);
      if (rs2.length === syms.length) for (var ri = 0; ri < syms.length; ri++) syms[ri] = rs2[ri];
    }
    var G = [];
    syms.forEach(function (s, i) { var g = refineSymbol(S, s, 3); if (g) { g.si = i; G.push(g); } });
    var B = G.length ? fitBaseline(G) : null;
    // prefer library line baseline when the segment is short
    var lineId = syms.length ? syms[0].lineId : null, LL = lineId != null && lib.lines[lineId];
    if (LL && (!B || B.n < 3)) {
      B = { a: LL.a - S.oy, slope: LL.slope, xc: LL.xc - S.ox, n: 0, fromLib: true };
      if (useLib) {} else B = B; // same coordinates only when page matches; otherwise keep segment fit
    }
    if (B) G.forEach(function (g) { g.base = baseAt(B, g.cx); });
    return { S: S, G: G, B: B, hEst: hEst, size: size };
  }
  function chooseCluster(ctx, seg, lib) {
    var votes = {}, nv = 0;
    seg.syms.forEach(function (s) { var c = lib.wordCluster[s.wordId]; if (c != null) { votes[c] = (votes[c] || 0) + 1; nv++; } });
    if (nv) {
      var best = null, bv = 0; Object.keys(votes).forEach(function (k) { if (votes[k] > bv) { bv = votes[k]; best = +k; } });
      return { cluster: best, how: 'member' };
    }
    var G = ctx.G, M = ctx.B ? lineMetrics(G, ctx.B) : { capH: NaN, xH: NaN };
    var stroke = strokeAT(G);
    var bestC = 0, bd = Infinity;
    lib.clusters.forEach(function (cl, ci) {
      var capH = M.capH > 0 ? M.capH : (M.xH > 0 ? M.xH * cl.capH / cl.xH : median(G.map(function (g) { return g.b - g.t; })));
      var d = Math.abs(Math.log(capH / cl.capH)) / 0.08;
      if (stroke > 0) d += Math.abs(stroke / capH - cl.strokeWeight / cl.capH) / (0.25 * cl.strokeWeight / cl.capH);
      var sh = [], s = capH / cl.capH;
      G.forEach(function (g) {
        var T = cl.classes[g.ch]; if (!T || !ctx.B) return;
        var crop = resampleSep(g.A, g.cw, g.chh, T.W, T.H, s, g.cx - T.cxg * s - g.bx0, s, g.base - T.byg * s - g.by0);
        sh.push(1 - ncc(crop, T.tpl));
      });
      if (sh.length) d += mean(sh) / 0.15;
      if (d < bd) { bd = d; bestC = ci; }
    });
    return { cluster: bestC, how: 'features', distance: bd };
  }
  function styleFromCtx(ctx, seg, lib) {
    var G = ctx.G, S = ctx.S, cc = chooseCluster(ctx, seg, lib), cl = lib.clusters[cc.cluster];
    var M = ctx.B ? lineMetrics(G, ctx.B) : { capH: NaN, xH: NaN };
    var capH = M.capH > 0 ? M.capH : (M.xH > 0 ? M.xH * cl.capH / cl.xH : cl.capH);
    var LL = seg.syms.length && lib.lines[seg.syms[0].lineId];
    if (cc.how === 'member') {
      var rs = [], segR = [];
      if (M.nCap >= 3 && M.capH > 0) segR.push(M.capH / cl.capH);
      if (M.nX >= 3 && M.xH > 0) segR.push(M.xH / cl.xH);
      if (segR.length === 2 && Math.abs(Math.log(segR[0] / segR[1])) > 0.06) segR = [];   // inconsistent evidence
      if (LL && LL.nCap >= 2 && LL.capH > 0) rs.push(LL.capH / cl.capH);
      if (LL && LL.nX >= 2 && LL.xH > 0) rs.push(LL.xH / cl.xH);
      // the OCR line is the robust reference; the segment's own glyphs override it only when they
      // clearly disagree (OCR lines that merge two type sizes, e.g. a 16 pt and a 14 pt heading)
      if (segR.length && (!rs.length || Math.abs(Math.log(median(segR) / median(rs))) > 0.1)) rs = segR;
      // words that were in the library: reuse the exact size factor used to normalise their templates
      var wsc = seg.syms.map(function (q) { return lib.wordScale && lib.wordScale[q.wordId]; }).filter(function (v) { return v > 0; });
      if (wsc.length) rs = [median(wsc)];
      var rr0 = rs.length ? median(rs) : 1;
      capH = (wsc.length ? Math.abs(rr0 - 1) < 1e-6 : Math.abs(Math.log(rr0)) < 0.05) ? cl.capH : cl.capH * rr0;
    } else if (!(M.capH > 0 && M.nCap >= 2) && !(M.xH > 0 && M.nX >= 2)) capH = cl.capH;
    var xH = M.xH > 0 ? M.xH : capH * cl.xH / cl.capH;
    // colours
    var inkV = [[], [], []], papV = [[], [], []], P = surfPaperArray(S), A = S._A;
    G.forEach(function (g) {
      for (var p = 0; p < g.A.length; p++) if (g.A[p] >= 0.85) {
        var q = ((g.by0 + Math.floor(p / g.cw)) * S.w + g.bx0 + p % g.cw) * 4;
        inkV[0].push(S.rgba[q]); inkV[1].push(S.rgba[q + 1]); inkV[2].push(S.rgba[q + 2]);
      }
    });
    for (var i = 0; i < S.w * S.h; i += 3) if (A[i] < 0.08 && !S.lineBand[i]) { papV[0].push(S.rgba[i * 4]); papV[1].push(S.rgba[i * 4 + 1]); papV[2].push(S.rgba[i * 4 + 2]); }
    var inkHue = inkV[0].length >= 8 ? [median(inkV[0]), median(inkV[1]), median(inkV[2])] : lib.inkRGB.slice();
    var paperColor = papV[0].length ? [median(papV[0]), median(papV[1]), median(papV[2])] : lib.paperRGB.slice();
    // full-coverage ink (alpha = 1 means gray = inkRatio * paper); keep the measured hue
    var lumI = Math.max(1, 0.299 * inkHue[0] + 0.587 * inkHue[1] + 0.114 * inkHue[2]), lumP = Math.max(1, 0.299 * paperColor[0] + 0.587 * paperColor[1] + 0.114 * paperColor[2]);
    var inkColor = inkHue.map(function (v) { return clamp(v / lumI * lib.inkRatio * lumP, 0, 255); });
    var bl = [], st = [];
    G.forEach(function (g) { if (bl.length < 120) edgeSamples(g.A, g.cw, g.chh, bl, 120); strokeSamples(g.A, g.cw, g.chh, st); });
    var blur = bl.length >= 8 ? median(bl) : cl.blurSigma;
    var stroke = st.length >= 8 ? iqMean(st) : cl.strokeWeight;
    var wr = [];
    G.forEach(function (g) { var T = cl.classes[g.ch]; if (T && T.rOff - T.lOff > 1) wr.push((g.r - g.l) / ((T.rOff - T.lOff) * capH / cl.capH)); });
    var left = G.length ? Math.min.apply(null, G.map(function (g) { return g.l; })) : 0;
    var right = G.length ? Math.max.apply(null, G.map(function (g) { return g.r; })) : 0;
    var fb = cl.fallback;
    return {
      capHeight: capH, xHeight: xH, baselineY: ctx.B ? baseAt(ctx.B, left) + S.oy : NaN, baselineSlope: ctx.B ? ctx.B.slope : 0,
      x: left + S.ox, right: right + S.ox, width: right - left,
      sizePx: capH / (fb && _fonts[fb.key] ? _fonts[fb.key].capRatio : 0.716),
      inkColor: inkColor, paperColor: paperColor, inkCss: rgbCss(inkColor), paperCss: rgbCss(paperColor),
      blurSigma: blur, strokeWeight: stroke, slant: cl.slant, scaleX: wr.length ? median(wr) : 1,
      cluster: cc.cluster, clusterMatch: cc.how, fallbackFont: fb ? fb.family + ' ' + fb.weight : null, lineId: seg.syms.length ? seg.syms[0].lineId : null,
      nGlyphs: G.length
    };
  }
  /**
   * Measure the visual style of an OCR segment (one line run of words).
   * @param {*} img page image
   * @param {Array} words tesseract-like words [{text, symbols:[...]}] or flat symbols
   * @param {Object} lib from buildLibrary
   * @returns {{capHeight,xHeight,baselineY,baselineSlope,x,right,width,sizePx,inkColor:number[],paperColor:number[],
   *            blurSigma,strokeWeight,slant,scaleX,cluster:number,clusterMatch:string,fallbackFont:?string}}
   */
  function analyzeSegment(img, words, lib) {
    var seg = normWords(words), ctx = segmentContext(img, seg, lib);
    return styleFromCtx(ctx, seg, lib);
  }

  // ------------------------------------------------------------------------------------
  // Replace
  // ------------------------------------------------------------------------------------
  function commonAffix(a, b) {
    var p = 0; while (p < a.length && p < b.length && a[p] === b[p]) p++;
    var q = 0; while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
    return { p: p, q: q };
  }
  /**
   * Replace an OCR segment with new text: inpaint old glyphs, render new ones with cloned glyphs.
   * @param {*} img page image (canvas / ImageData)
   * @param {Array} words segment words (tesseract shape) or flat symbols, in reading order
   * @param {string} newText
   * @param {Object} lib
   * @param {{align?:'left'|'right'|'center', preserveUnchanged?:boolean, maxWidth?:number, noise?:number, seed?:number, debug?:boolean}} [opts]
   *        preserveUnchanged (default true): characters of the unchanged prefix/suffix keep their original
   *        pixels (moved by sub-pixel resampling when the edit changes the width).
   * @returns {{patch, x:number, y:number, w:number, h:number, report:Object}}
   */
  function replaceSegment(img, words, newText, lib, opts) {
    opts = opts || {};
    var t0 = now(), seg = normWords(words);
    if (!seg.syms.length) throw new Error('ScanMatch.replaceSegment: segment has no symbols');
    var estW = Math.max(0, (chars(newText).length - chars(seg.text).length)) * (lib.symH || 16) * 0.8;
    var ctx = segmentContext(img, seg, lib, { left: opts.align === 'right' ? estW : (opts.align === 'center' ? estW / 2 : 0), right: opts.align === 'right' ? 0 : estW });
    var style = styleFromCtx(ctx, seg, lib), S = ctx.S, G = ctx.G, cl = lib.clusters[style.cluster];
    var s = style.capHeight / cl.capH; if (Math.abs(s - 1) < 0.015) s = 1;
    var oldCh = chars(seg.text), newCh = chars(newText);
    var glyphOf = {}; G.forEach(function (g) { glyphOf[g.si] = g; });
    // map old chars to refined glyphs
    var oldItems = oldCh.map(function (c, i) { var si = seg.map[i]; return { ch: c, si: si >= 0 ? si : null, g: si >= 0 ? glyphOf[si] : null }; });
    var preserve = opts.preserveUnchanged !== false;
    var aff = preserve ? commonAffix(oldCh, newCh) : { p: 0, q: 0 };
    if (preserve && aff.p === oldCh.length && aff.p === newCh.length) {
      return { patch: createCanvas(1, 1), x: Math.round(style.x), y: Math.round(style.baselineY), w: 0, h: 0, report: { noChange: true, style: style, ms: now() - t0 } };
    }
    // ensure prefix/suffix glyphs exist (otherwise fall back to full re-render)
    function okRange(a, b) { for (var i = a; i < b; i++) if (!isSpace(oldItems[i].ch) && !oldItems[i].g) return false; return true; }
    if (!okRange(0, aff.p) || !okRange(oldCh.length - aff.q, oldCh.length)) aff = { p: 0, q: 0 };
    // never split inside an old glyph mapping that spans multiple chars
    var midNew = newCh.slice(aff.p, newCh.length - aff.q).join('');
    var midOld = oldItems.slice(aff.p, oldCh.length - aff.q);
    var pre = oldItems.slice(0, aff.p), suf = oldItems.slice(oldCh.length - aff.q);
    var oldGl = oldItems.filter(function (o) { return o.g; }).map(function (o) { return o.g; });
    var oldL = Math.min.apply(null, oldGl.map(function (g) { return g.l; })), oldR = Math.max.apply(null, oldGl.map(function (g) { return g.r; }));
    // layout of the middle run
    var mid = layoutRun(midNew, cl, lib, s);
    var lastPre = null; for (var i = pre.length - 1; i >= 0; i--) if (pre[i].g) { lastPre = pre[i]; break; }
    var firstSuf = null; for (i = 0; i < suf.length; i++) if (suf[i].g) { firstSuf = suf[i]; break; }
    var preSpace = pre.length && isSpace(pre[pre.length - 1].ch) || (midNew.length && isSpace(midNew[0]));
    var sufSpace = suf.length && isSpace(suf[0].ch) || (midNew.length && isSpace(midNew[midNew.length - 1]));
    function gapBetween(a, b, sp) { return sp ? cl.wordGap * s : ((cl.classes[a] || cl.R[a] != null) && (cl.classes[b] || cl.L[b] != null) ? pairGap(cl, a, b) : cl.meanGap) * s; }
    var midItems = mid.items.map(function (it) { return it; }), midW = mid.width;
    var firstMid = midItems[0], lastMid = midItems[midItems.length - 1];
    // total new extent relative to the start of the middle run
    var preShift = 0, sufShift = 0, midStart;
    if (opts.align === 'right' && !firstSuf) {
      // anchor right edge of new text at old right edge
      var lead = lastPre ? gapBetween(lastPre.ch, firstMid ? firstMid.ch : '', preSpace) : 0;
      midStart = oldR - midW; preShift = lastPre ? (midStart - lead) - lastPre.g.r : 0;
      if (!midItems.length) preShift = oldR - (lastPre ? lastPre.g.r : oldR);
    } else {
      midStart = lastPre ? lastPre.g.r + (firstMid ? gapBetween(lastPre.ch, firstMid.ch, preSpace) : 0) : oldL;
      if (opts.align === 'right' || opts.align === 'center') {
        // keep the overall right edge (right) or centre (center) by shifting the prefix
        var midEnd0 = midItems.length ? midStart + midW : midStart;
        var sufStart0 = firstSuf ? (midItems.length ? midEnd0 + gapBetween(lastMid.ch, firstSuf.ch, sufSpace) : (lastPre ? lastPre.g.r + gapBetween(lastPre.ch, firstSuf.ch, preSpace || sufSpace) : oldL)) : midEnd0;
        var d0 = firstSuf ? sufStart0 - firstSuf.g.l : 0;
        var k = opts.align === 'right' ? 1 : 0.5;
        preShift = -k * d0; midStart += preShift;
      }
    }
    if (!midItems.length && lastPre) midStart = lastPre.g.r + preShift;
    midItems.forEach(function (it) { it.l += midStart; it.r += midStart; });
    var endMid = midItems.length ? midItems[midItems.length - 1].r : null;
    if (firstSuf) {
      var sufStart;
      if (midItems.length) sufStart = endMid + gapBetween(lastMid.ch, firstSuf.ch, sufSpace);
      else if (lastPre) sufStart = lastPre.g.r + preShift + gapBetween(lastPre.ch, firstSuf.ch, preSpace || sufSpace || midOld.some(function (o) { return isSpace(o.ch); }));
      else sufStart = oldL + preShift;
      sufShift = sufStart - firstSuf.g.l;
    }
    // final items: prefix (orig, maybe shifted), middle (lib/fb), suffix (orig shifted)
    var items = [], removed = [];
    pre.forEach(function (o) { if (!o.g) return; if (Math.abs(preShift) > 0.02) { items.push({ ch: o.ch, type: 'orig', orig: o.g, l: o.g.l + preShift - S.ox + S.ox }); removed.push(o.g); } });
    midOld.forEach(function (o) { if (o.g) removed.push(o.g); });
    suf.forEach(function (o) { if (!o.g) return; if (Math.abs(sufShift) > 0.02) { items.push({ ch: o.ch, type: 'orig', orig: o.g, l: o.g.l + sufShift }); removed.push(o.g); } });
    // convert orig items to surface coordinates (G are in surface coords already); middle items are in surface coords too
    midItems.forEach(function (it) { items.push(it); });
    // --- mask of removed glyphs
    var w = S.w, h = S.h, n = w * h, mask = new Uint8Array(n), keepM = new Uint8Array(n);
    function stamp(g, arr) { for (var y = 0; y < g.chh; y++) for (var x = 0; x < g.cw; x++) if (g.m[y * g.cw + x]) arr[(g.by0 + y) * w + g.bx0 + x] = 1; }
    removed.forEach(function (g) { stamp(g, mask); });
    G.forEach(function (g) { if (removed.indexOf(g) < 0) stamp(g, keepM); });
    // safety net: dark (non-line) pixels inside the OCR boxes of removed symbols are erased too,
    // so ink that component analysis assigned elsewhere (touching glyphs, OCR box drift) cannot survive
    var removedSyms = midOld.map(function (o) { return o.si; }).filter(function (v) { return v != null; });
    pre.concat(suf).forEach(function (o) { if (o.g && removed.indexOf(o.g) >= 0) removedSyms.push(o.si); });
    if (FLAGS.maskNet) removedSyms.forEach(function (si) {
      var sy = seg.syms[si]; if (!sy) return;
      for (var y = Math.max(0, Math.floor(sy.y0 - S.oy) - 1); y < Math.min(h, Math.ceil(sy.y1 - S.oy) + 1); y++)
        for (var x = Math.max(0, Math.floor(sy.x0 - S.ox) - 1); x < Math.min(w, Math.ceil(sy.x1 - S.ox) + 1); x++) {
          var q = y * w + x; if (S._A[q] > 0.3 && !S.lineBand[q] && !keepM[q]) mask[q] = 1;
        }
    });
    var rd = Math.max(2, Math.ceil(2 * style.blurSigma + 1.5));
    mask = dilate(mask, w, h, rd); keepM = dilate(keepM, w, h, 1);
    for (i = 0; i < n; i++) if (keepM[i]) mask[i] = 0;
    // --- inpaint
    var inp = inpaintCore(S, S._A, S.lines, mask, { seed: opts.seed || 1, noise: opts.noise, cell: clamp(Math.round(2 * ctx.hEst), 16, 48) });
    // --- render new glyphs into surface-sized alpha
    var NA = new Float32Array(n), report = { usedFallbackChars: [], glyphs: [] };
    var B = ctx.B || { a: style.baselineY - S.oy, slope: 0, xc: 0 };
    paintItems(items, cl, lib, s, NA, w, h, 0, 0, function (x) { return baseAt(B, x); }, report, seg.syms[0].lineId);
    report.glyphs.forEach(function (g) { g.x0 += S.ox; g.x1 += S.ox; g.y0 += S.oy; g.y1 += S.oy; });
    // --- composite (multiplicative ink over inpainted paper) + matched ink noise
    var ink = style.inkColor, pap = style.paperColor, kc = [ink[0] / Math.max(1, pap[0]), ink[1] / Math.max(1, pap[1]), ink[2] / Math.max(1, pap[2])];
    var pl = inp.planes, rr = rng((opts.seed || 1) * 7919 + 17), noiseAmt = opts.noise != null ? opts.noise : 1;
    var contrast = (1 - lib.inkRatio) * mean(pap), sigInk = cl.inkNoise * contrast, sigPap = inp.sigP;
    var extra = Math.sqrt(Math.max(0, sigInk * sigInk - (sigPap * lib.inkRatio) * (sigPap * lib.inkRatio))) * noiseAmt;
    for (i = 0; i < n; i++) {
      var a = NA[i]; if (a <= 0) continue;
      var nz = extra > 0 ? gaussRand(rr) * extra * a : 0;
      for (var c = 0; c < 3; c++) pl[c][i] = pl[c][i] * (1 - a * (1 - kc[c])) + nz;
    }
    // --- patch rectangle = changed pixels bbox
    var px0 = w, py0 = h, px1 = -1, py1 = -1;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var q = y * w + x;
      if (mask[q] || NA[q] > 0.002) { if (x < px0) px0 = x; if (x > px1) px1 = x; if (y < py0) py0 = y; if (y > py1) py1 = y; }
    }
    if (px1 < 0) { px0 = 0; py0 = 0; px1 = 0; py1 = 0; }
    px0 = Math.max(0, px0 - 1); py0 = Math.max(0, py0 - 1); px1 = Math.min(w - 1, px1 + 1); py1 = Math.min(h - 1, py1 + 1);
    var pw = px1 - px0 + 1, ph = py1 - py0 + 1;
    var patch = planesToCanvas(pl, w, px0, py0, pw, ph);
    var newL = Infinity, newR = -Infinity;
    report.glyphs.forEach(function (g) { newL = Math.min(newL, g.x0); newR = Math.max(newR, g.x1); });
    // clearance to neighbouring (non-segment) ink on the same line band: lets the editor detect collisions
    var bandT = Math.floor(baseAt(B, (newL + newR) / 2 - S.ox) - cl.capH * s), bandB = Math.ceil(baseAt(B, (newL + newR) / 2 - S.ox));
    // segment extent = new glyphs plus kept (unchanged, unmoved) glyphs of the segment
    var segL = newL, segR = newR;
    G.forEach(function (g) { if (removed.indexOf(g) < 0) { segL = Math.min(segL, g.l + S.ox); segR = Math.max(segR, g.r + S.ox); } });
    function clearance(dir) {
      var start = dir > 0 ? Math.ceil(segR - S.ox) + 1 : Math.floor(segL - S.ox) - 1;
      for (var d = 0; d < w; d++) {
        var x = start + dir * d; if (x < 0 || x >= w) return null;
        for (var y = Math.max(0, bandT); y <= Math.min(h - 1, bandB); y++) { var q = y * w + x; if (!mask[q] && !keepM[q] && NA[q] < 0.05 && S._A[q] > 0.4 && !S.lineBand[q]) return d; }
      }
      return null;
    }
    var clrR = isFinite(segR) ? clearance(1) : null, clrL = isFinite(segL) ? clearance(-1) : null, minGap = 0.35 * cl.wordGap * s;
    var uniq = report.usedFallbackChars.filter(function (c2, k2, a2) { return a2.indexOf(c2) === k2; });
    var rep = {
      clearance: { left: clrL, right: clrR }, collision: (clrR != null && clrR < minGap) || (clrL != null && clrL < minGap),
      oldText: seg.text, newText: String(newText), style: style, cluster: style.cluster, clusterMatch: style.clusterMatch,
      preserved: { prefix: aff.p, suffix: aff.q }, shift: { prefix: preShift, suffix: sufShift },
      usedFallbackChars: uniq, fallbackFont: uniq.length && cl.fallback ? { family: cl.fallback.family, weight: cl.fallback.weight, score: cl.fallback.score, scaleX: cl.fallback.scaleX } : null,
      glyphs: report.glyphs, oldWidth: oldR - oldL, newInkLeft: newL, newInkRight: newR,
      overflow: opts.maxWidth ? (newR - newL) > opts.maxWidth : false, ms: Math.round((now() - t0) * 10) / 10
    };
    if (opts.debug) {
      var oldInk = new Uint8Array(n); removed.forEach(function (g) { stamp(g, oldInk); });
      rep.debug = { surface: { x: S.ox, y: S.oy, w: w, h: h }, mask: mask, oldInk: oldInk, newAlpha: NA, paper: inp.P, lines: S.lines, patchInSurface: { x: px0, y: py0 } };
    }
    return { patch: patch, x: px0 + S.ox, y: py0 + S.oy, w: pw, h: ph, report: rep };
  }

  // ------------------------------------------------------------------------------------
  // Quality metrics
  // ------------------------------------------------------------------------------------
  function toGray(img) {
    if (img && img.gray && img.w) return img;
    var s = imgSize(img), px = getRGBA(img, 0, 0, s.w, s.h);
    return { gray: grayOf(px.data, s.w * s.h), w: s.w, h: s.h };
  }
  /**
   * SSIM (Gaussian window 11, sigma 1.5, on luma) and PSNR between two equally sized images.
   * @param {*} a canvas / ImageData / {gray,w,h}
   * @param {*} b same size as a
   * @returns {{ssim:number, psnr:number}}
   */
  function quality(a, b) {
    var A = toGray(a), B = toGray(b), w = Math.min(A.w, B.w), h = Math.min(A.h, B.h), n = w * h;
    var x = new Float32Array(n), y = new Float32Array(n), i, mse = 0;
    for (var j = 0; j < h; j++) for (var k = 0; k < w; k++) { x[j * w + k] = A.gray[j * A.w + k]; y[j * w + k] = B.gray[j * B.w + k]; }
    for (i = 0; i < n; i++) { var dd = x[i] - y[i]; mse += dd * dd; }
    mse /= Math.max(1, n);
    var xx = new Float32Array(n), yy = new Float32Array(n), xy = new Float32Array(n);
    for (i = 0; i < n; i++) { xx[i] = x[i] * x[i]; yy[i] = y[i] * y[i]; xy[i] = x[i] * y[i]; }
    function gb(Z) { return blurReflect(Z, w, h, 1.5); }
    var mx = gb(x), my = gb(y), sxx = gb(xx), syy = gb(yy), sxy = gb(xy), C1 = 6.5025, C2 = 58.5225, s = 0;
    for (i = 0; i < n; i++) {
      var vx = sxx[i] - mx[i] * mx[i], vy = syy[i] - my[i] * my[i], cv = sxy[i] - mx[i] * my[i];
      s += ((2 * mx[i] * my[i] + C1) * (2 * cv + C2)) / ((mx[i] * mx[i] + my[i] * my[i] + C1) * (vx + vy + C2));
    }
    return { ssim: n ? s / n : 1, psnr: mse > 0 ? 10 * Math.log10(255 * 255 / mse) : Infinity };
  }
  function blurReflect(A, w, h, sigma) {
    var k = gaussKernel(sigma), r = (k.length - 1) >> 1, t = new Float32Array(w * h), o = new Float32Array(w * h), x, y, i;
    function rf(v, n) { if (v < 0) v = -v - 1; if (v >= n) v = 2 * n - v - 1; return clamp(v, 0, n - 1); }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) { var s = 0; for (i = -r; i <= r; i++) s += A[y * w + rf(x + i, w)] * k[i + r]; t[y * w + x] = s; }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) { var s2 = 0; for (i = -r; i <= r; i++) s2 += t[rf(y + i, h) * w + x] * k[i + r]; o[y * w + x] = s2; }
    return o;
  }

  // ------------------------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------------------------
  var ScanMatch = {
    version: VERSION,
    buildLibrary: buildLibrary,
    analyzeSegment: analyzeSegment,
    renderText: renderText,
    inpaint: inpaint,
    replaceSegment: replaceSegment,
    quality: quality,
    symbolsFromTesseract: symbolsFromTesseract,
    prepareFallback: prepareFallback,
    loadFonts: loadFonts,
    registerFont: registerFont,
    matchFont: function (lib, clusterIndex) { return matchCluster(lib.clusters[clusterIndex || 0], lib); },
    FONT_CANDIDATES: FONT_CANDIDATES,
    /** @param {function(number,number):HTMLCanvasElement} fn */
    setCanvasFactory: function (fn) { _canvasFactory = fn; _scratch = null; },
    /** @param {function(Object):Promise<string|null>} fn spec -> css family name (or null when unavailable) */
    setFontLoader: function (fn) { _fontLoader = fn; },
    /** Measurement helpers (for tests/diagnostics; not a stable API). */
    util: {
      strokeSamples: strokeSamples, iqMean: iqMean, edgeSamples: edgeSamples, edgesOf: edgesOf, median: median, percentile: percentile,
      gaussBlur: gaussBlur, getRGBA: getRGBA, grayOf: grayOf, paperGrid: paperGrid, gridFill: gridFill, detectLines: detectLines,
      flags: FLAGS, degradeGlyph: degradeGlyph, fonts: function () { return _fonts; }, rgbaToCanvas: rgbaToCanvas, normWords: normWords
    }
  };

  root.ScanMatch = ScanMatch;
  if (typeof module !== 'undefined' && module.exports) module.exports = ScanMatch;
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this));