# No Brand Baseball - Pitcher App

Daily scouting reports for every No Brand Baseball Analytics pitcher, in one app.

**Login (first pass):** username = last name, password = first name. `Skenes` / `Paul`.
Two pitchers sharing a last name are told apart by the password, so Brandon and Josh White both sign in as `White`.
Matt Boyd can use `Matt` or `Matthew` (see `aliases` in the roster).

## What is in here
| Path | What |
|---|---|
| `www/index.html` | The app: login screen, pitcher dashboard, in-app report viewer |
| `www/app.js` | Login, routing, rendering, live roster refresh |
| `www/roster.js` | **The roster.** One entry per pitcher, with their reports and GitHub Pages links |
| `www/manifest.webmanifest`, `www/sw.js`, `www/icons/` | Installable web app (Add to Home Screen) + offline shell |
| `.github/workflows/pages.yml` | Publishes `www/` to GitHub Pages on every push to `main` |
| `capacitor.config.json`, `ios/`, `android/` | Native wrappers for the App Store / Play Store (Capacitor) |

## Daily workflow: publish a report
1. Push the report to its own GitHub Pages repo like always (for example `skenes-scout`).
2. In `www/roster.js`, find the pitcher and add (or update) the report entry:
   ```json
   { "id": "skenes-scout", "kind": "scout", "title": "Scouting Report - vs MIL, Apr 3", "updated": "2027-04-03", "url": "https://sicher19-dev.github.io/skenes-scout/" }
   ```
   `kind` is one of `scout`, `reverse`, `grades`, `execution`, `picture`, `player`, `zone`, `snapshot`, `lab`.
   The newest `scout` entry becomes the pitcher's **Latest Scouting Report** hero card.
3. Bump the top-level `"updated"` date and push to `main`.

The app fetches `roster.js` from the live site on every launch and sign-in, so pitchers see new reports **without an app update**.

## Add a pitcher
Add an object to `pitchers` in `www/roster.js`:
```json
{ "id": "lastname", "first": "First", "last": "Lastname", "org": "Pirates", "level": "MiLB", "role": "Starter", "hand": "RHP", "reports": [] }
```
They can sign in immediately; the dashboard says "No reports posted yet" until the first one lands.

## Run it locally
Open `www/index.html` in a browser, or serve the folder:
```
npx serve www
```

## Hosted
`https://sicher19-dev.github.io/No-Brand-Baseball-App/` - pitchers can use this in Safari today and tap **Share -> Add to Home Screen** for an app icon.

## Native apps (Capacitor)
```
npm install
npx cap sync
npx cap open ios       # Mac + Xcode: archive -> TestFlight -> App Store
npx cap open android   # Android Studio: build AAB -> Play Console
```
The native shell bundles `www/`; reports still load live from GitHub Pages.
