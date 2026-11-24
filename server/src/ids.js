const crypto = require('crypto');

function issueId(taken) {
  let id;
  do { id = String(crypto.randomInt(100000000, 1000000000)); } while (taken.has(id));
  return id;
}

module.exports = { issueId };
