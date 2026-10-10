# Lumière — feature set de l'app Android

29/10/2026

Une app Android qui pilote les ampoules Yeelight entièrement en local, sans compte ni cloud : couleur, intensité, blancs et presets d'ambiance. Tout ce qui suit repose sur des commandes testées sur une vraie lampe yeelink.light.color3 (firmware 2.0.6) avec le prototype `yeelocal.py`, sauf mention « à vérifier ».

## Contraintes techniques qui conditionnent le design

| Sujet | Réalité technique | Conséquence pour le design |
| --- | --- | --- |
| Réseau | Contrôle par TCP 55443 sur le Wi‑Fi de la maison. Le token cloud n'est pas utilisable. | Pas de contrôle hors de la maison. Le téléphone doit être sur le même Wi‑Fi : prévoir un état « pas sur le bon réseau ». |
| Appairage | Le téléphone rejoint le hotspot de la lampe, active « LAN control », lui envoie le Wi‑Fi, puis revient. Environ 1 min. La lampe clignote quand c'est réussi. | Parcours guidé en étapes, avec progression. Android affiche sa propre boîte de dialogue système pour rejoindre le hotspot. |
| Wi‑Fi | Lampe en 2,4 GHz uniquement, réseaux WPA2. | Avertir si le réseau choisi n'existe qu'en 5 GHz. |
| Découverte | Le routeur testé bloque les broadcasts. L'app interroge une à une les adresses du réseau, ce qui prend quelques secondes. | État « recherche des lampes » avec indicateur. L'IP peut changer : reconnexion automatique, invisible pour l'utilisateur. |
| Modes exclusifs | La lampe est soit en couleur (RGB), soit en blanc (température). Pas les deux. | L'UI montre clairement le mode actif. Toucher la couleur fait sortir du mode blanc, et inversement. |
| Transitions | Chaque commande s'applique avec un fondu de 500 ms. | Les curseurs envoient au relâchement, ou au plus quelques fois par seconde. Pas besoin d'animer côté app. |
| Débit | La doc publique Yeelight limite à environ 60 commandes par minute et par lampe (à vérifier). | Limiter les envois pendant qu'on fait glisser un curseur. |
| Plages | Luminosité 1–100 %, blanc 1700–6500 K, couleur RGB 24 bits, minuterie d'extinction 0–60 min. | Bornes des curseurs. |

## Écrans et parcours

| Écran | Rôle | Éléments clés |
| --- | --- | --- |
| Accueil / Mes lampes | Voir et allumer ses lampes en un geste | Carte par lampe : nom, pièce, interrupteur, pastille de la couleur actuelle, état en ligne ou hors ligne. Bouton « + ». |
| Contrôle d'une lampe | Régler finement | Grand interrupteur, sélecteur Couleur / Blanc, roue chromatique, curseur de température (dégradé ambre → bleuté), curseur d'intensité, rangée de presets, minuterie. |
| Presets | Choisir ou gérer ses ambiances | Grille de cartes : icône, nom, aperçu de la couleur. Presets fournis et presets perso. « Enregistrer l'état actuel comme preset ». |
| Ajouter une lampe | Appairer une lampe neuve ou réinitialisée | Étapes : 1) mettre la lampe en mode appairage (avec instructions de reset), 2) choisir la lampe détectée, 3) choisir le Wi‑Fi et saisir le mot de passe, 4) progression, 5) nommer la lampe et choisir sa pièce. |
| Ajouter une lampe existante | Reprendre une lampe déjà configurée avec l'app Yeelight | Explication : activer « LAN control » dans l'app officielle, puis recherche automatique sur le réseau. |
| Réglages | Gérer l'app | Lampes (renommer, supprimer, pièce), thème clair ou sombre, à propos. |

## Contrôles

| Contrôle | Plage | Commande envoyée | Recommandation d'UI |
| --- | --- | --- | --- |
| Allumer / éteindre | on / off | `set_power` | Interrupteur sur la carte et en tête de l'écran de contrôle. |
| Intensité | 1–100 % | `set_bright` | Curseur vertical ou horizontal large, avec la valeur en %. |
| Couleur | RGB 24 bits | `set_rgb` | Roue chromatique, plus une rangée de couleurs récentes. |
| Blanc (chaleur) | 1700–6500 K | `set_ct_abx` | Curseur en dégradé, repères « Chaud », « Neutre », « Froid ». Afficher les kelvins en petit. |
| Minuterie d'extinction | 0–60 min | `cron_add` (vérifié en LAN) | Puce « Éteindre dans… » : 15, 30, 60 min. |
| Basculer | — | `toggle` | Appui sur la carte de la lampe. |

## Presets

| Preset | Mode | Réglage | Intensité | Usage |
| --- | --- | --- | --- | --- |
| Concentration | Blanc | 5000 K | 100 % | Travail précis, matin |
| Travail sur ordi | Blanc | 4000 K | 75 % | Réduit le contraste avec l'écran |
| Lecture | Blanc | 3000 K | 90 % | Lire, écrire ; testé et validé sur la lampe |
| Cozy | Blanc | 2700 K | 70 % | Bureau chaleureux ; testé et validé |
| Détente | Blanc | 2200 K | 40 % | Soirée |
| Amoureux | Couleur | #FF3355 (rose‑rouge) | 20 % | Ambiance tamisée |
| Cinéma | Couleur | #2A3BFF (bleu profond) | 10 % | Éclairage d'appoint derrière l'écran |
| Veilleuse | Blanc | 1700 K | 1 % | Nuit |
| Réveil (animation) | Animation | 1700 K à 1 % → 4000 K à 100 % en 15 min | — | `start_cf`, vérifié en LAN |

Les presets perso enregistrent mode, valeur et intensité. Un preset s'applique en une seule action, et l'UI montre lequel est actif tant que l'utilisateur ne modifie rien.

## États et erreurs à designer

| Situation | Ce que l'utilisateur voit | Action proposée |
| --- | --- | --- |
| Lampe éteinte à l'interrupteur ou hors tension | Carte grisée, « Hors ligne » | « Vérifiez que l'interrupteur est allumé » |
| Téléphone hors du Wi‑Fi de la maison | Bandeau global | « Connectez‑vous à votre Wi‑Fi » |
| Lampe trouvée mais « LAN control » désactivé | Carte « À configurer » | Guide vers l'app Yeelight, ou réappairage |
| Mot de passe Wi‑Fi erroné à l'appairage | La lampe reste en mode appairage | Retour à l'étape mot de passe |
| Lampe déjà appairée, absente du mode appairage | Écran d'aide | Instructions de réinitialisation (5 cycles allumé/éteint, à vérifier par modèle) |
| IP de la lampe changée | Rien : reconnexion automatique | Recherche silencieuse |
| Commande sans réponse | Retour discret, la valeur revient à l'état réel | « Réessayer » |

## Périmètre

| Fonction | Version |
| --- | --- |
| Appairage sans cloud, liste des lampes, on/off | MVP |
| Couleur, intensité, blanc | MVP |
| Presets fournis et presets perso | MVP |
| Minuterie d'extinction | MVP |
| Pièces et groupes (une commande pour plusieurs lampes) | v2 |
| Widget écran d'accueil et tuile Réglages rapides | v2 |
| Animations (réveil, bougie, coucher de soleil) | v2 |
| Programmation horaire (allumage automatique) | v2 ; l'app ou la lampe doit gérer l'horloge |
| Mode musique, Wear OS | Plus tard |

## Questions ouvertes pour le design

- [ ] Nom de l'app et identité visuelle (couleurs, logo) ?
- [ ] Combien de lampes et de pièces à prévoir à l'écran d'accueil (2 ou 20) ?
- [ ] Thème sombre par défaut ? (logique pour une app d'éclairage le soir)
- [ ] Langue : français seulement, ou aussi anglais ?
- [ ] Faut‑il prévoir iOS plus tard (design partagé) ?
- [ ] Icônes ou illustrations pour les presets ?
