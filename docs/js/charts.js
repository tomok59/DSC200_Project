// Lightweight HTML charts. Every bar is a button: click toggles that value in the filter.
// DOM is built once; update() only changes widths, numbers and classes (fast).

const fmt = new Intl.NumberFormat("en-US");
export const fmtNum = (v) => fmt.format(v);
const pct = (v, t) => (t ? (100 * v / t).toFixed(v / t < 0.01 ? 2 : 1) : "0") + "%";

// ---- shared tooltip ----------------------------------------------------------------
let tip;
export function tooltip() {
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "tip";
    tip.setAttribute("role", "tooltip");
    document.body.appendChild(tip);
  }
  return tip;
}
export function showTip(x, y, value, label, sub) {
  const t = tooltip();
  t.replaceChildren();
  const v = document.createElement("strong"); v.textContent = value; t.appendChild(v);
  const l = document.createElement("div"); l.textContent = label; t.appendChild(l);
  if (sub) { const s = document.createElement("div"); s.className = "tip-sub"; s.textContent = sub; t.appendChild(s); }
  t.style.display = "block";
  const r = t.getBoundingClientRect();
  const px = Math.min(window.innerWidth - r.width - 8, x + 14), py = y - r.height - 12 < 4 ? y + 18 : y - r.height - 12;
  t.style.transform = `translate(${px}px, ${py}px)`;
}
export function hideTip() { if (tip) tip.style.display = "none"; }

function card(container, dim, extraClass = "") {
  const el = document.createElement("section");
  el.className = `card chart ${extraClass}`;
  el.dataset.dim = dim.key;
  const head = document.createElement("header");
  const h = document.createElement("h3"); h.textContent = dim.label;
  const clear = document.createElement("button");
  clear.className = "clear-btn"; clear.type = "button"; clear.textContent = "Clear";
  clear.title = `Clear the ${dim.label} filter`;
  head.append(h, clear);
  el.appendChild(head);
  container.appendChild(el);
  return { el, clear };
}

// ---- horizontal bar list (categorical) ---------------------------------------------
export class BarList {
  constructor(container, dim, { onToggle, onClear, searchable = false, sortByValue = true, maxRows = 0 }) {
    this.dim = dim;
    this.sortByValue = sortByValue;
    const { el, clear } = card(container, dim, searchable ? "chart-list" : "");
    this.el = el; this.clearBtn = clear;
    clear.addEventListener("click", onClear);
    if (searchable) {
      const s = document.createElement("input");
      s.type = "search"; s.placeholder = `Search ${dim.card} values…`; s.className = "search";
      s.setAttribute("aria-label", `Search ${dim.label}`);
      s.addEventListener("input", () => {
        const q = s.value.trim().toLowerCase();
        this.rows.forEach((r, code) => { r.el.hidden = q !== "" && !dim.labels[code].toLowerCase().includes(q); });
      });
      el.appendChild(s);
    }
    this.body = document.createElement("div");
    this.body.className = "bars" + (searchable || maxRows || dim.card > 12 ? " scroll" : "");
    el.appendChild(this.body);
    this.rows = dim.labels.map((label, code) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "bar-row";
      const l = document.createElement("span"); l.className = "lbl"; l.textContent = label; l.title = label;
      const tr = document.createElement("span"); tr.className = "track";
      const bar = document.createElement("span"); bar.className = "bar"; tr.appendChild(bar);
      const v = document.createElement("span"); v.className = "val";
      b.append(l, tr, v);
      b.addEventListener("click", () => onToggle(code));
      b.addEventListener("pointermove", (e) => showTip(e.clientX, e.clientY, fmtNum(this.last?.[code] ?? 0),
        label, `${pct(this.last?.[code] ?? 0, this.lastTotal)} of crashes shown in this chart`));
      b.addEventListener("pointerleave", hideTip);
      this.body.appendChild(b);
      return { el: b, bar, v };
    });
  }

  update(hist, selected) {
    let max = 0, total = 0;
    for (const v of hist) { if (v > max) max = v; total += v; }
    this.last = hist; this.lastTotal = total;
    const has = !!(selected && selected.size);
    this.el.classList.toggle("filtered", has);
    this.rows.forEach((r, code) => {
      const v = hist[code];
      r.bar.style.width = max ? `${(100 * v / max).toFixed(2)}%` : "0";
      r.v.textContent = fmtNum(v);
      const sel = has && selected.has(code);
      r.el.classList.toggle("sel", sel);
      r.el.classList.toggle("off", has && !sel);
      r.el.classList.toggle("zero", v === 0);
      r.el.setAttribute("aria-pressed", sel ? "true" : "false");
    });
    if (this.sortByValue) {
      const order = this.rows.map((_, c) => c).sort((a, b) => hist[b] - hist[a] || a - b);
      const sig = order.join(",");
      if (sig !== this.sig) { this.sig = sig; for (const c of order) this.body.appendChild(this.rows[c].el); }
    }
  }
}

// ---- vertical columns (ordinal: hour, weekday, year, speed …) ------------------------
export class Columns {
  constructor(container, dim, { onToggle, onClear, labelEvery = 1, axisLabels = null }) {
    this.dim = dim;
    const { el, clear } = card(container, dim, "chart-cols");
    this.el = el;
    clear.addEventListener("click", onClear);
    const plot = document.createElement("div"); plot.className = "cols";
    plot.style.gridTemplateColumns = `repeat(${dim.card}, 1fr)`;
    const axis = document.createElement("div"); axis.className = "cols-axis";
    axis.style.gridTemplateColumns = `repeat(${dim.card}, 1fr)`;
    el.append(plot, axis);
    this.cols = dim.labels.map((label, code) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "col";
      b.setAttribute("aria-label", label);
      const bar = document.createElement("span"); bar.className = "colbar"; b.appendChild(bar);
      b.addEventListener("click", () => onToggle(code));
      b.addEventListener("pointermove", (e) => showTip(e.clientX, e.clientY, fmtNum(this.last?.[code] ?? 0),
        `${dim.label}: ${label}`, pct(this.last?.[code] ?? 0, this.lastTotal)));
      b.addEventListener("pointerleave", hideTip);
      plot.appendChild(b);
      const t = document.createElement("span");
      t.textContent = code % labelEvery === 0 ? (axisLabels ? axisLabels[code] : label) : "";
      axis.appendChild(t);
      return { el: b, bar };
    });
  }

  update(hist, selected) {
    let max = 0, total = 0;
    for (const v of hist) { if (v > max) max = v; total += v; }
    this.last = hist; this.lastTotal = total;
    const has = !!(selected && selected.size);
    this.el.classList.toggle("filtered", has);
    this.cols.forEach((c, code) => {
      c.bar.style.height = max ? `${(100 * hist[code] / max).toFixed(2)}%` : "0";
      const sel = has && selected.has(code);
      c.el.classList.toggle("sel", sel);
      c.el.classList.toggle("off", has && !sel);
      c.el.setAttribute("aria-pressed", sel ? "true" : "false");
    });
  }
}

// ---- timeline with brush (month dimension) --------------------------------------------
export class Timeline {
  constructor(container, dim, { onRange, onToggle, onClear }) {
    this.dim = dim;
    const { el, clear } = card(container, dim, "chart-timeline");
    this.el = el;
    clear.addEventListener("click", onClear);
    const hint = document.createElement("p"); hint.className = "hint";
    hint.textContent = "Drag across months to select a date range · click one month to toggle it";
    el.appendChild(hint);
    const plot = document.createElement("div"); plot.className = "tl";
    plot.style.gridTemplateColumns = `repeat(${dim.card}, 1fr)`;
    const axis = document.createElement("div"); axis.className = "tl-axis";
    axis.style.gridTemplateColumns = `repeat(${dim.card}, 1fr)`;
    el.append(plot, axis);
    this.cols = dim.labels.map((label, code) => {
      const b = document.createElement("div"); b.className = "col"; b.dataset.code = code;
      const bar = document.createElement("span"); bar.className = "colbar"; b.appendChild(bar);
      plot.appendChild(b);
      const t = document.createElement("span");
      t.textContent = code % 12 === 0 ? label.split(" ")[1] : "";
      axis.appendChild(t);
      return { el: b, bar };
    });
    const codeAt = (e) => {
      const r = plot.getBoundingClientRect();
      return Math.max(0, Math.min(dim.card - 1, Math.floor((e.clientX - r.left) / r.width * dim.card)));
    };
    let start = null, cur = null;
    plot.addEventListener("pointerdown", (e) => {
      start = cur = codeAt(e); plot.setPointerCapture(e.pointerId); this.preview(start, cur);
    });
    plot.addEventListener("pointermove", (e) => {
      const c = codeAt(e);
      showTip(e.clientX, e.clientY, fmtNum(this.last?.[c] ?? 0), dim.labels[c], "crashes");
      if (start !== null && c !== cur) { cur = c; this.preview(start, cur); }
    });
    plot.addEventListener("pointerleave", hideTip);
    plot.addEventListener("pointerup", () => {
      if (start === null) return;
      const a = Math.min(start, cur), b = Math.max(start, cur);
      start = null;
      this.preview(null);
      if (a === b) onToggle(a); else onRange(a, b);
    });
  }

  preview(a, b) {
    const lo = a === null ? -1 : Math.min(a, b), hi = a === null ? -2 : Math.max(a, b);
    this.cols.forEach((c, i) => c.el.classList.toggle("brush", i >= lo && i <= hi));
  }

  update(hist, selected) {
    let max = 0, total = 0;
    for (const v of hist) { if (v > max) max = v; total += v; }
    this.last = hist; this.lastTotal = total;
    const has = !!(selected && selected.size);
    this.el.classList.toggle("filtered", has);
    this.cols.forEach((c, code) => {
      c.bar.style.height = max ? `${(100 * hist[code] / max).toFixed(2)}%` : "0";
      c.el.classList.toggle("sel", has && selected.has(code));
      c.el.classList.toggle("off", has && !selected.has(code));
    });
  }
}
