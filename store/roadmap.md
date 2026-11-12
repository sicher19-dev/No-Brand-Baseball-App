# No Brand Baseball - product roadmap

North star (Brian, Nov 12 2026): bigger and better than Maven Baseball. We start as in-season scouting and grow into
the complete pitcher platform: scouting + development + remote coaching, built on real pro data.

## What Maven sells (from its App Store page, Nov 2026)
- One score per athlete ("Maven Score"), broken into pillars (hitting: Gather, Bat Path, Ground, Motor). Pitching score "on the way".
- Predicted outcome stat (OPS) benchmarked against 3000+ athletes, HS to MLB.
- Trends and progress: score over time, compare two sessions side by side.
- Strengths and focus areas, with the athlete's own motion shown in 3D next to an optimal model.
- Pitching assessments: Lower Half, Sequencing, Arm Action.
- Video analysis: film anywhere, pro-level breakdown, compare to past or benchmark.
- Personalized drill library tagged to metrics.
- Training programs + messaging with coaches and Maven experts.
- Coach side: manage roster, assign programs, track progress.
- Positioning: "Not an opinion. A number." Seller Maven Baseball Lab LLC. 4.8 stars, 19 ratings, 108 MB.

## Where No Brand already wins (shipped or in the repo today)
- In-season scouting for real MLB/MiLB starts: pregame scouting reports, reverse reports, pitch grades, execution reports,
  zone usage, full-picture breakdowns. Maven has none of this.
- Reports are interactive analytics pages, not a single score.
- Real pro clients (Skenes, Chandler, Gore, Jax, ...) rather than a benchmark pool.
- Remote assessment video + coach review notes + messaging (v1.0.1+).
- Existing No Brand assets not yet in the app: MoCap library (3-camera biomech per pitcher), pitch design lab,
  grip library, development value board, offseason arsenal-optimization hub, live pen / command model.

## Roadmap (each phase ships as a tag; web updates land instantly)

### Phase 1 - In-season scouting (shipped, v1.0.x)
Login, per-pitcher report hub, remote assessment video, messaging, coach view. TestFlight + App Store submission.

### Phase 2 - Bullpen plans (next)
- Coach writes a pen script per pitcher (pitch, target, count, intent, reps); pitcher sees it as a checklist on their page.
- Pitcher marks the pen complete and can attach a pen video or TrackMan/Rapsodo CSV export.
- Coach feedback thread per pen. History of pens with dates.
- Reuses the existing nb_live / pen_tagger work in NoBrand-Command-Model where it fits.

### Phase 3 - Remote athlete program
- Weekly program: throwing, mobility, strength blocks assigned by coach, with videos/links for each drill.
- Daily check-in: arm feel, soreness, sleep, workload (pitch counts) - short form, trended over time.
- Assessment cadence: scheduled mobility videos, reminders, side-by-side with previous assessment.
- Push notifications: new report, new pen plan, coach reply, check-in reminder (needs native plugin + APNs).

### Phase 4 - Development picture (the Maven-beater)
- Biomech tab from the No Brand MoCap library: kinematic sequence, trends across sessions, game vs pen.
- Pitch design lab inside the app: shapes, grips (grip library with photos/video), targets, progress.
- No Brand pitcher grades: per-pitch and overall, trended, benchmarked against our pro pool - a number backed by
  real MLB outcomes, not a lab pool.
- Strengths / focus areas auto-generated from the data, each tied to a drill or pen intent.

### Phase 5 - Coach power tools
- Roster dashboard: who threw, who is due an assessment, who has unread messages, workload flags.
- Publish reports from the app (roster.js editor), not just from GitHub.
- Multi-coach roles (Brian, Derek, future staff), per-pitcher assignment.
- Email/push digests.

## App Store description guidance
Apple allows only current functionality in the description; update it as each phase ships.
Positioning line candidates: "Your arm. Your data. Your coaches." / "Built on big-league data, not a lab pool."
