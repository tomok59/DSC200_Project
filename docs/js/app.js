import { CrossFilter } from "./engine.js";
import { loadData, buildModel, crashRecord, GRID_BITS } from "./data.js";
import { BarList, Columns, Timeline, fmtNum, showTip, hideTip } from "./charts.js";
import { CrashMap } from "./map.js";
import { tooltipText, severityStyle, cssColor, SEVERITY_ORDER, SEVERITY_LABEL, POINT_ZOOM } from "./maphelpers.js";

const $ = (s) => document.querySelector(s);
const PERF = new URLSearchParams(location.search).has("perf");
const sharePct = (v, t) => { const p = 100 * v / t; return p === 0 ? "0%" : p < 0.1 ? "<0.1%" : p < 10 ? p.toFixed(1) + "%" : p.toFixed(0) + "%"; };

async function main() {
  const prog = $("#load-progress");
  const { meta, cols } = await loadData("data/", (f, bytes) => {
    prog.style.width = `${Math.round(f * 100)}%`;
    $("#load-text").textContent = `Loading ${(bytes / 1e6).toFixed(1)} MB of crash data…`;
  }, window.CRASH_DATA_FILE || "crashes.bin.gz");
  $("#load-text").textContent = `Preparing ${fmtNum(meta.n)} crashes…`;
  await new Promise((r) => setTimeout(r, 0));
  const model = buildModel(meta, cols);
  const cf = new CrossFilter({
    n: model.n, dims: model.dims.map((d) => ({ key: d.key, card: d.card, codes: d.codes })),
    measures: model.measures, cells: model.cells, gridCells: 1 << (2 * GRID_BITS), hotspotK: 10,
  });

  // ---------- charts ----------
  const charts = [];
  const changed = () => schedule();
  for (const d of model.dims) {
    const host = $(`#group-${d.group}`);
    const opts = {
      onToggle: (code) => { cf.toggle(d.key, code); changed(); },
      onClear: () => { cf.clear(d.key); changed(); },
    };
    let c;
    if (d.chart === "timeline") {
      c = new Timeline($("#timeline-host"), d, { ...opts,
        onRange: (a, b) => { cf.setFilter(d.key, Array.from({ length: b - a + 1 }, (_, i) => a + i)); changed(); } });
    } else if (d.chart === "columns") {
      c = new Columns(host, d, { ...opts,
        labelEvery: d.key === "hour" ? 3 : d.key === "speed" ? 1 : 1,
        axisLabels: d.key === "moy" ? d.labels.map((m) => m[0]) : null });
    } else if (d.chart === "list") {
      c = new BarList(host, d, { ...opts, searchable: true });
    } else {
      c = new BarList(host, d, { ...opts, sortByValue: !["damage", "severity", "ksiFlag", "intersection", "hitRun",
        "dooring", "workZone", "workers"].includes(d.key) });
    }
    charts.push(c);
  }

  // ---------- map ----------
  const mapTip = $("#map-tip");
  const map = new CrashMap($("#map"), model, {
    onAreaClick: (layer, name) => {
      const d = model.dimByKey[layer === "zip" ? "zip" : "neighborhood"];
      const code = d.raw.indexOf(name);
      if (code >= 0) { cf.toggle(d.key, code); changed(); }
    },
    onHover: (i, x, y) => {
      if (i < 0) { mapTip.style.display = "none"; return; }
      const r = crashRecord(model, i);
      mapTip.replaceChildren();
      const lines = tooltipText(r).split("\n");
      lines.forEach((line, k) => {
        const el = document.createElement(k === 0 ? "strong" : "div");
        el.textContent = line;
        if (k === 3) { el.style.color = cssColor(severityStyle(r.severity).color); }
        mapTip.appendChild(el);
      });
      const sub = document.createElement("div"); sub.className = "tip-sub";
      sub.textContent = `${r.neighborhood} · ${r.zip}`; mapTip.appendChild(sub);
      mapTip.style.display = "block";
      const w = mapTip.offsetWidth, h = mapTip.offsetHeight, W = $("#map").clientWidth;
      mapTip.style.transform = `translate(${Math.min(W - w - 8, x + 14)}px, ${y - h - 14 < 0 ? y + 16 : y - h - 14}px)`;
    },
    onModeChange: (mode, z) => {
      $("#zoom-read").textContent = `zoom ${z.toFixed(1)} · ${mode === "points" ? "individual crashes" : "crash density"}`;
      $("#legend-points").hidden = mode !== "points";
      $("#legend-density").hidden = mode !== "density";
    },
  });
  document.querySelectorAll("[name=layer-mode]").forEach((r) => r.addEventListener("change", (e) => map.setMode(e.target.value)));
  document.querySelectorAll("[name=boundary]").forEach((r) => r.addEventListener("change", (e) => { map.setBoundary(e.target.value); syncAreas(); }));
  $("#auto-label").textContent = `Auto (points at zoom ≥ ${POINT_ZOOM})`;

  // legend
  const lg = $("#legend-points");
  for (const s of SEVERITY_ORDER) {
    const st = severityStyle(s), item = document.createElement("span");
    const dot = document.createElement("i");
    dot.style.background = cssColor(st.color);
    dot.style.width = dot.style.height = `${Math.max(6, st.radius * 2)}px`;
    item.append(dot, document.createTextNode(SEVERITY_LABEL[s]));
    lg.appendChild(item);
  }

  function syncAreas() {
    const key = map.boundary === "zip" ? "zip" : "neighborhood";
    const sel = cf.selected(key);
    const d = model.dimByKey[key];
    map.highlightAreas(new Set(sel ? [...sel].map((c) => d.raw[c]) : []));
  }

  // ---------- hot spots ----------
  const hotList = $("#hotspots");
  const { LAT0, LAT1, LON0, LON1, Q } = model.bbox;
  const shift = 16 - GRID_BITS;
  function cellCenter(cell) {
    const qy = ((cell >> GRID_BITS) << shift) + (1 << (shift - 1)), qx = ((cell & ((1 << GRID_BITS) - 1)) << shift) + (1 << (shift - 1));
    return [LON0 + qx / Q * (LON1 - LON0), LAT0 + qy / Q * (LAT1 - LAT0)];
  }
  // label each hot spot by its most common block among the filtered crashes in that cell
  function hotspotLabels(res) {
    const want = new Map(res.hotspots.map((h) => [h.cell, new Map()]));
    const idx = cf.passIdx, cells = model.cells, blk = model.cols.block, st = model.cols.street;
    for (let j = 0; j < res.count; j++) {
      const i = idx[j], m = want.get(cells[i]);
      if (!m) continue;
      const key = blk[i] * 65536 + st[i];
      const e = m.get(key);
      if (e) e[0]++; else m.set(key, [1, i]);
    }
    return res.hotspots.map((h) => {
      let best = null;
      for (const e of want.get(h.cell).values()) if (!best || e[0] > best[0]) best = e;
      return best ? best[1] : h.rep;
    });
  }
  function renderHotspots(res) {
    hotList.replaceChildren();
    const reps = hotspotLabels(res);
    res.hotspots.forEach((h, k) => {
      const r = crashRecord(model, reps[k]);
      const li = document.createElement("li");
      const b = document.createElement("button"); b.type = "button";
      const rank = document.createElement("span"); rank.className = "rank"; rank.textContent = k + 1;
      const txt = document.createElement("span"); txt.className = "hs-text";
      const t1 = document.createElement("strong"); t1.textContent = `${r.block.replace(/^(\d+)/, "$1 block,")}`;
      const t2 = document.createElement("span"); t2.className = "muted"; t2.textContent = `${r.neighborhood} · ${r.zip}`;
      txt.append(t1, t2);
      const st = document.createElement("span"); st.className = "hs-stats";
      const s1 = document.createElement("b"); s1.textContent = fmtNum(h.ksi);
      const s1l = document.createElement("small"); s1l.textContent = "KSI";
      const s2 = document.createElement("span"); s2.textContent = `${fmtNum(h.count)} crash${h.count === 1 ? "" : "es"}`;
      st.append(s1, s1l, s2);
      b.append(rank, txt, st);
      b.title = "Zoom the map to this spot (about one block, 80 m)";
      b.addEventListener("click", () => { const [lon, lat] = cellCenter(h.cell); map.flyTo(lon, lat, 16.2); });
      li.appendChild(b);
      hotList.appendChild(li);
    });
    if (!res.hotspots.length) { const li = document.createElement("li"); li.className = "muted"; li.textContent = "No crashes match the filters."; hotList.appendChild(li); }
  }

  // ---------- filter chips + URL state ----------
  function renderChips() {
    const host = $("#chips");
    host.replaceChildren();
    let any = false;
    for (const d of model.dims) {
      const sel = cf.selected(d.key);
      if (!sel) continue;
      any = true;
      const chip = document.createElement("button"); chip.type = "button"; chip.className = "chip";
      const vals = [...sel].sort((a, b) => a - b);
      const shown = d.key === "month" && vals.length > 2 && vals[vals.length - 1] - vals[0] === vals.length - 1
        ? `${d.labels[vals[0]]} – ${d.labels[vals[vals.length - 1]]}`
        : vals.slice(0, 3).map((v) => d.labels[v]).join(", ") + (vals.length > 3 ? ` +${vals.length - 3}` : "");
      const k = document.createElement("span"); k.className = "chip-k"; k.textContent = d.label.replace(/ \(.*\)$/, "") + ":";
      const v = document.createElement("span"); v.textContent = " " + shown;
      const x = document.createElement("span"); x.className = "chip-x"; x.textContent = "×"; x.setAttribute("aria-hidden", "true");
      chip.append(k, v, x);
      chip.title = `Remove the ${d.label} filter`;
      chip.addEventListener("click", () => { cf.clear(d.key); changed(); });
      host.appendChild(chip);
    }
    $("#reset").hidden = !any;
    $("#no-filters").hidden = any;
  }
  function writeHash() {
    const parts = [];
    for (const d of model.dims) { const s = cf.selected(d.key); if (s) parts.push(`${d.key}=${[...s].sort((a, b) => a - b).join(",")}`); }
    const h = parts.length ? "#" + parts.join("&") : " ";
    history.replaceState(null, "", h === " " ? location.pathname + location.search : h);
  }
  function readHash() {
    const h = location.hash.slice(1);
    if (!h) return;
    for (const p of h.split("&")) {
      const [k, v] = p.split("=");
      const d = model.dimByKey[k];
      if (!d || !v) continue;
      const codes = v.split(",").map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x < d.card);
      if (codes.length) cf.setFilter(k, codes);
    }
  }
  $("#reset").addEventListener("click", () => { cf.clearAll(); changed(); });

  // ---------- update loop ----------
  const total = model.n;
  let pending = false, lastMs = 0;
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(update);
  }
  function update() {
    pending = false;
    const t0 = performance.now();
    const res = cf.compute();
    $("#kpi-crashes").textContent = fmtNum(res.count);
    $("#kpi-crashes-sub").textContent = res.count === total ? "all crashes, Jan 2021 – Apr 2026" : `${sharePct(res.count, total)} of ${fmtNum(total)}`;
    $("#kpi-ksi").textContent = fmtNum(res.ksi);
    $("#kpi-ksi-sub").textContent = res.count ? `${(1000 * res.ksi / res.count).toFixed(1)} per 1,000 crashes` : "–";
    $("#kpi-fatal").textContent = fmtNum(res.fatal);
    $("#kpi-inj").textContent = fmtNum(res.injuries);
    $("#kpi-inj-sub").textContent = res.count ? `${(100 * res.injuries / res.count).toFixed(1)} per 100 crashes` : "–";
    charts.forEach((c, i) => c.update(res.hist[model.dims[i].key], cf.selected(model.dims[i].key)));
    renderHotspots(res);
    renderChips();
    map.setMask(res.mask);
    syncAreas();
    writeHash();
    lastMs = performance.now() - t0;
    if (PERF) $("#perf-filter").textContent = `filter → all views: ${lastMs.toFixed(0)} ms`;
  }

  // ---------- methods panel ----------
  const rl = $("#rules-list");
  for (const r of meta.rules) {
    const li = document.createElement("li");
    const id = document.createElement("code"); id.textContent = r.id;
    const nm = document.createElement("strong"); nm.textContent = ` ${r.name.replaceAll("_", " ").toLowerCase()}`;
    const kd = document.createElement("span"); kd.className = "muted"; kd.textContent = ` · ${r.kind}` + (r.rows_dropped ? ` · ${fmtNum(r.rows_dropped)} rows dropped` : "");
    const tx = document.createElement("p"); tx.textContent = r.text;
    li.append(id, nm, kd, tx);
    rl.appendChild(li);
  }
  $("#m-in").textContent = fmtNum(meta.rows_in);
  $("#m-out").textContent = fmtNum(meta.rows_out);
  $("#m-drop").textContent = fmtNum(meta.rows_dropped);
  const dlg = $("#methods");
  $("#open-methods").addEventListener("click", () => dlg.showModal());
  $("#close-methods").addEventListener("click", () => dlg.close());

  readHash();
  $("#loader").remove();
  document.body.classList.add("ready");
  await map.init();
  update();
  window.addEventListener("hashchange", () => { cf.clearAll(); readHash(); schedule(); });

  if (PERF) {
    $("#perf").hidden = false;
    const frames = [];
    let prev = performance.now();
    const tick = (t) => {
      frames.push(t - prev); prev = t;
      if (frames.length > 60) frames.shift();
      const sorted = [...frames].sort((a, b) => a - b);
      $("#perf-frame").textContent = `map frame (median of 60): ${sorted[Math.floor(sorted.length / 2)].toFixed(1)} ms`;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  document.addEventListener("scroll", hideTip, { passive: true });
  void showTip;
}

main().catch((e) => {
  console.error(e);
  const t = document.querySelector("#load-text");
  if (t) t.textContent = "Could not load the data: " + e.message + ". If you opened index.html directly from disk, serve the folder instead (see README).";
});
