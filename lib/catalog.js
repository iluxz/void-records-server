'use strict';

const fs = require('fs');
const path = require('path');

const MIME = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
  '.mp4': 'video/mp4',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac'
};

function parseDurations(file) {
  const out = new Map();
  if (!file || !fs.existsSync(file)) return out;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const name = (parts[0] || '').trim();
    const seconds = Number(parts[1]);
    if (name && Number.isFinite(seconds) && seconds > 0) out.set(name, seconds);
  }
  return out;
}

function load(mediaDir, durationsFile) {
  const source = fs.readFileSync(path.join(mediaDir, 'tracks.js'), 'utf8');
  const start = source.indexOf('[');
  const end = source.lastIndexOf(']');
  if (start < 0 || end <= start) throw new Error('could not find TRACKS array in tracks.js');

  const raw = JSON.parse(source.slice(start, end + 1));
  const durations = parseDurations(durationsFile);

  const tracks = raw.map((t, index) => {
    const ext = path.extname(t.f).toLowerCase();
    return {
      index,
      file: t.f,
      name: t.n,
      tags: Array.isArray(t.a) ? t.a : [],
      duration: durations.has(t.f) ? durations.get(t.f) : null,
      ext,
      mime: MIME[ext] || 'application/octet-stream',
      url: '/audio/' + encodeURIComponent(t.f)
    };
  });

  const timed = tracks.filter(t => t.duration !== null);
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    count: tracks.length,
    totalDuration: timed.reduce((sum, t) => sum + t.duration, 0),
    timedCount: timed.length,
    tracks,
    byFile: new Map(tracks.map(t => [t.file, t]))
  };
}

module.exports = { load, parseDurations, MIME };
