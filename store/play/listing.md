# Google Play listing - No Brand Baseball

Everything the Play Console asks for, ready to paste. The signed bundle comes from the **Android - Play bundle**
workflow (every `v*` tag; artifact `NoBrandBaseball-android-<version>-<run>`), package `com.nobrandbaseball.app`.

## 1. Account (Brian, once)
1. [play.google.com/console](https://play.google.com/console) -> sign in with the No Brand Google account -> **Create developer account**.
   $25 one-time. Choose **Organization** if No Brand Baseball Analytics has (or can get) a D-U-N-S number: organization
   accounts skip the closed-testing gate below. A **Personal** account is faster to open but must run the 14-day test.
2. Identity verification (ID + a few days).
3. **Create app**: name *No Brand Baseball*, English (United States), App, Free.

## 2. Store listing
| Field | Value |
|---|---|
| App name (30) | No Brand Baseball |
| Short description (80) | Your scouting reports, assessments and coach messages from No Brand Baseball. |
| Category | Sports |
| Tags | Baseball, Coaching, Sports analytics |
| Contact email | nobrandbaseball@gmail.com |
| Website | https://sicher19-dev.github.io/No-Brand-Baseball-App/ |
| Privacy policy | https://sicher19-dev.github.io/No-Brand-Baseball-App/privacy.html |
| App icon (512x512) | `www/icons/icon-512.png` |
| Feature graphic (1024x500) | `store/play/feature-graphic.png` |
| Phone screenshots (1080x1920) | `store/play/screenshots/phone-*.png` (4) |
| 7-inch tablet (1200x1920) | `store/play/screenshots/tablet7-*.png` |
| 10-inch tablet (1600x2560) | `store/play/screenshots/tablet10-*.png` |

### Full description (4000)
No Brand Baseball is the private app for pitchers who work with No Brand Baseball Analytics.

Sign in and your page is waiting: today's scouting report at the top, then every reverse report, pitch-grade breakdown, execution report, bullpen plan and lab we have built for you, all interactive and updated the moment we publish.

Remote assessment: record a short mobility video right in the app and send it to your coaches. You will see when it has been received and reviewed, with their notes. Coaches can also run an assessment in person and save it straight to your page.

Messages: a direct thread with the No Brand coaching staff, inside the app.

Built for the arms we work with in the big leagues and the minors. An account from No Brand Baseball Analytics is required; there is no public sign-up.

## 3. App content (Policy -> App content)
| Section | Answer |
|---|---|
| Privacy policy | URL above |
| Ads | No, the app has no ads |
| App access | **All or some functionality is restricted.** Add instructions: "Pitcher login: username `Demo`, password `Pitcher`. The sample account has reports, can upload an assessment video and message the coaches. Coach features need a coach account; contact nobrandbaseball@gmail.com." |
| Content ratings (IARC) | Category *Utility, Productivity, Communication, or Other*. No violence, sexual content, language, controlled substances, gambling; no user-generated content shared publicly (messages are private pitcher-to-coach); no location sharing; no purchases. Expected: Everyone / PEGI 3. |
| Target audience | 18 and over (professional athletes; not designed for children) |
| News app | No |
| COVID-19 contact tracing | No |
| Data safety | see below |
| Government app | No |
| Financial features | None |
| Health | No health features (coaching videos and messages, not medical or fitness tracking). If Play insists, pick *Fitness and coaching* |

### Data safety
- Collects data: **Yes**. Shares data with third parties: **No** (Supabase is our processor, not a third party).
- Encrypted in transit: **Yes**. Users can request deletion: **Yes** (email nobrandbaseball@gmail.com; also in the privacy policy).
- Data types, all *Required*, purpose *App functionality*, collected (not shared):
  - Personal info: **Name** (pitchers, from the roster), **Email address** (coaches only)
  - Photos and videos: **Videos** (assessment videos the user records or uploads)
  - Messages: **Other in-app messages** (pitcher-coach thread)
  - App info and performance: none. Device or other IDs: none. Location: none. Financial: none. Health and fitness: none.
- Account creation: **No** (accounts are created by No Brand). Account deletion: on request by email.

## 4. Testing gate (personal accounts only)
New personal developer accounts must run a **closed test with at least 12 testers opted in for 14 continuous days**
before they can apply for production. Plan:
1. Release -> Testing -> **Closed testing** -> create track "No Brand Pitchers" -> upload the `.aab` from the workflow artifact.
2. Testers tab -> create an email list: the coaches plus every pitcher and friend with an Android phone (Gmail
   addresses). You need 12. Pitchers on iPhone cannot count; ask around the staff and family.
3. Send them the opt-in link; they install from Play and keep it installed for 14 days (uninstalling or opting out before day 14 breaks the streak; pausing the track resets it).
4. After 14 days: Dashboard -> **Apply for production access** -> answer the short questionnaire (what was tested, what changed). Google replies within about a week.
5. Then Release -> Production -> create release with the same (or newer) bundle -> submit for review.
An **Organization** account skips steps 1-4: upload to Internal testing, then straight to Production.

## 5. Automating uploads (optional, later)
1. Google Cloud Console -> create a project -> IAM -> **Service accounts** -> create `play-uploader` -> Keys -> add JSON key (download).
2. Play Console -> Users and permissions -> **Invite new users** -> the service account's email -> App permissions: No Brand Baseball,
   with *Release to testing tracks* and *Release to production* (production only once you want it).
3. Repo secret `PLAY_SERVICE_ACCOUNT_JSON` = the whole JSON file. Every `v*` tag then lands on the **Internal testing** track
   automatically (workflow `android-release.yml`); promote it in the console.

## 6. Re-render the assets
```
NODE_PATH=<folder with playwright>/node_modules node store/play/render.js
```
Needs Chrome installed (Playwright uses `channel: 'chrome'`). Roster is mocked as "Sample Pitcher"; nothing real is captured.
