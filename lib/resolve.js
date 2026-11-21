'use strict';

// Resolves a pasted YouTube link into a directly-playable progressive stream.
// The browser cannot do this itself (CORS + signed URLs), so the local server
// shells out to yt-dlp. No audio is downloaded here - only metadata + one URL.

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const EXE = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const YT_HOST_RE = /^https?:\/\/(?:(?:www|m|music)\.youtube\.com|youtube\.com|youtu\.be)\//i;

function findBinary() {
  if (process.env.VR_YTDLP) return process.env.VR_YTDLP;
  const local = path.join(ROOT, 'tools', EXE);
  if (fs.existsSync(local)) return local;
  return EXE; // fall back to PATH
}
const BIN = findBinary();

const TTL = Number(process.env.VR_RESOLVE_TTL || 20) * 60 * 1000;
const TIMEOUT = Number(process.env.VR_RESOLVE_TIMEOUT || 45) * 1000;
const EXTRA = String(process.env.VR_YTDLP_ARGS || '').trim().split(/\s+/).filter(Boolean);
// YouTube hides progressive formats without a JS runtime. node is already the
// server's runtime, so use it instead of shipping a separate deno binary.
const JS_RUNTIME = process.env.VR_JS_RUNTIME || 'node';
const cache = new Map();

function valid(url) {
  return YT_HOST_RE.test(String(url || ''));
}

function toolError(err, stderr) {
  const lines = String(stderr || (err && err.message) || 'yt-dlp failed').trim().split('\n').filter(Boolean);
  return new Error(lines.slice(-3).join(' | ').slice(0, 400));
}

function resolve(url) {
  const args = [
    '--js-runtimes', JS_RUNTIME,
    '--no-playlist',
    '--skip-download',
    '--dump-single-json',
    '--no-warnings',
    // progressive: one combined video+audio file, which <video> can display
    // and <audio> can play. DASH bestvideo+bestaudio has no single url.
    '-f', 'best[ext=mp4][acodec!=none][vcodec!=none]/best[acodec!=none][vcodec!=none]/best',
    ...EXTRA,
    url
  ];
  return new Promise((resolveP, reject) => {
    execFile(BIN, args, { timeout: TIMEOUT, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(toolError(err, stderr));
      try {
        const j = JSON.parse(String(stdout).slice(String(stdout).indexOf('{')));
        if (!j.url) throw new Error('no playable stream returned - try a different video');
        resolveP({
          ok: true,
          url: j.url,
          title: j.title || 'youtube video',
          channel: j.channel || j.uploader || '',
          duration: Number(j.duration) || null,
          thumbnail: j.thumbnail || null,
          headers: j.http_headers || null,
          video: true,
          source: 'youtube',
          expires: Date.now() + TTL
        });
      } catch (e) { reject(e); }
    });
  });
}

async function resolveUrl(url) {
  if (!valid(url)) {
    const e = new Error('only youtube links are supported');
    e.code = 400;
    throw e;
  }
  const key = String(url);
  const hit = cache.get(key);
  if (hit && Date.now() < hit.at + TTL) return Object.assign({}, hit.value, { cached: true });
  if (hit) cache.delete(key);
  const value = await resolve(key);
  cache.set(key, { at: Date.now(), value });
  return value;
}

function available() {
  return new Promise(r => {
    execFile(BIN, ['--version'], { timeout: 5000, windowsHide: true }, (err, out) => {
      r(err ? null : String(out).trim());
    });
  });
}

module.exports = { resolveUrl, available, valid, BIN, cache, TTL };
