/* Daftarbox PDF tools – shared UI: tool registry, tool page shell, generic tool page, results, home and routing. */
"use strict";

const CATS = [
  {id: "organise", name: "Organise"},
  {id: "optimise", name: "Optimise"},
  {id: "convert", name: "Convert"},
  {id: "edit", name: "Edit"},
  {id: "secure", name: "Sign & secure"}
];
const EXT = {
  pdf: ["pdf"], img: ["jpg", "jpeg", "png", "webp", "gif", "bmp"], docx: ["docx"], sheet: ["xlsx", "xls", "csv", "ods"]
};
EXT.pdfimg = EXT.pdf.concat(["jpg", "jpeg", "png", "webp"]);
const KIND = {
  pdf: ["PDF file", "PDF files", "PDF"], img: ["image", "images", "JPG, PNG, WebP, GIF or BMP"],
  docx: ["Word file", "Word files", ".docx"], sheet: ["spreadsheet", "spreadsheets", "Excel (.xlsx, .xls), ODS or CSV"],
  pdfimg: ["PDF or image", "PDF or photos", "PDF, or photos of documents (JPG, PNG)"]
};
const TOOLS = [];
const T = t => TOOLS.push(t);
const kindOf = t => Object.keys(EXT).find(k => EXT[k] === t.exts) || "pdf";
const acceptAttr = t => t.exts.map(e => "." + e).join(",");
const accepts = (t, f) => t.exts.includes(extOf(f.name));

let current = null; /* the tool page that receives dropped files */

function setStatus(el, msg, kind) { if (!el) return; el.textContent = msg || ""; el.className = "status" + (kind ? " " + kind : ""); }
const smooth = () => matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

/* ---------- Tool page shell: crumbs, heading, one big picker, workspace, results ---------- */
function toolShell(root, t) {
  const k = KIND[kindOf(t)]; const cat = CATS.find(c => c.id === t.cat);
  root.innerHTML = `<nav class="crumbs" aria-label="Breadcrumb"><a href="#/">PDF tools</a> <span aria-hidden="true">/</span> <a href="#/c/${cat.id}">${esc(cat.name)}</a></nav>
    <div class="t-head"><h1>${esc(t.name)}</h1><p>${esc(t.lede || t.desc)}</p></div>
    <div class="picker" data-picker>
      <button type="button" class="btn big" data-pick>${esc(t.pick || "Select " + (t.multiple ? k[1] : k[0]))}</button>
      <input type="file" accept="${acceptAttr(t)}" ${t.multiple ? "multiple" : ""} data-input tabindex="-1" aria-hidden="true">
      <small>or drop ${t.multiple ? "files" : "a file"} here &middot; ${esc(k[2])}</small>
      <p class="privacy">${ICON.lock}Your files are processed on this device and never uploaded.</p>
      <p class="status err" data-pst role="alert"></p>
    </div>
    <div data-work hidden></div>
    <section class="results" data-res hidden tabindex="-1" aria-live="polite"></section>
    ${related(t)}`;
  const P = {
    root, t, picker: $("[data-picker]", root), work: $("[data-work]", root), res: $("[data-res]", root),
    input: $("[data-input]", root), onFiles: null, onReset: null, onWarn: null,
    open() { P.input.click(); },
    showWork() { P.picker.hidden = true; P.work.hidden = false; },
    warn(msg) { if (P.onWarn && !P.work.hidden) P.onWarn(msg); else setStatus($("[data-pst]", root), msg, "err"); },
    take(list) {
      const good = list.filter(f => accepts(t, f)), bad = list.filter(f => !accepts(t, f));
      const msg = bad.length ? bad.map(f => f.name).join(", ") + (bad.length > 1 ? " aren't" : " isn't") + " a " + k[0] + ". Choose " + (t.multiple ? k[1] : "a " + k[0]) + " (" + k[2] + ")." : "";
      setStatus($("[data-pst]", root), "");
      if (good.length && P.onFiles) P.onFiles(good);
      if (msg) P.warn(msg);
    },
    done(r) { showResults(P.res, r, P.restart); },
    restart() {
      P.res.hidden = true; P.work.hidden = true; P.picker.hidden = false;
      if (P.onReset) P.onReset();
      window.scrollTo({top: 0, behavior: smooth()}); $("[data-pick]", root).focus({preventScroll: true});
    }
  };
  $("[data-pick]", root).addEventListener("click", () => P.open());
  P.input.addEventListener("change", () => { const l = [...P.input.files]; P.input.value = ""; if (l.length) P.take(l); });
  /* The picker itself also lights up while a file is dragged over it */
  P.picker.addEventListener("dragenter", () => P.picker.classList.add("drag"));
  P.picker.addEventListener("dragleave", e => { if (!P.picker.contains(e.relatedTarget)) P.picker.classList.remove("drag"); });
  P.picker.addEventListener("drop", () => P.picker.classList.remove("drag"));
  return P;
}

function related(t) {
  const same = TOOLS.filter(x => x.cat === t.cat && x.id !== t.id && !x.soon);
  const more = same.concat(TOOLS.filter(x => x.cat !== t.cat && !x.soon && ["merge", "compress", "edit", "sign"].includes(x.id))).slice(0, 4);
  return `<section class="more" aria-labelledby="more-h"><h2 id="more-h">More PDF tools</h2><ul class="tgrid">${more.map(cardHtml).join("")}</ul></section>`;
}

/* ---------- Results ---------- */
function showResults(host, r, onReset) {
  const many = r.files.length > 1;
  host.hidden = false;
  host.innerHTML = `<div class="res-head"><span class="res-ok">${ICON.check}</span><div><h2>${many ? "Your files are ready" : "Your file is ready"}</h2>${r.summary ? `<p class="sum">${esc(r.summary)}</p>` : ""}</div></div>
    ${r.note ? `<p class="warn">${esc(r.note)}</p>` : ""}
    <ul>${r.files.map((f, i) => `<li>${ICON.file.replace("<svg", '<svg class="fi"')}<span class="fname" title="${esc(f.name)}">${esc(f.name)}</span><span class="fsize">${fmtSize(f.blob.size)}</span><button type="button" class="btn small${many ? " ghost" : ""}" data-dl="${i}" aria-label="Download ${esc(f.name)}">${ICON.dl.replace("<svg", '<svg width="16" height="16"')}Download</button></li>`).join("")}</ul>
    <div class="results-foot">${many ? `<button type="button" class="btn" data-all>${ICON.dl.replace("<svg", '<svg width="16" height="16"')}Download all (.zip)</button>` : ""}<button type="button" class="btn ghost" data-reset>Start over</button></div>
    <p class="status" data-rs role="status"></p>`;
  const rs = $("[data-rs]", host);
  $$("[data-dl]", host).forEach(b => b.addEventListener("click", () => { const f = r.files[+b.dataset.dl]; saveFile(f.name, f.blob); setStatus(rs, "Downloading " + f.name + ".", "ok"); }));
  const all = $("[data-all]", host);
  if (all) all.addEventListener("click", async () => {
    all.disabled = true; setStatus(rs, "Packing your files into a zip…");
    try { const z = await zipAll(r.files); saveFile((r.zipName || "daftarbox-files") + ".zip", z); setStatus(rs, "Downloading the zip file.", "ok"); }
    catch (e) { setStatus(rs, e.message || "The zip file couldn't be made. Download the files one by one instead.", "err"); }
    all.disabled = false;
  });
  $("[data-reset]", host).addEventListener("click", onReset);
  host.scrollIntoView({behavior: smooth(), block: "start"});
  host.focus({preventScroll: true});
}

/* ---------- Form helpers ---------- */
function readForm(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === "radio") { if (el.checked) o[el.name] = el.value; }
    else if (el.type === "checkbox") o[el.name] = el.checked;
    else if (el.type === "file") o[el.name] = el.files[0] || null;
    else o[el.name] = el.value;
  }
  return o;
}
/* Elements with data-show="name=value" are only shown while that option is chosen. */
function wireShow(form) {
  const upd = () => { const o = readForm(form); $$("[data-show]", form).forEach(el => { const [n, v] = el.dataset.show.split("="); el.hidden = String(o[n]) !== v; }); };
  form.addEventListener("change", upd); form.addEventListener("input", upd); upd();
}
const radios = (name, opts, sel) => `<div class="radios">${opts.map(([v, l]) => `<label><input type="radio" name="${name}" value="${v}" ${v === sel ? "checked" : ""}> ${l}</label>`).join("")}</div>`;

/* ---------- PDF preview info for the file list (first-page thumbnail + page count) ---------- */
const infoCache = new WeakMap();
function pdfInfo(file) {
  if (!infoCache.has(file)) infoCache.set(file, (async () => {
    const pdf = await pdfjsOpen(file);
    try {
      const page = await pdf.getPage(1); const vp = page.getViewport({scale: 1});
      const c = await renderPage(page, 120 / Math.max(vp.width, vp.height));
      const thumb = c.toDataURL("image/jpeg", .8); c.width = c.height = 0; page.cleanup();
      return {pages: pdf.numPages, thumb};
    } finally { pdf.destroy(); }
  })());
  return infoCache.get(file);
}
const urlCache = new WeakMap();
const imgUrl = f => { if (!urlCache.has(f)) urlCache.set(f, URL.createObjectURL(f)); return urlCache.get(f); };

/* ---------- Generic tool page (file list + options + one action) ---------- */
function mountGeneric(P) {
  const t = P.t; const isPdf = t.exts === EXT.pdf, isImg = t.exts === EXT.img; let files = [];
  P.work.innerHTML = `<div class="work">
    <section class="box" aria-labelledby="fl-h"><div class="box-h"><h2 id="fl-h">${t.multiple ? "Your files" : "Your file"}</h2><span class="fsize" data-count></span><span class="sp"></span>
      <button type="button" class="btn ghost small" data-more>${t.multiple ? ICON.plus.replace("<svg", '<svg width="16" height="16"') + "Add more files" : "Choose a different file"}</button></div>
      <ul class="flist" data-list></ul>${t.hint ? `<p class="box-f">${esc(t.hint)}</p>` : ""}</section>
    <aside class="opts" aria-label="Options">${t.options ? "<h2>Options</h2>" : ""}<form data-opts novalidate>${t.options ? t.options() : ""}</form>
      <p class="note" data-info hidden></p>
      <button type="button" class="btn wide go" data-go>${esc(t.action)}</button>
      <progress max="1" value="0" hidden></progress>
      <p class="status" data-st role="status" aria-live="polite"></p></aside></div>`;
  const list = $("[data-list]", P.work), go = $("[data-go]", P.work), st = $("[data-st]", P.work), prog = $("progress", P.work), form = $("[data-opts]", P.work), info = $("[data-info]", P.work);
  form.addEventListener("submit", e => { e.preventDefault(); if (!go.disabled) go.click(); });
  wireShow(form);
  if (t.wire) t.wire(form);
  $("[data-more]", P.work).addEventListener("click", () => P.open());
  P.onWarn = msg => setStatus(st, msg, "err");
  P.onFiles = l => { if (t.multiple) files.push(...l); else files = [l[0]]; P.res.hidden = true; setStatus(st, ""); P.showWork(); draw(); changed(); };
  P.onReset = () => { files = []; list.innerHTML = ""; setStatus(st, ""); };

  function changed() {
    info.hidden = true;
    if (isPdf && !t.multiple && files[0]) {
      const f = files[0];
      pdfInfo(f).then(i => { if (files[0] !== f) return; info.hidden = false; info.textContent = f.name + " has " + plural(i.pages, "page") + "."; }).catch(() => {});
    }
    if (t.onLoad && files.length) Promise.resolve(t.onLoad(files, form)).catch(e => setStatus(st, e.message, "err"));
  }
  function draw() {
    $("[data-count]", P.work).textContent = t.multiple ? plural(files.length, "file") : "";
    list.innerHTML = files.map((f, i) => `<li>${t.multiple ? `<span class="fl-n">${i + 1}</span>` : ""}<span class="fl-th" data-th="${i}">${isImg ? `<img src="${imgUrl(f)}" alt="">` : ICON.file}</span>
      <span class="fl-txt"><span class="fname" title="${esc(f.name)}">${esc(f.name)}</span><span class="fl-meta" data-meta="${i}">${fmtSize(f.size)}</span></span>
      <span class="fl-act">${t.multiple ? `<button type="button" class="icon-btn" data-up="${i}" aria-label="Move ${esc(f.name)} up" ${i === 0 ? "disabled" : ""}>${ICON.up}</button><button type="button" class="icon-btn" data-down="${i}" aria-label="Move ${esc(f.name)} down" ${i === files.length - 1 ? "disabled" : ""}>${ICON.down}</button>` : ""}
      <button type="button" class="icon-btn" data-rm="${i}" aria-label="Remove ${esc(f.name)}">${ICON.x}</button></span></li>`).join("");
    if (isPdf) files.forEach((f, i) => pdfInfo(f).then(inf => {
      const th = $(`[data-th="${i}"]`, list), m = $(`[data-meta="${i}"]`, list);
      if (!th || files[i] !== f) return;
      th.innerHTML = `<img src="${inf.thumb}" alt="">`; m.textContent = fmtSize(f.size) + " · " + plural(inf.pages, "page");
    }).catch(() => { const m = $(`[data-meta="${i}"]`, list); if (m && files[i] === f) m.textContent = fmtSize(f.size) + " · preview not available"; }));
    const min = t.min || 1;
    go.disabled = files.length < min;
    if (files.length && files.length < min) setStatus(st, "Add at least " + min + " files to continue.");
    else if (st.textContent.startsWith("Add at least")) setStatus(st, "");
  }
  list.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.up) { const i = +b.dataset.up; [files[i - 1], files[i]] = [files[i], files[i - 1]]; draw(); ($(`[data-up="${i - 1}"]`, list) || $(`[data-down="${i - 1}"]`, list))?.focus(); }
    else if (b.dataset.down) { const i = +b.dataset.down; [files[i + 1], files[i]] = [files[i], files[i + 1]]; draw(); ($(`[data-down="${i + 1}"]`, list) || $(`[data-up="${i + 1}"]`, list))?.focus(); }
    else if (b.dataset.rm) { files.splice(+b.dataset.rm, 1); P.res.hidden = true; if (!files.length) { P.restart(); return; } draw(); changed(); }
  });
  go.addEventListener("click", async () => {
    const o = readForm(form);
    go.disabled = true; prog.hidden = false; prog.value = 0; setStatus(st, "Getting the tool ready…");
    try {
      if (t.libs) await need(...t.libs);
      setStatus(st, "Working…");
      const r = await t.run(files, o, (p, msg) => { prog.value = p; setStatus(st, msg || "Working… " + Math.round(p * 100) + "%"); });
      setStatus(st, "Done.", "ok");
      P.done(r);
    } catch (e) { console.error(e); setStatus(st, (e && e.message) || "Something went wrong. Try again, or try a different file.", "err"); }
    finally { prog.hidden = true; go.disabled = files.length < (t.min || 1); }
  });
}

/* ---------- Home ---------- */
function cardHtml(t) {
  return `<li class="tcard${t.soon ? " is-soon" : ""}" data-cat="${t.cat}"><span class="ti">${TICON[t.icon || t.id] || TICON.edit}</span>
    <h3><a href="#/t/${t.id}">${esc(t.name)}</a>${t.isNew ? '<span class="badge new">New</span>' : ""}${t.soon ? '<span class="badge">Coming soon</span>' : ""}</h3>
    <p>${esc(t.desc)}</p></li>`;
}
function renderHome(root, cat) {
  root.innerHTML = `<section class="p-hero"><span class="eyebrow">${ICON.lock.replace("<svg", '<svg width="14" height="14"')}Free &middot; Private &middot; No sign-up</span>
      <h1>Every PDF tool you need, right in your browser</h1>
      <p>Merge, split, compress, convert, edit and sign PDFs in a few clicks. Your files stay on your device the whole time.</p></section>
    <div class="chips" role="group" aria-label="Show tools by type">
      <button type="button" data-f="all" aria-pressed="false">All</button>${CATS.map(c => `<button type="button" data-f="${c.id}" aria-pressed="false">${esc(c.name)}</button>`).join("")}</div>
    <ul class="tgrid" data-grid>${TOOLS.map(cardHtml).join("")}</ul>
    <ul class="trust">
      <li>${ICON.device}<div><b>Stays on your device</b><span>Files are opened and changed by your browser. Nothing is sent to a server.</span></div></li>
      <li>${ICON.free}<div><b>Free to use</b><span>No watermarks added, no page limits, no account needed.</span></div></li>
      <li>${ICON.check}<div><b>Simple by design</b><span>Pick a tool, choose your file, download the result. That's it.</span></div></li>
    </ul>`;
  const apply = f => {
    $$(".chips button", root).forEach(b => b.setAttribute("aria-pressed", String(b.dataset.f === f)));
    $$(".tcard", root).forEach(li => li.hidden = f !== "all" && li.dataset.cat !== f);
    markNav(f);
  };
  $(".chips", root).addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    const f = b.dataset.f; apply(f);
    try { history.replaceState(null, "", f === "all" ? "#/" : "#/c/" + f); } catch (err) { /* some browsers block this on file:// */ }
  });
  apply(cat || "all");
}
function markNav(c) { $$("#nav a").forEach(a => { if (a.dataset.c === c) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); }); }

/* ---------- Coming soon page ---------- */
function mountSoon(root, t) {
  const cat = CATS.find(c => c.id === t.cat);
  root.innerHTML = `<nav class="crumbs" aria-label="Breadcrumb"><a href="#/">PDF tools</a> <span aria-hidden="true">/</span> <a href="#/c/${cat.id}">${esc(cat.name)}</a></nav>
    <div class="t-head"><h1>${esc(t.name)}</h1><p>${esc(t.desc)}</p></div>
    <div class="soon"><p class="warn">This tool isn't ready yet. We'd rather tell you that than give you a file that only looks protected.</p>${t.soonHtml}
    <p style="margin-top:22px"><a class="btn ghost" href="#/">Back to all PDF tools</a></p></div>`;
}

/* ---------- Router ---------- */
function route() {
  const app = $("#app"); const h = location.hash.replace(/^#\/?/, "");
  const [kind, id] = h.split("/");
  const t = kind === "t" && TOOLS.find(x => x.id === id);
  current = null;
  if (t) {
    document.title = t.name + " – Daftarbox";
    if (t.soon) mountSoon(app, t);
    else {
      const P = toolShell(app, t); current = P; (t.mount || mountGeneric)(P);
      const ho = window.dbxHandoff; window.dbxHandoff = null;
      if (ho && ho.length) setTimeout(() => P.take(ho), 0);
    }
    markNav(t.cat);
  } else {
    const c = kind === "c" && CATS.find(x => x.id === id);
    document.title = c ? c.name + " PDF tools – Daftarbox" : "PDF tools – Daftarbox";
    renderHome(app, c ? c.id : null);
  }
  window.scrollTo(0, 0);
  const h1 = $("h1", app); if (h1) { h1.tabIndex = -1; h1.focus({preventScroll: true}); }
}

/* Dropping files anywhere on a tool page adds them */
(function wireWindowDrop() {
  let depth = 0;
  const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes("Files");
  const off = () => { depth = 0; document.body.classList.remove("dropping"); current && current.picker.classList.remove("drag"); };
  window.addEventListener("dragenter", e => { if (!hasFiles(e) || !current) return; depth++; document.body.classList.add("dropping"); });
  window.addEventListener("dragleave", () => { if (depth && --depth <= 0) off(); });
  window.addEventListener("dragover", e => { e.preventDefault(); if (e.dataTransfer && hasFiles(e)) e.dataTransfer.dropEffect = current ? "copy" : "none"; });
  window.addEventListener("drop", e => {
    e.preventDefault(); off();
    if (current && hasFiles(e) && e.dataTransfer.files.length) current.take([...e.dataTransfer.files]);
  });
})();

document.addEventListener("DOMContentLoaded", () => { window.addEventListener("hashchange", route); route(); });
