# Spec — app Android « Lumière » (pilotage local des ampoules Yeelight)

29/10/2026 — destinée à l'agent qui implémentera l'app.

## 0. Contexte et règles

- **Objectif :** une app Android qui appaire et pilote des ampoules Yeelight Wi‑Fi **sans aucun cloud** (ni compte Xiaomi, ni compte Yeelight, ni Internet requis).
- **Matériel de référence :** `yeelink.light.color3` (firmware 2.0.6_0035, hw mw302). Deux ampoules chez l'utilisateur : `a42f` (appairée) et `4c14` (pas encore appairée).
- **Ce qui est vérifié :** tout le protocole ci‑dessous a été testé sur la vraie ampoule avec `reference/yeelocal.py`, sauf ce qui est marqué **[non vérifié]**.
- **Fichiers fournis dans `app/` :**

  | Fichier | Rôle |
  | --- | --- |
  | `spec.md` | Ce document : la référence pour l'implémentation |
  | `FEATURES.md` | Feature set côté produit et design (écrans, presets, états d'erreur, périmètre MVP / v2) |
  | `reference/yeelocal.py` | Implémentation Python de référence qui fonctionne (CLI et web UI). En cas de doute, c'est elle qui fait foi. |
  | `reference/fakebulb.py` | Simulateur d'ampoule : miIO UDP 54321 et LAN TCP 55443, pour les tests |

- **Interdits :**
  - Aucun appel réseau hors du LAN.
  - Aucun SDK Xiaomi ou Yeelight, aucune analytics.
  - Ne jamais stocker le mot de passe Wi‑Fi.
  - Ne jamais logger un token ou un mot de passe.

## 1. Stack imposée

| Sujet | Choix |
| --- | --- |
| Langage / UI | Kotlin, Jetpack Compose, Material 3 (thème sombre par défaut, dynamic color optionnel) |
| minSdk / targetSdk | 29 (requis pour `WifiNetworkSpecifier`) / dernier stable |
| Async | Coroutines + Flow |
| Persistance | DataStore (JSON via kotlinx.serialization) ou Room ; volume minuscule |
| Crypto | `javax.crypto` (AES/CBC/PKCS5Padding, qui équivaut à PKCS7 sur des blocs de 16), `java.security.MessageDigest` (MD5) |
| DI | Manuelle ou Hilt, au choix de l'agent |
| Modules | `:protocol` (Kotlin/JVM pur, sans dépendance Android, testable en JUnit), `:app` |

Permissions :
- `INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE`, `CHANGE_WIFI_STATE` ;
- `CHANGE_WIFI_MULTICAST_STATE`, pour la découverte SSDP optionnelle ;
- `NEARBY_WIFI_DEVICES` (API 33+, `neverForLocation`) ;
- `ACCESS_FINE_LOCATION`, uniquement si nécessaire pour lire le SSID courant sur API < 33.

## 2. Les deux protocoles

### 2.1 miIO — UDP 54321 (appairage uniquement)

Le miIO ne sert **que** pendant l'appairage, quand le téléphone est sur le hotspot de l'ampoule. Après l'appairage, le token ne fonctionne plus (constaté sur la vraie ampoule) : on n'utilise plus que le LAN (§2.2).

**Hello** (découverte et récupération du token) :
- Envoyer 32 octets : `21 31 00 20` suivis de 28 × `ff`.
- La réponse fait 32 octets :

  | Octets | Contenu |
  | --- | --- |
  | 0–1 | `21 31` |
  | 2–3 | longueur (BE16) |
  | 4–11 | did (BE64 ; en pratique, les 4 premiers octets à 0) |
  | 12–15 | stamp (BE32) |
  | 16–31 | token |

- Une ampoule **non appairée** renvoie son token en clair. Une ampoule appairée renvoie `ff…ff` ou `00…00` : il faut alors la réinitialiser.

**Requête chiffrée :**
```
token  = 16 octets (du hello)
key    = MD5(token)
iv     = MD5(key ‖ token)
body   = AES-128-CBC(key, iv, PKCS7(json_utf8))
json   = {"id": <int croissant>, "method": "<m>", "params": <array|object>}
header = 2131 | BE16(32 + len(body)) | BE64(did) | BE32(stamp + 1)
packet = header(16) ‖ MD5(header ‖ token ‖ body) ‖ body
```
- Il faut faire un hello juste avant chaque requête pour obtenir un `stamp` frais.
- **Réponse :** vérifier `MD5(resp[0:16] ‖ token ‖ resp[32:]) == resp[16:32]`. Déchiffrer `resp[32:]`, retirer le padding puis les `\0` finaux, et parser le JSON. Un `{"error":…}` dans le JSON signale une erreur.
- **Timeout :** 3 s.

**Vecteur de test** (token factice, à mettre en test unitaire) :
```
token   00112233445566778899aabbccddeeff
key     6e8311168ee16d6aa1aa48c64145003c
iv      6f434fa9acd75da73e5fb999f641cda2
json    {"id": 1, "method": "get_prop", "params": ["power"]}
cipher  2a36b2b7afa85bd6a9f1ed82b485a3d68628cb0ba48901152cb9ce59f42b292529bf9211d2778169fd9d357e85849a2e25d4f0d47f115adceb952501d510df30
did = 0x12345678, stamp+1 = 0x100 →
packet  21310060000000001234567800000100b48befb3c74e712065c531170be6462f2a36b2b7afa85bd6a9f1ed82b485a3d68628cb0ba48901152cb9ce59f42b292529bf9211d2778169fd9d357e85849a2e25d4f0d47f115adceb952501d510df30
```
Le JSON doit être sérialisé exactement comme ci‑dessus (séparateurs `", "` et `": "`) pour retrouver ce chiffré.

### 2.2 LAN Yeelight — TCP 55443 (tout le pilotage)

- **Format :** texte JSON, une ligne par message, terminée par `\r\n`.
- **Requête :** `{"id":N,"method":"m","params":[...]}`.
- **Réponse :** `{"id":N,"result":["ok"]}`, ou `{"id":N,"error":{"code":-1,"message":"..."}}`.
- **Notifications :** l'ampoule envoie aussi des notifications non sollicitées, par exemple `{"method":"props","params":{"power":"on","bright":"80"}}`.
  - Il faut les ignorer quand on attend une réponse (filtrer sur l'`id`).
  - Il faut aussi s'en servir pour mettre à jour l'état affiché : c'est ce qui synchronise l'app quand quelqu'un change la lampe ailleurs.
- **Connexion :** garder **une connexion TCP persistante par ampoule** tant que l'app est au premier plan. Reconnecter avec backoff (1 s, 2 s, 5 s, puis 10 s max). Fermer en arrière‑plan.
- **Limites documentées par Yeelight [non vérifié] :** 4 connexions simultanées max par ampoule, environ 60 commandes par minute. Côté app :
  - pendant qu'on fait glisser un curseur, envoyer au plus environ 3 commandes par seconde, et toujours la dernière valeur au relâchement ;
  - coalescer les commandes en attente (ne garder que la dernière par type).
- **Prérequis :** « LAN control » activé sur l'ampoule. Notre appairage l'active (§3). Sans lui, le port 55443 refuse la connexion.

**Commandes vérifiées sur la color3 :**

| Usage | Méthode | Params | Note |
| --- | --- | --- | --- |
| Allumer / éteindre | `set_power` | `["on"\|"off", "smooth", 500]` | `"sudden", 0` pour sans fondu |
| Basculer | `toggle` | `[]` | |
| Intensité | `set_bright` | `[1..100, "smooth", 500]` | |
| Couleur | `set_rgb` | `[0..0xFFFFFF, "smooth", 500]` | Passe en `color_mode` 1 |
| Blanc | `set_ct_abx` | `[1700..6500, "smooth", 500]` | Passe en `color_mode` 2 |
| Teinte / saturation | `set_hsv` | `[0..359, 0..100, "smooth", 500]` | `color_mode` 3 |
| **Preset en une commande** | `set_scene` | `["ct", K, bright]` ou `["color", rgb, bright]` | Allume aussi la lampe. **À utiliser pour les presets.** |
| Animation | `start_cf` | `[count, action, "dur,mode,val,bright,..."]` | `mode` : 1 = rgb, 2 = ct, 7 = pause. `action` : 0 = revenir à l'état d'avant, 1 = rester, 2 = éteindre. `count` 0 = infini. |
| Arrêter l'animation | `stop_cf` | `[]` | |
| Minuterie d'extinction | `cron_add` | `[0, minutes]` | Testé : `cron_add [0,60]` → ok |
| Lire la minuterie | `cron_get` | `[0]` | Renvoie `[{"type":0,"delay":60,"mix":0}]`, ou `[]` si aucune |
| Annuler la minuterie | `cron_del` | `[0]` | |
| Lire l'état | `get_prop` | `["power","bright","ct","rgb","hue","sat","color_mode","flowing","delayoff","name"]` | Toutes les valeurs arrivent en chaînes : `"on"`, `"90"`, `"3000"`, `"2"`. Une valeur inconnue vaut `""`. |
| Activer LAN control | `set_ps` | `["cfg_lan_ctrl","1"]` | Seulement via miIO pendant l'appairage |

- **`color_mode` :** 1 = RGB, 2 = température (blanc), 3 = HSV.
- **`rgb` :** entier décimal en chaîne (16777215 = #FFFFFF).
- **Erreur typique :** `{"code":-1,"message":"method not supported"}`.
- **Ampoule éteinte :** les commandes `set_*` (hors `set_power`, `set_scene` et `toggle`) peuvent échouer. L'app doit soit allumer d'abord, soit passer par `set_scene` [à confirmer sur la color3 ; dans le doute, envoyer `set_power on` avant].

**Réveil** (exemple de flow) : 15 minutes de 1700 K à 1 % jusqu'à 4000 K à 100 %, puis rester allumé.
```
set_scene ["ct", 1700, 1]
start_cf  [1, 1, "900000,2,4000,100"]
```

## 3. Appairage sans cloud

Le flux vient de l'app officielle (stratégie « AP config »), **sans** `bind_key` ni `uid` cloud. Il a été testé sur la A42F : la lampe clignote quand elle rejoint le réseau.

**Prérequis UI :**
- L'ampoule est en mode appairage : réinitialisée, elle émet un hotspot ouvert `yeelink-light-<modèle>_miap<XXXX>`.
- Procédure de reset color3 : allumer/éteindre 5 fois [à confirmer et documenter dans l'UI].

**Étapes :**

1. **Collecter le Wi‑Fi maison** : SSID (pré‑rempli avec le réseau courant si on peut le lire) et mot de passe saisi par l'utilisateur.
   - Si `WifiInfo.frequency > 4900`, avertir que l'ampoule ne voit que le 2,4 GHz.
   - Le mot de passe reste en mémoire le temps de l'appairage, jamais persisté.
2. **Rejoindre le hotspot** de l'ampoule avec `WifiNetworkSpecifier` :
   - `setSsidPattern(PatternMatcher("yeelink-light-", PATTERN_PREFIX))`, réseau ouvert.
   - `NetworkRequest` avec `TRANSPORT_WIFI` et `removeCapability(NET_CAPABILITY_INTERNET)`.
   - `ConnectivityManager.requestNetwork(request, callback, 60_000)`.
   - Android affiche lui‑même la liste des hotspots correspondants : pas besoin de scanner.
3. **Toutes les sockets de l'appairage** doivent être liées à ce `Network` : `network.bindSocket(datagramSocket)`, ou `cm.bindProcessToNetwork(network)` puis `null` à la fin. Sinon Android route vers le Wi‑Fi ou la 4G habituels.
4. **Trouver l'ampoule** : sur le hotspot, le broadcast ne marche pas. Il faut envoyer le hello **en unicast à la passerelle**.
   - La passerelle se lit dans `LinkProperties.routes` (route par défaut) ou `DhcpInfo.gateway`.
   - Valeur par défaut observée : `192.168.10.1`.
5. **Hello** → `did`, `stamp`, `token`. Si le token est `ff…`/`00…`, l'ampoule est déjà appairée : afficher l'aide « réinitialiser ».
6. **`miIO.info`** `[]` : facultatif, donne `model`, `fw_ver`, `mac`. Garder `model` et `mac`.
7. **`set_ps`** `["cfg_lan_ctrl","1"]` → `["ok"]`. **Indispensable** : c'est ce qui permet le pilotage ensuite.
8. **`miIO.config_router`** avec :
   ```json
   {"ssid": "<ssid>", "passwd": "<pwd>", "uid": 0, "tz": "<IANA, ex. Europe/Paris>"}
   ```
   - `tz` = `TimeZone.getDefault().id`.
   - L'ampoule peut ne pas répondre, parce qu'elle bascule déjà de réseau : un timeout ici **n'est pas** un échec.
9. **Libérer le réseau** du hotspot (`unregisterNetworkCallback`, `bindProcessToNetwork(null)`). Le téléphone revient seul sur le Wi‑Fi maison.
10. **Retrouver l'ampoule** sur le réseau maison (§4) par son `did`, avec un timeout de 60 s et une découverte toutes les 3 s. Ensuite, ouvrir le TCP 55443 et faire un `get_prop`.
    - **Succès :** passer à l'écran « nommer la lampe ».
    - **Échec :** mot de passe probablement faux. L'ampoule reste ou revient en mode hotspot : proposer de recommencer à l'étape 1.
11. **Ne pas conserver le token** : il est invalide après l'appairage.

## 4. Découverte sur le réseau maison

Le routeur de l'utilisateur bloque les broadcasts. Implémenter dans cet ordre, en parallèle si possible :

1. **SSDP Yeelight [non vérifié sur ce routeur] :**
   - Envoyer en UDP multicast à `239.255.255.250:1982` :
     ```
     M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1982\r\nMAN: "ssdp:discover"\r\nST: wifi_bulb\r\n
     ```
   - Prendre un `WifiManager.MulticastLock` pendant l'envoi.
   - La réponse contient `Location: yeelight://ip:55443`, `id: 0x…`, `model`, `power`, `bright`, `ct`, `rgb`, `color_mode`, `name`.
   - Les ampoules s'annoncent aussi spontanément (`NOTIFY`) sur ce groupe.
2. **Balayage unicast (vérifié) :**
   - Calculer le /24 depuis `LinkProperties.linkAddresses` (IPv4 du Wi‑Fi).
   - Envoyer un hello miIO UDP 54321 à chaque hôte de .1 à .254, avec 64 envois concurrents et un timeout de 1,5 s.
   - Les réponses donnent `ip` et `did`. C'est ce qui a trouvé la A42F (did 312413044 sur 192.168.144.5).
3. **Rapprochement :** mettre à jour l'IP des lampes connues par `did`. Une ampoule inconnue qui répond sur 55443 peut être proposée à l'ajout (« Ajouter une lampe existante »).
4. **Quand découvrir :**
   - au démarrage ;
   - au retour au premier plan ;
   - quand une connexion TCP échoue, l'IP a pu changer ;
   - après un appairage.
   - La découverte est silencieuse, sans écran bloquant.

## 5. Modèle de données

```kotlin
@Serializable data class Lamp(
    val id: String,            // UUID local
    val name: String,
    val did: Long,             // identité stable
    val ip: String,            // dernière IP connue
    val model: String? = null, // "yeelink.light.color3"
    val mac: String? = null,
    val room: String? = null,
)

data class LampState(          // en mémoire seulement
    val online: Boolean,
    val power: Boolean,
    val bright: Int,           // 1..100
    val mode: Mode,            // COLOR, WHITE, HSV
    val rgb: Int,              // 0xRRGGBB
    val ct: Int,               // 1700..6500
    val flowing: Boolean,
    val delayOffMin: Int,      // 0 = pas de minuterie
)

@Serializable data class Preset(
    val id: String, val name: String, val icon: String,
    val mode: PresetMode,      // WHITE(ct) | COLOR(rgb) | FLOW(expr, action)
    val value: Int?,           // K ou 0xRRGGBB
    val bright: Int?,
    val flow: String? = null,
    val builtIn: Boolean,
)
```

Presets fournis (non supprimables, mais masquables) :

| id | Nom | Commande |
| --- | --- | --- |
| focus | Concentration | `set_scene ["ct",5000,100]` |
| computer | Travail sur ordi | `set_scene ["ct",4000,75]` |
| reading | Lecture | `set_scene ["ct",3000,90]`, validé par l'utilisateur |
| cozy | Cozy | `set_scene ["ct",2700,70]`, validé par l'utilisateur |
| relax | Détente | `set_scene ["ct",2200,40]` |
| romantic | Amoureux | `set_scene ["color",0xFF3355,20]` |
| cinema | Cinéma | `set_scene ["color",0x2A3BFF,10]` |
| night | Veilleuse | `set_scene ["ct",1700,1]` |
| wakeup | Réveil | Flow du §2.2 |

- « Enregistrer l'état actuel » crée un preset perso à partir de `LampState`.
- Le preset actif est celui dont les valeurs correspondent exactement à l'état. L'indicateur disparaît dès qu'une valeur change.

## 6. Architecture

```
:protocol (JVM pur)
  MiioCodec          encode/decode paquets, hello parse        ← tests vecteur §2.1
  MiioClient         UDP, hello + send(method, params), lié à un Network optionnel
  LanConnection      TCP 55443 persistant, ids, Flow<Notification>, send() suspend
  Discovery          SSDP + sweep → Flow<Found(ip, did)>
  Commands           fonctions typées (setPower, setBright, setScene, startCf, cronAdd…)
:app
  LampRepository     lampes persistées + StateFlow<Map<id, LampState>>, une LanConnection par lampe,
                     throttle/coalescing des commandes, refresh par get_prop à la (re)connexion
  PairingController  machine à états §3 (WifiNetworkSpecifier, bind, étapes, erreurs typées)
  PresetRepository   fournis + perso
  ui/                Compose : Home, LampControl, Presets, Pairing (wizard), Settings
```

- Une UI optimiste : afficher la nouvelle valeur tout de suite. En cas d'erreur ou de timeout, revenir à l'état réel (`get_prop`) et afficher un snackbar avec « Réessayer ».
- Détection « pas sur le Wi‑Fi maison » : réseau actif non Wi‑Fi, ou sous‑réseau différent de celui des lampes enregistrées. Afficher un bandeau global.
- Erreurs d'appairage typées : `HotspotNotJoined`, `NoHelloReply`, `AlreadyProvisioned`, `LanEnableFailed`, `NotFoundAfterJoin` (mot de passe probablement faux), `Cancelled`.

## 7. Tests

- **Unitaires `:protocol` :**
  - vecteur §2.1 ;
  - parse du hello (token présent ou masqué) ;
  - décodage d'un `props` intercalé avant la réponse ;
  - erreur JSON ;
  - throttle et coalescing.
- **Intégration avec le simulateur :**
  ```
  FAKEBULB_HOST=0.0.0.0 python3 app/reference/fakebulb.py               # mode appairage (token exposé)
  FAKEBULB_HOST=0.0.0.0 python3 app/reference/fakebulb.py --provisioned  # token masqué
  ```
  - Depuis l'émulateur Android, l'hôte est `10.0.2.2`.
  - Le simulateur ferme la connexion TCP après chaque commande ; la vraie ampoule la garde ouverte. Le client doit gérer les deux cas.
  - Il envoie toujours une notification `props` avant la réponse.
- **Sur la vraie lampe (manuel) :** la A42F est à `192.168.144.5`, réseau `mega_simo`. Vérifier : liste, on/off, curseurs, chaque preset, minuterie, puis appairage de la `4c14` de bout en bout.
- **Référence croisée :** `python3 app/reference/yeelocal.py set a42f status` donne l'état réel pour comparer.

## 8. Critères d'acceptation MVP

1. Une ampoule réinitialisée est appairée depuis l'app en moins de 2 minutes, sans Internet ni compte, et apparaît dans la liste.
2. La lampe A42F, déjà appairée, est retrouvée automatiquement, même après un changement d'IP.
3. On/off, intensité, blanc (1700–6500 K), couleur et minuterie fonctionnent ; l'état affiché suit les changements faits ailleurs (notifications `props`).
4. Les 9 presets s'appliquent en un geste. Un preset perso peut être créé, renommé et supprimé.
5. Hors du Wi‑Fi maison, l'app l'indique clairement sans planter ni boucler.
6. Aucune requête réseau hors LAN, ce qui se vérifie avec `adb shell dumpsys netstats` ou un proxy. Aucun secret dans logcat.

## 9. Hors MVP (voir FEATURES.md)

Pièces et groupes, widget et tuile Réglages rapides, animations supplémentaires, programmation horaire, mode musique, Wear OS.

## 10. Points ouverts

- [ ] Procédure exacte de reset de la color3 (5 cycles ?), à documenter dans l'écran d'aide.
- [ ] SSDP sur le routeur `mega_simo` : à tester ; s'il marche, il est plus rapide que le balayage.
- [ ] Limite réelle de débit et de connexions sur la color3.
- [ ] Comportement des `set_*` quand la lampe est éteinte.
- [ ] Nom de l'app et identité visuelle (voir FEATURES.md, « Questions ouvertes »).
