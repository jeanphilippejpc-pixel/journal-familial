/* Journal familial — filtres et statistiques (phase 5)
 * Tout est calculé dans le téléphone, à partir des observations déjà présentes. Rien n'est envoyé.
 * Règles importantes :
 *   - une journée SANS observation ou SANS couleur est « non évaluée » : jamais « sans difficulté » ;
 *   - chaque statistique indique le nombre d'observations utilisées (n) ;
 *   - les interventions sont présentées avec le retour au calme observé, comme une ASSOCIATION,
 *     jamais comme une cause.
 * Ce fichier fonctionne aussi dans Node (tests automatiques).
 */
(function (root) {
  'use strict';

  const VERSION = '0.5.0';
  const TYPES = { difficulte: 'Difficulté', crise: 'Crise', reussite: 'Réussite', beau_moment: 'Beau moment', autre: 'Autre' };
  const TYPE_KEYS = Object.keys(TYPES);
  const HARD = ['difficulte', 'crise'];
  const POSITIVE = ['reussite', 'beau_moment'];
  const INTENSITIES = ['vert', 'jaune', 'orange', 'rouge'];
  const INTENSITY_LABEL = { vert: 'Vert', jaune: 'Jaune', orange: 'Orange', rouge: 'Rouge', none: 'Sans intensité' };
  const DAY_CLASS_LABEL = { positive: 'Journées positives', difficile: 'Journées avec difficultés', non_evaluee: 'Journées non évaluées' };
  const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const MOMENTS = [['matin', 'Matin (5 h – 12 h)'], ['midi', 'Midi (12 h – 14 h)'], ['apres_midi', 'Après-midi (14 h – 18 h)'], ['soir', 'Soir (18 h – 22 h)'], ['nuit', 'Nuit (22 h – 5 h)']];
  const MOMENT_LABEL = Object.fromEntries(MOMENTS);

  // Thèmes d'intervention reconnus par des mots simples (règles explicables, pas d'IA)
  const THEMES = [
    ['contact', 'Contact et réconfort (bras, câlin)', /\b(bras|calin|caliner|serr|console|consoler|reconfort|bercer|berce)/],
    ['espace', 'Espace, pause ou retrait au calme', /\b(espace|laiss|retrait|retire dans|s.eloign|coin calme|pause|temps calme|isol|sa chambre|seule?\b)/],
    ['respiration', 'Respiration ou exercice de calme', /\b(respir|souffl|compter|compte jusqu|bulles?\b)/],
    ['parole', 'Parler, nommer, rassurer, écouter', /\b(expliqu|parl|nomm|mettre des mots|valid|reformul|rassur|ecout|discut|dit que|lui ai dit)/],
    ['routine', 'Routine, horaire, avertissement à l\'avance', /\b(routine|tableau|horaire|minuterie|sablier|averti|prevenu|prevenir|pictogram|calendrier)/],
    ['choix', 'Offrir un choix', /\b(choix|choisir|option)/],
    ['diversion', 'Diversion (jeu, chanson, humour)', /\b(distrai|diversion|detourn|redirig|jeux?\b|jouet|chanson|chant|humour|blague)/],
    ['accompagner', 'Accompagner, guider, aider', /\b(accompagn|guid|aid|montr|faire avec|ensemble)/],
    ['limite', 'Limite ou conséquence', /\b(limite|consequence|retir|punition|interdi|non ferme)/],
  ];
  const THEME_LABEL = Object.fromEntries(THEMES.map((t) => [t[0], t[1]]));

  // ---------- Dates (chaînes AAAA-MM-JJ, calcul en temps universel : pas d'effet de l'heure d'été) ----------
  const pad = (n) => String(n).padStart(2, '0');
  const toUTC = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const fromUTC = (t) => { const d = new Date(t); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
  const addDays = (s, n) => fromUTC(toUTC(s) + n * 864e5);
  const weekday = (s) => new Date(toUTC(s)).getUTCDay();
  const mondayOf = (s) => addDays(s, -((weekday(s) + 6) % 7));
  const monthOf = (s) => s.slice(0, 7);
  function dateRange(from, to) { const out = []; if (!from || !to || from > to) return out; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; }
  const dayCountBetween = (from, to) => (from && to && from <= to ? Math.round((toUTC(to) - toUTC(from)) / 864e5) + 1 : 0);
  const fmtDay = (s) => { const [y, m, d] = s.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
  const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const fmtDayShort = (s) => { const [, m, d] = s.split('-').map(Number); return `${d} ${MONTHS_SHORT[m - 1]}`; };
  const fmtMonth = (k) => { const [y, m] = k.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };

  // ---------- Texte ----------
  const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, "'");
  const minutes = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) && n >= 0 && String(v ?? '').trim() !== '' ? n : null; };

  // ---------- Observations ----------
  const isExample = (e) => !!(e && e.localOnly && /^\s*\[Exemple\]/.test(e.note || ''));
  const isHard = (e) => HARD.includes(e.type);
  const isPositiveEv = (e) => POSITIVE.includes(e.type);
  const SEARCH_FIELDS = ['note', 'place', 'people', 'context', 'description', 'intervention', 'helped', 'extra', 'childReaction', 'adultReaction', 'stateBefore', 'outcome', 'impressions', 'originalText'];

  function emptyFilter() {
    return { from: '', to: '', types: [], intensities: [], categories: [], places: [], authors: [], approval: 'all', todo: false, q: '', examples: true };
  }
  // Nombre de critères actifs (pour l'affichage « Filtres (3) »)
  function activeCount(f) {
    let n = 0;
    if (f.from || f.to) n++;
    for (const k of ['types', 'intensities', 'categories', 'places', 'authors']) if ((f[k] || []).length) n++;
    if (f.approval && f.approval !== 'all') n++;
    if (f.todo) n++;
    if ((f.q || '').trim()) n++;
    return n;
  }
  /* ctx : { isApproved(e), isIncomplete(e), categoryLabel(k) } — fournis par l'application */
  function matches(e, f, ctx = {}) {
    if (!e || e.deletedAt) return false;
    if (f.examples === false && isExample(e)) return false;
    if (f.from && e.date < f.from) return false;
    if (f.to && e.date > f.to) return false;
    if ((f.types || []).length && !f.types.includes(e.type || 'none')) return false;
    if ((f.intensities || []).length && !f.intensities.includes(e.intensity || 'none')) return false;
    if ((f.categories || []).length && !(e.categories || []).some((c) => f.categories.includes(c))) return false;
    if ((f.places || []).length && !f.places.some((p) => norm(p) === norm(e.place).trim())) return false;
    if ((f.authors || []).length && !f.authors.includes(e.author || '')) return false;
    if (f.approval === 'approved' && !(ctx.isApproved && ctx.isApproved(e))) return false;
    if (f.approval === 'not_approved' && ctx.isApproved && ctx.isApproved(e)) return false;
    if (f.todo && !(ctx.isIncomplete && ctx.isIncomplete(e))) return false;
    const q = norm(f.q).trim();
    if (q) {
      const hay = norm([...SEARCH_FIELDS.map((k) => e[k]), TYPES[e.type], ...(e.categories || []).map((c) => (ctx.categoryLabel ? ctx.categoryLabel(c) : c))].join(' '));
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false; // tous les mots doivent être présents
    }
    return true;
  }
  const filterEvents = (events, f, ctx) => [...events].filter((e) => matches(e, f, ctx));

  // ---------- Journées ----------
  // positive = couleur verte ; difficile = jaune, orange ou rouge ; non évaluée = aucune couleur (avec ou sans observation)
  function classifyDay(day) { if (!day || !day.rating) return 'non_evaluee'; return day.rating === 'vert' ? 'positive' : 'difficile'; }
  /* getDay(date) → journée ou null ; events : observations déjà filtrées */
  function dayBreakdown(getDay, events, from, to) {
    const withObs = new Set(events.map((e) => e.date));
    const out = { total: 0, positive: 0, difficile: 0, non_evaluee: 0, nonEvalueeAvecObs: 0, nonEvalueeSansObs: 0, byColor: { vert: 0, jaune: 0, orange: 0, rouge: 0 } };
    for (const d of dateRange(from, to)) {
      const day = getDay(d);
      const c = classifyDay(day);
      out.total++; out[c]++;
      if (c !== 'non_evaluee') out.byColor[day.rating]++;
      else if (withObs.has(d)) out.nonEvalueeAvecObs++; else out.nonEvalueeSansObs++;
    }
    return out;
  }

  // ---------- Comptes d'observations ----------
  function calmStats(events) {
    const vals = events.filter(isHard).map((e) => minutes(e.calmTime)).filter((v) => v !== null);
    if (!vals.length) return { n: 0, avg: null, median: null };
    const s = [...vals].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return { n: vals.length, avg: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10, median: s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2 };
  }
  function counts(events) {
    const byType = Object.fromEntries(TYPE_KEYS.map((k) => [k, 0])); byType.none = 0;
    const byIntensity = { vert: 0, jaune: 0, orange: 0, rouge: 0, none: 0 };
    for (const e of events) { byType[e.type || 'none'] = (byType[e.type || 'none'] || 0) + 1; if (isHard(e)) byIntensity[e.intensity || 'none']++; }
    return { n: events.length, hard: events.filter(isHard).length, intense: events.filter((e) => isHard(e) && e.intensity === 'rouge').length, positive: events.filter(isPositiveEv).length, byType, byIntensity };
  }

  // ---------- Tendances par semaine ou par mois ----------
  function trends(getDay, events, from, to, unit = 'week') {
    const buckets = [];
    if (!from || !to || from > to) return buckets;
    let start = unit === 'month' ? `${monthOf(from)}-01` : mondayOf(from);
    while (start <= to) {
      const next = unit === 'month' ? (() => { const [y, m] = start.split('-').map(Number); return m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`; })() : addDays(start, 7);
      const bFrom = start < from ? from : start;
      const end = addDays(next, -1);
      const bTo = end > to ? to : end;
      const evs = events.filter((e) => e.date >= bFrom && e.date <= bTo);
      buckets.push({
        key: unit === 'month' ? monthOf(start) : start, unit,
        label: unit === 'month' ? fmtMonth(monthOf(start)) : `Semaine du ${fmtDayShort(start)}`,
        from: bFrom, to: bTo, partial: bFrom !== start || bTo !== end,
        days: dayBreakdown(getDay, evs, bFrom, bTo), ...counts(evs), calm: calmStats(evs),
      });
      start = next;
    }
    return buckets;
  }

  // ---------- Fréquences ----------
  function rank(map) { return Object.entries(map).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([key, count]) => ({ key, count })); }
  function topCategories(events) {
    const m = {};
    for (const e of events) for (const c of e.categories || []) m[c] = (m[c] || 0) + 1;
    return { n: events.length, withCategory: events.filter((e) => (e.categories || []).length).length, items: rank(m) };
  }
  function momentOf(time) {
    if (!/^\d{1,2}:\d{2}/.test(time || '')) return null;
    const h = Number(time.split(':')[0]);
    if (h >= 5 && h < 12) return 'matin';
    if (h >= 12 && h < 14) return 'midi';
    if (h >= 14 && h < 18) return 'apres_midi';
    if (h >= 18 && h < 22) return 'soir';
    return 'nuit';
  }
  // Contextes des difficultés et crises : endroit, moment de la journée, jour de la semaine
  function contexts(events) {
    const hard = events.filter(isHard);
    const places = {}; const moments = {}; const days = {};
    for (const e of hard) {
      const p = String(e.place || '').trim(); if (p) places[p] = (places[p] || 0) + 1;
      const mo = momentOf(e.time); if (mo) moments[mo] = (moments[mo] || 0) + 1;
      if (e.date) { const w = WEEKDAYS[weekday(e.date)]; days[w] = (days[w] || 0) + 1; }
    }
    return {
      n: hard.length,
      places: { n: hard.filter((e) => String(e.place || '').trim()).length, items: rank(places) },
      moments: { n: hard.filter((e) => momentOf(e.time)).length, items: rank(moments).map((x) => ({ ...x, label: MOMENT_LABEL[x.key] })) },
      weekdays: { n: hard.length, items: rank(days) },
    };
  }

  // ---------- Interventions et retour au calme (association observée, pas une cause) ----------
  function themesOf(text) { const t = norm(text); return t.trim() ? THEMES.filter(([, , re]) => re.test(t)).map(([k]) => k) : []; }
  function interventions(events) {
    const hard = events.filter(isHard);
    const withText = hard.filter((e) => String(e.intervention || '').trim() || String(e.helped || '').trim());
    const overall = calmStats(hard);
    const per = {};
    for (const e of withText) {
      for (const k of themesOf(`${e.intervention || ''} ${e.helped || ''}`)) {
        const p = per[k] || (per[k] = { key: k, label: THEME_LABEL[k], n: 0, calm: [] });
        p.n++;
        const m = minutes(e.calmTime); if (m !== null) p.calm.push(m);
      }
    }
    const items = Object.values(per).map((p) => ({ key: p.key, label: p.label, n: p.n, calmN: p.calm.length, calmAvg: p.calm.length ? Math.round((p.calm.reduce((a, b) => a + b, 0) / p.calm.length) * 10) / 10 : null }));
    // Classement : retour au calme moyen le plus court, seulement avec au moins 2 durées notées
    const ranked = items.filter((i) => i.calmN >= 2).sort((a, b) => a.calmAvg - b.calmAvg || b.n - a.n);
    const others = items.filter((i) => i.calmN < 2).sort((a, b) => b.n - a.n);
    return { n: hard.length, withIntervention: withText.length, unrecognized: withText.filter((e) => !themesOf(`${e.intervention || ''} ${e.helped || ''}`).length).length, overallCalm: overall, ranked, others };
  }

  // ---------- Résumé complet d'une sélection ----------
  function summarize(getDay, events, from, to) {
    return {
      from, to, days: dayBreakdown(getDay, events, from, to), ...counts(events), calm: calmStats(events),
      categories: topCategories(events), contexts: contexts(events), interventions: interventions(events),
      weeks: trends(getDay, events, from, to, 'week'), months: trends(getDay, events, from, to, 'month'),
      examples: events.filter(isExample).length,
    };
  }
  // Période précédente de même longueur (pour comparer)
  function previousPeriod(from, to) { const n = dayCountBetween(from, to); return { from: addDays(from, -n), to: addDays(from, -1) }; }

  const api = {
    VERSION, TYPES, TYPE_KEYS, HARD, POSITIVE, INTENSITIES, INTENSITY_LABEL, DAY_CLASS_LABEL, MONTHS, WEEKDAYS, MOMENTS, MOMENT_LABEL, THEMES, THEME_LABEL,
    pad, addDays, mondayOf, monthOf, dateRange, dayCountBetween, fmtDay, fmtDayShort, fmtMonth, norm, minutes,
    isExample, isHard, isPositive: isPositiveEv, emptyFilter, activeCount, matches, filterEvents,
    classifyDay, dayBreakdown, calmStats, counts, trends, topCategories, momentOf, contexts, themesOf, interventions, summarize, previousPeriod,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JFStats = api;
})(typeof window !== 'undefined' ? window : globalThis);
