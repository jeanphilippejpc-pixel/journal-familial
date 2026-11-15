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

À venir : structuration des notes dictées (phase 4), statistiques et PDF (phase 5).

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
node tests/serve.mjs            # app de test : http://localhost:8766/index.html?mock
                                # tests de sécurité réels : http://localhost:8766/tests/rls.html
python3 tests/test_phase2.py    # fonctions locales (Python, Playwright et Chrome)
```
Comptes fictifs du faux serveur : papa@test.local, maman@test.local (voir `tests/mock-supabase.mjs`). Les captures d'écran vont dans `tests/output/` (ignoré par Git).
