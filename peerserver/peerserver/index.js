const { PeerServer } = require('peer');
const express = require('express');
const app = express();
const http = require('http').createServer(app);

app.get('/', (req, res) => res.send('SS-Connect Peer Server running'));

const peerServer = PeerServer({
  port: process.env.PORT || 9000,
  path: '/peerjs',
  proxied: true,
  allow_discovery: false,
  cleanup_out_msgs: 1000
});

peerServer.on('connection', client => console.log('Peer connected:', client.getId()));
peerServer.on('disconnect', client => console.log('Peer disconnected:', client.getId()));

console.log(`SS-Connect Peer Server on port ${process.env.PORT || 9000}`);
