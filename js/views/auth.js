import { store } from '../store.js';
import { toast, daysTo } from '../ui.js';
import { esc, today } from '../util.js';
import { RACE_PRESET } from '../plan.js';
import { dailyLine } from '../inspire.js';

export const title = 'Sign in';
let mode = null;           // 'signin' | 'signup'; invited people start on sign-up

// Landing photo (your own, metadata stripped). If it fails to load, the sunrise gradient shows instead.
const HERO = {
  src: 'img/finish-line.jpg',
  srcset: 'img/finish-line-1000.jpg 1000w, img/finish-line.jpg 1760w',
  alt: 'Athletes on the finishing carpet under the IRONMAN Mont-Tremblant arch, race clock at 10:04:26, crowds cheering on both sides',
  credit: 'Mont-Tremblant finish line, 2012',
};

const svg = d => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const PROPS = [
  ['var(--swim)', svg('<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'), 'A plan built for you', 'A full season from today to race day, with easier weeks built in. Change anything.'],
  ['var(--bike)', svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'), 'Scored on following it', 'Not on who went furthest or fastest. Doing way more than planned doesn’t earn extra.'],
  ['var(--run)', svg('<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19.5c.6-3.3 3-5 6-5s5.4 1.7 6 5"/><circle cx="17" cy="9.5" r="2.4"/><path d="M16.5 14.6c2.3.2 4 1.6 4.5 4.4"/>'), 'Train with your crew', 'See how friends are doing against their own plans and cheer them on.'],
];

export function render() {
  const invited = !!sessionStorage.getItem('implanner:join');
  mode ||= invited && !localStorage.getItem('implanner:seen') ? 'signup' : 'signin';
  const up = mode === 'signup';
  const left = daysTo(RACE_PRESET.date);
  return `<div class="landing">
  <section class="landing-hero" data-hero>
    <img src="${HERO.src}" srcset="${HERO.srcset}" sizes="(max-width: 899px) 100vw, 55vw" alt="${esc(HERO.alt)}" data-hero-img>
    <span class="photo-credit">${esc(HERO.credit)}</span>
    <div class="copy">
      <div class="tri-bar" style="width:96px;margin-bottom:18px" aria-hidden="true"></div>
      <div class="eyebrow">${esc(RACE_PRESET.name)} · August 8, 2027</div>
      <h1>Every finish line starts with a plan.</h1>
      <p class="daily-line">${esc(dailyLine(today()))}</p>
      ${left > 0 ? `<div class="landing-count"><b>${left}</b> days to race day</div>` : ''}
    </div>
  </section>
  <section class="landing-side"><div class="auth-card">
    <div class="brand"><span class="brand-mark">IM</span><span class="brand-name">IMPlanner</span></div>
    <h2 style="margin-bottom:6px">${up ? 'Join the training' : 'Welcome back'}</h2>
    <p class="muted" style="margin-bottom:18px">Plan your Ironman season, follow it, and get there together.</p>
    ${invited ? `<p class="note" style="margin-bottom:14px">You've been invited to a crew. ${up ? 'Create an account' : 'Sign in'} and you'll join right after.</p>` : ''}
    <form class="card stack" data-auth>
      <div class="seg" style="width:100%"><button type="button" style="flex:1" data-action="mode" data-v="signin" aria-pressed="${!up}">Sign in</button><button type="button" style="flex:1" data-action="mode" data-v="signup" aria-pressed="${up}">Create account</button></div>
      ${up ? `<label class="field"><span>Your name</span><input type="text" name="name" maxlength="60" autocomplete="name" required placeholder="Shown to your crew"></label>` : ''}
      <label class="field"><span>Email</span><input type="email" name="email" autocomplete="email" required></label>
      <label class="field"><span>Password</span><input type="password" name="password" minlength="8" autocomplete="${up ? 'new-password' : 'current-password'}" required>${up ? '<small>At least 8 characters</small>' : ''}</label>
      <button class="btn primary" type="submit">${up ? 'Create account' : 'Sign in'}</button>
      ${up ? '' : `<button class="btn ghost small" type="button" data-action="forgot">Forgot password?</button>`}
    </form>
    <div class="props">${PROPS.map(([c, ic, h, t]) => `<div class="prop"><span class="pi" style="background:${c}">${ic}</span><div><b>${h}</b>${t}</div></div>`).join('')}</div>
    <p class="muted small" style="margin-top:20px">Free. No ads, no leaderboards.</p>
    <p class="muted small" style="margin-top:6px">IMPlanner is an independent project. It isn’t affiliated with or endorsed by IRONMAN.</p>
  </div></section></div>`;
}

export function mount(root) {
  const hero = root.querySelector('[data-hero]'), img = root.querySelector('[data-hero-img]');
  const shown = () => hero.classList.add('has-photo');
  if (img.complete && img.naturalWidth) shown();
  else { img.addEventListener('load', shown); img.addEventListener('error', () => img.remove()); }
  root.querySelector('[data-auth]').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      if (mode === 'signup') await store.signUp(f.email.value.trim(), f.password.value, f.name.value.trim());
      else await store.signIn(f.email.value.trim(), f.password.value);
      localStorage.setItem('implanner:seen', '1');
      // onAuth in app.js takes it from here
    } catch (err) {
      toast(/invalid login/i.test(err.message) ? 'Email or password is wrong' : err.message);
      btn.disabled = false;
    }
  });
}

export const actions = {
  mode: (el, e, ctx) => { mode = el.dataset.v; ctx.rerender(); },
  forgot: async (el, e, ctx) => {
    const email = ctx.root.querySelector('[name=email]').value.trim();
    if (!email) { toast('Enter your email first'); return; }
    try { await store.sendReset(email); toast(`If ${email} has an account, a reset link is on its way`); }
    catch (err) { toast(`Couldn't send the email (${err.message}). Ask whoever runs your IMPlanner to reset it.`); }
  },
};
