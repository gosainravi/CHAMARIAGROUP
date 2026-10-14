/* Daftarbox video tools. Classic script (no modules) so it works from file:// and over http.
   Everything runs in the browser: videos are never uploaded. */
"use strict";
(function () {

/* ---------- Small helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[c]));
const fmtSize = b => b < 1024 ? b + " B" : b < 1048576 ? (b / 1024).toFixed(0) + " KB" : b < 1073741824 ? (b / 1048576).toFixed(1) + " MB" : (b / 1073741824).toFixed(2) + " GB";
const baseName = n => (n || "video").replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80) || "video";
const extOf = n => ((String(n).match(/\.([^.]+)$/) || [, ""])[1]).toLowerCase();
/* 83.4 -> "1:23.4" (precise, for edit points) */
const fmtTime = s => { s = Math.max(0, +s || 0); let m = Math.floor(s / 60), r = Math.round((s - m * 60) * 10) / 10; if (r >= 60) { m++; r = 0; } return m + ":" + r.toFixed(1).padStart(4, "0"); };
/* 83.4 -> "1:23" (for lengths and estimates) */
const fmtClock = s => { s = Math.max(0, Math.round(+s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, r = s % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(r).padStart(2, "0"); };
/* "1:23.4", "83.4" or "1:02:03" -> seconds; NaN if not a time */
function parseTime(str) {
  const parts = String(str).trim().split(":");
  if (!parts.length || parts.length > 3 || parts.some(p => p === "" || !/^\d*\.?\d*$/.test(p))) return NaN;
  return parts.reduce((acc, p) => acc * 60 + parseFloat(p), 0);
}
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const even = x => Math.max(2, Math.round(x / 2) * 2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
/* Resolve when an element fires an event; reject on its "error" event; optional timeout resolves anyway. */
function waitFor(el, ev, ms) {
  return new Promise((res, rej) => {
    let t = 0;
    const done = () => { clearTimeout(t); el.removeEventListener(ev, ok); el.removeEventListener("error", bad); };
    const ok = () => { done(); res(); };
    const bad = () => { done(); rej(oops("Your browser can't play this video. Try an MP4 (H.264) or WebM file.")); };
    el.addEventListener(ev, ok); el.addEventListener("error", bad);
    if (ms) t = setTimeout(ok, ms);
  });
}
function oops(msg) { const e = new Error(msg); e.friendly = true; return e; }
const CANCEL = "Cancelled";
const store = {
  get(k, d) { try { const v = localStorage.getItem("daftarbox.video." + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("daftarbox.video." + k, JSON.stringify(v)); } catch (e) { /* storage blocked: ignore */ } }
};
const loaded = {};
function loadScript(src) {
  if (!loaded[src]) loaded[src] = new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = src; s.async = true;
    s.onload = res;
    s.onerror = () => { delete loaded[src]; s.remove(); rej(oops("A helper file couldn't be downloaded. Check your internet connection and try again.")); };
    document.head.appendChild(s);
  });
  return loaded[src];
}
const VIDEO_EXT = ["mp4", "m4v", "mov", "webm", "mkv", "ogv", "avi", "3gp", "mpeg", "mpg", "ts"];
const isVideo = f => f && ((f.type || "").startsWith("video/") || VIDEO_EXT.includes(extOf(f.name)));
const AC = window.AudioContext || window.webkitAudioContext;

/* ---------- Icons: one hand-drawn set on a 24px grid, 1.8 stroke, round caps ---------- */
const svg = (d, extra = "") => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"${extra}>${d}</svg>`;
const I = {
  trim: svg('<circle cx="6" cy="6.5" r="2.8"/><circle cx="6" cy="17.5" r="2.8"/><path d="M8.4 8 20 18.5M8.4 16 20 5.5"/>'),
  compress: svg('<path d="M4 14.5h5.5V20M20 9.5h-5.5V4M14.5 9.5 20.5 3.5M3.5 20.5l6-6"/>'),
  crop: svg('<path d="M6.5 2.5v13a2 2 0 0 0 2 2h13M2.5 6.5h13a2 2 0 0 1 2 2v13"/>'),
  rotate: svg('<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.6"/><path d="M4 4v4.6h4.6"/>'),
  speed: svg('<path d="M3.6 17.5a9 9 0 1 1 16.8 0"/><path d="m12 14 4.2-4.2"/><circle cx="12" cy="14" r="1.4"/>'),
  sound: svg('<path d="M11 5 6.5 9H3.5v6h3L11 19z"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18.5 6a8.5 8.5 0 0 1 0 12"/>'),
  merge: svg('<rect x="2.5" y="6" width="7.5" height="12" rx="1.6"/><rect x="14" y="6" width="7.5" height="12" rx="1.6"/><path d="M10 12h4"/>'),
  text: svg('<path d="M5 7V4.5h14V7M12 4.5v15M9 19.5h6"/>'),
  gif: svg('<rect x="3" y="4.5" width="18" height="15" rx="2.6"/><path d="M8 13.5a4 4 0 0 1 7.2-2.4M16 10.5a4 4 0 0 1-7.2 2.4"/><path d="M15.4 8.4v2.8h-2.8M8.6 15.6v-2.8h2.8" stroke-width="1.6"/>'),
  note: svg('<path d="M9 17.5V5.5l11-2v12"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="15.5" r="2.5"/>'),
  image: svg('<rect x="3" y="4" width="18" height="16" rx="2.6"/><circle cx="9" cy="10" r="1.9"/><path d="m20.5 16-5-5-9.5 9"/>'),
  film: svg('<rect x="3" y="4" width="18" height="16" rx="2.6"/><path d="M7.5 4v16M16.5 4v16M3 9h4.5M3 15h4.5M16.5 9H21M16.5 15H21"/>'),
  upload: svg('<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>'),
  download: svg('<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>'),
  play: svg('<path d="M7.5 5.2v13.6a.6.6 0 0 0 .9.5l11-6.8a.6.6 0 0 0 0-1L8.4 4.7a.6.6 0 0 0-.9.5z" fill="currentColor"/>'),
  pause: svg('<path d="M8.5 5v14M15.5 5v14" stroke-width="3"/>'),
  x: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  up: svg('<path d="m6 14.5 6-6 6 6"/>'),
  down: svg('<path d="m6 9.5 6 6 6-6"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  lock: svg('<rect x="5" y="10.5" width="14" height="10" rx="2.2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>'),
  free: svg('<path d="M20.5 12.5 12.5 20.5a1.8 1.8 0 0 1-2.5 0L3.5 14V3.5H14l6.5 6.5a1.8 1.8 0 0 1 0 2.5z"/><circle cx="8" cy="8" r="1.3"/>'),
  device: svg('<rect x="2.5" y="4" width="13" height="10" rx="1.6"/><path d="M6 18h6M9 14v4"/><rect x="17" y="8" width="4.5" height="11.5" rx="1.2"/>'),
  clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  rotL: svg('<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9"/><path d="M4.5 4.5V9H9"/>'),
  rotR: svg('<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3L19.5 9"/><path d="M19.5 4.5V9H15"/>'),
  flipH: svg('<path d="M12 3v18" stroke-dasharray="2 2.6"/><path d="M8.5 7 3.5 17h5zM15.5 7l5 10h-5z"/>'),
  flipV: svg('<path d="M3 12h18" stroke-dasharray="2 2.6"/><path d="M7 8.5 17 3.5v5zM7 15.5l10 5v-5z"/>'),
  prev: svg('<path d="M15 6l-6 6 6 6"/>'),
  next: svg('<path d="M9 6l6 6-6 6"/>'),
  back: svg('<path d="M11 6 5 12l6 6M19 6l-6 6 6 6"/>'),
  fwd: svg('<path d="M13 6l6 6-6 6M5 6l6 6-6 6"/>'),
  start: svg('<path d="M6 4v16M10 12h10M14 8l-4 4 4 4"/>'),
  end: svg('<path d="M18 4v16M14 12H4M10 8l4 4-4 4"/>')
};

/* ---------- Tool list ---------- */
const CATS = [["all", "All"], ["edit", "Edit"], ["convert", "Convert"], ["audio", "Audio"], ["social", "Social"]];
const TOOLS = [
  {id:"trim", name:"Trim video", icon:"trim", cats:["edit"], desc:"Cut off the start or end, or snip a part out of the middle.",
    lead:"Drag the handles to choose the part you want. Keep it, or cut it out."},
  {id:"compress", name:"Compress video", icon:"compress", cats:["convert"], desc:"Make a big video smaller so it's quick to send and share.",
    lead:"Pick how small you want it. We'll show the size before and after."},
  {id:"resize", name:"Crop & resize", icon:"crop", cats:["social", "edit"], isNew:true, desc:"Fit any video to Reels, Shorts, square or widescreen.",
    lead:"Choose a shape for Instagram, YouTube or WhatsApp. Fill the frame, or fit it with a blurred background."},
  {id:"rotate", name:"Rotate & flip", icon:"rotate", cats:["edit"], desc:"Turn a sideways video the right way up, or mirror it.",
    lead:"Shot your video sideways? Turn it in steps of 90°, or flip it like a mirror."},
  {id:"speed", name:"Change speed", icon:"speed", cats:["edit"], desc:"Slow motion or fast forward, from 0.25× to 4×.",
    lead:"Slow it down or speed it up. Voices can keep their normal pitch."},
  {id:"audio", name:"Mute or replace audio", icon:"sound", cats:["audio"], desc:"Remove the sound, or put your own music on the video.",
    lead:"Take the sound out, swap it for a song, or mix music under the original sound."},
  {id:"merge", name:"Merge videos", icon:"merge", cats:["edit"], multi:true, desc:"Join several clips into one video, in the order you like.",
    lead:"Add your clips, put them in order, and join them into one video."},
  {id:"text", name:"Add text or logo", icon:"text", cats:["edit", "social"], isNew:true, desc:"Put a caption, title or watermark on your video.",
    lead:"Write a caption or add your logo. Choose where it sits, how big, and the colour."},
  {id:"gif", name:"Video to GIF", icon:"gif", cats:["convert", "social"], isNew:true, engine:false, desc:"Turn a short moment into a looping GIF.",
    lead:"Pick a moment of up to 15 seconds and turn it into a GIF that loops."},
  {id:"extract", name:"Extract audio", icon:"note", cats:["audio", "convert"], engine:false, desc:"Save the sound from a video as a WAV or MP3 file.",
    lead:"Pull the soundtrack out of a video, as WAV or MP3."},
  {id:"frame", name:"Save a frame", icon:"image", cats:["convert"], engine:false, desc:"Grab a still photo from any moment, at full quality.",
    lead:"Pause on the moment you want and save it as a JPG or PNG photo."}
];
const toolById = id => TOOLS.find(t => t.id === id);

/* ---------- Recording support ---------- */
function pickMime() {
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return null;
  for (const m of ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"])
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) { /* ignore */ }
  return "";
}
const MIME = pickMime();
const canRecord = MIME !== null;
const outFormat = () => !MIME || MIME.includes("webm") ? "WebM" : "MP4";
const NO_REC = "This browser can't save edited videos. Please use a recent Chrome, Edge, Firefox or Safari on a computer or phone.";

/* Bitrate from output size and a quality preset (bits per pixel per frame at 30 fps). */
const BPP = {high:.11, balanced:.065, small:.035};
const bitrateFor = (W, H, q) => Math.round(clamp(W * H * 30 * (BPP[q] || BPP.balanced), 300000, 16000000));
/* Scale so the shorter side is at most `short` (0 = keep), even numbers, max 3840 on the long side. */
function fitSize(w, h, short) {
  let s = short && Math.min(w, h) > short ? short / Math.min(w, h) : 1;
  if (Math.max(w, h) * s > 3840) s = 3840 / Math.max(w, h);
  return [even(w * s), even(h * s)];
}
function setPitch(v, keep) { v.preservesPitch = keep; v.mozPreservesPitch = keep; v.webkitPreservesPitch = keep; }

/* ---------- Drawing helpers (shared by preview and export, so what you see is what you get) ---------- */
const vw = v => v.videoWidth || 16, vh = v => v.videoHeight || 9;
function drawPlain(g, v, W, H) { g.drawImage(v, 0, 0, W, H); }
function drawContain(g, v, W, H, fill = true) {
  if (fill) { g.fillStyle = "#000"; g.fillRect(0, 0, W, H); }
  const s = Math.min(W / vw(v), H / vh(v)), dw = vw(v) * s, dh = vh(v) * s;
  g.drawImage(v, (W - dw) / 2, (H - dh) / 2, dw, dh);
}
function drawCover(g, v, W, H, fx = .5, fy = .5) {
  const s = Math.max(W / vw(v), H / vh(v)), dw = vw(v) * s, dh = vh(v) * s;
  g.drawImage(v, (W - dw) * fx, (H - dh) * fy, dw, dh);
}
const blurCan = document.createElement("canvas");
function drawBlurBg(g, v, W, H) {
  const bw = 24, bh = Math.max(2, Math.round(24 * H / W));
  blurCan.width = bw; blurCan.height = bh;
  const bg = blurCan.getContext("2d"); bg.imageSmoothingEnabled = true; drawCover(bg, v, bw, bh);
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
  g.drawImage(blurCan, 0, 0, W, H);
  g.fillStyle = "rgba(0,0,0,.28)"; g.fillRect(0, 0, W, H);
}
/* Place a w×h box at a 3×3 position like "tl", "mc", "br" with margin m. */
function place(pos, W, H, w, h, m) {
  const r = pos[0], c = pos[1];
  return [c === "l" ? m : c === "r" ? W - w - m : (W - w) / 2, r === "t" ? m : r === "b" ? H - h - m : (H - h) / 2];
}
function drawOverlay(g, W, H, o) {
  const m = Math.round(Math.min(W, H) * .045);
  g.save(); g.globalAlpha = o.opacity;
  if (o.kind === "logo") {
    if (o.img && o.img.width) {
      const w = W * o.logoSize / 100, h = w * o.img.height / o.img.width;
      const [x, y] = place(o.pos, W, H, w, h, m);
      g.drawImage(o.img, x, y, w, h);
    }
  } else {
    const lines = String(o.text || "").split(/\r?\n/).slice(0, 8);
    if (lines.join("").trim()) {
      const fs = Math.max(8, Math.round(Math.min(W, H) * o.size / 100));
      g.font = `700 ${fs}px "Archivo", system-ui, sans-serif`; g.textBaseline = "top";
      const lh = fs * 1.22, ws = lines.map(l => g.measureText(l).width), bw = Math.max(...ws), bh = lines.length * lh;
      const pad = o.box ? fs * .45 : 0;
      const [x, y] = place(o.pos, W, H, bw + pad * 2, bh + pad * 2, m);
      if (o.box) {
        g.fillStyle = "rgba(0,0,0,.58)"; g.beginPath();
        if (g.roundRect) g.roundRect(x, y, bw + pad * 2, bh + pad * 2, fs * .25); else g.rect(x, y, bw + pad * 2, bh + pad * 2);
        g.fill();
      } else { g.shadowColor = "rgba(0,0,0,.65)"; g.shadowBlur = fs * .18; g.shadowOffsetY = fs * .05; }
      g.fillStyle = o.color;
      lines.forEach((ln, i) => {
        const lx = o.pos[1] === "l" ? x + pad : o.pos[1] === "r" ? x + pad + bw - ws[i] : x + pad + (bw - ws[i]) / 2;
        g.fillText(ln, lx, y + pad + i * lh + (lh - fs) / 2);
      });
    }
  }
  g.restore();
}

/* ---------- Render engine ----------
   One pipeline for every video tool: hidden <video> -> canvas (tool's draw function) -> captureStream,
   audio routed through Web Audio -> MediaRecorder. Runs in real time.
   job = {clips:[{url, a, b, draw?}], W, H, draw, quality, rate, keepPitch, audio:{mode:"keep"|"mute"|"replace"|"mix", url, musicVol, origVol, loop}} */
async function renderVideo(job, ctl) {
  if (!canRecord) throw oops(NO_REC);
  const {W, H, clips} = job, rate = job.rate || 1;
  const total = clips.reduce((s, c) => s + (c.b - c.a) / rate, 0);
  const am = (job.audio && job.audio.mode) || "keep";
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d"); g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
  const tracks = [...c.captureStream(30).getVideoTracks()];
  const holder = document.createElement("div");
  holder.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;overflow:hidden;opacity:0;pointer-events:none";
  document.body.appendChild(holder);
  let ac = null, dest = null, music = null, rec = null;
  try {
    if (am !== "mute" && AC) {
      ac = new AC(); dest = ac.createMediaStreamDestination(); tracks.push(...dest.stream.getAudioTracks());
      if ((am === "replace" || am === "mix") && job.audio.url) {
        music = document.createElement("audio"); music.preload = "auto"; music.loop = !!job.audio.loop; music.src = job.audio.url;
        holder.appendChild(music);
        await waitFor(music, "loadedmetadata").catch(() => { throw oops("Your browser can't play that music file. Try an MP3, M4A or WAV."); });
        const mg = ac.createGain(); mg.gain.value = job.audio.musicVol ?? 1;
        ac.createMediaElementSource(music).connect(mg).connect(dest);
      }
      await ac.resume();
    }
    const opts = {videoBitsPerSecond:bitrateFor(W, H, job.quality), audioBitsPerSecond:128000};
    if (MIME) opts.mimeType = MIME;
    rec = new MediaRecorder(new MediaStream(tracks), opts);
    const chunks = []; rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise(r => { rec.onstop = r; });
    let doneOut = 0;
    for (let i = 0; i < clips.length; i++) {
      ctl.check();
      const cl = clips[i], draw = cl.draw || job.draw;
      const v = document.createElement("video"); v.playsInline = true; v.preload = "auto"; v.src = cl.url; holder.appendChild(v);
      await waitFor(v, "loadedmetadata");
      let node = null;
      if (ac && (am === "keep" || am === "mix")) {
        const gn = ac.createGain(); gn.gain.value = am === "mix" ? (job.audio.origVol ?? 1) : 1;
        node = ac.createMediaElementSource(v); node.connect(gn).connect(dest);
      } else v.muted = true;
      v.defaultPlaybackRate = rate; v.playbackRate = rate; setPitch(v, job.keepPitch !== false);
      await seekTo(v, cl.a);
      g.save(); draw(g, v, W, H); g.restore();
      if (i === 0) rec.start(1000); else if (rec.state === "paused") rec.resume();
      if (music && (music.loop || music.currentTime < music.duration)) music.play().catch(() => {});
      v.playbackRate = rate;
      await v.play();
      await new Promise((res, rej) => {
        let done = false, guard = 0;
        const fin = err => { if (done) return; done = true; clearInterval(guard); if (err) rej(err); else res(); };
        const step = () => {
          if (done) return;
          if (ctl.cancelled) { fin(new Error(CANCEL)); return; }
          g.save(); draw(g, v, W, H); g.restore();
          const t = v.currentTime;
          ctl.progress((doneOut + Math.max(0, t - cl.a) / rate) / total);
          if (t >= cl.b - .02 || v.ended) fin();
        };
        const loop = () => { step(); if (!done) { if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(loop); else requestAnimationFrame(loop); } };
        v.addEventListener("ended", () => fin(), {once:true});
        v.addEventListener("error", () => fin(oops("The video stopped playing part-way. Try again, or try a different file.")), {once:true});
        guard = setInterval(step, 200); /* keeps going if frame callbacks are throttled */
        loop();
      });
      v.pause();
      if (i < clips.length - 1) { rec.pause(); if (music) music.pause(); }
      if (node) node.disconnect();
      v.removeAttribute("src"); v.load(); v.remove();
      doneOut += (cl.b - cl.a) / rate;
    }
    if (music) music.pause();
    rec.stop(); await stopped;
    const type = (rec.mimeType || MIME || "video/webm").split(";")[0];
    const blob = new Blob(chunks, {type});
    if (!blob.size) throw oops("The export came out empty. Keep this tab in front while it runs, then try again.");
    return {blob, ext:type.includes("mp4") ? "mp4" : "webm", W, H, dur:total};
  } finally {
    try { if (rec && rec.state !== "inactive") rec.stop(); } catch (e) { /* ignore */ }
    tracks.forEach(t => t.stop());
    $$("video,audio", holder).forEach(m => { m.pause(); m.removeAttribute("src"); });
    holder.remove();
    if (ac) ac.close().catch(() => {});
  }
}
async function seekTo(v, t) {
  if (Math.abs(v.currentTime - t) < .01 && v.readyState >= 2) return;
  const p = new Promise(r => v.addEventListener("seeked", r, {once:true}));
  v.currentTime = t;
  await Promise.race([p, sleep(4000)]);
}
/* Recorded WebM files often report an Infinity duration until you seek to the end. */
async function fixDuration(v) {
  if (isFinite(v.duration) && v.duration > 0) return;
  v.currentTime = 1e7;
  await Promise.race([new Promise(r => v.addEventListener("durationchange", r, {once:true})), sleep(3000)]);
  await seekTo(v, 0);
}
/* Probe a clip: size, length and a small thumbnail. */
async function probe(url) {
  const v = document.createElement("video"); v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
  try {
    await waitFor(v, "loadedmetadata"); await fixDuration(v);
    if (!v.videoWidth) throw oops("This file has no picture we can read. Try an MP4 or WebM video.");
    await seekTo(v, Math.min(.5, v.duration / 3));
    const th = document.createElement("canvas"); th.width = 192; th.height = 108;
    const g = th.getContext("2d"); g.fillStyle = "#000"; g.fillRect(0, 0, 192, 108); drawContain(g, v, 192, 108);
    return {w:v.videoWidth, h:v.videoHeight, dur:v.duration, thumb:th};
  } finally { v.removeAttribute("src"); v.load(); }
}

/* ---------- Preview player: hidden <video> drawn to a canvas through the tool's draw function ---------- */
function makePlayer(host, url, opt = {}) {
  host.innerHTML = `<div class="stage"><canvas class="view" role="img" aria-label="Video preview"></canvas><video class="src" playsinline preload="auto"></video>
    <div class="stage-load"><span class="spin" aria-hidden="true"></span><span>Opening your video…</span></div></div>
    <div class="ctrl"><button type="button" class="icon-btn play" aria-label="Play">${I.play}</button>
    <span class="tc" aria-live="off">0:00.0 / 0:00.0</span>${opt.scrub === false ? '<span class="sp"></span>' : '<input type="range" class="scrub" min="0" max="1" step="0.01" value="0" aria-label="Position in video">'}</div>`;
  const v = $("video", host), cv = $("canvas", host), g = cv.getContext("2d"), btn = $(".play", host), tc = $(".tc", host), scrub = $(".scrub", host);
  const P = {v, canvas:cv, dur:0, vw:0, vh:0, dead:false};
  P.draw = opt.draw || drawPlain;
  P.size = opt.size || ((w, h) => [w, h]);
  let raf = 0, scrubbing = false;
  P.resize = () => {
    const [W, H] = P.size(P.vw, P.vh); const s = Math.min(1, 960 / Math.max(W, H));
    cv.width = Math.max(2, Math.round(W * s)); cv.height = Math.max(2, Math.round(H * s));
    P.redraw();
  };
  P.redraw = () => {
    if (P.dead || !P.vw) return;
    g.save(); g.clearRect(0, 0, cv.width, cv.height);
    try { P.draw(g, v, cv.width, cv.height); } catch (e) { console.error(e); }
    g.restore();
    tc.textContent = fmtTime(v.currentTime) + " / " + fmtTime(P.dur);
    if (scrub && !scrubbing) scrub.value = v.currentTime;
    if (opt.onTime) opt.onTime(v.currentTime);
  };
  const loop = () => { P.redraw(); if (!v.paused && !v.ended && !P.dead) raf = v.requestVideoFrameCallback ? v.requestVideoFrameCallback(loop) : requestAnimationFrame(loop); };
  const setBtn = () => { const playing = !v.paused && !v.ended; btn.innerHTML = playing ? I.pause : I.play; btn.setAttribute("aria-label", playing ? "Pause" : "Play"); };
  v.addEventListener("play", () => { setBtn(); loop(); });
  v.addEventListener("pause", setBtn); v.addEventListener("ended", setBtn);
  v.addEventListener("seeked", P.redraw); v.addEventListener("loadeddata", P.redraw);
  v.addEventListener("timeupdate", () => { if (v.paused) P.redraw(); });
  btn.addEventListener("click", () => { if (v.paused || v.ended) P.play(); else v.pause(); });
  if (scrub) {
    scrub.addEventListener("input", () => { scrubbing = true; v.currentTime = +scrub.value; });
    scrub.addEventListener("change", () => { scrubbing = false; });
  }
  P.play = () => { const p = v.play(); if (p) p.catch(() => {}); };
  P.pause = () => v.pause();
  P.seek = t => { v.currentTime = clamp(t, 0, P.dur); };
  P.destroy = () => { P.dead = true; v.pause(); v.removeAttribute("src"); v.load(); };
  P.ready = (async () => {
    v.src = url;
    await waitFor(v, "loadedmetadata");
    await fixDuration(v);
    if (!v.videoWidth) throw oops("This file has no picture we can read. Try an MP4 or WebM video.");
    await Promise.race([v.readyState >= 2 ? Promise.resolve() : waitFor(v, "loadeddata"), sleep(5000)]);
    P.dur = v.duration; P.vw = v.videoWidth; P.vh = v.videoHeight;
    if (scrub) scrub.max = P.dur;
    $(".stage-load", host).hidden = true;
    P.resize();
    return P;
  })();
  return P;
}

/* ---------- Small option-UI builders ---------- */
const seg = (key, options, cur, label) => `<div class="seg full" role="group" aria-label="${esc(label || key)}" data-seg="${key}">${options.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${String(v) === String(cur)}">${l}</button>`).join("")}</div>`;
function onSeg(root, key, cb) {
  const el = $(`[data-seg="${key}"]`, root); if (!el) return;
  el.addEventListener("click", e => {
    const b = e.target.closest("button[data-v]"); if (!b) return;
    $$("button", el).forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    cb(b.dataset.v);
  });
}
function resField(w, h, def = 0) {
  const opts = [[0, `Keep original (${w}×${h})`]];
  for (const s of [1080, 720, 480, 360]) if (Math.min(w, h) > s) opts.push([s, s + "p"]);
  const cur = opts.some(o => o[0] === def) ? def : 0;
  return `<label class="f">Resolution<select data-res>${opts.map(([v, l]) => `<option value="${v}"${v === cur ? " selected" : ""}>${l}</option>`).join("")}</select></label>`;
}
const qualityGroup = (cur = "balanced") => `<div class="grp"><span class="lbl">Quality</span>${seg("quality", [["high", "Best"], ["balanced", "Balanced"], ["small", "Smallest"]], cur, "Quality")}</div>`;
const posGrid = cur => `<div class="posgrid" role="group" aria-label="Position" data-pos>${["tl", "tc", "tr", "ml", "mc", "mr", "bl", "bc", "br"].map(p => `<button type="button" data-p="${p}" aria-pressed="${p === cur}" aria-label="${{t:"Top", m:"Middle", b:"Bottom"}[p[0]]} ${{l:"left", c:"centre", r:"right"}[p[1]]}"></button>`).join("")}</div>`;

/* ---------- App state and routing ---------- */
const main = $("#main");
let cleanup = null, busy = false, dropTarget = null, handoff = null, lastHash = location.hash;

function route() {
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  dropTarget = null;
  const m = location.hash.match(/^#\/t\/([\w-]+)/);
  const t = m && toolById(m[1]);
  if (t) mountTool(t); else renderHome();
  $$("[data-nav]").forEach(a => { if (a.dataset.nav === (t ? t.id : "")) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  window.scrollTo(0, 0);
  lastHash = location.hash;
}
window.addEventListener("hashchange", () => {
  if (busy) {
    if (!confirm("A video is still being saved. Leave and stop it?")) { history.replaceState(null, "", lastHash || "#/"); return; }
    if (currentCtl) currentCtl.cancelled = true;
    busy = false;
  }
  route();
  const h = $("h1", main); if (h) h.focus({preventScroll:true});
});
window.addEventListener("beforeunload", e => { if (busy) { e.preventDefault(); e.returnValue = ""; } });

/* ---------- Home ---------- */
function renderHome() {
  document.title = "Video editing – Daftarbox";
  const cur = store.get("cat", "all");
  main.innerHTML = `<section class="p-hero">
      <span class="eyebrow">${I.lock}Private · runs in your browser</span>
      <h1 tabindex="-1">Simple video tools that just work</h1>
      <p>Trim, compress, resize for Reels and more. Free, no sign-up, and your video never leaves your device.</p>
    </section>
    <div class="chips" role="group" aria-label="Show tools by type">${CATS.map(([id, l]) => `<button type="button" data-cat="${id}" aria-pressed="${id === cur}">${l}</button>`).join("")}</div>
    <ul class="tgrid">${TOOLS.map(t => `<li class="tcard" data-cats="${t.cats.join(" ")}"><div class="ti">${I[t.icon]}</div>
      <h3><a href="index.html#/t/${t.id}">${esc(t.name)}</a>${t.isNew ? '<span class="badge new">New</span>' : ""}</h3><p>${esc(t.desc)}</p></li>`).join("")}</ul>
    <ul class="trust">
      <li><span class="ic">${I.lock}</span><div><b>Your files stay with you</b><span>Videos are edited on your device. Nothing is uploaded.</span></div></li>
      <li><span class="ic">${I.free}</span><div><b>Free, no sign-up</b><span>No account, no watermark added by us.</span></div></li>
      <li><span class="ic">${I.device}</span><div><b>Phone or computer</b><span>Works in Chrome, Edge, Firefox and Safari.</span></div></li>
    </ul>`;
  const filter = cat => {
    $$(".tgrid li", main).forEach(li => { li.hidden = cat !== "all" && !li.dataset.cats.split(" ").includes(cat); });
    $$("[data-cat]", main).forEach(b => b.setAttribute("aria-pressed", String(b.dataset.cat === cat)));
  };
  $(".chips", main).addEventListener("click", e => { const b = e.target.closest("[data-cat]"); if (!b) return; store.set("cat", b.dataset.cat); filter(b.dataset.cat); });
  filter(CATS.some(c => c[0] === cur) ? cur : "all");
}

/* ---------- Tool page shell ---------- */
let currentCtl = null;
function mountTool(t) {
  document.title = t.name + " – Daftarbox";
  const engine = t.engine !== false;
  const noun = t.multi ? "videos" : "video";
  main.innerHTML = `<nav class="crumbs" aria-label="Breadcrumb"><a href="../index.html">Daftarbox</a> / <a href="index.html#/">Video editing</a> / <span aria-current="page">${esc(t.name)}</span></nav>
    <header class="t-head"><h1 tabindex="-1">${esc(t.name)}</h1><p>${esc(t.lead)}</p></header>
    <section class="picker" data-picker aria-label="Choose a video">
      ${engine && !canRecord ? `<p class="warn">${esc(NO_REC)}</p>` : ""}
      <svg class="art" viewBox="0 0 136 96" aria-hidden="true"><rect class="a-sub" x="30" y="6" width="84" height="60" rx="10"/><rect class="a-bg" x="14" y="22" width="92" height="64" rx="12"/><rect class="a-ln" x="14" y="22" width="92" height="64" rx="12"/><path class="a-fill" d="M52 41.5v25a2 2 0 0 0 3 1.7l20.5-12.5a2 2 0 0 0 0-3.4L55 39.8a2 2 0 0 0-3 1.7z"/><circle class="a-fill" cx="112" cy="74" r="16"/><path class="a-arrow" d="M112 82V67m-6 6 6-6 6 6"/></svg>
      <button type="button" class="btn big" data-pick>${I.upload}Select ${noun}</button>
      <input type="file" accept="video/*,${VIDEO_EXT.map(e => "." + e).join(",")}" data-file ${t.multi ? "multiple" : ""} tabindex="-1" aria-hidden="true">
      <small>or drop ${t.multi ? "files" : "a file"} here</small>
      <p class="pick-err" role="alert" data-perr></p>
      <p class="privacy">${I.lock}Your ${noun} ${t.multi ? "stay" : "stays"} on this device. Nothing is uploaded.</p>
    </section>
    <div class="work" data-work hidden>
      <section class="box" aria-label="Workspace">
        <div class="box-h"><div class="fi">${I.film}<span class="fname" data-fname></span><span class="meta" data-meta></span></div>
          <button type="button" class="btn ghost small" data-change>Change ${t.multi ? "clips" : "video"}</button></div>
        <div class="box-b" data-ws></div>
      </section>
      <aside class="opts" aria-label="Options"><h2>Options</h2><fieldset data-fs><div data-opts></div></fieldset>
        <div class="act">
          <p class="fmt" data-fmt hidden></p>
          ${engine ? `<p class="note" data-rt>Saving plays your video through once, in real time. A 2-minute clip takes about 2 minutes. Keep this tab open and in front.</p>` : ""}
          <button type="button" class="btn wide go" data-go disabled>Export</button>
          <div class="job" data-job hidden>
            <div class="job-row"><b data-jt>Saving…</b><span data-jp>0%</span></div>
            <progress max="1" value="0"></progress>
            <div class="job-row muted"><span data-je>0:00 elapsed</span><span data-jr></span></div>
            <button type="button" class="btn ghost small wide" data-cancel>Cancel</button>
          </div>
          <p class="status" data-st role="status" aria-live="polite"></p>
        </div>
      </aside>
    </div>
    <section class="results" data-out hidden aria-label="Result"></section>`;
  const picker = $("[data-picker]", main), work = $("[data-work]", main), out = $("[data-out]", main), input = $("[data-file]", main);
  const go = $("[data-go]", main), st = $("[data-st]", main), fmtEl = $("[data-fmt]", main), jobEl = $("[data-job]", main), fs = $("[data-fs]", main);
  const urls = [];
  let inst = null, noteFn = null, ctlLocal = null;

  const S = {
    t, ws:$("[data-ws]", main), opts:$("[data-opts]", main), player:null, onGo:null, extraUrls:urls,
    url(f) { const u = URL.createObjectURL(f); urls.push(u); return u; },
    setInfo(name, meta) { $("[data-fname]", main).textContent = name; $("[data-meta]", main).textContent = meta || ""; },
    status(msg, kind) { st.textContent = msg || ""; st.className = "status" + (kind ? " " + kind : ""); },
    action(label, note) { go.innerHTML = label; noteFn = note || null; S.refresh(); },
    enable(on) { go.disabled = !on || busy || (engine && !canRecord); },
    refresh() {
      const n = noteFn ? noteFn() : "";
      fmtEl.hidden = !n; fmtEl.innerHTML = n ? I.clock + "<span>" + esc(n) + "</span>" : "";
    },
    run, showResult
  };
  go.addEventListener("click", () => { if (S.onGo && !busy) S.onGo(); });
  $("[data-cancel]", main).addEventListener("click", () => { if (ctlLocal) { ctlLocal.cancelled = true; $("[data-jt]", main).textContent = "Stopping…"; } });

  function teardown() {
    if (S.player) { S.player.destroy(); S.player = null; }
    if (inst && inst.destroy) { try { inst.destroy(); } catch (e) { console.error(e); } }
    inst = null; S.onGo = null; noteFn = null;
    urls.splice(0).forEach(u => URL.revokeObjectURL(u));
    /* Fresh containers so listeners from the previous file don't linger */
    for (const k of ["ws", "opts"]) { const n = S[k].cloneNode(false); S[k].replaceWith(n); S[k] = n; }
    out.hidden = true; out.innerHTML = "";
    S.status(""); S.refresh(); go.disabled = true;
  }
  function showPicker(err) {
    teardown(); work.hidden = true; picker.hidden = false;
    $("[data-perr]", main).textContent = err || "";
  }
  async function open(files) {
    if (busy) return;
    const vids = files.filter(isVideo);
    if (!vids.length) { $("[data-perr]", main).textContent = "That doesn't look like a video. Choose an MP4, MOV or WebM file."; return; }
    teardown();
    picker.hidden = true; work.hidden = false;
    S.setInfo(t.multi ? "" : vids[0].name, t.multi ? "" : fmtSize(vids[0].size));
    try { inst = (await TOOL_UI[t.id](S, t.multi ? vids : [vids[0]])) || {}; }
    catch (e) { console.error(e); showPicker(e.friendly ? e.message : "This video couldn't be opened. Try an MP4 (H.264) or WebM file."); }
  }
  input.addEventListener("change", () => { const f = [...input.files]; input.value = ""; if (f.length) { if (inst && inst.add && !work.hidden) inst.add(f); else open(f); } });
  $("[data-pick]", main).addEventListener("click", () => input.click());
  $("[data-change]", main).addEventListener("click", () => { if (!busy) showPicker(); $("[data-pick]", main).focus(); });
  dropTarget = files => { if (busy) return; if (inst && inst.add && !work.hidden) inst.add(files); else open(files); };
  S.pickMore = () => input.click();

  /* Run a long task with progress, elapsed/remaining time and cancel. fn(ctl) returns a result for showResult. */
  async function run(fn, label = "Saving…") {
    if (busy) return;
    busy = true; const ctl = ctlLocal = currentCtl = {cancelled:false, p:0,
      check() { if (this.cancelled) throw new Error(CANCEL); },
      label(s) { $("[data-jt]", main).textContent = s; },
      progress(p) { this.p = p; const pr = $("progress", jobEl); if (p == null) pr.removeAttribute("value"); else { pr.value = clamp(p, 0, 1); $("[data-jp]", main).textContent = Math.floor(clamp(p, 0, 1) * 100) + "%"; } }};
    if (S.player) S.player.pause();
    const box = $(".work .box", main);
    go.disabled = true; fs.disabled = true; box.inert = true; out.hidden = true; S.status("");
    jobEl.hidden = false; $("[data-jt]", main).textContent = label; $("[data-jp]", main).textContent = ""; ctl.progress(0);
    const t0 = performance.now();
    const tick = () => {
      const el = (performance.now() - t0) / 1000;
      $("[data-je]", main).textContent = fmtClock(el) + " elapsed";
      $("[data-jr]", main).textContent = ctl.p > .03 && ctl.p < 1 ? "about " + fmtClock(el * (1 - ctl.p) / ctl.p) + " left" : "";
      if (document.hidden) S.status("Keep this tab in front, or saving slows down.");
    };
    const timer = setInterval(tick, 500); tick();
    try {
      const r = await fn(ctl);
      if (ctl.cancelled) throw new Error(CANCEL);
      busy = false;
      if (r) showResult(r);
    } catch (e) {
      if (e && e.message === CANCEL) S.status("Stopped. Nothing was saved.");
      else if (e && e.name === "NotAllowedError") S.status("Your browser blocked playback. Press the button again to retry.", "err");
      else { console.error(e); S.status(e && e.friendly ? e.message : "Something went wrong while saving. Try again, or try a shorter or smaller video.", "err"); }
    } finally {
      clearInterval(timer); busy = false; ctlLocal = currentCtl = null;
      jobEl.hidden = true; fs.disabled = false; box.inert = false; go.disabled = engine && !canRecord;
    }
  }

  /* Result card: preview, download, what next. r = {blob, name, kind, summary, before?} */
  function showResult(r) {
    const u = S.url(r.blob);
    const nouns = {video:"video", gif:"GIF", audio:"audio file", image:"photo"};
    const prev = r.kind === "video" ? `<video controls playsinline preload="metadata" src="${u}"></video>`
      : r.kind === "audio" ? `<audio controls preload="metadata" src="${u}"></audio>`
      : `<img src="${u}" alt="Preview of your ${nouns[r.kind]}">`;
    let cmp = "";
    if (r.before) {
      const mx = Math.max(r.before, r.blob.size);
      cmp = `<div class="cmp" aria-label="Size before and after"><div><span>Before</span><i style="width:${(r.before / mx * 100).toFixed(1)}%"></i><span>${fmtSize(r.before)}</span></div>
        <div class="after"><span>After</span><i style="width:${(r.blob.size / mx * 100).toFixed(1)}%"></i><span>${fmtSize(r.blob.size)}</span></div></div>`;
    }
    const nextIds = r.kind === "video" ? ["compress", "resize", "text", "gif", "trim"].filter(id => id !== t.id).slice(0, 3) : [];
    out.innerHTML = `<div class="res-top"><span class="ok-ic">${I.check}</span><div><h2 tabindex="-1">Your ${nouns[r.kind] || "file"} is ready</h2><p class="sum">${esc(r.summary || "")}</p></div></div>
      <div class="res-prev">${prev}</div>${cmp}
      <ul><li><span class="fname">${esc(r.name)}</span><span class="fsize">${fmtSize(r.blob.size)}</span><a class="btn" href="${u}" download="${esc(r.name)}">${I.download}Download</a></li></ul>
      ${nextIds.length ? `<div class="next"><span>Keep editing this video:</span>${nextIds.map(id => `<a class="btn ghost small" href="index.html#/t/${id}" data-next>${I[toolById(id).icon]}${esc(toolById(id).name)}</a>`).join("")}</div>` : ""}
      <div class="results-foot"><button type="button" class="btn ghost" data-edit>Change settings</button><button type="button" class="btn ghost" data-reset>Start over</button></div>`;
    out.hidden = false;
    $$("[data-next]", out).forEach(a => a.addEventListener("click", () => { handoff = new File([r.blob], r.name, {type:r.blob.type}); }));
    $("[data-edit]", out).addEventListener("click", () => { out.hidden = true; go.focus(); });
    $("[data-reset]", out).addEventListener("click", () => { showPicker(); $("[data-pick]", main).focus(); window.scrollTo({top:0}); });
    out.scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block:"start"});
    $("h2", out).focus({preventScroll:true});
  }

  cleanup = () => { if (ctlLocal) ctlLocal.cancelled = true; teardown(); };
  if (handoff) { const f = handoff; handoff = null; open([f]); }
}

/* Engine tools share this: run the render and build the result. */
function exportVideo(S, job, file, suffix, describe) {
  return S.run(async ctl => {
    const r = await renderVideo(job, ctl);
    return {blob:r.blob, kind:"video", name:baseName(file.name) + "_" + suffix + "." + r.ext,
      summary:(describe ? describe(r) + " " : "") + fmtClock(r.dur) + " long, " + r.W + "×" + r.H + ", saved as " + r.ext.toUpperCase() + ".",
      before:job.compare ? file.size : 0};
  });
}
const realtimeNote = secs => `Saves as ${outFormat()}${outFormat() === "WebM" ? " (this browser can't make MP4)" : ""} · takes about ${fmtClock(Math.max(1, secs))}`;

/* ---------- Global drag and drop ---------- */
let dragDepth = 0;
const hasFiles = e => e.dataTransfer && [...(e.dataTransfer.types || [])].includes("Files");
document.addEventListener("dragenter", e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; if (dropTarget && !busy) document.body.classList.add("dragging"); });
document.addEventListener("dragover", e => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = dropTarget && !busy ? "copy" : "none"; });
document.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove("dragging"); } });
document.addEventListener("drop", e => {
  if (!hasFiles(e)) return; e.preventDefault(); dragDepth = 0; document.body.classList.remove("dragging");
  if (dropTarget) dropTarget([...e.dataTransfer.files]);
});

/* ---------- Audio encoders ---------- */
const GIFENC_URL = "https://cdn.jsdelivr.net/npm/gifenc@1.0.3/dist/gifenc.js"; /* MIT */
const LAME_URL = "https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js";    /* LGPL-3.0, loaded unmodified as a separate file */
function encodeWav(buf) {
  const nc = buf.numberOfChannels, sr = buf.sampleRate, len = buf.length;
  const dv = new DataView(new ArrayBuffer(44 + len * nc * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); dv.setUint32(4, 36 + len * nc * 2, true); w(8, "WAVE"); w(12, "fmt ");
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, nc, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * nc * 2, true); dv.setUint16(32, nc * 2, true); dv.setUint16(34, 16, true);
  w(36, "data"); dv.setUint32(40, len * nc * 2, true);
  const ch = []; for (let c = 0; c < nc; c++) ch.push(buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < nc; c++) {
    let s = ch[c][i]; s = s < -1 ? -1 : s > 1 ? 1 : s;
    dv.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true); o += 2;
  }
  return new Blob([dv], {type:"audio/wav"});
}
function toInt16(f, s, e) {
  const a = new Int16Array(e - s);
  for (let i = s; i < e; i++) { let x = f[i]; x = x < -1 ? -1 : x > 1 ? 1 : x; a[i - s] = x < 0 ? x * 0x8000 : x * 0x7FFF; }
  return a;
}
async function resample(buf, rate) {
  const oc = new OfflineAudioContext(Math.min(2, buf.numberOfChannels), Math.ceil(buf.duration * rate), rate);
  const s = oc.createBufferSource(); s.buffer = buf; s.connect(oc.destination); s.start();
  return oc.startRendering();
}
async function encodeMp3(buf, kbps, ctl) {
  ctl.label("Getting the MP3 maker…"); ctl.progress(null);
  await loadScript(LAME_URL);
  const lame = window.lamejs;
  if (!lame || !lame.Mp3Encoder) throw oops("The MP3 maker couldn't start. Try WAV instead.");
  if (![32000, 44100, 48000].includes(buf.sampleRate)) buf = await resample(buf, 44100);
  ctl.check(); ctl.label("Making the MP3…");
  const nc = Math.min(2, buf.numberOfChannels), enc = new lame.Mp3Encoder(nc, buf.sampleRate, kbps);
  const L = buf.getChannelData(0), R = nc > 1 ? buf.getChannelData(1) : null, block = 1152 * 40, out = [];
  for (let i = 0, n = 0; i < L.length; i += block, n++) {
    const e = Math.min(L.length, i + block);
    const d = R ? enc.encodeBuffer(toInt16(L, i, e), toInt16(R, i, e)) : enc.encodeBuffer(toInt16(L, i, e));
    if (d.length) out.push(new Uint8Array(d));
    if (n % 8 === 0) { ctl.progress(e / L.length); await sleep(0); ctl.check(); }
  }
  const d = enc.flush(); if (d.length) out.push(new Uint8Array(d));
  return new Blob(out, {type:"audio/mpeg"});
}
let gifLib = null;
async function loadGifenc() {
  if (gifLib) return gifLib;
  /* gifenc's browser build is CommonJS: give it an `exports` object to fill, then tidy up. */
  const had = "exports" in window, prev = window.exports;
  window.exports = {};
  try { await loadScript(GIFENC_URL); gifLib = window.exports; }
  finally { if (had) window.exports = prev; else delete window.exports; }
  if (!gifLib || !gifLib.GIFEncoder) { gifLib = null; throw oops("The GIF maker couldn't start. Reload the page and try again."); }
  return gifLib;
}

/* ---------- Trim timeline: two handles over a thumbnail strip ---------- */
function makeTimeline(host, dur, url, o) {
  host.innerHTML = `<div class="tl"><div class="tl-thumbs loading" aria-hidden="true"></div><div class="tl-shade l"></div><div class="tl-shade r"></div><div class="tl-sel"></div><div class="tl-ph"></div>
    <div class="tl-h" role="slider" tabindex="0" data-k="a" aria-label="Start of selection"></div><div class="tl-h" role="slider" tabindex="0" data-k="b" aria-label="End of selection"></div></div>
    <div class="tl-scale"><span>0:00</span><span>Selected <b data-len></b></span><span>${fmtClock(dur)}</span></div>`;
  const tr = $(".tl", host), hA = $('[data-k="a"]', host), hB = $('[data-k="b"]', host);
  const sel = $(".tl-sel", host), shL = $(".tl-shade.l", host), shR = $(".tl-shade.r", host), ph = $(".tl-ph", host), len = $("[data-len]", host);
  let a = o.a, b = o.b, drag = null; const MIN = .1;
  const pc = t => (t / dur * 100) + "%";
  function paint() {
    hA.style.left = pc(a); hB.style.left = pc(b); sel.style.left = pc(a); sel.style.width = pc(b - a);
    shL.style.width = pc(a); shR.style.width = pc(dur - b);
    for (const [h, v] of [[hA, a], [hB, b]]) { h.setAttribute("aria-valuemin", "0"); h.setAttribute("aria-valuemax", dur.toFixed(1)); h.setAttribute("aria-valuenow", v.toFixed(1)); h.setAttribute("aria-valuetext", fmtTime(v)); }
    len.textContent = fmtTime(b - a);
  }
  const tAt = x => { const r = tr.getBoundingClientRect(); return clamp((x - r.left) / r.width, 0, 1) * dur; };
  function move(e) {
    const t = tAt(e.clientX);
    if (drag === "a") { a = clamp(t, 0, b - MIN); o.onChange(a, b); o.onSeek(a); }
    else if (drag === "b") { b = clamp(t, a + MIN, dur); o.onChange(a, b); o.onSeek(b); }
    else o.onSeek(t);
  }
  tr.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    const h = e.target.closest(".tl-h"); drag = h ? h.dataset.k : "seek";
    try { tr.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    if (h) h.focus(); e.preventDefault(); move(e);
  });
  tr.addEventListener("pointermove", e => { if (drag) move(e); });
  const end = () => { drag = null; };
  tr.addEventListener("pointerup", end); tr.addEventListener("pointercancel", end);
  for (const h of [hA, hB]) h.addEventListener("keydown", e => {
    const step = e.shiftKey ? 1 : .1, k = h.dataset.k;
    let v = k === "a" ? a : b;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") v -= step;
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") v += step;
    else if (e.key === "Home") v = 0; else if (e.key === "End") v = dur;
    else return;
    e.preventDefault();
    if (k === "a") a = clamp(v, 0, b - MIN); else b = clamp(v, a + MIN, dur);
    o.onChange(a, b); o.onSeek(k === "a" ? a : b);
  });
  /* Thumbnail strip, made in the background */
  (async () => {
    const box = $(".tl-thumbs", host), v = document.createElement("video");
    v.muted = true; v.preload = "auto"; v.src = url;
    try {
      await waitFor(v, "loadeddata", 8000);
      const n = clamp(Math.round(tr.clientWidth / 72), 5, 12), cs = [];
      for (let i = 0; i < n && host.isConnected; i++) {
        await seekTo(v, (i + .5) * dur / n);
        const c = document.createElement("canvas"); c.width = 160; c.height = 90;
        drawCover(c.getContext("2d"), v, 160, 90); cs.push(c);
      }
      box.append(...cs);
    } catch (e) { /* thumbnails are optional */ }
    finally { box.classList.remove("loading"); v.removeAttribute("src"); v.load(); }
  })();
  paint();
  return {set(na, nb) { a = na; b = nb; paint(); }, playhead(t) { ph.style.left = pc(clamp(t, 0, dur)); }, mode(cut) { tr.classList.toggle("cut", cut); }};
}

/* Shared opening step for single-video tools */
async function basicVideo(S, f, opt = {}) {
  const url = S.url(f);
  S.ws.innerHTML = `<div data-pl></div>${opt.below || ""}`;
  const P = S.player = makePlayer($("[data-pl]", S.ws), url, opt.player || {});
  await P.ready;
  S.setInfo(f.name, `${fmtSize(f.size)} · ${fmtClock(P.dur)} · ${P.vw}×${P.vh}`);
  return {url, P};
}
const resVal = S => +(($("[data-res]", S.opts) || {}).value || 0);
const muted = S => { const m = $("[data-mute]", S.opts); return !!(m && m.checked); };

/* ---------- The tools ---------- */
const TOOL_UI = {
  async trim(S, [f]) {
    let a = 0, b = 0, mode = "keep", quality = "balanced", previewing = false, tl = null;
    const {url, P} = await basicVideo(S, f, {
      below:`<div data-tl></div><div class="tbar"><button type="button" class="btn ghost small" data-sa>${I.start}Start here</button><button type="button" class="btn ghost small" data-sb>${I.end}End here</button><span class="sp"></span><button type="button" class="btn ghost small" data-pv>${I.play}Play selection</button></div>`,
      player:{scrub:false, onTime:t => { if (tl) tl.playhead(t); if (previewing && t >= b) { previewing = false; S.player.pause(); } }}
    });
    const dur = P.dur; b = dur;
    S.opts.innerHTML = `<div class="grp"><span class="lbl">The selected part</span>${seg("mode", [["keep", "Keep it"], ["cut", "Cut it out"]], "keep", "What to do with the selected part")}</div>
      <div class="row2"><label class="f">Start<input type="text" inputmode="decimal" data-a></label><label class="f">End<input type="text" inputmode="decimal" data-b></label></div>
      <p class="note">Type times like 1:05.5, drag the handles, or use <b>Start here</b> and <b>End here</b> while you watch.</p>
      ${resField(P.vw, P.vh)}${qualityGroup()}
      <label class="check"><input type="checkbox" data-mute> Remove the sound</label>`;
    const inA = $("[data-a]", S.opts), inB = $("[data-b]", S.opts);
    const outLen = () => mode === "keep" ? b - a : dur - (b - a);
    const sync = () => { inA.value = fmtTime(a); inB.value = fmtTime(b); tl.set(a, b); S.refresh(); S.enable(outLen() > .2); };
    tl = makeTimeline($("[data-tl]", S.ws), dur, url, {a, b, onChange:(na, nb) => { a = na; b = nb; sync(); }, onSeek:t => { previewing = false; P.seek(t); }});
    const fromInput = (el, k) => {
      const v = parseTime(el.value);
      if (!isFinite(v)) { S.status("Type a time like 1:05.5 or 65.5", "err"); sync(); return; }
      S.status("");
      if (k === "a") a = clamp(v, 0, b - .1); else b = clamp(v, a + .1, dur);
      sync(); P.seek(k === "a" ? a : b);
    };
    inA.addEventListener("change", () => fromInput(inA, "a"));
    inB.addEventListener("change", () => fromInput(inB, "b"));
    $("[data-sa]", S.ws).addEventListener("click", () => { a = clamp(P.v.currentTime, 0, b - .1); sync(); });
    $("[data-sb]", S.ws).addEventListener("click", () => { b = clamp(P.v.currentTime, a + .1, dur); sync(); });
    $("[data-pv]", S.ws).addEventListener("click", () => { previewing = true; P.seek(a); P.play(); });
    onSeg(S.opts, "mode", v => { mode = v; tl.mode(v === "cut"); sync(); });
    onSeg(S.opts, "quality", v => { quality = v; });
    S.action(`${I.trim}Trim video`, () => realtimeNote(outLen()));
    sync();
    S.onGo = () => {
      const clips = (mode === "keep" ? [{url, a, b}] : [{url, a:0, b:a}, {url, a:b, b:dur}]).filter(c => c.b - c.a > .05);
      const [W, H] = fitSize(P.vw, P.vh, resVal(S));
      const ka = a, kb = b, km = mode;
      exportVideo(S, {clips, W, H, draw:drawPlain, quality, audio:{mode:muted(S) ? "mute" : "keep"}}, f, "trimmed",
        () => km === "keep" ? `Kept ${fmtTime(ka)} to ${fmtTime(kb)}.` : `Cut out ${fmtTime(ka)} to ${fmtTime(kb)}.`);
    };
  },

  async compress(S, [f]) {
    let quality = "balanced";
    const {url, P} = await basicVideo(S, f);
    const HINT = {high:"Small change in size, looks almost the same.", balanced:"A good mix of size and quality. Best for most videos.", small:"The smallest file. Fine for phones and WhatsApp."};
    S.opts.innerHTML = `<div class="grp"><span class="lbl">How much smaller?</span>${seg("quality", [["high", "Light"], ["balanced", "Medium"], ["small", "Strong"]], quality, "How much smaller")}
        <p class="note" data-qh style="margin:8px 0 0"></p></div>
      ${resField(P.vw, P.vh, Math.min(P.vw, P.vh) > 720 ? 720 : 0)}
      <label class="check"><input type="checkbox" data-mute> Remove the sound</label>
      <div class="est" data-est aria-live="polite"></div>`;
    const est = () => {
      const [W, H] = fitSize(P.vw, P.vh, resVal(S));
      const bytes = (bitrateFor(W, H, quality) + (muted(S) ? 0 : 128000)) * P.dur / 8;
      $("[data-qh]", S.opts).textContent = HINT[quality];
      $("[data-est]", S.opts).innerHTML = `Now <b>${fmtSize(f.size)}</b> → about <b>${fmtSize(bytes)}</b>` +
        (bytes > f.size * .85 ? `<br><span class="muted">This video is already quite small. Try <b>Strong</b> or a lower resolution.</span>` : "");
    };
    onSeg(S.opts, "quality", v => { quality = v; est(); });
    S.opts.addEventListener("change", est);
    S.action(`${I.compress}Compress video`, () => realtimeNote(P.dur));
    S.enable(true); est();
    S.onGo = () => {
      const [W, H] = fitSize(P.vw, P.vh, resVal(S));
      exportVideo(S, {clips:[{url, a:0, b:P.dur}], W, H, draw:drawPlain, quality, audio:{mode:muted(S) ? "mute" : "keep"}, compare:true}, f, "compressed",
        r => { const p = Math.round((1 - r.blob.size / f.size) * 100); return p > 0 ? `${p}% smaller.` : "It didn't get smaller. Try Strong or a lower resolution."; });
    };
  },

  async resize(S, [f]) {
    const PRE = [["9:16", "Reels, Shorts", 9, 16], ["1:1", "Square post", 1, 1], ["4:5", "Feed portrait", 4, 5], ["16:9", "YouTube", 16, 9]];
    let ratio = PRE[0], fit = "blur", pos = .5, short = 1080, quality = "balanced";
    const size = () => ratio[2] <= ratio[3] ? [short, even(short * ratio[3] / ratio[2])] : [even(short * ratio[2] / ratio[3]), short];
    const draw = (g, v, W, H) => {
      if (fit === "fill") { g.fillStyle = "#000"; g.fillRect(0, 0, W, H); drawCover(g, v, W, H, pos, pos); }
      else { if (fit === "blur") drawBlurBg(g, v, W, H); else { g.fillStyle = "#000"; g.fillRect(0, 0, W, H); } drawContain(g, v, W, H, false); }
    };
    const {url, P} = await basicVideo(S, f, {player:{draw, size:() => size()}});
    const FH = {blur:"Shows the whole video, with a soft blurred copy in the gaps.", bars:"Shows the whole video, with black bars in the gaps.", fill:"Fills the whole frame. Some edges get cut off."};
    S.opts.innerHTML = `<div class="grp"><span class="lbl">Shape</span><div class="presets" role="group" aria-label="Shape" data-presets>${PRE.map((p, i) => {
        const k = 30 / Math.max(p[2], p[3]);
        return `<button type="button" class="preset" data-i="${i}" aria-pressed="${i === 0}"><span class="shape" style="width:${Math.round(p[2] * k)}px;height:${Math.round(p[3] * k)}px"></span>${p[0]}<small>${p[1]}</small></button>`;
      }).join("")}</div></div>
      <div class="grp"><span class="lbl">Fit</span>${seg("fit", [["blur", "Blur"], ["bars", "Bars"], ["fill", "Fill"]], fit, "How to fit the video")}<p class="note" data-fh style="margin:8px 0 0"></p></div>
      <div class="grp sub-opts" data-posg hidden><span class="lbl" data-posl>Position</span><input type="range" min="0" max="100" value="50" data-pos aria-label="Crop position"></div>
      <label class="f">Size<select data-short><option value="1080">1080p, best for uploading</option><option value="720">720p, smaller file</option></select></label>
      ${qualityGroup()}`;
    const upd = () => {
      $("[data-fh]", S.opts).textContent = FH[fit];
      $("[data-posg]", S.opts).hidden = fit !== "fill";
      const [W, H] = size(), wide = P.vw / P.vh > W / H;
      $("[data-posl]", S.opts).textContent = wide ? "Move left or right" : "Move up or down";
      P.resize(); S.refresh();
    };
    $("[data-presets]", S.opts).addEventListener("click", e => {
      const b = e.target.closest(".preset"); if (!b) return;
      $$(".preset", S.opts).forEach(x => x.setAttribute("aria-pressed", String(x === b)));
      ratio = PRE[+b.dataset.i]; upd();
    });
    onSeg(S.opts, "fit", v => { fit = v; upd(); });
    onSeg(S.opts, "quality", v => { quality = v; });
    $("[data-pos]", S.opts).addEventListener("input", e => { pos = e.target.value / 100; P.redraw(); });
    $("[data-short]", S.opts).addEventListener("change", e => { short = +e.target.value; upd(); });
    S.action(`${I.crop}Resize video`, () => realtimeNote(P.dur) + " · " + size().join("×"));
    S.enable(true); upd();
    S.onGo = () => {
      const [W, H] = size();
      exportVideo(S, {clips:[{url, a:0, b:P.dur}], W, H, draw, quality, audio:{mode:"keep"}}, f, ratio[0].replace(":", "x"),
        () => `Resized to ${ratio[0]} (${ratio[1]}).`);
    };
  },

  async rotate(S, [f]) {
    let rot = 0, fh = false, fv = false, quality = "balanced";
    const draw = (g, v, W, H) => {
      g.translate(W / 2, H / 2); g.scale(fh ? -1 : 1, fv ? -1 : 1); g.rotate(rot * Math.PI / 180);
      const sw = rot % 180 ? H : W, sh = rot % 180 ? W : H;
      g.drawImage(v, -sw / 2, -sh / 2, sw, sh);
    };
    const size = (w, h) => rot % 180 ? [h, w] : [w, h];
    const {url, P} = await basicVideo(S, f, {player:{draw, size}, below:`<div class="tbar" role="group" aria-label="Turn and flip">
      <button type="button" class="btn ghost small" data-r="-90">${I.rotL}Turn left</button><button type="button" class="btn ghost small" data-r="90">${I.rotR}Turn right</button>
      <button type="button" class="btn ghost small" data-fh aria-pressed="false">${I.flipH}Mirror</button><button type="button" class="btn ghost small" data-fv aria-pressed="false">${I.flipV}Upside down</button></div>`});
    S.opts.innerHTML = `<div class="est" data-sum aria-live="polite"></div>${resField(P.vw, P.vh)}${qualityGroup()}`;
    const desc = () => [rot ? (rot === 180 ? "Turned 180°" : rot === 90 ? "Turned 90° right" : "Turned 90° left") : "", fh ? "mirrored" : "", fv ? "flipped upside down" : ""].filter(Boolean).join(", ");
    const upd = () => {
      const d = desc();
      $("[data-sum]", S.opts).innerHTML = d ? `<b>${esc(d[0].toUpperCase() + d.slice(1))}</b>` : `Use the buttons under the video to turn or flip it.`;
      $("[data-fh]", S.ws).setAttribute("aria-pressed", String(fh)); $("[data-fv]", S.ws).setAttribute("aria-pressed", String(fv));
      P.resize(); S.enable(!!d); S.refresh();
    };
    S.ws.addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.r) rot = (rot + +b.dataset.r + 360) % 360;
      else if (b.hasAttribute("data-fh")) fh = !fh;
      else if (b.hasAttribute("data-fv")) fv = !fv;
      else return;
      upd();
    });
    onSeg(S.opts, "quality", v => { quality = v; });
    S.action(`${I.rotate}Save video`, () => realtimeNote(P.dur));
    upd();
    S.onGo = () => {
      const [W, H] = fitSize(...size(P.vw, P.vh), resVal(S)); const d = desc();
      exportVideo(S, {clips:[{url, a:0, b:P.dur}], W, H, draw, quality, audio:{mode:"keep"}}, f, "rotated", () => d[0].toUpperCase() + d.slice(1) + ".");
    };
  },

  async speed(S, [f]) {
    let rate = 2, keep = true, quality = "balanced";
    const {url, P} = await basicVideo(S, f);
    const RATES = [.25, .5, .75, 1.25, 1.5, 2, 3, 4];
    S.opts.innerHTML = `<div class="grp"><p class="bigval" data-rv></p><p class="muted" data-len style="margin:0 0 14px;font-size:.9rem"></p>
        <div class="rates" role="group" aria-label="Speed presets">${RATES.map(r => `<button type="button" data-rate="${r}">${r}×</button>`).join("")}</div>
        <input type="range" min="0.25" max="4" step="0.05" value="${rate}" data-rr aria-label="Speed"></div>
      <label class="check"><input type="checkbox" data-pitch checked><span>Keep voices sounding normal<span class="h muted" style="display:block;font-weight:400;font-size:.84rem">Off gives the chipmunk or deep slow-mo effect.</span></span></label>
      <label class="check"><input type="checkbox" data-mute> Remove the sound</label>
      ${resField(P.vw, P.vh)}${qualityGroup()}`;
    const upd = () => {
      $("[data-rv]", S.opts).textContent = (+rate.toFixed(2)) + "×";
      $("[data-len]", S.opts).textContent = `${rate < 1 ? "Slower" : rate > 1 ? "Faster" : "Normal speed"} · new length ${fmtClock(P.dur / rate)} (was ${fmtClock(P.dur)})`;
      $$("[data-rate]", S.opts).forEach(b => b.setAttribute("aria-pressed", String(Math.abs(+b.dataset.rate - rate) < .001)));
      $("[data-rr]", S.opts).value = rate;
      P.v.playbackRate = rate; setPitch(P.v, keep); P.v.muted = muted(S);
      S.enable(Math.abs(rate - 1) > .001); S.refresh();
    };
    $(".rates", S.opts).addEventListener("click", e => { const b = e.target.closest("[data-rate]"); if (b) { rate = +b.dataset.rate; upd(); } });
    $("[data-rr]", S.opts).addEventListener("input", e => { rate = +e.target.value; upd(); });
    $("[data-pitch]", S.opts).addEventListener("change", e => { keep = e.target.checked; upd(); });
    $("[data-mute]", S.opts).addEventListener("change", upd);
    onSeg(S.opts, "quality", v => { quality = v; });
    S.action(`${I.speed}Save video`, () => realtimeNote(P.dur / rate));
    upd();
    S.onGo = () => {
      const [W, H] = fitSize(P.vw, P.vh, resVal(S)), r0 = rate;
      exportVideo(S, {clips:[{url, a:0, b:P.dur}], W, H, draw:drawPlain, quality, rate, keepPitch:keep, audio:{mode:muted(S) ? "mute" : "keep"}}, f, (+rate.toFixed(2)) + "x",
        () => `Speed ${+r0.toFixed(2)}×.`);
    };
  },

  async audio(S, [f]) {
    let mode = "remove", quality = "balanced", musicVol = 1, origVol = .35, loop = true, music = null;
    const m = document.createElement("audio"); m.preload = "auto";
    const {url, P} = await basicVideo(S, f);
    S.opts.innerHTML = `<div class="grp"><span class="lbl">Sound</span>${seg("am", [["remove", "Remove"], ["replace", "Replace"], ["mix", "Add music"]], mode, "What to do with the sound")}<p class="note" data-mh style="margin:8px 0 0"></p></div>
      <div class="sub-opts" data-mus hidden>
        <div class="grp"><span class="lbl">Music</span><div class="opt-file"><button type="button" class="btn ghost small" data-mpick>${I.note}Choose music</button><span class="fname muted" data-mname>No file chosen yet</span></div>
          <input type="file" accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.opus,.flac" data-mfile hidden></div>
        <div class="grp"><span class="lbl">Music volume <output data-mvo>100%</output></span><input type="range" min="0" max="100" value="100" data-mv aria-label="Music volume"></div>
        <div class="grp sub-opts" data-og hidden><span class="lbl">Original sound <output data-ovo>35%</output></span><input type="range" min="0" max="100" value="35" data-ov aria-label="Original sound volume"></div>
        <label class="check"><input type="checkbox" data-loop checked> Repeat the music if it's shorter than the video</label>
      </div>${qualityGroup()}`;
    const MH = {remove:"Your video will be silent.", replace:"Your music plays instead of the original sound.", mix:"Your music plays quietly under the original sound."};
    const syncPrev = () => {
      const v = P.v;
      v.muted = mode !== "mix"; v.volume = mode === "mix" ? origVol : 1;
      if (!music || mode === "remove") { m.pause(); return; }
      m.volume = musicVol; m.loop = loop;
      if (!v.paused && !v.ended) {
        const md = m.duration || 0, t = loop && md ? v.currentTime % md : v.currentTime;
        if (Math.abs(m.currentTime - t) > .3) m.currentTime = t;
        if (loop || t < md) { const p = m.play(); if (p) p.catch(() => {}); }
      } else m.pause();
    };
    ["play", "pause", "seeked", "ended"].forEach(ev => P.v.addEventListener(ev, syncPrev));
    const upd = () => {
      $("[data-mh]", S.opts).textContent = MH[mode];
      $("[data-mus]", S.opts).hidden = mode === "remove";
      $("[data-og]", S.opts).hidden = mode !== "mix";
      S.enable(mode === "remove" || !!music); S.refresh(); syncPrev();
    };
    onSeg(S.opts, "am", v => { mode = v; upd(); });
    onSeg(S.opts, "quality", v => { quality = v; });
    const mfile = $("[data-mfile]", S.opts);
    $("[data-mpick]", S.opts).addEventListener("click", () => mfile.click());
    mfile.addEventListener("change", async () => {
      const af = mfile.files[0]; mfile.value = ""; if (!af) return;
      const u = S.url(af); m.src = u;
      try { await waitFor(m, "loadedmetadata"); music = {file:af, url:u, dur:m.duration}; $("[data-mname]", S.opts).textContent = `${af.name} · ${fmtClock(m.duration)}`; S.status(""); }
      catch (e) { music = null; $("[data-mname]", S.opts).textContent = "No file chosen yet"; S.status("That music file can't be played here. Try an MP3, M4A or WAV.", "err"); }
      upd();
    });
    $("[data-mv]", S.opts).addEventListener("input", e => { musicVol = e.target.value / 100; $("[data-mvo]", S.opts).textContent = e.target.value + "%"; syncPrev(); });
    $("[data-ov]", S.opts).addEventListener("input", e => { origVol = e.target.value / 100; $("[data-ovo]", S.opts).textContent = e.target.value + "%"; syncPrev(); });
    $("[data-loop]", S.opts).addEventListener("change", e => { loop = e.target.checked; syncPrev(); });
    S.action(`${I.sound}Save video`, () => mode !== "remove" && !music ? "Choose a music file first" : realtimeNote(P.dur));
    upd();
    S.onGo = () => {
      const [W, H] = fitSize(P.vw, P.vh, 0), md = mode;
      const audio = mode === "remove" ? {mode:"mute"} : {mode, url:music.url, musicVol, origVol, loop};
      exportVideo(S, {clips:[{url, a:0, b:P.dur}], W, H, draw:drawPlain, quality, audio}, f, mode === "remove" ? "muted" : "new-sound",
        () => md === "remove" ? "Sound removed." : md === "replace" ? `Sound replaced with ${music.file.name}.` : `Added ${music.file.name} under the original sound.`);
    };
    return {destroy() { m.pause(); m.removeAttribute("src"); }};
  },

  async merge(S, files) {
    const clips = []; let quality = "balanced";
    S.setInfo("Your clips", "");
    S.ws.innerHTML = `<ol class="clips" data-list aria-label="Clips, in order"></ol>
      <div class="clips-add"><button type="button" class="btn ghost small" data-more>${I.plus}Add more clips</button><span>or drop more files anywhere</span></div>`;
    S.opts.innerHTML = `<label class="f">Size<select data-res></select><span class="h">Every clip is fitted into the size of the first clip.</span></label>${qualityGroup()}
      <label class="check"><input type="checkbox" data-mute> Remove the sound</label>`;
    const list = $("[data-list]", S.ws), resSel = $("[data-res]", S.opts);
    const total = () => clips.reduce((s, c) => s + c.dur, 0);
    function render(focusSel) {
      list.innerHTML = clips.map((c, i) => `<li data-i="${i}"><span class="n" aria-hidden="true">${i + 1}</span><span data-th></span>
        <div class="ci"><b>${esc(c.file.name)}</b><span>${fmtClock(c.dur)} · ${c.w}×${c.h}</span></div>
        <div class="ib"><button type="button" class="icon-btn" data-mv="-1" aria-label="Move ${esc(c.file.name)} up"${i === 0 ? " disabled" : ""}>${I.up}</button>
        <button type="button" class="icon-btn" data-mv="1" aria-label="Move ${esc(c.file.name)} down"${i === clips.length - 1 ? " disabled" : ""}>${I.down}</button>
        <button type="button" class="icon-btn" data-rm aria-label="Remove ${esc(c.file.name)}">${I.x}</button></div></li>`).join("");
      $$("[data-th]", list).forEach((el, i) => el.replaceWith(clips[i].thumb));
      const prev = resSel.value;
      if (clips[0]) {
        const c0 = clips[0], opts = [[0, `Same as first clip (${c0.w}×${c0.h})`]];
        for (const s of [720, 480]) if (Math.min(c0.w, c0.h) > s) opts.push([s, s + "p"]);
        resSel.innerHTML = opts.map(([v, l]) => `<option value="${v}"${String(v) === prev ? " selected" : ""}>${l}</option>`).join("");
      }
      S.setInfo(clips.length + (clips.length === 1 ? " clip" : " clips"), clips.length ? fmtClock(total()) + " in total" : "");
      S.enable(clips.length >= 2); S.refresh();
      if (focusSel) { const el = $(focusSel, list); if (el && !el.disabled) el.focus(); else { const any = $("[data-rm]", list); (any || $("[data-more]", S.ws)).focus(); } }
    }
    list.addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b || busy) return;
      const i = +b.closest("li").dataset.i;
      if (b.hasAttribute("data-rm")) { clips.splice(i, 1); render(`li[data-i="${Math.min(i, clips.length - 1)}"] [data-rm]`); }
      else { const j = i + +b.dataset.mv; [clips[i], clips[j]] = [clips[j], clips[i]]; render(`li[data-i="${j}"] [data-mv="${b.dataset.mv}"]`); }
    });
    async function add(fs) {
      const vids = fs.filter(isVideo);
      if (!vids.length) { S.status("Those files don't look like videos.", "err"); return; }
      S.status("Adding " + vids.length + (vids.length === 1 ? " clip…" : " clips…"));
      let bad = 0;
      for (const f of vids) {
        try { const url = S.url(f); clips.push(Object.assign({file:f, url}, await probe(url))); render(); }
        catch (e) { bad++; }
      }
      S.status(bad ? `${bad} file${bad > 1 ? "s" : ""} couldn't be opened. Try MP4 or WebM videos.` : clips.length < 2 ? "Add at least one more clip to merge." : "", bad ? "err" : "");
    }
    $("[data-more]", S.ws).addEventListener("click", () => S.pickMore());
    onSeg(S.opts, "quality", v => { quality = v; });
    S.action(`${I.merge}Merge videos`, () => clips.length >= 2 ? realtimeNote(total()) : "Add at least two clips");
    await add(files);
    if (!clips.length) throw oops("None of those files could be opened. Try MP4 or WebM videos.");
    S.onGo = () => {
      const c0 = clips[0], [W, H] = fitSize(c0.w, c0.h, +resSel.value || 0), n = clips.length;
      exportVideo(S, {clips:clips.map(c => ({url:c.url, a:0, b:c.dur})), W, H, draw:drawContain, quality, audio:{mode:muted(S) ? "mute" : "keep"}}, c0.file, "merged",
        () => `Joined ${n} clips.`);
    };
    return {add:fs => { if (!busy) add(fs); }};
  },

  async text(S, [f]) {
    const o = {kind:"text", text:"Your text here", size:7, color:"#ffffff", box:true, opacity:1, pos:"bc", logoSize:20, img:null};
    let quality = "balanced";
    const draw = (g, v, W, H) => { g.drawImage(v, 0, 0, W, H); drawOverlay(g, W, H, o); };
    const {url, P} = await basicVideo(S, f, {player:{draw}});
    S.opts.innerHTML = `<div class="grp">${seg("kind", [["text", "Text"], ["logo", "Logo"]], "text", "What to add")}</div>
      <div data-kt>
        <label class="f">Your text<textarea data-txt rows="2" maxlength="200">${esc(o.text)}</textarea></label>
        <div class="grp"><span class="lbl">Size <output data-so>7</output></span><input type="range" min="2" max="20" step="0.5" value="7" data-size aria-label="Text size"></div>
        <div class="grp"><span class="lbl">Colour</span><div class="colorrow"><input type="color" value="#ffffff" data-col aria-label="Text colour"><label class="check" style="margin:0"><input type="checkbox" data-box checked> Dark box behind text</label></div></div>
      </div>
      <div data-kl hidden>
        <div class="grp"><span class="lbl">Logo image</span><div class="opt-file"><button type="button" class="btn ghost small" data-lpick>${I.image}Choose image</button><span class="fname muted" data-lname>A PNG with a see-through background looks best.</span></div>
          <input type="file" accept="image/*" data-lfile hidden></div>
        <div class="grp"><span class="lbl">Size <output data-lso>20%</output></span><input type="range" min="5" max="60" value="20" data-lsize aria-label="Logo size"></div>
      </div>
      <div class="grp"><span class="lbl">Position</span>${posGrid(o.pos)}</div>
      <div class="grp"><span class="lbl">Opacity <output data-opo>100%</output></span><input type="range" min="10" max="100" value="100" data-op aria-label="Opacity"></div>
      ${resField(P.vw, P.vh)}${qualityGroup()}`;
    const ok = () => o.kind === "text" ? !!o.text.trim() : !!o.img;
    const upd = () => { P.redraw(); S.enable(ok()); S.refresh(); };
    onSeg(S.opts, "kind", v => { o.kind = v; $("[data-kt]", S.opts).hidden = v !== "text"; $("[data-kl]", S.opts).hidden = v !== "logo"; upd(); });
    onSeg(S.opts, "quality", v => { quality = v; });
    $("[data-txt]", S.opts).addEventListener("input", e => { o.text = e.target.value; upd(); });
    $("[data-size]", S.opts).addEventListener("input", e => { o.size = +e.target.value; $("[data-so]", S.opts).textContent = e.target.value; upd(); });
    $("[data-col]", S.opts).addEventListener("input", e => { o.color = e.target.value; upd(); });
    $("[data-box]", S.opts).addEventListener("change", e => { o.box = e.target.checked; upd(); });
    $("[data-lsize]", S.opts).addEventListener("input", e => { o.logoSize = +e.target.value; $("[data-lso]", S.opts).textContent = e.target.value + "%"; upd(); });
    $("[data-op]", S.opts).addEventListener("input", e => { o.opacity = e.target.value / 100; $("[data-opo]", S.opts).textContent = e.target.value + "%"; upd(); });
    $("[data-pos]", S.opts).addEventListener("click", e => {
      const b = e.target.closest("[data-p]"); if (!b) return;
      $$("[data-p]", S.opts).forEach(x => x.setAttribute("aria-pressed", String(x === b))); o.pos = b.dataset.p; upd();
    });
    const lfile = $("[data-lfile]", S.opts);
    $("[data-lpick]", S.opts).addEventListener("click", () => lfile.click());
    lfile.addEventListener("change", async () => {
      const imf = lfile.files[0]; lfile.value = ""; if (!imf) return;
      const img = new Image(); img.src = S.url(imf);
      try { await img.decode(); o.img = img; $("[data-lname]", S.opts).textContent = imf.name; S.status(""); }
      catch (e) { S.status("That image couldn't be opened. Try a PNG or JPG.", "err"); }
      upd();
    });
    if (document.fonts && document.fonts.load) document.fonts.load('700 20px "Archivo"').then(() => P.redraw(), () => {});
    S.action(`${I.text}Save video`, () => ok() ? realtimeNote(P.dur) : o.kind === "logo" ? "Choose a logo image first" : "Type some text first");
    upd();
    S.onGo = () => {
      const [W, H] = fitSize(P.vw, P.vh, resVal(S)), k = o.kind;
      exportVideo(S, {clips:[{url, a:0, b:P.dur}], W, H, draw, quality, audio:{mode:"keep"}}, f, k === "logo" ? "logo" : "text",
        () => k === "logo" ? "Logo added." : "Text added.");
    };
  },

  async gif(S, [f]) {
    const {url, P} = await basicVideo(S, f);
    let start = 0, len = Math.min(5, Math.floor(P.dur * 2) / 2 || .5), fps = 12;
    const widths = [320, 480, 640].filter(w => w <= P.vw); if (!widths.length) widths.push(even(P.vw));
    let width = widths.includes(480) ? 480 : widths[widths.length - 1];
    S.opts.innerHTML = `<div class="row2"><label class="f">Start<input type="text" inputmode="decimal" data-gs value="${fmtTime(0)}"></label><label class="f">Length (sec)<input type="number" min="0.5" max="15" step="0.5" value="${len}" data-gl></label></div>
      <button type="button" class="btn ghost small" data-gset style="margin:-2px 0 18px">${I.start}Start from where the video is</button>
      <div class="grp"><span class="lbl">Smoothness</span>${seg("fps", [[8, "8 fps"], [12, "12 fps"], [15, "15 fps"]], fps, "Frames per second")}</div>
      <div class="grp"><span class="lbl">Width</span>${seg("gw", widths.map(w => [w, w + " px"]), width, "Width in pixels")}</div>
      <div class="est" data-est aria-live="polite"></div>`;
    const dims = () => { const W = even(Math.min(width, P.vw)); return [W, even(W * P.vh / P.vw)]; };
    const upd = () => {
      len = clamp(len, .5, Math.min(15, P.dur - start || .5));
      const [W, H] = dims(), n = Math.max(1, Math.round(len * fps));
      $("[data-est]", S.opts).innerHTML = `<b>${n} frames</b> at ${W}×${H}<br><span class="muted">Rough size ${fmtSize(W * H * n * .45)}. GIFs have no sound.</span>`;
      S.enable(len >= .5); S.refresh();
    };
    const inS = $("[data-gs]", S.opts), inL = $("[data-gl]", S.opts);
    inS.addEventListener("change", () => {
      const v = parseTime(inS.value);
      if (!isFinite(v)) { S.status("Type a time like 0:12.5", "err"); } else { S.status(""); start = clamp(v, 0, Math.max(0, P.dur - .5)); P.seek(start); }
      inS.value = fmtTime(start); upd();
    });
    inL.addEventListener("change", () => { len = +inL.value || 5; upd(); inL.value = len; });
    $("[data-gset]", S.opts).addEventListener("click", () => { start = clamp(P.v.currentTime, 0, Math.max(0, P.dur - .5)); inS.value = fmtTime(start); upd(); inL.value = len; });
    onSeg(S.opts, "fps", v => { fps = +v; upd(); });
    onSeg(S.opts, "gw", v => { width = +v; upd(); });
    S.action(`${I.gif}Make GIF`, () => `Takes a few seconds · plays on a loop`);
    upd();
    S.onGo = () => S.run(async ctl => {
      ctl.label("Getting the GIF maker…"); ctl.progress(null);
      const lib = await loadGifenc(); ctl.check();
      ctl.label("Making your GIF…"); ctl.progress(0);
      const v = document.createElement("video"); v.muted = true; v.preload = "auto"; v.playsInline = true; v.src = url;
      try {
        await waitFor(v, "loadeddata");
        const [W, H] = dims(), n = Math.max(1, Math.round(len * fps)), delay = Math.round(1000 / fps);
        const c = document.createElement("canvas"); c.width = W; c.height = H;
        const g = c.getContext("2d", {willReadFrequently:true}), gif = lib.GIFEncoder();
        for (let i = 0; i < n; i++) {
          ctl.check();
          await seekTo(v, Math.min(P.dur - .01, start + i / fps));
          g.drawImage(v, 0, 0, W, H);
          const d = g.getImageData(0, 0, W, H).data, pal = lib.quantize(d, 256);
          gif.writeFrame(lib.applyPalette(d, pal), W, H, {palette:pal, delay});
          ctl.progress((i + 1) / n);
          if (i % 2 === 0) await sleep(0);
        }
        gif.finish();
        return {blob:new Blob([gif.bytes()], {type:"image/gif"}), kind:"gif", name:baseName(f.name) + ".gif",
          summary:`${n} frames, ${W}×${H}, ${len} seconds from ${fmtTime(start)}. Loops forever.`};
      } finally { v.removeAttribute("src"); v.load(); }
    }, "Making your GIF…");
  },

  async extract(S, [f]) {
    let fmt = "mp3", kbps = 192;
    await basicVideo(S, f);
    S.opts.innerHTML = `<div class="grp"><span class="lbl">Format</span>${seg("fmt", [["mp3", "MP3"], ["wav", "WAV"]], fmt, "Audio format")}<p class="note" data-fh style="margin:8px 0 0"></p></div>
      <label class="f sub-opts" data-q>Quality<select data-kbps><option value="128">128 kbps · smaller</option><option value="192" selected>192 kbps · recommended</option><option value="320">320 kbps · best</option></select></label>`;
    const FH = {mp3:"Small file that plays everywhere.", wav:"Exact sound, but a much bigger file."};
    const upd = () => { $("[data-fh]", S.opts).textContent = FH[fmt]; $("[data-q]", S.opts).hidden = fmt !== "mp3"; S.refresh(); };
    onSeg(S.opts, "fmt", v => { fmt = v; upd(); });
    $("[data-kbps]", S.opts).addEventListener("change", e => { kbps = +e.target.value; S.refresh(); });
    S.action(`${I.note}Extract audio`, () => fmt === "mp3" ? `Saves as MP3 · ${kbps} kbps` : "Saves as WAV (uncompressed)");
    S.enable(!!AC); upd();
    if (!AC) S.status("This browser can't read audio. Try a recent Chrome, Edge, Firefox or Safari.", "err");
    S.onGo = () => S.run(async ctl => {
      if (f.size > 1.5e9) throw oops("This video is too big to read in the browser. Try a file under 1.5 GB, or trim it first.");
      ctl.label("Reading the sound…"); ctl.progress(null);
      const ab = await f.arrayBuffer(); ctl.check();
      const ctx = new AC(); let buf;
      try { buf = await ctx.decodeAudioData(ab); }
      catch (e) { throw oops("We couldn't find sound in this video. It may have no audio, or use a format this browser can't read."); }
      finally { ctx.close().catch(() => {}); }
      ctl.check();
      const mp3 = fmt === "mp3", blob = mp3 ? await encodeMp3(buf, kbps, ctl) : encodeWav(buf);
      return {blob, kind:"audio", name:baseName(f.name) + (mp3 ? ".mp3" : ".wav"),
        summary:`${fmtClock(buf.duration)} of ${buf.numberOfChannels > 1 ? "stereo" : "mono"} sound${mp3 ? ` at ${kbps} kbps` : ""}.`};
    }, "Reading the sound…");
  },

  async frame(S, [f]) {
    let fmt = "jpg";
    const FR = 1 / 30;
    const {P} = await basicVideo(S, f, {below:`<div class="tbar" role="group" aria-label="Step through the video">
      <button type="button" class="btn ghost small" data-step="-1">${I.back}1 sec</button><button type="button" class="btn ghost small" data-step="-${FR}" aria-label="Previous frame">${I.prev}Frame</button>
      <button type="button" class="btn ghost small" data-step="${FR}" aria-label="Next frame">Frame${I.next}</button><button type="button" class="btn ghost small" data-step="1">1 sec${I.fwd}</button></div>`});
    S.opts.innerHTML = `<div class="grp"><span class="lbl">Format</span>${seg("ff", [["jpg", "JPG"], ["png", "PNG"]], fmt, "Photo format")}<p class="note" data-fh style="margin:8px 0 0"></p></div>
      <p class="note">Play or step to the moment you want, then save. The photo is ${P.vw}×${P.vh}, the video's full size.</p>`;
    const FH = {jpg:"Smaller file. Great for sharing.", png:"Exact pixels. Bigger file."};
    const upd = () => { $("[data-fh]", S.opts).textContent = FH[fmt]; S.refresh(); };
    onSeg(S.opts, "ff", v => { fmt = v; upd(); });
    S.ws.addEventListener("click", e => { const b = e.target.closest("[data-step]"); if (!b) return; P.pause(); P.seek(P.v.currentTime + +b.dataset.step); });
    S.action(`${I.image}Save this frame`, () => `Saves as ${fmt.toUpperCase()} · ${P.vw}×${P.vh}`);
    S.enable(true); upd();
    S.onGo = async () => {
      P.pause();
      const t = P.v.currentTime, c = document.createElement("canvas"); c.width = P.vw; c.height = P.vh;
      c.getContext("2d").drawImage(P.v, 0, 0);
      const png = fmt === "png";
      const blob = await new Promise(r => c.toBlob(r, png ? "image/png" : "image/jpeg", .93));
      if (!blob) { S.status("The photo couldn't be made. Try PNG instead.", "err"); return; }
      S.showResult({blob, kind:"image", name:`${baseName(f.name)}_${fmtTime(t).replace(/[:.]/g, "-")}.${png ? "png" : "jpg"}`,
        summary:`The frame at ${fmtTime(t)}, ${c.width}×${c.height}.`});
    };
  }
};

route();
})();
