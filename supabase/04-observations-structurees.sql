-- =====================================================================
-- Journal familial — Étape 4 : observations structurées (phase 4) — version 5
--
-- Ce script AJOUTE des colonnes à la table des observations. Il ne modifie, ne déplace
-- et n'efface aucune observation existante, et ne change aucune règle d'accès (RLS).
--
--   outcome           Résultat observé
--   impressions       Impressions du parent (séparées des faits)
--   original_text     Texte original dicté ou tapé : verrouillé par le serveur une fois enregistré
--   categories        Catégories choisies (liste fixe de 8, vérifiée par le serveur)
--   approval_version  Version de la fiche que le parent a relue et approuvée
--   approved_at       Date d'approbation : écrite UNIQUEMENT par le serveur
--   approved_by       Parent qui a approuvé : écrit UNIQUEMENT par le serveur (compte connecté)
--
-- Règles d'approbation (fonction private.stamp_approval) :
--   1. Approuver est une requête SÉPARÉE, qui ne contient que approval_version = le numéro de
--      version de la fiche que le parent a relue. Le serveur ne l'accepte que si :
--        a) ce numéro est EXACTEMENT la version actuelle de la fiche ;
--        b) la requête ne modifie RIEN au contenu (on n'approuve que ce qui est déjà enregistré) ;
--        c) elle vient d'un parent connecté et autorisé.
--      Sinon, elle est REFUSÉE en entier (rien n'est approuvé, rien n'est écrit).
--      Comme chaque modification (et chaque approbation) augmente la version, une demande
--      ancienne, rejouée ou envoyée en même temps qu'une autre porte un numéro périmé.
--      Une NOUVELLE fiche ne peut pas être approuvée à l'envoi : enregistrement d'abord,
--      approbation ensuite. Les valeurs envoyées dans approved_at / approved_by sont ignorées.
--      Ordre des déclencheurs : events_approval s'exécute avant events_stamp (ordre
--      alphabétique, règle de PostgreSQL). Il lit seulement old.version ; events_stamp
--      augmente ensuite la version une seule fois (old.version + 1). Les deux sont
--      indépendants : events_stamp ne touche aucune colonne du contenu comparé.
--   2. Sans demande d'approbation, toute modification du CONTENU de la fiche retire l'approbation :
--      date, heure, type, intensité, note, durée, endroit, personnes, état avant, les 6 sections,
--      réaction des adultes, retour au calme, ce qui a aidé, notes supplémentaires, catégories,
--      texte original. Ne la retirent pas : la mise à la corbeille / restauration et la case
--      « Fiche complète » (elles ne changent pas ce qui a été approuvé).
--   3. Seul un parent connecté et autorisé peut approuver (même depuis le SQL Editor, sans
--      compte connecté, une approbation est refusée).
--   4. Un téléphone en 0.3.0 ne connaît pas ces colonnes : il ne peut pas approuver, et s'il
--      modifie le contenu, l'approbation est retirée.
--   5. Texte original : un texte vide compte comme « absent » ; une fois un vrai texte
--      enregistré, personne ne peut le modifier ni l'effacer.
--
-- Sécurité de la migration (tout dans une seule transaction) :
--   - Empreinte des observations, journées et commentaires (nombre + contenu) avant et après.
--   - Empreinte des règles RLS, de l'activation du RLS sur les 4 tables (parents, days,
--     events, comments), des droits d'accès, des autres déclencheurs et des fonctions
--     existantes, avant et après.
--   - Le RLS doit être actif sur les 4 tables.
--   - À la moindre différence, tout est annulé automatiquement et rien n'est changé.
--
-- À exécuter dans Supabase > SQL Editor, après les étapes 1 et 2.
-- Peut être relancé sans risque (les colonnes déjà présentes ne sont pas recréées).
-- =====================================================================

begin;

-- 1. Empreintes AVANT la migration
create temporary table _avant on commit drop as
select
  (select count(*) from public.events) as nb,
  (select md5(coalesce(string_agg(row(id, date, time, type, intensity, note, duration_min, place, people,
           state_before, context, description, adult_reaction, intervention, child_reaction,
           calm_time_min, helped, extra, marked_complete, author_id, created_at, updated_at,
           updated_by, version, deleted_at)::text, '|' order by id), ''))
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
     where n.nspname = 'public' and not t.tgisinternal and t.tgname <> 'events_approval') as declencheurs,
  (select md5(coalesce(string_agg(pg_get_functiondef(p.oid), '|' order by p.proname), ''))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private' and p.proname in ('is_parent', 'stamp_row', 'stamp_comment')) as fonctions;

-- 2. Nouvelles colonnes (toutes facultatives ; categories vaut une liste vide par défaut)
alter table public.events
  add column if not exists outcome          text check (char_length(outcome) <= 5000),
  add column if not exists impressions      text check (char_length(impressions) <= 5000),
  add column if not exists original_text    text check (char_length(original_text) <= 10000),
  add column if not exists categories       text[] not null default '{}'
    check (categories <@ array['emotions', 'comportements', 'social', 'autonomie',
                               'communication', 'sommeil', 'apprentissages', 'reussites']::text[]
           and cardinality(categories) <= 8),
  add column if not exists approval_version integer check (approval_version >= 0),
  add column if not exists approved_at      timestamptz,
  add column if not exists approved_by      uuid references public.parents (user_id);

-- 3. Le serveur contrôle l'approbation et verrouille le texte original
create or replace function private.stamp_approval()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  demande         boolean := false;
  contenu_modifie boolean := false;
begin
  -- Texte original : un texte vide (ou seulement des espaces) compte comme absent
  if new.original_text is not null and btrim(new.original_text) = '' then
    if tg_op = 'INSERT' or old.original_text is null then
      new.original_text := null;
    end if;
  end if;

  if tg_op = 'INSERT' then
    -- Une nouvelle fiche ne peut pas être approuvée à l'envoi : elle doit d'abord être
    -- enregistrée, puis approuvée par une demande distincte, après relecture.
    if new.approval_version is not null then
      raise exception 'Approbation refusée : une nouvelle fiche doit d''abord être enregistrée, puis approuvée séparément.';
    end if;
    new.approved_at := null;             -- valeurs envoyées ignorées
    new.approved_by := null;
    return new;
  end if;

  -- Texte original : une fois enregistré, personne ne peut le modifier ni l'effacer
  if old.original_text is not null and new.original_text is distinct from old.original_text then
    raise exception 'Le texte original ne peut pas être modifié ni effacé.';
  end if;

  -- Le contenu de la fiche change-t-il dans cette requête ?
  contenu_modifie :=
    (new.date, new.time, new.type, new.intensity, new.note, new.duration_min, new.place,
     new.people, new.state_before, new.context, new.description, new.adult_reaction,
     new.intervention, new.child_reaction, new.calm_time_min, new.helped, new.extra,
     new.outcome, new.impressions, new.original_text, new.categories)
    is distinct from
    (old.date, old.time, old.type, old.intensity, old.note, old.duration_min, old.place,
     old.people, old.state_before, old.context, old.description, old.adult_reaction,
     old.intervention, old.child_reaction, old.calm_time_min, old.helped, old.extra,
     old.outcome, old.impressions, old.original_text, old.categories);

  -- Demande d'approbation : un numéro de version différent de celui déjà enregistré
  demande := new.approval_version is not null
             and new.approval_version is distinct from old.approval_version;

  if demande then
    -- a) Elle doit porter sur la version ACTUELLE (sinon : envoi tardif, rejoué, ou fiche
    --    modifiée entre-temps).
    if new.approval_version <> old.version then
      raise exception 'Approbation refusée : elle porte sur une ancienne version de la fiche (version %, version actuelle %). Relisez la fiche et approuvez-la de nouveau.',
        new.approval_version, old.version;
    end if;
    -- b) Elle doit être envoyée SEULE : on n'approuve que le contenu déjà enregistré et relu.
    if contenu_modifie then
      raise exception 'Approbation refusée : une approbation ne peut pas modifier la fiche. Enregistrez d''abord les modifications, relisez, puis approuvez.';
    end if;
    -- c) Seul un parent connecté et autorisé peut approuver
    if auth.uid() is null or not private.is_parent() then
      raise exception 'Approbation refusée : seul un parent connecté peut approuver.';
    end if;
    new.approved_at := now();            -- heure du serveur
    new.approved_by := auth.uid();       -- le parent connecté, jamais une valeur envoyée
    new.approval_version := old.version; -- la version exacte qui a été approuvée
    return new;
  end if;

  -- Pas de demande : l'approbation enregistrée est gardée telle quelle
  -- (les valeurs envoyées pour approved_at / approved_by / approval_version sont ignorées)...
  new.approval_version := old.approval_version;
  new.approved_at := old.approved_at;
  new.approved_by := old.approved_by;
  -- ... sauf si le contenu change : l'approbation est alors retirée
  if contenu_modifie then
    new.approved_at := null;
    new.approved_by := null;
  end if;
  return new;
end;
$$;
revoke all on function private.stamp_approval() from public, anon, authenticated;

drop trigger if exists events_approval on public.events;
create trigger events_approval before insert or update on public.events
  for each row execute function private.stamp_approval();

-- 4. Vérification : mêmes données, mêmes règles d'accès, RLS actif partout ; sinon tout est annulé
do $$
declare
  a record;
  b record;
  sans_rls int;
begin
  select * into a from _avant;
  select
    (select count(*) from public.events) as nb,
    (select md5(coalesce(string_agg(row(id, date, time, type, intensity, note, duration_min, place, people,
             state_before, context, description, adult_reaction, intervention, child_reaction,
             calm_time_min, helped, extra, marked_complete, author_id, created_at, updated_at,
             updated_by, version, deleted_at)::text, '|' order by id), ''))
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
       where n.nspname = 'public' and not t.tgisinternal and t.tgname <> 'events_approval') as declencheurs,
    (select md5(coalesce(string_agg(pg_get_functiondef(p.oid), '|' order by p.proname), ''))
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'private' and p.proname in ('is_parent', 'stamp_row', 'stamp_comment')) as fonctions
  into b;
  if a.nb <> b.nb or a.observations <> b.observations or a.journees <> b.journees or a.commentaires <> b.commentaires then
    raise exception 'Migration annulée : les données existantes auraient changé (observations avant %, après %).', a.nb, b.nb;
  end if;
  if a.regles_rls <> b.regles_rls or a.rls_tables <> b.rls_tables or a.droits <> b.droits
     or a.declencheurs <> b.declencheurs or a.fonctions <> b.fonctions then
    raise exception 'Migration annulée : les règles d''accès, les droits ou les déclencheurs existants auraient changé.';
  end if;
  -- Le RLS doit être actif sur les 4 tables (pas seulement « inchangé »)
  select count(*) into sans_rls
  from (values ('parents'), ('days'), ('events'), ('comments')) t(nom)
  left join pg_class c on c.relname = t.nom and c.relnamespace = 'public'::regnamespace
  where c.oid is null or not c.relrowsecurity;
  if sans_rls > 0 then
    raise exception 'Migration annulée : le RLS n''est pas actif sur % table(s) parmi parents, days, events, comments.', sans_rls;
  end if;
end $$;

commit;

-- 5. Résultat attendu : une ligne avec  nouvelles_colonnes = 7,  declencheur = 1,
--    regles_rls = 10,  tables_avec_rls = 4, et observations = le même nombre qu'avant.
select
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'events'
       and column_name in ('outcome', 'impressions', 'original_text', 'categories',
                           'approval_version', 'approved_at', 'approved_by'))                   as nouvelles_colonnes,
  (select count(*) from pg_trigger where tgname = 'events_approval')                           as declencheur,
  (select count(*) from pg_policies where schemaname = 'public')                              as regles_rls,
  (select count(*) from pg_class
     where relnamespace = 'public'::regnamespace and relrowsecurity
       and relname in ('parents', 'days', 'events', 'comments'))                              as tables_avec_rls,
  (select count(*) from public.events)                                                        as observations;
