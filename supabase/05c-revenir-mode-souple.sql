-- =====================================================================
-- Journal familial — REVENIR au mode souple de vérification des versions
--
-- À utiliser si un appareil oublié (app ancienne) doit pouvoir envoyer ses modifications.
-- Une version de départ périmée reste TOUJOURS refusée (aucun écrasement possible) ;
-- seules les modifications SANS version de départ redeviennent acceptées.
-- =====================================================================

update private.reglages set valeur = false where cle = 'version_obligatoire';

-- Résultat attendu : mode = souple
select case when valeur then 'OBLIGATOIRE' else 'souple' end as mode
from private.reglages where cle = 'version_obligatoire';
