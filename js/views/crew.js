import { esc, today, addDays, mondayOf, fmtDay, fmtMin, fmtHMS, fmtDist, fmtPace, relDay, SPORTS, CHEERS, sportIcon, timeAgo } from '../util.js';
import { state, isCloud, hasPlan } from '../state.js';
import { store } from '../store.js';
import { summarize, indexActivities, sessionStatus, pctText, STATUS } from '../compliance.js';
import { strip, avatar, statusBadge, feelChip, toast, daysTo, confirmDialog, openModal, closeModal } from '../ui.js';
import { rerender, go } from '../nav.js';

export const title = 'Crew';
const CREW_KEY = 'implanner:crew';
let data = null;          // last loaded crew data

const nameOf = p => p?.name || 'Someone';

const crewHero = msg => `<section class="card crew-hero">
  <img src="img/crew.jpg" alt="Three triathletes in race kit, wearing finisher medals and smiling after a race">
  <div class="ch-copy"><h1>Crew</h1><p>${esc(msg)}</p></div>
</section>`;

export function render(params, ctx) {
  if (!isCloud()) return `
    ${crewHero("Train together: see each other's plans and cheer each other on.")}
    <div class="empty"><h3>Sharing needs an account</h3><p>This copy of IMPlanner keeps everything on this device. Connect it to Supabase (see the README) to invite friends.</p></div>`;
  return `${crewHero('How everyone is doing against their own plan. No leaderboards: just showing up for each other.')}<div data-crew><div class="loading">Loading your crew…</div></div>`;
}

function invitePanel(crew) {
  const link = `${location.origin}${location.pathname}#/join/${crew.invite_code}`;
  return `<section class="card"><div class="spread"><h2>${esc(crew.name)}</h2>
      <div class="row">${crew.created_by === store.user.id ? `<button class="btn small ghost" data-action="rename">Rename</button>` : ''}<button class="btn small ghost" data-action="leave">Leave</button></div></div>
    <p class="muted small" style="margin:6px 0 10px">Invite friends with this link. They create a free account and join straight away.</p>
    <div class="invite"><code>${esc(link)}</code><button class="btn" data-action="copy" data-link="${esc(link)}">Copy link</button>
      ${navigator.share ? `<button class="btn" data-action="share" data-link="${esc(link)}">Share…</button>` : ''}</div></section>`;
}

function cheerBar(targetType, targetId, toUser) {
  const mine = store.user.id;
  const list = data.cheers.filter(c => c.target_id === targetId);
  const counts = {};
  list.forEach(c => { if (c.emoji) counts[c.emoji] = (counts[c.emoji] || 0) + 1; });
  const msgs = list.filter(c => c.message);
  const canCheer = toUser !== mine;
  const btns = CHEERS.map(e => {
    const minec = list.find(c => c.from_user === mine && c.emoji === e && !c.message);
    const n = counts[e] || 0;
    if (!canCheer && !n) return '';
    return `<button class="cheer-btn" ${canCheer ? `data-action="cheer" data-type="${targetType}" data-target="${esc(targetId)}" data-to="${toUser}" data-emoji="${e}"` : 'disabled'} aria-pressed="${!!minec}" aria-label="${e} ${n || ''}">${e}${n ? ` <span class="small">${n}</span>` : ''}</button>`;
  }).join('');
  return `<div class="cheers">${btns}</div>
    ${msgs.map(c => `<div class="cheer-msg"><b>${esc(nameOf(data.people[c.from_user]))}</b>: ${esc(c.message)}</div>`).join('')}
    ${canCheer ? `<form class="cheer-form" data-cheer-form data-type="${targetType}" data-target="${esc(targetId)}" data-to="${toUser}">
      <input type="text" name="message" maxlength="280" placeholder="Say something encouraging" aria-label="Message"><button class="btn small">Send</button></form>` : ''}`;
}

function memberCard(m, mon, t) {
  const uid = m.user_id, p = m.profile;
  const sessions = data.sessions.filter(s => s.user_id === uid && s.date >= mon && s.date <= addDays(mon, 6));
  const acts = data.activities.filter(a => a.user_id === uid);
  const idx = indexActivities(acts);
  const sum = summarize(sessions, idx, t);
  const last = acts.filter(a => a.feel).sort((x, y) => (y.start_time || y.date).localeCompare(x.start_time || x.date))[0];
  const left = p.race_date ? daysTo(p.race_date) : null;
  const me = uid === store.user.id;
  return `<article class="card member">
    <div class="member-top">${avatar(p.name)}
      <div class="who"><b>${esc(nameOf(p))}${me ? ' (you)' : ''}</b><span>${p.race_name ? `${esc(p.race_name)}${left > 0 ? ` · ${left} days` : ''}` : 'No race set'}</span></div>
      <div class="pct">${pctText(sum.adherence)}<small>on plan</small></div></div>
    ${sessions.length ? strip(mon, sessions, idx, { action: 'peek', ref: t }) : `<p class="muted small">No plan for this week.</p>`}
    <div class="muted small">${sum.dueCount ? `${sum.onCount} of ${sum.dueCount} sessions on plan so far` : 'Nothing due yet this week'}${last ? ` · Lately: ${feelChip(last.feel)}` : ''}</div>
    ${cheerBar('week', `${uid}:${mon}`, uid)}
  </article>`;
}

function feedItems(t) {
  const since = addDays(t, -13);
  const sById = new Map(data.sessions.map(s => [s.id, s]));
  const idxAll = indexActivities(data.activities);
  const items = [];
  for (const a of data.activities) if (a.date >= since) items.push({ kind: 'act', when: a.start_time || a.created_at || a.date, date: a.date, a, s: a.session_id ? sById.get(a.session_id) : null });
  for (const s of data.sessions) if (s.skip_reason && s.date >= since && s.date <= t) items.push({ kind: 'skip', when: `${s.date}T23:59`, date: s.date, s });
  items.sort((x, y) => String(y.when).localeCompare(String(x.when)));
  return items.slice(0, 40).map(it => {
    if (it.kind === 'skip') {
      const p = data.people[it.s.user_id];
      return `<div class="feed-item">${avatar(p?.name, 'sm')}<div>
        <div class="fi-line"><b>${esc(nameOf(p))}</b> skipped <b>${esc(it.s.title)}</b></div>
        <div class="fi-meta">${esc(relDay(it.s.date))} · ${statusBadge('skipped', it.s.skip_reason)}</div>
        ${cheerBar('session', it.s.id, it.s.user_id)}</div></div>`;
    }
    const { a, s } = it, p = data.people[a.user_id];
    const st = s ? sessionStatus(s, idxAll, t) : null;
    const details = a.details_hidden ? '' : [a.distance_m ? fmtDist(a.distance_m, a.sport) : '', a.distance_m && a.sport !== 'strength' ? fmtPace(a.sport, a.distance_m, a.duration_s) : '', a.avg_hr ? `${a.avg_hr} bpm` : '', a.avg_power ? `${a.avg_power} W` : ''].filter(Boolean).join(' · ');
    return `<div class="feed-item">${avatar(p?.name, 'sm')}<div>
      <div class="fi-line"><b>${esc(nameOf(p))}</b> ${s ? 'did' : 'did an extra'} <b>${esc(a.title || SPORTS[a.sport].label)}</b></div>
      <div class="fi-meta">${sportIcon(a.sport)} ${esc(relDay(a.date))} · ${fmtHMS(a.duration_s)}${s ? ` of ${esc(fmtMin(s.duration_min))} planned` : ''} ${st ? statusBadge(st.status) : ''} ${feelChip(a.feel)}</div>
      ${details ? `<div class="fi-meta">${esc(details)}</div>` : ''}
      ${a.notes ? `<div class="fi-note">${esc(a.notes)}</div>` : ''}
      ${cheerBar('activity', a.id, a.user_id)}</div></div>`;
  }).join('');
}

async function load(joinCode) {
  const crews = await store.myCrews();
  state.crews = crews;
  let invite = null;
  if (joinCode) invite = await store.crewByCode(joinCode).catch(() => null);
  let crew = null;
  if (crews.length) {
    const saved = localStorage.getItem(CREW_KEY);
    crew = crews.find(c => c.id === saved) || crews[0];
  }
  let members = [], act = { sessions: [], activities: [], cheers: [] }, people = {};
  if (crew) {
    members = await store.crewMembers(crew.id);
    const t = today(), mon = mondayOf(t);
    const from = addDays(t, -13) < mon ? addDays(t, -13) : mon;
    act = await store.crewActivity(members.map(m => m.user_id), from, addDays(mon, 6));
    members.forEach(m => { people[m.user_id] = m.profile; });
    const unknown = [...new Set(act.cheers.map(c => c.from_user))].filter(id => !people[id]);
    if (unknown.length) Object.assign(people, await store.profilesById(unknown));
  }
  data = { crews, crew, members, invite, joinCode, people, ...act };
}

function paint(root) {
  const t = today(), mon = mondayOf(t);
  const el = root.querySelector('[data-crew]');
  let html = '';
  if (data.joinCode) {
    const already = data.invite && data.crews.some(c => c.id === data.invite.id);
    html += data.invite
      ? `<section class="card" style="margin-bottom:18px"><h2>${already ? `You're in ${esc(data.invite.name)}` : `Join ${esc(data.invite.name)}?`}</h2>
          <p class="muted" style="margin:6px 0 12px">${data.invite.members} member${data.invite.members === 1 ? '' : 's'}. Crewmates see your plan, the sessions you complete, how they felt and your notes. Distances, paces, heart rate and power stay private unless you choose to share them in Settings.</p>
          ${already ? '' : `<div class="row"><button class="btn primary" data-action="join" data-code="${esc(data.joinCode)}">Join crew</button><button class="btn ghost" data-action="nojoin">Not now</button></div>`}</section>`
      : `<section class="note" style="margin-bottom:18px">That invite link didn't work. Ask your friend for a fresh one.</section>`;
  }
  if (!data.crew) {
    html += `<div class="grid grid-2">
      <form class="card stack" data-create><h2>Start a crew</h2><p class="muted small">You'll get an invite link to share with friends.</p>
        <label class="field"><span>Crew name</span><input type="text" name="name" maxlength="60" placeholder="e.g. Ottawa 2027" required></label>
        <button class="btn primary">Create crew</button></form>
      <form class="card stack" data-joinform><h2>Join a crew</h2><p class="muted small">Paste the invite link or code a friend sent you.</p>
        <label class="field"><span>Invite link or code</span><input type="text" name="code" required></label>
        <button class="btn">Join</button></form></div>`;
    el.innerHTML = html; return;
  }
  if (data.crews.length > 1) html += `<div class="seg" style="margin-bottom:14px">${data.crews.map(c => `<button data-action="pick" data-id="${c.id}" aria-pressed="${c.id === data.crew.id}">${esc(c.name)}</button>`).join('')}</div>`;
  html += invitePanel(data.crew);
  const ordered = [...data.members].sort((a, b) => (a.user_id === store.user.id ? -1 : b.user_id === store.user.id ? 1 : nameOf(a.profile).localeCompare(nameOf(b.profile))));
  html += `<section class="section"><h2>This week</h2><div class="grid grid-2">${ordered.map(m => memberCard(m, mon, t)).join('')}</div></section>`;
  const feed = feedItems(t);
  html += `<section class="section"><h2>Recent sessions <span class="muted">last 2 weeks</span></h2>${feed ? `<div class="list">${feed}</div>` : `<div class="empty">Nothing logged yet. Be the first.</div>`}</section>`;
  html += `<section class="section"><details><summary class="muted small" style="cursor:pointer">Start or join another crew</summary>
    <div class="grid grid-2" style="margin-top:10px">
      <form class="card stack" data-create><label class="field"><span>New crew name</span><input type="text" name="name" maxlength="60" required></label><button class="btn">Create crew</button></form>
      <form class="card stack" data-joinform><label class="field"><span>Invite link or code</span><input type="text" name="code" required></label><button class="btn">Join</button></form></div></details></section>`;
  el.innerHTML = html;
}

export async function mount(root, params, ctx) {
  if (!isCloud()) return;
  const joinCode = ctx.name === 'join' ? params[0] : null;
  try { await load(joinCode); paint(root); }
  catch (e) { root.querySelector('[data-crew]').innerHTML = `<div class="note">Couldn't load your crew: ${esc(e.message)}</div>`; return; }
  root.addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    try {
      if (f.matches('[data-create]')) {
        const c = await store.createCrew(f.name.value.trim());
        localStorage.setItem(CREW_KEY, c.id); toast('Crew created. Now invite your friends!'); go('#/crew');
      } else if (f.matches('[data-joinform]')) {
        const code = f.code.value.trim().split('/join/').pop().split(/[?#/]/)[0];
        go(`#/join/${encodeURIComponent(code)}`);
      } else if (f.matches('[data-cheer-form]')) {
        const msg = f.message.value.trim();
        if (!msg) return;
        await store.addCheer({ to_user: f.dataset.to, target_type: f.dataset.type, target_id: f.dataset.target, emoji: '', message: msg });
        toast('Sent'); rerender();
      }
    } catch (err) { toast(err.message); }
  });
}

export const actions = {
  copy: async el => { try { await navigator.clipboard.writeText(el.dataset.link); toast('Invite link copied'); } catch { toast('Copy the link above'); } },
  share: async el => { try { await navigator.share({ title: 'Join my IMPlanner crew', text: 'Train with me on IMPlanner', url: el.dataset.link }); } catch { /* cancelled */ } },
  pick: el => { localStorage.setItem(CREW_KEY, el.dataset.id); rerender(); },
  join: async el => {
    try {
      const c = await store.joinCrew(el.dataset.code);
      localStorage.setItem(CREW_KEY, c.id); sessionStorage.removeItem('implanner:join');
      toast(`Welcome to ${c.name}!`); go(hasPlan() ? '#/crew' : '#/setup');
    } catch (e) { toast(e.message); }
  },
  nojoin: () => { sessionStorage.removeItem('implanner:join'); go('#/crew'); },
  cheer: async el => {
    const mine = data.cheers.find(c => c.from_user === store.user.id && c.target_id === el.dataset.target && c.emoji === el.dataset.emoji && !c.message);
    try {
      if (mine) await store.removeCheer(mine.id);
      else await store.addCheer({ to_user: el.dataset.to, target_type: el.dataset.type, target_id: el.dataset.target, emoji: el.dataset.emoji, message: '' });
      rerender();
    } catch (e) { toast(e.message); }
  },
  peek: el => {
    const s = data.sessions.find(x => x.id === el.dataset.id);
    if (!s) return;
    const idx = indexActivities(data.activities);
    const st = sessionStatus(s, idx);
    openModal({ title: s.title, body: `<div class="session-card">${sportIcon(s.sport)}<div>
      <div class="meta">${esc(nameOf(data.people[s.user_id]))} · ${esc(fmtDay(s.date, { weekday: 'long', month: 'short', day: 'numeric' }))}</div>
      <div class="row" style="margin-top:6px">${statusBadge(st.status, s.skip_reason ? `Skipped: ${s.skip_reason}` : STATUS[st.status].label)}<span class="muted small">${esc(fmtMin(s.duration_min))}${st.acts.length ? ` · did ${esc(fmtMin(st.doneMin))}` : ''}</span></div>
      <p class="desc">${esc(s.description)}</p></div></div>`, foot: `<button class="btn" data-action="close">Close</button>` });
  },
  rename: async () => {
    openModal({ title: 'Rename crew', body: `<form data-submit="save" id="renf"><label class="field"><span>Name</span><input type="text" name="name" maxlength="60" value="${esc(data.crew.name)}" required></label></form>`,
      foot: `<button class="btn ghost" data-action="close">Cancel</button><button class="btn primary" form="renf">Save</button>`,
      actions: { save: async f => { await store.renameCrew(data.crew.id, f.name.value.trim()); closeModal(); rerender(); } } });
  },
  leave: async () => {
    const ok = await confirmDialog({ title: `Leave ${data.crew.name}?`, message: 'Your crewmates will stop seeing your training. You can rejoin with an invite link.', confirm: 'Leave crew', danger: true });
    if (!ok) return;
    await store.leaveCrew(data.crew.id); localStorage.removeItem(CREW_KEY); toast('You left the crew'); go('#/crew');
  },
};
