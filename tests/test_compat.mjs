// Compatibilité entre les versions 0.3.0 (publiée) et 0.4.0 (phase 4), et ordre « migration → publication ».
// Papa utilise la 0.4.0, Maman est restée en 0.3.0. Faux serveur, données fictives uniquement.
// Lancer : node tests/test_compat.mjs
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { createMock } from './mock-supabase.mjs';
const require = createRequire(import.meta.url);
const NEW = require('../js/sync.js');
const OLD = require('./legacy/sync-0.3.0.js');

let now = Date.parse('2026-11-16T15:00:00Z');
const results = [];
const check = (name, cond, extra = '') => { results.push(!!cond); console.log((cond ? 'OK    ' : 'ÉCHEC ') + name + (cond || !extra ? '' : '  → ' + extra)); };

function phone(J, mock, label, email) {
  const ev = new Map(); const dy = new Map(); let state = {}; let session = null;
  const store = {
    names: {}, events: () => ev.values(), getEvent: (id) => ev.get(id), putEvent: async (e) => { ev.set(e.id, e); }, removeEvent: async (id) => { ev.delete(id); },
    days: () => dy.values(), getDay: (d) => dy.get(d), putDay: async (d) => { dy.set(d.date, d); },
    getState: () => state, setState: async (s) => { state = s; }, myName: () => label, uid: randomUUID, now: () => now,
  };
  const client = J.createClient({ url: 'https://mock.test/mock', key: 'mock-publishable-key', fetchFn: (...a) => mock.fetchFn(...a), loadSession: async () => session, saveSession: async (s) => { session = s; }, now: () => now });
  const engine = J.createEngine({ client, store });
  return {
    ev, store, engine, client, login: () => client.signIn(email, 'motdepasse-test'), sync: () => engine.sync(),
    add(f) { const e = { id: randomUUID(), kind: 'event', date: '2026-11-16', time: '16:05', type: null, intensity: null, note: '', comments: [], ...f, dirty: true, rev: 1 }; ev.set(e.id, e); return e; },
    edit(id, f) { const e = ev.get(id); Object.assign(e, f); e.dirty = true; e.rev = (e.rev || 0) + 1; return e; },
    pending: () => [...ev.values()].filter(J.isPending).length,
    // Mise à jour de l'app sur ce téléphone : même stockage local, même session, nouveau moteur.
    upgrade(J2) {
      const c2 = J2.createClient({ url: 'https://mock.test/mock', key: 'mock-publishable-key', fetchFn: (...a) => mock.fetchFn(...a), loadSession: async () => session, saveSession: async (x) => { session = x; }, now: () => now });
      const e2 = J2.createEngine({ client: c2, store });
      return { sync: () => e2.sync(), pending: () => [...ev.values()].filter(J2.isPending).length };
    },
  };
}
const ORIG = 'au parc pis il a crié je l\'ai pris dans mes bras finalement il s\'est calmé';
const structured = () => ({ type: 'crise', intensity: 'orange', note: ORIG, originalText: ORIG, context: 'Au parc.', childReaction: 'Il a crié.', intervention: 'Je l\'ai pris dans mes bras.', outcome: 'Finalement il s\'est calmé.', impressions: '', categories: ['emotions'], hasStructure: true, approveRequest: randomUUID() });

// ===== A. Base déjà migrée (script 04 exécuté) =====
const mock = createMock({ now: () => now });
const papa = phone(NEW, mock, 'Papa', 'papa@test.local');
const maman = phone(OLD, mock, 'Maman', 'maman@test.local');
await papa.login(); await maman.login();
const P = mock.users['papa@test.local'].id; const M = mock.users['maman@test.local'].id;

const e1 = papa.add(structured());
await papa.sync();
let s = mock.tables.events.get(e1.id);
check('0.4.0 : observation structurée envoyée et approuvée par Papa', s && s.outcome === 'Finalement il s\'est calmé.' && s.original_text === ORIG && s.approved_by === P && s.categories.join() === 'emotions');
check('0.4.0 : la demande d\'approbation est soldée', !papa.ev.get(e1.id).approveRequest && papa.ev.get(e1.id).approval && papa.ev.get(e1.id).approval.byId === P);
check('Nouvelle fiche : enregistrée (version 1) puis approuvée par une 2e requête séparée (version 2, approval_version 1)', s.version === 2 && s.approval_version === 1);
{
  const R = { Prefer: 'return=representation' };
  const direct = await papa.client.request('POST', '/rest/v1/events', { id: randomUUID(), date: '2026-11-16', type: 'autre', note: 'x', approval_version: 0 }, R);
  check('Envoi direct d\'une nouvelle fiche déjà approuvée : refusé par le serveur', direct.status === 400);
  const before = { ...mock.tables.events.get(e1.id) };
  const mixed = await papa.client.request('PATCH', `/rest/v1/events?id=eq.${e1.id}`, { note: 'changée', approval_version: before.version }, R);
  check('Approbation + modification dans une même requête : refusée, rien n\'est écrit', mixed.status === 400 && mock.tables.events.get(e1.id).version === before.version && mock.tables.events.get(e1.id).note === before.note);
}

await maman.sync();
const m1 = maman.ev.get(e1.id);
check('0.3.0 reçoit la fiche (champs qu\'elle connaît)', m1 && m1.note === ORIG && m1.context === 'Au parc.' && m1.intervention.includes('bras'));

maman.edit(e1.id, { note: ORIG + ' (note rapide complétée par Maman)' });
await maman.sync();
s = mock.tables.events.get(e1.id);
check('0.3.0 modifie la note : sections, catégories et original conservés, approbation retirée', s.outcome === 'Finalement il s\'est calmé.' && s.original_text === ORIG && s.categories.length === 1 && s.approved_at === null && s.approved_by === null);
await papa.sync();
check('0.4.0 reçoit la note de Maman sans rien perdre (fiche à approuver de nouveau)', papa.ev.get(e1.id).note.includes('Maman') && papa.ev.get(e1.id).outcome && papa.ev.get(e1.id).originalText === ORIG && !papa.ev.get(e1.id).approval);
papa.edit(e1.id, { approveRequest: randomUUID() });
await papa.sync(); await maman.sync();
check('Papa approuve de nouveau la version qui contient la note de Maman', mock.tables.events.get(e1.id).approved_by === P);
maman.edit(e1.id, { markedComplete: true });
await maman.sync();
check('0.3.0 coche « Fiche complète » : approbation gardée', mock.tables.events.get(e1.id).approved_by === P && mock.tables.events.get(e1.id).marked_complete === true);

maman.edit(e1.id, { context: 'Au parc, après le souper.' });
await maman.sync();
s = mock.tables.events.get(e1.id);
check('0.3.0 modifie une section : approbation retirée par le serveur, sections gardées', s.approved_at === null && s.context.includes('souper') && s.outcome && s.original_text === ORIG);
await papa.sync();
check('0.4.0 voit la fiche comme « non approuvée »', !papa.ev.get(e1.id).approval && papa.ev.get(e1.id).context.includes('souper'));

papa.edit(e1.id, { approveRequest: randomUUID() });
await papa.sync();
check('Papa approuve de nouveau : approuvée par Papa', mock.tables.events.get(e1.id).approved_by === P && papa.ev.get(e1.id).approval);

// Modifications simultanées : Papa (0.4.0) le résultat, Maman (0.3.0) la description
await maman.sync();
papa.edit(e1.id, { outcome: 'Il s\'est calmé après 5 minutes.', approveRequest: null });
maman.edit(e1.id, { description: 'Il ne voulait pas quitter les glissades.' });
await papa.sync(); await maman.sync();
const mc = maman.ev.get(e1.id);
check('Conflit détecté chez Maman (0.3.0)', !!mc.conflict);
await maman.engine.resolveEvent(e1.id, 'mine'); await maman.sync(); await papa.sync();
s = mock.tables.events.get(e1.id);
check('Conflit tranché par Maman (0.3.0) : le résultat de Papa n\'est pas effacé', s.outcome === 'Il s\'est calmé après 5 minutes.' && s.description === 'Il ne voulait pas quitter les glissades.' && s.original_text === ORIG);
check('… et Papa reçoit la version fusionnée', papa.ev.get(e1.id).description.includes('glissades') && papa.ev.get(e1.id).outcome.includes('5 minutes'));

// 0.3.0 ajoute une fiche ; 0.4.0 l'organise ensuite
const e2 = maman.add({ type: 'difficulte', note: 'Pleurs au coucher' });
await maman.sync(); await papa.sync();
const p2 = papa.ev.get(e2.id);
check('Fiche de 0.3.0 reçue en 0.4.0 (non structurée)', p2 && !NEW.usesStructure(p2) && p2.categories.length === 0);
papa.edit(e2.id, { originalText: 'Pleurs au coucher', childReaction: 'Pleurs au coucher.', categories: ['sommeil', 'emotions'], hasStructure: true, approveRequest: randomUUID() });
await papa.sync();
s = mock.tables.events.get(e2.id);
check('0.4.0 organise une ancienne fiche : original ajouté, catégories dans l\'ordre fixe, approuvée', s.original_text === 'Pleurs au coucher' && s.categories.join() === 'emotions,sommeil' && s.approved_by === P);
await maman.sync();
check('0.3.0 continue de voir la fiche', maman.ev.get(e2.id).childReaction === 'Pleurs au coucher.');

// Texte original verrouillé : une tentative de changement est refusée, mais rien n'est perdu
papa.edit(e2.id, { originalText: 'retouché', note: 'Pleurs au coucher (complété)' });
await papa.sync();
check('Changer le texte original : refusé, la fiche reste en attente avec un message', papa.ev.get(e2.id).syncError && NEW.isPending(papa.ev.get(e2.id)));
papa.edit(e2.id, { originalText: 'Pleurs au coucher' });
await papa.sync();
check('… corrigée : envoyée, la note complétée est gardée', !papa.ev.get(e2.id).syncError && mock.tables.events.get(e2.id).note.includes('complété'));

// Section modifiée pendant l'envoi d'une approbation : la modification n'est pas approuvée à l'insu du parent
const e3 = papa.add(structured());
const real = mock.fetchFn; let typed = false;
const wrapped = async (url, opts) => { const r = await real(url, opts); if (!typed && opts.method === 'POST' && url.includes('/events')) { typed = true; papa.edit(e3.id, { outcome: 'Modifié pendant l\'envoi', approveRequest: null }); } return r; };
const c2 = NEW.createClient({ url: 'https://mock.test/mock', key: 'mock-publishable-key', fetchFn: wrapped, loadSession: async () => (await papa.client.getSession()), saveSession: async () => {}, now: () => now });
await NEW.createEngine({ client: c2, store: papa.store }).sync();
s = mock.tables.events.get(e3.id);
check('Modifié pendant l\'envoi : gardé, et l\'approbation est retirée (à refaire)', s.outcome === 'Modifié pendant l\'envoi' && s.approved_at === null && !papa.ev.get(e3.id).approval);

// Conflit 0.4.0 ↔ 0.4.0 sur le texte original (ajouté des deux côtés) : rien n'est perdu
const papaB = phone(NEW, mock, 'Maman', 'maman@test.local'); await papaB.login(); await papaB.sync();
const e4 = maman.add({ type: 'autre', note: 'Ancienne fiche' }); await maman.sync(); await papa.sync(); await papaB.sync();
papa.edit(e4.id, { originalText: 'Version dictée par Papa', hasStructure: true });
papaB.edit(e4.id, { originalText: 'Version dictée par Maman', hasStructure: true });
await papa.sync(); await papaB.sync();
check('Texte original ajouté sur les deux téléphones : conflit', !!papaB.ev.get(e4.id).conflict);
await papaB.engine.resolveEvent(e4.id, 'mine'); await papaB.sync();
const b4 = papaB.ev.get(e4.id);
check('… « garder le mien » : l\'original du serveur reste, l\'autre texte est gardé en commentaire', !b4.syncError && mock.tables.events.get(e4.id).original_text === 'Version dictée par Papa' && b4.comments.some((c) => c.text.includes('Version dictée par Maman')), b4.syncError || '');

// Approbation dont la réponse se perd (réseau instable) : le nouvel essai ne crée pas une 2e approbation
await papa.sync();
const e5 = papa.add({ type: 'autre', note: 'Fiche à approuver', originalText: 'Fiche à approuver', hasStructure: true });
await papa.sync();
papa.edit(e5.id, { approveRequest: randomUUID() });
// on perd la réponse de la requête d'approbation (la 2e étape), pas celle de l'enregistrement
const realF = mock.fetchFn;
const dropApproval = async (url, opts) => { if (opts.body && JSON.parse(opts.body).approval_version !== undefined) { await realF(url, opts); throw new TypeError('Failed to fetch'); } return realF(url, opts); };
const cLost = NEW.createClient({ url: 'https://mock.test/mock', key: 'mock-publishable-key', fetchFn: dropApproval, loadSession: async () => (await papa.client.getSession()), saveSession: async () => {}, now: () => now });
try { await NEW.createEngine({ client: cLost, store: papa.store }).sync(); } catch (e) { /* réponse perdue */ }
const firstApproval = mock.tables.events.get(e5.id).approved_at;
now += 60000;
await papa.sync();
const s5 = mock.tables.events.get(e5.id);
check('Réponse perdue puis nouvel essai : une seule approbation (même date), rien en attente', firstApproval && s5.approved_at === firstApproval && s5.approved_by === P && !NEW.isPending(papa.ev.get(e5.id)) && papa.ev.get(e5.id).approval);

// --- Scénario 1 : approbation A, puis modification + approbation B, puis arrivée tardive de A ---
const REP = { Prefer: 'return=representation' };
const e6 = papa.add({ type: 'crise', note: 'Version A', originalText: 'Version A', hasStructure: true });
await papa.sync();
const vA = papa.ev.get(e6.id).syncVersion;
const lateA = { note: 'Version A', approval_version: vA }; // demande A, préparée sur la version vA (envoi retardé)
papa.edit(e6.id, { approveRequest: randomUUID() }); await papa.sync(); // A appliquée normalement
papa.edit(e6.id, { note: 'Version B', approveRequest: randomUUID() }); await papa.sync(); // B
const beforeLate = { ...mock.tables.events.get(e6.id) };
const late = await papa.client.request('PATCH', `/rest/v1/events?id=eq.${e6.id}`, lateA, REP); // pas de filtre de version : le pire cas
const afterLate = mock.tables.events.get(e6.id);
check('Scénario 1 : la demande A arrivée en retard est refusée en entier', late.status === 400 && /ancienne version/.test(late.data.message));
check('… la version B reste intacte et approuvée telle quelle (rien n\'est écrit)', afterLate.note === 'Version B' && afterLate.version === beforeLate.version && afterLate.approved_at === beforeLate.approved_at && afterLate.approved_by === P);
const replay = await papa.client.request('PATCH', `/rest/v1/events?id=eq.${e6.id}`, { approval_version: vA }, REP);
check('… et la même demande A rejouée encore : toujours refusée', replay.status === 400 && mock.tables.events.get(e6.id).version === beforeLate.version);

// --- Scénario 2 : approbation préparée sur une ancienne version, la fiche a changé entre-temps ---
await maman.sync();
mock.net.offline = true;
papa.edit(e6.id, { approveRequest: randomUUID(), outcome: 'Approuvé hors ligne par Papa' }); // Papa approuve hors ligne
try { await papa.sync(); } catch (e) { /* hors ligne */ }
mock.net.offline = false;
maman.edit(e6.id, { note: 'Version C (Maman, 0.3.0)' }); await maman.sync(); // la fiche change sur le serveur
await papa.sync();
let s6 = mock.tables.events.get(e6.id);
check('Scénario 2 : l\'approbation préparée sur l\'ancienne version n\'approuve PAS la version de Maman', s6.note === 'Version C (Maman, 0.3.0)' && s6.approved_at === null && s6.approved_by === null);
check('… Papa voit un conflit, sa version et sa demande d\'approbation sont gardées (rien de perdu)', !!papa.ev.get(e6.id).conflict && papa.ev.get(e6.id).approveRequest && papa.ev.get(e6.id).outcome.includes('hors ligne'));
const direct = await papa.client.request('PATCH', `/rest/v1/events?id=eq.${e6.id}`, { approval_version: s6.version - 1 }, REP);
check('… et même envoyée directement au serveur, une version périmée est refusée', direct.status === 400 && mock.tables.events.get(e6.id).approved_at === null);
await papa.engine.resolveEvent(e6.id, 'theirs'); await papa.sync();
s6 = mock.tables.events.get(e6.id);
check('… Papa garde la version de Maman : elle reste NON approuvée, la sienne est gardée en commentaire', s6.approved_at === null && s6.note.includes('Version C') && papa.ev.get(e6.id).comments.some((c) => c.text.includes('hors ligne')));
papa.edit(e6.id, { approveRequest: randomUUID() }); await papa.sync();
check('… puis Papa relit et approuve la version actuelle : acceptée', mock.tables.events.get(e6.id).approved_by === P && mock.tables.events.get(e6.id).note.includes('Version C'));

// Variante : Papa choisit « garder ma version » → sa version est enregistrée, mais NON approuvée (à relire)
mock.net.offline = true;
papa.edit(e6.id, { approveRequest: randomUUID(), outcome: 'Encore approuvé hors ligne' });
try { await papa.sync(); } catch (e) { /* hors ligne */ }
mock.net.offline = false;
await maman.sync(); maman.edit(e6.id, { note: 'Version D (Maman)' }); await maman.sync();
await papa.sync();
await papa.engine.resolveEvent(e6.id, 'mine'); await papa.sync();
s6 = mock.tables.events.get(e6.id);
check('Variante : « garder ma version » après conflit → enregistrée mais pas approuvée sans nouvelle relecture', s6.outcome === 'Encore approuvé hors ligne' && s6.approved_at === null && !papa.ev.get(e6.id).approveRequest);

// --- Jamais de faux succès : une approbation qui n'aboutit pas ne devient jamais « approuvée » dans le téléphone ---
{
  await papa.sync(); await maman.sync();
  const e7 = papa.add({ type: 'autre', note: 'Fiche F', originalText: 'Fiche F', hasStructure: true });
  await papa.sync(); await maman.sync();
  // a) Maman modifie la fiche juste entre l'enregistrement et l'approbation de Papa
  papa.edit(e7.id, { approveRequest: randomUUID() });
  const real7 = mock.fetchFn; let raced = false;
  const race = async (url, opts) => { if (!raced && opts.body && JSON.parse(opts.body).approval_version !== undefined) { raced = true; await maman.client.request('PATCH', `/rest/v1/events?id=eq.${e7.id}`, { note: 'Fiche F (Maman)' }, { Prefer: 'return=representation' }); } return real7(url, opts); };
  const cRace = NEW.createClient({ url: 'https://mock.test/mock', key: 'mock-publishable-key', fetchFn: race, loadSession: async () => (await papa.client.getSession()), saveSession: async () => {}, now: () => now });
  await NEW.createEngine({ client: cRace, store: papa.store }).sync();
  let p7 = papa.ev.get(e7.id);
  check('Approbation devancée par une modification : PAS approuvée dans le téléphone (conflit affiché, demande en attente)', !p7.approval && !!p7.conflict && !!p7.approveRequest && mock.tables.events.get(e7.id).approved_at === null);
  await papa.engine.resolveEvent(e7.id, 'theirs'); await papa.sync();
  p7 = papa.ev.get(e7.id);
  check('… après le choix de version : non approuvée, aucune demande cachée', !p7.approval && !p7.approveRequest && mock.tables.events.get(e7.id).approved_at === null);
  // b) Le serveur refuse l'approbation (erreur) : message visible, rien d'approuvé, nouvel essai possible
  papa.edit(e7.id, { approveRequest: randomUUID() });
  const refuse = async (url, opts) => (opts.body && JSON.parse(opts.body).approval_version !== undefined ? { ok: false, status: 400, text: async () => JSON.stringify({ code: 'P0001', message: 'Approbation refusée : test' }) } : mock.fetchFn(url, opts));
  const cRef = NEW.createClient({ url: 'https://mock.test/mock', key: 'mock-publishable-key', fetchFn: refuse, loadSession: async () => (await papa.client.getSession()), saveSession: async () => {}, now: () => now });
  await NEW.createEngine({ client: cRef, store: papa.store }).sync();
  p7 = papa.ev.get(e7.id);
  check('Approbation refusée par le serveur : message gardé, PAS approuvée, demande gardée (rien de perdu)', /Approbation refusée/.test(p7.syncError || '') && !p7.approval && !!p7.approveRequest && mock.tables.events.get(e7.id).approved_at === null);
  await papa.sync();
  p7 = papa.ev.get(e7.id);
  check('… au nouvel essai qui réussit : approuvée seulement quand le serveur le confirme', p7.approval && p7.approval.byId === P && !p7.approveRequest && !p7.syncError && mock.tables.events.get(e7.id).approved_by === P);
}

// ===== B. Nouvelle version publiée AVANT le script 04 (mauvais ordre) =====
const mock3 = createMock({ now: () => now, schema: 3 });
const papa3 = phone(NEW, mock3, 'Papa', 'papa@test.local'); await papa3.login();
const f1 = papa3.add({ type: 'reussite', note: 'Fiche simple' });
const f2 = papa3.add(structured());
await papa3.sync();
check('Sans script 04 : les fiches simples sont quand même envoyées', mock3.tables.events.has(f1.id) && !NEW.isPending(papa3.ev.get(f1.id)));
check('Sans script 04 : la fiche structurée reste dans le téléphone avec un message (rien de perdu)', !mock3.tables.events.has(f2.id) && NEW.isPending(papa3.ev.get(f2.id)) && /column/.test(papa3.ev.get(f2.id).syncError || ''));
mock3.opt.schema = 4; // le script 04 est exécuté
papa3.edit(f2.id, {}); // nouvel essai (comme « Synchroniser maintenant »)
await papa3.sync();
check('Après le script 04 : la fiche structurée est envoyée et approuvée', mock3.tables.events.get(f2.id) && mock3.tables.events.get(f2.id).original_text === ORIG && mock3.tables.events.get(f2.id).approved_by === P);

// ===== D. Mise à jour 0.3.0 → 0.4.0 avec des données hors ligne pas encore envoyées =====
{
  const mockD = createMock({ now: () => now });
  const mom = phone(OLD, mockD, 'Maman', 'maman@test.local'); await mom.login();
  const synced = mom.add({ type: 'difficulte', note: 'Déjà envoyée' }); await mom.sync();
  // Hors ligne en 0.3.0 : une nouvelle fiche, une modification, une journée notée
  const off1 = mom.add({ type: 'crise', intensity: 'rouge', note: 'Écrite hors ligne en 0.3.0', comments: [] });
  mom.edit(synced.id, { note: 'Modifiée hors ligne en 0.3.0' });
  mom.store.putDay({ id: randomUUID(), kind: 'day', date: '2026-11-16', rating: 'jaune', belle: false, dirty: true, rev: 1 });
  check('Avant la mise à jour : 3 changements en attente dans le téléphone (0.3.0)', [...mom.ev.values()].filter(OLD.isPending).length === 2 && OLD.isPending(mom.store.getDay('2026-11-16')));
  const up = mom.upgrade(NEW); // l'app passe en 0.4.0 : stockage local inchangé
  await up.sync();
  const sv1 = mockD.tables.events.get(off1.id), sv2 = mockD.tables.events.get(synced.id), sd = mockD.tables.days.get('2026-11-16');
  check('Après la mise à jour : la fiche écrite hors ligne est envoyée intacte', sv1 && sv1.note === 'Écrite hors ligne en 0.3.0' && sv1.intensity === 'rouge');
  check('… la modification hors ligne est envoyée', sv2 && sv2.note === 'Modifiée hors ligne en 0.3.0');
  check('… la journée notée hors ligne est envoyée', sd && sd.rating === 'jaune');
  check('… plus rien en attente, aucune erreur', up.pending() === 0 && !NEW.isPending(mom.store.getDay('2026-11-16')) && ![...mom.ev.values()].some((e) => e.syncError || e.conflict));
}

const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} tests réussis`);
process.exit(ok === results.length ? 0 : 1);
