/* Journal familial — organisation locale d'une observation (phase 4)
 * Aucune intelligence artificielle, aucun envoi : des règles explicables, exécutées dans le téléphone.
 * Principe : l'application RÉORGANISE les phrases du parent dans des sections ; elle ne les reformule pas.
 * Seul un nettoyage mécanique est fait (« euh », mots de liaison en début de phrase, majuscule, point final).
 * Le texte original n'est jamais modifié. Ce fichier fonctionne aussi dans Node (tests automatiques).
 */
(function (root) {
  'use strict';

  const SECTIONS = [
    ['context', 'Contexte', 'Où et quand la situation s\'est produite'],
    ['description', 'Ce qui s\'est passé', 'Les faits observés'],
    ['childReaction', 'Réaction de l\'enfant', 'Ses paroles, gestes ou comportements'],
    ['intervention', 'Intervention du parent', 'Ce que Papa ou Maman a fait'],
    ['outcome', 'Résultat observé', 'Comment la situation s\'est terminée'],
    ['impressions', 'Impressions du parent', 'Ce que le parent pense ou suppose (pas un fait observé)'],
  ];
  const SECTION_KEYS = SECTIONS.map((s) => s[0]);
  const SECTION_LABEL = Object.fromEntries(SECTIONS.map((s) => [s[0], s[1]]));

  const CATEGORIES = [
    ['emotions', 'Émotions et autorégulation'],
    ['comportements', 'Comportements'],
    ['social', 'Relations sociales'],
    ['autonomie', 'Autonomie'],
    ['communication', 'Communication'],
    ['sommeil', 'Sommeil et routines'],
    ['apprentissages', 'Apprentissages'],
    ['reussites', 'Réussites et progrès'],
  ];
  const CATEGORY_KEYS = CATEGORIES.map((c) => c[0]);
  const CATEGORY_LABEL = Object.fromEntries(CATEGORIES);

  // Frontières de mots qui fonctionnent avec les lettres accentuées
  const L = '\\p{L}';
  const W = (src) => new RegExp(`(?<![${L}'’])(?:${src})(?![${L}])`, 'iu');
  const WS = (src) => new RegExp(`(?<![${L}'’])(?:${src})`, 'iu'); // début de mot (radical)

  // ---------- Règles de classement (dans l'ordre de priorité) ----------
  const R = {
    impression: W("je pense|je crois|j'ai l'impression|on dirait|j'imagine|je suppose|je trouve|selon moi|je me demande|sans doute|sûrement|surement|probablement|peut-être|peut être|il semblait|elle semblait|semblait|avait l'air|a eu l'air|a l'air|comme s'il|comme si elle|parce qu'il était|parce qu'elle était|je sentais"),
    innerState: W("(?:il|elle) (?:était|étais|est) (?:fatiguée?|fâchée?|triste|anxieuse?|anxieux|nerveuse?|nerveux|excitée?|frustrée?|contente?|heureuse?|heureux|stressée?|inquiète?|inquiet|jalouse?|jaloux|déçue?|tannée?|à boutte|à bout|en colère|de mauvaise humeur|de bonne humeur)"),
    outcome: W("finalement|à la fin|au final|en fin de compte|ça s'est (?:bien |mal )?(?:terminé|fini|réglé|calmé)|ça a fini|ça a pris \\d+ minutes?|s'est calmée?|s'est apaisée?|s'est endormie?|a retrouvé son calme|est revenue? au calme|revenue? au calme|a fini par|tout est rentré dans l'ordre|tout s'est replacé|on a pu (?:partir|repartir|continuer|souper|manger|terminer)|c'était réglé|s'est excusée?|est allée? se coucher sans|a accepté (?:de|d['’]\\p{L}+)"),
    perception: W("j'ai (?:vu|remarqué|entendu|constaté|observé|noté|aperçu)|on a (?:vu|remarqué|entendu|constaté)|je l'ai (?:vu|vue|entendu|entendue|trouvé|trouvée)"),
    contextStart: W("ce matin|ce midi|cet après-midi|ce soir|cette nuit|hier(?: soir| matin)?|avant-hier|aujourd'hui|au (?:déjeuner|dîner|diner|souper|coucher|lever|réveil|bain|parc|magasin|restaurant|service de garde|retour|centre d'achat|cinéma)|à l'heure du (?:souper|dîner|coucher|bain)|à l'école|à la garderie|à la maison|à l'épicerie|dans l'auto|dans la voiture|dans l'autobus|en auto|en voiture|chez (?:grand-maman|grand-papa|mamie|papi|ses grands-parents|sa tante|son oncle|ses cousins|des amis|le dentiste|le médecin)|pendant (?:le|la|les|l')|vers \\d+|à \\d+ ?h|après l'école|après la garderie|avant (?:le|la|l') (?:souper|dîner|coucher|école|garderie|bain|départ)|en (?:revenant|partant|arrivant)|au moment de"),
    contextOnly: W("on était|nous étions|j'étais|c'était (?:le|la|au|à|pendant|après|avant|un|une)|on revenait|on s'en allait|on partait|on arrivait|on se préparait|on soupait|on mangeait|on finissait|on sortait|il était (?:\\d+|tard|tôt|midi)|il faisait"),
    parentSubject: /^(?:je |j['’]|on |nous |moi |papa |maman |mon conjoint |ma conjointe |sa mère |son père )/iu,
    childSubject: /^(?:il |elle |il s['’]|elle s['’]|il l['’]|elle l['’]|il m['’]|elle m['’]|il n['’]|elle n['’]|mon (?:fils|garçon|grand|petit|gars) |ma (?:fille|grande|petite|cocotte) |notre (?:fils|fille|garçon|grand|grande) |le petit |la petite |l['’]enfant )/iu,
    childReaction: WS("cri|hurl|pleur|frapp|tap|mord|lanc|pouss|griff|crach|claqu|bott|cass|jet|cour[ur]|enfui|sauv|cach|refus|boud|rouss|répon|dit|demand|expliqu|chant|souri|ri[ts]?(?![\\p{L}])|ri |rigol|accept|obéi|écout|serr|calm|respir|s'est (?:mis|mise|roulé|roulée|fâché|fâchée|couché|couchée|levé|levée|assis|assise|enfermé|enfermée)|s'est fâch|se roul|a fait (?:une crise|un câlin|un dessin|ses devoirs)|n'a pas voulu|ne voulait pas|voulait pas|veut pas|a voulu|a décidé|a commencé à|s'est mis à|s'est mise à|a réussi|a partagé|a prêté|a aidé|a ramassé|a rangé|est parti|est partie|est venu|est venue|est revenu|est revenue"),
    quote: /[«“"]/u,
  };
  // Mots de liaison retirés en début de phrase (ils n'ajoutent pas d'information une fois classés)
  const LEADING = /^(?:(?:et puis|et là|pis là|pis|puis|et|là|bon|ben|fait que|faque|donc|mais là)[\s,]+)+/iu;
  const FILLERS = /(?<![\p{L}])(?:euh+|heu+|hum+|hmm+|euhm)(?![\p{L}])[,.]?\s*/giu;
  // Liaisons parlées qui commencent souvent une nouvelle phrase dans une dictée sans ponctuation
  const SPOKEN_BREAK = /\s+(?=(?:et là|pis là|pis|et puis|ensuite|après ça|après|finalement|à la fin|au final|fait que|faque|alors|mais là|tout à coup|soudain|quand je|quand on|quand il|quand elle)\s)|(?<!(?:^|[\s,])(?:que|qu['’]|quand|lorsque|si|où|comme|pendant que|parce que|avant que|et|pis|puis|là|finalement|ensuite|alors|après|faque|ça|mais))\s+(?=(?:je suis|je me suis|je l['’]ai|je lui ai|je les ai|j['’]ai|on a|on est|nous avons)\s)/giu;

  // Mots signalés : jugements ou termes de diagnostic (signalés seulement, jamais réécrits)
  const FLAGS = [
    [W("capricieuse?|capricieux|méchante?|manipulatrice|manipulateur|manipule|paresseuse?|paresseux|gâtée?|insupportable|impossible|tannante?|malcommode|bébé lala|niaiseux|niaiseuse|exprès|par exprès|pour nous provoquer|pour me provoquer|pour attirer l'attention|il fait toujours|elle fait toujours|il fait jamais|elle fait jamais|toujours pareil"), 'jugement', 'Décrivez plutôt ce qui a été vu ou entendu (ce qu\'il a fait ou dit, combien de temps).'],
    [W("tdah|tda|autiste|autisme|tsa|tdl|trouble|troubles|opposition|oppositionnel|oppositionnelle|hyperactive?|hyperactif|bipolaire|dépressive?|dépressif|dyslexique|dyspraxique|anxiété généralisée|douance|surdouée?|surdoué"), 'diagnostic', 'Ce journal décrit des observations ; il n\'établit aucun diagnostic. Décrivez le comportement observé.'],
  ];

  // Catégories : mots repérés dans le récit (la raison affichée liste les mots trouvés)
  const CAT_RULES = {
    emotions: WS("colère|fâch|frustr|pleur|hurl|cri[aé]|cris |crise|calm|peur|triste|anxi|inquiet|inquièt|nerveu|énerv|excit|respir|apais|consol|émotion|sanglot|panique|tann|à boutte|à bout"),
    comportements: WS("frapp|tap[aée]|mord|lanc|pouss|griff|crach|claqu|bott|cass|jet[aée]|refus|désobé|s'est roulé|se roul|enfui|sauvé|interdit|conséquence|retrait|a lancé|a frappé|bris"),
    social: WS("ami|amie|amis|copain|copine|frère|soeur|sœur|cousin|cousine|partag|prêt[ée]|jouer avec|a joué avec|camarade|enfants|chicane|groupe|voisin|grand-maman|grand-papa|mamie|papi|éducatrice|enseignante|professeur|prof "),
    autonomie: WS("habill|tout seul|toute seule|seul |seule |s'habill|brosser|dents|toilette|ranger|rangé|lacer|attacher|préparer son|son sac|mangé seul|sans aide|lui-même|elle-même|boutonn|zipp|aller aux toilettes|propre"),
    communication: WS("a dit|m'a dit|nous a dit|a demandé|m'a demandé|a expliqué|a répondu|ses mots|avec des mots|a nommé|a exprimé|parlé|parler|phrase|mots|«|“|demande de l'aide|a raconté|a chuchoté|a chanté"),
    sommeil: WS("dodo|coucher|couché|dormi|dormir|endorm|nuit|sieste|réveil|lever|routine|bain|pyjama|cauchemar|lit |son lit|histoire du soir|routine du matin"),
    apprentissages: WS("devoir|lecture|lire|lu |écrire|écrit|apprendre|appris|compter|leçon|exercice|math|mathématique|école|classe|lettres|alphabet|dessin|bricolage|casse-tête|jeu de société"),
    reussites: WS("bravo|réussi|fier|fière|première fois|progrès|mieux que|sans aide|a accepté|félicit|encourag|belle réussite|super|beau moment|a partagé|a prêté|s'est excusé|s'est excusée|a attendu son tour"),
  };

  // ---------- Découpage ----------
  function cleanText(t) { return String(t || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim(); }
  // Découpe en phrases sans couper l'intérieur des guillemets
  function splitSentences(text) {
    const t = cleanText(text);
    if (!t) return [];
    const out = [];
    let buf = ''; let inQ = 0;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      buf += c;
      if (c === '«' || c === '“') inQ++;
      else if ((c === '»' || c === '”') && inQ > 0) inQ--;
      else if (c === '"') inQ = inQ ? 0 : 1;
      const end = c === '\n' || ((c === '.' || c === '!' || c === '?' || c === '…' || c === ';') && !inQ && (i + 1 >= t.length || /\s/.test(t[i + 1])));
      if (end) { if (buf.trim()) out.push(buf.trim()); buf = ''; }
    }
    if (buf.trim()) out.push(buf.trim());
    // Dictée sans ponctuation : on coupe aussi devant les liaisons parlées (« pis », « et là », « finalement »…)
    const res = [];
    for (const s of out) {
      if (s.split(/\s+/).length < 8) { res.push(s); continue; }
      // les paroles entre guillemets ne sont jamais coupées
      const quotes = [];
      const masked = s.replace(/«[^»]*»|“[^”]*”|"[^"]*"/gu, (q) => { quotes.push(q); return `\u0001${quotes.length - 1}\u0001`; });
      masked.split(SPOKEN_BREAK).map((x) => x.replace(/\u0001(\d+)\u0001/g, (_, i) => quotes[Number(i)]).trim()).filter(Boolean).forEach((x) => res.push(x));
    }
    return res;
  }
  // Nettoyage mécanique d'une phrase (aucun mot ajouté)
  function tidy(s) {
    let x = String(s).replace(FILLERS, '').replace(/\s+/g, ' ').trim();
    x = x.replace(LEADING, '').trim();
    x = x.replace(/^[,;:\-–—\s]+/, '').replace(/[,;:\s]+$/, '');
    if (!x) return '';
    x = x.charAt(0).toUpperCase() + x.slice(1);
    if (!/[.!?…»”"]$/.test(x)) x += '.';
    return x;
  }
  const bare = (s) => String(s).replace(FILLERS, '').replace(LEADING, '').trim();

  // Sépare un contexte en tête de phrase : « Ce matin au déjeuner, il a refusé… »
  function splitLeadingContext(s) {
    const b = bare(s);
    const i = b.indexOf(',');
    if (i < 3 || i > 70) return null;
    const head = b.slice(0, i); const tail = b.slice(i + 1).trim();
    if (!tail || head.split(/\s+/).length > 9) return null;
    const m = head.match(R.contextStart) || head.match(R.contextOnly);
    if (!m || head.search(R.contextStart) > 12 && head.search(R.contextOnly) !== 0) return null;
    return { head, tail, why: m[0] };
  }

  // « Ce soir au coucher elle voulait pas dormir » : sépare le moment ou le lieu du reste de la phrase
  function splitLeadingContextNoComma(s) {
    const b = bare(s);
    const m = b.match(R.contextStart);
    if (!m || b.search(R.contextStart) !== 0) return null;
    const rest = b.slice(m[0].length);
    const k = rest.search(/\s(?=(?:il|elle|je|on|nous|mon|ma|notre|son|sa|ses)\s|j['’])/iu);
    if (k < 0 || rest.slice(0, k).split(/\s+/).length > 7) return null;
    const head = (m[0] + rest.slice(0, k)).trim(); const tail = rest.slice(k).trim();
    if (tail.split(/\s+/).length < 2) return null;
    return { head, tail, why: m[0] };
  }

  function childSubject(s, childName) {
    const b = bare(s);
    if (R.childSubject.test(b)) return true;
    if (childName) { const n = childName.trim().toLowerCase(); if (n && b.toLowerCase().startsWith(n + ' ')) return true; }
    return false;
  }

  // Classe une phrase ; renvoie { section, why }
  function classify(s, ctx) {
    const b = bare(s);
    let m;
    if ((m = b.match(R.impression))) return { section: 'impressions', why: `exprime une impression (« ${m[0]} »)` };
    if ((m = b.match(R.innerState))) return { section: 'impressions', why: `attribue un état intérieur (« ${m[0]} »), ce n'est pas un fait observé` };
    if ((m = b.match(FLAGS[0][0]))) return { section: 'impressions', why: `contient un jugement (« ${m[0]} »), ce n'est pas un fait observé` };
    if ((m = b.match(R.outcome))) return { section: 'outcome', why: `indique la fin de la situation (« ${m[0]} »)` };
    if ((m = b.match(R.contextOnly)) && b.search(R.contextOnly) < 15) return { section: 'context', why: `décrit le moment ou le lieu (« ${m[0]} »)` };
    if ((m = b.match(R.contextStart)) && b.search(R.contextStart) === 0 && b.split(/\s+/).length <= 8 && !b.match(R.childReaction)) return { section: 'context', why: `décrit le moment ou le lieu (« ${m[0]} »)` };
    if ((m = b.match(R.perception))) return { section: 'description', why: `fait observé par le parent (« ${m[0]} »)` };
    if (R.parentSubject.test(b)) {
      const who = b.match(R.parentSubject)[0].trim();
      return { section: 'intervention', why: `action du parent (« ${who} … »)` };
    }
    if (R.quote.test(b)) return { section: 'childReaction', why: 'contient des paroles entre guillemets' };
    if (childSubject(b, ctx.childName) && (m = b.match(R.childReaction))) return { section: 'childReaction', why: `geste ou parole de l'enfant (« ${m[0].trim()} »)` };
    return { section: 'description', why: 'fait raconté (aucune autre règle ne s\'applique)' };
  }

  // ---------- Organisation complète ----------
  function organize(text, { type = null, childName = '' } = {}) {
    const items = [];
    const ctx = { seenChild: false, childName };
    for (const raw of splitSentences(text)) {
      const lc = splitLeadingContext(raw) || splitLeadingContextNoComma(raw);
      const parts = lc ? [{ text: lc.head, forced: { section: 'context', why: `moment ou lieu en début de phrase (« ${lc.why} »)` } }, { text: lc.tail }] : [{ text: raw }];
      for (const p of parts) {
        const clean = tidy(p.text);
        if (!clean) continue;
        const c = p.forced || classify(p.text, ctx);
        if (c.section === 'childReaction') ctx.seenChild = true;
        items.push({ text: clean, section: c.section, why: c.why });
      }
    }
    // Un geste du parent raconté AVANT la réaction de l'enfant est le déclencheur : il fait partie de « Ce qui s'est passé »
    const firstChild = items.findIndex((i) => i.section === 'childReaction');
    items.forEach((it, i) => {
      if (firstChild > i && it.section === 'intervention') { it.section = 'description'; it.why = it.why.replace('action du parent', 'geste du parent avant la réaction de l\'enfant') + ' : fait partie de ce qui s\'est passé'; }
    });
    return { items, ...build(items, { type, text }) };
  }
  // Reconstruit sections, catégories, questions et signalements à partir du classement (modifiable par le parent)
  function build(items, { type = null, text = '' } = {}) {
    const sections = Object.fromEntries(SECTION_KEYS.map((k) => [k, '']));
    for (const it of items) sections[it.section] = sections[it.section] ? `${sections[it.section]} ${it.text}` : it.text;
    return { sections, categories: suggestCategories(text || items.map((i) => i.text).join(' '), type), questions: questionsFor(sections, type), flags: findFlags(text || items.map((i) => i.text).join(' ')) };
  }

  function suggestCategories(text, type) {
    const out = [];
    for (const [key] of CATEGORIES) {
      const re = new RegExp(CAT_RULES[key].source, 'giu');
      const found = [...new Set((String(text).match(re) || []).map((w) => (/^[«“]$/.test(w) ? "paroles citées" : w.trim().toLowerCase())))].slice(0, 4);
      if (key === 'reussites' && (type === 'reussite' || type === 'beau_moment')) found.unshift('type « réussite / beau moment »');
      if (found.length) out.push({ key, label: CATEGORY_LABEL[key], why: found });
    }
    return out;
  }

  const HARD = ['difficulte', 'crise'];
  function questionsFor(sections, type) {
    const q = [];
    const hard = HARD.includes(type) || /crise|cri|pleur|frapp|hurl|lanc/iu.test(sections.childReaction + ' ' + sections.description);
    if (hard && !sections.intervention) q.push({ section: 'intervention', text: 'Qu\'avez-vous fait pour l\'aider à retrouver son calme ?' });
    if (!sections.outcome) q.push({ section: 'outcome', text: 'Comment la situation s\'est-elle terminée ?' });
    if (!sections.context) q.push({ section: 'context', text: 'Où et à quel moment est-ce arrivé ?' });
    if (!hard && !sections.childReaction) q.push({ section: 'childReaction', text: 'Qu\'a-t-il fait ou dit à ce moment-là ?' });
    return q.slice(0, 2);
  }

  function findFlags(text) {
    const out = [];
    for (const [re, kind, tip] of FLAGS) {
      const g = new RegExp(re.source, 'giu');
      for (const m of String(text).matchAll(g)) out.push({ word: m[0], kind, tip });
    }
    const seen = new Set();
    return out.filter((f) => { const k = f.kind + f.word.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  }

  // ---------- Contrôles utilisés par les tests et l'écran de validation ----------
  const words = (s) => (String(s).toLowerCase().normalize('NFC').match(/[\p{L}\p{N}]+/gu) || []);
  // Vrai si chaque mot des sections vient du texte original (rien d'inventé)
  function inventedWords(original, sections) {
    const pool = new Map();
    for (const w of words(original)) pool.set(w, (pool.get(w) || 0) + 1);
    const extra = [];
    for (const k of SECTION_KEYS) for (const w of words(sections[k] || '')) {
      const n = pool.get(w) || 0;
      if (n > 0) pool.set(w, n - 1); else extra.push(w);
    }
    return extra;
  }
  // Mots de l'original absents des sections (hors mots de remplissage et liaisons retirées)
  const DROPPABLE = new Set(['euh', 'euhh', 'heu', 'hum', 'hmm', 'euhm', 'et', 'puis', 'pis', 'là', 'bon', 'ben', 'fait', 'que', 'faque', 'donc', 'mais']);
  function droppedWords(original, sections) {
    const pool = new Map();
    for (const k of SECTION_KEYS) for (const w of words(sections[k] || '')) pool.set(w, (pool.get(w) || 0) + 1);
    const lost = [];
    for (const w of words(original)) {
      const n = pool.get(w) || 0;
      if (n > 0) pool.set(w, n - 1); else if (!DROPPABLE.has(w)) lost.push(w);
    }
    return lost;
  }

  const api = { VERSION: '0.5.0', organize, build, splitSentences, tidy, classify, suggestCategories, questionsFor, findFlags, inventedWords, droppedWords, SECTIONS, SECTION_KEYS, SECTION_LABEL, CATEGORIES, CATEGORY_KEYS, CATEGORY_LABEL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JFOrganize = api;
})(typeof window !== 'undefined' ? window : globalThis);
