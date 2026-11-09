---
"@sketchi/cli": patch
---

`sketchi patch` refuses a flowchart and points at `sketchi edit ID --json '{"edits":[...]}'`, which changes its steps, labels, colors and shapes in the document. `generate` and `revise` no longer patch a flowchart's drawing: node colors and diamonds are in its document, and an edge color, a text color or another shape the request asks for comes back as a warning.
