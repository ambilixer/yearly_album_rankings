# Yearly album rankings

My running ranking of the year's best albums, tracked snapshot by snapshot from Rate Your Music exports, plus a dashboard to explore it.

**Dashboard:** published to GitHub Pages from `site/` on every push to `main`.

## How it works

1. Every few weeks I export my RYM collection and drop the CSV into `data/raw/rym/`, named by export date (`2026-10-31.csv`).
2. I rank every rated release from the year, highest first. That snapshot is saved as `data/rankings/<year>/<date>.csv`.
3. Genre and vibe tags live in `data/tags.csv`, one row per album, and carry over between snapshots.
4. `tools/build.py` joins everything into `site/data/<year>.json`, which the dashboard reads.

### The ranking rule

Rank always respects stars: nothing rated 3.5 can sit above anything rated 4.0. `build.py` refuses to build if any snapshot breaks this, has a duplicate album, or skips a rank number. GitHub Actions runs it on every push, so a bad snapshot never reaches the site.

## Data files

| File | Who writes it | Columns |
|---|---|---|
| `data/raw/rym/<date>.csv` | RYM export, never edited | RYM's own format. `Rating` is half-stars x2 (8 = 4.0 stars); 0 means unrated |
| `data/rankings/<year>/<date>.csv` | me | `rank, rym_id, stars, artist, album, note`. `artist`/`album` are for readability; `rym_id` is the key |
| `data/tags.csv` | me | `rym_id, artist, album, genre, artsy, aggressive, excitement` |
| `data/meta.csv` | enrichment (coming) | `rym_id, art_url, release_date, date_source` |

Tag conventions:

- `genre` is one free-text primary genre.
- `artsy` and `aggressive` are `X` or blank.
- `excitement` (unrated albums only) is `3` Must listen, `2` Somewhat hype, `1` Take or leave.

Everything is keyed on the RYM album ID. Year comes from the folder name, so other years slot in alongside 2026.

## Running it locally

```bash
python tools/build.py            # writes site/data/*.json
cd site && python -m http.server 8000
# open http://localhost:8000
```

No dependencies beyond Python 3.10+. The site vendors d3 (`site/vendor/`).

## Migration notes (2026)

The 2026 history came from a Google Sheet, migrated with `tools/migrate_xlsx.py`. Fixes applied there:

- **2026-08-17:** Ostraca's *Thread* had no RYM ID; filled in.
- **2026-10-07:** three rows (Kim Gordon, Feeble Little Horse, Coffret de Bijoux) were pasted twice, which pushed out YHWH Nailgun's *Magazine* and Tokyo Shoegazer's *Remains*. I dropped the duplicates and put the two missing albums back at the bottom of their star tier. They're marked in the `note` column, since their real positions that day are unknown.
- **Genres:** taken from the sheet's master tag list rather than each tab, so spelling drift between tabs (e.g. "experimental hip-hop") is gone.

## Roadmap

- [x] Migrate 2026 history
- [x] Dashboard
- [ ] Local ranking app: drop in a new export, auto-slot new albums into their star tier, drag to reorder, tag, save
- [ ] Enrichment: cover art and release dates (Deezer / iTunes / MusicBrainz), RYM-ID release-date estimates, optional RYM bookmarklet
- [ ] Backfill earlier years
