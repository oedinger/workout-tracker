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

const HTML = "<!doctype html>\n<html lang=\"he\" dir=\"rtl\">\n<head>\n<meta charset=\"utf-8\" />\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\" />\n<meta name=\"color-scheme\" content=\"light dark\" />\n<title>יומן אימונים</title>\n<style>\n  * { box-sizing: border-box; }\n  html, body { margin: 0; padding: 0; }\n  body {\n    font-family: system-ui, -apple-system, \"Segoe UI\", Arial, sans-serif;\n    line-height: 1.55;\n    background: #f4f1ec;\n    color: #1c1a17;\n    -webkit-font-smoothing: antialiased;\n  }\n  @media (prefers-color-scheme: dark) {\n    body { background: #16140f; color: #f2ede3; }\n  }\n  .wrap { max-width: 560px; margin: 0 auto; padding: 20px 16px 48px; width: 100%; }\n  header { margin-bottom: 18px; }\n  h1 { font-size: 32px; line-height: 1.15; margin: 0 0 4px; }\n  .sub { color: #57534a; font-size: 15px; margin: 0; }\n  @media (prefers-color-scheme: dark) { .sub { color: #b3ab9c; } }\n  h2 { font-size: 20px; margin: 0 0 10px; }\n  section { margin-bottom: 22px; }\n  .card {\n    background: #fffdf9;\n    border: 1px solid #d9d2c4;\n    border-radius: 14px;\n    padding: 16px;\n    margin-bottom: 12px;\n    min-width: 0;\n  }\n  @media (prefers-color-scheme: dark) {\n    .card { background: #201d17; border-color: #3a352b; }\n  }\n  .card .date { color: #57534a; font-size: 14px; }\n  @media (prefers-color-scheme: dark) { .card .date { color: #b3ab9c; } }\n  .badge {\n    display: inline-block;\n    background: #fbe9dd;\n    color: #c2410c;\n    font-weight: 700;\n    font-size: 13px;\n    padding: 2px 10px;\n    border-radius: 999px;\n    margin-bottom: 8px;\n  }\n  .next-letter { font-size: 26px; font-weight: 800; }\n  table { width: 100%; border-collapse: collapse; }\n  td { padding: 8px 0; border-top: 1px solid #d9d2c4; vertical-align: baseline; }\n  tr:first-child td { border-top: none; }\n  @media (prefers-color-scheme: dark) { td { border-top-color: #3a352b; } }\n  td.ex { font-weight: 600; min-width: 0; overflow-wrap: anywhere; }\n  td.ex .note { display: block; font-weight: 400; font-size: 13px; color: #57534a; }\n  @media (prefers-color-scheme: dark) { td.ex .note { color: #b3ab9c; } }\n  td.wt {\n    text-align: left;\n    font-weight: 700;\n    font-size: 17px;\n    white-space: nowrap;\n    padding-inline-start: 10px;\n    font-variant-numeric: tabular-nums;\n  }\n  td.wt .unit { font-size: 12px; font-weight: 500; color: #57534a; }\n  .cards { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }\n  @media (max-width: 420px) { .cards { grid-template-columns: 1fr; } }\n  .letter-card h3 { margin: 0 0 2px; font-size: 20px; }\n  .letter-card .date { display: block; margin-bottom: 6px; }\n  .muted { color: #57534a; font-size: 14px; }\n  @media (prefers-color-scheme: dark) { .muted { color: #b3ab9c; } }\n  .bar-row { display: flex; align-items: baseline; gap: 8px; margin: 6px 0; min-width: 0; }\n  .bar-row .lbl { flex: 0 0 auto; font-size: 14px; color: #57534a; }\n  .bar-track { flex: 1 1 auto; min-width: 0; height: 12px; background: #ece7dd; border-radius: 999px; overflow: hidden; }\n  .bar-fill { height: 100%; background: #c2410c; border-radius: 999px; }\n  .bar-val { flex: 0 0 auto; font-weight: 700; font-variant-numeric: tabular-nums; }\n  #status { color: #57534a; }\n  footer { color: #57534a; font-size: 13px; margin-top: 8px; }\n  @media (prefers-color-scheme: dark) { footer, #status { color: #b3ab9c; } }\n</style>\n</head>\n<body>\n<main class=\"wrap\">\n  <header>\n    <h1>יומן אימונים</h1>\n    <p class=\"sub\">THE WORKSHOP Strength Club · שני וחמישי 08:00 · אימונים A ו־C לסירוגין</p>\n  </header>\n\n  <p id=\"status\" role=\"status\">טוען אימונים…</p>\n\n  <section id=\"next-section\" hidden>\n    <h2>האימון הבא</h2>\n    <div class=\"card\" id=\"next-card\"></div>\n  </section>\n\n  <section id=\"letters-section\" hidden>\n    <h2>משקלים אחרונים לפי אימון</h2>\n    <div class=\"cards\" id=\"letters\"></div>\n  </section>\n\n  <section id=\"deadlift-section\" hidden>\n    <h2>התקדמות — דדליפט</h2>\n    <div class=\"card\" id=\"deadlift\"></div>\n  </section>\n\n  <section id=\"history-section\" hidden>\n    <h2>היסטוריה</h2>\n    <div id=\"history\"></div>\n  </section>\n\n  <footer id=\"updated\"></footer>\n</main>\n\n<script>\nfunction esc(s) {\n  return String(s == null ? '' : s).replace(/[&<>\"']/g, function (c) {\n    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' }[c];\n  });\n}\nfunction fmtDate(iso) {\n  if (!iso) return '';\n  var parts = iso.split('-');\n  if (parts.length !== 3) return esc(iso);\n  return parts[2] + '/' + parts[1] + '/' + parts[0];\n}\nfunction weekdayHe(iso) {\n  try {\n    var d = new Date(iso + 'T12:00:00');\n    return ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'][d.getDay()];\n  } catch (e) { return ''; }\n}\nfunction loadText(ex) {\n  var bits = [];\n  if (ex.load != null && ex.load !== '') bits.push(esc(ex.load) + ' <span class=\"unit\">ק״ג</span>');\n  if (ex.reps != null && ex.reps !== '') bits.push('×' + esc(ex.reps));\n  if (ex.sets != null && ex.sets !== '') bits.push(esc(ex.sets) + ' סטים');\n  return bits.join(' · ') || '—';\n}\nfunction exerciseRows(exercises) {\n  return (exercises || []).map(function (ex) {\n    var note = ex.note ? '<span class=\"note\">' + esc(ex.note) + '</span>' : '';\n    return '<tr><td class=\"ex\">' + esc(ex.name) + note + '</td>' +\n      '<td class=\"wt\">' + loadText(ex) + '</td></tr>';\n  }).join('');\n}\nfunction workoutCard(w, badgeText) {\n  var badge = badgeText ? '<span class=\"badge\">' + esc(badgeText) + '</span>' : '';\n  return badge +\n    '<div class=\"date\">אימון ' + esc(w.letter) + ' · ' + esc(weekdayHe(w.date)) + ' ' + fmtDate(w.date) + '</div>' +\n    '<table>' + exerciseRows(w.exercises) + '</table>';\n}\n\nasync function main() {\n  var status = document.getElementById('status');\n  var data;\n  try {\n    var res = await fetch('/api/workouts');\n    if (!res.ok) throw new Error('HTTP ' + res.status);\n    data = await res.json();\n  } catch (e) {\n    status.textContent = 'לא הצלחתי לטעון את האימונים. נסה לרענן.';\n    return;\n  }\n  var workouts = data.workouts || [];\n  if (!workouts.length) {\n    status.textContent = 'אין עדיין אימונים מתועדים. שלח אימון אחרי האימון הבא והוא יופיע כאן.';\n    return;\n  }\n  status.hidden = true;\n\n  // Next workout: opposite letter of the newest logged workout.\n  var last = workouts[0];\n  var nextLetter = last.letter === 'A' ? 'C' : 'A';\n  var prevSame = (data.last_by_letter && data.last_by_letter[nextLetter]) || null;\n  var nextCard = document.getElementById('next-card');\n  if (prevSame) {\n    nextCard.innerHTML = '<div class=\"next-letter\">אימון ' + esc(nextLetter) + '</div>' +\n      '<p class=\"muted\">פעם קודמת — ' + esc(weekdayHe(prevSame.date)) + ' ' + fmtDate(prevSame.date) + ':</p>' +\n      '<table>' + exerciseRows(prevSame.exercises) + '</table>';\n  } else {\n    nextCard.innerHTML = '<div class=\"next-letter\">אימון ' + esc(nextLetter) + '</div>' +\n      '<p class=\"muted\">אין עדיין אימון ' + esc(nextLetter) + ' מתועד — זו תהיה הפעם הראשונה.</p>';\n  }\n  document.getElementById('next-section').hidden = false;\n\n  // Last weights per letter.\n  var lettersEl = document.getElementById('letters');\n  ['A', 'C'].forEach(function (letter) {\n    var w = data.last_by_letter && data.last_by_letter[letter];\n    var div = document.createElement('div');\n    div.className = 'card letter-card';\n    div.innerHTML = w\n      ? '<h3>אימון ' + esc(letter) + '</h3><span class=\"date\">' + esc(weekdayHe(w.date)) + ' ' + fmtDate(w.date) + '</span>' +\n        '<table>' + exerciseRows(w.exercises) + '</table>'\n      : '<h3>אימון ' + esc(letter) + '</h3><p class=\"muted\">עדיין לא תועד.</p>';\n    lettersEl.appendChild(div);\n  });\n  document.getElementById('letters-section').hidden = false;\n\n  // Deadlift progress (only workouts that logged a deadlift load).\n  var dl = workouts\n    .filter(function (w) {\n      return (w.exercises || []).some(function (ex) { return ex.name === 'דדליפט' && ex.load != null; });\n    })\n    .map(function (w) {\n      var ex = w.exercises.find(function (e) { return e.name === 'דדליפט'; });\n      return { date: w.date, letter: w.letter, load: ex.load };\n    })\n    .sort(function (a, b) { return a.date < b.date ? -1 : 1; });\n  if (dl.length) {\n    var max = Math.max.apply(null, dl.map(function (d) { return d.load; }));\n    var first = dl[0].load, lastDl = dl[dl.length - 1].load;\n    var delta = Math.round((lastDl - first) * 10) / 10;\n    var html = '<p class=\"muted\">' + esc(first) + ' ← ' + esc(lastDl) + ' ק״ג' +\n      (dl.length > 1 ? ' (' + (delta >= 0 ? '+' : '') + esc(delta) + ' ק״ג)' : '') + '</p>';\n    html += dl.map(function (d) {\n      var pct = max > 0 ? Math.round((d.load / max) * 100) : 0;\n      return '<div class=\"bar-row\"><span class=\"lbl\">אימון ' + esc(d.letter) + ' · ' + fmtDate(d.date) + '</span>' +\n        '<span class=\"bar-track\"><span class=\"bar-fill\" style=\"display:block;width:' + pct + '%\"></span></span>' +\n        '<span class=\"bar-val\">' + esc(d.load) + '</span></div>';\n    }).join('');\n    document.getElementById('deadlift').innerHTML = html;\n    document.getElementById('deadlift-section').hidden = false;\n  }\n\n  // Full history, newest first.\n  var histEl = document.getElementById('history');\n  workouts.forEach(function (w, i) {\n    var div = document.createElement('div');\n    div.className = 'card';\n    div.innerHTML = workoutCard(w, i === 0 ? 'האימון האחרון' : '');\n    histEl.appendChild(div);\n  });\n  document.getElementById('history-section').hidden = false;\n\n  if (data.meta && data.meta.updated) {\n    document.getElementById('updated').textContent = 'עודכן: ' + data.meta.updated;\n  }\n}\nmain();\n</script>\n</body>\n</html>\n";

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
