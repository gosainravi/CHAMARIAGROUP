/* Daftarbox Security audit – pure logic (no DOM). Loaded with a classic <script> tag; also require()-able from Node for tests. */
(function (root) {
  'use strict';

  /* ---------- Domain input ---------- */
  var LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  function normaliseDomain(input) {
    var s = String(input == null ? '' : input).trim().toLowerCase();
    if (!s) return { ok: false, error: 'Please type a domain name, for example yourcompany.in' };
    if (s.indexOf('@') > -1) s = s.slice(s.lastIndexOf('@') + 1);           // pasted an email address
    s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');                           // https://
    s = s.split(/[\/?#]/)[0].replace(/:\d+$/, '').replace(/\.+$/, '');      // path, port, trailing dot
    if (/\s/.test(s)) return { ok: false, error: 'A domain name has no spaces. Type it like yourcompany.in' };
    var strippedWww = false;
    if (/^www\./.test(s) && s.split('.').length > 2) { s = s.slice(4); strippedWww = true; }
    if (/[^\x00-\x7f]/.test(s)) {                                           // Unicode domain → punycode
      try { s = new URL('http://' + s).hostname; } catch (e) { return { ok: false, error: 'That domain has characters we could not read.' }; }
    }
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return { ok: false, error: 'That looks like an IP address. Please type a domain name instead.' };
    var labels = s.split('.');
    if (labels.length < 2) return { ok: false, error: 'Add the ending too, for example yourcompany.in or yourcompany.com' };
    if (s.length > 253) return { ok: false, error: 'That domain name is too long.' };
    for (var i = 0; i < labels.length; i++) {
      if (!LABEL.test(labels[i])) return { ok: false, error: 'That does not look like a valid domain. Use only letters, numbers, dots and hyphens.' };
    }
    var tld = labels[labels.length - 1];
    if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(tld)) return { ok: false, error: 'The ending “.' + tld + '” is not a real domain ending.' };
    return { ok: true, domain: s, strippedWww: strippedWww };
  }

  /* ---------- DNS answer helpers ---------- */
  // DoH JSON gives TXT data as one or more quoted strings: "\"part1\" \"part2\"". Join them.
  function txtData(data) {
    var d = String(data || '');
    if (d.charAt(0) !== '"') return d;
    var out = '', re = /"((?:[^"\\]|\\.)*)"/g, m;
    while ((m = re.exec(d))) out += m[1];
    return out.replace(/\\(\d{3})/g, function (_, n) { return String.fromCharCode(+n); }).replace(/\\(.)/g, '$1');
  }
  function isSpf(t) { return /^v=spf1(\s|$)/i.test(String(t).trim()); }
  function isDmarc(t) { return /^v=DMARC1\s*(;|$)/i.test(String(t).trim()); }

  /* ---------- SPF ---------- */
  var SPF_MECH = { all: 1, include: 1, a: 1, mx: 1, ptr: 1, ip4: 1, ip6: 1, exists: 1 };
  var SPF_LOOKUP = { include: 1, a: 1, mx: 1, ptr: 1, exists: 1 };
  function parseSPF(record) {
    var r = { valid: false, terms: [], all: null, redirect: null, includes: [], directLookups: 0, unknown: [], hasPtr: false };
    var parts = String(record || '').trim().split(/\s+/);
    if (!parts.length || !/^v=spf1$/i.test(parts[0])) return r;
    r.valid = true;
    for (var i = 1; i < parts.length; i++) {
      var t = parts[i]; if (!t) continue;
      var mod = /^([a-z][a-z0-9_.-]*)=(.*)$/i.exec(t);
      if (mod) {
        var mn = mod[1].toLowerCase();
        if (mn === 'redirect') { r.redirect = mod[2]; r.directLookups++; }
        else if (mn !== 'exp') r.unknown.push(t);
        continue;
      }
      var q = '+';
      if (/^[+\-~?]/.test(t)) { q = t.charAt(0); t = t.slice(1); }
      var m = /^([a-z0-9]+)(?:[:\/](.*))?$/i.exec(t);
      var name = m ? m[1].toLowerCase() : t.toLowerCase();
      var val = m && m[2] != null ? m[2] : '';
      if (!SPF_MECH[name]) { r.unknown.push(parts[i]); continue; }
      r.terms.push({ q: q, mech: name, val: val });
      if (SPF_LOOKUP[name]) r.directLookups++;
      if (name === 'ptr') r.hasPtr = true;
      if (name === 'include' && val) r.includes.push(val.replace(/\.$/, ''));
      if (name === 'all') r.all = q;
    }
    return r;
  }

  // Counts DNS lookups the way receiving servers do (include + redirect are followed). getTxt(name) → Promise<string[]>
  function countSpfLookups(record, getTxt, seen, depth) {
    seen = seen || {}; depth = depth || 0;
    var p = parseSPF(record);
    var total = p.directLookups, notes = [];
    var targets = p.includes.slice();
    if (p.redirect && p.all === null) targets.push(p.redirect.replace(/\.$/, ''));
    var chain = Promise.resolve();
    targets.forEach(function (target) {
      chain = chain.then(function () {
        if (total > 20 || depth > 9) return;
        if (target.indexOf('%') > -1) { notes.push(target + ' uses a macro, so we could not follow it.'); return; }
        var key = target.toLowerCase();
        if (seen[key]) return; seen[key] = 1;
        return getTxt(target).then(function (txts) {
          var spfs = (txts || []).filter(isSpf);
          if (spfs.length !== 1) { notes.push(target + (spfs.length ? ' has more than one SPF record.' : ' has no SPF record (this counts as a broken include).')); return; }
          return countSpfLookups(spfs[0], getTxt, seen, depth + 1).then(function (sub) { total += sub.total; notes = notes.concat(sub.notes); });
        }, function () { notes.push('Could not look up ' + target + '.'); });
      });
    });
    return chain.then(function () { return { total: total, notes: notes }; });
  }

  /* ---------- Tag lists (DMARC, MTA-STS, TLS-RPT, BIMI, DKIM) ---------- */
  function parseTags(record) {
    var o = {};
    String(record || '').split(';').forEach(function (part) {
      var i = part.indexOf('='); if (i < 1) return;
      var k = part.slice(0, i).trim().toLowerCase(); if (!k) return;
      if (!(k in o)) o[k] = part.slice(i + 1).trim();
    });
    return o;
  }

  /* ---------- Evaluate every check from gathered DNS data ---------- */
  var WEIGHTS = { spf: 3, dmarc: 3, dkim: 2, mx: 1, dnssec: 1.5, caa: 1, mtasts: 1, tlsrpt: 0.5, bimi: 0 };

  function check(id, name, status, summary, extra) {
    var c = { id: id, name: name, status: status, summary: summary, details: [], found: [], fix: null };
    if (extra) for (var k in extra) c[k] = extra[k];
    return c;
  }

  function evalMx(d, data) {
    var mx = data.mx || [];
    if (mx.length === 1 && /^0\s+\.?$/.test(mx[0].trim())) {
      return check('mx', 'Mail servers (MX)', 'pass', 'This domain clearly says it does not receive email (a “null MX”). Good for non-mail domains.', { found: mx });
    }
    if (mx.length) {
      var hosts = mx.map(function (m) { return m.split(/\s+/).pop().replace(/\.$/, ''); });
      var provider = guessProvider(hosts.join(' '));
      return check('mx', 'Mail servers (MX)', 'pass', 'Email for this domain is delivered to ' + (provider ? provider : hosts.length + ' mail server' + (hosts.length > 1 ? 's' : '')) + '.', { found: mx });
    }
    return check('mx', 'Mail servers (MX)', 'warn', 'No mail servers found, so this domain cannot receive email.', {
      details: ['If you never use this domain for email, that is fine — but lock it down so nobody can send fake email from it.'],
      fix: { text: 'If the domain sends no email, publish these records to stop misuse:', example: d + '.  TXT  "v=spf1 -all"\n_dmarc.' + d + '.  TXT  "v=DMARC1; p=reject;"\n' + d + '.  MX  0 .' }
    });
  }

  function guessProvider(s) {
    s = s.toLowerCase();
    if (/google\.com|googlemail/.test(s)) return 'Google Workspace';
    if (/outlook\.com|protection\.outlook/.test(s)) return 'Microsoft 365';
    if (/zoho/.test(s)) return 'Zoho Mail';
    if (/rediffmail/.test(s)) return 'Rediffmail';
    if (/secureserver\.net/.test(s)) return 'GoDaddy email';
    if (/mimecast/.test(s)) return 'Mimecast';
    if (/pphosted|proofpoint/.test(s)) return 'Proofpoint';
    if (/titan\.email/.test(s)) return 'Titan email';
    if (/hostinger/.test(s)) return 'Hostinger email';
    return '';
  }

  function spfExample(d, mxText) {
    var p = guessProvider(mxText || '');
    var inc = p === 'Google Workspace' ? 'include:_spf.google.com ' : p === 'Microsoft 365' ? 'include:spf.protection.outlook.com ' : p === 'Zoho Mail' ? 'include:zohomail.in ' : 'include:<your-email-provider> ';
    return d + '.  TXT  "v=spf1 ' + inc + '-all"';
  }

  function evalSpf(d, data) {
    var name = 'SPF (who may send your email)';
    var spfs = (data.txt || []).filter(isSpf);
    var ex = spfExample(d, (data.mx || []).join(' '));
    if (!spfs.length) return check('spf', name, 'fail', 'No SPF record. Anyone can pretend to send email from your domain more easily.', {
      fix: { text: 'Add one TXT record at your domain that lists the services allowed to send your email, ending with -all:', example: ex }
    });
    if (spfs.length > 1) return check('spf', name, 'fail', 'There are ' + spfs.length + ' SPF records. Only one is allowed, so receivers treat all of them as broken.', {
      found: spfs, fix: { text: 'Merge them into one record. Keep every include you need, and one “all” at the end:', example: ex }
    });
    var rec = spfs[0], p = parseSPF(rec), c = check('spf', name, 'pass', '', { found: [rec] });
    var lookups = data.spfLookups ? data.spfLookups.total : p.directLookups;
    c.details.push('DNS lookups needed: ' + lookups + ' of the allowed 10.');
    if (data.spfLookups && data.spfLookups.notes.length) c.details = c.details.concat(data.spfLookups.notes);
    if (p.unknown.length) c.details.push('We did not recognise: ' + p.unknown.join(', '));
    if (p.hasPtr) c.details.push('The “ptr” method is slow and discouraged. Replace it with ip4/include entries.');
    var fixEx = { text: 'A safe SPF record lists your senders and ends with -all:', example: ex };
    if (lookups > 10) {
      c.status = 'fail'; c.summary = 'Your SPF record needs ' + lookups + ' DNS lookups — more than the limit of 10, so it fails at many receivers.';
      c.fix = { text: 'Remove services you no longer use, or replace include: entries with their ip4: ranges. Aim for 10 lookups or fewer.', example: ex };
    } else if (p.all === '+') {
      c.status = 'fail'; c.summary = 'Your SPF ends with “+all”, which lets the whole internet send email as you.'; c.fix = fixEx;
    } else if (p.all === '?') {
      c.status = 'warn'; c.summary = 'Your SPF ends with “?all” (neutral), which gives no protection.'; c.fix = fixEx;
    } else if (p.all === null && !p.redirect) {
      c.status = 'warn'; c.summary = 'Your SPF has no “all” at the end, so it does not say what to do with other senders.'; c.fix = fixEx;
    } else if (p.all === '~') {
      c.status = 'warn'; c.summary = 'SPF is set up with “~all” (soft fail). Good start — once DMARC is working, “-all” is stricter.'; c.fix = fixEx;
    } else {
      c.summary = p.all === '-' ? 'SPF is set up and strict (“-all”). Fake senders will be rejected.' : 'SPF is set up and points to another record via redirect.';
    }
    if (c.status === 'pass' && p.unknown.length) c.status = 'warn';
    return c;
  }

  function evalDmarc(d, data) {
    var name = 'DMARC (what to do with fake email)';
    var recs = (data.dmarcTxt || []).filter(isDmarc);
    var ex = '_dmarc.' + d + '.  TXT  "v=DMARC1; p=quarantine; pct=100; rua=mailto:dmarc-reports@' + d + '"';
    var fix = { text: 'Start with p=none for 2–4 weeks to read the reports, then move to p=quarantine and finally p=reject:', example: ex };
    if (!recs.length) return check('dmarc', name, 'fail', 'No DMARC record. Receivers get no instructions about fake email using your name.', { fix: fix });
    if (recs.length > 1) return check('dmarc', name, 'fail', 'There is more than one DMARC record, so receivers ignore them all.', { found: recs, fix: { text: 'Keep exactly one record at _dmarc.' + d + ':', example: ex } });
    var t = parseTags(recs[0]), c = check('dmarc', name, 'pass', '', { found: recs, fix: fix });
    var pol = (t.p || '').toLowerCase(), pct = t.pct == null ? 100 : parseInt(t.pct, 10);
    if (['none', 'quarantine', 'reject'].indexOf(pol) < 0) {
      c.status = 'fail'; c.summary = 'The DMARC record has no valid policy (p=). Receivers will ignore it.'; return c;
    }
    if (pol === 'none') { c.status = 'warn'; c.summary = 'DMARC is in monitor-only mode (p=none). Fake email is still delivered.'; }
    else if (pol === 'quarantine') c.summary = 'DMARC sends fake email to spam (p=quarantine).';
    else c.summary = 'DMARC blocks fake email outright (p=reject). Excellent.';
    if (isNaN(pct) || pct < 100) { if (pol !== 'none') c.status = 'warn'; c.details.push('Only ' + (isNaN(pct) ? '?' : pct) + '% of failing email is covered (pct). Raise it to 100.'); }
    if (!t.rua) { if (c.status === 'pass') c.status = 'warn'; c.details.push('No reporting address (rua). Add one so you can see who sends email as you.'); }
    else c.details.push('Reports go to: ' + t.rua);
    if (t.sp && t.sp.toLowerCase() === 'none' && pol !== 'none') c.details.push('Subdomains are not protected (sp=none).');
    if (c.status === 'pass') c.fix = null;
    return c;
  }

  function evalDkim(d, data) {
    var name = 'DKIM (email signature)';
    var found = (data.dkim || []).filter(function (k) { return /(^|;)\s*p=\s*[A-Za-z0-9+\/]/.test(k.record) || /v=DKIM1/i.test(k.record) && !/(^|;)\s*p=\s*(;|$)/.test(k.record); });
    var tried = data.dkimSelectors || [];
    if (!found.length) return check('dkim', name, 'warn', 'We did not find a DKIM key at the common names we tried. You may still have one under a different name.', {
      details: ['Selectors tried: ' + tried.join(', ') + '.', 'Not finding a key does not prove DKIM is missing — check your email provider’s admin panel.'],
      fix: { text: 'Turn on DKIM signing in your email admin panel (Google Workspace, Microsoft 365 and Zoho all have a button). It gives you a record like:', example: 'google._domainkey.' + d + '.  TXT  "v=DKIM1; k=rsa; p=MIIBIjANBgkq…"' }
    });
    var c = check('dkim', name, 'pass', 'DKIM key found (' + found.map(function (k) { return k.selector; }).join(', ') + '). Your emails can be signed.', {
      found: found.map(function (k) { return k.selector + '._domainkey: ' + k.record; })
    });
    found.forEach(function (k) {
      var p = (parseTags(k.record).p || '').replace(/\s+/g, '');
      if (p && p.length < 300 && !/k=ed25519/i.test(k.record)) { c.status = 'warn'; c.details.push('The “' + k.selector + '” key looks like 1024-bit. Switch to a 2048-bit key.'); }
    });
    if (c.status === 'warn') c.fix = { text: 'Generate a new 2048-bit DKIM key in your email admin panel and publish it under a new selector.', example: 'selector2._domainkey.' + d + '.  TXT  "v=DKIM1; k=rsa; p=<2048-bit key>"' };
    return c;
  }

  function evalDnssec(d, data) {
    var name = 'DNSSEC (tamper-proof DNS)';
    if (data.ad) return check('dnssec', name, 'pass', 'DNSSEC is on and the answers checked out as genuine.');
    if (data.ds && data.ds.length) return check('dnssec', name, 'fail', 'DNSSEC is switched on at the registry but answers do not validate. This can make your domain unreachable.', {
      found: data.ds, fix: { text: 'Ask your DNS host to re-sign the zone, or remove the old DS record at your registrar.', example: 'Registrar → Domain → DNSSEC → check the DS record matches your DNS host' }
    });
    return check('dnssec', name, 'warn', 'DNSSEC is not turned on. It stops attackers from faking your DNS answers.', {
      fix: { text: 'Most DNS hosts (Cloudflare, Route 53, many Indian registrars) have a one-click DNSSEC button. Turn it on, then add the DS record they give you at your registrar.', example: d + '.  DS  2371 13 2 <digest from your DNS host>' }
    });
  }

  function evalCaa(d, data) {
    var name = 'CAA (who may issue your HTTPS certificates)';
    var recs = data.caa || [];
    if (!recs.length) return check('caa', name, 'warn', 'No CAA record, so any certificate authority may issue certificates for your domain.', {
      fix: { text: 'List only the authorities you use. Example for Let’s Encrypt plus a reporting address:', example: d + '.  CAA  0 issue "letsencrypt.org"\n' + d + '.  CAA  0 iodef "mailto:security@' + d + '"' }
    });
    var issuers = recs.map(function (r) { var m = /^\d+\s+issue(?:wild)?\s+"?([^";]*)/i.exec(r); return m ? (m[1].trim() || 'none') : null; }).filter(Boolean);
    var uniq = issuers.filter(function (v, i) { return issuers.indexOf(v) === i; });
    return check('caa', name, 'pass', 'Only listed authorities may issue certificates' + (uniq.length ? ': ' + uniq.join(', ') : '') + '.', {
      found: recs, details: data.caaAt && data.caaAt !== d ? ['Inherited from ' + data.caaAt + '.'] : []
    });
  }

  function evalMtaSts(d, data) {
    var name = 'MTA-STS (force encrypted mail delivery)';
    var recs = (data.mtasts || []).filter(function (t) { return /^v=STSv1/i.test(t.trim()); });
    var fix = { text: 'Publish this TXT record and a policy file at https://mta-sts.' + d + '/.well-known/mta-sts.txt (start with mode: testing):', example: '_mta-sts.' + d + '.  TXT  "v=STSv1; id=20260101T000000"\n\n# mta-sts.txt\nversion: STSv1\nmode: testing\nmx: <your mx host>\nmax_age: 86400' };
    if (!recs.length) return check('mtasts', name, 'warn', 'Not set up. Other mail servers may deliver to you without encryption if someone interferes.', { fix: fix });
    var t = parseTags(recs[0]);
    if (!t.id) return check('mtasts', name, 'warn', 'The MTA-STS record is missing its “id”, so it will be ignored.', { found: recs, fix: fix });
    return check('mtasts', name, 'pass', 'MTA-STS is announced. (We cannot read the policy file from a browser page.)', { found: recs });
  }

  function evalTlsRpt(d, data) {
    var name = 'TLS-RPT (delivery encryption reports)';
    var recs = (data.tlsrpt || []).filter(function (t) { return /^v=TLSRPTv1/i.test(t.trim()); });
    if (!recs.length) return check('tlsrpt', name, 'warn', 'Not set up. You would not hear about failed encrypted deliveries.', {
      fix: { text: 'Add a TXT record with an address for daily reports:', example: '_smtp._tls.' + d + '.  TXT  "v=TLSRPTv1; rua=mailto:tls-reports@' + d + '"' }
    });
    return check('tlsrpt', name, 'pass', 'Reports about encrypted delivery are switched on.', { found: recs });
  }

  function evalBimi(d, data) {
    var name = 'BIMI (logo in inbox) — optional';
    var recs = (data.bimi || []).filter(function (t) { return /^v=BIMI1/i.test(t.trim()); });
    if (!recs.length) return check('bimi', name, 'info', 'Not set up. Optional: shows your logo next to your emails in some inboxes, once DMARC is at quarantine or reject.', {
      fix: { text: 'Needs DMARC enforcement first, then a square SVG logo (and for Gmail, a mark certificate):', example: 'default._bimi.' + d + '.  TXT  "v=BIMI1; l=https://' + d + '/logo.svg"' }
    });
    return check('bimi', name, 'info', 'BIMI is set up — your logo can appear in supporting inboxes.', { found: recs });
  }

  function gradeFor(pct, capped) {
    var g = pct >= 90 ? 'A' : pct >= 75 ? 'B' : pct >= 60 ? 'C' : pct >= 45 ? 'D' : 'F';
    if (capped && (g === 'A' || g === 'B' || g === 'C')) g = 'D';
    return g;
  }

  function evaluateDomain(d, data) {
    var checks = [evalSpf(d, data), evalDmarc(d, data), evalDkim(d, data), evalMx(d, data), evalDnssec(d, data), evalCaa(d, data), evalMtaSts(d, data), evalTlsRpt(d, data), evalBimi(d, data)];
    var got = 0, max = 0, capped = false;
    checks.forEach(function (c) {
      var w = WEIGHTS[c.id] || 0; if (!w || c.status === 'info') return;
      max += w; got += w * (c.status === 'pass' ? 1 : c.status === 'warn' ? 0.5 : 0);
      if ((c.id === 'spf' || c.id === 'dmarc') && c.status === 'fail') capped = true;
    });
    var pct = max ? Math.round(got / max * 100) : 0;
    var counts = { pass: 0, warn: 0, fail: 0, info: 0 };
    checks.forEach(function (c) { counts[c.status]++; });
    return { domain: d, score: pct, grade: gradeFor(pct, capped), capped: capped, counts: counts, checks: checks };
  }

  /* ---------- Self-assessment scoring ---------- */
  var VAL = { yes: 1, partly: 0.5, no: 0 };
  var EFFORT_RANK = { quick: 0, medium: 1, project: 2 };
  function maturity(pct) {
    if (pct == null) return { key: 'na', label: 'Not applicable' };
    if (pct >= 90) return { key: 'strong', label: 'Strong' };
    if (pct >= 70) return { key: 'good', label: 'Established' };
    if (pct >= 40) return { key: 'dev', label: 'Developing' };
    return { key: 'start', label: 'Starting out' };
  }
  function scoreAssessment(areas, questions, answers) {
    answers = answers || {};
    var byArea = {}, got = 0, max = 0, unanswered = 0, plan = [];
    areas.forEach(function (a) { byArea[a.id] = { id: a.id, name: a.name, got: 0, max: 0, answered: 0, total: 0 }; });
    questions.forEach(function (q, idx) {
      var a = answers[q.id], s = byArea[q.area]; if (!s) return;
      s.total++;
      if (a === 'na') { s.answered++; return; }
      if (!a) unanswered++; else s.answered++;
      var v = VAL[a] || 0;
      s.max += q.weight; s.got += q.weight * v; max += q.weight; got += q.weight * v;
      if (v < 1) {
        var pr = q.weight * (a === 'partly' ? 0.5 : 1);
        plan.push({ id: q.id, area: q.area, q: q.q, fix: q.fix, effort: q.effort, weight: q.weight, answer: a || 'unanswered', priority: pr,
          level: pr >= 3 ? 'High' : pr >= 1.5 ? 'Medium' : 'Low', order: idx });
      }
    });
    plan.sort(function (x, y) { return y.priority - x.priority || EFFORT_RANK[x.effort] - EFFORT_RANK[y.effort] || x.order - y.order; });
    var list = areas.map(function (a) {
      var s = byArea[a.id]; s.pct = s.max ? Math.round(s.got / s.max * 100) : null; s.level = maturity(s.pct); return s;
    });
    var pct = max ? Math.round(got / max * 100) : 0;
    return { score: pct, level: maturity(pct), areas: list, plan: plan, unanswered: unanswered, total: questions.length };
  }

  /* ---------- DNS over HTTPS ---------- */
  var TYPES = { A: 1, CNAME: 5, SOA: 6, MX: 15, TXT: 16, DS: 43, CAA: 257 };
  var DKIM_SELECTORS = ['google', 'selector1', 'selector2', 'default', 'k1', 'k2', 'mail', 's1', 's2', 'dkim', 'mxvault', 'zoho', 'zmail'];
  var RESOLVERS = [
    function (n, t) { return 'https://cloudflare-dns.com/dns-query?name=' + encodeURIComponent(n) + '&type=' + t; },
    function (n, t) { return 'https://dns.google/resolve?name=' + encodeURIComponent(n) + '&type=' + t; }
  ];

  function fetchJson(url, ms) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, ms || 8000);
    return fetch(url, { headers: { accept: 'application/dns-json' }, signal: ctl ? ctl.signal : undefined })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { clearTimeout(timer); return j; }, function (e) { clearTimeout(timer); throw e; });
  }

  // Returns { status, ad, answers:[data strings of the asked type] }. Tries Cloudflare, then Google.
  function dnsQuery(name, type) {
    var code = TYPES[type];
    var i = 0;
    function attempt() {
      return fetchJson(RESOLVERS[i](name, type)).then(function (j) {
        if (j.Status === 2 && i < RESOLVERS.length - 1) { i++; return attempt(); }   // SERVFAIL → try the other resolver
        var ans = (j.Answer || []).filter(function (a) { return a.type === code; }).map(function (a) { return type === 'TXT' ? txtData(a.data) : String(a.data); });
        return { status: j.Status, ad: !!j.AD, answers: ans };
      }, function (e) {
        if (i < RESOLVERS.length - 1) { i++; return attempt(); }
        throw e;
      });
    }
    return attempt();
  }
  function txtOf(name) { return dnsQuery(name, 'TXT').then(function (r) { return r.answers; }); }

  // Gathers everything evaluateDomain needs. onStep(label) is called for progress messages.
  function gatherDomain(d, onStep) {
    var step = onStep || function () {};
    var data = { dkimSelectors: DKIM_SELECTORS.slice() };
    step('Looking up your domain…');
    return dnsQuery(d, 'SOA').then(function (soa) {
      if (soa.status === 3) { var e = new Error('nxdomain'); e.code = 'NXDOMAIN'; throw e; }
      if (soa.status !== 0) { var e2 = new Error('servfail'); e2.code = 'SERVFAIL'; throw e2; }
      data.ad = soa.ad;
      step('Checking email records…');
      var parent = d.split('.').slice(1).join('.');
      var jobs = [
        dnsQuery(d, 'MX').then(function (r) { data.mx = r.answers; }),
        txtOf(d).then(function (t) { data.txt = t; }),
        txtOf('_dmarc.' + d).then(function (t) { data.dmarcTxt = t; }),
        dnsQuery(d, 'DS').then(function (r) { data.ds = r.answers; }),
        dnsQuery(d, 'CAA').then(function (r) {
          data.caa = r.answers; data.caaAt = d;
          if (!r.answers.length && parent.split('.').length >= 2) return dnsQuery(parent, 'CAA').then(function (p) { if (p.answers.length) { data.caa = p.answers; data.caaAt = parent; } });
        }),
        txtOf('_mta-sts.' + d).then(function (t) { data.mtasts = t; }),
        txtOf('_smtp._tls.' + d).then(function (t) { data.tlsrpt = t; }),
        txtOf('default._bimi.' + d).then(function (t) { data.bimi = t; }),
        Promise.all(DKIM_SELECTORS.map(function (s) {
          return txtOf(s + '._domainkey.' + d).then(function (t) {
            var rec = t.filter(function (x) { return /p=|v=DKIM1/i.test(x); })[0];
            return rec ? { selector: s, record: rec } : null;
          }, function () { return null; });
        })).then(function (list) { data.dkim = list.filter(Boolean); })
      ];
      return Promise.all(jobs);
    }).then(function () {
      var spfs = (data.txt || []).filter(isSpf);
      if (spfs.length !== 1) return;
      step('Counting SPF lookups…');
      var seen = {}; seen[d] = 1;
      return countSpfLookups(spfs[0], txtOf, seen).then(function (r) { data.spfLookups = r; });
    }).then(function () { step('Scoring…'); return data; });
  }

  var api = {
    dnsQuery: dnsQuery, gatherDomain: gatherDomain, DKIM_SELECTORS: DKIM_SELECTORS,
    normaliseDomain: normaliseDomain, txtData: txtData, isSpf: isSpf, isDmarc: isDmarc, parseSPF: parseSPF,
    countSpfLookups: countSpfLookups, parseTags: parseTags, evaluateDomain: evaluateDomain, gradeFor: gradeFor,
    guessProvider: guessProvider, scoreAssessment: scoreAssessment, maturity: maturity, WEIGHTS: WEIGHTS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SecLogic = api;
})(this);
