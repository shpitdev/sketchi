---
"@sketchi/cli": minor
---

Add native Venn diagrams: `sketchi create` builds `{ "type": "venn", "spec": { "title", "sets", "regions" } }` documents offline, and `sketchi generate --type venn` generates them. Two or three equal, overlapping translucent circles each carry their set's label outside, and each region's items (or a count) sit centred inside exactly that region; the circles grow until every region's text fits, so a crowded centre or long items never cross an outline.
