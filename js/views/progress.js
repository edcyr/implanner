import { esc, today, addDays, fmtDay, fmtRange, fmtHours, fmtDist, SPORTS, SPORT_ORDER } from '../util.js';
import { state, sessionsBetween } from '../state.js';
import { summarize, onPlanStreak, pctText } from '../compliance.js';
import { stackedColumns } from '../charts.js';
import { phaseLabel } from '../ui.js';

export const title = 'Progress';
const SPORT_COLOR = { swim: 'var(--swim)', bike: 'var(--bike)', run: 'var(--run)', strength: 'var(--strength)', other: 'var(--other)' };

function weekRows(t) {
  return state.weeks.filter(w => w.monday <= t).map(w => {
    const sun = addDays(w.monday, 6);
    const list = sessionsBetween(w.monday, sun);
    const sum = summarize(list, state.bySession, t);
    const bySport = {};
    for (const a of state.activities) if (a.date >= w.monday && a.date <= sun) bySport[a.sport] = (bySport[a.sport] || 0) + a.duration_s / 3600;
    return { w, sun, sum, bySport };
  });
}

export function render() {
  const t = today();
  const first = state.weeks[0];
  if (!first || t < first.monday) {
    return `<div class="page-head"><div><h1>Progress</h1></div></div>
      <div class="empty"><h3>Your plan starts ${first ? fmtDay(first.monday, { weekday: 'long', month: 'long', day: 'numeric' }) : 'soon'}</h3><p>Come back after your first week to see how you're tracking.</p></div>`;
  }
  const due = sessionsBetween(first.monday, t);
  const season = summarize(due, state.bySession, t);
  const streak = onPlanStreak(state.sessions, state.bySession, t);
  const doneH = state.activities.filter(a => a.date >= first.monday).reduce((s, a) => s + a.duration_s, 0) / 3600;
  const totals = {};
  for (const a of state.activities) {
    if (a.date < first.monday) continue;
    const x = totals[a.sport] ||= { n: 0, s: 0, m: 0 };
    x.n++; x.s += a.duration_s; x.m += a.distance_m || 0;
  }
  const rows = weekRows(t);

  return `
  <div class="page-head"><div><h1>Progress</h1><p>How closely you're following your plan. Consistency beats heroics.</p></div></div>
  <section class="grid grid-3">
    <div class="card feature"><div class="muted small">Plan followed this season</div><div class="hero-figure" style="margin-top:6px">${pctText(season.adherence)}</div>
      <div class="muted small" style="margin-top:6px">${season.onCount} of ${season.dueCount} sessions on plan</div></div>
    <div class="stats" style="grid-template-columns:1fr 1fr">
      <div class="stat"><div class="label">On-plan streak</div><div class="value">${streak} wk</div><div class="sub">weeks at 80 % or better</div></div>
      <div class="stat"><div class="label">Training so far</div><div class="value">${doneH.toFixed(0)} h</div><div class="sub">of ${fmtHours(season.planned)} planned</div></div>
      <div class="stat"><div class="label">Missed</div><div class="value">${season.counts.missed}</div><div class="sub">sessions</div></div>
      <div class="stat"><div class="label">Skipped</div><div class="value">${season.counts.skipped}</div><div class="sub">with a reason</div></div>
    </div>
  </section>

  <section class="section"><h2>Hours each week <span class="muted">done, with the plan marked</span></h2>
    <div class="card">
      <div class="legend" style="margin-bottom:10px">${['swim', 'bike', 'run', 'strength'].map(k => `<span><i style="background:${SPORT_COLOR[k]}"></i>${SPORTS[k].label}</span>`).join('')}<span><i style="background:var(--ink);height:2px;vertical-align:3px"></i>Planned</span></div>
      <div class="chart" data-chart="hours" data-label="Hours done each week by sport, with planned hours marked"></div>
      <details class="table-view"><summary>Show as table</summary><table class="data"><thead><tr><th>Week</th><th>Planned</th>${['swim', 'bike', 'run', 'strength'].map(k => `<th>${SPORTS[k].label}</th>`).join('')}<th>On plan</th></tr></thead><tbody>
        ${rows.map(r => `<tr><td>${fmtRange(r.w.monday, r.sun)}</td><td>${fmtHours(r.sum.planned)}</td>${['swim', 'bike', 'run', 'strength'].map(k => `<td>${r.bySport[k] ? r.bySport[k].toFixed(1) : '—'}</td>`).join('')}<td>${pctText(r.sum.adherence)}</td></tr>`).join('')}
      </tbody></table></details>
    </div></section>

  <section class="section"><h2>Plan followed each week</h2>
    <div class="card"><div class="chart" data-chart="adh" data-label="Percent of plan followed each week"></div>
      <p class="muted small" style="margin-top:8px">Doing far more than planned lowers the score the same way doing less does.</p></div></section>

  <section class="section"><h2>By sport <span class="muted">this season</span></h2>
    <div class="list">${SPORT_ORDER.filter(k => totals[k]).map(k => `<div class="list-item"><span class="sport-ico s-${k}"></span>
      <div><div class="li-title">${SPORTS[k].label}</div><div class="li-sub">${totals[k].n} session${totals[k].n === 1 ? '' : 's'}</div></div>
      <div class="li-end"><b>${(totals[k].s / 3600).toFixed(1)} h</b>${totals[k].m ? `<br>${esc(fmtDist(totals[k].m, k))}` : ''}</div></div>`).join('') || '<div class="list-item"><span></span><div class="muted">Nothing logged yet.</div><span></span></div>'}</div></section>`;
}

export function mount(root) {
  const t = today();
  const rows = weekRows(t);
  const upcoming = state.weeks.filter(w => w.monday > t).slice(0, 4);
  const hEl = root.querySelector('[data-chart="hours"]'), aEl = root.querySelector('[data-chart="adh"]');
  const draw = () => {
    stackedColumns(hEl, [
      ...rows.map(r => ({
        label: fmtDay(r.w.monday, { month: 'short', day: 'numeric' }),
        segments: ['swim', 'bike', 'run', 'strength', 'other'].map(k => ({ value: r.bySport[k] || 0, color: SPORT_COLOR[k] })),
        marker: r.sum.planned / 60, highlight: t <= r.sun,
        tip: `<b>${fmtRange(r.w.monday, r.sun)}</b> · ${esc(phaseLabel(r.w))}<br>${['swim', 'bike', 'run', 'strength'].filter(k => r.bySport[k]).map(k => `<span class="k" style="background:${SPORT_COLOR[k]}"></span>${SPORTS[k].label} ${r.bySport[k].toFixed(1)} h`).join('<br>') || 'Nothing logged'}<br>Planned ${fmtHours(r.sum.planned)}`,
      })),
      ...upcoming.map(w => {
        const p = sessionsBetween(w.monday, addDays(w.monday, 6)).reduce((s, x) => s + x.duration_min, 0);
        return { label: fmtDay(w.monday, { month: 'short', day: 'numeric' }), segments: [], marker: p / 60, faded: true, tip: `<b>${fmtRange(w.monday, addDays(w.monday, 6))}</b><br>Coming up: ${fmtHours(p)} planned` };
      }),
    ], { height: 220, unit: ' h' });
    stackedColumns(aEl, rows.map(r => {
      const v = r.sum.adherence;
      return {
        label: fmtDay(r.w.monday, { month: 'short', day: 'numeric' }),
        segments: [{ value: v == null ? 0 : v * 100, color: v == null ? 'var(--axis)' : v >= 0.85 ? 'var(--good)' : v >= 0.5 ? 'var(--warn)' : 'var(--serious)' }],
        tip: `<b>${fmtRange(r.w.monday, r.sun)}</b><br>${pctText(v)} on plan${v == null ? '' : v >= 0.85 ? ' ✓' : v >= 0.5 ? ' (close)' : ' (off plan)'}<br>${r.sum.onCount} of ${r.sum.dueCount} sessions on plan`,
      };
    }), { height: 160, unit: ' %', max: 100 });
  };
  draw();
  const ro = new ResizeObserver(() => draw()); ro.observe(hEl);
  return () => ro.disconnect();
}

export const actions = {};
