import { esc, today, addDays, mondayOf, fmtRange, fmtHours, fmtDay, DAY_SHORT, icon, daysBetween } from '../util.js';
import { state, sessionsBetween, sessionById, saveSession, currentWeek, keyRaces } from '../state.js';
import { summarize, pctText } from '../compliance.js';
import { PHASES, weekFor, RACE_TYPES } from '../plan.js';
import { chip, statusBadge, phaseLabel, toast } from '../ui.js';
import { stackedColumns } from '../charts.js';
import { openSession, openSessionEditor } from '../dialogs.js';
import { rerender } from '../nav.js';
import { racePlanCard } from './race-plan.js';

export const title = 'Plan';
let showAll = false;

const PHASE_FILL = { prep: 'var(--phase-prep)', base: 'var(--phase-base)', build: 'var(--phase-build)', peak: 'var(--phase-peak)', taper: 'var(--phase-taper)', race: 'var(--phase-race)' };

const racesIn = (from, to) => keyRaces().filter(r => r.date >= from && r.date <= to);

function weekBlock(w, t) {
  const sun = addDays(w.monday, 6);
  const list = sessionsBetween(w.monday, sun);
  const sum = summarize(list, state.bySession, t);
  const isNow = t >= w.monday && t <= sun;
  const past = sun < t;
  let html = `<section class="week-block" id="wk-${w.index}">
    <div class="week-head">
      <h3>Week ${w.index + 1}${isNow ? ' · this week' : ''}</h3>
      <span class="phase-pill ph-${w.phase}">${esc(phaseLabel(w))}</span>
      ${w.recovery ? '<span class="tag">Easier week</span>' : ''}
      ${racesIn(w.monday, sun).map(r => `<span class="tag race-tag">🏁 ${esc(r.name)}</span>`).join('')}
      ${list.some(s => s.kind === 'test') ? `<span class="tag">⏱ ${w.index === 0 ? 'Baseline tests' : 'Test week'}</span>` : ''}
      <span class="muted">${fmtRange(w.monday, sun)} · ${fmtHours(sum.planned)} planned</span>
      ${(past || isNow) && sum.adherence != null ? statusBadge(sum.adherence >= 0.85 ? 'on' : sum.adherence >= 0.5 ? 'close' : 'off', `${pctText(sum.adherence)} on plan`) : ''}
    </div>
    <div class="week-grid flex-days">`;
  for (let i = 0; i < 7; i++) {
    const d = addDays(w.monday, i);
    const day = list.filter(s => s.date === d);
    html += `<div class="day ${d === t ? 'today' : ''}" data-date="${d}">
      <div class="day-head"><b>${DAY_SHORT[i]}</b><span>${fmtDay(d, { day: 'numeric' })}</span></div>
      ${day.map(s => chip(s, state.bySession, { draggable: true })).join('') || `<span class="rest">${icon('rest')}Rest</span>`}
      <button class="add" data-action="add" data-date="${d}" aria-label="Add a session on ${fmtDay(d)}">+</button></div>`;
  }
  return html + `</div></section>`;
}

export function render() {
  const t = today();
  const weeks = state.weeks;
  if (!weeks.length) return `<div class="empty"><h3>No plan yet</h3><p><a href="#/setup">Create your plan</a></p></div>`;
  const now = currentWeek(t);
  const startIdx = showAll ? 0 : Math.max(0, (now ? now.index : t < weeks[0].monday ? 0 : weeks.length) - 1);
  const p = state.profile;

  // phase strip
  const groups = [];
  weeks.forEach(w => { const g = groups[groups.length - 1]; if (g && g.phase === w.phase) g.n++; else groups.push({ phase: w.phase, n: 1, first: w.index }); });

  let html = `
  <div class="page-head">
    <div><h1>Your plan</h1><p>${weeks.length} weeks · ${fmtDay(weeks[0].monday, { month: 'short', day: 'numeric' })} to ${esc(p.race_name)} on ${fmtDay(p.race_date, { month: 'long', day: 'numeric', year: 'numeric' })}</p></div>
    <div class="row"><button class="btn" data-action="add" data-date="${t}">Add session</button><a class="btn ghost" href="#/settings/races">Key races</a><a class="btn ghost" href="#/settings/plan">Plan settings</a></div>
  </div>
  ${racePlanCard(p, { compact: true })}
  ${keyRaces().length ? `<section class="card" style="margin-bottom:16px"><div class="spread"><h2>Key races</h2><a class="btn small ghost" href="#/settings/races">Add or change</a></div>
    <div class="list" style="margin-top:10px">${keyRaces().map(r => {
      const left = daysBetween(t, r.date), wk = weekFor(state.weeks, r.date);
      return `<a class="list-item" href="#wk-${wk?.index ?? 0}" data-action="jump" data-week="${wk?.index ?? 0}"><span class="race-flag" aria-hidden="true">🏁</span>
        <div><div class="li-title">${esc(r.name)} <span class="tag">${r.priority === 'C' ? 'C race' : 'B race'}</span></div>
        <div class="li-sub">${esc(fmtDay(r.date, { weekday: 'short', month: 'long', day: 'numeric' }))} · ${esc(RACE_TYPES[r.type]?.label || '')}${wk ? ` · week ${wk.index + 1}` : ''}</div></div>
        <span class="li-end">${left > 0 ? `${left} days` : left === 0 ? 'Today!' : 'Done'}</span></a>`;
    }).join('')}</div></section>` : ''}
  <section class="card">
    <div class="spread" style="margin-bottom:10px"><h2>Weekly hours</h2><span class="muted small">Tap a week to jump to it</span></div>
    <div class="row" style="gap:2px;margin:0 6px 8px 34px" aria-hidden="true">${groups.map(g => `<div style="flex:${g.n};min-width:0;text-align:center;font-size:11px;font-weight:650;color:var(--ink-2);border-bottom:2px solid ${PHASE_FILL[g.phase]};white-space:nowrap;overflow:hidden">${g.n >= 2 ? esc(PHASES[g.phase].label) : ''}</div>`).join('')}</div>
    <div class="chart" data-chart="season" data-label="Planned hours per week"></div>
    <details class="table-view"><summary>Show as table</summary><table class="data"><thead><tr><th>Week</th><th>Phase</th><th>Dates</th><th>Planned</th><th>Done</th><th>On plan</th></tr></thead><tbody>
      ${weeks.map(w => { const sum = summarize(sessionsBetween(w.monday, addDays(w.monday, 6)), state.bySession, t); return `<tr><td>${w.index + 1}</td><td>${esc(phaseLabel(w))}</td><td>${fmtRange(w.monday, addDays(w.monday, 6))}</td><td>${fmtHours(sum.planned)}</td><td>${sum.done ? fmtHours(sum.done) : '—'}</td><td>${pctText(sum.adherence)}</td></tr>`; }).join('')}
    </tbody></table></details>
  </section>
  <p class="muted small" style="margin-top:14px">A general template, not medical advice. Move sessions to fit your life (drag them, or open one and change its date) and listen to your body.</p>`;

  if (startIdx > 0) html += `<div style="margin-top:18px"><button class="btn small ghost" data-action="show-all">Show ${startIdx} earlier week${startIdx > 1 ? 's' : ''}</button></div>`;
  for (const w of weeks.slice(startIdx)) html += weekBlock(w, t);
  return html;
}

export function mount(root) {
  const t = today();
  const el = root.querySelector('[data-chart="season"]');
  if (!el) return;
  const draw = () => stackedColumns(el, state.weeks.map(w => {
    const list = sessionsBetween(w.monday, addDays(w.monday, 6));
    const sum = summarize(list, state.bySession, t);
    const training = list.filter(s => s.kind !== 'race').reduce((a, s) => a + s.duration_min, 0);   // race day itself would dwarf the season
    const raceNames = racesIn(w.monday, addDays(w.monday, 6)).map(r => esc(r.name));
    const tip = `<b>Week ${w.index + 1} · ${esc(phaseLabel(w))}</b><br>${fmtRange(w.monday, addDays(w.monday, 6))}${raceNames.length ? `<br>🏁 ${raceNames.join(', ')}` : ''}<br>${fmtHours(training)} planned${training < sum.planned ? ' + race day' : ''}${sum.done ? `<br>${fmtHours(sum.done)} done · ${pctText(sum.adherence)} on plan` : ''}${w.recovery ? '<br>Easier week' : ''}`;
    return {
      label: fmtDay(w.monday, { month: 'short', day: 'numeric' }),
      segments: [{ value: training / 60, color: PHASE_FILL[w.phase] }],
      highlight: t >= w.monday && t <= addDays(w.monday, 6), tip, href: `#wk-${w.index}`,
    };
  }), { height: 180, unit: ' h' });
  draw();
  el.addEventListener('click', e => {
    const h = e.target.closest('[data-href]')?.dataset.href;
    if (!h) return;
    const idx = +h.split('-')[1];
    const target = root.querySelector(h);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else { showAll = true; rerender(); requestAnimationFrame(() => document.getElementById(`wk-${idx}`)?.scrollIntoView({ block: 'start' })); }
  });
  const ro = new ResizeObserver(() => draw());
  ro.observe(el);

  // Drag a session chip to another day.
  let dragId = null;
  root.addEventListener('dragstart', e => {
    const c = e.target.closest('.chip[draggable]');
    if (!c) return;
    dragId = c.dataset.id; c.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId);
  });
  root.addEventListener('dragend', e => { e.target.closest?.('.chip')?.classList.remove('dragging'); root.querySelectorAll('.day.drop').forEach(d => d.classList.remove('drop')); });
  root.addEventListener('dragover', e => {
    const d = e.target.closest('.day[data-date]');
    if (!d || !dragId) return;
    e.preventDefault();
    root.querySelectorAll('.day.drop').forEach(x => x !== d && x.classList.remove('drop'));
    d.classList.add('drop');
  });
  root.addEventListener('drop', async e => {
    const d = e.target.closest('.day[data-date]');
    if (!d || !dragId) return;
    e.preventDefault();
    const s = sessionById(dragId); dragId = null;
    if (!s || s.date === d.dataset.date) return rerender();
    const wk = weekFor(state.weeks, d.dataset.date);
    await saveSession({ ...s, date: d.dataset.date, week: wk?.index ?? s.week, phase: wk?.phase ?? s.phase });
    toast(`Moved to ${fmtDay(d.dataset.date, { weekday: 'long' })}`);
    rerender();
  });
  return () => ro.disconnect();
}

export const actions = {
  jump: el => {
    const target = document.getElementById(`wk-${el.dataset.week}`);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else { showAll = true; rerender(); requestAnimationFrame(() => document.getElementById(`wk-${el.dataset.week}`)?.scrollIntoView({ block: 'start' })); }
  },
  'open-session': el => openSession(el.dataset.id),
  add: el => openSessionEditor(null, { date: el.dataset.date }),
  'show-all': () => { showAll = true; rerender(); },
};
