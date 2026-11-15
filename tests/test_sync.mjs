// Tests automatiques de la synchronisation (deux « téléphones » fictifs + faux serveur).
// Lancer : node tests/test_sync.mjs
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { createMock } from './mock-supabase.mjs';
const require = createRequire(import.meta.url);
const J = require('../js/sync.js');

let now = Date.parse('2026-11-12T15:00:00Z');
const mock = createMock({ now: () => now });
const results = [];
const check = (name, cond, extra = '') => { results.push([name, !!cond]); console.log((cond ? 'OK    ' : 'ÉCHEC ') + name + (cond || !extra ? '' : '  → ' + extra)); };

function phone(label) {
  const ev = new Map(); const dy = new Map();
  let state = {}; let session = null;
  const store = {
    names: {},
    events: () => ev.values(), getEvent: (id) => ev.get(id), putEvent: async (e) => { ev.set(e.id, e); }, removeEvent: async (id) => { ev.delete(id); },
    days: () => dy.values(), getDay: (d) => dy.get(d), putDay: async (d) => { dy.set(d.date, d); },
    getState: () => state, setState: async (s) => { state = s; },
    myName: () => store.names[session && session.user.id] || label, uid: randomUUID, now: () => now,
  };
  const client = J.createClient({ url: 'https://mock.test/mock', key: 'mock-publishable-key', fetchFn: mock.fetchFn, loadSession: async () => session, saveSession: async (s) => { session = s; }, now: () => now });
  const engine = J.createEngine({ client, store });
  const P = {
    label, store, client, engine, ev, dy,
    session: () => session,
    add(fields) { const e = { id: randomUUID(), kind: 'event', date: '2026-11-12', time: '16:05', type: null, intensity: null, note: '', comments: [], createdAt: new Date(now).toISOString(), ...fields, dirty: true, rev: 1 }; ev.set(e.id, e); return e; },
    edit(id, fields) { const e = ev.get(id); Object.assign(e, fields); e.dirty = true; e.rev = (e.rev || 0) + 1; return e; },
    comment(id, text) { const e = ev.get(id); e.comments = [...(e.comments || []), { id: randomUUID(), author: label, text, at: new Date(now).toISOString(), pending: true }]; },
    setDay(date, fields) { const d = dy.get(date) || { id: 'day-' + date, kind: 'day', date, rating: null, belle: false }; Object.assign(d, fields); d.dirty = true; d.rev = (d.rev || 0) + 1; dy.set(date, d); return d; },
    pending: () => [...ev.values(), ...dy.values()].filter(J.isPending).length + [...ev.values()].reduce((n, e) => n + (e.comments || []).filter((c) => c.pending).length, 0),
  };
  return P;
}

async function expectError(p, kind) { try { await p.engine.sync(); return false; } catch (e) { return e.kind === kind ? true : e.kind + ' ' + e.message; } }

const papa = phone('Papa'); const maman = phone('Maman');

// 1. Connexion
let bad = false; try { await papa.client.signIn('papa@test.local', 'mauvais'); } catch (e) { bad = e.kind === 'credentials'; }
check('Mauvais mot de passe refusé', bad);
await papa.client.signIn('papa@test.local', 'motdepasse-test');
await maman.client.signIn('maman@test.local', 'motdepasse-test');
check('Connexion Papa et Maman', papa.session() && maman.session());

// 2. Hors ligne puis retour du réseau
mock.net.offline = true;
const e1 = papa.add({ type: 'crise', intensity: 'orange', note: '[Exemple] Refus de quitter le parc', place: 'Parc', duration: '10' });
check('Hors ligne : la synchro signale « offline »', (await expectError(papa, 'offline')) === true);
check('Hors ligne : l\'observation reste en attente', papa.pending() === 1 && papa.ev.get(e1.id).dirty);
mock.net.offline = false;
await papa.engine.sync();
const s1 = mock.tables.events.get(e1.id);
check('Retour du réseau : envoyée au serveur', !!s1 && s1.note === '[Exemple] Refus de quitter le parc' && s1.duration_min === 10);
check('Auteur fixé par le serveur = Papa', s1.author_id === mock.users['papa@test.local'].id);
check('Plus rien en attente chez Papa', papa.pending() === 0, String(papa.pending()));

// 3. Réception chez Maman
await maman.engine.sync();
const m1 = maman.ev.get(e1.id);
check('Maman reçoit l\'observation', m1 && m1.note === s1.note && m1.place === 'Parc' && m1.duration === '10');
check('Maman voit « Papa » comme auteur', m1 && m1.author === 'Papa');

// 4. Réponse perdue en route : pas de doublon
const e2 = papa.add({ type: 'reussite', note: '[Exemple] A dit « je suis fâché »' });
mock.net.dropResponses = 1;
check('Réponse perdue : erreur réseau signalée', (await expectError(papa, 'offline')) === true);
check('Réponse perdue : toujours en attente', J.isPending(papa.ev.get(e2.id)));
await papa.engine.sync();
check('Renvoi après réponse perdue : une seule copie, plus en attente', mock.tables.events.size === 2 && !J.isPending(papa.ev.get(e2.id)));

// 5. Commentaires des deux parents en même temps (hors ligne)
await maman.engine.sync();
papa.comment(e1.id, '[Exemple] Commentaire de Papa');
maman.comment(e1.id, '[Exemple] Commentaire de Maman');
await papa.engine.sync(); await maman.engine.sync(); await papa.engine.sync();
const cp = papa.ev.get(e1.id).comments.map((c) => c.text); const cm = maman.ev.get(e1.id).comments.map((c) => c.text);
check('Les 2 commentaires sont gardés chez les deux', cp.length === 2 && cm.length === 2 && cp.every((t) => cm.includes(t)), JSON.stringify([cp, cm]));

// 6. Modification de la même fiche en même temps → conflit, rien de perdu (on garde l'autre)
papa.edit(e1.id, { note: '[Exemple] Version Papa' });
maman.edit(e1.id, { note: '[Exemple] Version Maman', helped: 'Câlin' });
await papa.engine.sync();
await maman.engine.sync();
const mc = maman.ev.get(e1.id);
check('Conflit détecté chez Maman', !!mc.conflict && mc.note === '[Exemple] Version Maman');
check('Pendant le conflit, la saisie de Maman n\'est pas écrasée sur le serveur', mock.tables.events.get(e1.id).note === '[Exemple] Version Papa');
await maman.engine.resolveEvent(e1.id, 'theirs');
await maman.engine.sync(); await papa.engine.sync();
const lostMsg = papa.ev.get(e1.id).comments.find((c) => c.text.includes('Version non retenue'));
check('« Garder l\'autre » : la version de Maman est gardée en commentaire', lostMsg && lostMsg.text.includes('Version Maman') && lostMsg.text.includes('Câlin'), JSON.stringify(papa.ev.get(e1.id).comments));
check('Les deux téléphones ont la même fiche', papa.ev.get(e1.id).note === maman.ev.get(e1.id).note && maman.ev.get(e1.id).note === '[Exemple] Version Papa');

// 7. Conflit, cette fois on garde la sienne
papa.edit(e2.id, { note: '[Exemple] B Papa' });
maman.edit(e2.id, { note: '[Exemple] B Maman' });
await papa.engine.sync(); await maman.engine.sync();
await maman.engine.resolveEvent(e2.id, 'mine');
await maman.engine.sync(); await papa.engine.sync();
const pe2 = papa.ev.get(e2.id);
check('« Garder la mienne » : la version de Maman gagne partout', pe2.note === '[Exemple] B Maman' && mock.tables.events.get(e2.id).note === '[Exemple] B Maman');
check('… et la version de Papa est gardée en commentaire', (pe2.comments || []).some((c) => c.text.includes('B Papa')));

// 8. Journées : même jour noté différemment
papa.setDay('2026-11-11', { rating: 'jaune' });
maman.setDay('2026-11-11', { rating: 'rouge' });
await papa.engine.sync(); await maman.engine.sync();
check('Conflit sur la couleur d\'une journée détecté', !!maman.dy.get('2026-11-11').conflict);
await maman.engine.resolveDay('2026-11-11', 'mine');
await maman.engine.sync(); await papa.engine.sync();
check('Journée résolue : rouge partout', papa.dy.get('2026-11-11').rating === 'rouge' && mock.tables.days.get('2026-11-11').rating === 'rouge');
papa.setDay('2026-11-10', { rating: 'vert', belle: true });
await papa.engine.sync(); await maman.engine.sync();
check('Belle journée synchronisée', maman.dy.get('2026-11-10') && maman.dy.get('2026-11-10').belle === true);

// 9. Fiche refusée par le serveur : erreur visible, rien de perdu
const e3 = papa.add({ date: '2025-06-01', type: 'autre', note: '[Exemple] date trop ancienne' });
await papa.engine.sync();
check('Fiche refusée : message d\'erreur gardé et toujours en attente', papa.ev.get(e3.id).syncError && J.isPending(papa.ev.get(e3.id)));
papa.edit(e3.id, { date: '2026-06-01' });
await papa.engine.sync();
check('Corrigée : envoyée', !J.isPending(papa.ev.get(e3.id)) && !papa.ev.get(e3.id).syncError);

// 10. Jeton expiré → renouvelé automatiquement
mock.expireTokens();
papa.edit(e3.id, { note: '[Exemple] après expiration' });
await papa.engine.sync();
check('Jeton expiré : renouvelé, envoi réussi', mock.tables.events.get(e3.id).note === '[Exemple] après expiration');

// 11. Session révoquée : données gardées en attente
const papaSess = papa.session();
papaSess.refresh_token = 'invalide'; papaSess.expires_at = 0;
papa.edit(e3.id, { note: '[Exemple] pendant déconnexion' });
check('Session invalide : demande de reconnexion', (await expectError(papa, 'auth')) === true);
check('… et la modification reste en attente', J.isPending(papa.ev.get(e3.id)));
await papa.client.signIn('papa@test.local', 'motdepasse-test');
await papa.engine.sync();
check('Après reconnexion : envoyée', mock.tables.events.get(e3.id).note === '[Exemple] pendant déconnexion');

// 12. Compte non autorisé
const intrus = phone('Intrus');
await intrus.client.signIn('intrus@test.local', 'motdepasse-test');
intrus.add({ type: 'autre', note: '[Exemple] intrus' });
check('Compte non parent : refusé', (await expectError(intrus, 'denied')) === true);
check('… le serveur n\'a rien reçu de lui', [...mock.tables.events.values()].every((r) => !r.note.includes('intrus')));

// 13. Corbeille : synchronisée, puis effacée après 30 jours
papa.edit(e3.id, { deletedAt: new Date(now).toISOString() });
await papa.engine.sync(); await maman.engine.sync();
check('Suppression (corbeille) synchronisée chez Maman', !!maman.ev.get(e3.id).deletedAt);
now += 31 * 864e5;
await papa.engine.sync();
check('Après 30 jours : effacée du serveur et du téléphone de Papa', !mock.tables.events.has(e3.id) && !papa.ev.has(e3.id));
await maman.engine.sync();
check('… puis du téléphone de Maman', !maman.ev.has(e3.id));
check('Les autres observations sont intactes', mock.tables.events.size === 2 && maman.ev.size === 2 && papa.ev.size === 2);

// 14. Modification pendant l'envoi : rien de perdu
const e4 = papa.add({ type: 'autre', note: '[Exemple] v1' });
// on modifie la fiche entre l'envoi et la réponse du serveur
const realFetch = mock.fetchFn;
let typed = false;
const wrapped = async (url, opts) => { const r = await realFetch(url, opts); if (!typed && opts.method === 'POST' && url.includes('/events')) { typed = true; papa.edit(e4.id, { note: '[Exemple] v2 tapée pendant l\'envoi' }); } return r; };
const papa2Client = J.createClient({ url: 'https://mock.test/mock', key: 'mock-publishable-key', fetchFn: wrapped, loadSession: async () => papa.session(), saveSession: async () => {}, now: () => now });
await J.createEngine({ client: papa2Client, store: papa.store }).sync();
check('Texte tapé pendant l\'envoi : gardé et envoyé', papa.ev.get(e4.id).note.includes('v2') && mock.tables.events.get(e4.id).note.includes('v2') && !J.isPending(papa.ev.get(e4.id)));

const fails = results.filter((r) => !r[1]).length;
console.log(`\n${results.length - fails}/${results.length} tests réussis`);
process.exit(fails ? 1 : 0);
