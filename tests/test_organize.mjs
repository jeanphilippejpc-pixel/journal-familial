// Tests de l'organisation locale (phase 4) — récits fictifs uniquement.
// Lancer : node tests/test_organize.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const O = require('../js/organize.js');

const results = [];
const check = (name, cond, extra = '') => { results.push(!!cond); console.log((cond ? 'OK    ' : 'ÉCHEC ') + name + (cond || !extra ? '' : '  → ' + extra)); };
const has = (sec, txt) => sec.toLowerCase().includes(txt.toLowerCase());

// [titre, récit, options, attentes { section: [extraits attendus] }, sections qui doivent rester vides, catégories attendues]
const CASES = [
  ['Crise au déjeuner (ponctué)', 'Ce matin au déjeuner, il a refusé de manger ses céréales. Il a crié « je veux pas ! » et il a lancé sa cuillère. Je lui ai proposé de respirer avec moi. Finalement il s\'est calmé après 5 minutes. Je pense qu\'il était fatigué.', { type: 'crise' },
    { context: ['Ce matin au déjeuner'], childReaction: ['refusé', 'je veux pas'], intervention: ['respirer avec moi'], outcome: ['calmé après 5 minutes'], impressions: ['fatigué'] }, [], ['emotions', 'comportements']],
  ['Dictée sans ponctuation (parc)', 'on était au parc pis je lui ai dit qu\'on partait dans 5 minutes et là il s\'est mis à pleurer pis il a couru vers les glissades je suis allé le chercher et je l\'ai pris dans mes bras finalement on a pu partir', { type: 'crise' },
    { context: ['au parc'], description: ['on partait dans 5 minutes'], childReaction: ['pleurer', 'glissades'], intervention: ['pris dans mes bras'], outcome: ['on a pu partir'] }, ['impressions'], ['emotions']],
  ['Réussite d\'autonomie', 'Il s\'est habillé tout seul pour la première fois. Il était fier de nous montrer.', { type: 'reussite' },
    { description: ['habillé tout seul'] }, ['intervention'], ['autonomie', 'reussites']],
  ['Coucher difficile avec jugement', 'Euh ce soir au coucher elle voulait pas dormir. Elle a demandé une autre histoire. J\'ai dit non. Elle a pleuré 10 minutes. Elle est capricieuse.', { type: 'difficulte' },
    { context: ['Ce soir au coucher'], childReaction: ['voulait pas dormir', 'pleuré 10 minutes'], intervention: ['dit non'], impressions: ['capricieuse'] }, ['outcome'], ['sommeil', 'emotions']],
  ['Partage avec le cousin', 'Chez grand-maman, il a prêté son camion à son cousin sans qu\'on lui demande.', { type: 'beau_moment' },
    { context: ['Chez grand-maman'], childReaction: ['prêté son camion'] }, ['intervention', 'impressions'], ['social', 'reussites']],
  ['Paroles entre guillemets', 'Il m\'a dit « je suis fâché » au lieu de lancer son jouet.', { type: 'reussite' },
    { childReaction: ['je suis fâché'] }, ['intervention'], ['communication']],
  ['Impression explicite', 'Il a refusé de mettre ses bottes. J\'ai l\'impression qu\'il avait peur d\'aller à la garderie.', { type: 'difficulte' },
    { childReaction: ['refusé de mettre ses bottes'], impressions: ['peur'] }, [], ['comportements']],
  ['Terme de diagnostic signalé', 'Il a couru partout pendant le souper. Sûrement son TDAH.', { type: 'difficulte' },
    { childReaction: ['couru partout'], impressions: ['TDAH'] }, [], []],
  ['Fait observé par le parent', 'J\'ai remarqué qu\'il se bouchait les oreilles quand l\'aspirateur fonctionnait.', { type: 'autre' },
    { description: ['bouchait les oreilles'] }, ['intervention', 'childReaction'], []],
  ['Devoirs', 'Après l\'école, il a fait ses devoirs de lecture sans se plaindre. Il a lu deux pages.', { type: 'reussite' },
    { context: ['Après l\'école'], childReaction: ['devoirs de lecture'] }, [], ['apprentissages']],
  ['Dans l\'auto', 'Dans l\'auto, sa sœur a pris sa tablette. Il l\'a frappée. On s\'est arrêtés et je les ai séparés. Ça s\'est réglé en 2 minutes.', { type: 'crise' },
    { context: ['Dans l\'auto'], description: ['sa sœur a pris sa tablette'], childReaction: ['frappée'], intervention: ['séparés'], outcome: ['réglé'] }, ['impressions'], ['comportements', 'social']],
  ['Prénom de l\'enfant', 'Léo a lancé ses blocs. Je me suis assis à côté de lui. Il s\'est calmé.', { type: 'difficulte', childName: 'Léo' },
    { childReaction: ['lancé ses blocs'], intervention: ['assis à côté'], outcome: ['calmé'] }, [], ['comportements']],
  ['Nuit et cauchemar', 'Cette nuit il s\'est réveillé deux fois à cause d\'un cauchemar. Je suis allée le consoler. Il s\'est rendormi vers 3 h.', { type: 'difficulte' },
    { context: ['Cette nuit'], intervention: ['consoler'] }, [], ['sommeil']],
  ['Texte très court', 'Belle journée au parc.', { type: 'beau_moment' }, {}, ['intervention', 'impressions', 'outcome'], []],
  ['Uniquement une impression', 'Je crois qu\'il était triste aujourd\'hui.', { type: 'autre' }, { impressions: ['triste'] }, ['childReaction', 'intervention', 'outcome'], []],
  ['Mot de remplissage', 'Euh il a euh rangé sa chambre euh tout seul.', { type: 'reussite' }, { childReaction: ['rangé sa chambre'] }, [], ['autonomie']],
  ['Moment de la journée en tête', 'À l\'heure du bain il s\'est mis à hurler. On a chanté sa chanson. Il a accepté d\'entrer dans le bain.', { type: 'difficulte' },
    { context: ['heure du bain'], childReaction: ['hurler'], intervention: ['chanté'], outcome: ['accepté'] }, [], ['sommeil', 'emotions']],
  ['Garderie (récit de l\'éducatrice)', 'À la garderie, l\'éducatrice nous a dit qu\'il avait mordu un ami.', { type: 'difficulte' },
    { context: ['garderie'] }, ['intervention'], ['social']],
  ['Plusieurs interventions', 'Il refusait de partir. Je lui ai donné deux choix. Je l\'ai prévenu une fois. Il a finalement mis son manteau.', { type: 'difficulte' },
    { childReaction: ['refusait'], intervention: ['deux choix', 'prévenu'], outcome: ['mis son manteau'] }, [], []],
  ['Point d\'exclamation et question', 'Il a dit : « Est-ce que je peux aider ? » Il a mis la table tout seul !', { type: 'reussite' },
    { childReaction: ['peux aider'] }, [], ['autonomie', 'communication']],
  ['Pas de section inventée', 'Il a joué avec ses amis.', { type: 'beau_moment' }, {}, ['context', 'intervention', 'outcome', 'impressions'], ['social']],
  ['Parent par son rôle', 'Maman l\'a pris dans ses bras après qu\'il soit tombé. Il a pleuré un peu.', { type: 'autre' }, { description: ['pris dans ses bras'] }, [], ['emotions']],
  ['Épicerie', 'À l\'épicerie il s\'est roulé par terre. J\'ai attendu à côté de lui sans parler. Au bout de 5 minutes il s\'est levé. Il était tanné de magasiner.', { type: 'crise' },
    { context: ['épicerie'], childReaction: ['roulé par terre'], intervention: ['attendu'], impressions: ['tanné'] }, [], ['comportements']],
  ['Réconciliation', 'Après la chicane avec son frère, il s\'est excusé tout seul.', { type: 'reussite' }, { outcome: ['excusé'] }, [], ['social', 'reussites']],
  ['Phrase très longue de dictée', 'ce soir pendant le souper il voulait pas manger ses légumes pis il a poussé son assiette pis là il a crié non non non je lui ai expliqué qu\'il pouvait juste goûter alors il a goûté une carotte à la fin il a mangé la moitié de son assiette', { type: 'difficulte' },
    { childReaction: ['poussé son assiette'], intervention: ['expliqué'], outcome: ['la moitié de son assiette'] }, [], ['comportements']],
  ['Signalement « exprès »', 'Il a renversé son verre exprès.', { type: 'difficulte' }, { impressions: ['exprès'] }, [], []],
  ['Respiration (autorégulation)', 'Quand il a senti la colère monter, il a pris trois grandes respirations tout seul.', { type: 'reussite' }, {}, ['intervention'], ['emotions']],
  ['Personne d\'autre que l\'enfant', 'Le chien a aboyé très fort et il s\'est caché derrière le divan.', { type: 'autre' }, {}, [], []],
  ['Texte vide', '   ', { type: null }, {}, ['context', 'description', 'childReaction', 'intervention', 'outcome', 'impressions'], []],
  ['Contexte « vers 17 h »', 'Vers 17 h il a demandé de l\'aide pour son casse-tête.', { type: 'reussite' }, { context: ['Vers 17 h'] }, [], ['apprentissages', 'communication']],
];

for (const [title, text, opt, expect, empty, cats] of CASES) {
  const r = O.organize(text, opt);
  const s = r.sections;
  const inv = O.inventedWords(text, s);
  const lost = O.droppedWords(text, s);
  let ok = inv.length === 0 && lost.length === 0;
  const why = [];
  if (inv.length) why.push('mots ajoutés : ' + inv.join(', '));
  if (lost.length) why.push('mots perdus : ' + lost.join(', '));
  for (const [sec, frags] of Object.entries(expect)) for (const f of frags) if (!has(s[sec], f)) { ok = false; why.push(`« ${f} » absent de ${sec} (${JSON.stringify(s[sec])})`); }
  for (const sec of empty) if (s[sec]) { ok = false; why.push(`${sec} devrait être vide : ${JSON.stringify(s[sec])}`); }
  const keys = r.categories.map((c) => c.key);
  for (const c of cats) if (!keys.includes(c)) { ok = false; why.push(`catégorie ${c} manquante (${keys.join(',')})`); }
  if (!keys.every((k) => O.CATEGORY_KEYS.includes(k))) { ok = false; why.push('catégorie inconnue'); }
  if (r.questions.length > 2) { ok = false; why.push('plus de 2 questions'); }
  if (r.questions.some((q) => s[q.section])) { ok = false; why.push('question sur une section déjà remplie'); }
  if (!r.items.every((i) => i.why && O.SECTION_KEYS.includes(i.section))) { ok = false; why.push('raison manquante'); }
  check(title, ok, why.join(' | '));
}

// Signalements
const f1 = O.organize('Il est capricieux et manipulateur. Il a peut-être un TDAH.').flags;
check('Jugements et diagnostic signalés (sans réécriture)', f1.some((f) => f.kind === 'jugement' && /capricieux/i.test(f.word)) && f1.some((f) => f.kind === 'diagnostic' && /tdah/i.test(f.word)));
// Le texte original n'est jamais modifié
const orig = 'euh   pis là il a crié';
const copy = String(orig); O.organize(orig);
check('Le texte original reste intact', orig === copy);
// Reconstruction après correction manuelle du classement
const r2 = O.organize('Il a crié. Je lui ai parlé doucement.', { type: 'crise' });
r2.items[1].section = 'description';
const b2 = O.build(r2.items, { type: 'crise', text: 'Il a crié. Je lui ai parlé doucement.' });
check('Déplacer une phrase vers une autre section', b2.sections.description.includes('parlé doucement') && !b2.sections.intervention && b2.questions.some((q) => q.section === 'intervention'));
// Questions : jamais plus de deux, facultatives
const r3 = O.organize('Il a pleuré.', { type: 'crise' });
check('Au plus deux questions, dans l\'ordre utile', r3.questions.length === 2 && r3.questions[0].section === 'intervention');
check('Aucune question quand tout est rempli', O.organize('Au parc, il a crié. Je l\'ai pris dans mes bras. Finalement il s\'est calmé.', { type: 'crise' }).questions.length === 0);

const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} tests réussis`);
process.exit(ok === results.length ? 0 : 1);
