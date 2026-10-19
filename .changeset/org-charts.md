---
"@sketchi/cli": minor
---

Add native org charts: `sketchi create` builds `{ "type": "org-chart", "spec": { "title", "people", "dottedLines" } }` documents offline, and `sketchi generate --type org-chart` generates them. Each person draws as a card of name, title and department; each manager stands above the reports their bus line feeds, long lists of reports stack in one or two columns, assistants hang beside their manager, and dotted-line reports draw dashed with a head at the second manager, around the hierarchy where they can, with their stated scope as a label on the line. `groupByDepartment: true` draws each department as a labeled region.
