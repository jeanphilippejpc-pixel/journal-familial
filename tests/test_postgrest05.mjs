// Script 05 face aux requêtes telles que PostgREST (l'API de Supabase) les exécute, avec les
// corps EXACTS produits par les moteurs 0.4.0 (publié) et 0.4.1. Base PostgreSQL locale (PGlite),
// rien n'est envoyé à Supabase. Données fictives uniquement.
//
// PostgREST ne fait pas un simple UPDATE : il reçoit le corps JSON, le transforme en ligne avec
// json_to_record, et ne met dans le SET que les clés présentes dans le corps (PATCH partiel).
// Les fonctions pgrstPatch / pgrstPost reproduisent cette forme de requête (PostgREST v12),
// rôle « authenticated » et identité du jeton comprises.
// Lancer : PGLITE=<dossier contenant node_modules/@electric-sql/pglite> node tests/test_postgrest05.mjs
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const NEW = require('../js/sync.js');           // 0.4.1
const V040 = require('./legacy/sync-0.4.0.js'); // 0.4.0 publiée
const here = fileURLToPath(new URL('.', import.meta.url));
const base = process.env.PGLITE;
if (!base) { console.log('Indiquez PGLITE=<dossier où @electric-sql/pglite est installé>'); process.exit(2); }
const { PGlite } = await import(pathToFileURL(join(base, 'node_modules/@electric-sql/pglite/dist/index.js')).href);
const sql = async (f) => readFile(join(here, '..', 'supabase', f), 'utf8');

const results = [];
const check = (name, cond, extra = '') => { results.push(!!cond); console.log((cond ? 'OK    ' : 'ÉCHEC ') + name + (cond || !extra ? '' : '  → ' + extra)); };
const section = (t) => console.log(`\n--- ${t} ---`);
const PAPA = '11111111-1111-4111-8111-111111111111';
const MAMAN = '22222222-2222-4222-8222-222222222222';

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  grant usage on schema public to anon, authenticated;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  insert into auth.users values ('${PAPA}', 'papa@test.local'), ('${MAMAN}', 'maman@test.local');
`);
for (const f of ['01-tables-et-securite.sql', '02-corbeille-protegee.sql', '04-observations-structurees.sql', '05-verification-des-versions.sql']) await db.exec(await sql(f));

// Types des colonnes, comme PostgREST les lit dans son cache de schéma
const types = {};
for (const t of ['events', 'days']) {
  types[t] = {};
  for (const r of (await db.query(`select attname, format_type(atttypid, atttypmod) as ty from pg_attribute where attrelid = 'public.${t}'::regclass and attnum > 0 and not attisdropped`)).rows) types[t][r.attname] = r.ty;
}
const qi = (s) => `"${s.replace(/"/g, '""')}"`;
async function asUser(uid, fn) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
function unknownColumn(table, body) { return Object.keys(body).find((k) => !types[table][k]); }
// PATCH /rest/v1/<table>?<filtres> avec « Prefer: return=representation »
async function pgrstPatch(uid, table, filters, body) {
  const bad = unknownColumn(table, body);
  if (bad) return { ok: false, status: 400, code: 'PGRST204', error: `Could not find the '${bad}' column` };
  const cols = Object.keys(body);
  const where = Object.entries(filters).map(([c, v], i) => `${qi('public')}.${qi(table)}.${qi(c)} = $${i + 2}`).join(' and ');
  const q = `with pgrst_source as (
      update ${qi('public')}.${qi(table)} set ${cols.map((c) => `${qi(c)} = pgrst_body.${qi(c)}`).join(', ')}
      from (select $1::json as json_data) pgrst_payload,
      lateral (select ${cols.map(qi).join(', ')} from json_to_record(pgrst_payload.json_data) as _(${cols.map((c) => `${qi(c)} ${types[table][c]}`).join(', ')}) limit 1) pgrst_body
      where ${where}
      returning ${qi('public')}.${qi(table)}.*)
    select coalesce(json_agg(_t), '[]') as body from (select * from pgrst_source) _t`;
  return asUser(uid, async () => {
    try { const r = await db.query(q, [JSON.stringify(body), ...Object.values(filters)]); return { ok: true, status: 200, rows: r.rows[0].body }; }
    catch (e) { return { ok: false, status: 400, code: e.code, error: e.message }; }
  });
}
// POST /rest/v1/<table> avec « Prefer: return=representation »
async function pgrstPost(uid, table, body) {
  const bad = unknownColumn(table, body);
  if (bad) return { ok: false, status: 400, code: 'PGRST204', error: `Could not find the '${bad}' column` };
  const cols = Object.keys(body);
  const q = `with pgrst_source as (
      insert into ${qi('public')}.${qi(table)} (${cols.map(qi).join(', ')})
      select ${cols.map((c) => `pgrst_body.${qi(c)}`).join(', ')}
      from (select $1::json as json_data) pgrst_payload,
      lateral (select ${cols.map(qi).join(', ')} from json_to_record(pgrst_payload.json_data) as _(${cols.map((c) => `${qi(c)} ${types[table][c]}`).join(', ')})) pgrst_body
      returning ${qi('public')}.${qi(table)}.*)
    select coalesce(json_agg(_t), '[]') as body from (select * from pgrst_source) _t`;
  return asUser(uid, async () => {
    try { const r = await db.query(q, [JSON.stringify(body)]); return { ok: true, status: 201, rows: r.rows[0].body }; }
    catch (e) { return { ok: false, status: 400, code: e.code, error: e.message }; }
  });
}
const srv = async (id) => (await db.query(`select * from public.events where id = $1`, [id])).rows[0];
const srvDay = async (d) => (await db.query(`select * from public.days where date = $1`, [d])).rows[0];
const journal = async () => (await db.query(`select parent, avec_version, sum(nb)::int as nb from private.journal_versions group by 1, 2`)).rows;
const nbJ = async (uid, avec) => ((await journal()).find((j) => j.parent === uid && j.avec_version === avec) || { nb: 0 }).nb;
const setMode = (on) => db.exec(`update private.reglages set valeur = ${on} where cle = 'version_obligatoire'`);
const evt = (f = {}) => ({ id: randomUUID(), kind: 'event', date: '2026-11-12', time: '16:05', type: 'crise', intensity: 'orange', note: 'Il a crié au parc', comments: [], ...f });
const structured = (f = {}) => evt({ originalText: 'au parc pis il a crié', context: 'Au parc.', childReaction: 'Il a crié.', outcome: 'Il s\'est calmé.', impressions: '', categories: ['emotions'], hasStructure: true, ...f });

// =====================================================================
section('1. Application 0.4.0 (corps exacts de la version publiée), mode souple');
{
  const e = structured();
  const row40 = V040.eventToRow(e);
  check('Le corps envoyé par la 0.4.0 ne contient pas base_version', !('base_version' in row40));
  let r = await pgrstPost(PAPA, 'events', row40);
  const ins = r.ok && r.rows[0];
  check('0.4.0 POST (nouvelle fiche structurée) : acceptée, version 1, base_version vide dans la réponse', ins && ins.version === 1 && ins.base_version === null && ins.original_text === 'au parc pis il a crié', r.error || '');
  e.note = 'Il a crié au parc, puis s\'est calmé';
  r = await pgrstPatch(MAMAN, 'events', { id: e.id, version: 1 }, V040.eventToRow(e));
  check('0.4.0 PATCH complet (filtre id + version) : accepté, version 2, base_version vide', r.ok && r.rows.length === 1 && r.rows[0].version === 2 && r.rows[0].base_version === null, r.error || JSON.stringify(r.rows));
  check('… compté « sans version » pour Maman', (await nbJ(MAMAN, false)) === 1);
  r = await pgrstPatch(PAPA, 'events', { id: e.id, version: 2 }, { approval_version: 2 });
  check('0.4.0 PATCH d\'approbation { approval_version } : accepté, approuvé par Papa', r.ok && r.rows.length === 1 && r.rows[0].approved_by === PAPA && r.rows[0].base_version === null, r.error || '');
  r = await pgrstPatch(MAMAN, 'events', { id: e.id, version: 3 }, { marked_complete: true });
  check('0.4.0 PATCH partiel { marked_complete } : accepté, approbation gardée', r.ok && r.rows.length === 1 && r.rows[0].approved_by === PAPA, r.error || '');
  r = await pgrstPatch(MAMAN, 'events', { id: e.id, version: 4 }, { deleted_at: new Date().toISOString() });
  check('0.4.0 PATCH partiel { deleted_at } (corbeille) : accepté', r.ok && r.rows.length === 1 && r.rows[0].deleted_at !== null, r.error || '');
  r = await pgrstPatch(MAMAN, 'events', { id: e.id, version: 5 }, { deleted_at: null });
  check('0.4.0 PATCH { deleted_at: null } (restauration) : accepté', r.ok && r.rows.length === 1 && r.rows[0].deleted_at === null, r.error || '');
  r = await pgrstPatch(PAPA, 'events', { id: e.id, version: 2 }, V040.eventToRow({ ...e, note: 'Papa sur une vieille version' }));
  check('0.4.0 PATCH sur une version périmée : 0 ligne (conflit détecté comme avant), rien d\'écrasé', r.ok && r.rows.length === 0 && (await srv(e.id)).note === 'Il a crié au parc, puis s\'est calmé');
  const d = { id: 'day-2026-11-12', kind: 'day', date: '2026-11-12', rating: 'jaune', belle: false };
  r = await pgrstPost(PAPA, 'days', V040.dayToRow(d));
  check('0.4.0 POST journée : acceptée', r.ok && r.rows[0].version === 1 && r.rows[0].base_version === null, r.error || '');
  r = await pgrstPatch(MAMAN, 'days', { date: '2026-11-12', version: 1 }, V040.dayToRow({ ...d, rating: 'vert', belle: true }));
  check('0.4.0 PATCH journée : accepté', r.ok && r.rows.length === 1 && r.rows[0].rating === 'vert', r.error || '');
  const simple = evt({ type: 'reussite', note: 'Fiche simple 0.4.0' });
  r = await pgrstPost(MAMAN, 'events', V040.eventToRow(simple));
  r = await pgrstPatch(MAMAN, 'events', { id: simple.id, version: 1 }, V040.eventToRow({ ...simple, note: 'Fiche simple modifiée' }));
  check('0.4.0 fiche simple (sans structure) : création et modification acceptées', r.ok && r.rows.length === 1, r.error || '');
  const nn = Number((await db.query(`select (select count(*) from public.events where base_version is not null) + (select count(*) from public.days where base_version is not null) as n`)).rows[0].n);
  check('Aucune base_version conservée dans la base après toutes ces requêtes', nn === 0);
}

// =====================================================================
section('2. Application 0.4.1 : base_version dans le corps JSON (PATCH de PostgREST)');
{
  const e = structured({ note: 'Fiche 0.4.1' });
  let r = await pgrstPost(PAPA, 'events', NEW.eventToRow(e));
  check('0.4.1 POST : le corps de création ne contient pas base_version, fiche acceptée', !('base_version' in NEW.eventToRow(e)) && r.ok, r.error || '');
  r = await pgrstPatch(PAPA, 'events', { id: e.id, version: 1 }, { ...NEW.eventToRow({ ...e, note: 'Modifiée en 0.4.1' }), base_version: 1 });
  check('0.4.1 PATCH { …, base_version: 1 } : accepté, version 2, base_version VIDE dans la réponse (contrainte respectée)', r.ok && r.rows.length === 1 && r.rows[0].version === 2 && r.rows[0].base_version === null, r.error || '');
  check('… compté « avec version » pour Papa', (await nbJ(PAPA, true)) === 1);
  r = await pgrstPatch(MAMAN, 'events', { id: e.id }, { note: 'Maman sur la version 1', base_version: 1 });
  check('0.4.1 PATCH avec base_version périmée : refusé, code JFV02 (PostgREST le renverrait en HTTP 400)', !r.ok && r.code === 'JFV02' && (await srv(e.id)).note === 'Modifiée en 0.4.1', r.error || 'accepté !');
  r = await pgrstPatch(MAMAN, 'events', { id: e.id, version: 2 }, { approval_version: 2, base_version: 2 });
  check('0.4.1 PATCH d\'approbation { approval_version, base_version } : accepté, version +1, base_version vide', r.ok && r.rows.length === 1 && r.rows[0].approved_by === MAMAN && r.rows[0].version === 3 && r.rows[0].base_version === null, r.error || '');
  r = await pgrstPatch(PAPA, 'events', { id: e.id, version: 3 }, { note: 'base_version null en JSON', base_version: null });
  check('JSON « base_version: null » : compté comme absent (accepté en mode souple)', r.ok && r.rows.length === 1 && r.rows[0].base_version === null, r.error || '');
  r = await pgrstPatch(PAPA, 'events', { id: e.id, version: 4 }, { note: 'chaîne', base_version: '4' });
  check('JSON « base_version: "4" » (texte) : converti en nombre par json_to_record, accepté', r.ok && r.rows.length === 1, r.error || '');
  r = await pgrstPost(PAPA, 'events', { ...NEW.eventToRow(evt({ note: 'POST avec base' })), base_version: 9 });
  check('POST avec base_version (jamais fait par l\'app) : accepté, base_version ignorée et vide', r.ok && r.rows[0].base_version === null && r.rows[0].version === 1, r.error || '');
  const d = { id: 'day-2026-11-13', kind: 'day', date: '2026-11-13', rating: 'jaune', belle: false };
  await pgrstPost(PAPA, 'days', NEW.dayToRow(d));
  r = await pgrstPatch(PAPA, 'days', { date: '2026-11-13', version: 1 }, { ...NEW.dayToRow({ ...d, rating: 'rouge' }), base_version: 1 });
  check('0.4.1 PATCH journée avec base_version : accepté, base_version vide', r.ok && r.rows.length === 1 && r.rows[0].base_version === null, r.error || '');
  r = await pgrstPatch(MAMAN, 'days', { date: '2026-11-13' }, { rating: 'vert', base_version: 1 });
  check('0.4.1 PATCH journée périmée : refusé JFV02, couleur de Papa gardée', !r.ok && r.code === 'JFV02' && (await srvDay('2026-11-13')).rating === 'rouge', r.error || 'accepté !');
}

// =====================================================================
section('3. Mode obligatoire (après 05b) puis retour au mode souple (05c)');
{
  const e = structured({ note: 'Avant le mode obligatoire' });
  await pgrstPost(MAMAN, 'events', V040.eventToRow(e));
  await setMode(true);
  let r = await pgrstPatch(MAMAN, 'events', { id: e.id, version: 1 }, V040.eventToRow({ ...e, note: '0.4.0 en mode obligatoire' }));
  check('Obligatoire : PATCH 0.4.0 refusé, code JFV01, rien d\'écrit', !r.ok && r.code === 'JFV01' && (await srv(e.id)).note === 'Avant le mode obligatoire', r.error || 'accepté !');
  r = await pgrstPost(MAMAN, 'events', V040.eventToRow(evt({ note: 'Nouvelle fiche 0.4.0 en mode obligatoire' })));
  check('Obligatoire : POST 0.4.0 (création) accepté', r.ok, r.error || '');
  r = await pgrstPatch(PAPA, 'events', { id: e.id, version: 1 }, { ...NEW.eventToRow({ ...e, note: '0.4.1 en mode obligatoire' }), base_version: 1 });
  check('Obligatoire : PATCH 0.4.1 accepté', r.ok && r.rows.length === 1, r.error || '');
  await db.exec(await sql('05c-revenir-mode-souple.sql'));
  r = await pgrstPatch(MAMAN, 'events', { id: e.id, version: 2 }, V040.eventToRow({ ...e, note: '0.4.0 de nouveau en souple' }));
  check('Retour au mode souple (05c) : PATCH 0.4.0 de nouveau accepté', r.ok && r.rows.length === 1, r.error || '');
}

// =====================================================================
section('4. Mode souple : aucun blocage pour la 0.4.0 sur une utilisation prolongée');
{
  // 200 opérations réalistes de la 0.4.0, par les deux parents, sur plusieurs fiches et journées
  const fiches = [];
  let refus = 0, ops = 0, conflitsAttendus = 0;
  let seed = 7; const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let i = 0; i < 200; i++) {
    const uid = rnd(2) ? PAPA : MAMAN;
    const k = rnd(6);
    if (k === 0 || fiches.length === 0) {
      const e = rnd(2) ? structured({ note: 'Fiche ' + i }) : evt({ note: 'Fiche ' + i, type: 'reussite' });
      const r = await pgrstPost(uid, 'events', V040.eventToRow(e)); ops++; if (!r.ok) refus++; else fiches.push({ e, v: 1 });
    } else if (k <= 3) {
      const f = fiches[rnd(fiches.length)];
      const stale = rnd(10) === 0; // 1 fois sur 10 : l'autre parent a modifié entre-temps
      const r = await pgrstPatch(uid, 'events', { id: f.e.id, version: stale ? f.v - 1 || 99 : f.v }, V040.eventToRow({ ...f.e, note: `Modif ${i}` })); ops++;
      if (!r.ok) refus++; else if (r.rows.length) f.v = r.rows[0].version; else conflitsAttendus++;
    } else if (k === 4) {
      const f = fiches[rnd(fiches.length)];
      const r = await pgrstPatch(uid, 'events', { id: f.e.id, version: f.v }, { approval_version: f.v }); ops++;
      if (!r.ok) refus++; else if (r.rows.length) f.v = r.rows[0].version;
    } else {
      const date = `2026-11-${String(14 + rnd(10)).padStart(2, '0')}`;
      const cur = await srvDay(date);
      const r = cur ? await pgrstPatch(uid, 'days', { date, version: cur.version }, V040.dayToRow({ date, rating: ['vert', 'jaune', 'orange', 'rouge'][rnd(4)], belle: false })) : await pgrstPost(uid, 'days', V040.dayToRow({ date, rating: 'jaune' }));
      ops++; if (!r.ok) refus++;
    }
  }
  check(`200 opérations 0.4.0 en mode souple (créations, modifications, approbations, journées) : aucun refus`, refus === 0 && ops === 200, `${refus} refus`);
  check(`… les modifications sur une version périmée donnent 0 ligne (conflit), comme aujourd'hui (${conflitsAttendus})`, conflitsAttendus > 0);
  const nn = Number((await db.query(`select (select count(*) from public.events where base_version is not null) + (select count(*) from public.days where base_version is not null) as n`)).rows[0].n);
  check('… aucune base_version conservée', nn === 0);
}

const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} tests réussis`);
process.exit(ok === results.length ? 0 : 1);
