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

const HTML = "<!doctype html>\n<html lang=\"he\" dir=\"rtl\">\n<head>\n<meta charset=\"utf-8\" />\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\" />\n<meta name=\"color-scheme\" content=\"light dark\" />\n<title>יומן אימונים</title>\n<style>\n  * { box-sizing: border-box; }\n  html, body { margin: 0; padding: 0; }\n  body {\n    font-family: system-ui, -apple-system, \"Segoe UI\", Arial, sans-serif;\n    line-height: 1.55;\n    background: #f4f1ec;\n    color: #1c1a17;\n    -webkit-font-smoothing: antialiased;\n  }\n  @media (prefers-color-scheme: dark) {\n    body { background: #16140f; color: #f2ede3; }\n  }\n  .wrap { max-width: 560px; margin: 0 auto; padding: 20px 16px 48px; width: 100%; }\n  header { margin-bottom: 18px; }\n  h1 { font-size: 32px; line-height: 1.15; margin: 0 0 4px; }\n  .sub { color: #57534a; font-size: 15px; margin: 0; }\n  @media (prefers-color-scheme: dark) { .sub { color: #b3ab9c; } }\n  h2 { font-size: 20px; margin: 0 0 10px; }\n  section { margin-bottom: 22px; }\n  .card {\n    background: #fffdf9;\n    border: 1px solid #d9d2c4;\n    border-radius: 14px;\n    padding: 16px;\n    margin-bottom: 12px;\n    min-width: 0;\n  }\n  @media (prefers-color-scheme: dark) {\n    .card { background: #201d17; border-color: #3a352b; }\n  }\n  .card .date { color: #57534a; font-size: 14px; }\n  @media (prefers-color-scheme: dark) { .card .date { color: #b3ab9c; } }\n  .badge {\n    display: inline-block;\n    background: #fbe9dd;\n    color: #c2410c;\n    font-weight: 700;\n    font-size: 13px;\n    padding: 2px 10px;\n    border-radius: 999px;\n    margin-bottom: 8px;\n  }\n  .next-letter { font-size: 26px; font-weight: 800; }\n  .cards { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }\n  @media (max-width: 420px) { .cards { grid-template-columns: 1fr; } }\n  .letter-card h3 { margin: 0 0 2px; font-size: 20px; }\n  .letter-card .date { display: block; margin-bottom: 6px; }\n  .muted { color: #57534a; font-size: 14px; }\n  @media (prefers-color-scheme: dark) { .muted { color: #b3ab9c; } }\n  .prog-card h3 { margin: 0 0 2px; font-size: 19px; }\n  .prog-card h3 .he { font-weight: 400; font-size: 14px; color: #57534a; }\n  @media (prefers-color-scheme: dark) { .prog-card h3 .he { color: #b3ab9c; } }\n  .prog-line { font-weight: 700; font-size: 15px; margin: 4px 0 2px; font-variant-numeric: tabular-nums; }\n  .prog-line .delta { color: #c2410c; }\n  .chart { margin: 6px 0 2px; color: #1c1a17; }\n  @media (prefers-color-scheme: dark) { .chart { color: #f2ede3; } }\n  .obs { list-style: none; margin: 6px 0 0; padding: 0; font-size: 13px; color: #57534a; }\n  .obs li { padding: 1px 0; }\n  @media (prefers-color-scheme: dark) { .obs { color: #b3ab9c; } }\n  /* One exercise inside a workout card: name + load, then its own history graph. */\n  .ex-block { padding: 10px 0; border-top: 1px solid #d9d2c4; min-width: 0; }\n  .ex-block:first-child { border-top: none; padding-top: 2px; }\n  @media (prefers-color-scheme: dark) { .ex-block { border-top-color: #3a352b; } }\n  .ex-head { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; }\n  .ex-name { font-weight: 700; min-width: 0; overflow-wrap: anywhere; }\n  .ex-name .note { display: block; font-weight: 400; font-size: 13px; color: #57534a; }\n  @media (prefers-color-scheme: dark) { .ex-name .note { color: #b3ab9c; } }\n  .ex-load { font-weight: 700; font-size: 17px; white-space: nowrap; font-variant-numeric: tabular-nums; }\n  .ex-load .unit { font-size: 12px; font-weight: 500; color: #57534a; }\n  .ex-delta { font-size: 13px; color: #57534a; margin-top: 2px; font-variant-numeric: tabular-nums; }\n  @media (prefers-color-scheme: dark) { .ex-delta { color: #b3ab9c; } }\n  .chart.mini { margin: 4px 0 0; }\n  #status { color: #57534a; }\n  footer { color: #57534a; font-size: 13px; margin-top: 8px; }\n  @media (prefers-color-scheme: dark) { footer, #status { color: #b3ab9c; } }\n</style>\n</head>\n<body>\n<main class=\"wrap\">\n  <header>\n    <h1>יומן אימונים</h1>\n    <p class=\"sub\">THE WORKSHOP Strength Club · שני וחמישי 08:00 · אימונים A ו־C לסירוגין</p>\n  </header>\n\n  <p id=\"status\" role=\"status\">טוען אימונים…</p>\n\n  <section id=\"last-section\" hidden>\n    <h2>האימון האחרון</h2>\n    <div class=\"card\" id=\"last-card\"></div>\n  </section>\n\n  <section id=\"next-section\" hidden>\n    <h2>האימון הבא</h2>\n    <div class=\"card\" id=\"next-card\"></div>\n  </section>\n\n  <section id=\"progress-section\" hidden>\n    <h2>התקדמות לפי תרגיל ואימון</h2>\n    <div id=\"progress\"></div>\n  </section>\n\n  <section id=\"letters-section\" hidden>\n    <h2>משקלים אחרונים לפי אימון</h2>\n    <div class=\"cards\" id=\"letters\"></div>\n  </section>\n\n  <section id=\"history-section\" hidden>\n    <h2>היסטוריה</h2>\n    <div id=\"history\"></div>\n  </section>\n\n  <footer id=\"updated\"></footer>\n</main>\n\n<script>\n// Official exercise names from THE WORKSHOP program sheet (23/11/2026).\n// Oren does only workouts A and C (no B). Stored workout data may use the\n// old Hebrew names — canonKey() normalises both to the same exercise.\n// KEY RULE: an exercise belongs to a specific workout letter. Deadlift in A\n// and Deadlift in C are DIFFERENT histories — every graph is keyed by\n// (letter, exercise), never by exercise alone.\nvar EXERCISES = {\n  'back-squat':  { name: 'Back Squat',     he: 'בק סקוואט' },\n  'pull-ups':    { name: 'Pull Ups',       he: 'פול אפס' },\n  'deadlift':    { name: 'Deadlift',       he: 'דדליפט' },\n  'dips':        { name: 'Dips',           he: 'דיפס' },\n  'goblet-squat':{ name: 'Goblet Squat',   he: 'גובלט סקוואט' },\n  'bench-press': { name: 'Bench Press',    he: 'חזה' },\n  'dar-lunges':  { name: 'D.A.R Lunges',   he: '' },\n  'double-kb-row':{ name: 'Double KB Row', he: 'חתירה' },\n  'kb-swing':    { name: 'KB Swing',       he: 'סוויפט' }\n};\n// Program order on the sheet: A first, then C (B is not done).\nvar PROGRAM_ORDER = ['back-squat', 'pull-ups', 'deadlift', 'dips', 'goblet-squat',\n                     'bench-press', 'dar-lunges', 'double-kb-row', 'kb-swing'];\nvar NAME_TO_KEY = {\n  'back squat': 'back-squat', 'בק סקוואט': 'back-squat', 'סקוואט': 'back-squat',\n  'pull ups': 'pull-ups', 'פול אפס': 'pull-ups',\n  'deadlift': 'deadlift', 'דדליפט': 'deadlift',\n  'dips': 'dips', 'דיפס': 'dips',\n  'goblet squat': 'goblet-squat', 'גובלט סקוואט': 'goblet-squat',\n  'bench press': 'bench-press', 'חזה': 'bench-press',\n  'd.a.r lunges': 'dar-lunges',\n  'double kb row': 'double-kb-row', 'חתירה': 'double-kb-row',\n  'kb swing': 'kb-swing', 'סוויפט': 'kb-swing'\n};\nfunction canonKey(name) {\n  if (!name) return null;\n  return NAME_TO_KEY[String(name).trim().toLowerCase()] || null;\n}\n// History key: letter + exercise. Same exercise name in another letter\n// is a different series.\nfunction histKey(letter, ex) {\n  var k = canonKey(ex.name);\n  if (!k) k = 'raw:' + String(ex.name).trim().toLowerCase();\n  return letter + '|' + k;\n}\nfunction displayName(ex) {\n  var k = canonKey(ex.name);\n  return k ? EXERCISES[k].name : ex.name;\n}\nfunction hebrewName(ex) {\n  var k = canonKey(ex.name);\n  return k ? EXERCISES[k].he : '';\n}\nfunction keyLabel(k) {\n  if (k.indexOf('raw:') === 0) return k.slice(4);\n  var def = EXERCISES[k];\n  return def ? def.name : k;\n}\nfunction keyHebrew(k) {\n  if (k.indexOf('raw:') === 0) return '';\n  var def = EXERCISES[k];\n  return def ? def.he : '';\n}\n\nfunction esc(s) {\n  return String(s == null ? '' : s).replace(/[&<>\"']/g, function (c) {\n    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' }[c];\n  });\n}\nfunction fmtNum(v) {\n  return String(Math.round(v * 10) / 10);\n}\nfunction fmtDate(iso) {\n  if (!iso) return '';\n  var parts = iso.split('-');\n  if (parts.length !== 3) return esc(iso);\n  return parts[2] + '/' + parts[1] + '/' + parts[0];\n}\nfunction fmtDateShort(iso) {\n  if (!iso) return '';\n  var parts = iso.split('-');\n  if (parts.length !== 3) return esc(iso);\n  return parts[2] + '/' + parts[1];\n}\nfunction weekdayHe(iso) {\n  try {\n    var d = new Date(iso + 'T12:00:00');\n    return ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'][d.getDay()];\n  } catch (e) { return ''; }\n}\nfunction loadText(ex) {\n  var bits = [];\n  if (ex.load != null && ex.load !== '') bits.push(esc(fmtNum(ex.load)) + ' <span class=\"unit\">ק״ג</span>');\n  if (ex.reps != null && ex.reps !== '') bits.push('×' + esc(fmtNum(ex.reps)));\n  if (ex.sets != null && ex.sets !== '') bits.push(esc(ex.sets) + ' סטים');\n  return bits.join(' · ') || '—';\n}\n// Numeric value of one logged exercise: load (kg) if present, else reps.\nfunction exValue(ex) {\n  if (ex.load != null && ex.load !== '') return { v: Number(ex.load), unit: 'kg' };\n  if (ex.reps != null && ex.reps !== '') return { v: Number(ex.reps), unit: 'reps' };\n  return null;\n}\nfunction unitLabel(unit) { return unit === 'kg' ? 'ק״ג' : 'חזרות'; }\nfunction chartSVG(points, opts) {\n  opts = opts || {};\n  var W = 300, H = opts.small ? 72 : 96, PL = 18, PR = 18, PT = 20, PB = 20;\n  var vals = points.map(function (p) { return p.v; });\n  var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);\n  if (min === max) { min -= 1; max += 1; }\n  var pad = (max - min) * 0.2; min -= pad; max += pad;\n  function x(i) { return points.length === 1 ? W / 2 : PL + (W - PL - PR) * (i / (points.length - 1)); }\n  function y(v) { return PT + (H - PT - PB) * (1 - (v - min) / (max - min)); }\n  // First/last labels anchor inward so \"16/11\" is not clipped at the edge.\n  function anchor(i) { return points.length === 1 ? 'middle' : (i === 0 ? 'start' : (i === points.length - 1 ? 'end' : 'middle')); }\n  var line = points.map(function (p, i) {\n    return (i === 0 ? 'M' : 'L') + x(i).toFixed(1) + ' ' + y(p.v).toFixed(1);\n  }).join(' ');\n  var dots = points.map(function (p, i) {\n    return '<circle cx=\"' + x(i).toFixed(1) + '\" cy=\"' + y(p.v).toFixed(1) + '\" r=\"4\" fill=\"#c2410c\"/>';\n  }).join('');\n  var labels = points.map(function (p, i) {\n    return '<text x=\"' + x(i).toFixed(1) + '\" y=\"' + (y(p.v) - 8).toFixed(1) + '\" text-anchor=\"' + anchor(i) + '\" font-size=\"12\" font-weight=\"700\" fill=\"currentColor\">' + esc(fmtNum(p.v)) + '</text>';\n  }).join('');\n  var dates = points.map(function (p, i) {\n    return '<text x=\"' + x(i).toFixed(1) + '\" y=\"' + (H - 6) + '\" text-anchor=\"' + anchor(i) + '\" font-size=\"11\" fill=\"currentColor\" opacity=\"0.7\">' + fmtDateShort(p.date) + '</text>';\n  }).join('');\n  return '<svg class=\"chart' + (opts.small ? ' mini' : '') + '\" direction=\"ltr\" viewBox=\"0 0 ' + W + ' ' + H + '\" width=\"100%\" role=\"img\" aria-label=\"גרף התקדמות\">' +\n    '<path d=\"' + line + '\" fill=\"none\" stroke=\"#c2410c\" stroke-width=\"2.5\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/>' +\n    dots + labels + dates + '</svg>';\n}\n// One exercise inside a workout card: name + this workout's load, then\n// the history graph of THIS exercise in THIS letter only.\nfunction exerciseBlock(ex, letter, hist) {\n  var obs = hist[histKey(letter, ex)] || [];\n  var numeric = obs.filter(function (o) { return o.val; });\n  var subs = [];\n  var he = hebrewName(ex);\n  if (he) subs.push(he);\n  if (ex.note) subs.push(ex.note);\n  var html = '<div class=\"ex-block\"><div class=\"ex-head\">' +\n    '<span class=\"ex-name\"><span dir=\"ltr\">' + esc(displayName(ex)) + '</span>' +\n    (subs.length ? '<span class=\"note\">' + subs.map(esc).join(' · ') + '</span>' : '') + '</span>' +\n    '<span class=\"ex-load\">' + loadText(ex) + '</span></div>';\n  if (numeric.length) {\n    html += chartSVG(numeric.map(function (o) { return { date: o.date, v: o.val.v }; }), { small: true });\n    if (numeric.length > 1) {\n      var first = numeric[0].val.v, lastV = numeric[numeric.length - 1].val.v;\n      var delta = Math.round((lastV - first) * 10) / 10;\n      html += '<div class=\"ex-delta\">' + esc(fmtNum(first)) + ' ← ' + esc(fmtNum(lastV)) + ' ' + esc(unitLabel(numeric[0].val.unit)) +\n        ' (' + (delta >= 0 ? '+' : '') + esc(fmtNum(delta)) + ')</div>';\n    }\n  }\n  return html + '</div>';\n}\nfunction workoutCard(w, hist, badgeText, showDate) {\n  var badge = badgeText ? '<span class=\"badge\">' + esc(badgeText) + '</span>' : '';\n  var dateLine = showDate === false ? '' :\n    '<div class=\"date\">אימון ' + esc(w.letter) + ' · ' + esc(weekdayHe(w.date)) + ' ' + fmtDate(w.date) + '</div>';\n  return badge + dateLine +\n    (w.exercises || []).map(function (ex) { return exerciseBlock(ex, w.letter, hist); }).join('');\n}\n// All logged observations grouped by (letter, exercise), oldest first.\nfunction buildHist(workouts) {\n  var h = {};\n  workouts.forEach(function (w) {\n    (w.exercises || []).forEach(function (ex) {\n      var k = histKey(w.letter, ex);\n      (h[k] = h[k] || []).push({ date: w.date, letter: w.letter, val: exValue(ex), note: ex.note || '' });\n    });\n  });\n  Object.keys(h).forEach(function (k) {\n    h[k].sort(function (a, b) { return a.date < b.date ? -1 : 1; });\n  });\n  return h;\n}\n\nasync function main() {\n  var status = document.getElementById('status');\n  var data;\n  try {\n    var res = await fetch('/api/workouts');\n    if (!res.ok) throw new Error('HTTP ' + res.status);\n    data = await res.json();\n  } catch (e) {\n    status.textContent = 'לא הצלחתי לטעון את האימונים. נסה לרענן.';\n    return;\n  }\n  var workouts = data.workouts || [];\n  if (!workouts.length) {\n    status.textContent = 'אין עדיין אימונים מתועדים. שלח אימון אחרי האימון הבא והוא יופיע כאן.';\n    return;\n  }\n  status.hidden = true;\n  var hist = buildHist(workouts);\n\n  // Last workout only, with its latest weights + per-exercise graphs.\n  var last = workouts[0];\n  document.getElementById('last-card').innerHTML = workoutCard(last, hist, null);\n  document.getElementById('last-section').hidden = false;\n\n  // Next workout: opposite letter of the newest logged workout.\n  var nextLetter = last.letter === 'A' ? 'C' : 'A';\n  var prevSame = (data.last_by_letter && data.last_by_letter[nextLetter]) || null;\n  var nextCard = document.getElementById('next-card');\n  if (prevSame) {\n    nextCard.innerHTML = '<div class=\"next-letter\">אימון ' + esc(nextLetter) + '</div>' +\n      '<p class=\"muted\">פעם קודמת — ' + esc(weekdayHe(prevSame.date)) + ' ' + fmtDate(prevSame.date) + ':</p>' +\n      workoutCard(prevSame, hist, null, false);\n  } else {\n    nextCard.innerHTML = '<div class=\"next-letter\">אימון ' + esc(nextLetter) + '</div>' +\n      '<p class=\"muted\">אין עדיין אימון ' + esc(nextLetter) + ' מתועד — זו תהיה הפעם הראשונה.</p>';\n  }\n  document.getElementById('next-section').hidden = false;\n\n  // Progress, split by (letter, exercise): Deadlift in A and Deadlift in C\n  // are separate cards with separate graphs.\n  var progEl = document.getElementById('progress');\n  ['A', 'C', 'B'].forEach(function (letter) {\n    var keys = Object.keys(hist)\n      .filter(function (k) { return k.indexOf(letter + '|') === 0; })\n      .map(function (k) { return k.slice(2); });\n    keys.sort(function (a, b) {\n      var ia = PROGRAM_ORDER.indexOf(a), ib = PROGRAM_ORDER.indexOf(b);\n      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);\n    });\n    keys.forEach(function (k) {\n      var obs = hist[letter + '|' + k];\n      var div = document.createElement('div');\n      div.className = 'card prog-card';\n      var he = keyHebrew(k);\n      var title = '<h3><span dir=\"ltr\">' + esc(keyLabel(k)) + '</span> · אימון ' + esc(letter) +\n        (he ? ' <span class=\"he\">· ' + esc(he) + '</span>' : '') + '</h3>';\n      var numeric = obs.filter(function (o) { return o.val; });\n      var html = title;\n      if (numeric.length) {\n        var unit = numeric[0].val.unit;\n        var first = numeric[0].val.v, lastV = numeric[numeric.length - 1].val.v;\n        var delta = Math.round((lastV - first) * 10) / 10;\n        html += '<p class=\"prog-line\">' + esc(fmtNum(first)) + ' ← ' + esc(fmtNum(lastV)) + ' ' + esc(unitLabel(unit)) +\n          (numeric.length > 1 ? ' <span class=\"delta\">(' + (delta >= 0 ? '+' : '') + esc(fmtNum(delta)) + ')</span>' : '') + '</p>';\n        html += chartSVG(numeric.map(function (o) { return { date: o.date, v: o.val.v }; }));\n      }\n      html += '<ul class=\"obs\">' + obs.map(function (o) {\n        var valTxt = o.val\n          ? (o.val.unit === 'kg' ? esc(fmtNum(o.val.v)) + ' ק״ג' : '×' + esc(fmtNum(o.val.v)))\n          : '—';\n        var bits = [fmtDate(o.date) + ' · אימון ' + esc(o.letter) + ' — ' + valTxt];\n        if (o.note) bits.push(esc(o.note));\n        return '<li>' + bits.join(' · ') + '</li>';\n      }).join('') + '</ul>';\n      div.innerHTML = html;\n      progEl.appendChild(div);\n    });\n  });\n  document.getElementById('progress-section').hidden = false;\n\n  // Last weights per letter, with per-exercise graphs.\n  var lettersEl = document.getElementById('letters');\n  ['A', 'C'].forEach(function (letter) {\n    var w = data.last_by_letter && data.last_by_letter[letter];\n    var div = document.createElement('div');\n    div.className = 'card letter-card';\n    div.innerHTML = w\n      ? '<h3>אימון ' + esc(letter) + '</h3><span class=\"date\">' + esc(weekdayHe(w.date)) + ' ' + fmtDate(w.date) + '</span>' +\n        workoutCard(w, hist, null, false)\n      : '<h3>אימון ' + esc(letter) + '</h3><p class=\"muted\">עדיין לא תועד.</p>';\n    lettersEl.appendChild(div);\n  });\n  document.getElementById('letters-section').hidden = false;\n\n  // Full history, newest first — each card carries its exercises' graphs.\n  var histEl = document.getElementById('history');\n  workouts.forEach(function (w) {\n    var div = document.createElement('div');\n    div.className = 'card';\n    div.innerHTML = workoutCard(w, hist, null);\n    histEl.appendChild(div);\n  });\n  document.getElementById('history-section').hidden = false;\n\n  if (data.meta && data.meta.updated) {\n    document.getElementById('updated').textContent = 'עודכן: ' + data.meta.updated;\n  }\n}\nmain();\n</script>\n</body>\n</html>\n";

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
