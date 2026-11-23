/* Journal familial — rapport pour les professionnels (phase 5)
 * Produit le rapport en HTML, dans le téléphone. L'impression (ou « Enregistrer au format PDF »)
 * est faite par le téléphone lui-même : rien n'est envoyé, rien n'est enregistré par l'application.
 * Principes :
 *   - par défaut, seulement les observations approuvées ; les autres, si on les inclut, sont marquées ;
 *   - les FAITS observés et les IMPRESSIONS des parents sont dans des sections séparées ;
 *   - les renseignements personnels peuvent être masqués (prénom, parents, personnes présentes) ;
 *   - le nombre d'observations utilisées est toujours indiqué ;
 *   - une journée non évaluée n'est jamais comptée comme une journée sans difficulté.
 * Ce fichier fonctionne aussi dans Node (tests automatiques).
 */
(function (root) {
  'use strict';

  const VERSION = '0.5.0';
  const St = (typeof module !== 'undefined' && module.exports) ? require('./stats.js') : root.JFStats;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (x) => String(x).replace('.', ',');
  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)} %` : '—');
  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
  const COLOR = { positive: '#2E8B57', difficile: '#D9782F', non_evaluee: '#D5D8E2', vert: '#2E8B57', jaune: '#C9A227', orange: '#D9782F', rouge: '#B3261E' };
  const DISCLAIMER = 'Document d\'observation rédigé par les parents. Il ne constitue pas un diagnostic. Les statistiques ne portent que sur les observations notées ; une journée sans observation n\'est pas une journée sans difficulté.';
  const FACT_FIELDS = [
    ['context', 'Contexte'], ['description', 'Ce qui s\'est passé'], ['childReaction', 'Réaction de l\'enfant'],
    ['intervention', 'Intervention du parent'], ['adultReaction', 'Réaction des adultes'], ['outcome', 'Résultat observé'],
    ['stateBefore', 'État apparent avant'], ['extra', 'Notes supplémentaires'],
  ];

  // ---------- Masquage des renseignements personnels ----------
  function masker(opts) {
    const name = String(opts.childName || '').trim();
    if (!opts.hideIdentity || !name) return (s) => String(s ?? '');
    const pattern = new RegExp(`(?<![\\p{L}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'giu');
    return (s) => String(s ?? '').replace(pattern, '[l\'enfant]');
  }

  // ---------- Graphique des journées (SVG, attributs seulement : compatible avec la politique de sécurité) ----------
  function dayChart(buckets, W = 640) {
    if (!buckets.length) return '';
    const H = 128; const fs = W < 500 ? 11 : 10; const top = 8; const base = 98;
    const slot = W / buckets.length; const bw = Math.max(6, Math.min(34, slot * 0.62));
    let bars = '';
    buckets.forEach((b, i) => {
      const x = Math.round(i * slot + (slot - bw) / 2);
      const total = b.days.total || 1; let y = base;
      for (const k of ['difficile', 'positive', 'non_evaluee']) {
        const h = Math.round(((base - top) * b.days[k]) / total);
        if (h > 0) { y -= h; bars += `<rect x="${x}" y="${y}" width="${Math.round(bw)}" height="${h}" fill="${COLOR[k]}"/>`; }
      }
      const lab = b.unit === 'month' ? St.fmtMonth(b.key).replace(/^(\S+) (\d{2})(\d{2})$/, (x, mo, c, yy) => `${mo.length > 4 ? mo.slice(0, 4) + '.' : mo} ${yy}`) : St.fmtDayShort(b.from);
      if (buckets.length <= (W < 500 ? 8 : 16) || i % Math.ceil(buckets.length / (W < 500 ? 8 : 16)) === 0) bars += `<text x="${Math.round(i * slot + slot / 2)}" y="${base + 14}" font-size="${fs}" text-anchor="middle" fill="#5F6478">${esc(lab)}</text>`;
    });
    const legend = [['positive', 'Positives (vert)'], ['difficile', 'Avec difficultés'], ['non_evaluee', 'Non évaluées']]
      .map(([k, l], i) => `<rect x="${Math.round((i * W) / 3)}" y="${H - 10}" width="10" height="10" fill="${COLOR[k]}"/><text x="${Math.round((i * W) / 3) + 14}" y="${H - 1}" font-size="${fs}" fill="#23263A">${esc(l)}</text>`).join('');
    return `<svg class="rpt-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Journées par ${buckets[0].unit === 'month' ? 'mois' : 'semaine'} : positives, avec difficultés et non évaluées">${bars}<line x1="0" y1="${base}" x2="${W}" y2="${base}" stroke="#D9DCE6"/>${legend}</svg>`;
  }

  function daysTable(d) {
    const ne = `Non évaluées${d.non_evaluee ? ` <span class="rpt-muted">(${d.nonEvalueeAvecObs} avec au moins une observation retenue, ${d.nonEvalueeSansObs} sans observation retenue)</span>` : ''}`;
    return `<table class="rpt-t"><tbody>
      <tr><th>Journées positives (vert)</th><td>${d.positive}</td><td>${pct(d.positive, d.total)}</td></tr>
      <tr><th>Journées avec difficultés <span class="rpt-muted">(jaune ${d.byColor.jaune}, orange ${d.byColor.orange}, rouge ${d.byColor.rouge})</span></th><td>${d.difficile}</td><td>${pct(d.difficile, d.total)}</td></tr>
      <tr><th>${ne}</th><td>${d.non_evaluee}</td><td>${pct(d.non_evaluee, d.total)}</td></tr>
      <tr class="rpt-sum"><th>Total de la période</th><td>${d.total}</td><td></td></tr></tbody></table>`;
  }
  const calmText = (c) => (c.n ? `${num(c.avg)} min en moyenne (médiane ${num(c.median)} min), ${plural(c.n, 'durée notée', 'durées notées')}` : 'aucune durée notée');

  function compareLine(cur, prev) {
    if (!prev) return '';
    const diff = (a, b) => (a === b ? 'stable' : a > b ? `+${a - b}` : `−${b - a}`);
    return `<p class="rpt-small">Comparaison avec la période précédente de même durée (du ${esc(St.fmtDay(prev.from))} au ${esc(St.fmtDay(prev.to))}, ${plural(prev.n, 'observation', 'observations')}) : difficultés et crises ${cur.hard} contre ${prev.hard} (${diff(cur.hard, prev.hard)}) ; journées positives ${cur.days.positive} contre ${prev.days.positive} (${diff(cur.days.positive, prev.days.positive)}) ; journées non évaluées ${cur.days.non_evaluee} contre ${prev.days.non_evaluee}. À interpréter avec prudence : le nombre d'observations notées peut varier d'une période à l'autre.</p>`;
  }

  function freqList(items, n, labelOf, max = 4) {
    if (!items.length) return '<p class="rpt-muted">Aucune donnée.</p>';
    return `<ul class="rpt-list">${items.slice(0, max).map((x) => `<li>${esc(labelOf(x))} : ${x.count} <span class="rpt-muted">(${pct(x.count, n)})</span></li>`).join('')}</ul>`;
  }

  function interventionBlock(iv, max = 3) {
    const head = `<p class="rpt-small">Parmi ${plural(iv.n, 'difficulté ou crise', 'difficultés et crises')}, ${iv.withIntervention} ${iv.withIntervention > 1 ? 'décrivent' : 'décrit'} une intervention. Retour au calme pour l'ensemble : ${esc(calmText(iv.overallCalm))}.</p>`;
    const rows = iv.ranked.slice(0, max).map((t) => `<tr><th>${esc(t.label)}</th><td>${t.n}</td><td>${num(t.calmAvg)} min <span class="rpt-muted">(${t.calmN} durées)</span></td></tr>`).join('');
    const table = rows ? `<table class="rpt-t"><thead><tr><th>Intervention notée</th><th>Fiches</th><th>Retour au calme moyen</th></tr></thead><tbody>${rows}</tbody></table>`
      : '<p class="rpt-muted">Pas assez de durées de retour au calme notées pour comparer les interventions (au moins 2 par intervention).</p>';
    return `${head}${table}<p class="rpt-note">Ces chiffres montrent ce qui a été observé en même temps, pas une relation de cause à effet. D'autres facteurs (fatigue, contexte, intensité de départ) peuvent jouer.</p>`;
  }

  function trendTable(buckets) {
    if (!buckets.length) return '';
    return `<table class="rpt-t rpt-trend"><thead><tr><th>Période</th><th>Obs.</th><th>Diff. et crises</th><th>Dont rouges</th><th>Réussites</th><th>J. positives</th><th>J. difficiles</th><th>J. non évaluées</th><th>Calme moyen (n)</th></tr></thead><tbody>${
      buckets.map((b) => `<tr><th>${esc(b.label)}${b.partial ? '*' : ''}</th><td>${b.n}</td><td>${b.hard}</td><td>${b.intense}</td><td>${b.positive}</td><td>${b.days.positive}</td><td>${b.days.difficile}</td><td>${b.days.non_evaluee}</td><td>${b.calm.n ? `${num(b.calm.avg)} min (${b.calm.n})` : '—'}</td></tr>`).join('')
    }</tbody></table>${buckets.some((b) => b.partial) ? '<p class="rpt-small">* Période incomplète (début ou fin de la sélection).</p>' : ''}`;
  }

  // ---------- Construction du rapport ----------
  /* opts : { kind: 'summary' | 'detailed', events (déjà sélectionnés), getDay, from, to,
   *          prev: { from, to, events } | null, includeImpressions, includeOriginal, hideIdentity,
   *          childName, isApproved(e), approvalText(e), generatedAt (ISO), criteria: [texte], categoryLabel(k) } */
  function build(opts) {
    const m = masker(opts);
    const evs = [...opts.events].sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
    const sum = St.summarize(opts.getDay, evs, opts.from, opts.to);
    const prev = opts.prev ? { from: opts.prev.from, to: opts.prev.to, ...St.counts(opts.prev.events), days: St.dayBreakdown(opts.getDay, opts.prev.events, opts.prev.from, opts.prev.to) } : null;
    const nApproved = evs.filter((e) => opts.isApproved(e)).length;
    const notApproved = evs.length - nApproved;
    const catLabel = (k) => (opts.categoryLabel ? opts.categoryLabel(k) : k);
    const nameLine = opts.hideIdentity ? 'Renseignements personnels masqués' : (String(opts.childName || '').trim() ? `Enfant : ${esc(opts.childName.trim())}` : '');
    const created = new Date(opts.generatedAt || Date.now());
    const createdTxt = `${created.getDate()} ${St.MONTHS[created.getMonth()]} ${created.getFullYear()}`;
    const buckets = sum.weeks.length <= 16 ? sum.weeks : sum.months;

    const head = `<header class="rpt-head"><h1>${opts.kind === 'detailed' ? 'Rapport d\'observation' : 'Résumé des observations'}</h1>
      <p>${nameLine ? `${nameLine} · ` : ''}Période : du ${esc(St.fmtDay(opts.from))} au ${esc(St.fmtDay(opts.to))} (${plural(sum.days.total, 'jour', 'jours')}) · Préparé par les parents · Créé le ${esc(createdTxt)}</p></header>
      <p class="rpt-scope"><strong>Basé sur ${plural(evs.length, 'observation', 'observations')}</strong>${notApproved ? ` (${nApproved} approuvée${nApproved > 1 ? 's' : ''} et <strong>${notApproved} non approuvée${notApproved > 1 ? 's' : ''}</strong>, marquée${notApproved > 1 ? 's' : ''} comme telle${notApproved > 1 ? 's' : ''})` : evs.length ? ', toutes approuvées par un parent' : ''}.${(opts.criteria || []).length ? ` Sélection : ${esc(opts.criteria.join(' ; '))}.` : ''}</p>`;

    // Page 1 : résumé synthétique (aucune impression des parents ici)
    const page1 = `<section class="rpt-page rpt-summary">${head}
      <h2>Journées</h2>
      <div class="rpt-cols"><div>${daysTable(sum.days)}</div><div>${dayChart(buckets)}</div></div>
      <p class="rpt-note">Une journée « non évaluée » n'a pas reçu de couleur : ce n'est pas une journée sans difficulté.</p>
      <h2>Observations notées</h2>
      <table class="rpt-t"><tbody>
        <tr><th>Difficultés et crises</th><td>${sum.hard}</td><td class="rpt-muted">dont ${sum.intense} d'intensité rouge, ${sum.byIntensity.orange} orange, ${sum.byIntensity.jaune} jaune${sum.byIntensity.none ? `, ${sum.byIntensity.none} sans intensité` : ''}</td></tr>
        <tr><th>Réussites et beaux moments</th><td>${sum.positive}</td><td></td></tr>
        <tr><th>Autres</th><td>${sum.n - sum.hard - sum.positive}</td><td></td></tr>
        <tr><th>Retour au calme (difficultés et crises)</th><td colspan="2">${esc(calmText(sum.calm))}</td></tr></tbody></table>
      ${compareLine(sum, prev)}
      <div class="rpt-cols">
        <div><h2>Catégories les plus fréquentes</h2><p class="rpt-small">Sur ${plural(sum.categories.n, 'observation', 'observations')} (${sum.categories.withCategory} avec au moins une catégorie).</p>${freqList(sum.categories.items, sum.categories.n, (x) => catLabel(x.key))}</div>
        <div><h2>Contextes des difficultés</h2><p class="rpt-small">Sur ${plural(sum.contexts.n, 'difficulté ou crise', 'difficultés et crises')}.</p>
          <p class="rpt-small rpt-sub">Endroits (${sum.contexts.places.n} précisés)</p>${freqList(sum.contexts.places.items, sum.contexts.n, (x) => x.key, 3)}
          <p class="rpt-small rpt-sub">Moments de la journée (${sum.contexts.moments.n} avec l'heure)</p>${freqList(sum.contexts.moments.items, sum.contexts.n, (x) => x.label, 3)}</div>
      </div>
      <h2>Interventions et retour au calme</h2>${interventionBlock(sum.interventions)}
      <p class="rpt-foot">${esc(DISCLAIMER)}</p></section>`;
    if (opts.kind !== 'detailed') return `<article class="rpt">${page1}</article>`;

    // Rapport détaillé : tendances, puis les faits, puis (si demandé) les impressions, puis (si demandé) les textes originaux
    const trendsPage = `<section class="rpt-page"><h2>Tendances par semaine</h2>${trendTable(sum.weeks)}
      <h2>Tendances par mois</h2>${trendTable(sum.months)}
      <h2>Contextes : jours de la semaine</h2><p class="rpt-small">Sur ${plural(sum.contexts.n, 'difficulté ou crise', 'difficultés et crises')}.</p>${freqList(sum.contexts.weekdays.items, sum.contexts.n, (x) => x.key, 7)}
      <h2>Interventions notées (toutes)</h2>${[...sum.interventions.ranked, ...sum.interventions.others].length ? `<ul class="rpt-list">${[...sum.interventions.ranked, ...sum.interventions.others].map((t) => `<li>${esc(t.label)} : ${plural(t.n, 'fiche', 'fiches')}${t.calmN ? `, retour au calme moyen ${num(t.calmAvg)} min (${t.calmN} durées)` : ', aucune durée de retour au calme notée'}</li>`).join('')}</ul>` : '<p class="rpt-muted">Aucune intervention reconnue.</p>'}
      ${sum.interventions.unrecognized ? `<p class="rpt-small">${plural(sum.interventions.unrecognized, 'intervention décrite n\'entre', 'interventions décrites n\'entrent')} dans aucun thème : elles figurent telles quelles dans les observations détaillées.</p>` : ''}
      <p class="rpt-note">Association observée, pas une relation de cause à effet.</p></section>`;

    const facts = evs.map((e) => {
      const meta = [e.time ? e.time.replace(':', ' h ') : '', e.type ? St.TYPES[e.type] : 'Événement', St.isHard(e) && e.intensity ? `intensité ${St.INTENSITY_LABEL[e.intensity].toLowerCase()}` : ''].filter(Boolean).join(' · ');
      const rows = [];
      if (String(e.place || '').trim()) rows.push(['Endroit', e.place]);
      if (!opts.hideIdentity && String(e.people || '').trim()) rows.push(['Personnes présentes', e.people]);
      if (St.minutes(e.duration) !== null) rows.push(['Durée approximative', `${e.duration} min`]);
      if (St.minutes(e.calmTime) !== null) rows.push(['Retour au calme', `${e.calmTime} min`]);
      const structured = FACT_FIELDS.filter(([k]) => String(e[k] || '').trim());
      if (!structured.length || (String(e.note || '').trim() && !String(e.description || '').trim())) { if (String(e.note || '').trim()) rows.push(['Note', e.note]); }
      for (const [k, l] of structured) rows.push([l, e[k]]);
      if ((e.categories || []).length) rows.push(['Catégories', e.categories.map(catLabel).join(', ')]);
      const approved = opts.isApproved(e);
      const status = approved ? (opts.approvalText ? opts.approvalText(e, opts.hideIdentity) : 'Approuvée') : 'NON APPROUVÉE — à lire comme une note de travail';
      return `<div class="rpt-ob${approved ? '' : ' rpt-unapproved'}"><h3>${esc(St.fmtDay(e.date))}${meta ? ` · ${esc(meta)}` : ''}</h3>
        <dl>${rows.map(([l, v]) => `<dt>${esc(l)}</dt><dd>${esc(m(v))}</dd>`).join('')}</dl>
        <p class="rpt-status">${esc(status)}${!opts.hideIdentity && e.author ? ` · Notée par ${esc(e.author)}` : ''}</p></div>`;
    }).join('');
    const factsSec = `<section class="rpt-obs"><h2>Observations détaillées — faits observés</h2><p class="rpt-small">${plural(evs.length, 'observation', 'observations')}, en ordre chronologique. Cette partie ne contient que les faits décrits par les parents ; leurs impressions sont ${opts.includeImpressions ? 'regroupées dans la section suivante' : 'exclues de ce rapport'}.</p>${facts || '<p class="rpt-muted">Aucune observation pour cette sélection.</p>'}</section>`;

    let impSec = '';
    if (opts.includeImpressions) {
      const items = evs.filter((e) => String(e.impressions || '').trim() || String(e.helped || '').trim());
      impSec = `<section class="rpt-imp"><h2>Impressions des parents</h2><p class="rpt-note">Interprétations, suppositions et ressentis des parents. Ce ne sont pas des faits observés.</p>${
        items.length ? items.map((e) => `<div class="rpt-ob"><h3>${esc(St.fmtDay(e.date))}${e.time ? ` · ${esc(e.time.replace(':', ' h '))}` : ''}${opts.isApproved(e) ? '' : ' · NON APPROUVÉE'}</h3><dl>${String(e.impressions || '').trim() ? `<dt>Impressions du parent</dt><dd>${esc(m(e.impressions))}</dd>` : ''}${String(e.helped || '').trim() ? `<dt>Ce qui semble avoir aidé (appréciation du parent)</dt><dd>${esc(m(e.helped))}</dd>` : ''}</dl></div>`).join('') : '<p class="rpt-muted">Aucune impression notée pour cette sélection.</p>'}</section>`;
    }
    let origSec = '';
    if (opts.includeOriginal) {
      const items = evs.filter((e) => String(e.originalText || '').trim());
      origSec = `<section class="rpt-orig"><h2>Annexe — textes originaux dictés ou tapés</h2><p class="rpt-note">Récits bruts, tels que les parents les ont dictés : faits et impressions peuvent y être mêlés. Les sections ci-dessus en sont la version organisée et approuvée.</p>${
        items.length ? items.map((e) => `<div class="rpt-ob"><h3>${esc(St.fmtDay(e.date))}${e.time ? ` · ${esc(e.time.replace(':', ' h '))}` : ''}</h3><p class="rpt-original">${esc(m(e.originalText))}</p></div>`).join('') : '<p class="rpt-muted">Aucun texte original pour cette sélection.</p>'}</section>`;
    }
    return `<article class="rpt">${page1}${trendsPage}${factsSec}${impSec}${origSec}<p class="rpt-foot">${esc(DISCLAIMER)}</p></article>`;
  }

  // Blocs réutilisés par l'écran « Évolution » (mêmes calculs, même présentation)
  const api = { VERSION, build, DISCLAIMER, dayChart, daysTable, trendTable, interventionBlock, freqList, calmText, esc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JFReport = api;
})(typeof window !== 'undefined' ? window : globalThis);
