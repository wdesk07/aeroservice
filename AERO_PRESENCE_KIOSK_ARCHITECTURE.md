# Aéro Présence — architecture de la borne officielle

## Décision validée

- La borne du centre est le moyen officiel et prioritaire de pointage quotidien.
- Elle fonctionne d'abord sur l'ordinateur déjà disponible, puis sur une tablette.
- L'apprenant s'identifie avec son e-mail ou identifiant et son mot de passe.
- Le pointage mobile personnel reste désactivé au lancement.
- Le GPS est un contrôle complémentaire quand l'appareil le permet; il n'est pas l'unique preuve de présence.
- Le pointage quotidien reste distinct du pointage d'une séance de cours.
- Aucun changement ne doit être appliqué à la base Supabase de production ni déployé sur le domaine de production avant validation explicite des tests.

## État constaté avant modification

- Dépôt GitHub : `wdesk07/aeroservice`; branche de référence de travail : `fix/attendance-late-arrival-validation`.
- L'espace apprenant existe dans `src/src/app/page.tsx`, mais son tableau de bord n'affiche pas encore de rubrique « Mes présences ».
- Le module administratif « Présences » est déjà présent et doit être conservé.
- Une page QR quotidienne et une RPC `qr_daily_checkin` existent sur la branche précédente. Elles ne sont pas considérées comme validées de bout en bout et ne constituent pas la nouvelle borne.
- L'environnement Supabase `aero-service-test` est séparé du projet de production `tsyhuuqtbcdpolhmmeri`. Les variables Preview de Vercel sont configurées pour l'URL et la clé publique de l'environnement de test. Les migrations d'essai ne doivent cibler que `nuijzdqnhjzcnqpfqvvl`.

## Parcours cible

1. Un administrateur autorisé active/enregistre l'appareil de borne.
2. La borne affiche une interface publique limitée au pointage; elle ne donne accès ni à la Direction ni aux données d'autres apprenants.
3. L'apprenant saisit son e-mail/identifiant et son mot de passe sur la borne.
4. Le serveur vérifie l'identité, l'état du compte, le profil apprenant actif, la séance quotidienne ouverte, la fenêtre horaire, l'autorisation de la borne et l'absence d'un pointage déjà enregistré.
5. Si le navigateur et l'appareil fournissent une géolocalisation précise, elle est vérifiée en complément de l'identité de la borne.
6. Le serveur enregistre l'heure en fuseau `Africa/Porto-Novo` et calcule le statut. Le navigateur ne choisit jamais le statut ni l'heure officielle.
7. Un reçu visuel de confirmation s'affiche sans révéler les informations du précédent utilisateur; la session apprenant est fermée et l'écran revient à l'accueil de la borne.
8. L'espace apprenant permet de consulter uniquement son propre historique. La Direction et les rôles autorisés disposent de la vue globale et de l'audit.

## Architecture de sécurité recommandée

- Routes dédiées : `/presence/borne` pour le terminal et une rubrique « Mes présences » dans l'espace apprenant.
- Enregistrement de la borne : appareil activé par un rôle autorisé, avec état actif/révoqué, nom de l'appareil, date d'activation et journal d'audit.
- Session de borne courte et sécurisée : cookie `HttpOnly`, `Secure`, `SameSite=Strict`, émis et validé côté serveur. Aucun secret de borne dans le code client, les variables `NEXT_PUBLIC_*` ou le stockage local.
- API serveur : elle valide la session Supabase de l'apprenant et la session de borne avant d'autoriser le pointage.
- RPC de base : accès direct interdit aux rôles `anon` et `authenticated` si la fonction est conçue pour n'être appelée que par l'API privilégiée; la fonction doit vérifier les paramètres, l'état de la borne, les droits, la fenêtre horaire et les doublons.
- Secrets serveur uniquement : une clé Supabase privilégiée et une clé de signature de borne ne doivent être configurées que dans l'environnement Preview de test au début, jamais dans le navigateur. Si elles ne sont pas configurées, le pointage doit échouer de façon sûre.
- Protection contre les abus : limite de tentatives de connexion, délai/rate limit, déconnexion automatique après chaque pointage, verrouillage de l'interface entre deux utilisateurs, aucune possibilité d'auto-déclarer ou de modifier son statut.
- GPS : utile comme signal supplémentaire, mais ne constitue pas une preuve absolue sur un ordinateur et peut être imprécis ou falsifié. La présence est d'abord liée à une borne autorisée et à une validation côté serveur.
- Absence : après fermeture de la période, un dossier sans pointage apparaît « absence à confirmer »; la confirmation définitive et les pénalités suivent les règles métier et les permissions déjà définies.
- Mode hors ligne : hors périmètre initial. Il ne sera ajouté qu'avec une file locale signée, anti-doublon, auditée et synchronisée; ne jamais prétendre qu'un pointage hors ligne est confirmé avant synchronisation serveur.

## Contrôles de validation obligatoires

### Fonctionnel
- Un apprenant actif peut pointer une fois durant la fenêtre autorisée.
- Un compte non apprenant, désactivé ou non admis est refusé.
- Un doublon ne crée pas de seconde présence.
- Une borne non activée ou révoquée est refusée.
- Un pointage depuis un téléphone personnel est refusé au lancement, même si l'utilisateur est connecté.
- Une localisation absente/imprécise ne doit pas transformer automatiquement un présent en absent; selon la configuration, le pointage peut être mis en attente de vérification ou rester possible depuis la borne enregistrée.
- Les horaires et la date utilisent `Africa/Porto-Novo`.
- L'heure et le statut sont calculés par le serveur.
- Après pointage, l'écran n'expose plus les données du précédent apprenant.

### Autorisations et sécurité
- L'apprenant ne peut lire que ses propres présences.
- L'apprenant ne peut ni insérer directement ni modifier/supprimer des présences via l'API Supabase.
- Les rôles Direction/Pré-administration autorisés peuvent activer/révoquer une borne et consulter les journaux.
- Un appel direct à la RPC depuis le navigateur ne permet pas de contourner le contrôle de borne.
- Les secrets privilégiés ne sont jamais envoyés au client.
- Les opérations sensibles sont journalisées.

### Non-régression et livraison
- Exécuter `npm test` et `npm run build` dans `src`.
- Tester sur la base `aero-service-test` uniquement, avec comptes fictifs.
- Vérifier les politiques RLS, les droits RPC et les journaux.
- Vérifier la prévisualisation Vercel et sa connexion à la base de test.
- Vérifier que la production utilise toujours `tsyhuuqtbcdpolhmmeri` et qu'aucune migration de test ne lui a été appliquée.
- Ne pas fusionner dans `main`, promouvoir une prévisualisation ou appliquer une migration en production avant validation explicite.

## Ordre de réalisation

1. Construire la route de borne et son mécanisme d'activation côté serveur.
2. Ajouter « Mes présences » à l'espace apprenant sans élargir ses permissions.
3. Ajouter le modèle de données et la RPC sécurisée pour la borne.
4. Ajouter les tests unitaires et les scénarios d'intégration.
5. Exécuter les tests et inspecter les journaux dans l'environnement de test.
6. Présenter le lien de prévisualisation et les résultats avant toute décision de production.


## Avancement de la branche `feat/aero-presence-kiosk`

- [x] Architecture et contrôles documentés avant toute migration.
- [x] Point d'entrée « Consulter mes présences » ajouté au tableau de bord apprenant.
- [x] Module « Mes présences » autorisé uniquement pour les rôles `STUDENT`/`APPRENANT` et limité par la politique RLS à l'historique personnel.
- [x] Build de prévisualisation Vercel réussi pour le commit `fa69644e74be09d4c8d670bdedce11a56a58ca01`.
- [ ] Route de borne et activation/révocation d'appareil.
- [ ] Contrôle serveur qui refuse les pointages venant d'un appareil non enregistré.
- [ ] Migration et fonctions serveur testées dans `aero-service-test`.
- [ ] Tests d'intégration, vérification RLS/RPC et test manuel de bout en bout.
- [ ] Aucun changement de production n'est autorisé à ce stade.


## Mise en œuvre réalisée dans la branche de test

- [x] Migration `20261013145325_presence_kiosk` appliquée uniquement au projet `aero-service-test` (`nuijzdqnhjzcnqpfqvvl`).
- [x] Table des bornes enregistrées avec jeton stocké uniquement sous forme de hash, état de révocation et dernière utilisation.
- [x] RPC d'activation et de révocation protégées par les rôles Direction / ADMIN / PRE_ADMIN.
- [x] RPC de pointage quotidien qui exige une borne active et un compte apprenant actif; vérification de la fenêtre horaire, prévention des doublons et journalisation.
- [x] Fonction publique de pointage QR personnel désactivée dans la base de test; la page QR indique désormais que le pointage doit se faire sur la borne.
- [x] Page `/presence/borne` avec activation admin, connexion apprenant par e-mail ou matricule et confirmation de présence.
- [x] Jeton de borne conservé dans un cookie `HttpOnly`, `Secure`, `SameSite=Strict`, inaccessible au JavaScript; opérations de pointage/revocation via routes serveur.
- [x] Fonction Edge `kiosk-auth` déployée sur le projet Supabase de test, avec contrôle de l'identifiant, du mot de passe, du statut apprenant et une limitation de tentatives par IP hashée.
- [x] Routes serveur `/api/presence/kiosk-activate`, `kiosk-checkin`, `kiosk-revoke` et `kiosk-status`.
- [x] Contrôles SQL en lecture seule confirmés : tables/fonctions présentes, anon ne peut pas activer ou pointer, rôle authenticated ne peut pas lire les jetons, et l'exécution du RPC QR est révoquée.
- [x] Build Vercel de la prévisualisation réussi pour le commit `c8d26299dfaacd5b8f4eec18fd931e2de795c900`.
- [ ] Test manuel de bout en bout avec comptes fictifs (activation Direction, connexion apprenant, pointage, doublon, révoquer borne).
- [ ] Tester la géolocalisation réelle sur l'ordinateur du centre et décider si le point GPS est configuré; GPS complémentaire ne doit pas bloquer une borne officielle si la localisation n'est pas disponible.
- [ ] Vérifier le comportement de l'authentification de borne derrière la protection Vercel et la politique de partage du lien de prévisualisation.
- [ ] Le mode hors ligne reste hors périmètre.
- [ ] Aucun déploiement ni migration en production n'a été effectué.
