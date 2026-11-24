# SS-Connect Desktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a first testable `SS-Connect.exe` (Windows) plus a signaling server, so two PCs can connect by ID + password, view the screen, and control it only after B clicks Allow, with a 40-minute limit.

**Architecture:** Node.js WebSocket signaling server (IDs, password check relayed to B, session timer). C# .NET Framework 4.8 WinForms app; WebRTC via SIPSorcery for direct-first/TURN-fallback connectivity with two data channels (`screen`, `control`). Screen = 64×64 changed tiles as JPEG; control = normalized input events injected with `SendInput`, gated on B.

**Tech Stack:** Node.js 20+ with `ws`; `node:test`. C# 7.3 / .NET Framework 4.8, WinForms, SIPSorcery (NuGet), Newtonsoft.Json; xUnit tests; .NET 8 SDK for building; GitHub Actions `windows-latest`.

**Spec:** `docs/superpowers/specs/2026-11-24-ss-connect-desktop-design.md`

## Global Constraints

- Windows 10/11 only; app targets .NET Framework 4.8 (`net48`), WinForms.
- Server address is a setting (`server.txt` next to the exe or `--server` arg), default `ws://localhost:8080`.
- ID: 9 digits, issued by the server. Password: 6 chars, random per app start, refreshable, checked on B, never stored on the server.
- 5 wrong passwords → that ID locked 5 minutes.
- Session limit 40 minutes, warning at 35, enforced by the server; overridable by env `SESSION_LIMIT_MS` for tests.
- Control only after B allows; B drops every input event unless control is granted.
- Allow popup auto-denies after 30 s. Connection lost > 30 s ends the session.
- Primary monitor only; ~12 fps; 64×64 tiles; JPEG quality 70 default; keyframe every 5 s.
- No secrets in the repo (TURN secret lives only on the VM).

## Review Focus

- B's screen resolution differs from A's window size (and DPI scaling ≠ 100%) → clicks must land where A clicked. Test: `CoordMapTests` with 150% DPI case.
- A holds a key / modifier (Ctrl+C, Shift+letters) → exactly one key on B, no doubling, no stuck modifiers when control is revoked. Test: `InputGateTests.RevokeReleasesHeldKeys`.
- A connects while B is already in a session → A gets "Partner busy", B's session is untouched. Test: server `busy target` test.
- Password typed with spaces / lowercase → still accepted. Test: `PasswordTests.NormalizesInput`.
- Server restarts mid-session → both apps show "Reconnecting…", then end cleanly; apps re-register and get a (new) ID. Test: server `close drops pairs` test + manual E2E step.

---

## File Structure

```
server/
  package.json
  src/ids.js            # 9-digit unique ID issuing
  src/server.js         # WebSocket hub: register, connect, signal, timers, lockout
  src/index.js          # starts server on PORT
  test/server.test.js
desktop/
  SSConnect.sln
  src/SSConnect.Core/   # net48 class library, no UI
    Protocol/Messages.cs      # control-channel JSON messages
    Protocol/TilePacket.cs    # binary tile message encode/decode
    Screen/TileDiffer.cs      # frame → changed tiles
    Input/CoordMap.cs         # normalized ↔ pixel
    Input/InputGate.cs        # grant/revoke, drop when not granted, track held keys
    Security/Password.cs      # generate + normalize + compare
    Net/SignalingClient.cs    # WebSocket to server
    Net/PeerLink.cs           # SIPSorcery RTCPeerConnection + 2 data channels
    Session/SessionTimer.cs   # local display countdown
  src/SSConnect.App/    # net48 WinForms exe
    Program.cs
    Settings.cs
    Win32/ScreenCapture.cs    # BitBlt primary monitor
    Win32/InputInjector.cs    # SendInput
    UI/MainForm.cs            # ID/password + partner connect
    UI/ViewerForm.cs          # A: remote screen + toolbar
    UI/AllowDialog.cs         # B: Allow / Deny popup
    UI/ControlBar.cs          # B: always-on-top bar, red while controlled
    Controller/SharedSide.cs  # B logic: capture loop, gate, inject
    Controller/ViewerSide.cs  # A logic: tiles → bitmap, send input
  tests/SSConnect.Tests/ # net48 xUnit
.github/workflows/build-ss-connect-desktop.yml
remote/index.html        # add download link (modify)
```

---

### Task 1: Toolchain + solution scaffold

**Files:**
- Create: `desktop/SSConnect.sln`, `desktop/src/SSConnect.Core/SSConnect.Core.csproj`, `desktop/src/SSConnect.App/SSConnect.App.csproj`, `desktop/tests/SSConnect.Tests/SSConnect.Tests.csproj`

**Interfaces:**
- Produces: buildable solution; `dotnet test desktop/SSConnect.sln` runs.

- [ ] **Step 1: Install .NET 8 SDK**

Run: `winget install --id Microsoft.DotNet.SDK.8 -e --accept-source-agreements --accept-package-agreements`
Then: `dotnet --list-sdks` → Expected: a line starting `8.0.`

- [ ] **Step 2: Create projects**

```powershell
cd desktop
dotnet new sln -n SSConnect
dotnet new classlib -o src/SSConnect.Core -f netstandard2.0
dotnet new winforms -o src/SSConnect.App
dotnet new xunit -o tests/SSConnect.Tests
dotnet sln add src/SSConnect.Core src/SSConnect.App tests/SSConnect.Tests
```

- [ ] **Step 3: Retarget to net48** — replace each csproj body:

`SSConnect.Core.csproj`:
```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net48</TargetFramework>
    <LangVersion>7.3</LangVersion>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="SIPSorcery" Version="8.0.*" />
    <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
    <PackageReference Include="Microsoft.NETFramework.ReferenceAssemblies" Version="1.0.3" PrivateAssets="all" />
    <Reference Include="System.Drawing" />
  </ItemGroup>
</Project>
```

`SSConnect.App.csproj`:
```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>WinExe</OutputType>
    <TargetFramework>net48</TargetFramework>
    <LangVersion>7.3</LangVersion>
    <UseWindowsForms>true</UseWindowsForms>
    <AssemblyName>SS-Connect</AssemblyName>
    <ApplicationManifest>app.manifest</ApplicationManifest>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="..\SSConnect.Core\SSConnect.Core.csproj" />
    <PackageReference Include="Microsoft.NETFramework.ReferenceAssemblies" Version="1.0.3" PrivateAssets="all" />
    <PackageReference Include="Costura.Fody" Version="5.7.0" PrivateAssets="all" />
  </ItemGroup>
</Project>
```
Add `desktop/src/SSConnect.App/app.manifest` declaring per-monitor DPI awareness (`<dpiAwareness>PerMonitorV2</dpiAwareness>`) so capture coordinates are physical pixels. Add `FodyWeavers.xml` with `<Weavers><Costura /></Weavers>` so the exe is a single file.

`SSConnect.Tests.csproj`: `TargetFramework` `net48`, `LangVersion` 7.3, reference Core and App, keep xunit packages, add ReferenceAssemblies.

- [ ] **Step 4: Build + test**

Run: `dotnet build desktop/SSConnect.sln -c Release` → Expected: Build succeeded.
Run: `dotnet test desktop/SSConnect.sln` → Expected: the template test passes.

- [ ] **Step 5: Commit** — `git add desktop && git commit -m "chore: scaffold SS-Connect desktop solution"`

---

### Task 2: Signaling server

**Files:**
- Create: `server/package.json`, `server/src/ids.js`, `server/src/server.js`, `server/src/index.js`, `server/test/server.test.js`

**Interfaces:**
- Produces (JSON over WebSocket, every message has `type`):
  - server→app `welcome {id}` after connect.
  - app→server `connect {targetId, password}`; server→B `auth-request {fromId, password, reqId}`; B→server `auth-response {reqId, ok}`; server→A `connect-result {ok, reason?}` where reason ∈ `offline|busy|wrong-password|locked`; on ok server→both `session-start {peerId, role:"viewer"|"shared", limitMs}`.
  - app→server `signal {data}` → forwarded to paired peer as `signal {data}`.
  - app→server `end {}`; server→both `session-end {reason}` reason ∈ `ended|timeout|peer-left`.
  - server→both `session-warning {remainingMs}` at limit−5 min (or limit/8 if limit < 10 min).
  - `createServer({port, limitMs})` returns `{close(), port}`.

- [ ] **Step 1: package.json**

```json
{
  "name": "ss-connect-signaling",
  "version": "1.0.0",
  "private": true,
  "type": "commonjs",
  "scripts": { "start": "node src/index.js", "test": "node --test" },
  "engines": { "node": ">=20" },
  "dependencies": { "ws": "^8.18.0" }
}
```
Run: `cd server; npm install`

- [ ] **Step 2: Write failing tests** `server/test/server.test.js`

```js
const test = require('node:test');
const assert = require('node:assert');
const WebSocket = require('ws');
const { createServer } = require('../src/server');

function client(port) {
  return new Promise(res => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    const queue = []; const waiters = [];
    ws.on('message', m => { const msg = JSON.parse(m); const w = waiters.shift(); w ? w(msg) : queue.push(msg); });
    ws.next = () => new Promise(r => queue.length ? r(queue.shift()) : waiters.push(r));
    ws.sendJson = o => ws.send(JSON.stringify(o));
    ws.on('open', async () => { ws.id = (await ws.next()).id; res(ws); });
  });
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

test('5 wrong passwords locks target for that window', async () => {
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
  const a = await client(s.port), b = await client(s.port), c = await client(s.port);
  a.sendJson({ type: 'connect', targetId: b.id, password: 'p' });
  const req = await b.next(); b.sendJson({ type: 'auth-response', reqId: req.reqId, ok: true });
  await a.next(); await a.next(); await b.next();
  c.sendJson({ type: 'connect', targetId: b.id, password: 'p' });
  assert.deepStrictEqual(await c.next(), { type: 'connect-result', ok: false, reason: 'busy' });
  a.close(); b.close(); c.close(); s.close();
});

test('signal forwarded, timeout ends session', async () => {
  const s = createServer({ port: 0, limitMs: 400 });
  const a = await client(s.port), b = await client(s.port);
  a.sendJson({ type: 'connect', targetId: b.id, password: 'p' });
  const req = await b.next(); b.sendJson({ type: 'auth-response', reqId: req.reqId, ok: true });
  await a.next(); await a.next(); await b.next();
  a.sendJson({ type: 'signal', data: { sdp: 'x' } });
  assert.deepStrictEqual(await b.next(), { type: 'signal', data: { sdp: 'x' } });
  assert.strictEqual((await a.next()).type, 'session-warning');
  assert.strictEqual((await b.next()).type, 'session-warning');
  assert.deepStrictEqual(await a.next(), { type: 'session-end', reason: 'timeout' });
  a.close(); b.close(); s.close();
});

test('close drops pairs: peer gets peer-left', async () => {
  const s = createServer({ port: 0 });
  const a = await client(s.port), b = await client(s.port);
  a.sendJson({ type: 'connect', targetId: b.id, password: 'p' });
  const req = await b.next(); b.sendJson({ type: 'auth-response', reqId: req.reqId, ok: true });
  await a.next(); await a.next(); await b.next();
  a.close();
  assert.deepStrictEqual(await b.next(), { type: 'session-end', reason: 'peer-left' });
  b.close(); s.close();
});
```

Run: `cd server; npm test` → Expected: FAIL, `Cannot find module '../src/server'`.

- [ ] **Step 3: Implement** `server/src/ids.js`

```js
const crypto = require('crypto');
function issueId(taken) {
  let id;
  do { id = String(crypto.randomInt(100000000, 1000000000)); } while (taken.has(id));
  return id;
}
module.exports = { issueId };
```

`server/src/server.js`:
```js
const WebSocket = require('ws');
const crypto = require('crypto');
const { issueId } = require('./ids');

const LOCK_MS = 5 * 60 * 1000, MAX_FAILS = 5;

function createServer({ port = 8080, limitMs = 40 * 60 * 1000 } = {}) {
  const wss = new WebSocket.Server({ port });
  const clients = new Map();          // id -> ws
  const pending = new Map();          // reqId -> { from, to }
  const fails = new Map();            // targetId -> { count, until }
  const send = (ws, o) => ws && ws.readyState === 1 && ws.send(JSON.stringify(o));

  function endSession(ws, reason) {
    const peer = ws.peer && clients.get(ws.peer);
    for (const s of [ws, peer]) {
      if (!s || !s.peer) continue;
      clearTimeout(s.warnTimer); clearTimeout(s.endTimer);
      s.peer = null;
      send(s, { type: 'session-end', reason });
    }
  }

  function startSession(a, b) {
    a.peer = b.id; b.peer = a.id;
    send(a, { type: 'session-start', peerId: b.id, role: 'viewer', limitMs });
    send(b, { type: 'session-start', peerId: a.id, role: 'shared', limitMs });
    const warnAt = limitMs >= 10 * 60 * 1000 ? limitMs - 5 * 60 * 1000 : limitMs - limitMs / 8;
    a.warnTimer = setTimeout(() => {
      for (const s of [a, b]) send(s, { type: 'session-warning', remainingMs: limitMs - warnAt });
    }, warnAt);
    a.endTimer = setTimeout(() => endSession(a, 'timeout'), limitMs);
  }

  wss.on('connection', ws => {
    ws.id = issueId(clients);
    clients.set(ws.id, ws);
    send(ws, { type: 'welcome', id: ws.id });

    ws.on('message', raw => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (m.type === 'connect') {
        const target = clients.get(String(m.targetId || ''));
        const f = fails.get(m.targetId);
        if (!target || target === ws) return send(ws, { type: 'connect-result', ok: false, reason: 'offline' });
        if (f && f.until > Date.now()) return send(ws, { type: 'connect-result', ok: false, reason: 'locked' });
        if (target.peer || ws.peer) return send(ws, { type: 'connect-result', ok: false, reason: 'busy' });
        const reqId = crypto.randomUUID();
        pending.set(reqId, { from: ws.id, to: target.id });
        send(target, { type: 'auth-request', fromId: ws.id, password: String(m.password || ''), reqId });
      } else if (m.type === 'auth-response') {
        const p = pending.get(m.reqId);
        if (!p || p.to !== ws.id) return;
        pending.delete(m.reqId);
        const a = clients.get(p.from);
        if (!a) return;
        if (!m.ok) {
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
      } else if (m.type === 'signal') {
        send(ws.peer && clients.get(ws.peer), { type: 'signal', data: m.data });
      } else if (m.type === 'end') {
        endSession(ws, 'ended');
      }
    });

    ws.on('close', () => {
      clients.delete(ws.id);
      if (ws.peer) {
        const peer = clients.get(ws.peer);
        if (peer) { clearTimeout(peer.warnTimer); clearTimeout(peer.endTimer); peer.peer = null; send(peer, { type: 'session-end', reason: 'peer-left' }); }
        clearTimeout(ws.warnTimer); clearTimeout(ws.endTimer);
      }
    });
  });

  return { close: () => wss.close(), get port() { return wss.address().port; } };
}

module.exports = { createServer };
```

Note: timers live on the viewer socket `a`; `endSession` clears timers on both sides so either side ending is safe.

`server/src/index.js`:
```js
const { createServer } = require('./server');
const port = Number(process.env.PORT || 8080);
const limitMs = Number(process.env.SESSION_LIMIT_MS || 40 * 60 * 1000);
createServer({ port, limitMs });
console.log(`SS-Connect signaling on :${port}, session limit ${limitMs} ms`);
```

- [ ] **Step 4: Run tests** — `cd server; npm test` → Expected: 7 passing.

- [ ] **Step 5: Commit** — `git add server && git commit -m "feat: SS-Connect signaling server with lockout and session timer"`

---

### Task 3: Core primitives — password, coord map, input gate, messages

**Files:**
- Create: `desktop/src/SSConnect.Core/Security/Password.cs`, `Input/CoordMap.cs`, `Input/InputGate.cs`, `Protocol/Messages.cs`
- Test: `desktop/tests/SSConnect.Tests/PasswordTests.cs`, `CoordMapTests.cs`, `InputGateTests.cs`

**Interfaces:**
- Produces:
  - `static class Password { string Generate(); string Normalize(string s); bool Matches(string expected, string typed); }` — 6 chars from `abcdefghjkmnpqrstuvwxyz23456789`.
  - `static class CoordMap { PointF ToNormalized(int x, int y, int w, int h); Point ToPixels(float nx, float ny, int screenW, int screenH); }` (clamped 0–1).
  - `class InputEvent { string Kind; float X; float Y; int Button; int Delta; int Vk; }` — Kind ∈ `move|down|up|wheel|keydown|keyup`; Button 0=left 1=middle 2=right.
  - `class InputGate { bool Granted {get;} void Grant(); IList<InputEvent> Revoke(); bool Accept(InputEvent e); }` — `Accept` returns false when not granted; tracks held keys/buttons; `Revoke()` returns synthetic `keyup`/`up` events for anything still held.
  - `class ControlMessage { string Type; }` with JSON types: `ask-control`, `allow`, `deny`, `revoke`, `release`, `input` (with `InputEvent Input`), `keyframe-request`, `quality` (with `int Quality`). `static string Serialize(ControlMessage m)`, `static ControlMessage Parse(string json)`.

- [ ] **Step 1: Write failing tests**

`PasswordTests.cs`:
```csharp
using SSConnect.Core.Security; using Xunit;
public class PasswordTests {
  [Fact] public void GeneratesSixAllowedChars() {
    var p = Password.Generate();
    Assert.Equal(6, p.Length);
    Assert.Matches("^[abcdefghjkmnpqrstuvwxyz23456789]{6}$", p);
  }
  [Fact] public void NormalizesInput() {
    Assert.True(Password.Matches("ab3k9m", " AB3 K9M "));
    Assert.False(Password.Matches("ab3k9m", "ab3k9n"));
    Assert.False(Password.Matches("ab3k9m", ""));
  }
}
```

`CoordMapTests.cs`:
```csharp
using SSConnect.Core.Input; using Xunit;
public class CoordMapTests {
  [Fact] public void RoundTripsAcrossResolutions() {
    var n = CoordMap.ToNormalized(400, 300, 800, 600);   // viewer box 800x600
    var p = CoordMap.ToPixels(n.X, n.Y, 2880, 1620);     // 1920x1080 @150% DPI = physical 2880x1620
    Assert.Equal(1440, p.X); Assert.Equal(810, p.Y);
  }
  [Fact] public void ClampsOutside() {
    var p = CoordMap.ToPixels(1.4f, -0.2f, 1920, 1080);
    Assert.Equal(1919, p.X); Assert.Equal(0, p.Y);
  }
}
```

`InputGateTests.cs`:
```csharp
using System.Linq; using SSConnect.Core.Input; using Xunit;
public class InputGateTests {
  static InputEvent K(string k, int vk) => new InputEvent { Kind = k, Vk = vk };
  [Fact] public void DropsUntilGranted() {
    var g = new InputGate();
    Assert.False(g.Accept(K("keydown", 0x41)));
    g.Grant();
    Assert.True(g.Accept(K("keydown", 0x41)));
  }
  [Fact] public void RevokeReleasesHeldKeys() {
    var g = new InputGate(); g.Grant();
    g.Accept(K("keydown", 0x11));                 // Ctrl held
    g.Accept(new InputEvent { Kind = "down", Button = 0 });
    var release = g.Revoke();
    Assert.False(g.Granted);
    Assert.Contains(release, e => e.Kind == "keyup" && e.Vk == 0x11);
    Assert.Contains(release, e => e.Kind == "up" && e.Button == 0);
    Assert.False(g.Accept(K("keydown", 0x41)));
  }
  [Fact] public void KeyUpClearsHeld() {
    var g = new InputGate(); g.Grant();
    g.Accept(K("keydown", 0x41)); g.Accept(K("keyup", 0x41));
    Assert.Empty(g.Revoke());
  }
}
```

Run: `dotnet test desktop/SSConnect.sln` → Expected: FAIL (types not defined).

- [ ] **Step 2: Implement**

`Security/Password.cs`:
```csharp
using System.Security.Cryptography; using System.Text;
namespace SSConnect.Core.Security {
  public static class Password {
    const string Alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
    public static string Generate() {
      var bytes = new byte[6]; using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(bytes);
      var sb = new StringBuilder(6);
      foreach (var b in bytes) sb.Append(Alphabet[b % Alphabet.Length]);
      return sb.ToString();
    }
    public static string Normalize(string s) => (s ?? "").Replace(" ", "").Trim().ToLowerInvariant();
    public static bool Matches(string expected, string typed) {
      var t = Normalize(typed);
      return t.Length > 0 && t == Normalize(expected);
    }
  }
}
```

`Input/CoordMap.cs`:
```csharp
using System; using System.Drawing;
namespace SSConnect.Core.Input {
  public static class CoordMap {
    public static PointF ToNormalized(int x, int y, int w, int h) =>
      new PointF(Clamp(x / (float)w), Clamp(y / (float)h));
    public static Point ToPixels(float nx, float ny, int screenW, int screenH) =>
      new Point((int)Math.Min(screenW - 1, Math.Round(Clamp(nx) * screenW)),
                (int)Math.Min(screenH - 1, Math.Round(Clamp(ny) * screenH)));
    static float Clamp(float v) => v < 0 ? 0 : v > 1 ? 1 : v;
  }
}
```

`Input/InputGate.cs`:
```csharp
using System.Collections.Generic; using System.Linq;
namespace SSConnect.Core.Input {
  public class InputEvent { public string Kind; public float X; public float Y; public int Button; public int Delta; public int Vk; }
  public class InputGate {
    readonly HashSet<int> keys = new HashSet<int>(); readonly HashSet<int> buttons = new HashSet<int>();
    readonly object sync = new object();
    public bool Granted { get; private set; }
    public void Grant() { lock (sync) Granted = true; }
    public IList<InputEvent> Revoke() {
      lock (sync) {
        Granted = false;
        var r = keys.Select(k => new InputEvent { Kind = "keyup", Vk = k })
          .Concat(buttons.Select(b => new InputEvent { Kind = "up", Button = b })).ToList();
        keys.Clear(); buttons.Clear(); return r;
      }
    }
    public bool Accept(InputEvent e) {
      lock (sync) {
        if (!Granted || e == null) return false;
        switch (e.Kind) {
          case "keydown": keys.Add(e.Vk); break;
          case "keyup": keys.Remove(e.Vk); break;
          case "down": buttons.Add(e.Button); break;
          case "up": buttons.Remove(e.Button); break;
          case "move": case "wheel": break;
          default: return false;
        }
        return true;
      }
    }
  }
}
```

`Protocol/Messages.cs`:
```csharp
using Newtonsoft.Json; using SSConnect.Core.Input;
namespace SSConnect.Core.Protocol {
  public class ControlMessage {
    [JsonProperty("type")] public string Type;
    [JsonProperty("input", NullValueHandling = NullValueHandling.Ignore)] public InputEvent Input;
    [JsonProperty("quality", NullValueHandling = NullValueHandling.Ignore)] public int? Quality;
    public static string Serialize(ControlMessage m) => JsonConvert.SerializeObject(m);
    public static ControlMessage Parse(string json) {
      try { return JsonConvert.DeserializeObject<ControlMessage>(json); } catch { return null; }
    }
  }
}
```

- [ ] **Step 3: Run tests** → Expected: all pass.
- [ ] **Step 4: Commit** — `git commit -am "feat: core password, coord map, input gate, control messages"` (add new files first).

---

### Task 4: Screen tiles — differ + binary packet

**Files:**
- Create: `desktop/src/SSConnect.Core/Screen/TileDiffer.cs`, `Protocol/TilePacket.cs`
- Test: `desktop/tests/SSConnect.Tests/TileTests.cs`

**Interfaces:**
- Produces:
  - `class Tile { int X, Y, W, H; byte[] Jpeg; }`
  - `class TileDiffer { TileDiffer(int tileSize = 64); List<Rectangle> Changed(Bitmap frame, bool forceAll); }` — compares against the previous frame (32bpp ARGB, row-by-row `memcmp`-style via `LockBits`); first call or size change returns all tiles.
  - `static class TilePacket { List<byte[]> Encode(int screenW, int screenH, IList<Tile> tiles, int maxBytes = 60000); bool TryDecode(byte[] msg, out int screenW, out int screenH, out List<Tile> tiles); }` — format: byte `0x01`, u16 screenW, u16 screenH, u16 count, then per tile u16 x, u16 y, u16 w, u16 h, i32 len, bytes (little-endian). Splits into multiple messages ≤ maxBytes.
  - `static byte[] JpegCodec.Encode(Bitmap src, Rectangle r, int quality)`; `static Bitmap JpegCodec.Decode(byte[] jpeg)` (in `TilePacket.cs`).

- [ ] **Step 1: Failing tests** `TileTests.cs`

```csharp
using System.Drawing; using System.Linq; using SSConnect.Core.Protocol; using SSConnect.Core.Screen; using Xunit;
public class TileTests {
  static Bitmap Solid(int w, int h, Color c) { var b = new Bitmap(w, h); using (var g = Graphics.FromImage(b)) g.Clear(c); return b; }
  [Fact] public void FirstFrameAllTilesThenOnlyChanged() {
    var d = new TileDiffer(64);
    var f1 = Solid(200, 130, Color.White);
    Assert.Equal(4 * 3, d.Changed(f1, false).Count);           // ceil(200/64)=4, ceil(130/64)=3
    var f2 = Solid(200, 130, Color.White); f2.SetPixel(70, 10, Color.Black);
    var ch = d.Changed(f2, false);
    Assert.Single(ch); Assert.Equal(new Rectangle(64, 0, 64, 64), ch[0]);
    var f3 = Solid(200, 130, Color.White); f3.SetPixel(70, 10, Color.Black);
    Assert.Empty(d.Changed(f3, false));
  }
  [Fact] public void EdgeTilesAreCropped() {
    var d = new TileDiffer(64);
    var all = d.Changed(Solid(200, 130, Color.White), false);
    Assert.Contains(new Rectangle(192, 128, 8, 2), all);
  }
  [Fact] public void PacketRoundTripAndSplit() {
    var big = new byte[40000];
    var tiles = Enumerable.Range(0, 3).Select(i => new Tile { X = i * 64, Y = 0, W = 64, H = 64, Jpeg = big }).ToList();
    var msgs = TilePacket.Encode(1920, 1080, tiles, 60000);
    Assert.Equal(3, msgs.Count);
    var decoded = msgs.SelectMany(m => { Assert.True(TilePacket.TryDecode(m, out var w, out var h, out var t)); Assert.Equal(1920, w); return t; }).ToList();
    Assert.Equal(new[] { 0, 64, 128 }, decoded.Select(t => t.X));
    Assert.Equal(40000, decoded[2].Jpeg.Length);
  }
  [Fact] public void RejectsGarbage() {
    Assert.False(TilePacket.TryDecode(new byte[] { 0x01, 0x02 }, out _, out _, out _));
  }
}
```
Run tests → Expected: FAIL.

- [ ] **Step 2: Implement** `Screen/TileDiffer.cs`

```csharp
using System; using System.Collections.Generic; using System.Drawing; using System.Drawing.Imaging; using System.Runtime.InteropServices;
namespace SSConnect.Core.Screen {
  public class Tile { public int X, Y, W, H; public byte[] Jpeg; }
  public class TileDiffer {
    readonly int size; byte[] prev; int pw, ph;
    public TileDiffer(int tileSize = 64) { size = tileSize; }
    public List<Rectangle> Changed(Bitmap frame, bool forceAll) {
      int w = frame.Width, h = frame.Height, stride = w * 4;
      var data = frame.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
      var cur = new byte[stride * h];
      for (int y = 0; y < h; y++) Marshal.Copy(data.Scan0 + y * data.Stride, cur, y * stride, stride);
      frame.UnlockBits(data);
      bool all = forceAll || prev == null || pw != w || ph != h;
      var result = new List<Rectangle>();
      for (int ty = 0; ty < h; ty += size)
        for (int tx = 0; tx < w; tx += size) {
          var r = new Rectangle(tx, ty, Math.Min(size, w - tx), Math.Min(size, h - ty));
          if (all || Differs(cur, r, stride)) result.Add(r);
        }
      prev = cur; pw = w; ph = h;
      return result;
    }
    bool Differs(byte[] cur, Rectangle r, int stride) {
      int rowBytes = r.Width * 4;
      for (int y = r.Top; y < r.Bottom; y++) {
        int off = y * stride + r.Left * 4;
        for (int i = 0; i < rowBytes; i++) if (cur[off + i] != prev[off + i]) return true;
      }
      return false;
    }
  }
}
```

`Protocol/TilePacket.cs`:
```csharp
using System; using System.Collections.Generic; using System.Drawing; using System.Drawing.Imaging; using System.IO; using System.Linq; using SSConnect.Core.Screen;
namespace SSConnect.Core.Protocol {
  public static class TilePacket {
    const int Header = 7, PerTile = 12;
    public static List<byte[]> Encode(int screenW, int screenH, IList<Tile> tiles, int maxBytes = 60000) {
      var msgs = new List<byte[]>(); var batch = new List<Tile>(); int size = Header;
      foreach (var t in tiles) {
        int need = PerTile + t.Jpeg.Length;
        if (batch.Count > 0 && size + need > maxBytes) { msgs.Add(Write(screenW, screenH, batch)); batch.Clear(); size = Header; }
        batch.Add(t); size += need;
      }
      if (batch.Count > 0) msgs.Add(Write(screenW, screenH, batch));
      return msgs;
    }
    static byte[] Write(int sw, int sh, List<Tile> tiles) {
      using (var ms = new MemoryStream()) using (var w = new BinaryWriter(ms)) {
        w.Write((byte)1); w.Write((ushort)sw); w.Write((ushort)sh); w.Write((ushort)tiles.Count);
        foreach (var t in tiles) { w.Write((ushort)t.X); w.Write((ushort)t.Y); w.Write((ushort)t.W); w.Write((ushort)t.H); w.Write(t.Jpeg.Length); w.Write(t.Jpeg); }
        return ms.ToArray();
      }
    }
    public static bool TryDecode(byte[] msg, out int screenW, out int screenH, out List<Tile> tiles) {
      screenW = screenH = 0; tiles = null;
      try {
        using (var r = new BinaryReader(new MemoryStream(msg))) {
          if (r.ReadByte() != 1) return false;
          screenW = r.ReadUInt16(); screenH = r.ReadUInt16(); int n = r.ReadUInt16();
          var list = new List<Tile>(n);
          for (int i = 0; i < n; i++) {
            var t = new Tile { X = r.ReadUInt16(), Y = r.ReadUInt16(), W = r.ReadUInt16(), H = r.ReadUInt16() };
            int len = r.ReadInt32(); if (len < 0 || len > msg.Length) return false;
            t.Jpeg = r.ReadBytes(len); if (t.Jpeg.Length != len) return false;
            list.Add(t);
          }
          tiles = list; return true;
        }
      } catch (EndOfStreamException) { return false; }
    }
  }
  public static class JpegCodec {
    static readonly ImageCodecInfo Jpeg = ImageCodecInfo.GetImageEncoders().First(c => c.FormatID == ImageFormat.Jpeg.Guid);
    public static byte[] Encode(Bitmap src, Rectangle r, int quality) {
      using (var tile = src.Clone(r, PixelFormat.Format24bppRgb)) using (var ms = new MemoryStream()) {
        var p = new EncoderParameters(1); p.Param[0] = new EncoderParameter(Encoder.Quality, (long)quality);
        tile.Save(ms, Jpeg, p); return ms.ToArray();
      }
    }
    public static Bitmap Decode(byte[] jpeg) { using (var ms = new MemoryStream(jpeg)) return new Bitmap(ms); }
  }
}
```

- [ ] **Step 3: Run tests** → Expected: pass.
- [ ] **Step 4: Commit** — `git add desktop && git commit -m "feat: tile differ and tile packet codec"`

---

### Task 5: SignalingClient + PeerLink (networking)

**Files:**
- Create: `desktop/src/SSConnect.Core/Net/SignalingClient.cs`, `Net/PeerLink.cs`
- Test: `desktop/tests/SSConnect.Tests/PeerLinkTests.cs` (loopback, no server), manual check against the Node server.

**Interfaces:**
- Consumes: server messages from Task 2.
- Produces:
  - `class SignalingClient { event Action<JObject> Message; event Action<string> Status; string MyId {get;} Task RunAsync(Uri server, CancellationToken ct); Task SendAsync(object msg); }` — reconnects every 3 s on failure, raises `Status("connecting"|"online"|"offline")`, sets `MyId` from `welcome`.
  - `class PeerLink : IDisposable { PeerLink(bool isViewer, IEnumerable<RTCIceServer> ice, Func<JObject,Task> sendSignal); Task StartAsync(); Task HandleSignalAsync(JObject data); event Action<byte[]> ScreenMessage; event Action<string> ControlMessage; event Action<string> StateChanged; void SendScreen(byte[] msg); void SendControl(string json); }` — viewer creates both channels and the offer; shared side answers and receives channels via `ondatachannel`. Signal payloads: `{ sdp, sdpType }` or `{ candidate }` (JSON of `RTCIceCandidateInit`). `StateChanged` forwards `connectionState` strings (`connected`, `disconnected`, `failed`, `closed`).

- [ ] **Step 1: Failing loopback test** `PeerLinkTests.cs`

```csharp
using System.Threading.Tasks; using Newtonsoft.Json.Linq; using SIPSorcery.Net; using SSConnect.Core.Net; using Xunit;
public class PeerLinkTests {
  [Fact(Timeout = 20000)] public async Task ViewerAndSharedExchangeOnBothChannels() {
    PeerLink viewer = null, shared = null;
    var ice = new RTCIceServer[0];
    viewer = new PeerLink(true, ice, d => shared.HandleSignalAsync(d));
    shared = new PeerLink(false, ice, d => viewer.HandleSignalAsync(d));
    var gotControl = new TaskCompletionSource<string>(); var gotScreen = new TaskCompletionSource<int>();
    var open = new TaskCompletionSource<bool>();
    shared.ControlMessage += s => gotControl.TrySetResult(s);
    viewer.ScreenMessage += b => gotScreen.TrySetResult(b.Length);
    viewer.StateChanged += s => { if (s == "connected") open.TrySetResult(true); };
    await shared.StartAsync(); await viewer.StartAsync();
    await open.Task; await Task.Delay(500);
    viewer.SendControl("{\"type\":\"ask-control\"}");
    shared.SendScreen(new byte[50000]);
    Assert.Equal("{\"type\":\"ask-control\"}", await gotControl.Task);
    Assert.Equal(50000, await gotScreen.Task);
    viewer.Dispose(); shared.Dispose();
  }
}
```
Run → Expected: FAIL (PeerLink missing).

- [ ] **Step 2: Implement** `Net/PeerLink.cs`

```csharp
using System; using System.Collections.Generic; using System.Linq; using System.Text; using System.Threading.Tasks;
using Newtonsoft.Json.Linq; using SIPSorcery.Net;
namespace SSConnect.Core.Net {
  public class PeerLink : IDisposable {
    readonly bool viewer; readonly Func<JObject, Task> sendSignal; readonly RTCPeerConnection pc;
    RTCDataChannel screen, control; readonly List<RTCIceCandidateInit> early = new List<RTCIceCandidateInit>(); bool remoteSet;
    public event Action<byte[]> ScreenMessage; public event Action<string> ControlMessage; public event Action<string> StateChanged;
    public PeerLink(bool isViewer, IEnumerable<RTCIceServer> ice, Func<JObject, Task> sendSignal) {
      viewer = isViewer; this.sendSignal = sendSignal;
      pc = new RTCPeerConnection(new RTCConfiguration { iceServers = ice.ToList() });
      pc.onicecandidate += c => { if (c != null) sendSignal(new JObject { ["candidate"] = JObject.Parse(c.toJSON()) }); };
      pc.onconnectionstatechange += s => StateChanged?.Invoke(s.ToString());
      pc.ondatachannel += Wire;
    }
    void Wire(RTCDataChannel ch) {
      if (ch.label == "screen") { screen = ch; ch.onmessage += (c, p, d) => ScreenMessage?.Invoke(d); }
      else if (ch.label == "control") { control = ch; ch.onmessage += (c, p, d) => ControlMessage?.Invoke(Encoding.UTF8.GetString(d)); }
    }
    public async Task StartAsync() {
      if (!viewer) return;
      Wire(await pc.createDataChannel("control", new RTCDataChannelInit { ordered = true }));
      Wire(await pc.createDataChannel("screen", new RTCDataChannelInit { ordered = false }));
      var offer = pc.createOffer();
      await pc.setLocalDescription(offer);
      await sendSignal(new JObject { ["sdp"] = offer.sdp, ["sdpType"] = "offer" });
    }
    public async Task HandleSignalAsync(JObject d) {
      if (d["sdp"] != null) {
        var type = (string)d["sdpType"] == "offer" ? RTCSdpType.offer : RTCSdpType.answer;
        pc.setRemoteDescription(new RTCSessionDescriptionInit { type = type, sdp = (string)d["sdp"] });
        remoteSet = true;
        foreach (var c in early) pc.addIceCandidate(c); early.Clear();
        if (type == RTCSdpType.offer) {
          var answer = pc.createAnswer();
          await pc.setLocalDescription(answer);
          await sendSignal(new JObject { ["sdp"] = answer.sdp, ["sdpType"] = "answer" });
        }
      } else if (d["candidate"] != null) {
        var c = d["candidate"].ToObject<RTCIceCandidateInit>();
        if (remoteSet) pc.addIceCandidate(c); else early.Add(c);
      }
    }
    public void SendScreen(byte[] msg) { if (screen?.readyState == RTCDataChannelState.open) screen.send(msg); }
    public void SendControl(string json) { if (control?.readyState == RTCDataChannelState.open) control.send(json); }
    public void Dispose() { try { pc.close(); } catch { } }
  }
}
```
If the SIPSorcery version's signatures differ (e.g. `createDataChannel` not async, `onmessage` delegate shape), adapt to the installed version's API — check with the IDE/`dotnet build` errors; keep the public `PeerLink` interface unchanged.

`Net/SignalingClient.cs`:
```csharp
using System; using System.Net.WebSockets; using System.Text; using System.Threading; using System.Threading.Tasks; using Newtonsoft.Json; using Newtonsoft.Json.Linq;
namespace SSConnect.Core.Net {
  public class SignalingClient {
    ClientWebSocket ws; readonly SemaphoreSlim sendLock = new SemaphoreSlim(1, 1);
    public event Action<JObject> Message; public event Action<string> Status;
    public string MyId { get; private set; }
    public async Task RunAsync(Uri server, CancellationToken ct) {
      while (!ct.IsCancellationRequested) {
        Status?.Invoke("connecting");
        try {
          ws = new ClientWebSocket();
          await ws.ConnectAsync(server, ct);
          var buf = new byte[64 * 1024];
          while (ws.State == WebSocketState.Open) {
            var sb = new StringBuilder(); WebSocketReceiveResult r;
            do { r = await ws.ReceiveAsync(new ArraySegment<byte>(buf), ct); if (r.MessageType == WebSocketMessageType.Close) break; sb.Append(Encoding.UTF8.GetString(buf, 0, r.Count)); } while (!r.EndOfMessage);
            if (r.MessageType == WebSocketMessageType.Close) break;
            var msg = JObject.Parse(sb.ToString());
            if ((string)msg["type"] == "welcome") { MyId = (string)msg["id"]; Status?.Invoke("online"); }
            Message?.Invoke(msg);
          }
        } catch (OperationCanceledException) { break; } catch { }
        MyId = null; Status?.Invoke("offline");
        try { await Task.Delay(3000, ct); } catch { break; }
      }
    }
    public async Task SendAsync(object msg) {
      var s = ws; if (s == null || s.State != WebSocketState.Open) return;
      var bytes = Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(msg));
      await sendLock.WaitAsync();
      try { await s.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None); } finally { sendLock.Release(); }
    }
  }
}
```

- [ ] **Step 3: Run tests** → Expected: pass (loopback connects on host candidates).
- [ ] **Step 4: Commit** — `git add desktop && git commit -m "feat: WebRTC peer link and signaling client"`

---

### Task 6: Windows capture + input injection

**Files:**
- Create: `desktop/src/SSConnect.App/Win32/ScreenCapture.cs`, `Win32/InputInjector.cs`
- Test: `desktop/tests/SSConnect.Tests/ScreenCaptureTests.cs`

**Interfaces:**
- Produces:
  - `static class ScreenCapture { Size PrimarySize(); Bitmap CapturePrimary(); }` — physical pixels (app is PerMonitorV2-aware), includes cursor drawn with `DrawIconEx`.
  - `static class InputInjector { void Apply(InputEvent e, Size screen); }` — move → `SendInput` absolute (`MOUSEEVENTF_ABSOLUTE|MOVE|VIRTUALDESK` scaled 0–65535 over the virtual screen, using `CoordMap.ToPixels` + primary offset); down/up per button; wheel `Delta*120`; keydown/keyup with `KEYEVENTF_EXTENDEDKEY` for arrows/Home/End/Ins/Del/PgUp/PgDn/RCtrl/RAlt/Win.

- [ ] **Step 1: Failing test**

```csharp
using SSConnect.App.Win32; using Xunit;
public class ScreenCaptureTests {
  [Fact] public void CapturesPrimaryAtReportedSize() {
    var size = ScreenCapture.PrimarySize();
    using (var bmp = ScreenCapture.CapturePrimary()) { Assert.Equal(size.Width, bmp.Width); Assert.Equal(size.Height, bmp.Height); }
  }
}
```
Run → FAIL.

- [ ] **Step 2: Implement** `ScreenCapture.cs`

```csharp
using System; using System.Drawing; using System.Runtime.InteropServices;
namespace SSConnect.App.Win32 {
  public static class ScreenCapture {
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
    [DllImport("user32.dll")] static extern bool GetCursorInfo(ref CURSORINFO ci);
    [DllImport("user32.dll")] static extern bool DrawIconEx(IntPtr hdc, int x, int y, IntPtr icon, int w, int h, int step, IntPtr brush, int flags);
    [DllImport("user32.dll")] static extern bool GetIconInfo(IntPtr icon, out ICONINFO info);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr o);
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] struct CURSORINFO { public int cbSize, flags; public IntPtr hCursor; public POINT pt; }
    [StructLayout(LayoutKind.Sequential)] struct ICONINFO { public bool fIcon; public int xHotspot, yHotspot; public IntPtr hbmMask, hbmColor; }
    public static Size PrimarySize() => new Size(GetSystemMetrics(0), GetSystemMetrics(1));
    public static Bitmap CapturePrimary() {
      var s = PrimarySize(); var bmp = new Bitmap(s.Width, s.Height, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
      using (var g = Graphics.FromImage(bmp)) {
        g.CopyFromScreen(0, 0, 0, 0, s, CopyPixelOperation.SourceCopy);
        var ci = new CURSORINFO { cbSize = Marshal.SizeOf(typeof(CURSORINFO)) };
        if (GetCursorInfo(ref ci) && ci.flags == 1 && GetIconInfo(ci.hCursor, out var ii)) {
          var hdc = g.GetHdc();
          DrawIconEx(hdc, ci.pt.X - ii.xHotspot, ci.pt.Y - ii.yHotspot, ci.hCursor, 0, 0, 0, IntPtr.Zero, 3);
          g.ReleaseHdc(hdc);
          if (ii.hbmMask != IntPtr.Zero) DeleteObject(ii.hbmMask);
          if (ii.hbmColor != IntPtr.Zero) DeleteObject(ii.hbmColor);
        }
      }
      return bmp;
    }
  }
}
```

`InputInjector.cs`:
```csharp
using System; using System.Drawing; using System.Runtime.InteropServices; using SSConnect.Core.Input;
namespace SSConnect.App.Win32 {
  public static class InputInjector {
    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public InputUnion u; }
    [StructLayout(LayoutKind.Explicit)] struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public int mouseData; public uint dwFlags, time; public IntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr extra; }
    const uint MOVE = 0x1, ABS = 0x8000, VDESK = 0x4000, WHEEL = 0x0800, KEYUP = 0x2, EXT = 0x1;
    static readonly uint[] Down = { 0x2, 0x20, 0x8 }, Up = { 0x4, 0x40, 0x10 };
    static readonly int[] Extended = { 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2D, 0x2E, 0xA3, 0xA5, 0x5B, 0x5C, 0x6F, 0x90 };
    public static void Apply(InputEvent e, Size screen) {
      switch (e.Kind) {
        case "move": Mouse(e, screen, MOVE | ABS | VDESK, 0); break;
        case "down": Mouse(e, screen, MOVE | ABS | VDESK | Down[Clamp(e.Button)], 0); break;
        case "up": Mouse(e, screen, MOVE | ABS | VDESK | Up[Clamp(e.Button)], 0); break;
        case "wheel": Mouse(e, screen, MOVE | ABS | VDESK | WHEEL, e.Delta * 120); break;
        case "keydown": Key(e.Vk, false); break;
        case "keyup": Key(e.Vk, true); break;
      }
    }
    static int Clamp(int b) => b < 0 || b > 2 ? 0 : b;
    static void Mouse(InputEvent e, Size screen, uint flags, int data) {
      var p = CoordMap.ToPixels(e.X, e.Y, screen.Width, screen.Height);
      int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77), vw = GetSystemMetrics(78), vh = GetSystemMetrics(79);
      var i = new INPUT { type = 0 };
      i.u.mi.dx = (int)((p.X - vx) * 65535.0 / Math.Max(1, vw - 1));
      i.u.mi.dy = (int)((p.Y - vy) * 65535.0 / Math.Max(1, vh - 1));
      i.u.mi.dwFlags = flags; i.u.mi.mouseData = data;
      SendInput(1, new[] { i }, Marshal.SizeOf(typeof(INPUT)));
    }
    static void Key(int vk, bool up) {
      var i = new INPUT { type = 1 };
      i.u.ki.wVk = (ushort)vk;
      i.u.ki.dwFlags = (up ? KEYUP : 0) | (Array.IndexOf(Extended, vk) >= 0 ? EXT : 0);
      SendInput(1, new[] { i }, Marshal.SizeOf(typeof(INPUT)));
    }
  }
}
```

- [ ] **Step 3: Run tests** → pass.
- [ ] **Step 4: Commit** — `git commit -m "feat: screen capture and SendInput injector"`

---

### Task 7: Session logic — shared side (B) and viewer side (A)

**Files:**
- Create: `desktop/src/SSConnect.App/Controller/SharedSide.cs`, `Controller/ViewerSide.cs`, `desktop/src/SSConnect.Core/Session/SessionTimer.cs`
- Test: `desktop/tests/SSConnect.Tests/SharedSideTests.cs`

**Interfaces:**
- Consumes: `PeerLink`, `InputGate`, `ControlMessage`, `TileDiffer`, `TilePacket`, `JpegCodec`, `ScreenCapture`, `InputInjector`.
- Produces:
  - `class SharedSide : IDisposable { SharedSide(PeerLink link, Func<Task<bool>> askUser, Action<bool> onControlChanged, Action<InputEvent> inject = null, Func<Bitmap> capture = null); void Start(); void RevokeControl(); }` — capture loop every 83 ms on a background thread; keyframe every 5 s or on `keyframe-request`; on `ask-control` awaits `askUser()` (UI shows AllowDialog, 30 s auto-deny), replies `allow`/`deny`; on `input` → `gate.Accept` → `inject`; `RevokeControl()` releases held keys via `gate.Revoke()` and sends `revoke`; `release` from viewer also revokes.
  - `class ViewerSide : IDisposable { ViewerSide(PeerLink link); Bitmap Frame {get;} event Action FrameChanged; event Action<bool> ControlChanged; event Action<string> Notice; void AskControl(); void ReleaseControl(); void SendInput(InputEvent e); void SetQuality(int q); bool HasControl {get;} }` — draws decoded tiles into `Frame` (resized when screen size changes, then sends `keyframe-request`); `SendInput` is a no-op unless `HasControl`.
  - `class SessionTimer { SessionTimer(TimeSpan limit); TimeSpan Remaining {get;} }`

- [ ] **Step 1: Failing tests** `SharedSideTests.cs` (fake link via two loopback `PeerLink`s as in Task 5, fake capture returning a 128×128 bitmap, fake inject collecting events)

```csharp
using System.Collections.Generic; using System.Drawing; using System.Threading.Tasks; using SIPSorcery.Net; using SSConnect.App.Controller; using SSConnect.Core.Input; using SSConnect.Core.Net; using Xunit;
public class SharedSideTests {
  async Task<(PeerLink v, PeerLink s)> Pair() {
    PeerLink v = null, s = null; var ice = new RTCIceServer[0];
    v = new PeerLink(true, ice, d => s.HandleSignalAsync(d)); s = new PeerLink(false, ice, d => v.HandleSignalAsync(d));
    var open = new TaskCompletionSource<bool>(); v.StateChanged += x => { if (x == "connected") open.TrySetResult(true); };
    await s.StartAsync(); await v.StartAsync(); await open.Task; await Task.Delay(500); return (v, s);
  }
  [Fact(Timeout = 30000)] public async Task InputIgnoredUntilAllowedThenInjectedOnce() {
    var (vl, sl) = await Pair();
    var injected = new List<InputEvent>(); bool allow = false;
    var shared = new SharedSide(sl, () => Task.FromResult(allow), _ => { }, e => { lock (injected) injected.Add(e); }, () => new Bitmap(128, 128));
    var viewer = new ViewerSide(vl); shared.Start();
    viewer.SendInput(new InputEvent { Kind = "keydown", Vk = 0x41 });
    await Task.Delay(300); Assert.Empty(injected);
    viewer.AskControl(); await Task.Delay(500); Assert.False(viewer.HasControl);   // denied
    allow = true; viewer.AskControl(); await Task.Delay(500); Assert.True(viewer.HasControl);
    viewer.SendInput(new InputEvent { Kind = "keydown", Vk = 0x41 }); viewer.SendInput(new InputEvent { Kind = "keyup", Vk = 0x41 });
    await Task.Delay(300);
    Assert.Equal(2, injected.Count);
    shared.RevokeControl(); await Task.Delay(300); Assert.False(viewer.HasControl);
    viewer.SendInput(new InputEvent { Kind = "keydown", Vk = 0x42 }); await Task.Delay(300);
    Assert.Equal(2, injected.Count);
    shared.Dispose(); viewer.Dispose();
  }
  [Fact(Timeout = 30000)] public async Task ViewerReceivesFrame() {
    var (vl, sl) = await Pair();
    var shared = new SharedSide(sl, () => Task.FromResult(false), _ => { }, _ => { }, () => new Bitmap(128, 128));
    var viewer = new ViewerSide(vl); var got = new TaskCompletionSource<bool>(); viewer.FrameChanged += () => got.TrySetResult(true);
    shared.Start(); await got.Task;
    Assert.Equal(128, viewer.Frame.Width);
    shared.Dispose(); viewer.Dispose();
  }
}
```
Run → FAIL.

- [ ] **Step 2: Implement** `SharedSide.cs`

```csharp
using System; using System.Drawing; using System.Linq; using System.Threading; using System.Threading.Tasks;
using SSConnect.App.Win32; using SSConnect.Core.Input; using SSConnect.Core.Net; using SSConnect.Core.Protocol; using SSConnect.Core.Screen;
namespace SSConnect.App.Controller {
  public class SharedSide : IDisposable {
    readonly PeerLink link; readonly Func<Task<bool>> askUser; readonly Action<bool> onControlChanged;
    readonly Action<InputEvent> inject; readonly Func<Bitmap> capture;
    readonly InputGate gate = new InputGate(); readonly TileDiffer differ = new TileDiffer(64);
    readonly CancellationTokenSource cts = new CancellationTokenSource();
    volatile bool forceKey = true; volatile int quality = 70; int asking;
    public SharedSide(PeerLink link, Func<Task<bool>> askUser, Action<bool> onControlChanged, Action<InputEvent> inject = null, Func<Bitmap> capture = null) {
      this.link = link; this.askUser = askUser; this.onControlChanged = onControlChanged;
      this.capture = capture ?? ScreenCapture.CapturePrimary;
      this.inject = inject ?? (e => InputInjector.Apply(e, ScreenCapture.PrimarySize()));
      link.ControlMessage += OnControl;
    }
    public void Start() => Task.Run(CaptureLoop);
    async Task CaptureLoop() {
      var lastKey = DateTime.UtcNow;
      while (!cts.IsCancellationRequested) {
        var t0 = DateTime.UtcNow;
        try {
          using (var frame = capture()) {
            bool key = forceKey || (DateTime.UtcNow - lastKey).TotalSeconds >= 5;
            if (key) { forceKey = false; lastKey = DateTime.UtcNow; }
            var rects = differ.Changed(frame, key);
            if (rects.Count > 0) {
              var tiles = rects.Select(r => new Tile { X = r.X, Y = r.Y, W = r.Width, H = r.Height, Jpeg = JpegCodec.Encode(frame, r, quality) }).ToList();
              foreach (var m in TilePacket.Encode(frame.Width, frame.Height, tiles)) link.SendScreen(m);
            }
          }
        } catch { }
        var wait = 83 - (int)(DateTime.UtcNow - t0).TotalMilliseconds;
        try { await Task.Delay(Math.Max(5, wait), cts.Token); } catch { break; }
      }
    }
    async void OnControl(string json) {
      var m = ControlMessage.Parse(json); if (m == null) return;
      switch (m.Type) {
        case "ask-control":
          if (gate.Granted || Interlocked.Exchange(ref asking, 1) == 1) return;
          bool ok; try { ok = await askUser(); } finally { asking = 0; }
          if (ok) { gate.Grant(); onControlChanged(true); }
          link.SendControl(ControlMessage.Serialize(new ControlMessage { Type = ok ? "allow" : "deny" }));
          break;
        case "input":
          if (gate.Accept(m.Input)) inject(m.Input);
          break;
        case "release": RevokeControl(false); break;
        case "keyframe-request": forceKey = true; break;
        case "quality": if (m.Quality.HasValue) quality = Math.Max(30, Math.Min(90, m.Quality.Value)); forceKey = true; break;
      }
    }
    public void RevokeControl() => RevokeControl(true);
    void RevokeControl(bool notify) {
      bool was = gate.Granted;
      foreach (var e in gate.Revoke()) inject(e);
      if (was) onControlChanged(false);
      if (notify) link.SendControl(ControlMessage.Serialize(new ControlMessage { Type = "revoke" }));
    }
    public void Dispose() { cts.Cancel(); RevokeControl(false); link.ControlMessage -= OnControl; }
  }
}
```

`ViewerSide.cs`:
```csharp
using System; using System.Drawing; using SSConnect.Core.Input; using SSConnect.Core.Net; using SSConnect.Core.Protocol;
namespace SSConnect.App.Controller {
  public class ViewerSide : IDisposable {
    readonly PeerLink link; readonly object frameLock = new object();
    public Bitmap Frame { get; private set; }
    public object FrameLock => frameLock;
    public bool HasControl { get; private set; }
    public event Action FrameChanged; public event Action<bool> ControlChanged; public event Action<string> Notice;
    public ViewerSide(PeerLink link) { this.link = link; link.ScreenMessage += OnScreen; link.ControlMessage += OnControl; }
    void OnScreen(byte[] msg) {
      if (!TilePacket.TryDecode(msg, out var w, out var h, out var tiles)) return;
      lock (frameLock) {
        if (Frame == null || Frame.Width != w || Frame.Height != h) {
          Frame?.Dispose(); Frame = new Bitmap(w, h);
          if (tiles.Count < ((w + 63) / 64) * ((h + 63) / 64)) Send("keyframe-request");
        }
        using (var g = Graphics.FromImage(Frame))
          foreach (var t in tiles) using (var img = JpegCodec.Decode(t.Jpeg)) g.DrawImage(img, t.X, t.Y, t.W, t.H);
      }
      FrameChanged?.Invoke();
    }
    void OnControl(string json) {
      var m = ControlMessage.Parse(json); if (m == null) return;
      if (m.Type == "allow") { HasControl = true; ControlChanged?.Invoke(true); }
      else if (m.Type == "deny") Notice?.Invoke("Partner denied control.");
      else if (m.Type == "revoke") { HasControl = false; ControlChanged?.Invoke(false); Notice?.Invoke("Partner took control back."); }
    }
    void Send(string type) => link.SendControl(ControlMessage.Serialize(new ControlMessage { Type = type }));
    public void AskControl() => Send("ask-control");
    public void ReleaseControl() { HasControl = false; ControlChanged?.Invoke(false); Send("release"); }
    public void SetQuality(int q) => link.SendControl(ControlMessage.Serialize(new ControlMessage { Type = "quality", Quality = q }));
    public void SendInput(InputEvent e) { if (HasControl) link.SendControl(ControlMessage.Serialize(new ControlMessage { Type = "input", Input = e })); }
    public void Dispose() { link.ScreenMessage -= OnScreen; link.ControlMessage -= OnControl; }
  }
}
```

`Core/Session/SessionTimer.cs`:
```csharp
using System; using System.Diagnostics;
namespace SSConnect.Core.Session {
  public class SessionTimer {
    readonly TimeSpan limit; readonly Stopwatch sw = Stopwatch.StartNew();
    public SessionTimer(TimeSpan limit) { this.limit = limit; }
    public TimeSpan Remaining { get { var r = limit - sw.Elapsed; return r < TimeSpan.Zero ? TimeSpan.Zero : r; } }
  }
}
```

- [ ] **Step 3: Run tests** → pass.
- [ ] **Step 4: Commit** — `git commit -m "feat: shared and viewer session logic with consent gate"`

---

### Task 8: WinForms UI + Program wiring

**Files:**
- Create: `desktop/src/SSConnect.App/Program.cs`, `Settings.cs`, `UI/MainForm.cs`, `UI/ViewerForm.cs`, `UI/AllowDialog.cs`, `UI/ControlBar.cs`
- Test: manual (Task 9 E2E); unit test `SettingsTests` for server URL parsing.

**Interfaces:**
- Consumes: everything above.
- Produces: `SS-Connect.exe`.

Behaviour to implement (code is UI glue; keep each form < 200 lines):

- [ ] **Step 1: `Settings.cs` + test**

```csharp
using System; using System.IO; using System.Linq;
namespace SSConnect.App {
  public static class Settings {
    public static Uri ServerUri(string[] args, string exeDir) {
      var arg = args.SkipWhile(a => a != "--server").Skip(1).FirstOrDefault();
      var file = Path.Combine(exeDir, "server.txt");
      var s = arg ?? (File.Exists(file) ? File.ReadAllText(file).Trim() : "ws://localhost:8080");
      return new Uri(s);
    }
  }
}
```
Test: `--server ws://1.2.3.4:9000` wins over `server.txt`; missing both → `ws://localhost:8080`.

- [ ] **Step 2: `MainForm`** — 560×320, title "SS-Connect". Left group "Allow remote control": big ID label (formatted `123 456 789`), password label + ↻ button (`Password.Generate()`), status label ("Connecting to server…"/"Ready"/"Cannot reach server — retrying"). Right group "Control a remote computer": Partner ID textbox, Password textbox, Connect button. Owns one `SignalingClient` started in `Load`; marshals events with `BeginInvoke`.
  - `auth-request` → reply `auth-response {reqId, ok: Password.Matches(current, password)}`.
  - Connect → `connect {targetId: digitsOnly, password}`; `connect-result` errors → MessageBox: offline "That ID is not online.", busy "That computer is already in a session.", wrong-password "Wrong password.", locked "Too many wrong passwords. Try again in 5 minutes."
  - `session-start` → create `PeerLink(role=="viewer", ice, d => client.SendAsync(new { type="signal", data=d }))`, route `signal` messages to `link.HandleSignalAsync`, `await link.StartAsync()`. Viewer → open `ViewerForm`; shared → `SharedSide` + `ControlBar`.
  - ICE servers v1: `stun:stun.l.google.com:19302` only (TURN added when the VM exists).
  - `session-warning` → toast label "5 minutes left"; `session-end` → close session windows, MessageBox for `timeout` ("Free session limit of 40 minutes reached.") and `peer-left` ("Partner disconnected."), refresh password.
  - Link `StateChanged` "disconnected" → show "Reconnecting…"; if not "connected" again within 30 s → send `end`.
- [ ] **Step 3: `ViewerForm`** — resizable, double-buffered panel painting `viewer.Frame` letterboxed (keep aspect); toolbar: Ask control / Release control (toggles on `ControlChanged`), Quality combo Low=40/Medium=70/High=85, timer label from `SessionTimer`, End. Mouse/keyboard on the panel map through the letterbox rect with `CoordMap.ToNormalized` → `viewer.SendInput`; key events use `e.KeyValue` as Vk, set `e.Handled/SuppressKeyPress` and override `ProcessCmdKey` so Tab/arrows/Alt reach the panel; `MouseWheel` → `Delta = e.Delta/120`. Each Windows event sends exactly one `InputEvent` (no separate click events).
- [ ] **Step 4: `AllowDialog`** — TopMost, centered: "‹ID› wants to control your PC." Allow / Deny, countdown "Auto-deny in 30 s"; returns `Task<bool>` via `TaskCompletionSource`.
- [ ] **Step 5: `ControlBar`** — TopMost borderless strip top-center 420×36: "Sharing with ‹ID› · 38:12 left" + End; turns red with "Your PC is being controlled" + Stop control button while granted (`SharedSide.RevokeControl`).
- [ ] **Step 6: `Program.cs`** — `[STAThread] Main(args)`: `Application.EnableVisualStyles(); Application.Run(new MainForm(Settings.ServerUri(args, AppDomain.CurrentDomain.BaseDirectory)));` and a single-instance mutex only when no `--allow-multi` arg (E2E runs two instances).
- [ ] **Step 7: Build** — `dotnet build desktop/SSConnect.sln -c Release` → `desktop/src/SSConnect.App/bin/Release/net48/SS-Connect.exe` exists (single file via Costura).
- [ ] **Step 8: Commit** — `git commit -m "feat: SS-Connect WinForms UI"`

---

### Task 9: End-to-end test on this PC

**Files:** none (checklist recorded in the commit message / PR).

- [ ] **Step 1:** `cd server; $env:SESSION_LIMIT_MS="90000"; npm start`
- [ ] **Step 2:** Start two instances: `SS-Connect.exe --allow-multi` twice. Both show distinct 9-digit IDs and passwords within 3 s.
- [ ] **Step 3:** Instance 1 connects to instance 2 with a wrong password → "Wrong password." Then correct (typed uppercase with a space) → viewer window shows the desktop within 10 s.
- [ ] **Step 4:** Type in the viewer before asking → nothing happens on the desktop. Ask control → Deny → notice shown. Ask control → Allow → red bar appears.
- [ ] **Step 5:** Open Notepad via the viewer, type `Hello SS-Connect 123` → exactly that text (no doubled letters); Shift+letters and Ctrl+A work; double-click selects a word; right-click opens a menu once.
- [ ] **Step 6:** Hold Ctrl in the viewer, click Stop control on the bar → Ctrl is not stuck (typing `a` locally types `a`).
- [ ] **Step 7:** Warning toast at ~78 s; session ends at 90 s with the limit message on both.
- [ ] **Step 8:** Stop the server mid-session → both show reconnect status; restart server → both get IDs again.
- [ ] **Step 9:** Fix anything found (with a failing unit test first where the bug is in Core/Controller), re-run.

---

### Task 10: CI build, release, portal link

**Files:**
- Create: `.github/workflows/build-ss-connect-desktop.yml`
- Modify: `remote/index.html` (SS-Connect download section)

- [ ] **Step 1: Workflow**

```yaml
name: Build SS-Connect Desktop
on:
  workflow_dispatch:
  push:
    paths: ['desktop/**']
permissions:
  contents: write
jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-dotnet@v4
        with: { dotnet-version: '8.0.x' }
      - run: dotnet test desktop/SSConnect.sln -c Release
      - run: dotnet build desktop/src/SSConnect.App -c Release
      - uses: softprops/action-gh-release@v2
        with:
          tag_name: ss-connect-desktop-latest
          name: SS-Connect Desktop (Windows)
          make_latest: false
          files: desktop/src/SSConnect.App/bin/Release/net48/SS-Connect.exe
```

- [ ] **Step 2: Portal link** — in `remote/index.html`, add above the agent downloads: a card "SS-Connect for Windows — full remote control app (screen + mouse + keyboard, with permission)" linking `https://github.com/gosainravi/CHAMARIAGROUP/releases/download/ss-connect-desktop-latest/SS-Connect.exe`, plus the line "Windows may show 'Unknown publisher' — click More info → Run anyway."
- [ ] **Step 3:** Verify locally that the page renders and the link URL is correct (preview server `portal`, read_page).
- [ ] **Step 4: Commit** — `git commit -m "ci: build and publish SS-Connect desktop; link from portal"`
- [ ] **Step 5:** Hand the user the push commands for the CHAMARIAGROUP repo (files go under `daftarbox/` there; desktop/ and server/ at repo root), and the next-step note: Azure VM + TURN for cross-network use.
