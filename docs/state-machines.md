# State machines

A state machine draws states and the transitions between them: an order's lifecycle, a player's modes, a connection that retries. It is a canonical family (`state-machine`), built with `sketchi.buildStateMachine`, Studio's `build_state_machine`, `POST /api/v1/state-machines/build`, `sketchi create`, or `generate --type state-machine`.

```json
{"type":"state-machine","spec":{"title":"Media player","initial":"stopped","states":[{"id":"stopped","label":"Stopped"},{"id":"active","label":"Active","initial":"playing"},{"id":"playing","label":"Playing","parent":"active"},{"id":"paused","label":"Paused","parent":"active"},{"id":"ejected","kind":"final"}],"transitions":[{"source":"stopped","target":"active","event":"play"},{"source":"playing","target":"paused","event":"pause"},{"source":"paused","target":"playing","event":"resume"},{"source":"playing","target":"playing","event":"seek","action":"jump"},{"source":"active","target":"stopped","event":"stop"},{"source":"stopped","target":"ejected","event":"eject","guard":"tray open"}]}}
```

## Contract

- `initial` names the top-level state the machine starts in. It draws as a filled dot.
- A state has a unique `id` (no `:`) and an optional `label`. Across all surfaces, an omitted regular-state label defaults to the id verbatim, like class and ER names: `waiting_for_payment` stays `waiting_for_payment`. An explicit blank label is invalid. `kind: "final"` ends the machine. Its omitted label also defaults to its id, drawn as a named state followed by a bullseye. Generic final ids stay anonymous bullseyes when all their words come from `end`, `ended`, `final`, `finish`, `finished`, `done`, `stop`, `stopped`, `exit`, `state`, `node`; case boundaries, underscores, hyphens, spaces and digits split the words (`endState`, `end2`, `__end__`). Real outcomes such as `Failed`, `Cancelled`, `Terminated` and `Delivered` keep their names. Explicit labels take precedence. `kind: "choice"` is a branch point drawn as a diamond whose outgoing transitions carry guards.
- States that name another state as `parent` form a composite, drawn as a frame around them. A composite's `initial` names the substate a transition into it enters, drawn as a dot inside the frame. Composites hold states, not other composites.
- A transition has `source`, `target` and optional `event`, `guard` and `action`, kept as separate fields and drawn as one label, `event [guard] / action`. It may return to its own state, and may leave or enter a composite. In Code Mode its `id` is optional.
- At most 30 states, 60 transitions and 6 composites. Every state must be reachable from `initial`, a final state has no outgoing transitions, a choice has two or more, each with its own guard (one may be `else`), and a transition into a composite needs the composite's `initial`. Each rejection carries a repair hint.

## Layout

- The graph router lays the machine out left to right or top to bottom. Without `layout.direction`, it renders both and keeps the one with a readable aspect (up to 2.5:1) and fewer crossings and reader findings.
- A self-loop leaves the side across the flow and returns into the side the flow enters by, as a loop around that corner, with its label outside the loop. A second loop on the same state takes the next corner, and every other line keeps out of the corner.
- A transition and its return between the same two states run as two parallel lines, the transition on the low side (left or above) and the return on the high side, each label outside the pair. Only when a paired lane still crosses another arrow after the normal repairs, the router tries one extra layout with ordinary routing for the crossed pairs alone. Unrelated pairs keep their lanes. The candidate is kept only with strictly fewer crossings and no worse export defects, inward endpoints or reader findings.
- Every transition label sits nearer its own line than any other line, by a clear margin. When another transition's run passes closer, that run moves clear of the label, but only if the move adds no crossings, export defects or reader findings. A label beside a vertical line aligns its text toward that line.
- Transitions into and out of a composite end on its frame, right of its name on the top side. The composite lays out as one block, like a flowchart group.
- Each transition into an unlabeled final state ends at a bullseye of its own, placed where its line runs straight. A labeled final state draws as its state followed by a bullseye.

## Excalidraw

States are rounded rectangles with bound labels. Initial dots, bullseyes and unlabeled choices carry the `state-marker` renderer role: no label is drawn, they stay obstacles for other arrows, and the bullseye's ring and core are grouped. Each composite is a frame named by its label; its substates are frame children, and transitions into or out of it bind to the frame.

## Scenarios

Maintained scenarios: `order-lifecycle-state-machine` (guards, cancellations, a return and three ends), `media-player-state-machine` (a composite with a self-loop inside), `turnstile-state-machine` (self-loops and a guarded unlock) and `connection-retry-state-machine` (a guarded choice, a labeled final and a composite). Their `--input` checks require every stated state in the right composite, the initial state, each composite's initial substate, and every transition between the right states with its event, guard and action in their own fields.
