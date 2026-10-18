---
"@sketchi/cli": minor
---

Add native state machines: `sketchi create` builds `{ "type": "state-machine", "spec": { "title", "initial", "states", "transitions" } }` documents offline, and `sketchi generate --type state-machine` generates them. States may be final or choices, states that name a `parent` form a composite drawn as a frame, and transitions are drawn `event [guard] / action`, including self-loops and transitions into or out of a composite.
