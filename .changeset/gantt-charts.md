---
"@sketchi/cli": minor
---

Add native Gantt charts: `sketchi create` builds `{ "type": "gantt", "spec": { "title", "tasks" } }` documents offline, and `sketchi generate --type gantt` generates them. Tasks take a start day and an end day or a duration in calendar days, and may be milestones, sit under phases, record progress, and depend on other tasks finishing first. The chart draws a to-scale date axis, a date column, and dependency arrows routed clear of every bar and label.
