import { esc, fmtDay, fmtHMS, fmtDist, fmtPace, fmtMin, SPORTS, sportIcon, addDays, timeAgo } from '../util.js';
import { state, activityById, sessionById, saveActivity, deleteActivity, sessionsBetween, activitiesFor, isCloud } from '../state.js';
import { sessionStatus } from '../compliance.js';
import { store } from '../store.js';
import { statusBadge, feelPicker, pickFeel, toast, confirmDialog, avatar } from '../ui.js';
import { lineChart, zoneBar } from '../charts.js';
import { openLogForm } from '../dialogs.js';
import { rerender, go } from '../nav.js';

export const title = 'Workout';

function stat(label, value, sub = '') {
  return value ? `<div class="stat"><div class="label">${label}</div><div class="value tnum">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>` : '';
}

export function render([id]) {
  const a = activityById(id);
  if (!a) return `<div class="empty"><h3>Workout not found</h3><p><a href="#/log">Back to your log</a></p></div>`;
  const s = a.session_id ? sessionById(a.session_id) : null;
  const st = s ? sessionStatus(s, state.bySession) : null;
  const cands = sessionsBetween(addDays(a.date, -3), addDays(a.date, 3)).filter(x => x.sport === a.sport && (x.id === a.session_id || !activitiesFor(x.id).length));
  const z = a.zones || {};
  const sp = a.sport;

  return `
  <div class="page-head">
    <div class="row" style="align-items:flex-start;gap:14px">${sportIcon(sp)}
      <div><h1>${esc(a.title || SPORTS[sp].label)}</h1>
      <p>${esc(fmtDay(a.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))}${a.start_time ? ` · ${new Date(a.start_time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''} · ${a.source === 'manual' ? 'Logged by hand' : `Imported (${esc(a.source.toUpperCase())})`}</p></div></div>
    <div class="row"><button class="btn" data-action="edit">Edit</button><button class="btn ghost danger" data-action="delete">Delete</button></div>
  </div>

  <section class="card">
    <h2 style="margin-bottom:10px">Against the plan</h2>
    ${s ? `<div class="row">${statusBadge(st.status)}<span><b>${esc(s.title)}</b>: planned ${esc(fmtMin(s.duration_min))}${s.distance_m ? ` / ${fmtDist(s.distance_m, 'swim')}` : ''}, done ${esc(fmtMin(st.doneMin))}${st.ratio != null ? ` (${Math.round(st.ratio * 100)}%)` : ''}</span></div>
          ${st.ratio > 1.2 && s.kind !== 'race' ? `<p class="note" style="margin-top:10px">That's more than planned. Extra volume isn't extra credit: the plan builds in rest for a reason.</p>` : ''}`
      : `<p class="muted">Not linked to a planned session, so it doesn't change your plan score.</p>`}
    <label class="field" style="margin-top:12px;max-width:520px"><span>Planned session</span>
      <select data-link><option value="">Not part of the plan (extra)</option>
      ${cands.map(x => `<option value="${x.id}" ${x.id === a.session_id ? 'selected' : ''}>${esc(fmtDay(x.date))}: ${esc(x.title)} (${esc(fmtMin(x.duration_min))})</option>`).join('')}</select></label>
  </section>

  <section class="section"><div class="stats">
    ${stat('Time', fmtHMS(a.duration_s), a.elapsed_s && a.elapsed_s - a.duration_s > 60 ? `${fmtHMS(a.elapsed_s)} elapsed` : '')}
    ${stat('Distance', fmtDist(a.distance_m, sp))}
    ${stat(sp === 'bike' ? 'Speed' : 'Pace', a.distance_m && sp !== 'strength' ? fmtPace(sp, a.distance_m, a.duration_s) : '')}
    ${stat('Avg heart rate', a.avg_hr ? `${a.avg_hr} bpm` : '', a.max_hr ? `max ${a.max_hr}` : '')}
    ${stat('Avg power', a.avg_power ? `${a.avg_power} W` : '', a.np ? `NP ${a.np} W` : '')}
    ${stat('Cadence', a.avg_cadence ? `${a.avg_cadence} ${sp === 'run' ? 'spm' : 'rpm'}` : '')}
    ${stat('Climbing', a.ascent_m ? `${Math.round(a.ascent_m)} m` : '')}
    ${stat('Pool', sp === 'swim' && a.pool_length_m != null ? (a.pool_length_m ? `${+a.pool_length_m.toFixed(2)} m` : 'Open water') : '')}
    ${stat('Effort', a.rpe ? `${a.rpe}/10` : '')}
  </div></section>

  <section class="section" data-series-wrap hidden><h2>Through the workout</h2>
    <div class="card stack" data-series></div></section>

  ${(z.hr || z.power) ? `<section class="section"><h2>Time in zones</h2><div class="card stack">
    ${z.hr ? zoneBar(z.hr, 'Heart rate zones') : ''}${z.power ? zoneBar(z.power, 'Power zones') : ''}</div></section>` : ''}

  <section class="section"><h2>How it went</h2>
    <form class="card stack" data-notes>
      ${feelPicker('feel', a.feel)}
      <label class="field"><span>Notes for your crew</span><textarea name="notes" maxlength="2000">${esc(a.notes || '')}</textarea></label>
      <div class="row" style="justify-content:flex-end"><button class="btn primary" type="submit">Save</button></div>
    </form></section>

  ${isCloud() ? `<section class="section" data-cheers-wrap hidden><h2>Cheers</h2><div class="list" data-cheers></div></section>` : ''}`;
}

export async function mount(root, [id]) {
  const a = activityById(id);
  if (!a) return;
  root.querySelector('[data-link]')?.addEventListener('change', async e => {
    await saveActivity({ ...a, session_id: e.target.value || null });
    toast(e.target.value ? 'Linked to your plan' : 'Marked as extra'); rerender();
  });
  root.querySelector('[data-notes]')?.addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    await saveActivity({ ...a, feel: f.feel.value || null, notes: f.notes.value.trim() });
    toast('Saved');
  });

  const series = await store.getSeries(id);
  const wrap = root.querySelector('[data-series]');
  if (series && wrap) {
    const parts = [];
    if (series.hr?.some(v => v)) parts.push(['Heart rate', series.hr, ' bpm', 'var(--critical)', v => Math.round(v)]);
    if (series.pw?.some(v => v)) parts.push(['Power', series.pw, ' W', 'var(--bike)', v => Math.round(v)]);
    if (series.sp?.some(v => v)) parts.push(a.sport === 'run'
      ? ['Pace', series.sp.map(v => v > 0.5 ? 1000 / v / 60 : null), ' min/km', 'var(--run)', v => `${Math.floor(v)}:${String(Math.round(v % 1 * 60)).padStart(2, '0')}`]
      : ['Speed', series.sp.map(v => v != null ? v * 3.6 : null), ' km/h', 'var(--swim)', v => v.toFixed(1)]);
    if (series.al?.some(v => v != null)) parts.push(['Elevation', series.al, ' m', 'var(--ink-2)', v => Math.round(v)]);
    if (parts.length) {
      wrap.innerHTML = parts.map((p, i) => `<div><b class="small">${p[0]}</b><div class="chart" data-line="${i}" data-label="${p[0]}"></div></div>`).join('');
      const draw = () => parts.forEach((p, i) => lineChart(wrap.querySelector(`[data-line="${i}"]`), series.t, p[1], { unit: p[2], color: p[3], fmt: p[4] }));
      root.querySelector('[data-series-wrap]').hidden = false;
      draw();
      const ro = new ResizeObserver(() => draw()); ro.observe(wrap);
    }
  }

  if (isCloud()) {
    try {
      const cheers = await store.cheersOn([id]);
      if (cheers.length) {
        const people = await store.profilesById([...new Set(cheers.map(c => c.from_user))]);
        root.querySelector('[data-cheers]').innerHTML = cheers.map(c => `<div class="list-item">${avatar(people[c.from_user]?.name, 'sm')}
          <div><div class="li-title">${c.emoji} ${esc(people[c.from_user]?.name || 'A crewmate')}</div>${c.message ? `<div class="li-sub">“${esc(c.message)}”</div>` : ''}</div>
          <span class="li-end">${esc(timeAgo(c.created_at))}</span></div>`).join('');
        root.querySelector('[data-cheers-wrap]').hidden = false;
      }
    } catch (e) { console.warn(e); }
  }
}

export const actions = {
  'pick-feel': el => pickFeel(el),
  edit: (el, e, ctx) => openLogForm({ activity: activityById(ctx.params[0]) }),
  delete: async (el, e, ctx) => {
    const ok = await confirmDialog({ title: 'Delete this workout?', message: 'This removes it from your log and your plan score. It cannot be undone.', confirm: 'Delete', danger: true });
    if (!ok) return;
    await deleteActivity(ctx.params[0]); toast('Workout deleted'); go('#/log');
  },
};
