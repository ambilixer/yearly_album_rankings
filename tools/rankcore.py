"""The logic behind the ranking app: turn a new RYM export plus the last ranking into a
proposed new ranking, and save a finished ranking back to the repo's CSVs."""
from __future__ import annotations

import re
from datetime import date

from rym import (DATE_RE, META, RANK_COLS, RANKINGS, RAW, TAG_COLS, TAGS, export_paths, read_csv,
                 read_export, snapshot_paths, validate_snapshot, write_csv)


def export_date(filename: str) -> str:
    m = DATE_RE.search(filename or "")
    return m.group(1) if m else date.today().isoformat()


def save_export(filename: str, content: bytes) -> str:
    """Store an uploaded RYM export as data/raw/rym/<date>.csv. Returns the date."""
    head = content[:400].decode("utf-8-sig", errors="replace")
    if "RYM Album" not in head:
        raise ValueError("That doesn't look like a Rate Your Music export (no 'RYM Album' column).")
    d = export_date(filename)
    RAW.mkdir(parents=True, exist_ok=True)
    (RAW / f"{d}.csv").write_bytes(content)
    return d


def propose(year: int, export_d: str | None = None) -> dict:
    """Build the draft for a new ranking.

    Stars come from the RYM export. Order within each star tier follows the last ranking.
    An album RYM now rates higher goes to the bottom of its new tier; one rated lower goes
    to the top of its new tier (it was better than everything there last time). New albums
    go to the bottom of their tier.
    """
    exports = dict(export_paths())
    if not exports:
        raise ValueError("No RYM exports yet.")
    export_d = export_d or max(exports)
    rows = read_export(exports[export_d])
    info = {r["rym_id"]: r for r in rows if r["year"] == year}
    rated = {rid: r["rating10"] / 2 for rid, r in info.items() if r["rating10"]}

    snaps = snapshot_paths(year)
    prev_date, prev = (snaps[-1][0], read_csv(snaps[-1][1])) if snaps else (None, [])
    prev_rank = {int(r["rym_id"]): int(r["rank"]) for r in prev}
    prev_stars = {int(r["rym_id"]): float(r["stars"]) for r in prev}
    prev_order = [int(r["rym_id"]) for r in prev]

    tiers: dict[float, dict[str, list[int]]] = {}
    for rid in prev_order:
        if rid not in rated:
            continue
        t = tiers.setdefault(rated[rid], {"down": [], "same": [], "up": [], "new": []})
        ps = prev_stars[rid]
        t["same" if ps == rated[rid] else ("down" if ps > rated[rid] else "up")].append(rid)
    for rid in sorted(set(rated) - set(prev_rank), key=lambda r: (info[r]["artist"].lower(), info[r]["album"].lower())):
        tiers.setdefault(rated[rid], {"down": [], "same": [], "up": [], "new": []})["new"].append(rid)

    order = [rid for st in sorted(tiers, reverse=True) for part in ("down", "same", "up", "new") for rid in tiers[st][part]]
    tags = {int(t["rym_id"]): t for t in read_csv(TAGS)}
    meta = {int(m["rym_id"]): m for m in read_csv(META)}

    def item(rid: int) -> dict:
        r, t, m = info.get(rid, {}), tags.get(rid, {}), meta.get(rid, {})
        return {
            "id": rid, "artist": r.get("artist", t.get("artist", "")), "album": r.get("album", t.get("album", "")),
            "rymStars": rated.get(rid), "prevRank": prev_rank.get(rid), "prevStars": prev_stars.get(rid),
            "genre": t.get("genre", ""), "artsy": bool(t.get("artsy", "").strip()), "aggressive": bool(t.get("aggressive", "").strip()),
            "excitement": int(t["excitement"]) if t.get("excitement", "").strip().isdigit() else None,
            "art": m.get("art_url", ""),
        }

    ranked = []
    for rid in order:
        it = item(rid)
        it["stars"] = rated[rid]
        ranked.append(it)
    queue = [item(rid) for rid in sorted(set(info) - set(rated), key=lambda r: (info[r]["artist"].lower(), info[r]["album"].lower()))]
    dropped = [{"id": rid, "artist": r["artist"], "album": r["album"]} for rid, r in
               ((rid, next((p for p in prev if int(p["rym_id"]) == rid), {})) for rid in prev_order if rid not in rated)]
    genres = sorted({t.get("genre", "").strip() for t in tags.values() if t.get("genre", "").strip()})
    existing = [d for d, _ in snaps]
    return {"year": year, "exportDate": export_d, "date": export_d, "prevDate": prev_date,
            "existingSnapshots": existing, "ranked": ranked, "queue": queue, "dropped": dropped, "genres": genres}


def save(year: int, snap_date: str, ranked: list[dict], queue: list[dict]) -> dict:
    """Write data/rankings/<year>/<date>.csv and update data/tags.csv."""
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", snap_date or ""):
        raise ValueError("The ranking date must look like 2026-11-04.")
    rows = [{"rank": i, "rym_id": int(a["id"]), "stars": f"{float(a['stars']):.1f}", "artist": a["artist"], "album": a["album"], "note": ""}
            for i, a in enumerate(ranked, 1)]
    problems = validate_snapshot(rows)
    if problems:
        raise ValueError("; ".join(problems))

    tags = {int(t["rym_id"]): t for t in read_csv(TAGS)}
    for a in list(ranked) + list(queue):
        t = tags.setdefault(int(a["id"]), {"rym_id": int(a["id"])})
        t["artist"], t["album"] = a["artist"], a["album"]
        if "genre" in a:
            t["genre"] = (a.get("genre") or "").strip().lower()
        if "artsy" in a:
            t["artsy"] = "X" if a.get("artsy") else ""
        if "aggressive" in a:
            t["aggressive"] = "X" if a.get("aggressive") else ""
        if "excitement" in a:
            t["excitement"] = str(a["excitement"]) if a.get("excitement") in (1, 2, 3) else ""
    out = sorted(tags.values(), key=lambda t: (t.get("artist", "").lower(), t.get("album", "").lower()))

    path = RANKINGS / str(year) / f"{snap_date}.csv"
    write_csv(path, RANK_COLS, rows)
    write_csv(TAGS, TAG_COLS, out)
    untagged = sum(1 for a in ranked if not (a.get("genre") or "").strip())
    return {"path": str(path.relative_to(path.parents[3])), "count": len(rows), "untagged": untagged}
