import { esc, today, addDays, mondayOf, fmtMMSS, parseMMSS, fmtDay, debounce } from '../util.js';
import { state, saveProfile, regenerateFrom, isCloud, exportData, importData, load } from '../state.js';
import { store, localStore } from '../store.js';
import { toast, confirmDialog, openModal, closeModal } from '../ui.js';
import { planFields, readPlanFields, validatePlan, planPreview, drawPreview } from './setup.js';
import { rerender, go } from '../nav.js';
import { garminCardHtml, mountGarminCard } from './garmin-card.js';

export const title = 'Settings';
const THEME_KEY = 'implanner:theme';

export function applyTheme(v = localStorage.getItem(THEME_KEY) || 'system') {
  if (v === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', v);
}

export function render() {
  const p = state.profile, th = p.settings.thresholds || {}, ps = p.settings.plan;
  const theme = localStorage.getItem(THEME_KEY) || 'system';
  const nextMon = addDays(mondayOf(today()), 7);
  return `
  <div class="page-head"><div><h1>Settings</h1></div></div>

  <form class="card stack" data-form="profile">
    <h2>You and your race</h2>
    <div class="form-grid">
      <label class="field"><span>Your name</span><input type="text" name="name" maxlength="60" value="${esc(p.name)}" required></label>
      <label class="field"><span>Race</span><input type="text" name="race_name" maxlength="80" value="${esc(p.race_name)}" required></label>
      <label class="field"><span>Race date</span><input type="date" name="race_date" value="${p.race_date}" required><small>Changing it? Rebuild your plan below too.</small></label>
    </div>
    <div class="row" style="justify-content:flex-end"><button class="btn primary">Save</button></div>
  </form>

  <form class="card stack" data-form="zones" style="margin-top:16px">
    <h2>Training zones</h2>
    <p class="muted small">Optional. Used to put watts and paces into workouts and to work out time in zones from your Garmin files. These stay private.</p>
    <div class="form-grid">
      <label class="field"><span>Bike FTP (watts)</span><input type="number" name="ftp" min="50" max="600" value="${th.ftp ?? ''}"></label>
      <label class="field"><span>Bike threshold HR (bpm)</span><input type="number" name="lthr_bike" min="80" max="220" value="${th.lthr_bike ?? ''}"></label>
      <label class="field"><span>Run threshold HR (bpm)</span><input type="number" name="lthr_run" min="80" max="220" value="${th.lthr_run ?? ''}"></label>
      <label class="field"><span>Run threshold pace (min:sec /km)</span><input type="text" name="run_pace" placeholder="4:45" value="${th.run_pace ? fmtMMSS(th.run_pace) : ''}"></label>
      <label class="field"><span>Swim CSS (min:sec /100 m)</span><input type="text" name="css" placeholder="1:50" value="${th.css ? fmtMMSS(th.css) : ''}"></label>
    </div>
    <div class="row" style="justify-content:flex-end"><button class="btn primary">Save zones</button></div>
  </form>

  <form class="card stack" data-form="plan" id="plan" style="margin-top:16px">
    <h2>Rebuild your plan</h2>
    <p class="muted small">Change your hours or week layout, then rebuild from a date. Sessions you've already logged stay as they are; everything planned after that date is replaced, including your own edits.</p>
    ${planFields(ps)}
    <div data-preview></div><div class="chart" data-chart="preview" data-label="Planned hours each week"></div>
    <div class="row" style="justify-content:flex-end;align-items:flex-end">
      <label class="field"><span>Rebuild from</span><input type="date" name="from" value="${nextMon}"></label>
      <button class="btn primary">Rebuild plan</button></div>
  </form>

  ${isCloud() ? garminCardHtml() : ''}

  ${isCloud() ? `<form class="card stack" data-form="sharing" style="margin-top:16px">
    <h2>What your crew sees</h2>
    <p class="muted small">Always shared: your plan, which sessions you completed or skipped (and why), their length, how they felt, and your notes.</p>
    <label class="check"><input type="checkbox" name="share_details" ${p.share_details ? 'checked' : ''}><span><b>Also share distance, pace, heart rate and power</b><br><span class="muted small">Off by default, so it's about following the plan, not comparing numbers.</span></span></label>
    <div class="row" style="justify-content:flex-end"><button class="btn primary">Save</button></div>
  </form>` : ''}

  <section class="card stack" style="margin-top:16px">
    <h2>Appearance</h2>
    <div class="seg" role="group" aria-label="Theme">${[['system', 'Match device'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<button data-action="theme" data-v="${v}" aria-pressed="${theme === v}">${l}</button>`).join('')}</div>
  </section>

  <section class="card stack" style="margin-top:16px">
    <h2>Your data</h2>
    <p class="muted small">Download everything as one file to keep a backup, or to move to another device.</p>
    <div class="row"><button class="btn" data-action="export">Download backup</button>
      <label class="btn">Restore from backup<input type="file" accept=".json,application/json" data-restore hidden></label>
      ${isCloud() ? '' : `<button class="btn ghost danger" data-action="wipe">Delete everything on this device</button>`}</div>
  </section>

  ${isCloud() ? `<section class="card stack" style="margin-top:16px">
    <h2>Account</h2>
    <p class="muted small">Signed in as <b>${esc(store.user?.email || '')}</b></p>
    <div class="row"><button class="btn" data-action="password">Change password</button><button class="btn ghost" data-action="signout">Sign out</button></div>
  </section>` : `<p class="note" style="margin-top:16px">This copy keeps everything in this browser. To share with friends, connect it to Supabase (see the README).</p>`}`;
}

export function mount(root, params) {
  if (params[0] === 'plan' || params[0] === 'garmin') requestAnimationFrame(() => root.querySelector(`#${params[0]}`)?.scrollIntoView({ block: 'start' }));
  if (isCloud()) mountGarminCard(root);
  const planForm = root.querySelector('[data-form="plan"]');
  const prev = planForm.querySelector('[data-preview]'), chartEl = planForm.querySelector('[data-chart="preview"]');
  const update = () => { const { html, weeks } = planPreview(readPlanFields(planForm), state.profile.race_date); prev.innerHTML = html; drawPreview(chartEl, weeks); };
  update();
  planForm.addEventListener('input', debounce(update, 150));
  const ro = new ResizeObserver(() => update()); ro.observe(chartEl);

  root.addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, kind = f.dataset.form, p = state.profile;
    try {
      if (kind === 'profile') {
        await saveProfile({ name: f.name.value.trim(), race_name: f.race_name.value.trim(), race_date: f.race_date.value });
        toast('Saved');
      } else if (kind === 'zones') {
        const n = v => v === '' ? null : +v;
        const thresholds = { ftp: n(f.ftp.value), lthr_bike: n(f.lthr_bike.value), lthr_run: n(f.lthr_run.value), run_pace: parseMMSS(f.run_pace.value), css: parseMMSS(f.css.value) };
        await saveProfile({ settings: { ...p.settings, thresholds } });
        toast('Zones saved. Rebuild your plan to update workout targets.');
      } else if (kind === 'plan') {
        const ps = readPlanFields(f);
        const err = validatePlan(ps, p.race_date);
        if (err) { toast(err); return; }
        const from = f.from.value || today();
        const ok = await confirmDialog({ title: 'Rebuild your plan?', message: `Planned sessions from ${fmtDay(from, { weekday: 'long', month: 'long', day: 'numeric' })} on will be replaced. Logged workouts are kept.`, confirm: 'Rebuild' });
        if (!ok) return;
        await saveProfile({ settings: { ...p.settings, plan: ps } });
        const r = await regenerateFrom(from);
        toast(`Plan rebuilt: ${r.added} sessions`); go('#/plan');
      } else if (kind === 'sharing') {
        await saveProfile({ share_details: f.share_details.checked });
        toast('Saved');
      }
    } catch (err) { toast(err.message); }
  });

  root.querySelector('[data-restore]')?.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const ok = await confirmDialog({ title: 'Restore this backup?', message: `It has ${data.sessions?.length || 0} planned sessions and ${data.activities?.length || 0} workouts. They'll be added to what's here, replacing any with the same IDs.`, confirm: 'Restore' });
      if (!ok) return;
      await importData(data); toast('Backup restored'); rerender();
    } catch (err) { toast(err.message || 'Could not read that file'); }
  });
  return () => ro.disconnect();
}

export const actions = {
  theme: el => { localStorage.setItem(THEME_KEY, el.dataset.v); applyTheme(el.dataset.v); rerender(); },
  export: async () => {
    const data = await exportData();
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `implanner-backup-${today()}.json`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },
  wipe: async () => {
    const ok = await confirmDialog({ title: 'Delete everything?', message: 'Your plan and every logged workout on this device will be erased. Download a backup first if you might want it.', confirm: 'Delete everything', danger: true });
    if (!ok) return;
    await localStore.clearAll(); await load(); go('#/setup');
  },
  signout: async () => { await store.signOut(); location.hash = '#/today'; location.reload(); },
  password: () => openModal({
    title: 'Change password',
    body: `<form data-submit="save" id="pwf" class="stack"><label class="field"><span>New password</span><input type="password" name="pw" minlength="8" autocomplete="new-password" required></label></form>`,
    foot: `<button class="btn ghost" data-action="close">Cancel</button><button class="btn primary" form="pwf">Save</button>`,
    actions: { save: async f => { try { await store.updatePassword(f.pw.value); closeModal(); toast('Password changed'); } catch (e) { toast(e.message); } } },
  }),
};
