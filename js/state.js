// App state held in memory; every change goes through here so the store stays in sync.

import { store, localStore, cloudConfigured } from './store.js';
import { buildWeeks, generatePlan, defaultPlanSettings, RACE_PRESET, weekFor, resolveLayout } from './plan.js';
import { indexActivities } from './compliance.js';
import { today, byTime } from './util.js';

export const state = {
  profile: null,
  sessions: [],
  activities: [],
  bySession: new Map(),
  weeks: [],
  crews: null,          // cached list of my crews (cloud only)
};

export const isCloud = () => store.mode === 'cloud';
export const hasPlan = () => !!(state.profile?.settings?.plan && state.profile.race_date);

export async function load() {
  const mine = await store.loadMine();
  state.profile = mine.profile;
  state.sessions = mine.sessions;
  state.activities = mine.activities;
  derive();
}

export function derive() {
  state.sessions.sort((a, b) => a.date.localeCompare(b.date) || byTime(a, b));
  state.activities.sort((a, b) => (b.start_time || b.date).localeCompare(a.start_time || a.date));
  state.bySession = indexActivities(state.activities);
  state.weeks = hasPlan() ? buildWeeks(state.profile.settings.plan, state.profile.race_date) : [];
}

export function draftProfile() {
  const p = state.profile || {};
  return {
    id: p.id || 'local',
    name: p.name || '',
    race_name: p.race_name || RACE_PRESET.name,
    race_date: p.race_date || RACE_PRESET.date,
    share_details: !!p.share_details,
    settings: {
      plan: planWithLayout(p.settings?.plan),
      thresholds: { ...(p.settings?.thresholds || {}) },
    },
  };
}

// Plans saved before day-by-day layouts keep the same days they were built with.
function planWithLayout(saved) {
  if (!saved) return defaultPlanSettings();
  return { ...defaultPlanSettings(), ...saved, layout: saved.layout || resolveLayout(saved), bricks: saved.bricks ?? true };
}

// ---- lookups --------------------------------------------------------------
export const sessionById = id => state.sessions.find(s => s.id === id) || null;
export const activityById = id => state.activities.find(a => a.id === id) || null;
export const sessionsOn = date => state.sessions.filter(s => s.date === date);
export const sessionsBetween = (a, b) => state.sessions.filter(s => s.date >= a && s.date <= b);
export const activitiesFor = sessionId => state.bySession.get(sessionId) || [];
export const currentWeek = (date = today()) => weekFor(state.weeks, date);

// ---- profile & plan ------------------------------------------------------------
export async function saveProfile(p) {
  state.profile = { ...state.profile, ...p };
  await store.saveProfile(state.profile);
  derive();
}

export async function createPlan(profile) {
  await saveProfile(profile);
  const old = state.sessions.filter(s => !state.bySession.has(s.id));
  if (old.length) await store.removeSessions(old.map(s => s.id));
  const fresh = generatePlan(state.profile);
  await store.putSessions(fresh);
  state.sessions = state.sessions.filter(s => state.bySession.has(s.id)).concat(fresh);
  derive();
  return fresh.length;
}

// Replace planned sessions from `fromDate` on. Sessions you've already logged stay.
export async function regenerateFrom(fromDate) {
  const keep = s => s.date < fromDate || state.bySession.has(s.id);
  const drop = state.sessions.filter(s => !keep(s));
  const kept = state.sessions.filter(keep);
  const doneKeys = new Set(kept.filter(s => s.date >= fromDate).map(s => `${s.date}|${s.sport}`));
  const fresh = generatePlan(state.profile, fromDate).filter(n => !doneKeys.has(`${n.date}|${n.sport}`));
  if (drop.length) await store.removeSessions(drop.map(s => s.id));
  await store.putSessions(fresh);
  state.sessions = kept.concat(fresh);
  derive();
  return { removed: drop.length, added: fresh.length };
}

export async function saveSession(s) {
  await store.putSessions([s]);
  const i = state.sessions.findIndex(x => x.id === s.id);
  if (i >= 0) state.sessions[i] = { ...state.sessions[i], ...s }; else state.sessions.push(s);
  derive();
}

export async function deleteSession(id) {
  await store.removeSessions([id]);
  state.sessions = state.sessions.filter(s => s.id !== id);
  state.activities.forEach(a => { if (a.session_id === id) a.session_id = null; });
  derive();
}

// ---- activities ----------------------------------------------------------------
export async function saveActivity(a) {
  await store.putActivity(a);
  const { series, ...rest } = a;
  const i = state.activities.findIndex(x => x.id === a.id);
  if (i >= 0) state.activities[i] = { ...state.activities[i], ...rest }; else state.activities.push(rest);
  derive();
}

export async function deleteActivity(id) {
  await store.removeActivity(id);
  state.activities = state.activities.filter(a => a.id !== id);
  derive();
}

export function isDuplicate(a) {
  return state.activities.some(x =>
    (a.file_hash && x.file_hash === a.file_hash) ||
    (a.start_time && x.start_time && x.sport === a.sport && Math.abs(Date.parse(x.start_time) - Date.parse(a.start_time)) < 90e3));
}

// ---- backup & moving data between device and account ------------------------------
export async function exportData() {
  const activities = [];
  for (const a of state.activities) activities.push({ ...a, series: await store.getSeries(a.id) });
  return { app: 'IMPlanner', version: 1, exported_at: new Date().toISOString(), profile: state.profile, sessions: state.sessions, activities };
}

export async function importData(data, target = store) {
  if (!data || !Array.isArray(data.sessions) || !data.profile) throw new Error('This file is not an IMPlanner backup.');
  const prof = { ...data.profile, id: target.user?.id || 'local' };
  await target.saveProfile(prof);
  await target.putSessions(data.sessions);
  for (const a of data.activities || []) await target.putActivity(a);
  if (target === store) await load();
}

// Plan kept in this browser from before cloud sign-in, if any.
export async function localSnapshot() {
  if (!cloudConfigured) return null;
  try {
    const snap = await localStore.loadMine();
    return snap.profile?.settings?.plan ? snap : null;
  } catch { return null; }
}

export async function moveLocalToCloud() {
  const snap = await localStore.loadMine();
  const activities = [];
  for (const a of snap.activities) activities.push({ ...a, series: await localStore.getSeries(a.id) });
  await importData({ profile: { ...snap.profile, name: state.profile?.name || snap.profile.name }, sessions: snap.sessions, activities });
  await localStore.clearAll();
}
