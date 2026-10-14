/* Wi-Fi propagation model (predictive).
   Everything is in metres and dBm. Plain JS with no dependencies so it runs on the page, inside a Blob-URL
   Web Worker (via WifiModelFactory.toString()) and in Node for tests.

   RSSI = Tx + antenna gain - FSPL(1 m, f) - 10 * n * log10(d) - sum(wall losses crossed)
   FSPL(1 m, f MHz) = 20*log10(f) - 27.55   (about 40 dB at 2.4 GHz, 47 dB at 5.5 GHz)
   d is 3D: horizontal distance plus the height difference between a ceiling AP and a device (dz).

   Walls come in two forms and both can be used together:
   - segments {ax,ay,bx,by,loss:{band:dB}}: exact "shadow" rasterisation per AP.
   - wallGrid {w,h,cell,data:Uint8Array(class), loss:{class:{band:dB}}}: a raster wall mask (from scans or
     detected walls). Each ray from the AP is marched across the mask and every entry into a wall adds its loss.
*/
function WifiModelFactory() {
  'use strict';

  var BANDS = {
    '2.4': { f: 2437, label: '2.4 GHz' },
    '5':   { f: 5500, label: '5 GHz' },
    '6':   { f: 6175, label: '6 GHz' }
  };
  var GOOD = -67, OK = -72, CCA = -82, FLOOR_DBM = -127;

  function fspl1m(fMHz) { return 20 * Math.log10(fMHz) - 27.55; }

  function segCross(px, py, qx, qy, ax, ay, bx, by) {
    var d1 = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    var d2 = (bx - ax) * (qy - ay) - (by - ay) * (qx - ax);
    var d3 = (qx - px) * (ay - py) - (qy - py) * (ax - px);
    var d4 = (qx - px) * (by - py) - (qy - py) * (bx - px);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  }

  function apBase(ap, band) {
    var b = ap.bands && ap.bands[band];
    if (!b || !b.on) return null;
    var gain = b.gain != null ? +b.gain : (+ap.gain || 0);
    return (+b.tx || 0) + (gain || 0) - fspl1m(BANDS[band].f);
  }

  // Loss from the raster wall grid along the straight line P->Q, for several bands at once (adds into out[]).
  function gridLossLine(WG, px, py, qx, qy, lossTab, nb, out) {
    var dx = qx - px, dy = qy - py, dist = Math.sqrt(dx * dx + dy * dy);
    var steps = Math.ceil(dist / (WG.cell * 0.7));
    if (steps < 1) return;
    var sx = dx / steps, sy = dy / steps, x = px, y = py, ww = WG.w, wh = WG.h, wc = WG.cell, data = WG.data;
    var i0 = (x / wc) | 0, j0 = (y / wc) | 0;
    var prev = (i0 >= 0 && j0 >= 0 && i0 < ww && j0 < wh) ? data[j0 * ww + i0] : 0;
    for (var s = 1; s <= steps; s++) {
      x += sx; y += sy;
      var i = (x / wc) | 0, j = (y / wc) | 0;
      var c = (i >= 0 && j >= 0 && i < ww && j < wh) ? data[j * ww + i] : 0;
      if (c && !prev) for (var k = 0; k < nb; k++) out[k] += lossTab[c * nb + k];
      prev = c;
    }
  }
  function lossTable(WG, bands) {
    var nb = bands.length, t = new Float32Array(8 * nb);
    for (var c = 1; c < 8; c++) for (var k = 0; k < nb; k++) t[c * nb + k] = (WG.loss[c] && WG.loss[c][bands[k]]) || 0;
    return t;
  }

  // RSSI at one point (brute force). opts: {dz, wallGrid}
  function rssiPoint(ap, band, x, y, walls, n, opts) {
    var base = apBase(ap, band);
    if (base === null) return null;
    var dz = (opts && opts.dz) || 0;
    var d = Math.max(1, Math.sqrt((x - ap.x) * (x - ap.x) + (y - ap.y) * (y - ap.y) + dz * dz));
    var r = base - 10 * n * Math.log10(d);
    for (var i = 0; i < walls.length; i++) {
      var w = walls[i];
      if (segCross(ap.x, ap.y, x, y, w.ax, w.ay, w.bx, w.by)) r -= (w.loss[band] || 0);
    }
    if (opts && opts.wallGrid) {
      var out = [0];
      gridLossLine(opts.wallGrid, ap.x, ap.y, x, y, lossTable(opts.wallGrid, [band]), 1, out);
      r -= out[0];
    }
    return r;
  }

  // Add wall loss to every cell whose centre lies in the "shadow" of wall AB seen from P.
  // Shadow = intersection of three half-planes, so each grid row is one x-interval. Exact and fast.
  function addShadow(acc, gw, gh, cell, Px, Py, w, losses, nb) {
    var Ax = w.ax, Ay = w.ay, Bx = w.bx, By = w.by;
    var s = (Ax - Px) * (By - Py) - (Ay - Py) * (Bx - Px);
    if (Math.abs(s) < 1e-9) return;
    var sg = s > 0 ? 1 : -1;
    var q = (Bx - Ax) * (Py - Ay) - (By - Ay) * (Px - Ax);
    var sq = q > 0 ? -1 : 1;
    var H = [
      [sg * -(Ay - Py), sg * (Ax - Px), sg * (-(Ax - Px) * Py + (Ay - Py) * Px)],
      [sg * (By - Py), sg * -(Bx - Px), sg * (-Px * (By - Py) + Py * (Bx - Px))],
      [sq * -(By - Ay), sq * (Bx - Ax), sq * (-(Bx - Ax) * Ay + (By - Ay) * Ax)]
    ];
    var size = gw * gh;
    for (var j = 0; j < gh; j++) {
      var yc = (j + 0.5) * cell;
      var lo = -Infinity, hi = Infinity, empty = false;
      for (var h = 0; h < 3; h++) {
        var a = H[h][0], k = H[h][1] * yc + H[h][2];
        if (Math.abs(a) < 1e-12) { if (k <= 0) { empty = true; break; } continue; }
        var t = -k / a;
        if (a > 0) { if (t > lo) lo = t; } else { if (t < hi) hi = t; }
      }
      if (empty || lo >= hi) continue;
      var i0 = Math.max(0, Math.floor(lo / cell - 0.5) + 1);
      var i1 = Math.min(gw - 1, Math.ceil(hi / cell - 0.5) - 1);
      if (i1 < i0) continue;
      var row = j * gw;
      for (var bi = 0; bi < nb; bi++) {
        var L = losses[bi]; if (!L) continue;
        var off = bi * size + row;
        for (var i = i0; i <= i1; i++) acc[off + i] += L;
      }
    }
  }

  /* RSSI map of one AP for several bands: Float32Array(nb * gw * gh).
     opts: {dz, wallGrid, mask} - with a mask, raster wall loss is only worked out for masked cells. */
  function apMaps(ap, bands, grid, walls, n, opts) {
    opts = opts || {};
    var gw = grid.gw, gh = grid.gh, cell = grid.cell, size = gw * gh, nb = bands.length;
    var acc = new Float32Array(nb * size);
    var bases = bands.map(function (b) { return apBase(ap, b); });
    if (!bases.some(function (v) { return v !== null; })) { acc.fill(FLOOR_DBM); return acc; }
    for (var wi = 0; wi < walls.length; wi++) {
      var w = walls[wi];
      var losses = bands.map(function (b, k) { return bases[k] === null ? 0 : (w.loss[b] || 0); });
      addShadow(acc, gw, gh, cell, ap.x, ap.y, w, losses, nb);
    }
    var WG = opts.wallGrid, mask = opts.mask, lt = WG ? lossTable(WG, bands) : null, tmp = new Float32Array(nb);
    var tenN = 10 * n, dz2 = (opts.dz || 0) * (opts.dz || 0);
    for (var j = 0; j < gh; j++) {
      var yc = (j + 0.5) * cell, dy = yc - ap.y, dy2 = dy * dy;
      for (var i = 0; i < gw; i++) {
        var idx = j * gw + i;
        var xc = (i + 0.5) * cell, dx = xc - ap.x;
        var d2 = dx * dx + dy2 + dz2;
        var pl = d2 <= 1 ? 0 : tenN * 0.5 * Math.log10(d2);
        if (WG && (!mask || mask[idx])) {
          for (var t = 0; t < nb; t++) tmp[t] = 0;
          gridLossLine(WG, ap.x, ap.y, xc, yc, lt, nb, tmp);
          for (var t2 = 0; t2 < nb; t2++) acc[t2 * size + idx] += tmp[t2];
        }
        for (var k = 0; k < nb; k++) {
          var o = k * size + idx;
          acc[o] = bases[k] === null ? FLOOR_DBM : bases[k] - pl - acc[o];
        }
      }
    }
    return acc;
  }

  function channelsOverlap(band, c1, c2) {
    c1 = +c1; c2 = +c2;
    if (!c1 || !c2) return false;
    if (band === '2.4') return Math.abs(c1 - c2) < 5;
    return c1 === c2;
  }

  function polyMask(mask, gw, gh, cell, polys) {
    for (var p = 0; p < polys.length; p++) {
      var pts = polys[p];
      if (!pts || pts.length < 3) continue;
      for (var j = 0; j < gh; j++) {
        var yc = (j + 0.5) * cell, xs = [];
        for (var a = 0, b = pts.length - 1; a < pts.length; b = a++) {
          var ya = pts[a].y, yb = pts[b].y;
          if ((ya > yc) !== (yb > yc)) xs.push(pts[a].x + (yc - ya) / (yb - ya) * (pts[b].x - pts[a].x));
        }
        xs.sort(function (u, v) { return u - v; });
        for (var q = 0; q + 1 < xs.length; q += 2) {
          var i0 = Math.max(0, Math.floor(xs[q] / cell - 0.5) + 1);
          var i1 = Math.min(gw - 1, Math.ceil(xs[q + 1] / cell - 0.5) - 1);
          for (var i = i0; i <= i1; i++) mask[j * gw + i] = 1;
        }
      }
    }
  }

  function makeGrid(W, H, maxCells, minCell) {
    var cell = Math.max(minCell || 0.25, Math.sqrt((W * H) / (maxCells || 160000)));
    cell = Math.ceil(cell * 100) / 100;
    return { cell: cell, gw: Math.max(1, Math.ceil(W / cell)), gh: Math.max(1, Math.ceil(H / cell)) };
  }

  /* Cells that count as floor to cover: areaMask (detected interior), else drawn areas, else the box around walls, else all. */
  function buildMask(grid, areas, walls, areaMask) {
    var size = grid.gw * grid.gh, mask = new Uint8Array(size), mode;
    if (areaMask && areaMask.data) {
      var am = areaMask, cnt = 0;
      for (var j = 0; j < grid.gh; j++) for (var i = 0; i < grid.gw; i++) {
        var x = ((i + 0.5) * grid.cell / am.cell) | 0, y = ((j + 0.5) * grid.cell / am.cell) | 0;
        if (x < am.w && y < am.h && am.data[y * am.w + x]) { mask[j * grid.gw + i] = 1; cnt++; }
      }
      if (cnt) return { mask: mask, mode: 'auto' };
    }
    if (areas && areas.length) { polyMask(mask, grid.gw, grid.gh, grid.cell, areas); mode = 'areas'; }
    else if (walls && walls.length) {
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      walls.forEach(function (w) {
        x0 = Math.min(x0, w.ax, w.bx); x1 = Math.max(x1, w.ax, w.bx);
        y0 = Math.min(y0, w.ay, w.by); y1 = Math.max(y1, w.ay, w.by);
      });
      polyMask(mask, grid.gw, grid.gh, grid.cell, [[{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]]);
      mode = 'walls';
    } else { mask.fill(1); mode = 'all'; }
    return { mask: mask, mode: mode };
  }

  /* p = { W, H, maxCells, aps, walls, wallGrid, areaMask, areas, bands, n, dz } */
  function computeGrid(p) {
    var grid = makeGrid(p.W, p.H, p.cell ? p.W * p.H / (p.cell * p.cell) : p.maxCells, p.minCell);
    var size = grid.gw * grid.gh, bands = p.bands, nb = bands.length;
    var m = buildMask(grid, p.areas, p.walls, p.areaMask);
    var out = { gw: grid.gw, gh: grid.gh, cell: grid.cell, mask: m.mask, maskMode: m.mode, bands: {} };
    var opts = { dz: p.dz || 0, wallGrid: p.wallGrid || null, mask: m.mask };
    var per = [];
    for (var a = 0; a < p.aps.length; a++) {
      var maps = apMaps(p.aps[a], bands, grid, p.walls, p.n, opts);
      var arr = [];
      for (var k = 0; k < nb; k++) {
        var i8 = new Int8Array(size);
        for (var c = 0; c < size; c++) { var v = Math.round(maps[k * size + c]); i8[c] = v < -127 ? -127 : v > 127 ? 127 : v; }
        arr.push(i8);
      }
      per.push(arr);
    }
    for (var k2 = 0; k2 < nb; k2++) {
      var band = bands[k2];
      var best = new Float32Array(size).fill(FLOOR_DBM), second = new Float32Array(size).fill(FLOOR_DBM);
      var bestAp = new Int16Array(size).fill(-1), count = new Uint8Array(size), cochan = new Uint8Array(size);
      for (var a2 = 0; a2 < per.length; a2++) {
        var mp = per[a2][k2];
        for (var c2 = 0; c2 < size; c2++) {
          var r = mp[c2];
          if (r >= GOOD) count[c2]++;
          if (r > best[c2]) { second[c2] = best[c2]; best[c2] = r; bestAp[c2] = a2; }
          else if (r > second[c2]) second[c2] = r;
        }
      }
      var chans = p.aps.map(function (ap) { var b = ap.bands && ap.bands[band]; return b && b.on ? +b.ch : 0; });
      for (var c3 = 0; c3 < size; c3++) {
        var ba = bestAp[c3];
        if (ba < 0 || best[c3] < OK) continue;
        var cnt = 0;
        for (var a3 = 0; a3 < per.length; a3++) {
          if (a3 === ba || !chans[a3]) continue;
          if (per[a3][k2][c3] >= CCA && channelsOverlap(band, chans[ba], chans[a3])) cnt++;
        }
        cochan[c3] = cnt > 255 ? 255 : cnt;
      }
      out.bands[band] = { best: best, second: second, bestAp: bestAp, count: count, cochan: cochan };
    }
    return out;
  }

  function coverageStats(best, mask, thresholds) {
    var total = 0, hits = thresholds.map(function () { return 0; });
    for (var c = 0; c < best.length; c++) {
      if (!mask[c]) continue;
      total++;
      for (var t = 0; t < thresholds.length; t++) if (best[c] >= thresholds[t]) hits[t]++;
    }
    return { cells: total, frac: hits.map(function (h) { return total ? h / total : 0; }) };
  }

  function channelConflicts(aps, walls, n, band, opts) {
    var list = [];
    for (var i = 0; i < aps.length; i++) for (var j = i + 1; j < aps.length; j++) {
      var a = aps[i], b = aps[j], ba = a.bands && a.bands[band], bb = b.bands && b.bands[band];
      if (!ba || !bb || !ba.on || !bb.on || !channelsOverlap(band, ba.ch, bb.ch)) continue;
      var r = Math.max(rssiPoint(a, band, b.x, b.y, walls, n, opts), rssiPoint(b, band, a.x, a.y, walls, n, opts));
      if (r >= CCA) list.push({ a: i, b: j, rssi: r });
    }
    return list;
  }

  // Distance (m) from a point to the nearest wall, capped at `cap`.
  function clearance(x, y, walls, WG, cap) {
    var best = cap;
    for (var i = 0; i < walls.length; i++) {
      var w = walls[i], dx = w.bx - w.ax, dy = w.by - w.ay, L = dx * dx + dy * dy;
      var t = L ? ((x - w.ax) * dx + (y - w.ay) * dy) / L : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
      var d = Math.hypot(x - w.ax - t * dx, y - w.ay - t * dy);
      if (d < best) best = d;
    }
    if (WG) {
      var radii = [0.25, 0.5, 0.8, 1.2, 1.8, 2.5];
      outer: for (var r = 0; r < radii.length && radii[r] < best; r++) {
        for (var a = 0; a < 12; a++) {
          var xx = x + radii[r] * Math.cos(a * Math.PI / 6), yy = y + radii[r] * Math.sin(a * Math.PI / 6);
          var ci = (xx / WG.cell) | 0, cj = (yy / WG.cell) | 0;
          if (ci >= 0 && cj >= 0 && ci < WG.w && cj < WG.h && WG.data[cj * WG.w + ci]) { best = Math.min(best, radii[r]); break outer; }
        }
      }
    }
    return best;
  }

  /* Automatic AP placement for one band.
     p = computeGrid-style params + { band, threshold, target (0..1), maxNew, preset:{bands}, minSpacing (m), evalCells, maxCands }
     1. Candidates on a lattice inside the floor, away from walls.  2. Greedy: add the spot that newly covers the most floor,
     with a small bonus for open, central spots.  3. Refine: nudge each AP to a better nearby spot.  4. Prune APs we don't need. */
  function placeAps(p, progress) {
    var grid = makeGrid(p.W, p.H, p.evalCell ? p.W * p.H / (p.evalCell * p.evalCell) : (p.evalCells || 8000), 0.4);
    var size = grid.gw * grid.gh, band = p.band, thr = p.threshold, target = p.target;
    var m = buildMask(grid, p.areas, p.walls, p.areaMask), mask = m.mask, total = 0;
    for (var c = 0; c < size; c++) total += mask[c];
    if (!total) return { added: [], frac: 0 };
    var opts = { dz: p.dz || 0, wallGrid: p.wallGrid || null, mask: mask };
    var fixed = new Float32Array(size).fill(FLOOR_DBM);
    (p.aps || []).forEach(function (ap) {
      var mp = apMaps(ap, [band], grid, p.walls, p.n, opts);
      for (var c = 0; c < size; c++) if (mp[c] > fixed[c]) fixed[c] = mp[c];
    });
    var minSp = p.minSpacing != null ? p.minSpacing : 4;
    var areaM2 = total * grid.cell * grid.cell;
    var step = Math.max(grid.cell * 1.5, Math.sqrt(areaM2 / (p.maxCands || 240)));
    var cands = [], loose = [];
    for (var y = step / 2; y < p.H; y += step) for (var x = step / 2; x < p.W; x += step) {
      var ci = Math.min(grid.gw - 1, Math.floor(x / grid.cell)), cj = Math.min(grid.gh - 1, Math.floor(y / grid.cell));
      if (!mask[cj * grid.gw + ci]) continue;
      var cl = clearance(x, y, p.walls, p.wallGrid, 2.5);
      (cl >= 0.5 ? cands : loose).push({ x: x, y: y, clear: cl });
    }
    if (cands.length < 3) cands = cands.concat(loose);
    if (!cands.length) return { added: [], frac: 0 };
    var maps = cands.map(function (cd, k) {
      if (progress && k % 10 === 0) progress(k / cands.length * 0.85);
      return apMaps({ x: cd.x, y: cd.y, bands: p.preset.bands }, [band], grid, p.walls, p.n, opts);
    });
    function coverWith(base, extra) {
      var h = 0;
      for (var c = 0; c < size; c++) if (mask[c] && (base[c] >= thr || (extra && extra[c] >= thr))) h++;
      return h;
    }
    function bestOf(list, skip) {
      var b = Float32Array.from(fixed);
      for (var q = 0; q < list.length; q++) if (q !== skip) { var mp = maps[list[q]]; for (var c = 0; c < size; c++) if (mp[c] > b[c]) b[c] = mp[c]; }
      return b;
    }
    function farEnough(k, list, skip) {
      var cd = cands[k];
      for (var q = 0; q < list.length; q++) if (q !== skip && Math.hypot(cands[list[q]].x - cd.x, cands[list[q]].y - cd.y) < minSp) return false;
      for (var f = 0; f < (p.aps || []).length; f++) if (Math.hypot(p.aps[f].x - cd.x, p.aps[f].y - cd.y) < minSp) return false;
      return true;
    }
    var chosen = [], cur = Float32Array.from(fixed), covered = coverWith(cur), need = Math.ceil(target * total);
    var maxNew = p.maxNew || 40;
    while (covered < need && chosen.length < maxNew) {
      var bi = -1, bs = 0, bg = 0;
      for (var k = 0; k < maps.length; k++) {
        if (chosen.indexOf(k) >= 0 || !farEnough(k, chosen, -1)) continue;
        var mp = maps[k], g = 0;
        for (var c2 = 0; c2 < size; c2++) if (mask[c2] && cur[c2] < thr && mp[c2] >= thr) g++;
        var s = g * (1 + 0.05 * Math.min(cands[k].clear, 2.5));
        if (s > bs) { bs = s; bi = k; bg = g; }
      }
      if (bi < 0 || !bg) break;
      chosen.push(bi);
      var mb = maps[bi];
      for (var c3 = 0; c3 < size; c3++) if (mb[c3] > cur[c3]) cur[c3] = mb[c3];
      covered = coverWith(cur);
    }
    if (progress) progress(0.9);
    // refine: move each AP to the best spot nearby
    for (var pass = 0; pass < 2; pass++) {
      for (var q = 0; q < chosen.length; q++) {
        var others = bestOf(chosen, q), k0 = chosen[q];
        var bestK = k0, bestCov = coverWith(others, maps[k0]), bestClear = cands[k0].clear;
        for (var k2 = 0; k2 < maps.length; k2++) {
          if (k2 === k0 || chosen.indexOf(k2) >= 0) continue;
          if (Math.hypot(cands[k2].x - cands[k0].x, cands[k2].y - cands[k0].y) > step * 2.6) continue;
          if (!farEnough(k2, chosen, q)) continue;
          var cv = coverWith(others, maps[k2]);
          if (cv > bestCov || (cv === bestCov && cands[k2].clear > bestClear + 0.3)) { bestCov = cv; bestK = k2; bestClear = cands[k2].clear; }
        }
        chosen[q] = bestK;
      }
    }
    // prune: drop APs that aren't needed to stay on target
    for (var q2 = chosen.length - 1; q2 >= 0; q2--) {
      if (chosen.length <= 1) break;
      if (coverWith(bestOf(chosen, q2)) >= need) chosen.splice(q2, 1);
    }
    var finalCov = coverWith(bestOf(chosen, -1));
    if (progress) progress(1);
    return { added: chosen.map(function (k) { return { x: cands[k].x, y: cands[k].y }; }), frac: finalCov / total, cell: grid.cell, areaM2: areaM2 };
  }

  return {
    BANDS: BANDS, GOOD: GOOD, OK: OK, CCA: CCA, FLOOR_DBM: FLOOR_DBM,
    fspl1m: fspl1m, segCross: segCross, rssiPoint: rssiPoint, apMaps: apMaps, makeGrid: makeGrid,
    buildMask: buildMask, computeGrid: computeGrid, coverageStats: coverageStats, clearance: clearance,
    channelsOverlap: channelsOverlap, channelConflicts: channelConflicts, placeAps: placeAps, suggestAps: placeAps
  };
}
var WifiModel = WifiModelFactory();
if (typeof module !== 'undefined' && module.exports) module.exports = WifiModel;
