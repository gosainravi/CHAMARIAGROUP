/* Daftarbox PDF tools – Edit PDF, a full-screen editor.
   Click any line or paragraph to edit it in place. Text pages are editable straight away; scans and photos are read
   with OCR in the background. On save the old text is really removed from the page and the new text is written with
   the PDF's own font when it has the characters (otherwise a similar standard font). Everything you don't touch stays as it was. */
"use strict";

const ED_FONT = {sans: "Arial, Helvetica, sans-serif", serif: '"Times New Roman", Times, serif', mono: '"Courier New", Courier, monospace'};
const INDIC_FONTS = [
  [/[ऀ-ॿ]/, "Noto Sans Devanagari"], [/[ঀ-৿]/, "Noto Sans Bengali"], [/[਀-੿]/, "Noto Sans Gurmukhi"],
  [/[઀-૿]/, "Noto Sans Gujarati"], [/[஀-௿]/, "Noto Sans Tamil"], [/[ఀ-౿]/, "Noto Sans Telugu"],
  [/[ಀ-೿]/, "Noto Sans Kannada"], [/[ഀ-ൿ]/, "Noto Sans Malayalam"]
];
const fontStack = fam => (ED_FONT[fam] || ED_FONT.sans) + ", " + INDIC_FONTS.map(f => '"' + f[1] + '"').join(", ") + ", sans-serif";
const OCR_LANGS = [["eng", "English"], ["hin", "Hindi"], ["eng+hin", "English + Hindi"], ["mar", "Marathi"], ["ben", "Bengali"], ["guj", "Gujarati"],
  ["tam", "Tamil"], ["tel", "Telugu"], ["kan", "Kannada"], ["mal", "Malayalam"], ["pan", "Punjabi"]];
const LANG_KEY = "daftarbox-pdf-ocr-lang", ZOOM_KEY = "daftarbox-pdf-edit-zoom";
const loadedFonts = new Set();
function ensureScriptFonts(text) {
  for (const [re, name] of INDIC_FONTS) if (re.test(text) && !loadedFonts.has(name)) {
    loadedFonts.add(name);
    const l = document.createElement("link"); l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=" + name.replace(/ /g, "+") + ":wght@400;700&display=swap";
    document.head.appendChild(l);
  }
}
async function fontsReady(text, bold, px) {
  ensureScriptFonts(text);
  const names = INDIC_FONTS.filter(([re]) => re.test(text)).map(f => f[1]);
  for (let i = 0; i < 30 && names.length; i++) {
    try { const r = await Promise.all(names.map(n => document.fonts.load((bold ? 700 : 400) + " " + Math.round(px) + 'px "' + n + '"', text))); if (r.every(a => a.length)) return; } catch (e) { /* keep waiting */ }
    await new Promise(res => setTimeout(res, 150));
  }
}
const hasNonLatin = s => /[^\u0000-ɏ -⁯₠-⃏℀-⅏]/.test(s);
const rgbCss = c => "rgb(" + c.map(v => Math.round(v)).join(",") + ")";
const rgbHex = c => "#" + c.map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("");
const PT_OK = (() => { try { const d = document.createElement("div"); d.contentEditable = "plaintext-only"; return d.contentEditable === "plaintext-only"; } catch (e) { return false; } })();
const PX_PER_PT = 96 / 72;

const ED_ICON = {
  edit: S('<path d="M5 3l12 8-5.5 1.2L9 18z"/><path d="M14 14l5 5"/>'),
  text: S('<path d="M5 6V4h14v2M12 4v16M9 20h6"/>'),
  img: S('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>'),
  draw: S('<path d="M4 20c2-1 3-4 5-4s1 3 3 3 3-6 5-6 2 2 3 2"/><path d="M15 4l5 5"/>'),
  hl: S('<path d="M9 15l-3 3h6l1-1"/><path d="M9 15l7-11 4 3-7 11z"/><path d="M4 21h16"/>'),
  shape: S('<rect x="4" y="5" width="16" height="14" rx="1.5"/>'),
  rect: S('<path d="M7 20h10M5 14l7-10 7 10-4 6H9z"/>'),
  undo: S('<path d="M9 7H4v5"/><path d="M4 12a8 8 0 1 0 3-6.2L4 7"/>'),
  redo: S('<path d="M15 7h5v5"/><path d="M20 12a8 8 0 1 1-3-6.2L20 7"/>'),
  del: S('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  minus: S('<path d="M5 12h14"/>'), plus: S('<path d="M12 5v14M5 12h14"/>'),
  fitw: S('<path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/>'), fitp: S('<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M9 9h6M9 13h6"/>'),
  grip: S('<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>'),
  pages: S('<rect x="4" y="3" width="10" height="14" rx="1"/><path d="M10 21h8a2 2 0 0 0 2-2V9"/>'),
  rotate: S('<path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v5h-5"/>'),
  more: S('<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>'),
  al: S('<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>'), ac: S('<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>'),
  ar: S('<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>'), aj: S('<path d="M4 6h16M4 10h16M4 14h16M4 18h16"/>')
};
const MODES = [
  ["edit", "Edit", "Edit text and move things (V)", "v"], ["text", "Add text", "Add new text (T)", "t"], ["img", "Image", "Add an image or signature (I)", "i"],
  ["draw", "Draw", "Draw freehand (D)", "d"], ["hl", "Highlight", "Highlight (H)", "h"], ["shape", "Rectangle", "Rectangle (R)", "r"], ["rect", "White-out", "White-out (W)", "w"]
];

/* Photos and scans -> a PDF with one page per image (sized to fit A4), honouring the photo's rotation. */
async function imagesToPdf(files, onNote) {
  await need("pdflib"); const d = await PDFLib.PDFDocument.create(); let straightened = 0;
  for (const f of files) {
    let img = null;
    let bmp; try { bmp = await createImageBitmap(f, {imageOrientation: "from-image"}); } catch (e) { throw new Error(f.name + " couldn't be opened as an image. Try a JPG or PNG file."); }
    const k0 = Math.min(1, 3500 / Math.max(bmp.width, bmp.height));
    let c = document.createElement("canvas"); c.width = Math.round(bmp.width * k0); c.height = Math.round(bmp.height * k0);
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height); bmp.close && bmp.close();
    /* a photo of a page (page smaller than the picture): find the page, undo the perspective, even out the light */
    if (!window.__dbxNoStraighten) {
      try {
        const r = scanStraighten(g.getImageData(0, 0, c.width, c.height));
        if (r) { const o = document.createElement("canvas"); o.width = r.img.width; o.height = r.img.height; o.getContext("2d").putImageData(new ImageData(r.img.data, r.img.width, r.img.height), 0, 0); c.width = c.height = 0; c = o; straightened++; }
      } catch (err) { console.warn("straighten", err); }
    }
    if (extOf(f.name) === "png" && !straightened) { try { img = await d.embedPng(await f.arrayBuffer()); } catch (e) { img = null; } }
    if (!img) img = await d.embedJpg(await (await canvasBlob(c, "image/jpeg", .95)).arrayBuffer());
    c.width = c.height = 0;
    const s = Math.min(595.28 / img.width, 841.89 / img.height); const w = img.width * s, h = img.height * s;
    d.addPage([w, h]).drawImage(img, {x: 0, y: 0, width: w, height: h});
  }
  if (straightened && onNote) onNote(straightened);
  return new File([await d.save()], baseName(files[0].name) + ".pdf", {type: "application/pdf"});
}
/* Text the standard PDF fonts can't draw (Indian scripts) -> a 300 dpi transparent picture of the exact lines. */
async function linesToPng(lines, fam, bold, italic, size, gap, color, align, wrapW) {
  const k = 300 / 72; const c = document.createElement("canvas"); const g = c.getContext("2d");
  await fontsReady(lines.join(" "), bold, size * k);
  g.font = (italic ? "italic " : "") + (bold ? 700 : 400) + " " + size * k + "px " + fontStack(fam);
  const asc = size * 1.2, desc = size * .55; const widths = lines.map(l => g.measureText(l).width / k);
  const w = Math.max(wrapW, ...widths) + size * .2, h = asc + (lines.length - 1) * gap + desc;
  c.width = Math.ceil(w * k); c.height = Math.ceil(h * k);
  g.font = (italic ? "italic " : "") + (bold ? 700 : 400) + " " + size * k + "px " + fontStack(fam); g.fillStyle = color; g.textBaseline = "alphabetic";
  lines.forEach((l, i) => { const off = align === "center" ? (wrapW - widths[i]) / 2 : align === "right" ? wrapW - widths[i] : 0; g.fillText(l, Math.max(0, off) * k, (asc + i * gap) * k); });
  const url = c.toDataURL("image/png"); c.width = c.height = 0;
  return {url, top: -asc, w, h};
}
let mctx0 = null, scanMetricsReady = false; const mctx = () => mctx0 || (mctx0 = document.createElement("canvas").getContext("2d"));
const cssFont = (fam, bold, italic, px) => (italic ? "italic " : "") + (bold ? 700 : 400) + " " + px + "px " + fontStack(fam);
function measureCss(fam, bold, italic, size, text) { const g = mctx(); g.font = cssFont(fam, bold, italic, 100); return g.measureText(text).width * size / 100; }

function mountEdit(P) {
  let E = null;
  P.work.innerHTML = "";
  P.onFiles = async list => {
    const pdfs = list.filter(f => extOf(f.name) === "pdf"), imgs = list.filter(f => extOf(f.name) !== "pdf");
    try {
      if (E && !E.closeAsk()) return;
      let file, fromImages = false, straightNote = 0;
      if (pdfs.length) file = pdfs[0];
      else { setStatus($("[data-pst]", P.root), "Turning your " + (imgs.length > 1 ? "images" : "image") + " into pages…"); file = await imagesToPdf(imgs, n => { straightNote = n; }); fromImages = true; }
      setStatus($("[data-pst]", P.root), "Opening " + file.name + "…");
      E = await openEditor(P, file, fromImages, () => { E = null; });
      if (straightNote && E && E.toast) E.toast(straightNote > 1 ? "We straightened your photos so the pages lie flat." : "We straightened your photo so the page lies flat.", 6000);
      setStatus($("[data-pst]", P.root), pdfs.length && list.length > 1 ? "Only " + pdfs[0].name + " was opened. Edit one PDF at a time." : "");
    } catch (e) { console.error(e); P.warn(e.message || "This file couldn't be opened."); }
  };
  P.onReset = () => { if (E) E.close(true); };
}

async function openEditor(P, file, fromImages, onClosed) {
  await need("pdfjs", "pdflib");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsOpen(file, {fontExtraProperties: true});
  const docKey = "d" + Date.now().toString(36);
  let pl = null; try { pl = await PDFLib.PDFDocument.load(bytes, {ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false}); } catch (e) { pl = null; }
  const N = pdf.numPages;
  let lang = "eng"; try { lang = localStorage.getItem(LANG_KEY) || "eng"; } catch (e) { /* storage blocked */ }
  if (!OCR_LANGS.some(l => l[0] === lang)) lang = "eng";
  let zoomPref = "fitw"; try { zoomPref = localStorage.getItem(ZOOM_KEY) || "fitw"; } catch (e) { /* storage blocked */ }

  /* ---------- the editor view ---------- */
  const root = document.createElement("div"); root.className = "edx"; root.dataset.mode = "edit";
  root.setAttribute("role", "application"); root.setAttribute("aria-label", "PDF editor");
  const modeBtn = (m, label, tip, key, rail) => `<button type="button" class="${rail ? "rb" : "pb"}" data-mode="${m}" aria-pressed="${m === "edit"}" title="${tip} (${key.toUpperCase()})">${ED_ICON[m]}${rail ? `<span class="sr">${label}</span>` : `<span>${label}</span>`}</button>`;
  root.innerHTML = `<header class="edx-top">
      <button type="button" class="edx-ico" data-a="panel" title="Show or hide the tools panel" aria-label="Tools panel" aria-expanded="true">${S('<path d="M4 6h16M4 12h16M4 18h16"/>')}</button>
      <button type="button" class="edx-logo" data-a="close" title="Close the editor"><span class="mk" aria-hidden="true"></span><span class="lt">Daftarbox</span></button>
      <span class="edx-file" title="${esc(file.name)}">${esc(file.name)}</span>
      <span class="edx-pill" data-pill hidden><span class="spin" aria-hidden="true"></span><span data-pill-t role="status"></span><button type="button" data-a="stop">Stop</button></span>
      <button type="button" class="btn ghost small" data-a="close">Close</button>
      <button type="button" class="btn small edx-dl" data-a="save">${ICON.dl}<span>Download PDF</span></button>
    </header>
    <div class="edx-body">
      <aside class="edx-panel" data-panel aria-label="Edit tools">
        <h2>Edit</h2>
        <p class="edx-tip">Click any text on the page to change it. Dashed boxes show what you can edit.</p>
        <h3>Add content</h3>
        ${modeBtn("text", "Text", "Add new text", "t")}
        ${modeBtn("img", "Image", "Add an image", "i")}
        <button type="button" class="pb" data-a="sign">${TICON.sign}<span>Signature</span></button>
        <label class="edx-pick" data-picw hidden>${ED_ICON.img}<span data-pickt>Choose image…</span><input type="file" data-pic accept=".png,.jpg,.jpeg,.webp,.gif"></label>
        <h3>Mark up</h3>
        ${modeBtn("draw", "Draw", "Draw freehand", "d")}
        ${modeBtn("hl", "Highlight", "Highlight", "h")}
        ${modeBtn("shape", "Shape", "Rectangle", "r")}
        ${modeBtn("rect", "White-out", "White-out", "w")}
        <h3>Format</h3>
        <div class="edx-fmt" role="group" aria-label="Text formatting">
          <select data-f="fam" aria-label="Font" title="Font"><option value="orig">Original font</option><option value="sans">Sans</option><option value="serif">Serif</option><option value="mono">Mono</option></select>
          <div class="edx-fr">
            <input type="number" data-f="size" list="edx-sizes" min="4" max="200" step="0.5" value="12" aria-label="Text size in points" title="Text size">
            <datalist id="edx-sizes">${[6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64, 72].map(v => `<option value="${v}">`).join("")}</datalist>
            <input type="color" data-f="color" value="#111111" aria-label="Colour" title="Colour">
            <select data-f="ls" aria-label="Line spacing" title="Line spacing"><option value="">Spacing</option><option value="1">1.0</option><option value="1.15">1.15</option><option value="1.2">1.2</option><option value="1.5">1.5</option><option value="2">2.0</option></select>
          </div>
          <div class="edx-fr">
            <button type="button" class="tb sq" data-f="bold" aria-pressed="false" title="Bold (Ctrl+B)" aria-label="Bold"><b>B</b></button>
            <button type="button" class="tb sq" data-f="italic" aria-pressed="false" title="Italic (Ctrl+I)" aria-label="Italic"><i>I</i></button>
            <button type="button" class="tb sq" data-f="underline" aria-pressed="false" title="Underline (Ctrl+U)" aria-label="Underline"><u>U</u></button>
            ${["left", "center", "right", "justify"].map(a => `<button type="button" class="tb sq" data-align="${a}" aria-pressed="${a === "left"}" title="Align ${a === "center" ? "centre" : a}" aria-label="Align ${a === "center" ? "centre" : a}">${ED_ICON["a" + a[0]]}</button>`).join("")}
            <button type="button" class="tb sq" data-f="fill" aria-pressed="false" title="Fill rectangles" aria-label="Fill rectangles">${ED_ICON.shape.replace("<svg", '<svg fill="currentColor" fill-opacity=".35"')}</button>
          </div>
        </div>
        <div class="edx-ctx" data-imgctx hidden role="group" aria-label="Selected image">
          <h3>Selected image</h3>
          <button type="button" class="pb" data-a="irot">${ED_ICON.rotate}<span>Rotate 90°</span></button>
          <button type="button" class="pb" data-a="irep">${ED_ICON.img}<span>Replace image…</span></button>
          <button type="button" class="pb" data-a="idel">${ED_ICON.del}<span>Delete image</span></button>
          <input type="file" data-irepf accept=".png,.jpg,.jpeg,.webp" hidden>
        </div>
        <h3>Scanned pages</h3>
        <label class="edx-lang"><span>Text language</span><select data-lang aria-label="Language of scanned pages">${OCR_LANGS.map(([v, l]) => `<option value="${v}" ${v === lang ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <button type="button" class="pb" data-a="reread">${ED_ICON.rotate}<span>Read this page again</span></button>
        <button type="button" class="pb" data-a="readall">${TICON.ocr}<span>Read all scanned pages</span></button>
        <h3>Page options</h3>
        ${[["organise", "Organise pages"], ["rotate", "Rotate pages"], ["crop", "Crop pages"], ["pagenumbers", "Add page numbers"]].map(([id, l]) => `<button type="button" class="pb" data-goto="${id}">${TICON[id]}<span>${l}</span></button>`).join("")}
        <p class="edx-note" data-note aria-live="polite"></p>
        <p class="edx-honest">Changed text is written in the PDF's own font when it has the letters you typed, otherwise in a similar standard font. Everything you don't touch stays exactly as it was.</p>
      </aside>
      <nav class="edx-rail" role="toolbar" aria-label="Tools" aria-orientation="vertical">
        ${modeBtn("edit", "Edit text and move", "Edit text and move", "v", 1)}
        ${modeBtn("text", "Add text", "Add new text", "t", 1)}
        ${modeBtn("draw", "Draw", "Draw freehand", "d", 1)}
        ${modeBtn("hl", "Highlight", "Highlight", "h", 1)}
        ${modeBtn("shape", "Rectangle", "Rectangle", "r", 1)}
        ${modeBtn("rect", "White-out", "White-out", "w", 1)}
        <span class="rsep"></span>
        <button type="button" class="rb" data-a="undo" title="Undo (Ctrl+Z)" aria-label="Undo" disabled>${ED_ICON.undo}</button>
        <button type="button" class="rb" data-a="redo" title="Redo (Ctrl+Y)" aria-label="Redo" disabled>${ED_ICON.redo}</button>
        <button type="button" class="rb" data-a="del" title="Delete selected (Del)" aria-label="Delete selected">${ED_ICON.del}</button>
      </nav>
      <div class="edx-stage" data-stage tabindex="-1"><div class="edx-pages" data-pages></div></div>
      <nav class="edx-thumbs" data-thumbs aria-label="Pages"></nav>
      <nav class="edx-rail edx-rr" aria-label="Pages and zoom">
        <span class="pgi"><input type="text" inputmode="numeric" data-pgi aria-label="Current page" value="1"><span>/ ${N}</span></span>
        <button type="button" class="rb" data-a="pgup" title="Previous page" aria-label="Previous page">${ICON.up}</button>
        <button type="button" class="rb" data-a="pgdn" title="Next page" aria-label="Next page">${ICON.down}</button>
        <span class="rsep"></span>
        <button type="button" class="rb" data-a="zin" title="Zoom in (Ctrl + +)" aria-label="Zoom in">${ED_ICON.plus}</button>
        <select data-zsel aria-label="Zoom level" title="Zoom level"></select>
        <button type="button" class="rb" data-a="zout" title="Zoom out (Ctrl + −)" aria-label="Zoom out">${ED_ICON.minus}</button>
        <button type="button" class="rb" data-a="fitw" title="Fit width (Ctrl + 0)" aria-label="Fit width">${ED_ICON.fitw}</button>
        <button type="button" class="rb" data-a="fitp" title="Fit whole page" aria-label="Fit whole page">${ED_ICON.fitp}</button>
        <span class="rsep"></span>
        <button type="button" class="rb" data-a="pages" title="Page thumbnails" aria-label="Page thumbnails" aria-expanded="false">${ED_ICON.pages}</button>
        <button type="button" class="rb" data-a="keys" title="Keyboard shortcuts" aria-label="Keyboard shortcuts">${S('<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h1M11 10h1M15 10h2M7 14h10"/>')}</button>
      </nav>
    </div>
    <p class="edx-toast" data-toast role="status" hidden></p>
    <dialog class="edx-dlg" data-dlg aria-labelledby="edx-dh"><div class="d-h"><h2 id="edx-dh" data-dh></h2></div><div class="d-b" data-db></div><div class="d-f" data-df></div></dialog>`;
  root.style.visibility = "hidden"; document.body.appendChild(root);
  /* Only take over the screen once the editor's stylesheet is really there */
  for (let i = 0; i < 40 && getComputedStyle(root).getPropertyValue("--edx-css").trim() !== "1"; i++) await new Promise(r => setTimeout(r, 100));
  if (getComputedStyle(root).getPropertyValue("--edx-css").trim() !== "1") { root.remove(); try { pdf.destroy(); } catch (e) { /* closed */ } throw new Error("The editor's design file didn't load. Reload the page (Ctrl+F5) and try again."); }
  root.style.visibility = ""; document.body.classList.add("edx-open");
  const $e = s => root.querySelector(s), $$e = s => [...root.querySelectorAll(s)];
  const stage = $e("[data-stage]"), pagesEl = $e("[data-pages]"), thumbsEl = $e("[data-thumbs]");
  let pushed = false; try { history.pushState({dbxEditor: 1}, ""); pushed = true; } catch (e) { pushed = false; }

  /* ---------- state ---------- */
  const pages = []; let s = 1, mode = "edit", sel = null, cur = 1, uid = 0, closed = false, dirty = false;
  const items = []; const imgReg = {}; let pendingImg = null;
  const def = {fam: "sans", size: 12, color: "#111111", bold: false, italic: false, underline: false, align: "left", fill: false};
  let hist = [], hpos = -1, commitT = 0;
  for (let i = 1; i <= N; i++) {
    const page = await pdf.getPage(i); const vp = page.getViewport({scale: 1});
    const el = document.createElement("div"); el.className = "edx-pg"; el.dataset.n = i;
    el.innerHTML = `<canvas aria-hidden="true"></canvas><div class="edx-ly"><div class="cv-l"></div><div class="im-l"></div><div class="bk-l"></div></div><span class="edx-pgn">${i}</span>`;
    pagesEl.appendChild(el);
    const pg = {n: i, W: vp.width, H: vp.height, vt: vp.transform, el, canvas: el.querySelector("canvas"), ly: el.querySelector(".edx-ly"),
      cvL: el.querySelector(".cv-l"), imL: el.querySelector(".im-l"), bkL: el.querySelector(".bk-l"), ps: 0, visible: false, rec: null, blocks: [], images: [], rules: [], state: "new"};
    pg.V = {layer: pg.ly, cur: i, W: pg.W, H: pg.H, get cssW() { return pg.W * s; }};
    pages.push(pg); page.cleanup();
  }
  const pgOf = n => pages[n - 1];
  root.__pages = pages; /* for automated checks */
  const maxW = Math.max(...pages.map(p => p.W));

  /* ---------- zoom & layout ---------- */
  const zsel = $e("[data-zsel]");
  const fitW = () => clamp((stage.clientWidth - (innerWidth < 700 ? 16 : 48)) / maxW, .15, 8);
  const fitP = () => { const p = pgOf(cur); return clamp(Math.min(fitW(), (stage.clientHeight - 32) / p.H), .15, 8); };
  function zoomLabel() {
    const pct = Math.round(s / PX_PER_PT * 100);
    zsel.innerHTML = `<option value="cur" selected>${pct}%</option><option value="fitw">Fit width</option><option value="fitp">Fit page</option>` + [50, 75, 100, 125, 150, 200, 300].map(v => `<option value="${v}">${v}%</option>`).join("");
  }
  function setScale(ns, anchor) {
    ns = clamp(ns, .15, 8); if (Math.abs(ns - s) < 1e-4 && pages[0].el.style.width) return;
    const r = stage.getBoundingClientRect(); const cx = anchor ? anchor.x : r.left + r.width / 2, cy = anchor ? anchor.y : r.top + Math.min(r.height / 2, 200);
    const px = stage.scrollLeft + cx - r.left, py = stage.scrollTop + cy - r.top;
    let ap = pages[0]; for (const p of pages) { if (p.el.offsetTop <= py) ap = p; else break; }
    const ptx = (px - ap.el.offsetLeft) / s, pty = (py - ap.el.offsetTop) / s;
    s = ns; layoutAll();
    stage.scrollLeft = ap.el.offsetLeft + ptx * s - (cx - r.left); stage.scrollTop = ap.el.offsetTop + pty * s - (cy - r.top);
    zoomLabel(); scheduleRender();
  }
  function applyZoomPref(anchor) {
    const z = zoomPref; const v = z === "fitw" ? fitW() : z === "fitp" ? fitP() : (+z || 100) / 100 * PX_PER_PT; setScale(v, anchor);
  }
  const rememberZoom = z => { zoomPref = z; try { localStorage.setItem(ZOOM_KEY, String(z)); } catch (e) { /* storage blocked */ } };
  function zoomBy(f, anchor) { rememberZoom(String(Math.round(clamp(s * f, .15, 8) / PX_PER_PT * 100))); setScale(s * f, anchor); }
  zsel.addEventListener("change", () => { const v = zsel.value; if (v === "cur") return; rememberZoom(v); applyZoomPref(); stage.focus({preventScroll: true}); });
  function layoutAll() {
    for (const p of pages) {
      p.el.style.width = p.W * s + "px"; p.el.style.height = p.H * s + "px";
      p.canvas.style.width = p.W * s + "px"; p.canvas.style.height = p.H * s + "px";
      if (p.state === "ready") { for (const b of p.blocks) placeBlock(b); placeImages(p); }
      if (p.L) p.L.draw();
    }
    placeHandles();
  }

  /* ---------- crisp page rendering (only pages near the screen) ---------- */
  let rTimer = 0, rendering = false;
  const io = new IntersectionObserver(es => { for (const e of es) { const p = pgOf(+e.target.dataset.n); p.visible = e.isIntersecting; } scheduleRender(); }, {root: stage, rootMargin: "600px 0px"});
  pages.forEach(p => io.observe(p.el));
  const want = p => Math.min(s * Math.min(3, window.devicePixelRatio || 1), Math.sqrt(16e6 / (p.W * p.H)));
  function scheduleRender() { clearTimeout(rTimer); rTimer = setTimeout(renderNext, 140); }
  async function renderNext() {
    if (rendering || closed) return;
    for (const p of pages) if (!p.visible && p.ps && Math.abs(p.n - cur) > 3) { p.canvas.width = p.canvas.height = 0; p.ps = 0; }
    const todo = pages.filter(p => p.visible && Math.abs(p.ps - want(p)) > want(p) * .02).sort((a, b) => Math.abs(a.n - cur) - Math.abs(b.n - cur));
    if (!todo.length) return;
    rendering = true; const p = todo[0];
    try {
      const ps = want(p); const page = await pdf.getPage(p.n); const vp = page.getViewport({scale: ps});
      const c = document.createElement("canvas"); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
      await page.render({canvasContext: g, viewport: vp, intent: "print"}).promise;
      if (!closed) { p.canvas.width = c.width; p.canvas.height = c.height; p.canvas.getContext("2d").drawImage(c, 0, 0); p.ps = ps; }
      c.width = c.height = 0; loadFonts(p, page); page.cleanup();
    } catch (e) { console.error(e); p.ps = want(p); }
    rendering = false; if (!closed) renderNext();
  }
  /* The PDF's own fonts, as web fonts, so edits look exactly like the original */
  function loadFonts(p, page) {
    if (!p.blocks.length) return;
    for (const b of p.blocks) {
      if (!b.pfn || b.ff !== undefined) continue;
      b.ff = null;
      ffLoadPageFont(page, b.pfn, docKey).then(f => { if (f && !closed) { b.ff = f; if (b.el) { placeBlock(b); if (sel && sel.b === b) updateNotes(); } } });
    }
  }
  /* Background/text colour around a box, from the rendered page pixels. */
  function sampleBlock(b) {
    const p = pgOf(b.page); if (!p.ps || !p.canvas.width) return;
    const k = p.ps, pad = 4; const x0 = Math.max(0, Math.floor((b.x - pad) * k)), y0 = Math.max(0, Math.floor((b.top - pad) * k));
    const w = Math.min(p.canvas.width - x0, Math.ceil((b.wOrig + 2 * pad) * k)), h = Math.min(p.canvas.height - y0, Math.ceil((b.bottom - b.top + 2 * pad) * k));
    if (w < 2 || h < 2) return;
    try {
      const img = p.canvas.getContext("2d").getImageData(x0, y0, w, h);
      const r = sampleColors(img, pad * k, pad * k, Math.max(1, w - 2 * pad * k), Math.max(1, h - 2 * pad * k));
      if (!b.bgFixed) b.bg = r.bg; if (!b.color) b.fg = r.fg; b.sampled = true;
    } catch (e) { /* canvas not readable */ }
  }

  /* ---------- thumbnails ---------- */
  thumbsEl.innerHTML = pages.map(p => `<button type="button" data-p="${p.n}" aria-label="Page ${p.n}"><span class="ph" style="aspect-ratio:${p.W}/${p.H}"></span><span>${p.n}</span></button>`).join("");
  const tio = new IntersectionObserver(es => {
    for (const e of es) if (e.isIntersecting) {
      const btn = e.target; tio.unobserve(btn); const n = +btn.dataset.p;
      (async () => { try { const page = await pdf.getPage(n); const vp = page.getViewport({scale: 1}); const c = await renderPage(page, 160 / vp.width); page.cleanup(); const ph = btn.querySelector(".ph"); if (ph && !closed) ph.replaceWith(c); } catch (err) { /* skip */ } })();
    }
  }, {root: thumbsEl, rootMargin: "300px"});
  $$e("[data-p]").forEach(b => tio.observe(b));
  thumbsEl.addEventListener("click", e => { const b = e.target.closest("[data-p]"); if (!b) return; goPage(+b.dataset.p); if (innerWidth < 760) togglePages(false); });
  function goPage(n) { const p = pgOf(n); stage.scrollTo({top: p.el.offsetTop - 12, behavior: "auto"}); setCur(n); }
  function setCur(n) {
    if (n === cur && thumbsEl.querySelector('[aria-current="true"]')) return; cur = n;
    const pgi = $e("[data-pgi]"); if (document.activeElement !== pgi) pgi.value = n;
    $$e("[data-p]").forEach(b => { const on = +b.dataset.p === n; b.setAttribute("aria-current", String(on)); if (on) b.scrollIntoView({block: "nearest"}); });
    bumpQueue();
  }
  stage.addEventListener("scroll", () => {
    const mid = stage.scrollTop + stage.clientHeight / 2; let best = cur, bd = Infinity;
    for (const p of pages) { const d = Math.abs(p.el.offsetTop + p.el.offsetHeight / 2 - mid); if (d < bd) { bd = d; best = p.n; } }
    setCur(best);
  }, {passive: true});
  function togglePages(v) { const on = v == null ? !root.classList.contains("pages-open") : v; root.classList.toggle("pages-open", on); $e("[data-a=pages]").setAttribute("aria-expanded", String(on)); }

  /* ---------- reading text: real text first, OCR automatically for scans ---------- */
  let ocrQ = [], textQ = pages.map(p => p.n), looping = false, runTok = 0, ocrBroken = "", ocrTotal = 0, ocrDone = 0;
  const pill = $e("[data-pill]");
  function pillUI(t) { if (t == null) { pill.hidden = true; return; } pill.hidden = false; $e("[data-pill-t]").textContent = t; }
  function bumpQueue() {
    textQ.sort((a, b) => Math.abs(a - cur) - Math.abs(b - cur)); ocrQ.sort((a, b) => Math.abs(a - cur) - Math.abs(b - cur));
    pump();
  }
  function fontInfoFor(page, tc) {
    return name => {
      let real = "", bold = false;
      try { if (page.commonObjs.has(name)) { const f = page.commonObjs.get(name); real = f.name || ""; bold = !!(f.bold || f.black); } } catch (e) { /* not loaded */ }
      const fi = fontFromName(real, (tc.styles[name] || {}).fontFamily); if (bold) fi.bold = true; return fi;
    };
  }
  async function readText(p) {
    const page = await pdf.getPage(p.n);
    try {
      const tc = await page.getTextContent();
      if (countChars(tc.items) < 8) return null;
      p.fontNames = Object.keys(tc.styles || {});
      let csp = null; if (pl) { try { csp = csReadPage(pl, p.n - 1, p.vt); } catch (e) { console.warn("content parse", e); csp = null; } }
      let lines = runsToLines(itemsToRuns(tc.items, p.vt, fontInfoFor(page, tc)), csp ? csp.rules : []);
      if (csp) lines = splitLinesByShows(lines, csp.shows, csp.rules);
      for (const ln of lines) { ln.text = unspace(ln.text); if (/[\u0900-\u097F]/.test(ln.text)) { ln.rawText = ln.text; ln.text = indicRepair(ln.text); ln.indic = true; } }
      if (csp) for (const ln of lines) {
        const sh = csShowsForLine(csp.shows, ln);
        if (sh.length) {
          ln.color = sh[0].color; ln.showN = sh.length;
          const f = sh[0].font;
          if (f && f.baseFont && !ln.font.sure) { const g = fontFromName(f.baseFont, ""); if (g.sure) ln.font = {...ln.font, fam: g.fam, sure: true}; }
          if (f && f.baseFont) { const g = fontFromName(f.baseFont, ""); if (g.bold) ln.font = {...ln.font, bold: true}; if (g.italic) ln.font = {...ln.font, italic: true}; ln.fontName = f.baseFont.replace(/^[A-Z]{6}\+/, ""); }
        }
      }
      const blocks = buildBlocks(lines, csp ? csp.rules : [], p.W, p.H);
      const images = csp ? csp.images.filter(im => !im.inForm && im.vw > 8 && im.vh > 8) : [];
      return {source: "text", blocks, images, rules: csp ? csp.rules : []};
    } finally { page.cleanup(); }
  }
  async function readOcr(p, tok) {
    const page = await pdf.getPage(p.n);
    try {
      /* read scans at the resolution of the scan itself (no resampling), when the page is one big image */
      let dpi = fromImages ? 300 : 250;
      try { if (pl) { const cs2 = csReadPage(pl, p.n - 1, p.vt); const big = cs2.images.filter(im => im.pw && im.vw > p.W * .85 && im.vh > p.H * .85).sort((a, b2) => b2.vw - a.vw)[0]; if (big) dpi = clamp(big.pw / (big.vw / 72), 150, 400); } } catch (e) { /* keep the default */ }
      const c = await renderPage(page, dpi / 72); const sc = c.width / p.W;
      try {
        /* find table borders first and hide them on a copy for the text reader: OCR often skips text inside ruled tables */
        const img = c.getContext("2d").getImageData(0, 0, c.width, c.height); const G = scanGray(img); const R = scanRules(G);
        const clean = document.createElement("canvas"); clean.width = c.width; clean.height = c.height; const cg = clean.getContext("2d"); cg.drawImage(c, 0, 0);
        cg.fillStyle = "rgb(" + G.paper + "," + G.paper + "," + G.paper + ")"; const t = Math.max(2, Math.round(sc * .6));
        for (const r of R.v) cg.fillRect(r.x - t, r.y0 - 1, 2 * t + 1, r.y1 - r.y0 + 3);
        for (const r of R.h) cg.fillRect(r.x0 - 1, r.y - t, r.x1 - r.x0 + 3, 2 * t + 1);
        const data = await ocrCanvas(clean, lang, m => {
          if (tok !== runTok) return;
          if (m.status === "recognizing text") pillUI("Reading page " + p.n + " of " + N + "… " + Math.round(m.progress * 100) + "%");
          else if (/load|initiali/i.test(m.status)) pillUI("Getting the text reader ready…");
        });
        clean.width = clean.height = 0;
        /* borders in the image split lines into cells; letter heights give the real size; widths give family and scaling */
        const rules = scanRulesToPt(R, sc);
        if (!scanMetricsReady) { scanMetricsReady = true; scanUseFontMetrics((fam, ch) => { const g = mctx(); g.font = "400 200px " + fontStack(fam); return g.measureText(ch).actualBoundingBoxAscent / 200; }); }
        const lines = scanLines(ocrDataLines(data), sc, img, G, rules, (f, b, t, z) => measureCss(f, b, false, z, t));
        for (const l of lines) l.bg = scanPaper(img, G, {x0: l.x * sc, y0: l.top * sc, x1: (l.x + l.w) * sc, y1: l.bottom * sc});
        const blocks = buildBlocks(lines, rules, p.W, p.H);
        const symbols = [];
        ocrDataLines(data).forEach((L, li) => (L.words || []).forEach((w, wi) => (w.symbols || []).forEach(s => { if (s.bbox) symbols.push({text: s.text, bbox: s.bbox, confidence: s.confidence, lineId: li, wordId: li + ":" + wi, baseline: L.baseline}); })));
        p.ocr = {img, sc, symbols, data, lib: null};
        for (const b of blocks) {
          b.scanWords = b.lines.flatMap(l => l.words.map(w => ({...w.src, baseline: w.lineBaseline})));
          b.bg = b.lines[0].bg; b.hscale = scanMedian(b.lines.map(l => l.hscale || 1)); b.coverPad = 1.2 / sc; b.sampled = true;
          b.size = scanMedian(b.lines.map(l => l.size));
        }
        return {source: "ocr", blocks, images: [], rules};
      } catch (err) { p.ocr = null; throw err;
      } finally { c.width = c.height = 0; }
    } finally { page.cleanup(); }
  }
  /* Hindi text layers often lose vowel signs (the font's character map is wrong). Read those lines again with OCR
     and use the OCR words when they're confident and close to what the text layer says. Positions stay from the text layer. */
  const indicQ = []; let indicBusy = false;
  async function indicVerify() {
    if (indicBusy || closed || !indicQ.length || ocrBroken) return; indicBusy = true;
    while (indicQ.length && !closed) {
      const n = indicQ.shift(); const p = pgOf(n); if (!p.rec || p.rec.source !== "text") continue;
      try {
        pillUI("Checking the Hindi text on page " + n + "…");
        const page = await pdf.getPage(n); const c = await renderPage(page, 300 / 72); page.cleanup(); const sc = c.width / p.W;
        const data = await ocrCanvas(c, "hin+eng"); c.width = c.height = 0;
        const words = ocrDataLines(data).flatMap(L => (L.words || []).filter(w => w.bbox && String(w.text || "").trim()).map(w => ({t: String(w.text).trim(), conf: w.confidence, x0: w.bbox.x0 / sc, y0: w.bbox.y0 / sc, x1: w.bbox.x1 / sc, y1: w.bbox.y1 / sc})));
        for (const b of p.blocks) {
          if (changed(b)) continue; let touched = false;
          for (const ln of b.lines) {
            if (!ln.indic) continue;
            const mine = words.filter(w => { const cy = (w.y0 + w.y1) / 2; return cy > ln.top && cy < ln.bottom + ln.size * .3 && w.x1 > ln.x - 2 && w.x0 < ln.x + ln.w + 2; }).sort((a, b2) => a.x0 - b2.x0);
            if (!mine.length) continue;
            const ocrText = mine.map(w => w.t).join(" "), conf = mine.reduce((a, w) => a + w.conf, 0) / mine.length;
            /* the text layer is trusted for everything that isn't Devanagari: OCR must agree on those letters and digits */
            const latin = t => t.replace(/[\u0900-\u097F\s]/g, "");
            if (ocrText !== ln.text && conf >= 70 && latin(ocrText) === latin(ln.text) && textSim(ocrText, ln.text) >= .6 && textSim(ocrText, ln.text) < 1) { b.origText = b.origText.replace(ln.text, ocrText); ln.text = ocrText; ln.ocrChecked = true; touched = true; }
          }
          if (touched && !changed({...b, text: b.origText})) { b.text = b.origText; if (b.el && document.activeElement !== b.el) b.el.textContent = b.text; }
        }
      } catch (err) { console.warn("Hindi check", err); if (err && err.ocrStart) { ocrBroken = err.message; break; } }
    }
    indicBusy = false; if (!looping) pillUI(null);
  }
  function pump() {
    if (looping || closed) return; looping = true; const tok = runTok;
    (async () => {
      while (!closed && tok === runTok && (textQ.length || ocrQ.length)) {
        const isText = textQ.length > 0; const n = isText ? textQ.shift() : ocrQ.shift(); const p = pgOf(n);
        if (isText && p.state !== "new") continue;
        try {
          if (isText) {
            const r = await readText(p);
            if (tok !== runTok) { textQ.unshift(n); break; }
            if (r) { setRec(p, r); } else { p.state = "scan"; if (!ocrBroken) { ocrQ.push(n); ocrTotal++; } }
          } else {
            ocrDone++; pillUI("Reading page " + n + " of " + N + "…");
            const r = await readOcr(p, tok);
            if (tok !== runTok) break;
            setRec(p, r);
          }
        } catch (e) {
          if (tok !== runTok) break;
          if (e.ocrStart) { ocrBroken = e.message; ocrQ = []; toast(e.message, 9000); }
          else { console.error(e); if (!isText) p.state = "error"; else { p.state = "scan"; } }
        }
        if (!ocrQ.length) { pillUI(null); ocrTotal = ocrDone = 0; }
      }
      if (tok === runTok) { looping = false; pillUI(null); indicVerify(); }
    })();
  }
  function setRec(p, r) {
    p.rec = r; p.state = "ready"; p.rules = r.rules || [];
    p.blocks = r.blocks.map((b, i) => prepBlock(b, p, i, r.source === "ocr"));
    p.images = (r.images || []).map((im, i) => ({...im, id: "im" + p.n + "_" + i, page: p.n, x: im.vx, y: im.vy, w: im.vw, h: im.vh, q: 0, del: false, repl: null}));
    buildPageDom(p);
    if (p.ps && r.source === "text") pdf.getPage(p.n).then(pg => loadFonts(p, pg)).catch(() => {});
    if (r.source === "text" && p.blocks.some(b => b.lines.some(l => l.indic))) indicQ.push(p.n);
  }
  $e("[data-lang]").addEventListener("change", e => {
    const ocrPages = pages.filter(p => p.rec && p.rec.source === "ocr");
    if (ocrPages.some(p => p.blocks.some(changed)) && !confirm("Reading scanned pages again in the new language will undo your text changes on them. Continue?")) { e.target.value = lang; return; }
    lang = e.target.value; try { localStorage.setItem(LANG_KEY, lang); } catch (err) { /* storage blocked */ }
    ocrBroken = "";
    for (const p of pages) if (p.state === "scan" || p.state === "error" || (p.rec && p.rec.source === "ocr")) { clearPage(p); p.state = "scan"; if (!ocrQ.includes(p.n)) ocrQ.push(p.n); }
    runTok++; looping = false; ocrStop(); bumpQueue(); commit();
  });
  function clearPage(p) { p.rec = null; p.blocks = []; p.images = []; p.cvL.innerHTML = p.imL.innerHTML = p.bkL.innerHTML = ""; if (sel && sel.page === p.n) select(null); }

  /* ---------- text blocks ---------- */
  function prepBlock(b, p, i, ocr) {
    b.id = "b" + p.n + "_" + i; b.page = p.n; b.ocr = ocr; b.text = b.origText; b.dx = 0; b.dy = 0; b.push = 0;
    if (b.ox == null) b.ox = b.x;
    b.wOrig = Math.max(...b.lines.map(l => l.x + l.w)) - b.ox;
    b.pfn = ocr ? null : ((b.lines.find(l => l.pfn) || {}).pfn || null);
    const fam0 = b.font.fam, bold = b.font.bold, it = b.font.italic;
    const longest = b.lines.reduce((a, l) => l.w > a.w ? l : a, b.lines[0]);
    b.cssFam = b.font.sure ? fam0 : pickFamily([longest.text], longest.w, b.size, (f, t) => measureCss(f, bold, it, 1, t), fam0);
    const cw = measureCss(b.cssFam, bold, it, b.size, longest.text);
    b.r = b.hscale || (b.font.sure ? 1 : cw > 0 ? clamp(longest.w / cw, .75, 1.33) : 1);
    b.lsOrig = b.lines.length > 1 ? b.gap / b.size : 1.2;
    if (b.color) b.fg = b.color.map(v => v * 255);
    return b;
  }
  const changed = b => !!b.isNew || b.text !== b.origText || b.size2 != null || b.color2 != null || b.fam2 != null || b.bold2 != null || b.italic2 != null || !!b.underline || b.align2 != null || b.ls2 != null || !!b.dx || !!b.dy || !!b.push || b.wrap2 != null || b.h2 != null || b.fitSize != null || hasCs(b);
  const famOf = b => b.fam2 && b.fam2 !== "orig" ? b.fam2 : b.cssFam || b.font.fam;
  const boldOf = b => b.bold2 != null ? b.bold2 : !!b.font.bold, italOf = b => b.italic2 != null ? b.italic2 : !!b.font.italic;
  const baseSize = b => b.size2 || b.size, sizeOf = b => b.fitSize || baseSize(b);
  const gapOf = b => (b.ls2 || b.lsOrig) * sizeOf(b);
  const wrapOf = b => b.wrap2 || b.wrapW;
  const alignOf = b => b.align2 || b.align0 || b.align || "left";
  /* the embedded font is used while the family/style are unchanged and the text has no Indian-script letters */
  const ffOf = b => b.ff && !b.isNew && (!b.fam2 || b.fam2 === "orig") && boldOf(b) === !!b.font.bold && italOf(b) === !!b.font.italic && !hasNonLatin(b.text) ? b.ff : null;
  const familyCss = b => { const f = ffOf(b); return (f ? '"' + f.family + '", ' : "") + fontStack(famOf(b)); };
  const cssFontOf = (b, px) => (italOf(b) ? "italic " : "") + (boldOf(b) ? 700 : 400) + " " + px + "px " + familyCss(b);
  const ratioOf = b => ffOf(b) || (b.fam2 && b.fam2 !== "orig") || b.isNew ? 1 : b.r;
  const colourOf = b => b.color2 || rgbHex(b.fg || [17, 17, 17]);
  const dyOf = b => b.dy + (b.push || 0);
  const topPx = b => (b.base0 + dyOf(b)) * s - ffBaseline(cssFontOf(b, sizeOf(b) * s), sizeOf(b) * s, gapOf(b) * s);
  const topOf = b => topPx(b) / s;
  /* the original glyph area, kept inside the table cell so table lines are never painted over */
  function coverRect(b) {
    const pad = b.coverPad != null ? b.coverPad : Math.max(.8, b.size * .1); let x0 = b.ox - pad, y0 = b.top - pad, x1 = b.ox + b.wOrig + pad, y1 = b.bottom + pad;
    if (b.cell && b.cont) { x0 = Math.max(x0, b.cont.l + .8); y0 = Math.max(y0, b.cont.t + .8); x1 = Math.min(x1, b.cont.r - .8); y1 = Math.min(y1, b.cont.b - .8); }
    return {x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0)};
  }
  const cellBelow = b => !b.cell || !b.cont ? [] : pgOf(b.page).blocks.filter(o => o !== b && o.cell && o.cont && !o.isNew && Math.abs(o.cont.l - b.cont.l) < .5 && Math.abs(o.cont.t - b.cont.t) < .5 && o.top >= b.bottom - .5);
  /* text that grows in a table cell pushes the lines below it down, inside the cell */
  function reflowBelow(b) {
    const below = cellBelow(b); if (!below.length || !b.el) return;
    /* growth compared with the box's own height before editing; tiny differences never move other text */
    if (b.h0 == null) b.h0 = b.el.scrollHeight / s;
    const grow = b.el.scrollHeight / s - b.h0; const extra = changed(b) && grow > .5 ? grow : 0;
    for (const o of below) if (Math.abs((o.push || 0) - extra) > .05) { o.push = extra; placeBlock(o); }
  }
  function buildPageDom(p) {
    p.cvL.innerHTML = ""; p.bkL.innerHTML = ""; p.imL.innerHTML = "";
    for (const b of p.blocks) makeBlockEl(b, p);
    for (const im of p.images) makeImgEl(im, p);
    if (!p.L) p.L = itemLayer(p.V, items, itemHooks(p));
    p.L.draw();
    if (sel && sel.kind === "bk" && sel.b.page === p.n) placeHandles();
  }
  /* ---------- character formatting (runs) ----------
     b.cs[i] holds the style overrides of character i of b.text ({bold, italic, underline, color, size}); null = block style. */
  const hasCs = b => !!(b.cs && b.cs.some(Boolean));
  const csKey = st => st ? JSON.stringify(st) : "";
  function runsOf(b) { /* [{text, st, start}] */
    const out = []; const t = b.text; for (let i = 0; i < t.length; i++) { const st = b.cs && b.cs[i] || null; const l = out[out.length - 1]; if (l && csKey(l.st) === csKey(st)) l.text += t[i]; else out.push({text: t[i], st, start: i}); }
    return out;
  }
  function spanCss(b, st) {
    if (!st) return "";
    const k = s; const css = [];
    const bold = st.bold != null ? st.bold : boldOf(b), ital = st.italic != null ? st.italic : italOf(b);
    if (st.bold != null) css.push("font-weight:" + (bold ? 700 : 400));
    if (st.italic != null) css.push("font-style:" + (ital ? "italic" : "normal"));
    const vf = (st.bold != null || st.italic != null) && b.ffv && b.ffv[(bold ? "b" : "") + (ital ? "i" : "")];
    if (vf) css.push('font-family:"' + vf.family + '",' + fontStack(famOf(b)));
    else if ((st.bold != null && bold !== !!b.font.bold) || (st.italic != null && ital !== !!b.font.italic)) css.push("font-family:" + fontStack(famOf(b)));
    if (st.underline) css.push("text-decoration:underline");
    if (st.color) css.push("color:" + st.color);
    if (st.size) css.push("font-size:" + st.size * k + "px");
    return css.join(";");
  }
  function renderRuns(b) {
    const el = b.el; if (!el) return;
    if (!hasCs(b)) { if (el.children.length) el.textContent = b.text; return; }
    const selNow = document.activeElement === el ? caretOffsets(el) : null;
    el.innerHTML = runsOf(b).map(r => r.st ? '<span style="' + esc(spanCss(b, r.st)) + '">' + esc(r.text) + "</span>" : esc(r.text)).join("");
    if (selNow) setCaretOffsets(el, selNow[0], selNow[1]);
  }
  function caretOffsets(el) {
    const sl = getSelection(); if (!sl.rangeCount) return null; const r = sl.getRangeAt(0); if (!el.contains(r.startContainer)) return null;
    const pre = document.createRange(); pre.selectNodeContents(el); pre.setEnd(r.startContainer, r.startOffset); const s0 = pre.toString().length;
    return [s0, s0 + r.toString().length];
  }
  function setCaretOffsets(el, a, z) {
    const find = off => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n, acc = 0; while ((n = w.nextNode())) { if (acc + n.length >= off) return [n, off - acc]; acc += n.length; } return [el, el.childNodes.length]; };
    try { const r = document.createRange(); const [n1, o1] = find(a), [n2, o2] = find(z); r.setStart(n1, o1); r.setEnd(n2, o2); const sl = getSelection(); sl.removeAllRanges(); sl.addRange(r); } catch (err) { /* ignore */ }
  }
  /* keep b.cs aligned with the text after typing: new characters take the style of the one before them */
  function syncCs(b, oldText) {
    if (!b.cs) return; const t = b.text; let p = 0; while (p < oldText.length && p < t.length && oldText[p] === t[p]) p++;
    let q = 0; while (q < oldText.length - p && q < t.length - p && oldText[oldText.length - 1 - q] === t[t.length - 1 - q]) q++;
    const ins = t.length - p - q; const inherit = p > 0 ? b.cs[p - 1] : (b.cs[p] || null);
    b.cs = b.cs.slice(0, p).concat(Array.from({length: ins}, () => inherit), b.cs.slice(oldText.length - q));
    if (!b.cs.some(Boolean)) b.cs = null;
  }
  function styleRange(b, a, z, k, v) {
    if (!b.cs) b.cs = Array.from({length: b.text.length}, () => null);
    for (let i = a; i < z; i++) { const st = {...(b.cs[i] || {})}; if (v == null || v === false && k === "underline") delete st[k]; else st[k] = v; b.cs[i] = Object.keys(st).length ? st : null; }
    if (!b.cs.some(Boolean)) b.cs = null;
  }
  /* the variant faces of the PDF's own font (Bold, Italic) for the preview */
  async function loadVariants(b) {
    const p = pgOf(b.page); if (!b.pfn || !p.fontNames || b.ffvLoading) return; b.ffvLoading = true; b.ffv = b.ffv || {};
    try {
      const page = await pdf.getPage(p.n); const realName = n => { try { return page.commonObjs.has(n) ? String(page.commonObjs.get(n).name || "") : ""; } catch (e) { return ""; } };
      const fam = realName(b.pfn).replace(/^[A-Z]{6}\+/, "").split(/[-,_]/)[0]; if (!fam) return;
      for (const n of p.fontNames) {
        if (n === b.pfn) continue; const nm = realName(n).replace(/^[A-Z]{6}\+/, ""); if (!nm.toLowerCase().startsWith(fam.toLowerCase())) continue;
        const fi = fontFromName(nm, ""); const key = (fi.bold ? "b" : "") + (fi.italic ? "i" : ""); if (b.ffv[key]) continue;
        const f = await ffLoadPageFont(page, n, docKey); if (f) b.ffv[key] = f;
      }
      renderRuns(b);
    } catch (e) { /* preview falls back to synthetic styles */ }
  }
  function makeBlockEl(b, p) {
    const cv = document.createElement("div"); cv.className = "bk-cv"; p.cvL.appendChild(cv); b.cv = cv;
    const el = document.createElement("div"); el.className = "bk"; el.contentEditable = PT_OK ? "plaintext-only" : "true"; el.spellcheck = false;
    el.setAttribute("role", "textbox"); el.setAttribute("aria-label", b.isNew ? "New text" : "Text: " + b.origText.slice(0, 60));
    if (wrapOf(b) && b.lines && b.lines.length > 1) el.setAttribute("aria-multiline", "true");
    el.dataset.ph = "Type here"; el.textContent = b.text; b.el = el; p.bkL.appendChild(el); if (hasCs(b)) renderRuns(b);
    if (b.ocr && !changed(b)) for (const w of b.words || []) if (w.conf < 60) {
      const u = document.createElement("span"); u.className = "lowc"; u.title = "We're not sure about this word"; u.dataset.b = b.id;
      u._w = w; p.cvL.appendChild(u);
    }
    wireBlock(el, b); placeBlock(b); if (b.h0 == null && el.isConnected) b.h0 = el.scrollHeight / s;
  }
  function placeBlock(b) {
    const el = b.el; if (!el) return;
    const p = pgOf(b.page); const sz = sizeOf(b), gap = gapOf(b), r = ratioOf(b), ff = ffOf(b);
    const ws = ff && ff.space != null ? (ff.space - measureCss(famOf(b), boldOf(b), italOf(b), 1, " ")) * sz * s : 0;
    Object.assign(el.style, {left: (b.x + b.dx) * s + "px", top: topPx(b) + "px", width: wrapOf(b) * s / r + "px", transform: r !== 1 ? "scaleX(" + r + ")" : "",
      fontSize: sz * s + "px", lineHeight: gap * s + "px", minHeight: (b.h2 ? b.h2 : Math.max(1, b.lines && b.lines.length ? b.lines.length : 1) * gap) * s + "px",
      fontFamily: familyCss(b), fontWeight: boldOf(b) ? "700" : "400", fontStyle: italOf(b) ? "italic" : "normal", wordSpacing: ws ? ws + "px" : "normal",
      textDecoration: b.underline ? "underline" : "none", textAlign: alignOf(b)});
    el.style.setProperty("--fg", colourOf(b)); el.style.setProperty("--bg", rgbCss(b.bg || [255, 255, 255]));
    const on = changed(b); el.classList.toggle("on", on); el.classList.toggle("new", !!b.isNew);
    if (b.cv) {
      const cr = coverRect(b);
      Object.assign(b.cv.style, {left: cr.x * s + "px", top: cr.y * s + "px", width: cr.w * s + "px", height: cr.h * s + "px", background: rgbCss(b.bg || [255, 255, 255])});
      b.cv.classList.toggle("show", !b.isNew && (on || document.activeElement === el));
    }
    $$(`.lowc[data-b="${b.id}"]`, p.cvL).forEach(u => { if (on) { u.remove(); return; } const w = u._w; Object.assign(u.style, {left: w.x0 * s + "px", top: w.y1 * s + "px", width: (w.x1 - w.x0) * s + "px"}); });
    checkFit(b); reflowBelow(b);
    if ((b.smEl && b.smEl.length) || (b.sm && b.el)) drawSm(b);
  }
  /* ---------- glyph-cloning engine for scans (pdf/scanmatch.js, optional) ---------- */
  const SM = () => window.ScanMatch && typeof window.ScanMatch.replaceSegment === "function" ? window.ScanMatch : null;
  function smLib(p) {
    if (!p.ocr || !SM()) return null;
    if (p.ocr.lib == null) {
      try {
        const syms = typeof SM().symbolsFromTesseract === "function" ? SM().symbolsFromTesseract(p.ocr.data) : p.ocr.symbols.map(s => ({ch: s.text, x0: s.bbox.x0, y0: s.bbox.y0, x1: s.bbox.x1, y1: s.bbox.y1, conf: s.confidence, wordId: s.wordId, lineId: s.lineId}));
        p.ocr.smSymbols = syms; p.ocr.lib = SM().buildLibrary(p.ocr.img, syms) || false;
      } catch (err) { console.warn("ScanMatch library", err); p.ocr.lib = false; }
    }
    return p.ocr.lib || null;
  }
  /* One call per changed LINE (the engine works on single lines). All-or-nothing per block: if any line can't be
     cloned, or wrapping changed the number of lines, the block falls back to the font-matching path. */
  async function smRun(b) {
    const p = pgOf(b.page); const lib = smLib(p); b.sm = null;
    if (!lib || !b.ocr || b.isNew || !b.lines || !b.lines.length || !b.lines[0].words) return null;
    const styled = hasCs(b) || b.size2 != null || b.fam2 != null || b.bold2 != null || b.italic2 != null || b.underline || b.color2 != null || b.fitSize != null || b.ls2 != null || b.dx || dyOf(b);
    if (styled) return null;
    const text = b.text; const lines = b.out && b.out.length && b.out.join("\n").replace(/\s+/g, " ").trim() === text.replace(/\s+/g, " ").trim() ? b.out : text.split("\n");
    if (lines.length !== b.lines.length) return null;
    const patches = [];
    try {
      for (let i = 0; i < b.lines.length; i++) {
        const ln = b.lines[i]; if (lines[i].trim() === ln.text.trim()) continue;
        const boxes = ln.words.map(w => w.px || (w.src && w.src.bbox)).filter(Boolean);
        const inBox = s => { const cx = (s.x0 + s.x1) / 2, cy = (s.y0 + s.y1) / 2; return boxes.some(q => cx >= q.x0 - 1 && cx <= q.x1 + 1 && cy >= q.y0 - 1 && cy <= q.y1 + 1); };
        const syms = (p.ocr.smSymbols || []).filter(inBox); if (!syms.length) return null;
        const r = await SM().replaceSegment(p.ocr.img, syms, lines[i], lib, {align: alignOf(b)});
        if (!r || !r.patch || !(r.w > 0) || !(r.h > 0)) return null;
        patches.push({i, r});
      }
    } catch (err) { console.warn("ScanMatch", err); return null; }
    b.sm = {text, patches}; return b.sm;
  }
  function smPreview(b) {
    if (!SM() || !b.ocr || !b.scanWords) return;
    clearTimeout(b._smT); b._smT = setTimeout(async () => { if (closed) return; const r = await smRun(b); if (r && r.text === b.text) drawSm(b); }, 250);
  }
  function smCanvas(patch) {
    if (patch instanceof HTMLCanvasElement) return patch;
    const c = document.createElement("canvas"); c.width = patch.width; c.height = patch.height;
    if (patch instanceof ImageData) c.getContext("2d").putImageData(patch, 0, 0); else c.getContext("2d").drawImage(patch, 0, 0);
    return c;
  }
  /* the patch is in OCR-image pixels (k px per point, top-left origin) -> points -> screen */
  function drawSm(b) {
    const p = pgOf(b.page); if (b.smEl) { b.smEl.forEach(e => e.remove()); b.smEl = null; }
    const ok = b.sm && b.sm.text === b.text && b.sm.patches.length && p.ocr; if (b.el) b.el.classList.toggle("sm", !!ok);
    if (!ok) return;
    const k = p.ocr.sc; b.smEl = [];
    for (const {r} of b.sm.patches) {
      /* a copy, so the engine's own canvas is never moved into the page */
      const src = smCanvas(r.patch), c = document.createElement("canvas"); c.width = src.width; c.height = src.height; c.getContext("2d").drawImage(src, 0, 0);
      c.className = "sm-patch";
      Object.assign(c.style, {position: "absolute", left: r.x / k * s + "px", top: r.y / k * s + "px", width: r.w / k * s + "px", height: r.h / k * s + "px", pointerEvents: "none"});
      p.cvL.appendChild(c); b.smEl.push(c);
    }
    if (b.cv) b.cv.classList.remove("show");
  }
  const bkText = el => el.innerText.replace(/ /g, " ").replace(/\r/g, "").replace(/\n$/, "");
  /* The exact lines the browser shows (so the saved PDF wraps at the same places). */
  function domLines(el) {
    const out = []; let line = "", lastTop = null; const rng = document.createRange();
    const walk = n => {
      if (n.nodeType === 3) {
        const t = n.textContent;
        for (let i = 0; i < t.length; i++) {
          const ch = t[i];
          if (ch === "\n") { out.push(line); line = ""; lastTop = null; continue; }
          rng.setStart(n, i); rng.setEnd(n, i + 1); const rc = rng.getClientRects()[0];
          if (rc && lastTop !== null && rc.top > lastTop + rc.height * .5) { out.push(line.replace(/\s+$/, "")); line = ""; }
          if (rc) lastTop = rc.top;
          line += ch;
        }
      } else if (n.nodeName === "BR") { out.push(line); line = ""; lastTop = null; }
      else for (const c of n.childNodes) walk(c);
    };
    walk(el); out.push(line);
    while (out.length > 1 && out[out.length - 1] === "" && !bkText(el).endsWith("\n")) out.pop();
    return out;
  }
  function cacheLines(b) { if (b.el && b.el.isConnected && b.el.offsetParent !== null) b.out = domLines(b.el); }
  /* Does the text fit its container? Shows a badge with options when it doesn't, and an amber outline when it overlaps. */
  function checkFit(b) {
    const el = b.el; if (!el || !el.isConnected) return;
    const p = pgOf(b.page); const on = changed(b);
    const hPt = el.scrollHeight / s; const top = topOf(b); const belowH = cellBelow(b).reduce((a, o) => a + (o.bottom - o.top) + .8, 0); const avail = b.h2 || (b.maxBottom - top - belowH);
    const over = on && b.fit !== "grow" && hPt > avail + .6;
    b.over = over;
    const rect = {x: b.x + b.dx, y: top, w: wrapOf(b), h: hPt};
    let ovl = false;
    if (on) {
      const pushed = new Set(cellBelow(b));
      for (const o of p.blocks) { if (o === b || pushed.has(o)) continue; const orr = changed(o) ? {x: o.x + o.dx, y: topOf(o), w: wrapOf(o), h: o.el ? o.el.scrollHeight / s : o.bottom - o.top} : {x: o.ox, y: o.top, w: o.wOrig, h: o.bottom - o.top}; if (rectsOverlap(rect, orr, 1)) { ovl = true; break; } }
      if (!ovl) for (const q of p.rules) { if (q.soft) continue; const rr = {x: q.x0 - .2, y: q.y0 - .2, w: q.x1 - q.x0 + .4, h: q.y1 - q.y0 + .4}; if (rectsOverlap(rect, rr, 1.2)) { ovl = true; break; } }
      if (!ovl) for (const im of p.images) if (!im.del && rectsOverlap(rect, {x: im.x, y: im.y, w: im.w, h: im.h}, 1)) { ovl = true; break; }
    }
    el.classList.toggle("ovl", ovl || over);
    if (sel && sel.kind === "bk" && sel.b === b) placeHandles();
  }
  function wireBlock(el, b) {
    el.addEventListener("focus", () => {
      if (mode !== "edit" && !b.isNew) setMode("edit");
      b._before = {text: b.text}; if (!b.sampled) sampleBlock(b);
      select({kind: "bk", b, page: b.page}); placeBlock(b); updateNotes();
    });
    el.addEventListener("input", () => {
      const oldText = b.text; b.text = bkText(el); syncCs(b, oldText); if (b.fit === "shrink") autoShrink(b); placeBlock(b); cacheLines(b); updateNotes(); scheduleCommit(); smPreview(b);
      if (b.over && b.cell && !b._suggested) { b._suggested = true; toast("This text doesn't fit the table cell. Choose \u201cShrink text to fit\u201d under the box to keep it inside."); }
    });
    el.addEventListener("blur", () => {
      if (hasCs(b)) renderRuns(b);
      cacheLines(b); if (commitT) commit();
      if (b.isNew && !b.text.trim()) { const p = pgOf(b.page); p.blocks = p.blocks.filter(x => x !== b); el.remove(); b.cv && b.cv.remove(); if (sel && sel.b === b) select(null); commit(); return; }
      placeBlock(b);
    });
    el.addEventListener("keydown", e => {
      if (e.key === "Escape") { e.preventDefault(); if (b._before && b.text !== b._before.text) { b.text = b._before.text; el.textContent = b.text; placeBlock(b); commit(); } focusHandles(); return; }
      if (e.key === "Enter" && !e.shiftKey && (!b.lines || b.lines.length < 2) && !b.isNew) { e.preventDefault(); el.blur(); focusHandles(); return; }
      if (e.key === "Tab") { e.preventDefault(); const all = $$e(".bk"); const i = all.indexOf(el); const nx = all[i + (e.shiftKey ? -1 : 1)]; if (nx) { nx.focus(); nx.scrollIntoView({block: "nearest"}); placeCaretEnd(nx); } return; }
      if (e.altKey && e.key.startsWith("Arrow")) { e.preventDefault(); nudge(b, e.key, e.shiftKey); }
    });
    el.addEventListener("paste", e => {
      e.preventDefault(); const t = (e.clipboardData || window.clipboardData).getData("text/plain");
      if (!document.execCommand("insertText", false, t)) { el.textContent += t; el.dispatchEvent(new Event("input")); }
    });
  }
  function placeCaretEnd(el) { try { const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const sl = getSelection(); sl.removeAllRanges(); sl.addRange(r); } catch (e) { /* ignore */ } }
  function nudge(b, key, resize) {
    const st = 1;
    if (resize) { if (key === "ArrowRight") b.wrap2 = wrapOf(b) + st; if (key === "ArrowLeft") b.wrap2 = Math.max(8, wrapOf(b) - st); if (key === "ArrowDown") b.h2 = (b.h2 || (b.el.scrollHeight / s)) + st; if (key === "ArrowUp") b.h2 = Math.max(4, (b.h2 || b.el.scrollHeight / s) - st); }
    else { if (key === "ArrowLeft") b.dx -= st; if (key === "ArrowRight") b.dx += st; if (key === "ArrowUp") b.dy -= st; if (key === "ArrowDown") b.dy += st; }
    placeBlock(b); cacheLines(b); scheduleCommit();
  }
  function autoShrink(b) {
    const el = b.el; if (!el) return; const base = baseSize(b), top0 = b.base0 + b.dy;
    const belowH = cellBelow(b).reduce((a, o) => a + (o.bottom - o.top) + .8, 0);
    const fits = sz => { b.fitSize = sz; placeBlockNoFit(b); const avail = b.h2 || (b.maxBottom - topOf(b) - belowH); return el.scrollHeight / s <= avail + .6; };
    if (fits(base)) { b.fitSize = undefined; return; }
    let lo = Math.max(4, base * .5), hi = base;
    if (!fits(lo)) { b.fitSize = lo; return; }
    for (let i = 0; i < 9; i++) { const m = (lo + hi) / 2; if (fits(m)) lo = m; else hi = m; }
    b.fitSize = Math.floor(lo * 10) / 10;
  }
  function placeBlockNoFit(b) { const sz = sizeOf(b), gap = gapOf(b); Object.assign(b.el.style, {fontSize: sz * s + "px", lineHeight: gap * s + "px", top: topPx(b) + "px"}); }
  function addText(p, x, y) {
    const sz = def.size;
    const b = {id: "n" + (++uid), page: p.n, isNew: true, lines: [], x, top: y - sz * .7, bottom: y + sz * .4, base0: y + sz * .3, gap: sz * 1.2, size: sz, lsOrig: 1.2,
      font: {fam: def.fam === "orig" ? "sans" : def.fam, bold: def.bold, italic: def.italic, sure: true}, cssFam: def.fam === "orig" ? "sans" : def.fam,
      color2: def.color, underline: def.underline, align0: def.align, origText: "", text: "", dx: 0, dy: 0, r: 1, wOrig: 0, words: [],
      wrapW: Math.max(60, p.W - 24 - x), maxBottom: p.H - 18, cont: {l: x, r: p.W - 24, t: y, b: p.H - 18}};
    p.blocks.push(b); makeBlockEl(b, p); setTimeout(() => b.el && b.el.focus(), 0);
  }

  /* ---------- selection handles (move, resize, snapping) ---------- */
  const hd = document.createElement("div"); hd.className = "edx-h"; hd.tabIndex = -1; hd.hidden = true;
  hd.innerHTML = `<span class="h-mv" data-h="mv" title="Drag to move (arrow keys)">${ED_ICON.grip}</span><span class="h-e h-l" data-h="l"></span><span class="h-e h-r" data-h="r"></span><span class="h-c" data-h="br"></span>
    <span class="h-tip" data-tip></span><div class="h-ovf" data-ovf hidden><b>Text doesn't fit</b><button type="button" data-fit="shrink">Shrink text to fit</button><button type="button" data-fit="wider">Make box wider</button><button type="button" data-fit="grow">Let the box grow</button></div>`;
  const guide = document.createElement("div"); guide.className = "edx-guide"; guide.hidden = true;
  function placeHandles() {
    if (!sel || (sel.kind !== "bk" && sel.kind !== "img")) { hd.hidden = true; return; }
    const p = pgOf(sel.page); if (hd.parentNode !== p.ly) { p.ly.appendChild(hd); p.ly.appendChild(guide); }
    let r;
    if (sel.kind === "bk") { const b = sel.b; if (!b.el || !b.el.isConnected) { hd.hidden = true; return; } r = {x: b.x + b.dx, y: topOf(b), w: wrapOf(b), h: Math.max(b.h2 || 0, b.el.scrollHeight / s)}; }
    else { const im = sel.im; r = {x: im.x, y: im.y, w: im.w, h: im.h}; }
    hd.hidden = false; hd.classList.toggle("is-img", sel.kind === "img");
    Object.assign(hd.style, {left: r.x * s + "px", top: r.y * s + "px", width: r.w * s + "px", height: r.h * s + "px"});
    const ovf = $("[data-ovf]", hd); ovf.hidden = !(sel.kind === "bk" && sel.b.over);
    if (!ovf.hidden) $("[data-fit=shrink]", ovf).classList.toggle("rec", !!sel.b.cell);
  }
  function focusHandles() { if (sel) { placeHandles(); hd.focus({preventScroll: true}); } }
  hd.addEventListener("keydown", e => {
    if (!sel) return;
    if (e.key.startsWith("Arrow")) { e.preventDefault(); if (sel.kind === "bk") nudge(sel.b, e.key, e.shiftKey); else nudgeImg(sel.im, e.key, e.shiftKey); placeHandles(); }
    else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSel(); }
    else if (e.key === "Enter" && sel.kind === "bk") { e.preventDefault(); sel.b.el.focus(); placeCaretEnd(sel.b.el); }
    else if (e.key === "Escape") { e.preventDefault(); select(null); stage.focus({preventScroll: true}); }
  });
  hd.addEventListener("click", e => {
    const f = e.target.closest("[data-fit]"); if (!f || !sel || sel.kind !== "bk") return; const b = sel.b;
    if (f.dataset.fit === "shrink") { b.fit = "shrink"; autoShrink(b); }
    else if (f.dataset.fit === "grow") { b.fit = "grow"; }
    else { const p = pgOf(b.page); const lim = (b.cell ? p.W - 18 : p.W - 18) - (b.x + b.dx); b.wrap2 = Math.min(Math.max(wrapOf(b) * 1.25, wrapOf(b) + 20), Math.max(wrapOf(b), lim)); }
    placeBlock(b); cacheLines(b); commit(); placeHandles();
  });
  hd.addEventListener("pointerdown", e => {
    const h = e.target.closest("[data-h]"); if (!h || !sel) return;
    e.preventDefault(); e.stopPropagation(); hd.setPointerCapture(e.pointerId);
    const p = pgOf(sel.page); const k = h.dataset.h;
    const st = sel.kind === "bk" ? {x: sel.b.x + sel.b.dx, dx: sel.b.dx, dy: sel.b.dy, w: wrapOf(sel.b), h: sel.b.h2 || sel.b.el.scrollHeight / s} : {x: sel.im.x, y: sel.im.y, w: sel.im.w, h: sel.im.h};
    /* table borders win over other boxes' edges when both are close */
    const ruleX = [...new Set(p.rules.filter(q => q.x1 - q.x0 < 1.5).map(q => q.x0))];
    const edgeX = [...new Set([...p.blocks.filter(o => sel.kind !== "bk" || o !== sel.b).flatMap(o => [o.x + o.dx, o.x + o.dx + wrapOf(o)]), 18, p.W - 18])];
    const snap = (v, t) => { const a = snapTo(v, ruleX, t); return a.to !== null ? a : snapTo(v, edgeX, t); };
    const tol = 5 / s;
    let drag = {k, sx: e.clientX, sy: e.clientY, st, p, tol};
    const mv = ev => {
      const dx = (ev.clientX - drag.sx) / s, dy = (ev.clientY - drag.sy) / s; let gx = null;
      if (sel.kind === "bk") {
        const b = sel.b;
        if (k === "mv") { let nx = st.x + dx; const sn = snap(nx, tol); if (sn.to !== null) { nx = sn.v; gx = sn.v; } b.dx = st.dx + (nx - st.x); b.dy = st.dy + dy; }
        else if (k === "r" || k === "br") { let right = st.x + st.w + dx; const sn = snap(right, tol); if (sn.to !== null) { right = sn.v; gx = right; } b.wrap2 = Math.max(8, right - st.x); if (k === "br") b.h2 = Math.max(4, st.h + dy); }
        else if (k === "l") { let left = st.x + dx; const sn = snap(left, tol); if (sn.to !== null) { left = sn.v; gx = left; } left = Math.min(left, st.x + st.w - 8); b.dx = st.dx + (left - st.x); b.wrap2 = st.w - (left - st.x); }
        placeBlock(b); $("[data-tip]", hd).textContent = Math.round(wrapOf(b) / MM) + " × " + Math.round(Math.max(b.h2 || 0, b.el.scrollHeight / s) / MM) + " mm";
      } else {
        const im = sel.im; const ar = st.h / st.w;
        if (k === "mv") { im.x = st.x + dx; im.y = st.y + dy; }
        else { let w = Math.max(8, st.w + dx), h = ev.shiftKey ? Math.max(8, st.h + dy) : w * ar; if (k === "l") { w = Math.max(8, st.w - dx); h = ev.shiftKey ? st.h : w * ar; im.x = st.x + st.w - w; } im.w = w; im.h = h; }
        placeImages(pgOf(im.page)); $("[data-tip]", hd).textContent = Math.round(im.w / MM) + " × " + Math.round(im.h / MM) + " mm";
      }
      guide.hidden = gx === null; if (gx !== null) Object.assign(guide.style, {left: gx * s + "px"});
      placeHandles();
    };
    const up = () => { hd.removeEventListener("pointermove", mv); hd.removeEventListener("pointerup", up); hd.removeEventListener("pointercancel", up); guide.hidden = true; $("[data-tip]", hd).textContent = ""; if (sel && sel.kind === "bk") cacheLines(sel.b); commit(); };
    hd.addEventListener("pointermove", mv); hd.addEventListener("pointerup", up); hd.addEventListener("pointercancel", up);
  });

  /* ---------- existing images on the page ---------- */
  function makeImgEl(im, p) {
    const el = document.createElement("div"); el.className = "imx"; el.tabIndex = 0; el.setAttribute("role", "button"); el.setAttribute("aria-label", "Image on the page. Press Enter to select it.");
    el.innerHTML = '<img alt="">'; im.el = el; p.imL.appendChild(el);
    const cvi = document.createElement("div"); cvi.className = "bk-cv"; p.cvL.appendChild(cvi); im.cv = cvi;
    el.addEventListener("pointerdown", e => {
      if (mode !== "edit") return; e.preventDefault(); e.stopPropagation(); selectImg(im);
      const sx = e.clientX, sy = e.clientY, ox = im.x, oy = im.y; el.setPointerCapture(e.pointerId); let moved = false;
      const mv = ev => { const dx = (ev.clientX - sx) / s, dy = (ev.clientY - sy) / s; if (!moved && Math.hypot(dx, dy) * s < 3) return; moved = true; snapImg(im); im.x = ox + dx; im.y = oy + dy; placeImages(p); placeHandles(); };
      const up = () => { el.removeEventListener("pointermove", mv); el.removeEventListener("pointerup", up); if (moved) commit(); };
      el.addEventListener("pointermove", mv); el.addEventListener("pointerup", up);
    });
    el.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectImg(im); focusHandles(); } });
  }
  const imgChanged = im => im.del || !!im.repl || im.q % 4 !== 0 || Math.abs(im.x - im.vx) > .01 || Math.abs(im.y - im.vy) > .01 || Math.abs(im.w - im.vw) > .01 || Math.abs(im.h - im.vh) > .01;
  function snapImg(im) {
    if (im.snap || im.repl) return; const p = pgOf(im.page); if (!p.ps) return;
    const k = p.ps; const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(im.vw * k)); c.height = Math.max(1, Math.round(im.vh * k));
    try { c.getContext("2d").drawImage(p.canvas, im.vx * k, im.vy * k, im.vw * k, im.vh * k, 0, 0, c.width, c.height); im.snap = c.toDataURL("image/png"); } catch (e) { im.snap = null; }
    if (!im.bg) { try { const img = p.canvas.getContext("2d").getImageData(Math.max(0, Math.floor((im.vx - 3) * k)), Math.max(0, Math.floor((im.vy - 3) * k)), Math.ceil((im.vw + 6) * k), Math.ceil((im.vh + 6) * k)); im.bg = sampleColors(img, 3 * k, 3 * k, im.vw * k, im.vh * k).bg; } catch (e) { im.bg = [255, 255, 255]; } }
  }
  function placeImages(p) {
    for (const im of p.images) {
      const el = im.el; if (!el) continue; const ch = imgChanged(im);
      Object.assign(el.style, {left: im.x * s + "px", top: im.y * s + "px", width: im.w * s + "px", height: im.h * s + "px"});
      el.classList.toggle("on", ch); el.hidden = im.del;
      const img = el.querySelector("img");
      if (ch && !im.del) { const src = im.repl ? im.repl.url : im.snap; if (src && img.getAttribute("src") !== src) img.src = src; img.style.transform = "rotate(" + (im.q * 90) + "deg)"; const odd = im.q % 2; Object.assign(img.style, odd ? {width: im.h * s + "px", height: im.w * s + "px", left: (im.w - im.h) / 2 * s + "px", top: (im.h - im.w) / 2 * s + "px"} : {width: "100%", height: "100%", left: 0, top: 0}); }
      else img.removeAttribute("src");
      Object.assign(im.cv.style, {left: (im.vx - .5) * s + "px", top: (im.vy - .5) * s + "px", width: (im.vw + 1) * s + "px", height: (im.vh + 1) * s + "px", background: rgbCss(im.bg || [255, 255, 255])});
      im.cv.classList.toggle("show", ch);
    }
  }
  function nudgeImg(im, key, resize) {
    snapImg(im); const st = 1;
    if (resize) { const ar = im.h / im.w; if (key === "ArrowRight") im.w += st; if (key === "ArrowLeft") im.w = Math.max(8, im.w - st); im.h = im.w * ar; }
    else { if (key === "ArrowLeft") im.x -= st; if (key === "ArrowRight") im.x += st; if (key === "ArrowUp") im.y -= st; if (key === "ArrowDown") im.y += st; }
    placeImages(pgOf(im.page)); scheduleCommit();
  }
  function selectImg(im) { snapImg(im); select({kind: "img", im, page: im.page}); }
  $e("[data-a=irot]").addEventListener("click", () => { if (sel && sel.kind === "img") { const im = sel.im; snapImg(im); im.q = (im.q + 1) % 4; const cx = im.x + im.w / 2, cy = im.y + im.h / 2; [im.w, im.h] = [im.h, im.w]; im.x = cx - im.w / 2; im.y = cy - im.h / 2; placeImages(pgOf(im.page)); placeHandles(); commit(); } });
  $e("[data-a=idel]").addEventListener("click", () => deleteSel());
  $e("[data-a=irep]").addEventListener("click", () => $e("[data-irepf]").click());
  $e("[data-irepf]").addEventListener("change", async e => {
    const f = e.target.files[0]; e.target.value = ""; if (!f || !sel || sel.kind !== "img") return; const im = sel.im;
    try { const r = await imageToPng(f, 2400); const ar = r.h / r.w; let w = im.w, h = w * ar; if (h > im.h) { h = im.h; w = h / ar; } im.x += (im.w - w) / 2; im.y += (im.h - h) / 2; im.w = w; im.h = h; im.q = 0; im.repl = {url: r.url}; snapImg(im); placeImages(pgOf(im.page)); placeHandles(); commit(); }
    catch (err) { toast(err.message); }
  });

  /* ---------- added items: images, drawings, highlights, shapes, white-out ---------- */
  function itemHooks(p) {
    return {
      label: it => ({img: "Image", ink: "Drawing", hl: "Highlight", shape: "Rectangle", rect: "White-out box"}[it.type] || "Item"),
      render: renderItem,
      onSelect: it => { if (it) { for (const q of pages) if (q !== p && q.L && q.L.sel) q.L.select(null); if (document.activeElement && document.activeElement.classList.contains("bk")) document.activeElement.blur(); select({kind: "item", it, page: p.n}, true); } else if (sel && sel.kind === "item" && sel.page === p.n) select(null, true); },
      onChange: () => commit()
    };
  }
  function renderItem(it, el) {
    const k = s;
    if (it.type === "img") el.innerHTML = `<img src="${imgReg[it.img]}" alt="">`;
    else if (it.type === "rect") el.style.background = it.color;
    else if (it.type === "hl") { el.style.background = it.color; el.style.opacity = ".42"; el.style.mixBlendMode = "multiply"; }
    else if (it.type === "shape") { el.style.border = Math.max(1, it.width * k) + "px solid " + it.color; el.style.background = it.fill ? it.color : "transparent"; el.style.boxSizing = "border-box"; }
    else if (it.type === "ink") el.innerHTML = `<svg viewBox="0 0 1 1" preserveAspectRatio="none" width="100%" height="100%" style="overflow:visible;display:block"><polyline fill="none" stroke="${it.color}" stroke-width="${Math.max(1, it.width * k)}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" points="${it.pts.map(q => q[0].toFixed(4) + "," + q[1].toFixed(4)).join(" ")}"/></svg>`;
  }
  function addItem(p, it) { it.page = p.n; it.id = "o" + (++uid); items.push(it); p.L.draw(); p.L.select(it); commit(); }
  let drawing = null;
  function pageAt(e) { const el = e.target.closest && e.target.closest(".edx-pg"); return el ? pgOf(+el.dataset.n) : null; }
  function fracIn(p, e) { const r = p.ly.getBoundingClientRect(); return {x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1)}; }
  pagesEl.addEventListener("pointerdown", e => {
    const p = pageAt(e); if (!p || e.button > 0) return;
    if (!e.target.classList.contains("edx-ly")) return;
    const f = fracIn(p, e);
    if (mode === "edit") { if (sel) select(null); return; }
    if (p.state !== "ready" && p.state !== "scan" && p.state !== "error") { /* still reading the page */ }
    if (!p.L) p.L = itemLayer(p.V, items, itemHooks(p));
    if (mode === "text") { e.preventDefault(); addText(p, f.x * p.W, f.y * p.H); return; }
    if (mode === "img") {
      if (!pendingImg) { toast("Choose an image or signature first (button in the second row)."); $e("[data-pic]").click(); return; }
      const fw = Math.min(.4, pendingImg.w * .75 / p.W), fh = fw * pendingImg.ar * p.W / p.H;
      addItem(p, {type: "img", img: pendingImg.id, ar: pendingImg.ar, keep: true, fw, fh, fx: clamp(f.x - fw / 2, 0, 1 - fw), fy: clamp(f.y - fh / 2, 0, Math.max(0, 1 - fh))});
      return;
    }
    e.preventDefault(); p.ly.setPointerCapture(e.pointerId);
    const pv = document.createElement("div"); pv.className = "ed-prev ed-prev-" + mode; p.ly.appendChild(pv);
    if (mode === "draw") pv.innerHTML = '<svg viewBox="0 0 1000 1000" preserveAspectRatio="none" width="100%" height="100%"><polyline fill="none" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>';
    drawing = {p, mode, start: f, pts: [f], pv, id: e.pointerId}; paintPrev();
  });
  pagesEl.addEventListener("pointermove", e => {
    if (!drawing || e.pointerId !== drawing.id) return; const f = fracIn(drawing.p, e);
    if (drawing.mode === "draw") { const q = drawing.pts[drawing.pts.length - 1]; if (Math.hypot((f.x - q.x) * drawing.p.W, (f.y - q.y) * drawing.p.H) > .8) drawing.pts.push(f); } else drawing.pts[1] = f;
    paintPrev();
  });
  const endDraw = e => {
    if (!drawing || (e && e.pointerId !== drawing.id)) return; const d = drawing; drawing = null; d.pv.remove(); const p = d.p;
    if (d.mode === "draw") {
      const xs = d.pts.map(q => q.x), ys = d.pts.map(q => q.y); const fx = Math.min(...xs), fy = Math.min(...ys);
      const fw = Math.max(Math.max(...xs) - fx, 1 / p.W), fh = Math.max(Math.max(...ys) - fy, 1 / p.H);
      addItem(p, {type: "ink", color: def.color, width: 2, fx, fy, fw, fh, pts: d.pts.map(q => [(q.x - fx) / fw, (q.y - fy) / fh])});
    } else {
      const a = d.start, b = d.pts[1] || a; let fx = Math.min(a.x, b.x), fy = Math.min(a.y, b.y), fw = Math.abs(b.x - a.x), fh = Math.abs(b.y - a.y);
      if (fw * p.W < 4 && fh * p.H < 4) { fw = d.mode === "hl" ? .3 : .2; fh = 16 / p.H; fx = clamp(a.x - fw / 2, 0, 1 - fw); fy = clamp(a.y - fh / 2, 0, 1 - fh); }
      fw = Math.max(fw, 2 / p.W); fh = Math.max(fh, 2 / p.H);
      if (d.mode === "hl") addItem(p, {type: "hl", color: def.color === "#111111" ? "#FFE45C" : def.color, fx, fy, fw, fh});
      else if (d.mode === "shape") addItem(p, {type: "shape", color: def.color, fill: def.fill, width: 1.5, fx, fy, fw, fh});
      else addItem(p, {type: "rect", color: "#ffffff", fx, fy, fw, fh});
    }
  };
  pagesEl.addEventListener("pointerup", endDraw); pagesEl.addEventListener("pointercancel", () => { if (drawing) { drawing.pv.remove(); drawing = null; } });
  function paintPrev() {
    const d = drawing; if (!d) return;
    if (d.mode === "draw") { const pl2 = $("polyline", d.pv); pl2.setAttribute("points", d.pts.map(q => (q.x * 1000).toFixed(1) + "," + (q.y * 1000).toFixed(1)).join(" ")); pl2.setAttribute("stroke", def.color); pl2.setAttribute("stroke-width", String(2 * s)); Object.assign(d.pv.style, {left: 0, top: 0, width: "100%", height: "100%"}); }
    else { const a = d.start, b = d.pts[1] || a; Object.assign(d.pv.style, {left: Math.min(a.x, b.x) * 100 + "%", top: Math.min(a.y, b.y) * 100 + "%", width: Math.abs(b.x - a.x) * 100 + "%", height: Math.abs(b.y - a.y) * 100 + "%"}); d.pv.style.setProperty("--c", d.mode === "rect" ? "#ffffff" : d.mode === "hl" && def.color === "#111111" ? "#FFE45C" : def.color); }
  }
  $e("[data-pic]").addEventListener("change", async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const r = await imageToPng(f, 2000); const id = "i" + (++uid); imgReg[id] = r.url; pendingImg = {id, ar: r.h / r.w, w: r.w}; $e("[data-pickt]").textContent = f.name; toast("Now click on the page to place the image."); }
    catch (err) { pendingImg = null; toast(err.message); }
  });

  /* ---------- toolbar ---------- */
  function setMode(m) {
    mode = m; root.dataset.mode = m;
    $$e("[data-mode]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === m)));
    $e("[data-picw]").hidden = m !== "img";
    if (m !== "edit" && sel && sel.kind !== "item") select(null);
    if (m === "img" && !pendingImg) $e("[data-pic]").click();
  }
  root.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b || !root.contains(b)) return;
    if (b.dataset.mode) setMode(b.dataset.mode);
    else if (b.dataset.align) applyFmt("align", b.dataset.align);
    else if (b.dataset.f) { const v = b.getAttribute("aria-pressed") !== "true"; b.setAttribute("aria-pressed", String(v)); applyFmt(b.dataset.f, v); }
    else if (b.dataset.a) act(b.dataset.a);
    else if (b.dataset.goto) gotoTool(b.dataset.goto);
  });
  $e("[data-pgi]").addEventListener("change", e => { const n = parseInt(e.target.value, 10); if (n >= 1 && n <= N) goPage(n); else e.target.value = cur; });
  $e("[data-f=fam]").addEventListener("change", e => applyFmt("fam", e.target.value));
  $e("[data-f=color]").addEventListener("input", e => applyFmt("color", e.target.value));
  $e("[data-f=size]").addEventListener("change", e => { const v = +e.target.value; if (v >= 4 && v <= 200) applyFmt("size", v); });
  $e("[data-f=ls]").addEventListener("change", e => applyFmt("ls", e.target.value ? +e.target.value : null));
  function act(a) {
    const menu = $e(".edx-menu"); if (menu) menu.open = false;
    if (a === "undo") undo(); else if (a === "redo") redo(); else if (a === "del") deleteSel();
    else if (a === "zin") zoomBy(1.2); else if (a === "zout") zoomBy(1 / 1.2);
    else if (a === "fitw" || a === "fitp") { rememberZoom(a); applyZoomPref(); }
    else if (a === "save") save();
    else if (a === "close") close(false);
    else if (a === "pages") togglePages();
    else if (a === "panel") { const on = !root.classList.contains("panel-open"); root.classList.toggle("panel-open", on); $e("[data-a=panel]").setAttribute("aria-expanded", String(on)); setTimeout(() => { if (zoomPref === "fitw" || zoomPref === "fitp") applyZoomPref(); }, 0); }
    else if (a === "pgup") goPage(Math.max(1, cur - 1)); else if (a === "pgdn") goPage(Math.min(N, cur + 1));
    else if (a === "sign") signature();
    else if (a === "stop") { ocrQ = []; runTok++; looping = false; pillUI(null); ocrStop(); toast("Stopped reading scanned pages. You can start again from the … menu."); pump(); }
    else if (a === "reread") { const p = pgOf(cur); if (p.rec && p.rec.source === "text") { toast("This page has real text, so there's nothing to read with OCR."); return; } if (p.blocks.some(changed) && !confirm("Reading this page again will undo your text changes on it. Continue?")) return; clearPage(p); p.state = "scan"; ocrBroken = ""; ocrQ.unshift(p.n); pump(); }
    else if (a === "readall") { ocrBroken = ""; for (const p of pages) if ((p.state === "scan" || p.state === "error") && !ocrQ.includes(p.n)) ocrQ.push(p.n); if (!ocrQ.length) toast("There are no scanned pages left to read."); bumpQueue(); }
    else if (a === "keys") dialog("Keyboard shortcuts", `<table class="t"><tbody>${[["V T I D H R W", "Edit, Add text, Image, Draw, Highlight, Rectangle, White-out"], ["Ctrl+Z / Ctrl+Y", "Undo / Redo"], ["Del", "Delete the selected item"], ["Tab / Shift+Tab", "Next / previous text"], ["Enter", "Finish a one-line edit"], ["Esc", "Cancel the edit, keep the box selected"], ["Arrow keys", "Move the selected box (Shift: change its width)"], ["Alt+Arrow keys", "Move the box while typing"], ["Ctrl + / Ctrl − / Ctrl 0", "Zoom in / out / fit width"], ["Ctrl + mouse wheel", "Zoom at the pointer"]].map(([k, v]) => `<tr><td><b>${k}</b></td><td>${v}</td></tr>`).join("")}</tbody></table>`, [["Close", "btn"]]);
  }
  function syncFmt(src) {
    $e("[data-f=fam]").value = src.fam || "sans"; $e("[data-f=size]").value = Math.round((src.size || 12) * 10) / 10; $e("[data-f=color]").value = src.color || "#111111";
    for (const k of ["bold", "italic", "underline", "fill"]) $e(`[data-f=${k}]`).setAttribute("aria-pressed", String(!!src[k]));
    $$e("[data-align]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.align === (src.align || "left"))));
    $e("[data-f=ls]").value = src.ls ? String(src.ls) : "";
    $e("[data-f=fam] option[value=orig]").hidden = !src.hasOrig;
  }
  function applyFmt(k, v) {
    if (sel && sel.kind === "bk" && ["bold", "italic", "underline", "color", "size"].includes(k) && sel.b._sel && sel.b._sel[1] > sel.b._sel[0]) {
      const b = sel.b; const [a, z] = sel.b._sel;
      styleRange(b, a, z, k, k === "size" ? +v : v); renderRuns(b); placeBlock(b); cacheLines(b); commit(); updateNotes();
      if ((k === "bold" || k === "italic") && !b.ffv) loadVariants(b);
      if (b.el) { b.el.focus(); setCaretOffsets(b.el, a, z); }
      return;
    }
    if (sel && sel.kind === "bk") {
      const b = sel.b;
      if (k === "fam") b.fam2 = v === "orig" ? null : v; else if (k === "size") { b.size2 = v; b.fitSize = undefined; } else if (k === "color") b.color2 = v; else if (k === "bold") b.bold2 = v;
      else if (k === "italic") b.italic2 = v; else if (k === "underline") b.underline = v; else if (k === "align") b.align2 = v; else if (k === "ls") b.ls2 = v; else return;
      if (k === "align") $$e("[data-align]").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.align === v)));
      if (b.fit === "shrink") autoShrink(b);
      placeBlock(b); cacheLines(b); commit(); return;
    }
    if (sel && sel.kind === "item") {
      const it = sel.it;
      if (k === "color" && it.type !== "img") it.color = v; else if (k === "fill" && it.type === "shape") it.fill = v; else if (k === "size" && it.type === "ink") it.width = clamp(v / 6, .5, 20); else return;
      pgOf(sel.page).L.draw(); commit(); return;
    }
    if (k === "align") { def.align = v; $$e("[data-align]").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.align === v))); } else if (k !== "ls") def[k] = v;
  }
  function select(x, fromItem) {
    if (!fromItem) for (const p of pages) if (p.L && p.L.sel) p.L.select(null);
    const prev = sel; sel = x;
    if (prev && prev.kind === "bk" && prev.b !== (x && x.b)) placeBlock(prev.b);
    $e("[data-imgctx]").hidden = !(x && x.kind === "img");
    if (x && x.kind === "bk") {
      const b = x.b;
      syncFmt({fam: b.fam2 || (b.isNew || b.ocr ? famOf(b) : "orig"), size: sizeOf(b), color: colourOf(b), bold: boldOf(b), italic: italOf(b), underline: !!b.underline, align: alignOf(b), ls: b.ls2, fill: def.fill, hasOrig: !b.isNew && !b.ocr});
    } else if (x && x.kind === "item") syncFmt({...def, color: x.it.color || def.color, fill: !!x.it.fill});
    else syncFmt({...def, hasOrig: false});
    placeHandles();
  }
  function deleteSel() {
    if (!sel) { toast("Select some text or an item first."); return; }
    if (sel.kind === "item") { pgOf(sel.page).L.remove(sel.it); return; }
    if (sel.kind === "img") { const im = sel.im; snapImg(im); im.del = true; placeImages(pgOf(im.page)); select(null); commit(); toast("Image removed. Use Undo if that was a mistake."); return; }
    const b = sel.b;
    if (b.isNew) { const p = pgOf(b.page); p.blocks = p.blocks.filter(x => x !== b); b.el.remove(); b.cv && b.cv.remove(); select(null); }
    else { b.text = ""; b.el.textContent = ""; b.out = [""]; placeBlock(b); }
    commit(); toast("Text removed. Use Undo if that was a mistake.");
  }

  /* ---------- undo / redo ---------- */
  const BK = ["text", "cs", "dx", "dy", "push", "size2", "fam2", "bold2", "italic2", "underline", "align2", "ls2", "color2", "wrap2", "h2", "fit", "fitSize", "out"];
  const IM = ["x", "y", "w", "h", "q", "del", "repl"];
  function snapshot() {
    const pg = {};
    for (const p of pages) {
      if (p.state !== "ready" && !p.blocks.length) continue;
      const bl = []; for (const b of p.blocks) { if (!b.isNew && !changed(b)) continue; const o = {id: b.id}; for (const k of BK) if (b[k] !== undefined) o[k] = b[k]; if (b.isNew) o.newB = {x: b.x, base0: b.base0, top: b.top, bottom: b.bottom, size: b.size, font: b.font, cssFam: b.cssFam, wrapW: b.wrapW, maxBottom: b.maxBottom, cont: b.cont}; bl.push(o); }
      const im = p.images.filter(imgChanged).map(i => { const o = {id: i.id}; for (const k of IM) o[k] = i[k]; return o; });
      if (bl.length || im.length) pg[p.n] = {bl, im};
    }
    return JSON.stringify({pg, items});
  }
  function commit() {
    clearTimeout(commitT); commitT = 0;
    const sn = snapshot(); if (hist[hpos] === sn) return;
    hist = hist.slice(0, hpos + 1); hist.push(sn); if (hist.length > 80) hist.shift(); hpos = hist.length - 1;
    if (hpos > 0) dirty = true; updUndo(); updateNotes();
  }
  const scheduleCommit = () => { clearTimeout(commitT); commitT = setTimeout(commit, 600); };
  function restore(sn) {
    const o = JSON.parse(sn);
    for (const p of pages) {
      p.blocks = p.blocks.filter(b => !b.isNew);
      for (const b of p.blocks) { for (const k of BK) delete b[k]; b.text = b.origText; b.dx = b.dy = 0; b.push = 0; }
      for (const im of p.images) { im.x = im.vx; im.y = im.vy; im.w = im.vw; im.h = im.vh; im.q = 0; im.del = false; im.repl = null; }
      const d = o.pg[p.n];
      if (d) {
        for (const c of d.bl) {
          let b = p.blocks.find(x => x.id === c.id);
          if (!b && c.newB) { b = {...c.newB, id: c.id, page: p.n, isNew: true, lines: [], origText: "", text: "", dx: 0, dy: 0, r: 1, wOrig: 0, lsOrig: 1.2, gap: c.newB.size * 1.2, words: []}; p.blocks.push(b); }
          if (b) for (const k of BK) if (c[k] !== undefined) b[k] = c[k];
        }
        for (const c of d.im) { const im = p.images.find(x => x.id === c.id); if (im) for (const k of IM) im[k] = c[k]; }
      }
      if (p.state === "ready" || p.blocks.length) buildPageDom(p);
      placeImages(p);
    }
    items.length = 0; items.push(...o.items);
    for (const p of pages) if (p.L) p.L.draw();
    select(null); updUndo(); updateNotes(); dirty = true;
  }
  function undo() { if (commitT) commit(); if (hpos > 0) restore(hist[--hpos]); }
  function redo() { if (hpos < hist.length - 1) restore(hist[++hpos]); }
  function updUndo() { $e("[data-a=undo]").disabled = hpos <= 0; $e("[data-a=redo]").disabled = hpos >= hist.length - 1; }
  function updateNotes() {
    let indic = false;
    for (const p of pages) for (const b of p.blocks) if (changed(b) && hasNonLatin(b.text)) indic = true;
    let miss = "";
    if (sel && sel.kind === "bk" && sel.b.ff && !hasNonLatin(sel.b.text)) { const m = [...new Set([...sel.b.text])].filter(ch => ch.trim() && !sel.b.ff.chars.has(ch)); if (m.length) miss = "\"" + m.join("") + "\" isn't in this PDF's own font, so a matching standard font is used for " + (m.length > 1 ? "those characters." : "it."); }
    $e("[data-note]").textContent = [indic ? "Hindi and other Indian-language text is saved as a sharp picture (it can't be selected in the PDF)." : "", miss].filter(Boolean).join(" ");
  }

  /* ---------- keyboard, wheel and pinch zoom ---------- */
  const onKey = e => {
    if (closed) return;
    const t = e.target, inField = /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName), inBk = t.classList && t.classList.contains("bk"); const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === "+" || e.key === "=")) { e.preventDefault(); zoomBy(1.2); return; }
    if (mod && e.key === "-") { e.preventDefault(); zoomBy(1 / 1.2); return; }
    if (mod && e.key === "0") { e.preventDefault(); rememberZoom("fitw"); applyZoomPref(); return; }
    if (mod && !inField && !inBk && (e.key === "z" || e.key === "Z") && !e.shiftKey) { e.preventDefault(); undo(); return; }
    if (mod && !inField && !inBk && (e.key === "y" || e.key === "Y" || ((e.key === "z" || e.key === "Z") && e.shiftKey))) { e.preventDefault(); redo(); return; }
    if (mod && inBk && (e.key === "z" || e.key === "Z" || e.key === "y" || e.key === "Y")) { /* browser text undo inside the box */ return; }
    if (mod && ["b", "i", "u"].includes(e.key.toLowerCase()) && (inBk || (sel && sel.kind === "bk"))) { e.preventDefault(); const k = {b: "bold", i: "italic", u: "underline"}[e.key.toLowerCase()]; const bt = $e(`[data-f=${k}]`); const v = bt.getAttribute("aria-pressed") !== "true"; bt.setAttribute("aria-pressed", String(v)); applyFmt(k, v); return; }
    if (inField || inBk || mod || e.altKey) return;
    if (t === hd) return;
    if (t.closest && t.closest(".ov") && (e.key === "Delete" || e.key === "Backspace")) return;
    if (e.key === "Delete" || e.key === "Backspace") { if (sel) { e.preventDefault(); deleteSel(); } return; }
    if (e.key === "Escape") { if (sel) select(null); else if (mode !== "edit") setMode("edit"); return; }
    const m = MODES.find(x => x[3] === e.key.toLowerCase()); if (m) { e.preventDefault(); setMode(m[0]); }
  };
  document.addEventListener("keydown", onKey);
  const onSelChange = () => { const a = document.activeElement; if (!a || !a.classList || !a.classList.contains("bk") || !sel || sel.kind !== "bk" || sel.b.el !== a) return; const o = caretOffsets(a); if (o) sel.b._sel = o; };
  document.addEventListener("selectionchange", onSelChange);
  stage.addEventListener("wheel", e => { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); const f = Math.exp(-e.deltaY * .0018); rememberZoom(String(Math.round(clamp(s * f, .15, 8) / PX_PER_PT * 100))); setScale(s * f, {x: e.clientX, y: e.clientY}); }, {passive: false});
  (function pinch() {
    const pts = new Map(); let st = null, raf = 0;
    const d2 = () => { const [a, b] = [...pts.values()]; return {d: Math.hypot(a[0] - b[0], a[1] - b[1]), x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2}; };
    stage.addEventListener("pointerdown", e => { if (e.pointerType !== "touch") return; pts.set(e.pointerId, [e.clientX, e.clientY]); if (pts.size === 2) { st = {s, ...d2()}; if (drawing) { drawing.pv.remove(); drawing = null; } } }, true);
    stage.addEventListener("pointermove", e => {
      if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (st && pts.size === 2 && !raf) raf = requestAnimationFrame(() => { raf = 0; if (!st || pts.size < 2) return; const c = d2(); setScale(st.s * c.d / st.d, {x: c.x, y: c.y}); });
    }, true);
    const up = e => { pts.delete(e.pointerId); if (st && pts.size < 2) { st = null; rememberZoom(String(Math.round(s / PX_PER_PT * 100))); } };
    stage.addEventListener("pointerup", up, true); stage.addEventListener("pointercancel", up, true);
  })();
  let rz = 0; const onResize = () => { clearTimeout(rz); rz = setTimeout(() => { if (!closed && (zoomPref === "fitw" || zoomPref === "fitp")) applyZoomPref(); }, 150); };
  window.addEventListener("resize", onResize);

  /* ---------- messages ---------- */
  let toastT = 0;
  function toast(msg, ms = 4500) { const t = $e("[data-toast]"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms); }
  function dialog(title, html, buttons) {
    const d = $e("[data-dlg]"); $e("[data-dh]").textContent = title; $e("[data-db]").innerHTML = html;
    return new Promise(res => {
      $e("[data-df]").innerHTML = buttons.map(([l, c], i) => `<button type="button" class="${c}" data-r="${i}">${esc(l)}</button>`).join("");
      $$e("[data-df] button").forEach(b => b.onclick = () => { d.close(); res(+b.dataset.r); });
      d.onclose = () => res(-1);
      try { d.showModal(); } catch (e) { d.setAttribute("open", ""); }
    });
  }

  /* ---------- save ---------- */
  async function save() {
    const btn = $e("[data-a=save]"); if (btn.disabled) return;
    if (document.activeElement && document.activeElement.classList.contains("bk")) { const b = sel && sel.b; if (b) cacheLines(b); }
    if (commitT) commit();
    btn.disabled = true; const label = btn.innerHTML; btn.innerHTML = '<span class="spin" aria-hidden="true"></span>Saving…';
    try {
      const out = await buildPdf();
      const name = baseName(file.name) + "_edited.pdf"; const blob = pdfBlob(out.bytes);
      saveFile(name, blob); dirty = false;
      const lines = [out.replaced ? plural(out.replaced, "text line") + " replaced (the old words are removed from the file)" : "", out.covered ? plural(out.covered, "line") + " covered with the background colour" : "",
        out.similar ? plural(out.similar, "line") + " used a similar font because the original font doesn't contain those characters" : "", out.images ? plural(out.images, "text box", "text boxes") + " in an Indian language saved as a picture" : "",
        out.scanPatched ? plural(out.scanPatched, "scanned line") + " redrawn using the page's own letters (still searchable)" : "",
        out.others ? plural(out.others, "other change") : ""].filter(Boolean);
      btn.disabled = false; btn.innerHTML = label;
      const r = await dialog("Your PDF is downloaded", `<p>${esc(name)} (${fmtSize(blob.size)})</p>${lines.length ? `<ul>${lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul>` : "<p>No changes were made, so it's the same as your original.</p>"}`, [["Keep editing", "btn ghost"], ["Download again", "btn ghost"], ["Start over", "btn"]]);
      if (r === 1) saveFile(name, blob); else if (r === 2) close(true);
    } catch (e) { console.error(e); toast(e.message || "The PDF couldn't be saved. Try again.", 8000); }
    btn.disabled = false; btn.innerHTML = label;
  }
  /* lines (as drawn) -> per line [{text, st}] using the character styles */
  function lineRunsOf(b, lines) {
    const t = b.text; let i = 0;
    return lines.map(line => {
      const segs = [];
      for (const ch of line) {
        while (i < t.length && t[i] !== ch && /\s/.test(t[i])) i++;
        const st = t[i] === ch && b.cs ? b.cs[i] || null : null; if (t[i] === ch) i++;
        const l = segs[segs.length - 1]; if (l && csKey(l.st) === csKey(st)) l.text += ch; else segs.push({text: ch, st});
      }
      while (i < t.length && /\s/.test(t[i])) i++;
      return segs;
    });
  }
  async function buildPdf() {
    const d = await PDFLib.PDFDocument.load(bytes, {ignoreEncryption: true, throwOnInvalidObject: false});
    if (d.isEncrypted) throw new Error("This PDF is password-protected, so it can't be changed here. Save a copy without the password first.");
    const SF = PDFLib.StandardFonts; const NAMES = {sans: ["Helvetica", "HelveticaBold", "HelveticaOblique", "HelveticaBoldOblique"], serif: ["TimesRoman", "TimesRomanBold", "TimesRomanItalic", "TimesRomanBoldItalic"], mono: ["Courier", "CourierBold", "CourierOblique", "CourierBoldOblique"]};
    const stdFonts = {}; const stat = {replaced: 0, covered: 0, similar: 0, images: 0, others: 0};
    const getStd = async (fam, bold, it) => { fam = NAMES[fam] ? fam : "sans"; const key = fam + (bold ? 1 : 0) + (it ? 1 : 0); return stdFonts[key] || (stdFonts[key] = await d.embedFont(SF[NAMES[fam][(bold ? 1 : 0) + (it ? 2 : 0)]])); };
    const sameText = (out, t) => out && out.join("\n").replace(/\s+/g, " ").trim() === t.replace(/\s+/g, " ").trim();
    for (const p of pages) {
      const edited = p.blocks.filter(changed); const imgs = p.images.filter(imgChanged);
      if (!edited.length && !imgs.length) continue;
      const pageObj = d.getPage(p.n - 1); const F = pageFrame(pageObj); const node = pageObj.node;
      let csp = null; try { csp = csReadPage(d, p.n - 1, p.vt); } catch (e) { console.warn(e); csp = null; }
      const names = {}; const moreEdits = [];
      const specs = edited.flatMap(b => {
        const fam = famOf(b), bold = boldOf(b), ital = italOf(b), size = sizeOf(b), gap = gapOf(b), wrap = wrapOf(b);
        const keep = !b.isNew && !b.ocr && (!b.fam2 || b.fam2 === "orig") && bold === !!b.font.bold && ital === !!b.font.italic;
        const lines = b.text.trim() ? (sameText(b.out, b.text) ? b.out : layoutText(b.text, t => measureCss(fam, bold, ital, size, t) * ratioOf(b), wrap)) : [];
        const color = b.color2 ? hexRgb(b.color2) : b.color && !b.ocr ? b.color : (b.fg || [17, 17, 17]).map(v => v / 255);
        const spec = {isNew: !!b.isNew, origLines: b.lines || [], cover: b.isNew ? null : coverRect(b), bg: (b.bg || [255, 255, 255]).map(v => v / 255), lines,
          x0: b.x + b.dx, base0: b.base0 + dyOf(b), gap, size, wrap, align: alignOf(b), color, keepFont: keep, hscale: ffOf(b) ? 1 : ratioOf(b), bold, italic: ital, stdFam: fam, underline: !!b.underline, _b: b};
        /* only the lines whose words changed are rewritten; untouched lines of the same block keep their original glyphs */
        if (hasCs(b)) spec.lineRuns = lineRunsOf(b, lines);
        const styled = hasCs(b) || b.size2 != null || b.fam2 != null || b.bold2 != null || b.italic2 != null || b.underline || b.align2 != null || b.ls2 != null || b.color2 != null || b.fitSize != null || b.wrap2 != null || b.h2 != null;
        if (b.isNew || styled || b.dx || dyOf(b) || !b.lines || b.lines.length < 2 || lines.length !== b.lines.length) return [spec];
        return b.lines.map((ln, i) => lines[i].trim() === ln.text.trim() ? null : {...spec, origLines: [ln], cover: coverRect({...b, ox: ln.x, wOrig: ln.w, top: ln.top, bottom: ln.bottom}), lines: [lines[i]], base0: ln.base, x0: alignOf(b) === "left" ? ln.x : spec.x0}).filter(Boolean);
      });
      /* the PDF's own Bold / Italic faces of a family, when the page uses them */
      const variant = (baseFont, bold, ital) => {
        if (!csp || !baseFont) return null; const fam = baseFont.replace(/^[A-Z]{6}\+/, "").split(/[-,_]/)[0].toLowerCase();
        const sh = csp.shows.find(x => x.font && x.font.baseFont && !x.inForm && x.font.baseFont.replace(/^[A-Z]{6}\+/, "").toLowerCase().startsWith(fam) && (() => { const fi = fontFromName(x.font.baseFont, ""); return fi.bold === bold && fi.italic === ital; })());
        return sh ? {font: sh.font, fname: sh.fname} : null;
      };
      const helpers = {
        getStd, variant, stdName: f => names[f.name] || (names[f.name] = node.newFontDictionary(f.name, f.ref).toString().replace(/^\//, "")),
        image: async ed => { const r = await linesToPng(ed.lines, famOf(ed._b), ed.bold, ed.italic, ed.size, ed.gap, colourOf(ed._b), ed.align, ed.wrap); return {bytes: dataUrlBytes(r.url), top: r.top, w: r.w, h: r.h}; }
      };
      let patchOps = "";
      if (SM() && p.ocr) for (const sp of specs) {
        const b = sp._b; if (!b.ocr || b.isNew || sp.origLines.length !== 1) continue;
        const sm = b.sm && b.sm.text === b.text ? b.sm : await smRun(b); if (!sm) continue;
        const li = b.lines.indexOf(sp.origLines[0]); const hit = sm.patches.find(q => q.i === li); if (!hit) continue;
        const r = hit.r; const k = p.ocr.sc;
        const blob = await canvasBlob(smCanvas(r.patch), "image/png"); const png = await d.embedPng(new Uint8Array(await blob.arrayBuffer()));
        const nm = node.newXObject("DbxScan", png.ref).toString().replace(/^\//, "");
        /* OCR-image pixels (top-left origin) -> visible points -> PDF space (y flips, crop box and rotation via pageFrame) */
        const vx = r.x / k, vy = r.y / k, vw = r.w / k, vh = r.h / k; const [x, y] = F.pt(vx, vy + vh); const [c, s2] = F.vec(1, 0);
        patchOps += "q " + [c * vw, s2 * vw, -s2 * vh, c * vh, x, y].map(v => Math.round(v * 1000) / 1000).join(" ") + " cm /" + nm + " Do Q\n";
        sp.cover = null; sp.invisible = true; stat.scanPatched = (stat.scanPatched || 0) + 1; /* the new words stay searchable as invisible text */
      }
      const res = await csApplyTextEdits(d, p.n - 1, csp, F, specs, helpers);
      if (patchOps) res.ops = patchOps + res.ops;
      for (const k of ["replaced", "covered", "similar", "images"]) stat[k] += res.stat[k];
      for (const im of imgs) {
        stat.others++;
        if (im.del) { moreEdits.push({s: im.s, e: im.e, text: " "}); continue; }
        let name = im.name;
        if (im.repl) { const emb = await d.embedPng(dataUrlBytes(im.repl.url)); name = node.newXObject("DbxIm", emb.ref).toString().replace(/^\//, ""); }
        const X = imageCm(im.ctm, p.vt, {x: im.vx, y: im.vy, w: im.vw, h: im.vh}, {x: im.x, y: im.y, w: im.w, h: im.h}, im.q);
        moreEdits.push({s: im.s, e: im.e, text: " q " + X.map(v => (Math.round(v * 10000) / 10000)).join(" ") + " cm /" + name + " Do Q "});
      }
      if (csp) csWritePage(d, p.n - 1, csp, res.remove, res.ops, moreEdits);
      else if (res.ops) { const ref = d.context.register(d.context.flateStream("q\n" + res.ops + "Q\n")); node.addContentStream(ref); }
    }
    for (const it of items) {
      stat.others++;
      const pg = d.getPage(it.page - 1); const F = pageFrame(pg); const col = PDFLib.rgb(...hexRgb(it.color || "#000000"));
      if (it.type === "img") pg.drawImage(await d.embedPng(dataUrlBytes(imgReg[it.img])), itemBox(F, it));
      else if (it.type === "rect") pg.drawRectangle({...itemBox(F, it), color: col});
      else if (it.type === "hl") pg.drawRectangle({...itemBox(F, it), color: col, opacity: .42, ...(PDFLib.BlendMode ? {blendMode: PDFLib.BlendMode.Multiply} : {})});
      else if (it.type === "shape") pg.drawRectangle({...itemBox(F, it), borderColor: col, borderWidth: it.width, ...(it.fill ? {color: col} : {})});
      else if (it.type === "ink") {
        const pts = it.pts.map(q => F.pt((it.fx + q[0] * it.fw) * F.W, (it.fy + q[1] * it.fh) * F.H));
        const cap = PDFLib.LineCapStyle ? {lineCap: PDFLib.LineCapStyle.Round} : {};
        if (pts.length === 1) pg.drawCircle({x: pts[0][0], y: pts[0][1], size: it.width / 2, color: col});
        for (let i = 1; i < pts.length; i++) pg.drawLine({start: {x: pts[i - 1][0], y: pts[i - 1][1]}, end: {x: pts[i][0], y: pts[i][1]}, thickness: it.width, color: col, ...cap});
      }
    }
    return {bytes: await d.save(), ...stat};
  }

  /* ---------- closing ---------- */
  function closeAsk() { return !dirty || confirm("You have changes that aren't downloaded yet. Close the editor and lose them?"); }
  const onPop = () => {
    if (closed) return; pushed = false;
    if (!closeAsk()) { try { history.pushState({dbxEditor: 1}, ""); pushed = true; } catch (e) { /* ignore */ } return; }
    close(true, true);
  };
  window.addEventListener("popstate", onPop);
  function close(force, fromPop) {
    if (closed) return true;
    if (!force && !closeAsk()) return false;
    closed = true; runTok++;
    document.removeEventListener("keydown", onKey); document.removeEventListener("selectionchange", onSelChange); window.removeEventListener("resize", onResize); window.removeEventListener("popstate", onPop);
    io.disconnect(); tio.disconnect();
    root.remove(); document.body.classList.remove("edx-open");
    try { pdf.destroy(); } catch (e) { /* already closed */ }
    if (pushed && !fromPop) { pushed = false; try { history.back(); } catch (e) { /* ignore */ } }
    onClosed(); P.restart();
    return true;
  }

  /* ---------- signature and other tools ---------- */
  async function signature() {
    const html = '<div class="seg" role="group" aria-label="How to sign" data-sgt style="display:flex;margin-bottom:10px"><button type="button" aria-pressed="true" data-t="draw" style="flex:1">Draw</button><button type="button" aria-pressed="false" data-t="type" style="flex:1">Type</button></div>' +
      '<canvas class="sigpad" data-sgpad aria-label="Draw your signature here"></canvas><div data-sgtype hidden><label class="f">Your name<input type="text" data-sgname maxlength="40" autocomplete="name"></label></div>' +
      '<p class="fl-meta" style="margin:8px 0 0">Next, click on the page where the signature should go. Drag its corner to resize it.</p>';
    let tab = "draw", drawn = false;
    const pr = dialog("Your signature", html, [["Cancel", "btn ghost"], ["Use this signature", "btn"]]);
    const pad = $e("[data-sgpad]"); const dpr = window.devicePixelRatio || 1; const rc = pad.getBoundingClientRect(); pad.width = Math.max(300, rc.width) * dpr; pad.height = 160 * dpr;
    const g = pad.getContext("2d"); g.scale(dpr, dpr); g.lineCap = g.lineJoin = "round"; g.lineWidth = 2.6; g.strokeStyle = "#111"; let down = false;
    const pos = e => { const r = pad.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    pad.onpointerdown = e => { down = true; pad.setPointerCapture(e.pointerId); g.beginPath(); g.moveTo(...pos(e)); g.lineTo(...pos(e)); g.stroke(); drawn = true; };
    pad.onpointermove = e => { if (down) { g.lineTo(...pos(e)); g.stroke(); } };
    pad.onpointerup = () => { down = false; };
    $$e("[data-sgt] button").forEach(b => b.onclick = () => { tab = b.dataset.t; $$e("[data-sgt] button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); pad.hidden = tab !== "draw"; $e("[data-sgtype]").hidden = tab !== "type"; });
    const r = await pr; if (r !== 1) return;
    let c = null;
    if (tab === "draw" && drawn) c = trimCanvas(pad);
    else if (tab === "type") {
      const name = ($e("[data-sgname]") || {}).value || "";
      if (name.trim()) { try { await document.fonts.load("80px Caveat"); } catch (e) { /* fallback */ } const t = document.createElement("canvas"); t.width = 1400; t.height = 220; const tg = t.getContext("2d"); tg.font = "96px Caveat, cursive"; tg.fillStyle = "#111"; tg.textBaseline = "middle"; tg.fillText(name.trim(), 20, 110); c = trimCanvas(t); }
    }
    if (!c) { toast("No signature was made."); return; }
    const id = "i" + (++uid); imgReg[id] = c.toDataURL("image/png"); pendingImg = {id, ar: c.height / c.width, w: Math.min(c.width, 360)};
    $e("[data-pickt]").textContent = "Signature"; setMode("img"); toast("Click on the page where your signature should go.");
  }
  async function gotoTool(id) {
    let f = file;
    if (dirty) {
      const r = await dialog("Use your edited PDF?", "<p>" + esc(TOOLS.find(t => t.id === id).name) + " will open with this file. Include the changes you made here?</p>", [["Cancel", "btn ghost"], ["Use the original", "btn ghost"], ["Include my changes", "btn"]]);
      if (r <= 0) return;
      if (r === 2) { try { const out = await buildPdf(); f = new File([out.bytes], baseName(file.name) + "_edited.pdf", {type: "application/pdf"}); } catch (e) { toast(e.message); return; } }
    }
    window.dbxHandoff = [f]; dirty = false; close(true); setTimeout(() => { location.hash = "#/t/" + id; }, 50);
  }

  /* ---------- start ---------- */
  root.classList.toggle("panel-open", innerWidth >= 1100); $e("[data-a=panel]").setAttribute("aria-expanded", String(innerWidth >= 1100));
  setMode("edit"); syncFmt({...def, hasOrig: false}); zoomLabel();
  void root.offsetWidth; applyZoomPref(); stage.scrollTop = 0; setCur(1);
  pages.slice(0, 2).forEach(p => { p.visible = true; }); renderNext();
  commit(); dirty = false;
  if (!pl) toast("This PDF's structure couldn't be fully read. You can still edit, but old text will be covered rather than removed.", 7000);
  pump();
  stage.focus({preventScroll: true});
  return {close, closeAsk, toast};
}
