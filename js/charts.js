// Hand-rolled SVG charts sized to their container. Thin marks, 2 px gaps between
// stacked segments, 4 px rounded data-ends, hairline grid, hover tooltips via data-tip.

import { esc, fmtHMS } from './util.js';

const NS = 'http://www.w3.org/2000/svg';

// Clean axis: step of 1/2/2.5/5 × 10^k giving at most `n` intervals.
function niceScale(v, n = 4) {
  if (!(v > 0)) return { max: 1, step: 0.25 };
  const raw = v / n, p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= raw);
  return { max: Math.ceil(v / step - 1e-9) * step, step };
}
function topRounded(x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  if (h <= 0) return '';
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

// Stacked columns. cols: [{ label, segments: [{ value, color }], marker?, tip, faded?, highlight? }]
export function stackedColumns(el, cols, { height = 220, unit = '', ticks = 4, labelEvery = 0, max: fixedMax = null } = {}) {
  const W = Math.max(280, el.clientWidth || 600), H = height;
  const m = { t: 10, r: 6, b: 24, l: 34 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const sc = fixedMax ? { max: fixedMax, step: fixedMax / ticks } : niceScale(Math.max(...cols.map(c => Math.max(c.marker || 0, c.segments.reduce((a, s) => a + s.value, 0)))), ticks);
  const max = sc.max, nTicks = Math.round(max / sc.step);
  const band = iw / Math.max(1, cols.length), bw = Math.min(24, Math.max(3, band * 0.62));
  const y = v => m.t + ih - v / max * ih;
  const every = labelEvery || Math.ceil(cols.length / Math.max(1, Math.floor(iw / 46)));
  let s = `<svg xmlns="${NS}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(el.dataset.label || 'Chart')}">`;
  for (let i = 0; i <= nTicks; i++) {
    const v = sc.step * i, yy = y(v);
    s += `<line class="${i ? 'grid-line' : 'axis-line'}" x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}"/>`;
    s += `<text x="${m.l - 6}" y="${yy + 4}" text-anchor="end">${+v.toFixed(1)}${i === nTicks ? unit : ''}</text>`;
  }
  cols.forEach((c, i) => {
    const cx = m.l + band * i + band / 2, x = cx - bw / 2;
    s += `<g class="col"${c.faded ? ' opacity=".45"' : ''}>`;
    if (c.highlight) s += `<rect x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ih}" fill="var(--wash)" opacity=".7"/><circle cx="${cx}" cy="${m.t + ih + 5}" r="2.5" fill="var(--ink)"/>`;
    let acc = 0;
    const segs = c.segments.filter(sg => sg.value > 0);
    segs.forEach((sg, j) => {
      const y0 = y(acc), y1 = y(acc + sg.value);
      const h = Math.max(0, y0 - y1 - (j > 0 ? 2 : 0));   // 2 px surface gap above the segment below
      const top = y1;
      s += j === segs.length - 1
        ? `<path class="bar" d="${topRounded(x, top, bw, h, 4)}" fill="${sg.color}"/>`
        : `<rect class="bar" x="${x}" y="${top}" width="${bw}" height="${h}" fill="${sg.color}"/>`;
      acc += sg.value;
    });
    if (c.marker) {
      const ym = y(c.marker);
      s += `<line x1="${cx - bw / 2 - 3}" x2="${cx + bw / 2 + 3}" y1="${ym}" y2="${ym}" stroke="var(--ink)" stroke-width="2" stroke-linecap="round"/>`;
    }
    if (i % every === 0) s += `<text x="${cx}" y="${H - 6}" text-anchor="middle">${esc(c.label)}</text>`;
    s += `</g><rect class="hit" x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ih}" data-tip="${esc(c.tip || '')}"${c.href ? ` data-href="${esc(c.href)}" style="cursor:pointer"` : ''}/>`;
  });
  el.innerHTML = s + '</svg>';
}

// Single-series line over time (activity detail). One chart per measure: never a second axis.
export function lineChart(el, t, values, { color = 'var(--swim)', unit = '', height = 120, fmt = v => Math.round(v) } = {}) {
  const pts = t.map((tt, i) => [tt, values[i]]).filter(p => p[1] != null);
  if (pts.length < 2) { el.innerHTML = ''; return; }
  const W = Math.max(280, el.clientWidth || 600), H = height, m = { t: 8, r: 8, b: 20, l: 40 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const t0 = pts[0][0], t1 = pts[pts.length - 1][0] || 1;
  let lo = Math.min(...pts.map(p => p[1])), hi = Math.max(...pts.map(p => p[1]));
  if (hi - lo < 1e-6) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.1; lo = Math.max(0, lo - pad); hi += pad;
  const X = tt => m.l + (tt - t0) / (t1 - t0 || 1) * iw, Y = v => m.t + ih - (v - lo) / (hi - lo) * ih;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
  const area = `${d}L${X(pts[pts.length - 1][0]).toFixed(1)},${m.t + ih}L${X(pts[0][0]).toFixed(1)},${m.t + ih}Z`;
  let s = `<svg xmlns="${NS}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(el.dataset.label || 'Chart')}">`;
  [lo, (lo + hi) / 2, hi].forEach((v, i) => {
    s += `<line class="${i ? 'grid-line' : 'axis-line'}" x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${fmt(v)}</text>`;
  });
  for (let k = 0; k <= 4; k++) {
    const tt = t0 + (t1 - t0) * k / 4;
    s += `<text x="${X(tt)}" y="${H - 4}" text-anchor="${k === 0 ? 'start' : k === 4 ? 'end' : 'middle'}">${fmtHMS(tt - t0)}</text>`;
  }
  s += `<path d="${area}" fill="${color}" opacity=".1"/><path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  s += `<line class="xh" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}" stroke="var(--axis)" stroke-width="1" visibility="hidden"/>`;
  s += `<circle class="xd" r="4.5" fill="${color}" stroke="var(--surface)" stroke-width="2" visibility="hidden"/>`;
  s += `<rect class="hit" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}"/></svg>`;
  el.innerHTML = s;
  const svg = el.querySelector('svg'), xh = svg.querySelector('.xh'), xd = svg.querySelector('.xd'), tip = document.getElementById('tip');
  const hit = svg.querySelector('.hit');
  hit.addEventListener('pointermove', e => {
    const r = svg.getBoundingClientRect(), px = e.clientX - r.left;
    const tt = t0 + (px - m.l) / iw * (t1 - t0);
    let best = pts[0];
    for (const p of pts) if (Math.abs(p[0] - tt) < Math.abs(best[0] - tt)) best = p;
    xh.setAttribute('x1', X(best[0])); xh.setAttribute('x2', X(best[0])); xh.setAttribute('visibility', 'visible');
    xd.setAttribute('cx', X(best[0])); xd.setAttribute('cy', Y(best[1])); xd.setAttribute('visibility', 'visible');
    hit.dataset.tip = `<b>${fmt(best[1])}${unit}</b> at ${fmtHMS(best[0] - t0)}`;
  });
  hit.addEventListener('pointerleave', () => { xh.setAttribute('visibility', 'hidden'); xd.setAttribute('visibility', 'hidden'); tip.style.display = 'none'; });
}

// Time in zones as one horizontal bar with an ordinal single-hue ramp (Z1 light → Z5 dark).
const ZONE_RAMP = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'];
export function zoneBar(seconds, label) {
  const total = seconds.reduce((a, b) => a + b, 0);
  if (!total) return '';
  const cells = seconds.map((v, i) => v ? `<span style="flex:${v};background:${ZONE_RAMP[i]}" data-tip="<b>Zone ${i + 1}</b><br>${fmtHMS(v)} · ${Math.round(v / total * 100)}%"></span>` : '').join('');
  const legend = seconds.map((v, i) => `<span><i style="background:${ZONE_RAMP[i]}"></i>Z${i + 1} ${Math.round(v / total * 100)}%</span>`).join('');
  return `<div class="stack"><div class="spread"><b class="small">${esc(label)}</b></div><div class="zonebar" role="img" aria-label="${esc(label)}">${cells}</div><div class="legend">${legend}</div></div>`;
}
