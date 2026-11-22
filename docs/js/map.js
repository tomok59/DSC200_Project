// Map view: MapLibre basemap + deck.gl layers (WebGL, so 577k points draw well under 33 ms/frame).
// Density below POINT_ZOOM, individual crashes at POINT_ZOOM or closer (FR-3).
// Layer order, bottom → top: clickable area fills · density or points · area outlines · focus ring.
/* global maplibregl, deck */
import { layerModeForZoom, severityStyle, severityRank, SEVERITY_ORDER, densityRaster } from "./maphelpers.js";

const DENSITY_GRID_BITS = 10; // 1024 x 1024 cells over the bounding box (~40 m each)

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
    this.overlay = new deck.MapboxOverlay({ interleaved: false, layers: [] });
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

  /** Density image for the current filters, rebuilt only when the filters change. */
  _densityImage() {
    if (this._densVersion === this.version && this._densCanvas) return this._densCanvas;
    const c = this.model.cols;
    const r = densityRaster(this.mask, c.qlat, c.qlon, DENSITY_GRID_BITS, 2, (this._densWork ||= {}));
    const canvas = document.createElement("canvas"); // new object → deck uploads a new texture
    canvas.width = canvas.height = r.size;
    canvas.getContext("2d").putImageData(new ImageData(r.rgba, r.size, r.size), 0, 0);
    this._densCanvas = canvas;
    this._densVersion = this.version;
    return canvas;
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
    const mode = this.currentMode();
    this.lastMode = mode;
    const layers = [];
    const g = this.boundary !== "none" && this.geo ? this.geo[this.boundary] : null;
    const isSel = (f) => !!this.selectedNames?.has(f.properties.name);
    const areaTrig = `${this.boundary}-${this.areaVersion || 0}`;

    // 1. area fills: below the data, nearly invisible, but clickable (click = filter by that area)
    if (g) {
      layers.push(new deck.GeoJsonLayer({
        id: "area-fills", data: g, stroked: false, filled: true, pickable: true,
        getFillColor: (f) => (isSel(f) ? [57, 135, 229, 45] : [0, 0, 0, 1]),
        updateTriggers: { getFillColor: areaTrig },
        onClick: (info) => info.object && this.onAreaClick(this.boundary, info.object.properties.name),
      }));
    }

    // 2. the data
    if (mode === "density") {
      const { LAT0, LAT1, LON0, LON1 } = this.model.bbox;
      layers.push(new deck.BitmapLayer({
        id: "density", image: this._densityImage(), bounds: [LON0, LAT0, LON1, LAT1],
        pickable: false, parameters: { depthTest: false },
      }));
    } else {
      layers.push(this._points("crashes-base", this.base));
      layers.push(this._points("crashes-injury", this.top));
    }

    // 3. outlines ON TOP of the data: dark halo + bright line, so they read over dense points
    if (g) {
      layers.push(new deck.GeoJsonLayer({
        id: "area-halo", data: g, stroked: true, filled: false, pickable: false,
        lineWidthUnits: "pixels", getLineWidth: (f) => (isSel(f) ? 5 : 3.5), getLineColor: [8, 10, 14, 210],
        updateTriggers: { getLineWidth: areaTrig }, parameters: { depthTest: false },
      }));
      layers.push(new deck.GeoJsonLayer({
        id: "area-lines", data: g, stroked: true, filled: false, pickable: false,
        lineWidthUnits: "pixels", getLineWidth: (f) => (isSel(f) ? 2.5 : 1.4),
        getLineColor: (f) => (isSel(f) ? [120, 180, 255, 255] : [236, 238, 245, 200]),
        updateTriggers: { getLineWidth: areaTrig, getLineColor: areaTrig }, parameters: { depthTest: false },
      }));
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
