---
"@sketchi/cli": minor
---

Draw swimlane flowcharts: a flowchart spec's `lanes: [{ id, label }]` and each node's `lane` draw one full-length band per actor, in order, with its name in a header. Steps sit in their lane's band, a handoff to the neighboring lane runs straight across the boundary, and lanes come out as locked shapes in Excalidraw, so steps stay free to move. `sketchi create` builds them offline, and `sketchi generate` adds lanes when a prompt describes a process across actors.
