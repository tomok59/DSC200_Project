// Functional + performance tests for the website's filter engine (docs/js/engine.js).
// Written before the engine existed. Run:  node --test tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { CrossFilter } from "../docs/js/engine.js";

// ---- synthetic data with the same shape as the real site data --------------
const CARDS = { month: 64, moy: 12, dow: 7, hour: 24, neighborhood: 77, zip: 59, beat: 279,
  weather: 12, lighting: 6, surface: 7, defect: 7, alignment: 6, trafficway: 20, control: 19,
  device: 8, speed: 10, crashType: 18, cause1: 40, cause2: 40, damage: 3, units: 4,
  intersection: 2, hitRun: 2, dooring: 2, workZone: 2, workZoneType: 5, workers: 2,
  severity: 6, ksiFlag: 2, injuryBucket: 4 };
const KEYS = Object.keys(CARDS);
const GRID = 512 * 512;

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function makeData(n, seed = 1) {
  const r = rng(seed);
  const dims = KEYS.map((key) => {
    const card = CARDS[key];
    const codes = card > 255 ? new Uint16Array(n) : new Uint8Array(n);
    for (let i = 0; i < n; i++) codes[i] = Math.floor(Math.pow(r(), 2) * card); // skewed, like real data
    return { key, card, codes };
  });
  const ksi = new Uint8Array(n), fatal = new Uint8Array(n), injuries = new Uint8Array(n), cells = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    injuries[i] = r() < 0.15 ? 1 + Math.floor(r() * 3) : 0;
    fatal[i] = r() < 0.001 ? 1 : 0;
    ksi[i] = fatal[i] + (r() < 0.015 ? 1 : 0);
    cells[i] = Math.floor(r() * 4000) * 37; // concentrated, so hot spots exist
  }
  return { n, dims, measures: { ksi, fatal, injuries }, cells, gridCells: GRID };
}

function brute(data, filters, exceptKey = null) {
  const pass = new Uint8Array(data.n).fill(1);
  for (const d of data.dims) {
    const f = filters[d.key];
    if (!f || d.key === exceptKey) continue;
    for (let i = 0; i < data.n; i++) if (!f.has(d.codes[i])) pass[i] = 0;
  }
  return pass;
}
const sum = (a) => { let s = 0; for (const v of a) s += v; return s; };

const SMALL = makeData(20000, 7);

test("FT-02 every dimension filters correctly (single value)", () => {
  for (const d of SMALL.dims) {
    const cf = new CrossFilter(SMALL);
    cf.setFilter(d.key, [1]);
    const res = cf.compute();
    const expected = sum(brute(SMALL, { [d.key]: new Set([1]) }));
    assert.equal(res.count, expected, `dimension ${d.key}`);
  }
});

test("FT-03 OR within a dimension, AND across dimensions", () => {
  const cf = new CrossFilter(SMALL);
  const f = { weather: new Set([0, 2, 3]), hour: new Set([7, 8, 17]), neighborhood: new Set([0, 1, 5, 9]) };
  for (const [k, v] of Object.entries(f)) cf.setFilter(k, [...v]);
  assert.equal(cf.compute().count, sum(brute(SMALL, f)));
});

test("FT-04 clearing a filter and reset-all restore the full set", () => {
  const cf = new CrossFilter(SMALL);
  cf.setFilter("weather", [0]); cf.setFilter("dow", [1, 2]);
  cf.clear("weather");
  assert.equal(cf.compute().count, sum(brute(SMALL, { dow: new Set([1, 2]) })));
  cf.toggle("hour", 3); cf.toggle("hour", 3); // toggle on then off
  cf.clearAll();
  assert.equal(cf.compute().count, SMALL.n);
});

test("FT-08 map mask marks exactly the filtered crashes", () => {
  const cf = new CrossFilter(SMALL);
  const f = { lighting: new Set([1, 2]), crashType: new Set([0, 4]) };
  for (const [k, v] of Object.entries(f)) cf.setFilter(k, [...v]);
  const res = cf.compute();
  const exp = brute(SMALL, f);
  assert.equal(res.mask.length, SMALL.n);
  for (let i = 0; i < SMALL.n; i++) assert.equal(res.mask[i] > 0 ? 1 : 0, exp[i]);
});

test("FT-09 headline = map mask = every unfiltered chart = hot-spot grid total", () => {
  const cf = new CrossFilter(SMALL);
  cf.setFilter("surface", [0, 1]); cf.setFilter("month", [10, 11, 12, 13]);
  const res = cf.compute();
  assert.equal(sum(res.mask), res.count);
  for (const d of SMALL.dims) {
    if (d.key === "surface" || d.key === "month") continue;
    assert.equal(sum(res.hist[d.key]), res.count, `chart ${d.key}`);
  }
  assert.equal(res.gridTotal, res.count);
  // headline measures
  const pass = brute(SMALL, { surface: new Set([0, 1]), month: new Set([10, 11, 12, 13]) });
  let ksi = 0; for (let i = 0; i < SMALL.n; i++) if (pass[i]) ksi += SMALL.measures.ksi[i];
  assert.equal(res.ksi, ksi);
});

test("FT-10 a filtered dimension's own chart shows rows passing all OTHER filters", () => {
  const cf = new CrossFilter(SMALL);
  const f = { weather: new Set([0]), dow: new Set([2, 3]), zip: new Set([4, 5, 6]) };
  for (const [k, v] of Object.entries(f)) cf.setFilter(k, [...v]);
  const res = cf.compute();
  for (const key of Object.keys(f)) {
    const pass = brute(SMALL, f, key);
    const d = SMALL.dims.find((x) => x.key === key);
    const h = new Uint32Array(d.card);
    for (let i = 0; i < SMALL.n; i++) if (pass[i]) h[d.codes[i]]++;
    assert.deepEqual([...res.hist[key]], [...h], `own chart ${key}`);
    assert.ok(sum(h) >= res.count);
  }
});

test("FT-11 hot spots only count filtered crashes", () => {
  const cf = new CrossFilter(SMALL);
  const f = { cause1: new Set([0, 1, 2]) };
  cf.setFilter("cause1", [0, 1, 2]);
  const res = cf.compute();
  const pass = brute(SMALL, f);
  assert.ok(res.hotspots.length > 0);
  for (const h of res.hotspots) {
    let c = 0, k = 0;
    for (let i = 0; i < SMALL.n; i++) if (pass[i] && SMALL.cells[i] === h.cell) { c++; k += SMALL.measures.ksi[i]; }
    assert.equal(h.count, c);
    assert.equal(h.ksi, k);
    assert.equal(pass[h.rep], 1, "representative crash passes the filters");
  }
  // sorted by KSI, then crash count
  for (let j = 1; j < res.hotspots.length; j++) {
    const a = res.hotspots[j - 1], b = res.hotspots[j];
    assert.ok(a.ksi > b.ksi || (a.ksi === b.ksi && a.count >= b.count));
  }
});

// ---- non-functional ----------------------------------------------------------
test("NFT-01 / NFT-03 filter update on 650,000 crashes: median ≤ 250 ms (budget 500 ms, NFR-1 1 s)", () => {
  const BIG = makeData(650000, 3);
  const cf = new CrossFilter(BIG);
  cf.compute(); // warm-up
  const r = rng(99), times = [];
  for (let t = 0; t < 20; t++) {
    const d = BIG.dims[Math.floor(r() * BIG.dims.length)];
    const t0 = performance.now();
    if (r() < 0.25) cf.clear(d.key); else cf.toggle(d.key, Math.floor(r() * d.card));
    cf.compute();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const median = times[10], worst = times[19];
  console.log(`  650k rows: median ${median.toFixed(1)} ms, worst ${worst.toFixed(1)} ms`);
  assert.ok(median <= 250, `median ${median} ms`);
  assert.ok(worst <= 1000, `worst ${worst} ms`);
});
