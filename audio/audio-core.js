/* Audio core: pure sound maths and file encoders.
   No DOM here, so it also runs under Node for tests.
   A "clip" is {sr: sampleRate, ch: [Float32Array, ...]} and is never changed in place:
   every function returns a new clip. */
(function (root) {
  "use strict";
  var AK = {};

  /* ---------- Formatting ---------- */
  AK.fmtTime = function (s, dec) {
    if (!isFinite(s) || s < 0) s = 0;
    var d = dec === undefined ? 1 : dec;
    var m = Math.floor(s / 60), r = s - m * 60;
    var rs = r.toFixed(d);
    if (parseFloat(rs) >= 60) { m += 1; rs = (0).toFixed(d); }
    var h = Math.floor(m / 60);
    if (h) { m = m % 60; return h + ":" + (m < 10 ? "0" : "") + m + ":" + (parseFloat(rs) < 10 ? "0" : "") + rs; }
    return m + ":" + (parseFloat(rs) < 10 ? "0" : "") + rs;
  };
  AK.fmtSize = function (b) {
    if (b < 1024) return b + " B";
    if (b < 1048576) return (b / 1024).toFixed(b < 10240 ? 1 : 0) + " KB";
    return (b / 1048576).toFixed(b < 10485760 ? 1 : 0) + " MB";
  };
  AK.dbToGain = function (db) { return Math.pow(10, db / 20); };
  AK.gainToDb = function (g) { return g > 0 ? 20 * Math.log10(g) : -Infinity; };

  /* ---------- Clip basics ---------- */
  AK.makeClip = function (nc, len, sr) {
    var ch = []; for (var c = 0; c < nc; c++) ch.push(new Float32Array(Math.max(1, len | 0)));
    return { sr: sr, ch: ch };
  };
  AK.len = function (c) { return c.ch[0].length; };
  AK.dur = function (c) { return c.ch[0].length / c.sr; };
  AK.copy = function (c) { return { sr: c.sr, ch: c.ch.map(function (d) { return new Float32Array(d); }) }; };
  AK.sec2s = function (c, t) { return Math.max(0, Math.min(AK.len(c), Math.round(t * c.sr))); };

  /* Keep samples [a, b) */
  AK.slice = function (c, a, b) {
    a = Math.max(0, a | 0); b = Math.min(AK.len(c), b | 0);
    if (b - a < 1) throw new Error("That part is too short.");
    return { sr: c.sr, ch: c.ch.map(function (d) { return d.slice(a, b); }) };
  };
  /* Remove samples [a, b) */
  AK.remove = function (c, a, b) {
    var n = AK.len(c); a = Math.max(0, a | 0); b = Math.min(n, b | 0);
    var len = n - (b - a);
    if (len < 1) throw new Error("That would remove all of the audio.");
    return { sr: c.sr, ch: c.ch.map(function (d) { var o = new Float32Array(len); o.set(d.subarray(0, a)); o.set(d.subarray(b), a); return o; }) };
  };
  /* Silence samples [a, b) */
  AK.silence = function (c, a, b) {
    var o = AK.copy(c); o.ch.forEach(function (d) { d.fill(0, Math.max(0, a), Math.min(d.length, b)); }); return o;
  };
  AK.reverse = function (c) { return { sr: c.sr, ch: c.ch.map(function (d) { return new Float32Array(d).reverse(); }) }; };

  /* Smooth fade (raised cosine). dir "in" or "out", over samples [a, b). */
  AK.fade = function (c, a, b, dir) {
    var o = AK.copy(c), n = Math.max(1, b - a);
    o.ch.forEach(function (d) {
      for (var i = Math.max(0, a); i < Math.min(d.length, b); i++) {
        var r = (i - a) / n, g = 0.5 - 0.5 * Math.cos(Math.PI * r);
        d[i] *= dir === "in" ? g : 1 - g;
      }
    });
    return o;
  };

  AK.peak = function (c) {
    var pk = 0;
    for (var k = 0; k < c.ch.length; k++) { var d = c.ch[k]; for (var i = 0; i < d.length; i++) { var v = d[i] < 0 ? -d[i] : d[i]; if (v > pk) pk = v; } }
    return pk;
  };
  AK.rms = function (c) {
    var s = 0, n = 0;
    for (var k = 0; k < c.ch.length; k++) { var d = c.ch[k]; for (var i = 0; i < d.length; i++) s += d[i] * d[i]; n += d.length; }
    return Math.sqrt(s / Math.max(1, n));
  };
  AK.gain = function (c, g) { return { sr: c.sr, ch: c.ch.map(function (d) { var o = new Float32Array(d.length); for (var i = 0; i < d.length; i++) o[i] = d[i] * g; return o; }) }; };
  AK.normalize = function (c, target) {
    var pk = AK.peak(c);
    if (pk < 1e-5) throw new Error("This audio is silent, so there is nothing to make louder.");
    return AK.gain(c, (target || 0.98) / pk);
  };

  /* Mix to 1 or 2 channels. */
  AK.toChannels = function (c, n) {
    var L = AK.len(c), nc = c.ch.length;
    if (n === nc) return c;
    if (n === 1) {
      var m = new Float32Array(L);
      for (var k = 0; k < nc; k++) { var d = c.ch[k]; for (var i = 0; i < L; i++) m[i] += d[i] / nc; }
      return { sr: c.sr, ch: [m] };
    }
    if (nc === 1) return { sr: c.sr, ch: [new Float32Array(c.ch[0]), new Float32Array(c.ch[0])] };
    /* more than 2 channels: odd channels left, even right */
    var l = new Float32Array(L), r = new Float32Array(L), nl = 0, nr = 0;
    for (var j = 0; j < nc; j++) { var s = c.ch[j], t = j % 2 ? r : l; if (j % 2) nr++; else nl++; for (var q = 0; q < L; q++) t[q] += s[q]; }
    for (var z = 0; z < L; z++) { l[z] /= nl; r[z] /= nr; }
    return { sr: c.sr, ch: [l, r] };
  };

  /* Put clips end to end. gapSec adds silence; xfadeSec overlaps neighbours with an equal-power crossfade. */
  AK.concat = function (clips, gapSec, xfadeSec) {
    if (!clips.length) throw new Error("Add some clips first.");
    var sr = clips[0].sr, nc = 1;
    clips.forEach(function (c) { if (c.sr !== sr) throw new Error("Clips must share one sample rate."); nc = Math.max(nc, c.ch.length); });
    var gap = Math.max(0, Math.round((gapSec || 0) * sr));
    var xf = Math.max(0, Math.round((xfadeSec || 0) * sr));
    if (xf) { gap = 0; clips.forEach(function (c) { xf = Math.min(xf, Math.floor(AK.len(c) / 2)); }); }
    var total = 0;
    clips.forEach(function (c, i) { total += AK.len(c); if (i) total += gap - xf; });
    var out = AK.makeClip(nc, total, sr), off = 0;
    clips.forEach(function (c, i) {
      var L = AK.len(c);
      for (var k = 0; k < nc; k++) {
        var src = c.ch[Math.min(k, c.ch.length - 1)], dst = out.ch[k];
        for (var s = 0; s < L; s++) {
          var g = 1;
          if (xf && i > 0 && s < xf) g = Math.sin((s / xf) * Math.PI / 2);
          if (xf && i < clips.length - 1 && s >= L - xf) g *= Math.cos(((s - (L - xf)) / xf) * Math.PI / 2);
          dst[off + s] += src[s] * g;
        }
      }
      off += L + (i < clips.length - 1 ? gap - xf : 0);
    });
    return out;
  };

  /* Look-ahead peak limiter. Gain never lets any sample exceed `ceiling`.
     Gain dips smoothly before a peak (attack) and recovers slowly after (release). */
  AK.limit = function (c, ceiling, attackMs, releaseMs) {
    ceiling = ceiling || 0.97;
    var L = AK.len(c), sr = c.sr, i;
    var att = Math.max(1, Math.round(sr * (attackMs || 5) / 1000)), rel = Math.max(1, Math.round(sr * (releaseMs || 120) / 1000));
    var g = new Float32Array(L), touched = 0;
    for (i = 0; i < L; i++) {
      var pk = 0;
      for (var k = 0; k < c.ch.length; k++) { var v = c.ch[k][i]; if (v < 0) v = -v; if (v > pk) pk = v; }
      g[i] = pk > ceiling ? ceiling / pk : 1;
    }
    var rs = 1 / rel, as = 1 / att;
    for (i = 1; i < L; i++) { var up = g[i - 1] + rs; if (up < g[i]) g[i] = up; }
    for (i = L - 2; i >= 0; i--) { var dn = g[i + 1] + as; if (dn < g[i]) g[i] = dn; }
    var out = AK.makeClip(c.ch.length, L, sr);
    for (i = 0; i < L; i++) if (g[i] < 0.999) touched++;
    for (var q = 0; q < c.ch.length; q++) {
      var s = c.ch[q], o = out.ch[q];
      for (i = 0; i < L; i++) { var x = s[i] * g[i]; o[i] = x > ceiling ? ceiling : x < -ceiling ? -ceiling : x; }
    }
    out.limited = touched / Math.max(1, L);
    return out;
  };

  /* 4-point Hermite resampling. Treats the clip as if it were recorded at `fromSr`, outputs at `toSr`.
     (fromSr = sr * speed gives "speed and pitch together".) */
  AK.resample = function (c, fromSr, toSr, outRate) {
    var L = AK.len(c), ratio = fromSr / toSr, N = Math.max(1, Math.floor(L / ratio));
    var out = AK.makeClip(c.ch.length, N, outRate || toSr);
    for (var k = 0; k < c.ch.length; k++) {
      var d = c.ch[k], o = out.ch[k];
      for (var i = 0; i < N; i++) {
        var p = i * ratio, j = Math.floor(p), f = p - j;
        var xm1 = d[j > 0 ? j - 1 : 0], x0 = d[j], x1 = d[j + 1 < L ? j + 1 : L - 1], x2 = d[j + 2 < L ? j + 2 : L - 1];
        if (x0 === undefined) x0 = 0;
        var c1 = 0.5 * (x1 - xm1), c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2, c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
        o[i] = ((c3 * f + c2) * f + c1) * f + x0;
      }
    }
    return out;
  };
  AK.changeRate = function (c, newSr) { return AK.resample(c, c.sr, newSr); };

  /* WSOLA time-stretch: changes length, keeps pitch. rate > 1 is faster (shorter).
     Async so a long file can let the page breathe; onProgress(0..1) is optional. */
  AK.timeStretch = async function (c, rate, onProgress) {
    if (Math.abs(rate - 1) < 1e-4) return AK.copy(c);
    var sr = c.sr, L = AK.len(c), nc = c.ch.length;
    var N = sr >= 32000 ? 2048 : 1024, Hs = N / 2, tol = Math.round(sr * 0.012);
    var win = new Float32Array(N); for (var w = 0; w < N; w++) win[w] = 0.5 - 0.5 * Math.cos(2 * Math.PI * w / N);
    var outLen = Math.max(1, Math.round(L / rate));
    var out = AK.makeClip(nc, outLen + N, sr), norm = new Float32Array(outLen + N);
    /* mono guide signal for matching */
    var mono = c.ch[0];
    if (nc > 1) { mono = new Float32Array(L); for (var k = 0; k < nc; k++) { var dk = c.ch[k]; for (var z = 0; z < L; z++) mono[z] += dk[z]; } }
    var frames = Math.ceil(outLen / Hs) + 1, prev = 0, lastYield = Date.now();
    var at = function (p) { return p >= 0 && p < L ? mono[p] : 0; };
    for (var f = 0; f < frames; f++) {
      var outPos = f * Hs, ideal = Math.round(outPos * rate), best = ideal;
      if (f > 0) {
        var target = prev + Hs, bestScore = -Infinity, step = 4, sub = 8, s, score, p;
        var lo = Math.max(0, ideal - tol), hi = Math.min(L - 1, ideal + tol);
        for (p = lo; p <= hi; p += step) {
          score = 0; for (s = 0; s < Hs; s += sub) score += at(target + s) * at(p + s);
          if (score > bestScore) { bestScore = score; best = p; }
        }
        var c0 = best;
        for (p = Math.max(lo, c0 - step); p <= Math.min(hi, c0 + step); p++) {
          score = 0; for (s = 0; s < Hs; s += 2) score += at(target + s) * at(p + s);
          if (score > bestScore) { bestScore = score; best = p; }
        }
      }
      for (var q = 0; q < nc; q++) {
        var src = c.ch[q], dst = out.ch[q];
        for (var n = 0; n < N; n++) { var sp = best + n, op = outPos + n; if (op >= dst.length) break; dst[op] += (sp < L ? src[sp] : 0) * win[n]; }
      }
      for (var m = 0; m < N && outPos + m < norm.length; m++) norm[outPos + m] += win[m];
      prev = best;
      if (Date.now() - lastYield > 60) { lastYield = Date.now(); if (onProgress) onProgress(f / frames); await new Promise(function (r) { setTimeout(r, 0); }); }
    }
    for (var r = 0; r < nc; r++) { var o = out.ch[r]; for (var i = 0; i < outLen; i++) o[i] = norm[i] > 1e-3 ? o[i] / norm[i] : o[i]; out.ch[r] = o.slice(0, outLen); }
    /* gentle edges where the window sum was small */
    if (onProgress) onProgress(1);
    return out;
  };

  /* Pitch shift by semitones, same length. */
  AK.pitchShift = async function (c, semis, onProgress) {
    var p = Math.pow(2, semis / 12);
    var st = await AK.timeStretch(c, 1 / p, onProgress); /* p times longer */
    var o = AK.resample(st, c.sr * p, c.sr);           /* play p times faster: back to length, pitch up */
    /* match exact length */
    var L = AK.len(c);
    return { sr: c.sr, ch: o.ch.map(function (d) { if (d.length === L) return d; var x = new Float32Array(L); x.set(d.subarray(0, L)); return x; }) };
  };

  /* Noise gate: quietens the audio whenever it falls below the threshold.
     thrDb: threshold in dBFS. reduceDb: how far to turn down the gaps (e.g. -24). */
  AK.gate = function (c, thrDb, reduceDb, opts) {
    opts = opts || {};
    var sr = c.sr, L = AK.len(c), nc = c.ch.length;
    var thrOpen = AK.dbToGain(thrDb), thrClose = AK.dbToGain(thrDb - 4), floor = AK.dbToGain(reduceDb);
    var envRel = Math.exp(-1 / (sr * 0.02));
    var attC = 1 - Math.exp(-1 / (sr * 0.002)), relC = 1 - Math.exp(-1 / (sr * (opts.releaseMs || 150) / 1000));
    var holdN = Math.round(sr * (opts.holdMs || 80) / 1000), la = Math.round(sr * 0.005);
    var gains = new Float32Array(L), env = 0, open = false, hold = 0, g = floor, closed = 0;
    for (var i = 0; i < L; i++) {
      var x = 0; for (var k = 0; k < nc; k++) { var v = c.ch[k][i]; if (v < 0) v = -v; if (v > x) x = v; }
      env = x > env ? x : env * envRel;
      if (env > thrOpen) { open = true; hold = holdN; }
      else if (env < thrClose) { if (hold > 0) hold--; else open = false; }
      var tgt = open ? 1 : floor;
      g += (tgt - g) * (tgt > g ? attC : relC);
      gains[i] = g; if (g < 0.5) closed++;
    }
    var out = AK.makeClip(nc, L, sr);
    for (var q = 0; q < nc; q++) { var s = c.ch[q], o = out.ch[q]; for (var j = 0; j < L; j++) o[j] = s[j] * gains[j + la < L ? j + la : L - 1]; }
    out.quietShare = closed / Math.max(1, L);
    return out;
  };

  /* Guess the background noise level: the quiet end of 20 ms loudness readings. */
  AK.noiseFloorDb = function (c) {
    var sr = c.sr, L = AK.len(c), W = Math.max(64, Math.round(sr * 0.02)), vals = [];
    for (var s = 0; s + W <= L; s += W) {
      var sum = 0; for (var k = 0; k < c.ch.length; k++) { var d = c.ch[k]; for (var i = s; i < s + W; i++) sum += d[i] * d[i]; }
      vals.push(Math.sqrt(sum / (W * c.ch.length)));
    }
    if (!vals.length) return -60;
    vals.sort(function (a, b) { return a - b; });
    var v = vals[Math.floor(vals.length * 0.1)];
    return v > 1e-7 ? AK.gainToDb(v) : -100;
  };

  /* ---------- Peaks for waveform drawing ---------- */
  AK.PEAK_BLOCK = 256;
  AK.peaks = function (c) {
    var B = AK.PEAK_BLOCK, L = AK.len(c), n = Math.ceil(L / B), mn = new Float32Array(n), mx = new Float32Array(n);
    for (var b = 0; b < n; b++) {
      var lo = 1, hi = -1, e = Math.min(L, (b + 1) * B);
      for (var k = 0; k < c.ch.length; k++) { var d = c.ch[k]; for (var i = b * B; i < e; i++) { var v = d[i]; if (v < lo) lo = v; if (v > hi) hi = v; } }
      mn[b] = lo; mx[b] = hi;
    }
    return { min: mn, max: mx };
  };

  /* ---------- Encoders ---------- */
  AK.encodeWav = function (c, gain) {
    gain = gain === undefined ? 1 : gain;
    var nc = c.ch.length, sr = c.sr, len = AK.len(c), bytes = len * nc * 2;
    var buf = new ArrayBuffer(44 + bytes), dv = new DataView(buf);
    var w = function (o, s) { for (var i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    w(0, "RIFF"); dv.setUint32(4, 36 + bytes, true); w(8, "WAVE"); w(12, "fmt ");
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, nc, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * nc * 2, true); dv.setUint16(32, nc * 2, true); dv.setUint16(34, 16, true);
    w(36, "data"); dv.setUint32(40, bytes, true);
    var o = 44;
    for (var i = 0; i < len; i++) for (var k = 0; k < nc; k++) {
      var s = c.ch[k][i] * gain; s = s < -1 ? -1 : s > 1 ? 1 : s;
      dv.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true); o += 2;
    }
    return new Uint8Array(buf);
  };

  AK.MP3_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];
  function toI16(d, gain) {
    var o = new Int16Array(d.length);
    for (var i = 0; i < d.length; i++) { var s = d[i] * gain; s = s < -1 ? -1 : s > 1 ? 1 : s; o[i] = s < 0 ? s * 0x8000 : s * 0x7FFF; }
    return o;
  }
  /* lame: the lamejs global. Returns an array of Uint8Array parts. */
  AK.encodeMp3 = async function (c, kbps, lame, onProgress, gain) {
    gain = gain === undefined ? 1 : gain;
    if (AK.MP3_RATES.indexOf(c.sr) < 0) c = AK.changeRate(c, 44100);
    if (c.ch.length > 2) c = AK.toChannels(c, 2);
    var nc = c.ch.length, enc = new lame.Mp3Encoder(nc, c.sr, kbps || 192);
    var L = toI16(c.ch[0], gain), R = nc > 1 ? toI16(c.ch[1], gain) : null;
    var parts = [], block = 1152 * 20, n = L.length, last = Date.now();
    for (var i = 0; i < n; i += block) {
      var l = L.subarray(i, i + block);
      var b = R ? enc.encodeBuffer(l, R.subarray(i, i + block)) : enc.encodeBuffer(l);
      if (b.length) parts.push(new Uint8Array(b.buffer, b.byteOffset, b.length).slice());
      if (Date.now() - last > 60) { last = Date.now(); if (onProgress) onProgress(i / n); await new Promise(function (r) { setTimeout(r, 0); }); }
    }
    var f = enc.flush(); if (f.length) parts.push(new Uint8Array(f.buffer, f.byteOffset, f.length).slice());
    if (onProgress) onProgress(1);
    return parts;
  };

  root.AK = AK;
  if (typeof module !== "undefined" && module.exports) module.exports = AK;
})(typeof window !== "undefined" ? window : globalThis);
