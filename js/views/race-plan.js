// Race-day plan: your goal split into legs, how it compares with your zones, and how to pace it.

import { esc, fmtHMS } from '../util.js';
import { triPlan, paceChecks, raceStrategy, fmtGoal } from '../pacing.js';
import { statusBadge } from '../ui.js';

const STATUS_TEXT = { on: 'Realistic', close: 'Ambitious', off: 'Very ambitious' };

export function racePlanCard(profile, { compact = false } = {}) {
  const ps = profile.settings.plan, th = profile.settings.thresholds || {};
  const goal = ps.goal_time_s || null;
  const plan = triPlan(goal, th);
  const hasZones = th.css || th.ftp || th.run_pace;
  const legs = raceStrategy(plan, th);

  if (compact) {
    if (!goal) return '';
    return `<section class="card" style="margin-bottom:16px">
      <div class="spread"><h2>Race-day plan <span class="tag" style="margin-left:6px">Goal ${esc(fmtGoal(goal))}</span></h2><a class="btn small ghost" href="#/settings/race-plan">Pacing details</a></div>
      <div class="race-legs">${legs.map(l => `<div class="race-leg ${l.leg.startsWith('t') ? 'transition' : `s-${l.leg}`}"><b>${l.label}</b><span>${fmtHMS(l.time)}</span>${l.target ? `<small>${esc(l.target)}</small>` : ''}</div>`).join('')}</div>
    </section>`;
  }

  const checks = goal ? paceChecks(plan, th) : [];
  return `
    <section class="card stack" id="race-plan" style="margin-top:16px">
      <div class="spread"><h2>Race-day plan</h2>${goal ? `<span class="tag">Goal ${esc(fmtGoal(goal))}</span>` : ''}</div>
      ${!goal ? `<p class="muted small">Set a goal finish time above to get a target for each leg, built into your race-pace workouts and race day.
          ${hasZones ? `From your current training zones, a realistic finish today is around <b>${esc(fmtGoal(Math.round(plan.predicted / 60) * 60))}</b>.` : 'Add your training zones (or do the fitness tests) for a personal estimate.'}</p>`
        : `<p class="muted small">Your goal is split across the legs in proportion to what ${hasZones ? 'your current zones' : 'typical paces'} predict
          (${hasZones ? `about <b>${esc(fmtGoal(Math.round(plan.predicted / 60) * 60))}</b> today` : 'add your zones for a personal estimate'}). As your tests improve your zones, this gets more accurate.</p>
        <table class="data race-plan"><thead><tr><th>Leg</th><th>Target</th><th>Pace</th><th>Clock</th></tr></thead><tbody>
          ${(() => { let clock = 0; return legs.map(l => { clock += l.time; return `<tr><td>${l.label}</td><td>${fmtHMS(l.time)}</td><td>${esc(l.target || '—')}</td><td>${fmtHMS(clock)}</td></tr>`; }).join(''); })()}
        </tbody></table>
        ${checks.length ? `<div class="stack">${checks.map(c => `<div class="row" style="align-items:flex-start;flex-wrap:nowrap">${c.sport === 'bike' ? '<span class="tag">Bike</span>' : statusBadge(c.status, `${c.sport === 'swim' ? 'Swim' : 'Run'}: ${STATUS_TEXT[c.status]}`)}<span class="small">${esc(c.text)}</span></div>`).join('')}</div>` : ''}
        <div class="stack">${legs.map(l => `<div class="small"><b>${l.label}${l.target ? ` · ${esc(l.target)}` : ''}</b><br><span class="muted">${esc(l.notes)}</span></div>`).join('')}</div>`}
    </section>`;
}
