---
"@sketchi/cli": minor
---

Add native UML class diagrams: `sketchi create` builds `{ "type": "class", "spec": { "title", "classes", "relationships" } }` documents offline, and `sketchi generate --type class` generates them. Each class draws as a box of three compartments: its name under any `«interface»`, `«abstract»` or `«enumeration»` keyword, its attributes and its methods, with visibility and `{static}` or `{abstract}` markers. Superclasses and interfaces stand above the classes that extend or implement them. Relationships draw with their UML heads: hollow triangles for inheritance and (dashed) realization, filled and hollow diamonds for composition and aggregation, open arrows for navigable associations and (dashed) dependencies, with multiplicities and roles beside their ends. Members may be written on one line, as in `"+ area(): double"`.
