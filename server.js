'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const { load } = require('./lib/catalog');
const { Lyrics } = require('./lib/lyrics');
const { Store } = require('./lib/store');

const ROOT = __dirname;
const MEDIA_DIR = path.resolve(process.env.VR_MEDIA_DIR || path.join(ROOT, '..', 'void-records'));
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const DURATIONS = process.env.VR_DURATIONS || path.join(ROOT, 'data', 'durations.tsv');
const LYRICS_FILE = process.env.VR_LYRICS || path.join(ROOT, 'data', 'lyrics.json');
const STATE_FILE = process.env.VR_STATE || path.join(ROOT, 'data', 'state.json');

let catalog;
try {
  catalog = load(MEDIA_DIR, DURATIONS);
} catch (err) {
  console.error('[fatal] could not load catalog:', err.message);
  process.exit(1);
}
const lyrics = new Lyrics(LYRICS_FILE);
const store = new Store(STATE_FILE);

const app = express();
app.disable('x-powered-by');

// Every response is cross-origin readable. Range/expose headers matter:
// without them a cross-origin <audio> cannot seek in a 60-minute record.
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Range');
  res.set('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length, Content-Type');
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '512kb' }));

app.get('/vr-client.js', (req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.type('application/javascript');
  res.sendFile(path.join(ROOT, 'public', 'vr-client.js'));
});

// The browser console. Same file is deployed to Cloudflare Pages; the only
// difference there is the base-URL field (set via ?base= or saved locally).
function serveConsole(req, res) {
  res.set('Cache-Control', 'no-cache');
  res.type('html');
  res.sendFile(path.join(ROOT, 'console.html'));
}
app.get('/', serveConsole);
app.get('/console', serveConsole);

function publicTrack(t) {
  return { index: t.index, file: t.file, name: t.name, tags: t.tags, duration: t.duration, ext: t.ext, mime: t.mime, url: t.url };
}

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'void-records-server',
    apiVersion: 1,
    tracks: catalog.count,
    lyrics: lyrics.size,
    clients: Object.keys(store.all()).length,
    uptime: Math.round(process.uptime()),
    mediaDir: MEDIA_DIR
  });
});

app.get('/api/v1/manifest', (req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  res.json({
    version: 1,
    generatedAt: catalog.generatedAt,
    count: catalog.count,
    totalDuration: catalog.totalDuration,
    timedCount: catalog.timedCount,
    tracks: catalog.tracks.map(publicTrack)
  });
});

app.get('/api/v1/tracks/:file', (req, res) => {
  const t = catalog.byFile.get(req.params.file);
  if (!t) return res.status(404).json({ error: 'unknown track', file: req.params.file });
  res.json(publicTrack(t));
});

// Deterministic PRNG so ?seed=... gives reproducible picks for tests/demos.
function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

app.get('/api/v1/random', (req, res) => {
  const q = req.query;
  const tags = String(q.tag || q.tags || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const excludes = new Set(String(q.exclude || '').split(',').map(s => s.trim()).filter(Boolean));
  const min = Number(q.min);
  const max = Number(q.max);
  const n = Math.max(1, Math.min(50, Number(q.n) || 1));
  const seed = q.seed == null ? null : Number(q.seed);

  let pool = catalog.tracks.filter(t => {
    if (excludes.has(t.file)) return false;
    if (Number.isFinite(min) && (t.duration === null || t.duration < min)) return false;
    if (Number.isFinite(max) && (t.duration === null || t.duration > max)) return false;
    if (tags.length && !tags.some(tag => t.tags.some(a => a.toLowerCase() === tag || a.toLowerCase().includes(tag)))) return false;
    return true;
  });

  const next = seed === null ? Math.random : rng(seed);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  res.json({ count: pool.length, picked: pool.slice(0, n).map(publicTrack) });
});

app.get('/api/v1/lyrics/index', (req, res) => res.json({ count: lyrics.size, loadedAt: lyrics.loadedAt, entries: lyrics.index() }));

app.get('/api/v1/lyrics', (req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  res.json(lyrics.lookup(req.query));
});

// Reload the offline file only. There is deliberately no live LRCLIB route.
app.post('/api/v1/lyrics/reload', (req, res) => {
  try {
    res.json({ ok: true, count: lyrics.load(), loadedAt: lyrics.loadedAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/v1/state/:client', (req, res) => {
  if (!store.valid(req.params.client)) return res.status(400).json({ error: 'bad client id' });
  res.set('Cache-Control', 'no-store');
  res.json({ client: req.params.client, state: store.get(req.params.client) });
});

app.put('/api/v1/state/:client', (req, res) => {
  if (!store.valid(req.params.client)) return res.status(400).json({ error: 'bad client id' });
  res.json({ ok: true, client: req.params.client, state: store.replace(req.params.client, req.body) });
});

app.patch('/api/v1/state/:client', (req, res) => {
  if (!store.valid(req.params.client)) return res.status(400).json({ error: 'bad client id' });
  res.json({ ok: true, client: req.params.client, state: store.patch(req.params.client, req.body) });
});

app.delete('/api/v1/state/:client', (req, res) => {
  if (!store.valid(req.params.client)) return res.status(400).json({ error: 'bad client id' });
  res.json({ ok: store.remove(req.params.client), client: req.params.client });
});

// express.static handles Range, ETag and Last-Modified for us.
app.use('/audio', express.static(MEDIA_DIR, {
  acceptRanges: true,
  etag: true,
  lastModified: true,
  index: false,
  dotfiles: 'deny',
  setHeaders(res, filePath) {
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.type(path.extname(filePath));
  }
}));

app.use((req, res) => res.status(404).json({ error: 'not found', path: req.path }));
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: err.message });
});

const server = app.listen(PORT, HOST, () => {
  console.log('[void-records-server] ' + HOST + ':' + PORT);
  console.log('  media   ' + MEDIA_DIR);
  console.log('  tracks  ' + catalog.count + ' (' + catalog.timedCount + ' with durations)');
  console.log('  lyrics  ' + lyrics.size + ' offline entries');
  console.log('  state   ' + STATE_FILE);
});

function shutdown() {
  store.saveNow();
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
// Windows does not reliably deliver SIGTERM to child processes; a sync flush
// on normal exit keeps the last debounced state patch from disappearing.
process.on('exit', () => store.saveNow());

module.exports = { app, server, catalog, lyrics, store };
