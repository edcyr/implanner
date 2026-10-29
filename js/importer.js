// Read workout files exported from Garmin Connect (or any device):
//   .fit (Garmin's own format, decoded with Garmin's official FIT SDK)
//   .zip (what "Export Original" downloads: a zip with the .fit inside)
//   .tcx and .gpx
// Output: activity objects (summary + zone times + a small downsampled series).
// GPS positions are never kept.

import { fromDate, uid } from './util.js';

const FIT_SDK = 'https://cdn.jsdelivr.net/npm/@garmin/fitsdk@21.217.0/+esm';

// ---- zip (stored or deflate; enough for Garmin exports) -------------------

async function unzip(buf) {
  const v = new DataView(buf), out = [];
  // Find the end-of-central-directory record, then walk the central directory.
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip file');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true);
    const csize = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true);
    const localOff = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(buf, p + 46, nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    const lNameLen = v.getUint16(localOff + 26, true), lExtraLen = v.getUint16(localOff + 28, true);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = new Uint8Array(buf, start, csize);
    if (name.endsWith('/')) continue;
    let data;
    if (method === 0) data = raw.slice().buffer;
    else if (method === 8) data = await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
    else continue;
    out.push({ name, data });
  }
  return out;
}

// ---- helpers -----------------------------------------------------------------

async function sha256(buf) {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

const FIT_SPORT = { cycling: 'bike', eBiking: 'bike', running: 'run', swimming: 'swim', training: 'strength', fitnessEquipment: 'other', walking: 'other', hiking: 'other' };
function mapSport(s) {
  const k = String(s || '').toLowerCase();
  if (/bik|cycl|ride/.test(k)) return 'bike';
  if (/run/.test(k)) return 'run';
  if (/swim/.test(k)) return 'swim';
  if (/strength|training/.test(k)) return 'strength';
  return 'other';
}

// Friel heart-rate zones as fractions of lactate-threshold HR, upper bounds of Z1..Z4.
const HR_BOUNDS = { bike: [0.81, 0.89, 0.93, 0.99], run: [0.85, 0.89, 0.94, 0.99] };
const PW_BOUNDS = [0.55, 0.75, 0.90, 1.05];   // Coggan, fractions of FTP

function zoneIndex(v, bounds) { let z = 0; while (z < bounds.length && v > bounds[z]) z++; return z; }

// Time in zones and a ≤ 300-point series from per-second-ish records.
function summarizeRecords(recs, sport, th) {
  if (!recs.length) return { zones: null, series: null };
  const lthr = sport === 'bike' ? th.lthr_bike : sport === 'run' ? th.lthr_run : null;
  const hrZ = lthr ? [0, 0, 0, 0, 0] : null, pwZ = sport === 'bike' && th.ftp ? [0, 0, 0, 0, 0] : null;
  for (let i = 1; i < recs.length; i++) {
    const dt = Math.min(10, (recs[i].t - recs[i - 1].t));
    if (!(dt > 0)) continue;
    if (hrZ && recs[i].hr) hrZ[zoneIndex(recs[i].hr / lthr, HR_BOUNDS[sport])] += dt;
    if (pwZ && recs[i].pw != null) pwZ[zoneIndex(recs[i].pw / th.ftp, PW_BOUNDS)] += dt;
  }
  const t0 = recs[0].t, span = recs[recs.length - 1].t - t0 || 1;
  const B = Math.min(300, recs.length), buckets = Array.from({ length: B }, () => ({ n: 0, hr: 0, hn: 0, pw: 0, pn: 0, sp: 0, sn: 0, al: 0, an: 0 }));
  for (const r of recs) {
    const b = buckets[Math.min(B - 1, Math.floor((r.t - t0) / span * B))];
    b.n++;
    if (r.hr) { b.hr += r.hr; b.hn++; }
    if (r.pw != null) { b.pw += r.pw; b.pn++; }
    if (r.sp != null) { b.sp += r.sp; b.sn++; }
    if (r.al != null) { b.al += r.al; b.an++; }
  }
  const col = (k, n, dec = 0) => buckets.some(b => b[n]) ? buckets.map(b => b[n] ? +(b[k] / b[n]).toFixed(dec) : null) : null;
  const series = { t: buckets.map((_, i) => Math.round(i / B * span)), hr: col('hr', 'hn'), pw: col('pw', 'pn'), sp: col('sp', 'sn', 2), al: col('al', 'an', 1) };
  return { zones: (hrZ || pwZ) ? { hr: hrZ, power: pwZ } : null, series };
}

const round = (v, d = 0) => v == null || !Number.isFinite(+v) ? null : +(+v).toFixed(d);

function makeActivity(base, recs, th) {
  const start = base.start_time ? new Date(base.start_time) : null;
  const { zones, series } = summarizeRecords(recs, base.sport, th);
  return {
    id: uid(), session_id: null,
    date: start ? fromDate(start) : fromDate(new Date()),
    start_time: start ? start.toISOString() : null,
    sport: base.sport, title: base.title || '',
    duration_s: Math.round(base.duration_s || 0),
    source: base.source, rpe: null, feel: null, notes: '',
    file_hash: base.file_hash,
    distance_m: round(base.distance_m, 1), elapsed_s: round(base.elapsed_s),
    avg_hr: round(base.avg_hr), max_hr: round(base.max_hr), avg_power: round(base.avg_power), np: round(base.np),
    avg_cadence: round(base.avg_cadence), ascent_m: round(base.ascent_m, 1), calories: round(base.calories),
    pool_length_m: round(base.pool_length_m, 1), zones, series,
  };
}

// ---- FIT -----------------------------------------------------------------------

let sdk;
async function parseFit(buf, hash, th) {
  sdk ||= await import(FIT_SDK);
  const { Decoder, Stream } = sdk;
  const stream = Stream.fromArrayBuffer(buf);
  if (!Decoder.isFIT(stream)) throw new Error('Not a FIT file');
  const decoder = new Decoder(stream);
  const { messages, errors } = decoder.read({ convertTypesToStrings: true, convertDateTimesToDates: true });
  const sessions = messages.sessionMesgs || [];
  if (!sessions.length) throw new Error(errors?.[0]?.message || 'No workout found in this FIT file');
  const records = (messages.recordMesgs || []).filter(r => r.timestamp).map(r => ({
    t: r.timestamp.getTime() / 1000, hr: r.heartRate ?? null, pw: r.power ?? null,
    sp: r.enhancedSpeed ?? r.speed ?? null, al: r.enhancedAltitude ?? r.altitude ?? null,
  }));
  // Multisport files (e.g. a brick or a race) hold one session per leg; transitions are dropped.
  return sessions.filter(s => s.sport !== 'transition').map((s, i) => {
    const t0 = s.startTime?.getTime() / 1000, t1 = t0 + (s.totalElapsedTime || 0);
    const recs = sessions.length > 1 ? records.filter(r => r.t >= t0 && r.t <= t1) : records;
    return makeActivity({
      sport: FIT_SPORT[s.sport] || mapSport(s.sport), source: 'fit', file_hash: sessions.length > 1 ? `${hash}:${i}` : hash,
      start_time: s.startTime, duration_s: s.totalTimerTime ?? s.totalElapsedTime, elapsed_s: s.totalElapsedTime,
      distance_m: s.totalDistance, avg_hr: s.avgHeartRate, max_hr: s.maxHeartRate,
      avg_power: s.avgPower, np: s.normalizedPower, avg_cadence: s.avgCadence ?? s.avgRunningCadence,
      ascent_m: s.totalAscent, calories: s.totalCalories, pool_length_m: s.poolLength,
    }, recs, th);
  });
}

// ---- TCX / GPX -------------------------------------------------------------------

const txt = (el, sel) => el?.getElementsByTagName(sel)?.[0]?.textContent;
const num = v => v == null || v === '' ? null : +v;
function byLocal(el, name) { return [...el.getElementsByTagName('*')].filter(n => n.localName === name); }
function firstLocal(el, name) { return byLocal(el, name)[0]?.textContent ?? null; }

function parseTcx(text, hash, th) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const acts = byLocal(doc, 'Activity');
  if (!acts.length) throw new Error('No activity in this TCX file');
  return acts.map((act, i) => {
    const laps = byLocal(act, 'Lap');
    let dur = 0, dist = 0, cal = 0, hrSum = 0, maxHr = 0;
    for (const lap of laps) {
      const t = num(txt(lap, 'TotalTimeSeconds')) || 0;
      dur += t; dist += num(txt(lap, 'DistanceMeters')) || 0; cal += num(txt(lap, 'Calories')) || 0;
      const ah = num(firstLocal(byLocal(lap, 'AverageHeartRateBpm')[0] || lap, 'Value')); if (ah) hrSum += ah * t;
      const mh = num(firstLocal(byLocal(lap, 'MaximumHeartRateBpm')[0] || lap, 'Value')); if (mh > maxHr) maxHr = mh;
    }
    const recs = byLocal(act, 'Trackpoint').map(tp => ({
      t: Date.parse(txt(tp, 'Time')) / 1000,
      hr: num(firstLocal(byLocal(tp, 'HeartRateBpm')[0] || document.createElement('x'), 'Value')),
      pw: num(firstLocal(tp, 'Watts')), sp: num(firstLocal(tp, 'Speed')), al: num(txt(tp, 'AltitudeMeters')),
    })).filter(r => Number.isFinite(r.t));
    const pws = recs.filter(r => r.pw != null);
    return makeActivity({
      sport: mapSport(act.getAttribute('Sport')), source: 'tcx', file_hash: acts.length > 1 ? `${hash}:${i}` : hash,
      start_time: txt(act, 'Id') || laps[0]?.getAttribute('StartTime'), duration_s: dur, elapsed_s: recs.length > 1 ? recs[recs.length - 1].t - recs[0].t : dur,
      distance_m: dist || null, avg_hr: dur && hrSum ? hrSum / dur : null, max_hr: maxHr || null,
      avg_power: pws.length ? pws.reduce((a, r) => a + r.pw, 0) / pws.length : null, calories: cal || null,
    }, recs, th);
  });
}

function haversine(a, b) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function parseGpx(text, hash, th) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const trk = byLocal(doc, 'trk')[0];
  if (!trk) throw new Error('No track in this GPX file');
  const pts = byLocal(trk, 'trkpt').map(p => ({
    lat: +p.getAttribute('lat'), lon: +p.getAttribute('lon'),
    t: Date.parse(firstLocal(p, 'time')) / 1000, al: num(firstLocal(p, 'ele')),
    hr: num(firstLocal(p, 'hr')), pw: num(firstLocal(p, 'power')),
  })).filter(p => Number.isFinite(p.t));
  if (pts.length < 2) throw new Error('Not enough points in this GPX file');
  let dist = 0, moving = 0, ascent = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = haversine(pts[i - 1], pts[i]), dt = pts[i].t - pts[i - 1].t;
    dist += d;
    if (dt > 0 && dt < 60 && d / dt > 0.3) moving += dt;      // drop pauses
    pts[i].sp = dt > 0 ? d / dt : null;
    if (pts[i].al != null && pts[i - 1].al != null && pts[i].al > pts[i - 1].al) ascent += pts[i].al - pts[i - 1].al;
  }
  const hrs = pts.filter(p => p.hr), pws = pts.filter(p => p.pw != null);
  const recs = pts.map(({ lat, lon, ...r }) => r);
  return [makeActivity({
    sport: mapSport(firstLocal(trk, 'type') || txt(trk, 'name')), source: 'gpx', file_hash: hash,
    start_time: new Date(pts[0].t * 1000), duration_s: moving || pts[pts.length - 1].t - pts[0].t, elapsed_s: pts[pts.length - 1].t - pts[0].t,
    distance_m: dist, avg_hr: hrs.length ? hrs.reduce((a, p) => a + p.hr, 0) / hrs.length : null,
    max_hr: hrs.length ? Math.max(...hrs.map(p => p.hr)) : null,
    avg_power: pws.length ? pws.reduce((a, p) => a + p.pw, 0) / pws.length : null, ascent_m: ascent || null,
  }, recs, th)];
}

// ---- entry point -------------------------------------------------------------------

async function parseOne(name, buf, th) {
  const ext = name.toLowerCase().split('.').pop();
  const hash = await sha256(buf);
  if (ext === 'fit') return parseFit(buf, hash, th);
  if (ext === 'tcx') return parseTcx(new TextDecoder().decode(buf), hash, th);
  if (ext === 'gpx') return parseGpx(new TextDecoder().decode(buf), hash, th);
  throw new Error('Unsupported file type');
}

// Returns [{ name, activities?: [...], error?: string }]
export async function readWorkoutFiles(files, thresholds = {}) {
  const results = [];
  for (const file of files) {
    try {
      const buf = await file.arrayBuffer();
      if (file.name.toLowerCase().endsWith('.zip')) {
        const entries = (await unzip(buf)).filter(e => /\.(fit|tcx|gpx)$/i.test(e.name));
        if (!entries.length) throw new Error('No .fit, .tcx or .gpx files inside this zip');
        for (const e of entries) {
          try { results.push({ name: `${file.name} › ${e.name.split('/').pop()}`, activities: await parseOne(e.name, e.data, thresholds) }); }
          catch (err) { results.push({ name: e.name, error: err.message }); }
        }
      } else {
        results.push({ name: file.name, activities: await parseOne(file.name, buf, thresholds) });
      }
    } catch (err) {
      results.push({ name: file.name, error: err.message || String(err) });
    }
  }
  return results;
}

export { unzip as _unzip, summarizeRecords as _summarizeRecords };
