# Yearly album rankings

My running ranking of the year's best albums, tracked snapshot by snapshot from Rate Your Music exports, plus a dashboard to explore it.

**Dashboard:** published to GitHub Pages from `site/` on every push to `main`.

## How it works

1. Every few weeks I export my RYM collection and rank every rated release from the year, using the ranking app below.
2. Each ranking is saved as `data/rankings/<year>/<date>.csv`, and the export it came from as `data/raw/rym/<date>.csv`.
3. Genre and vibe tags (and excitement for the unrated queue) live in `data/tags.csv`, one row per album, and carry over between rankings.
4. The ranking app looks up cover art and release dates for new albums when you load an export. On every push, GitHub Actions runs the same lookup for anything still missing (`tools/enrich.py`, saved to `data/meta.csv`), then `tools/build.py` turns everything into `site/data/<year>.json` and publishes the dashboard.

## The ranking app

From the repo folder on your computer:

```bash
python tools/rank.py
```

It first pulls the latest from GitHub (fast-forward only, so it never touches unpublished work; if it can't, the app says why), then opens a page in your browser (http://localhost:8777). Then:

1. **Drop in the new RYM export.** The app keeps your last ranking's order within each star tier. Stars come from RYM. An album RYM now rates higher goes to the bottom of its new tier, one rated lower to the top of its new tier, and new albums go to the bottom of theirs.
2. **Rank and tag.** Drag (or use the arrows) to reorder within a tier. Change stars on any album; it moves tiers automatically. Fill in genre and the artsy/aggressive toggles. Rows show where each album was last time and flag stars that differ from last time or from RYM.
3. **Queue tab.** Set excitement for unrated albums, or give one stars to add it to the ranking.
4. **Cover art.** As soon as an export loads, the app looks up cover art and release dates for new albums on your computer (the same lookup GitHub runs, with progress shown in a banner; keep working while it runs). Albums it can't find get an **Add missing covers** button, which steps through them one by one. For each, drop or paste (Ctrl+V) an image, choose a file, or paste a link to the image or to the album's Bandcamp/SoundCloud page. Click any cover in the list to replace it. Covers are shrunk to 800px, saved to `site/art/<rym_id>.jpg` right away, and go up with the next publish.
5. **Save ranking**, check **Preview the dashboard**, then **Publish to GitHub** (commits and pushes `data/` and `site/art/`). The live site updates a couple of minutes later.

Work in progress is saved as you go, so you can close the tab and come back. No dependencies beyond Python 3.10+ and git.

### The ranking rule

Rank always respects stars: nothing rated 3.5 can sit above anything rated 4.0.

### Duplicates

RYM sometimes lists one album twice (same artist and title, two IDs). The app and the dashboard treat matching artist + title (ignoring case and spacing) as the same album:

- one copy rated, the other not: the unrated copy is dropped from the queue
- neither rated: one copy stays in the queue (the more hyped one, else the older RYM ID)
- both rated: both stay ranked, and the app warns you to unrate one on RYM

The raw exports and `data/tags.csv` are left as they are. `build.py` refuses to build if any snapshot breaks this, has a duplicate album, or skips a rank number. GitHub Actions runs it on every push, so a bad snapshot never reaches the site.

## Data files

| File | Who writes it | Columns |
|---|---|---|
| `data/raw/rym/<date>.csv` | RYM export, never edited | RYM's own format. `Rating` is half-stars x2 (8 = 4.0 stars); 0 means unrated |
| `data/rankings/<year>/<date>.csv` | me | `rank, rym_id, stars, artist, album, note`. `artist`/`album` are for readability; `rym_id` is the key |
| `data/tags.csv` | me | `rym_id, artist, album, genre, artsy, aggressive, excitement` |
| `site/art/<rym_id>.jpg` | the ranking app | Covers added by hand. They override `meta.csv`'s `art_url` |
| `data/meta.csv` | `tools/enrich.py` (the ranking app and CI) | `rym_id, artist, album, art_url, release_date, date_source, match, checked, locked`. Fix a wrong match by editing the row and setting `locked` to `X` |

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
- [x] Local ranking app
- [x] Cover art and release dates (Deezer / iTunes / MusicBrainz), with RYM-ID estimates for the rest
- [ ] Backfill earlier years
