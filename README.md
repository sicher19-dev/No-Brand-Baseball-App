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

## Remote assessments and messages (backend)

Pitchers can record a mobility video and message the coaches from their player page; coaches sign in
(Coach sign in on the login screen) to a coach view with every upload and thread. This needs a Supabase project.

### One-time setup
1. Create a project at [supabase.com](https://supabase.com) (sign up with the No Brand email). Pick a strong database password; you will not need it again.
2. SQL Editor -> New query -> paste all of `supabase/schema.sql` -> Run. This creates the tables, security rules and the private `assessments` video bucket.
3. Authentication -> Sign In / Providers -> Email: turn **Confirm email** off (pitcher accounts use internal addresses).
4. Storage -> Settings: raise the global upload limit to **500 MB** (Pro plan). Videos over the limit are rejected with a clear message in the app.
5. Project Settings -> API: copy **Project URL** and the **anon public** key into `www/config.js`, commit and push.
6. In this repo add secrets `SUPABASE_URL` (same Project URL) and `SUPABASE_SERVICE_ROLE_KEY` (the **service_role** key, never put this one in the app),
   and a secret `COACH_EMAILS` with the coach addresses, comma-separated (a secret so the public workflow logs mask them).
7. Actions -> **Provision app users** -> Run workflow. Every pitcher in `www/roster.js` gets a login; coaches get an invite email to set a password.
   Re-run it whenever you add a pitcher. Tick *reset_passwords* after fixing a pitcher's first name.

Pitchers keep signing in with last name / first name; the app derives their backend login from the roster.
Coaches use Coach sign in with their email and the password from the invite.

### Where things live
| Thing | Where |
|---|---|
| Videos | Supabase Storage, bucket `assessments`, folder per pitcher id, private (signed links only) |
| Video records, coach notes | table `assessments` |
| Messages | table `messages`, one thread per pitcher |
| Who is a coach | table `profiles`, `role = 'coach'` |

## Ship to the App Store and Google Play (no Mac needed)

The native apps are built in the cloud by GitHub Actions: iOS on a GitHub-hosted Mac, Android on Linux.
The native shell bundles `www/`; reports still load live from GitHub Pages, so daily reports never need a store update.

### One-time setup checklist

**Apple (you do these once)**
1. Enroll in the [Apple Developer Program](https://developer.apple.com/programs/enroll/) ($99/yr).
2. In App Store Connect -> Users and Access -> Integrations -> App Store Connect API, create a key with the **Admin** role.
   Download the `.p8` file (only offered once) and note the **Key ID** and **Issuer ID**.
3. Find your **Team ID** on developer.apple.com -> Membership details (10 characters, e.g. `A1B2C3D4E5`).

**GitHub (you do these once)**
4. Create a **private** repo `sicher19-dev/No-Brand-Certificates` (empty, no README). Signing certificates are stored there, encrypted.
5. Create a fine-grained personal access token (Settings -> Developer settings -> Personal access tokens -> Fine-grained):
   repository access = `No-Brand-Certificates` **and** `No-Brand-Baseball-App`; permissions = **Contents: read & write**, **Secrets: read & write**, **Metadata: read**.
6. In this repo -> Settings -> Secrets and variables -> Actions, add these **secrets**:

| Secret | Value |
|---|---|
| `ASC_KEY_ID` | Key ID from step 2 |
| `ASC_ISSUER_ID` | Issuer ID from step 2 |
| `ASC_KEY_CONTENT` | The `.p8` file, base64-encoded on one line (PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("AuthKey_XXXX.p8"))`) |
| `APPLE_TEAM_ID` | Team ID from step 3 |
| `MATCH_GIT_TOKEN` | The token from step 5 |
| `MATCH_PASSWORD` | Any long passphrase you make up; it encrypts the certificates. Keep it somewhere safe. |

7. Actions tab -> **One-time signing setup** -> Run workflow. It registers the bundle ID `com.nobrandbaseball.app`,
   creates the App Store Connect app record, creates the iOS distribution certificate + profile, and generates the Android upload keystore
   (saved automatically as `ANDROID_KEYSTORE_BASE64` / `ANDROID_KEYSTORE_PASSWORD` secrets, with an encrypted backup in the certs repo).
   If Apple says the app name is taken, re-run it with a different name in the `app_name` box.

**Google Play (optional, for Android)**
8. Create a [Play Console](https://play.google.com/console) account ($25 once) and an app with package `com.nobrandbaseball.app`.
   Upload the first `.aab` by hand from the workflow artifacts. To automate later uploads, add a service-account JSON as `PLAY_SERVICE_ACCOUNT_JSON`.

### Every release
```
git tag v1.0.0
git push origin v1.0.0
```
That runs **iOS - TestFlight** (build on a Mac runner, upload to TestFlight) and **Android - Play bundle** (signed `.aab` as a downloadable artifact).
Both can also be started from the Actions tab with **Run workflow**. The build number is the workflow run number, so it always goes up.

Then in App Store Connect: TestFlight tab -> add pitchers as external testers (or share a public TestFlight link),
and when ready, App Store tab -> create the version, attach the build, fill in screenshots and description, and submit for review.
App Review needs a login: give them username `Demo`, password `Pitcher` (the sample account in `www/roster.js`).

### If you ever get a Mac
```
npm install
npx cap sync
npx cap open ios       # Xcode: archive -> TestFlight -> App Store
npx cap open android   # Android Studio: build AAB -> Play Console
```
