"""Shared helpers for reading RYM exports and the repo's data files."""
from __future__ import annotations

import csv
import html
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
RAW = DATA / "raw" / "rym"
RANKINGS = DATA / "rankings"
TAGS = DATA / "tags.csv"
META = DATA / "meta.csv"

DATE_RE = re.compile(r"(\d{4}-\d{2}-\d{2})")

RANK_COLS = ["rank", "rym_id", "stars", "artist", "album", "note"]
META_COLS = ["rym_id", "artist", "album", "art_url", "release_date", "date_source", "match", "checked", "locked"]
TAG_COLS = ["rym_id", "artist", "album", "genre", "artsy", "aggressive", "excitement"]
EXCITEMENT = {3: "Must listen", 2: "Somewhat hype", 1: "Take or leave"}


def clean(s) -> str:
    """Strip, decode HTML entities (RYM exports '&amp;'), collapse whitespace."""
    if s is None:
        return ""
    s = html.unescape(str(s)).strip()
    return re.sub(r"\s+", " ", s)


def artist_name(row: dict) -> str:
    """Same rule as the sheet's formula: localized name parts win when present."""
    first = clean(row.get("First Name localized")) or clean(row.get("First Name"))
    last = clean(row.get("Last Name localized")) or clean(row.get("Last Name"))
    return f"{first} {last}".strip()


def read_export(path: Path) -> list[dict]:
    """Read one RYM export. Header names are stripped (RYM pads some with spaces)
    and extra columns (e.g. Review) are tolerated."""
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        header = [h.strip() for h in next(reader)]
        out = []
        for raw in reader:
            if not raw:
                continue
            row = dict(zip(header, raw))
            try:
                rid = int(float(row["RYM Album"]))
            except (KeyError, ValueError):
                continue
            year = row.get("Release_Date", "").strip()
            out.append({
                "rym_id": rid,
                "artist": artist_name(row),
                # the name in its original script (e.g. 劣 for Lie), for metadata lookups
                "artist_orig": f"{clean(row.get('First Name'))} {clean(row.get('Last Name'))}".strip(),
                "album": clean(row.get("Title")),
                "year": int(float(year)) if year else None,
                "rating10": int(float(row.get("Rating") or 0)),  # RYM: 0 = unrated, else half-stars x2
            })
        return out


def export_paths() -> list[tuple[str, Path]]:
    """All raw exports as (YYYY-MM-DD, path), oldest first."""
    items = []
    for p in RAW.glob("*.csv"):
        m = DATE_RE.search(p.name)
        if m:
            items.append((m.group(1), p))
    return sorted(items)


def read_csv(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def write_csv(path: Path, cols: list[str], rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore", lineterminator="\n")
        w.writeheader()
        for r in rows:
            w.writerow({c: ("" if r.get(c) is None else r.get(c)) for c in cols})


def snapshot_paths(year: int | str) -> list[tuple[str, Path]]:
    d = RANKINGS / str(year)
    return sorted((DATE_RE.search(p.name).group(1), p) for p in d.glob("*.csv") if DATE_RE.search(p.name))


def validate_snapshot(rows: list[dict]) -> list[str]:
    """Problems with a ranking snapshot: duplicate IDs, gaps in ranks, tier violations."""
    problems = []
    ids = [r["rym_id"] for r in rows]
    dupes = {i for i in ids if ids.count(i) > 1}
    if dupes:
        problems.append(f"duplicate rym_id: {sorted(dupes)}")
    if any(not str(i).strip() for i in ids):
        problems.append("row(s) missing rym_id")
    ranks = [int(r["rank"]) for r in rows]
    if ranks != list(range(1, len(rows) + 1)):
        problems.append("ranks are not 1..N in order")
    for a, b in zip(rows, rows[1:]):
        if float(b["stars"]) > float(a["stars"]):
            problems.append(f"tier violation: #{b['rank']} {b['album']} ({b['stars']}) below #{a['rank']} ({a['stars']})")
    return problems
