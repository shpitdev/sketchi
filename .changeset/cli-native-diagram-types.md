---
"@sketchi/cli": minor
---

`sketchi generate --type` now lists and accepts only the diagram types Sketchi draws: flowchart, mindmap, and sequence. Help no longer advertises ER, architecture, swimlane, or state-machine. Without `--type`, a prompt that asks for another kind of diagram still fails with the typed `unsupported_diagram_type` error instead of being coerced. `sketchi create` and the generate builder now take their document types from one shared family registry.
