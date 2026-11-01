# Lumière

Pilotage local des ampoules Yeelight (Expo / React Native), sans cloud. Référence : `docs/spec.md`, `docs/FEATURES.md`. Prototype Python et simulateur de lampe : `reference/`. Site et pages Play Store : `site/index.html`.

## Structure

| Chemin | Rôle |
| --- | --- |
| `src/protocol/` | Protocole pur TypeScript, testable sous Node : miIO (`miio.ts`), LAN TCP 55443 (`lan.ts`, avec throttle/coalescing), commandes, découverte |
| `modules/yeenet/` | Module natif local (Kotlin + Swift) : UDP, balayage, SSDP, TCP ligne à ligne, MD5/AES, hotspot (`WifiNetworkSpecifier` / `NEHotspotConfiguration`) |
| `src/net/` | Liaison protocole ↔ natif, découverte, appairage (spec §3) |
| `src/store/` | État de l'app : lampes et presets persistés, état live, une connexion par lampe |
| `src/screens/`, `src/ui/` | Écrans d'après le design (Accueil, Contrôle, Ambiances, Réglages, Appairage) |

## Commandes

```sh
npm test                                   # vecteur miIO, parse, LAN, coalescer + intégration fakebulb.py
npx tsc --noEmit -p .
cd android && ./gradlew app:assembleRelease -PreactNativeArchitectures=arm64-v8a
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

## Publication (EAS)

```sh
npx eas-cli@latest build -p android --profile preview      # APK à installer pour tester
npx eas-cli@latest build -p android --profile production   # AAB pour Google Play
```

Le projet EAS est `@wassim24/lumiere`, et la version de build est gérée à distance et incrémentée à chaque build de production. `.easignore` reprend `.gitignore` et exclut les fichiers pnpm : EAS doit installer avec npm (`package-lock.json`). Toute nouvelle règle de `.gitignore` doit donc y être recopiée.

## Langues

Les textes sont dans `src/i18n.ts`. Français si l'appareil est en français, anglais sinon. `en` a le type de `fr` : une clé manquante est une erreur de compilation.

iOS : `npx expo prebuild -p ios` puis build sur un Mac. Il faut les entitlements Hotspot Configuration, Wi‑Fi Info et Multicast, déjà déclarés dans `app.json`. La partie Swift n'a pas encore été compilée.
