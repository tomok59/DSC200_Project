// Pure map rules (FR-3). Unit-tested in Node (tests/map.test.mjs).

/** Zoom level at which the map switches from density to individual points (spec FR-3). */
export const POINT_ZOOM = 8.5;

/** 'auto' follows FR-3; 'density' / 'points' are manual overrides offered in the UI. */
export function layerModeForZoom(zoom, mode = "auto") {
  if (mode === "density" || mode === "points") return mode;
  return zoom >= POINT_ZOOM ? "points" : "density";
}

export const SEVERITY_ORDER = ["NO INDICATION OF INJURY", "REPORTED, NOT EVIDENT",
  "NONINCAPACITATING INJURY", "INCAPACITATING INJURY", "FATAL"];

export const SEVERITY_LABEL = {
  "NO INDICATION OF INJURY": "No injury",
  "REPORTED, NOT EVIDENT": "Possible injury",
  "NONINCAPACITATING INJURY": "Minor injury",
  "INCAPACITATING INJURY": "Serious injury",
  "FATAL": "Fatal",
  "UNKNOWN": "Unknown",
};

// Ordinal: cool & faint -> hot & opaque, radius grows with severity.
const STYLES = [
  { color: [85, 152, 231, 120], radius: 2 },   // no injury
  { color: [250, 178, 25, 170], radius: 3 },   // possible injury
  { color: [236, 131, 90, 200], radius: 4.5 }, // minor injury
  { color: [227, 73, 72, 235], radius: 6.5 },  // serious injury
  { color: [255, 64, 129, 255], radius: 9 },   // fatal
];

export function severityRank(severity) {
  const r = SEVERITY_ORDER.indexOf(severity);
  return r < 0 ? 0 : r;
}

export function severityStyle(severity) {
  const s = STYLES[severityRank(severity)];
  return { color: s.color.slice(), radius: s.radius };
}

// ---- density raster (replaces deck.gl's HeatmapLayer, which didn't render our binary data) ----
// One hue (amber) from dark to light: magnitude only.
export const DENSITY_RAMP = [[70, 30, 10], [130, 55, 15], [190, 85, 25], [236, 120, 45], [250, 175, 90], [255, 232, 185]];

function boxBlur(src, tmp, size, r) {
  const w = 2 * r + 1;
  for (let y = 0; y < size; y++) { // horizontal pass, running sum
    const row = y * size;
    let s = 0;
    for (let x = -r; x <= r; x++) s += src[row + Math.min(size - 1, Math.max(0, x))];
    for (let x = 0; x < size; x++) {
      tmp[row + x] = s / w;
      s += src[row + Math.min(size - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < size; x++) { // vertical pass
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.min(size - 1, Math.max(0, y)) * size + x];
    for (let y = 0; y < size; y++) {
      src[y * size + x] = s / w;
      s += tmp[Math.min(size - 1, y + r + 1) * size + x] - tmp[Math.max(0, y - r) * size + x];
    }
  }
}

/**
 * Count the visible crashes (mask[i] > 0) on a size x size grid over the data's bounding box,
 * smooth it, and colour it. Row 0 is the NORTH edge (image top).
 * @returns {{rgba: Uint8ClampedArray, size: number, max: number, visible: number}}
 */
export function densityRaster(mask, qlat, qlon, gridBits = 10, blurRadius = 2, work = {}) {
  const size = 1 << gridBits, shift = 16 - gridBits, n = mask.length;
  const grid = work.grid && work.grid.length === size * size ? work.grid : (work.grid = new Float32Array(size * size));
  const tmp = work.tmp && work.tmp.length === size * size ? work.tmp : (work.tmp = new Float32Array(size * size));
  grid.fill(0);
  let visible = 0;
  for (let i = 0; i < n; i++) {
    if (mask[i] > 0) {
      grid[(size - 1 - (qlat[i] >> shift)) * size + (qlon[i] >> shift)] += 1;
      visible++;
    }
  }
  if (blurRadius > 0) { boxBlur(grid, tmp, size, blurRadius); boxBlur(grid, tmp, size, blurRadius); } // ≈ gaussian
  let max = 0;
  for (let k = 0; k < grid.length; k++) if (grid[k] > max) max = grid[k];
  const rgba = new Uint8ClampedArray(size * size * 4);
  if (max > 0) {
    const lmax = Math.log1p(max * 4), last = DENSITY_RAMP.length - 1, floor = max * 1e-3;
    for (let k = 0; k < grid.length; k++) {
      const v = grid[k];
      if (v <= floor) continue;                       // transparent where there are no crashes
      const t = Math.min(1, Math.log1p(v * 4) / lmax); // log scale so quieter streets still show
      const p = t * last, j = Math.min(last - 1, p | 0), f = p - j, a = DENSITY_RAMP[j], b = DENSITY_RAMP[j + 1];
      const o = 4 * k;
      rgba[o] = a[0] + (b[0] - a[0]) * f;
      rgba[o + 1] = a[1] + (b[1] - a[1]) * f;
      rgba[o + 2] = a[2] + (b[2] - a[2]) * f;
      rgba[o + 3] = 35 + 220 * Math.min(1, t * 1.25);
    }
  }
  return { rgba, size, max, visible };
}

export function cssColor(c) { return `rgba(${c[0]},${c[1]},${c[2]},${(c[3] / 255).toFixed(2)})`; }

/** Plain-text hover content: date, type, cause, injuries, block (one fact per line). */
export function tooltipText(r) {
  const inj = `${r.injuries} injur${r.injuries === 1 ? "y" : "ies"}` +
    (r.fatal || r.incap ? ` (${r.fatal} fatal, ${r.incap} serious)` : "");
  return [
    r.date,
    r.type,
    `Cause: ${r.cause}`,
    inj + (r.severity ? ` · ${SEVERITY_LABEL[r.severity] || r.severity}` : ""),
    `Block: ${r.block}`,
  ].join("\n");
}
