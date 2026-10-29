// Dialogs shared across pages: view a planned session, log it, skip it, edit or add one.

import { esc, uid, today, fmtDay, fmtMin, fmtHMS, parseHMS, fmtDist, SPORTS, SPORT_ORDER, SKIP_REASONS, sportIcon, addDays } from './util.js';
import { state, saveSession, deleteSession, saveActivity, sessionById, activitiesFor, sessionsBetween } from './state.js';
import { sessionStatus } from './compliance.js';
import { openModal, closeModal, confirmDialog, toast, statusBadge, sessionMeta, feelPicker, pickFeel, feelChip } from './ui.js';
import { rerender } from './nav.js';
import { weekFor } from './plan.js';

const formData = form => Object.fromEntries(new FormData(form).entries());

// ---- view a planned session --------------------------------------------------------
export function openSession(id) {
  const s = sessionById(id);
  if (!s) return;
  const st = sessionStatus(s, state.bySession);
  const acts = activitiesFor(id);
  const past = s.date <= today();
  const body = `
    <div class="session-card">
      ${sportIcon(s.sport)}
      <div>
        <div class="meta">${esc(fmtDay(s.date, { weekday: 'long', month: 'long', day: 'numeric' }))}</div>
        <div class="row" style="margin-top:4px">${statusBadge(st.status)} <span class="muted small">${esc(sessionMeta(s))}</span></div>
        <p class="desc">${esc(s.description)}</p>
        ${s.skip_reason ? `<p class="note" style="margin-top:10px">Skipped: <strong>${esc(s.skip_reason)}</strong></p>` : ''}
        ${acts.map(a => `<a class="list-item" style="border:1px solid var(--border);border-radius:10px;margin-top:10px" href="#/activity/${a.id}">
            ${sportIcon(a.sport)}<div><div class="li-title">${esc(a.title || 'Logged')}</div>
            <div class="li-sub">${fmtHMS(a.duration_s)}${a.distance_m ? ` · ${fmtDist(a.distance_m, a.sport)}` : ''} ${feelChip(a.feel)}</div></div><span class="li-end">Open ›</span></a>`).join('')}
      </div>
    </div>`;
  const canLog = !acts.length;
  const foot = `
    <button class="btn ghost left" data-action="edit">Edit</button>
    ${canLog && past && !s.skip_reason ? `<button class="btn" data-action="skip">Skip</button>` : ''}
    ${s.skip_reason ? `<button class="btn" data-action="unskip">Undo skip</button>` : ''}
    ${canLog ? `<button class="btn" data-action="log">Log details</button><button class="btn primary" data-action="done">Done as planned</button>` : `<button class="btn" data-action="log">Log another</button>`}`;
  openModal({
    title: s.title, body, foot,
    actions: {
      edit: () => openSessionEditor(s),
      skip: () => openSkip(s),
      unskip: async () => { await saveSession({ ...s, skip_reason: null }); closeModal(); rerender(); },
      log: () => openLogForm({ session: s }),
      done: async () => { await quickDone(s); closeModal(); toast('Nice work. Logged as planned.'); rerender(); },
    },
  });
}

export async function quickDone(s) {
  await saveActivity({
    id: uid(), session_id: s.id, date: s.date, start_time: null, sport: s.sport, title: s.title,
    duration_s: (s.duration_min || 0) * 60, distance_m: s.distance_m || null, source: 'manual',
    rpe: null, feel: null, notes: '', file_hash: null,
  });
  if (s.skip_reason) await saveSession({ ...s, skip_reason: null });
}

export function openSkip(s) {
  openModal({
    title: 'Skip this session?',
    body: `<p class="muted">Life happens. Saying why helps your crew support you. Skipped sessions still count as not done in your plan score.</p>
      <form data-submit="save" id="skipf" class="stack" style="margin-top:14px">
        <div class="row">${SKIP_REASONS.map(r => `<label class="tag" style="cursor:pointer;padding:6px 12px"><input type="radio" name="reason" value="${r}" style="margin:0 6px 0 0">${r}</label>`).join('')}</div>
        <label class="field"><span>Note (optional)</span><input type="text" name="note" maxlength="140" placeholder="e.g. Head cold, back Thursday"></label>
      </form>`,
    foot: `<button class="btn ghost" data-action="close">Cancel</button><button class="btn primary" form="skipf">Skip session</button>`,
    actions: {
      save: async form => {
        const d = formData(form);
        const reason = [d.reason, d.note?.trim()].filter(Boolean).join(': ') || 'Skipped';
        await saveSession({ ...s, skip_reason: reason.slice(0, 200) });
        closeModal(); rerender();
      },
    },
  });
}

// ---- log a workout by hand (swims mostly), or edit one ----------------------------------
export function openLogForm({ session = null, sport = null, date = null, activity = null } = {}) {
  const a = activity || {};
  const sp = a.sport || session?.sport || sport || 'swim';
  const d = a.date || session?.date || date || today();
  const isSwim = sp === 'swim';
  const durVal = a.duration_s ? fmtHMS(a.duration_s) : session ? fmtHMS(session.duration_min * 60) : '';
  const distVal = a.distance_m ? (isSwim ? Math.round(a.distance_m) : (a.distance_m / 1000).toFixed(2)) : (session?.distance_m && isSwim ? session.distance_m : '');
  const body = `
    <form data-submit="save" id="logf" class="stack">
      <div class="form-grid">
        <label class="field"><span>Sport</span><select name="sport" data-action="sport-change">${SPORT_ORDER.map(k => `<option value="${k}" ${k === sp ? 'selected' : ''}>${SPORTS[k].label}</option>`).join('')}</select></label>
        <label class="field"><span>Date</span><input type="date" name="date" value="${d}" required></label>
        <label class="field"><span>Time (h:mm:ss)</span><input type="text" name="duration" inputmode="numeric" value="${esc(durVal)}" placeholder="1:05:00" required><small>Or just minutes, e.g. 45</small></label>
        <label class="field" data-dist><span>Distance (<span data-unit>${isSwim ? 'm' : 'km'}</span>)</span><input type="number" name="distance" step="any" min="0" value="${esc(distVal)}" placeholder="${isSwim ? '2500' : '40'}"></label>
        <label class="field" data-pool ${isSwim ? '' : 'hidden'}><span>Pool</span><select name="pool">
          ${[['25', '25 m'], ['50', '50 m'], ['22.86', '25 yd'], ['0', 'Open water']].map(([v, l]) => `<option value="${v}" ${String(a.pool_length_m ?? 25) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field wide"><span>Planned session</span><select name="session_id">${sessionOptions(sp, d, a.session_id ?? session?.id)}</select></label>
      </div>
      <div class="field"><span>How did it feel?</span>${feelPicker('feel', a.feel)}</div>
      <label class="field"><span>Effort (RPE): <b data-rpe>${a.rpe || 5}</b>/10</span><input type="range" name="rpe" min="1" max="10" value="${a.rpe || 5}" data-action="rpe"></label>
      <label class="field"><span>Notes for your crew</span><textarea name="notes" maxlength="2000" placeholder="Sets, how it went, anything you want to remember">${esc(a.notes || '')}</textarea></label>
    </form>`;
  openModal({
    title: activity ? 'Edit workout' : session ? `Log: ${session.title}` : 'Log a workout',
    body,
    foot: `<button class="btn ghost" data-action="close">Cancel</button><button class="btn primary" form="logf">Save</button>`,
    onMount: dlg => {
      const f = dlg.querySelector('#logf');
      const sync = () => {
        const sw = f.sport.value === 'swim';
        dlg.querySelector('[data-pool]').hidden = !sw;
        dlg.querySelector('[data-unit]').textContent = sw ? 'm' : 'km';
        f.session_id.innerHTML = sessionOptions(f.sport.value, f.date.value, f.session_id.value);
      };
      f.sport.addEventListener('change', sync);
      f.date.addEventListener('change', sync);
      f.rpe.addEventListener('input', () => { dlg.querySelector('[data-rpe]').textContent = f.rpe.value; });
    },
    actions: {
      'pick-feel': el => pickFeel(el),
      save: async form => {
        const v = formData(form);
        const dur = parseHMS(v.duration);
        if (!dur) { toast('Enter a time like 1:05:00 or 45'); return; }
        const dist = v.distance === '' ? null : +v.distance * (v.sport === 'swim' ? 1 : 1000);
        const linked = v.session_id ? sessionById(v.session_id) : null;
        const rec = {
          ...a, id: a.id || uid(), session_id: v.session_id || null, date: v.date, sport: v.sport,
          title: a.title || linked?.title || `${SPORTS[v.sport].label}`, duration_s: dur,
          distance_m: dist, pool_length_m: v.sport === 'swim' ? +v.pool : null,
          source: a.source || 'manual', rpe: +v.rpe || null, feel: v.feel || null, notes: v.notes.trim(),
          start_time: a.start_time || null, file_hash: a.file_hash || null,
        };
        await saveActivity(rec);
        if (linked?.skip_reason) await saveSession({ ...linked, skip_reason: null });
        closeModal(); toast(activity ? 'Saved' : 'Logged. Nice work.'); rerender();
      },
    },
  });
}

function sessionOptions(sport, date, selected) {
  const near = sessionsBetween(addDays(date, -3), addDays(date, 3))
    .filter(s => s.sport === sport && (s.id === selected || !activitiesFor(s.id).length));
  near.sort((a, b) => Math.abs(new Date(a.date) - new Date(date)) - Math.abs(new Date(b.date) - new Date(date)));
  return `<option value="">Not part of the plan (extra)</option>` + near.map(s =>
    `<option value="${s.id}" ${s.id === selected ? 'selected' : ''}>${esc(fmtDay(s.date))}: ${esc(s.title)} (${esc(fmtMin(s.duration_min))})</option>`).join('');
}

// ---- edit or add a planned session ----------------------------------------------------------
export function openSessionEditor(s = null, { date = today(), sport = 'run' } = {}) {
  const isNew = !s;
  const x = s || { id: uid(), date, sport, kind: 'custom', title: '', description: '', duration_min: 45, distance_m: null, phase: '', week: 0, sort: 2, skip_reason: null };
  const body = `
    <form data-submit="save" id="sessf" class="stack">
      <div class="form-grid">
        <label class="field"><span>Sport</span><select name="sport">${SPORT_ORDER.map(k => `<option value="${k}" ${k === x.sport ? 'selected' : ''}>${SPORTS[k].label}</option>`).join('')}</select></label>
        <label class="field"><span>Date</span><input type="date" name="date" value="${x.date}" required></label>
        <label class="field"><span>Planned time (minutes)</span><input type="number" name="duration_min" min="0" max="1440" step="5" value="${x.duration_min}" required></label>
        <label class="field"><span>Distance (m, optional)</span><input type="number" name="distance_m" min="0" step="50" value="${x.distance_m ?? ''}"><small>Used to score swims</small></label>
        <label class="field wide"><span>Title</span><input type="text" name="title" maxlength="120" value="${esc(x.title)}" placeholder="e.g. Easy run" required></label>
        <label class="field wide"><span>Workout</span><textarea name="description" maxlength="2000" rows="4">${esc(x.description)}</textarea></label>
      </div>
    </form>`;
  openModal({
    title: isNew ? 'Add a session' : 'Edit session', body,
    foot: `${isNew ? '' : `<button class="btn danger left" data-action="del">Delete</button>`}<button class="btn ghost" data-action="close">Cancel</button><button class="btn primary" form="sessf">Save</button>`,
    actions: {
      save: async form => {
        const v = formData(form);
        const wk = weekFor(state.weeks, v.date);
        await saveSession({
          ...x, sport: v.sport, date: v.date, title: v.title.trim(), description: v.description.trim(),
          duration_min: Math.round(+v.duration_min || 0), distance_m: v.distance_m === '' ? null : Math.round(+v.distance_m),
          week: wk?.index ?? x.week, phase: wk?.phase ?? x.phase,
        });
        closeModal(); toast(isNew ? 'Session added' : 'Session saved'); rerender();
      },
      del: async () => {
        const n = activitiesFor(x.id).length;
        const ok = await confirmDialog({ title: 'Delete this session?', message: n ? 'Your logged workout stays, but it will no longer count toward the plan.' : 'It will be removed from your plan.', confirm: 'Delete', danger: true });
        if (!ok) return;
        await deleteSession(x.id); toast('Session deleted'); rerender();
      },
    },
  });
}
