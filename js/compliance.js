// Plan adherence: how closely what you did matches what was planned.
// Doing much MORE than planned lowers the score just like doing less: the goal is the plan.

import { addDays, mondayOf, today } from './util.js';

export const STATUS = {
  on:       { label: 'On plan',   mark: '✓' },
  close:    { label: 'Close',     mark: '≈' },
  off:      { label: 'Off plan',  mark: '!' },
  missed:   { label: 'Missed',    mark: '✕' },
  skipped:  { label: 'Skipped',   mark: '–' },
  today:    { label: 'Today',     mark: '•' },
  upcoming: { label: 'Upcoming',  mark: '' },
};

// Score a done/planned ratio: full credit within ±10 %, then a straight-line drop.
export function ratioScore(r) {
  if (!(r >= 0)) return 0;
  return Math.max(0, Math.min(1, 1 - (Math.abs(r - 1) - 0.1) * 1.25));
}

export function indexActivities(activities) {
  const bySession = new Map();
  for (const a of activities) {
    if (!a.session_id) continue;
    if (!bySession.has(a.session_id)) bySession.set(a.session_id, []);
    bySession.get(a.session_id).push(a);
  }
  return bySession;
}

export function sessionStatus(s, bySession, ref = today()) {
  const acts = bySession.get(s.id) || [];
  if (acts.length) {
    const doneMin = acts.reduce((t, a) => t + (a.duration_s || 0), 0) / 60;
    const doneDist = acts.reduce((t, a) => t + (a.distance_m || 0), 0);
    let ratio = s.duration_min ? doneMin / s.duration_min : 1;
    // Swims are planned by distance; use it when both sides have one.
    if (s.sport === 'swim' && s.distance_m && doneDist > 0) ratio = doneDist / s.distance_m;
    const score = s.kind === 'race' ? 1 : ratioScore(ratio);
    const status = score >= 0.85 ? 'on' : score >= 0.5 ? 'close' : 'off';
    return { status, ratio, score, doneMin, acts, counted: true };
  }
  if (s.date > ref) return { status: 'upcoming', score: null, acts, counted: false };
  if (s.date === ref) return { status: s.skip_reason ? 'skipped' : 'today', score: s.skip_reason ? 0 : null, acts, counted: !!s.skip_reason };
  return { status: s.skip_reason ? 'skipped' : 'missed', score: 0, acts, counted: true };
}

// Adherence over a set of sessions = planned-minute-weighted average score of the
// sessions that have come due (past days, plus anything already done today).
export function summarize(sessions, bySession, ref = today()) {
  let w = 0, ws = 0, planned = 0, done = 0, dueCount = 0, onCount = 0;
  const counts = { on: 0, close: 0, off: 0, missed: 0, skipped: 0, today: 0, upcoming: 0 };
  for (const s of sessions) {
    const st = sessionStatus(s, bySession, ref);
    counts[st.status]++;
    planned += s.duration_min || 0;
    done += st.doneMin || 0;
    if (st.counted) {
      const weight = Math.max(10, s.duration_min || 0);
      w += weight; ws += weight * st.score; dueCount++;
      if (st.status === 'on') onCount++;
    }
  }
  return { adherence: w ? ws / w : null, planned, done, counts, dueCount, onCount, total: sessions.length };
}

export function weekRange(monday) { return [monday, addDays(monday, 6)]; }

export function sessionsInRange(sessions, from, to) {
  return sessions.filter(s => s.date >= from && s.date <= to);
}

// Activities that are not tied to any planned session ("extras").
export function extras(activities, from, to) {
  return activities.filter(a => !a.session_id && a.date >= from && a.date <= to);
}

// Consecutive finished weeks, counting back from last week, with adherence ≥ 80 %.
export function onPlanStreak(sessions, bySession, ref = today()) {
  let mon = addDays(mondayOf(ref), -7), streak = 0;
  for (let i = 0; i < 60; i++) {
    const wk = sessionsInRange(sessions, mon, addDays(mon, 6));
    if (!wk.length) break;
    const sum = summarize(wk, bySession, ref);
    if (sum.adherence == null || sum.adherence < 0.8) break;
    streak++; mon = addDays(mon, -7);
  }
  return streak;
}

export function pctText(v) { return v == null ? '—' : `${Math.round(v * 100)}%`; }

// Pick the planned session an imported activity most likely belongs to:
// same day and sport, not already done, closest planned duration.
export function bestMatch(activity, sessions, bySession) {
  const cands = sessions.filter(s => s.date === activity.date && s.sport === activity.sport && !(bySession.get(s.id) || []).length);
  if (!cands.length) return null;
  const min = (activity.duration_s || 0) / 60;
  cands.sort((a, b) => Math.abs(a.duration_min - min) - Math.abs(b.duration_min - min));
  return cands[0];
}
