# Worklog

## Where things stand (Nov 4, 2026)

**Live:** https://ambilixer.github.io/yearly_album_rankings/ (rebuilds on every push to `main`).

- **Data:** 8 rankings for 2026 (Jul 25 through Nov 4), migrated from the Google Sheet plus the first update made with the ranking app. The latest has 73 albums ranked, 49 in the queue (all tagged with excitement), and every ranked album has a genre.
- **Dashboard sections:**
  - #1 album and headline stats
  - Top 10 (rank sparklines, badges, full badge key)
  - Top 25 grid (rows of 3/4/5/6/7, sized by rank)
  - Ranking trends (bump chart)
  - Full ranking (tiers, artsy/aggressive filter pills)
  - Queue
- **Cover art and release dates:** looked up in GitHub Actions on every push (`tools/enrich.py` → `data/meta.csv`). 106 of 122 albums have art. Dates come from Deezer/iTunes/MusicBrainz, or are estimated from the RYM ID, shown with "~" (typical miss about 4 weeks).
- **Ranking app:** `python tools/rank.py` from the local clone. Import export → reorder/re-star/tag → Save → Publish. Already used once, for the Nov 4 update.

## Nov 10, 2026

- **Duplicates:** same artist + title on RYM is treated as one album (rule in `rym.find_duplicates`, used by the app, saved drafts and `build.py`). Only case so far: @ – *Autosmile* (17140166 ranked, 17141935 dropped from the queue).
- **Cover art in the app:** banner + "Add missing covers" walkthrough for albums the lookup couldn't find; any cover is clickable to replace. Accepts drop, paste, file, or a link (image or Bandcamp/SoundCloud page, via og:image). Saved as `site/art/<rym_id>.jpg` (max 800px), which overrides `meta.csv`. Kept out of `meta.csv` on purpose so publishes don't conflict with CI's meta commits.

## Nov 11, 2026

- **Lookups run in the app now.** Loading an export looks up art and dates for new albums on Charlie's computer (`enrich.look_up_one`, one album per request so the banner shows progress). It also redoes the RYM-ID date estimates, so GitHub's run after a publish normally changes nothing and makes no extra commit. If the lookup sites can't be reached, those albums are left for GitHub and stay retryable.
- **Auto-pull on start:** `rank.py` runs `git pull --ff-only` before opening (skip with `--no-pull`). It never merges; if it can't, the app shows why.
- **Fix:** editing a genre then clicking a summary button no longer swallows the click (genre edits refresh only the counter chips).

## Decisions to remember

- **Rank respects stars.** No lower-rated album above a higher-rated one. `build.py` blocks deploys that break this.
- **Stars in a ranking are Charlie's** and can differ from RYM. The app defaults to RYM's stars and flags any difference.
- **▲/▼ badges count real moves only:** albums passed among those already on the list (new arrivals don't count). They show only for moves of more than 5 places.
- **Remaining badges:** New and Hot debut. Surging, Slipping, Staple and Back were dropped as confusing.
- **Removed sections:** Vibe map, Movers, New entries, Re-ratings and Genre mix (genre mix isn't meaningful without genre families).
- **Colors:** Artsy is teal and Aggressive is amber, so they don't clash with the blue/red used for moves. Hot debut is pink.
- **Commit email:** commits to the repo must use the no-reply address `76854138+ambilixer@users.noreply.github.com`. GitHub's email privacy setting blocks the Gmail address.

## Next up

1. **Mobile pass.** Charlie reviews the site on a phone and sends feedback.
2. **Fix covers and dates by hand.** Covers: use the app's "Add missing covers" (15 still missing as of Nov 10). Dates: in `data/meta.csv`, paste `release_date` and set `locked` = `X`.
   - Friko's date may be from an "Expanded Edition" reissue.
   - icewings and Liam Aldous are dated Jan 1, which may be a placeholder.
3. **Stars default in the app.** If re-rating mostly happens while ranking rather than on RYM, switch the default to the last ranking's stars.
4. **Data oddities to check on RYM:**
   - username & Marsh crane's *Overtime* lost its RYM rating after Sep 17.
   - iD-sus's *Gri Gri* was ranked in the sheet but unrated on RYM as of Oct 31.
5. **Backfill earlier years.** The structure is year-agnostic: add `data/rankings/<year>/` files and the matching exports.
6. **Parked ideas:**
   - genre families (to bring back a genre view)
   - RYM bookmarklet for community averages
   - Last.fm listener counts as an "obscurity" axis

## Picking up

- Repo: `ambilixer/yearly_album_rankings`. See README.md for data formats and the app walkthrough.
- Local preview: `python tools/build.py`, then `cd site && python -m http.server`.
- Force a retry of failed art/date lookups: Actions tab → "Build and deploy dashboard" → Run workflow → tick retry.
