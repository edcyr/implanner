import { store } from '../store.js';
import { toast } from '../ui.js';

export const title = 'Sign in';
let mode = null;           // 'signin' | 'signup'; invited people start on sign-up

export function render() {
  const invited = !!sessionStorage.getItem('implanner:join');
  mode ||= invited && !localStorage.getItem('implanner:seen') ? 'signup' : 'signin';
  const up = mode === 'signup';
  return `<div class="auth-wrap"><div class="auth-card">
    <div class="brand"><span class="brand-mark">IM</span><span class="brand-name">IMPlanner</span></div>
    <p class="tagline">Plan your Ironman season, follow it, and support each other.</p>
    ${invited ? `<p class="note" style="margin-bottom:14px">You've been invited to a crew. ${up ? 'Create an account' : 'Sign in'} and you'll join right after.</p>` : ''}
    <form class="card stack" data-auth>
      <div class="seg" style="width:100%"><button type="button" style="flex:1" data-action="mode" data-v="signin" aria-pressed="${!up}">Sign in</button><button type="button" style="flex:1" data-action="mode" data-v="signup" aria-pressed="${up}">Create account</button></div>
      ${up ? `<label class="field"><span>Your name</span><input type="text" name="name" maxlength="60" autocomplete="name" required placeholder="Shown to your crew"></label>` : ''}
      <label class="field"><span>Email</span><input type="email" name="email" autocomplete="email" required></label>
      <label class="field"><span>Password</span><input type="password" name="password" minlength="8" autocomplete="${up ? 'new-password' : 'current-password'}" required>${up ? '<small>At least 8 characters</small>' : ''}</label>
      <button class="btn primary" type="submit">${up ? 'Create account' : 'Sign in'}</button>
      ${up ? '' : `<button class="btn ghost small" type="button" data-action="forgot">Forgot password?</button>`}
    </form>
    <p class="muted small" style="text-align:center;margin-top:14px">Free, no ads, no leaderboards.</p>
  </div></div>`;
}

export function mount(root) {
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
