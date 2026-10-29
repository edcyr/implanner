import { esc, today, addDays, mondayOf, fmtHours, fmtRange, fmtDay, relDay, sportIcon, icon, timeAgo } from '../util.js';
import { state, isCloud, sessionsOn, sessionsBetween, currentWeek, sessionById, keyRaces } from '../state.js';
import { summarize, sessionStatus } from '../compliance.js';
import { PHASES } from '../plan.js';
import { ring, strip, statusBadge, sessionMeta, doneText, feelChip, phaseLabel, daysTo, toast, avatar } from '../ui.js';
import { openSession, openLogForm, openSkip, quickDone } from '../dialogs.js';
import { store } from '../store.js';
import { rerender, go } from '../nav.js';
import { dailyLine } from '../inspire.js';

export const title = 'Today';

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Up early' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function sessionCard(s) {
  const st = sessionStatus(s, state.bySession);
  const done = st.acts.length > 0;
  return `<article class="card session-card s-${s.sport}">
    ${sportIcon(s.sport)}
    <div>
      <h3>${esc(s.title)} ${statusBadge(st.status)}</h3>
      <div class="meta">${esc(sessionMeta(s))}</div>
      <p class="desc">${esc(s.description)}</p>
      ${done ? `<div class="done-line"><b>${esc(doneText(st))}</b> ${st.acts.map(a => feelChip(a.feel)).join('')}
          ${st.acts.map(a => `<a class="btn small ghost" href="#/activity/${a.id}">View</a>`).join('')}</div>`
        : s.skip_reason ? `<p class="note" style="margin-top:10px">Skipped: <strong>${esc(s.skip_reason)}</strong></p>`
        : `<div class="actions">
            <button class="btn primary" data-action="done" data-id="${s.id}">Done as planned</button>
            <button class="btn" data-action="log" data-id="${s.id}">Log details</button>
            ${s.sport !== 'swim' && s.sport !== 'strength' ? `<a class="btn" href="#/log">Import from Garmin</a>` : ''}
            <button class="btn ghost" data-action="skip" data-id="${s.id}">Skip</button></div>`}
    </div></article>`;
}

export function render() {
  const t = today();
  const p = state.profile;
  const first = state.weeks[0];
  const before = first && t < first.monday;          // plan hasn't started: preview week 1
  const mon = before ? first.monday : mondayOf(t), sun = addDays(mon, 6);
  const wk = currentWeek(t);
  const weekSessions = sessionsBetween(mon, sun);
  const sum = summarize(weekSessions, state.bySession, t);
  const todays = sessionsOn(t);
  const missed = sessionsBetween(addDays(t, -6), addDays(t, -1)).filter(s => sessionStatus(s, state.bySession, t).status === 'missed');
  const tomorrow = sessionsOn(addDays(t, 1));
  const left = daysTo(p.race_date);
  const firstName = (p.name || '').split(' ')[0];

  const kicker = !first ? '' : t < first.monday ? `Plan starts ${fmtDay(first.monday, { weekday: 'long', month: 'long', day: 'numeric' })}`
    : wk ? `${phaseLabel(wk)} · Week ${wk.index + 1} of ${state.weeks.length}${wk.recovery ? ' · Easier week' : ''}` : 'Season complete';

  let html = `
  <section class="card hero vivid">
    <div>
      <div class="kicker">${esc(kicker)}</div>
      <h1>${greeting()}${firstName ? `, ${esc(firstName)}` : ''}</h1>
      <p class="countdown">${left > 0 ? `<b>${left} days</b> to ${esc(p.race_name)}` : left === 0 ? `<b>Race day!</b> Go get it.` : `${esc(p.race_name)} is done. Well raced.`}</p>
      ${(() => { const r = keyRaces().find(x => x.date >= t); if (!r) return ''; const d = daysTo(r.date); return `<p class="countdown">🏁 ${d === 0 ? `<b>${esc(r.name)} today.</b> Enjoy it!` : `<b>${d} day${d === 1 ? '' : 's'}</b> to ${esc(r.name)}`}</p>`; })()}
      <p class="daily-line">${esc(dailyLine(t, wk?.phase))}</p>
      ${wk ? `<p class="blurb">${esc(PHASES[wk.phase].label)}: ${esc(PHASES[wk.phase].blurb)}</p>` : ''}
    </div>
    ${before ? `<div class="ring-wrap"><div class="ring-label" style="max-width:220px"><b>Week 1: ${fmtHours(sum.planned)}</b>${weekSessions.length} sessions. Tap one to see the workout.</div></div>`
      : `<div class="ring-wrap">${ring(sum.adherence)}
      <div class="ring-label"><b>Plan followed this week</b>${sum.dueCount ? `${sum.onCount} of ${sum.dueCount} sessions on plan` : 'Nothing due yet'} · ${fmtHours(sum.done)} of ${fmtHours(sum.planned)}</div></div>`}
  </section>

  <section class="section">
    <h2>${before ? 'Your first week' : 'This week'} <span class="muted">${fmtRange(mon, sun)}</span></h2>
    <div class="card">${strip(mon, weekSessions, state.bySession)}</div>
  </section>`;

  if (missed.length) {
    const shown = missed.slice(-5).reverse();                // most recent first
    html += `<section class="section"><h2>Did these happen? <span class="muted">log them or say why not</span></h2><div class="list">
      ${shown.map(s => `<div class="list-item">${sportIcon(s.sport)}
        <div><div class="li-title">${esc(s.title)}</div><div class="li-sub">${esc(relDay(s.date))} · ${esc(sessionMeta(s))}</div></div>
        <div class="row" style="justify-content:flex-end">
          <button class="btn small" data-action="done" data-id="${s.id}">Done</button>
          <button class="btn small" data-action="log" data-id="${s.id}">Log</button>
          <button class="btn small ghost" data-action="skip" data-id="${s.id}">Skipped</button></div></div>`).join('')}
    </div>${missed.length > shown.length ? `<p class="muted small" style="margin-top:8px">${missed.length - shown.length} more from the past week are on your <a href="#/plan">plan</a>.</p>` : ''}</section>`;
  }

  html += `<section class="section"><h2>Today <span class="muted">${fmtDay(t, { weekday: 'long', month: 'long', day: 'numeric' })}</span></h2>`;
  html += todays.length ? todays.map(sessionCard).join('') : `<div class="card session-card"><span class="sport-ico" style="background:var(--wash);color:var(--ink-2)">${icon('rest')}</span>
      <div><h3>${before ? 'Before you start' : 'Rest day'}</h3><p class="desc muted">${before ? 'Nothing planned yet. Add your training zones in Settings so workouts show your own watts and paces, and invite your friends from the Crew page.' : 'Recovery is training too. Sleep, eat well, and stretch if you feel like it.'}</p>
      <div class="actions"><button class="btn" data-action="log-extra">${before ? 'Log a workout' : 'Log a workout anyway'}</button></div></div></div>`;
  html += `</section>`;

  if (tomorrow.length) {
    html += `<section class="section"><h2>Tomorrow</h2><div class="list">${tomorrow.map(s => `
      <button class="list-item" style="width:100%;text-align:left;background:none;border-left:0;border-right:0;border-bottom:0;cursor:pointer" data-action="open-session" data-id="${s.id}">
        ${sportIcon(s.sport)}<div><div class="li-title">${esc(s.title)}</div><div class="li-sub">${esc(sessionMeta(s))}</div></div><span class="li-end">›</span></button>`).join('')}</div></section>`;
  }

  if (isCloud()) html += `<section class="section" id="support" hidden><h2>Support from your crew</h2><div class="list" data-support></div></section>`;
  return html;
}

export async function mount(root) {
  if (!isCloud()) return;
  try {
    const cheers = (await store.myCheers(8)).filter(c => Date.now() - Date.parse(c.created_at) < 14 * 864e5);
    if (!cheers.length) return;
    const people = await store.profilesById([...new Set(cheers.map(c => c.from_user))]);
    const what = c => {
      if (c.target_type === 'week') return 'your week';
      const a = state.activities.find(x => x.id === c.target_id);
      const s = a ? null : sessionById(c.target_id);
      return a ? esc(a.title || 'your workout') : s ? esc(s.title) : 'your training';
    };
    root.querySelector('[data-support]').innerHTML = cheers.map(c => `
      <div class="list-item">${avatar(people[c.from_user]?.name, 'sm')}
        <div><div class="li-title">${c.emoji ? `${c.emoji} ` : ''}${esc(people[c.from_user]?.name || 'A crewmate')} <span class="muted" style="font-weight:400">on ${what(c)}</span></div>
        ${c.message ? `<div class="li-sub">“${esc(c.message)}”</div>` : ''}</div><span class="li-end">${esc(timeAgo(c.created_at))}</span></div>`).join('');
    root.querySelector('#support').hidden = false;
  } catch (e) { console.warn('cheers', e); }
}

export const actions = {
  'open-session': el => openSession(el.dataset.id),
  done: async el => { await quickDone(sessionById(el.dataset.id)); toast('Nice work. Logged as planned.'); rerender(); },
  log: el => openLogForm({ session: sessionById(el.dataset.id) }),
  skip: el => openSkip(sessionById(el.dataset.id)),
  'log-extra': () => openLogForm({ date: today(), sport: 'run' }),
  import: () => go('#/log'),
};
