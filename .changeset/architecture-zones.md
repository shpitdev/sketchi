---
"@sketchi/cli": minor
---

Draw architecture diagrams: a flowchart spec's groups nest through `parent` (a subnet in a VPC in a region) and say what they stand for through `kind` (`cloud`, `datacenter`, `region`, `zone`, `vpc`, `subnet`, `cluster` or `namespace`), and a node's `shape` draws it as a `database` cylinder, a `queue`, a `document` or a `storage` bucket. Zones come out as styled, locked rectangles with their labels in a header strip, children inside their parents, and edges cross zone outlines without running along them. `sketchi create` builds them offline, and `sketchi generate` nests zones when a prompt describes an architecture.
