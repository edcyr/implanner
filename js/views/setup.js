import { esc, DAY_NAMES, fmtDay, mondayOf, daysBetween, debounce } from '../util.js';
import { draftProfile, createPlan, isCloud, localSnapshot, moveLocalToCloud, load } from '../state.js';
import { buildWeeks, PHASES, RACE_PRESET } from '../plan.js';
import { stackedColumns } from '../charts.js';
import { toast } from '../ui.js';
import { go } from '../nav.js';

export const title = 'Set up your plan';
const PHASE_FILL = { prep: 'var(--phase-prep)', base: 'var(--phase-base)', build: 'var(--phase-build)', peak: 'var(--phase-peak)', taper: 'var(--phase-taper)', race: 'var(--phase-race)' };

const dayOptions = sel => DAY_NAMES.map((d, i) => `<option value="${i}" ${+sel === i ? 'selected' : ''}>${d}</option>`).join('');

// Plan fields shared with Settings.
export function planFields(ps) {
  return `
    <div class="form-grid">
      <label class="field"><span>Plan starts (Monday)</span><input type="date" name="start_date" value="${ps.start_date}" required></label>
      <label class="field"><span>Hours a week now</span><input type="number" name="current_hours" min="2" max="25" step="0.5" value="${ps.current_hours}" required><small>What you train in a normal week today</small></label>
      <label class="field"><span>Peak hours a week</span><input type="number" name="peak_hours" min="4" max="30" step="0.5" value="${ps.peak_hours}" required><small>Most first-timers peak at 12–16</small></label>
      <label class="field"><span>Easier week every</span><select name="recovery_every">
        <option value="4" ${+ps.recovery_every === 4 ? 'selected' : ''}>4th week (3:1)</option>
        <option value="3" ${+ps.recovery_every === 3 ? 'selected' : ''}>3rd week (2:1)</option></select></label>
      <label class="field"><span>Rest day</span><select name="rest_day">${dayOptions(ps.rest_day)}</select></label>
      <label class="field"><span>Long ride day</span><select name="long_ride_day">${dayOptions(ps.long_ride_day)}</select></label>
      <label class="field"><span>Long run day</span><select name="long_run_day">${dayOptions(ps.long_run_day)}</select></label>
      <label class="field"><span>Swims a week</span><select name="swims"><option value="3" ${+ps.swims === 3 ? 'selected' : ''}>3</option><option value="2" ${+ps.swims === 2 ? 'selected' : ''}>2</option></select></label>
      <label class="check wide"><input type="checkbox" name="strength" ${ps.strength ? 'checked' : ''}><span><b>Include strength work</b><br><span class="muted small">Two 30-minute sessions a week in prep and base, one in build</span></span></label>
    </div>`;
}

export function readPlanFields(form) {
  const v = Object.fromEntries(new FormData(form).entries());
  return {
    start_date: mondayOf(v.start_date),
    current_hours: +v.current_hours, peak_hours: +v.peak_hours, recovery_every: +v.recovery_every,
    rest_day: +v.rest_day, long_ride_day: +v.long_ride_day, long_run_day: +v.long_run_day,
    swims: +v.swims, strength: !!v.strength,
  };
}

export function validatePlan(ps, raceDate) {
  if (new Set([ps.rest_day, ps.long_ride_day, ps.long_run_day]).size < 3) return 'Pick different days for rest, the long ride and the long run.';
  if (!(ps.current_hours > 0) || !(ps.peak_hours > 0)) return 'Enter your weekly hours.';
  if (ps.peak_hours < ps.current_hours) return 'Peak hours should be at least your current hours.';
  if (daysBetween(ps.start_date, raceDate) < 28) return 'The race needs to be at least 4 weeks after the plan starts.';
  return null;
}

export function planPreview(ps, raceDate) {
  const err = validatePlan(ps, raceDate);
  if (err) return { html: `<p class="note">${esc(err)}</p>`, weeks: [] };
  const weeks = buildWeeks(ps, raceDate);
  const counts = {};
  weeks.forEach(w => { counts[w.phase] = (counts[w.phase] || 0) + 1; });
  const html = `<p><b>${weeks.length} weeks</b>, ${fmtDay(weeks[0].monday, { month: 'short', day: 'numeric' })} to race day.</p>
    <div class="legend" style="margin:8px 0 10px">${Object.keys(PHASES).filter(k => counts[k]).map(k => `<span><i style="background:${PHASE_FILL[k]}"></i>${PHASES[k].label} ${counts[k]} wk</span>`).join('')}</div>`;
  return { html, weeks };
}

export function drawPreview(el, weeks) {
  if (!weeks.length) { el.innerHTML = ''; return; }
  stackedColumns(el, weeks.map(w => ({
    label: fmtDay(w.monday, { month: 'short' }),
    segments: [{ value: w.hours, color: PHASE_FILL[w.phase] }],
    tip: `<b>Week ${w.index + 1} · ${PHASES[w.phase].label}</b><br>${fmtDay(w.monday)}<br>about ${w.hours.toFixed(1)} h${w.recovery ? '<br>Easier week' : ''}`,
  })), { height: 150, unit: ' h' });
}

export async function render() {
  const p = draftProfile();
  const snap = isCloud() ? await localSnapshot() : null;
  return `
  <div class="page-head"><div><h1>Let's build your plan</h1><p>A periodized season from now to race day. You can change any of this later.</p></div></div>
  ${snap ? `<section class="card" style="margin-bottom:16px"><h2>Bring your plan from this device?</h2>
    <p class="muted" style="margin:6px 0 12px">This browser has a plan with ${snap.sessions.length} sessions and ${snap.activities.length} logged workouts from before you signed in.</p>
    <button class="btn primary" data-action="move-local">Move it into my account</button></section>` : ''}
  <form class="stack" data-setup>
    <section class="card stack">
      <h2>You and your race</h2>
      <div class="form-grid">
        <label class="field"><span>Your name</span><input type="text" name="name" maxlength="60" value="${esc(p.name)}" placeholder="Shown to your crew" required></label>
        <label class="field"><span>Race</span><input type="text" name="race_name" maxlength="80" value="${esc(p.race_name)}" required></label>
        <label class="field"><span>Race date</span><input type="date" name="race_date" value="${p.race_date}" required>${p.race_date === RACE_PRESET.date ? '<small>Sunday, August 8, 2027 per the published schedule</small>' : ''}</label>
      </div>
    </section>
    <section class="card stack"><h2>Your training week</h2>${planFields(p.settings.plan)}</section>
    <section class="card"><h2 style="margin-bottom:8px">Your season</h2><div data-preview></div><div class="chart" data-chart="preview" data-label="Planned hours each week"></div></section>
    <p class="muted small">IMPlanner builds a general plan from common Ironman training principles. It isn't medical advice: check with a doctor before starting, and adjust to how you feel.</p>
    <div class="row" style="justify-content:flex-end"><button class="btn primary" type="submit">Create my plan</button></div>
  </form>`;
}

export function mount(root) {
  const form = root.querySelector('[data-setup]');
  const prev = root.querySelector('[data-preview]'), chartEl = root.querySelector('[data-chart="preview"]');
  const update = () => {
    const { html, weeks } = planPreview(readPlanFields(form), form.race_date.value);
    prev.innerHTML = html; drawPreview(chartEl, weeks);
  };
  update();
  form.addEventListener('input', debounce(update, 150));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const ps = readPlanFields(form);
    const err = validatePlan(ps, form.race_date.value);
    if (err) { toast(err); return; }
    const base = draftProfile();
    const btn = form.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = 'Building…';
    try {
      const n = await createPlan({ ...base, name: form.name.value.trim(), race_name: form.race_name.value.trim(), race_date: form.race_date.value, settings: { ...base.settings, plan: ps } });
      toast(`Plan ready: ${n} sessions`);
      const pendingJoin = sessionStorage.getItem('implanner:join');
      go(pendingJoin ? `#/join/${pendingJoin}` : '#/today');
    } catch (err2) { toast(err2.message); btn.disabled = false; btn.textContent = 'Create my plan'; }
  });
  const ro = new ResizeObserver(() => update()); ro.observe(chartEl);
  return () => ro.disconnect();
}

export const actions = {
  'move-local': async el => {
    el.disabled = true; el.textContent = 'Moving…';
    try { await moveLocalToCloud(); await load(); toast('Your plan is now in your account'); go('#/today'); }
    catch (e) { toast(e.message); el.disabled = false; el.textContent = 'Move it into my account'; }
  },
};
