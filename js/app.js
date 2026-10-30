// IMPlanner: shell, router and start-up.

import { store } from './store.js';
import { state, load, hasPlan, isCloud } from './state.js';
import { initModal, initTooltips, toast, daysTo, openModal, closeModal } from './ui.js';
import { setRerender } from './nav.js';
import { esc } from './util.js';
import { syncGarmin, syncMessage } from './garmin.js';
import * as today from './views/today.js';
import * as season from './views/season.js';
import * as log from './views/log.js';
import * as activity from './views/activity.js';
import * as crew from './views/crew.js';
import * as progress from './views/progress.js';
import * as settings from './views/settings.js';
import * as setup from './views/setup.js';
import * as auth from './views/auth.js';

const ROUTES = { today, plan: season, log, activity, crew, join: crew, progress, settings, setup };
const NO_PLAN_OK = new Set(['setup', 'join', 'crew']);

const NAV_ICONS = {
  today: '<path d="M3 11.5L12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/>',
  plan: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  log: '<circle cx="12" cy="12" r="8.5"/><path d="M12 8v8M8 12h8"/>',
  crew: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19.5c.6-3.3 3-5 6-5s5.4 1.7 6 5"/><circle cx="17" cy="9.5" r="2.4"/><path d="M16.5 14.6c2.3.2 4 1.6 4.5 4.4"/>',
  progress: '<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
};
const navIcon = k => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${NAV_ICONS[k]}</svg>`;
const TABS = [['today', 'Today'], ['plan', 'Plan'], ['log', 'Log'], ['crew', 'Crew'], ['progress', 'Progress']];

function renderShell() {
  document.getElementById('app').innerHTML = `
    <nav class="sidebar" aria-label="Main">
      <a class="brand" href="#/today"><span class="brand-mark">IM</span><span class="brand-name">IMPlanner</span></a>
      ${[...TABS, ['settings', 'Settings']].map(([k, l]) => `<a class="nav-link" data-nav="${k}" href="#/${k}">${navIcon(k)}${l}</a>`).join('')}
      <div class="nav-foot" data-countdown></div>
      <div class="nav-account" data-account></div>
    </nav>
    <header class="topbar">
      <a class="brand" href="#/today"><span class="brand-mark">IM</span><span class="brand-name">IMPlanner</span></a>
      <a class="icon-btn" data-nav="settings" href="#/settings" aria-label="Settings">${navIcon('settings')}</a>
    </header>
    <main id="main" tabindex="-1"></main>
    <nav class="tabbar" aria-label="Main">${TABS.map(([k, l]) => `<a data-nav="${k}" href="#/${k}">${navIcon(k)}${l}</a>`).join('')}</nav>`;
}

function updateNav(name) {
  const active = name === 'activity' ? 'log' : name === 'join' ? 'crew' : name;
  document.querySelectorAll('[data-nav]').forEach(a => {
    if (a.dataset.nav === active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const cd = document.querySelector('[data-countdown]');
  const p = state.profile;
  if (cd) cd.innerHTML = p?.race_date && hasPlan() ? `<strong>${Math.max(0, daysTo(p.race_date))}</strong>days to ${esc(p.race_name)}` : '';
  const acct = document.querySelector('[data-account]');
  if (acct) acct.innerHTML = isCloud() && store.user
    ? `<span title="${esc(store.user.email || '')}">${esc(p?.name || store.user.email || '')}</span><button class="btn small ghost" data-signout>Sign out</button>` : '';
}

async function signOut() {
  await store.signOut();
  location.hash = '#/today';
  location.reload();
}

// ---- router ----------------------------------------------------------------------------
let current = null, cleanup = null;

async function show(view, params, name, { keepScroll = false } = {}) {
  cleanup?.(); cleanup = null;
  const ctx = { name, params, rerender };
  document.body.classList.toggle('auth-only', name === 'auth');
  updateNav(name);
  const main = document.getElementById('main');
  const y = scrollY;
  try {
    const root = document.createElement('div');
    root.className = 'view';
    root.innerHTML = await view.render(params, ctx);
    ctx.root = root;
    main.replaceChildren(root);
    current = { view, ctx };
    document.title = `${view.title} · IMPlanner`;
    if (keepScroll) scrollTo(0, y); else { scrollTo(0, 0); main.focus({ preventScroll: true }); }
    const c = await view.mount?.(root, params, ctx);
    if (typeof c === 'function') cleanup = c;
  } catch (e) {
    console.error(e);
    main.innerHTML = `<div class="empty"><h3>Something went wrong</h3><p>${esc(e.message)}</p><p style="margin-top:12px"><button class="btn" onclick="location.reload()">Try again</button></p></div>`;
  }
}

async function rerender() {
  if (current) await show(current.view, current.ctx.params, current.ctx.name, { keepScroll: true });
}

function route() {
  const raw = location.hash.replace(/^#\/?/, '');
  if (/^(access_token|error|type)=/.test(raw)) return;      // Supabase is handling an auth redirect
  let [name, ...params] = raw.split('/').map(s => decodeURIComponent(s));
  if (!ROUTES[name]) name = 'today';
  if (name === 'join' && params[0]) sessionStorage.setItem('implanner:join', params[0]);
  if (isCloud() && !store.user) return show(auth, [], 'auth');
  if (!hasPlan() && !NO_PLAN_OK.has(name)) name = 'setup';
  if (hasPlan() && name === 'setup') name = 'today';
  return show(ROUTES[name], params, name);
}

// Pull new Garmin workouts in the background (at most every 10 minutes; quiet unless something arrives).
async function autoSync() {
  if (!isCloud() || !store.user || !hasPlan()) return;
  try {
    const r = await syncGarmin();
    if (r?.connected && !r.skipped && r.added + r.filled > 0) { toast(syncMessage(r)); rerender(); }
  } catch (e) { console.warn('Garmin sync:', e.message); }
}

function askNewPassword() {
  openModal({
    title: 'Choose a new password',
    body: `<form data-submit="save" id="npw"><label class="field"><span>New password</span><input type="password" name="pw" minlength="8" autocomplete="new-password" required></label></form>`,
    foot: `<button class="btn primary" form="npw">Save password</button>`,
    actions: { save: async f => { try { await store.updatePassword(f.pw.value); closeModal(); toast('Password updated'); } catch (e) { toast(e.message); } } },
  });
}

// ---- start --------------------------------------------------------------------------------
async function boot() {
  settings.applyTheme();
  renderShell();
  initModal();
  initTooltips();
  setRerender(rerender);
  const main = document.getElementById('main');
  main.innerHTML = '<div class="loading">Loading…</div>';
  document.addEventListener('click', e => { if (e.target.closest('[data-signout]')) signOut(); });
  main.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    const fn = el && current?.view.actions?.[el.dataset.action];
    if (!fn) return;
    if (el.tagName === 'A' || el.tagName === 'BUTTON') e.preventDefault();
    fn(el, e, current.ctx);
  });

  try {
    await store.init();
  } catch (e) {
    main.innerHTML = `<div class="empty"><h3>Can't reach IMPlanner's server</h3><p>${esc(e.message)}. Check your connection and try again.</p></div>`;
    return;
  }

  let loadedFor = store.user?.id || null;     // set before loading so the initial auth event doesn't load twice
  if (isCloud()) {
    // Supabase asks that this callback stays synchronous; do the work on the next tick.
    store.onAuth((event, user) => setTimeout(async () => {
      if (event === 'PASSWORD_RECOVERY') askNewPassword();
      if (user && user.id !== loadedFor) {
        loadedFor = user.id;
        try { await load(); } catch (e) { toast(e.message); }
        await route();
        autoSync();
      } else if (!user && loadedFor) {
        loadedFor = null;
        Object.assign(state, { profile: null, sessions: [], activities: [], crews: null });
        route();
      }
    }, 0));
  }
  if (!isCloud() || store.user) {
    try { await load(); }
    catch (e) { main.innerHTML = `<div class="empty"><h3>Couldn't load your training</h3><p>${esc(e.message)}</p><p style="margin-top:12px"><button class="btn" onclick="location.reload()">Try again</button></p></div>`; return; }
  }
  addEventListener('hashchange', route);
  await route();
  autoSync();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') autoSync(); });
}

boot();
