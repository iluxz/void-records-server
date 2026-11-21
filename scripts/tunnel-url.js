'use strict';

// Pulls the newest trycloudflare URL out of data/tunnel.log and writes it to
// pages/config.json. The version is derived from the URL so the hosted console
// notices a changed tunnel on its next load instead of using a stale value.
// Usage: npm run console:url   (or npm run console:deploy to upload too)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const LOG = path.join(ROOT, 'data', 'tunnel.log');
const OUT = path.join(ROOT, 'pages', 'config.json');

function newestUrl() {
  if (!fs.existsSync(LOG)) return null;
  const text = fs.readFileSync(LOG, 'utf8');
  const found = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/gi);
  return found && found.length ? found[found.length - 1] : null;
}

const url = newestUrl();
if (!url) {
  console.error('no trycloudflare url found in data/tunnel.log - is the tunnel running?');
  process.exit(1);
}
const version = crypto.createHash('sha1').update(url).digest('hex').slice(0, 10);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ version, base: url }));
console.log('pages/config.json -> ' + url);
console.log('config version ' + version);
