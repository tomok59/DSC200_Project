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
