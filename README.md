# Journal familial

Journal d'observation familial (PWA) pour deux parents : calendrier, ajout rapide, fiches détaillées, évolution et rapports.
Outil d'observation descriptif : **il n'établit aucun diagnostic**.

## État : phase 3 (comptes et synchronisation)

- Calendrier mensuel (semaine du dimanche), couleur de la journée choisie par les parents, suggestion transparente, « Non évaluée ».
- Bouton « Belle journée » (un toucher).
- Ajout rapide (intensité, type, note, bouton de dictée via le clavier).
- Fiches détaillées (tous les champs facultatifs), commentaires, indicateur « À compléter ».
- Corbeille de 30 jours, journal avec recherche simple.
- Code à 4 chiffres, verrouillage à l'ouverture et après 5 minutes d'inactivité.
- Sauvegarde protégée par mot de passe, export lisible, restauration par fusion (sans doublons).

Phase 3 :

- Connexion de Papa et Maman avec leurs comptes Supabase (aucune inscription possible).
- Synchronisation automatique entre les deux téléphones, même hors ligne : tout est d'abord enregistré chiffré dans le téléphone, puis envoyé au retour du réseau. L'état est affiché en haut (« Synchronisé », « 2 en attente », « Hors ligne »…).
- Conflits : si la même fiche est modifiée sur les deux téléphones, les parents choisissent la version à garder ; l'autre est conservée en commentaire. Rien n'est écrasé en silence.
- Commentaires ajoutés, jamais remplacés ; corbeille de 30 jours partagée.
- Les données fictives « [Exemple] » restent dans le téléphone.

Phase 4 (observations structurées) :

- Récit dicté (micro du clavier) ou tapé, relu et corrigé avant de continuer ; brouillon gardé chiffré automatiquement (fermeture, verrouillage, mise à jour : rien n'est perdu).
- Organisation proposée dans le téléphone, **sans intelligence artificielle ni envoi** : des règles explicables rangent les phrases du parent dans 6 sections (Contexte, Ce qui s'est passé, Réaction de l'enfant, Intervention du parent, Résultat observé, Impressions du parent). Les phrases sont rangées, jamais réécrites ; la raison de chaque classement est affichée.
- Catégories suggérées (8, fixes) selon les mots du récit ; questions facultatives (2 au plus) ; jugements et termes de diagnostic signalés.
- Validation obligatoire : texte original, classement, sections et catégories modifiables, puis « Approuver ». L'app enregistre d'abord la fiche, puis envoie l'approbation seule, liée à la version relue ; le serveur refuse une approbation qui modifie la fiche, une nouvelle fiche envoyée déjà approuvée, et toute demande ancienne ou rejouée, puis fixe lui-même la date et le parent approbateur, retire l'approbation si le contenu de la fiche change (sections, note, date, heure, endroit, catégories…) sans nouvelle approbation, refuse toute approbation sans parent connecté, et verrouille le texte original.

### Phase 5 : recherche, statistiques et rapports (0.5.0)
- **Journal** : filtres combinables (période, type, intensité, catégories, endroit, parent, approbation, « À compléter ») et recherche de plusieurs mots, sans tenir compte des accents. « Créer un rapport avec ces filtres » reprend la sélection dans l'onglet Rapports.
- **Évolution** : journées positives, avec difficultés et non évaluées (une journée sans couleur n'est jamais comptée comme une journée sans difficulté), tendances par semaine et par mois, catégories et contextes les plus fréquents (endroits, moments, jours), interventions associées au retour au calme le plus rapide — présentées comme une association observée, jamais comme une cause. Le nombre d'observations utilisées est toujours affiché.
- **Rapports** : résumé d'une page ou rapport détaillé, aperçu avant impression, période et filtres, seulement les fiches approuvées par défaut (les autres, si on les ajoute, sont marquées), impressions des parents dans une section séparée des faits (option), textes originaux en annexe (option), masquage des renseignements personnels (activé par défaut).
- **Confidentialité** : le rapport est construit dans le téléphone, uniquement dans la page ouverte. Il n'est ni envoyé, ni enregistré, ni mis en cache ; il est effacé à la fermeture de l'aperçu et au verrouillage. Le PDF est produit par la fenêtre d'impression du téléphone (« Enregistrer au format PDF »).

## Confidentialité

- **Aucune donnée n'est dans ce dépôt**, ni aucun prénom : il contient uniquement le code, et les tests utilisent des données fictives. Le prénom de l'enfant est saisi dans l'application et enregistré chiffré dans le téléphone.
- Aucune bibliothèque externe ni police externe. Le seul serveur contacté est le projet Supabase privé du journal (HTTPS).
- Le code contient seulement l'adresse du projet et sa clé « publishable », conçues pour être publiques : sans un compte parent, elles n'ouvrent rien (règles RLS, voir `supabase/`). La clé secrète n'est jamais dans ce dépôt.
- La session de connexion est chiffrée dans le téléphone comme les observations.
- Les observations sont chiffrées (AES-GCM 256 bits) avant d'être écrites dans le stockage du navigateur, avec une clé non exportable.
- Le code à 4 chiffres empêche l'ouverture de l'application ; il ne remplace pas le verrouillage d'écran du téléphone, qui active le chiffrement d'Android.
- Les sauvegardes protégées utilisent un mot de passe d'au moins 10 caractères (PBKDF2, 310 000 itérations + AES-GCM).

## Base de données

Les scripts SQL du dossier `supabase/` créent les tables et les règles d'accès (à exécuter dans le SQL Editor de Supabase, dans l'ordre).

## Tests

```
node tests/test_sync.mjs        # synchronisation, hors ligne, conflits (faux serveur, données fictives)
node tests/test_organize.mjs    # organisation locale des récits (récits fictifs ; aucun mot ajouté ni perdu)
node tests/test_compat.mjs      # compatibilité 0.3.0 ↔ 0.4.0 et ordre « script 04 → publication »
PGLITE=<dossier> node tests/test_sql.mjs  # scripts SQL 01, 02, 04 sur PostgreSQL local (PGlite), sans Supabase (WITH05=1 : rejoué avec le script 05 installé)
node tests/test_versions.mjs    # vérification des versions (script 05) : concurrence hors ligne, 0.3.0/0.4.0/0.4.1, modes souple et obligatoire
PGLITE=<dossier> node tests/test_sql05.mjs  # script SQL 05 (et 05a, 05b, 05c) sur PostgreSQL local (PGlite)
PGLITE=<dossier> node tests/test_postgrest05.mjs  # script 05 face aux requêtes PATCH/POST telles que PostgREST les exécute (corps 0.4.0 et 0.4.1)
node tests/serve.mjs            # app de test : http://localhost:8766/index.html?mock
                                # tests de sécurité réels : http://localhost:8766/tests/rls.html
python3 tests/test_phase2.py    # fonctions locales (Python, Playwright et Chrome)
```
Comptes fictifs du faux serveur : papa@test.local, maman@test.local (voir `tests/mock-supabase.mjs`). Les captures d'écran vont dans `tests/output/` (ignoré par Git).
