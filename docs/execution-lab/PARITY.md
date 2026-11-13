# Execution Lab: parity checklist

Everything the reference execution tool shows (screen recording, 2026-11-12,
one-minute walk-through of a season page for one pitcher), plus what the
Execution Lab adds on top. The reference is a benchmark only: nothing from it
is named on a player-facing page.

Status column: `engine` = the step 1 engine already computes it; `page` =
needs the page; `data` = needs a feed or pipeline we do not have wired yet;
`later` = a later build step.

## Must have: click a pitch, watch the pitch

The pitcher's favorite feature. Every pitch dot and every pitch-log row opens
the broadcast clip of that pitch inline, with a caption ("Pitch 49, 4-seam
fastball to <batter>, inning 4, count 0-0"), play / pause, scrubber, mute, and
Close. Clip rights for this come through the data provider agreement, which is
in place.

| Feature | Reference | Ours | Status |
|---|---|---|---|
| Click pitch for video from the location chart | yes | yes | data, page |
| Click pitch for video from the pitch log | yes | yes | data, page |
| Clip caption with pitch number, type, batter, inning, count | yes | yes | page |
| Inline player: play / pause, scrubber, time, unmute, close | yes | yes | page |
| Target drawn on the catcher in the clip (circle on the glove) | yes | yes | data |
| Edit target button on the clip to correct the glove read | yes | yes, writes back to the inferred layer | later |
| Clip stays open while scrolling the chart above it | yes | yes | page |

## Season page

| Section | Reference | Ours | Status |
|---|---|---|---|
| Season hero tiles: Overall execution, Velo execution ("relative to max"), Command execution ("distance from target"), each with +/- vs league | yes | Command only on player pages by default. Velo tile is coach-only (house rule: no velo on player pages by default). | engine, page |
| "50 is league avg execution" anchor on every section | yes | yes, league line per layer | engine |
| Summary table by pitch type, two seasons side by side: pitches, overall, velo, command (inches) | yes | yes, minus velo on player pages. Command in inches and as score. | engine, page |
| Score chips colored by distance from 50 (red above, blue below) | yes | yes | page |
| Trends: start-by-start line chart, two seasons side by side | yes | yes, with the noise band shaded per start (reference has no band) | engine, page |
| Trend toggles: Overall / Velo / Command, each a separate line, multi-select | yes | Command plus the three target layers; velo coach-only | page |
| Trend toggles by pitch type, multi-select, legend names "Overall, Sinker" | yes | yes | page |
| Game log: date, home/away, opponent, pitches, overall, velo, command, colored chips, scroll | yes | yes, plus executed % and centered % | engine, page |
| Click a game log row to open that game | yes | yes | page |

## Game page

| Section | Reference | Ours | Status |
|---|---|---|---|
| Header: date, opponent, "Game 31 of 32 in 2026", Previous / Next game | yes | yes | page |
| Game tiles: Overall, Velo, Command, each +/- vs season | yes | Command vs season, plus grade mix vs season | engine, page |
| Location chart, Miss pattern view: dots in inches from target, rings at 10 and 20, dashed target circle, "12 in target circle" count, colored by pitch type | yes | yes: rings at 6 and 12, spread ellipse, aim-offset arrow, count in the circle | engine, page |
| Location chart, Target to plate view: glove target (open circle), plate location (dot), miss line, strike zone, home plate, colored by pitch type | yes | yes, plus the plan box for the selected pitch and the dead-middle box | engine, page |
| Pitch type filter on the game chart (click a type to isolate, others fade) | yes | yes | page |
| Pitch type summaries for the game: pitches, overall, velo (+/- vs season), command in inches (+/- vs season) | yes | yes, minus velo on player pages | engine, page |
| All pitches log: #, inning (with outs as 0.1 / 0.2), count, batter, pitch, overall, velo, command inches, colored chips | yes | yes, plus grade (executed / within one ball / centered / off) and the layer the row is scored on | engine, page |
| "Click pitch for video" on the log | yes | yes | data, page |

## What the Execution Lab adds (the "and more")

- Three target layers, switchable: the glove, the glove moved by the
  pitcher's own aim habit, and the plan. The reference grades against the
  glove only.
- The plan layer grades every pitch, including the ones with no readable
  glove, and never rewards dead-middle.
- Grades, not only a score: executed, within one ball, centered, strike off
  target, ball off target, with the grade mix per game and per pitch type.
- Aim offset and spread split apart: what is fixable by aiming versus
  repeatability.
- Noise band on every start so a one-game swing reads as noise when it is.
- Count split (before two strikes / with two strikes) everywhere.
- Edit target writes back and re-scores, instead of a one-off correction.
- Lab mode: body and mound-force data attach to a pitch when a lab session
  exists (later step).

## House rules applied

- No velocity on player pages by default. Velo execution exists for coaches.
- No data-source names or internal codenames on anything a player sees;
  clips carry no provider branding in the caption.
- Brand on every page: No Brand Baseball Analytics.
