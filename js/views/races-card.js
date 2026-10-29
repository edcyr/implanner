// "Key races" editor, used in Settings (saves and rebuilds the weeks around the race) and in
// plan setup (kept in the form until the plan is created).

import { esc, uid, today, addDays, fmtDay, daysBetween } from '../util.js';
import { RACE_TYPES } from '../plan.js';
import { toast } from '../ui.js';

const TYPE_OPTIONS = Object.entries(RACE_TYPES).map(([k, t]) => `<option value="${k}">${esc(t.label)}</option>`).join('');

export const racesCardHtml = (intro = true) => `
  <section class="card stack" id="races" style="margin-top:16px">
    <h2>Key races</h2>
    ${intro ? `<p class="muted small">Races before your Ironman, like a spring marathon. The plan eases off before each one, puts the race in, and builds in recovery after. A <b>B race</b> matters to you: full taper and recovery. A <b>C race</b> is a training race: a short ease-off and quicker return.</p>` : ''}
    <div data-race-list></div>
    <form class="form-grid" data-race-form>
      <label class="field wide"><span>Race name</span><input type="text" name="name" maxlength="80" placeholder="e.g. Tamarack Ottawa Marathon" required></label>
      <label class="field"><span>Date</span><input type="date" name="date" required></label>
      <label class="field"><span>Distance</span><select name="type">${TYPE_OPTIONS}</select></label>
      <label class="field"><span>How much it matters</span><select name="priority"><option value="B">B: taper + recover</option><option value="C">C: training race</option></select></label>
      <label class="field wide"><span>Notes (optional)</span><input type="text" name="notes" maxlength="200" placeholder="Goal, start time, anything to remember"></label>
      <div class="row wide" style="justify-content:flex-end"><button class="btn primary">Add race</button></div>
    </form>
  </section>`;

function listHtml(races) {
  if (!races.length) return `<p class="muted small">No key races yet.</p>`;
  return `<div class="list">${races.map(r => {
    const T = RACE_TYPES[r.type], left = daysBetween(today(), r.date);
    return `<div class="list-item"><span class="race-flag" aria-hidden="true">🏁</span>
      <div><div class="li-title">${esc(r.name)} <span class="tag">${r.priority === 'C' ? 'C race' : 'B race'}</span></div>
      <div class="li-sub">${esc(fmtDay(r.date, { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' }))} · ${esc(T?.label || r.type)}${left >= 0 ? ` · in ${left} days` : ' · done'}${r.notes ? ` · ${esc(r.notes)}` : ''}</div></div>
      <button class="btn small ghost danger" data-race-remove="${esc(r.id)}" aria-label="Remove ${esc(r.name)}">Remove</button></div>`;
  }).join('')}</div>`;
}

// opts: { get: () => races, save: async (races, changed, action) => void, bounds: () => ({ start, end }) }
export function mountRacesCard(root, { get, save, bounds }) {
  const card = root.querySelector('#races');
  if (!card) return;
  const listEl = card.querySelector('[data-race-list]');
  const paint = () => { listEl.innerHTML = listHtml(get()); };
  paint();

  card.addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const { start, end } = bounds();
    const r = { id: uid(), name: f.name.value.trim(), date: f.date.value, type: f.type.value, priority: f.priority.value, notes: f.notes.value.trim() };
    if (!r.name || !r.date) return;
    if (start && r.date < start) { toast(`That's before your plan starts (${fmtDay(start)}).`); return; }
    if (end && r.date >= addDays(end, -6)) { toast('That’s in your Ironman’s final week. Pick an earlier race.'); return; }
    if (get().some(x => x.date === r.date)) { toast('You already have a race that day.'); return; }
    if (end && r.priority !== 'C' && daysBetween(r.date, end) < 28) toast('Heads up: that’s within 4 weeks of your Ironman. Consider making it a C race.');
    const btn = f.querySelector('.btn.primary'); btn.disabled = true;
    try {
      await save([...get(), r], r, 'add');
      f.reset();
    } catch (err) { toast(err.message); }
    btn.disabled = false;
    paint();
  });

  card.addEventListener('click', async e => {
    const id = e.target.closest('[data-race-remove]')?.dataset.raceRemove;
    if (!id) return;
    const r = get().find(x => x.id === id);
    try { await save(get().filter(x => x.id !== id), r, 'remove'); } catch (err) { toast(err.message); }
    paint();
  });
}
