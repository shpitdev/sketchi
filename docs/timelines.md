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
- Dated events are spaced by elapsed time with a minimum marker gap; an outsized gap becomes a marked axis break. Ordered events are evenly spaced and carry no caption.
- Captions keep each date's precision (`2019`, `Mar 2020`, `Sep 1`, `09:05`). The year appears on the first caption and wherever it changes. A same-day chronology shows its date and timezone once in a header, and each event shows only its time. Instants share their common offset, or show in UTC when offsets differ.
- Labels alternate above and below the axis, and dense clusters fan out into tiers without crossing stems. Long timelines wrap into left-to-right rows; each row ends with a dashed arrow and the next one starts with a dashed lead-in.
- Markers carry the `timeline-marker` renderer role. Each event's marker, stem, and text are grouped, so they move together in Excalidraw.

## Scenarios

Maintained CLI scenarios: `release-milestones-timeline`, `incident-chronology-timeline`, `project-roadmap-timeline`, `company-history-timeline` (mixed precision), `checkout-outage-timeline` (same-day minutes, offset, milestones), `library-releases-timeline` (uneven gaps), `launch-phases-timeline` (phases and today), `launch-workstreams-timeline` (two lanes), and `lunar-mission-timeline` (ten events with a description). Their `--input` checks use the model's own labels and dates at the prompt's precision, phase ends, milestone kinds, lanes, descriptions, the Today date, distinct matches, chronological sequence, and exact counts. Fixture proof is deterministic, not model-quality evidence.
