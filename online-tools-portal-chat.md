# Online Tools Web Portal – Chat Record

**Date:** 4 October 2026
**Project:** Project for building tool based web portal

---

## 1. Request: complete plan for the tools website

> Provide the complete plan to build a website for specific free tools with subscription model
> 1. pdf editing 2. Remote desk 3. Video Editing 4. Audio Editing 5. photo editing 6. other helpful tools
> Complete plan: to form company, GST certificate, licensing if required, certificates if required, payment gateway if required, all steps

### Response: Complete Plan – Online Tools Website with a Subscription Model (India)

This is a crowded market. iLovePDF, Smallpdf, AnyDesk, Canva and CapCut already offer free tiers, so the plan is built around a strategy that can compete:

- **Process files in the user's browser wherever possible.** This keeps server costs low, lets you promise "your files never leave your device," and reduces data-protection exposure.
- **Sell one subscription that covers every tool.** Competitors charge separately for PDF, image and video tools.
- **Price for India in rupees, with UPI Autopay.** Most competitors price in dollars.

*Not a CA or lawyer. Have a CA confirm the tax and company steps before filing anything.*

#### Phase 0 – Before you start (Week 0)

**Check your employment contract.** Many employment agreements have clauses on outside business, directorships and ownership of intellectual property (IP). Confirm you're free to become a director of another company and to build this on the side. Use your own laptop, accounts and time so the code clearly belongs to the new company.

**Decide on name and domain together.** Check availability in three places before you commit:
- The MCA name search
- The trademark search at ipindia.gov.in, in Class 9 (software) and Class 42 (SaaS)
- The .com and .in domains

#### Phase 1 – Form the company (Weeks 1–3)

**Pick the structure**

| Structure | Best when | Pros | Cons |
|---|---|---|---|
| **Private Limited** (recommended) | You may raise funds, add partners, give ESOPs | Credible with payment gateways, investors and B2B buyers. Eligible for DPIIT startup benefits. | Needs 2 directors and 2 shareholders. Higher compliance cost (~₹25–40k/yr with a CA). |
| **OPC** (One Person Company) | You're truly solo for now | Limited liability with one person; can convert to Pvt Ltd later | Needs a nominee. Can't take equity investors. |
| **LLP** | Two partners, no plan to raise funds | Lower compliance | Investors don't fund LLPs; no ESOPs |

**Pvt Ltd incorporation steps (via SPICe+ on the MCA portal)**

1. **Digital Signature Certificates (DSC)** for all directors. Class 3, about ₹1,500–2,500 each.
2. **Name reservation** through SPICe+ Part A. Submit two name options.
3. **SPICe+ Part B** together with the e-MOA, e-AOA and AGILE-PRO-S forms. This single filing gives you:
   - The Certificate of Incorporation and CIN
   - Company PAN and TAN
   - EPFO and ESIC registration
   - A bank current account
   - Optional GSTIN
4. **Registered office proof.** Rent agreement or ownership document, an NOC from the owner, and a recent utility bill. A home address works if the owner gives an NOC.
5. **Timeline and cost.** About 10–15 working days and ₹8–20k all-in through a CA. Government fees are near zero for capital up to ₹15 lakh, plus Delhi stamp duty.

**Mandatory filings after incorporation**

- **First board meeting:** within 30 days.
- **Appoint the statutory auditor (ADT-1):** within 30 days.
- **INC-20A (commencement of business):** within 180 days, after shareholders deposit their capital. Heavy penalty if missed.
- **Every year:** AOC-4, MGT-7A, income tax return, DIR-3 KYC for each director, and the statutory audit.

#### Phase 2 – Tax and business registrations (Weeks 2–4)

**GST registration.**
- The legal threshold for services is ₹20 lakh turnover.
- **Register voluntarily from day one anyway**, because:
  - Business customers will want GST invoices.
  - You can claim input tax credit on Indian cloud bills.
  - Payment gateways and enterprise buyers prefer GST-registered merchants.
- SaaS and online tools attract **18% GST**.

**Reverse charge on foreign services.** Paying foreign SaaS providers (Vercel, OpenAI, Google Workspace) counts as importing services. Once registered, you pay GST on these under reverse charge and claim it back as credit.

**LUT (Form GST RFD-11).** File every financial year. It lets you bill foreign customers without charging IGST, because export of services is zero-rated. Keep the bank's e-FIRC/e-BRC records as proof.

**Udyam (MSME) registration.** Free and online. Gives protection against delayed payments, cheaper trademark fees, and eligibility for government schemes.

**DPIIT Startup India recognition.** Free. Benefits: 80% rebate on patent fees and reduced trademark fees, self-certification under labour laws, eligibility to apply for the Section 80-IAC tax holiday (needs separate approval).

**Trademark.** File in Class 9 and Class 42. ₹4,500 per class for startups and MSMEs filing online. Register before marketing.

**IEC (Import Export Code).** Free, issued instantly online. Some banks and gateways ask for it before enabling international payments.

**Shops & Establishment registration.** Only needed if you open a physical office or hire staff in Delhi.

#### Phase 3 – Licensing and compliance specific to these tools

No government licence is required to run an online tools website. The real legal risks are below.

**A. Open-source licences (the biggest hidden risk)**

| Tool | Safe to use commercially (MIT/Apache/BSD) | Handle with care |
|---|---|---|
| PDF | pdf-lib (MIT), PDF.js (Apache 2.0), qpdf (Apache), Tesseract OCR (Apache) | **Ghostscript and MuPDF are AGPL.** Using them in a SaaS can oblige you to release your code, unless you buy Artifex's commercial licence. |
| Photo | Fabric.js / Konva (MIT), rembg (MIT) | Some background-removal libraries are AGPL. Check each one. |
| Audio | wavesurfer.js (BSD), Web Audio API | – |
| Video | Browser WebCodecs API, ffmpeg.wasm | **FFmpeg builds with x264 are GPL.** H.264/HEVC encoding also carries patent questions. Prefer LGPL builds plus VP9/AV1, or the browser's built-in encoders. |
| Remote desktop | Apache Guacamole (Apache 2.0) | **RustDesk is AGPL-3.0.** If you modify it and offer it as a service, you must share your source. Alternatively, license a white-label remote-access SDK. |
| Office → PDF | LibreOffice headless (MPL 2.0, fine) | – |

Keep a licence register (every library, its licence and version) from day one.

**B. Remote desktop: the highest-risk module**

Remote-access tools are heavily abused in tech-support and "digital arrest" scams in India. You need:
- **Abuse controls:** verified accounts for session hosts, session logs, a visible warning to the person being connected, one-click end-and-report, rate limits.
- **Relay servers**, which carry ongoing bandwidth costs, so make this a paid-tier feature launched last.
- **A plan for law-enforcement requests**, including log retention.

**C. Indian law that applies**

- **IT Act 2000 and Intermediary Guidelines 2021:** publish Terms of Use and Privacy Policy; appoint a Grievance Officer with contact details on the site; acknowledge complaints within 24 hours and resolve within 15 days.
- **CERT-In Directions (2022):** report cyber incidents within 6 hours; sync clocks to NIC/NPL NTP servers; keep ICT logs for 180 days within India.
- **DPDP Act 2023 and DPDP Rules 2025:** rules notified 13 November 2025. Consent-manager registration starts 14 November 2026; substantive consent, breach, children's-data and Significant-Data-Fiduciary obligations start 14 May 2027. The government has said it may compress this timeline. Build now: clear consent at signup, auto-deletion of uploaded files (1–2 hours), data-deletion requests, a breach-response plan, age-gating.
- **Consumer Protection (E-Commerce) Rules 2020 and CCPA Dark Patterns Guidelines 2023:** cancelling must be as easy as subscribing; no hidden auto-renewals or fake urgency; clear refund policy; prices shown inclusive of GST.
- **E-signature tool:** a "draw your signature" feature is fine, but don't market it as equivalent to Aadhaar eSign (that needs a licensed eSign Service Provider).

**D. Certificates (none mandatory)**

- **SSL/TLS:** essential; free via Let's Encrypt or Cloudflare.
- **PCI-DSS:** not needed if you use the gateway's hosted checkout.
- **VAPT before launch:** recommended; CERT-In-empanelled auditor ~₹30–80k.
- **ISO 27001 / SOC 2:** only later, for company customers.

#### Phase 4 – Payment gateway (Weeks 3–6)

**Indian customers**

| Gateway | Subscription support | Notes |
|---|---|---|
| **Razorpay** (recommended) | Subscriptions API, UPI Autopay, card e-mandates | Best documentation; widely used by SaaS |
| **Cashfree** | Subscriptions, UPI Autopay | Competitive pricing |
| **PayU** | Recurring payments | Common alternative |

Standard fees about 2% per transaction plus GST on the fee.

**RBI recurring-payment rules:** additional authentication when the mandate is created; pre-debit notification 24 hours before each charge; auto-debits up to ₹15,000 without fresh authentication (keep plans below this).

**What gateways check before approving:** Certificate of Incorporation, company PAN, bank account, GST certificate, director KYC, and **a live website** with Pricing, Terms of Service, Privacy Policy, Refund & Cancellation policy, contact details with address, and a Grievance Officer.

**International customers**
- **Stripe:** invite-only in India; since 1 January 2026 RBI rules require video KYC for new users. Apply, but don't depend on it.
- **Razorpay international cards / PayPal:** workable; separate approval.
- **Merchant of Record (e.g., Paddle):** easiest for global sales; handles foreign VAT/sales tax; fees ~5% + 50¢. Confirm current India-seller support.

#### Phase 5 – Product and technology architecture

| Tool | Free tier | Paid tier | Where processing happens |
|---|---|---|---|
| **PDF** | 5 tasks/day, 20 MB | Unlimited, 500 MB, batch, OCR | Mostly browser; server for Office↔PDF and heavy compression |
| **Photo** | Standard resolution | HD, batch, AI background removal | Browser (ONNX/WebGPU for background removal) |
| **Audio** | Up to 10 minutes | Long files, AI noise removal | Browser; server for AI |
| **Video** | 720p, 5 min, small watermark | 1080p/4K, no watermark, long videos | Browser (WebCodecs) for small jobs; GPU server for heavy jobs |
| **Remote desktop** | One 15-min session/day | Unattended access, file transfer, multiple devices | Relay servers (Guacamole or licensed SDK) |
| **Other tools** | Free, unlimited | – | Browser |

**Suggested stack:** Next.js on Vercel/Cloudflare Pages; Supabase (Mumbai) for login, Postgres, subscription status and usage counters; Docker workers with Redis/BullMQ on a VPS or AWS Mumbai (GPU only for AI/video); S3 or Cloudflare R2 with auto-deletion after 1–2 hours; Razorpay webhooks updating Supabase; Sentry, Uptime Kuma, and 180-day logs in India.

#### Phase 6 – Subscription model

| Plan | India | International | Includes |
|---|---|---|---|
| **Free** | ₹0 | $0 | All tools with daily limits, optional ads, small video watermark |
| **Pro** | ₹249/month or ₹1,999/year | $6/month or $48/year | Unlimited, large files, no ads/watermark, AI features, batch |
| **Pro + Remote** | ₹449/month | $10/month | Pro plus remote desktop |
| **Team** | ₹199/user/month (min 3) | $5/user/month | Shared billing, admin panel, GST invoices, priority support |

Offer annual plans (~33% discount), optionally a 7-day Pro trial with e-mandate, and keep ads off tool workspaces.

#### Phase 7 – Build roadmap

| Period | Business track | Product track |
|---|---|---|
| **Month 1** | Employment check, name, DSC, incorporation, bank account | Design system, login, landing pages, legal pages |
| **Month 2** | GST, Udyam, DPIIT, trademark filing, gateway application | **MVP:** PDF suite and photo tools |
| **Month 3** | Gateway live, LUT filed | Billing, plan limits, usage tracking, **public launch** |
| **Months 4–5** | VAPT, international payments | Audio tools, then video tools |
| **Months 6–8** | First CA review | Remote desktop (beta → paid), Team plan |
| **Month 9+** | Optional ISO 27001 | Mobile app (PWA), developer API, Hindi interface |

#### Phase 8 – Launch and growth

- **SEO is the main growth engine.** One fast page per tool targeting phrases like "compress pdf to 100kb" or "merge pdf online free", with Hindi versions.
- **India-specific tools:** photo/signature resizers for exam and form limits (SSC, UPSC, passport), Aadhaar/PAN PDF unlocker, GST invoice generator.
- **Channels:** Product Hunt, Reddit (r/india, r/SaaS), LinkedIn, YouTube Shorts, partnerships with CA and IT-service firms.

#### Phase 9 – Rough Year-1 budget

| Item | Estimate (₹) |
|---|---|
| Company formation + DSCs | 10,000 – 20,000 |
| GST/Udyam/DPIIT/IEC (with CA help) | 3,000 – 8,000 |
| Trademark (2 classes) | 9,000 – 20,000 |
| Annual CA, audit and ROC compliance | 25,000 – 50,000 |
| Domain, email, SSL | 3,000 – 6,000 |
| Hosting and processing | 60,000 – 3,00,000 |
| VAPT audit | 30,000 – 80,000 |
| Development: self-built / outsourced | ~0 / 5,00,000 – 20,00,000 |
| Marketing | 50,000 – 2,00,000 |
| **Total (self-built)** | **~₹2 – 7 lakh** |

#### Ongoing compliance calendar

- **Monthly:** GSTR-1 by the 11th and GSTR-3B by the 20th (QRMP quarterly allowed under ₹5 crore); reverse-charge GST on foreign services.
- **Quarterly:** TDS returns if applicable.
- **Yearly:** LUT renewal (April), DIR-3 KYC (September), audit with AOC-4 and MGT-7A (Oct–Nov), income tax return, GSTR-9 if applicable, review of licence register and privacy policy.

---

## 2. Request: build the portal

> For first tool create the portal: Main Portal; PDF tool – copy everything and create in new style (pdf.pixelpath.in); Remote Access; Video Editing; Audio Editing; Convert documents – pdf to word, word to pdf, vcf to csv, excel, pdf to jpg, jpg to pdf

### Response

Built the portal with 22 tools across five sections. Everything except Remote Access works, and the PDF tools are in a new design. pdf.pixelpath.in blocks automated access, so the usual set of PDF tools was built rather than a copy of that site's list.

Every tool was tested in a browser with sample files and produced a correct output file.

| Section | Tools |
|---|---|
| **PDF tools** | Merge, Split, Compress, Organize pages (drag, rotate, delete), Rotate, Remove pages, Extract pages, Page numbers, Watermark, Sign (draw or type) |
| **Convert documents** | PDF→Word, Word→PDF, PDF→JPG/PNG, JPG→PDF, VCF→CSV/Excel, Excel↔CSV |
| **Video editing** | Trim & compress, Extract audio, Save a frame as an image |
| **Audio editing** | Editor (trim, cut, fade, volume, normalise, undo), Join clips |
| **Remote access** | "Coming soon" page (needs a small desktop app) |

The home page lets users drop any file and shows which tools fit it.

**No server needed.** All tools process files in the user's browser; nothing is uploaded. Zero processing cost, and the single HTML file can be hosted on GitHub Pages.

**Current limits**
- **Compress PDF** rebuilds pages as images, so text can't be selected afterwards.
- **PDF→Word** copies text and paragraphs only; scanned PDFs need OCR later.
- **Word→PDF** handles English text only for now (Hindi shows as "?"); fix needs an embedded Unicode font.
- **Video export** runs in real time. Output is MP4 in Chrome/Safari, WebM in Firefox.
- **WAV files download as .zip** inside Claude's viewer; on your own site they download directly.

**"Karigar" is a placeholder name** in the logo, page titles and footer; find-and-replace to rename.

Published artifact: https://claude.ai/artifact/VKyhYvWaxZDMsVyuJCkQTa
File: `index.html`

**Next steps suggested:** photo tools, then login and Pro plan using Supabase with Razorpay subscriptions.

---

## 3. Request: save the file in the project folder

> save the file in the folder location of the project
> Location: `D:\Dashboard\Claude Code\Online Tool Web portal`

### Response

The file was made available for download as `index.html`. Claude in claude.ai runs in the cloud and cannot write to a local `D:\` drive, even with permission. Options given:

1. Download `index.html` and move it into `D:\Dashboard\Claude Code\Online Tool Web portal`.
2. Use Claude Code on the PC, opened in that folder, so files save there directly.
3. Save via a cloud drive that syncs to the PC.

---

## 4. Request: can you access OneDrive

### Response

Yes, through the Microsoft 365 connector. A folder named **Online Tool Web portal** was created in the root of OneDrive (fundcapllp-my.sharepoint.com, personal OneDrive). The `index.html` upload had not yet been completed when the next request came in.

---

## 5. Request: give me .md file of this chat

This document.
