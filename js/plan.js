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
    long_ride_day: 5,      // Saturday
    long_run_day: 6,       // Sunday
    bricks: true,          // short run straight after the long ride, from base on
    layout: {              // days are 0 = Monday … 6 = Sunday; time is optional "HH:MM"
      swim: { days: [1, 3, 4], time: '' },
      bike: { days: [1, 3, 5], time: '' },
      run: { days: [2, 4, 6], time: '' },
      strength: { days: [2, 4], time: '' },
    },
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

// Older plans stored a rest day, long days and a swim count; derive the same layout from them.
export function dayRoles(ps) {
  const rest = +ps.rest_day, ride = +ps.long_ride_day, run = +ps.long_run_day;
  const others = [];
  for (let k = 1; k <= 7; k++) {
    const d = (rest + k) % 7;
    if (d !== rest && d !== ride && d !== run) others.push(d);
  }
  return { rest, ride, run, A: others[0], B: others[1], C: others[2], D: others[3] };
}

export const LAYOUT_SPORTS = ['swim', 'bike', 'run', 'strength'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

// Which days (0 = Monday) each sport happens, with an optional fixed start time ("07:30").
// The long ride and long run days are always part of the bike and run days.
export function resolveLayout(ps) {
  let L = ps.layout;
  if (!L) {
    const r = dayRoles(ps);
    L = {
      swim: { days: +ps.swims >= 3 ? [r.A, r.C, r.D] : [r.A, r.D] },
      bike: { days: [r.A, r.C, r.ride] },
      run: { days: [r.B, r.D, r.run] },
      strength: { days: ps.strength === false ? [] : [r.B, r.D] },
    };
  }
  const out = {};
  for (const k of LAYOUT_SPORTS) {
    const days = [...new Set((L[k]?.days || []).map(Number).filter(d => d >= 0 && d <= 6))].sort((a, b) => a - b);
    out[k] = { days, time: TIME.test(L[k]?.time || '') ? L[k].time : '' };
  }
  const ride = +ps.long_ride_day, run = +ps.long_run_day;
  if (!out.bike.days.includes(ride)) out.bike.days = [...out.bike.days, ride].sort((a, b) => a - b);
  if (!out.run.days.includes(run)) out.run.days = [...out.run.days, run].sort((a, b) => a - b);
  return out;
}

export function weekSessions(week, ps, th) {
  const { phase, recovery } = week;
  const L = resolveLayout(ps);
  const ride = +ps.long_ride_day, longRun = +ps.long_run_day;
  const out = [];
  const add = (day, sport, kind, duration_min, built, sort, extra = {}) => out.push({
    id: uid(), date: addDays(week.monday, day), sport, kind,
    title: built.title, description: (recovery ? 'Easier week: keep it relaxed. ' : '') + built.text,
    duration_min, distance_m: null, at_time: L[sport]?.time || null, phase, week: week.index, sort, skip_reason: null, ...extra,
  });

  // Strength is a fixed 30 minutes, counted inside the weekly total.
  const sd = L.strength.days;
  const strengthDays = (phase === 'prep' || phase === 'base') ? (recovery ? sd.slice(0, 1) : sd)
    : phase === 'build' ? sd.slice(0, 1) : [];
  const triMin = Math.max(0, week.hours * 60 - strengthDays.length * 30);
  const fr = raceFocus(week, ps), focus = fr?.sport || null;
  const split = { ...SPLIT[phase] };
  if (focus === 'run') { split.run += 0.05; split.bike -= 0.05; }
  if (focus === 'bike') { split.bike += 0.05; split.run -= 0.05; }
  // Long runs build toward the race distance: about 1h40 → 2h20 for a marathon, less for a half.
  const longRunMin = focus === 'run' && !recovery ? clamp(Math.round((fr.km >= 42 ? 160 : 115) - fr.d * (fr.km >= 42 ? 1.3 : 0.8)), 40, fr.km >= 42 ? 150 : 100) : 40;
  const K = { ...KINDS[phase] };
  if (recovery) Object.assign(K, { swimA: 'technique', swimC: 'easy', bikeA: 'easy', bikeC: 'endurance', runB: 'strides' });

  // Swims: the last swim of the week is the longer, steadier one; the others alternate.
  const swimDays = L.swim.days;
  if (swimDays.length) {
    const kinds = swimDays.length === 1 ? [K.swimA]
      : swimDays.map((_, i) => i === swimDays.length - 1 ? K.swimD : i % 2 ? K.swimC : K.swimA);
    const mins = allocate(triMin * split.swim, kinds.map((k, i) => ({ w: i === kinds.length - 1 && kinds.length > 1 ? 1.25 : 1, min: 30, max: 90 })));
    swimDays.forEach((day, i) => {
      const D = swimDistance(mins[i], th);
      add(day, 'swim', kinds[i], mins[i], swimWorkout(kinds[i], D, th), 0, { distance_m: D });
    });
  }

  // Bike: long ride on its day; the first other ride is the quality one, the rest steady.
  const bikeOthers = L.bike.days.filter(d => d !== ride);
  const bikeSlots = [
    ...bikeOthers.map((_, i) => ({ kind: i === 0 ? K.bikeA : i === 1 ? K.bikeC : 'endurance', w: i === 0 ? 1 : 0.9, min: 45, max: i === 0 ? 120 : 180 })),
    { kind: 'long', w: LONG_RIDE_W[phase] * (recovery ? 0.8 : 1), min: 60, max: 360 },
  ];
  const bikeMins = allocate(triMin * split.bike, bikeSlots);
  [...bikeOthers, ride].forEach((day, i) => add(day, 'bike', bikeSlots[i].kind, bikeMins[i], bikeWorkout(bikeSlots[i].kind, bikeMins[i], phase, th), 1));

  // Run: long run on its day; the first other run is the quality one, the rest easy; brick after the long ride.
  const runOthers = L.run.days.filter(d => d !== longRun);
  const brickW = recovery || ps.bricks === false ? 0 : BRICK_W[phase];
  const runSlots = [
    ...runOthers.map((_, i) => ({ kind: i === 0 ? K.runB : K.runD, w: i === 0 ? 1 : 0.7, min: i === 0 ? 30 : 25, max: i === 0 ? 75 : 60 })),
    { kind: 'long', w: focus === 'run' ? 1.8 : 1.5, min: longRunMin, max: focus === 'run' ? 180 : phase === 'prep' ? 90 : 165 },
    ...(brickW ? [{ kind: 'brick', w: brickW, min: 10, max: 45 }] : []),
  ];
  const runMins = allocate(triMin * split.run, runSlots);
  [...runOthers, longRun, ...(brickW ? [ride] : [])].forEach((day, i) => {
    const sl = runSlots[i];
    add(day, 'run', sl.kind, runMins[i], runWorkout(sl.kind, runMins[i], phase, th), sl.kind === 'brick' ? 3 : 2,
      sl.kind === 'brick' ? { at_time: L.bike.time || null } : {});
  });

  strengthDays.forEach(day => add(day, 'strength', 'strength', 30, strengthWorkout(phase), 4));
  return out;
}

function raceWeekSessions(week, raceDate, raceName, th) {
  const s = (offset, sport, kind, duration_min, title, description, sort = 0, distance_m = null) => ({
    id: uid(), date: addDays(raceDate, offset), sport, kind, title, description, duration_min, distance_m,
    at_time: null, phase: 'race', week: week.index, sort, skip_reason: null,
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
  let sessions = [];
  for (const w of weeks) {
    sessions.push(...(w.phase === 'race' ? raceWeekSessions(w, profile.race_date, profile.race_name || 'Race', th) : weekSessions(w, ps, th)));
  }
  sessions = applyKeyRaces(sessions, ps, th, profile.race_date);
  return fromDate ? sessions.filter(s => s.date >= fromDate) : sessions;
}

// ---- key races (B and C races before the main one) ------------------------------------
// km: distance; legs: triathlon swim/bike/run km; rest: days after with none of that sport;
// recover: further days kept easy; taperB: days eased before a B race.
export const RACE_TYPES = {
  '5k':       { label: '5K',                      sport: 'run',  km: 5,    pace: 1.00, rest: 0, recover: 2, taperB: 6 },
  '10k':      { label: '10K',                     sport: 'run',  km: 10,   pace: 1.04, rest: 0, recover: 3, taperB: 6 },
  'half':     { label: 'Half marathon',           sport: 'run',  km: 21.1, pace: 1.09, rest: 1, recover: 5, taperB: 10 },
  'marathon': { label: 'Marathon',                sport: 'run',  km: 42.2, pace: 1.16, rest: 3, recover: 7, taperB: 10 },
  'sprint':   { label: 'Sprint triathlon',        sport: 'tri',  legs: [0.75, 20, 5],   rest: 0, recover: 2, taperB: 6 },
  'olympic':  { label: 'Olympic triathlon',       sport: 'tri',  legs: [1.5, 40, 10],   rest: 1, recover: 3, taperB: 6 },
  '70.3':     { label: 'Half-distance tri (70.3)', sport: 'tri', legs: [1.9, 90, 21.1], rest: 2, recover: 5, taperB: 10 },
  'fondo':    { label: 'Gran fondo / bike event', sport: 'bike', km: 120,  rest: 0, recover: 3, taperB: 6 },
  'swim':     { label: 'Open-water swim race',    sport: 'swim', km: 3,    rest: 0, recover: 2, taperB: 4 },
};

const RACE_SPORTS = T => T.sport === 'tri' ? ['swim', 'bike', 'run'] : [T.sport];

// Days around a race the plan changes: [first day, last day].
export function raceWindow(r) {
  const T = RACE_TYPES[r.type];
  if (!T) return [r.date, r.date];
  const B = r.priority !== 'C';
  const before = B && T.sport === 'run' && T.km >= 21 ? 42 : B ? T.taperB : 2;   // run block before a long B run race
  const after = (B ? T.rest + T.recover : Math.ceil((T.rest + T.recover) / 2));
  return [addDays(r.date, -before), addDays(r.date, after)];
}

// In the six weeks before a B-priority half or full marathon (or bike event), lean the week toward that sport.
function raceFocus(week, ps) {
  for (const r of ps.races || []) {
    const T = RACE_TYPES[r.type];
    if (!T || r.priority === 'C' || !(T.sport === 'run' && T.km >= 21 || T.sport === 'bike')) continue;
    const d = daysBetween(week.monday, r.date);
    if (d >= 7 && d <= 48) return { sport: T.sport, km: T.km, d };
  }
  return null;
}

// Rough finishing time, from your thresholds when you've set them.
function raceMinutes(T, th, leg = null) {
  const runPace = (th.run_pace || 330);           // s/km at threshold (default 5:30)
  if (T.sport === 'run') return r5(T.km * runPace * T.pace / 60);
  if (T.sport === 'bike') return r5(T.km / 27 * 60);
  if (T.sport === 'swim') return r5(T.km * 10 * (th.css || 125) * 1.08 / 60);
  const [sw, bk, rn] = T.legs;
  return [r5(sw * 10 * (th.css || 125) * 1.1 / 60), r5(bk / (sw > 1.6 ? 30 : 31) * 60), r5(rn * runPace * (rn > 15 ? 1.22 : 1.12) / 60)][leg];
}

const EASY = { swim: 'Easy swim', bike: 'Easy spin', run: 'Easy run', strength: 'Strength', other: 'Easy session' };

function eased(s, factor, why) {
  const duration_min = Math.max(20, r5(s.duration_min * factor));
  return {
    ...s, kind: s.sport === 'strength' ? 'strength' : 'easy', title: EASY[s.sport] || s.title, duration_min,
    distance_m: s.sport === 'swim' && s.distance_m ? r100(s.distance_m * duration_min / Math.max(1, s.duration_min)) : s.distance_m,
    description: `${why} ${fmtMin(duration_min)} easy${s.sport === 'run' ? ', conversational' : s.sport === 'bike' ? ', light gears' : ''}.`,
  };
}

export function applyKeyRaces(list, ps, th, mainRaceDate) {
  let out = list;
  const races = (ps.races || []).filter(r => RACE_TYPES[r.type] && r.date && r.date < addDays(mainRaceDate, -6)).sort((a, b) => a.date.localeCompare(b.date));
  for (const r of races) {
    const T = RACE_TYPES[r.type], B = r.priority !== 'C', sports = RACE_SPORTS(T);
    const rest = B ? T.rest : Math.min(T.rest, 1), recover = B ? T.recover : Math.ceil(T.recover / 2);
    const taper = B ? T.taperB : 2;
    const sample = out.find(s => s.date === r.date) || out.find(s => s.date > r.date) || {};
    out = out.flatMap(s => {
      if (s.phase === 'race') return [s];                       // never touch the main race week
      const d = daysBetween(r.date, s.date);                    // negative = before the race
      if (d === 0) return [];                                   // race day: the race replaces it
      if (d < 0 && -d <= taper) {
        if (-d === 1) return B ? [] : [eased(s, 0.6, `Day before ${r.name}: stay fresh.`)];
        if (s.sport === 'strength' && (B || -d <= 2)) return [];
        if (-d === 2) return [eased(s, B ? 0.6 : 0.8, `Two days to ${r.name}.`)];
        if (s.kind === 'long' || s.kind === 'brick') return [eased(s, B ? 0.6 : 0.85, `Taper for ${r.name}.`)];
        return B ? [{ ...s, duration_min: Math.max(20, r5(s.duration_min * 0.8)), description: `Taper for ${r.name}: shorter, keep the quality. ${s.description}` }] : [s];
      }
      if (d > 0 && d <= rest) {
        if (d === 1 && T.rest >= 1 && B) return [];             // full rest the day after a big race
        return sports.includes(s.sport) || s.sport === 'strength' ? [] : [eased(s, 0.6, `Recovering from ${r.name}.`)];
      }
      if (d > 0 && d <= rest + recover) {
        if (s.sport === 'strength') return d - rest <= 2 ? [] : [s];
        return [eased(s, sports.includes(s.sport) ? 0.6 : 0.75, `Recovery after ${r.name}: no hard efforts yet.`)];
      }
      return [s];
    });
    const base = { phase: sample.phase || '', week: sample.week ?? 0, at_time: null, skip_reason: null };
    const desc = `${T.label}${B ? ': a key race. Taper is built in, so go for it.' : ': a training race. Race it, but keep something in reserve.'}${r.notes ? ` ${r.notes}` : ''}`;
    if (T.sport === 'tri') {
      ['swim', 'bike', 'run'].forEach((sp, i) => out.push({ ...base, id: uid(), date: r.date, sport: sp, kind: 'race', title: `${r.name}: ${sp}`,
        description: `${T.legs[i]} km. ${desc}`, duration_min: raceMinutes(T, th, i), distance_m: Math.round(T.legs[i] * 1000), sort: i }));
    } else {
      out.push({ ...base, id: uid(), date: r.date, sport: T.sport, kind: 'race', title: r.name, description: `${T.km} km. ${desc}`,
        duration_min: raceMinutes(T, th), distance_m: Math.round(T.km * 1000), sort: 0 });
    }
    if (B) {
      const sp = T.sport === 'tri' ? 'run' : T.sport;
      out.push({ ...base, id: uid(), date: addDays(r.date, -1), sport: sp, kind: 'easy', title: 'Shake-out',
        description: `${sp === 'run' ? "15' easy jog with 4×20 s strides" : sp === 'bike' ? "20' easy spin with 3×30 s quick" : "15' easy swim with a few fast 25s"}. Lay out your kit for ${r.name}.`,
        duration_min: sp === 'bike' ? 20 : 15, distance_m: sp === 'swim' ? 600 : null, sort: 0 });
    }
  }
  return out;
}

export function plannedMinutes(sessions) { return sessions.reduce((a, s) => a + (s.duration_min || 0), 0); }
