import { esc, today, mondayOf, fmtDay, fmtRange, addDays, fmtHMS, fmtDist, fmtMin, fmtPace, SPORTS, sportIcon, icon } from '../util.js';
import { state, saveActivity, saveSession, sessionById, isDuplicate, sessionsBetween, activitiesFor } from '../state.js';
import { bestMatch } from '../compliance.js';
import { readWorkoutFiles } from '../importer.js';
import { toast, feelChip } from '../ui.js';
import { openLogForm } from '../dialogs.js';
import { rerender } from '../nav.js';

export const title = 'Log';
let pending = [];          // [{ a, include, dup, match }]
let failures = [];
let busy = false;
let historyCount = 40;

function partOfDay(iso) {
  if (!iso) return '';
  const h = new Date(iso).getHours();
  return h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening';
}

function candidateSessions(a) {
  return sessionsBetween(addDays(a.date, -3), addDays(a.date, 3)).filter(s => s.sport === a.sport && !activitiesFor(s.id).length);
}

function previewRow(p, i) {
  const a = p.a;
  const cands = candidateSessions(a);
  return `<div class="preview-row" style="${p.include ? '' : 'opacity:.55'}">
    ${sportIcon(a.sport)}
    <div>
      <label class="check"><input type="checkbox" data-action="toggle" data-i="${i}" ${p.include ? 'checked' : ''}>
        <span><b>${esc(fmtDay(a.date, { weekday: 'short', month: 'short', day: 'numeric' }))}${a.start_time ? `, ${new Date(a.start_time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}</b>
        · ${SPORTS[a.sport].label} · ${fmtHMS(a.duration_s)}${a.distance_m ? ` · ${fmtDist(a.distance_m, a.sport)}` : ''}${a.avg_hr ? ` · ${a.avg_hr} bpm` : ''}${a.avg_power ? ` · ${a.avg_power} W` : ''}</span></label>
      ${p.dup ? `<div class="small" style="color:var(--critical);margin-top:4px">Looks like you already imported this one.</div>` : ''}
      <select data-action="match" data-i="${i}" aria-label="Planned session for this workout">
        <option value="">Not part of the plan (extra)</option>
        ${cands.map(s => `<option value="${s.id}" ${p.match === s.id ? 'selected' : ''}>${esc(fmtDay(s.date))}: ${esc(s.title)} (${esc(fmtMin(s.duration_min))})</option>`).join('')}
      </select>
    </div></div>`;
}

function historyList() {
  const acts = state.activities.slice(0, historyCount);
  if (!acts.length) return `<div class="empty"><h3>Nothing logged yet</h3><p>Import a Garmin file or log a swim to get started.</p></div>`;
  let html = '<div class="list">', lastWeek = null;
  for (const a of acts) {
    const mon = mondayOf(a.date);
    if (mon !== lastWeek) { html += `<div class="list-head">${fmtRange(mon, addDays(mon, 6))}</div>`; lastWeek = mon; }
    const s = a.session_id ? sessionById(a.session_id) : null;
    html += `<a class="list-item" href="#/activity/${a.id}">${sportIcon(a.sport)}
      <div><div class="li-title">${esc(a.title || SPORTS[a.sport].label)} ${feelChip(a.feel)}</div>
      <div class="li-sub">${esc(fmtDay(a.date))} · ${fmtHMS(a.duration_s)}${a.distance_m ? ` · ${fmtDist(a.distance_m, a.sport)}` : ''}${a.distance_m && a.sport !== 'strength' ? ` · ${fmtPace(a.sport, a.distance_m, a.duration_s)}` : ''}${s ? '' : ' · <i>extra</i>'}</div></div>
      <span class="li-end">›</span></a>`;
  }
  html += '</div>';
  if (state.activities.length > historyCount) html += `<div style="margin-top:10px"><button class="btn small ghost" data-action="more">Show more</button></div>`;
  return html;
}

export function render() {
  return `
  <div class="page-head"><div><h1>Log a workout</h1><p>Import rides and runs from Garmin, and log swims by hand.</p></div>
    <div class="row"><button class="btn primary" data-action="swim">Log a swim</button><button class="btn" data-action="manual">Log another workout</button></div></div>

  <section class="card">
    <div class="dropzone" data-drop tabindex="0" role="button" aria-label="Choose Garmin files to import">
      ${icon('other')}
      <h3>${busy ? 'Reading files…' : 'Drop Garmin files here'}</h3>
      <p>or click to choose · .fit, .zip, .tcx or .gpx · several at once is fine</p>
      <input type="file" data-file accept=".fit,.zip,.tcx,.gpx" multiple hidden>
    </div>
    <details style="margin-top:12px" class="small">
      <summary class="muted" style="cursor:pointer">How to get files out of Garmin Connect</summary>
      <ol class="muted" style="margin:8px 0 0;padding-left:20px">
        <li>Open <b>connect.garmin.com</b> in a browser and go to the activity.</li>
        <li>Click the gear (⚙) at the top right, then <b>Export Original</b>. It downloads a .zip; drop it here as it is.</li>
        <li>For your whole history: Garmin account → Data Management → <b>Export Your Data</b>. Garmin emails a big zip; drop the .fit files from it here.</li>
      </ol>
      <p class="muted" style="margin-top:8px">Workouts are matched to your plan by day and sport. GPS positions are never saved.</p>
    </details>
    ${failures.length ? `<div class="note" style="margin-top:12px">${failures.map(f => `<div><strong>${esc(f.name)}</strong>: ${esc(f.error)}</div>`).join('')}</div>` : ''}
  </section>

  ${pending.length ? `<section class="section"><h2>Ready to save <span class="muted">${pending.filter(p => p.include).length} of ${pending.length}</span></h2>
    <div class="list">${pending.map(previewRow).join('')}</div>
    <div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn ghost" data-action="clear">Cancel</button><button class="btn primary" data-action="save-all" ${pending.some(p => p.include) ? '' : 'disabled'}>Save workouts</button></div></section>` : ''}

  <section class="section"><h2>History</h2>${historyList()}</section>`;
}

async function handleFiles(files) {
  if (!files?.length) return;
  busy = true; failures = []; rerender();
  const th = state.profile?.settings?.thresholds || {};
  const results = await readWorkoutFiles([...files], th);
  busy = false;
  const used = new Set(pending.map(p => p.match).filter(Boolean));
  for (const r of results) {
    if (r.error) { failures.push(r); continue; }
    for (const a of r.activities) {
      const dup = isDuplicate(a) || pending.some(p => p.a.file_hash === a.file_hash);
      const free = state.sessions.filter(s => !used.has(s.id));
      const m = dup ? null : bestMatch(a, free, state.bySession);
      if (m) used.add(m.id);
      pending.push({ a, include: !dup, dup, match: m?.id || '' });
    }
  }
  pending.sort((x, y) => (x.a.start_time || x.a.date).localeCompare(y.a.start_time || y.a.date));
  rerender();
}

export function mount(root) {
  const dz = root.querySelector('[data-drop]'), input = root.querySelector('[data-file]');
  dz.addEventListener('click', () => input.click());
  dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  input.addEventListener('change', () => handleFiles(input.files));
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); handleFiles(e.dataTransfer.files); });
  root.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.action === 'toggle') { pending[+el.dataset.i].include = el.checked; rerender(); }
    if (el.dataset.action === 'match') { pending[+el.dataset.i].match = el.value; }
  });
}

export const actions = {
  swim: () => openLogForm({ sport: 'swim', session: state.sessions.find(s => s.date === today() && s.sport === 'swim' && !activitiesFor(s.id).length) || null }),
  manual: () => openLogForm({ sport: 'run' }),
  clear: () => { pending = []; failures = []; rerender(); },
  more: () => { historyCount += 60; rerender(); },
  'save-all': async el => {
    el.disabled = true;
    const chosen = pending.filter(p => p.include);
    for (const p of chosen) {
      const s = p.match ? sessionById(p.match) : null;
      const auto = `${partOfDay(p.a.start_time)} ${SPORTS[p.a.sport].verb}`.trim();
      const a = { ...p.a, session_id: s?.id || null, title: s?.title || auto[0].toUpperCase() + auto.slice(1) };
      await saveActivity(a);
      if (s?.skip_reason) await saveSession({ ...s, skip_reason: null });
    }
    pending = []; failures = [];
    toast(`Saved ${chosen.length} workout${chosen.length === 1 ? '' : 's'}`);
    rerender();
  },
};
