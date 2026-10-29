// Data layer. Two backends with one interface:
//   local: IndexedDB on this device (no account, no sharing)
//   cloud: Supabase (account, crews, sharing), used when config.js has keys.

import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm';

const SESSION_COLS = ['id', 'date', 'sport', 'kind', 'title', 'description', 'duration_min', 'distance_m', 'phase', 'week', 'sort', 'skip_reason'];
const ACT_COLS = ['id', 'session_id', 'date', 'start_time', 'sport', 'title', 'duration_s', 'source', 'rpe', 'feel', 'notes', 'file_hash', 'external_id'];
const DETAIL_COLS = ['distance_m', 'elapsed_s', 'avg_hr', 'max_hr', 'avg_power', 'np', 'avg_cadence', 'ascent_m', 'calories', 'pool_length_m', 'zones'];
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, o[k]]));
const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

// ---- IndexedDB key-value -------------------------------------------------

let dbp;
function idb() {
  dbp ||= new Promise((resolve, reject) => {
    const req = indexedDB.open('implanner', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
async function kv(mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', mode);
    const req = fn(tx.objectStore('kv'));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}
const kvGet = key => kv('readonly', s => s.get(key));
const kvSet = (key, val) => kv('readwrite', s => s.put(val, key));
const kvDel = key => kv('readwrite', s => s.delete(key));

// ---- local backend -------------------------------------------------------

const local = {
  mode: 'local',
  user: null,
  async init() {},
  async loadMine() {
    return {
      profile: (await kvGet('profile')) || null,
      sessions: (await kvGet('sessions')) || [],
      activities: (await kvGet('activities')) || [],
    };
  },
  async saveProfile(p) { await kvSet('profile', p); },
  async putSessions(list) {
    const all = (await kvGet('sessions')) || [];
    const byId = new Map(all.map(s => [s.id, s]));
    list.forEach(s => byId.set(s.id, { ...byId.get(s.id), ...s }));
    await kvSet('sessions', [...byId.values()]);
  },
  async removeSessions(ids) {
    const drop = new Set(ids);
    await kvSet('sessions', ((await kvGet('sessions')) || []).filter(s => !drop.has(s.id)));
    const acts = (await kvGet('activities')) || [];
    if (acts.some(a => drop.has(a.session_id))) await kvSet('activities', acts.map(a => drop.has(a.session_id) ? { ...a, session_id: null } : a));
  },
  async putActivity(a) {
    const { series, ...rest } = a;
    const all = (await kvGet('activities')) || [];
    const i = all.findIndex(x => x.id === a.id);
    if (i >= 0) all[i] = { ...all[i], ...rest }; else all.push(rest);
    await kvSet('activities', all);
    if (series !== undefined) await kvSet(`series:${a.id}`, series);
  },
  async removeActivity(id) {
    await kvSet('activities', ((await kvGet('activities')) || []).filter(a => a.id !== id));
    await kvDel(`series:${id}`);
  },
  async getSeries(id) { return (await kvGet(`series:${id}`)) || null; },
  async clearAll() { for (const k of ['profile', 'sessions', 'activities']) await kvDel(k); },
};

// ---- cloud backend -------------------------------------------------------

let sb = null;
const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

async function fetchAll(build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const rows = must(await build().range(from, from + 999));
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

const cloud = {
  mode: 'cloud',
  user: null,
  async init() {
    const { createClient } = await import(SUPABASE_CDN);
    sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    const { data } = await sb.auth.getSession();
    this.user = data.session?.user || null;
  },
  onAuth(cb) { sb.auth.onAuthStateChange((event, session) => { this.user = session?.user || null; cb(event, this.user); }); },
  async signIn(email, password) { must(await sb.auth.signInWithPassword({ email, password })); },
  async signUp(email, password, name) {
    const data = must(await sb.auth.signUp({ email, password, options: { data: { name } } }));
    if (!data.session) throw new Error('Account created, but email confirmation is switched on in Supabase. Turn off "Confirm email" (see README), then sign in.');
  },
  async signOut() { await sb.auth.signOut(); this.user = null; },
  async sendReset(email) { must(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname })); },
  async updatePassword(password) { must(await sb.auth.updateUser({ password })); },

  async loadMine() {
    const id = this.user.id;
    const [prof, set, sessions, acts, details] = await Promise.all([
      sb.from('profiles').select('*').eq('id', id).maybeSingle().then(must),
      sb.from('profile_settings').select('settings').eq('user_id', id).maybeSingle().then(must),
      fetchAll(() => sb.from('sessions').select(SESSION_COLS.join(',')).eq('user_id', id).order('date')),
      fetchAll(() => sb.from('activities').select(ACT_COLS.join(',')).eq('user_id', id).order('date')),
      fetchAll(() => sb.from('activity_details').select(['activity_id', ...DETAIL_COLS].join(',')).eq('user_id', id)),
    ]);
    const det = new Map(details.map(d => [d.activity_id, d]));
    const activities = acts.map(a => { const d = det.get(a.id) || {}; delete d.activity_id; return { ...a, ...d }; });
    return { profile: prof ? { ...prof, settings: set?.settings || null } : null, sessions, activities };
  },
  async saveProfile(p) {
    const id = this.user.id;
    must(await sb.from('profiles').upsert({ id, name: p.name, race_name: p.race_name, race_date: p.race_date, share_details: !!p.share_details, updated_at: new Date().toISOString() }));
    must(await sb.from('profile_settings').upsert({ user_id: id, settings: p.settings }));
  },
  async putSessions(list) {
    const id = this.user.id;
    for (const part of chunks(list, 400)) must(await sb.from('sessions').upsert(part.map(s => ({ ...pick(s, SESSION_COLS), user_id: id }))));
  },
  async removeSessions(ids) {
    for (const part of chunks(ids, 80)) must(await sb.from('sessions').delete().in('id', part));
  },
  async putActivity(a) {
    const id = this.user.id;
    must(await sb.from('activities').upsert({ ...pick(a, ACT_COLS), user_id: id }));
    const det = { activity_id: a.id, user_id: id, ...pick(a, DETAIL_COLS) };
    if (a.series !== undefined) det.series = a.series;
    must(await sb.from('activity_details').upsert(det));
  },
  async removeActivity(id) { must(await sb.from('activities').delete().eq('id', id)); },
  async getSeries(id) {
    const row = must(await sb.from('activity_details').select('series').eq('activity_id', id).maybeSingle());
    return row?.series || null;
  },

  // -- crews
  async myCrews() {
    const mine = must(await sb.from('crew_members').select('crew_id').eq('user_id', this.user.id));
    if (!mine.length) return [];
    return must(await sb.from('crews').select('*').in('id', mine.map(m => m.crew_id)).order('created_at'));
  },
  async createCrew(name) { return must(await sb.rpc('create_crew', { crew_name: name })); },
  async crewByCode(code) { return must(await sb.rpc('crew_by_code', { code }))?.[0] || null; },
  async joinCrew(code) { return must(await sb.rpc('join_crew', { code })); },
  async leaveCrew(crewId) { must(await sb.from('crew_members').delete().eq('crew_id', crewId).eq('user_id', this.user.id)); },
  async renameCrew(crewId, name) { must(await sb.from('crews').update({ name }).eq('id', crewId)); },
  async crewMembers(crewId) {
    const mems = must(await sb.from('crew_members').select('user_id,joined_at').eq('crew_id', crewId).order('joined_at'));
    const ids = mems.map(m => m.user_id);
    const profs = ids.length ? must(await sb.from('profiles').select('id,name,race_name,race_date,share_details').in('id', ids)) : [];
    const byId = new Map(profs.map(p => [p.id, p]));
    return mems.map(m => ({ ...m, profile: byId.get(m.user_id) || { id: m.user_id, name: '' } }));
  },
  // Plan, completed sessions (with details where shared) and cheers for a set of people.
  async crewActivity(userIds, from, to) {
    if (!userIds.length) return { sessions: [], activities: [], cheers: [] };
    const [sessions, acts, cheers] = await Promise.all([
      fetchAll(() => sb.from('sessions').select(['user_id', ...SESSION_COLS].join(',')).in('user_id', userIds).gte('date', from).lte('date', to)),
      fetchAll(() => sb.from('activities').select(['user_id', 'created_at', ...ACT_COLS].join(',')).in('user_id', userIds).gte('date', from).lte('date', to)),
      fetchAll(() => sb.from('cheers').select('*').in('to_user', userIds).gte('created_at', new Date(Date.parse(from) - 7 * 864e5).toISOString()).order('created_at')),
    ]);
    const det = new Map();
    for (const part of chunks(acts.map(a => a.id), 80)) {
      const rows = must(await sb.from('activity_details').select(['activity_id', ...DETAIL_COLS].join(',')).in('activity_id', part));
      rows.forEach(r => det.set(r.activity_id, r));
    }
    const activities = acts.map(a => {
      const d = det.get(a.id);
      if (!d) return { ...a, details_hidden: true };
      const { activity_id, ...rest } = d; return { ...a, ...rest };
    });
    return { sessions, activities, cheers };
  },
  async myCheers(limit = 40) {
    return must(await sb.from('cheers').select('*').eq('to_user', this.user.id).order('created_at', { ascending: false }).limit(limit));
  },
  async cheersOn(targetIds) {
    const out = [];
    for (const part of chunks(targetIds, 80)) out.push(...must(await sb.from('cheers').select('*').in('target_id', part).order('created_at')));
    return out;
  },
  async addCheer(c) { return must(await sb.from('cheers').insert({ ...c, from_user: this.user.id }).select().single()); },
  async removeCheer(id) { must(await sb.from('cheers').delete().eq('id', id)); },
  // -- Garmin Connect (Personal API key kept in Supabase Vault; see supabase/garmin.sql)
  async garminStatus() { return must(await sb.rpc('garmin_status'))?.[0] || null; },
  async garminConnect(apiKey, expires) { must(await sb.rpc('garmin_connect', { api_key: apiKey, expires })); },
  async garminDisconnect() { must(await sb.rpc('garmin_disconnect')); },
  async garmin(body) {
    const { data, error } = await sb.functions.invoke('garmin', { body });
    if (error) {
      let msg = error.message;
      try { const j = await error.context?.json(); if (j?.error || j?.message || j?.msg) msg = j.error || j.message || j.msg; } catch { /* not JSON */ }
      throw new Error(msg);
    }
    return data;
  },
  async profilesById(ids) {
    if (!ids.length) return {};
    const rows = must(await sb.from('profiles').select('id,name').in('id', ids));
    return Object.fromEntries(rows.map(r => [r.id, r]));
  },
};

export const cloudConfigured = !!(SUPABASE_URL && SUPABASE_KEY);
export const store = cloudConfigured ? cloud : local;
export const localStore = local;
