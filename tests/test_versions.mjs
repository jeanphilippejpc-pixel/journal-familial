// Vérification des versions (script SQL 05 + application 0.4.1). Faux serveur, données fictives.
// Couvre : modifications concurrentes de Papa et Maman (y compris hors ligne), compatibilité avec
// 0.4.0 et 0.3.0 en mode souple et obligatoire, conservation des changements hors ligne, et le
// réessai sans base_version strictement limité à « colonne absente ».
// Lancer : node tests/test_versions.mjs
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { createMock } from './mock-supabase.mjs';
const require = createRequire(import.meta.url);
const NEW = require('../js/sync.js');            // 0.4.1
const V040 = require('./legacy/sync-0.4.0.js');  // 0.4.0 publiée
const V030 = require('./legacy/sync-0.3.0.js');  // 0.3.0

let now = Date.parse('2026-11-20T15:00:00Z');
const results = [];
const check = (name, cond, extra = '') => { results.push(!!cond); console.log((cond ? 'OK    ' : 'ÉCHEC ') + name + (cond || !extra ? '' : '  → ' + extra)); };
const section = (t) => console.log(`\n--- ${t} ---`);

// Un téléphone : son propre stockage local, son propre réseau (hors ligne ou non), le journal de ses requêtes
function phone(J, mock, label, email) {
  const ev = new Map(); const dy = new Map(); let state = {}; let session = null;
  const p = { offline: false, log: [], tamper: null };
  const fetchFn = async (url, opts = {}) => {
    if (p.offline) throw new TypeError('Failed to fetch');
    let u = url;
    if (p.tamper) u = p.tamper(url, opts) || url;
    p.log.push({ method: opts.method || 'GET', url: u, body: opts.body ? JSON.parse(opts.body) : null });
    return mock.fetchFn(u, opts);
  };
  const store = {
    names: {}, events: () => ev.values(), getEvent: (id) => ev.get(id), putEvent: async (e) => { ev.set(e.id, e); }, removeEvent: async (id) => { ev.delete(id); },
    days: () => dy.values(), getDay: (d) => dy.get(d), putDay: async (d) => { dy.set(d.date, d); },
    getState: () => state, setState: async (s) => { state = s; }, myName: () => label, uid: randomUUID, now: () => now,
  };
  const make = (JJ) => {
    const client = JJ.createClient({ url: 'https://mock.test/mock', key: 'mock-publishable-key', fetchFn, loadSession: async () => session, saveSession: async (s) => { session = s; }, now: () => now });
    return { client, engine: JJ.createEngine({ client, store }), J: JJ };
  };
  let cur = make(J);
  Object.assign(p, {
    ev, dy, store,
    get engine() { return cur.engine; }, get client() { return cur.client; },
    login: () => cur.client.signIn(email, 'motdepasse-test'),
    sync: () => cur.engine.sync(),
    upgrade(JJ) { cur = make(JJ); return p; }, // mise à jour de l'app : même stockage local, même session
    add(f) { const e = { id: randomUUID(), kind: 'event', date: '2026-11-20', time: '16:05', type: 'difficulte', intensity: null, note: '', comments: [], ...f, dirty: true, rev: 1 }; ev.set(e.id, e); return e; },
    edit(id, f) { const e = ev.get(id); Object.assign(e, f); e.dirty = true; e.rev = (e.rev || 0) + 1; return e; },
    rate(date, rating) { const d = dy.get(date) || { id: randomUUID(), kind: 'day', date, rating: null, belle: false }; Object.assign(d, { rating, dirty: true, rev: (d.rev || 0) + 1 }); dy.set(date, d); return d; },
    pending: () => [...ev.values(), ...dy.values()].filter(cur.J.isPending).length,
    patches: () => p.log.filter((r) => r.method === 'PATCH'),
  });
  return p;
}
async function family(opts = {}, papaJ = NEW, mamanJ = NEW) {
  const mock = createMock({ now: () => now, ...opts });
  const papa = phone(papaJ, mock, 'Papa', 'papa@test.local');
  const maman = phone(mamanJ, mock, 'Maman', 'maman@test.local');
  await papa.login(); await maman.login();
  return { mock, papa, maman, P: mock.users['papa@test.local'].id, M: mock.users['maman@test.local'].id };
}
const srvEv = (mock, id) => mock.tables.events.get(id);
const lostComment = (e) => (e.comments || []).some((c) => /Version non retenue/.test(c.text));

// =====================================================================
section('1. Base de fonctionnement (mode souple)');
{
  const { mock, papa, maman, P, M } = await family({}, NEW, V040);
  const e = papa.add({ note: 'Fiche de Papa' }); await papa.sync(); await maman.sync();
  papa.edit(e.id, { note: 'Papa (0.4.1) modifie' }); await papa.sync();
  const pp = papa.patches().at(-1);
  check('0.4.1 : la modification envoie base_version = la version de départ, en plus du filtre d\'adresse', pp && pp.body.base_version === 1 && /version=eq\.1/.test(pp.url));
  check('… acceptée, comptée « avec version » ; base_version jamais conservée sur le serveur', srvEv(mock, e.id).note === 'Papa (0.4.1) modifie' && srvEv(mock, e.id).base_version === null && mock.journal.some((j) => j.uid === P && j.avec));
  await maman.sync(); maman.edit(e.id, { note: 'Maman (0.4.0) modifie' }); await maman.sync();
  check('0.4.0 en mode souple : fonctionne comme avant, comptée « sans version »', srvEv(mock, e.id).note === 'Maman (0.4.0) modifie' && mock.journal.some((j) => j.uid === M && !j.avec) && maman.pending() === 0);
  papa.rate('2026-11-20', 'jaune'); await papa.sync(); papa.rate('2026-11-20', 'vert'); await papa.sync();
  check('0.4.1 : journée modifiée avec base_version', papa.patches().some((r) => /\/days\?/.test(r.url) && r.body.base_version === 1) && mock.tables.days.get('2026-11-20').rating === 'vert');
}

// =====================================================================
section('2. Modifications concurrentes hors ligne : aucun écrasement silencieux');
for (const [nomP, JP, nomM, JM] of [['0.4.1', NEW, '0.4.1', NEW], ['0.4.1', NEW, '0.4.0', V040], ['0.4.0', V040, '0.4.1', NEW], ['0.4.1', NEW, '0.3.0', V030]]) {
  for (const strict of [false, true]) {
    if (strict && (JP !== NEW || JM !== NEW)) continue; // en mode obligatoire, une app ancienne ne peut rien modifier (section 3)
    const mode = strict ? 'obligatoire' : 'souple';
    const { mock, papa, maman } = await family({ strict }, JP, JM);
    const e = papa.add({ note: 'Version de départ' }); await papa.sync(); await maman.sync();
    papa.offline = true; maman.offline = true;                       // les deux téléphones hors ligne
    papa.edit(e.id, { note: `Papa hors ligne (${nomP})` });
    maman.edit(e.id, { note: `Maman hors ligne (${nomM})` });
    maman.offline = false; await maman.sync();                        // Maman revient la première
    papa.offline = false; await papa.sync();                          // puis Papa
    const s = srvEv(mock, e.id); const lp = papa.ev.get(e.id);
    check(`[${mode}] Papa ${nomP} / Maman ${nomM} : la version de Maman, arrivée la 1re, n'est pas écrasée`, s.note === `Maman hors ligne (${nomM})`, s.note);
    check(`… Papa voit un conflit et garde sa propre version dans le téléphone`, !!lp.conflict && lp.note === `Papa hors ligne (${nomP})`);
    if (JP.VERSION === '0.4.1' || JP === NEW) {
      await papa.engine.resolveEvent(e.id, 'mine'); await papa.sync();
      const s2 = srvEv(mock, e.id);
      check(`… Papa garde sa version après avoir choisi : celle de Maman est conservée en commentaire (rien de perdu)`, s2.note === `Papa hors ligne (${nomP})` && lostComment(papa.ev.get(e.id)) && [...mock.tables.comments.values()].some((c) => c.event_id === e.id && /Maman hors ligne/.test(c.text)));
    }
  }
}
{
  // Journées concurrentes hors ligne
  const { mock, papa, maman } = await family({}, NEW, NEW);
  papa.rate('2026-11-21', 'jaune'); await papa.sync(); await maman.sync();
  papa.offline = maman.offline = true;
  papa.rate('2026-11-21', 'rouge'); maman.rate('2026-11-21', 'vert');
  maman.offline = false; await maman.sync(); papa.offline = false; await papa.sync();
  check('Journée notée hors ligne par les deux : la 1re arrivée reste, l\'autre devient un conflit', mock.tables.days.get('2026-11-21').rating === 'vert' && !!papa.dy.get('2026-11-21').conflict && papa.dy.get('2026-11-21').rating === 'rouge');
}
{
  // Champs différents modifiés en même temps : toujours un conflit, jamais de fusion silencieuse
  const { mock, papa, maman } = await family({}, NEW, NEW);
  const e = papa.add({ note: 'Départ', place: 'Parc' }); await papa.sync(); await maman.sync();
  papa.offline = maman.offline = true;
  papa.edit(e.id, { place: 'École' }); maman.edit(e.id, { note: 'Départ, précisé par Maman' });
  maman.offline = false; await maman.sync(); papa.offline = false; await papa.sync();
  check('Champs différents modifiés hors ligne : conflit signalé, le serveur garde la version de Maman intacte', !!papa.ev.get(e.id).conflict && srvEv(mock, e.id).place === 'Parc' && srvEv(mock, e.id).note === 'Départ, précisé par Maman');
}
{
  // Approbation pendant que l'autre parent modifie hors ligne
  const { mock, papa, maman, P } = await family({ strict: true }, NEW, NEW);
  const e = papa.add({ note: 'À approuver' }); await papa.sync(); await maman.sync();
  maman.offline = true; maman.edit(e.id, { note: 'Maman corrige hors ligne' });
  papa.edit(e.id, { approveRequest: randomUUID() }); await papa.sync();
  check('Papa approuve (mode obligatoire, avec base_version) : acceptée', srvEv(mock, e.id).approved_by === P);
  maman.offline = false; await maman.sync();
  check('… la correction de Maman faite hors ligne sur l\'ancienne version : conflit, ni l\'approbation ni le texte ne sont écrasés', !!maman.ev.get(e.id).conflict && srvEv(mock, e.id).note === 'À approuver' && srvEv(mock, e.id).approved_by === P);
  await maman.engine.resolveEvent(e.id, 'mine'); await maman.sync();
  check('… Maman garde sa correction : l\'approbation de Papa est retirée (elle portait sur l\'ancien texte)', srvEv(mock, e.id).note === 'Maman corrige hors ligne' && srvEv(mock, e.id).approved_at === null);
}

// =====================================================================
section('3. Mode obligatoire : téléphones restés sur une ancienne version');
for (const [nom, JOLD] of [['0.4.0', V040], ['0.3.0', V030]]) {
  const { mock, papa, maman } = await family({ strict: false }, NEW, JOLD);
  const e = maman.add({ note: 'Écrite par Maman' }); await maman.sync(); await papa.sync();
  mock.opt.strict = true; // les parents ont exécuté le script 05b
  maman.offline = true;
  maman.edit(e.id, { note: `Corrigée hors ligne (${nom})` });
  maman.rate('2026-11-22', 'orange');
  const nouvelle = maman.add({ note: `Nouvelle fiche hors ligne (${nom})` });
  maman.offline = false; await maman.sync();
  const le = maman.ev.get(e.id);
  check(`${nom} en mode obligatoire : la correction est REFUSÉE par le serveur, qui garde l'ancienne version`, srvEv(mock, e.id).note === 'Écrite par Maman');
  check(`… la correction reste dans le téléphone, en attente, avec le message de mise à jour`, le.note === `Corrigée hors ligne (${nom})` && V040.isPending(le) && /Mise à jour de l'application nécessaire/.test(le.syncError || ''), le.syncError);
  check(`… une nouvelle fiche (création) est quand même envoyée`, !!srvEv(mock, nouvelle.id));
  check(`… la journée notée (création) est envoyée`, mock.tables.days.get('2026-11-22') && mock.tables.days.get('2026-11-22').rating === 'orange');
  await maman.sync(); await maman.sync();
  check(`… plusieurs synchronisations : toujours refusée, jamais perdue, jamais forcée`, srvEv(mock, e.id).note === 'Écrite par Maman' && maman.ev.get(e.id).note === `Corrigée hors ligne (${nom})`);
  maman.upgrade(NEW); await maman.sync();                     // Maman ouvre l'app avec Internet → 0.4.1
  check(`… après la mise à jour en 0.4.1 : la correction gardée hors ligne est envoyée, plus rien en attente`, srvEv(mock, e.id).note === `Corrigée hors ligne (${nom})` && maman.pending() === 0 && !maman.ev.get(e.id).syncError);
}
{
  // Ancien téléphone + l'autre parent modifie la même fiche entre-temps
  const { mock, papa, maman } = await family({}, NEW, V040);
  const e = papa.add({ note: 'Départ' }); await papa.sync(); await maman.sync();
  mock.opt.strict = true;
  maman.offline = true; maman.edit(e.id, { note: 'Maman 0.4.0 hors ligne' });
  maman.offline = false; await maman.sync();                  // refusée (mise à jour nécessaire)
  papa.edit(e.id, { note: 'Papa 0.4.1 entre-temps' }); await papa.sync();
  maman.upgrade(NEW); await maman.sync();
  check('Correction refusée puis mise à jour, alors que Papa a modifié entre-temps : conflit, rien d\'écrasé', srvEv(mock, e.id).note === 'Papa 0.4.1 entre-temps' && !!maman.ev.get(e.id).conflict && maman.ev.get(e.id).note === 'Maman 0.4.0 hors ligne');
}
{
  // Ancienne version avec une approbation en attente
  const { mock, papa, maman } = await family({ strict: true }, NEW, V040);
  const e = maman.add({ note: 'Fiche', originalText: 'récit', hasStructure: true, categories: ['emotions'] }); await maman.sync();
  maman.edit(e.id, { approveRequest: randomUUID() }); await maman.sync();
  check('0.4.0 en mode obligatoire : son approbation est refusée et reste en attente (pas de faux « approuvée »)', srvEv(mock, e.id).approved_at === null && !!maman.ev.get(e.id).approveRequest);
  maman.upgrade(NEW); await maman.sync();
  check('… après la mise à jour : l\'approbation est envoyée et confirmée par le serveur', srvEv(mock, e.id).approved_at !== null && !maman.ev.get(e.id).approveRequest);
}
{
  const { mock, papa } = await family({ strict: true }, NEW, NEW);
  const e = papa.add({ note: 'x' }); await papa.sync(); papa.edit(e.id, { note: 'y' }); await papa.sync();
  papa.rate('2026-11-23', 'vert'); await papa.sync(); papa.rate('2026-11-23', 'jaune'); await papa.sync();
  check('0.4.1 en mode obligatoire : fiches et journées se synchronisent normalement', srvEv(mock, e.id).note === 'y' && mock.tables.days.get('2026-11-23').rating === 'jaune' && papa.pending() === 0 && !papa.engine.needsUpdate());
}

// =====================================================================
section('4. Mise à jour 0.4.0 → 0.4.1 avec des données hors ligne');
for (const strict of [false, true]) {
  const { mock, maman } = await family({ strict: false }, NEW, V040);
  const a = maman.add({ note: 'Déjà envoyée' }); await maman.sync();
  maman.offline = true;
  const b = maman.add({ note: 'Nouvelle hors ligne (0.4.0)', type: 'crise', intensity: 'rouge' });
  maman.edit(a.id, { note: 'Modifiée hors ligne (0.4.0)' });
  maman.rate('2026-11-24', 'jaune');
  mock.opt.strict = strict;
  maman.upgrade(NEW); maman.offline = false; await maman.sync();
  check(`Mise à jour avec 3 changements hors ligne (mode ${strict ? 'obligatoire' : 'souple'}) : tout est envoyé intact, rien en attente`, srvEv(mock, b.id) && srvEv(mock, b.id).intensity === 'rouge' && srvEv(mock, a.id).note === 'Modifiée hors ligne (0.4.0)' && mock.tables.days.get('2026-11-24').rating === 'jaune' && maman.pending() === 0);
}

// =====================================================================
section('5. Réessai sans base_version : seulement si la colonne n\'existe pas');
{
  // Script 05 pas encore installé (schéma 4) : l'app 0.4.1 fonctionne quand même
  const { mock, papa, P } = await family({ schema: 4 }, NEW, NEW);
  const e = papa.add({ note: 'Avant le script 05' }); await papa.sync();
  papa.log.length = 0;
  papa.edit(e.id, { note: 'Modifiée avant le script 05' }); papa.rate('2026-11-25', 'vert'); await papa.sync();
  papa.rate('2026-11-25', 'rouge'); papa.edit(e.id, { approveRequest: randomUUID() }); await papa.sync();
  const p = papa.patches();
  check('Sans script 05 : modification, approbation et journée envoyées (sans base_version)', srvEv(mock, e.id).note === 'Modifiée avant le script 05' && srvEv(mock, e.id).approved_by === P && mock.tables.days.get('2026-11-25').rating === 'rouge' && papa.pending() === 0);
  check('… un seul essai avec base_version par table et par synchronisation, refusé car la colonne manque', p.filter((r) => r.body.base_version !== undefined && /events/.test(r.url)).length === 2 && p.filter((r) => r.body.base_version !== undefined && /days/.test(r.url)).length === 1, JSON.stringify(p.map((r) => [r.url.split('?')[0], r.body.base_version])));
  mock.opt.schema = 5; // le script 05 est installé
  papa.log.length = 0; papa.edit(e.id, { note: 'Après le script 05' }); await papa.sync();
  check('… dès le script 05 installé, la synchronisation suivante renvoie base_version', papa.patches().every((r) => r.body.base_version !== undefined) && mock.journal.some((j) => j.uid === P && j.avec));
}
{
  // Une autre colonne manque (script 04 absent) : pas de réessai sans base_version
  const { mock, papa } = await family({ schema: 3 }, NEW, NEW);
  const e = papa.add({ note: 'Simple' }); await papa.sync();
  papa.log.length = 0;
  papa.edit(e.id, { outcome: 'Résultat', originalText: 'récit', hasStructure: true }); await papa.sync();
  const p = papa.patches();
  check('Erreur « colonne absente » qui ne nomme PAS base_version : aucun renvoi sans base_version', p.length === 1 && p[0].body.base_version !== undefined && !!papa.ev.get(e.id).syncError, JSON.stringify(p.map((r) => r.body.base_version)));
}
{
  // Refus « version périmée » (JFV02) : jamais contourné. On retire le filtre d'adresse pour que seul
  // le serveur (base_version) puisse détecter que la fiche a changé.
  const { mock, papa, maman } = await family({ strict: false }, NEW, NEW);
  const e = papa.add({ note: 'Départ' }); await papa.sync(); await maman.sync();
  maman.edit(e.id, { note: 'Maman d\'abord' }); await maman.sync();
  papa.tamper = (url, opts) => (opts.method === 'PATCH' ? url.replace(/&version=eq\.\d+/, '') : url);
  papa.log.length = 0;
  papa.edit(e.id, { note: 'Papa sur l\'ancienne version' }); await papa.sync();
  const p = papa.patches();
  check('Refus JFV02 (version périmée) : la version de Maman reste sur le serveur', srvEv(mock, e.id).note === 'Maman d\'abord');
  check('… aucune nouvelle tentative sans base_version', p.length >= 1 && p.every((r) => r.body.base_version !== undefined), JSON.stringify(p.map((r) => r.body.base_version)));
  check('… Papa voit un conflit, sa version est gardée dans le téléphone', !!papa.ev.get(e.id).conflict && papa.ev.get(e.id).note === 'Papa sur l\'ancienne version');
  // Même chose pour une journée et pour une approbation
  papa.tamper = null; await papa.engine.resolveEvent(e.id, 'theirs'); await papa.sync();
  papa.rate('2026-11-26', 'jaune'); await papa.sync(); await maman.sync();
  maman.rate('2026-11-26', 'vert'); await maman.sync();
  papa.tamper = (url, opts) => (opts.method === 'PATCH' ? url.replace(/&version=eq\.\d+/, '') : url);
  papa.log.length = 0; papa.rate('2026-11-26', 'rouge'); await papa.sync();
  check('Journée : refus JFV02 jamais contourné, conflit, couleur de Maman gardée', mock.tables.days.get('2026-11-26').rating === 'vert' && !!papa.dy.get('2026-11-26').conflict && papa.patches().every((r) => r.body.base_version !== undefined));
}
{
  // Mode obligatoire (JFV01) reçu par l'app 0.4.1 : jamais contourné, message « mise à jour nécessaire »
  const { mock, papa } = await family({ strict: true }, NEW, NEW);
  const e = papa.add({ note: 'Départ' }); await papa.sync();
  // On simule un serveur qui exigerait une version plus récente de l'app (réponse JFV01 forcée)
  const real = mock.fetchFn;
  mock.fetchFn = async (url, opts) => (opts.method === 'PATCH' ? { ok: false, status: 400, text: async () => JSON.stringify({ code: 'JFV01', message: "Mise à jour de l'application nécessaire : fermez puis rouvrez le Journal. Vos changements restent dans le téléphone." }) } : real(url, opts));
  papa.log.length = 0; papa.edit(e.id, { note: 'Modifiée' }); await papa.sync();
  check('Refus JFV01 : la modification reste en attente, avec le message, et l\'app signale qu\'une mise à jour est nécessaire', NEW.isPending(papa.ev.get(e.id)) && /Mise à jour/.test(papa.ev.get(e.id).syncError || '') && papa.engine.needsUpdate());
  check('… aucune nouvelle tentative sans base_version', papa.patches().every((r) => r.body.base_version !== undefined));
  mock.fetchFn = real; await papa.sync();
  check('… dès que le serveur l\'accepte : envoyée, plus de message', srvEv(mock, e.id).note === 'Modifiée' && !papa.engine.needsUpdate() && papa.pending() === 0);
}
{
  // Erreur serveur ordinaire : pas de réessai sans base_version, rien de perdu
  const { mock, papa } = await family({}, NEW, NEW);
  const e = papa.add({ note: 'Départ' }); await papa.sync();
  const real = mock.fetchFn;
  mock.fetchFn = async (url, opts) => (opts.method === 'PATCH' ? { ok: false, status: 500, text: async () => '{"message":"panne"}' } : real(url, opts));
  papa.log.length = 0; papa.edit(e.id, { note: 'Pendant la panne' }); await papa.sync();
  check('Panne du serveur : une seule tentative (avec base_version), la modification reste en attente', papa.patches().length === 1 && papa.patches()[0].body.base_version !== undefined && NEW.isPending(papa.ev.get(e.id)));
  mock.fetchFn = real;
}
{
  // Le mode obligatoire ne s'active jamais tout seul
  const mock = createMock({ now: () => now });
  const p = phone(NEW, mock, 'Papa', 'papa@test.local'); await p.login();
  const e = p.add({ note: 'x' }); await p.sync();
  for (let i = 0; i < 10; i++) { now += 864e5; p.edit(e.id, { note: 'jour ' + i }); await p.sync(); }
  check('Après 10 jours de synchronisation sans aucune app ancienne : le mode reste souple (aucune activation automatique)', mock.opt.strict === false);
}

const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} tests réussis`);
process.exit(ok === results.length ? 0 : 1);
