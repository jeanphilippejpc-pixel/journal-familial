// Vérifie le script SQL 05 (vérification des versions) sur une vraie base PostgreSQL locale (PGlite),
// après les scripts 01, 02 et 04. Ne touche pas à Supabase. Données fictives uniquement.
// Lancer : PGLITE=<dossier contenant node_modules/@electric-sql/pglite> node tests/test_sql05.mjs
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

const PAPA = '11111111-1111-4111-8111-111111111111';
const MAMAN = '22222222-2222-4222-8222-222222222222';
const INTRUS = '33333333-3333-4333-8333-333333333333';
const E1 = 'dddddddd-0000-4000-8000-000000000001';
const E2 = 'dddddddd-0000-4000-8000-000000000002';
const DAY = '2026-11-10';

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
  await d.exec(await sql('04-observations-structurees.sql'));
  // Données « 0.4.0 » existantes avant le script 05
  await d.exec(`select set_config('request.jwt.claim.sub', '${PAPA}', false);
    insert into public.events (id, date, type, note, original_text, context, categories) values
      ('${E1}', '2026-11-10', 'crise', '[Exemple] fiche 1', '[Exemple] récit', 'Au parc', '{emotions}'),
      ('${E2}', '2026-11-11', 'reussite', '[Exemple] fiche 2', null, null, '{}');
    insert into public.days (date, rating) values ('${DAY}', 'jaune');
    insert into public.comments (id, event_id, text) values ('dddddddd-0000-4000-8000-0000000000c1', '${E1}', '[Exemple] commentaire');
    update public.events set approval_version = version where id = '${E1}';
    select set_config('request.jwt.claim.sub', '', false);`);
}
const rollback = async (d) => { try { await d.exec('rollback'); } catch (e) { /* déjà annulé */ } };

// ===== A. Garde de migration =====
{
  const g = new PGlite(); await setup(g);
  const colsBase = async () => (await g.query(`select count(*)::int as n from information_schema.columns where table_schema='public' and column_name='base_version'`)).rows[0].n;
  const inject = async (what) => { const s = (await sql('05-verification-des-versions.sql')).replace('-- 6. Vérification', what + '\n-- 6. Vérification'); let err = null; try { await g.exec(s); } catch (e) { err = e.message; } await rollback(g); return err; };
  let err = await inject('drop policy "days_lecture" on public.days;');
  check('Garde : une règle d\'accès modifiée pendant la migration → tout est annulé', /règles d'accès/.test(err || '') && (await colsBase()) === 0, err || '');
  err = await inject("update public.events set impressions = 'modifiée en douce';");
  check('Garde : une observation (colonne de la phase 4) modifiée → tout est annulé', /données existantes/.test(err || '') && (await colsBase()) === 0, err || '');
  err = await inject("update public.days set rating = 'rouge';");
  check('Garde : une journée modifiée → tout est annulé', /données existantes/.test(err || '') && (await colsBase()) === 0, err || '');
  for (const t of ['parents', 'days', 'events', 'comments']) {
    err = await inject(`alter table public.${t} disable row level security;`);
    check(`Garde : RLS désactivé sur « ${t} » → tout est annulé`, /règles d'accès/.test(err || '') && (await colsBase()) === 0, err || '');
  }
  err = await inject('grant select on private.journal_versions to authenticated;');
  check('Garde : registre privé rendu lisible par l\'application → tout est annulé', /tables privées/.test(err || '') && (await colsBase()) === 0, err || '');
  err = await inject('drop trigger events_approval on public.events;');
  check('Garde : déclencheur d\'approbation (script 04) retiré → tout est annulé', /déclencheurs/.test(err || '') && (await colsBase()) === 0, err || '');
  for (const [label, what] of [
    ['fonction rendue exécutable par l\'application', 'grant execute on function private.verifier_version() to authenticated;'],
    ['fonction rendue exécutable par « public »', 'grant execute on function private.verifier_version() to public;'],
    ['fonction passée en SECURITY INVOKER', 'alter function private.verifier_version() security invoker;'],
    ['chemin de recherche de la fonction retiré', 'alter function private.verifier_version() reset search_path;'],
    ['chemin de recherche = public', 'alter function private.verifier_version() set search_path = public;'],
    ['chemin de recherche = "", public', "alter function private.verifier_version() set search_path = '', public;"],
    ['chemin de recherche = pg_temp', 'alter function private.verifier_version() set search_path = pg_temp;'],
    ['chemin de recherche = pg_catalog', 'alter function private.verifier_version() set search_path = pg_catalog;'],
    ['schéma privé ouvert aux visiteurs', 'grant usage on schema private to anon;'],
    ['schéma privé modifiable par l\'application', 'grant create on schema private to authenticated;'],
    ['contrainte « jamais conservée » retirée', 'alter table public.days drop constraint days_base_version_jamais_conservee;'],
  ]) {
    err = await inject(what);
    check(`Garde : ${label} → tout est annulé`, /Migration annulée/.test(err || '') && (await colsBase()) === 0, err || 'acceptée !');
  }
  const tables = (await g.query(`select count(*)::int as n from pg_tables where schemaname='private'`)).rows[0].n;
  check('Après une migration annulée : aucune table privée créée', tables === 0, String(tables));
  // Le contrôle du search_path ne dépend pas de l'écriture : « set search_path to '' » (autre forme) est accepté
  err = await inject("alter function private.verifier_version() set search_path to '';");
  check('Garde : search_path vide écrit autrement (« to \'\' ») → accepté, migration faite', err === null && (await colsBase()) === 2, err || '');
  await g.close();
}

// ===== B. Migration réelle =====
const db = new PGlite(); await setup(db);
const FULL = 'id, date, time, type, intensity, note, duration_min, place, people, state_before, context, description, adult_reaction, intervention, child_reaction, calm_time_min, helped, extra, marked_complete, author_id, created_at, updated_at, updated_by, version, deleted_at, outcome, impressions, original_text, categories, approval_version, approved_at, approved_by';
const snap = async () => JSON.stringify([(await db.query(`select ${FULL} from public.events order by id`)).rows, (await db.query('select date, rating, belle, created_at, updated_at, updated_by, version from public.days')).rows, (await db.query('select * from public.comments')).rows]);
const before = await snap();
const res = await db.exec(await sql('05-verification-des-versions.sql'));
const out = res[res.length - 1].rows[0];
check('Script 05 : résultat 2 colonnes, 2 déclencheurs, mode souple, 10 règles, RLS sur 4 tables, 2 observations', Number(out.colonnes_base) === 2 && Number(out.declencheurs) === 2 && out.mode === 'souple' && Number(out.regles_rls) === 10 && Number(out.tables_avec_rls) === 4 && Number(out.observations) === 2, JSON.stringify(out));
check('Données existantes intactes (observations avec la phase 4, journées, commentaires)', (await snap()) === before);
const trg = async (t) => (await db.query(`select tgname from pg_trigger where tgrelid = 'public.${t}'::regclass and not tgisinternal order by tgname`)).rows.map((x) => x.tgname).join(',');
check('Ordre des déclencheurs sur events : events_approval → events_base → events_stamp', (await trg('events')) === 'events_approval,events_base,events_stamp', await trg('events'));
check('Ordre des déclencheurs sur days : days_base → days_stamp', (await trg('days')) === 'days_base,days_stamp', await trg('days'));
const again = await db.exec(await sql('05-verification-des-versions.sql'));
check('Script 05 relancé : sans erreur, rien en double', Number(again[again.length - 1].rows[0].declencheurs) === 2 && (await snap()) === before);

async function as(uid, q, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid || ''}', false); set role ${uid ? 'authenticated' : 'anon'};`);
  try { return { ok: true, rows: (await db.query(q, params)).rows }; }
  catch (e) { return { ok: false, error: e.message, code: e.code }; }
  finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
const row = async (id) => (await db.query(`select note, version, base_version, approved_at, approved_by, approval_version, deleted_at from public.events where id = $1`, [id])).rows[0];
const day = async () => (await db.query(`select rating, version, base_version from public.days where date = $1`, [DAY])).rows[0];
const journal = async () => (await db.query(`select table_nom, parent, avec_version, nb from private.journal_versions order by table_nom, parent, avec_version`)).rows;
const count = async (tbl, parent, avec) => { const r = (await journal()).find((j) => j.table_nom === tbl && j.parent === parent && j.avec_version === avec); return r ? r.nb : 0; };
const setMode = async (on) => db.exec(`update private.reglages set valeur = ${on} where cle = 'version_obligatoire'`);

// ===== C. Mode souple (la 0.4.0 continue de fonctionner) =====
let v = (await row(E2)).version;
let r = await as(MAMAN, `update public.events set note = 'Sans version (0.4.0)' where id = $1 and version = $2 returning version, base_version`, [E2, v]);
check('Souple : modification SANS base_version (app 0.4.0) acceptée comme avant', r.ok && r.rows[0].version === v + 1 && r.rows[0].base_version === null, r.error || '');
check('… comptée « sans version » pour Maman dans le registre', (await count('events', MAMAN, false)) === 1);
v = (await row(E2)).version;
r = await as(PAPA, `update public.events set note = 'Avec version (0.4.1)', base_version = $2 where id = $1 and version = $2 returning version, base_version`, [E2, v]);
check('Modification AVEC la bonne base_version : acceptée, version +1 une seule fois', r.ok && r.rows[0].version === v + 1, r.error || '');
check('… base_version n\'est pas conservée (remise à vide par le serveur)', r.ok && r.rows[0].base_version === null && (await row(E2)).base_version === null);
check('… comptée « avec version » pour Papa', (await count('events', PAPA, true)) === 1);
const beforeStale = JSON.stringify(await row(E2));
r = await as(MAMAN, `update public.events set note = 'Écrase la version de Papa ?', base_version = $2 where id = $1 returning version`, [E2, v]);
check('Base_version périmée (sans filtre d\'adresse) : REFUSÉE (JFV02), rien n\'est écrit', !r.ok && r.code === 'JFV02' && /a changé depuis/.test(r.error) && JSON.stringify(await row(E2)) === beforeStale, r.error || 'acceptée !');
// Concurrence : Papa et Maman partent de la même version
v = (await row(E2)).version;
const c1 = await as(PAPA, `update public.events set note = 'Papa en même temps', base_version = $2 where id = $1 returning version`, [E2, v]);
const c2 = await as(MAMAN, `update public.events set note = 'Maman en même temps', base_version = $2 where id = $1 returning version`, [E2, v]);
check('Modifications simultanées sur la même version : la 1re passe, la 2e est refusée (aucun écrasement)', c1.ok && !c2.ok && c2.code === 'JFV02' && (await row(E2)).note === 'Papa en même temps', c2.error || 'acceptée !');
const c3 = await as(MAMAN, `update public.events set note = 'Maman en même temps' where id = $1 and version = $2 returning version`, [E2, v]);
check('… même chose avec le seul filtre d\'adresse (app 0.4.0) : 0 ligne modifiée, rien d\'écrasé', c3.ok && c3.rows.length === 0 && (await row(E2)).note === 'Papa en même temps');

// Approbation (script 04) et base_version
v = (await row(E1)).version;
const appr = (await row(E1)).approved_by;
r = await as(PAPA, `update public.events set marked_complete = true, base_version = $2 where id = $1 returning approved_by, version`, [E1, v]);
check('base_version seule ne retire pas l\'approbation (ce n\'est pas du contenu)', r.ok && r.rows[0].approved_by === appr && appr === PAPA, r.error || JSON.stringify(r.rows));
v = (await row(E1)).version;
await as(MAMAN, `update public.events set context = 'Au parc, après le souper', base_version = $2 where id = $1`, [E1, v]);
check('Modification du contenu avec base_version : approbation retirée (règle du script 04 intacte)', (await row(E1)).approved_at === null);
v = (await row(E1)).version;
r = await as(MAMAN, `update public.events set approval_version = $2, base_version = $2 where id = $1 and version = $2 returning approved_by, version, approval_version`, [E1, v]);
check('Approbation envoyée avec base_version (app 0.4.1) : acceptée, au nom de Maman, version +1', r.ok && r.rows[0].approved_by === MAMAN && r.rows[0].version === v + 1 && r.rows[0].approval_version === v, r.error || '');
r = await as(PAPA, `update public.events set approval_version = $2, base_version = $2 where id = $1 returning approved_by`, [E1, v]);
check('Approbation rejouée sur l\'ancienne version : REFUSÉE', !r.ok, 'acceptée !');
v = (await row(E1)).version;
r = await as(PAPA, `update public.events set note = 'changée', approval_version = $2, base_version = $2 where id = $1 returning id`, [E1, v]);
check('Approbation + modification avec base_version : toujours REFUSÉE (script 04)', !r.ok && /ne peut pas modifier/.test(r.error), r.error || 'acceptée !');
r = await as(PAPA, `update public.events set original_text = 'retouché', base_version = $2 where id = $1 returning id`, [E1, v]);
check('Texte original toujours verrouillé, même avec la bonne base_version', !r.ok && /texte original/.test(r.error), r.error || 'accepté !');
r = await as(PAPA, `update public.events set deleted_at = now(), base_version = $2 where id = $1 returning deleted_at`, [E2, (await row(E2)).version]);
check('Mise à la corbeille avec base_version : acceptée', r.ok && r.rows[0].deleted_at !== null, r.error || '');
await as(PAPA, `update public.events set deleted_at = null, base_version = $2 where id = $1`, [E2, (await row(E2)).version]);

// Journées
let dv = (await day()).version;
r = await as(PAPA, `update public.days set rating = 'vert', base_version = $2 where date = $1 returning version, base_version`, [DAY, dv]);
check('Journée avec la bonne base_version : acceptée, base_version remise à vide', r.ok && r.rows[0].version === dv + 1 && r.rows[0].base_version === null, r.error || '');
r = await as(MAMAN, `update public.days set rating = 'rouge', base_version = $2 where date = $1 returning version`, [DAY, dv]);
check('Journée avec une base_version périmée : REFUSÉE, la couleur de Papa reste', !r.ok && r.code === 'JFV02' && (await day()).rating === 'vert', r.error || 'acceptée !');
r = await as(MAMAN, `update public.days set belle = true where date = $1 returning version`, [DAY]);
check('Souple : journée modifiée sans base_version (0.4.0) acceptée', r.ok && r.rows.length === 1, r.error || '');

// Créations, commentaires, SQL Editor
r = await as(PAPA, `insert into public.events (id, date, type, note, base_version) values (gen_random_uuid(), '2026-11-12', 'autre', '[Exemple] nouvelle', 7) returning version, base_version`);
check('Création avec une base_version envoyée : acceptée, version 1, base_version ignorée', r.ok && r.rows[0].version === 1 && r.rows[0].base_version === null, r.error || '');
const journalBefore = JSON.stringify(await journal());
await db.exec(`update public.events set extra = 'par le SQL Editor' where id = '${E2}'`);
check('SQL Editor (aucun compte connecté) : accepté et non compté dans le registre', JSON.stringify(await journal()) === journalBefore);

// Accès aux éléments privés
for (const t of ['private.reglages', 'private.journal_versions']) {
  r = await as(PAPA, `select * from ${t}`);
  const r2 = await as(PAPA, `delete from ${t}`);
  const r3 = await as(null, `select * from ${t}`);
  check(`« ${t} » : inaccessible au parent connecté et aux visiteurs`, !r.ok && !r2.ok && !r3.ok, `${r.error} / ${r2.error}`);
}
r = await as(PAPA, `update private.reglages set valeur = true`);
check('Un téléphone ne peut pas changer le mode lui-même', !r.ok);
r = await as(PAPA, `select private.verifier_version()`);
check('Fonction de vérification non appelable directement', !r.ok);
const cols = (await db.query(`select string_agg(column_name, ',' order by ordinal_position) as c from information_schema.columns where table_schema='private' and table_name='journal_versions'`)).rows[0].c;
check('Registre : aucun contenu d\'observation, seulement des compteurs', cols === 'jour,table_nom,parent,avec_version,nb,dernier', cols);
const suivi = await db.exec((await sql('05a-suivi-des-versions.sql')).replace("date '2026-11-16'", "date '2000-01-01'"));
const lignes = suivi[suivi.length - 1].rows;
check('Requête de suivi 05a (lecture seule) : un résumé par parent', suivi[0].rows[0].mode === 'souple' && lignes.length === 2 && lignes.some((l) => /maman/i.test(l.parent) && Number(l.sans_version) >= 2), JSON.stringify(lignes));

// ===== D. Mode obligatoire (activé à la main par le script 05b, jamais automatiquement) =====
const act = await db.exec(await sql('05b-activer-version-obligatoire.sql'));
check('Script 05b : mode OBLIGATOIRE', act[act.length - 1].rows[0].mode === 'OBLIGATOIRE');
const before0 = JSON.stringify(await row(E2));
v = (await row(E2)).version;
r = await as(MAMAN, `update public.events set note = 'App 0.4.0 en mode obligatoire' where id = $1 and version = $2 returning id`, [E2, v]);
check('Obligatoire : modification SANS base_version (app 0.4.0) REFUSÉE (JFV01), rien n\'est écrit', !r.ok && r.code === 'JFV01' && /Mise à jour de l'application nécessaire/.test(r.error) && JSON.stringify(await row(E2)) === before0, r.error || 'acceptée !');
r = await as(MAMAN, `update public.events set approval_version = $2 where id = $1 returning id`, [E2, v]);
check('Obligatoire : approbation sans base_version REFUSÉE', !r.ok && r.code === 'JFV01', r.error || 'acceptée !');
r = await as(MAMAN, `update public.days set rating = 'orange' where date = $1 returning date`, [DAY]);
check('Obligatoire : journée sans base_version REFUSÉE', !r.ok && r.code === 'JFV01' && (await day()).rating === 'vert', r.error || 'acceptée !');
r = await as(PAPA, `update public.events set note = 'App 0.4.1', base_version = $2 where id = $1 and version = $2 returning version`, [E2, v]);
check('Obligatoire : modification avec la bonne base_version acceptée', r.ok && r.rows.length === 1, r.error || '');
r = await as(MAMAN, `update public.events set note = 'Version périmée', base_version = $2 where id = $1 returning version`, [E2, v]);
check('Obligatoire : base_version périmée toujours REFUSÉE (JFV02)', !r.ok && r.code === 'JFV02', r.error || 'acceptée !');
v = (await row(E2)).version;
r = await as(PAPA, `update public.events set approval_version = $2, base_version = $2 where id = $1 returning approved_by`, [E2, v]);
check('Obligatoire : approbation avec base_version acceptée', r.ok && r.rows[0].approved_by === PAPA, r.error || '');
r = await as(MAMAN, `insert into public.events (id, date, type, note) values (gen_random_uuid(), '2026-11-13', 'autre', '[Exemple] créée par 0.4.0') returning version`);
check('Obligatoire : création d\'une fiche (même par 0.4.0) acceptée', r.ok && r.rows[0].version === 1, r.error || '');
r = await as(MAMAN, `insert into public.comments (id, event_id, text) values (gen_random_uuid(), $1, '[Exemple] commentaire 0.4.0') returning id`, [E2]);
check('Obligatoire : ajout d\'un commentaire (même par 0.4.0) accepté', r.ok, r.error || '');
r = await as(MAMAN, `insert into public.days (date, rating) values ('2026-11-14', 'vert') returning version`);
check('Obligatoire : nouvelle journée acceptée', r.ok, r.error || '');
await db.exec(`update public.events set extra = 'SQL Editor en mode obligatoire' where id = '${E2}'`);
check('Obligatoire : le SQL Editor (aucun compte connecté) n\'est pas bloqué', (await db.query(`select extra from public.events where id = '${E2}'`)).rows[0].extra === 'SQL Editor en mode obligatoire');
const rerun = await db.exec(await sql('05-verification-des-versions.sql'));
check('Script 05 relancé en mode obligatoire : le mode reste OBLIGATOIRE (jamais remis à zéro)', rerun[rerun.length - 1].rows[0].mode === 'OBLIGATOIRE');
const back = await db.exec(await sql('05c-revenir-mode-souple.sql'));
v = (await row(E2)).version;
r = await as(MAMAN, `update public.events set note = 'De retour en souple' where id = $1 and version = $2 returning id`, [E2, v]);
check('Script 05c : retour au mode souple, la 0.4.0 peut de nouveau modifier', back[back.length - 1].rows[0].mode === 'souple' && r.ok && r.rows.length === 1, r.error || '');
r = await as(PAPA, `update public.events set note = 'périmée', base_version = $2 where id = $1 returning id`, [E2, v]);
check('… une base_version périmée reste refusée en mode souple', !r.ok && r.code === 'JFV02');
await setMode(false);

// ===== F. Point 1 : valeur réellement envoyée ou ancienne valeur conservée =====
{
  const nn = async (t) => Number((await db.query(`select count(*) as n from public.${t} where base_version is not null`)).rows[0].n);
  check('Point 1 : aucune ligne (y compris les données d\'avant le script 05) ne conserve une base_version', (await nn('events')) === 0 && (await nn('days')) === 0);
  const con = (await db.query(`select conname, pg_get_constraintdef(oid) as d from pg_constraint where conname like '%base_version_jamais_conservee' order by conname`)).rows;
  check('Point 1 : contrainte « base_version is null » sur events et days', con.length === 2 && con.every((c) => /base_version IS NULL/i.test(c.d)), JSON.stringify(con));
  // Même en contournant le déclencheur (administrateur), une valeur ne peut pas rester dans une ligne
  await db.exec('alter table public.events disable trigger events_base');
  let err = null; try { await db.exec(`update public.events set base_version = 5 where id = '${E1}'`); } catch (e) { err = e.message; }
  await db.exec('alter table public.events enable trigger events_base');
  check('Point 1 : déclencheur désactivé → l\'écriture d\'une base_version est REFUSÉE par la contrainte (jamais conservée)', /base_version_jamais_conservee/.test(err || '') && (await nn('events')) === 0, err || 'acceptée !');
  await setMode(true);
  v = (await row(E1)).version;
  r = await as(PAPA, `update public.events set note = 'Avec version', base_version = $2 where id = $1 and version = $2 returning version`, [E1, v]);
  const ok1 = r.ok;
  r = await as(PAPA, `update public.events set note = 'Mise à jour partielle sans version' where id = $1 returning version`, [E1]);
  check('Point 1 : juste après une modification AVEC version, une mise à jour partielle SANS version est bien vue comme « absente » (refusée en mode obligatoire)', ok1 && !r.ok && r.code === 'JFV01', r.error || 'acceptée !');
  r = await as(PAPA, `update public.events set note = 'base_version = null explicite', base_version = null where id = $1 returning version`, [E1]);
  check('Point 1 : base_version envoyée vide (null) = absente', !r.ok && r.code === 'JFV01', r.error || 'acceptée !');
  r = await as(PAPA, `update public.events set note = 'base_version = elle-même', base_version = base_version where id = $1 returning version`, [E1]);
  check('Point 1 : base_version recopiée de la ligne (vide) = absente', !r.ok && r.code === 'JFV01', r.error || 'acceptée !');
  r = await as(PAPA, `update public.events set deleted_at = now() where id = $1 returning version`, [E1]);
  check('Point 1 : mise à jour partielle d\'une seule colonne (corbeille) sans version = absente', !r.ok && r.code === 'JFV01', r.error || 'acceptée !');
  for (const bad of [0, -1, 999999]) {
    r = await as(PAPA, `update public.events set note = 'valeur bizarre', base_version = $2 where id = $1 returning version`, [E1, bad]);
    check(`Point 1 : base_version = ${bad} → refusée (JFV02), aucune écriture`, !r.ok && r.code === 'JFV02', r.error || 'acceptée !');
  }
  // Plusieurs lignes dans une même requête : une seule version de départ ne peut pas convenir à toutes
  const before2 = JSON.stringify([await row(E1), await row(E2)]);
  r = await as(PAPA, `update public.events set note = 'en masse', base_version = $1 where id in ($2, $3) returning id`, [(await row(E1)).version, E1, E2]);
  check('Point 1 : modification de plusieurs fiches avec une seule base_version → tout est refusé, rien d\'écrit à moitié', !r.ok && JSON.stringify([await row(E1), await row(E2)]) === before2, r.error || 'acceptée !');
  // « Upsert » (insertion qui devient une modification) : la version envoyée est effacée à l'insertion
  r = await as(PAPA, `insert into public.events (id, date, type, note, base_version) values ($1, '2026-11-10', 'crise', 'upsert', $2) on conflict (id) do update set note = excluded.note, base_version = excluded.base_version returning note`, [E1, (await row(E1)).version]);
  check('Point 1 : insertion transformée en modification (upsert) → vue comme sans version, refusée en mode obligatoire', !r.ok && r.code === 'JFV01', r.error || 'acceptée !');
  await setMode(false);
  const sansAvant = await count('events', PAPA, false);
  r = await as(PAPA, `insert into public.events (id, date, type, note) values ($1, '2026-11-10', 'crise', 'upsert souple') on conflict (id) do update set note = excluded.note returning note`, [E1]);
  check('Point 1 : même upsert en mode souple → accepté comme aujourd\'hui, compté « sans version »', r.ok && (await count('events', PAPA, false)) === sansAvant + 1, r.error || '');
}

// ===== G. Point 2 : schéma privé, fonction SECURITY DEFINER, identité inscrite au registre =====
{
  const q1 = async (s) => (await db.query(s)).rows[0];
  const sch = await q1(`select has_schema_privilege('anon','private','usage') as anon_usage, has_schema_privilege('anon','private','create') as anon_create, has_schema_privilege('authenticated','private','usage') as auth_usage, has_schema_privilege('authenticated','private','create') as auth_create`);
  check('Point 2 : schéma private — visiteurs : aucun accès ; comptes connectés : usage seulement (pour les règles RLS existantes), jamais création', !sch.anon_usage && !sch.anon_create && sch.auth_usage && !sch.auth_create, JSON.stringify(sch));
  for (const role of ['anon', 'authenticated']) {
    const t = await q1(`select bool_or(has_table_privilege('${role}', t, p)) as any from unnest(array['private.reglages','private.journal_versions']) t, unnest(array['select','insert','update','delete','truncate','references','trigger']) p`);
    check(`Point 2 : « ${role} » n'a aucun droit sur les tables privées`, t.any === false);
  }
  const f = await q1(`select p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) as owner, (select pg_get_userbyid(relowner) from pg_class where oid = 'private.journal_versions'::regclass) as tab_owner, has_function_privilege('anon','private.verifier_version()','execute') as anon_x, has_function_privilege('authenticated','private.verifier_version()','execute') as auth_x, exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where x.grantee = 0) as public_x from pg_proc p where p.oid = 'private.verifier_version()'::regprocedure`);
  check('Point 2 : fonction SECURITY DEFINER, chemin de recherche vide, même propriétaire que le registre', f.prosecdef === true && JSON.stringify(f.proconfig) === JSON.stringify(['search_path=""']) && f.owner === f.tab_owner, JSON.stringify(f));
  check('Point 2 : fonction non exécutable par public, anon ni authenticated', !f.anon_x && !f.auth_x && !f.public_x, JSON.stringify(f));
  // Les autres fonctions existantes ne sont pas devenues SECURITY DEFINER
  const others = (await db.query(`select proname, prosecdef from pg_proc where pronamespace = 'private'::regnamespace order by proname`)).rows;
  check('Point 2 : seules is_parent (existante) et verifier_version sont SECURITY DEFINER', others.filter((o) => o.prosecdef).map((o) => o.proname).join(',') === 'is_parent,verifier_version', JSON.stringify(others));
  // Identité : le registre inscrit le compte CONNECTÉ, pas le propriétaire de la fonction
  await db.exec('truncate private.journal_versions');
  await as(MAMAN, `update public.events set extra = 'Maman' , base_version = version where id = $1`, [E2]);
  await as(PAPA, `update public.events set extra = 'Papa' where id = $1`, [E2]);
  const j = await journal();
  check('Point 2 : registre — Maman inscrite « avec version », Papa « sans version », jamais le propriétaire de la fonction', j.length === 2 && j.some((x) => x.parent === MAMAN && x.avec_version) && j.some((x) => x.parent === PAPA && !x.avec_version), JSON.stringify(j));
  // Aucun moyen pour un téléphone d'écrire au registre ou de changer le mode
  for (const [label, q] of [['insérer au registre', `insert into private.journal_versions values (current_date, 'events', '${PAPA}', true, 999, now())`], ['modifier le registre', 'update private.journal_versions set nb = 0'], ['ajouter un réglage', `insert into private.reglages values ('autre', true)`], ['appeler la fonction', 'select private.verifier_version()']]) {
    r = await as(PAPA, q);
    check(`Point 2 : un parent connecté ne peut pas ${label}`, !r.ok, 'accepté !');
  }
  const jt = JSON.stringify(await journal());
  r = await as(MAMAN, `update public.events set extra = 'Maman essaie', base_version = version where id = $1`, [E2]); // aucun moyen de choisir le parent inscrit
  check('Point 2 : le parent inscrit vient du jeton (auth.uid()), pas d\'une valeur envoyée', JSON.stringify(await journal()) !== jt && (await journal()).every((x) => x.parent === MAMAN || x.parent === PAPA));
}

// ===== H. Point 3 : enchaînement avec les déclencheurs existants =====
{
  const full = async (id) => (await db.query(`select version, updated_at, updated_by, author_id, created_at, approved_at, approved_by, approval_version, deleted_at, note from public.events where id = $1`, [id])).rows[0];
  const a0 = await full(E2);
  await new Promise((res) => setTimeout(res, 5));
  r = await as(MAMAN, `update public.events set approval_version = $2, base_version = $2, author_id = $3, created_at = '2020-01-01', updated_by = $3 where id = $1 and version = $2 returning version`, [E2, a0.version, PAPA]);
  const a1 = await full(E2);
  check('Point 3 : approbation + base_version → version +1 une seule fois', r.ok && a1.version === a0.version + 1, r.error || '');
  check('Point 3 : … events_stamp fixe toujours updated_at / updated_by (Maman) ; auteur et date de création inchangés', a1.updated_by === MAMAN && new Date(a1.updated_at) > new Date(a0.updated_at) && a1.author_id === a0.author_id && String(a1.created_at) === String(a0.created_at));
  check('Point 3 : … events_approval fixe toujours approved_by / approval_version', a1.approved_by === MAMAN && a1.approval_version === a0.version);
  r = await as(PAPA, `update public.events set approval_version = $2, base_version = $3 where id = $1 returning id`, [E2, a1.version, a1.version - 1]);
  check('Point 3 : approbation sur la bonne version mais base_version périmée → REFUSÉE (JFV02), rien n\'est approuvé', !r.ok && r.code === 'JFV02' && (await full(E2)).approved_by === MAMAN && (await full(E2)).version === a1.version, r.error || 'acceptée !');
  r = await as(PAPA, `update public.events set approval_version = $2, base_version = $3 where id = $1 returning id`, [E2, a1.version - 2, a1.version]);
  check('Point 3 : approbation périmée avec une base_version correcte → REFUSÉE par events_approval', !r.ok && /ancienne version/.test(r.error), r.error || 'acceptée !');
  r = await as(PAPA, `update public.events set approval_version = $2, base_version = $3 where id = $1 and version = $3 returning approved_by, approved_at`, [E2, a1.approval_version, a1.version]);
  check('Point 3 : approval_version identique à celle déjà enregistrée (+ bonne base) = aucune demande : l\'approbation de Maman reste telle quelle (règle du script 04)', r.ok && r.rows[0].approved_by === MAMAN && String(r.rows[0].approved_at) === String(a1.approved_at), r.error || JSON.stringify(r.rows));
  const b0 = await full(E2);
  r = await as(PAPA, `update public.events set note = 'périmée', base_version = $2 where id = $1`, [E2, b0.version - 1]);
  check('Point 3 : refus JFV02 avant events_stamp → version, date et auteur de la modification inchangés', !r.ok && JSON.stringify(await full(E2)) === JSON.stringify(b0));
  r = await as(PAPA, `update public.events set deleted_at = '2020-01-01', base_version = $2 where id = $1 returning deleted_at`, [E2, b0.version]);
  check('Point 3 : corbeille avec base_version → date fixée par le serveur (script 02), impossible d\'antidater', r.ok && new Date(r.rows[0].deleted_at) > new Date('2026-01-01'), r.error || '');
  await as(PAPA, `update public.events set deleted_at = null, base_version = version where id = $1`, [E2]);
  const dd0 = (await db.query(`select version, updated_by from public.days where date = $1`, [DAY])).rows[0];
  r = await as(MAMAN, `update public.days set rating = 'orange', base_version = $2 where date = $1 returning version, updated_by`, [DAY, dd0.version]);
  check('Point 3 : journée — days_base puis days_stamp : version +1 une seule fois, updated_by = Maman', r.ok && r.rows[0].version === dd0.version + 1 && r.rows[0].updated_by === MAMAN, r.error || '');
  const evTrig = (await db.query(`select tgname, pg_get_triggerdef(oid) as d from pg_trigger where tgrelid = 'public.events'::regclass and not tgisinternal order by tgname`)).rows;
  check('Point 3 : les 3 déclencheurs d\'events sont BEFORE ... FOR EACH ROW (ordre alphabétique garanti par PostgreSQL)', evTrig.length === 3 && evTrig.every((t) => /BEFORE INSERT OR UPDATE ON public\.events FOR EACH ROW/.test(t.d)), JSON.stringify(evTrig.map((t) => t.tgname)));
}

// ===== E. Compte non parent =====
r = await as(INTRUS, `update public.events set note = 'intrus', base_version = version returning id`);
check('Compte non parent : ne modifie rien, même avec une base_version', (r.ok && r.rows.length === 0) || !r.ok);

const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} tests réussis`);
process.exit(ok === results.length ? 0 : 1);
