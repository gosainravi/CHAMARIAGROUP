/* Daftarbox PDF tools – visual editors: Organise pages, Crop, Edit and Sign. */
"use strict";

/* Shared side panel tail: primary button, progress and status */
const goBlock = label => `<button type="button" class="btn wide go" data-go disabled>${esc(label)}</button>
  <progress max="1" value="0" hidden></progress><p class="status" data-st role="status" aria-live="polite"></p>`;

/* ================= Organise pages ================= */
function mountOrganize(P) {
  let file = null, pages = [], dragFrom = null, token = 0, focusSel = null;
  P.work.innerHTML = `<div class="work">
    <section class="box" aria-labelledby="og-h"><div class="box-h"><h2 id="og-h" class="fname" data-name></h2><span class="sp"></span>
      <button type="button" class="btn ghost small" data-rall>${ICON.rot}Rotate all</button>
      <button type="button" class="btn ghost small" data-rev>Reverse</button>
      <button type="button" class="btn ghost small" data-more>Choose a different file</button></div>
      <div class="thumbs" data-th role="list" aria-label="Pages"></div></section>
    <aside class="opts" aria-label="Options"><h2>Arrange your pages</h2>
      <p class="note">Drag a page to move it, or use the arrows under it. You can also turn or delete each page.</p>
      <p class="fl-meta" data-count></p>
      <button type="button" class="btn ghost wide" data-undo style="margin:0 0 10px">Undo all changes</button>
      ${goBlock("Save PDF")}</aside></div>`;
  const th = $("[data-th]", P.work), go = $("[data-go]", P.work), st = $("[data-st]", P.work), prog = $("progress", P.work);
  P.onWarn = m => setStatus(st, m, "err");
  P.onFiles = l => load(l[0]);
  P.onReset = () => { token++; file = null; pages = []; th.innerHTML = ""; };
  $("[data-more]", P.work).onclick = () => P.open();
  $("[data-rall]", P.work).onclick = () => { pages.forEach(p => p.rot = (p.rot + 90) % 360); draw(); };
  $("[data-rev]", P.work).onclick = () => { pages.reverse(); draw(); };
  let original = [];
  $("[data-undo]", P.work).onclick = () => { pages = original.map(p => ({...p, rot: 0})); draw(); setStatus(st, "Back to the original order."); };

  async function load(f) {
    const my = ++token; file = f; pages = []; P.res.hidden = true; P.showWork();
    $("[data-name]", P.work).textContent = f.name; th.innerHTML = ""; go.disabled = true;
    setStatus(st, "Opening " + f.name + "…"); prog.hidden = false; prog.value = 0;
    try {
      const pdf = await pdfjsOpen(f);
      try {
        for (let i = 1; i <= pdf.numPages; i++) {
          if (my !== token) return;
          const page = await pdf.getPage(i); const vp = page.getViewport({scale: 1});
          const c = await renderPage(page, Math.min(1, 240 / Math.max(vp.width, vp.height)));
          pages.push({src: i - 1, rot: 0, canvas: c}); page.cleanup();
          prog.value = i / pdf.numPages;
          if (i === 1 || i % 8 === 0 || i === pdf.numPages) { draw(); setStatus(st, "Loading pages… " + i + " of " + pdf.numPages); }
        }
      } finally { pdf.destroy(); }
      if (my !== token) return;
      original = pages.slice(); setStatus(st, ""); go.disabled = false; draw();
    } catch (e) { if (my === token) setStatus(st, e.message, "err"); }
    finally { if (my === token) prog.hidden = true; }
  }
  function draw() {
    th.innerHTML = "";
    $("[data-count]", P.work).textContent = plural(pages.length, "page") + (original.length && pages.length !== original.length ? " (was " + original.length + ")" : "");
    pages.forEach((p, i) => {
      const el = document.createElement("figure"); el.className = "thumb"; el.draggable = true; el.setAttribute("role", "listitem");
      el.innerHTML = `<div class="thumb-img"></div><figcaption class="thumb-n">Page ${i + 1}${p.src !== i ? ` <span class="fl-meta">(was ${p.src + 1})</span>` : ""}</figcaption><div class="thumb-bar">
        <button type="button" class="icon-btn" data-a="l" data-i="${i}" aria-label="Move page ${i + 1} earlier" ${i === 0 ? "disabled" : ""}>${ICON.left}</button>
        <button type="button" class="icon-btn" data-a="r" data-i="${i}" aria-label="Move page ${i + 1} later" ${i === pages.length - 1 ? "disabled" : ""}>${ICON.right}</button>
        <button type="button" class="icon-btn" data-a="rot" data-i="${i}" aria-label="Turn page ${i + 1} clockwise">${ICON.rot}</button>
        <button type="button" class="icon-btn" data-a="del" data-i="${i}" aria-label="Delete page ${i + 1}">${ICON.x}</button></div>`;
      p.canvas.style.transform = "rotate(" + p.rot + "deg)" + (p.rot % 180 ? " scale(" + Math.min(1, p.canvas.height / p.canvas.width, p.canvas.width / p.canvas.height) + ")" : "");
      $(".thumb-img", el).appendChild(p.canvas);
      el.addEventListener("dragstart", e => { dragFrom = i; el.classList.add("dragging"); try { e.dataTransfer.setData("text/plain", String(i)); e.dataTransfer.effectAllowed = "move"; } catch (err) { /* old browsers */ } });
      el.addEventListener("dragend", () => el.classList.remove("dragging"));
      el.addEventListener("dragover", e => { if (dragFrom === null) return; e.preventDefault(); el.classList.add("over"); });
      el.addEventListener("dragleave", () => el.classList.remove("over"));
      el.addEventListener("drop", e => { el.classList.remove("over"); if (dragFrom === null) return; e.preventDefault(); e.stopPropagation(); if (dragFrom !== i) { const [m] = pages.splice(dragFrom, 1); pages.splice(i, 0, m); } dragFrom = null; draw(); });
      th.appendChild(el);
    });
    if (focusSel) { const b = $(focusSel, th); (b && !b.disabled ? b : $(`[data-i]`, th))?.focus(); focusSel = null; }
  }
  th.addEventListener("click", e => {
    const a = e.target.closest("[data-a]"); if (!a) return; const i = +a.dataset.i, k = a.dataset.a;
    if (k === "l") { [pages[i - 1], pages[i]] = [pages[i], pages[i - 1]]; focusSel = `[data-a="l"][data-i="${i - 1}"]`; }
    if (k === "r") { [pages[i + 1], pages[i]] = [pages[i], pages[i + 1]]; focusSel = `[data-a="r"][data-i="${i + 1}"]`; }
    if (k === "rot") { pages[i].rot = (pages[i].rot + 90) % 360; focusSel = `[data-a="rot"][data-i="${i}"]`; }
    if (k === "del") { if (pages.length === 1) { setStatus(st, "A PDF needs at least one page, so the last page can't be deleted.", "err"); return; } pages.splice(i, 1); focusSel = `[data-a="del"][data-i="${Math.min(i, pages.length - 1)}"]`; }
    draw();
  });
  go.addEventListener("click", async () => {
    go.disabled = true; setStatus(st, "Saving…");
    try {
      await need("pdflib"); const src = await loadPL(file); const d = await PDFLib.PDFDocument.create();
      const copied = await d.copyPages(src, pages.map(p => p.src));
      copied.forEach((pg, i) => { if (pages[i].rot) pg.setRotation(PDFLib.degrees((pg.getRotation().angle + pages[i].rot) % 360)); d.addPage(pg); });
      setStatus(st, "Done.", "ok");
      P.done({files: [{name: baseName(file.name) + "_organised.pdf", blob: pdfBlob(await d.save())}], summary: "Saved " + plural(pages.length, "page") + " in your new order."});
    } catch (e) { console.error(e); setStatus(st, e.message || "The PDF couldn't be saved. Try again.", "err"); }
    go.disabled = false;
  });
}

/* ================= Page viewer: one big page, prev/next, thumbnail strip ================= */
function pageViewer(host, pdf, tools = "") {
  host.innerHTML = `<div class="box-h pv-bar"><button type="button" class="icon-btn" data-prev aria-label="Previous page">${ICON.left}</button>
      <span class="pn" data-pn aria-live="polite"></span><button type="button" class="icon-btn" data-next aria-label="Next page">${ICON.right}</button><span class="sp"></span>${tools}</div>
    <div class="pv-stage" data-stage><div class="pv-wrap" data-wrap><canvas data-pc></canvas><div class="pv-layer" data-layer></div></div></div>
    ${pdf.numPages > 1 ? '<div class="pv-strip" data-strip role="group" aria-label="Jump to page"></div>' : ""}`;
  const stage = $("[data-stage]", host), canvas = $("[data-pc]", host), strip = $("[data-strip]", host);
  const V = {pdf, cur: 1, n: pdf.numPages, W: 1, H: 1, cssW: 1, wrap: $("[data-wrap]", host), layer: $("[data-layer]", host), onShow: null, alive: true, zoom: 1};
  let tok = 0;
  V.show = async n => {
    V.cur = clamp(n, 1, V.n); const my = ++tok;
    const page = await pdf.getPage(V.cur); const vp = page.getViewport({scale: 1});
    const availW = Math.max(200, stage.clientWidth - 32), availH = Math.max(360, window.innerHeight * .78);
    const s = Math.min(availW / vp.width, availH / vp.height, 2.5) * (V.zoom || 1); const dpr = Math.min(2, window.devicePixelRatio || 1);
    const c = await renderPage(page, s * dpr); page.cleanup();
    if (my !== tok || !V.alive) { c.width = c.height = 0; return; }
    canvas.width = c.width; canvas.height = c.height; canvas.getContext("2d").drawImage(c, 0, 0); c.width = c.height = 0;
    V.W = vp.width; V.H = vp.height; V.cssW = vp.width * s;
    canvas.style.width = V.cssW + "px"; canvas.style.height = vp.height * s + "px";
    $("[data-pn]", host).textContent = "Page " + V.cur + " of " + V.n;
    $("[data-prev]", host).disabled = V.cur === 1; $("[data-next]", host).disabled = V.cur === V.n;
    if (strip) $$("button", strip).forEach(b => { const on = +b.dataset.p === V.cur; b.setAttribute("aria-current", String(on)); if (on) b.scrollIntoView({block: "nearest", inline: "nearest"}); });
    V.onShow && V.onShow();
  };
  V.setZoom = z => { V.zoom = clamp(z, .5, 4); return V.show(V.cur); };
  $("[data-prev]", host).onclick = () => V.show(V.cur - 1);
  $("[data-next]", host).onclick = () => V.show(V.cur + 1);
  if (strip) {
    const max = Math.min(V.n, 500);
    strip.innerHTML = Array.from({length: max}, (_, i) => `<button type="button" data-p="${i + 1}" aria-label="Page ${i + 1}"><span class="ph"></span>${i + 1}</button>`).join("");
    strip.addEventListener("click", e => { const b = e.target.closest("button"); if (b) V.show(+b.dataset.p); });
    (async () => {
      for (let i = 1; i <= max && V.alive; i++) {
        try {
          const page = await pdf.getPage(i); const vp = page.getViewport({scale: 1});
          const c = await renderPage(page, 128 / vp.height); page.cleanup();
          const ph = $(`[data-p="${i}"] .ph`, strip); if (ph) ph.replaceWith(c); else c.width = c.height = 0;
        } catch (e) { if (!V.alive) return; }
      }
    })();
  }
  let rt = 0;
  const onResize = () => { clearTimeout(rt); rt = setTimeout(() => { if (!document.contains(host)) { window.removeEventListener("resize", onResize); return; } if (V.alive) V.show(V.cur); }, 200); };
  window.addEventListener("resize", onResize);
  V.destroy = () => { V.alive = false; window.removeEventListener("resize", onResize); try { pdf.destroy(); } catch (e) { /* already closed */ } };
  return V;
}

/* ================= Movable items on top of a page (used by Edit and Sign) ================= */
function itemLayer(V, items, hooks) {
  let sel = null;
  const L = {
    get sel() { return sel; },
    select(it) { sel = it; L.draw(); hooks.onSelect && hooks.onSelect(it); },
    remove(it) { const i = items.indexOf(it); if (i >= 0) items.splice(i, 1); if (sel === it) sel = null; L.draw(); hooks.onSelect && hooks.onSelect(sel); hooks.onChange && hooks.onChange(); },
    draw() {
      $$(".ov", V.layer).forEach(e => e.remove());
      for (const it of items.filter(i => i.page === V.cur)) {
        const el = document.createElement("div"); el.className = "ov" + (it === sel ? " sel" : ""); el.tabIndex = 0;
        el.setAttribute("role", "button"); el.setAttribute("aria-label", hooks.label(it) + ". Drag or use the arrow keys to move it. Press Delete to remove it.");
        place(el, it); hooks.render(it, el);
        el.insertAdjacentHTML("beforeend", `<button type="button" class="ov-x" aria-label="Remove ${esc(hooks.label(it))}" tabindex="-1">${ICON.x}</button>${it.type !== "text" ? '<span class="ov-h" aria-hidden="true"></span>' : ""}`);
        wire(el, it); V.layer.appendChild(el);
        if (it === sel && it._focus) { it._focus = false; el.focus({preventScroll: true}); }
      }
    }
  };
  function place(el, it) {
    el.style.left = it.fx * 100 + "%"; el.style.top = it.fy * 100 + "%";
    if (it.type !== "text") { el.style.width = it.fw * 100 + "%"; el.style.height = it.fh * 100 + "%"; }
  }
  const markSel = (el, it) => { sel = it; $$(".ov", V.layer).forEach(e => e.classList.toggle("sel", e === el)); hooks.onSelect && hooks.onSelect(it); };
  function wire(el, it) {
    let drag = null;
    el.addEventListener("pointerdown", e => {
      if (e.target.closest(".ov-x")) return;
      e.preventDefault(); el.focus({preventScroll: true}); markSel(el, it);
      const r = V.layer.getBoundingClientRect();
      drag = {px: e.clientX, py: e.clientY, w: r.width, h: r.height, fx: it.fx, fy: it.fy, fw: it.fw, fh: it.fh, resize: !!e.target.closest(".ov-h")};
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener("pointermove", e => {
      if (!drag) return;
      const dx = (e.clientX - drag.px) / drag.w, dy = (e.clientY - drag.py) / drag.h;
      if (drag.resize) {
        it.fw = clamp(drag.fw + dx, .02, 1 - it.fx);
        it.fh = it.keep ? it.fw * it.ar * V.W / V.H : clamp(drag.fh + dy, .008, 1 - it.fy);
        if (it.fy + it.fh > 1) { it.fh = 1 - it.fy; if (it.keep) it.fw = it.fh * V.H / V.W / it.ar; }
      } else {
        const ew = it.type === "text" ? el.offsetWidth / drag.w : it.fw, eh = it.type === "text" ? el.offsetHeight / drag.h : it.fh;
        it.fx = clamp(drag.fx + dx, 0, Math.max(0, 1 - ew)); it.fy = clamp(drag.fy + dy, 0, Math.max(0, 1 - eh));
      }
      place(el, it);
    });
    const end = () => { if (drag) { drag = null; hooks.onChange && hooks.onChange(); } };
    el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
    el.addEventListener("keydown", e => {
      const step = e.shiftKey ? .02 : .004; let used = true;
      if (e.key === "ArrowLeft") it.fx = clamp(it.fx - step, 0, 1); else if (e.key === "ArrowRight") it.fx = clamp(it.fx + step, 0, 1 - (it.fw || .01));
      else if (e.key === "ArrowUp") it.fy = clamp(it.fy - step, 0, 1); else if (e.key === "ArrowDown") it.fy = clamp(it.fy + step, 0, 1 - (it.fh || .01));
      else if (e.key === "Delete" || e.key === "Backspace") { L.remove(it); return e.preventDefault(); }
      else if (e.key === "Enter" || e.key === " ") markSel(el, it);
      else used = false;
      if (used) { e.preventDefault(); place(el, it); }
    });
    el.addEventListener("focus", () => { if (sel !== it) markSel(el, it); });
    $(".ov-x", el).addEventListener("click", e => { e.stopPropagation(); L.remove(it); });
  }
  V.layer.addEventListener("click", e => {
    if (e.target !== V.layer || !hooks.onPlace) return;
    const r = V.layer.getBoundingClientRect();
    hooks.onPlace((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  });
  return L;
}
/* Draw an image or rectangle item onto a pdf-lib page, upright as the reader sees it. */
function itemBox(F, it) {
  const w = it.fw * F.W, h = it.fh * F.H; const [x, y] = F.pt(it.fx * F.W, (it.fy + it.fh) * F.H);
  return {x, y, width: w, height: h, rotate: PDFLib.degrees(F.r)};
}

/* ================= Sign PDF ================= */
function mountSign(P) {
  let file = null, V = null, L = null, sig = null, items = [], mode = "draw", drawn = false;
  P.work.innerHTML = `<div class="work">
    <section class="box" data-view aria-label="Page preview"></section>
    <aside class="opts" aria-label="Your signature"><h2>Your signature</h2>
      <div class="seg" role="group" aria-label="How to make your signature" data-tabs><button type="button" aria-pressed="true" data-tab="draw">Draw</button><button type="button" aria-pressed="false" data-tab="type">Type</button><button type="button" aria-pressed="false" data-tab="upload">Upload</button></div>
      <div data-pane="draw" style="margin-top:12px"><canvas class="sigpad" data-pad aria-label="Signature drawing area. Draw with your mouse, finger or pen."></canvas>
        <div class="inl" style="margin:8px 0 14px"><label class="inl" style="font-size:.9rem">Ink <select data-ink class="btn ghost small" aria-label="Ink colour"><option value="#111111">Black</option><option value="#1D3B8F">Blue</option></select></label><span class="sp" style="flex:1"></span><button type="button" class="btn ghost small" data-clear>Clear</button></div></div>
      <div data-pane="type" hidden style="margin-top:12px"><label class="f">Your name<input type="text" data-name maxlength="40" placeholder="e.g. Ravi Kumar" autocomplete="name"></label>
        <label class="f">Style<select data-font><option value="Caveat">Handwritten</option><option value="Dancing Script">Script</option></select></label></div>
      <div data-pane="upload" hidden style="margin-top:12px"><label class="f">Signature picture<input type="file" data-up accept=".png,.jpg,.jpeg,.webp"><span class="h">A photo of your signature on white paper, or a PNG with a see-through background.</span></label></div>
      <div class="sig-prev" data-prev aria-live="polite"><span>Your signature will show here</span></div>
      <label class="f">Signature width<input type="range" data-size min="8" max="60" value="25" aria-describedby="sz-h"><span class="h" id="sz-h">For new signatures. Drag the corner of a placed signature to resize it.</span></label>
      <p class="note">Click the page where you want to sign. Drag a signature to move it. You can sign on as many pages as you need.</p>
      ${goBlock("Sign PDF")}</aside></div>`;
  const view = $("[data-view]", P.work), go = $("[data-go]", P.work), st = $("[data-st]", P.work), pad = $("[data-pad]", P.work), prev = $("[data-prev]", P.work);
  P.onWarn = m => setStatus(st, m, "err");
  P.onFiles = l => load(l[0]);
  P.onReset = () => { V && V.destroy(); V = null; file = null; items = []; view.innerHTML = ""; };

  const sizePad = () => { const r = pad.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1; pad.width = Math.max(260, r.width) * dpr; pad.height = 160 * dpr; const g = pad.getContext("2d"); g.scale(dpr, dpr); g.lineCap = g.lineJoin = "round"; g.lineWidth = 2.6; drawn = false; };
  let down = false;
  const pos = e => { const r = pad.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  pad.addEventListener("pointerdown", e => { down = true; pad.setPointerCapture(e.pointerId); const g = pad.getContext("2d"); g.strokeStyle = $("[data-ink]", P.work).value; g.beginPath(); g.moveTo(...pos(e)); g.lineTo(...pos(e)); g.stroke(); drawn = true; });
  pad.addEventListener("pointermove", e => { if (!down) return; const g = pad.getContext("2d"); g.lineTo(...pos(e)); g.stroke(); drawn = true; });
  const up = () => { if (down) { down = false; refreshSig(); } };
  pad.addEventListener("pointerup", up); pad.addEventListener("pointercancel", up);
  $("[data-clear]", P.work).onclick = () => { sizePad(); refreshSig(); };
  $("[data-tabs]", P.work).addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return; mode = b.dataset.tab;
    $$("[data-tab]", P.work).forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    $$("[data-pane]", P.work).forEach(p => p.hidden = p.dataset.pane !== mode);
    if (mode === "draw") requestAnimationFrame(() => { if (!drawn) sizePad(); });
    refreshSig();
  });
  $("[data-name]", P.work).oninput = refreshSig; $("[data-font]", P.work).onchange = refreshSig;
  let upSig = null;
  $("[data-up]", P.work).onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const r = await imageToPng(f, 1200); upSig = {url: r.url, ar: r.h / r.w}; setStatus(st, ""); }
    catch (err) { upSig = null; setStatus(st, err.message, "err"); }
    refreshSig();
  };
  async function refreshSig() {
    sig = null;
    if (mode === "draw" && drawn) { const c = trimCanvas(pad); if (c) sig = {url: c.toDataURL("image/png"), ar: c.height / c.width}; }
    else if (mode === "type") {
      const name = $("[data-name]", P.work).value.trim(); const font = $("[data-font]", P.work).value;
      if (name) {
        try { await document.fonts.load("80px '" + font + "'"); } catch (e) { /* falls back to cursive */ }
        const c = document.createElement("canvas"); c.width = 1400; c.height = 220; const g = c.getContext("2d");
        g.font = "96px '" + font + "', cursive"; g.fillStyle = "#111"; g.textBaseline = "middle"; g.fillText(name, 20, 110);
        const t = trimCanvas(c); if (t) sig = {url: t.toDataURL("image/png"), ar: t.height / t.width};
      }
    } else if (mode === "upload") sig = upSig;
    prev.innerHTML = sig ? `<img src="${sig.url}" alt="Your signature">` : "<span>Your signature will show here</span>";
    if (V && V.layer) V.layer.classList.toggle("placing", !!sig);
    updateGo();
  }
  const updateGo = () => { go.disabled = !(file && items.length); };

  async function load(f) {
    P.res.hidden = true; setStatus(st, "Opening " + f.name + "…");
    let pdf; try { pdf = await pdfjsOpen(f); } catch (e) { P.warn(e.message); return; }
    V && V.destroy(); file = f; items = []; P.showWork(); requestAnimationFrame(() => { if (!drawn) sizePad(); });
    V = pageViewer(view, pdf, `<button type="button" class="btn ghost small" data-undo>Undo</button><button type="button" class="btn ghost small" data-more>Change file</button>`);
    $("[data-more]", view).onclick = () => P.open();
    $("[data-undo]", view).onclick = () => { const it = items.pop(); if (it) { if (it.page !== V.cur) V.show(it.page); else L.draw(); } updateGo(); };
    L = itemLayer(V, items, {
      label: () => "Signature",
      render: (it, el) => { el.innerHTML = `<img src="${it.url}" alt="">`; },
      onChange: updateGo,
      onPlace(cx, cy) {
        if (!sig) { setStatus(st, "First draw, type or upload your signature on the right.", "err"); return; }
        const fw = +$("[data-size]", P.work).value / 100, fh = fw * sig.ar * V.W / V.H;
        const it = {type: "img", page: V.cur, url: sig.url, ar: sig.ar, keep: true, fw, fh, fx: clamp(cx - fw / 2, 0, 1 - fw), fy: clamp(cy - fh / 2, 0, Math.max(0, 1 - fh))};
        items.push(it); L.draw(); updateGo();
        setStatus(st, plural(items.length, "signature") + " placed. Click Sign PDF when you're done.");
      }
    });
    V.onShow = () => { L.draw(); V.layer.classList.toggle("placing", !!sig); };
    await V.show(1);
    setStatus(st, sig ? "Click on the page where your signature should go." : "Make your signature on the right, then click the page to place it.");
  }
  go.addEventListener("click", async () => {
    go.disabled = true; setStatus(st, "Signing…");
    try {
      await need("pdflib"); const d = await loadPL(file); const cache = {};
      for (const it of items) {
        const png = cache[it.url] || (cache[it.url] = await d.embedPng(dataUrlBytes(it.url)));
        const pg = d.getPage(it.page - 1); pg.drawImage(png, itemBox(pageFrame(pg), it));
      }
      setStatus(st, "Done.", "ok");
      P.done({files: [{name: baseName(file.name) + "_signed.pdf", blob: pdfBlob(await d.save())}], summary: "Added " + plural(items.length, "signature") + "."});
    } catch (e) { console.error(e); setStatus(st, e.message || "The PDF couldn't be signed. Try again.", "err"); }
    updateGo();
  });
}

/* ================= Crop PDF ================= */
const MM = 72 / 25.4;
function mountCrop(P) {
  let file = null, V = null, m = {t: 0, r: 0, b: 0, l: 0}, drag = null;
  P.work.innerHTML = `<div class="work">
    <section class="box" data-view aria-label="Page preview"></section>
    <aside class="opts" aria-label="Crop options"><h2>Trim the edges</h2>
      <p class="note">Drag on the page to draw the area you want to keep, or type how much to trim from each edge.</p>
      <div class="row2">${[["t", "Top"], ["b", "Bottom"], ["l", "Left"], ["r", "Right"]].map(([k, l]) => `<label class="f">${l} (mm)<input type="number" min="0" step="1" data-m="${k}" value="0"></label>`).join("")}</div>
      <button type="button" class="btn ghost small" data-zero style="margin:0 0 14px">Reset to full page</button>
      <fieldset class="f fs"><legend>Crop which pages</legend>${radios("which", [["all", "All pages"], ["cur", "Only the page shown"], ["some", "Pages I choose"]], "all")}</fieldset>
      <label class="f" data-somef hidden>Pages<input type="text" data-some placeholder="e.g. 1-3, 6" autocomplete="off"></label>
      <p class="fl-meta">Cropping hides the trimmed edges in every PDF reader and when printing. The hidden parts are still inside the file.</p>
      ${goBlock("Crop PDF")}</aside></div>`;
  const view = $("[data-view]", P.work), go = $("[data-go]", P.work), st = $("[data-st]", P.work);
  const which = () => ($("input[name=which]:checked", P.work) || {}).value;
  P.onWarn = msg => setStatus(st, msg, "err");
  P.onFiles = l => load(l[0]);
  P.onReset = () => { V && V.destroy(); V = null; file = null; view.innerHTML = ""; };
  $$("input[name=which]", P.work).forEach(r => r.onchange = () => { $("[data-somef]", P.work).hidden = which() !== "some"; });
  const box = () => ({x: m.l, y: m.t, w: Math.max(4, V.W - m.l - m.r), h: Math.max(4, V.H - m.t - m.b)});
  function sync(fromInputs) {
    if (!V) return;
    if (!fromInputs) $$("[data-m]", P.work).forEach(i => { i.value = Math.round(m[i.dataset.m] / MM * 10) / 10; });
    const b = box(); const el = $(".crop-box", V.layer); if (!el) return;
    Object.assign(el.style, {left: b.x / V.W * 100 + "%", top: b.y / V.H * 100 + "%", width: b.w / V.W * 100 + "%", height: b.h / V.H * 100 + "%"});
    const any = m.t || m.r || m.b || m.l; go.disabled = !(file && any);
  }
  $$("[data-m]", P.work).forEach(i => i.addEventListener("input", () => {
    if (!V) return; const v = Math.max(0, +i.value || 0) * MM; const k = i.dataset.m;
    const opp = {t: "b", b: "t", l: "r", r: "l"}[k]; const span = k === "t" || k === "b" ? V.H : V.W;
    m[k] = Math.min(v, Math.max(0, span - m[opp] - 10)); sync(true);
  }));
  $("[data-zero]", P.work).onclick = () => { m = {t: 0, r: 0, b: 0, l: 0}; sync(); };

  function wireDraw(layer) {
    const at = e => { const r = layer.getBoundingClientRect(); return {x: clamp((e.clientX - r.left) / r.width, 0, 1) * V.W, y: clamp((e.clientY - r.top) / r.height, 0, 1) * V.H}; };
    const hit = p => {
      const b = box(); const tol = 12 * V.W / layer.getBoundingClientRect().width;
      const inY = p.y > b.y - tol && p.y < b.y + b.h + tol, inX = p.x > b.x - tol && p.x < b.x + b.w + tol;
      const ed = {l: inY && Math.abs(p.x - b.x) < tol, r: inY && Math.abs(p.x - b.x - b.w) < tol, t: inX && Math.abs(p.y - b.y) < tol, b: inX && Math.abs(p.y - b.y - b.h) < tol};
      if (ed.l || ed.r || ed.t || ed.b) return {edges: ed};
      const full = !(m.t || m.r || m.b || m.l);
      return !full && p.x > b.x && p.x < b.x + b.w && p.y > b.y && p.y < b.y + b.h ? {move: true} : null;
    };
    const setBox = b => { m.l = b.x; m.t = b.y; m.r = Math.max(0, V.W - b.x - b.w); m.b = Math.max(0, V.H - b.y - b.h); sync(); };
    const CUR = {l: "ew-resize", r: "ew-resize", t: "ns-resize", b: "ns-resize", lt: "nwse-resize", rb: "nwse-resize", rt: "nesw-resize", lb: "nesw-resize"};
    layer.addEventListener("pointerdown", e => {
      layer.setPointerCapture(e.pointerId); const p = at(e); const h = hit(p); const b = box();
      drag = h && h.edges ? {edges: h.edges, s: b} : h ? {move: true, ox: p.x - b.x, oy: p.y - b.y, w: b.w, h: b.h} : {sx: p.x, sy: p.y, prev: {...m}};
    });
    layer.addEventListener("pointermove", e => {
      const p = at(e);
      if (!drag) { const h = hit(p); layer.style.cursor = !h ? "crosshair" : h.move ? "move" : CUR[(h.edges.l ? "l" : h.edges.r ? "r" : "") + (h.edges.t ? "t" : h.edges.b ? "b" : "")]; return; }
      if (drag.move) { setBox({x: clamp(p.x - drag.ox, 0, V.W - drag.w), y: clamp(p.y - drag.oy, 0, V.H - drag.h), w: drag.w, h: drag.h}); return; }
      if (drag.edges) {
        const {l, r, t, b} = drag.edges, s = drag.s; let x0 = s.x, y0 = s.y, x1 = s.x + s.w, y1 = s.y + s.h;
        if (l) x0 = Math.min(p.x, x1 - 10); if (r) x1 = Math.max(p.x, x0 + 10); if (t) y0 = Math.min(p.y, y1 - 10); if (b) y1 = Math.max(p.y, y0 + 10);
        setBox({x: x0, y: y0, w: x1 - x0, h: y1 - y0}); return;
      }
      const w = Math.abs(p.x - drag.sx), h = Math.abs(p.y - drag.sy); if (w < 4 || h < 4) return;
      setBox({x: Math.min(p.x, drag.sx), y: Math.min(p.y, drag.sy), w, h});
    });
    const end = () => { if (drag && drag.sx !== undefined && V.W - m.l - m.r < 10) { m = drag.prev; sync(); } drag = null; };
    layer.addEventListener("pointerup", end); layer.addEventListener("pointercancel", end);
  }
  async function load(f) {
    P.res.hidden = true; setStatus(st, "Opening " + f.name + "…");
    let pdf; try { pdf = await pdfjsOpen(f); } catch (e) { P.warn(e.message); return; }
    V && V.destroy(); file = f; m = {t: 0, r: 0, b: 0, l: 0}; P.showWork();
    V = pageViewer(view, pdf, `<button type="button" class="btn ghost small" data-more>Change file</button>`);
    $("[data-more]", view).onclick = () => P.open();
    V.wrap.classList.add("cropping"); V.layer.innerHTML = '<div class="crop-box"></div>'; wireDraw(V.layer);
    V.onShow = () => sync();
    await V.show(1); setStatus(st, "");
  }
  go.addEventListener("click", async () => {
    go.disabled = true; setStatus(st, "Cropping…");
    try {
      await need("pdflib"); const d = await loadPL(file); const n = d.getPageCount();
      const w = which(); const set = w === "cur" ? new Set([V.cur - 1]) : w === "some" ? pageSet($("[data-some]", P.work).value || " ", n) : null;
      if (w === "some" && !set) throw new Error("Type the pages to crop, for example 1-3, 6.");
      let count = 0;
      d.getPages().forEach((p, i) => {
        if (set && !set.has(i)) return;
        const F = pageFrame(p);
        if (m.l + m.r > F.W - 10 || m.t + m.b > F.H - 10) throw new Error("Page " + (i + 1) + " is smaller than the area you're trimming. Use smaller margins, or crop that page on its own.");
        const b = visRectToBox(F, m.l, m.t, F.W - m.l - m.r, F.H - m.t - m.b);
        p.setCropBox(b.x, b.y, b.width, b.height); count++;
      });
      setStatus(st, "Done.", "ok");
      P.done({files: [{name: baseName(file.name) + "_cropped.pdf", blob: pdfBlob(await d.save())}], summary: "Cropped " + plural(count, "page") + "."});
    } catch (e) { console.error(e); setStatus(st, e.message || "The PDF couldn't be cropped. Try again.", "err"); }
    go.disabled = false;
  });
}
