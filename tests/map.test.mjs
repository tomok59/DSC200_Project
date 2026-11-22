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
