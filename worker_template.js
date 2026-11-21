// Workout tracker — Cloudflare Worker + KV.
// KV binding: WORKOUT_KV. No D1 (the Cloudflare token has no D1 scope).
// KV keys:
//   workout:<date>:<letter>  -> {date, letter, exercises: [...], updated}
//   meta                     -> {workouts: ["workout:<date>:<letter>", ...newest first],
//                               last_by_letter: {A: {...}, C: {...}}, updated}
// Exercise: {name, sets?, reps?, load?, unit?, note?} — only fields that
// are actually known are stored; sets/reps are never invented.
// Routes: GET / (page), GET /api/workouts, GET /api/last?letter=,
// POST /api/sync (Bearer SYNC_SECRET), GET /api/health (alias /health).
// GETs need no auth; POST /api/sync requires Bearer env.SYNC_SECRET.

const HTML = __HTML_JSON__;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const workoutKey = (date, letter) => 'workout:' + date + ':' + letter;

function sortNewestFirst(list) {
  return list.slice().sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.letter < b.letter ? 1 : -1;
  });
}

async function getMeta(env) {
  const meta = await env.WORKOUT_KV.get('meta', 'json');
  return meta || { workouts: [], last_by_letter: {}, updated: '' };
}

async function getAllWorkouts(env) {
  const meta = await getMeta(env);
  const docs = [];
  for (const key of meta.workouts || []) {
    const doc = await env.WORKOUT_KV.get(key, 'json');
    if (doc) docs.push(doc);
  }
  return { meta, workouts: sortNewestFirst(docs) };
}

function lastByLetter(workouts) {
  const out = {};
  for (const w of workouts) {
    if (!out[w.letter]) out[w.letter] = w; // workouts are newest-first
  }
  return out;
}

function cleanExercise(ex) {
  if (!ex || typeof ex.name !== 'string' || !ex.name.trim()) return null;
  const out = { name: ex.name.trim() };
  if (ex.sets != null && ex.sets !== '') out.sets = Number(ex.sets);
  if (ex.reps != null && ex.reps !== '') out.reps = Number(ex.reps);
  if (ex.load != null && ex.load !== '') out.load = Number(ex.load);
  if (ex.unit) out.unit = String(ex.unit);
  if (ex.note) out.note = String(ex.note);
  if (out.sets != null && !Number.isFinite(out.sets)) return null;
  if (out.reps != null && !Number.isFinite(out.reps)) return null;
  if (out.load != null && !Number.isFinite(out.load)) return null;
  return out;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/' || path === '/index.html') {
      return new Response(HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (path === '/api/health' || path === '/health') return json({ ok: true });

    if (path === '/api/workouts' && request.method === 'GET') {
      const { meta, workouts } = await getAllWorkouts(env);
      return json({ workouts, last_by_letter: lastByLetter(workouts), meta });
    }

    if (path === '/api/last' && request.method === 'GET') {
      const letter = (url.searchParams.get('letter') || '').toUpperCase();
      if (!['A', 'B', 'C'].includes(letter)) {
        return json({ error: 'letter must be A, B or C' }, 400);
      }
      const { workouts } = await getAllWorkouts(env);
      const found = workouts.find((w) => w.letter === letter);
      if (!found) return json({ error: 'no workout ' + letter + ' recorded yet' }, 404);
      return json(found);
    }

    if (path === '/api/sync' && request.method === 'POST') {
      const auth = request.headers.get('Authorization') || '';
      if (!env.SYNC_SECRET || auth !== 'Bearer ' + env.SYNC_SECRET) {
        return new Response('unauthorized', { status: 401 });
      }
      let data = {};
      try { data = await request.json(); } catch { return json({ error: 'invalid JSON' }, 400); }

      const date = String(data.date || '');
      const letter = String(data.letter || '').toUpperCase();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return json({ error: 'date (YYYY-MM-DD) is required' }, 400);
      }
      if (!['A', 'B', 'C'].includes(letter)) {
        return json({ error: 'letter must be A, B or C' }, 400);
      }
      if (!Array.isArray(data.exercises) || !data.exercises.length) {
        return json({ error: 'exercises (non-empty array) is required' }, 400);
      }
      const exercises = data.exercises.map(cleanExercise);
      if (exercises.some((e) => e === null)) {
        return json({ error: 'each exercise needs a name and numeric sets/reps/load' }, 400);
      }

      const now = new Date().toISOString();
      const doc = { date, letter, exercises, updated: now };
      const key = workoutKey(date, letter);
      await env.WORKOUT_KV.put(key, JSON.stringify(doc));

      const meta = await getMeta(env);
      if (!meta.workouts.includes(key)) meta.workouts.push(key);
      meta.workouts.sort((a, b) => (a < b ? 1 : -1)); // keys sort by date desc (YYYY-MM-DD)
      const prev = meta.last_by_letter[letter];
      if (!prev || date >= prev.date) meta.last_by_letter[letter] = doc;
      meta.updated = now;
      await env.WORKOUT_KV.put('meta', JSON.stringify(meta));
      return json({ ok: true, key, date, letter, count: exercises.length });
    }

    return new Response('Not found', { status: 404 });
  },
};
