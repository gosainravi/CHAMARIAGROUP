const { PeerServer } = require('peer');
const express = require('express');
const app = express();

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

app.get('/', (req, res) => res.json({ status: 'ok', server: 'SS-Connect Peer Server' }));
app.get('/health', (req, res) => res.json({ status: 'ok', time: Date.now() }));

const peerServer = PeerServer({
  port: process.env.PORT || 9000,
  path: '/peerjs',
  proxied: true,
  allow_discovery: false,
  cleanup_out_msgs: 1000,
  alive_timeout: 60000,
});

peerServer.on('connection', c => console.log('+ peer:', c.getId()));
peerServer.on('disconnect', c => console.log('- peer:', c.getId()));

console.log(`SS-Connect Peer Server on port ${process.env.PORT || 9000}`);
