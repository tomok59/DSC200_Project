// Functional tests for the map rules (FR-3), docs/js/maphelpers.js. Written before the map existed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { POINT_ZOOM, layerModeForZoom, severityStyle, SEVERITY_ORDER, tooltipText } from "../docs/js/maphelpers.js";

test("FT-05 density below zoom 8.5, points at 8.5 or closer", () => {
  assert.equal(POINT_ZOOM, 8.5);
  assert.equal(layerModeForZoom(8.49), "density");
  assert.equal(layerModeForZoom(5), "density");
  assert.equal(layerModeForZoom(8.5), "points");
  assert.equal(layerModeForZoom(14), "points");
  // manual overrides offered in the UI still work
  assert.equal(layerModeForZoom(12, "density"), "density");
  assert.equal(layerModeForZoom(6, "points"), "points");
});

test("FT-06 colour and size grow with severity", () => {
  assert.deepEqual(SEVERITY_ORDER, ["NO INDICATION OF INJURY", "REPORTED, NOT EVIDENT",
    "NONINCAPACITATING INJURY", "INCAPACITATING INJURY", "FATAL"]);
  const styles = SEVERITY_ORDER.map((s) => severityStyle(s));
  for (let i = 1; i < styles.length; i++) {
    assert.ok(styles[i].radius > styles[i - 1].radius, "radius increases");
    assert.notDeepEqual(styles[i].color, styles[i - 1].color, "distinct colour");
    assert.ok(styles[i].color[3] >= styles[i - 1].color[3], "more opaque");
  }
  assert.deepEqual(severityStyle("UNKNOWN"), severityStyle("NO INDICATION OF INJURY"));
});

test("FT-07 hover shows date, type, cause, injuries and block", () => {
  const t = tooltipText({ date: "2023-06-15 14:22", type: "REAR END", cause: "FOLLOWING TOO CLOSELY",
    injuries: 3, fatal: 1, incap: 2, block: "1000 W ADDISON ST", severity: "FATAL" });
  for (const s of ["2023-06-15 14:22", "REAR END", "FOLLOWING TOO CLOSELY", "1000 W ADDISON ST"]) assert.ok(t.includes(s), s);
  assert.match(t, /3 injur/i);
  assert.match(t, /1 fatal/i);
});

// ---- added after review: density rendering + outline order ------------------------------
import { densityRaster } from "../docs/js/maphelpers.js";

test("FT-12 density raster: coloured exactly where filtered crashes are, transparent elsewhere", () => {
  const n = 4000, qlat = new Uint16Array(n), qlon = new Uint16Array(n), mask = new Float32Array(n);
  for (let i = 0; i < n; i++) {         // two clusters: SW (filtered in) and NE (filtered out)
    const sw = i < n / 2;
    qlat[i] = sw ? 10000 + (i % 50) * 10 : 55000 + (i % 50) * 10;
    qlon[i] = sw ? 10000 + (i % 37) * 10 : 55000 + (i % 37) * 10;
    mask[i] = sw ? 1 : 0;
  }
  const r = densityRaster(mask, qlat, qlon, 8, 1);
  assert.equal(r.visible, n / 2);
  const alphaAt = (ql, qo) => { const s = r.size, row = s - 1 - (ql >> 8), col = qo >> 8; return r.rgba[4 * (row * s + col) + 3]; };
  assert.ok(alphaAt(10200, 10150) > 0, "SW cluster is drawn");
  assert.equal(alphaAt(55200, 55150), 0, "filtered-out NE cluster is not drawn");
  assert.equal(alphaAt(30000, 30000), 0, "empty area is transparent");
  // north is the top row of the image
  const top = r.rgba.subarray(0, 4 * r.size * 10), bottom = r.rgba.subarray(r.rgba.length - 4 * r.size * 10);
  assert.ok(top.every((v, k) => k % 4 !== 3 || v === 0) && bottom.every((v, k) => k % 4 !== 3 || v === 0));
  // nothing visible -> fully transparent image
  const none = densityRaster(new Float32Array(n), qlat, qlon, 8, 1);
  assert.equal(none.visible, 0);
  assert.ok(none.rgba.every((v) => v === 0));
});

test("FT-13 layer order: outlines are drawn over the crash points and the density layer", async () => {
  const made = [];
  class L { constructor(p) { this.id = p.id; this.props = p; made.push(this); } }
  globalThis.deck = { ScatterplotLayer: class extends L {}, BitmapLayer: class extends L {}, GeoJsonLayer: class extends L {},
    DataFilterExtension: class {} };
  globalThis.document = { createElement: () => ({ getContext: () => ({ putImageData() {} }) }) };
  globalThis.ImageData = class { constructor(d, w, h) { this.data = d; this.width = w; this.height = h; } };
  const { CrashMap } = await import("../docs/js/map.js");
  const n = 50, cols = { severity: new Uint8Array(n).map((_, i) => i % 5), qlat: new Uint16Array(n).fill(30000), qlon: new Uint16Array(n).fill(30000) };
  const model = { n, cols, positions: new Float32Array(2 * n), severityRaw: ["NO INDICATION OF INJURY", "REPORTED, NOT EVIDENT", "NONINCAPACITATING INJURY", "INCAPACITATING INJURY", "FATAL"],
    bbox: { LAT0: 41.64, LAT1: 42.03, LON0: -87.95, LON1: -87.52, Q: 65535 } };
  const cm = new CrashMap(null, model, { onAreaClick() {}, onHover() {} });
  let layers = [];
  cm.overlay = { setProps: (p) => { layers = p.layers; } };
  cm.geo = { neighborhood: { type: "FeatureCollection", features: [] }, zip: { type: "FeatureCollection", features: [] } };
  let zoom = 12;
  cm.map = { getZoom: () => zoom };
  cm.setMask(new Float32Array(n).fill(1));
  let ids = layers.map((l) => l.id);
  assert.deepEqual(ids, ["area-fills", "crashes-base", "crashes-injury", "area-halo", "area-lines"]);
  assert.equal(layers.find((l) => l.id === "area-lines").props.pickable, false, "outlines don't steal hover from points");
  assert.equal(layers.find((l) => l.id === "crashes-injury").props.pickable, true);
  zoom = 7; cm.render();
  ids = layers.map((l) => l.id);
  assert.deepEqual(ids, ["area-fills", "density", "area-halo", "area-lines"]);
  assert.ok(layers[1].props.image, "density layer has an image");
  cm.setBoundary("zip");
  assert.equal(layers.at(-1).id, "area-lines");
  cm.setBoundary("none");
  assert.deepEqual(layers.map((l) => l.id), ["density"]);
});
