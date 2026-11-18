-- =====================================================================
-- Journal familial — Suivi des versions (LECTURE SEULE : ne modifie rien)
--
-- À lancer dans Supabase > SQL Editor, après le script 05, pour vérifier que tous les
-- appareils sont à jour AVANT d'envisager le mode obligatoire (script 05b).
--
--   avec_version = modifications envoyées par l'app 0.4.1 ou plus récente ;
--   sans_version = modifications envoyées par une app ancienne (0.4.0 ou 0.3.0).
--
-- Ce suivi ne compte que les MODIFICATIONS (pas les créations ni les commentaires).
-- Les dates sont en temps universel (UTC).
-- =====================================================================

-- 1. Mode actuel
select case when valeur then 'OBLIGATOIRE' else 'souple' end as mode
from private.reglages where cle = 'version_obligatoire';

-- 2. Résumé par parent depuis une date (remplacez la date par celle de la publication de la 0.4.1)
select
  coalesce(p.display_name, j.parent::text)                                as parent,
  coalesce(sum(j.nb) filter (where j.avec_version), 0)                    as avec_version,
  coalesce(sum(j.nb) filter (where not j.avec_version), 0)                as sans_version,
  max(j.dernier) filter (where not j.avec_version)                        as derniere_sans_version,
  max(j.dernier)                                                          as derniere_modification
from private.journal_versions j
left join public.parents p on p.user_id = j.parent
where j.jour >= date '2026-11-18'
group by 1
order by 1;
