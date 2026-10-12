# Aéro Service — plan de vérification de finalisation

## Règles de sécurité
- Travailler sur `finalisation-audit-securite`, dérivée de `finance-dashboard-first-pass`.
- Ne pas fusionner dans `main` et ne pas déployer en production sans revue et accord explicite.
- Ne jamais tester avec de vrais paiements ou modifier des données de production.
- Appliquer les migrations uniquement sur un environnement Supabase de test après vérification du projet cible et sauvegarde.

## Point détecté à corriger
Le formulaire de paiement ordinaire permet un payeur externe sans compte Aéro Service (nom du payeur, sans `person_id`). La migration `20261010120000_support_ordinary_payments.sql` rejette cependant tout paiement ordinaire dont `person_id` est nul (`PAYMENT_PERSON_REQUIRED`). La migration corrective `20261012120000_allow_external_ordinary_payments.sql` autorise le payeur externe nommé, tout en exigeant soit un bénéficiaire lié à la plateforme, soit un nom de payeur non vide. Elle conserve les contrôles de montant positif, de référence de pénalité, le statut initial en attente et l'émission du reçu seulement après validation.

## Tests de régression — paiements
À exécuter uniquement dans un environnement de test après application contrôlée des migrations.

1. Paiement ordinaire avec un bénéficiaire de la plateforme et un montant entier positif : création en attente; pas de numéro de reçu avant validation.
2. Paiement ordinaire d'un payeur externe avec nom non vide et montant positif : création en attente; `person_id` nul accepté.
3. Paiement ordinaire sans bénéficiaire et sans nom de payeur : rejet attendu (`PAYMENT_PAYER_REQUIRED`).
4. Paiement ordinaire avec montant nul, négatif ou absent : rejet attendu.
5. Paiement ordinaire qui référence une pénalité : rejet attendu.
6. Règlement de pénalité sans `penalty_id` : rejet attendu (`PENALTY_REQUIRED`).
7. Règlement de pénalité avec identifiant inexistant, pénalité déjà réglée ou montant incohérent fourni par le client : rejet ou montant/bénéficiaire recalculés côté serveur, selon le cas.
8. Création d'un paiement : statut forcé à `pending`, date et utilisateur de réception définis par le serveur, reçu nul.
9. Validation par un rôle autorisé : date, validateur et numéro de reçu générés par la base.
10. Validation par un rôle non autorisé : refus côté base de données, même si le client contourne l'interface.
11. Tentative de modifier le montant, le type, le bénéficiaire ou la pénalité d'un paiement existant : rejet.
12. Double validation / double soumission : aucune double comptabilisation; vérifier les contraintes et l'état final de la pénalité.

## Contrôles de build et de livraison
- [ ] Installer les dépendances dans `src/` selon le lockfile réellement présent (à confirmer).
- [ ] Exécuter `npm run build` depuis `src/`.
- [ ] Ajouter des tests automatisés pour les fonctions métier critiques; aucun script de test dédié n'a été trouvé dans le `package.json` inspecté.
- [ ] Contrôler les logs de build et les erreurs runtime sur une Preview.
- [ ] Tester les flux avec comptes de test distincts pour chaque rôle.
- [ ] Vérifier les politiques RLS et les fonctions SQL dans Supabase de test.
- [ ] Obtenir une validation explicite avant toute fusion ou mise en production.

## Statut
Le dépôt a été examiné en lecture et une migration corrective a été ajoutée à cette branche. La migration n'a pas été appliquée à Supabase; aucun test d'intégration ni build n'est déclaré réussi à ce stade.
