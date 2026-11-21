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
| `VR_DURATIONS` | `data/durations.tsv` | 418-row `file<TAB>seconds` table |
| `VR_LYRICS` | `data/lyrics.json` | offline lyric dump result |
| `VR_STATE` | `data/state.json` | shared settings/achievements store |

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
| `GET /api/v1/manifest` | all 418 tracks with name, tags, duration, mime, url |
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

- **never** calls LRCLIB or any external API. `data/lyrics.json` is populated offline from the dump; an empty source returns `{found:false}`, not a live search.
- audio filenames are stable, so files are cached as `immutable` and served with `Range` — seeking a 65-minute track does not re-download it.
- state is written at most once per 1.5s burst, via atomic temp-file + rename.
- the catalog and lyric index load once at startup. no per-request filesystem scanning.
- `vr-client.js` sets `crossorigin` expectations explicitly because a tainted media element makes `createMediaElementSource()` output silence.

## status

the offline lyric file is currently empty because the LRCLIB recompress died with `EOFError` on a truncated `.zst`. the lyrics route is live and tested; it just reports "not found" until the dump is finished and matched against the 418-row duration table.
