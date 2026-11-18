// Vérifie les scripts SQL sur une vraie base PostgreSQL locale (PGlite), sans toucher à Supabase.
// Données fictives uniquement. Imite le strict nécessaire de Supabase : rôles anon/authenticated,
// auth.users et auth.uid().
// Lancer : PGLITE=<dossier contenant node_modules/@electric-sql/pglite> node tests/test_sql.mjs
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const base = process.env.PGLITE;
if (!base) { console.log('Indiquez PGLITE=<dossier où @electric-sql/pglite est installé>'); process.exit(2); }
const { PGlite } = await import(pathToFileURL(join(base, 'node_modules/@electric-sql/pglite/dist/index.js')).href);
const sql = async (f) => readFile(join(here, '..', 'supabase', f), 'utf8');

const results = [];
const check = (name, cond, extra = '') => { results.push(!!cond); console.log((cond ? 'OK    ' : 'ÉCHEC ') + name + (cond || !extra ? '' : '  → ' + extra)); };

const db = new PGlite();
const PAPA = '11111111-1111-4111-8111-111111111111';
const MAMAN = '22222222-2222-4222-8222-222222222222';
const INTRUS = '33333333-3333-4333-8333-333333333333';

// --- Imitation minimale de Supabase, puis étapes 1 et 2 ---
async function setup(d) {
  await d.exec(`
    create role anon nologin; create role authenticated nologin;
    grant usage on schema public to anon, authenticated;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    insert into auth.users values ('${PAPA}', 'papa@test.local'), ('${MAMAN}', 'maman@test.local');
  `);
  await d.exec(await sql('01-tables-et-securite.sql'));
  await d.exec(await sql('02-corbeille-protegee.sql'));
  await d.exec(`insert into auth.users values ('${INTRUS}', 'intrus@test.local');`);
}
await setup(db);

// --- La garde du script 04 annule tout si une règle d'accès changeait pendant la migration ---
{
  const g = new PGlite(); await setup(g);
  await g.exec(`select set_config('request.jwt.claim.sub', '${PAPA}', false); insert into public.events (id, date, note) values ('cccccccc-0000-4000-8000-000000000001', '2026-11-10', '[Exemple] avant'); select set_config('request.jwt.claim.sub', '', false);`);
  const bad = (await sql('04-observations-structurees.sql')).replace('-- 4. Vérification', 'drop policy "days_lecture" on public.days;\n-- 4. Vérification');
  let err = null; try { await g.exec(bad); } catch (e) { err = e.message; }
  try { await g.exec('rollback'); } catch (e) { /* déjà annulé */ }
  const cols = (await g.query(`select count(*)::int as n from information_schema.columns where table_schema='public' and table_name='events' and column_name='original_text'`)).rows[0].n;
  const pol = (await g.query(`select count(*)::int as n from pg_policies where schemaname='public'`)).rows[0].n;
  check('Garde : une règle d\'accès modifiée pendant la migration → tout est annulé', /règles d'accès/.test(err || '') && cols === 0 && pol === 10, `${err} / colonnes ${cols} / règles ${pol}`);
  const bad2 = (await sql('04-observations-structurees.sql')).replace('-- 4. Vérification', "update public.events set note = 'modifiée en douce';\n-- 4. Vérification");
  err = null; try { await g.exec(bad2); } catch (e) { err = e.message; }
  try { await g.exec('rollback'); } catch (e) { /* déjà annulé */ }
  const n = (await g.query(`select note from public.events`)).rows;
  check('Garde : une observation modifiée pendant la migration → tout est annulé', /données existantes/.test(err || '') && n.every((r) => r.note !== 'modifiée en douce'), err || '');
  for (const t of ['parents', 'days', 'events', 'comments']) {
    const bad3 = (await sql('04-observations-structurees.sql')).replace('-- 4. Vérification', `alter table public.${t} disable row level security;\n-- 4. Vérification`);
    err = null; try { await g.exec(bad3); } catch (e) { err = e.message; }
    try { await g.exec('rollback'); } catch (e) { /* déjà annulé */ }
    const on = (await g.query(`select relrowsecurity as on from pg_class where oid = 'public.${t}'::regclass`)).rows[0].on;
    check(`Garde : RLS désactivé sur « ${t} » pendant la migration → tout est annulé`, /règles d'accès/.test(err || '') && on === true, `${err} / rls ${on}`);
  }
  // Le RLS doit être actif sur les 4 tables, même s'il était déjà désactivé avant la migration
  await g.exec('alter table public.comments disable row level security;');
  err = null; try { await g.exec(await sql('04-observations-structurees.sql')); } catch (e) { err = e.message; }
  try { await g.exec('rollback'); } catch (e) { /* déjà annulé */ }
  check('Garde : RLS déjà absent sur une table → migration refusée', /RLS n'est pas actif/.test(err || ''), err || 'acceptée !');
  await g.exec('alter table public.comments enable row level security;');
  await g.close();
}

// Exécute une requête « en tant que » un compte (comme l'API de Supabase)
async function as(uid, q, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid || ''}', false); set role ${uid ? 'authenticated' : 'anon'};`);
  try { return { ok: true, rows: (await db.query(q, params)).rows }; }
  catch (e) { return { ok: false, error: e.message }; }
  finally { await db.exec('reset role;'); }
}

// --- Données « phase 3 » existantes avant la migration ---
const ids = ['aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000003'];
await as(PAPA, `insert into public.events (id, date, time, type, intensity, note, context, description, intervention, place, duration_min) values ($1, '2026-11-10', '16:05', 'crise', 'orange', '[Exemple] Refus de quitter le parc', 'Au parc', 'Cris', 'Accompagner', 'Parc', 10)`, [ids[0]]);
await as(MAMAN, `insert into public.events (id, date, type, note) values ($1, '2026-11-11', 'reussite', '[Exemple] A partagé ses blocs')`, [ids[1]]);
await as(PAPA, `insert into public.events (id, date, type, note) values ($1, '2026-11-12', 'difficulte', '[Exemple] À la corbeille')`, [ids[2]]);
await as(PAPA, `update public.events set deleted_at = now() where id = $1`, [ids[2]]);
await as(MAMAN, `update public.events set note = '[Exemple] Refus de quitter le parc (modifié)' where id = $1`, [ids[0]]);
await as(PAPA, `insert into public.comments (id, event_id, text) values (gen_random_uuid(), $1, '[Exemple] commentaire')`, [ids[0]]);
await as(PAPA, `insert into public.days (date, rating) values ('2026-11-10', 'orange')`);
const OLD = 'id, date, time, type, intensity, note, duration_min, place, people, state_before, context, description, adult_reaction, intervention, child_reaction, calm_time_min, helped, extra, marked_complete, author_id, created_at, updated_at, updated_by, version, deleted_at';
const snap = async () => JSON.stringify((await db.query(`select ${OLD} from public.events order by id`)).rows);
const before = await snap();
const beforeDays = JSON.stringify((await db.query('select * from public.days')).rows);
const beforeCm = JSON.stringify((await db.query('select * from public.comments')).rows);

// --- Migration 04 ---
let migr = true; try { await db.exec(await sql('04-observations-structurees.sql')); } catch (e) { migr = e.message; }
check('Le script 04 s\'exécute sans erreur', migr === true, String(migr));
check('Observations existantes intactes (même nombre, même contenu)', (await snap()) === before);
check('Journées et commentaires intacts', JSON.stringify((await db.query('select * from public.days')).rows) === beforeDays && JSON.stringify((await db.query('select * from public.comments')).rows) === beforeCm);
const nw = (await db.query(`select categories, outcome, impressions, original_text, approved_at, approved_by from public.events`)).rows;
check('Anciennes observations : nouvelles colonnes vides, catégories = liste vide', nw.every((r) => Array.isArray(r.categories) && r.categories.length === 0 && r.outcome === null && r.original_text === null && r.approved_at === null));
const v = (await db.query(`select (select count(*) from information_schema.columns where table_schema='public' and table_name='events' and column_name in ('outcome','impressions','original_text','categories','approval_version','approved_at','approved_by'))::int as c, (select count(*) from pg_trigger where tgname='events_approval')::int as t, (select count(*) from pg_policies where schemaname='public')::int as p, (select count(*) from pg_class where relnamespace='public'::regnamespace and relrowsecurity and relname in ('parents','days','events','comments'))::int as rls`)).rows[0];
check('Vérification finale : 7 colonnes, 1 déclencheur, 10 règles RLS, RLS actif sur les 4 tables', v.c === 7 && v.t === 1 && v.p === 10 && v.rls === 4, JSON.stringify(v));
let again = true; try { await db.exec(await sql('04-observations-structurees.sql')); } catch (e) { again = e.message; }
check('Le script 04 peut être relancé sans risque', again === true && (await snap()) === before, String(again));
// Avec WITH05=1 : toute la suite du script 04 est rejouée APRÈS l'installation du script 05 (mode souple),
// pour vérifier que les nouveaux déclencheurs ne changent rien aux règles d'approbation et de version.
const WITH05 = !!process.env.WITH05;
if (WITH05) { let m5 = true; try { await db.exec(await sql('05-verification-des-versions.sql')); } catch (e) { m5 = e.message; } check('[avec le script 05] Le script 05 s\'exécute sans erreur', m5 === true && (await snap()) === before, String(m5)); }

// --- Approbation contrôlée par le serveur ---
const N = 'bbbbbbbb-0000-4000-8000-000000000001';
const curV = async (id) => (await db.query(`select version from public.events where id = $1`, [id])).rows[0].version;
const rowOf = async (id) => (await db.query(`select note, version, approved_at, approved_by, approval_version, outcome from public.events where id = $1`, [id])).rows[0];
// Point 5 : une nouvelle fiche ne peut pas être approuvée à l'envoi
let r = await as(PAPA, `insert into public.events (id, date, type, note, approval_version) values (gen_random_uuid(), '2026-11-13', 'crise', 'x', 0)`);
check('Nouvelle fiche envoyée avec une approbation : REFUSÉE (enregistrer d\'abord)', !r.ok && /d'abord être enregistrée/.test(r.error), r.error || 'acceptée !');
r = await as(PAPA, `insert into public.events (id, date, type, note, original_text, context, description, categories, approved_at, approved_by) values ($1, '2026-11-13', 'crise', 'Il a crié', 'il a crié pis je l''ai consolé', 'Au parc', 'Il a crié', '{emotions}', '2020-01-01', $2) returning *`, [N, MAMAN]);
let row = r.ok && r.rows[0];
check('Nouvelle fiche enregistrée : non approuvée (approved_at / approved_by envoyés ignorés)', row && row.approved_at === null && row.approved_by === null && row.version === 1, r.error || JSON.stringify(row));
r = await as(PAPA, `update public.events set approval_version = $2 where id = $1 returning approved_at, approved_by, approval_version, version`, [N, 1]);
row = r.ok && r.rows[0];
check('… puis approbation séparée, après relecture : acceptée (heure du serveur, parent connecté)', row && row.approved_by === PAPA && new Date(row.approved_at) > new Date('2026-01-01') && row.approval_version === 1, r.error || '');
// Point 3 : une approbation réussie augmente la version UNE seule fois
check('Une approbation réussie augmente la version une seule fois (1 → 2)', row && row.version === 2, JSON.stringify(row));
// Point 2 : ordre des déclencheurs
const trg = (await db.query(`select tgname from pg_trigger where tgrelid = 'public.events'::regclass and not tgisinternal order by tgname`)).rows.map((x) => x.tgname);
check('Ordre des déclencheurs (alphabétique, règle PostgreSQL) : events_approval puis events_stamp', JSON.stringify(trg) === JSON.stringify(WITH05 ? ['events_approval', 'events_base', 'events_stamp'] : ['events_approval', 'events_stamp']), trg.join(', '));
r = await as(PAPA, `update public.events set approved_by = $2 where id = $1 returning approved_by, approved_at`, [N, MAMAN]);
check('Impossible de changer l\'auteur de l\'approbation', r.ok && r.rows[0].approved_by === PAPA && r.rows[0].approved_at !== null, r.error || JSON.stringify(r.rows));
r = await as(PAPA, `update public.events set approved_at = '2030-01-01' where id = $1 returning approved_at`, [N]);
check('Impossible d\'inventer une date d\'approbation (valeur ignorée)', r.ok && new Date(r.rows[0].approved_at) < new Date('2029-01-01'));
r = await as(PAPA, `update public.events set approved_at = null, approved_by = null where id = $1 returning approved_at`, [N]);
check('Effacer approved_at sans changer le contenu : ignoré (seul le serveur l\'écrit)', r.ok && r.rows[0].approved_at !== null);
r = await as(MAMAN, `update public.events set outcome = 'Il s''est calmé' where id = $1 returning approved_by, approved_at, version`, [N]);
check('Section modifiée sans approbation : approbation retirée', r.ok && r.rows[0].approved_at === null && r.rows[0].approved_by === null, r.error || JSON.stringify(r.rows));
r = await as(MAMAN, `update public.events set approval_version = version where id = $1 returning approved_by, approved_at`, [N]);
check('Demande seule sur la version actuelle : approuvé par Maman, à l\'heure du serveur', r.ok && r.rows[0].approved_by === MAMAN && new Date(r.rows[0].approved_at) < new Date('2029-01-01'), r.error || JSON.stringify(r.rows));
// Point 1 : une approbation ne peut pas modifier le contenu
const beforeMix = await rowOf(N);
for (const [label, set] of [['les catégories', `categories = '{emotions,comportements}'`], ['la note', `note = 'Note changée'`], ['une section', `outcome = 'Autre résultat'`], ['l\'heure', `time = '18:00'`]]) {
  r = await as(PAPA, `update public.events set ${set}, approval_version = version where id = $1 returning approved_at`, [N]);
  check(`Approbation + modification de ${label} dans la même requête : REFUSÉE, rien n'est écrit`, !r.ok && /ne peut pas modifier/.test(r.error) && JSON.stringify(await rowOf(N)) === JSON.stringify(beforeMix), r.error || 'acceptée !');
}
r = await as(PAPA, `update public.events set note = note, outcome = outcome, approval_version = version where id = $1 returning approved_by`, [N]);
check('Approbation avec les mêmes valeurs renvoyées (aucun changement réel) : acceptée', r.ok && r.rows[0].approved_by === PAPA, r.error || '');
r = await as(PAPA, `update public.events set marked_complete = true, approval_version = version where id = $1 returning approved_by`, [N]);
check('Approbation + case « Fiche complète » (hors contenu) : acceptée', r.ok && r.rows[0].approved_by === PAPA, r.error || '');

// Point 4 : deux approbations simultanées sur la même version (les deux parents en même temps)
const vSim = await curV(N);
const sim1 = await as(PAPA, `update public.events set approval_version = $2 where id = $1 returning approved_by, version`, [N, vSim]);
const afterSim1 = await rowOf(N);
const sim2 = await as(MAMAN, `update public.events set approval_version = $2 where id = $1 returning approved_by, approved_at`, [N, vSim]);
check('Approbations simultanées sur la même version : la 1re approuve, la 2e ne crée AUCUNE nouvelle approbation', sim1.ok && sim1.rows[0].version === vSim + 1 && sim2.ok && sim2.rows[0].approved_by === PAPA && String(sim2.rows[0].approved_at) === String(afterSim1.approved_at), sim2.error || JSON.stringify(sim2.rows));
const sim3 = await as(MAMAN, `update public.events set approval_version = $2 where id = $1`, [N, vSim - 1]);
check('… une demande simultanée préparée sur une version encore plus ancienne : refusée', !sim3.ok && /ancienne version/.test(sim3.error));
// Avec le filtre de version utilisé par l'application, la 2e demande ne touche même pas la fiche
const vNow = await curV(N);
const sim4 = await as(MAMAN, `update public.events set approval_version = $2 where id = $1 and version = $2 returning id`, [N, vSim]);
check('… et avec le filtre de version de l\'app, la 2e demande ne modifie rien (0 ligne)', sim4.ok && sim4.rows.length === 0 && (await curV(N)) === vNow && (await rowOf(N)).approved_by === PAPA);
// Simultané : une modification et une approbation préparées sur la même version
const vMix = await curV(N);
const m1 = await as(MAMAN, `update public.events set note = 'Modifiée par Maman' where id = $1 returning version`, [N]);
const m2 = await as(PAPA, `update public.events set approval_version = $2 where id = $1`, [N, vMix]);
check('Modification et approbation simultanées : l\'approbation arrivée après est refusée, la modification reste non approuvée', m1.ok && !m2.ok && (await rowOf(N)).approved_at === null && (await rowOf(N)).note === 'Modifiée par Maman');

// ---- Scénario 1 (revue précédente) : approbation A, modification puis approbation B, arrivée tardive de A ----
const S1 = 'bbbbbbbb-0000-4000-8000-000000000003';
await as(PAPA, `insert into public.events (id, date, type, note, original_text) values ($1, '2026-11-14', 'crise', 'Version A', 'Récit A')`, [S1]);
const vA = await curV(S1);
r = await as(PAPA, `update public.events set approval_version = $2 where id = $1 returning approved_at, approval_version`, [S1, vA]); // demande A
check('Scénario 1 : la demande A (seule, sur la version actuelle) est approuvée', r.ok && r.rows[0].approved_at !== null && r.rows[0].approval_version === vA, r.error || '');
await as(MAMAN, `update public.events set note = 'Version B' where id = $1`, [S1]); // modification B (enregistrée)
const vB = await curV(S1);
r = await as(MAMAN, `update public.events set approval_version = $2 where id = $1 returning approved_at, approved_by`, [S1, vB]); // demande B, après relecture
check('… modification B enregistrée puis approuvée séparément par Maman', r.ok && r.rows[0].approved_by === MAMAN, r.error || '');
const stateB = await rowOf(S1);
r = await as(PAPA, `update public.events set approval_version = $2 where id = $1 returning approved_at`, [S1, vA]); // A arrive en retard
check('… la demande A arrivée en retard est REFUSÉE (ancienne version)', !r.ok && /ancienne version/.test(r.error), r.error || 'acceptée !');
check('… rien n\'a changé : la version B reste telle quelle, approuvée par Maman', JSON.stringify(await rowOf(S1)) === JSON.stringify(stateB));
r = await as(PAPA, `update public.events set note = 'Version A', approval_version = $2 where id = $1`, [S1, vA]);
check('… la demande A rejouée avec son ancien contenu : refusée aussi, le texte B n\'est pas écrasé', !r.ok && (await rowOf(S1)).note === 'Version B');
r = await as(PAPA, `update public.events set approval_version = $2 where id = $1 returning approved_at, approved_by`, [S1, vB]);
check('… la demande B rejouée : aucune nouvelle approbation (même date, même parent)', r.ok && String(r.rows[0].approved_at) === String(stateB.approved_at) && r.rows[0].approved_by === MAMAN, r.error || JSON.stringify(r.rows));

// ---- Scénario 2 : une demande préparée sur une ancienne version ne peut pas approuver une version plus récente ----
const S2 = 'bbbbbbbb-0000-4000-8000-000000000004';
await as(PAPA, `insert into public.events (id, date, type, note) values ($1, '2026-11-14', 'difficulte', 'Version 1')`, [S2]);
const v1 = await curV(S2); // Papa relit la version 1 (par exemple hors ligne)
await as(MAMAN, `update public.events set note = 'Version 2 (Maman)' where id = $1`, [S2]); // Maman modifie entre-temps
r = await as(PAPA, `update public.events set approval_version = $2 where id = $1 returning approved_at`, [S2, v1]);
check('Scénario 2 : approbation préparée sur la version 1 envoyée seule → refusée, la version 2 n\'est pas approuvée', !r.ok && (await db.query(`select approved_at from public.events where id = $1`, [S2])).rows[0].approved_at === null, r.error || 'acceptée !');
r = await as(PAPA, `update public.events set note = 'Version 1 relue par Papa', approval_version = $2 where id = $1`, [S2, v1]);
check('… même avec son contenu : refusée en entier (le texte de Maman n\'est pas écrasé)', !r.ok && (await db.query(`select note from public.events where id = $1`, [S2])).rows[0].note === 'Version 2 (Maman)');
r = await as(PAPA, `update public.events set approval_version = $2 where id = $1`, [S2, v1 + 5]);
check('… une version « future » inventée : refusée aussi', !r.ok);
r = await as(PAPA, `update public.events set approval_version = $2 where id = $1 returning approved_by`, [S2, await curV(S2)]);
check('… après relecture, une demande sur la version actuelle : acceptée', r.ok && r.rows[0].approved_by === PAPA, r.error || '');
r = await as(MAMAN, `update public.events set approval_version = approval_version, note = 'Version 3' where id = $1 returning approved_at`, [S2]);
check('… renvoyer la version déjà enregistrée avec une modification : pas d\'approbation (retirée)', r.ok && r.rows[0].approved_at === null);
r = await as(MAMAN, `update public.events set approval_version = null where id = $1 returning approval_version`, [S2]);
check('… effacer approval_version : ignoré (seul le serveur l\'écrit)', r.ok && r.rows[0].approval_version !== null);

// Toute modification du contenu retire l'approbation, y compris les anciens champs
const approve = (uid) => as(uid, `update public.events set approval_version = version where id = $1 returning approved_at`, [N]);
for (const [label, set] of [['la note', `note = 'Il a crié fort'`], ['l\'heure', `time = '17:00'`], ['la date', `date = '2026-11-12'`], ['l\'endroit', `place = 'Parc'`], ['la réaction des adultes', `adult_reaction = 'Calme'`], ['l\'intensité', `intensity = 'rouge'`], ['la durée', `duration_min = 7`], ['ce qui a aidé', `helped = 'Un câlin'`], ['les notes supplémentaires', `extra = 'x'`]]) {
  await approve(PAPA);
  r = await as(MAMAN, `update public.events set ${set} where id = $1 returning approved_at, approved_by`, [N]);
  check(`Modifier ${label} sans nouvelle approbation : approbation retirée`, r.ok && r.rows[0].approved_at === null && r.rows[0].approved_by === null, r.error || JSON.stringify(r.rows));
}
await approve(PAPA);
r = await as(MAMAN, `update public.events set approved_at = approved_at, approved_by = approved_by, approval_version = approval_version, note = 'Je garde l''ancienne approbation' where id = $1 returning approved_at`, [N]);
check('Renvoyer l\'ancienne approbation et l\'ancienne version approuvée avec une modification : approbation retirée (pas de maintien artificiel)', r.ok && r.rows[0].approved_at === null);
await approve(PAPA);
r = await as(MAMAN, `update public.events set note = note, place = place, time = time where id = $1 returning approved_at`, [N]);
check('Réenvoyer les mêmes valeurs (aucun changement réel) : approbation gardée', r.ok && r.rows[0].approved_at !== null);
r = await as(MAMAN, `update public.events set marked_complete = true where id = $1 returning approved_at`, [N]);
check('Cocher « Fiche complète » : approbation gardée', r.ok && r.rows[0].approved_at !== null);
r = await as(MAMAN, `update public.events set deleted_at = now() where id = $1 returning approved_at`, [N]);
const r2 = await as(MAMAN, `update public.events set deleted_at = null where id = $1 returning approved_at`, [N]);
check('Corbeille puis restauration : approbation gardée', r.ok && r2.ok && r2.rows[0].approved_at !== null);

// Approbation impossible sans parent connecté (par exemple depuis le SQL Editor, sans compte)
await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); // comme le SQL Editor : aucun compte connecté
let adm = null; try { await db.query(`update public.events set approval_version = version where id = $1`, [N]); } catch (e) { adm = e.message; }
check('Approbation sans compte connecté (administration) : refusée', /seul un parent/.test(adm || ''), adm || 'acceptée !');
adm = null; try { await db.query(`insert into public.events (id, date, note, approval_version) values (gen_random_uuid(), '2026-11-13', 'x', 0)`); } catch (e) { adm = e.message; }
check('Ajout approuvé sans compte connecté : refusé', !!adm, 'accepté !');
r = await as(INTRUS, `insert into public.events (id, date, note, approval_version) values (gen_random_uuid(), '2026-11-13', 'x', 0)`);
check('Ajout approuvé par un compte non parent : refusé', !r.ok);

// --- Texte original verrouillé ---
r = await as(PAPA, `update public.events set original_text = 'autre texte' where id = $1`, [N]);
check('Texte original : modification refusée', !r.ok && /original/.test(r.error), r.error || 'accepté !');
r = await as(MAMAN, `update public.events set original_text = null where id = $1`, [N]);
check('Texte original : effacement refusé', !r.ok, r.error || 'accepté !');
r = await as(PAPA, `update public.events set original_text = 'texte dicté plus tard' where id = $1 returning original_text`, [ids[1]]);
check('Texte original ajouté à une ancienne fiche : accepté une fois', r.ok && r.rows[0].original_text === 'texte dicté plus tard', r.error || '');
r = await as(MAMAN, `update public.events set original_text = 'retouché' where id = $1`, [ids[1]]);
check('… puis verrouillé', !r.ok);
r = await as(PAPA, `update public.events set deleted_at = now() where id = $1 returning deleted_at, original_text`, [N]);
check('Mise à la corbeille d\'une fiche structurée : texte original conservé', r.ok && r.rows[0].original_text === 'il a crié pis je l\'ai consolé');
await as(PAPA, `update public.events set deleted_at = null where id = $1`, [N]);

// --- Texte original initialement vide ---
const V = 'bbbbbbbb-0000-4000-8000-000000000002';
r = await as(PAPA, `insert into public.events (id, date, note, original_text) values ($1, '2026-11-13', 'Fiche', '   ') returning original_text`, [V]);
check('Texte original vide à l\'ajout : enregistré comme absent', r.ok && r.rows[0].original_text === null, r.error || JSON.stringify(r.rows));
r = await as(MAMAN, `update public.events set original_text = '' where id = $1 returning original_text`, [V]);
check('Texte original vide en modification : reste absent', r.ok && r.rows[0].original_text === null);
await as(MAMAN, `update public.events set original_text = 'Texte dicté' where id = $1`, [V]);
r = await as(MAMAN, `update public.events set approval_version = version where id = $1 returning original_text, approved_by`, [V]);
check('Texte original ajouté plus tard avec approbation : accepté', r.ok && r.rows[0].original_text === 'Texte dicté' && r.rows[0].approved_by === MAMAN, r.error || '');
r = await as(PAPA, `update public.events set original_text = '' where id = $1`, [V]);
check('… ensuite, impossible de le vider', !r.ok);

// --- Valeurs refusées ---
r = await as(PAPA, `update public.events set categories = '{piratage}' where id = $1`, [N]);
check('Catégorie inconnue : refusée', !r.ok);
r = await as(PAPA, `insert into public.events (id, date, note, impressions) values (gen_random_uuid(), '2026-11-13', 'x', repeat('a', 5001))`);
check('Texte trop long : refusé', !r.ok);

// --- Compatibilité avec un téléphone en version 0.3.0 (il ne connaît pas les nouvelles colonnes) ---
// La 0.3.0 renvoie TOUTES ses colonnes à chaque modification (jamais les nouvelles) : on l'imite exactement.
const OLD_COLS = ['date', 'time', 'type', 'intensity', 'note', 'duration_min', 'place', 'people', 'state_before', 'context', 'description', 'adult_reaction', 'intervention', 'child_reaction', 'calm_time_min', 'helped', 'extra', 'marked_complete', 'deleted_at'];
async function legacyPatch(uid, id, changes) {
  const cur = (await db.query(`select * from public.events where id = $1`, [id])).rows[0];
  const vals = OLD_COLS.map((c) => (c in changes ? changes[c] : cur[c]));
  return as(uid, `update public.events set ${OLD_COLS.map((c, i) => `${c} = $${i + 2}`).join(', ')} where id = $1 and version = ${cur.version} returning outcome, impressions, original_text, categories, approved_at, approved_by, version`, [id, ...vals]);
}
await as(PAPA, `update public.events set outcome = 'Calme', impressions = 'Fatigué ?', marked_complete = false where id = $1`, [N]);
await as(PAPA, `update public.events set approval_version = version where id = $1`, [N]);
r = await legacyPatch(MAMAN, N, { marked_complete: true });
check('0.3.0 coche « Fiche complète » (toute la fiche renvoyée, inchangée) : approbation gardée', r.ok && r.rows.length === 1 && r.rows[0].approved_at !== null, r.error || JSON.stringify(r.rows));
r = await legacyPatch(MAMAN, N, { note: 'Note modifiée en 0.3.0' });
check('0.3.0 modifie la note : nouvelles colonnes conservées, approbation retirée', r.ok && r.rows[0].outcome === 'Calme' && r.rows[0].impressions === 'Fatigué ?' && r.rows[0].original_text && r.rows[0].categories.length >= 1 && r.rows[0].approved_at === null && r.rows[0].approved_by === null, r.error || JSON.stringify(r.rows));
await approve(PAPA);
r = await legacyPatch(MAMAN, N, { context: 'Corrigé en 0.3.0' });
check('0.3.0 modifie une section : approbation retirée automatiquement', r.ok && r.rows[0].approved_at === null);
r = await legacyPatch(MAMAN, ids[0], { note: '[Exemple] ancienne fiche modifiée en 0.3.0' });
check('0.3.0 modifie une ancienne fiche (non structurée) : accepté', r.ok && r.rows.length === 1 && r.rows[0].approved_at === null && r.rows[0].original_text === null, r.error || '');
r = await as(MAMAN, `insert into public.events (id, date, type, note) values (gen_random_uuid(), '2026-11-13', 'autre', 'Ajout depuis 0.3.0') returning categories, approved_at`);
check('0.3.0 ajoute une fiche : acceptée (catégories vides, non approuvée)', r.ok && r.rows[0].categories.length === 0 && r.rows[0].approved_at === null, r.error || '');

// --- Les règles d'accès restent les mêmes ---
r = await as(INTRUS, `select * from public.events`);
check('Compte non parent : ne voit aucune observation', r.ok && r.rows.length === 0);
r = await as(INTRUS, `update public.events set approval_version = version returning id`);
check('Compte non parent : ne peut rien approuver', (r.ok && r.rows.length === 0) || !r.ok);
r = await as(null, `select original_text from public.events`);
check('Visiteur anonyme : aucun accès', !r.ok);
r = await as(PAPA, `select private.stamp_approval()`);
check('Fonction interne d\'approbation non appelable directement', !r.ok);

const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} tests réussis`);
process.exit(ok === results.length ? 0 : 1);
