import { esc, DAY_NAMES, DAY_SHORT, SPORTS, sportIcon, fmtDay, fmtShort, mondayOf, daysBetween, debounce, dow, byTime } from '../util.js';
import { draftProfile, createPlan, isCloud, localSnapshot, moveLocalToCloud, load } from '../state.js';
import { buildWeeks, PHASES, RACE_PRESET, resolveLayout, weekSessions, LAYOUT_SPORTS } from '../plan.js';
import { stackedColumns } from '../charts.js';
import { toast } from '../ui.js';
import { go } from '../nav.js';
import { racesCardHtml, mountRacesCard } from './races-card.js';
import { parseGoal, fmtGoal } from '../pacing.js';

let setupRaces = null;     // key races added before the plan exists

export const title = 'Set up your plan';
const PHASE_FILL = { prep: 'var(--phase-prep)', base: 'var(--phase-base)', build: 'var(--phase-build)', peak: 'var(--phase-peak)', taper: 'var(--phase-taper)', race: 'var(--phase-race)' };

const dayOptions = sel => DAY_NAMES.map((d, i) => `<option value="${i}" ${+sel === i ? 'selected' : ''}>${d}</option>`).join('');

// The day-by-day grid: tick the days for each sport, optionally a fixed start time.
function layoutGrid(ps) {
  const L = resolveLayout(ps);
  const longDay = { bike: +ps.long_ride_day, run: +ps.long_run_day };
  return `
    <div class="lg-row lg-head" aria-hidden="true"><span></span>${DAY_SHORT.map(d => `<span>${d[0]}<span class="lg-full">${d.slice(1)}</span></span>`).join('')}<span class="lg-head-time">Start time</span></div>
    ${LAYOUT_SPORTS.map(sp => `<div class="lg-row" role="group" aria-label="${SPORTS[sp].label} days">
      <span class="lg-sport">${sportIcon(sp)}<span>${SPORTS[sp].label}</span></span>
      ${[0, 1, 2, 3, 4, 5, 6].map(d => {
        const isLong = longDay[sp] === d;
        const on = isLong || L[sp].days.includes(d);
        return `<label class="lg-cell s-${sp}" title="${esc(`${SPORTS[sp].label} on ${DAY_NAMES[d]}${isLong ? ` (long ${sp === 'bike' ? 'ride' : 'run'})` : ''}`)}">
          <input type="checkbox" name="${sp}_d${d}" ${on ? 'checked' : ''} ${isLong ? 'disabled' : ''} aria-label="${esc(`${SPORTS[sp].label} on ${DAY_NAMES[d]}`)}">
          <span class="lg-mark" aria-hidden="true">${isLong ? 'L' : '✓'}</span></label>`;
      }).join('')}
      <input type="time" class="lg-time" name="${sp}_time" value="${esc(L[sp].time)}" aria-label="${esc(`${SPORTS[sp].label} start time (optional)`)}">
    </div>`).join('')}`;
}

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
    </div>
    <div class="stack" style="margin-top:6px">
      <div><b>Your week</b><p class="muted small">Tick the days you can do each sport, and add a start time for fixed slots like pool times. Days with nothing ticked are rest days.</p></div>
      <div class="layout-grid" data-layout>${layoutGrid(ps)}</div>
      <div class="form-grid">
        <label class="field"><span>Long ride day</span><select name="long_ride_day">${dayOptions(ps.long_ride_day)}</select></label>
        <label class="field"><span>Long run day</span><select name="long_run_day">${dayOptions(ps.long_run_day)}</select></label>
        <label class="check wide"><input type="checkbox" name="bricks" ${ps.bricks !== false ? 'checked' : ''}><span><b>Brick run after the long ride</b><br><span class="muted small">A short run straight off the bike, from the base phase on</span></span></label>
        <label class="check wide"><input type="checkbox" name="tests" ${ps.tests !== false ? 'checked' : ''}><span><b>Fitness tests</b><br><span class="muted small">A swim CSS test, a 20-minute bike test and a 30-minute run time trial: a baseline in week 1, then in the last hard week of each block (before the easier week) through base and build. Your results update your training zones.</span></span></label>
      </div>
      <div data-typical></div>
    </div>`;
}

export function readPlanFields(form) {
  const v = Object.fromEntries(new FormData(form).entries());
  const layout = {};
  for (const sp of LAYOUT_SPORTS) {
    layout[sp] = { days: [0, 1, 2, 3, 4, 5, 6].filter(d => v[`${sp}_d${d}`]), time: v[`${sp}_time`] || '' };
  }
  return {
    start_date: mondayOf(v.start_date),
    current_hours: +v.current_hours, peak_hours: +v.peak_hours, recovery_every: +v.recovery_every,
    long_ride_day: +v.long_ride_day, long_run_day: +v.long_run_day, bricks: !!v.bricks, tests: !!v.tests, layout,
    ...('goal_time' in v ? { goal_time_s: parseGoal(v.goal_time, true) || null } : {}),
  };
}

export function validatePlan(ps, raceDate) {
  const L = resolveLayout(ps);
  if (!L.swim.days.length) return 'Pick at least one swim day.';
  if (ps.long_ride_day === ps.long_run_day) return 'Pick different days for the long ride and the long run.';
  if (!(ps.current_hours > 0) || !(ps.peak_hours > 0)) return 'Enter your weekly hours.';
  if (ps.goal_time_s && !(ps.goal_time_s > 6 * 3600 && ps.goal_time_s < 18 * 3600)) return 'Enter a goal finish time like 12:30 (between 6 and 17 hours).';
  if (ps.peak_hours < ps.current_hours) return 'Peak hours should be at least your current hours.';
  if (daysBetween(ps.start_date, raceDate) < 28) return 'The race needs to be at least 4 weeks after the plan starts.';
  return null;
}

// A representative week (first full base week) so you can see where everything lands.
function typicalWeek(ps, weeks) {
  const wk = weeks.find(w => w.phase === 'base' && !w.recovery) || weeks.find(w => !w.recovery) || weeks[0];
  if (!wk) return '';
  const list = weekSessions(wk, ps, {}).sort(byTime);
  const rest = [0, 1, 2, 3, 4, 5, 6].filter(d => !list.some(x => dow(x.date) === d));
  return `<div class="card" style="background:var(--wash);border:0;padding:14px">
    <p class="small"><b>A typical ${PHASES[wk.phase].label.toLowerCase()} week</b> <span class="muted">(week ${wk.index + 1}, about ${wk.hours.toFixed(1)} h)</span></p>
    <div class="week-grid flex-days typical" style="margin-top:8px">${DAY_SHORT.map((d, i) => `<div class="day">
      <div class="day-head"><b>${d}</b></div>
      ${list.filter(x => dow(x.date) === i).map(x => `<span class="chip st-upcoming" title="${esc(x.title)}">${sportIcon(x.sport)}<span class="chip-txt">${x.at_time ? `<span class="chip-time">${esc(x.at_time.replace(/^0/, ''))}</span>` : ''}${esc(fmtShort(x.duration_min))}</span></span>`).join('') || `<span class="rest">Rest</span>`}
    </div>`).join('')}</div>
    ${rest.length ? '' : `<p class="note" style="margin-top:10px">No rest day this way. Most plans keep at least one day a week free.</p>`}
  </div>`;
}

export function planPreview(ps, raceDate) {
  const err = validatePlan(ps, raceDate);
  if (err) return { html: `<p class="note">${esc(err)}</p>`, weeks: [], typical: '' };
  const weeks = buildWeeks(ps, raceDate);
  const counts = {};
  weeks.forEach(w => { counts[w.phase] = (counts[w.phase] || 0) + 1; });
  const html = `<p><b>${weeks.length} weeks</b>, ${fmtDay(weeks[0].monday, { month: 'short', day: 'numeric' })} to race day.</p>
    <div class="legend" style="margin:8px 0 10px">${Object.keys(PHASES).filter(k => counts[k]).map(k => `<span><i style="background:${PHASE_FILL[k]}"></i>${PHASES[k].label} ${counts[k]} wk</span>`).join('')}</div>`;
  return { html, weeks, typical: typicalWeek(ps, weeks) };
}

// Keep the grid in step with the long-day pickers, and refresh previews on any change.
export function wirePlanFields(form, onChange) {
  form.addEventListener('change', e => {
    if (e.target.name === 'long_ride_day' || e.target.name === 'long_run_day') {
      form.querySelector('[data-layout]').innerHTML = layoutGrid(readPlanFields(form));
    }
  });
  form.addEventListener('input', debounce(onChange, 150));
  form.addEventListener('change', debounce(onChange, 150));
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
  <section class="photo-banner">
    <img src="img/bike-checkin.jpg" srcset="img/bike-checkin-1000.jpg 1000w, img/bike-checkin.jpg 1500w" sizes="(max-width: 899px) 100vw, 1000px"
      alt="Bike check-in at IRONMAN Mont-Tremblant: rows of racked bikes under a blue sky, with white tents and green hills behind">
    <div class="pb-copy"><h1>Let's build your plan</h1><p>A periodized season from now to race day. You can change any of this later.</p></div>
    <span class="photo-credit">Bike check-in, Mont-Tremblant 2013</span>
  </section>
  ${snap ? `<section class="card" style="margin-bottom:16px"><h2>Bring your plan from this device?</h2>
    <p class="muted" style="margin:6px 0 12px">This browser has a plan with ${snap.sessions.length} sessions and ${snap.activities.length} logged workouts from before you signed in.</p>
    <button class="btn primary" data-action="move-local">Move it into my account</button></section>` : ''}
  <form class="stack" data-setup id="setupform">
    <section class="card stack">
      <h2>You and your race</h2>
      <div class="form-grid">
        <label class="field"><span>Your name</span><input type="text" name="name" maxlength="60" value="${esc(p.name)}" placeholder="Shown to your crew" required></label>
        <label class="field"><span>Race</span><input type="text" name="race_name" maxlength="80" value="${esc(p.race_name)}" required></label>
        <label class="field"><span>Race date</span><input type="date" name="race_date" value="${p.race_date}" required>${p.race_date === RACE_PRESET.date ? '<small>Sunday, August 8, 2027 per the published schedule</small>' : ''}</label>
        <label class="field"><span>Goal finish time (h:mm)</span><input type="text" name="goal_time" inputmode="numeric" placeholder="e.g. 12:30" value="${esc(fmtGoal(p.settings.plan.goal_time_s))}"><small>Optional. Sets your race-pace targets; change it any time.</small></label>
      </div>
    </section>
    <section class="card stack"><h2>Your training week</h2>${planFields(p.settings.plan)}</section>
    <section class="card"><h2 style="margin-bottom:8px">Your season</h2><div data-preview></div><div class="chart" data-chart="preview" data-label="Planned hours each week"></div></section>
  </form>
  ${racesCardHtml()}
  <p class="muted small" style="margin-top:16px">IMPlanner builds a general plan from common Ironman training principles. It isn't medical advice: check with a doctor before starting, and adjust to how you feel.</p>
  <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn primary" type="submit" form="setupform">Create my plan</button></div>`;
}

export function mount(root) {
  const form = root.querySelector('[data-setup]');
  const prev = root.querySelector('[data-preview]'), chartEl = root.querySelector('[data-chart="preview"]');
  const update = () => {
    const { html, weeks, typical } = planPreview(readPlanFields(form), form.race_date.value);
    prev.innerHTML = html; drawPreview(chartEl, weeks);
    form.querySelector('[data-typical]').innerHTML = typical;
  };
  update();
  wirePlanFields(form, update);
  setupRaces ??= [...(draftProfile().settings.plan.races || [])];
  mountRacesCard(root, {
    get: () => setupRaces,
    save: async races => { setupRaces = races; },
    bounds: () => ({ start: readPlanFields(form).start_date, end: form.race_date.value }),
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const ps = readPlanFields(form);
    const err = validatePlan(ps, form.race_date.value);
    if (err) { toast(err); return; }
    const base = draftProfile();
    const btn = root.querySelector('[form=setupform]'); btn.disabled = true; btn.textContent = 'Building…';
    try {
      const n = await createPlan({ ...base, name: form.name.value.trim(), race_name: form.race_name.value.trim(), race_date: form.race_date.value, settings: { ...base.settings, plan: { ...ps, races: setupRaces } } });
      setupRaces = null;
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
