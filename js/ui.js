// Shared UI: modal, toast, confirm, tooltips and small components.

import { esc, icon, sportIcon, fmtMin, fmtShort, fmtDist, SPORTS, FEELS, DAY_SHORT, addDays, today, toDate } from './util.js';
import { STATUS, sessionStatus } from './compliance.js';

// ---- toast ------------------------------------------------------------------
let toastTimer;
export function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---- modal --------------------------------------------------------------------
let modalActions = {}, modalClose = null;
export function openModal({ title, body, foot = '', actions = {}, onMount, onClose }) {
  const dlg = document.getElementById('modal');
  dlg.innerHTML = `
    <div class="modal-head"><h2 id="modal-title">${esc(title)}</h2>
      <button class="btn ghost small" data-action="close" aria-label="Close">✕</button></div>
    <div class="modal-body">${body}</div>
    ${foot ? `<div class="modal-foot">${foot}</div>` : ''}`;
  modalActions = { close: () => closeModal(), ...actions };
  modalClose = onClose || null;
  if (!dlg.open) dlg.showModal();
  onMount?.(dlg);
  const first = dlg.querySelector('.modal-body input:not([type=hidden]), .modal-body select, .modal-body textarea');
  if (first && matchMedia('(hover: hover)').matches) first.focus();
  return dlg;
}
export function closeModal() {
  const dlg = document.getElementById('modal');
  if (dlg.open) dlg.close();
}
export function initModal() {
  const dlg = document.getElementById('modal');
  dlg.addEventListener('click', e => {
    if (e.target === dlg) { closeModal(); return; }                 // backdrop click
    const el = e.target.closest('[data-action]');
    if (el && modalActions[el.dataset.action]) { e.preventDefault(); modalActions[el.dataset.action](el, e, dlg); }
  });
  dlg.addEventListener('submit', e => {
    e.preventDefault();
    const name = e.target.dataset.submit;
    if (name && modalActions[name]) modalActions[name](e.target, e, dlg);
  });
  dlg.addEventListener('close', () => { const f = modalClose; modalClose = null; f?.(); });
}

export function confirmDialog({ title, message, confirm = 'Confirm', danger = false }) {
  return new Promise(resolve => {
    let answered = false;
    openModal({
      title, body: `<p>${message}</p>`,
      foot: `<button class="btn ghost" data-action="no">Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-action="yes">${esc(confirm)}</button>`,
      actions: {
        yes: () => { answered = true; closeModal(); resolve(true); },
        no: () => { answered = true; closeModal(); resolve(false); },
      },
      onClose: () => { if (!answered) resolve(false); },
    });
  });
}

// ---- tooltips (charts and anything with data-tip) ------------------------------
export function initTooltips() {
  const tip = document.getElementById('tip');
  const show = (el, x, y) => {
    tip.innerHTML = el.dataset.tip;
    tip.style.display = 'block';
    const r = tip.getBoundingClientRect();
    let left = x + 14, top = y + 14;
    if (left + r.width > innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > innerHeight - 8) top = y - r.height - 14;
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.top = `${Math.max(8, top)}px`;
  };
  document.addEventListener('pointermove', e => {
    const el = e.target.closest?.('[data-tip]');
    if (el) show(el, e.clientX, e.clientY); else tip.style.display = 'none';
  });
  document.addEventListener('focusin', e => {
    const el = e.target.closest?.('[data-tip]');
    if (el) { const r = el.getBoundingClientRect(); show(el, r.left + r.width / 2, r.bottom); }
  });
  document.addEventListener('focusout', () => { tip.style.display = 'none'; });
  addEventListener('scroll', () => { tip.style.display = 'none'; }, { passive: true });
}

// ---- components -------------------------------------------------------------------
export function statusBadge(status, text) {
  const s = STATUS[status] || STATUS.upcoming;
  return `<span class="badge st-${status}"><span class="mk" aria-hidden="true">${s.mark}</span>${esc(text || s.label)}</span>`;
}

export function sessionMeta(s) {
  const parts = [fmtMin(s.duration_min)];
  if (s.distance_m) parts.push(fmtDist(s.distance_m, s.sport));
  return parts.join(' · ');
}

export function doneText(st) {
  if (!st.acts?.length) return '';
  return `Done ${fmtMin(st.doneMin)}${st.ratio != null ? ` · ${Math.round(st.ratio * 100)}% of plan` : ''}`;
}

export function chip(s, bySession, opts = {}) {
  const st = sessionStatus(s, bySession);
  const label = `${SPORTS[s.sport]?.label}: ${s.title}, ${sessionMeta(s)}. ${STATUS[st.status].label}`;
  return `<button class="chip st-${st.status}" data-action="${opts.action || 'open-session'}" data-id="${s.id}" ${opts.draggable ? 'draggable="true"' : ''} title="${esc(label)}" aria-label="${esc(label)}">
    ${sportIcon(s.sport)}<span class="chip-txt">${esc(fmtShort(s.duration_min))}</span><span class="chip-mk" aria-hidden="true">${STATUS[st.status].mark}</span></button>`;
}

// Seven-day strip of small sport tiles, colored by status.
export function strip(monday, sessions, bySession, { action = 'open-session', ref = today() } = {}) {
  let html = '<div class="strip">';
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    const list = sessions.filter(s => s.date === d);
    html += `<div class="sday ${d === ref ? 'today' : ''}"><b>${DAY_SHORT[i][0]}</b><div class="dots">`;
    html += list.length ? list.map(s => {
      const st = sessionStatus(s, bySession, ref);
      return `<button class="dot s-${s.sport} st-${st.status}" style="color:var(--sc)" data-action="${action}" data-id="${s.id}"
        data-tip="<b>${esc(s.title)}</b><br>${esc(sessionMeta(s))}<br>${esc(STATUS[st.status].label)}" aria-label="${esc(`${s.title}, ${STATUS[st.status].label}`)}">${icon(s.sport)}<span class="dot-t">${esc(fmtShort(s.duration_min))}</span></button>`;
    }).join('') : `<span class="dot rest" aria-label="Rest day">${icon('rest')}</span>`;
    html += '</div></div>';
  }
  return html + '</div>';
}

export function ring(value, size = 84) {
  const r = size / 2 - 7, c = 2 * Math.PI * r;
  const v = value == null ? 0 : Math.max(0, Math.min(1, value));
  const color = value == null ? 'var(--axis)' : v >= 0.85 ? 'var(--good)' : v >= 0.5 ? 'var(--warn)' : 'var(--serious)';
  const text = value == null ? '—' : `${Math.round(v * 100)}%`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Plan followed: ${text}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--wash)" stroke-width="8"/>
    ${v > 0 ? `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round"
      stroke-dasharray="${(c * v).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>` : ''}
    <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" font-size="${size / 4.6}" font-weight="650" fill="var(--ink)" font-family="system-ui, sans-serif">${text}</text></svg>`;
}

export const initials = name => (name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('') || '?';
// Each person keeps the same tint everywhere (picked from their name).
const tint = name => { let h = 0; for (const c of name || '') h = (h * 31 + c.charCodeAt(0)) >>> 0; return `av-${h % 6}`; };
export const avatar = (name, cls = '') => `<span class="avatar ${tint(name)} ${cls}" aria-hidden="true">${esc(initials(name))}</span>`;
export const feelChip = feel => feel && FEELS[feel] ? `<span class="tag" title="Felt ${FEELS[feel].label.toLowerCase()}">${FEELS[feel].emoji} ${FEELS[feel].label}</span>` : '';

export function feelPicker(name, value) {
  return `<div class="feel-pick" role="group" aria-label="How did it feel?">${Object.entries(FEELS).map(([k, f]) =>
    `<button type="button" data-action="pick-feel" data-name="${name}" data-value="${k}" aria-pressed="${value === k}"><span>${f.emoji}</span>${f.label}</button>`).join('')}
    <input type="hidden" name="${name}" value="${esc(value || '')}"></div>`;
}
// Wire the feel picker inside a container (modal or page).
export function pickFeel(el) {
  const wrap = el.closest('.feel-pick');
  const input = wrap.querySelector('input[type=hidden]');
  const same = input.value === el.dataset.value;
  input.value = same ? '' : el.dataset.value;
  wrap.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(!same && b === el)));
}

export function phaseLabel(week) {
  if (!week) return '';
  const names = { prep: 'Prep', base: 'Base', build: 'Build', peak: 'Peak', taper: 'Taper', race: 'Race week' };
  return week.phase === 'race' ? 'Race week' : `${names[week.phase]} ${week.phaseWeek}/${week.phaseLength}`;
}

export function daysTo(date) { return Math.round((toDate(date) - toDate(today())) / 864e5); }
