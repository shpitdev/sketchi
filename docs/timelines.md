# Native timelines

Use `timeline` for release milestones, incident chronologies, and roadmaps. Events are points, not scheduled durations. No Gantt resources or dependency scheduler is included.

```json
{"type":"timeline","spec":{"title":"Release","events":[{"id":"beta","label":"Public beta","date":"2026-09-15"},{"id":"ga","label":"General availability","date":"2026-10-01","description":"Release to everyone."}]}}
```

Pass this document to `sketchi create --json`, or its `spec` to `sketchi.buildTimeline({ spec, options: { artifactFormats: ["scene", "excalidraw", "png"] } })`. Public HTTP builds use `POST /api/v1/timelines/build`; generation accepts `type: "timeline"`. Studio exposes `build_timeline`.

Every event needs a unique `id`, `label`, and exactly one chronology field. Use `date` for every event when dates are supplied: a real `YYYY-MM-DD` calendar day or `YYYY-MM-DDTHH:mm:ss[.sss]Z` UTC instant. Use finite numeric `order` for every event when the source supplies only order. Do not mix modes or invent dates. Optional `description` is retained.

Events sort by timestamp or numeric order; equal values retain input order. Input arrays and date strings are preserved by the core contract; builds return the chronological normalized spec. Empty input, invalid/overflow dates, duplicate IDs, mixed modes, and more than 60 events are rejected with repair hints. Spacing communicates order, not elapsed time. The renderer lays out readable event labels on a milestone spine in alternating chronological rows with numbered labels and direction arrows; longer inputs grow in both dimensions rather than one wide row.

Maintained CLI scenarios: `release-milestones-timeline`, `incident-chronology-timeline`, and `project-roadmap-timeline`. Their `--input` checks use the model's event labels, actual dates/order, distinct event matches, chronological sequence, and exact count. Fixture proof is deterministic, not model-quality evidence.
