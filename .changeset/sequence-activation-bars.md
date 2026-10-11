---
"@sketchi/cli": minor
---

Sequence diagrams from `sketchi create` and `sketchi generate` now draw activation bars. A message of type `return` answers the latest open call between the two participants, and the callee's lifeline shows a bar from that call to its return. Re-entrant calls nest, and calls nobody answers draw no bar. Messages attach to the bars in the PNG and Excalidraw exports.

Activation bars use ids under `<participant>:lifeline:`, so a participant id that starts with another participant's id followed by `:lifeline` (for example `api:lifeline:v2` next to `api`) is now rejected. Before, only an exact `api:lifeline` collided. The repair hint is now "Rename the participant so its id does not start with another participant id followed by :lifeline."
