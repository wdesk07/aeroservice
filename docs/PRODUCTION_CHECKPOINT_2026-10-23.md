# Aéro Service — checkpoint de reprise production

Date du contrôle : 2026-10-23

## Environnement vérifié
- Site officiel : https://aero-service.vercel.app/
- Projet Supabase production : `tsyhuuqtbcdpolhmmeri`
- Dépôt : `wdesk07/aeroservice`
- Projet Supabase TEST séparé : `nuijzdqnhjzcnqpfqvvl`

## État des effectifs observé dans la base production
- `public.students` : 67 lignes au contrôle (un comptage antérieur avait indiqué 66 ; revérifier les compteurs avant toute correction).
- `public.registrations` : 67 lignes au contrôle précédent, avec des inscriptions par formation pouvant différer du nombre de fiches apprenant.
- `public.profiles` : 75 lignes.
- `public.formations` : 9 lignes.
- Ne jamais copier les données de TEST vers production pour « réparer » un affichage.
- Ne pas supprimer, recréer, fusionner ni réinitialiser les comptes apprenants pour résoudre un problème de connexion sans diagnostic individuel.

## Répartition observée au contrôle
| Code | Formation | Apprenants |
|---|---|---:|
| AGENT_BILLETTERIE | Agent de billetterie | 0 |
| AGENT_ESCALE | Agent d’escale | 4 |
| AGENT_VOYAGE | Agent de voyage (général) | 0 |
| AGENT_VOYAGE_2ANS | Agent de voyage — 2 ans | 24 |
| AGENT_VOYAGE_UNI_2 | Agent de voyage Uni 2ème | 10 |
| GCOO37 | Agent de voyage — 6 mois, promotion 37 | 8 |
| GCOO38 | Agent de voyage — 6 mois, promotion 38 | 10 |
| HOTESSE_AIR | Hôtesse de l’air | 10 |
| PNC | PNC | 1 |

## Authentification — point de reprise
- Une anomalie `auth.users.email_change IS NULL` avait provoqué des erreurs HTTP 500. La valeur NULL a été corrigée en chaîne vide pour le compte concerné.
- Un contrôle ultérieur avait trouvé 0 ligne `auth.users` avec `email_change IS NULL` parmi 74 utilisateurs Auth.
- Des erreurs `invalid_credentials` subsistaient : elles nécessitent une vérification du flux d'inscription/connexion et des identifiants, sans réinitialisation générale des mots de passe.

## Procédure de reprise sûre
1. Vérifier le domaine officiel et la cible du déploiement Vercel avant de publier.
2. Vérifier que l'application utilise le projet Supabase production `tsyhuuqtbcdpolhmmeri` et que TEST reste `nuijzdqnhjzcnqpfqvvl`.
3. Recompter `students`, `registrations`, `profiles` et les effectifs par formation avant/après toute modification.
4. Inspecter migrations et code d'inscription avant de modifier le schéma ou les comptes.
5. Faire une sauvegarde native/exportée indépendante avant toute migration destructive ou correction de masse.
6. Tester d'abord en TEST ; ne promouvoir en production qu'après vérification et autorisation explicite.
7. Préserver le logo officiel et les données existantes.

## Limite importante
Ce document est un checkpoint de reprise technique, pas une sauvegarde complète de la base : il ne contient ni les dossiers personnels, ni les mots de passe, ni l'ensemble des tables. La sauvegarde native Supabase ou un export SQL/CSV indépendant doit être réalisé et vérifié pour assurer une vraie restauration après perte de base.