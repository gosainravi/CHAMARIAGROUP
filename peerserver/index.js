const express = require('express');
const { ExpressPeerServer } = require('peer');

const app = express();
const PORT = process.env.PORT || 9000;

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

app.get('/', (req, res) => res.json({ status: 'ok', server: 'SS-Connect Peer Server' }));
app.get('/health', (req, res) => res.json({ status: 'ok', time: Date.now() }));

// Short-lived Cloudflare TURN credentials; secrets stay in Render env vars, never in the public repo.
app.get('/turn', async (req, res) => {
  const keyId = process.env.CF_TURN_KEY_ID;
  const token = process.env.CF_TURN_API_TOKEN;
  if (!keyId || !token) return res.json({ iceServers: [], configured: false });
  try {
    const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 86400 })
    });
    const j = await r.json();
    const list = Array.isArray(j.iceServers) ? j.iceServers : (j.iceServers ? [j.iceServers] : []);
    res.json({ iceServers: list, configured: true });
  } catch (e) {
    console.error('TURN fetch failed:', e.message);
    res.json({ iceServers: [], configured: true, error: true });
  }
});

const server = app.listen(PORT, () => console.log(`SS-Connect Peer Server on port ${PORT}`));

const peerServer = ExpressPeerServer(server, {
  path: '/',
  proxied: true,
  allow_discovery: false,
  alive_timeout: 60000
});
app.use('/peerjs', peerServer);

peerServer.on('connection', c => console.log('+ peer:', c.getId()));
peerServer.on('disconnect', c => console.log('- peer:', c.getId()));
