// Season plan generator: periodized weeks (prep → base → build → peak → taper → race)
// with sessions laid out on the athlete's chosen days. Everything it makes is editable.

import { addDays, mondayOf, daysBetween, uid, fmtMin, fmtMMSS, clamp } from './util.js';

export const PHASES = {
  prep:  { label: 'Prep',      blurb: 'Build the habit, technique and strength. Mostly easy.' },
  base:  { label: 'Base',      blurb: 'Grow the aerobic engine: steady volume, mostly Zone 2.' },
  build: { label: 'Build',     blurb: 'Longer sessions and race-specific intensity.' },
  peak:  { label: 'Peak',      blurb: 'Your biggest weeks. Rehearse race day: pacing, fuel, kit.' },
  taper: { label: 'Taper',     blurb: 'Volume drops, a little intensity stays. Sleep and eat well.' },
  race:  { label: 'Race week', blurb: 'Stay fresh and calm. The work is done.' },
};

export const RACE_PRESET = { name: 'IRONMAN Canada–Ottawa', date: '2027-08-08' };

export function defaultPlanSettings(ref) {
  const d = new Date(); const t = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const mon = mondayOf(ref || t);
  return {
    start_date: mon === mondayOf(t) && t !== mon ? addDays(mon, 7) : mon,   // next Monday unless today is Monday
    current_hours: 6,
    peak_hours: 14,
    recovery_every: 4,     // 3 build weeks + 1 easier week
    rest_day: 0,           // Monday
    long_ride_day: 5,      // Saturday
    long_run_day: 6,       // Sunday
    swims: 3,
    strength: true,
  };
}

// ---- weeks ---------------------------------------------------------------

export function buildWeeks(ps, raceDate) {
  const start = mondayOf(ps.start_date);
  const raceMon = mondayOf(raceDate);
  const W = Math.floor(daysBetween(start, raceMon) / 7) + 1;
  if (W < 1) return [];

  const taper = Math.min(2, W - 1);
  const A = W - 1 - taper;
  const peak = A >= 10 ? 3 : A >= 5 ? 2 : 0;
  const R = A - peak;
  const build = Math.min(12, Math.round(R * 0.45));
  const base = Math.min(16, R - build);
  const prep = R - build - base;
  const S = prep + base + build;

  const cur = +ps.current_hours || 6, pk = Math.max(+ps.peak_hours || 14, cur);
  const N = +ps.recovery_every || 4;
  const peakShape = peak === 3 ? [1, 1, 0.85] : [1, 0.9];
  const taperShape = taper === 2 ? [0.7, 0.5] : [0.6];

  const weeks = [];
  let lastLoad = cur;
  for (let i = 0; i < W; i++) {
    let phase, pw, recovery = false, hours;
    if (i < prep) { phase = 'prep'; pw = i; }
    else if (i < prep + base) { phase = 'base'; pw = i - prep; }
    else if (i < S) { phase = 'build'; pw = i - prep - base; }
    else if (i < S + peak) { phase = 'peak'; pw = i - S; }
    else if (i < W - 1) { phase = 'taper'; pw = i - S - peak; }
    else { phase = 'race'; pw = 0; }

    if (i < S) {
      const j = S - 1 - i;                 // weeks remaining before peak; the last one is easy
      recovery = i >= 2 && j % N === 0;
      const n = base + build;
      hours = i < prep ? cur : cur + (0.95 * pk - cur) * Math.pow((i - prep + 1) / n, 0.9);
      if (recovery) hours = lastLoad * 0.65; else lastLoad = hours;
    } else if (phase === 'peak') hours = pk * peakShape[pw];
    else if (phase === 'taper') hours = pk * taperShape[pw];
    else hours = pk * 0.3;

    const len = { prep, base, build, peak, taper, race: 1 }[phase];
    weeks.push({ index: i, monday: addDays(start, i * 7), phase, phaseWeek: pw + 1, phaseLength: len, recovery, hours });
  }
  return weeks;
}

export function weekFor(weeks, date) {
  const mon = mondayOf(date);
  return weeks.find(w => w.monday === mon) || null;
}

// ---- zone helpers --------------------------------------------------------

function bikeZ(th, lo, hi) { return th?.ftp ? ` (${Math.round(th.ftp * lo)}–${Math.round(th.ftp * hi)} W)` : ''; }
function runPace(th, lo, hi) { return th?.run_pace ? ` (${fmtMMSS(th.run_pace * lo)}–${fmtMMSS(th.run_pace * hi)} /km)` : ''; }
function cssNote(th) { return th?.css ? ` (CSS ≈ ${fmtMMSS(th.css)} /100 m)` : ''; }
const r5 = v => Math.max(5, Math.round(v / 5) * 5);
const r100 = v => Math.max(100, Math.round(v / 100) * 100);

export function swimDistance(min, th) {
  const pace = (th?.css || 125) * 1.2;      // seconds per 100 m including rests and drills
  return r100(min * 60 / pace * 100);
}

// ---- workout descriptions ------------------------------------------------

function swimWorkout(kind, D, th) {
  const wu = r100(D * 0.15), cd = Math.max(100, r100(D * 0.08));
  const main = Math.max(200, D - wu - cd);
  const n = (len, part = 1) => Math.max(2, Math.round(main * part / len));
  const css = cssNote(th);
  switch (kind) {
    case 'technique': return { title: 'Technique swim', text: `WU ${wu} easy · Drills ${n(50, 0.35)}×50 (catch-up, fingertip drag, 6-kick switch) · ${n(100, 0.65)}×100 smooth Z2, 15 s rest · CD ${cd}` };
    case 'aerobic': return { title: 'Aerobic swim', text: `WU ${wu} · ${n(200, 0.7)}×200 steady Z2–Z3, 20 s rest · Pull ${n(100, 0.3)}×100 with buoy · CD ${cd}` };
    case 'endurance': return { title: 'Endurance swim', text: `WU ${wu} · ${n(400)}×400 steady Z2, 30 s rest — hold an even pace · CD ${cd}` };
    case 'css': return { title: 'CSS intervals', text: `WU ${wu} incl. 4×50 build · ${n(100)}×100 at CSS pace${css}, 10–15 s rest · CD ${cd}` };
    case 'threshold': return { title: 'Threshold swim', text: `WU ${wu} · ${n(300)}×300 at CSS + 2 s${css}, 20 s rest · CD ${cd}` };
    case 'long': return { title: 'Long swim', text: `WU ${wu} · ${n(500)}×500 at Ironman effort, 30 s rest — sight every 6–8 strokes · CD ${cd}` };
    case 'openwater': return { title: 'Open-water swim', text: `${D} m continuous at Ironman effort. Wetsuit practice, sighting every 6–8 strokes. Swim with a buddy.` };
    case 'speed': return { title: 'Sharpening swim', text: `WU ${wu} · 8×50 fast, 30 s rest · ${n(100, 0.6)}×100 race pace · CD ${cd}` };
    default: return { title: 'Easy swim', text: `${D} m easy, mixing strokes and drills. Loosen up.` };
  }
}

function bikeWorkout(kind, min, phase, th) {
  const reps = (each, lo, hi) => clamp(Math.floor((min - 25) / each), lo, hi);
  switch (kind) {
    case 'cadence': return { title: 'Cadence drills', text: `WU 10' · ${reps(5, 3, 8)}×(3' at 100+ rpm / 2' normal) in Z2${bikeZ(th, 0.56, 0.75)} · steady Z2 to finish · CD 5'` };
    case 'sweetspot': { const k = reps(16, 2, 4); return { title: 'Sweet-spot intervals', text: `WU 15' · ${k}×12' sweet spot${bikeZ(th, 0.88, 0.94)}, 4' easy · Z2 to finish · CD 10'` }; }
    case 'threshold': { const k = reps(15, 2, 5); return { title: 'Threshold intervals', text: `WU 15' · ${k}×10' Z4${bikeZ(th, 0.91, 1.0)}, 5' easy · CD 10'` }; }
    case 'tempo': { const k = reps(25, 1, 4); return { title: 'Tempo ride', text: `WU 15' · ${k}×20' Z3${bikeZ(th, 0.76, 0.88)}, 5' easy · Z2 to finish · CD 10'` }; }
    case 'racepace': { const k = reps(35, 1, 4); return { title: 'Race-pace ride', text: `WU 15' · ${k}×30' at Ironman effort${bikeZ(th, 0.68, 0.75)}, 5' easy · CD 10'. Eat and drink as on race day.` }; }
    case 'openers': return { title: 'Openers', text: `WU 15' · 4×1' high Z4, 2' easy · Z2 to finish. Legs should feel snappy, not tired.` };
    case 'long':
      if (phase === 'peak') return { title: 'Race rehearsal ride', text: `${fmtMin(min)}: ride the middle ${fmtMin(r5(min * 0.6))} at Ironman effort${bikeZ(th, 0.68, 0.75)}. Full race nutrition and race kit.` };
      if (phase === 'build') return { title: 'Long ride', text: `${fmtMin(min)} in Z2 with ${min >= 240 ? 3 : 2}×30' at Ironman effort${bikeZ(th, 0.68, 0.75)} in the second half. Fuel as on race day: 60–90 g carbs an hour.` };
      return { title: 'Long ride', text: `${fmtMin(min)} steady Z2${bikeZ(th, 0.56, 0.75)}. Practise fuelling: 60–90 g carbs and a bottle an hour.` };
    case 'easy': return { title: 'Easy spin', text: `${fmtMin(min)} easy Z1–Z2, light gears, high cadence.` };
    default: return { title: 'Endurance ride', text: `${fmtMin(min)} steady Z2${bikeZ(th, 0.56, 0.75)}, cadence 85–95.` };
  }
}

function runWorkout(kind, min, phase, th) {
  const reps = (each, lo, hi) => clamp(Math.floor((min - 25) / each), lo, hi);
  switch (kind) {
    case 'hills': return { title: 'Hill repeats', text: `WU 15' · ${clamp(Math.round((min - 25) / 3), 4, 10)}×60 s uphill strong, jog down · Z2 to finish · CD 10'` };
    case 'tempo': return { title: 'Tempo run', text: `WU 15' · ${reps(10, 2, 5)}×8' Z3${runPace(th, 1.08, 1.15)}, 2' jog · CD 10'` };
    case 'threshold': return { title: 'Threshold run', text: `WU 15' · ${reps(7, 3, 6)}×5' Z4${runPace(th, 0.98, 1.04)}, 2' jog · CD 10'` };
    case 'racepace': return { title: 'Race-pace run', text: `WU 15' · ${reps(18, 1, 3)}×15' at Ironman pace${runPace(th, 1.15, 1.25)}, 3' easy · CD 10'` };
    case 'openers': return { title: 'Run openers', text: `WU 10' · 4×30 s quick, 90 s jog · easy to finish.` };
    case 'brick': return { title: 'Brick run', text: `Straight off the bike: ${fmtMin(min)}. First 5' relaxed, then settle into Ironman effort. Practise a quick transition.` };
    case 'long':
      if (phase === 'peak') return { title: 'Long run', text: `${fmtMin(min)}: middle third at Ironman pace${runPace(th, 1.15, 1.25)}. Race fuel and shoes.` };
      if (phase === 'build') return { title: 'Long run', text: `${fmtMin(min)} in Z2; last ${fmtMin(Math.min(30, r5(min * 0.25)))} at Ironman pace${runPace(th, 1.15, 1.25)}. Take a gel every 30–40'.` };
      return { title: 'Long run', text: `${fmtMin(min)} steady Z2${runPace(th, 1.22, 1.35)}. Practise walking aid stations for 30 s.` };
    case 'strides': return { title: 'Easy run + strides', text: `${fmtMin(min)} easy Z1–Z2, conversational. Finish with 4×20 s strides.` };
    default: return { title: 'Easy run', text: `${fmtMin(min)} easy Z1–Z2, conversational.` };
  }
}

function strengthWorkout(phase) {
  if (phase === 'build') return { title: 'Strength (maintenance)', text: `2 rounds: split squats ×8/side, single-leg RDL ×8/side, glute bridge ×12, plank 45 s, side plank 30 s/side.` };
  return { title: 'Strength', text: `3 rounds: goblet squat ×10, single-leg RDL ×8/side, step-ups ×10/side, push-ups ×10, plank 45 s, side plank 30 s/side, band pull-aparts ×15.` };
}

// ---- weekly layout ---------------------------------------------------------

const SPLIT = {
  prep:  { swim: 0.24, bike: 0.42, run: 0.34 },
  base:  { swim: 0.19, bike: 0.51, run: 0.30 },
  build: { swim: 0.16, bike: 0.56, run: 0.28 },
  peak:  { swim: 0.14, bike: 0.58, run: 0.28 },
  taper: { swim: 0.20, bike: 0.52, run: 0.28 },
};

// Which intensity each slot carries in each phase. Recovery weeks swap quality for easy.
const KINDS = {
  prep:  { swimA: 'technique', swimC: 'technique', swimD: 'endurance', bikeA: 'cadence',   bikeC: 'endurance', runB: 'strides',   runD: 'easy' },
  base:  { swimA: 'technique', swimC: 'aerobic',   swimD: 'endurance', bikeA: 'sweetspot', bikeC: 'endurance', runB: 'hills',     runD: 'easy' },
  build: { swimA: 'css',       swimC: 'threshold', swimD: 'long',      bikeA: 'threshold', bikeC: 'tempo',     runB: 'threshold', runD: 'easy' },
  peak:  { swimA: 'css',       swimC: 'openwater', swimD: 'long',      bikeA: 'racepace',  bikeC: 'endurance', runB: 'racepace',  runD: 'easy' },
  taper: { swimA: 'speed',     swimC: 'css',       swimD: 'easy',      bikeA: 'openers',   bikeC: 'endurance', runB: 'openers',   runD: 'easy' },
};
const LONG_RIDE_W = { prep: 1.4, base: 2.0, build: 2.6, peak: 3.0, taper: 2.0 };
const BRICK_W = { prep: 0, base: 0.22, build: 0.35, peak: 0.45, taper: 0.25 };

// Distribute `total` minutes across slots by weight, respecting each slot's min/max.
export function allocate(total, slots) {
  const out = slots.map(() => 0);
  let free = slots.map((_, i) => i), rem = total;
  for (let pass = 0; pass < slots.length + 1 && free.length; pass++) {
    const W = free.reduce((s, i) => s + slots[i].w, 0);
    const over = free.filter(i => rem * slots[i].w / W > slots[i].max);
    if (!over.length) { free.forEach(i => { out[i] = rem * slots[i].w / W; }); break; }
    over.forEach(i => { out[i] = slots[i].max; rem -= slots[i].max; });
    free = free.filter(i => !over.includes(i));
  }
  return out.map((v, i) => r5(Math.max(slots[i].min, v)));
}

export function dayRoles(ps) {
  const rest = +ps.rest_day, ride = +ps.long_ride_day, run = +ps.long_run_day;
  const others = [];
  for (let k = 1; k <= 7; k++) {
    const d = (rest + k) % 7;
    if (d !== rest && d !== ride && d !== run) others.push(d);
  }
  return { rest, ride, run, A: others[0], B: others[1], C: others[2], D: others[3] };
}

function weekSessions(week, ps, th) {
  const { phase, recovery } = week;
  const roles = dayRoles(ps);
  const out = [];
  const add = (day, sport, kind, duration_min, built, sort, extra = {}) => out.push({
    id: uid(), date: addDays(week.monday, day), sport, kind,
    title: built.title, description: (recovery ? 'Easier week: keep it relaxed. ' : '') + built.text,
    duration_min, distance_m: null, phase, week: week.index, sort, skip_reason: null, ...extra,
  });

  // Strength is a fixed 30 minutes, counted inside the weekly total.
  const strengthDays = !ps.strength ? [] :
    (phase === 'prep' || phase === 'base') ? (recovery ? [roles.B] : [roles.B, roles.D]) :
    phase === 'build' ? [roles.B] : [];
  const strengthMin = strengthDays.length * 30;
  const triMin = Math.max(0, week.hours * 60 - strengthMin);
  const split = SPLIT[phase];
  const K = { ...KINDS[phase] };
  if (recovery) Object.assign(K, { swimA: 'technique', swimC: 'easy', bikeA: 'easy', bikeC: 'endurance', runB: 'strides' });

  // Swims
  const swimDays = +ps.swims >= 3 ? [['swimA', roles.A], ['swimC', roles.C], ['swimD', roles.D]] : [['swimA', roles.A], ['swimD', roles.D]];
  const swimMins = allocate(triMin * split.swim, swimDays.map(([k]) => ({ w: k === 'swimD' ? 1.25 : 1, min: 30, max: 90 })));
  swimDays.forEach(([k, day], i) => {
    const D = swimDistance(swimMins[i], th);
    add(day, 'swim', K[k], swimMins[i], swimWorkout(K[k], D, th), 0, { distance_m: D });
  });

  // Bike: quality day, mid-week endurance, long ride
  const bikeSlots = [
    { key: 'A', w: 1, min: 45, max: 120 },
    { key: 'C', w: 0.9, min: 45, max: 180 },
    { key: 'long', w: LONG_RIDE_W[phase] * (recovery ? 0.8 : 1), min: 60, max: 360 },
  ];
  const bikeMins = allocate(triMin * split.bike, bikeSlots);
  add(roles.A, 'bike', K.bikeA, bikeMins[0], bikeWorkout(K.bikeA, bikeMins[0], phase, th), 1);
  add(roles.C, 'bike', K.bikeC, bikeMins[1], bikeWorkout(K.bikeC, bikeMins[1], phase, th), 1);
  add(roles.ride, 'bike', 'long', bikeMins[2], bikeWorkout('long', bikeMins[2], phase, th), 1);

  // Run: quality, easy, long, brick
  const brickW = recovery ? 0 : BRICK_W[phase];
  const runSlots = [
    { w: 1, min: 30, max: 75 },
    { w: 0.7, min: 25, max: 60 },
    { w: 1.5, min: 40, max: phase === 'prep' ? 90 : 165 },
    ...(brickW ? [{ w: brickW, min: 10, max: 45 }] : []),
  ];
  const runMins = allocate(triMin * split.run, runSlots);
  add(roles.B, 'run', K.runB, runMins[0], runWorkout(K.runB, runMins[0], phase, th), 2);
  add(roles.D, 'run', K.runD, runMins[1], runWorkout(K.runD, runMins[1], phase, th), 2);
  add(roles.run, 'run', 'long', runMins[2], runWorkout('long', runMins[2], phase, th), 2);
  if (brickW) add(roles.ride, 'run', 'brick', runMins[3], runWorkout('brick', runMins[3], phase, th), 3);

  strengthDays.forEach(day => add(day, 'strength', 'strength', 30, strengthWorkout(phase), 4));
  return out;
}

function raceWeekSessions(week, raceDate, raceName, th) {
  const s = (offset, sport, kind, duration_min, title, description, sort = 0, distance_m = null) => ({
    id: uid(), date: addDays(raceDate, offset), sport, kind, title, description, duration_min, distance_m,
    phase: 'race', week: week.index, sort, skip_reason: null,
  });
  const list = [
    s(-5, 'swim', 'easy', 30, 'Easy swim', `1,000 m easy with 4×100 at race pace${cssNote(th)}.`, 0, 1000),
    s(-4, 'bike', 'openers', 60, 'Bike openers', `60' Z2 with 3×5' at Ironman effort${bikeZ(th, 0.68, 0.75)}.`, 1),
    s(-3, 'run', 'openers', 30, 'Run openers', `30' easy with 4×20 s strides.`, 2),
    s(-2, 'swim', 'easy', 20, 'Shake-out swim', `20' easy. Check goggles and wetsuit.`, 0, 800),
    s(-1, 'bike', 'easy', 30, 'Shake-out ride', `30' easy spin with 3×1' at race effort. Check the bike, then rack it.`, 1),
    s(-1, 'run', 'easy', 10, 'Shake-out jog', `10' easy jog. Feet up the rest of the day.`, 2),
    s(0, 'swim', 'race', 80, `${raceName}: swim`, '3.8 km. Start calm, find feet, sight often.', 0, 3800),
    s(0, 'bike', 'race', 390, `${raceName}: bike`, '180 km. Ride your plan, not the people around you. Eat and drink on schedule.', 1),
    s(0, 'run', 'race', 285, `${raceName}: run`, '42.2 km. Easy for the first 10 km, then hold on. Enjoy the finish line.', 2),
  ];
  return list.filter(x => x.date >= week.monday);
}

export function generatePlan(profile, fromDate = null) {
  const ps = profile.settings.plan, th = profile.settings.thresholds || {};
  const weeks = buildWeeks(ps, profile.race_date);
  const sessions = [];
  for (const w of weeks) {
    if (fromDate && addDays(w.monday, 6) < fromDate) continue;
    const list = w.phase === 'race' ? raceWeekSessions(w, profile.race_date, profile.race_name || 'Race', th) : weekSessions(w, ps, th);
    sessions.push(...list.filter(s => !fromDate || s.date >= fromDate));
  }
  return sessions;
}

export function plannedMinutes(sessions) { return sessions.reduce((a, s) => a + (s.duration_min || 0), 0); }
