'use strict';

// Metadata-only playlist scanner for the discovery queue. yt-dlp runs in flat
// mode: it reads titles/ids/durations, never downloads a byte of audio, and
// nothing here can add a track to the 431-record shelf.

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const sources = require('./sources');

const ROOT = path.join(__dirname, '..');
const EXE = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
function findBinary() {
  if (process.env.VR_YTDLP) return process.env.VR_YTDLP;
  const local = path.join(ROOT, 'tools', EXE);
  if (fs.existsSync(local)) return local;
  return EXE;
}
const BIN = findBinary();
const JS_RUNTIME = process.env.VR_JS_RUNTIME || 'node';
const EXTRA = String(process.env.VR_YTDLP_ARGS || '').trim().split(/\s+/).filter(Boolean);
const LIMIT = Math.max(1, Math.min(500, Number(process.env.VR_DISCOVER_LIMIT || 200)));
const TTL = Math.max(0, Number(process.env.VR_DISCOVER_TTL || 30)) * 60 * 1000;
const TIMEOUT = Math.max(5000, Number(process.env.VR_DISCOVER_TIMEOUT || 45) * 1000);

const cache = new Map();
const inflight = new Map();

function toolError(err, stderr) {
  const lines = String(stderr || (err && err.message) || 'yt-dlp failed').trim().split('\n').filter(Boolean);
  return new Error(lines.slice(-3).join(' | ').slice(0, 400));
}

function thumbnail(e) {
  const list = Array.isArray(e.thumbnails) ? e.thumbnails : [];
  for (let i = list.length - 1; i >= 0; i--) if (list[i] && list[i].url) return list[i].url;
  return e.thumbnail || null;
}

function normalize(e) {
  if (!e || typeof e !== 'object') return null;
  const id = e.id || null;
  let url = e.url || (id ? 'https://www.youtube.com/watch?v=' + id : null);
  if (!url) return null;
  return {
    id: id,
    url: url,
    title: e.title || id || 'untitled',
    channel: e.channel || e.uploader || '',
    duration: Number(e.duration) || null,
    thumbnail: thumbnail(e),
    live: e.live_status === 'live' || !!e.live
  };
}

function scan(raw) {
  const source = String(raw == null ? '' : raw).trim();
  const classified = sources.classify(source);
  if (!classified.ok) {
    const e = new Error(classified.reason);
    e.code = 400;
    return Promise.reject(e);
  }
  const hit = cache.get(source);
  if (hit && Date.now() < hit.at + TTL) {
    return Promise.resolve(Object.assign({}, hit.value, { cached: true }));
  }
  if (hit) cache.delete(source);
  if (inflight.has(source)) return inflight.get(source);

  const args = [
    '--js-runtimes', JS_RUNTIME,
    '--flat-playlist',
    '--skip-download',
    '--dump-single-json',
    '--no-warnings',
    '--playlist-end', String(LIMIT),
    ...EXTRA,
    source
  ];
  const job = new Promise((resolveP, reject) => {
    execFile(BIN, args, { timeout: TIMEOUT, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(toolError(err, stderr));
      try {
        const text = String(stdout);
        const j = JSON.parse(text.slice(text.indexOf('{')));
        // a plain video link has no "entries" wrapper; treat it as a one-item queue
        const rawEntries = Array.isArray(j.entries) ? j.entries : (j._type === 'url' || !j.id ? [] : [j]);
        const all = rawEntries.map(normalize).filter(Boolean);
        const value = {
          ok: true,
          source: source,
          kind: classified.kind,
          host: classified.host,
          title: j.title || j.id || source,
          count: all.length,
          limit: LIMIT,
          truncated: all.length >= LIMIT,
          items: all,
          scannedAt: Date.now()
        };
        cache.set(source, { at: Date.now(), value: value });
        resolveP(value);
      } catch (e) {
        reject(new Error('could not read playlist metadata: ' + e.message));
      }
    });
  });
  inflight.set(source, job);
  job.then(() => inflight.delete(source), () => inflight.delete(source));
  return job;
}

module.exports = { scan, cache, BIN, LIMIT, TTL };
