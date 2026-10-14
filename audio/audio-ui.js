/* Audio portal: shared UI pieces (helpers, icons, waveform, export, tool shell). Needs audio-core.js. */
(function () {
  "use strict";
  var AK = window.AK;
  var UI = {};
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  UI.$ = $; UI.$$ = $$;
  UI.esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  UI.baseName = function (n) { return (String(n).replace(/\.[^.]+$/, "") || "audio").replace(/[\\/:*?"<>|]+/g, "_"); };
  UI.wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms || 0); }); };

  /* Remembered preferences (best effort only) */
  UI.store = {
    get: function (k, d) { try { var v = localStorage.getItem("daftarbox.audio." + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem("daftarbox.audio." + k, JSON.stringify(v)); } catch (e) { /* storage blocked: ignore */ } }
  };

  /* Accepts "1:23.5", "0:01:23", or plain seconds "83.5" */
  UI.parseTime = function (s) {
    s = String(s || "").trim().replace(",", ".");
    if (!s) return NaN;
    if (!/^[0-9:.]+$/.test(s)) return NaN;
    var parts = s.split(":").map(parseFloat);
    if (parts.some(function (p) { return !isFinite(p); })) return NaN;
    return parts.reduce(function (acc, p) { return acc * 60 + p; }, 0);
  };

  /* ---------- Icons (drawn for this site) ---------- */
  var P = {
    wave: '<path d="M3 12h1.5M7 8.5v7M10.5 5v14M14 8v8M17.5 6v12M21 11v2"/>',
    scissors: '<circle cx="6" cy="6.5" r="2.8"/><circle cx="6" cy="17.5" r="2.8"/><path d="M8.4 8 20 18M8.4 16 20 6"/>',
    join: '<rect x="3" y="5" width="7.5" height="6" rx="1.5"/><rect x="13.5" y="13" width="7.5" height="6" rx="1.5"/><path d="M10.5 8h2.5a2 2 0 0 1 2 2v3"/>',
    convert: '<path d="M4 8.5h14l-3.5-3.5M20 15.5H6l3.5 3.5"/>',
    speed: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="m12 18 4.2-5.6"/><path d="M7.5 13.5h.01M12 10h.01"/>',
    volume: '<path d="M4 9.5v5h3.5l5 4v-13l-5 4z"/><path d="M16 9.2a4 4 0 0 1 0 5.6M18.6 6.6a7.6 7.6 0 0 1 0 10.8"/>',
    eq: '<path d="M6 4v16M12 4v16M18 4v16"/><path d="M3.8 14h4.4M9.8 8.5h4.4M15.8 16h4.4"/>',
    noise: '<path d="M3 13h3l1.6-4 2.6 9 2.6-11 2.2 7 1.5-1H21"/><path d="M4 21 20 3" opacity=".55"/>',
    reverse: '<path d="M11.5 6 5.5 12l6 6M19 6l-6 6 6 6"/>',
    bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 21a2 2 0 0 0 4 0"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>',
    play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>',
    pause: '<path d="M8.5 5.5v13M15.5 5.5v13" stroke-width="3.2"/>',
    stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.6" fill="currentColor"/>',
    zin: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.6-4.6M10.5 8v5M8 10.5h5"/>',
    zout: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.6-4.6M8 10.5h5"/>',
    fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    up: '<path d="m6 15 6-6 6 6"/>', down: '<path d="m6 9 6 6 6-6"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>',
    lock: '<rect x="5" y="11" width="14" height="9.5" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    upload: '<path d="M12 15.5V4M7 9l5-5 5 5M4 15.5V19a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3.5"/>',
    download: '<path d="M12 4v11.5M7 10.5l5 5 5-5M4 19.5h16"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    shield: '<path d="M12 3 5 6v5.5c0 4.5 3 7.7 7 9.5 4-1.8 7-5 7-9.5V6z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
    bolt: '<path d="M13 3 5 14h6l-1 7 8-11h-6z"/>',
    heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>'
  };
  UI.icon = function (n) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (P[n] || "") + "</svg>";
  };

  /* ---------- Status helpers ---------- */
  UI.status = function (el, msg, kind) { if (!el) return; el.textContent = msg || ""; el.className = "status" + (kind ? " " + kind : ""); };
  UI.errText = function (e) {
    var m = (e && e.message) || "";
    if (e && e.name === "QuotaExceededError" || /memory|allocation|Array buffer/i.test(m)) return "This file is too big for your browser's memory. Try a shorter file, or close other tabs.";
    return m || "Something went wrong. Please try again.";
  };

  /* ---------- Libraries (loaded only when needed) ---------- */
  var LIBS = { lame: "https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js" }; /* LGPL-3.0 */
  var scriptP = {};
  UI.need = function (name) {
    var url = LIBS[name];
    if (scriptP[url]) return scriptP[url];
    return (scriptP[url] = new Promise(function (res, rej) {
      var s = document.createElement("script"); s.src = url; s.async = true; s.crossOrigin = "anonymous";
      s.onload = function () { res(); };
      s.onerror = function () { delete scriptP[url]; s.remove(); rej(new Error("The MP3 encoder didn't load. Check your internet connection and try again, or save as WAV.")); };
      document.head.appendChild(s);
    }));
  };

  /* ---------- Audio context, decode, buffers ---------- */
  var actx = null;
  UI.ac = function () {
    if (!actx) {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) throw new Error("This browser can't work with audio. Please use a recent Chrome, Edge, Firefox or Safari.");
      actx = new C();
    }
    return actx;
  };
  UI.clipFrom = function (ab) { var ch = []; for (var c = 0; c < ab.numberOfChannels; c++) ch.push(ab.getChannelData(c)); return { sr: ab.sampleRate, ch: ch }; };
  var bufCache = new WeakMap();
  UI.toBuffer = function (clip) {
    var b = bufCache.get(clip); if (b) return b;
    var opts = { numberOfChannels: clip.ch.length, length: AK.len(clip), sampleRate: clip.sr };
    try { b = new AudioBuffer(opts); } catch (e) { b = UI.ac().createBuffer(opts.numberOfChannels, opts.length, opts.sampleRate); }
    clip.ch.forEach(function (d, i) { if (b.copyToChannel) b.copyToChannel(d, i); else b.getChannelData(i).set(d); });
    bufCache.set(clip, b); return b;
  };
  UI.decode = async function (fileOrBlob, name) {
    var nm = name || fileOrBlob.name || "this file";
    var ab;
    try { ab = await fileOrBlob.arrayBuffer(); } catch (e) { throw new Error("Couldn't read " + nm + ". It may have been moved or deleted."); }
    try {
      var a = UI.ac();
      var buf = await new Promise(function (res, rej) { var p = a.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); });
      if (!buf || !buf.length) throw new Error("empty");
      return UI.clipFrom(buf);
    } catch (e) {
      var isVid = /^video\//.test(fileOrBlob.type || "") || /\.(mp4|mov|mkv|m4v|avi)$/i.test(nm);
      throw new Error(isVid
        ? "Couldn't find sound your browser can read in " + nm + ". Videos with AAC or Opus sound (most MP4 and WebM files) work best."
        : "Your browser can't read the sound in " + nm + ". Try an MP3, WAV, M4A, OGG or FLAC file.");
    }
  };

  /* Render a clip through Web Audio nodes offline. build(ctx, sourceNode) returns the last node. */
  UI.renderOffline = async function (clip, build) {
    var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OAC) throw new Error("This browser can't apply audio effects. Please use a recent Chrome, Edge, Firefox or Safari.");
    var oc = new OAC(clip.ch.length, AK.len(clip), clip.sr);
    var s = oc.createBufferSource(); s.buffer = UI.toBuffer(clip);
    build(oc, s).connect(oc.destination); s.start(0);
    var r = await new Promise(function (res, rej) { oc.oncomplete = function (e) { res(e.renderedBuffer); }; var p = oc.startRendering(); if (p && p.then) p.then(res, rej); });
    return UI.clipFrom(r);
  };

  /* ---------- Files ---------- */
  var AUD_EXT = ["mp3", "wav", "m4a", "aac", "ogg", "oga", "opus", "flac", "weba", "webm", "aif", "aiff", "caf", "amr", "3gp"];
  var VID_EXT = ["mp4", "mov", "m4v", "mkv", "webm", "avi", "3gp"];
  UI.accept = function (video) { return "audio/*," + AUD_EXT.map(function (e) { return "." + e; }).join(",") + (video ? ",video/*," + VID_EXT.map(function (e) { return "." + e; }).join(",") : ""); };
  UI.isOk = function (f, video) {
    var ext = (f.name.split(".").pop() || "").toLowerCase();
    if (/^audio\//.test(f.type) || AUD_EXT.indexOf(ext) >= 0) return true;
    return !!video && (/^video\//.test(f.type) || VID_EXT.indexOf(ext) >= 0);
  };

  /* ---------- Output formats ---------- */
  var FMT = {
    mp3: { label: "MP3", ext: "mp3", mime: "audio/mpeg" },
    wav: { label: "WAV", ext: "wav", mime: "audio/wav" },
    webm: { label: "WebM", ext: "webm", live: ["audio/webm;codecs=opus", "audio/webm"] },
    m4a: { label: "M4A", ext: "m4a", live: ["audio/mp4;codecs=mp4a.40.2", "audio/mp4"] },
    m4r: { label: "M4R", ext: "m4r", live: ["audio/mp4;codecs=mp4a.40.2", "audio/mp4"] }
  };
  UI.liveMime = function (f) {
    var d = FMT[f]; if (!d || !d.live || !window.MediaRecorder || !MediaRecorder.isTypeSupported) return null;
    for (var i = 0; i < d.live.length; i++) if (MediaRecorder.isTypeSupported(d.live[i])) return d.live[i];
    return null;
  };
  /* list: format ids to offer, e.g. ["mp3","wav","webm"]. Unsupported live formats are left out. */
  UI.formatField = function (list) {
    list = (list || ["mp3", "wav"]).filter(function (f) { return !FMT[f].live || UI.liveMime(f); });
    var saved = UI.store.get("fmt", "mp3"); var def = list.indexOf(saved) >= 0 ? saved : list[0];
    var kb = UI.store.get("kbps", 192);
    return '<div class="grp" data-fmtgrp><h3>Save as</h3>' +
      '<div class="seg full" role="group" aria-label="File format">' + list.map(function (f) { return '<button type="button" data-fmt="' + f + '" aria-pressed="' + (f === def) + '">' + FMT[f].label + "</button>"; }).join("") + "</div>" +
      '<label class="f" data-qual>Quality<select data-kbps>' +
      [[96, "96 kbps · smallest file"], [128, "128 kbps · good"], [192, "192 kbps · great"], [256, "256 kbps · very high"], [320, "320 kbps · best"]].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === kb ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") +
      "</select></label><p class=\"note\" data-fmtnote></p></div>";
  };
  var FMT_NOTES = {
    mp3: "Plays everywhere. Good balance of size and sound.",
    wav: "Full quality, no compression. Files are large.",
    webm: "Small, modern Opus sound. Your browser makes it in real time, so it takes as long as the audio lasts.",
    m4a: "AAC sound for Apple devices. Your browser makes it in real time, so it takes as long as the audio lasts.",
    m4r: "iPhone ringtone format. Add it with Finder (Mac) or iTunes (Windows). Made in real time by your browser."
  };
  UI.wireFormat = function (root) {
    var grp = $("[data-fmtgrp]", root); if (!grp) return function () { return { fmt: "wav", kbps: 192 }; };
    var qual = $("[data-qual]", grp), sel = $("[data-kbps]", grp), note = $("[data-fmtnote]", grp);
    var cur = function () { var b = $("[data-fmt][aria-pressed=true]", grp); return b ? b.dataset.fmt : "wav"; };
    var sync = function () { var f = cur(); qual.hidden = f === "wav"; note.textContent = FMT_NOTES[f] || ""; };
    grp.addEventListener("click", function (e) {
      var b = e.target.closest("[data-fmt]"); if (!b) return;
      $$("[data-fmt]", grp).forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      if (["mp3", "wav"].indexOf(b.dataset.fmt) >= 0) UI.store.set("fmt", b.dataset.fmt);
      sync();
    });
    sel.addEventListener("change", function () { UI.store.set("kbps", +sel.value); });
    sync();
    return function () { return { fmt: cur(), kbps: +sel.value }; };
  };

  /* Play a clip silently into MediaRecorder to get WebM/M4A. */
  async function recordLive(clip, mime, kbps, prog) {
    var a = UI.ac(); await a.resume();
    var dest = a.createMediaStreamDestination(), s = a.createBufferSource();
    s.buffer = UI.toBuffer(clip); s.connect(dest);
    var rec = new MediaRecorder(dest.stream, { mimeType: mime, audioBitsPerSecond: kbps * 1000 });
    var chunks = []; rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    var stopped = new Promise(function (r) { rec.onstop = r; });
    var ended = new Promise(function (r) { s.onended = r; });
    rec.start(500); s.start(); var t0 = a.currentTime, D = AK.dur(clip);
    var iv = setInterval(function () { prog && prog(Math.min(1, (a.currentTime - t0) / D)); }, 200);
    await ended; await UI.wait(200); rec.stop(); await stopped; clearInterval(iv);
    try { s.disconnect(); } catch (e) { /* already gone */ }
    return new Blob(chunks, { type: mime.split(";")[0] });
  }

  /* Encode a clip. gain > 1 goes through the limiter so it can't clip. */
  UI.encode = async function (clip, out, prog, gain) {
    gain = gain === undefined ? 1 : gain;
    if (gain > 1.0001) { clip = AK.limit(AK.gain(clip, gain), 0.97); gain = 1; }
    var f = FMT[out.fmt] || FMT.wav;
    if (out.fmt === "wav") { prog && prog(1); return { blob: new Blob([AK.encodeWav(clip, gain)], { type: "audio/wav" }), ext: "wav" }; }
    if (out.fmt === "mp3") {
      await UI.need("lame");
      if (!window.lamejs || !window.lamejs.Mp3Encoder) throw new Error("The MP3 encoder didn't start. Please reload the page, or save as WAV.");
      var parts = await AK.encodeMp3(clip, out.kbps, window.lamejs, prog, gain);
      return { blob: new Blob(parts, { type: "audio/mpeg" }), ext: "mp3" };
    }
    var mime = UI.liveMime(out.fmt);
    if (!mime) throw new Error("Your browser can't make " + f.label + " files. Choose MP3 or WAV instead.");
    if (gain !== 1) clip = AK.gain(clip, gain);
    return { blob: await recordLive(clip, mime, out.kbps, prog), ext: f.ext };
  };

  /* ---------- Waveform with playback, selection and zoom ---------- */
  function Wave(host, o) {
    var w = this;
    w.o = Object.assign({ select: true, zoom: true, maxSel: 0, moveSel: false, route: null, onChange: null, onPlay: null }, o || {});
    w.clip = null; w.sel = null; w.cursor = 0; w.view = { s: 0, d: 1 }; w.src = null; w.raf = 0;
    host.innerHTML = '<div class="wv"><div class="wv-stage"><canvas tabindex="0" aria-label="Waveform. Click to place the playhead' + (w.o.select ? ", drag to select a part. Arrow keys move, Shift with arrows selects" : "") + '. Space plays or pauses."></canvas></div>' +
      (w.o.zoom ? '<input type="range" class="wv-scroll" min="0" max="1000" value="0" aria-label="Scroll along the waveform" hidden>' : "") +
      '<div class="wv-bar"><button type="button" class="btn play" data-play aria-label="Play">' + UI.icon("play") + "</button>" +
      '<button type="button" class="icon-btn" data-stop aria-label="Stop">' + UI.icon("stop") + "</button>" +
      '<span class="wv-time"><b data-now>0:00.0</b> / <span data-total>0:00.0</span></span>' +
      (w.o.zoom ? '<span class="wv-zoom"><button type="button" class="icon-btn" data-z="out" aria-label="Zoom out">' + UI.icon("zout") + '</button><button type="button" class="icon-btn" data-z="in" aria-label="Zoom in">' + UI.icon("zin") + '</button><button type="button" class="icon-btn" data-z="fit" aria-label="Show the whole track">' + UI.icon("fit") + "</button></span>" : "") +
      "</div></div>";
    w.cv = $("canvas", host); w.scroll = $(".wv-scroll", host); w.btn = $("[data-play]", host);
    w.nowEl = $("[data-now]", host); w.totEl = $("[data-total]", host);
    w.btn.onclick = function () { w.toggle(); };
    $("[data-stop]", host).onclick = function () { w.stop(true); };
    $$("[data-z]", host).forEach(function (b) { b.onclick = function () { var z = b.dataset.z; if (z === "fit") w.fit(); else w.zoomBy(z === "in" ? 2 : 0.5); }; });
    if (w.scroll) w.scroll.oninput = function () { var D = w.total(); w.view.s = (+w.scroll.value / 1000) * Math.max(0, D - w.view.d); w.draw(); };
    w.wirePointer(); w.wireKeys();
    w.ro = new ResizeObserver(function () { w.draw(); }); w.ro.observe(w.cv);
    w.mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    w.onTheme = function () { w.draw(); };
    if (w.mq && w.mq.addEventListener) w.mq.addEventListener("change", w.onTheme);
  }
  Wave.prototype.total = function () { return this.clip ? AK.dur(this.clip) : 1; };
  Wave.prototype.setClip = function (clip, keep) {
    this.stop(); this.clip = clip; this.peaks = AK.peaks(clip);
    var D = this.total();
    if (!keep || this.view.d > D) this.view = { s: 0, d: D };
    if (this.view.s + this.view.d > D) this.view.s = Math.max(0, D - this.view.d);
    if (this.sel && this.sel.b > D) this.sel = null;
    if (this.cursor > D) this.cursor = 0;
    this.totEl.textContent = AK.fmtTime(D); this.syncScroll(); this.draw(); this.emit();
  };
  Wave.prototype.emit = function () { if (this.o.onChange) this.o.onChange(this); };
  Wave.prototype.setSel = function (a, b, edge) {
    if (!this.clip) return;
    var D = this.total();
    if (a === null) { this.sel = null; this.draw(); this.emit(); return; }
    a = Math.max(0, Math.min(D, a)); b = Math.max(0, Math.min(D, b));
    if (b < a) { var t = a; a = b; b = t; }
    var mx = this.o.maxSel;
    if (mx && b - a > mx) { if (edge === "a") a = b - mx; else b = a + mx; }
    if (b - a < 0.005) { this.sel = null; } else this.sel = { a: a, b: b };
    this.draw(); this.emit();
  };
  Wave.prototype.pos = function () {
    if (!this.src) return this.cursor;
    var a = UI.ac(); return Math.min(this.to, this.from + (a.currentTime - this.t0) * (this.rate || 1));
  };
  Wave.prototype.isPlaying = function () { return !!this.src; };
  Wave.prototype.toggle = function () { if (this.src) this.pause(); else this.play(); };
  Wave.prototype.play = function () {
    var w = this; if (!w.clip) return;
    w.halt(); var a = UI.ac(); if (a.resume) a.resume();
    var s = a.createBufferSource(); s.buffer = UI.toBuffer(w.clip);
    var out = w.o.route ? (w.o.route(a, s) || s) : s; out.connect(a.destination);
    var D = w.total(), from, to;
    if (w.sel) { from = w.cursor >= w.sel.a && w.cursor < w.sel.b - 0.05 ? w.cursor : w.sel.a; to = w.sel.b; }
    else { from = w.cursor >= D - 0.05 ? 0 : w.cursor; to = D; }
    w.from = from; w.to = to; w.t0 = a.currentTime; w.rate = 1; w.src = s;
    s.start(0, from, Math.max(0.01, to - from));
    s.onended = function () { if (w.src === s) { w.src = null; w.cursor = w.from; w.ui(); w.draw(); } };
    w.ui();
    var tick = function () {
      if (w.src !== s) return;
      var p = w.pos();
      if (w.view.d < D - 1e-6 && (p > w.view.s + w.view.d || p < w.view.s)) { w.view.s = Math.max(0, Math.min(D - w.view.d, p - w.view.d * 0.05)); w.syncScroll(); }
      w.draw(p); w.raf = requestAnimationFrame(tick);
    };
    tick();
    if (w.o.onPlay) w.o.onPlay(true);
  };
  Wave.prototype.halt = function () {
    if (this.src) { var s = this.src; this.src = null; try { s.onended = null; s.stop(); s.disconnect(); } catch (e) { /* stopped */ } }
    cancelAnimationFrame(this.raf);
  };
  Wave.prototype.pause = function () { if (!this.src) return; this.cursor = this.pos(); this.halt(); this.ui(); this.draw(); if (this.o.onPlay) this.o.onPlay(false); };
  Wave.prototype.stop = function (rewind) { this.halt(); if (rewind) this.cursor = this.sel ? this.sel.a : 0; this.ui(); if (this.clip) this.draw(); };
  Wave.prototype.ui = function () {
    var p = !!this.src; this.btn.innerHTML = UI.icon(p ? "pause" : "play"); this.btn.setAttribute("aria-label", p ? "Pause" : "Play");
  };
  Wave.prototype.destroy = function () { this.halt(); this.ro.disconnect(); if (this.mq && this.mq.removeEventListener) this.mq.removeEventListener("change", this.onTheme); };
  Wave.prototype.syncScroll = function () {
    if (!this.scroll) return; var D = this.total(), zoomed = this.view.d < D - 1e-6;
    this.scroll.hidden = !zoomed; if (zoomed) this.scroll.value = String(Math.round(this.view.s / Math.max(1e-9, D - this.view.d) * 1000));
  };
  Wave.prototype.zoomBy = function (f, center) {
    if (!this.clip) return; var D = this.total(), v = this.view;
    var minD = Math.min(D, Math.max(0.02, (this.cv.clientWidth || 600) / this.clip.sr * 2));
    var c = center !== undefined ? center : (this.src ? this.pos() : this.sel ? (this.sel.a + this.sel.b) / 2 : this.cursor);
    var d = Math.max(minD, Math.min(D, v.d / f));
    var s = c - (c - v.s) * (d / v.d);
    if (center === undefined) s = c - d / 2;
    v.d = d; v.s = Math.max(0, Math.min(D - d, s)); this.syncScroll(); this.draw();
  };
  Wave.prototype.fit = function () { this.view = { s: 0, d: this.total() }; this.syncScroll(); this.draw(); };
  Wave.prototype.zoomSel = function () { if (!this.sel) return this.fit(); var pad = (this.sel.b - this.sel.a) * 0.1, D = this.total(); this.view.s = Math.max(0, this.sel.a - pad); this.view.d = Math.min(D - this.view.s, this.sel.b - this.sel.a + pad * 2); this.syncScroll(); this.draw(); };
  Wave.prototype.tAt = function (clientX) { var r = this.cv.getBoundingClientRect(); return this.view.s + Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * this.view.d; };
  Wave.prototype.xOf = function (t) { return (t - this.view.s) / this.view.d * this.cv.clientWidth; };
  Wave.prototype.seek = function (t) { var playing = !!this.src; this.halt(); this.cursor = Math.max(0, Math.min(this.total(), t)); if (playing) this.play(); else { this.ui(); this.draw(); } this.emit(); };
  Wave.prototype.wirePointer = function () {
    var w = this, cv = w.cv, drag = null;
    cv.addEventListener("pointerdown", function (e) {
      if (!w.clip || e.button > 0) return;
      cv.setPointerCapture(e.pointerId); cv.focus({ preventScroll: true });
      var t = w.tAt(e.clientX), r = cv.getBoundingClientRect(), x = e.clientX - r.left;
      drag = { t0: t, x0: e.clientX, moved: false, edge: null };
      if (w.o.select && w.sel) {
        if (Math.abs(x - w.xOf(w.sel.a)) < 9) drag.edge = "a";
        else if (Math.abs(x - w.xOf(w.sel.b)) < 9) drag.edge = "b";
        else if (w.o.moveSel && t > w.sel.a && t < w.sel.b) { drag.edge = "move"; drag.a0 = w.sel.a; drag.b0 = w.sel.b; }
      }
    });
    cv.addEventListener("pointermove", function (e) {
      if (!w.clip) return;
      if (!drag) { var r0 = cv.getBoundingClientRect(), x0 = e.clientX - r0.left; cv.style.cursor = w.o.select && w.sel && (Math.abs(x0 - w.xOf(w.sel.a)) < 9 || Math.abs(x0 - w.xOf(w.sel.b)) < 9) ? "ew-resize" : (w.o.moveSel && w.sel && w.tAt(e.clientX) > w.sel.a && w.tAt(e.clientX) < w.sel.b ? "grab" : "text"); return; }
      var t = w.tAt(e.clientX);
      if (Math.abs(e.clientX - drag.x0) > 3) drag.moved = true;
      if (!drag.moved || !w.o.select) return;
      if (drag.edge === "a") w.setSel(t, w.sel.b, "a");
      else if (drag.edge === "b") w.setSel(w.sel.a, t, "b");
      else if (drag.edge === "move") { var len = drag.b0 - drag.a0, D = w.total(), na = Math.max(0, Math.min(D - len, drag.a0 + (t - drag.t0))); w.setSel(na, na + len); }
      else w.setSel(drag.t0, t, t < drag.t0 ? "a" : "b");
    });
    var end = function (e) {
      if (!drag) return; var d = drag; drag = null;
      if (!d.moved) { if (w.o.select && !d.edge) { w.sel = null; } w.seek(d.t0); w.draw(); w.emit(); }
      else if (w.sel && !w.src) { w.cursor = w.sel.a; w.draw(); }
    };
    cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", function () { drag = null; });
    cv.addEventListener("wheel", function (e) {
      if (!w.clip || !w.o.zoom) return;
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); w.zoomBy(e.deltaY < 0 ? 1.25 : 0.8, w.tAt(e.clientX)); return; }
      var D = w.total(); if (w.view.d >= D - 1e-6) return;
      var dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : (e.shiftKey ? e.deltaY : 0);
      if (!dx) return; e.preventDefault();
      w.view.s = Math.max(0, Math.min(D - w.view.d, w.view.s + dx / Math.max(1, cv.clientWidth) * w.view.d)); w.syncScroll(); w.draw();
    }, { passive: false });
  };
  Wave.prototype.wireKeys = function () {
    var w = this;
    w.cv.addEventListener("keydown", function (e) {
      if (!w.clip) return; var D = w.total(), step = Math.max(0.05, w.view.d / 50) * (e.altKey ? 0.2 : 1);
      if (e.key === " " || e.key === "Spacebar") { if (!w.o.globalSpace) { e.preventDefault(); w.toggle(); } return; }
      var nt = null;
      if (e.key === "ArrowLeft") nt = w.cursor - step; else if (e.key === "ArrowRight") nt = w.cursor + step;
      else if (e.key === "Home") nt = 0; else if (e.key === "End") nt = D; else return;
      e.preventDefault(); nt = Math.max(0, Math.min(D, nt));
      if (e.shiftKey && w.o.select) { var anchor = w.sel ? (Math.abs(w.cursor - w.sel.b) < 1e-6 ? w.sel.a : w.sel.b) : w.cursor; w.cursor = nt; w.setSel(Math.min(anchor, nt), Math.max(anchor, nt), nt < anchor ? "a" : "b"); }
      else { w.seek(nt); }
      if (nt < w.view.s || nt > w.view.s + w.view.d) { w.view.s = Math.max(0, Math.min(D - w.view.d, nt - w.view.d / 2)); w.syncScroll(); }
      w.draw();
    });
  };
  Wave.prototype.draw = function (ph) {
    var w = this, cv = w.cv, clip = w.clip;
    var dpr = window.devicePixelRatio || 1, W = Math.max(1, Math.round(cv.clientWidth * dpr)), H = Math.max(1, Math.round(cv.clientHeight * dpr));
    if (cv.width !== W) cv.width = W; if (cv.height !== H) cv.height = H;
    var g = cv.getContext("2d"), cs = getComputedStyle(cv), col = function (k) { return cs.getPropertyValue(k).trim(); };
    g.clearRect(0, 0, W, H);
    var p = ph !== undefined ? ph : w.cursor;
    if (w.nowEl) w.nowEl.textContent = AK.fmtTime(w.src ? w.pos() : p);
    if (!clip) return;
    var v = w.view, RU = Math.round(18 * dpr), top = RU, h = H - RU, mid = top + h / 2;
    var X = function (t) { return (t - v.s) / v.d * W; };
    /* ruler */
    var steps = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800], st = steps[steps.length - 1];
    for (var i = 0; i < steps.length; i++) if (steps[i] / v.d * W >= 74 * dpr) { st = steps[i]; break; }
    g.fillStyle = col("--muted"); g.font = Math.round(10.5 * dpr) + "px Archivo, system-ui, sans-serif"; g.textBaseline = "top";
    var dec = st < 0.1 ? 2 : st < 1 ? 1 : 0;
    for (var t = Math.ceil(v.s / st) * st; t <= v.s + v.d + 1e-9; t += st) { var tx = Math.round(X(t)); g.fillRect(tx, RU - 5 * dpr, Math.max(1, dpr), 5 * dpr); g.fillText(AK.fmtTime(t, dec), tx + 3 * dpr, 3 * dpr); }
    g.fillStyle = col("--line"); g.fillRect(0, RU - Math.max(1, dpr), W, Math.max(1, dpr));
    /* selection */
    var acc = col("--accent");
    if (w.sel) {
      var x1 = X(w.sel.a), x2 = X(w.sel.b);
      g.fillStyle = col("--accent-soft"); g.fillRect(x1, top, Math.max(1, x2 - x1), h);
      g.fillStyle = acc; g.fillRect(x1 - dpr, top, 2 * dpr, h); g.fillRect(x2 - dpr, top, 2 * dpr, h);
      g.fillRect(x1 - 4 * dpr, top, 8 * dpr, 10 * dpr); g.fillRect(x2 - 4 * dpr, top, 8 * dpr, 10 * dpr);
    }
    /* centre line */
    g.fillStyle = col("--line"); g.fillRect(0, Math.round(mid), W, Math.max(1, dpr));
    /* wave */
    var L = AK.len(clip), sr = clip.sr, s0 = v.s * sr, spp = v.d * sr / W, B = AK.PEAK_BLOCK, pk = w.peaks, amp = h / 2 * 0.92;
    var selA = w.sel ? X(w.sel.a) : -1, selB = w.sel ? X(w.sel.b) : -1;
    g.fillStyle = acc;
    for (var x = 0; x < W; x++) {
      var a = Math.floor(s0 + x * spp), b = Math.max(a + 1, Math.floor(s0 + (x + 1) * spp));
      if (a >= L) break; if (b > L) b = L;
      var mn = 1, mx = -1, k, j;
      if (spp >= B) { for (j = Math.floor(a / B); j < Math.ceil(b / B); j++) { if (pk.min[j] < mn) mn = pk.min[j]; if (pk.max[j] > mx) mx = pk.max[j]; } }
      else { for (k = 0; k < clip.ch.length; k++) { var d = clip.ch[k]; for (j = a; j < b; j++) { var y = d[j]; if (y < mn) mn = y; if (y > mx) mx = y; } } }
      if (mx < mn) continue;
      g.globalAlpha = w.sel && (x < selA || x > selB) ? 0.4 : 1;
      var y1 = mid - mx * amp, y2 = mid - mn * amp;
      g.fillRect(x, y1, 1, Math.max(dpr, y2 - y1));
    }
    g.globalAlpha = 1;
    /* playhead */
    var px = X(p);
    if (px >= -2 && px <= W + 2) {
      g.fillStyle = col("--ink"); g.fillRect(Math.round(px - dpr / 2), top, Math.max(1, Math.round(1.5 * dpr)), h);
      g.beginPath(); g.moveTo(px - 5 * dpr, top - 1); g.lineTo(px + 5 * dpr, top - 1); g.lineTo(px, top + 6 * dpr); g.closePath(); g.fill();
    }
  };
  UI.Wave = Wave;

  /* ---------- Small player for list rows ---------- */
  var mini = { src: null, btn: null };
  UI.miniPlay = function (clip, btn) {
    var same = mini.btn === btn; UI.miniStop();
    if (same) return;
    var a = UI.ac(); if (a.resume) a.resume();
    var s = a.createBufferSource(); s.buffer = UI.toBuffer(clip); s.connect(a.destination); s.start();
    mini.src = s; mini.btn = btn; btn.innerHTML = UI.icon("pause"); btn.setAttribute("aria-label", "Pause");
    s.onended = function () { if (mini.src === s) UI.miniStop(); };
  };
  UI.miniStop = function () {
    if (mini.src) { try { mini.src.onended = null; mini.src.stop(); } catch (e) { /* stopped */ } }
    if (mini.btn) { mini.btn.innerHTML = UI.icon("play"); mini.btn.setAttribute("aria-label", "Play this clip"); }
    mini.src = null; mini.btn = null;
  };

  /* ---------- Page pieces ---------- */
  UI.toolHead = function (t) {
    return '<nav class="crumbs" aria-label="Breadcrumb"><a href="#/">Audio tools</a> <span aria-hidden="true">/</span> <span aria-current="page">' + UI.esc(t.name) + "</span></nav>" +
      '<div class="t-head"><h1 tabindex="-1">' + UI.esc(t.name) + "</h1><p>" + t.lede + "</p></div><div data-stage></div>";
  };
  UI.pickerHtml = function (o) {
    return '<div class="picker" data-picker><input type="file" data-file tabindex="-1" aria-hidden="true" accept="' + UI.accept(o.video) + '"' + (o.multiple ? " multiple" : "") + ">" +
      '<button type="button" class="btn big" data-pick>' + UI.icon("upload") + UI.esc(o.label || "Select audio file") + "</button>" +
      "<small>or drop " + (o.multiple ? "files" : "a file") + " here · MP3, WAV, M4A, OGG, FLAC" + (o.video ? ", or a video (MP4, MOV, WebM)" : "") + "</small>" +
      '<p class="lock">' + UI.icon("lock") + "Your audio stays on this device. Nothing is uploaded.</p>" +
      '<p class="status" data-pst role="status" aria-live="polite"></p></div>';
  };
  UI.wirePicker = function (host, onFiles) {
    var pk = $("[data-picker]", host); if (!pk) return;
    var inp = $("[data-file]", pk);
    $("[data-pick]", pk).onclick = function () { inp.click(); };
    inp.onchange = function () { if (inp.files.length) onFiles(Array.prototype.slice.call(inp.files)); inp.value = ""; };
  };
  /* Hidden input used by "Change file" / "Add more" buttons */
  UI.filePrompt = function (o, onFiles) {
    var inp = document.createElement("input"); inp.type = "file"; inp.accept = UI.accept(o.video); inp.multiple = !!o.multiple;
    inp.onchange = function () { if (inp.files.length) onFiles(Array.prototype.slice.call(inp.files)); };
    inp.click();
  };

  /* Results box with preview player and download. */
  UI.showResult = function (host, r) {
    if (host._url) URL.revokeObjectURL(host._url);
    var url = host._url = URL.createObjectURL(r.blob);
    host.hidden = false;
    host.innerHTML = '<h2 tabindex="-1">' + UI.icon("check").replace("<svg", '<svg style="width:22px;height:22px;vertical-align:-3px;margin-right:6px;color:var(--ok)"') + "Your audio is ready</h2>" +
      (r.summary ? '<p class="sum">' + UI.esc(r.summary) + "</p>" : "") +
      '<audio controls preload="metadata" src="' + url + '" aria-label="Listen to the result"></audio>' +
      '<ul><li><span class="fname">' + UI.esc(r.name) + '</span><span class="fsize">' + AK.fmtSize(r.blob.size) + '</span><a class="btn" href="' + url + '" download="' + UI.esc(r.name) + '">' + UI.icon("download").replace("<svg", '<svg style="width:18px;height:18px"') + "Download</a></li></ul>" +
      '<div class="results-foot">' + (r.onEdit ? '<button type="button" class="btn ghost" data-edit>Open in audio editor</button>' : "") +
      (r.onAgain ? '<button type="button" class="btn ghost" data-again>Change settings</button>' : "") +
      '<button type="button" class="btn ghost" data-reset>Start over</button></div>';
    if (r.onEdit) $("[data-edit]", host).onclick = r.onEdit;
    if (r.onAgain) $("[data-again]", host).onclick = r.onAgain;
    $("[data-reset]", host).onclick = r.onReset;
    host.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    $("h2", host).focus({ preventScroll: true });
  };
  UI.clearResult = function (host) { if (!host) return; var au = $("audio", host); if (au) au.pause(); if (host._url) URL.revokeObjectURL(host._url); host._url = null; host.hidden = true; host.innerHTML = ""; };

  /* Hand a clip to another tool (used by "Open in audio editor"). */
  UI.handoff = null;
  UI.pending = null; /* files dropped on the home page */

  window.KUI = UI;
})();
