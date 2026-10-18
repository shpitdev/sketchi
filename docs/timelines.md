# Native timelines

Use `timeline` for release milestones, incident chronologies, roadmaps, phased plans, and company histories. Gantt resources and dependency scheduling are out of scope.

```json
{"type":"timeline","spec":{"title":"Launch","today":"2026-03-10","events":[{"id":"build","label":"Build","date":"2026-02-16","end":"2026-05-29"},{"id":"beta","label":"Public beta","date":"2026-06-01","description":"Collect feedback from early users."},{"id":"ga","label":"General availability","date":"2026-08-04","kind":"milestone"}]}}
```

Pass this document to `sketchi create --json`, or its `spec` to `sketchi.buildTimeline({ spec, options: { artifactFormats: ["scene", "excalidraw", "png"] } })`. Public HTTP builds use `POST /api/v1/timelines/build`; generation accepts `type: "timeline"`. Studio exposes `build_timeline`.

## Contract

Every event needs a unique `id`, a `label`, and exactly one chronology field:

- `date` on every event, at the source's precision: `YYYY`, `YYYY-MM`, `YYYY-MM-DD`, or an instant `YYYY-MM-DDTHH:mm[:ss[.sss]]` with `Z` or an explicit `±HH:MM` offset. Zone-less instants are rejected as ambiguous.
- numeric `order` on every event when the source gives no dates. Do not mix modes or invent dates.

Optional fields:

- `end` turns a dated event into a phase. It is inclusive at its own precision, so `"date":"2026-09","end":"2026-09"` is all of September. Phases need dates and cannot be milestones.
- `kind: "milestone"` draws a diamond; `"event"` (the default) draws a dot.
- `lane` puts events on labeled tracks. When any event has a lane, every event needs one. Top-level `lanes` sets the track order (default: first chronological use); at most 6.
- `today` draws a Today marker at that date on a dated timeline. Nothing reads the clock, so output stays deterministic.
- `description` adds a short line under the label.

Events sort by the start of their period or by order; equal values keep input order. Builds return the chronological normalized spec. Empty input, invalid dates, duplicate ids, mixed modes, malformed spans or lanes, and more than 60 events are rejected with repair hints.

## Rendering

The renderer owns all coordinates:

- One axis per lane with dot, diamond, and phase-bar markers. No arrows between events and no number badges.
- Dated events sit on one time scale shared by every lane, with nothing drawn off scale unless an axis break marks it. Ordered events are evenly spaced and carry no caption.
- Captions keep each date's precision (`2019`, `Mar 2020`, `Sep 1`, `09:05`). The year appears on the first caption and wherever it changes. A same-day chronology shows its date and timezone once in a header, and each event shows only its time. Instants share their common offset, or show in UTC when offsets differ.
- Labels alternate above and below the axis, and dense clusters fan out into tiers without crossing stems. Long timelines wrap into left-to-right rows; each row ends with a dashed arrow and the next one starts with a dashed lead-in.
- Markers carry the `timeline-marker` renderer role. Each event's marker, stem, and text are grouped, so they move together in Excalidraw.

### Spacing

- The scale starts at about one label pitch per event. It then grows until each pair of neighbors on a lane is far enough apart for its labels and each phase bar is visible. Labels never move a marker off its date. Collisions are solved by the scale and by stacking labels in tiers. A marker dated inside a phase may sit on its bar, including one on the phase's last day. If a marker dated outside a phase would land on that phase's bar, every phase on that lane moves down to one track below the axis, so the lane's bars stay together. Markers stay on the axis at their dates, and the scale doesn't change.
- A gap that this scale would draw longer than ten label pitches becomes an axis break: two slanted ticks around the time it leaves out, such as `5 months`, exactly where that time is. The break starts past every earlier marker on every lane, so events on the same date always stay on the same side of it.
- Once any gap breaks, so does every gap that a break would shorten by at least its own length. Breaks draw on a log scale: the shortest draws 1.5 label pitches, or as long as the longest unbroken gap if that is longer, each doubling of the time left out adds half that, and the longest draws at most twice the shortest. So gaps between moments on any lane draw in the order of their real time, and a gap with half again another's time draws visibly longer.
- A single row is capped at 3.5:1, measured as the hosted PNG frames it. A row past the cap breaks its widest remaining gap, then measures again, until it fits. Only gaps that a break shortens by at least its own length qualify, and no gap inside a phase does. Spacing stays to scale within each stretch between breaks. If no qualifying gap is left and the row still doesn't fit, the timeline wraps at its natural scale instead. Phases that cover every gap leave nothing to break or wrap, so such a row may stay wider. A row within the cap compresses nothing, even long gaps. In `library-releases-timeline`, drawing the 162-day gap 23 times the 7-day gaps took the row to 4.25:1, so that gap breaks as `5 months` and the 610-day gap after v1.0 as a longer `20 months`, and the row lands near 2.3:1.
- A phase cannot break. Its bar can grow to twenty label pitches, twice the longest unbroken gap. If two neighbors are still too close to draw at that scale, the longest gap between them gets a break, even inside a bar, so no gap is stretched without a mark. That break states its time too, but it draws longer than its time at scale, so it stands outside the elapsed order.
- Simultaneous events on one lane fan out to the right of their date by the minimum gap, and their captions share the date. The next date is measured from the true position. A phase hangs its label from its midpoint, or from the middle of its longest free stretch when an event is on that midpoint. A phase that spans Today hangs its label from its longer side of the Today line, because that line runs through every label tier.
- Wrapping keeps the scale. A row can end anywhere in a gap that no phase crosses. The next row picks up at the same moment, so the gap's length is split between the end of one row and the start of the next. A row that ends in a break shows the whole break before its dashed arrow, and the next row draws the rest of the gap. Cuts prefer breaks, then wide gaps.

## Scenarios

Maintained CLI scenarios: `release-milestones-timeline`, `incident-chronology-timeline`, `project-roadmap-timeline`, `company-history-timeline` (mixed precision), `checkout-outage-timeline` (same-day minutes, offset, milestones), `library-releases-timeline` (uneven gaps), `launch-phases-timeline` (phases and today), `launch-workstreams-timeline` (two lanes), and `lunar-mission-timeline` (ten events with a description). Their `--input` checks use the model's own labels and dates at the prompt's precision, phase ends, milestone kinds, lanes, descriptions, the Today date, distinct matches, chronological sequence, and exact counts. Dated scenarios also check spacing (`timeline-spacing`). The rendered scene is read back as one unwrapped axis per lane (`readTimelineGaps`). Every gap between the prompt's events that has no break must match the prompt's real elapsed time at one shared scale, within 5%. The gap order check (`timeline-gap-order`) requires the gaps between the prompt's events, across lanes, to draw in the order of their real time, with half again the time beside a break drawing longer, and every break to state its gap's time within rounding. Fixture proof is deterministic, not model-quality evidence.
