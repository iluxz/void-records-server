# void-records-server

a small node + express bridge so other projects can pull from the void records shelf without depending on github pages. runs locally by default, binds to `127.0.0.1`, and does not phone home anywhere.

## run

```bash
npm install
npm start
# default: http://127.0.0.1:8787
npm run smoke   # boots a throwaway server and checks every endpoint
```

## env

| var | default | what |
|---|---|---|
| `PORT` | `8787` | listen port |
| `HOST` | `127.0.0.1` | set `0.0.0.0` only if another machine/projects on the LAN need it |
| `VR_MEDIA_DIR` | `../void-records` | folder holding `tracks.js` and the audio files |
| `VR_DURATIONS` | `data/durations.tsv` | 432-row `file<TAB>seconds` table |
| `VR_LYRICS` | `data/lyrics.json` | offline lyric dump result |
| `VR_STATE` | `data/state.json` | shared settings/achievements store |
| `VR_YTDLP` | `tools/yt-dlp.exe` (or PATH) | yt-dlp binary used by the link resolver |
| `VR_JS_RUNTIME` | `node` | JS runtime yt-dlp needs to expose YouTube's progressive formats |
| `VR_RESOLVE_TTL` | `20` | minutes to cache a resolved stream URL (signed links expire in hours) |
| `VR_YTDLP_ARGS` | empty | extra args appended to every resolve call, e.g. `--cookies-from-browser chrome` |
| `VR_RESOLVE_TIMEOUT` | `45` | seconds before a resolve attempt is abandoned |
| `VR_DISCOVER_LIMIT` | `200` | max candidates returned by one discovery scan |
| `VR_DISCOVER_TTL` | `30` | minutes to cache a playlist's metadata |

## youtube link playback

`GET /api/v1/resolve?url=<youtube url>` returns metadata plus one direct
progressive mp4 stream URL (format 18 - video and audio combined, so the
player's `<audio>` and muted `<video>` can share it). nothing is downloaded or
added to the shelf. `GET /api/v1/resolve/status` reports whether the binary is
available. youtube, youtube music, soundcloud, jiosaavn and bandcamp links are
accepted; spotify and apple music are rejected with a clear message because
they have no direct extractor.

the binary is gitignored (24 MB), so install it once:

```powershell
curl.exe -L --fail -o tools\yt-dlp.exe https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe
```

youtube hides progressive formats unless yt-dlp has a JS runtime. node is
already required by this server, so `--js-runtimes node` is passed by default.
if a link needs cookies (age/region gates), set `VR_YTDLP_ARGS` to
`--cookies-from-browser chrome` and restart.

signed stream URLs are bound to the requesting IP and expire in hours, so the
player re-resolves every time rather than storing them. a 403/429 usually means
the IP got soft-blocked - solve the challenge in a browser and retry with
cookies. resolved metadata is cached for `VR_RESOLVE_TTL` minutes.

## discovery queue + sandbox radio

`GET /api/v1/discover?url=<playlist url>` runs yt-dlp with `--flat-playlist
--skip-download --dump-single-json`. it returns only metadata (id, title,
channel, duration, thumbnail, playable url) and never downloads audio. accepted
inputs are youtube/youtube music playlists (or a single video), soundcloud sets,
jiosaavn and bandcamp playlists, plus explicit `ytsearch5:query` /
`ytmsearch5:query` station queries. results are capped at `VR_DISCOVER_LIMIT`
and cached in memory for `VR_DISCOVER_TTL` minutes; concurrent identical scans
share one in-flight job.

the player's discover panel previews candidates and lets you keep a few in a
separate local pool. sandbox radio shuffles that pool, resolves each entry on
demand through `/api/v1/resolve`, and repeats forever. neither feature writes
`vr_clean`, shelf stats or achievements - the 432 stays finite and fully
offline. spotify/apple playlists get a plain error rather than a fake result.

## browser console

served by express at `/` and `/console`, and deployed to cloudflare pages at
`https://void-records-console.cnnecare.workers.dev`. it has a method/path/body
request box, a response viewer, quick chips for every common route, a filtered
random picker and an audio player. no build step, one self-contained `console.html`.

the express copy defaults to `http://127.0.0.1:8787`. the pages copy reads
`pages/config.json` for the tunnel url, and `?base=https://...` always wins and
sticks in localStorage. a changed tunnel url bumps the config `version`, so
existing browsers pick it up on next load.

| console script | what |
|---|---|
| `npm run console:url` | pull the newest trycloudflare url from `data/tunnel.log` into `pages/config.json` |
| `npm run console:deploy` | same, then upload to cloudflare pages |

`vr-server.vbs` starts both the server and a quick tunnel at login, hidden, with
guards against double-launching either. copy it into the startup folder:

```powershell
Copy-Item vr-server.vbs ([Environment]::GetFolderPath('Startup'))
```

`tools/cloudflared.exe` is downloaded separately and gitignored (55 MB):

```powershell
curl.exe -L --fail -o tools\cloudflared.exe https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
```

quick tunnel urls change on every restart. after a reboot, run
`npm run console:deploy` once to republish the new url. for a permanent url,
use a named tunnel with a domain instead.

## endpoints (v1)

| route | what |
|---|---|
| `GET /` / `GET /console` | the browser console |
| `GET /health` | status, track count, lyric count, uptime |
| `GET /api/v1/manifest` | all 432 tracks with name, tags, duration, mime, url |
| `GET /api/v1/tracks/:file` | one track |
| `GET /audio/:file` | the actual file, with byte-range support + immutable cache |
| `GET /api/v1/random?tag=&min=&max=&exclude=&n=&seed=` | filtered random picks, seed is optional/deterministic |
| `GET /api/v1/lyrics?file=&duration=&title=&artist=` | offline-only lyric lookup |
| `GET /api/v1/lyrics/index` | which files have offline lyrics |
| `POST /api/v1/lyrics/reload` | reload the offline json, no network call |
| `GET/PUT/PATCH/DELETE /api/v1/state/:client` | shared settings + achievement state |

Everything sends `Access-Control-Allow-Origin: *` and exposes `Content-Range`/`Accept-Ranges`, so cross-origin audio can seek.

## using it from a project

```html
<script src="http://127.0.0.1:8787/vr-client.js"></script>
<script>
const tracks = await VR.manifest();
const pick = await VR.random({ tag: 'ultrakill', n: 1 }).then(r => r[0]);
const audio = new Audio(VR.audioUrl(pick.file));
audio.crossOrigin = 'anonymous'; // REQUIRED for Web Audio / visualizers
</script>
```

`VR.patchState('cube', { vr_settings: {...} })` shares state across projects. `vr_clean`, `vr_ach`, `vr_settings`, `vr_sfx` are just keys in that JSON blob, no special schema.

gotcha: an `https://` page cannot load audio from `http://127.0.0.1:8787` (mixed content). serve the consuming project over localhost/http too, tunnel the server over https, or set `HOST=0.0.0.0` and use the LAN IP from an http page.

## rules baked in

- **never** calls LRCLIB or any external API at runtime. `data/lyrics.json` is built ahead of time by a one-off, rate-limited per-song lookup (see `scripts/build-lyrics.py`); an empty source returns `{found:false}`, not a live search.
- audio filenames are stable, so files are cached as `immutable` and served with `Range` — seeking a 65-minute track does not re-download it.
- state is written at most once per 1.5s burst, via atomic temp-file + rename.
- the catalog and lyric index load once at startup. no per-request filesystem scanning.
- `vr-client.js` sets `crossorigin` expectations explicitly because a tainted media element makes `createMediaElementSource()` output silence.

## status

the 52.94 GiB LRCLIB sqlite dump is gone - it was never needed. `data/lyrics.json` is now built by searching LRCLIB once per shelf song, 1.5s apart, with strict title and duration guards. the lyrics route stays offline at runtime; unmatched songs simply report "not found".
