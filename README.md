# Journal familial

Journal d'observation familial (PWA) pour deux parents : calendrier, ajout rapide, fiches détaillées, évolution et rapports.
Outil d'observation descriptif : **il n'établit aucun diagnostic**.

## État : phase 2 (fonctionnement local)

- Calendrier mensuel (semaine du dimanche), couleur de la journée choisie par les parents, suggestion transparente, « Non évaluée ».
- Bouton « Belle journée » (un toucher).
- Ajout rapide (intensité, type, note, bouton de dictée via le clavier).
- Fiches détaillées (tous les champs facultatifs), commentaires, indicateur « À compléter ».
- Corbeille de 30 jours, journal avec recherche simple.
- Code à 4 chiffres, verrouillage à l'ouverture et après 5 minutes d'inactivité.
- Sauvegarde protégée par mot de passe, export lisible, restauration par fusion (sans doublons).

À venir : comptes et synchronisation (phase 3), structuration des notes dictées (phase 4), statistiques et PDF (phase 5).

## Confidentialité

- **Aucune donnée n'est dans ce dépôt**, ni aucun prénom : le prénom de l'enfant est saisi dans l'application et enregistré chiffré dans le téléphone.
- **Aucune donnée n'est dans ce dépôt.** Le dépôt contient uniquement le code. Les tests utilisent des données fictives.
- Aucune bibliothèque externe, aucune police ni service tiers : l'application ne contacte aucun serveur dans cette phase.
- Les observations sont chiffrées (AES-GCM 256 bits) avant d'être écrites dans le stockage du navigateur, avec une clé non exportable.
- Le code à 4 chiffres empêche l'ouverture de l'application ; il ne remplace pas le verrouillage d'écran du téléphone, qui active le chiffrement d'Android.
- Les sauvegardes protégées utilisent un mot de passe d'au moins 10 caractères (PBKDF2, 310 000 itérations + AES-GCM).

## Tests

```
python3 tests/test_phase2.py
```
Nécessite Python, Playwright et Chrome. Les captures d'écran vont dans `tests/output/` (ignoré par Git).
