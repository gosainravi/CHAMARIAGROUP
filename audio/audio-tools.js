/* Audio portal: the tools, the home page and the hash router. Needs audio-core.js and audio-ui.js. */
(function () {
  "use strict";
  var AK = window.AK, UI = window.KUI, $ = UI.$, $$ = UI.$$, esc = UI.esc, icon = UI.icon;
  var main = document.getElementById("app");

  /* ================= Shared single-file tool ================= */
  /* cfg: video, wave {select, zoom, maxSel, moveSel}, opts(ctx) html, init(ctx), process(ctx, prog) -> {clip, summary}, formats, action, suffix */
  function singleTool(cfg) {
    return function (root, t) {
      var ctx = { t: t, root: root, clip: null, file: null, name: "" };
      var wave = null, getFmt = null, stageEl, resEl, busy = false;
      root.innerHTML = UI.toolHead(t);
      stageEl = $("[data-stage]", root);

      function picker() {
        if (wave) { wave.destroy(); wave = null; }
        UI.clearResult(resEl); resEl = null; ctx.clip = null;
        stageEl.innerHTML = UI.pickerHtml({ label: cfg.pick || "Select audio file", video: cfg.video });
        UI.wirePicker(stageEl, function (f) { load(f[0]); });
      }
      async function load(f) {
        var pst = $("[data-pst]", stageEl) || $("[data-st]", stageEl);
        if (!f) return;
        if (!UI.isOk(f, cfg.video)) { UI.status(pst, cfg.video ? "That doesn't look like an audio or video file. Try MP3, WAV, M4A or MP4." : "That doesn't look like an audio file. Try MP3, WAV, M4A, OGG or FLAC.", "err"); return; }
        UI.status(pst, "Opening " + f.name + "…");
        try { var clip = await UI.decode(f); } catch (e) { UI.status(pst, UI.errText(e), "err"); return; }
        ctx.file = f; ctx.name = UI.baseName(f.name);
        work(clip, f.name, AK.fmtSize(f.size));
      }
      function work(clip, label, size) {
        if (wave) wave.destroy();
        UI.clearResult(resEl);
        ctx.clip = clip;
        stageEl.innerHTML = '<div class="work"><section class="box" aria-label="Your audio"><div class="box-h fhead"><span class="fname">' + esc(label) + '</span><span class="meta">' + AK.fmtTime(AK.dur(clip)) + (size ? " · " + size : "") + " · " + (clip.ch.length > 1 ? "stereo" : "mono") + '</span><button type="button" class="btn ghost small" data-change>Change file</button></div>' +
          '<div class="box-b"><div data-wave></div>' + (cfg.below ? cfg.below(ctx) : "") + "</div></section>" +
          '<aside class="opts" aria-label="Options"><h2>' + (cfg.optsTitle || "Options") + "</h2>" + (cfg.opts ? cfg.opts(ctx) : "") + UI.formatField(cfg.formats) +
          '<button type="button" class="btn wide" data-go>' + esc(cfg.action) + '</button><progress max="1" value="0" hidden></progress><p class="status" data-st role="status" aria-live="polite"></p></aside></div>' +
          '<section class="results" data-res hidden></section>';
        resEl = $("[data-res]", stageEl);
        ctx.st = $("[data-st]", stageEl);
        var w = cfg.wave || {};
        wave = ctx.wave = new UI.Wave($("[data-wave]", stageEl), { select: !!w.select, zoom: w.zoom !== false, maxSel: w.maxSel || 0, moveSel: !!w.moveSel, route: cfg.route ? function (a, s) { return cfg.route(ctx, a, s); } : null, onChange: function () { if (cfg.onSel) cfg.onSel(ctx); } });
        wave.setClip(clip);
        if (cfg.defaultSel) { var ds = cfg.defaultSel(clip); wave.setSel(ds[0], ds[1]); wave.cursor = ds[0]; wave.draw(); }
        getFmt = UI.wireFormat(stageEl);
        $("[data-change]", stageEl).onclick = function () { UI.filePrompt({ video: cfg.video }, function (f) { load(f[0]); }); };
        $("[data-go]", stageEl).onclick = run;
        if (cfg.init) cfg.init(ctx);
      }
      async function run() {
        if (busy || !ctx.clip) return;
        var go = $("[data-go]", stageEl), pr = $("progress", stageEl), st = ctx.st;
        busy = true; go.disabled = true; wave.pause(); UI.clearResult(resEl);
        pr.hidden = false; pr.value = 0; UI.status(st, "Working on it…");
        try {
          await UI.wait(30);
          var out = await cfg.process(ctx, function (p) { pr.value = p * 0.5; });
          var fmt = getFmt();
          UI.status(st, fmt.fmt === "wav" ? "Saving…" : "Encoding " + fmt.fmt.toUpperCase() + "…" + (UI.liveMime(fmt.fmt) && fmt.fmt !== "mp3" ? " This runs in real time." : ""));
          var enc = await UI.encode(out.clip, fmt, function (p) { pr.value = 0.5 + p * 0.5; });
          UI.status(st, "Done.", "ok");
          var resultClip = out.clip;
          UI.showResult(resEl, {
            blob: enc.blob, name: ctx.name + (cfg.suffix ? "_" + cfg.suffix : "") + "." + enc.ext, summary: out.summary,
            onAgain: function () { UI.clearResult(resEl); go.focus(); },
            onReset: picker,
            onEdit: t.id === "editor" ? null : function () { UI.handoff = { clip: resultClip, name: ctx.name + (cfg.suffix ? "_" + cfg.suffix : "") }; location.hash = "#/t/editor"; }
          });
        } catch (e) { console.error(e); UI.status(st, UI.errText(e), "err"); }
        finally { busy = false; go.disabled = false; pr.hidden = true; }
      }
      picker();
      takeIncoming(function (f) { load(f[0]); });
      return {
        onFiles: function (f) { if (!busy) load(f[0]); },
        keydown: function (e) { if (wave && isSpace(e) && calm(e)) { e.preventDefault(); wave.toggle(); } },
        destroy: function () { if (wave) wave.destroy(); UI.clearResult(resEl); if (cfg.destroy) cfg.destroy(ctx); }
      };
    };
  }
  function takeIncoming(open) { if (UI.pending) { var f = UI.pending; UI.pending = null; open(f); } }
  function isSpace(e) { return e.key === " " || e.key === "Spacebar"; }
  function typing(e) { var el = e.target; if (!el || !el.tagName) return false; var tg = el.tagName; return tg === "TEXTAREA" || tg === "SELECT" || (tg === "INPUT" && !/^(range|checkbox|radio|button)$/.test(el.type)) || el.isContentEditable; }
  /* Space toggles play only when focus isn't on a control that uses Space itself */
  function calm(e) { var el = e.target; return !el || el === document.body || el === main || el.tagName === "CANVAS" || !el.closest("button,a,input,select,textarea,[contenteditable]"); }
  function fmtSel(sel) { return sel ? AK.fmtTime(sel.a) + " – " + AK.fmtTime(sel.b) + " · " + (sel.b - sel.a).toFixed(1) + " s" : "Nothing selected"; }
  function rangeVal(root, sel) { return parseFloat($(sel, root).value); }
  function segVal(root, name) { var b = $('[data-seg="' + name + '"] [aria-pressed=true]', root); return b ? b.dataset.v : null; }
  function segHtml(name, label, items, def) {
    return '<div class="seg full" role="group" aria-label="' + label + '" data-seg="' + name + '">' + items.map(function (it) { return '<button type="button" data-v="' + it[0] + '" aria-pressed="' + (it[0] === def) + '">' + it[1] + "</button>"; }).join("") + "</div>";
  }
  function wireSegs(root, onChange) {
    $$("[data-seg]", root).forEach(function (g) {
      g.addEventListener("click", function (e) { var b = e.target.closest("[data-v]"); if (!b) return; $$("[data-v]", g).forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); }); if (onChange) onChange(g.dataset.seg, b.dataset.v); });
    });
  }
  function selFields(prefix) {
    return '<div class="row2"><label class="f">Start<input type="text" inputmode="decimal" data-a placeholder="0:00.0" autocomplete="off"></label><label class="f">End<input type="text" inputmode="decimal" data-b placeholder="0:00.0" autocomplete="off"></label></div>';
  }
  function wireSelFields(ctx, extra) {
    var r = ctx.root, ia = $("[data-a]", r), ib = $("[data-b]", r);
    var apply = function () {
      var a = UI.parseTime(ia.value), b = UI.parseTime(ib.value), D = AK.dur(ctx.clip);
      if (!isFinite(a) || !isFinite(b)) { UI.status(ctx.st, "Type times like 1:05.5 or 65.5.", "err"); return; }
      if (b <= a) { UI.status(ctx.st, "The end must be after the start.", "err"); return; }
      UI.status(ctx.st, ""); ctx.wave.setSel(Math.min(a, D), Math.min(b, D)); ctx.wave.cursor = ctx.wave.sel ? ctx.wave.sel.a : 0; ctx.wave.draw();
    };
    ia.onchange = apply; ib.onchange = apply;
    ia.onkeydown = ib.onkeydown = function (e) { if (e.key === "Enter") apply(); };
    return function sync() { var s = ctx.wave.sel; if (document.activeElement !== ia) ia.value = s ? AK.fmtTime(s.a, 2) : ""; if (document.activeElement !== ib) ib.value = s ? AK.fmtTime(s.b, 2) : ""; if (extra) extra(s); };
  }

  /* ================= Tools ================= */

  /* ---- Cut audio ---- */
  var cutTool = singleTool({
    wave: { select: true, zoom: true }, action: "Cut audio", suffix: "cut", formats: ["mp3", "wav"],
    defaultSel: function (c) { var D = AK.dur(c); return [D * 0.25, D * 0.75]; },
    opts: function () {
      return '<div class="grp"><h3>Part to cut</h3><p class="note">Drag on the waveform, or drag the edges of the shaded part. You can also type times.</p>' + selFields() +
        '<div class="btnrow"><button type="button" class="btn ghost small" data-seta>Start at playhead</button><button type="button" class="btn ghost small" data-setb>End at playhead</button></div>' +
        '<p class="selinfo" data-si></p>' +
        '<div class="f lab">What to do' + segHtml("mode", "What to do with the selected part", [["keep", "Keep it"], ["remove", "Remove it"]], "keep") + "</div>" +
        '<label class="check"><input type="checkbox" data-soft checked> Soft edges (tiny fade so the cut doesn\'t click)</label></div>';
    },
    init: function (ctx) {
      var sync = wireSelFields(ctx, function (s) { $("[data-si]", ctx.root).textContent = fmtSel(s); });
      ctx.syncSel = sync; sync(); wireSegs(ctx.root);
      $("[data-seta]", ctx.root).onclick = function () { var w = ctx.wave, p = w.pos(), b = w.sel ? w.sel.b : AK.dur(ctx.clip); if (p < b) w.setSel(p, b); };
      $("[data-setb]", ctx.root).onclick = function () { var w = ctx.wave, p = w.pos(), a = w.sel ? w.sel.a : 0; if (p > a) w.setSel(a, p); };
    },
    onSel: function (ctx) { if (ctx.syncSel) ctx.syncSel(); },
    process: async function (ctx) {
      var s = ctx.wave.sel, c = ctx.clip; if (!s) throw new Error("Select a part of the waveform first.");
      var a = AK.sec2s(c, s.a), b = AK.sec2s(c, s.b), soft = $("[data-soft]", ctx.root).checked, f = Math.round(c.sr * 0.012), out;
      if (segVal(ctx.root, "mode") === "keep") {
        out = AK.slice(c, a, b);
        if (soft) { var L = AK.len(out); out = AK.fade(AK.fade(out, 0, Math.min(f, L >> 1), "in"), L - Math.min(f, L >> 1), L, "out"); }
        return { clip: out, summary: "Kept " + AK.fmtTime(s.a) + " to " + AK.fmtTime(s.b) + ". New length " + AK.fmtTime(AK.dur(out)) + "." };
      }
      out = AK.remove(c, a, b);
      if (soft) { var j = a, n = AK.len(out); if (j > 0) out = AK.fade(out, Math.max(0, j - f), j, "out"); if (j < n) out = AK.fade(out, j, Math.min(n, j + f), "in"); }
      return { clip: out, summary: "Removed " + (s.b - s.a).toFixed(1) + " s. New length " + AK.fmtTime(AK.dur(out)) + "." };
    }
  });

  /* ---- Convert ---- */
  var convertTool = singleTool({
    video: true, wave: { select: false, zoom: false }, action: "Convert", formats: ["mp3", "wav", "webm", "m4a"], pick: "Select audio or video",
    opts: function (ctx) {
      return '<div class="grp"><label class="f">Channels<select data-chan><option value="keep">Keep as it is (' + (ctx.clip.ch.length > 1 ? "stereo" : "mono") + ')</option><option value="1">Mono (half the size for WAV)</option><option value="2">Stereo</option></select></label></div>';
    },
    process: async function (ctx) {
      var ch = $("[data-chan]", ctx.root).value, c = ctx.clip;
      if (ch !== "keep") c = AK.toChannels(c, +ch);
      var isVid = ctx.file && (/^video\//.test(ctx.file.type) || /\.(mp4|mov|m4v|mkv|avi)$/i.test(ctx.file.name));
      return { clip: c, summary: (isVid ? "Took the sound out of your video: " : "Converted ") + AK.fmtTime(AK.dur(c)) + " of audio, " + (c.ch.length > 1 ? "stereo" : "mono") + "." };
    }
  });

  /* ---- Speed & pitch ---- */
  var speedTool = singleTool({
    wave: { select: false, zoom: true }, action: "Apply changes", suffix: "speed", formats: ["mp3", "wav"],
    opts: function () {
      return '<div class="grp"><div class="f lab">What to change' + segHtml("mode", "What to change", [["speed", "Speed"], ["pitch", "Pitch"], ["both", "Both"]], "speed") + "</div>" +
        '<p class="note" data-mnote></p>' +
        '<div data-speedf><label class="f">Speed <output data-so>1.25×</output><input type="range" min="0.5" max="2" step="0.05" value="1.25" data-speed aria-label="Speed"></label>' +
        '<div class="minis" data-sp>' + [0.5, 0.75, 1.25, 1.5, 2].map(function (v) { return '<button type="button" data-v="' + v + '" aria-pressed="' + (v === 1.25) + '">' + v + "×</button>"; }).join("") + "</div></div>" +
        '<div data-pitchf hidden><label class="f">Pitch <output data-po>+2 semitones</output><input type="range" min="-12" max="12" step="1" value="2" data-pitch aria-label="Pitch in semitones"><span class="h">12 semitones is one octave. Negative is deeper, positive is higher.</span></label></div>' +
        '<p class="selinfo" data-len></p></div>';
    },
    init: function (ctx) {
      var r = ctx.root, sp = $("[data-speed]", r), pi = $("[data-pitch]", r);
      var notes = { speed: "Changes how fast it plays. Voices keep their normal pitch.", pitch: "Makes it sound higher or deeper. The length stays the same.", both: "Like playing a record faster or slower: speed and pitch change together." };
      var upd = function () {
        var m = segVal(r, "mode"), s = +sp.value, p = +pi.value;
        $("[data-so]", r).textContent = s.toFixed(2).replace(/0$/, "") + "×";
        $("[data-po]", r).textContent = (p > 0 ? "+" : "") + p + " semitone" + (Math.abs(p) === 1 ? "" : "s");
        $("[data-mnote]", r).textContent = notes[m];
        $("[data-speedf]", r).hidden = m === "pitch"; $("[data-pitchf]", r).hidden = m !== "pitch";
        $$("[data-sp] button", r).forEach(function (b) { b.setAttribute("aria-pressed", String(Math.abs(+b.dataset.v - s) < 1e-6)); });
        var D = AK.dur(ctx.clip); $("[data-len]", r).textContent = "New length: " + AK.fmtTime(m === "pitch" ? D : D / s) + " (now " + AK.fmtTime(D) + ")";
      };
      wireSegs(r, upd); sp.oninput = upd; pi.oninput = upd;
      $("[data-sp]", r).onclick = function (e) { var b = e.target.closest("[data-v]"); if (b) { sp.value = b.dataset.v; upd(); } };
      upd();
    },
    process: async function (ctx, prog) {
      var r = ctx.root, m = segVal(r, "mode"), s = +$("[data-speed]", r).value, p = +$("[data-pitch]", r).value, c = ctx.clip, out;
      if (m === "pitch") { if (!p) throw new Error("Move the pitch slider away from 0 first."); out = await AK.pitchShift(c, p, prog); return { clip: out, summary: "Pitch moved " + (p > 0 ? "up " : "down ") + Math.abs(p) + " semitone" + (Math.abs(p) === 1 ? "" : "s") + ". Length unchanged." }; }
      if (Math.abs(s - 1) < 1e-3) throw new Error("Pick a speed other than 1× first.");
      if (m === "both") { out = AK.resample(c, c.sr * s, c.sr); return { clip: out, summary: "Played at " + s + "× with pitch following. New length " + AK.fmtTime(AK.dur(out)) + "." }; }
      out = await AK.timeStretch(c, s, prog);
      return { clip: out, summary: "Speed set to " + s + "× with the pitch kept. New length " + AK.fmtTime(AK.dur(out)) + "." };
    }
  });

  /* ---- Volume booster ---- */
  var volumeTool = singleTool({
    wave: { select: false, zoom: false }, action: "Boost volume", suffix: "louder", formats: ["mp3", "wav"],
    route: function (ctx, a, s) { var g = a.createGain(); g.gain.value = AK.dbToGain(+$("[data-db]", ctx.root).value); ctx.gainNode = g; s.connect(g); return g; },
    opts: function (ctx) {
      var pk = AK.peak(ctx.clip), room = -AK.gainToDb(pk);
      ctx.room = room;
      return '<div class="grp"><p class="note">Loudest point now: <b>' + (pk > 0 ? AK.gainToDb(pk).toFixed(1) + " dB" : "silent") + "</b>. " + (room > 0.5 ? "There is " + room.toFixed(1) + " dB of room before it would clip." : "It already reaches full level, so the limiter will do the work.") + "</p>" +
        '<label class="f">Boost <output data-dbo></output><input type="range" min="0" max="20" step="0.5" value="6" data-db aria-label="Boost in decibels"></label>' +
        '<div class="minis" data-pre><button type="button" data-v="3">A little</button><button type="button" data-v="6">Louder</button><button type="button" data-v="10">Much louder</button><button type="button" data-v="max">Fill to the top</button></div>' +
        '<label class="check"><input type="checkbox" data-lim checked> Soft limiter (keeps peaks from crackling)</label>' +
        '<p class="note">Press play on the left to hear the boost live. The saved file also gets the limiter.</p></div>';
    },
    init: function (ctx) {
      var r = ctx.root, db = $("[data-db]", r);
      var upd = function () { var v = +db.value; $("[data-dbo]", r).textContent = "+" + v + " dB · " + AK.dbToGain(v).toFixed(1) + "× level"; if (ctx.gainNode) ctx.gainNode.gain.value = AK.dbToGain(v); };
      db.oninput = upd; upd();
      $("[data-pre]", r).onclick = function (e) { var b = e.target.closest("[data-v]"); if (!b) return; db.value = b.dataset.v === "max" ? Math.max(0, Math.min(20, Math.floor((ctx.room - 0.3) * 2) / 2)) : b.dataset.v; upd(); };
    },
    process: async function (ctx) {
      var r = ctx.root, v = +$("[data-db]", r).value, lim = $("[data-lim]", r).checked;
      if (!v) throw new Error("Move the boost slider above 0 dB first.");
      var c = AK.gain(ctx.clip, AK.dbToGain(v)), msg = "Boosted by " + v + " dB.";
      if (lim) { c = AK.limit(c, 0.97); if (c.limited > 0.001) msg += " The limiter softly held back peaks in " + Math.max(1, Math.round(c.limited * 100)) + "% of the track."; }
      else if (AK.peak(c) > 1) msg += " Some peaks are above full level and will clip.";
      return { clip: c, summary: msg };
    }
  });

  /* ---- Equaliser ---- */
  var EQ_PRESETS = { flat: [0, 0, 0, "Flat"], voice: [-3, 3, 2, "Voice"], bass: [7, 0, -1, "Bass boost"], treble: [0, 0, 6, "Treble boost"], warm: [3, -1, -3, "Warm"], radio: [-12, 5, -10, "Old radio"] };
  function eqNodes(a, vals) {
    var lo = a.createBiquadFilter(); lo.type = "lowshelf"; lo.frequency.value = 120; lo.gain.value = vals[0];
    var mi = a.createBiquadFilter(); mi.type = "peaking"; mi.frequency.value = 1000; mi.Q.value = 0.9; mi.gain.value = vals[1];
    var hi = a.createBiquadFilter(); hi.type = "highshelf"; hi.frequency.value = 5000; hi.gain.value = vals[2];
    lo.connect(mi); mi.connect(hi); return [lo, mi, hi];
  }
  function eqVals(r) { return ["bass", "mid", "treble"].map(function (k) { return +$("[data-eq=" + k + "]", r).value; }); }
  var eqTool = singleTool({
    wave: { select: false, zoom: false }, action: "Apply equaliser", suffix: "eq", formats: ["mp3", "wav"],
    route: function (ctx, a, s) { var n = eqNodes(a, eqVals(ctx.root)); ctx.eq = n; s.connect(n[0]); return n[2]; },
    opts: function () {
      var sl = function (k, lab, hint) { return '<label class="f">' + lab + ' <output data-eqo="' + k + '">0 dB</output><input type="range" min="-12" max="12" step="0.5" value="0" data-eq="' + k + '"><span class="h">' + hint + "</span></label>"; };
      return '<div class="grp"><h3>Presets</h3><div class="minis" data-pre>' + Object.keys(EQ_PRESETS).map(function (k) { return '<button type="button" data-v="' + k + '" aria-pressed="' + (k === "flat") + '">' + EQ_PRESETS[k][3] + "</button>"; }).join("") + "</div></div>" +
        '<div class="grp"><h3>Fine tune</h3>' + sl("bass", "Bass", "Deep sounds, around 120 Hz and below") + sl("mid", "Mid", "Voices and most instruments, around 1 kHz") + sl("treble", "Treble", "Crispness and sparkle, 5 kHz and above") +
        '<p class="note">Press play to hear changes live while you move the sliders.</p></div>';
    },
    init: function (ctx) {
      var r = ctx.root;
      var upd = function (fromPreset) {
        var v = eqVals(r);
        ["bass", "mid", "treble"].forEach(function (k, i) { $("[data-eqo=" + k + "]", r).textContent = (v[i] > 0 ? "+" : "") + v[i] + " dB"; if (ctx.eq) ctx.eq[i].gain.value = v[i]; });
        if (!fromPreset) $$("[data-pre] button", r).forEach(function (b) { var p = EQ_PRESETS[b.dataset.v]; b.setAttribute("aria-pressed", String(p[0] === v[0] && p[1] === v[1] && p[2] === v[2])); });
      };
      $$("[data-eq]", r).forEach(function (s) { s.oninput = function () { upd(); }; });
      $("[data-pre]", r).onclick = function (e) {
        var b = e.target.closest("[data-v]"); if (!b) return; var p = EQ_PRESETS[b.dataset.v];
        ["bass", "mid", "treble"].forEach(function (k, i) { $("[data-eq=" + k + "]", r).value = p[i]; });
        $$("[data-pre] button", r).forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); }); upd(true);
      };
      upd();
    },
    process: async function (ctx) {
      var v = eqVals(ctx.root);
      if (!v[0] && !v[1] && !v[2]) throw new Error("All sliders are at 0, so nothing would change. Pick a preset or move a slider.");
      var c = await UI.renderOffline(ctx.clip, function (a, s) { var n = eqNodes(a, v); s.connect(n[0]); return n[2]; });
      var msg = "Bass " + (v[0] > 0 ? "+" : "") + v[0] + " dB, mid " + (v[1] > 0 ? "+" : "") + v[1] + " dB, treble " + (v[2] > 0 ? "+" : "") + v[2] + " dB.";
      if (AK.peak(c) > 0.98) { c = AK.limit(c, 0.97); msg += " Peaks were softly limited so nothing clips."; }
      return { clip: c, summary: msg };
    }
  });

  /* ---- Reduce noise ---- */
  var noiseTool = singleTool({
    wave: { select: false, zoom: true }, action: "Reduce noise", suffix: "clean", formats: ["mp3", "wav"],
    opts: function () {
      return '<p class="note">Best for steady background sound such as fan hum, AC noise or hiss, heard in the pauses between words. It turns those pauses down and filters out low rumble. It can\'t remove noise that sits right under the voice.</p>' +
        '<div class="grp"><label class="f">Noise level <output data-tho></output><input type="range" min="-80" max="-15" step="1" value="-50" data-th aria-label="Noise level threshold in decibels"><span class="h">Sound quieter than this counts as noise. We set it from your file; nudge it up if noise remains.</span></label>' +
        '<div class="btnrow"><button type="button" class="btn ghost small" data-detect>Detect again</button></div>' +
        '<label class="f">Turn the noise down<select data-red><option value="-12">Gently</option><option value="-24" selected>Clearly</option><option value="-40">Strongly</option><option value="-80">Mute it fully</option></select></label>' +
        '<label class="f">Remove low hum and rumble<select data-hp><option value="0">Off</option><option value="80" selected>Below 80 Hz (safe for voice)</option><option value="120">Below 120 Hz</option><option value="200">Below 200 Hz (strong)</option></select></label>' +
        '<label class="check"><input type="checkbox" data-lp> Soften hiss (cuts the very highest sounds)</label></div>';
    },
    init: function (ctx) {
      var r = ctx.root, th = $("[data-th]", r);
      var upd = function () { $("[data-tho]", r).textContent = th.value + " dB"; };
      var detect = function () { var f = AK.noiseFloorDb(ctx.clip); th.value = Math.max(-80, Math.min(-15, Math.round(f + 8))); upd(); UI.status(ctx.st, "Background noise is around " + Math.round(f) + " dB."); };
      th.oninput = upd; $("[data-detect]", r).onclick = detect; detect();
    },
    process: async function (ctx, prog) {
      var r = ctx.root, hp = +$("[data-hp]", r).value, lp = $("[data-lp]", r).checked, thr = +$("[data-th]", r).value, red = +$("[data-red]", r).value;
      var c = ctx.clip;
      if (hp || lp) c = await UI.renderOffline(c, function (a, s) {
        var last = s;
        if (hp) for (var i = 0; i < 2; i++) { var f = a.createBiquadFilter(); f.type = "highpass"; f.frequency.value = hp; f.Q.value = 0.707; last.connect(f); last = f; }
        if (lp) { var l = a.createBiquadFilter(); l.type = "lowpass"; l.frequency.value = 9000; l.Q.value = 0.707; last.connect(l); last = l; }
        return last;
      });
      prog(0.5);
      c = AK.gate(c, thr, red);
      var share = Math.round(c.quietShare * 100);
      return { clip: c, summary: "Turned down the quiet parts (" + share + "% of the track)" + (hp ? ", removed rumble below " + hp + " Hz" : "") + (lp ? ", softened hiss" : "") + "." + (share > 70 ? " That's a lot: if words sound cut off, lower the noise level and try again." : "") };
    }
  });

  /* ---- Reverse ---- */
  var reverseTool = singleTool({
    wave: { select: false, zoom: false }, action: "Reverse audio", suffix: "reversed", formats: ["mp3", "wav"],
    opts: function () { return '<p class="note">The whole track will play backwards, end first. Listen to the result before you download.</p>'; },
    process: async function (ctx) { return { clip: AK.reverse(ctx.clip), summary: "Reversed " + AK.fmtTime(AK.dur(ctx.clip)) + " of audio." }; }
  });

  /* ---- Ringtone maker ---- */
  var ringTool = singleTool({
    wave: { select: true, zoom: true, maxSel: 30, moveSel: true }, action: "Make ringtone", suffix: "ringtone", formats: ["mp3", "m4r", "wav"],
    defaultSel: function (c) { return [0, Math.min(30, AK.dur(c))]; },
    opts: function () {
      return '<div class="grp"><h3>Pick the best part (up to 30 s)</h3><p class="note">Drag the shaded part to move it, or drag its edges.</p>' + selFields() + '<p class="selinfo" data-si></p>' +
        '<div class="row2"><label class="f">Fade in<select data-fi><option value="0">None</option><option value="0.5">0.5 s</option><option value="1" selected>1 s</option><option value="2">2 s</option></select></label>' +
        '<label class="f">Fade out<select data-fo><option value="0">None</option><option value="1">1 s</option><option value="2" selected>2 s</option><option value="3">3 s</option></select></label></div></div>' +
        (UI.liveMime("m4r") ? "" : '<p class="note">For iPhone: save as MP3, open it in GarageBand, then share it as a ringtone. Android phones can use the MP3 directly.</p>');
    },
    init: function (ctx) { var sync = wireSelFields(ctx, function (s) { $("[data-si]", ctx.root).textContent = fmtSel(s); }); ctx.syncSel = sync; sync(); },
    onSel: function (ctx) { if (ctx.syncSel) ctx.syncSel(); },
    process: async function (ctx) {
      var s = ctx.wave.sel, c = ctx.clip; if (!s) throw new Error("Select the part you want first.");
      var out = AK.slice(c, AK.sec2s(c, s.a), AK.sec2s(c, s.b)), L = AK.len(out);
      var fi = Math.min(L >> 1, Math.round(+$("[data-fi]", ctx.root).value * c.sr)), fo = Math.min(L >> 1, Math.round(+$("[data-fo]", ctx.root).value * c.sr));
      if (fi) out = AK.fade(out, 0, fi, "in"); if (fo) out = AK.fade(out, L - fo, L, "out");
      return { clip: out, summary: "Ringtone of " + (s.b - s.a).toFixed(1) + " s with soft fades." };
    }
  });

  /* ================= Audio editor ================= */
  function editorTool(root, t) {
    var clip = null, name = "audio", hist = [], redo = [], wave = null, stageEl, resEl, getFmt, busy = false;
    root.innerHTML = UI.toolHead(t); stageEl = $("[data-stage]", root);
    function picker() {
      if (wave) { wave.destroy(); wave = null; } UI.clearResult(resEl); resEl = null; clip = null;
      stageEl.innerHTML = UI.pickerHtml({ label: "Select audio file", video: true });
      UI.wirePicker(stageEl, function (f) { load(f[0]); });
    }
    async function load(f) {
      var pst = $("[data-pst]", stageEl) || $("[data-st]", stageEl);
      if (!UI.isOk(f, true)) { UI.status(pst, "That doesn't look like an audio or video file.", "err"); return; }
      UI.status(pst, "Opening " + f.name + "…");
      try { var c = await UI.decode(f); } catch (e) { UI.status(pst, UI.errText(e), "err"); return; }
      open(c, UI.baseName(f.name), f.name);
    }
    var B = function (op, label, ic) { return '<button type="button" class="btn ghost small" data-op="' + op + '">' + (ic ? icon(ic) : "") + label + "</button>"; };
    function open(c, nm, label) {
      name = nm; hist = []; redo = []; UI.clearResult(resEl);
      stageEl.innerHTML = '<div class="work"><section class="box" aria-label="Editor"><div class="box-h fhead"><span class="fname">' + esc(label) + '</span><span class="meta" data-meta></span><button type="button" class="btn ghost small" data-change>Open another</button></div>' +
        '<div class="box-b"><div data-wave></div>' +
        '<div class="btnrow" role="toolbar" aria-label="Edit tools" style="margin:14px 0 0">' +
        '<button type="button" class="icon-btn" data-op="undo" aria-label="Undo (Ctrl+Z)" title="Undo (Ctrl+Z)">' + icon("undo") + '</button><button type="button" class="icon-btn" data-op="redo" aria-label="Redo (Ctrl+Shift+Z)" title="Redo (Ctrl+Shift+Z)">' + icon("redo") + "</button>" +
        B("keep", "Keep selection") + B("cut", "Delete selection") + B("mute", "Silence") + B("fin", "Fade in") + B("fout", "Fade out") + B("norm", "Normalise") + B("rev", "Reverse") + "</div>" +
        '<p class="kbd"><kbd>Space</kbd> play or pause · <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo · <kbd>Del</kbd> delete selection · <kbd>+</kbd>/<kbd>−</kbd> zoom · <kbd>Ctrl</kbd>+scroll zoom at the pointer · <kbd>Shift</kbd>+arrows select · <kbd>Esc</kbd> clear</p></div></section>' +
        '<aside class="opts" aria-label="Selection and saving"><h2>Selection</h2>' + selFields() + '<p class="selinfo" data-si></p>' +
        '<div class="btnrow"><button type="button" class="btn ghost small" data-op="all">Select all</button><button type="button" class="btn ghost small" data-op="none">Clear</button><button type="button" class="btn ghost small" data-op="zsel">Zoom to it</button></div>' +
        '<p class="note">Fades, normalise and reverse use the selection, or the whole track when nothing is selected (fades then use the first or last 3 seconds).</p>' +
        '<div class="grp"><label class="f">Volume <output data-vo>100%</output><input type="range" min="0" max="200" value="100" data-vol aria-label="Output volume"></label></div>' +
        UI.formatField(["mp3", "wav"]) + '<button type="button" class="btn wide" data-go>Save audio</button><progress max="1" value="0" hidden></progress><p class="status" data-st role="status" aria-live="polite"></p></aside></div>' +
        '<section class="results" data-res hidden></section>';
      resEl = $("[data-res]", stageEl);
      var ctx = { root: stageEl, st: $("[data-st]", stageEl) };
      var vol = $("[data-vol]", stageEl), gainNode = null;
      wave = ctx.wave = new UI.Wave($("[data-wave]", stageEl), { select: true, zoom: true, globalSpace: true,
        route: function (a, s) { gainNode = a.createGain(); gainNode.gain.value = vol.value / 100; s.connect(gainNode); return gainNode; },
        onChange: function () { if (ctx.sync) ctx.sync(); } });
      ctx.clip = c; clip = c;
      ctx.sync = wireSelFields({ root: stageEl, get clip() { return clip; }, wave: wave, st: ctx.st }, function (s) { $("[data-si]", stageEl).textContent = fmtSel(s); });
      vol.oninput = function () { $("[data-vo]", stageEl).textContent = vol.value + "%"; if (gainNode) gainNode.gain.value = vol.value / 100; };
      getFmt = UI.wireFormat(stageEl);
      setClip(c, false);
      $("[data-change]", stageEl).onclick = function () { UI.filePrompt({ video: true }, function (f) { load(f[0]); }); };
      $("[data-go]", stageEl).onclick = save;
      stageEl.addEventListener("click", function (e) { var b = e.target.closest("[data-op]"); if (b) op(b.dataset.op); });
      setTimeout(function () { wave.cv.focus({ preventScroll: true }); }, 50);
    }
    function setClip(c, keep) { clip = c; wave.setClip(c, keep); $("[data-meta]", stageEl).textContent = AK.fmtTime(AK.dur(c)) + " · " + (c.ch.length > 1 ? "stereo" : "mono"); undoUi(); }
    function undoUi() { var u = $("[data-op=undo]", stageEl), r = $("[data-op=redo]", stageEl); if (u) u.disabled = !hist.length; if (r) r.disabled = !redo.length; }
    function region(fn) {
      var s = wave.sel, a = s ? AK.sec2s(clip, s.a) : 0, b = s ? AK.sec2s(clip, s.b) : AK.len(clip);
      if (b - a < 2) throw new Error("Select a longer part first.");
      var piece = fn(AK.slice(clip, a, b)), out = AK.copy(clip);
      out.ch.forEach(function (d, i) { d.set(piece.ch[i], a); }); return out;
    }
    function op(k) {
      if (!clip || busy) return; var st = $("[data-st]", stageEl); UI.status(st, "");
      try {
        if (k === "all") { wave.setSel(0, AK.dur(clip)); return; }
        if (k === "none") { wave.setSel(null); return; }
        if (k === "zsel") { wave.zoomSel(); return; }
        if (k === "undo" || k === "redo") {
          var from = k === "undo" ? hist : redo, to = k === "undo" ? redo : hist;
          if (!from.length) { UI.status(st, k === "undo" ? "Nothing to undo." : "Nothing to redo."); return; }
          to.push({ clip: clip, sel: wave.sel }); var h = from.pop(); wave.stop(); setClip(h.clip, true); wave.sel = h.sel; wave.draw(); wave.emit();
          UI.status(st, k === "undo" ? "Undone." : "Redone."); return;
        }
        var s = wave.sel, next, msg, newSel = s;
        if ((k === "keep" || k === "cut" || k === "mute") && !s) throw new Error("Select a part of the waveform first.");
        wave.stop();
        if (k === "keep") { next = AK.slice(clip, AK.sec2s(clip, s.a), AK.sec2s(clip, s.b)); newSel = null; wave.cursor = 0; msg = "Kept the selection."; }
        else if (k === "cut") { next = AK.remove(clip, AK.sec2s(clip, s.a), AK.sec2s(clip, s.b)); newSel = null; wave.cursor = s.a; msg = "Deleted the selection."; }
        else if (k === "mute") { next = AK.silence(clip, AK.sec2s(clip, s.a), AK.sec2s(clip, s.b)); msg = "Silenced the selection."; }
        else if (k === "fin" || k === "fout") {
          var D = AK.dur(clip), a = s ? s.a : k === "fin" ? 0 : Math.max(0, D - 3), b = s ? s.b : k === "fin" ? Math.min(3, D) : D;
          next = AK.fade(clip, AK.sec2s(clip, a), AK.sec2s(clip, b), k === "fin" ? "in" : "out"); msg = k === "fin" ? "Fade in added." : "Fade out added.";
        }
        else if (k === "norm") { next = region(function (p) { return AK.normalize(p, 0.97); }); msg = "Volume evened out to full level."; }
        else if (k === "rev") { next = region(AK.reverse); msg = s ? "Selection reversed." : "Whole track reversed."; }
        else return;
        hist.push({ clip: clip, sel: s }); if (hist.length > 20) hist.shift(); redo = [];
        setClip(next, true); wave.sel = newSel && newSel.b <= AK.dur(next) ? newSel : null; wave.draw(); wave.emit();
        UI.status(st, msg + " Length now " + AK.fmtTime(AK.dur(next)) + ".");
      } catch (e) { UI.status(st, UI.errText(e), "err"); }
    }
    async function save() {
      if (busy || !clip) return; var go = $("[data-go]", stageEl), pr = $("progress", stageEl), st = $("[data-st]", stageEl), vol = +$("[data-vol]", stageEl).value / 100;
      busy = true; go.disabled = true; wave.pause(); pr.hidden = false; pr.value = 0; UI.status(st, "Saving…");
      try {
        await UI.wait(30);
        var fmt = getFmt(), enc = await UI.encode(clip, fmt, function (p) { pr.value = p; }, vol);
        UI.status(st, "Done.", "ok");
        UI.showResult(resEl, { blob: enc.blob, name: name + "_edited." + enc.ext, summary: "Saved " + AK.fmtTime(AK.dur(clip)) + " of audio" + (vol !== 1 ? " at " + Math.round(vol * 100) + "% volume" : "") + ".",
          onAgain: function () { UI.clearResult(resEl); wave.cv.focus(); }, onReset: picker });
        $("[data-again]", resEl).textContent = "Keep editing";
      } catch (e) { console.error(e); UI.status(st, UI.errText(e), "err"); }
      finally { busy = false; go.disabled = false; pr.hidden = true; }
    }
    if (UI.handoff) { var h = UI.handoff; UI.handoff = null; open(h.clip, h.name, h.name); }
    else { picker(); takeIncoming(function (f) { load(f[0]); }); }
    return {
      onFiles: function (f) { if (!busy) load(f[0]); },
      keydown: function (e) {
        if (!wave || !clip || typing(e)) return;
        var mod = e.ctrlKey || e.metaKey, k = e.key;
        if (isSpace(e)) { e.preventDefault(); wave.toggle(); }
        else if (mod && (k === "z" || k === "Z")) { e.preventDefault(); op(e.shiftKey ? "redo" : "undo"); }
        else if (mod && (k === "y" || k === "Y")) { e.preventDefault(); op("redo"); }
        else if (mod && (k === "a" || k === "A")) { e.preventDefault(); op("all"); }
        else if ((k === "Delete" || k === "Backspace") && wave.sel) { e.preventDefault(); op("cut"); }
        else if (k === "Escape" && wave.sel) { op("none"); }
        else if (!mod && (k === "+" || k === "=")) { e.preventDefault(); wave.zoomBy(2); }
        else if (!mod && (k === "-" || k === "_")) { e.preventDefault(); wave.zoomBy(0.5); }
        else if (!mod && k === "0") { e.preventDefault(); wave.fit(); }
      },
      destroy: function () { if (wave) wave.destroy(); UI.clearResult(resEl); }
    };
  }

  /* ================= Join audio ================= */
  function joinTool(root, t) {
    var items = [], stageEl, resEl, getFmt, busy = false, uid = 0;
    root.innerHTML = UI.toolHead(t); stageEl = $("[data-stage]", root);
    function picker() {
      UI.miniStop(); items = []; UI.clearResult(resEl); resEl = null;
      stageEl.innerHTML = UI.pickerHtml({ label: "Select audio files", multiple: true });
      UI.wirePicker(stageEl, add);
    }
    async function add(files) {
      var st = $("[data-pst]", stageEl) || $("[data-st]", stageEl), bad = [];
      files = files.filter(function (f) { if (UI.isOk(f, false)) return true; bad.push(f.name); return false; });
      if (!files.length) { UI.status(st, "Those don't look like audio files. Try MP3, WAV, M4A or OGG.", "err"); return; }
      for (var i = 0; i < files.length; i++) {
        UI.status(st, "Reading " + files[i].name + " (" + (i + 1) + " of " + files.length + ")…");
        try { items.push({ id: ++uid, name: files[i].name, clip: await UI.decode(files[i]) }); } catch (e) { bad.push(files[i].name); }
      }
      if (!items.length) { UI.status(st, "None of those files could be read. Try MP3, WAV or M4A.", "err"); return; }
      if (!$("[data-list]", stageEl)) layout();
      render();
      st = $("[data-st]", stageEl);
      UI.status(st, bad.length ? "Skipped " + bad.join(", ") + " because it couldn't be read." : items.length < 2 ? "Add at least one more clip to join." : "", bad.length ? "err" : "");
    }
    function layout() {
      stageEl.innerHTML = '<div class="work"><section class="box" aria-label="Clips to join"><div class="box-h fhead"><span class="fname" data-count></span><span class="meta" data-total></span><button type="button" class="btn ghost small" data-add>' + icon("plus").replace("<svg", '<svg style="width:16px;height:16px"') + "Add files</button></div>" +
        '<div class="box-b"><div class="timeline" data-tl aria-hidden="true"></div><p class="note">Clips play from top to bottom. Use the arrows to change the order.</p><ul class="clips" data-list></ul></div></section>' +
        '<aside class="opts" aria-label="Options"><h2>Options</h2><div class="grp"><div class="f lab">Between clips' + segHtml("mode", "Between clips", [["none", "Nothing"], ["gap", "Pause"], ["xf", "Crossfade"]], "none") + "</div>" +
        '<label class="f" data-amtf hidden><span data-amtl>Length</span><select data-amt><option value="0.5">0.5 s</option><option value="1" selected>1 s</option><option value="2">2 s</option><option value="3">3 s</option><option value="5">5 s</option></select></label></div>' +
        UI.formatField(["mp3", "wav"]) + '<button type="button" class="btn wide" data-go>Join audio</button><progress max="1" value="0" hidden></progress><p class="status" data-st role="status" aria-live="polite"></p></aside></div><section class="results" data-res hidden></section>';
      resEl = $("[data-res]", stageEl); getFmt = UI.wireFormat(stageEl);
      wireSegs(stageEl, function (n, v) { $("[data-amtf]", stageEl).hidden = v === "none"; $("[data-amtl]", stageEl).textContent = v === "gap" ? "Pause length" : "Crossfade length"; render(); });
      $("[data-amt]", stageEl).onchange = render;
      $("[data-add]", stageEl).onclick = function () { UI.filePrompt({ multiple: true }, add); };
      $("[data-go]", stageEl).onclick = join;
      $("[data-list]", stageEl).addEventListener("click", function (e) {
        var b = e.target.closest("[data-act]"); if (!b) return; var li = b.closest("li"), i = items.findIndex(function (x) { return x.id === +li.dataset.id; });
        var a = b.dataset.act;
        if (a === "play") { UI.miniPlay(items[i].clip, b); return; }
        UI.miniStop();
        if (a === "up" && i > 0) items.splice(i - 1, 0, items.splice(i, 1)[0]);
        else if (a === "down" && i < items.length - 1) items.splice(i + 1, 0, items.splice(i, 1)[0]);
        else if (a === "del") items.splice(i, 1);
        if (!items.length) { picker(); return; }
        render();
        var nb = $('[data-id="' + items[Math.max(0, Math.min(items.length - 1, a === "up" ? i - 1 : a === "down" ? i + 1 : i))].id + '"] [data-act="' + (a === "del" ? "del" : a) + '"]', stageEl);
        if (nb && !nb.disabled) nb.focus();
      });
    }
    function settings() { var m = segVal(stageEl, "mode"), v = +$("[data-amt]", stageEl).value; return { gap: m === "gap" ? v : 0, xf: m === "xf" ? v : 0 }; }
    function render() {
      var list = $("[data-list]", stageEl); if (!list) return;
      var s = settings(), tot = items.reduce(function (a, it) { return a + AK.dur(it.clip); }, 0) + (items.length - 1) * (s.gap - s.xf);
      $("[data-count]", stageEl).textContent = items.length + " clip" + (items.length === 1 ? "" : "s");
      $("[data-total]", stageEl).textContent = "Total " + AK.fmtTime(Math.max(0, tot));
      $("[data-tl]", stageEl).innerHTML = items.map(function (it) { return '<i style="flex:' + AK.dur(it.clip).toFixed(3) + '"></i>'; }).join("");
      list.innerHTML = items.map(function (it, i) {
        return '<li data-id="' + it.id + '"><span class="n">' + (i + 1) + '</span><button type="button" class="icon-btn play-mini" data-act="play" aria-label="Play this clip">' + icon("play") + "</button>" +
          '<span class="nm"><b>' + esc(it.name) + "</b><span>" + AK.fmtTime(AK.dur(it.clip)) + " · " + (it.clip.ch.length > 1 ? "stereo" : "mono") + "</span></span>" +
          '<span class="acts"><button type="button" class="icon-btn" data-act="up" aria-label="Move ' + esc(it.name) + ' up"' + (i === 0 ? " disabled" : "") + ">" + icon("up") + '</button><button type="button" class="icon-btn" data-act="down" aria-label="Move ' + esc(it.name) + ' down"' + (i === items.length - 1 ? " disabled" : "") + ">" + icon("down") + '</button><button type="button" class="icon-btn" data-act="del" aria-label="Remove ' + esc(it.name) + '">' + icon("x") + "</button></span></li>";
      }).join("");
    }
    async function join() {
      if (busy) return; var st = $("[data-st]", stageEl), go = $("[data-go]", stageEl), pr = $("progress", stageEl);
      if (items.length < 2) { UI.status(st, "Add at least two clips to join.", "err"); return; }
      busy = true; go.disabled = true; UI.miniStop(); UI.clearResult(resEl); pr.hidden = false; pr.value = 0; UI.status(st, "Joining…");
      try {
        await UI.wait(30);
        var s = settings(), out = AK.concat(items.map(function (i) { return i.clip; }), s.gap, s.xf);
        var enc = await UI.encode(out, getFmt(), function (p) { pr.value = p; });
        UI.status(st, "Done.", "ok");
        UI.showResult(resEl, { blob: enc.blob, name: "joined." + enc.ext, summary: "Joined " + items.length + " clips into " + AK.fmtTime(AK.dur(out)) + (s.gap ? " with " + s.gap + " s pauses" : s.xf ? " with " + s.xf + " s crossfades" : "") + ".",
          onAgain: function () { UI.clearResult(resEl); go.focus(); }, onReset: picker,
          onEdit: function () { UI.handoff = { clip: out, name: "joined" }; location.hash = "#/t/editor"; } });
      } catch (e) { console.error(e); UI.status(st, UI.errText(e), "err"); }
      finally { busy = false; go.disabled = false; pr.hidden = true; }
    }
    picker(); takeIncoming(add);
    return { onFiles: function (f) { if (!busy) add(f); }, destroy: function () { UI.miniStop(); UI.clearResult(resEl); } };
  }

  /* ================= Voice recorder ================= */
  function recorderTool(root, t) {
    var stageEl, stream = null, rec = null, chunks = [], an = null, srcNode = null, raf = 0, t0 = 0, acc = 0, paused = false, levels = [], recBlob = null, rmime = "";
    var inner = null; /* a singleTool-like review stage */
    root.innerHTML = UI.toolHead(t); stageEl = $("[data-stage]", root);
    var supported = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
    function start() {
      cleanup();
      stageEl.innerHTML = '<div class="picker" data-picker><button type="button" class="btn big" data-rec>' + icon("mic") + "Start recording</button>" +
        "<small>Your browser will ask to use the microphone.</small>" +
        '<label class="check" style="margin:6px 0 0"><input type="checkbox" data-clean checked> Clean up my voice (echo and noise control from your browser)</label>' +
        '<p class="lock">' + icon("lock") + "Recordings stay on this device. Nothing is uploaded.</p>" +
        '<p class="status" data-pst role="status" aria-live="polite"></p></div>';
      var pst = $("[data-pst]", stageEl);
      if (!supported) { UI.status(pst, "This browser can't record audio. Please use a recent Chrome, Edge, Firefox or Safari.", "err"); $("[data-rec]", stageEl).disabled = true; return; }
      $("[data-rec]", stageEl).onclick = begin;
    }
    async function begin() {
      var pst = $("[data-pst]", stageEl), clean = $("[data-clean]", stageEl).checked;
      UI.status(pst, "Waiting for microphone permission…");
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: clean, noiseSuppression: clean, autoGainControl: clean } }); }
      catch (e) {
        UI.status(pst, e && (e.name === "NotAllowedError" || e.name === "SecurityError") ? "Microphone access was blocked. Allow it from the icon in your address bar, then try again." :
          e && e.name === "NotFoundError" ? "No microphone was found. Plug one in and try again." : e && e.name === "NotReadableError" ? "Your microphone is busy in another app. Close that app and try again." : "Couldn't start the microphone.", "err");
        return;
      }
      rmime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find(function (m) { return MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m); }) || "";
      try { rec = new MediaRecorder(stream, rmime ? { mimeType: rmime } : {}); } catch (e) { UI.status(pst, "This browser can't record from the microphone.", "err"); cleanup(); return; }
      chunks = []; rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      var a = UI.ac(); if (a.resume) await a.resume();
      srcNode = a.createMediaStreamSource(stream); an = a.createAnalyser(); an.fftSize = 2048; srcNode.connect(an);
      stageEl.innerHTML = '<section class="box"><div class="rec rec-on" data-recbox><div class="rec-state"><span class="rec-dot"></span><span data-rs>Recording</span></div>' +
        '<div class="rec-time" data-rt aria-live="off">0:00.0</div><canvas data-lv aria-hidden="true"></canvas>' +
        '<div class="meter" role="meter" aria-label="Microphone level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i data-mt></i></div>' +
        '<div class="rec-btns"><button type="button" class="btn ghost" data-pause>' + icon("pause").replace("<svg", '<svg style="width:18px;height:18px"') + 'Pause</button><button type="button" class="btn" data-stop>' + icon("stop").replace("<svg", '<svg style="width:18px;height:18px"') + "Stop</button></div>" +
        '<p class="status" data-st role="status" aria-live="polite"></p></div></section>';
      $("[data-pause]", stageEl).onclick = togglePause; $("[data-stop]", stageEl).onclick = finish;
      levels = []; acc = 0; paused = false; t0 = performance.now(); rec.start(500);
      window.addEventListener("beforeunload", warn);
      loop();
    }
    function warn(e) { if (rec && rec.state !== "inactive") { e.preventDefault(); e.returnValue = ""; } }
    function elapsed() { return (acc + (paused ? 0 : performance.now() - t0)) / 1000; }
    function togglePause() {
      var b = $("[data-pause]", stageEl), box = $("[data-recbox]", stageEl);
      if (!paused) { rec.pause(); acc += performance.now() - t0; paused = true; b.innerHTML = icon("mic").replace("<svg", '<svg style="width:18px;height:18px"') + "Resume"; $("[data-rs]", stageEl).textContent = "Paused"; box.classList.remove("rec-on"); }
      else { rec.resume(); t0 = performance.now(); paused = false; b.innerHTML = icon("pause").replace("<svg", '<svg style="width:18px;height:18px"') + "Pause"; $("[data-rs]", stageEl).textContent = "Recording"; box.classList.add("rec-on"); }
    }
    function loop() {
      var cv = $("[data-lv]", stageEl); if (!cv || !an) return;
      var buf = new Float32Array(an.fftSize); an.getFloatTimeDomainData(buf);
      var pk = 0; for (var i = 0; i < buf.length; i++) { var v = Math.abs(buf[i]); if (v > pk) pk = v; }
      var dpr = window.devicePixelRatio || 1, W = Math.round(cv.clientWidth * dpr), H = Math.round(cv.clientHeight * dpr);
      if (cv.width !== W) cv.width = W; if (cv.height !== H) cv.height = H;
      var bw = 4 * dpr, n = Math.floor(W / bw);
      if (!paused) { levels.push(pk); if (levels.length > n) levels.splice(0, levels.length - n); }
      var g = cv.getContext("2d"), cs = getComputedStyle(cv); g.clearRect(0, 0, W, H); g.fillStyle = cs.getPropertyValue("--accent").trim();
      for (var j = 0; j < levels.length; j++) { var h = Math.max(2 * dpr, Math.min(1, Math.sqrt(levels[j])) * H * 0.9); g.fillRect(W - (levels.length - j) * bw, (H - h) / 2, bw - dpr, h); }
      $("[data-rt]", stageEl).textContent = AK.fmtTime(elapsed());
      var pct = Math.round(Math.min(1, Math.sqrt(pk)) * 100), mt = $("[data-mt]", stageEl); mt.style.width = pct + "%"; mt.parentNode.setAttribute("aria-valuenow", pct);
      if (pk > 0.99) UI.status($("[data-st]", stageEl), "Too loud: move a little away from the microphone.", "err");
      raf = requestAnimationFrame(loop);
    }
    async function finish() {
      var stopped = new Promise(function (r) { rec.onstop = r; });
      rec.stop(); await stopped; window.removeEventListener("beforeunload", warn);
      var type = (rec.mimeType || rmime || "audio/webm").split(";")[0];
      recBlob = new Blob(chunks, { type: type });
      cleanup(true);
      var ext = /mp4/.test(type) ? "m4a" : /ogg/.test(type) ? "ogg" : "webm";
      var st = $("[data-st]", stageEl); UI.status(st, "Getting your recording ready…");
      var clip;
      try { clip = await UI.decode(recBlob, "the recording"); } catch (e) { UI.status(st, "The recording couldn't be opened for editing. You can still download it as is.", "err"); clip = null; }
      review(clip, ext);
    }
    function review(clip, ext) {
      var name = "recording-" + new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-");
      var origUrl = URL.createObjectURL(recBlob);
      inner = { url: origUrl };
      if (!clip) {
        stageEl.innerHTML = '<section class="results"><h2>Recording saved</h2><audio controls src="' + origUrl + '"></audio><div class="results-foot"><a class="btn" href="' + origUrl + '" download="' + name + "." + ext + '">Download (' + AK.fmtSize(recBlob.size) + ')</a><button type="button" class="btn ghost" data-again>Record again</button></div></section>';
        $("[data-again]", stageEl).onclick = start; return;
      }
      stageEl.innerHTML = '<div class="work"><section class="box" aria-label="Your recording"><div class="box-h fhead"><span class="fname">Your recording</span><span class="meta">' + AK.fmtTime(AK.dur(clip)) + '</span><button type="button" class="btn ghost small" data-again>Record again</button></div><div class="box-b"><div data-wave></div></div></section>' +
        '<aside class="opts" aria-label="Save options"><h2>Save</h2><p class="note">Listen back first. To trim mistakes, open it in the audio editor.</p>' +
        '<div class="btnrow"><button type="button" class="btn ghost small" data-edit>' + icon("edit").replace("<svg", '<svg style="width:16px;height:16px"') + 'Open in audio editor</button><a class="btn ghost small" href="' + origUrl + '" download="' + name + "." + ext + '">Original .' + ext + " (" + AK.fmtSize(recBlob.size) + ")</a></div>" +
        UI.formatField(["mp3", "wav"]) + '<button type="button" class="btn wide" data-go>Save recording</button><progress max="1" value="0" hidden></progress><p class="status" data-st role="status" aria-live="polite"></p></aside></div><section class="results" data-res hidden></section>';
      var wave = new UI.Wave($("[data-wave]", stageEl), { select: false, zoom: true }); wave.setClip(clip); inner.wave = wave;
      var getFmt = UI.wireFormat(stageEl), resEl = $("[data-res]", stageEl); inner.res = resEl;
      $("[data-again]", stageEl).onclick = start;
      $("[data-edit]", stageEl).onclick = function () { UI.handoff = { clip: clip, name: name }; location.hash = "#/t/editor"; };
      $("[data-go]", stageEl).onclick = async function () {
        var go = this, pr = $("progress", stageEl), st = $("[data-st]", stageEl);
        go.disabled = true; wave.pause(); pr.hidden = false; UI.status(st, "Saving…");
        try {
          var enc = await UI.encode(clip, getFmt(), function (p) { pr.value = p; });
          UI.status(st, "Done.", "ok");
          UI.showResult(resEl, { blob: enc.blob, name: name + "." + enc.ext, summary: AK.fmtTime(AK.dur(clip)) + " recording.", onReset: start, onEdit: function () { UI.handoff = { clip: clip, name: name }; location.hash = "#/t/editor"; } });
        } catch (e) { UI.status(st, UI.errText(e), "err"); }
        finally { go.disabled = false; pr.hidden = true; }
      };
      inner.keydown = function (e) { if (isSpace(e) && calm(e)) { e.preventDefault(); wave.toggle(); } };
    }
    function cleanup(keepStage) {
      cancelAnimationFrame(raf); raf = 0;
      if (rec && rec.state !== "inactive") { try { rec.stop(); } catch (e) { /* stopped */ } }
      if (stream) stream.getTracks().forEach(function (tr) { tr.stop(); }); stream = null;
      if (srcNode) { try { srcNode.disconnect(); } catch (e) { /* gone */ } } srcNode = null; an = null;
      window.removeEventListener("beforeunload", warn);
      if (!keepStage && inner) { if (inner.wave) inner.wave.destroy(); if (inner.url) URL.revokeObjectURL(inner.url); UI.clearResult(inner.res); inner = null; }
    }
    start();
    return { keydown: function (e) { if (inner && inner.keydown) inner.keydown(e); }, destroy: function () { cleanup(false); rec = null; } };
  }

  /* ================= Catalogue ================= */
  var TOOLS = [
    { id: "editor", name: "Audio editor", cat: "edit", ic: "wave", desc: "Trim, delete parts, fade and tidy up on a zoomable waveform.", lede: "Select parts of the waveform to keep, delete, silence or fade. Undo anything, zoom in for precise cuts.", mount: editorTool },
    { id: "cut", name: "Cut audio", cat: "edit", ic: "scissors", desc: "Keep or remove one part of a song or recording.", lede: "Pick a start and end, then keep that part or cut it out.", mount: cutTool },
    { id: "join", name: "Join audio", cat: "edit", ic: "join", desc: "Put clips one after another, with a pause or a crossfade.", lede: "Add your clips, put them in order, and choose how they meet.", mount: joinTool },
    { id: "convert", name: "Convert audio", cat: "convert", ic: "convert", desc: "Change to MP3, WAV or WebM, or take the sound out of a video.", lede: "Turn any audio or video file into MP3, WAV and more.", mount: convertTool },
    { id: "speed", name: "Change speed & pitch", cat: "effects", ic: "speed", isNew: true, desc: "Slow down or speed up, with or without changing the pitch.", lede: "Speed up a lecture, slow down a song to learn it, or shift the key.", mount: speedTool },
    { id: "volume", name: "Volume booster", cat: "effects", ic: "volume", desc: "Make quiet audio louder without harsh crackle.", lede: "Raise the volume with a soft limiter that keeps peaks clean.", mount: volumeTool },
    { id: "eq", name: "Equaliser", cat: "effects", ic: "eq", desc: "Adjust bass, mids and treble, or use a ready preset.", lede: "Shape the sound with three simple sliders and hear it live.", mount: eqTool },
    { id: "noise", name: "Reduce noise", cat: "effects", ic: "noise", isNew: true, desc: "Quieten steady hum and hiss in the gaps between words.", lede: "A simple clean-up for voice recordings with fan, AC or hiss in the background.", mount: noiseTool },
    { id: "reverse", name: "Reverse audio", cat: "effects", ic: "reverse", desc: "Play any sound backwards.", lede: "Flip your audio so it plays from the end to the start.", mount: reverseTool },
    { id: "ringtone", name: "Ringtone maker", cat: "edit", ic: "bell", desc: "Pick the best 30 seconds and add soft fades for your phone.", lede: "Choose your favourite part of a song and save it as a ringtone.", mount: ringTool },
    { id: "recorder", name: "Voice recorder", cat: "record", ic: "mic", isNew: true, desc: "Record from your microphone, then trim or download.", lede: "Record your voice in one click. Pause when you need to.", mount: recorderTool }
  ];
  var CHIPS = [["all", "All"], ["edit", "Edit"], ["convert", "Convert"], ["effects", "Effects"], ["record", "Record"]];
  var chip = UI.store.get("chip", "all");

  function home() {
    main.innerHTML = '<section class="p-hero"><span class="eyebrow">' + icon("lock") + 'Private · runs in your browser</span><h1 tabindex="-1">Audio tools that just work</h1>' +
      "<p>Cut, join, convert, clean up and record sound in a few clicks. Free, no sign-up, and your files never leave your device.</p></section>" +
      '<div class="chips" role="group" aria-label="Filter tools">' + CHIPS.map(function (c) { return '<button type="button" data-chip="' + c[0] + '" aria-pressed="' + (c[0] === chip) + '">' + c[1] + "</button>"; }).join("") + "</div>" +
      '<ul class="tgrid" data-grid></ul>' +
      '<ul class="trust"><li>' + icon("shield") + "Files stay on your device</li><li>" + icon("bolt") + "Fast, no waiting in a queue</li><li>" + icon("heart") + "Free, no account needed</li></ul>";
    var grid = $("[data-grid]", main);
    var paint = function () {
      var list = TOOLS.filter(function (t) { return chip === "all" || t.cat === chip; });
      grid.innerHTML = list.map(function (t) {
        return '<li class="tcard"><span class="ti">' + icon(t.ic) + '</span><h3><a href="#/t/' + t.id + '">' + esc(t.name) + "</a>" + (t.isNew ? ' <span class="badge new">New</span>' : "") + "</h3><p>" + esc(t.desc) + "</p></li>";
      }).join("");
    };
    $(".chips", main).onclick = function (e) {
      var b = e.target.closest("[data-chip]"); if (!b) return; chip = b.dataset.chip; UI.store.set("chip", chip);
      $$("[data-chip]", main).forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); }); paint();
    };
    paint();
    return { onFiles: function (f) { UI.pending = f; location.hash = f.length > 1 ? "#/t/join" : "#/t/editor"; } };
  }

  /* ================= Router ================= */
  var current = null, first = true;
  function route() {
    if (current && current.destroy) { try { current.destroy(); } catch (e) { console.error(e); } }
    current = null; UI.miniStop();
    var m = location.hash.match(/^#\/t\/([\w-]+)/), t = m && TOOLS.find(function (x) { return x.id === m[1]; });
    $$("[data-nav]").forEach(function (a) { if ((t ? t.id : "home") === a.dataset.nav) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    if (t) { document.title = t.name + " – Daftarbox"; current = t.mount(main, t) || {}; }
    else { if (location.hash && location.hash !== "#/") history.replaceState(null, "", "#/"); document.title = "Audio editing – Daftarbox"; current = home(); }
    if (!first) { window.scrollTo(0, 0); var h = $("h1", main); if (h) h.focus({ preventScroll: true }); }
    first = false;
  }
  window.addEventListener("hashchange", route);

  /* Keyboard shortcuts go to the current tool */
  document.addEventListener("keydown", function (e) { if (!e.defaultPrevented && current && current.keydown) current.keydown(e); });

  /* Drop a file anywhere on the page */
  var depth = 0;
  var hasFiles = function (e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") >= 0; };
  document.addEventListener("dragenter", function (e) { if (!hasFiles(e) || !current || !current.onFiles) return; e.preventDefault(); depth++; document.body.classList.add("dragging"); });
  document.addEventListener("dragover", function (e) { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = current && current.onFiles ? "copy" : "none"; });
  document.addEventListener("dragleave", function () { if (--depth <= 0) { depth = 0; document.body.classList.remove("dragging"); } });
  document.addEventListener("drop", function (e) {
    if (!hasFiles(e)) return; e.preventDefault(); depth = 0; document.body.classList.remove("dragging");
    var f = Array.prototype.slice.call(e.dataTransfer.files || []);
    if (f.length && current && current.onFiles) current.onFiles(f);
  });

  route();
})();
