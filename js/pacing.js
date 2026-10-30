// Race pacing from a goal time, and the fitness tests that keep training zones current.

import { clamp, fmtMMSS, fmtHMS } from './util.js';

export const IRONMAN = { swim: 3.8, bike: 180.2, run: 42.2, t1: 360, t2: 240 };

// "12:30" → 45000 s when hours are expected, else minutes:seconds; "3:59:00" → 14340 s.
export function parseGoal(str, hours = true) {
  if (!str || !String(str).trim()) return null;
  const p = String(str).trim().split(':').map(Number);
  if (p.some(n => !Number.isFinite(n) || n < 0)) return null;
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  if (p.length === 2) return hours ? p[0] * 3600 + p[1] * 60 : p[0] * 60 + p[1];
  return hours ? Math.round(p[0] * 3600) : Math.round(p[0] * 60);
}
export const fmtGoal = s => s ? fmtHMS(s).replace(/:00$/, '') : '';

// What each leg would take at your current thresholds (or sensible defaults when they're not set).
function predict(th, legs) {
  const long = legs.bike >= 150;
  const swimPace = (th.css || 125) + (long ? 10 : 5);                    // s per 100 m on race day
  const bikeKmh = th.ftp ? clamp(21 + th.ftp * 0.035, 24, 40) : 28;      // flat-course estimate
  const runPace = (th.run_pace || 330) * (long ? 1.25 : 1.12);           // s per km off the bike
  return { swim: legs.swim * 10 * swimPace, bike: legs.bike / bikeKmh * 3600, run: legs.run * runPace };
}

// Split a goal finish time across the legs in proportion to that prediction.
export function triPlan(goalS, th = {}, legs = IRONMAN) {
  const long = legs.bike >= 150;
  const t1 = legs.t1 ?? (long ? 360 : 150), t2 = legs.t2 ?? (long ? 240 : 90);
  const p = predict(th, legs);
  const moving = p.swim + p.bike + p.run;
  const k = goalS ? Math.max(0.5, (goalS - t1 - t2) / moving) : 1;
  const swim = p.swim * k, bike = p.bike * k, run = p.run * k;
  return {
    goal: goalS || null, predicted: moving + t1 + t2, legs, long,
    swim, bike, run, t1, t2,
    swimPace: swim / (legs.swim * 10), bikeKmh: legs.bike / (bike / 3600), runPace: run / legs.run,
  };
}

// How the target paces compare with your current thresholds.
export function paceChecks(plan, th) {
  const out = [];
  if (th.css) {
    const d = plan.swimPace - th.css;
    out.push({ sport: 'swim', status: d < 0 ? 'off' : d < (plan.long ? 5 : 2) ? 'close' : 'on',
      text: d < 0 ? `Faster than your CSS (${fmtMMSS(th.css)}): very unlikely over ${plan.legs.swim} km.`
        : `${Math.round(d)} s/100 m slower than your CSS (${fmtMMSS(th.css)}): ${d < (plan.long ? 5 : 2) ? 'ambitious' : 'realistic'}.` });
  }
  if (th.run_pace) {
    const r = plan.runPace / th.run_pace, [hard, ok] = plan.long ? [1.12, 1.18] : [1.03, 1.08];
    out.push({ sport: 'run', status: r < hard ? 'off' : r < ok ? 'close' : 'on',
      text: `${Math.round((r - 1) * 100)} % slower than your threshold pace (${fmtMMSS(th.run_pace)} /km): ${r < hard ? 'very ambitious off the bike' : r < ok ? 'ambitious' : 'realistic'}.` });
  }
  if (th.ftp) {
    const [lo, hi] = plan.long ? [0.68, 0.75] : [0.80, 0.88];
    out.push({ sport: 'bike', status: 'on', text: `Ride it by power, not speed: about ${Math.round(th.ftp * lo)}–${Math.round(th.ftp * hi)} W (${lo * 100}–${hi * 100} % of FTP). Speed depends on the course, wind and your position.` });
  }
  return out;
}

// Race-day pacing plan, leg by leg.
export function raceStrategy(plan, th) {
  const pw = th.ftp ? (plan.long ? `${Math.round(th.ftp * 0.68)}–${Math.round(th.ftp * 0.75)} W` : `${Math.round(th.ftp * 0.8)}–${Math.round(th.ftp * 0.88)} W`) : 'steady Zone 2 heart rate';
  return [
    { leg: 'swim', label: 'Swim', time: plan.swim, target: `${fmtMMSS(plan.swimPace)} /100 m`,
      notes: 'Start relaxed for the first 200 m, find feet to draft on, then settle in. Sight every 6–8 strokes.' },
    { leg: 't1', label: 'T1', time: plan.t1, target: '',
      notes: 'Wetsuit off, helmet on and buckled before you touch the bike. Walk-jog; don’t sprint.' },
    { leg: 'bike', label: 'Bike', time: plan.bike, target: `${plan.bikeKmh.toFixed(1)} km/h`,
      notes: `Hold ${pw}. Ride the first hour 5–10 % easier and ${th.ftp ? `keep climbs below about ${Math.round(th.ftp * 0.85)} W (85 % of FTP)` : 'don’t surge on the climbs'}. ${plan.long ? 'Eat 60–90 g of carbs and drink 500–750 ml an hour, starting in the first 20 minutes.' : 'Drink and take a gel or two.'}` },
    { leg: 't2', label: 'T2', time: plan.t2, target: '',
      notes: 'Socks, shoes, race belt. Take your nutrition with you.' },
    { leg: 'run', label: 'Run', time: plan.run, target: `${fmtMMSS(plan.runPace)} /km`,
      notes: plan.long
        ? `First 10 km about 10 s/km slower (${fmtMMSS(plan.runPace + 10)} /km), then hold ${fmtMMSS(plan.runPace)}. Walking through aid stations is fine: it’s built into the pace. Keep taking carbs to the end.`
        : `First kilometre controlled, then settle at ${fmtMMSS(plan.runPace)} /km and finish strong.` },
  ];
}

// ---- fitness tests ------------------------------------------------------------------------
export const TESTS = {
  swim: { title: 'Swim test: CSS', minutes: 45,
    text: "WU 400 easy + 4×50 build · 400 m time trial at your best even pace · 5' easy · 200 m time trial, all out · CD 200. Record both times: IMPlanner works out your CSS (threshold swim pace) from them." },
  bike: { title: 'Bike test: 20-minute FTP', minutes: 70,
    text: "WU 20' including 3×1' fast · 5' hard · 10' easy · 20' time trial: the hardest steady effort you can hold · CD 15'. Record the 20' average power and/or heart rate. Use the same bike or trainer each time." },
  run: { title: 'Run test: 30-minute time trial', minutes: 55,
    text: "WU 15' with 4×20 s strides · 30' solo time trial on a flat route or track, an even hard effort · CD 10'. Record the distance covered and your average heart rate over the last 20'." },
};

// Inputs → new thresholds. Swim: 400 and 200 m times (s). Bike: 20' power (W) and/or HR. Run: km in 30' and/or HR.
export function deriveTest(sport, v) {
  if (sport === 'swim' && v.t400 > 0 && v.t200 > 0 && v.t400 > v.t200) return { css: Math.round((v.t400 - v.t200) / 2) };
  if (sport === 'bike') {
    const r = {};
    if (v.p20 > 0) r.ftp = Math.round(v.p20 * 0.95);
    if (v.hr20 > 0) r.lthr_bike = Math.round(v.hr20 * 0.95);
    return Object.keys(r).length ? r : null;
  }
  if (sport === 'run') {
    const r = {};
    if (v.km > 0) r.run_pace = Math.round(1800 / v.km);
    if (v.hr > 0) r.lthr_run = Math.round(v.hr);
    return Object.keys(r).length ? r : null;
  }
  return null;
}

export const THRESHOLD_LABELS = {
  css: ['Swim CSS', v => `${fmtMMSS(v)} /100 m`, true],
  ftp: ['Bike FTP', v => `${v} W`, false],
  lthr_bike: ['Bike threshold HR', v => `${v} bpm`, false],
  run_pace: ['Run threshold pace', v => `${fmtMMSS(v)} /km`, true],
  lthr_run: ['Run threshold HR', v => `${v} bpm`, false],
};   // [label, format, lower is better]
