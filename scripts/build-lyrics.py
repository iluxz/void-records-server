"""Targeted LRCLIB lookup for every void records shelf track.

One polite search per song, cached to disk, strict title + duration guards.
Writes D:\Cube\void-records-server\data\lyrics.json in the plain map shape
that lib/lyrics.js already understands. No dump, no bulk scrape.
"""
import difflib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

WEB = r'D:\Cube\void-records'
DUR = r'D:\Cube\void-records-server\data\durations.tsv'
OUT = r'D:\Cube\void-records-server\data\lyrics.json'
CACHE = r'C:\Users\Can\Downloads\lrclib-targeted-cache.json'
LOG = r'C:\Users\Can\Downloads\lrclib-targeted.log'
UA = 'void-records-targeted-lyrics/1.0 (https://github.com/iluxz/void-records)'
DELAY = 1.5

JUNK = re.compile(
    r'\s*(\(|\[|\{)[^)\]\}]*(official|lyrics?|video|audio|visualizer|mv|hd|hq|'
    r'4k|1080p|720p|sfm|remix|cover|full|extended|sped up|boosted|slowed|'
    r'edit|mashup|live|teaser|preview|demo|clip|cut|reaction|karaoke)[^)\]\}]*(\)|\]|\})',
    re.I)


def log(msg):
    line = '%s %s\n' % (time.strftime('%Y-%m-%d %H:%M:%S'), msg)
    with open(LOG, 'a', encoding='utf-8') as f:
        f.write(line)
    sys.stderr.write(line)
    sys.stderr.flush()


def norm(s):
    return re.sub(r'[^a-z0-9]+', ' ', str(s or '').lower()).strip()


def parse_query(name):
    raw = re.sub(r'\s+', ' ', str(name or '')).strip()
    q = JUNK.sub('', raw)
    q = re.sub(r'\s*[-–—|]\s*(?:with|ft\.?|feat\.?)\b.*$', '', q, flags=re.I)
    q = re.sub(r'\s+', ' ', q).strip(' -–—|')
    artist, title = '', q
    if ' - ' in q:
        left, right = q.split(' - ', 1)
        if 2 <= len(left) <= 40 and len(right) >= 3:
            artist, title = left.strip(), right.strip()
    return raw, q, artist, title


def get(url, tries=4):
    for n in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode('utf-8'))
        except urllib.error.HTTPError as exc:
            if exc.code in (429, 403, 500, 502, 503, 504) and n < tries - 1:
                wait = 5 * (2 ** n)
                log('  http %d, backoff %ds' % (exc.code, wait))
                time.sleep(wait)
                continue
            raise
        except Exception:
            if n < tries - 1:
                time.sleep(5 * (2 ** n))
                continue
            raise


def score_hit(hit, title, artist, dur):
    if not hit.get('plainLyrics') and not hit.get('syncedLyrics'):
        return -100
    nt = norm(title)
    rt = norm(hit.get('trackName'))
    if not nt or not rt:
        return -100
    ratio = difflib.SequenceMatcher(None, nt, rt).ratio()
    if nt in rt or rt in nt:
        ratio = max(ratio, 0.9)
    d = abs(float(hit.get('duration') or 0) - float(dur or 0))
    if d > 5:
        return -100
    s = ratio * 20 - d * 1.5
    if hit.get('syncedLyrics'):
        s += 4
    if hit.get('lyricsfile'):
        s += 2
    na = norm(artist)
    ra = norm(hit.get('artistName'))
    if na:
        if na == ra:
            s += 6
        elif na in ra or ra in na:
            s += 3
        else:
            s -= 6
    return s


def main():
    src = open(os.path.join(WEB, 'tracks.js'), encoding='utf-8').read()
    tracks = json.loads(re.search(r'const TRACKS=(\[[\s\S]*\])\s*;?\s*$', src).group(1))
    durations = {}
    for line in open(DUR, encoding='utf-8'):
        if '\t' in line:
            f, d = line.rstrip('\n').split('\t', 1)
            durations[f] = float(d)
    cache = {}
    if os.path.exists(CACHE):
        try:
            cache = json.load(open(CACHE, encoding='utf-8'))
        except Exception:
            cache = {}

    results = {}
    log('start %d tracks' % len(tracks))
    for i, tr in enumerate(tracks, 1):
        f = tr['f']
        if f in cache and cache[f].get('done'):
            hit = cache[f].get('best')
            if hit:
                results[f] = hit
            continue
        raw, q, artist, title = parse_query(tr['n'])
        dur = durations.get(f)
        params = {'track_name': title or q, 'limit': '10'}
        if dur:
            params['duration'] = str(int(round(dur)))
        if artist:
            params['artist_name'] = artist
        url = 'https://lrclib.net/api/search?' + urllib.parse.urlencode(params)
        best, best_score, err = None, -100, None
        try:
            hits = get(url)
            if not isinstance(hits, list):
                hits = []
            for h in hits:
                s = score_hit(h, title or q, artist, dur)
                if s > best_score:
                    best_score, best = s, h
            if best_score < 0:
                # one loose fallback, same rate limit, still duration-guarded
                time.sleep(DELAY)
                fb = 'https://lrclib.net/api/search?' + urllib.parse.urlencode(
                    {'q': q or raw, 'limit': '10'})
                for h in get(fb):
                    s = score_hit(h, title or q, '', dur)
                    if s > best_score:
                        best_score, best = s, h
        except Exception as exc:
            err = repr(exc)
            log('  %s error %r' % (f, exc))
        rec = {'done': True, 'q': q, 'artist': artist, 'title': title,
               'duration': dur, 'err': err,
               'best': {'title': best.get('trackName'), 'artist': best.get('artistName'),
                        'duration': best.get('duration'), 'score': round(best_score, 2),
                        'synced': best.get('syncedLyrics') or None,
                        'plain': best.get('plainLyrics') or None,
                        'wordSynced': best.get('lyricsfile') or None,
                        'lrclibId': best.get('id')} if best_score >= 0 else None}
        cache[f] = rec
        results[f] = rec['best']
        if i % 10 == 0 or rec['best']:
            log('%d/%d %s -> %s' % (i, len(tracks), f,
                                   (rec['best'] or {}).get('title') or 'no match'))
        with open(CACHE, 'w', encoding='utf-8') as fh:
            json.dump(cache, fh, ensure_ascii=False)
        time.sleep(DELAY)

    out = {}
    for f, best in results.items():
        if not best:
            continue
        tr = next(t for t in tracks if t['f'] == f)
        out[f] = {
            'file': f,
            'title': best['title'],
            'artist': best['artist'],
            'duration': best['duration'],
            'shelfTitle': tr['n'],
            'synced': best.get('synced'),
            'plain': best.get('plain'),
            'wordSynced': best.get('wordSynced'),
            'lrclibId': best.get('lrclibId'),
        }
    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(out, fh, ensure_ascii=False, indent=2)
    log('DONE matched %d/%d -> %s' % (len(out), len(tracks), OUT))


if __name__ == '__main__':
    main()
