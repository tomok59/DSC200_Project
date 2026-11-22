# System architecture

Three diagrams, written in Mermaid (GitHub renders them directly). PNG copies are in `design/`.

## 1. Use case diagram

```mermaid
flowchart LR
  analyst([Student / analyst])
  city([City of Chicago staff<br/>e.g. CDOT, Vision Zero])
  public([Public, advocates,<br/>emergency services])
  user([Website user])
  maint([Data maintainer])

  analyst -- is a --> user
  city -- is a --> user
  public -- is a --> user

  subgraph site["Chicago Crash Atlas (website)"]
    uc1(["View crash density / individual crashes"])
    uc2(["Filter by time, place, conditions, crash, severity"])
    uc5(["Read headline numbers: crashes · KSI · deaths · injuries"])
    uc3(["Inspect a crash on hover: date · type · cause · injuries · block"])
    uc4(["Find hot spots and zoom to them"])
    uc6(["Share a filtered view via the URL"])
    uc7(["Read data & methods (rules R01–R16)"])
  end

  subgraph pipe["Data pipeline (notebook + module)"]
    uc8(["Rebuild cleaned CSV, drop summary, site data"])
    uc9(["Run unit / functional / non-functional tests"])
  end

  user --- uc1 & uc2 & uc3 & uc4 & uc6 & uc7
  maint --- uc8 & uc9
  maint --- uc7
  uc2 -. «include» .-> uc5
  uc3 -. «extend» .-> uc1
```

## 2. Component diagram

```mermaid
flowchart TB
  subgraph inputs["Inputs (data/, read-only)"]
    raw[(export.csv<br/>1,108,694 crashes · 49 cols)]
    ca[(igwz-8jzy.geojson<br/>77 community areas)]
    zp[(unjd-c2ca.geojson<br/>59 ZIP codes)]
  end

  subgraph py["Pipeline (Python: pandas, numpy, matplotlib.path)"]
    nb["notebook/chicago_crash_cleaning.ipynb<br/>(Run all)"]
    mod["pipeline/crash_pipeline.py"]
    subgraph modparts[" "]
      rd["Chunked reader"]
      dr["Drop rules<br/>R01 R02 R04 R05 R07 R14"]
      geo["Point-in-polygon<br/>R12 R13"]
      vr["Value rules<br/>R03 R06 R08–R11 R15 R16"]
      wr["Writers + manifest"]
      ex["Site exporter<br/>(columnar, gzip)"]
    end
    tests["tests/*.py (unittest)"]
  end

  subgraph out["Outputs (output/)"]
    clean[(chicago_crashes_clean.csv<br/>577,130 × 42)]
    drops[(drop_summary.csv)]
    oob[(out_of_bounds_points.csv)]
    man[(export_manifest.json<br/>cleaning_report.md)]
  end

  subgraph web["Website (docs/, GitHub Pages)"]
    sdata[(data/crashes.bin.gz · meta.json<br/>neighborhoods / zipcodes.geojson<br/>6.5 MB)]
    app["app.js: controller"]
    data["data.js: loader + model"]
    eng["engine.js: CrossFilter<br/>(bitmask cross-filtering)"]
    charts["charts.js: bar lists,<br/>columns, timeline brush"]
    map["map.js + maphelpers.js"]
    jstests["tests/*.test.mjs (node --test)"]
  end

  cdn["CDN: MapLibre GL, deck.gl<br/>CARTO basemap tiles"]

  raw --> rd
  ca --> geo
  zp --> geo
  nb --> mod
  tests --> mod
  rd --> dr --> geo --> vr --> wr
  wr --> clean & drops & oob & man
  wr --> ex --> sdata
  sdata --> data --> app
  app --> eng
  app --> charts
  app --> map
  map --> cdn
  jstests --> eng
  jstests --> map
```

## 3. Sequence diagrams

### 3a. Loading the site

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant B as Browser (app.js)
  participant D as data.js
  participant GH as GitHub Pages
  participant E as engine.js
  participant M as map.js (MapLibre + deck.gl)
  U->>B: open the site
  B->>D: loadData("data/")
  D->>GH: GET meta.json
  D->>GH: GET crashes.bin.gz (5.1 MB, progress bar)
  D->>D: DecompressionStream("gzip") → typed arrays
  D-->>B: model (31 filter dimensions, positions, measures)
  B->>E: new CrossFilter(model)
  B->>B: build 31 charts, read filters from URL hash
  B->>M: init() (basemap, or plain fallback if blocked)
  B->>E: compute()
  E-->>B: counts, histograms, mask, hot spots
  B->>M: setMask(mask)
  M-->>U: density (zoom < 8.5) or points (zoom ≥ 8.5)
```

### 3b. Changing a filter (FR-2, FR-4, NFR-1/3)

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant C as Chart (e.g. Weather)
  participant A as app.js
  participant E as engine.js
  participant M as map.js
  U->>C: click "Rain"
  C->>A: onToggle(code)
  A->>E: toggle("weather", code)
  E->>E: update bit "weather" in every row's fail mask
  A->>A: requestAnimationFrame(update)
  A->>E: compute()
  Note over E: mask==0 → filtered set (KPIs, map, hot spots)<br/>(mask & ~bit_d)==0 → chart d (own filter ignored)
  E-->>A: {count, ksi, fatal, injuries, hist{31}, mask, hotspots}
  par all views from the same result
    A->>A: KPI tiles
    A->>C: update(hist, selection) for all 31 charts
    A->>A: hot-spot list + filter chips + URL hash
    A->>M: setMask(mask) → GPU attribute upload
  end
  M-->>U: map redraws (frame < 33 ms)
  Note over U,M: measured: ~40 ms from click to all views (577k crashes, headless Chrome)
```
