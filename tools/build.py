"""Build the dashboard's data file(s) from the repo's CSVs.

    python tools/build.py            # every year that has a rankings folder
    python tools/build.py 2026

Writes site/data/<year>.json and site/data/index.json (the list of years).
Fails loudly if any snapshot breaks the ranking rules.
"""
from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone

from rym import (EXCITEMENT, META, RANKINGS, ROOT, TAGS, export_paths, find_duplicates, manual_art, read_csv, read_export,
                 snapshot_paths, validate_snapshot)

OUT = ROOT / "site" / "data"
SPLIT = re.compile(r"\s*(?:,|&|/| x | and |\bfeat\.?|\bwith\b)\s*", re.I)


def artist_parts(name: str) -> set[str]:
    parts = {p.strip().lower() for p in SPLIT.split(name) if p.strip()}
    parts.add(name.strip().lower())
    return parts


def build_year(year: int) -> dict:
    snaps = snapshot_paths(year)
    if not snaps:
        raise SystemExit(f"no snapshots for {year}")
    exports = export_paths()
    tags = {int(t["rym_id"]): t for t in read_csv(TAGS)}

    albums: dict[int, dict] = {}

    def album(rid: int, artist: str = "", title: str = "") -> dict:
        a = albums.get(rid)
        if a is None:
            t = tags.get(rid, {})
            exc = t.get("excitement", "").strip()
            a = albums[rid] = {
                "id": rid,
                "artist": artist or t.get("artist", ""),
                "album": title or t.get("album", ""),
                "genre": t.get("genre", "").strip(),
                "artsy": bool(t.get("artsy", "").strip()),
                "aggressive": bool(t.get("aggressive", "").strip()),
                "excitement": int(exc) if exc.isdigit() else None,
                "ranks": {}, "stars": {}, "rym": {},
                "firstSeen": None,
            }
        return a

    # RYM rating history for this year's releases, plus the full catalog for artist affinity
    catalog: list[dict] = []
    for date, path in exports:
        rows = read_export(path)
        catalog = rows  # the last one wins
        for r in rows:
            if r["year"] != year:
                continue
            a = album(r["rym_id"], r["artist"], r["album"])
            a["artist"], a["album"] = r["artist"], r["album"]  # latest export's spelling
            a["rym"][date] = r["rating10"] / 2 if r["rating10"] else None
            a["firstSeen"] = a["firstSeen"] or date

    # ranking snapshots
    sizes = {}
    for date, path in snaps:
        rows = read_csv(path)
        problems = validate_snapshot(rows)
        if problems:
            raise SystemExit(f"{path.name}: {problems}")
        sizes[date] = len(rows)
        for r in rows:
            a = album(int(r["rym_id"]), r["artist"], r["album"])
            a["ranks"][date] = int(r["rank"])
            a["stars"][date] = float(r["stars"])

    # optional enrichment: cover art, release date (data/meta.csv)
    for m in read_csv(META):
        a = albums.get(int(m["rym_id"]))
        if a:
            if m.get("art_url"):
                a["art"] = m["art_url"]
            if m.get("release_date"):
                a["released"] = m["release_date"]
                a["releasedSource"] = m.get("date_source", "")
    for rid, url in manual_art().items():  # covers added by hand in the ranking app win
        if rid in albums:
            albums[rid]["art"] = url

    latest_snap = snaps[-1][0]
    latest_export = exports[-1][0] if exports else None

    # the same album listed twice on RYM: drop the unranked copy (see rym.find_duplicates)
    dupes = {}
    if latest_export:
        latest_rows = [r for r in catalog if r["year"] == year]
        latest_ranked = {int(r["rym_id"]) for r in read_csv(snaps[-1][1])}
        excitement = {rid: a["excitement"] for rid, a in albums.items() if a["excitement"]}
        dupes, _ = find_duplicates(latest_rows, latest_ranked, excitement)
        for rid in dupes:
            if not albums[rid]["ranks"]:
                del albums[rid]

    # artist affinity: your RYM ratings of the same artist's other releases (any year)
    by_artist = defaultdict(list)
    for r in catalog:
        if r["rating10"]:
            for p in artist_parts(r["artist"]):
                by_artist[p].append(r)

    unrated = []
    for a in albums.values():
        if latest_snap in a["ranks"] or a["id"] in dupes:
            continue
        if latest_export and latest_export in a["rym"] and a["rym"][latest_export] is None:
            prior = {}
            for p in artist_parts(a["artist"]):
                for r in by_artist.get(p, []):
                    if r["rym_id"] != a["id"]:
                        prior[r["rym_id"]] = r
            prior = sorted(prior.values(), key=lambda r: -r["rating10"])
            a["affinity"] = {
                "n": len(prior),
                "avg": round(sum(r["rating10"] for r in prior) / len(prior) / 2, 2) if prior else None,
                "best": [{"album": r["album"], "year": r["year"], "stars": r["rating10"] / 2} for r in prior[:3]],
            }
            a["wasRanked"] = bool(a["ranks"])
            unrated.append(a["id"])

    return {
        "year": year,
        "built": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "snapshots": [d for d, _ in snaps],
        "snapshotSizes": sizes,
        "exports": [d for d, _ in exports],
        "excitementLabels": {str(k): v for k, v in EXCITEMENT.items()},
        "albums": sorted(albums.values(), key=lambda a: (a["ranks"].get(latest_snap, 10**6), a["artist"].lower())),
        "unrated": unrated,
    }


def main(argv: list[str]) -> None:
    years = [int(y) for y in argv] or sorted(int(p.name) for p in RANKINGS.iterdir() if p.is_dir() and p.name.isdigit())
    OUT.mkdir(parents=True, exist_ok=True)
    for y in years:
        data = build_year(y)
        (OUT / f"{y}.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"{y}: {len(data['albums'])} albums, {len(data['snapshots'])} snapshots, {len(data['unrated'])} unrated")
    all_years = sorted(int(p.stem) for p in OUT.glob("[0-9][0-9][0-9][0-9].json"))
    (OUT / "index.json").write_text(json.dumps({"years": all_years}), encoding="utf-8")


if __name__ == "__main__":
    main(sys.argv[1:])
