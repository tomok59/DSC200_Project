// Cross-filter engine. Pure (no DOM), so it is unit-tested in Node (tests/engine.test.mjs).
//
// Each row keeps a 32-bit "fail mask": bit d is set when the row fails the filter on dimension d.
//   * a row is in the filtered set            <=>  mask == 0
//   * a row belongs in dimension d's own chart <=>  (mask & ~bit_d) == 0
//     (it passes every OTHER filter; FR-4 "unselected values stay visible and clickable")
// Changing one filter only touches one bit per row, then compute() aggregates everything.

export class CrossFilter {
  /**
   * @param {object} o
   * @param {number} o.n                         number of rows
   * @param {{key:string, card:number, codes:Uint8Array|Uint16Array}[]} o.dims  filterable dimensions (≤ 32)
   * @param {{ksi:Uint8Array, fatal:Uint8Array, injuries:Uint8Array}} o.measures headline measures
   * @param {Uint32Array} o.cells                hot-spot grid cell of each row
   * @param {number} o.gridCells                 number of grid cells
   * @param {number} [o.hotspotK=10]             hot spots to return
   */
  constructor({ n, dims, measures, cells, gridCells, hotspotK = 10 }) {
    if (dims.length > 32) throw new Error("at most 32 filter dimensions");
    this.n = n;
    this.dims = dims;
    this.measures = measures;
    this.cells = cells;
    this.hotspotK = hotspotK;
    this.index = new Map(dims.map((d, i) => [d.key, i]));
    this.filters = new Map(); // key -> Set of codes
    this.fail = new Uint32Array(n);
    this.hist = dims.map((d) => new Uint32Array(d.card));
    this.mask = new Float32Array(n);
    this.passIdx = new Uint32Array(n);
    this.gridCount = new Uint32Array(gridCells);
    this.gridKsi = new Uint32Array(gridCells);
    this.gridRep = new Int32Array(gridCells);
  }

  _dim(key) {
    const i = this.index.get(key);
    if (i === undefined) throw new Error(`unknown dimension ${key}`);
    return i;
  }

  _apply(di) {
    const d = this.dims[di], set = this.filters.get(d.key), f = this.fail, n = this.n, codes = d.codes;
    const bit = (1 << di) >>> 0, nb = ~bit;
    if (!set || set.size === 0) {
      for (let i = 0; i < n; i++) f[i] &= nb;
      return;
    }
    const lut = new Uint8Array(d.card);
    for (const v of set) if (v >= 0 && v < d.card) lut[v] = 1;
    for (let i = 0; i < n; i++) {
      if (lut[codes[i]]) f[i] &= nb; else f[i] |= bit;
    }
  }

  /** Replace the selection of one dimension. `values` = iterable of codes, or null/empty to clear. */
  setFilter(key, values) {
    const di = this._dim(key);
    const set = values == null ? null : new Set(values);
    if (!set || set.size === 0) this.filters.delete(key); else this.filters.set(key, set);
    this._apply(di);
  }

  /** Add or remove one value from a dimension's selection (bar click). */
  toggle(key, code) {
    const cur = new Set(this.filters.get(key) || []);
    if (cur.has(code)) cur.delete(code); else cur.add(code);
    this.setFilter(key, cur);
  }

  clear(key) { this.setFilter(key, null); }

  clearAll() {
    this.filters.clear();
    this.fail.fill(0);
  }

  selected(key) { return this.filters.get(key) || null; }

  /** Recompute every aggregate from the current filters. */
  compute() {
    const n = this.n, f = this.fail, mask = this.mask, idx = this.passIdx;
    const { ksi: K, fatal: F, injuries: J } = this.measures;
    const cells = this.cells, gc = this.gridCount, gk = this.gridKsi, gr = this.gridRep;
    gc.fill(0); gk.fill(0);

    // 1. filtered set: mask for the map, index list, headline numbers, hot-spot grid
    let count = 0, ksi = 0, fatal = 0, injuries = 0;
    for (let i = 0; i < n; i++) {
      if (f[i] === 0) {
        mask[i] = 1;
        idx[count++] = i;
        const k = K[i];
        ksi += k; fatal += F[i]; injuries += J[i];
        const c = cells[i];
        gc[c]++; gk[c] += k; gr[c] = i;
      } else {
        mask[i] = 0;
      }
    }

    // 2. charts. Unfiltered dims only need the filtered rows; a filtered dim needs every row
    //    that passes all OTHER filters.
    const hist = this.hist;
    for (let di = 0; di < this.dims.length; di++) {
      const h = hist[di], codes = this.dims[di].codes;
      h.fill(0);
      if (!this.filters.has(this.dims[di].key)) {
        for (let j = 0; j < count; j++) h[codes[idx[j]]]++;
      } else {
        const nb = ~((1 << di) >>> 0);
        for (let i = 0; i < n; i++) if ((f[i] & nb) === 0) h[codes[i]]++;
      }
    }

    // 3. hot spots: top-K grid cells by KSI, then by crash count
    const K_ = this.hotspotK, top = [];
    let gridTotal = 0;
    for (let c = 0; c < gc.length; c++) {
      const cnt = gc[c];
      if (cnt === 0) continue;
      gridTotal += cnt;
      const k = gk[c];
      if (top.length === K_) {
        const w = top[K_ - 1];
        if (k < w.ksi || (k === w.ksi && cnt <= w.count)) continue;
        top.pop();
      }
      const item = { cell: c, count: cnt, ksi: k, rep: gr[c] };
      let p = top.length;
      while (p > 0 && (top[p - 1].ksi < k || (top[p - 1].ksi === k && top[p - 1].count < cnt))) p--;
      top.splice(p, 0, item);
    }

    const out = { count, ksi, fatal, injuries, mask, gridTotal, hotspots: top, hist: {} };
    this.dims.forEach((d, i) => { out.hist[d.key] = hist[i]; });
    return out;
  }
}
