# Sportsball Go

Live sports scoreboard + ticker (NFL & college football via ESPN's public scoreboard feed; MLB/NASCAR placeholders).
One React/Vite codebase, three targets:

| Target | Tech | Output |
|---|---|---|
| Web / dev | Vite + React | `npm run dev` |
| Windows & Linux desktop | Tauri v2 | NSIS `.exe`, portable `.zip`, AppImage |
| Android | Capacitor (WebView wrapper) | `.apk` |

## Develop
```bash
npm install
npm run dev              # browser
npm run tauri -- dev     # desktop window (needs Rust + platform deps)
```

## Android
```bash
npm run android:sync     # vite build + copy into android/
npm run android:open     # open in Android Studio, or:
cd android && ./gradlew assembleDebug   # -> app/build/outputs/apk/debug/app-debug.apk
```
CI (`.github/workflows/build-android.yml`) builds a debug APK on every push. For Play Store releases, add a keystore and an `assembleRelease`/`bundleRelease` step with signing secrets.

## CI
- `build-desktop.yml` – Windows + Linux artifacts
- `build-android.yml` – Android APK

App IDs: `app.sportsballgo.desktop`, `app.sportsballgo.mobile` (change before publishing).
Icons: regenerate desktop icons with `npx tauri icon path/to/1024.png`.
