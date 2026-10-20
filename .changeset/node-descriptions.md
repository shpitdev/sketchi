---
"@sketchi/cli": patch
---

Flowchart node descriptions now draw: each one is a smaller, muted subtitle under its node's label, inside the node, wrapped at whole words and grouped with the node in Excalidraw. A long description widens its node, up to a bound, so it fits in two lines; past three lines at that width it still draws in full and the build returns a `label_too_long` warning. Nodes without descriptions render exactly as before.
