"""Look up cover art and release dates for every release in a year, and save them to
data/meta.csv. Runs in GitHub Actions on every push (it needs internet access).

    python tools/enrich.py              # every year with a rankings folder
    python tools/enrich.py 2026 --retry # also retry albums that found nothing last time

Sources, in order: Deezer, iTunes, MusicBrainz + Cover Art Archive. A candidate only
counts if its artist and title match the RYM entry and its release year matches.
Albums still without a date get an estimate from their RYM album ID (IDs are handed
out in order as releases are added, so they track release dates closely).

Hand edits: put your own art_url / release_date in a row and set locked=X, and this
script will never touch that row again.
"""
from __future__ import annotations

import argparse
import json
import re
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, timedelta
from difflib import SequenceMatcher

from rym import META, META_COLS, RANKINGS, export_paths, read_csv, read_export, snapshot_paths, write_csv

UA = "yearly-album-rankings/1.0 (+https://github.com/ambilixer/yearly_album_rankings)"
RETRY_DAYS = 30
REAL_SOURCES = {"deezer", "itunes", "musicbrainz", "manual"}
SPLIT = re.compile(r"\s*(?:,|&|/|\+| x | and | feat\.? | with )\s*", re.I)


# ---------- http ----------
def get_json(url: str, pause: float):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=25) as r:
                data = json.load(r)
            time.sleep(pause)
            if isinstance(data, dict) and isinstance(data.get("error"), dict):  # Deezer quota
                time.sleep(5 * (attempt + 1))
                continue
            return data
        except urllib.error.HTTPError as e:
            if e.code == 404:
                time.sleep(pause)
                return None
            if e.code in (403, 429, 500, 502, 503, 504):
                time.sleep(6 * (attempt + 1))
                continue
            print(f"    http {e.code} for {url}")
            return None
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            time.sleep(3 * (attempt + 1))
    return None


# ---------- matching ----------
def norm(s: str, drop_brackets: bool = True) -> str:
    s = re.sub(r"\s-\s(ep|single)\s*$", "", s or "", flags=re.I)
    s = unicodedata.normalize("NFKC", s)
    s = "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c)).lower()
    s = s.replace("&", " and ")
    if drop_brackets:
        stripped = re.sub(r"[\(\[].*?[\)\]]", " ", s)
        if re.sub(r"\W", "", stripped):
            s = stripped
    s = re.sub(r"[^\w]+", " ", s)
    return " ".join(s.split())


def ratio(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()


def title_score(rym: str, cand: str) -> float:
    a, b = norm(rym), norm(cand)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    if min(len(a), len(b)) <= 3:  # "U", "bb": only exact matches count
        return 0.0
    r = ratio(a, b)
    return r if r >= 0.88 else 0.0


def artist_score(variants: list[str], cand: str) -> float:
    c = norm(cand, drop_brackets=False)
    if not c:
        return 0.0
    best = 0.0
    for v in variants:
        full = norm(v, drop_brackets=False)
        parts = {norm(p, drop_brackets=False) for p in SPLIT.split(v) if p.strip()}
        cparts = {norm(p, drop_brackets=False) for p in SPLIT.split(cand) if p.strip()}
        if c == full:
            return 1.0
        if parts & cparts:  # a collaborator matches
            best = max(best, 0.9)
        r = ratio(full, c)
        if r >= 0.85:
            best = max(best, r)
    return best


def year_ok(d: str | None, year: int) -> bool:
    return not d or d[:4] == str(year)


# ---------- sources ----------
def deezer(variants, title, year):
    for artist in variants:
        for q in (f'artist:"{artist}" album:"{title}"', f"{artist} {title}"):
            res = get_json("https://api.deezer.com/search/album?limit=15&q=" + urllib.parse.quote(q), 0.2)
            cands = []
            for it in (res or {}).get("data", []):
                sc = title_score(title, it.get("title", "")) * artist_score(variants, (it.get("artist") or {}).get("name", ""))
                if sc > 0:
                    cands.append((sc, it))
            for sc, it in sorted(cands, key=lambda x: -x[0]):
                full = get_json(f"https://api.deezer.com/album/{it['id']}", 0.2) or {}
                d = full.get("release_date")
                if year_ok(d, year):
                    art = full.get("cover_xl") or it.get("cover_xl")
                    if art and "/images/cover//" in art:  # Deezer's blank placeholder
                        art = None
                    return {"art": art, "date": d, "src": "deezer", "match": f"{it['artist']['name']} – {it['title']}"}
    return None


def itunes(variants, title, year):
    for artist in variants:
        q = urllib.parse.urlencode({"term": f"{artist} {title}", "entity": "album", "media": "music", "limit": 25})
        res = get_json("https://itunes.apple.com/search?" + q, 3.2)  # ~20 requests/minute allowed
        cands = []
        for it in (res or {}).get("results", []):
            sc = title_score(title, it.get("collectionName", "")) * artist_score(variants, it.get("artistName", ""))
            d = (it.get("releaseDate") or "")[:10] or None
            if sc > 0 and year_ok(d, year):
                cands.append((sc, it, d))
        if cands:
            sc, it, d = max(cands, key=lambda x: x[0])
            art = (it.get("artworkUrl100") or "").replace("100x100bb", "600x600bb") or None
            return {"art": art, "date": d, "src": "itunes", "match": f"{it['artistName']} – {it['collectionName']}"}
    return None


def musicbrainz(variants, title, year):
    esc = lambda s: s.replace("\\", "\\\\").replace('"', '\\"')
    for artist in variants:
        q = f'releasegroup:"{esc(title)}" AND artist:"{esc(artist)}"'
        res = get_json("https://musicbrainz.org/ws/2/release-group/?fmt=json&limit=10&query=" + urllib.parse.quote(q), 1.1)
        cands = []
        for it in (res or {}).get("release-groups", []):
            credit = "".join(c.get("name", "") + c.get("joinphrase", "") for c in it.get("artist-credit", []))
            sc = title_score(title, it.get("title", "")) * artist_score(variants, credit)
            d = it.get("first-release-date") or None
            if sc > 0 and year_ok(d, year):
                cands.append((sc, it, d, credit))
        if cands:
            sc, it, d, credit = max(cands, key=lambda x: x[0])
            art = None
            caa = get_json(f"https://coverartarchive.org/release-group/{it['id']}", 1.0)
            for img in (caa or {}).get("images", []):
                if img.get("front"):
                    th = img.get("thumbnails") or {}
                    art = th.get("500") or th.get("large") or img.get("image")
                    break
            return {"art": art, "date": d if d and len(d) >= 7 else None, "src": "musicbrainz", "match": f"{credit} – {it['title']}"}
    return None


def lookup(variants, title, year):
    out = {}
    for fn in (deezer, itunes, musicbrainz):
        try:
            r = fn(variants, title, year)
        except Exception as e:  # one bad response shouldn't stop the run
            print(f"    {fn.__name__} error: {e}")
            r = None
        if not r:
            continue
        if not out.get("art") and r.get("art"):
            out["art"] = r["art"]
        if not out.get("date") and r.get("date"):
            out["date"], out["src"] = r["date"], r["src"]
        out.setdefault("match", f"{r['src']}: {r['match']}")
        if out.get("art") and out.get("date"):
            break
    return out


# ---------- RYM-ID date estimates ----------
def estimate_dates(rows: list[dict], year: int, latest_by_id: dict[int, str]) -> None:
    def to_ord(d: str) -> int:
        y, m, dd = (d.split("-") + ["15", "15"])[:3]
        return date(int(y), int(m), int(dd)).toordinal()

    anchors = [(int(r["rym_id"]), to_ord(r["release_date"])) for r in rows
               if r.get("date_source") in REAL_SOURCES and r.get("release_date", "")[:4] == str(year)]
    if len(anchors) < 8:
        print(f"  only {len(anchors)} dated albums, skipping RYM-ID estimates")
        return
    pts = anchors
    for _ in range(3):  # fit, drop outliers (reissues, late RYM additions), refit
        n = len(pts)
        mx = sum(x for x, _ in pts) / n
        my = sum(y for _, y in pts) / n
        sxx = sum((x - mx) ** 2 for x, _ in pts) or 1
        b = sum((x - mx) * (y - my) for x, y in pts) / sxx
        a = my - b * mx
        resid = [abs(y - (a + b * x)) for x, y in pts]
        keep = [p for p, e in zip(pts, resid) if e <= 45]
        if len(keep) == len(pts) or len(keep) < 8:
            break
        pts = keep
    mae = sum(abs(y - (a + b * x)) for x, y in pts) / len(pts)
    print(f"  RYM-ID fit on {len(pts)} of {len(anchors)} dated albums: typical miss {mae:.0f} days")
    lo, hi = date(year, 1, 1).toordinal(), date(year, 12, 31).toordinal()
    for r in rows:
        if r.get("locked") or r.get("date_source") in REAL_SOURCES:
            continue
        est = round(a + b * int(r["rym_id"]))
        cap = hi
        if latest_by_id.get(int(r["rym_id"])):  # it was rated by then, so it was out by then
            cap = min(cap, date.fromisoformat(latest_by_id[int(r["rym_id"])]).toordinal())
        d = date.fromordinal(max(lo, min(cap, est)))
        r["release_date"], r["date_source"] = d.strftime("%Y-%m"), "estimate"


# ---------- main ----------
def enrich_year(year: int, rows_by_id: dict[int, dict], retry: bool) -> None:
    exports = export_paths()
    latest = read_export(exports[-1][1]) if exports else []
    albums = {r["rym_id"]: r for r in latest if r["year"] == year}
    first_ranked: dict[int, str] = {}
    for d, path in snapshot_paths(year):
        for r in read_csv(path):
            rid = int(r["rym_id"])
            first_ranked.setdefault(rid, d)
            albums.setdefault(rid, {"rym_id": rid, "artist": r["artist"], "artist_orig": r["artist"], "album": r["album"]})

    today = date.today()
    todo = []
    for rid, a in albums.items():
        row = rows_by_id.setdefault(rid, {"rym_id": rid})
        row["artist"], row["album"] = a["artist"], a["album"]
        if row.get("locked"):
            continue
        done = row.get("art_url") and row.get("date_source") in REAL_SOURCES
        recent = row.get("checked") and (today - date.fromisoformat(row["checked"])).days < RETRY_DAYS
        if done or (recent and not retry):
            continue
        todo.append(a)

    print(f"{year}: {len(albums)} releases, looking up {len(todo)}")
    found_art = found_date = 0
    for i, a in enumerate(todo, 1):
        variants = list(dict.fromkeys(v for v in (a["artist"], a.get("artist_orig")) if v))
        res = lookup(variants, a["album"], year)
        row = rows_by_id[a["rym_id"]]
        row["checked"] = today.isoformat()
        if res.get("art"):
            row["art_url"] = res["art"]
            found_art += 1
        if res.get("date"):
            row["release_date"], row["date_source"] = res["date"], res["src"]
            found_date += 1
        row["match"] = res.get("match", "")
        status = ("art " if res.get("art") else "") + ("date " if res.get("date") else "")
        print(f"  [{i}/{len(todo)}] {a['artist']} – {a['album']}: {status or 'no match'}{'  <- ' + res['match'] if res.get('match') else ''}")
    print(f"  found art for {found_art}, dates for {found_date} of {len(todo)} looked up")

    year_rows = [rows_by_id[rid] for rid in albums]
    estimate_dates(year_rows, year, first_ranked)
    have_art = sum(1 for r in year_rows if r.get("art_url"))
    real = sum(1 for r in year_rows if r.get("date_source") in REAL_SOURCES)
    est = sum(1 for r in year_rows if r.get("date_source") == "estimate")
    print(f"  {year} coverage: art {have_art}/{len(albums)}, real dates {real}, estimated {est}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("years", nargs="*", type=int)
    ap.add_argument("--retry", action="store_true", help="retry albums that found nothing recently")
    args = ap.parse_args()
    years = args.years or sorted(int(p.name) for p in RANKINGS.iterdir() if p.is_dir() and p.name.isdigit())
    rows_by_id = {int(r["rym_id"]): r for r in read_csv(META)}
    for y in years:
        enrich_year(y, rows_by_id, args.retry)
    rows = sorted(rows_by_id.values(), key=lambda r: (r.get("artist", "").lower(), r.get("album", "").lower()))
    write_csv(META, META_COLS, rows)


if __name__ == "__main__":
    main()
