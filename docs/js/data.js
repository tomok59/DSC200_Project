// Loads docs/data/meta.json + crashes.bin.gz and builds the in-memory model.
import { SEVERITY_LABEL } from "./maphelpers.js";

export const GRID_BITS = 9;            // hot-spot grid = 512 x 512 cells (~80 m)
export const GRID_SIZE = 1 << GRID_BITS;

export async function loadData(base, onProgress = () => {}, file = "crashes.bin.gz") {
  const meta = await (await fetch(base + "meta.json")).json();
  const res = await fetch(base + file);
  if (!res.ok) throw new Error(`could not load crash data (${res.status})`);
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress(total ? got / total : 0, got);
  }
  let raw = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { raw.set(c, o); o += c.length; }
  if (file.endsWith(".b64.txt")) { // preview hosts that cannot serve binary files
    const bin = atob(new TextDecoder().decode(raw).trim());
    raw = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i);
  }
  // GitHub Pages serves .gz as a plain file -> decompress here. If a server already
  // decoded it (Content-Encoding: gzip) the gzip magic bytes are gone and we use it as is.
  if (raw[0] === 0x1f && raw[1] === 0x8b) {
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("gzip"));
    raw = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const n = meta.n, cols = {};
  let off = 0;
  for (const c of meta.columns) {
    if (c.bytes === 1) {
      cols[c.key] = raw.subarray(off, off + n);
      off += n;
    } else {
      const lo = raw.subarray(off, off + n), hi = raw.subarray(off + n, off + 2 * n), a = new Uint16Array(n);
      for (let i = 0; i < n; i++) a[i] = lo[i] | (hi[i] << 8);
      cols[c.key] = a;
      off += 2 * n;
    }
  }
  if (off !== raw.length) throw new Error("crash data does not match meta.json");
  return { meta, cols };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const KEEP_UPPER = new Set(["ZIP", "W/MEDIAN", "RR", "DVD", "ETC.)", "II", "I", "L", "T", "Y", "N", "S", "E", "W"]);

const SPECIAL = { MCKINLEY: "McKinley", OHARE: "O'Hare" };
export function pretty(s) {
  if (/^\d|^\$/.test(s)) return s;
  if (SPECIAL[s.split(" ")[0]]) return s.split(" ").map((w) => SPECIAL[w] || w.charAt(0) + w.slice(1).toLowerCase()).join(" ");
  return s.split(" ").map((w) => (KEEP_UPPER.has(w) ? w : w.charAt(0) + w.slice(1).toLowerCase())).join(" ");
}

// group, chart type and display label of every filter dimension (31 of 32 possible)
export const DIM_SPECS = [
  { key: "month", group: "time", chart: "timeline", label: "Crashes per month" },
  { key: "year", group: "time", chart: "columns", label: "Year" },
  { key: "moy", group: "time", chart: "columns", label: "Month of year" },
  { key: "dow", group: "time", chart: "columns", label: "Day of week" },
  { key: "hour", group: "time", chart: "columns", label: "Hour of day" },
  { key: "neighborhood", group: "place", chart: "list", label: "Neighborhood (community area)" },
  { key: "zip", group: "place", chart: "list", label: "ZIP code" },
  { key: "beat", group: "place", chart: "list", label: "Police beat" },
  { key: "weather", group: "conditions", chart: "bars", label: "Weather" },
  { key: "lighting", group: "conditions", chart: "bars", label: "Lighting" },
  { key: "surface", group: "conditions", chart: "bars", label: "Road surface" },
  { key: "speed", group: "conditions", chart: "columns", label: "Posted speed limit (mph)" },
  { key: "trafficway", group: "conditions", chart: "bars", label: "Trafficway type" },
  { key: "control", group: "conditions", chart: "bars", label: "Traffic control device" },
  { key: "device", group: "conditions", chart: "bars", label: "Control device condition" },
  { key: "defect", group: "conditions", chart: "bars", label: "Road defect" },
  { key: "alignment", group: "conditions", chart: "bars", label: "Road alignment" },
  { key: "crashType", group: "crash", chart: "bars", label: "First crash type" },
  { key: "cause1", group: "crash", chart: "list", label: "Primary contributory cause" },
  { key: "cause2", group: "crash", chart: "list", label: "Secondary contributory cause" },
  { key: "damage", group: "crash", chart: "bars", label: "Damage" },
  { key: "units", group: "crash", chart: "columns", label: "Units involved" },
  { key: "intersection", group: "crash", chart: "bars", label: "Intersection related" },
  { key: "hitRun", group: "crash", chart: "bars", label: "Hit and run" },
  { key: "dooring", group: "crash", chart: "bars", label: "Dooring" },
  { key: "workZone", group: "crash", chart: "bars", label: "Work zone" },
  { key: "workZoneType", group: "crash", chart: "bars", label: "Work zone type" },
  { key: "workers", group: "crash", chart: "bars", label: "Workers present" },
  { key: "severity", group: "severity", chart: "bars", label: "Most severe injury" },
  { key: "ksiFlag", group: "severity", chart: "bars", label: "Killed or seriously injured (KSI)" },
  { key: "injuryBucket", group: "severity", chart: "columns", label: "People injured" },
];

export function buildModel(meta, cols) {
  const n = meta.n;
  const [LAT0, LAT1, LON0, LON1] = meta.bbox;
  const Q = meta.quant;
  const colMeta = Object.fromEntries(meta.columns.map((c) => [c.key, c]));

  // per-day lookup tables for the derived time dimensions
  const day0 = Date.parse(meta.day0 + "T00:00:00Z");
  const days = meta.days;
  const dMonth = new Uint8Array(days), dYear = new Uint8Array(days), dMoy = new Uint8Array(days),
    dDow = new Uint8Array(days), dIso = new Array(days);
  let maxMonth = 0;
  for (let d = 0; d < days; d++) {
    const t = new Date(day0 + d * 86400000);
    const y = t.getUTCFullYear() - 2021, m = t.getUTCMonth();
    dMonth[d] = y * 12 + m; dYear[d] = y; dMoy[d] = m; dDow[d] = t.getUTCDay();
    dIso[d] = t.toISOString().slice(0, 10);
    if (dMonth[d] > maxMonth) maxMonth = dMonth[d];
  }
  const nMonths = maxMonth + 1, nYears = Math.floor(maxMonth / 12) + 1;

  const day = cols.day, tod = cols.tod, fatal = cols.fatal, incap = cols.incap, injuries = cols.injuries;
  const month = new Uint8Array(n), year = new Uint8Array(n), moy = new Uint8Array(n), dow = new Uint8Array(n),
    hour = new Uint8Array(n), ksi = new Uint8Array(n), ksiFlag = new Uint8Array(n), injuryBucket = new Uint8Array(n),
    cells = new Uint32Array(n), positions = new Float32Array(2 * n);
  const qlat = cols.qlat, qlon = cols.qlon, sLat = (LAT1 - LAT0) / Q, sLon = (LON1 - LON0) / Q,
    shift = 16 - GRID_BITS;
  for (let i = 0; i < n; i++) {
    const d = day[i];
    month[i] = dMonth[d]; year[i] = dYear[d]; moy[i] = dMoy[d]; dow[i] = dDow[d];
    hour[i] = (tod[i] / 60) | 0;
    const k = Math.min(255, fatal[i] + incap[i]);
    ksi[i] = k; ksiFlag[i] = k > 0 ? 0 : 1;
    injuryBucket[i] = Math.min(3, injuries[i]);
    cells[i] = ((qlat[i] >> shift) << GRID_BITS) | (qlon[i] >> shift);
    positions[2 * i] = LON0 + qlon[i] * sLon;
    positions[2 * i + 1] = LAT0 + qlat[i] * sLat;
  }

  const monthLabels = Array.from({ length: nMonths }, (_, m) => `${MONTHS[m % 12]} ${2021 + Math.floor(m / 12)}`);
  const derived = {
    month: { codes: month, labels: monthLabels },
    year: { codes: year, labels: Array.from({ length: nYears }, (_, y) => String(2021 + y)) },
    moy: { codes: moy, labels: MONTHS },
    dow: { codes: dow, labels: DOW },
    hour: { codes: hour, labels: Array.from({ length: 24 }, (_, h) => String(h)) },
    ksiFlag: { codes: ksiFlag, labels: ["KSI crash", "No KSI"] },
    injuryBucket: { codes: injuryBucket, labels: ["0", "1", "2", "3+"] },
  };

  const dims = DIM_SPECS.map((s) => {
    if (derived[s.key]) {
      const { codes, labels } = derived[s.key];
      return { ...s, codes, labels, raw: labels, card: labels.length };
    }
    const cm = colMeta[s.key];
    const raw = cm.values;
    const labels = raw.map((v) => (s.key === "severity" ? SEVERITY_LABEL[v] || pretty(v)
      : s.key === "units" ? v : pretty(v)));
    return { ...s, codes: cols[s.key], labels, raw, card: raw.length };
  });

  const severityRaw = colMeta.severity.values;
  return {
    n, meta, dims, dimByKey: Object.fromEntries(dims.map((d) => [d.key, d])),
    measures: { ksi, fatal, injuries }, cells, positions, cols, dIso, severityRaw,
    streets: colMeta.street.values, dirs: colMeta.streetDir.values,
    bbox: { LAT0, LAT1, LON0, LON1, Q },
  };
}

/** Details of one crash (for hover + hot-spot labels). */
export function crashRecord(model, i) {
  const c = model.cols, dims = model.dimByKey;
  const t = c.tod[i];
  const hh = String((t / 60) | 0).padStart(2, "0"), mm = String(t % 60).padStart(2, "0");
  const dir = model.dirs[c.streetDir[i]];
  return {
    date: `${model.dIso[c.day[i]]} ${hh}:${mm}`,
    type: dims.crashType.labels[c.crashType[i]],
    cause: dims.cause1.labels[c.cause1[i]],
    injuries: c.injuries[i], fatal: c.fatal[i], incap: c.incap[i],
    severity: model.severityRaw[c.severity[i]],
    block: `${c.block[i] * 100} ${dir === "UNKNOWN" ? "" : dir + " "}${model.streets[c.street[i]]}`,
    neighborhood: dims.neighborhood.labels[c.neighborhood[i]],
    zip: dims.zip.labels[c.zip[i]],
  };
}
