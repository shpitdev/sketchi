---
"@sketchi/cli": minor
---

Add native user journey maps: `sketchi create` builds `{ "type": "journey", "spec": { "title", "persona", "stages" } }` documents offline, and `sketchi generate --type journey` generates them. Stages head columns across the top with each step's card under its stage, an emotion curve runs through a face per step at its 1–5 sentiment score over a dashed neutral baseline, and each stage's pain points and opportunities sit in rows beneath it. A journey too wide to read narrows its cards, then wraps into bands of whole stages with the curve running on between them.
