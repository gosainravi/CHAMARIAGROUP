/* Daftarbox PDF tools – the tools. Each has options (HTML) and run(files, options, progress) -> {files, summary}. */
"use strict";

const PAGE_SIZES = {a4: [595.28, 841.89], letter: [612, 792]};
const rangeField = (label = "Pages", hint = "Leave empty for all pages, or type pages like 1, 3-5.") =>
  `<label class="f">${label}<input type="text" name="pages" placeholder="All pages" autocomplete="off"><span class="h">${hint}</span></label>`;

/* ================= Organise ================= */
T({id: "merge", cat: "organise", name: "Merge PDF", desc: "Join several PDFs into one file, in any order you like.",
  exts: EXT.pdf, multiple: true, min: 2, libs: ["pdflib"], action: "Merge PDFs", pick: "Select PDF files",
  hint: "Files are joined from top to bottom. Use the arrows to change the order.",
  async run(files, o, prog) {
    const out = await PDFLib.PDFDocument.create();
    for (let i = 0; i < files.length; i++) {
      const src = await loadPL(files[i]);
      (await out.copyPages(src, src.getPageIndices())).forEach(p => out.addPage(p));
      prog((i + 1) / files.length);
    }
    return {files: [{name: "merged.pdf", blob: pdfBlob(await out.save())}], summary: "Joined " + plural(files.length, "file") + " into one PDF with " + plural(out.getPageCount(), "page") + "."};
  }});

T({id: "split", cat: "organise", name: "Split PDF", desc: "Cut one PDF into smaller files by page, by range or every few pages.",
  exts: EXT.pdf, libs: ["pdflib"], action: "Split PDF",
  options: () => `<fieldset class="f fs"><legend>How to split</legend>${radios("mode", [["each", "Every page as its own file"], ["ranges", "By page ranges I choose"], ["every", "Every few pages"]], "each")}</fieldset>
    <label class="f" data-show="mode=ranges">Ranges<input type="text" name="ranges" placeholder="1-3, 4-6, 9" autocomplete="off"><span class="h">Each range becomes one file.</span></label>
    <label class="f" data-show="mode=every">Pages in each file<input type="number" name="n" value="2" min="1"></label>`,
  async run(files, o, prog) {
    const src = await loadPL(files[0]); const n = src.getPageCount(); const b = baseName(files[0].name);
    const groups = o.mode === "ranges" ? parseRanges(o.ranges, n) : o.mode === "every" ? chunkGroups(n, +o.n) : src.getPageIndices().map(i => ({label: String(i + 1), idx: [i]}));
    if (groups.length > 1000) throw new Error("That would make more than 1,000 files. Choose bigger ranges.");
    const outs = [];
    for (let i = 0; i < groups.length; i++) { outs.push({name: b + "_pages_" + groups[i].label + ".pdf", blob: await subsetPdf(src, groups[i].idx)}); prog((i + 1) / groups.length); }
    return {files: outs, zipName: b + "_split", summary: "Made " + plural(outs.length, "file") + " from " + plural(n, "page") + "."};
  }});

T({id: "organise", cat: "organise", name: "Organise pages", desc: "See every page, then drag to reorder, rotate or delete.",
  exts: EXT.pdf, mount: mountOrganize});

T({id: "rotate", cat: "organise", name: "Rotate PDF", desc: "Turn sideways or upside-down pages the right way round.",
  exts: EXT.pdf, libs: ["pdflib"], action: "Rotate PDF",
  options: () => `<label class="f">Turn pages<select name="angle"><option value="90">90° clockwise</option><option value="270">90° anticlockwise</option><option value="180">Upside down (180°)</option></select></label>
    ${rangeField()}<p class="note">Want to turn pages one by one? Use Organise pages to see each page first.</p>`,
  async run(files, o) {
    const d = await loadPL(files[0]); const n = d.getPageCount(); const set = pageSet(o.pages, n);
    d.getPages().forEach((p, i) => { if (!set || set.has(i)) p.setRotation(PDFLib.degrees((p.getRotation().angle + +o.angle) % 360)); });
    return {files: [{name: baseName(files[0].name) + "_rotated.pdf", blob: pdfBlob(await d.save())}], summary: "Turned " + (set ? set.size : n) + " of " + plural(n, "page") + "."};
  }});

T({id: "remove", cat: "organise", name: "Remove pages", desc: "Take out blank or unwanted pages in seconds.",
  exts: EXT.pdf, libs: ["pdflib"], action: "Remove pages",
  options: () => `<label class="f">Pages to remove<input type="text" name="pages" placeholder="e.g. 2, 5-7" autocomplete="off"><span class="h">Separate pages with commas. Use a dash for a range.</span></label>`,
  async run(files, o) {
    const src = await loadPL(files[0]); const n = src.getPageCount();
    const del = new Set(parseRanges(o.pages, n).flatMap(g => g.idx));
    const keep = src.getPageIndices().filter(i => !del.has(i));
    if (!keep.length) throw new Error("That would remove every page. Leave at least one page in.");
    return {files: [{name: baseName(files[0].name) + "_edited.pdf", blob: await subsetPdf(src, keep)}], summary: "Removed " + plural(del.size, "page") + ". " + plural(keep.length, "page") + " left."};
  }});

T({id: "extract", cat: "organise", name: "Extract pages", desc: "Copy just the pages you need into a new PDF.",
  exts: EXT.pdf, libs: ["pdflib"], action: "Extract pages",
  options: () => `<label class="f">Pages to keep<input type="text" name="pages" placeholder="e.g. 1, 4-6" autocomplete="off"><span class="h">Pages come out in the order you type them, so 5-1 reverses them.</span></label>
    <label class="check"><input type="checkbox" name="sep"> Save each page as a separate file</label>`,
  async run(files, o) {
    const src = await loadPL(files[0]); const n = src.getPageCount(); const b = baseName(files[0].name);
    const idx = [...new Set(parseRanges(o.pages, n).flatMap(g => g.idx))];
    if (o.sep) { const outs = []; for (const i of idx) outs.push({name: b + "_page_" + (i + 1) + ".pdf", blob: await subsetPdf(src, [i])}); return {files: outs, zipName: b + "_pages", summary: "Saved " + plural(outs.length, "page") + " as separate files."}; }
    return {files: [{name: b + "_extract.pdf", blob: await subsetPdf(src, idx)}], summary: "New PDF with " + plural(idx.length, "page") + "."};
  }});

/* ================= Optimise ================= */
T({id: "compress", cat: "optimise", name: "Compress PDF", desc: "Make big PDFs small enough to email or upload.",
  exts: EXT.pdf, libs: ["pdflib", "pdfjs"], action: "Compress PDF",
  options: () => `<fieldset class="f fs"><legend>How much to compress</legend>${radios("level", [["strong", "Smallest file &ndash; lower quality"], ["balanced", "Recommended &ndash; good balance"], ["light", "Light &ndash; best quality"]], "balanced")}</fieldset>
    <p class="note">Each page is turned into a picture to save space, so the text in the result can't be selected, searched or copied. Best for scans and photo-heavy PDFs.</p>`,
  async run(files, o, prog) {
    const f = files[0]; const cfg = {strong: [72, .5], balanced: [110, .65], light: [150, .78]}[o.level] || [110, .65];
    const pdf = await pdfjsOpen(f); const out = await PDFLib.PDFDocument.create();
    try {
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i); const vp1 = page.getViewport({scale: 1});
        const c = await renderPage(page, cfg[0] / 72);
        const jb = await canvasBlob(c, "image/jpeg", cfg[1]); c.width = c.height = 0;
        const img = await out.embedJpg(await jb.arrayBuffer());
        out.addPage([vp1.width, vp1.height]).drawImage(img, {x: 0, y: 0, width: vp1.width, height: vp1.height});
        page.cleanup(); prog(i / pdf.numPages);
      }
    } finally { pdf.destroy(); }
    const bytes = await out.save();
    if (bytes.length >= f.size) return {files: [{name: f.name, blob: f}], summary: "This PDF is already well optimised, so compressing would have made it bigger. Here is your original file, unchanged. You can try 'Smallest file' for more savings."};
    const pct = Math.round((1 - bytes.length / f.size) * 100);
    return {files: [{name: baseName(f.name) + "_compressed.pdf", blob: pdfBlob(bytes)}], summary: "Down from " + fmtSize(f.size) + " to " + fmtSize(bytes.length) + " (" + pct + "% smaller)."};
  }});

T({id: "repair", cat: "optimise", name: "Repair PDF", desc: "Try to fix a PDF that won't open or shows errors.",
  exts: EXT.pdf, libs: ["pdflib"], action: "Repair PDF",
  options: () => `<p class="note">We rebuild the file's internal structure and save a clean copy. If that isn't enough, we rescue each page that can still be read.</p>`,
  async run(files, o, prog) {
    const f = files[0]; const b = baseName(f.name); let src = null;
    try { src = await PDFLib.PDFDocument.load(await f.arrayBuffer(), {ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false}); } catch (e) { src = null; }
    if (src && src.isEncrypted) throw new Error(f.name + " is password-protected, not damaged. Open it in your PDF reader, save a copy without the password, then try again.");
    prog(.3);
    if (src) {
      try {
        const d = await PDFLib.PDFDocument.create();
        (await d.copyPages(src, src.getPageIndices())).forEach(p => d.addPage(p));
        try { const t = src.getTitle(); if (t) d.setTitle(t); const a = src.getAuthor(); if (a) d.setAuthor(a); } catch (e) { /* metadata is optional */ }
        if (d.getPageCount()) {
          const bytes = await d.save(); prog(1);
          return {files: [{name: b + "_repaired.pdf", blob: pdfBlob(bytes)}], summary: "Rebuilt the file's structure and recovered all " + plural(d.getPageCount(), "page") + "."};
        }
      } catch (e) { /* fall back to page rescue */ }
    }
    let pdf;
    try { pdf = await pdfjsOpen(f); }
    catch (e) { throw new Error("We couldn't recover " + f.name + ". It may be too badly damaged, cut short while downloading, or not a PDF at all. If you can, download or export it again."); }
    const out = await PDFLib.PDFDocument.create(); let lost = 0;
    try {
      for (let i = 1; i <= pdf.numPages; i++) {
        try {
          const page = await pdf.getPage(i); const vp1 = page.getViewport({scale: 1});
          const c = await renderPage(page, 150 / 72); const jb = await canvasBlob(c, "image/jpeg", .85); c.width = c.height = 0;
          out.addPage([vp1.width, vp1.height]).drawImage(await out.embedJpg(await jb.arrayBuffer()), {x: 0, y: 0, width: vp1.width, height: vp1.height});
          page.cleanup();
        } catch (e) { lost++; }
        prog(.3 + .7 * i / pdf.numPages);
      }
    } finally { pdf.destroy(); }
    if (!out.getPageCount()) throw new Error("None of the pages in " + f.name + " could be read, so there's nothing to recover.");
    return {files: [{name: b + "_repaired.pdf", blob: pdfBlob(await out.save())}],
      summary: "Rescued " + plural(out.getPageCount(), "page") + (lost ? ". " + plural(lost, "page") + " couldn't be read and were left out." : "."),
      note: "The file was badly damaged, so pages were rebuilt as pictures. Text in the repaired file can't be selected or searched."};
  }});

T({id: "ocr", cat: "optimise", name: "OCR PDF", desc: "Make scanned PDFs searchable, so you can find and copy their text.", isNew: true,
  lede: "We read the words on scanned pages and add them as hidden text. The pages look exactly the same, but you can now search, select and copy.",
  exts: EXT.pdf, libs: ["pdflib", "pdfjs"], action: "Make searchable",
  options: () => `<label class="f">Language of the text<select name="lang">${OCR_LANGS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select><span class="h">Each language downloads once, the first time you use it.</span></label>
    <label class="f">Reading quality<select name="dpi"><option value="200">Standard (faster)</option><option value="300" selected>Best</option></select></label>
    <label class="check"><input type="checkbox" name="skip" checked> Skip pages that already have text</label>
    <label class="check"><input type="checkbox" name="txt"> Also save the text as a .txt file</label>
    <p class="note">OCR is only as good as the scan: clear, straight, well-lit pages work best. Hindi and other Indian-language words are saved in the .txt file; the hidden text layer in the PDF holds English letters and numbers only.</p>`,
  onLoad(files, form) { try { const l = localStorage.getItem(LANG_KEY); if (l && OCR_LANGS.some(x => x[0] === l)) form.elements.lang.value = l; } catch (e) { /* storage blocked */ } },
  async run(files, o, prog) {
    try { localStorage.setItem(LANG_KEY, o.lang); } catch (e) { /* storage blocked */ }
    const f = files[0]; const pdf = await pdfjsOpen(f); const d = await loadPL(f); const font = await d.embedFont(PDFLib.StandardFonts.Helvetica);
    const n = pdf.numPages; const texts = []; let read = 0, skipped = 0, words = 0, other = 0;
    try {
      for (let i = 1; i <= n; i++) {
        const page = await pdf.getPage(i);
        try {
          const tc = await page.getTextContent();
          if (o.skip && countChars(tc.items) >= 8) { skipped++; texts.push(itemsToLines(tc.items).map(l => l.text).join("\n")); prog(i / n, "Page " + i + " of " + n + " already has text."); continue; }
          const vp1 = page.getViewport({scale: 1});
          prog((i - 1) / n, "Reading page " + i + " of " + n + "…");
          const c = await renderPage(page, (+o.dpi || 300) / 72); const sc = c.width / vp1.width;
          let data;
          try { data = await ocrCanvas(c, o.lang, m => { if (m.status === "recognizing text") prog((i - 1 + m.progress) / n, "Reading page " + i + " of " + n + "… " + Math.round(m.progress * 100) + "%"); else if (/load|initiali/i.test(m.status)) prog((i - 1) / n, "Getting the text reader ready. The first time can take a minute…"); }); }
          finally { c.width = c.height = 0; }
          texts.push((data.text || "").trim());
          const pg = d.getPage(i - 1); const F = pageFrame(pg);
          for (const w of ocrWordsPt(ocrDataLines(data), sc)) {
            const cl = cleanForFont(font, w.text); if (cl.bad) { other++; continue; }
            const unit = font.widthOfTextAtSize(cl.text, 1); if (!unit) continue;
            const h = Math.max(1, (w.base - w.y0) / .72);
            const size = clamp((w.x1 - w.x0) / unit, h * .5, h * 2);
            const [x, y] = F.pt(w.x0, w.base);
            pg.drawText(cl.text, {x, y, size, font, opacity: 0, rotate: PDFLib.degrees(F.r)}); words++;
          }
          read++;
        } finally { page.cleanup(); }
      }
    } finally { pdf.destroy(); }
    if (!read) throw new Error("Every page in this PDF already has text, so there was nothing to read. Untick 'Skip pages that already have text' to read them anyway.");
    const b = baseName(f.name); const outs = [{name: b + "_searchable.pdf", blob: pdfBlob(await d.save())}];
    if (o.txt) outs.push({name: b + ".txt", blob: new Blob([texts.map((t, i) => "----- Page " + (i + 1) + " -----\r\n\r\n" + t.replace(/\r?\n/g, "\r\n")).join("\r\n\r\n")], {type: "text/plain;charset=utf-8"})});
    return {files: outs, zipName: b + "_ocr",
      summary: "Read " + plural(read, "page") + " and added " + words.toLocaleString("en-IN") + " words as hidden, searchable text." + (skipped ? " " + plural(skipped, "page") + " already had text and " + (skipped === 1 ? "was" : "were") + " left as is." : ""),
      note: other ? plural(other, "word") + " in Hindi or another Indian script couldn't go into the hidden text layer (the built-in PDF fonts can't hold them)." + (o.txt ? " They are in the .txt file." : " Tick 'Also save the text as a .txt file' to keep them.") : ""};
  }});

/* ================= Convert ================= */T({id: "pdf2word", cat: "convert", name: "PDF to Word", desc: "Get the text out of a PDF into an editable Word file.",
  exts: EXT.pdf, libs: ["pdfjs", "jszip"], action: "Convert to Word",
  options: () => `<p class="note">Copies the text, headings and paragraphs into Word so you can edit them. The exact layout, tables and pictures aren't kept. Scanned PDFs have no text to copy.</p>`,
  async run(files, o, prog) {
    const pages = await extractPages(files[0], p => prog(p * .9));
    const hs = pages.flatMap(ls => ls.map(l => l.h)).sort((a, b) => a - b);
    const total = pages.reduce((s, ls) => s + ls.reduce((a, l) => a + l.text.length, 0), 0);
    if (total < 20) throw new Error("This PDF has no text we can copy. It's probably a scan or a photo of a document.");
    const med = hs[Math.floor(hs.length / 2)] || 10; const paras = [];
    pages.forEach((ls, pi) => { paras.push(...linesToParas(ls, med)); if (pi < pages.length - 1) paras.push({pageBreak: true}); });
    const out = paras.map(p => p.pageBreak ? p : {text: p.text, bold: p.big, sz: p.big ? Math.min(48, Math.max(26, Math.round(p.h * 1.6))) : 22});
    const blob = await makeDocx(out); prog(1);
    return {files: [{name: baseName(files[0].name) + ".docx", blob}], summary: "Turned " + plural(pages.length, "page") + " into an editable Word document."};
  }});

T({id: "word2pdf", cat: "convert", name: "Word to PDF", desc: "Turn a .docx document into a tidy PDF.",
  exts: EXT.docx, libs: ["mammoth", "pdflib"], action: "Convert to PDF", pick: "Select Word file",
  options: () => `<label class="f">Page size<select name="size"><option value="a4">A4</option><option value="letter">Letter</option></select></label>
    <p class="note">Keeps headings, paragraphs, lists and table text in a clean layout. Pictures and exact Word styling aren't carried over. Old .doc files need to be saved as .docx first.</p>
    <p class="warn">Hindi and other Indian scripts can't be drawn by the built-in PDF fonts yet, so those letters will show as "?". For Hindi documents, use Save as PDF in Word instead.</p>`,
  async run(files, o, prog) {
    let html;
    try { html = (await mammoth.convertToHtml({arrayBuffer: await files[0].arrayBuffer()})).value; }
    catch (e) { throw new Error(files[0].name + " couldn't be read. Make sure it's a .docx file and not an older .doc file."); }
    prog(.3);
    const dom = new DOMParser().parseFromString("<div>" + html + "</div>", "text/html").body.firstChild;
    const blocks = [];
    const walk = (el, depth) => {
      for (const n of el.children) {
        const tag = n.tagName.toLowerCase();
        if (/^h[1-6]$/.test(tag)) blocks.push({t: n.textContent, kind: "h" + tag[1]});
        else if (tag === "p") { const t = n.textContent; const bold = n.children.length === 1 && /^(strong|b)$/i.test(n.children[0].tagName) && n.children[0].textContent === t; blocks.push({t, kind: bold ? "pb" : "p"}); }
        else if (tag === "ul" || tag === "ol") { let k = 0; for (const li of n.children) { if (li.tagName !== "LI") continue; k++; const own = [...li.childNodes].filter(c => !(c.nodeType === 1 && /^(UL|OL)$/.test(c.tagName))).map(c => c.textContent).join(""); blocks.push({t: own, kind: "li", depth, mark: tag === "ol" ? k + "." : "•"}); for (const sub of li.children) if (/^(UL|OL)$/.test(sub.tagName)) walk({children: [sub]}, depth + 1); } }
        else if (tag === "table") { for (const tr of n.querySelectorAll("tr")) blocks.push({t: [...tr.children].map(c => c.textContent.trim()).join("   |   "), kind: "p"}); blocks.push({t: "", kind: "p"}); }
        else if (n.children.length) walk(n, depth);
        else if (n.textContent.trim()) blocks.push({t: n.textContent, kind: "p"});
      }
    };
    walk(dom, 0);
    if (!blocks.some(b => b.t.trim())) throw new Error("This document has no text to convert.");
    const d = await PDFLib.PDFDocument.create();
    const reg = await d.embedFont(PDFLib.StandardFonts.Helvetica), bold = await d.embedFont(PDFLib.StandardFonts.HelveticaBold);
    const [W, H] = PAGE_SIZES[o.size] || PAGE_SIZES.a4; const M = 60;
    let page = null, y = 0, replaced = 0;
    const newPage = () => { page = d.addPage([W, H]); y = H - M; };
    newPage();
    const style = {h1: [bold, 20, 14, 8], h2: [bold, 16, 12, 6], h3: [bold, 13.5, 10, 4], h4: [bold, 12, 8, 4], h5: [bold, 11, 8, 4], h6: [bold, 11, 8, 4], p: [reg, 11, 0, 7], pb: [bold, 11, 0, 7], li: [reg, 11, 0, 3]};
    for (const b of blocks) {
      const [font, size, before, after] = style[b.kind] || style.p;
      const indent = b.kind === "li" ? 18 + (b.depth || 0) * 18 : 0;
      const c = cleanForFont(font, b.t.replace(/\s+/g, " ").trim()); replaced += c.bad;
      const lh = size * 1.38;
      if (!c.text) { y -= lh * .6; continue; }
      y -= before;
      wrapText(c.text, font, size, W - 2 * M - indent).forEach((ln, i) => {
        if (y - lh < M) newPage();
        if (i === 0 && b.kind === "li") page.drawText(cleanForFont(font, b.mark).text, {x: M + indent - 14, y: y - size, size, font});
        page.drawText(ln, {x: M + indent, y: y - size, size, font, color: PDFLib.rgb(.08, .09, .11)});
        y -= lh;
      });
      y -= after;
    }
    prog(1);
    return {files: [{name: baseName(files[0].name) + ".pdf", blob: pdfBlob(await d.save())}],
      summary: "Made a PDF with " + plural(d.getPageCount(), "page") + ".",
      note: replaced ? replaced + " characters the PDF font can't show (for example Hindi or other non-English letters) were replaced with ?." : ""};
  }});

T({id: "pdf2jpg", cat: "convert", name: "PDF to JPG", desc: "Save each page as a JPG or PNG picture.",
  exts: EXT.pdf, libs: ["pdfjs"], action: "Convert to images",
  options: () => `<div class="row2"><label class="f">Format<select name="fmt"><option value="jpg">JPG</option><option value="png">PNG</option></select></label>
    <label class="f">Quality<select name="dpi"><option value="100">Standard</option><option value="150" selected>High</option><option value="220">Print</option></select></label></div>
    ${rangeField()}`,
  async run(files, o, prog) {
    const pdf = await pdfjsOpen(files[0]); const n = pdf.numPages; const b = baseName(files[0].name);
    const outs = []; const png = o.fmt === "png";
    try {
      const set = pageSet(o.pages, n); const idx = set ? [...set] : [...Array(n).keys()];
      for (let k = 0; k < idx.length; k++) {
        const page = await pdf.getPage(idx[k] + 1); const c = await renderPage(page, (+o.dpi || 150) / 72);
        outs.push({name: b + "_page-" + (idx[k] + 1) + (png ? ".png" : ".jpg"), blob: await canvasBlob(c, png ? "image/png" : "image/jpeg", .9)});
        c.width = c.height = 0; page.cleanup(); prog((k + 1) / idx.length);
      }
    } finally { pdf.destroy(); }
    return {files: outs, zipName: b + "_images", summary: "Saved " + plural(outs.length, "page") + " as " + (png ? "PNG" : "JPG") + " images."};
  }});

T({id: "jpg2pdf", cat: "convert", name: "JPG to PDF", desc: "Put photos and scans (JPG, PNG, WebP) together in one PDF.",
  exts: EXT.img, multiple: true, min: 1, libs: ["pdflib"], action: "Convert to PDF", pick: "Select images",
  hint: "Each image becomes one page, from top to bottom. Use the arrows to change the order.",
  options: () => `<label class="f">Page size<select name="size"><option value="a4" selected>A4</option><option value="letter">Letter</option><option value="fit">Same as each image</option></select></label>
    <label class="f">Orientation<select name="orient"><option value="auto">Match each image</option><option value="p">Portrait</option><option value="l">Landscape</option></select></label>
    <label class="f">Margin<select name="margin"><option value="0">None</option><option value="20" selected>Small</option><option value="45">Large</option></select></label>`,
  async run(files, o, prog) {
    const d = await PDFLib.PDFDocument.create(); const m = +o.margin || 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i]; let img;
      if (extOf(f.name) === "png") { try { img = await d.embedPng(await f.arrayBuffer()); } catch (e) { img = null; } }
      if (!img) {
        let bmp; try { bmp = await createImageBitmap(f, {imageOrientation: "from-image"}); } catch (e) { throw new Error(f.name + " couldn't be opened as an image. Try saving it as JPG or PNG."); }
        const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
        const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0); bmp.close && bmp.close();
        img = await d.embedJpg(await (await canvasBlob(c, "image/jpeg", .92)).arrayBuffer()); c.width = c.height = 0;
      }
      const iw = img.width * .75, ih = img.height * .75; let pw, ph;
      if (o.size === "fit") { pw = iw + 2 * m; ph = ih + 2 * m; }
      else {
        [pw, ph] = PAGE_SIZES[o.size] || PAGE_SIZES.a4;
        const land = o.orient === "l" || (o.orient === "auto" && iw > ih);
        if (land) [pw, ph] = [ph, pw];
      }
      const s = Math.min((pw - 2 * m) / iw, (ph - 2 * m) / ih, o.size === "fit" ? 1 : Infinity);
      const w = iw * s, h = ih * s;
      d.addPage([pw, ph]).drawImage(img, {x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h});
      prog((i + 1) / files.length);
    }
    return {files: [{name: (files.length === 1 ? baseName(files[0].name) : "images") + ".pdf", blob: pdfBlob(await d.save())}], summary: "Made a PDF with " + plural(files.length, "page") + "."};
  }});

const colName = i => { let s = ""; i++; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };
T({id: "excel", cat: "convert", name: "Excel to PDF", desc: "Print spreadsheets and CSV files as neat PDF tables.",
  exts: EXT.sheet, libs: ["xlsx", "pdflib"], action: "Convert to PDF", pick: "Select Excel or CSV file",
  options: () => `<label class="f">Sheets<select name="sheets"><option value="all">All sheets</option><option value="first">First sheet only</option></select></label>
    <div class="row2"><label class="f">Page size<select name="size"><option value="a4">A4</option><option value="letter">Letter</option></select></label>
    <label class="f">Text size<select name="fs"><option value="7">Small</option><option value="9" selected>Normal</option><option value="11">Large</option></select></label></div>
    <label class="f">Orientation<select name="orient"><option value="auto">Automatic (landscape for wide tables)</option><option value="p">Portrait</option><option value="l">Landscape</option></select></label>
    <label class="check"><input type="checkbox" name="head" checked> First row is a header (repeat it on every page)</label>
    <label class="check"><input type="checkbox" name="grid" checked> Show cell borders</label>
    <p class="note">Values are printed as they appear in the sheet. Charts, pictures and colours aren't included. Very wide tables continue on extra pages.</p>`,
  async run(files, o, prog) {
    const f = files[0]; let wb;
    try { wb = extOf(f.name) === "csv" ? XLSX.read(await f.text(), {type: "string"}) : XLSX.read(new Uint8Array(await f.arrayBuffer()), {type: "array", cellDates: true}); }
    catch (e) { throw new Error(f.name + " couldn't be read as a spreadsheet. If it's password-protected, remove the password in Excel first."); }
    const names = o.sheets === "first" ? wb.SheetNames.slice(0, 1) : wb.SheetNames;
    const d = await PDFLib.PDFDocument.create();
    const reg = await d.embedFont(PDFLib.StandardFonts.Helvetica), bold = await d.embedFont(PDFLib.StandardFonts.HelveticaBold);
    const size = +o.fs || 9, pad = 3.5, lh = size * 1.25, M = 36, maxLines = 8;
    const [PW, PH] = PAGE_SIZES[o.size] || PAGE_SIZES.a4;
    const ink = PDFLib.rgb(.1, .11, .13), lineC = PDFLib.rgb(.75, .77, .8), headBg = PDFLib.rgb(.92, .93, .95);
    let replaced = 0, done = 0, rowsTotal = 0;
    for (const [si, name] of names.entries()) {
      const raw = XLSX.utils.sheet_to_json(wb.Sheets[name], {header: 1, raw: false, defval: "", blankrows: true});
      const rows = trimRows(raw);
      if (!rows.length || !rows[0].length) continue;
      if (rows.length * rows[0].length > 400000) throw new Error("The sheet \"" + name + "\" is too big to print here (over 400,000 cells). Split it into smaller sheets first.");
      const cells = rows.map((r, ri) => r.map(v => { const c = cleanForFont(ri === 0 && o.head ? bold : reg, v.replace(/\s+/g, " ").trim()); replaced += c.bad; return c.text; }));
      const fontFor = ri => ri === 0 && o.head ? bold : reg;
      const nat = cells[0].map((_, ci) => { let m = 0; for (let ri = 0; ri < cells.length; ri++) { const s = cells[ri][ci]; if (s) m = Math.max(m, fontFor(ri).widthOfTextAtSize(s, size)); } return m + pad * 2; });
      const totalW = nat.reduce((a, b) => a + Math.min(b, 220), 0);
      const land = o.orient === "l" || (o.orient === "auto" && totalW > PW - 2 * M);
      const [W, H] = land ? [PH, PW] : [PW, PH];
      const groups = planColumns(nat, W - 2 * M);
      const head = o.head ? cells[0] : null; const body = o.head ? cells.slice(1) : cells;
      for (const g of groups) {
        let page, y;
        const rowLines = r => g.cols.map((ci, k) => { const s = r[ci]; if (!s) return [""]; let ls = wrapText(s, reg, size, g.widths[k] - pad * 2); if (ls.length > maxLines) { ls = ls.slice(0, maxLines); ls[maxLines - 1] = ls[maxLines - 1].replace(/.{0,3}$/, "..."); } return ls; });
        const drawRow = (r, isHead) => {
          const font = isHead ? bold : reg; const ls = rowLines(r); const rh = Math.max(...ls.map(l => l.length)) * lh + pad * 2;
          if (!isHead && y - rh < M + 14) { newPage(); }
          let x = M;
          g.cols.forEach((ci, k) => {
            const w = g.widths[k];
            if (isHead) page.drawRectangle({x, y: y - rh, width: w, height: rh, color: headBg});
            if (o.grid) page.drawRectangle({x, y: y - rh, width: w, height: rh, borderColor: lineC, borderWidth: .5});
            const num = !isHead && looksNumeric(r[ci]);
            ls[k].forEach((t, li) => { if (!t) return; const tw = font.widthOfTextAtSize(t, size); page.drawText(t, {x: num ? x + w - pad - tw : x + pad, y: y - pad - size * .85 - li * lh, size, font, color: ink}); });
            x += w;
          });
          y -= rh;
        };
        const newPage = () => {
          page = d.addPage([W, H]); y = H - M;
          const title = cleanForFont(bold, name).text + (groups.length > 1 ? "  (columns " + colName(g.cols[0]) + "-" + colName(g.cols[g.cols.length - 1]) + ")" : "");
          page.drawText(title, {x: M, y: y - size - 2, size: size + 2, font: bold, color: ink}); y -= size + 12;
          if (head) drawRow(head, true);
        };
        newPage();
        for (const r of body) drawRow(r, false);
      }
      rowsTotal += body.length; done++; prog((si + 1) / names.length * .95);
    }
    if (!done) throw new Error("The spreadsheet is empty, so there's nothing to print.");
    const pages = d.getPages(); const n = pages.length;
    pages.forEach((p, i) => { const s = "Page " + (i + 1) + " of " + n; const {width} = p.getSize(); p.drawText(s, {x: (width - reg.widthOfTextAtSize(s, 8)) / 2, y: 18, size: 8, font: reg, color: PDFLib.rgb(.45, .47, .5)}); });
    prog(1);
    return {files: [{name: baseName(f.name) + ".pdf", blob: pdfBlob(await d.save())}],
      summary: "Printed " + plural(done, "sheet") + " (" + plural(rowsTotal, "row") + ") on " + plural(n, "page") + ".",
      note: replaced ? replaced + " characters the PDF font can't show (for example Hindi or the rupee sign in some files) were replaced with ?." : ""};
  }});

T({id: "pdf2txt", cat: "convert", name: "PDF to text", desc: "Pull all the text out of a PDF into a plain .txt file.",
  exts: EXT.pdf, libs: ["pdfjs"], action: "Get the text",
  options: () => `<label class="check"><input type="checkbox" name="marks" checked> Mark where each page starts</label>
    <label class="check"><input type="checkbox" name="paras" checked> Join lines into paragraphs</label>
    <p class="note">Scanned PDFs are pictures of text, so there's nothing to copy from them.</p>`,
  async run(files, o, prog) {
    const pages = await extractPages(files[0], prog);
    const hs = pages.flatMap(ls => ls.map(l => l.h)).sort((a, b) => a - b); const med = hs[Math.floor(hs.length / 2)] || 10;
    const parts = pages.map((ls, i) => (o.marks ? "----- Page " + (i + 1) + " -----\n\n" : "") + (o.paras ? linesToParas(ls, med).map(p => p.text).join("\n\n") : ls.map(l => l.text).join("\n")));
    const text = parts.join("\n\n");
    const chars = pages.reduce((s, ls) => s + ls.reduce((a, l) => a + l.text.length, 0), 0);
    if (chars < 5) throw new Error("This PDF has no text we can copy. It's probably a scan or a photo of a document.");
    return {files: [{name: baseName(files[0].name) + ".txt", blob: new Blob([text.replace(/\n/g, "\r\n")], {type: "text/plain;charset=utf-8"})}],
      summary: "Copied " + chars.toLocaleString("en-IN") + " characters from " + plural(pages.length, "page") + "."};
  }});

/* ================= Edit ================= */
T({id: "pagenumbers", cat: "edit", name: "Add page numbers", desc: "Number your pages in the corner or centre, your way.",
  exts: EXT.pdf, libs: ["pdflib"], action: "Add page numbers",
  options: () => `<label class="f">Position<select name="pos">
      <option value="bc">Bottom centre</option><option value="br">Bottom right</option><option value="bl">Bottom left</option>
      <option value="tc">Top centre</option><option value="tr">Top right</option><option value="tl">Top left</option></select></label>
    <label class="f">Style<select name="fmt"><option value="n">1</option><option value="page">Page 1</option><option value="of">Page 1 of 10</option><option value="slash">1 / 10</option></select></label>
    <div class="row2"><label class="f">First number<input type="number" name="start" value="1" min="0"></label>
    <label class="f">Text size<input type="number" name="size" value="11" min="6" max="36"></label></div>
    <label class="check"><input type="checkbox" name="skip"> Don't number the first page (cover)</label>`,
  async run(files, o) {
    const d = await loadPL(files[0]); const font = await d.embedFont(PDFLib.StandardFonts.Helvetica);
    const pages = d.getPages(); const skip = !!o.skip; const start = Number.isFinite(+o.start) ? +o.start : 1;
    const size = clamp(+o.size || 11, 6, 36); const count = pages.length - (skip ? 1 : 0); const last = start + count - 1;
    pages.forEach((p, i) => {
      if (skip && i === 0) return;
      const n = start + i - (skip ? 1 : 0);
      const text = {n: String(n), page: "Page " + n, of: "Page " + n + " of " + last, slash: n + " / " + last}[o.fmt] || String(n);
      const F = pageFrame(p); const tw = font.widthOfTextAtSize(text, size);
      const vx = o.pos[1] === "l" ? 36 : o.pos[1] === "r" ? F.W - 36 - tw : (F.W - tw) / 2;
      const vy = o.pos[0] === "t" ? 28 + size : F.H - 24;
      const [x, y] = F.pt(vx, vy);
      p.drawText(text, {x, y, size, font, color: PDFLib.rgb(.22, .22, .25), rotate: PDFLib.degrees(F.r)});
    });
    return {files: [{name: baseName(files[0].name) + "_numbered.pdf", blob: pdfBlob(await d.save())}], summary: "Numbered " + plural(count, "page") + "."};
  }});

T({id: "watermark", cat: "edit", name: "Add watermark", desc: "Stamp text or your logo across every page.",
  exts: EXT.pdf, libs: ["pdflib"], action: "Add watermark",
  options: () => `<div class="f"><span id="wm-k">Watermark</span><div class="seg" role="group" aria-labelledby="wm-k" data-kind><button type="button" aria-pressed="true" data-v="text">Text</button><button type="button" aria-pressed="false" data-v="image">Image</button></div><input type="hidden" name="kind" value="text"></div>
    <div data-show="kind=text">
      <label class="f">Text<input type="text" name="text" value="CONFIDENTIAL" maxlength="60"></label>
      <div class="row2"><label class="f">Text size<input type="number" name="size" value="60" min="10" max="200"></label>
      <label class="f">Colour<input type="color" name="col" value="#888888"></label></div>
      <label class="f">Angle<select name="ang"><option value="45">Diagonal</option><option value="0">Straight</option></select></label>
    </div>
    <div data-show="kind=image" hidden>
      <label class="f">Image<input type="file" name="img" accept=".png,.jpg,.jpeg,.webp"><span class="h">A PNG logo with a see-through background looks best.</span></label>
      <label class="f">Image width<select name="isz"><option value=".2">Small (20% of the page)</option><option value=".35" selected>Medium (35%)</option><option value=".55">Large (55%)</option><option value=".8">Very large (80%)</option></select></label>
    </div>
    <div class="row2"><label class="f">Strength<select name="op"><option value=".12">Faint</option><option value=".25" selected>Medium</option><option value=".45">Strong</option></select></label>
    <label class="f">Layout<select name="lay"><option value="one">Once, centred</option><option value="tile">Repeated</option></select></label></div>
    ${rangeField()}`,
  wire(form) {
    const seg = $("[data-kind]", form);
    seg.addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; $$("button", seg).forEach(x => x.setAttribute("aria-pressed", String(x === b))); form.elements.kind.value = b.dataset.v; form.dispatchEvent(new Event("change")); });
  },
  async run(files, o) {
    const d = await loadPL(files[0]); const n = d.getPageCount(); const set = pageSet(o.pages, n);
    const op = +o.op || .25; const tile = o.lay === "tile";
    const spots = F => tile ? [[.25, .2], [.75, .2], [.5, .5], [.25, .8], [.75, .8]].map(([a, b]) => [F.W * a, F.H * b]) : [[F.W / 2, F.H / 2]];
    let count = 0;
    if (o.kind === "image") {
      if (!o.img) throw new Error("Choose an image for the watermark, or switch to a text watermark.");
      const img = await embedImageFile(d, o.img); const frac = +o.isz || .35;
      d.getPages().forEach((p, i) => {
        if (set && !set.has(i)) return; count++;
        const F = pageFrame(p); const w = F.W * frac * (tile ? .6 : 1), h = w * img.height / img.width;
        for (const [vx, vy] of spots(F)) { const [cx, cy] = F.pt(vx, vy); const [dx, dy] = F.vec(w / 2, h / 2); p.drawImage(img, {x: cx - dx, y: cy - dy, width: w, height: h, opacity: op, rotate: PDFLib.degrees(F.r)}); }
      });
    } else {
      const text = (o.text || "").trim(); if (!text) throw new Error("Type the watermark text, or switch to an image watermark.");
      const font = await d.embedFont(PDFLib.StandardFonts.HelveticaBold);
      const safe = cleanForFont(font, text).text; const size0 = clamp(+o.size || 60, 10, 200);
      const a = (+o.ang || 0) * Math.PI / 180; const col = PDFLib.rgb(...hexRgb(o.col || "#888888"));
      d.getPages().forEach((p, i) => {
        if (set && !set.has(i)) return; count++;
        const F = pageFrame(p); const size = tile ? size0 * .55 : size0; const w = font.widthOfTextAtSize(safe, size);
        for (const [vx, vy] of spots(F)) {
          const [cx, cy] = F.pt(vx, vy);
          const [dx, dy] = F.vec(-(w / 2) * Math.cos(a) + (size / 3) * Math.sin(a), -(w / 2) * Math.sin(a) - (size / 3) * Math.cos(a));
          p.drawText(safe, {x: cx + dx, y: cy + dy, size, font, color: col, opacity: op, rotate: PDFLib.degrees((+o.ang || 0) + F.r)});
        }
      });
    }
    return {files: [{name: baseName(files[0].name) + "_watermarked.pdf", blob: pdfBlob(await d.save())}], summary: "Watermark added to " + plural(count, "page") + "."};
  }});

T({id: "crop", cat: "edit", name: "Crop PDF", desc: "Trim the margins off pages, with a live preview.", isNew: true,
  exts: EXT.pdf, mount: mountCrop});

T({id: "edit", cat: "edit", name: "Edit PDF", desc: "Change the existing text, even on scans and photos, and add text, images, drawings and highlights.", isNew: true,
  lede: "Click any line to rewrite it. Scanned pages and photos are made editable with OCR. Only your changes are added; the rest of the page stays as it was.",
  exts: EXT.pdfimg, multiple: true, pick: "Select PDF or photos", mount: mountEdit});

T({id: "meta", cat: "edit", name: "Edit metadata", desc: "Change the title, author, subject and keywords stored in a PDF.",
  exts: EXT.pdf, libs: ["pdflib"], action: "Save details",
  options: () => `<label class="f">Title<input type="text" name="title" autocomplete="off"></label>
    <label class="f">Author<input type="text" name="author" autocomplete="off"></label>
    <label class="f">Subject<input type="text" name="subject" autocomplete="off"></label>
    <label class="f">Keywords<input type="text" name="keywords" autocomplete="off"><span class="h">Separate keywords with commas.</span></label>
    <label class="check"><input type="checkbox" name="strip"> Also clear the "created with" app details</label>
    <p class="note" data-orig>Open a file to see its current details.</p>`,
  async onLoad(files, form) {
    await need("pdflib"); const d = await loadPL(files[0], {updateMetadata: false});
    const get = fn => { try { return d[fn]() || ""; } catch (e) { return ""; } };
    form.elements.title.value = get("getTitle"); form.elements.author.value = get("getAuthor");
    form.elements.subject.value = get("getSubject"); form.elements.keywords.value = get("getKeywords");
    const app = [get("getCreator"), get("getProducer")].filter(Boolean).join(" / ");
    $("[data-orig]", form).textContent = "Current details are filled in above." + (app ? " Made with: " + app + "." : "");
  },
  async run(files, o) {
    const d = await loadPL(files[0], {updateMetadata: false});
    d.setTitle(o.title.trim()); d.setAuthor(o.author.trim()); d.setSubject(o.subject.trim());
    d.setKeywords(o.keywords.split(/[,;]/).map(s => s.trim()).filter(Boolean));
    if (o.strip) { d.setCreator(""); d.setProducer(""); }
    d.setModificationDate(new Date());
    return {files: [{name: files[0].name, blob: pdfBlob(await d.save({updateFieldAppearances: false}))}], summary: "Saved the new details. The pages themselves are unchanged."};
  }});

/* ================= Sign & secure ================= */
T({id: "sign", cat: "secure", name: "Sign PDF", desc: "Draw, type or upload your signature and place it on the page.",
  exts: EXT.pdf, mount: mountSign});

T({id: "protect", cat: "secure", name: "Protect PDF", desc: "Lock a PDF with a password so only people you trust can open it.", soon: true,
  soonHtml: `<h2>What it will do</h2><ul><li>Add a password that's needed to open the PDF.</li><li>Optionally stop printing or copying.</li><li>All on your device, like every other tool here.</li></ul>
    <h2>Why it isn't here yet</h2><p>Password protection needs proper encryption. The PDF library we use in the browser can't encrypt files yet, and we won't ship a lock that doesn't really lock.</p>
    <h2>What you can do today</h2><p>Microsoft Word, LibreOffice and most PDF apps can save a PDF with a password. On a Mac, Preview can do it too (File &gt; Export &gt; Encrypt).</p>`});

T({id: "unlock", cat: "secure", name: "Unlock PDF", desc: "Remove a password you know from a PDF.", soon: true,
  soonHtml: `<h2>What it will do</h2><ul><li>Open a protected PDF with the password you type.</li><li>Save a copy that opens without a password.</li></ul>
    <h2>Why it isn't here yet</h2><p>Opening encrypted PDFs safely needs decryption support that our in-browser PDF library doesn't have yet.</p>
    <h2>What you can do today</h2><p>Open the PDF in your browser or PDF reader with the password, then choose Print and "Save as PDF". The new copy won't have a password.</p>`});
