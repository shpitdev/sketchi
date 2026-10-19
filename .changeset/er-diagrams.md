---
"@sketchi/cli": minor
---

Add native ER diagrams: `sketchi create` builds `{ "type": "er", "spec": { "title", "entities", "relationships" } }` documents offline, and `sketchi generate --type er` generates them. Each entity draws as a table of its fields, with PK, FK and UK markers, types and nullable fields marked `?`. Each relationship draws as an orthogonal line between the rows it joins, with a crow's-foot end for its cardinality at each table: one, zero or one, many, one or many, or zero or many. Fields may be written on one line, as in `"customer_id uuid FK"`.
