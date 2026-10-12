# Aéro Service — plan de vérification Présences et Pénalités

Ce document est un plan de test. Il ne signifie pas que les scénarios ont déjà été exécutés.

## État du schéma (lecture seule)

Lors du contrôle de la base Supabase connectée, les colonnes `penalty_type` et `description` sont présentes, mais `target_scope`, `application_mode` et `applies_after_time` ne sont pas présentes sur `penalty_rules`. La migration qui ajoute ces colonnes existe sur la branche Finance, mais elle n'est pas enregistrée dans l'historique de migrations appliquées de la base connectée. Le panneau de règles générales ne doit donc pas être utilisé sur cette base avant un essai isolé et une migration validée.

Autre blocage constaté : la fonction `private.guard_attendance_insert()` actuellement déployée ne prend pas en charge les retards manuels sans `session_id`; elle cherche une séance et lève `Session not found` si aucune séance n'est fournie. La migration de la branche Finance prévoit un chemin manuel contrôlé pour le secrétariat, mais elle n'est pas appliquée à la base connectée. Le formulaire de retard manuel ne doit donc pas être déclaré opérationnel en production tant que cette différence n'a pas été testée et corrigée via une migration approuvée. Aucune migration n'a été appliquée pendant cet audit.

## Plan de test sans frais supplémentaires

### Phase 1 — tests locaux, sans Supabase et sans écriture de données

Depuis le dossier `src`, lancer `npm test`. La suite `tests/attendance-validation.test.mjs` vérifie le calcul du retard, le fuseau du Bénin, les heures mal formées et les montants invalides. Elle ne se connecte pas à Supabase et ne crée aucune présence, pénalité ou paiement.

- [x] Tests unitaires de validation des retards ajoutés.
- [x] Tests unitaires des horaires officiels ajoutés : personnel 08:30/08:31, apprenants 09:15/09:16 et heure courante du Bénin.
- [x] Le formulaire de retard manuel utilise la limite de référence officielle et refuse une arrivée encore dans la tolérance côté interface.
- [ ] La migration de garde serveur des retards manuels est préparée dans la branche, mais non appliquée à la base réelle.
- [x] Une migration de branche prépare une table de présence quotidienne distincte et une RPC QR géolocalisée; elle n'est pas appliquée à Supabase.
- [x] Une page dédiée `/presence/qr` est ajoutée sur la branche et appelle `qr_daily_checkin`; elle n'est pas encore validée de bout en bout. Les coordonnées/rayons du checkpoint sont préparés dans une migration non appliquée.
- [ ] Le pointage de séance doit rester distinct et continuer à utiliser l'heure de début de la séance.
- [x] Les 10 tests initiaux de validation et de limites horaires ont été déclarés exécutés avec succès dans la révision précédente.
- [x] Trois tests de non-régression ont été ajoutés pour le règlement d'une pénalité, mais ils doivent encore être exécutés dans l'environnement local.
- [ ] Confirmer le build Vercel après les dernières corrections TypeScript.
- [ ] Vérifier le build Next.js/TypeScript de la dernière révision.

### Phase 2 — tests d'intégration de la base

Les tests qui insèrent réellement une présence, une pénalité ou un paiement exigent une base isolée. Si aucun environnement isolé sans frais n'est disponible, ces scénarios restent explicitement **non testés**. Ne pas simuler ces écritures dans la base de production.

- Vérifier les migrations et fonctions sur une base de test isolée uniquement.
- Utiliser des comptes de test et des données fictives.
- Ne pas utiliser de vrais paiements ni de données personnelles réelles.
- Ne pas fusionner ni déployer en production tant que les scénarios bloquants ne sont pas validés.

## Retard manuel — formulaire secrétariat

- [ ] Une heure d'arrivée postérieure à l'heure prévue crée un retard avec le nombre de minutes attendu.
- [ ] Une heure d'arrivée identique à l'heure prévue est refusée avant insertion.
- [ ] Une heure d'arrivée antérieure à l'heure prévue est refusée avant insertion.
- [ ] Un montant vide, non numérique, décimal, nul, négatif ou supérieur à la capacité entière sûre est refusé.
- [ ] Des heures mal formées sont refusées.
- [ ] Le fuseau `Africa/Porto-Novo` est utilisé pour composer la date et l'heure prévues/constatées, y compris autour de minuit et si le navigateur est réglé sur un autre fuseau.
- [ ] Un compte secrétariat ne peut pas autoriser l'accès du personnel.
- [ ] Un compte non autorisé ne peut pas créer de retard manuel.
- [ ] Une erreur après la création du retard laisse l'accès bloqué et affiche une explication exploitable.

## Horaires officiels demandés par la Direction

Paramètres métier à appliquer dans le moteur de pointage, en heure locale du Bénin (`Africa/Porto-Novo`) :

- **Personnel, secrétariat et directeur :** heure limite 08:30, tolérance zéro. À 08:30 pile, la personne est à l'heure; après 08:30, elle est en retard.
- **Apprenants :** heure limite 09:00, tolérance de 15 minutes. Jusqu'à 09:15 inclus, l'arrivée est tolérée; à partir de 09:16, elle dépasse la tolérance.
- Les profils doivent être classés côté serveur à partir des données fiables de la personne, et non à partir d'une valeur de type de personne fournie par le navigateur.
- Les horaires ne doivent pas être déduits de l'heure de début d'un cours si la politique concerne l'heure d'arrivée quotidienne.
- Aucun changement de ces paramètres n'a été appliqué à la base de production. Ils doivent être codés et testés dans la branche de travail avant toute migration.

Tests de frontière à ajouter avant validation :

- [x] Tests unitaires de frontière ajoutés pour le personnel : 08:30 à l'heure; 08:31 en retard.
- [x] Tests unitaires de frontière ajoutés pour les apprenants : 09:00 et 09:15 tolérés; 09:16 en retard.
- [ ] Intégrer ces règles au pointage serveur et les valider avant production.
- [ ] Le fuseau `Africa/Porto-Novo` est appliqué même si le téléphone utilise un autre fuseau.
- [ ] Les apprenants ne reçoivent pas la tolérance du personnel, et le personnel ne reçoit pas la tolérance des apprenants.
- [x] La saisie manuelle du secrétariat est protégée par une migration de branche qui vérifie les limites quotidiennes côté serveur.
- [x] Une RPC séparée pour le QR quotidien calcule les limites côté serveur sans écraser l'heure de séance.
- [ ] Raccorder l'interface QR à cette RPC, configurer les coordonnées GPS et tester les doublons avant activation.

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

La branche ajoute une fonction de planification du règlement : si aucune pénalité automatique n'existe, le code doit d'abord créer une pénalité manuelle et récupérer son identifiant avant d'insérer un paiement de type `penalty`. Si une pénalité automatique existe, le montant saisi doit correspondre à son montant. Les migrations et tests restent à valider avant production.

- [ ] Une pénalité automatique dont le montant diffère du montant présenté n'est pas encaissée automatiquement.
- [ ] Un paiement de pénalité reprend le bénéficiaire et le montant issus de la base.
- [x] Une garde côté interface impose une pénalité existante avant la création du paiement; tests unitaires de non-régression ajoutés pour éviter PENALTY_REQUIRED si aucune pénalité automatique n'existe.
- [ ] Un paiement ordinaire ne référence aucune pénalité.
- [ ] Un paiement de pénalité exige une pénalité existante et payable.
- [ ] Un paiement refusé ou en attente ne régularise pas le retard.
- [ ] Seul un paiement effectivement validé par la base peut déclencher la régularisation.
- [ ] Une erreur de mise à jour de l'accès après validation est signalée et auditée.
- [ ] La répétition de la même action ne crée pas un second paiement validé ou un second reçu.
- [ ] Le reçu n'est émis qu'après validation.

## Pointage QR — audit du backend et critères

Constat issu de l'inspection en lecture seule de la base Supabase Aéro Service : les tables `checkpoints` et `qr_tokens` et les fonctions `issue_qr_challenge` / `qr_checkin` existent déjà. Le flux actuel utilise un défi à durée courte (15 à 120 secondes, 45 secondes par défaut), consommé une seule fois. Une page utilisateur QR quotidienne est maintenant présente sur la branche de travail, mais elle n'a pas encore été validée de bout en bout. Les deux points de contrôle actifs trouvés (`Entrée Aéro Service` et `Secrétariat`) n'ont pas de coordonnées GPS configurées ni de rayon défini; la vérification de distance ne peut donc pas protéger le QR permanent tant que ces paramètres ne sont pas renseignés et rendus obligatoires côté serveur.

**Décision de sécurité à respecter :** un QR imprimé permanent et un défi QR temporaire renouvelé sont deux modes différents. Ne pas générer un défi depuis la page qui vient d'être ouverte par un scan, car cela permettrait à quelqu'un de lancer le pointage à distance sans avoir scanné un code affiché sur place. Avant d'implémenter l'interface, choisir explicitement entre :
- QR dynamique affiché sur un écran au point de contrôle, renouvelé régulièrement et consommé une seule fois; ou
- QR imprimé permanent qui ouvre l'application, avec une protection de présence distincte et obligatoire côté serveur (par exemple géolocalisation vérifiée et contrôles anti-doublon). La fonction existante ne suffit pas à garantir cette variante si le défi est émis par la page du scan.

- [ ] L'utilisateur doit être authentifié; après connexion, le flux reprend sans perdre la destination.
- [ ] Le serveur détermine la personne depuis `auth.uid()`, jamais depuis un identifiant fourni par le navigateur.
- [ ] Le serveur vérifie la séance ouverte, le calendrier, le rôle et la fenêtre de pointage.
- [ ] Le défi est à usage unique, expire rapidement et n'est jamais enregistré en clair dans la base.
- [ ] Le pointage répété pour la même personne et la même séance est refusé sans doublon.
- [ ] La pénalité éventuelle est calculée côté base/serveur à partir des règles actives.
- [ ] Une erreur ou une requête non autorisée ne peut ni créer une présence au nom d'autrui ni débloquer l'accès.
- [ ] L'impression/affichage du QR inclut le logo officiel, l'URL lisible et une instruction simple.
- [ ] Les journaux identifient l'auteur, l'heure et la source du pointage sans exposer de secrets.

## Validation avant fusion

- [ ] Build de production et vérification TypeScript réussis.
- [ ] Vérification des politiques RLS et des fonctions/trigger sur la base de test.
- [ ] Tests de rôles croisés : apprenant, enseignant, personnel, secrétariat, comptabilité, direction.
- [ ] Aperçu de branche vérifié dans le navigateur.
- [ ] Aucun secret ni identifiant d'accès ajouté au dépôt.
- [ ] Validation explicite avant toute fusion et tout déploiement en production.


## Séparation QR quotidien / séance de cours

La migration `20261012130000_daily_attendance_qr_policy.sql` crée une table distincte `daily_attendance` et une RPC `qr_daily_checkin`. Le pointage quotidien utilise l'heure locale `Africa/Porto-Novo`, un seuil de 08:30 pour le personnel/les enseignants et 09:15 comme fin de tolérance pour les apprenants. Le pointage de cours continue à utiliser `course_sessions.planned_start` via le flux QR existant. La RPC quotidienne refuse le pointage si le checkpoint n'a pas de coordonnées et de rayon valides, si la précision GPS dépasse 50 m, ou si la personne a déjà un pointage quotidien ce jour-là. La fonction est une préparation backend : l'interface QR n'est pas encore raccordée et la migration n'est pas appliquée.


## Registre complet et détection des absences quotidiennes

La migration de branche `20261012133000_daily_student_absence_closure.sql` prépare l'extension de `daily_attendance` pour le statut `absent` et une RPC idempotente `close_daily_student_absences()`. Après 09:16, elle marque absents les apprenants actifs inscrits dans `students` sans pointage quotidien et crée un événement d'audit. Elle ne modifie pas les données de production tant que la migration n'est pas appliquée.

**Limites à traiter avant activation :**
- La base de production consultée ne compte qu'un seul enregistrement dans `students`; le registre complet doit être fourni/importé avant que le bilan d'absences soit représentatif.
- `pg_cron` n'est pas installé dans les extensions consultées. La RPC ne s'exécute donc pas automatiquement à ce stade : un planificateur sécurisé devra l'appeler après 09:16, ou une clôture administrateur contrôlée devra être prévue.
- Le calendrier de présence (jours ouvrés, samedis, jours fériés et fermetures) n'est pas encore modélisé. Ne pas appliquer la migration ni marquer automatiquement les absences tant que les jours de présence attendus ne sont pas déterminés.
- La migration est préparée sur la branche uniquement. Aucun SQL n'a été appliqué à la base réelle et aucun absent n'a été créé.
- L'absence ne crée pas automatiquement une pénalité de 1 000 F CFA dans cette version; la règle confirmée de 1 000 F CFA concerne le retard, et l'absence doit conserver un statut distinct jusqu'à décision métier.
