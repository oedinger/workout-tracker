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

const HTML = "<!doctype html>\n<html lang=\"he\" dir=\"rtl\">\n<head>\n<meta charset=\"utf-8\" />\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\" />\n<meta name=\"color-scheme\" content=\"light dark\" />\n<title>יומן אימונים</title>\n<style>\n  * { box-sizing: border-box; }\n  html, body { margin: 0; padding: 0; }\n  body {\n    font-family: system-ui, -apple-system, \"Segoe UI\", Arial, sans-serif;\n    line-height: 1.55;\n    background: #f4f1ec;\n    color: #1c1a17;\n    -webkit-font-smoothing: antialiased;\n  }\n  @media (prefers-color-scheme: dark) {\n    body { background: #16140f; color: #f2ede3; }\n  }\n  .wrap { max-width: 720px; margin: 0 auto; padding: 20px 16px 48px; width: 100%; }\n  header { margin-bottom: 16px; }\n  h1 { font-size: 32px; line-height: 1.15; margin: 0 0 4px; }\n  .sub { color: #57534a; font-size: 15px; margin: 0; }\n  .hub { color: #57534a; font-size: 13px; margin: 6px 0 0; }\n  .hub a { color: inherit; text-decoration: none; }\n  .hub a:hover { text-decoration: underline; }\n  @media (prefers-color-scheme: dark) { .sub, .hub { color: #b3ab9c; } }\n  /* The two letter cards sit side by side in one row. */\n  #cards { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: start; }\n  #cards .card { margin-bottom: 0; }\n  .card {\n    background: #fffdf9;\n    border: 1px solid #d9d2c4;\n    border-radius: 14px;\n    padding: 16px;\n    margin-bottom: 14px;\n    min-width: 0;\n  }\n  @media (prefers-color-scheme: dark) {\n    .card { background: #201d17; border-color: #3a352b; }\n  }\n  .card h2 { font-size: 22px; margin: 0 0 2px; }\n  .card .date { color: #57534a; font-size: 14px; display: block; margin-bottom: 4px; }\n  @media (prefers-color-scheme: dark) { .card .date { color: #b3ab9c; } }\n  .muted { color: #57534a; font-size: 14px; }\n  @media (prefers-color-scheme: dark) { .muted { color: #b3ab9c; } }\n  /* One exercise: name + last load, then a small minimal history sparkline. */\n  .ex-block { padding: 10px 0; border-top: 1px solid #d9d2c4; min-width: 0; }\n  .ex-block:first-of-type { border-top: none; padding-top: 4px; }\n  @media (prefers-color-scheme: dark) { .ex-block { border-top-color: #3a352b; } }\n  .ex-head { display: flex; justify-content: space-between; gap: 4px 10px; align-items: baseline; flex-wrap: wrap; }\n  .ex-name { font-weight: 700; min-width: 0; overflow-wrap: anywhere; }\n  .ex-name .note { display: block; font-weight: 400; font-size: 13px; color: #57534a; }\n  @media (prefers-color-scheme: dark) { .ex-name .note { color: #b3ab9c; } }\n  .ex-load { font-weight: 700; font-size: 17px; white-space: nowrap; font-variant-numeric: tabular-nums; }\n  .ex-load .unit { font-size: 12px; font-weight: 500; color: #57534a; }\n  .spark { display: block; margin: 3px 0 0; color: #1c1a17; }\n  @media (prefers-color-scheme: dark) { .spark { color: #f2ede3; } }\n  .spark-range { font-size: 12px; color: #57534a; margin-top: 1px; font-variant-numeric: tabular-nums; }\n  @media (prefers-color-scheme: dark) { .spark-range { color: #b3ab9c; } }\n  #status { color: #57534a; }\n  footer { color: #57534a; font-size: 13px; margin-top: 8px; }\n  @media (prefers-color-scheme: dark) { footer, #status { color: #b3ab9c; } }\n</style>\n</head>\n<body>\n<main class=\"wrap\">\n  <header>\n    <h1>יומן אימונים</h1>\n    <p class=\"sub\">THE WORKSHOP Strength Club · שני וחמישי 08:00 · אימונים A ו־C לסירוגין</p>\n    <p class=\"hub\"><a href=\"https://sites.oedinger.stream\">⌂ כל האתרים</a></p>\n    <p class=\"sub\" id=\"next-line\" hidden></p>\n  </header>\n\n  <p id=\"status\" role=\"status\">טוען אימונים…</p>\n\n  <div id=\"cards\"></div>\n\n  <footer id=\"updated\"></footer>\n</main>\n\n<script>\n// Official exercise names from THE WORKSHOP program sheet (23/11/2026).\n// Oren does only workouts A and C (no B). Stored workout data may use the\n// old Hebrew names — canonKey() normalises both to the same exercise.\n// KEY RULE: an exercise belongs to a specific workout letter. Deadlift in A\n// and Deadlift in C are DIFFERENT histories — every graph is keyed by\n// (letter, exercise), never by exercise alone.\nvar EXERCISES = {\n  'back-squat':  { name: 'Back Squat',     he: 'בק סקוואט' },\n  'pull-ups':    { name: 'Pull Ups',       he: 'פול אפס' },\n  'deadlift':    { name: 'Deadlift',       he: 'דדליפט' },\n  'dips':        { name: 'Dips',           he: 'דיפס' },\n  'goblet-squat':{ name: 'Goblet Squat',   he: 'גובלט סקוואט' },\n  'bench-press': { name: 'Bench Press',    he: 'חזה' },\n  'dar-lunges':  { name: 'D.A.R Lunges',   he: '' },\n  'double-kb-row':{ name: 'Double KB Row', he: 'חתירה' },\n  'kb-swing':    { name: 'KB Swing',       he: 'סוויפט' }\n};\n// Program order per letter (from the club sheet).\nvar LETTER_EXERCISES = {\n  'A': ['back-squat', 'pull-ups', 'deadlift', 'dips', 'goblet-squat'],\n  'C': ['deadlift', 'bench-press', 'dar-lunges', 'double-kb-row', 'kb-swing']\n};\nvar NAME_TO_KEY = {\n  'back squat': 'back-squat', 'בק סקוואט': 'back-squat', 'סקוואט': 'back-squat',\n  'pull ups': 'pull-ups', 'פול אפס': 'pull-ups',\n  'deadlift': 'deadlift', 'דדליפט': 'deadlift',\n  'dips': 'dips', 'דיפס': 'dips',\n  'goblet squat': 'goblet-squat', 'גובלט סקוואט': 'goblet-squat',\n  'bench press': 'bench-press', 'חזה': 'bench-press',\n  'd.a.r lunges': 'dar-lunges',\n  'double kb row': 'double-kb-row', 'חתירה': 'double-kb-row',\n  'kb swing': 'kb-swing', 'סוויפט': 'kb-swing'\n};\nfunction canonKey(name) {\n  if (!name) return null;\n  return NAME_TO_KEY[String(name).trim().toLowerCase()] || null;\n}\n// History key: letter + exercise. Same exercise name in another letter\n// is a different series.\nfunction histKey(letter, ex) {\n  var k = canonKey(ex.name);\n  if (!k) k = 'raw:' + String(ex.name).trim().toLowerCase();\n  return letter + '|' + k;\n}\n\nfunction esc(s) {\n  return String(s == null ? '' : s).replace(/[&<>\"']/g, function (c) {\n    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' }[c];\n  });\n}\nfunction fmtNum(v) {\n  return String(Math.round(v * 10) / 10);\n}\nfunction fmtDate(iso) {\n  if (!iso) return '';\n  var parts = iso.split('-');\n  if (parts.length !== 3) return esc(iso);\n  return parts[2] + '/' + parts[1] + '/' + parts[0];\n}\nfunction weekdayHe(iso) {\n  try {\n    var d = new Date(iso + 'T12:00:00');\n    return ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'][d.getDay()];\n  } catch (e) { return ''; }\n}\nfunction loadText(ex) {\n  var bits = [];\n  if (ex.load != null && ex.load !== '') bits.push(esc(fmtNum(ex.load)) + ' <span class=\"unit\">ק״ג</span>');\n  if (ex.reps != null && ex.reps !== '') bits.push('×' + esc(fmtNum(ex.reps)));\n  if (ex.sets != null && ex.sets !== '') bits.push(esc(ex.sets) + ' סטים');\n  return bits.join(' · ') || '—';\n}\n// Numeric value of one logged exercise: load (kg) if present, else reps.\nfunction exValue(ex) {\n  if (ex.load != null && ex.load !== '') return { v: Number(ex.load), unit: 'kg' };\n  if (ex.reps != null && ex.reps !== '') return { v: Number(ex.reps), unit: 'reps' };\n  return null;\n}\n// Minimal sparkline: thin line with a soft area fill, small dots, no axes, no labels.\n// Smaller than before (26px tall) — the values read from the caption under it.\nfunction sparkSVG(points) {\n  var W = 300, H = 26, PL = 4, PR = 4, PT = 4, PB = 4;\n  var vals = points.map(function (p) { return p.v; });\n  var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);\n  if (min === max) { min -= 1; max += 1; }\n  var pad = (max - min) * 0.25; min -= pad; max += pad;\n  function x(i) { return points.length === 1 ? W / 2 : PL + (W - PL - PR) * (i / (points.length - 1)); }\n  function y(v) { return PT + (H - PT - PB) * (1 - (v - min) / (max - min)); }\n  var line = points.map(function (p, i) {\n    return (i === 0 ? 'M' : 'L') + x(i).toFixed(1) + ' ' + y(p.v).toFixed(1);\n  }).join(' ');\n  var area = line + ' L' + x(points.length - 1).toFixed(1) + ' ' + (H - PB) + ' L' + x(0).toFixed(1) + ' ' + (H - PB) + ' Z';\n  var dots = points.map(function (p, i) {\n    var last = i === points.length - 1;\n    var halo = last ? '<circle cx=\"' + x(i).toFixed(1) + '\" cy=\"' + y(p.v).toFixed(1) + '\" r=\"6\" fill=\"none\" stroke=\"#c2410c\" stroke-opacity=\"0.35\" stroke-width=\"1.5\"/>' : '';\n    return halo + '<circle cx=\"' + x(i).toFixed(1) + '\" cy=\"' + y(p.v).toFixed(1) + '\" r=\"' + (last ? 3.5 : 2.5) + '\" fill=\"#c2410c\"/>';\n  }).join('');\n  return '<svg class=\"spark\" direction=\"ltr\" viewBox=\"0 0 ' + W + ' ' + H + '\" width=\"100%\" height=\"' + H + '\" role=\"img\" aria-label=\"גרף היסטוריה\">' +\n    '<path d=\"' + area + '\" fill=\"#c2410c\" fill-opacity=\"0.12\"/>' +\n    '<path d=\"' + line + '\" fill=\"none\" stroke=\"#c2410c\" stroke-width=\"2.5\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/>' +\n    dots + '</svg>';\n}\n// All logged observations grouped by (letter, exercise), oldest first.\nfunction buildHist(workouts) {\n  var h = {};\n  workouts.forEach(function (w) {\n    (w.exercises || []).forEach(function (ex) {\n      var k = histKey(w.letter, ex);\n      (h[k] = h[k] || []).push({ date: w.date, letter: w.letter, val: exValue(ex), note: ex.note || '' });\n    });\n  });\n  Object.keys(h).forEach(function (k) {\n    h[k].sort(function (a, b) { return a.date < b.date ? -1 : 1; });\n  });\n  return h;\n}\n// One letter card: program exercises in order, last entered load each,\n// small sparkline of that exercise's history in THIS letter only.\nfunction letterCard(letter, lastW, hist) {\n  var html = '<div class=\"card\"><h2>אימון ' + esc(letter) + '</h2>';\n  if (lastW) {\n    html += '<span class=\"date\">אחרון: ' + esc(weekdayHe(lastW.date)) + ' ' + fmtDate(lastW.date) + '</span>';\n  }\n  var keys = (LETTER_EXERCISES[letter] || []).slice();\n  // Any logged exercise of this letter not on the program list, appended after.\n  Object.keys(hist).forEach(function (hk) {\n    if (hk.indexOf(letter + '|') !== 0) return;\n    var k = hk.slice(2);\n    if (keys.indexOf(k) === -1) keys.push(k);\n  });\n  var byKey = {};\n  (lastW && lastW.exercises || []).forEach(function (ex) {\n    var k = canonKey(ex.name) || ('raw:' + String(ex.name).trim().toLowerCase());\n    byKey[k] = ex;\n  });\n  keys.forEach(function (k) {\n    var def = EXERCISES[k];\n    var name = def ? def.name : (k.indexOf('raw:') === 0 ? k.slice(4) : k);\n    var he = def ? def.he : '';\n    var ex = byKey[k];\n    var obs = hist[letter + '|' + k] || [];\n    var numeric = obs.filter(function (o) { return o.val; });\n    var subs = [];\n    if (he) subs.push(he);\n    if (ex && ex.note) subs.push(ex.note);\n    html += '<div class=\"ex-block\"><div class=\"ex-head\">' +\n      '<span class=\"ex-name\"><span dir=\"ltr\">' + esc(name) + '</span>' +\n      (subs.length ? '<span class=\"note\">' + subs.map(esc).join(' · ') + '</span>' : '') + '</span>' +\n      '<span class=\"ex-load\">' + (ex ? loadText(ex) : '—') + '</span></div>';\n    if (numeric.length) {\n      html += sparkSVG(numeric.map(function (o) { return { date: o.date, v: o.val.v }; }));\n      if (numeric.length > 1) {\n        var first = numeric[0], lastO = numeric[numeric.length - 1];\n        var unit = first.val.unit === 'kg' ? 'ק״ג' : 'חזרות';\n        // The note (e.g. the band) is part of the value: for Pull Ups a\n        // lighter band is progress even when the rep count drops, so the\n        // caption shows the band at each end instead of bare numbers.\n        function cap(o) {\n          var t = esc(fmtNum(o.val.v)) + ' ' + esc(unit);\n          if (o.note) t += ' (' + esc(o.note) + ')';\n          return t;\n        }\n        html += '<div class=\"spark-range\">' + cap(first) + ' ← ' + cap(lastO) + '</div>';\n      }\n    }\n    html += '</div>';\n  });\n  return html + '</div>';\n}\n\nasync function main() {\n  var status = document.getElementById('status');\n  var data;\n  try {\n    var res = await fetch('/api/workouts');\n    if (!res.ok) throw new Error('HTTP ' + res.status);\n    data = await res.json();\n  } catch (e) {\n    status.textContent = 'לא הצלחתי לטעון את האימונים. נסה לרענן.';\n    return;\n  }\n  var workouts = data.workouts || [];\n  if (!workouts.length) {\n    status.textContent = 'אין עדיין אימונים מתועדים. שלח אימון אחרי האימון הבא והוא יופיע כאן.';\n    return;\n  }\n  status.hidden = true;\n  var hist = buildHist(workouts);\n\n  // Next workout: opposite letter of the newest logged workout.\n  var last = workouts[0];\n  var nextLetter = last.letter === 'A' ? 'C' : 'A';\n  var nextLine = document.getElementById('next-line');\n  nextLine.textContent = 'האימון הבא: אימון ' + nextLetter;\n  nextLine.hidden = false;\n\n  var cardsEl = document.getElementById('cards');\n  ['A', 'C'].forEach(function (letter) {\n    var w = data.last_by_letter && data.last_by_letter[letter];\n    var div = document.createElement('div');\n    div.innerHTML = letterCard(letter, w || null, hist);\n    cardsEl.appendChild(div.firstChild);\n  });\n\n  if (data.meta && data.meta.updated) {\n    document.getElementById('updated').textContent = 'עודכן: ' + data.meta.updated;\n  }\n}\nmain();\n</script>\n</body>\n</html>\n";

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
