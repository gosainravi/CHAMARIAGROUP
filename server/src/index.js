const { createServer } = require('./server');

const port = Number(process.env.PORT || 8080);
const limitMs = Number(process.env.SESSION_LIMIT_MS || 40 * 60 * 1000);
createServer({ port, limitMs });
console.log(`SS-Connect signaling on :${port}, session limit ${limitMs} ms`);
