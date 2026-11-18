-- =====================================================================
-- Journal familial — ACTIVER le mode obligatoire de vérification des versions
--
-- NE PAS EXÉCUTER sans l'accord explicite des parents, même si le suivi (05a) est favorable.
-- Rien ne l'active automatiquement.
--
-- Conditions à vérifier avant :
--   - chaque appareil affiche « Version 0.4.1 » (ou plus) dans Paramètres, « Synchronisé »,
--     et aucun changement en attente ;
--   - le suivi 05a montre 0 modification « sans_version » depuis au moins 7 jours ;
--   - une sauvegarde chiffrée a été faite sur chaque téléphone.
--
-- Effet : une modification sans version de départ (app 0.4.0 ou 0.3.0) est refusée ; elle
-- reste dans le téléphone, avec le message « Mise à jour de l'application nécessaire », et
-- sera envoyée après la mise à jour. Les créations et les commentaires ne sont pas concernés.
-- Retour arrière : script 05c.
-- =====================================================================

update private.reglages set valeur = true where cle = 'version_obligatoire';

-- Résultat attendu : mode = OBLIGATOIRE
select case when valeur then 'OBLIGATOIRE' else 'souple' end as mode
from private.reglages where cle = 'version_obligatoire';
