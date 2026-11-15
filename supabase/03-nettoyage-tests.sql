-- =====================================================================
-- Journal familial — Nettoyage après les tests de sécurité (version 2, plus prudente)
-- Efface UNIQUEMENT les données fictives créées par la page de tests :
--   * observations datées du 2099-12-31 dont la note commence par « [TEST RLS] » ;
--   * commentaires « [TEST RLS] » rattachés à ces observations ;
--   * la journée 2099-12-31, SEULEMENT si aucune vraie observation n'existe à cette date.
-- Garde : si une observation non marquée « [TEST RLS] » existe le 2099-12-31,
-- le script s'arrête AVANT de supprimer quoi que ce soit (rien n'est effacé).
-- Tout se fait dans une seule transaction.
-- =====================================================================

begin;

do $$
declare
  reelles integer;
begin
  select count(*) into reelles
    from public.events
   where date = '2099-12-31'
     and (note is null or note not like '[TEST RLS]%');
  if reelles > 0 then
    raise exception 'ARRÊT : % observation(s) non fictive(s) datée(s) du 2099-12-31. Rien n''a été effacé.', reelles;
  end if;
end $$;

delete from public.comments
 where text like '[TEST RLS]%'
   and event_id in (select id from public.events
                     where date = '2099-12-31' and note like '[TEST RLS]%');

delete from public.events
 where date = '2099-12-31' and note like '[TEST RLS]%';

delete from public.days d
 where d.date = '2099-12-31'
   and not exists (select 1 from public.events e where e.date = d.date);

commit;

-- Vérification : les 3 nombres doivent être 0
select
  (select count(*) from public.events   where note like '[TEST RLS]%') as evenements_test,
  (select count(*) from public.comments where text like '[TEST RLS]%') as commentaires_test,
  (select count(*) from public.days     where date = '2099-12-31')     as journees_test;
