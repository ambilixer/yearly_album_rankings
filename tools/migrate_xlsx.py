"""One-time migration of the old Google Sheet (exported as .xlsx) into the repo's CSV files.

    python tools/migrate_xlsx.py path/to/best_albums_2026.xlsx 2026

Reads every YYYY-MM-DD tab (hidden ones too) into data/rankings/<year>/<date>.csv and the
genre_vibe_ref tab into data/tags.csv. Applies the known fixes listed in FIXES and refuses
to write a snapshot that still fails validation.
"""
from __future__ import annotations

import sys

import openpyxl

from rym import DATE_RE, RANK_COLS, TAG_COLS, RANKINGS, TAGS, clean, export_paths, read_export, validate_snapshot, write_csv

# Known problems in the original sheet, found during migration (2026-11-04).
FIXES = {
    # Ostraca "Thread" was missing its rym_id on this tab.
    "2026-08-17": {"fill_ids": {("Ostraca", "Thread"): 17110617}},
    # Three rows were pasted twice, displacing two albums. Drop the second copies and
    # re-insert the missing albums at the bottom of their star tier (their exact
    # position that day is unknown).
    "2026-10-07": {
        "drop_dupes": True,
        "insert": [(16870982, 3.5), (17058309, 3.0)],  # Tokyo Shoegazer, YHWH Nailgun
    },
}


def main(xlsx: str, year: str) -> None:
    wb = openpyxl.load_workbook(xlsx, data_only=True)

    # canonical names: latest export wins
    names: dict[int, tuple[str, str]] = {}
    for _, p in export_paths():
        for r in read_export(p):
            names[r["rym_id"]] = (r["artist"], r["album"])

    for ws in wb.worksheets:
        if not DATE_RE.fullmatch(ws.title):
            continue
        date, fix = ws.title, FIXES.get(ws.title, {})
        rows = []
        for v in ws.iter_rows(min_row=2, values_only=True):
            rid, rank, artist, album, stars = v[:5]
            if rank is None:
                continue
            artist, album = clean(artist), clean(album)
            if rid is None:
                rid = fix.get("fill_ids", {}).get((artist, album))
            rid = int(rid)
            artist, album = names.get(rid, (artist, album))
            rows.append({"rank": int(rank), "rym_id": rid, "stars": float(stars), "artist": artist, "album": album, "note": ""})

        if fix.get("drop_dupes"):
            seen, kept = set(), []
            for r in rows:
                if r["rym_id"] not in seen:
                    seen.add(r["rym_id"])
                    kept.append(r)
            rows = kept
        for rid, stars in fix.get("insert", []):
            artist, album = names[rid]
            pos = max(i for i, r in enumerate(rows) if r["stars"] >= stars) + 1
            rows.insert(pos, {"rym_id": rid, "stars": stars, "artist": artist, "album": album,
                              "note": "reconstructed: missing from original tab, placed at bottom of tier"})
        for i, r in enumerate(rows, 1):
            r["rank"] = i
            r["stars"] = f"{r['stars']:.1f}"

        problems = validate_snapshot(rows)
        if problems:
            sys.exit(f"{date}: {problems}")
        write_csv(RANKINGS / year / f"{date}.csv", RANK_COLS, rows)
        print(f"{date}: {len(rows)} ranked")

    # tags
    tags = []
    for v in wb["genre_vibe_ref"].iter_rows(min_row=2, values_only=True):
        if not v[0]:
            continue
        rid = int(v[0])
        artist, album = names.get(rid, (clean(v[1]), clean(v[2])))
        tags.append({"rym_id": rid, "artist": artist, "album": album, "genre": clean(v[3]).lower(),
                     "artsy": "X" if clean(v[4]) else "", "aggressive": "X" if clean(v[5]) else "", "excitement": ""})
    have = {t["rym_id"] for t in tags}
    # add a blank row for every other release from this year in the latest export, so the
    # unrated queue can be tagged (excitement) by hand
    latest = read_export(export_paths()[-1][1])
    for r in latest:
        if r["year"] == int(year) and r["rym_id"] not in have:
            tags.append({"rym_id": r["rym_id"], "artist": r["artist"], "album": r["album"]})
            have.add(r["rym_id"])
    tags.sort(key=lambda t: (t["artist"].lower(), t["album"].lower()))
    write_csv(TAGS, TAG_COLS, tags)
    print(f"tags.csv: {len(tags)} rows")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "2026")
