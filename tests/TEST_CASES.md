# Test cases — Chicago Crash Visualization

These test cases were written **before** the pipeline and the website were built (spec: "You must create test cases before any other part of the system"). Each test is its own test function, so each passes or fails on its own.

How to run:

```bash
# Python (data + pipeline). Standard library unittest only, no pytest needed
python3 -m unittest discover -s tests -p "test_*.py" -v

# JavaScript (website logic). Node 18+ built-in test runner, no npm install needed
node --test tests/*.test.mjs
```

Tests that need the full cleaned output (`output/…`) skip with a message if the pipeline hasn't been run yet.

## Traceability

| Requirement | Test IDs |
|---|---|
| Unit 1: no missing entries | UT-01 |
| Unit 2: every row has ZIP + neighborhood | UT-02 |
| Unit 3: output header | UT-03 |
| Rules R01–R16 (each rule) | UT-10 … UT-34 |
| FR-1: cleaned CSV has no missing values | FT-01 (+UT-01) |
| FR-2: every filter is interactive and filters correctly | FT-02, FT-03, FT-04 |
| FR-3: map density / points / severity style / hover fields | FT-05, FT-06, FT-07, FT-08, FT-12, FT-13 |
| FR-4: all views describe the same filtered set; own-filter exclusion | FT-09, FT-10, FT-11 |
| NFR-1: visible update ≤ 1 s | NFT-01 (engine) + NFT-M1 (manual) |
| NFR-2: data download ≤ 10 MB | NFT-02 |
| NFR-3: filter update ≤ 250 ms at 650k; map frame ≤ 33 ms | NFT-03 (engine) + NFT-M2 (manual, in-site perf overlay) |
| NFR-4: reproducibility + rule IDs everywhere | NFT-04, NFT-05, NFT-06, NFT-07 |
| Performance budget: ≤ 500 ms | NFT-03 (stricter 250 ms bound covers it) |
| Acceptance: input not modified | AT-01 |
| Acceptance: two runs → identical output | AT-02 |
| Acceptance: no row breaks any rule | UT-10 … UT-34 on the real output |
| Acceptance: 42 columns (39 kept + 3 new) | UT-03 |

## Unit test cases (Python, `tests/test_rules_unit.py` on a synthetic fixture, `tests/test_output_data.py` on the real output)

| ID | Test | Expected |
|---|---|---|
| UT-01 | Every cell of the cleaned CSV is non-empty | 0 empty cells |
| UT-02 | Every row has a `NEIGHBORHOOD` from the boundary file and a `ZIPCODE` from the ZIP file | 100 % of rows |
| UT-03 | Header equals the 39 kept columns in original order + `KSI`, `NEIGHBORHOOD`, `ZIPCODE` | exactly 42 names, exact order |
| UT-10 | R01: crash on 12/31/2020 23:59 is dropped | in drop summary with R01 |
| UT-11 | R01: crash on 05/01/2026 00:00 is dropped | R01 |
| UT-12 | R01: boundary crashes 01/01/2021 00:00 and 04/30/2026 23:59 are kept | present in output |
| UT-13 | R02: second row with an existing `CRASH_RECORD_ID` is dropped, first kept | R02 for the 2nd copy only |
| UT-14 | R03: the 10 listed columns are absent | none in header |
| UT-15 | R04: missing coordinates dropped | R04 |
| UT-16 | R04: zero coordinates dropped | R04 |
| UT-17 | R04: point outside the bounding box dropped **and** listed in `out_of_bounds_points.csv` | R04 + listed |
| UT-18 | R05: police notified 31 days after crash dropped; exactly 30 days kept | R05 / kept |
| UT-19 | R06: `Y` → `YES`, `N` → `NO`, blank → `NO` for every `*_I` column | domain {YES, NO} |
| UT-20 | R07: speeds 0, 7, 10 → `0-10` | value `0-10` |
| UT-21 | R07: speeds 12 and 39 (>10, not multiple of 5) dropped | R07 |
| UT-22 | R07: speeds 60 and 99 (>55) dropped; 55 kept as `55` | R07 / kept |
| UT-23 | R08: missing injury counts become 0 | 0 |
| UT-24 | R09: NUM_UNITS 1,2,3,4,7 → `1`,`2`,`3`,`4+`,`4+` | bucketed |
| UT-25 | R10a: WORK_ZONE_I=Y and type blank → `UNKNOWN`; both blank → `NOT A WORK ZONE`; given type kept | as stated |
| UT-26 | R10f: blank beat → `UNKNOWN`; `811.0` → `811` | as stated |
| UT-27 | R11: KSI = INJURIES_FATAL + INJURIES_INCAPACITATING | equal on every row |
| UT-28 | R12/R13: Wrigley Field point → `LAKE VIEW`, ZIP `60613` | exact |
| UT-29 | R14: point inside the bounding box but outside Chicago (Oak Park) dropped | R14 |
| UT-30 | R15: blank STREET_DIRECTION → `UNKNOWN`; blank MOST_SEVERE_INJURY with blank counts → `UNKNOWN` | as stated |
| UT-31 | R16: CRASH_DATE written as ISO `YYYY-MM-DD HH:MM:SS`; count columns are integers | format |
| UT-32 | Drop summary has one row per dropped row and the header `CRASH_RECORD_ID,CRASH_DATE,RULE_ID,RULE_NAME,DETAIL,ALL_FAILED_RULES` | counts add up: kept + dropped = input |
| UT-33 | Every RULE_ID in the drop summary is a known rule ID | subset of R01…R16 |
| UT-34 | Real output: no row breaks R01, R02, R04, R06, R07, R09, R10, R11 (checked value-by-value) | 0 violations |

## Functional test cases (Node, `tests/engine.test.mjs`, `tests/map.test.mjs`)

| ID | Requirement | Test | Expected |
|---|---|---|---|
| FT-01 | FR-1 | Same as UT-01 on the real output | 0 empty cells |
| FT-02 | FR-2 | For **every** filter dimension, select one value; the filtered count equals a brute-force count | equal for every dimension |
| FT-03 | FR-2 | Selecting several values in one dimension is an OR; filters across dimensions are AND | equal to brute force |
| FT-04 | FR-2 | Clearing a filter (and "reset all") restores the full count | equals N |
| FT-05 | FR-3 | Layer mode is `density` below zoom 8.5 and `points` at zoom ≥ 8.5 (auto mode) | as stated |
| FT-06 | FR-3 | Point colour and radius increase with severity (no injury < … < fatal) | strictly ordered |
| FT-07 | FR-3 | Hover text contains date, crash type, primary cause, injuries and block | all 5 present |
| FT-08 | FR-3 | Map visibility mask marks exactly the filtered crashes | mask sum = filtered count |
| FT-09 | FR-4 | Headline count = map mask sum = sum of every un-filtered chart = sum of hot-spot grid | all equal |
| FT-10 | FR-4 | A filtered dimension's own chart equals the brute-force histogram of rows that pass every **other** filter | equal |
| FT-11 | FR-4 | Hot-spot list is computed from the filtered set only (no crash outside the filter contributes) | all hot-spot crashes pass filters |
| FT-12 | FR-3 | *(added after review)* Density image is coloured where filtered crashes are, transparent where crashes are filtered out or absent; north is up; empty filter → fully transparent | as stated |
| FT-13 | FR-3 / usability | *(added after review)* Layer order: clickable area fills → density or points → outline halo → outlines; outlines are not pickable so point hover still works; switching boundary keeps outlines on top | exact order |

## Non-functional test cases

| ID | Requirement | Test | Expected |
|---|---|---|---|
| NFT-01 | NFR-1 | Engine update on 650,000 synthetic crashes (`engine.test.mjs`) | < 1000 ms |
| NFT-02 | NFR-2 | Total size of `docs/data/*` (what the browser downloads) | ≤ 10 MB |
| NFT-03 | NFR-3 / budget | Median of 20 random filter changes on 650,000 synthetic crashes: set filter + recompute all aggregates | ≤ 250 ms |
| NFT-04 | NFR-4 | Notebook exists and mentions every rule ID | all IDs found |
| NFT-05 | NFR-4 | `export_manifest.json` lists every rule ID with its count | all IDs found |
| NFT-06 | NFR-4 | Site `meta.json` lists every rule ID (shown in the site's Methods panel) | all IDs found |
| NFT-07 | NFR-4 | The notebook's code imports the same pipeline used by the export (single source of truth) | `crash_pipeline` imported |
| NFT-M1 | NFR-1 | **Manual**: open site, click 10 filters; each visible update appears in < 1 s | pass/fail recorded |
| NFT-M2 | NFR-3 | **Manual**: open `index.html?perf=1`; overlay shows last filter time (ms) and map frame time (ms) while panning at zoom ≥ 8.5 | filter ≤ 250 ms, frame ≤ 33 ms |

## Acceptance test cases

| ID | Test | Expected |
|---|---|---|
| AT-01 | SHA-256 of the raw input is identical before and after a run | unchanged |
| AT-02 | Running the pipeline twice on the same input gives byte-identical cleaned CSV, drop summary and site data | identical hashes |
