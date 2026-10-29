// Garmin Connect sync (Garmin Personal API, through the `garmin` Supabase Edge Function).
// New workouts are pulled when the app opens or comes back into view (at most every 10 minutes)
// and when you tap Sync now. Each one is matched to the plan like an imported file.

import { store } from './store.js';
import { state, isCloud, saveActivity, saveSession } from './state.js';
import { readWorkoutFiles } from './importer.js';
import { bestMatch } from './compliance.js';
import { today, addDays, fromDate } from './util.js';

const LAST_TRY = 'implanner:garmin-last-try';
let running = null;

export const garminStatus = () => isCloud() ? store.garminStatus() : Promise.resolve(null);

function decode(b64) {
  const bin = atob(b64), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Same workout already here? (Same file, or same sport starting within 90 s.)
function existing(a) {
  return state.activities.find(x =>
    (a.file_hash && x.file_hash === a.file_hash) ||
    (a.start_time && x.start_time && x.sport === a.sport && Math.abs(Date.parse(x.start_time) - Date.parse(a.start_time)) < 90e3));
}

// items: [{ id, name, file (base64 zip) }] from the Edge Function.
export async function applyGarminItems(items) {
  const th = state.profile?.settings?.thresholds || {};
  let added = 0, filled = 0;
  for (const it of items) {
    const results = await readWorkoutFiles([new File([decode(it.file)], `garmin-${it.id}.zip`)], th);
    const legs = results.flatMap(r => r.activities || []);
    for (const [i, a] of legs.entries()) {
      const ext = legs.length > 1 ? `garmin:${it.id}:${i}` : `garmin:${it.id}`;
      if (state.activities.some(x => x.external_id === ext)) continue;
      const dup = existing(a);
      if (dup) { if (!dup.external_id) await saveActivity({ ...dup, external_id: ext }); continue; }
      const garmin = { ...a, source: 'garmin', external_id: ext };
      // Marked "Done as planned" or logged by hand that day? Fill that entry in with Garmin's data.
      const manual = state.activities.find(x => x.date === a.date && x.sport === a.sport && x.source === 'manual' && !x.external_id && !x.start_time);
      if (manual) {
        await saveActivity({ ...garmin, id: manual.id, session_id: manual.session_id, title: manual.title, feel: manual.feel, rpe: manual.rpe, notes: manual.notes });
        filled++; continue;
      }
      const s = bestMatch(a, state.sessions, state.bySession);
      await saveActivity({ ...garmin, session_id: s?.id || null, title: s?.title || it.name || a.title || 'Workout' });
      if (s?.skip_reason) await saveSession({ ...s, skip_reason: null });
      added++;
    }
  }
  return { added, filled };
}

// Returns null when Garmin isn't available, { connected: false } when not connected,
// otherwise { connected: true, added, filled } (or { skipped: true } if synced recently).
export function syncGarmin({ force = false } = {}) {
  if (!isCloud()) return Promise.resolve(null);
  if (running) return running;
  running = (async () => {
    const st = await store.garminStatus();
    if (!st) return { connected: false };
    if (!force && Date.now() - (+localStorage.getItem(LAST_TRY) || 0) < 10 * 60e3) return { connected: true, skipped: true };
    localStorage.setItem(LAST_TRY, String(Date.now()));
    const t = today();
    const since = st.last_sync_at ? addDays(fromDate(new Date(st.last_sync_at)), -3) : addDays(t, -14);
    const known = new Set(state.activities.filter(a => a.external_id?.startsWith('garmin:') && a.date >= addDays(since, -1)).map(a => a.external_id.split(':')[1]));
    const total = { connected: true, added: 0, filled: 0 };
    for (let round = 0; round < 10; round++) {
      const res = await store.garmin({ action: 'sync', since, until: t, known: [...known], max: 6 });
      const r = await applyGarminItems(res.activities || []);
      total.added += r.added; total.filled += r.filled;
      (res.activities || []).forEach(x => known.add(x.id));
      if (!res.more) break;
    }
    return total;
  })().finally(() => { running = null; });
  return running;
}

export function syncMessage(r) {
  if (!r?.connected || r.skipped) return '';
  const n = r.added + r.filled;
  if (!n) return 'Garmin is up to date';
  return `${n} workout${n === 1 ? '' : 's'} from Garmin${r.filled ? ` (${r.filled} added to sessions you’d already logged)` : ''}`;
}
