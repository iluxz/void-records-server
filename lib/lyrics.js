'use strict';

// OFFLINE ONLY. This module never performs a network request. The LRCLIB dump
// is processed ahead of time into data/lyrics.json; this just looks it up.

const fs = require('fs');

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const BUCKETS = ['high', 'candidates', 'unverified', 'entries'];

function collectEntries(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (typeof data !== 'object') return [];
  // A bucket-shaped object stays empty when its buckets are empty. Without
  // this, {high:[],...} would be misread as a map with three "files".
  if (BUCKETS.some(key => Array.isArray(data[key]))) {
    return BUCKETS.reduce((all, key) => all.concat(Array.isArray(data[key]) ? data[key] : []), []);
  }
  // plain map: { "filename.mp3": {...} }
  return Object.keys(data).map(key => {
    const value = data[key] && typeof data[key] === 'object' ? data[key] : {};
    return Object.assign({ file: key }, value);
  });
}

class Lyrics {
  constructor(file) {
    this.file = file;
    this.entries = [];
    this.byFile = new Map();
    this.byTitle = new Map();
    this.loadedAt = null;
    this.load();
  }

  load() {
    let data = null;
    if (this.file && fs.existsSync(this.file)) {
      try {
        data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      } catch (err) {
        throw new Error('bad lyrics json: ' + err.message);
      }
    }
    this.entries = collectEntries(data);
    this.byFile.clear();
    this.byTitle.clear();

    for (const e of this.entries) {
      const file = e.file || e.filename || e.f;
      if (file) this.byFile.set(file, e);
      const title = normalize(e.title || e.n || e.trackName);
      const artist = normalize(e.artist || e.a);
      if (title) this.byTitle.set(title + '|' + artist, e);
      if (title && !this.byTitle.has(title)) this.byTitle.set(title, e);
    }
    this.loadedAt = new Date().toISOString();
    return this.size;
  }

  get size() { return this.entries.length; }

  lookup(query) {
    const file = query.file || query.f || '';
    const duration = Number(query.duration);
    const title = normalize(query.title);
    const artist = normalize(query.artist);

    let hit = file ? this.byFile.get(file) : null;

    // Some dump rows are keyed by title/artist instead of shelf filename.
    if (!hit && title) {
      hit = this.byTitle.get(title + '|' + artist) || this.byTitle.get(title);
    }

    // Duration is a guard, not a lookup key: a near-match with a wildly
    // different length is almost always the wrong cover of a song.
    if (hit && Number.isFinite(duration) && hit.duration && Math.abs(Number(hit.duration) - duration) > 5) {
      return { found: false, reason: 'duration mismatch', candidate: this.shape(hit) };
    }
    if (!hit) return { found: false, reason: this.size ? 'no offline match' : 'offline lyric source is empty' };
    return { found: true, source: 'offline-dump', data: this.shape(hit) };
  }

  shape(e) {
    return {
      file: e.file || e.filename || e.f || null,
      title: e.title || e.n || null,
      artist: e.artist || e.a || null,
      duration: e.duration == null ? null : Number(e.duration),
      synced: e.synced || e.wordSynced || e.lrc || null,
      plain: e.plain || e.plainLrc || e.lyrics || null
    };
  }

  index() {
    return this.entries.map(e => ({
      file: e.file || e.filename || e.f || null,
      title: e.title || e.n || null,
      artist: e.artist || e.a || null,
      duration: e.duration == null ? null : Number(e.duration),
      hasSynced: !!(e.synced || e.wordSynced || e.lrc),
      hasPlain: !!(e.plain || e.plainLrc || e.lyrics)
    }));
  }
}

module.exports = { Lyrics, normalize };
