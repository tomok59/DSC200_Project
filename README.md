# Chicago Crash Atlas

[Interactive map](https://tomok59.github.io/DSC200_Project/) and cross-filtering dashboard for **577,130 Chicago traffic crashes (January 2021 – April 2026)**, built from the City of Chicago's *Traffic Crashes – Crashes* dataset, plus the pipeline that cleans it.

| Deliverable | Where |
|---|---|
| Cleaned CSV (42 columns: 39 kept + `KSI`, `NEIGHBORHOOD`, `ZIPCODE`) | `output/chicago_crashes_clean.csv` |
| Drop summary (every dropped row + rule ID) | `output/drop_summary.csv` |
| Points outside the Chicago bounding box | `output/out_of_bounds_points.csv` (empty: none found) |
| Per-rule counts, hashes | `output/export_manifest.json`, `output/cleaning_report.md` |
| Website (GitHub Pages) | `docs/` |
| Notebook ("Run all" rebuilds everything) | `notebook/chicago_crash_cleaning.ipynb` |
| Test cases (written first) + tests | `tests/TEST_CASES.md`, `tests/` |
| Architecture: use case, component, sequence diagrams | `design/ARCHITECTURE.md` (+ PNGs) |
| Decisions, added requirements, open questions | `DECISIONS.md` |

## Rebuild the data

Requirements: Python 3.9+ with `pandas`, `numpy`, `matplotlib`. About 1.5 GB RAM; takes ~1 minute.

```bash
python3 pipeline/crash_pipeline.py      # or open the notebook and "Run all"
```

The raw file `data/export.csv` is only read, never modified. Running twice gives byte-identical outputs (test AT-02).

## Run the tests

```bash
python3 -m unittest discover -s tests -p "test_*.py" -v   # data, rules, acceptance, size
node --test tests/*.test.mjs                              # filter engine, map rules, performance
```

## View the website locally

The site loads data with `fetch`, so it must be served over HTTP. Opening `index.html` from disk won't work:

```bash
cd docs && python3 -m http.server 8000
# open http://localhost:8000          (add ?perf=1 for the performance overlay)
```

## Publish on GitHub Pages

1. Create a GitHub repository and push this folder. `.gitignore` already excludes the large CSVs, which exceed GitHub's 100 MB file limit (see `DECISIONS.md`, open question 3).
2. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / folder `/docs`** → Save.
3. After a minute the site is live at `https://<your-user>.github.io/<repo>/`.

The site needs no build step. MapLibre GL and deck.gl load from unpkg, and the basemap comes from CARTO.

## How the website works

* `docs/data/crashes.bin.gz` holds the 577k crashes as a 5.1 MB column-wise binary (one code per category per crash). It is decompressed in the browser.
* `docs/js/engine.js` handles filtering. Every crash keeps a 32-bit mask of the filters it fails. A filter change flips one bit per crash, and one pass recomputes the headline numbers, all 31 charts, the hot-spot grid and the map's visibility mask. A filtered field's own chart ignores its own filter, so the other values stay visible and clickable (FR-4).
* The map draws a GPU heatmap below zoom 8.5 and individual crashes at zoom 8.5 or closer, coloured and sized by severity, with a hover card (FR-3).

## Cleaning rules

| ID | Rule |
|---|---|
| R01 | Keep crashes 2021-01-01 → 2026-04-30 |
| R02 | Drop duplicate `CRASH_RECORD_ID` |
| R03 | Drop 10 columns |
| R04 | Drop missing / zero / out-of-box coordinates (list out-of-box) |
| R05 | Drop if police notified > 30 days after the crash |
| R06 | `*_I` columns → YES / NO |
| R07 | Speed 0–10 → `0-10`; drop >10 and not a multiple of 5; drop > 55 |
| R08 | Missing injury counts → 0 |
| R09 | NUM_UNITS → 1, 2, 3, 4+ |
| R10 | Missing work-zone type / flags / beat |
| R11 | `KSI` = fatal + incapacitating injuries |
| R12 | `NEIGHBORHOOD` from community-area polygons |
| R13 | `ZIPCODE` from ZIP polygons |
| R14 | *(added)* Drop points outside all Chicago polygons |
| R15 | *(added)* Other blanks → UNKNOWN |
| R16 | *(added)* ISO dates, integer beat, deterministic order |

Data: City of Chicago Data Portal. Basemap © CARTO, © OpenStreetMap contributors.
