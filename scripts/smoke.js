'use strict';

// Boots a throwaway server on port 8799, hits every v1 endpoint, then exits.
// Usage: npm run smoke

const { spawn } = require('child_process');
const path = require('path');
const sources = require('../lib/sources');

const PORT = 8799;
const BASE = 'http://127.0.0.1:' + PORT;
const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: Object.assign({}, process.env, { PORT: String(PORT), HOST: '127.0.0.1' }),
  stdio: ['ignore', 'pipe', 'pipe']
});
child.stderr.on('data', d => process.stderr.write(d));

const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;

function check(name, condition, detail) {
  console.log((condition ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  ' + detail : ''));
  if (!condition) failed++;
}

async function json(pathname, options) {
  const res = await fetch(BASE + pathname, options);
  return { status: res.status, headers: res.headers, body: await res.json() };
}

(async () => {
  let up = false;
  for (let i = 0; i < 40 && !up; i++) {
    try { up = (await fetch(BASE + '/health')).ok; } catch (_) { await sleep(100); }
  }
  if (!up) throw new Error('server did not start');

  const health = await json('/health');
  check('health', health.body.ok && health.body.tracks === 431, 'tracks=' + health.body.tracks);

  const consolePage = await fetch(BASE + '/console');
  const consoleHtml = await consolePage.text();
  check('console served', consolePage.status === 200 && /void records :: console/.test(consoleHtml));
  check('console has request/response ui', consoleHtml.includes('id="send"') && consoleHtml.includes('id="out"') && consoleHtml.includes('id="player"'));

  const manifest = await json('/api/v1/manifest');
  check('manifest 431 tracks', manifest.body.count === 431, 'count=' + manifest.body.count);
  check('durations merged', manifest.body.timedCount === 431, 'timed=' + manifest.body.timedCount);
  check('urls encoded', manifest.body.tracks[0].url.startsWith('/audio/'));

  const one = await json('/api/v1/tracks/' + encodeURIComponent(manifest.body.tracks[0].file));
  check('single track', one.status === 200 && one.body.file === manifest.body.tracks[0].file);

  const random = await json('/api/v1/random?tag=ultrakill&n=3&seed=42');
  check('random filtered', random.body.picked.length === 3 && random.body.picked.every(t => t.tags.includes('ultrakill')),
    'picked=' + random.body.picked.length);

  const again = await json('/api/v1/random?tag=ultrakill&n=3&seed=42');
  check('random seeded deterministic', JSON.stringify(random.body.picked) === JSON.stringify(again.body.picked));

  const resolveStatus = await json('/api/v1/resolve/status');
  check('resolver status', resolveStatus.status === 200 && typeof resolveStatus.body.available === 'boolean',
    'binary=' + resolveStatus.body.binary);
  const reject = await json('/api/v1/resolve?url=' + encodeURIComponent('https://example.com/song'));
  check('resolver rejects non-youtube', reject.status === 400 && /youtube/i.test(reject.body.error));
  const noUrl = await json('/api/v1/resolve');
  check('resolver needs a url', noUrl.status === 400);

  const discNoUrl = await json('/api/v1/discover');
  check('discovery needs a url', discNoUrl.status === 400);
  const discSpotify = await json('/api/v1/discover?url=' + encodeURIComponent('https://open.spotify.com/playlist/abc'));
  check('discovery rejects spotify clearly', discSpotify.status === 400 && /no direct stream extractor/i.test(discSpotify.body.error));
  const discSearch = sources.classify('ytsearch5:void ambient');
  check('discovery accepts search queries', discSearch.ok && discSearch.kind === 'search');

  const lyrics = await json('/api/v1/lyrics?file=delta2lp.wav&duration=10.45');
  check('lyrics offline empty is graceful', lyrics.status === 200 && lyrics.body.found === false);

  const lyricsIndex = await json('/api/v1/lyrics/index');
  check('lyrics index', lyricsIndex.body.count === 0);

  const client = 'smoke-' + Date.now();
  const patched = await json('/api/v1/state/' + client, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vr_sfx: true, vr_clean: { 'a.mp3': true } })
  });
  check('state patch', patched.body.state.vr_sfx === true);
  const fetched = await json('/api/v1/state/' + client);
  check('state round trip', fetched.body.state.vr_clean['a.mp3'] === true);
  await sleep(1700); // debounce window
  const fs = require('fs');
  const saved = fs.existsSync(path.join(__dirname, '..', 'data', 'state.json'))
    ? JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'state.json'), 'utf8'))
    : {};
  check('state persisted to disk', !!(saved.clients && saved.clients[client] && saved.clients[client].vr_sfx === true));
  await json('/api/v1/state/' + client, { method: 'DELETE' });

  const clientJs = await fetch(BASE + '/vr-client.js');
  check('client helper served', clientJs.status === 200 && (await clientJs.text()).includes('global.VR'));

  const file = manifest.body.tracks[0].file;
  const audio = await fetch(BASE + '/audio/' + encodeURIComponent(file), { headers: { Range: 'bytes=0-15' } });
  check('audio range 206', audio.status === 206, 'status=' + audio.status);
  check('audio CORS', audio.headers.get('access-control-allow-origin') === '*');
  check('audio immutable cache', /immutable/.test(audio.headers.get('cache-control') || ''));

  const missing = await json('/api/v1/nope');
  check('unknown api 404', missing.status === 404);

  console.log(failed ? '\n' + failed + ' FAILED' : '\nall server smoke checks passed');
})().catch(err => {
  console.error(err);
  failed++;
}).finally(() => {
  child.kill('SIGTERM');
  process.exit(failed ? 1 : 0);
});
