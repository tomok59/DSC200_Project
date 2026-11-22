// Map view: MapLibre basemap + deck.gl layers (WebGL, so 577k points draw well under 33 ms/frame).
// Density (heatmap) below POINT_ZOOM, individual crashes at POINT_ZOOM or closer (FR-3).
/* global maplibregl, deck */
import { layerModeForZoom, severityStyle, severityRank, SEVERITY_ORDER } from "./maphelpers.js";

const BASEMAP = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
// Used when the basemap host can't be reached (offline, strict CSP): plain dark canvas + our outlines.
const FALLBACK_STYLE = { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#0b0d11" } }] };
async function pickStyle() {
  try {
    const r = await fetch(BASEMAP);
    if (!r.ok) throw new Error(String(r.status));
    return { style: await r.json(), basemap: true };
  } catch (e) {
    console.warn("basemap unavailable, using plain background", e);
    return { style: FALLBACK_STYLE, basemap: false };
  }
}
const CITY_BOUNDS = [[-87.94, 41.644], [-87.524, 42.023]];
// one hue (amber) from dark to light: magnitude only
const HEAT_RANGE = [[70, 30, 10], [130, 55, 15], [190, 85, 25], [236, 120, 45], [250, 175, 90], [255, 232, 185]];

export class CrashMap {
  constructor(el, model, { onAreaClick, onHover, onModeChange }) {
    this.el = el;
    this.model = model;
    this.onAreaClick = onAreaClick;
    this.onHover = onHover;
    this.onModeChange = onModeChange;
    this.mode = "auto";
    this.boundary = "neighborhood";
    this.version = 0;
    this.focus = null;
    this._prepare();
  }

  _prepare() {
    const m = this.model, n = m.n, sev = m.cols.severity;
    // Two point layers: crashes with an injury are drawn on top of no-injury crashes.
    const rankOf = m.severityRaw.map((s) => (SEVERITY_ORDER.includes(s) ? severityRank(s) : 0));
    const styleOf = m.severityRaw.map((s) => severityStyle(s));
    let nInj = 0;
    for (let i = 0; i < n; i++) if (rankOf[sev[i]] >= 2) nInj++;
    const mk = (count) => ({ idx: new Uint32Array(count), pos: new Float32Array(2 * count),
      color: new Uint8Array(4 * count), radius: new Float32Array(count), mask: new Float32Array(count) });
    this.base = mk(n - nInj);
    this.top = mk(nInj);
    let a = 0, b = 0;
    for (let i = 0; i < n; i++) {
      const s = sev[i], L = rankOf[s] >= 2 ? this.top : this.base, j = L === this.top ? b++ : a++;
      L.idx[j] = i;
      L.pos[2 * j] = m.positions[2 * i]; L.pos[2 * j + 1] = m.positions[2 * i + 1];
      L.color.set(styleOf[s].color, 4 * j);
      L.radius[j] = styleOf[s].radius;
    }
  }

  async init() {
    const { style, basemap } = await pickStyle();
    this.hasBasemap = basemap;
    this.map = new maplibregl.Map({
      container: this.el, style, bounds: CITY_BOUNDS, fitBoundsOptions: { padding: 20 },
      attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false,
    });
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    this.overlay = new deck.MapboxOverlay({
      interleaved: false, layers: [],
      onError: (err, layer) => {
        // if the GPU heatmap is not supported, fall back to small additive "glow" dots
        if (layer && layer.id === "density" && !this.heatFailed) {
          console.warn("heatmap unavailable, using dot density", err);
          this.heatFailed = true;
          this.render();
        }
      },
    });
    this.map.addControl(this.overlay);
    this.map.on("zoom", () => {
      const z = this.map.getZoom();
      const mode = layerModeForZoom(z, this.mode);
      if (mode !== this.lastMode || mode === "points") this.render();
      this.onModeChange?.(mode, z);
    });
    const [neigh, zips] = await Promise.all([
      fetch("data/neighborhoods.geojson").then((r) => r.json()),
      fetch("data/zipcodes.geojson").then((r) => r.json()),
    ]);
    this.geo = { neighborhood: neigh, zip: zips };
    await new Promise((res) => (this.map.loaded() ? res() : this.map.once("load", res)));
    this.render();
  }

  zoom() { return this.map ? this.map.getZoom() : 10; }
  currentMode() { return layerModeForZoom(this.zoom(), this.mode); }
  setMode(mode) { this.mode = mode; this.render(); this.onModeChange?.(this.currentMode(), this.zoom()); }
  setBoundary(b) { this.boundary = b; this.render(); }

  setMask(mask) {
    this.mask = mask;
    for (const L of [this.base, this.top]) for (let j = 0; j < L.idx.length; j++) L.mask[j] = mask[L.idx[j]];
    this.version++;
    this.render();
  }

  flyTo(lon, lat, zoom = 16) {
    this.focus = [lon, lat];
    this.map.flyTo({ center: [lon, lat], zoom, speed: 1.4 });
    this.render();
  }

  _points(id, L) {
    const zoom = this.zoom();
    const scale = Math.max(0.55, Math.min(2.2, Math.pow(1.22, zoom - 12)));
    return new deck.ScatterplotLayer({
      id,
      data: { length: L.idx.length, attributes: {
        getPosition: { value: L.pos, size: 2 },
        getFillColor: { value: L.color, size: 4, normalized: true },
        getRadius: { value: L.radius, size: 1 },
        getFilterValue: { value: L.mask, size: 1 },
      } },
      radiusUnits: "pixels", radiusScale: scale, radiusMinPixels: 1,
      stroked: false, filled: true, pickable: true, autoHighlight: true, highlightColor: [255, 255, 255, 220],
      extensions: [new deck.DataFilterExtension({ filterSize: 1 })], filterRange: [0.5, 1],
      updateTriggers: { getFilterValue: this.version },
      onHover: (info) => this.onHover(info.index >= 0 ? L.idx[info.index] : -1, info.x, info.y),
      parameters: { depthTest: false },
    });
  }

  render() {
    if (!this.overlay || !this.mask) return;
    const m = this.model, mode = this.currentMode();
    this.lastMode = mode;
    const layers = [];
    const g = this.boundary !== "none" && this.geo ? this.geo[this.boundary] : null;
    if (g) {
      layers.push(new deck.GeoJsonLayer({
        id: "areas-" + this.boundary, data: g, stroked: true, filled: true, pickable: true,
        getFillColor: (f) => (this.selectedNames?.has(f.properties.name) ? [57, 135, 229, 50] : [0, 0, 0, 0]),
        getLineColor: (f) => (this.selectedNames?.has(f.properties.name) ? [120, 180, 255, 230] : [200, 200, 210, 70]),
        lineWidthUnits: "pixels", getLineWidth: (f) => (this.selectedNames?.has(f.properties.name) ? 2 : 1),
        updateTriggers: { getFillColor: this.areaVersion, getLineColor: this.areaVersion, getLineWidth: this.areaVersion },
        onClick: (info) => info.object && this.onAreaClick(this.boundary, info.object.properties.name),
      }));
    }
    if (mode === "density" && this.heatFailed) {
      layers.push(new deck.ScatterplotLayer({
        id: "density-dots",
        data: { length: m.n, attributes: {
          getPosition: { value: m.positions, size: 2 },
          getFilterValue: { value: this.mask, size: 1 },
        } },
        getFillColor: [250, 160, 60, 40], radiusUnits: "pixels", getRadius: 1.6, stroked: false,
        extensions: [new deck.DataFilterExtension({ filterSize: 1 })], filterRange: [0.5, 1],
        updateTriggers: { getFilterValue: this.version }, parameters: { depthTest: false },
      }));
    } else if (mode === "density") {
      layers.push(new deck.HeatmapLayer({
        id: "density",
        data: { length: m.n, attributes: {
          getPosition: { value: m.positions, size: 2 },
          getWeight: { value: this.mask, size: 1 },
        } },
        radiusPixels: 22, intensity: 1.1, threshold: 0.04, colorRange: HEAT_RANGE, aggregation: "SUM",
        updateTriggers: { getWeight: this.version },
      }));
    } else {
      layers.push(this._points("crashes-base", this.base));
      layers.push(this._points("crashes-injury", this.top));
    }
    if (this.focus) {
      layers.push(new deck.ScatterplotLayer({
        id: "focus", data: [this.focus], getPosition: (d) => d, getRadius: 70, radiusUnits: "meters",
        stroked: true, filled: false, getLineColor: [255, 255, 255, 230], lineWidthUnits: "pixels", getLineWidth: 2,
      }));
    }
    this.overlay.setProps({ layers });
  }

  /** names of the selected areas for the active boundary layer (filled + outlined) */
  highlightAreas(names) {
    this.selectedNames = names;
    this.areaVersion = (this.areaVersion || 0) + 1;
    this.render();
  }
}
