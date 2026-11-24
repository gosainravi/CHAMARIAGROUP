const WebSocket = require('ws');
const crypto = require('crypto');
const { issueId } = require('./ids');

const LOCK_MS = 5 * 60 * 1000;
const MAX_FAILS = 5;

function createServer({ port = 8080, limitMs = 40 * 60 * 1000, authTimeoutMs = 35 * 1000 } = {}) {
  const wss = new WebSocket.Server({ port, maxPayload: 256 * 1024, perMessageDeflate: false });
  const clients = new Map();
  const pending = new Map();          // reqId -> { from, to, timer }
  const pendingByTarget = new Map();  // targetId -> reqId (one password check at a time per target)
  const fails = new Map();
  const send = (ws, o) => ws && ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(o));

  function clearTimers(s) { clearTimeout(s.warnTimer); clearTimeout(s.endTimer); }

  function dropPending(reqId) {
    const p = pending.get(reqId);
    if (!p) return null;
    clearTimeout(p.timer);
    pending.delete(reqId);
    if (pendingByTarget.get(p.to) === reqId) pendingByTarget.delete(p.to);
    return p;
  }

  function endSession(ws, reason) {
    const peer = ws.peer && clients.get(ws.peer);
    for (const s of [ws, peer]) {
      if (!s || !s.peer) continue;
      clearTimers(s);
      s.peer = null;
      s.sessionId = null;
      send(s, { type: 'session-end', reason });
    }
  }

  function startSession(a, b) {
    const sessionId = crypto.randomUUID();
    a.peer = b.id; b.peer = a.id;
    a.sessionId = b.sessionId = sessionId;
    send(a, { type: 'session-start', sessionId, peerId: b.id, role: 'viewer', limitMs });
    send(b, { type: 'session-start', sessionId, peerId: a.id, role: 'shared', limitMs });
    const warnAt = limitMs >= 10 * 60 * 1000 ? limitMs - 5 * 60 * 1000 : limitMs - limitMs / 8;
    a.warnTimer = setTimeout(() => {
      for (const s of [a, b]) send(s, { type: 'session-warning', remainingMs: limitMs - warnAt });
    }, warnAt);
    a.endTimer = setTimeout(() => endSession(a, 'timeout'), limitMs);
  }

  function onConnect(ws, m) {
    const targetId = String(m.targetId || '');
    const target = clients.get(targetId);
    const f = fails.get(targetId);
    if (!target || target === ws) return send(ws, { type: 'connect-result', ok: false, reason: 'offline' });
    if (f && f.until > Date.now()) return send(ws, { type: 'connect-result', ok: false, reason: 'locked' });
    if (target.peer || ws.peer || pendingByTarget.has(targetId)) return send(ws, { type: 'connect-result', ok: false, reason: 'busy' });
    const reqId = crypto.randomUUID();
    const timer = setTimeout(() => {
      const p = dropPending(reqId);
      if (p) send(clients.get(p.from), { type: 'connect-result', ok: false, reason: 'no-answer' });
    }, authTimeoutMs);
    pending.set(reqId, { from: ws.id, to: target.id, timer });
    pendingByTarget.set(target.id, reqId);
    send(target, { type: 'auth-request', fromId: ws.id, password: String(m.password || ''), reqId });
  }

  function onAuthResponse(ws, m) {
    const p = pending.get(m.reqId);
    if (!p || p.to !== ws.id) return;
    dropPending(m.reqId);
    const a = clients.get(p.from);
    if (!a) return;
    if (m.ok !== true) {
      const f = fails.get(ws.id) || { count: 0, until: 0 };
      f.count++;
      if (f.count >= MAX_FAILS) { f.until = Date.now() + LOCK_MS; f.count = 0; }
      fails.set(ws.id, f);
      return send(a, { type: 'connect-result', ok: false, reason: 'wrong-password' });
    }
    fails.delete(ws.id);
    if (a.peer || ws.peer) return send(a, { type: 'connect-result', ok: false, reason: 'busy' });
    send(a, { type: 'connect-result', ok: true });
    startSession(a, ws);
  }

  function onMessage(ws, m) {
    if (m.type === 'connect') onConnect(ws, m);
    else if (m.type === 'auth-response') onAuthResponse(ws, m);
    else if (m.type === 'signal') send(ws.peer && clients.get(ws.peer), { type: 'signal', sessionId: ws.sessionId, data: m.data });
    else if (m.type === 'end') endSession(ws, 'ended');
  }

  wss.on('connection', ws => {
    ws.id = issueId(clients);
    clients.set(ws.id, ws);
    send(ws, { type: 'welcome', id: ws.id });

    ws.on('message', (raw, isBinary) => {
      if (isBinary) {
        // Screen and control traffic: forwarded untouched, only to the paired peer.
        const peer = ws.peer && clients.get(ws.peer);
        if (peer && peer.readyState === WebSocket.OPEN) peer.send(raw, { binary: true });
        return;
      }
      let m;
      try { m = JSON.parse(raw); } catch { return; }
      if (!m || typeof m !== 'object' || Array.isArray(m)) return;
      try { onMessage(ws, m); } catch (e) { console.error('message handling failed:', e.message); }
    });

    ws.on('close', () => {
      clients.delete(ws.id);
      for (const [reqId, p] of pending) {
        if (p.from === ws.id || p.to === ws.id) {
          dropPending(reqId);
          if (p.to === ws.id) send(clients.get(p.from), { type: 'connect-result', ok: false, reason: 'offline' });
        }
      }
      if (!ws.peer) return;
      const peer = clients.get(ws.peer);
      clearTimers(ws);
      if (peer) { clearTimers(peer); peer.peer = null; peer.sessionId = null; send(peer, { type: 'session-end', reason: 'peer-left' }); }
    });
  });

  return { close: () => wss.close(), get port() { return wss.address().port; } };
}

module.exports = { createServer };
