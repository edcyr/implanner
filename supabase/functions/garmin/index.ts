// IMPlanner `garmin` Edge Function: fetches the signed-in person's own workouts from the
// Garmin Connect Personal API, using the key they saved (kept in Supabase Vault).
// Deploy with "Verify JWT" OFF: the function checks the caller's session itself, so the
// browser's CORS preflight (which carries no token) can get through.
//
// POST { action: 'test' }                                   → { ok: true }
// POST { action: 'sync', since, until, known: [ids], max }  → { activities: [{ id, name, type, startLocal, file }], more }
//   `file` is the original activity zip from Garmin, base64. Only swim, bike, run, multisport and
//   strength workouts are returned, oldest first. Start coordinates from Garmin's list are dropped here.

import { createClient } from 'npm:@supabase/supabase-js@2.117.3';

const GARMIN = 'https://personal.connectapi.garmin.com';
const ORIGINS = ['https://edcyr.github.io', 'http://localhost:8765', 'http://localhost:8766', 'http://127.0.0.1:8765', 'http://127.0.0.1:8766'];

const cors = (req: Request) => {
  const origin = req.headers.get('Origin') ?? '';
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
};
function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json' } });

// Server key: the new-style secret key if the project has one, else the legacy service-role key.
function serviceKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    const k = keys.default ?? Object.values(keys)[0];
    if (typeof k === 'string' && k) return k;
  } catch { /* fall through */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
}

// Which Garmin activity types IMPlanner imports.
function sportOf(typeKey = ''): string | null {
  const k = typeKey.toLowerCase();
  if (/multi_sport|triathlon|duathlon|aquathlon|brick/.test(k)) return 'multi';
  if (/swim/.test(k)) return 'swim';
  if (/cycl|bik|ride|spin/.test(k)) return 'bike';
  if (/run/.test(k)) return 'run';
  if (/strength/.test(k)) return 'strength';
  return null;
}

// Logs status codes and reply shapes only: never the key, the token or workout data.
const looksLikeHtml = (t: string) => /<html|<!doctype|cloudflare|attention required|just a moment/i.test(t);

async function garminToken(apiKey: string): Promise<string> {
  const r = await fetch(`${GARMIN}/personalapitoken-service/personal-api/personal-api-key/token`, {
    // Accept anything: the token service answers 406 Not Acceptable to `Accept: application/json`.
    method: 'POST', headers: { Authorization: `ApiKey ${apiKey}`, Accept: '*/*' },
  });
  const text = await r.text();
  const type = r.headers.get('content-type') ?? '';
  if (!r.ok) {
    const html = looksLikeHtml(text);
    // Garmin's JSON error bodies are short status messages (no secrets), so log them to help diagnose.
    console.error('garmin token failed', r.status, type || '(no content-type)', html ? '(HTML page)' : type.includes('json') ? text.slice(0, 300) : `(${text.length} bytes)`);
    if (r.status === 401) throw new Error('Garmin didn’t recognise the key (401). Check you copied all of it, or create a new one in Garmin Connect.');
    if (r.status === 403 || html) throw new Error(`Garmin refused the request (${r.status}${html ? ', firewall page' : ''}). It may be blocking requests from Supabase's servers.`);
    throw new Error(`Garmin token request failed (${r.status})`);
  }
  let body: any;
  try { body = JSON.parse(text); } catch { body = text.trim(); }
  const tok = typeof body === 'string' ? body
    : body.access_token ?? body.accessToken ?? body.token ?? body.value ?? body.data?.access_token ?? body.data?.accessToken;
  const shape = typeof body === 'object' ? Object.keys(body).join(', ') : `text, ${String(body).length} chars`;
  if (!tok || typeof tok !== 'string') {
    console.error('garmin token reply not understood', type, shape);
    throw new Error(`Garmin sent a token reply IMPlanner didn’t understand (${shape}).`);
  }
  console.log('garmin token ok', type, shape);
  return tok;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, { error: 'POST only' }, 405);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey(), { auth: { persistSession: false } });
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: who, error: authErr } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null }, error: null };
  const user = who?.user;
  if (authErr || !user) return json(req, { error: 'Sign in to IMPlanner first' }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { /* empty body */ }

  const { data: apiKey, error: keyErr } = await admin.rpc('garmin_key_for', { uid: user.id });
  if (keyErr) return json(req, { error: keyErr.message }, 500);
  if (!apiKey) return json(req, { error: 'Garmin isn’t connected yet' }, 409);

  try {
    const token = await garminToken(apiKey);
    const auth = { Authorization: `Bearer ${token}` };

    if (body.action === 'test') {
      await admin.rpc('garmin_mark', { uid: user.id, ok: true, err: null });
      return json(req, { ok: true });
    }

    if (body.action === 'sync') {
      const date = /^\d{4}-\d{2}-\d{2}$/;
      if (!date.test(body.since) || !date.test(body.until)) return json(req, { error: 'since and until must be YYYY-MM-DD' }, 400);
      const known = new Set((body.known ?? []).map(String));
      const max = Math.min(8, Math.max(1, Number(body.max) || 6));
      const q = new URLSearchParams({ start: '0', limit: '100', startDate: body.since, endDate: body.until, sortOrder: 'asc', excludeChildren: 'true' });
      const lr = await fetch(`${GARMIN}/activitylist-service/activities/search/activities?${q}`, { headers: { ...auth, Accept: 'application/json' } });
      if (!lr.ok) { console.error('garmin list failed', lr.status, lr.headers.get('content-type'), (await lr.text()).slice(0, 300)); throw new Error(`Garmin activity list failed (${lr.status})`); }
      const list: any[] = await lr.json();
      const wanted = list.filter(a => sportOf(a.activityType?.typeKey) && !known.has(String(a.activityId)));
      const out = [];
      for (const a of wanted.slice(0, max)) {
        const fr = await fetch(`${GARMIN}/download-service/files/activity/${a.activityId}`, {
          headers: { ...auth, Accept: '*/*' },
        });
        if (!fr.ok) { console.error('garmin file failed', fr.status, a.activityId); throw new Error(`Garmin file download failed (${fr.status}) for activity ${a.activityId}`); }
        out.push({
          id: String(a.activityId), name: a.activityName ?? '', type: a.activityType?.typeKey ?? '',
          startLocal: a.startTimeLocal ?? null, file: base64(new Uint8Array(await fr.arrayBuffer())),
        });
      }
      console.log('garmin sync', list.length, 'listed,', wanted.length, 'new,', out.length, 'sent');
      await admin.rpc('garmin_mark', { uid: user.id, ok: true, err: null });
      return json(req, { activities: out, more: wanted.length > out.length });
    }

    return json(req, { error: 'Unknown action' }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.rpc('garmin_mark', { uid: user.id, ok: false, err: msg });
    return json(req, { error: msg }, 502);
  }
});
