// Settings card for connecting Garmin Connect (cloud accounts only).

import { esc, today, addDays, fmtDay, timeAgo, daysBetween } from '../util.js';
import { store } from '../store.js';
import { toast, confirmDialog } from '../ui.js';
import { syncGarmin, syncMessage } from '../garmin.js';
import { rerender } from '../nav.js';

const KEY_PAGE = 'https://connect.garmin.com/app/settings/personalApiToken';

export const garminCardHtml = () => `
  <section class="card stack" id="garmin" style="margin-top:16px">
    <h2>Garmin Connect</h2>
    <div data-garmin><p class="muted small">Checking your Garmin connection…</p></div>
  </section>`;

function form(replacing) {
  return `
    ${replacing ? '' : `<p>Have your rides, runs and swims appear here on their own, matched to your plan.</p>`}
    <ol class="small" style="margin:0;padding-left:20px;color:var(--ink-2)">
      <li>Open <a href="${KEY_PAGE}" target="_blank" rel="noopener">your Personal API Key page in Garmin Connect</a> (sign in if asked).</li>
      <li>Select <b>Create Key</b>, read and accept Garmin’s terms, and choose an expiry (<b>1 year</b> is easiest).</li>
      <li>Copy the key (Garmin shows it only once) and paste it here.</li>
    </ol>
    <form class="form-grid" data-garmin-form>
      <label class="field wide"><span>Personal API key</span><input type="password" name="key" autocomplete="off" autocapitalize="off" spellcheck="false" required></label>
      <label class="field"><span>Key expires in</span><select name="days">
        <option value="365" selected>1 year</option><option value="180">180 days</option><option value="90">90 days</option><option value="30">30 days</option></select>
        <small>The same as you picked in Garmin</small></label>
      <div class="row wide" style="justify-content:flex-end">${replacing ? '<button type="button" class="btn ghost" data-garmin-cancel>Cancel</button>' : ''}<button class="btn primary">Connect Garmin</button></div>
    </form>
    <p class="note">Your key is stored encrypted and used only to read your own workouts. Your crew never sees it, and you can disconnect at any time.</p>`;
}

function status(st) {
  const left = st.key_expires ? daysBetween(today(), st.key_expires) : null;
  const expiry = left == null ? '' : left < 0 ? `<b style="color:var(--critical)">Your key expired on ${fmtDay(st.key_expires)}.</b> Create a new one and replace it below.`
    : left <= 14 ? `<b>Your key expires in ${left} day${left === 1 ? '' : 's'}</b> (${fmtDay(st.key_expires)}). Create a new one in Garmin Connect and replace it here.`
    : `Key expires ${fmtDay(st.key_expires, { month: 'long', day: 'numeric', year: 'numeric' })}.`;
  return `
    <p><span class="badge st-on"><span class="mk" aria-hidden="true">✓</span>Connected</span>
      <span class="muted small" style="margin-left:6px">${st.last_sync_at ? `Last synced ${esc(timeAgo(st.last_sync_at))}` : 'Not synced yet'}</span></p>
    ${st.last_error ? `<p class="note" style="color:var(--critical)">Last sync didn’t work: ${esc(st.last_error)}</p>` : ''}
    <p class="muted small">${expiry} New workouts come in when you open IMPlanner. Swims, rides, runs, bricks and strength sessions are imported; walks and other activities are skipped.</p>
    <div class="row"><button class="btn primary" data-garmin-sync>Sync now</button><button class="btn" data-garmin-replace>Replace key</button><button class="btn ghost danger" data-garmin-off>Disconnect</button></div>`;
}

export async function mountGarminCard(root) {
  const box = root.querySelector('[data-garmin]');
  if (!box) return;
  let st;
  try { st = await store.garminStatus(); } catch (e) { box.innerHTML = `<p class="note">Couldn’t check Garmin: ${esc(e.message)}</p>`; return; }
  box.innerHTML = st ? status(st) : form(false);

  box.addEventListener('click', async e => {
    const t = e.target;
    if (t.matches('[data-garmin-replace]')) box.innerHTML = form(true);
    if (t.matches('[data-garmin-cancel]')) box.innerHTML = status(st);
    if (t.matches('[data-garmin-sync]')) {
      t.disabled = true; t.textContent = 'Syncing…';
      try { toast(syncMessage(await syncGarmin({ force: true })) || 'Done'); } catch (err) { toast(err.message); }
      rerender();
    }
    if (t.matches('[data-garmin-off]')) {
      const ok = await confirmDialog({ title: 'Disconnect Garmin?', message: 'IMPlanner deletes your saved key and stops syncing. Workouts already synced stay. You can also delete the key in Garmin Connect.', confirm: 'Disconnect', danger: true });
      if (!ok) return;
      await store.garminDisconnect(); toast('Garmin disconnected'); rerender();
    }
  });

  box.addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector('.btn.primary');
    const key = f.key.value.trim();
    btn.disabled = true; btn.textContent = 'Connecting…';
    try {
      await store.garminConnect(key, addDays(today(), +f.days.value));
      f.key.value = '';
      try {
        await store.garmin({ action: 'test' });
      } catch (err) {
        // Keep the key so the problem can be fixed (or the key replaced) without pasting it again.
        toast(`Saved, but Garmin didn’t accept it yet: ${err.message}`);
        rerender();
        return;
      }
      toast('Garmin connected. Fetching your last two weeks…');
      const r = await syncGarmin({ force: true });
      toast(syncMessage(r) || 'Garmin connected');
      rerender();
    } catch (err) {
      toast(err.message);
      btn.disabled = false; btn.textContent = 'Connect Garmin';
    }
  });
}
