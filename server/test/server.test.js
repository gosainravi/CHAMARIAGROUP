const test = require('node:test');
const assert = require('node:assert');
const WebSocket = require('ws');
const { createServer } = require('../src/server');

function client(port) {
  return new Promise(res => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    const queue = []; const waiters = [];
    ws.on('message', (m, isBinary) => { if (isBinary) return; const msg = JSON.parse(m); const w = waiters.shift(); w ? w(msg) : queue.push(msg); });
    ws.next = () => new Promise(r => queue.length ? r(queue.shift()) : waiters.push(r));
    ws.sendJson = o => ws.send(JSON.stringify(o));
    ws.on('open', async () => { ws.id = (await ws.next()).id; res(ws); });
  });
}

async function pair(s) {
  const a = await client(s.port), b = await client(s.port);
  a.sendJson({ type: 'connect', targetId: b.id, password: 'p' });
  const req = await b.next(); b.sendJson({ type: 'auth-response', reqId: req.reqId, ok: true });
  await a.next(); await a.next(); await b.next();
  return { a, b };
}

test('issues unique 9-digit ids', async () => {
  const s = createServer({ port: 0 });
  const a = await client(s.port), b = await client(s.port);
  assert.match(a.id, /^\d{9}$/); assert.notStrictEqual(a.id, b.id);
  a.close(); b.close(); s.close();
});

test('connect: B approves → session-start to both', async () => {
  const s = createServer({ port: 0 });
  const a = await client(s.port), b = await client(s.port);
  a.sendJson({ type: 'connect', targetId: b.id, password: 'abc123' });
  const req = await b.next();
  assert.strictEqual(req.type, 'auth-request'); assert.strictEqual(req.password, 'abc123'); assert.strictEqual(req.fromId, a.id);
  b.sendJson({ type: 'auth-response', reqId: req.reqId, ok: true });
  assert.deepStrictEqual(await a.next(), { type: 'connect-result', ok: true });
  const sa = await a.next(); const sb = await b.next();
  assert.strictEqual(sa.role, 'viewer'); assert.strictEqual(sb.role, 'shared'); assert.strictEqual(sa.peerId, b.id);
  a.close(); b.close(); s.close();
});

test('offline target', async () => {
  const s = createServer({ port: 0 });
  const a = await client(s.port);
  a.sendJson({ type: 'connect', targetId: '123456789', password: 'x' });
  assert.deepStrictEqual(await a.next(), { type: 'connect-result', ok: false, reason: 'offline' });
  a.close(); s.close();
});

test('5 wrong passwords locks target', async () => {
  const s = createServer({ port: 0 });
  const a = await client(s.port), b = await client(s.port);
  for (let i = 0; i < 5; i++) {
    a.sendJson({ type: 'connect', targetId: b.id, password: 'bad' });
    const req = await b.next();
    b.sendJson({ type: 'auth-response', reqId: req.reqId, ok: false });
    assert.strictEqual((await a.next()).reason, 'wrong-password');
  }
  a.sendJson({ type: 'connect', targetId: b.id, password: 'good' });
  assert.strictEqual((await a.next()).reason, 'locked');
  a.close(); b.close(); s.close();
});

test('busy target', async () => {
  const s = createServer({ port: 0 });
  const { a, b } = await pair(s);
  const c = await client(s.port);
  c.sendJson({ type: 'connect', targetId: b.id, password: 'p' });
  assert.deepStrictEqual(await c.next(), { type: 'connect-result', ok: false, reason: 'busy' });
  a.close(); b.close(); c.close(); s.close();
});

test('signal forwarded, warning then timeout ends session', async () => {
  const s = createServer({ port: 0, limitMs: 400 });
  const { a, b } = await pair(s);
  a.sendJson({ type: 'signal', data: { sdp: 'x' } });
  assert.deepStrictEqual((await b.next()).data, { sdp: 'x' });
  assert.strictEqual((await a.next()).type, 'session-warning');
  assert.strictEqual((await b.next()).type, 'session-warning');
  assert.deepStrictEqual(await a.next(), { type: 'session-end', reason: 'timeout' });
  assert.deepStrictEqual(await b.next(), { type: 'session-end', reason: 'timeout' });
  a.close(); b.close(); s.close();
});

test('end by shared side ends for both', async () => {
  const s = createServer({ port: 0 });
  const { a, b } = await pair(s);
  b.sendJson({ type: 'end' });
  assert.deepStrictEqual(await a.next(), { type: 'session-end', reason: 'ended' });
  assert.deepStrictEqual(await b.next(), { type: 'session-end', reason: 'ended' });
  a.close(); b.close(); s.close();
});

test('malformed messages do not crash the server', async () => {
  const s = createServer({ port: 0 });
  const a = await client(s.port);
  for (const raw of ['null', '42', '"x"', '[]', '{"type":null}', '{"type":"connect"}']) a.send(raw);
  await new Promise(r => setTimeout(r, 100));
  const b = await client(s.port);
  assert.match(b.id, /^\d{9}$/);
  a.close(); b.close(); s.close();
});

test('only one pending password check per target (no flooding past lockout)', async () => {
  const s = createServer({ port: 0 });
  const a = await client(s.port), b = await client(s.port);
  for (let i = 0; i < 10; i++) a.sendJson({ type: 'connect', targetId: b.id, password: 'guess' + i });
  const first = await b.next();
  assert.strictEqual(first.type, 'auth-request');
  for (let i = 0; i < 9; i++) assert.strictEqual((await a.next()).reason, 'busy');
  b.sendJson({ type: 'auth-response', reqId: first.reqId, ok: false });
  assert.strictEqual((await a.next()).reason, 'wrong-password');
  a.close(); b.close(); s.close();
});

test('unanswered password check expires', async () => {
  const s = createServer({ port: 0, authTimeoutMs: 150 });
  const a = await client(s.port), b = await client(s.port);
  a.sendJson({ type: 'connect', targetId: b.id, password: 'p' });
  await b.next();
  assert.deepStrictEqual(await a.next(), { type: 'connect-result', ok: false, reason: 'no-answer' });
  a.sendJson({ type: 'connect', targetId: b.id, password: 'p' });
  assert.strictEqual((await b.next()).type, 'auth-request');
  a.close(); b.close(); s.close();
});

test('session id ties signals to their session', async () => {
  const s = createServer({ port: 0 });
  const a = await client(s.port), b = await client(s.port);
  a.sendJson({ type: 'connect', targetId: b.id, password: 'p' });
  const req = await b.next(); b.sendJson({ type: 'auth-response', reqId: req.reqId, ok: true });
  await a.next(); const sa = await a.next(); const sb = await b.next();
  assert.ok(sa.sessionId); assert.strictEqual(sa.sessionId, sb.sessionId);
  a.sendJson({ type: 'signal', data: { sdp: 'x' } });
  assert.deepStrictEqual(await b.next(), { type: 'signal', sessionId: sa.sessionId, data: { sdp: 'x' } });
  a.close(); b.close(); s.close();
});

test('binary frames are relayed only between paired peers', async () => {
  const s = createServer({ port: 0 });
  const { a, b } = await pair(s);
  const c = await client(s.port);
  const got = new Promise(r => b.once('message', (m, isBinary) => r({ m, isBinary })));
  a.send(Buffer.from([1, 2, 3, 4]));
  const { m, isBinary } = await got;
  assert.strictEqual(isBinary, true);
  assert.deepStrictEqual([...m], [1, 2, 3, 4]);
  let leaked = false;
  a.on('message', () => { leaked = true; });
  c.send(Buffer.from([9, 9]));
  await new Promise(r => setTimeout(r, 100));
  assert.strictEqual(leaked, false);
  a.close(); b.close(); c.close(); s.close();
});

test('close drops pairs: peer gets peer-left', async () => {
  const s = createServer({ port: 0 });
  const { a, b } = await pair(s);
  a.close();
  assert.deepStrictEqual(await b.next(), { type: 'session-end', reason: 'peer-left' });
  b.close(); s.close();
});
