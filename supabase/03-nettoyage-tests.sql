-- =====================================================================
-- Journal familial — Nettoyage après les tests de sécurité
-- Efface UNIQUEMENT les données fictives créées par la page de tests (date 2099-12-31,
-- texte commençant par « [TEST RLS] »). Aucune vraie observation n'est touchée.
-- =====================================================================

delete from public.comments where text like '[TEST RLS]%';
delete from public.events   where date = '2099-12-31' and note like '[TEST RLS]%';
delete from public.days     where date = '2099-12-31';

-- Vérification : les 3 nombres doivent être 0
select
  (select count(*) from public.events   where note like '[TEST RLS]%') as evenements_test,
  (select count(*) from public.comments where text like '[TEST RLS]%') as commentaires_test,
  (select count(*) from public.days     where date = '2099-12-31')     as journees_test;
