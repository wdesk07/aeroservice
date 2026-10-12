# Aéro Service — plan de vérification Présences et Pénalités

Ce document est un plan de test. Il ne signifie pas que les scénarios ont déjà été exécutés.

## Préconditions

- Utiliser uniquement une base Supabase de test isolée, avec sauvegarde préalable.
- Vérifier que les migrations de règles de pénalité et de catégories sont appliquées sur cette base.
- Utiliser des comptes de test avec les rôles apprenant, enseignant, personnel, secrétariat, comptabilité et direction.
- Ne pas utiliser de vrais paiements ni de données personnelles réelles.
- Ne pas fusionner ni déployer en production tant que les scénarios bloquants ne sont pas validés.

## Retard manuel — formulaire secrétariat

- [ ] Une heure d'arrivée postérieure à l'heure prévue crée un retard avec le nombre de minutes attendu.
- [ ] Une heure d'arrivée identique à l'heure prévue est refusée avant insertion.
- [ ] Une heure d'arrivée antérieure à l'heure prévue est refusée avant insertion.
- [ ] Un montant vide, non numérique, décimal, nul, négatif ou supérieur à la capacité entière sûre est refusé.
- [ ] Des heures mal formées sont refusées.
- [ ] La date locale est utilisée pour composer l'heure prévue et l'heure constatée, y compris autour de minuit.
- [ ] Un compte secrétariat ne peut pas autoriser l'accès du personnel.
- [ ] Un compte non autorisé ne peut pas créer de retard manuel.
- [ ] Une erreur après la création du retard laisse l'accès bloqué et affiche une explication exploitable.

## Règles automatiques de pénalité

- [ ] Une règle inactive n'est jamais appliquée.
- [ ] Une règle manuelle n'est jamais appliquée automatiquement.
- [ ] Seule une règle automatique de type retard est appliquée par le pointage.
- [ ] Les portées « tout le monde », « apprenants », « personnel » et « enseignants » ne ciblent que les personnes attendues.
- [ ] Les limites de retard minimum, tolérance, retard maximum et heure limite sont vérifiées aux bornes exactes.
- [ ] Les dates d'effet et de fin sont respectées selon le fuseau Africa/Porto-Novo.
- [ ] Un même événement de présence ne produit jamais plusieurs pénalités.
- [ ] Une erreur de lecture/création de pénalité ne débloque jamais l'accès par défaut.

## Paiement, régularisation et accès

- [ ] Une pénalité automatique dont le montant diffère du montant présenté n'est pas encaissée automatiquement.
- [ ] Un paiement de pénalité reprend le bénéficiaire et le montant issus de la base.
- [ ] Un paiement ordinaire ne référence aucune pénalité.
- [ ] Un paiement de pénalité exige une pénalité existante et payable.
- [ ] Un paiement refusé ou en attente ne régularise pas le retard.
- [ ] Seul un paiement effectivement validé par la base peut déclencher la régularisation.
- [ ] Une erreur de mise à jour de l'accès après validation est signalée et auditée.
- [ ] La répétition de la même action ne crée pas un second paiement validé ou un second reçu.
- [ ] Le reçu n'est émis qu'après validation.

## Pointage QR — critères avant implémentation

- [ ] Le QR imprimé pointe vers une URL fixe de l'application, pas vers l'identité d'une personne.
- [ ] L'utilisateur doit être authentifié; après connexion, le flux reprend sans perdre la destination.
- [ ] Le serveur détermine la personne depuis la session authentifiée, jamais depuis un identifiant fourni par le navigateur.
- [ ] Le serveur vérifie la séance ouverte, le calendrier, le rôle et la fenêtre de pointage.
- [ ] Le pointage répété pour la même personne et la même séance est idempotent/refusé sans doublon.
- [ ] La pénalité éventuelle est calculée côté base/serveur à partir des règles actives.
- [ ] Une erreur ou une requête non autorisée ne peut ni créer une présence au nom d'autrui ni débloquer l'accès.
- [ ] L'impression du QR inclut le logo officiel, l'URL lisible et une instruction simple.
- [ ] Les journaux permettent d'identifier l'auteur, l'heure et la source du pointage sans exposer de secrets.

## Validation avant fusion

- [ ] Build de production et vérification TypeScript réussis.
- [ ] Vérification des politiques RLS et des fonctions/trigger sur la base de test.
- [ ] Tests de rôles croisés : apprenant, enseignant, personnel, secrétariat, comptabilité, direction.
- [ ] Aperçu de branche vérifié dans le navigateur.
- [ ] Aucun secret ni identifiant d'accès ajouté au dépôt.
- [ ] Validation explicite avant toute fusion et tout déploiement en production.
