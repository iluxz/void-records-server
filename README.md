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

## endpoints (v1)

| route | what |
|---|---|
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
