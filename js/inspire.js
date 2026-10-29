// A line of encouragement for the day. Same line all day for everyone, a new one tomorrow.

const GENERAL = [
  'You don’t have to be fast. You have to be consistent.',
  'The plan works when you work the plan.',
  'One session at a time. Today’s is the only one that matters.',
  'Rest is part of the plan, not a break from it.',
  'Slow kilometres are still kilometres.',
  'Small wins stack up: one session, one week, one block.',
  'Missed one? Don’t make it up. Pick the plan back up and carry on.',
  'Be the training partner you’d want to have.',
  'Cheer someone on today. It costs nothing and means a lot.',
  'Easy days easy, so the hard days can be hard.',
  'Nobody remembers a perfect week. Everybody remembers the finish line.',
  'Show up, do the session, recover. Repeat.',
  'Swim smooth, ride smart, run strong.',
  'Patience on the bike buys you a better run.',
  'Every early alarm is a deposit for race day.',
  'Fuel the work. Every long day is a nutrition rehearsal.',
  'Bad days happen. Log it, learn from it, line up tomorrow.',
  'Consistency beats intensity, week after week.',
  'Your crew is counting on you, and you can count on them.',
  'Strong legs are built on boring miles.',
  'Trust the process. The process is on your calendar.',
  'Sleep is the cheapest performance upgrade there is.',
  'Train the body, but practise the mindset too.',
  'Finish the session you planned, not the one your ego wants.',
  'The finish line is earned one ordinary day at a time.',
];

const BY_PHASE = {
  prep: ['Build the habit first. Fitness follows habits.', 'Technique now saves minutes later.', 'Start easy. There’s a long way to go and plenty of time.'],
  base: ['Winter kilometres, summer smiles.', 'Zone 2 is where the engine gets built.', 'Base season: boring on purpose.'],
  build: ['This is where it gets real. Stay patient.', 'Practise race pace until it feels like home.', 'Long days now, easy confidence later.'],
  peak: ['Your biggest weeks. Rehearse everything: pace, fuel, kit.', 'You’re fitter than you’ve ever been. Recover like it.', 'Dress rehearsals make race day feel familiar.'],
  taper: ['Less is more now. Trust the work you’ve done.', 'Feeling restless? That’s the taper working.', 'Sleep, eat, stay calm. The hay is in the barn.'],
  race: ['The training is done. Now go enjoy it.', 'Calm swim, smart bike, brave run.', 'You’ve earned this start line.'],
};

function hash(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }

// Every third day leans on the current phase; otherwise a general line.
export function dailyLine(date, phase) {
  const h = hash(date);
  const pool = phase && BY_PHASE[phase] && h % 3 === 0 ? BY_PHASE[phase] : GENERAL;
  return pool[h % pool.length];
}
