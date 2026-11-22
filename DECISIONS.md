# Decisions, added requirements and open questions

The spec (Process rule 13) asks for every filtering/cleaning decision that the spec doesn't specify, every added requirement, and any open questions. Numbers are from the run on `data/export.csv` (sha256 `26d7de11…`).

## Results at a glance

| | Rows |
|---|---:|
| Raw rows | 1,108,694 |
| **Kept** | **577,130** |
| Dropped, R01 date range | 524,644 |
| Dropped, R02 duplicate ID | 0 (no duplicate IDs in the file) |
| Dropped, R04 coordinates | 5,527 (5,485 missing, 42 zero, **0 outside the box**) |
| Dropped, R05 police notified > 30 days later | 960 |
| Dropped, R07 speed limit | 194 (155 not a multiple of 5, 39 over 55 mph) |
| Dropped, R14 outside Chicago polygons (added rule) | 239 |

**Bounding-box report (spec rule 3):** every crash whose coordinates are present and non-zero lies inside lat 41.64–42.03 / lon −87.95 to −87.52 (raw extremes: lat ≤ 42.0228, lon ≥ −87.9397). `output/out_of_bounds_points.csv` therefore has a header and no rows. The 75 raw rows with a zero coordinate are counted as "zero" (R04), not "outside the box".

Each dropped row's first failing rule is its `RULE_ID`. `ALL_FAILED_RULES` lists every rule it fails. Example: 3,228 rows fail both R01 and R04 and are listed with RULE_ID R01.

## Decisions not specified in the spec

### Data and boundaries
1. **"Neighborhoods" are the 77 community areas.** The spec describes 98 neighborhoods (`y6yq-dbs2`) but gives the URL of `igwz-8jzy`, which is the **77 Community Areas** file. That file is the one in `data/`. I used the file as provided and kept the column name `NEIGHBORHOOD`. All 77 areas appear in the output. *(See open question 1.)*
2. **Point-in-polygon** uses polygon exteriors minus holes (matplotlib's C routine). A point exactly on a shared edge goes to the alphabetically first area/ZIP, so runs are deterministic.
3. **Added rule R14:** 239 crashes lie inside the bounding box but in **no** community area **and** no ZIP polygon (suburbs such as Oak Park, Cicero, Evanston edges, Lincolnwood). Without a drop they would break "no missing values", so they are dropped and listed in the drop summary. No kept crash fell in one polygon set but not the other.

### Row filters
4. **Date range** = `2021-01-01 00:00:00` ≤ CRASH_DATE < `2026-05-01 00:00:00`, so all of April 2026 is included. An unparseable date would be dropped under R01. None occurred.
5. **Duplicates:** the first occurrence in file order is kept. The check runs on all rows, before the other filters. None found.
6. **Rule order** for the primary reason: R01 → R02 → R04 → R05 → R07 → R14.
7. **Zero coordinates** = latitude **or** longitude equal to 0.
8. **Late notification:** strictly more than 30 days (30 × 24 h). Exactly 30 days is kept. One crash was "notified" before it happened (negative delay). It is **kept**, because the rule only covers late notification. A missing notification date would not drop a row (none occurred). DATE_POLICE_NOTIFIED is used for R05 and then dropped (R03).
9. **Speed (rule 6):** "Bucket the speed from 0-10 mph" was read as: every value 0–10 becomes the single label `0-10` (17,942 kept rows). Other speeds stay as numbers (`15`…`55`), so the column is text. Values 11–55 that are not multiples of 5 are dropped, as are values > 55. 55 itself is kept. *(Open question 4.)*

### Values
10. **Y/N columns:** R06 applies to the five `*_I` columns that remain (INTERSECTION_RELATED_I, HIT_AND_RUN_I, DOORING_I, WORK_ZONE_I, WORKERS_PRESENT_I): `Y` → `YES`, `N` or blank → `NO`. This matches the R10 instructions for blanks.
11. **Injury counts** are written as integers (`1`, not `1.0`). 1,305 kept rows had **all** injury counts blank; they become 0 per R08.
12. **MOST_SEVERE_INJURY blank:** when the injury counts exist, the value is derived from them (4 rows: FATAL > INCAPACITATING > NONINCAPACITATING > REPORTED, NOT EVIDENT > NO INDICATION). When the counts were blank too (1,305 rows), the value is `UNKNOWN`, not "no injury", so that missing data isn't presented as "no injury".
13. **NUM_UNITS:** ≥ 4 → `4+` (8,682 rows). No 0 values exist.
14. **WORK_ZONE_TYPE:** blank → `NOT A WORK ZONE`, or `UNKNOWN` if WORK_ZONE_I = Y. After cleaning no kept row has WORK_ZONE_I = Y with a blank type, and no row has a type while WORK_ZONE_I = NO.
15. **BEAT_OF_OCCURRENCE** is written as an integer string (`811`, not `811.0`). No kept row had a blank beat.
16. **Other blanks (added rule R15):** 1 blank STREET_DIRECTION → `UNKNOWN`. Any other blank text cell would also become `UNKNOWN`.
17. **Formats (added rule R16):** CRASH_DATE is ISO `YYYY-MM-DD HH:MM:SS`. LATITUDE/LONGITUDE keep their original text (no float re-rounding). CRASH_HOUR, CRASH_DAY_OF_WEEK and CRASH_MONTH are kept from the source. I checked that they agree with CRASH_DATE on every kept row (0 mismatches).
18. **Row order:** sorted by CRASH_DATE then CRASH_RECORD_ID, so the output doesn't depend on chunk size or input order.
19. **Drop summary** keeps CRASH_DATE in its raw format, so a dropped row can be found in the raw file.

### Website data
20. Crash locations are stored quantized to ~0.7 m. The hover "block" is the street number rounded down to the hundred (`5500 S MERRIMAC AVE`), which is how Chicago describes crash locations and keeps the data small.
21. **Hot spots** are ~80 m grid cells ranked by KSI, then by crash count, for the filtered crashes. Each is labelled with its most common block.
22. Rows in the site file are in spatial (Morton) order, which compresses the download to 5.1 MB.

## Requirements I added

| ID | Added requirement | Why |
|---|---|---|
| AR-1 | Rule R14: drop crashes outside Chicago's community-area and ZIP polygons | needed for FR-1 / unit test 2 (no blank NEIGHBORHOOD/ZIPCODE) |
| AR-2 | Rules R15, R16 (other blanks → UNKNOWN; ISO dates; deterministic sort) | FR-1 and the "identical output twice" acceptance criterion |
| AR-3 | The filter state is kept in the URL, so a filtered view can be shared | usability for City staff and services |
| AR-4 | Map mode switch (Auto / Density / Points) and outline switch (community areas / ZIP / none); clicking an area filters by it | FR-3 threshold is strict (see Q2); the switch lets users choose |
| AR-5 | `?perf=1` overlay showing filter→views time and map frame time | makes NFR-3's 250 ms / 33 ms testable by hand (NFT-M2) |
| AR-6 | Fallback to a plain dark map if the basemap host is blocked. The density view is computed in the browser and drawn as a single image, not with deck.gl's HeatmapLayer, which didn't render the site's compact binary data | the site keeps working on restricted networks and on any GPU |
| AR-10 | Area outlines (community areas / ZIP codes) are drawn above the crash points and the density layer, with a dark halo; clicking inside an area still filters by it | outlines were hard to see under dense points (review feedback) |
| AR-7 | Accessibility: every bar is a keyboard-focusable button with `aria-pressed`; values are printed next to every bar (no colour-only meaning); reduced-motion support | usable by anyone |
| AR-8 | `export_manifest.json` records the input's SHA-256, per-rule counts and output hashes | traceability; acceptance test AT-01 |
| AR-9 | Browser support: a modern browser with WebGL and `DecompressionStream` (Chrome/Edge 80+, Firefox 113+, Safari 16.4+) | needed to render 577k points smoothly |

## Open questions

1. **Neighborhoods vs community areas.** Did you want the 98 neighborhoods (`y6yq-dbs2`) or the 77 community areas that were supplied? To switch, drop the 98-neighborhood GeoJSON into `data/`, point `neighborhoods_path` at it and re-run. The code reads `pri_neigh` automatically.
2. **Zoom 8.5 threshold (FR-3).** In web-map zoom levels, zoom 8.5 already shows the whole Chicago region, so "points at ≥ 8.5" means the city view shows points, not density. I implemented it exactly (Auto mode) and added a Density/Points switch. Was something like zoom 12–13 intended? It's one constant: `POINT_ZOOM` in `docs/js/maphelpers.js`, plus the matching test.
3. **GitHub file-size limits.** GitHub rejects files over 100 MB. The raw CSV (697 MB), cleaned CSV (272 MB) and drop summary (122 MB) can't be pushed as normal files, so `.gitignore` excludes them. Options: Git LFS, a GitHub Release attachment, or gzipping them (the cleaned CSV gzips to about 76 MB and the drop summary to about 48 MB, both under the limit). The website only needs `docs/` (6.5 MB).
4. **Speed bucket wording.** Should `0-10` be a single bucket (what I did)? Or did you want buckets for every speed (e.g. 0-10, 15-20, 25-30…)?
5. **Spec numbering.** There are two rules numbered 3, and the text refers to "rule 13" for neighborhoods (it's rule 11). The rule IDs R01–R16 replace these numbers. The mapping is in the `spec` field of each rule in `export_manifest.json`.
6. **650,000 vs 577,130 crashes.** The performance targets mention 650k crashes, but the cleaned data has 577,130. The tests use 650,000 synthetic rows, so the targets are met with headroom.
7. **Blank = "NO" for flags.** Per the spec, blank HIT_AND_RUN_I etc. become NO. In the source a blank often means "not recorded" rather than "no". Is that acceptable for the City's use?
8. **Reference hardware.** "Mid-range laptop" isn't defined. Measured so far: engine ≈ 7 ms median on 650k synthetic rows (Node), ≈ 40 ms click-to-all-views in headless Chrome for the real data. Map frame time needs the manual NFT-M2 test on your target machine.
9. **2026 is a partial year** (Jan–Apr). Year totals for 2026 look low. Should the Year chart flag this or show a monthly average instead?
10. **Data refresh.** The City updates the crash dataset daily. Should the site be rebuilt on a schedule (e.g. a GitHub Action that runs the pipeline weekly)?
11. **"Project update rubric".** The acceptance criteria mention it, but it wasn't provided. Please share it so I can check against it.
12. **Negative notification delay** (1 crash notified before it happened). It's kept. Should it be dropped as bad data?
