'use strict';

// One place that decides which outside sources the bridge understands. Both the
// paste resolver and the discovery scanner use it so the player never offers
// a source that cannot actually be played back.

function classify(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (/^yt(?:m)?search\d*:/i.test(s)) {
    return { ok: true, kind: 'search', host: 'youtube', playlist: true };
  }
  let u;
  try { u = new URL(s); } catch (e) { return { ok: false, reason: 'enter an http(s) link or a ytsearch: query' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, reason: 'enter an http(s) link or a ytsearch: query' };
  }
  const h = u.hostname.toLowerCase();

  if (h === 'youtu.be' || /(?:^|\.)youtube\.com$/.test(h)) {
    const list = u.searchParams.get('list');
    return {
      ok: true, kind: 'youtube', host: 'youtube',
      playlist: !!(list || /^\/playlist/i.test(u.pathname) || /^\/shorts/i.test(u.pathname)),
      url: u
    };
  }
  if (/(?:^|\.)soundcloud\.com$/.test(h)) {
    return { ok: true, kind: 'soundcloud', host: 'soundcloud', playlist: /\/sets?\//i.test(u.pathname), url: u };
  }
  if (/(?:^|\.)jiosaavn\.com$/.test(h)) {
    return { ok: true, kind: 'jiosaavn', host: 'jiosaavn', playlist: true, url: u };
  }
  if (/(?:^|\.)bandcamp\.com$/.test(h)) {
    return { ok: true, kind: 'bandcamp', host: 'bandcamp', playlist: true, url: u };
  }
  if (/(?:^|\.)spotify\.com$/.test(h)) {
    return { ok: false, reason: 'spotify has no direct stream extractor - use a youtube playlist or a ytsearch: query' };
  }
  if (/(?:^|\.)apple\.com$/.test(h)) {
    return { ok: false, reason: 'apple music has no direct stream extractor - use a youtube playlist or a ytsearch: query' };
  }
  return { ok: false, reason: 'unsupported source - use youtube, youtube music, soundcloud, jiosaavn or bandcamp' };
}

// paste playback: a single playable thing, not a search query
function watchable(raw) {
  const c = classify(raw);
  return c.ok && c.kind !== 'search';
}

// discovery: playlists and search queries are both fine here
function discoverable(raw) {
  return classify(raw).ok;
}

module.exports = { classify, watchable, discoverable };
