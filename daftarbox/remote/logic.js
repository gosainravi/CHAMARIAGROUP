/* Remote access portal: pure helpers (no DOM). Works as a classic <script> and in Node (module.exports). */
(function (root) {
  'use strict';

  function randInt(max, rng) {
    // Uniform integer in [0, max) using rejection sampling on 32-bit values.
    if (rng) return Math.floor(rng() * max);
    var c = (root.crypto || (typeof globalThis !== 'undefined' && globalThis.crypto));
    if (c && c.getRandomValues) {
      var buf = new Uint32Array(1), lim = Math.floor(4294967296 / max) * max;
      do { c.getRandomValues(buf); } while (buf[0] >= lim);
      return buf[0] % max;
    }
    return Math.floor(Math.random() * max);
  }

  /* Luhn check digit for a string of digits */
  function luhnDigit(body) {
    var sum = 0, dbl = true;
    for (var i = body.length - 1; i >= 0; i--) {
      var d = +body[i];
      if (dbl) { d *= 2; if (d > 9) d -= 9; }
      sum += d; dbl = !dbl;
    }
    return String((10 - (sum % 10)) % 10);
  }

  /* 9-digit device ID: 8 random digits (first is 1-9) + 1 check digit to catch typos */
  function genId(rng) {
    var s = String(1 + randInt(9, rng));
    for (var i = 0; i < 7; i++) s += randInt(10, rng);
    return s + luhnDigit(s);
  }

  function digitsOnly(v) { return String(v == null ? '' : v).replace(/\D+/g, ''); }

  /* "123456789" -> "123 456 789"; partial input is grouped as typed */
  function formatId(v) {
    var d = digitsOnly(v).slice(0, 9);
    return d.replace(/(\d{3})(?=\d)/g, '$1 ');
  }

  /* Returns {ok, id, msg} */
  function checkId(v) {
    var d = digitsOnly(v);
    if (!d.length) return { ok: false, id: '', msg: 'Type the 9-digit ID shown on the other computer.' };
    if (d.length < 9) return { ok: false, id: d, msg: 'That ID is too short. It should have 9 digits.' };
    if (d.length > 9) return { ok: false, id: d, msg: 'That ID is too long. It should have 9 digits.' };
    if (d[0] === '0') return { ok: false, id: d, msg: 'IDs never start with 0. Please check the number.' };
    if (luhnDigit(d.slice(0, 8)) !== d[8]) return { ok: false, id: d, msg: 'This ID does not look right. One digit may be wrong – please check again.' };
    return { ok: true, id: d, msg: '' };
  }

  /* One-time password: 8 characters without look-alikes (no 0/o, 1/l/i), shown as xxxx-xxxx */
  var OTP_SET = 'abcdefghjkmnpqrstuvwxyz23456789';
  function genOtp(rng) {
    var s = '';
    for (var i = 0; i < 8; i++) s += OTP_SET[randInt(OTP_SET.length, rng)];
    return s.slice(0, 4) + '-' + s.slice(4);
  }

  /* Password strength for unattended access. Returns {score 0-4, label, tips[], ok} */
  var COMMON = ['password', 'passw0rd', 'qwerty', 'asdf', 'zxcv', '123456', '12345678', 'admin', 'welcome', 'letmein',
    'india', 'bharat', 'iloveyou', 'monkey', 'dragon', 'daftarbox', 'remote', 'access', 'abc123', 'login', 'master', 'secret'];
  function hasSequence(pw) {
    var s = pw.toLowerCase(), seqs = ['abcdefghijklmnopqrstuvwxyz', '01234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
    for (var i = 0; i + 4 <= s.length; i++) {
      var part = s.slice(i, i + 4), rev = part.split('').reverse().join('');
      for (var j = 0; j < seqs.length; j++) if (seqs[j].indexOf(part) >= 0 || seqs[j].indexOf(rev) >= 0) return true;
    }
    return false;
  }
  function strength(pw) {
    pw = String(pw || '');
    var tips = [];
    if (!pw) return { score: 0, label: 'Not set', tips: ['Use at least 12 characters.'], ok: false, bits: 0 };
    var pool = 0, classes = 0;
    if (/[a-z]/.test(pw)) { pool += 26; classes++; }
    if (/[A-Z]/.test(pw)) { pool += 26; classes++; }
    if (/\d/.test(pw)) { pool += 10; classes++; }
    if (/[^A-Za-z0-9]/.test(pw)) { pool += 33; classes++; }
    var uniq = {}; for (var i = 0; i < pw.length; i++) uniq[pw[i]] = 1;
    var uniqN = Object.keys(uniq).length;
    var effLen = Math.min(pw.length, uniqN * 2);
    var bits = effLen * Math.log(pool) / Math.LN2;
    var low = pw.toLowerCase(), common = false;
    for (var k = 0; k < COMMON.length; k++) if (low.indexOf(COMMON[k]) >= 0) { common = true; break; }
    if (common) { bits -= 20; tips.push('Avoid common words like “password” or “admin”.'); }
    if (hasSequence(pw)) { bits -= 10; tips.push('Avoid runs like “1234” or “abcd”.'); }
    if (/(.)\1\1/.test(pw)) { bits -= 6; tips.push('Avoid repeating the same character.'); }
    if (pw.length < 12) tips.push('Use at least 12 characters.');
    if (classes < 3) tips.push('Mix capitals, small letters, numbers and symbols.');
    var score = bits < 28 ? 0 : bits < 40 ? 1 : bits < 56 ? 2 : bits < 72 ? 3 : 4;
    if (pw.length < 12 && score > 2) score = 2;
    if (common && score > 2) score = 2;
    var labels = ['Too weak', 'Weak', 'Okay', 'Strong', 'Very strong'];
    return { score: score, label: labels[score], tips: tips, ok: score >= 3 && pw.length >= 12, bits: Math.max(0, Math.round(bits)) };
  }

  /* CSV: quote every cell and neutralise spreadsheet formulas */
  function csvCell(v) {
    var s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function toCsv(rows) {
    return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
  }

  function fmtDuration(sec) {
    sec = Math.max(0, Math.round(+sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h) return h + ' h ' + (m < 10 ? '0' : '') + m + ' min';
    if (m) return m + ' min ' + (s < 10 ? '0' : '') + s + ' s';
    return s + ' s';
  }

  /* Validate + normalise a device record from the address-book form */
  function cleanDevice(d) {
    var errs = {};
    var name = String(d.name || '').trim().slice(0, 60);
    if (!name) errs.name = 'Give this device a name, e.g. “Papa’s laptop”.';
    var idc = checkId(d.id);
    if (!idc.ok) errs.id = idc.msg;
    return {
      ok: !Object.keys(errs).length, errs: errs,
      device: {
        name: name, id: idc.id,
        group: String(d.group || '').trim().slice(0, 40),
        notes: String(d.notes || '').trim().slice(0, 500),
        unattended: !!d.unattended
      }
    };
  }

  /* Drop history entries older than `days` (0 = keep all) */
  function pruneHistory(list, days, now) {
    if (!days) return list.slice();
    var cut = (now || Date.now()) - days * 86400000;
    return list.filter(function (h) { return +h.start >= cut; });
  }

  var api = { luhnDigit: luhnDigit, genId: genId, digitsOnly: digitsOnly, formatId: formatId, checkId: checkId,
    genOtp: genOtp, strength: strength, csvCell: csvCell, toCsv: toCsv, fmtDuration: fmtDuration,
    cleanDevice: cleanDevice, pruneHistory: pruneHistory, OTP_SET: OTP_SET };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RemoteLogic = api;
})(typeof window !== 'undefined' ? window : this);
