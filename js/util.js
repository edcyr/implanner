// Small shared helpers: DOM, dates (local 'YYYY-MM-DD' strings), formatting, sport metadata.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const uid = () => crypto.randomUUID();
const pad = n => String(n).padStart(2, '0');
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---- dates -------------------------------------------------------------
// Dates are local calendar days as 'YYYY-MM-DD'. Noon avoids DST edge cases.
export function toDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); }
export function fromDate(dt) { return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`; }
export const today = () => fromDate(new Date());
export function addDays(s, n) { const d = toDate(s); d.setDate(d.getDate() + n); return fromDate(d); }
export const dow = s => (toDate(s).getDay() + 6) % 7;          // 0 = Monday
export const mondayOf = s => addDays(s, -dow(s));
export const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 864e5);
export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function fmtDay(s, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  return toDate(s).toLocaleDateString(undefined, opts);
}
export function fmtRange(a, b) {
  const da = toDate(a), db = toDate(b);
  const sameMonth = da.getMonth() === db.getMonth();
  const left = da.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const right = db.toLocaleDateString(undefined, sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' });
  return `${left}–${right}`;
}
export function relDay(s, ref = today()) {
  const d = daysBetween(ref, s);
  if (d === 0) return 'Today';
  if (d === -1) return 'Yesterday';
  if (d === 1) return 'Tomorrow';
  if (d < 0 && d > -7) return (s < mondayOf(ref) ? 'Last ' : '') + fmtDay(s, { weekday: 'long' });
  return fmtDay(s);
}
export function timeAgo(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return fmtDay(fromDate(new Date(iso)));
}

// ---- numbers -----------------------------------------------------------
export function fmtMin(min) {
  min = Math.round(min || 0);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}h ${pad(m)}` : `${h}h`;
}
// Compact form for tight spaces: 30m, 1h, 1h45
export function fmtShort(min) {
  min = Math.round(min || 0);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}h${pad(m)}` : `${h}h`;
}
export const fmtHours = min => `${(min / 60).toFixed(min >= 600 ? 0 : 1)} h`;
export function fmtHMS(s) {
  s = Math.round(s || 0);
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
// "1:02:03" → 3723 s, "62:03" → 3723 s, "45" → 2700 s (bare number = minutes)
export function parseHMS(str) {
  if (str == null || String(str).trim() === '') return null;
  const p = String(str).trim().split(':').map(Number);
  if (p.some(n => !Number.isFinite(n) || n < 0)) return null;
  if (p.length === 1) return Math.round(p[0] * 60);
  if (p.length === 2) return p[0] * 60 + p[1];
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  return null;
}
// "1:45" → 105 (seconds, for paces)
export function parseMMSS(str) {
  if (!str) return null;
  const p = String(str).trim().split(':').map(Number);
  if (p.some(n => !Number.isFinite(n))) return null;
  return p.length === 2 ? p[0] * 60 + p[1] : p[0];
}
export const fmtMMSS = s => s == null ? '' : `${Math.floor(s / 60)}:${pad(Math.round(s % 60))}`;
export function fmtDist(m, sport) {
  if (m == null || !(m > 0)) return '';
  if (sport === 'swim') return `${Math.round(m).toLocaleString()} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
}
export function fmtPace(sport, distM, sec) {
  if (!(distM > 0) || !(sec > 0)) return '';
  if (sport === 'swim') return `${fmtMMSS(sec / distM * 100)} /100 m`;
  if (sport === 'run') return `${fmtMMSS(sec / distM * 1000)} /km`;
  return `${(distM / sec * 3.6).toFixed(1)} km/h`;
}

// ---- sports ------------------------------------------------------------
export const SPORTS = {
  swim: { label: 'Swim', verb: 'swim' },
  bike: { label: 'Bike', verb: 'ride' },
  run: { label: 'Run', verb: 'run' },
  strength: { label: 'Strength', verb: 'strength session' },
  other: { label: 'Other', verb: 'workout' },
};
export const SPORT_ORDER = ['swim', 'bike', 'run', 'strength', 'other'];

const ICONS = {
  swim: '<path d="M2 15c1.7 0 1.7-1.2 3.3-1.2S7 15 8.7 15s1.7-1.2 3.3-1.2 1.7 1.2 3.3 1.2 1.7-1.2 3.3-1.2S20.3 15 22 15"/><path d="M2 19.5c1.7 0 1.7-1.2 3.3-1.2s1.7 1.2 3.4 1.2 1.7-1.2 3.3-1.2 1.7 1.2 3.3 1.2 1.7-1.2 3.3-1.2 1.7 1.2 3.4 1.2"/><circle cx="17" cy="6" r="2"/><path d="M5 11.5l4.5-4 3 2.5 2.5-1.5"/>',
  bike: '<circle cx="5.5" cy="16.5" r="3.5"/><circle cx="18.5" cy="16.5" r="3.5"/><path d="M5.5 16.5L9 9h6.5l3 7.5M9 9l3.5 7.5h-7M14 6h2.5"/>',
  run: '<circle cx="15" cy="4.5" r="2"/><path d="M7 21l3.5-6 3 2.5V22M5 12.5l3.5-4 4 .5 3 3.5h3.5M10.5 15l2.5-6"/>',
  strength: '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9.5v5M20.5 9.5v5M6.5 12h11"/>',
  other: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  rest: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
};
export function icon(name, cls = '') {
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.other}</svg>`;
}
export const sportIcon = sport => `<span class="sport-ico s-${esc(sport)}" title="${esc(SPORTS[sport]?.label || sport)}">${icon(sport)}</span>`;

// Feelings people record after a session: shared with the crew to start conversations.
export const FEELS = {
  great: { emoji: '😄', label: 'Great' },
  good: { emoji: '🙂', label: 'Good' },
  ok: { emoji: '😐', label: 'OK' },
  tired: { emoji: '😮‍💨', label: 'Tired' },
  rough: { emoji: '😣', label: 'Rough' },
};
export const SKIP_REASONS = ['Sick', 'Injured', 'Work', 'Family', 'Travel', 'Tired', 'Weather', 'Other'];
export const CHEERS = ['👏', '💪', '🙌', '❤️', '🫂'];

export function debounce(fn, ms = 300) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
