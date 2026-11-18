-- =====================================================================
-- Journal familial — Étape 5 : vérification des versions par le serveur (version 2)
--
-- But : qu'aucune modification ne puisse écraser une version plus récente sans le savoir.
-- L'application 0.4.1 indique dans chaque modification la version sur laquelle elle s'appuie
-- (colonne base_version). Le serveur la compare à la version actuelle.
--
-- Ce script AJOUTE une colonne à « events » et à « days », deux déclencheurs et deux tables
-- privées. Il ne modifie, ne déplace et n'efface aucune observation, journée ni commentaire,
-- et ne change aucune règle d'accès (RLS).
--
-- Il installe le MODE SOUPLE : rien n'est refusé à cause d'une version absente, l'application
-- 0.4.0 (et 0.3.0) continue de fonctionner exactement comme avant. Le mode obligatoire ne
-- s'active JAMAIS tout seul : seulement en exécutant le script 05b, avec l'accord des parents.
--
-- Règles (fonction private.verifier_version, pour chaque MODIFICATION d'une fiche ou d'une journée) :
--   1. base_version fournie et différente de la version actuelle → REFUS (code JFV02)
--      « La fiche a changé depuis votre dernière synchronisation ». Rien n'est écrit.
--   2. base_version absente, envoyée par un compte connecté (téléphone) :
--        - mode souple      → acceptée comme avant, et comptée dans le registre de suivi ;
--        - mode obligatoire → REFUS (code JFV01) « Mise à jour de l'application nécessaire ».
--      Les modifications faites dans le SQL Editor de Supabase (aucun compte connecté)
--      ne sont pas concernées.
--   3. base_version n'est jamais conservée : le serveur la remet à vide après chaque
--      modification, et une contrainte « base_version is null » (vérifiée après les
--      déclencheurs) interdit qu'une valeur reste dans une ligne. Une requête qui ne l'envoie
--      pas (mise à jour partielle, ancienne app) arrive donc forcément « vide ». Est considérée
--      comme envoyée une valeur non vide ET différente de celle déjà enregistrée.
--   4. Les créations (nouvelle fiche, nouvelle journée), les commentaires et la purge de la
--      corbeille ne sont pas concernés (il n'existe pas de version à vérifier).
--   Ordre des déclencheurs (alphabétique, règle de PostgreSQL) :
--      events : events_approval → events_base → events_stamp
--      days   : days_base → days_stamp
--   events_base et days_base lisent old.version AVANT que events_stamp / days_stamp
--   l'augmentent (old.version + 1). base_version ne fait pas partie du contenu de la fiche :
--   elle ne retire pas une approbation et ne compte pas comme une modification.
--
-- Registre de suivi (private.journal_versions) : par jour, par table et par parent, le nombre de
-- modifications AVEC et SANS base_version. Aucun contenu d'observation n'y est copié. Il sert à
-- vérifier que tous les appareils sont à jour avant d'activer le mode obligatoire.
-- Les tables privées ne sont accessibles ni à l'application ni aux visiteurs.
--
-- Identité et droits : private.verifier_version est SECURITY DEFINER, avec un chemin de
-- recherche vide, pour pouvoir écrire dans le registre privé sans donner AUCUN droit sur ces
-- tables à l'application. Elle s'exécute avec les droits du propriétaire des tables privées
-- (celui qui exécute ce script), mais le parent inscrit au registre est TOUJOURS le compte
-- connecté (auth.uid(), tiré du jeton vérifié par Supabase), jamais une valeur envoyée.
-- Elle n'est exécutable directement par personne (ni public, ni anon, ni authenticated) :
-- seulement par les déclencheurs. Elle ne lit que le mode et n'écrit que des compteurs.
--
-- Sécurité de la migration (tout dans une seule transaction) :
--   - Empreinte des observations (avec les colonnes de la phase 4), journées et commentaires.
--   - Empreinte des règles RLS, de l'activation du RLS sur les 4 tables, des droits, des
--     déclencheurs et des fonctions existants, avant et après.
--   - Le RLS doit être actif sur les 4 tables ; les tables privées ne doivent être lisibles
--     ni par « anon » ni par « authenticated ».
--   - À la moindre différence, tout est annulé automatiquement et rien n'est changé.
--
-- À exécuter dans Supabase > SQL Editor, après les étapes 1, 2 et 4.
-- Peut être relancé sans risque : rien n'est recréé en double, et le mode déjà choisi
-- (souple ou obligatoire) n'est PAS modifié par une nouvelle exécution.
-- =====================================================================

begin;

-- 1. Empreintes AVANT la migration
create temporary table _avant on commit drop as
select
  (select count(*) from public.events) as nb,
  (select md5(coalesce(string_agg(row(id, date, time, type, intensity, note, duration_min, place, people,
           state_before, context, description, adult_reaction, intervention, child_reaction,
           calm_time_min, helped, extra, marked_complete, author_id, created_at, updated_at,
           updated_by, version, deleted_at, outcome, impressions, original_text, categories,
           approval_version, approved_at, approved_by)::text, '|' order by id), ''))
     from public.events) as observations,
  (select md5(coalesce(string_agg(row(date, rating, belle, created_at, updated_at, updated_by, version)::text, '|' order by date), ''))
     from public.days) as journees,
  (select md5(coalesce(string_agg(row(id, event_id, text, author_id, created_at)::text, '|' order by id), ''))
     from public.comments) as commentaires,
  (select md5(coalesce(string_agg(row(tablename, policyname, permissive, roles, cmd, qual, with_check)::text, '|' order by tablename, policyname), ''))
     from pg_policies where schemaname = 'public') as regles_rls,
  (select md5(coalesce(string_agg(row(c.relname, c.relrowsecurity, c.relforcerowsecurity)::text, '|' order by c.relname), ''))
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname in ('parents', 'days', 'events', 'comments')) as rls_tables,
  (select md5(coalesce(string_agg(row(table_name, grantee, privilege_type)::text, '|' order by table_name, grantee, privilege_type), ''))
     from information_schema.role_table_grants
     where table_schema = 'public' and table_name in ('parents', 'days', 'events', 'comments')) as droits,
  (select md5(coalesce(string_agg(row(c.relname, t.tgname, pg_get_triggerdef(t.oid))::text, '|' order by c.relname, t.tgname), ''))
     from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and not t.tgisinternal and t.tgname not in ('events_base', 'days_base')) as declencheurs,
  (select md5(coalesce(string_agg(pg_get_functiondef(p.oid), '|' order by p.proname), ''))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private' and p.proname in ('is_parent', 'stamp_row', 'stamp_comment', 'stamp_approval')) as fonctions;

-- 2. Colonne base_version : jamais conservée. La contrainte « is null » est vérifiée APRÈS les
--    déclencheurs : une valeur ne peut donc JAMAIS rester enregistrée dans une ligne (même si le
--    déclencheur était un jour désactivé, l'écriture serait refusée au lieu d'être conservée).
--    Les lignes existantes reçoivent une colonne vide.
alter table public.events add column if not exists base_version integer
  constraint events_base_version_jamais_conservee check (base_version is null);
alter table public.days   add column if not exists base_version integer
  constraint days_base_version_jamais_conservee check (base_version is null);

-- 3. Réglage du mode (souple par défaut ; une nouvelle exécution ne le change pas)
create table if not exists private.reglages (
  cle    text primary key,
  valeur boolean not null
);
insert into private.reglages (cle, valeur) values ('version_obligatoire', false)
  on conflict (cle) do nothing;

-- 4. Registre de suivi : des compteurs, aucun contenu d'observation
create table if not exists private.journal_versions (
  jour         date        not null,
  table_nom    text        not null,
  parent       uuid        not null,
  avec_version boolean     not null,
  nb           integer     not null default 0,
  dernier      timestamptz not null,
  primary key (jour, table_nom, parent, avec_version)
);

-- Tables privées : aucun accès pour l'application ni pour les visiteurs (RLS actif, aucune règle)
alter table private.reglages         enable row level security;
alter table private.journal_versions enable row level security;
revoke all on private.reglages, private.journal_versions from public, anon, authenticated;

-- 5. Le serveur vérifie la version de départ de chaque modification
create or replace function private.verifier_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  obligatoire boolean;
  envoyee     boolean;
  utilisateur uuid := auth.uid();        -- le compte connecté (jeton vérifié par Supabase), pas le propriétaire de la fonction
begin
  if tg_op = 'INSERT' then
    new.base_version := null;            -- création : rien à vérifier, rien à conserver
    return new;
  end if;

  -- Valeur réellement ENVOYÉE dans cette requête : non vide et différente de la valeur déjà
  -- enregistrée (toujours vide, grâce à la contrainte). Une mise à jour partielle qui ne
  -- mentionne pas base_version reçoit l'ancienne valeur (vide) : elle compte comme « absente ».
  envoyee := new.base_version is not null and new.base_version is distinct from old.base_version;

  if envoyee then
    -- 1. La version de départ doit être la version ACTUELLE
    if new.base_version <> old.version then
      raise exception using
        errcode = 'JFV02',
        message = format('La fiche a changé depuis votre dernière synchronisation (version %s, version actuelle %s). Rien n''a été écrit.',
                         new.base_version, old.version);
    end if;
  elsif utilisateur is not null then
    -- 2. Version absente, envoyée par un téléphone : acceptée en mode souple, refusée en mode obligatoire
    select valeur into obligatoire from private.reglages where cle = 'version_obligatoire';
    if coalesce(obligatoire, false) then
      raise exception using
        errcode = 'JFV01',
        message = 'Mise à jour de l''application nécessaire : fermez puis rouvrez le Journal. Vos changements restent dans le téléphone.';
    end if;
  end if;

  -- Registre de suivi (comptes connectés seulement)
  if utilisateur is not null then
    insert into private.journal_versions as j (jour, table_nom, parent, avec_version, nb, dernier)
    values (current_date, tg_table_name, utilisateur, envoyee, 1, now())
    on conflict (jour, table_nom, parent, avec_version)
      do update set nb = j.nb + 1, dernier = excluded.dernier;
  end if;

  -- 3. Jamais conservée
  new.base_version := null;
  return new;
end;
$$;
revoke all on function private.verifier_version() from public, anon, authenticated;

drop trigger if exists events_base on public.events;
create trigger events_base before insert or update on public.events
  for each row execute function private.verifier_version();
drop trigger if exists days_base on public.days;
create trigger days_base before insert or update on public.days
  for each row execute function private.verifier_version();

-- 6. Vérification : mêmes données, mêmes règles d'accès, RLS actif, tables privées fermées ; sinon tout est annulé
do $$
declare
  a record;
  b record;
  sans_rls int;
  prive_ouvert int;
begin
  select * into a from _avant;
  select
    (select count(*) from public.events) as nb,
    (select md5(coalesce(string_agg(row(id, date, time, type, intensity, note, duration_min, place, people,
             state_before, context, description, adult_reaction, intervention, child_reaction,
             calm_time_min, helped, extra, marked_complete, author_id, created_at, updated_at,
             updated_by, version, deleted_at, outcome, impressions, original_text, categories,
             approval_version, approved_at, approved_by)::text, '|' order by id), ''))
       from public.events) as observations,
    (select md5(coalesce(string_agg(row(date, rating, belle, created_at, updated_at, updated_by, version)::text, '|' order by date), ''))
       from public.days) as journees,
    (select md5(coalesce(string_agg(row(id, event_id, text, author_id, created_at)::text, '|' order by id), ''))
       from public.comments) as commentaires,
    (select md5(coalesce(string_agg(row(tablename, policyname, permissive, roles, cmd, qual, with_check)::text, '|' order by tablename, policyname), ''))
       from pg_policies where schemaname = 'public') as regles_rls,
    (select md5(coalesce(string_agg(row(c.relname, c.relrowsecurity, c.relforcerowsecurity)::text, '|' order by c.relname), ''))
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname in ('parents', 'days', 'events', 'comments')) as rls_tables,
    (select md5(coalesce(string_agg(row(table_name, grantee, privilege_type)::text, '|' order by table_name, grantee, privilege_type), ''))
       from information_schema.role_table_grants
       where table_schema = 'public' and table_name in ('parents', 'days', 'events', 'comments')) as droits,
    (select md5(coalesce(string_agg(row(c.relname, t.tgname, pg_get_triggerdef(t.oid))::text, '|' order by c.relname, t.tgname), ''))
       from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and not t.tgisinternal and t.tgname not in ('events_base', 'days_base')) as declencheurs,
    (select md5(coalesce(string_agg(pg_get_functiondef(p.oid), '|' order by p.proname), ''))
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'private' and p.proname in ('is_parent', 'stamp_row', 'stamp_comment', 'stamp_approval')) as fonctions
  into b;
  if a.nb <> b.nb or a.observations <> b.observations or a.journees <> b.journees or a.commentaires <> b.commentaires then
    raise exception 'Migration annulée : les données existantes auraient changé (observations avant %, après %).', a.nb, b.nb;
  end if;
  if a.regles_rls <> b.regles_rls or a.rls_tables <> b.rls_tables or a.droits <> b.droits
     or a.declencheurs <> b.declencheurs or a.fonctions <> b.fonctions then
    raise exception 'Migration annulée : les règles d''accès, les droits ou les déclencheurs existants auraient changé.';
  end if;
  select count(*) into sans_rls
  from (values ('parents'), ('days'), ('events'), ('comments')) t(nom)
  left join pg_class c on c.relname = t.nom and c.relnamespace = 'public'::regnamespace
  where c.oid is null or not c.relrowsecurity;
  if sans_rls > 0 then
    raise exception 'Migration annulée : le RLS n''est pas actif sur % table(s) parmi parents, days, events, comments.', sans_rls;
  end if;
  select count(*) into prive_ouvert
  from (values ('anon'), ('authenticated')) r(role), (values ('private.reglages'), ('private.journal_versions')) t(nom)
  where has_table_privilege(r.role, t.nom, 'select') or has_table_privilege(r.role, t.nom, 'insert')
     or has_table_privilege(r.role, t.nom, 'update') or has_table_privilege(r.role, t.nom, 'delete');
  if prive_ouvert > 0 then
    raise exception 'Migration annulée : les tables privées seraient accessibles à l''application ou aux visiteurs.';
  end if;
  -- Les visiteurs n'ont aucun accès au schéma privé (les comptes connectés n'y ont que l'usage
  -- nécessaire aux règles RLS existantes, sans aucun droit sur les tables ajoutées ici)
  if has_schema_privilege('anon', 'private', 'usage') or has_schema_privilege('anon', 'private', 'create')
     or has_schema_privilege('authenticated', 'private', 'create') then
    raise exception 'Migration annulée : le schéma privé serait ouvert aux visiteurs ou modifiable par l''application.';
  end if;
  -- Fonction SECURITY DEFINER : chemin de recherche vide, appartenant au propriétaire des tables
  -- privées, et non exécutable directement par l'application, les visiteurs ou « public »
  if not exists (
       select 1 from pg_proc p
       where p.oid = 'private.verifier_version()'::regprocedure
         and p.prosecdef
         -- search_path vide, lu sans dépendre de l'écriture exacte : une seule entrée
         -- « search_path=… », dont la valeur, sans guillemets ni espaces, est vide
         -- (refuse par exemple « public » ou « "", public »)
         and (select count(*) from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
              where cfg like 'search_path=%') = 1
         and not exists (select 1 from unnest(p.proconfig) cfg
                         where cfg like 'search_path=%'
                           and btrim(substr(cfg, length('search_path=') + 1), ' "') <> '')
         and p.proowner = (select c.relowner from pg_class c where c.oid = 'private.journal_versions'::regclass)
         and p.proowner = (select c.relowner from pg_class c where c.oid = 'private.reglages'::regclass))
     or has_function_privilege('anon', 'private.verifier_version()', 'execute')
     or has_function_privilege('authenticated', 'private.verifier_version()', 'execute')
     or exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) droit
                where p.oid = 'private.verifier_version()'::regprocedure and droit.grantee = 0) then
    raise exception 'Migration annulée : la fonction de vérification n''a pas les protections attendues.';
  end if;
  -- Aucune base_version conservée, et les contraintes « jamais conservée » sont en place
  if exists (select 1 from public.events where base_version is not null)
     or exists (select 1 from public.days where base_version is not null)
     or (select count(*) from pg_constraint
         where conname in ('events_base_version_jamais_conservee', 'days_base_version_jamais_conservee')) <> 2 then
    raise exception 'Migration annulée : la colonne base_version n''est pas protégée comme prévu.';
  end if;
end $$;

commit;

-- 7. Résultat attendu : une ligne avec  colonnes_base = 2,  declencheurs = 2,  mode = souple,
--    regles_rls = 10,  tables_avec_rls = 4,  observations = le même nombre qu'avant.
select
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name in ('events', 'days') and column_name = 'base_version') as colonnes_base,
  (select count(*) from pg_trigger where tgname in ('events_base', 'days_base'))                      as declencheurs,
  (select case when valeur then 'OBLIGATOIRE' else 'souple' end
     from private.reglages where cle = 'version_obligatoire')                                         as mode,
  (select count(*) from pg_policies where schemaname = 'public')                                      as regles_rls,
  (select count(*) from pg_class
     where relnamespace = 'public'::regnamespace and relrowsecurity
       and relname in ('parents', 'days', 'events', 'comments'))                                      as tables_avec_rls,
  (select count(*) from public.events)                                                                as observations;
