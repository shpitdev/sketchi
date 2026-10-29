# Venn diagrams

A Venn diagram draws what two or three sets share: one circle per set, its label outside it, and the items of each region (only in one set, in two, or in all three) inside exactly that region. It is a canonical family (`venn`), built with `sketchi.buildVennDiagram`, Studio's `build_venn_diagram`, `POST /api/v1/venn-diagrams/build`, `sketchi create`, or `generate --type venn`.

```json
{"type":"venn","spec":{"title":"iOS vs Android","sets":[{"id":"ios","label":"iOS"},{"id":"android","label":"Android"}],"regions":[{"sets":["ios"],"items":["Apple Pay"]},{"sets":["android"],"items":["Google Pay"]},{"sets":["ios","android"],"items":["Push notifications","Dark mode"]}]}}
```

## Contract

- `sets: [{ id, label, color? }]`: two or three sets, with distinct ids and labels (40 characters at most). `color` is a palette name (`blue`, `orange`, `green`, `yellow`, `pink`, `violet`, `red`, `gray`; matched case-insensitively against those names only) or a `#rrggbb` hex; sets without one take blue, orange and green in order.
- `regions: [{ sets, label?, items?, count? }]`: a region holds what lies in exactly its `sets` and in no other set. `["a"]` is only in a, `["a", "b"]` is in a and b but not c, in any key order. Each combination appears once. A region holds `items` (phrases of at most 60 characters, at most 12 per region and 40 in all) or a `count`, not both; `label` names the overlap itself ("Shared"). Regions the request leaves empty are omitted; an empty `items` list draws nothing, and so does a `count` of 0 in a diagram that lists items and no positive count. In a diagram of counts alone every count draws, 0 included. An item's own line breaks are kept as line boundaries.
- No field takes coordinates or sizes: area-proportional diagrams are out of scope.
- Code Mode and generation also read a set without an `id` (it takes its label), regions that name sets by label, a lone set name for a list of one, a lone region object for a list of one, `in` for `sets` and `members` for `items`; any other non-list `regions` is rejected. A set may instead list its whole membership as `items`; each item then joins the region of exactly the sets that list it, merged into a stated region of the same sets.
- Validation rejects one set or four, a repeated set id or label, an unknown color, a region naming a set that does not exist or a set twice, two regions for one combination, a region with both items and a count, text over its limit, and more than 12 items in a region or 40 in all. Each rejection carries a repair hint.

## Layout

- The standard symmetric arrangement of equal circles: two side by side, or three in an equilateral triangle, two above and one below.
- Text sizes the diagram, not the reverse. For each separation of the centres (from 0.6 to 1.4 radii, the canonical 1.0 first) the circles grow, to the pixel, until every region's text fits inside its region, at least 10 px from every outline it must stay inside or outside of. The layout then takes the separation that keeps the diagram narrowest, paying for each step away from the canonical arrangement, so a crowded centre pulls the circles together and crowded sides push them apart. Circles never shrink below a radius of 110 (two sets) or 120 (three).
- Items are 15 px, one per line, centred on the region and 7 px apart; a region's label (17 px) and count (26 px) sit above them. An item wraps at word boundaries only when its region would otherwise need circles more than a fifth larger; a word is never broken.
- Each region's block sits where it is farthest from the outlines around it, then is centred within the stretch where it stays nearly that far, so a lone item sits on its crescent's middle line.
- Set labels (20 px) sit outside their circles, the upper two above, over the part only their set covers, and a third below its circle. Each takes its set's color, darkened until it reads on the surface.
- Fills are translucent (22% opacity), so each overlap shows the blend of its sets. A dark set color fills with a lighter tint of itself, so ink reads at 7:1 or better on every blend.
- Work is bounded and deterministic: the fixture tries under 400,000 placements and a twelve-item centre under 600,000; renders take 1–75 ms.

## Excalidraw

Each set is a group (`venn:set:<n>`): a translucent filled ellipse, an outline ellipse over every fill, and the label as free text. Both ellipses carry the `venn-set` renderer role, so neither grows a generated label and patches keep them. Each region's texts are free, centre-aligned text elements grouped as `venn:region:<n>+<m>`, one per item, so an item edits on its own and a region drags as one. Every export validates before and after a save and reload.

## Scenarios

Maintained scenarios, from Frontierclimb's eval prompts: `team-skills-venn` (Design, Engineering and Product, all seven regions filled, 13 items), `plan-features-venn` (the challenge: 20 features across three plans with seven in the centre, long items, and Personal ∩ Education stated empty) and `ios-android-venn` (two sets, 10 items). Their `--input` checks score the model's own spec: `set:<key>` for every set by label, `item:<key>` for every item and `region:<key>` for each in exactly its stated combination, in any key order, `sets-exact` and `items-exact` (no unstated set or item, none in two regions), and `empty-region:<combo>` for a region stated empty (no items, a count of 0, or no entry). Labels compare without case, spacing, punctuation or a leading bullet. `venn-drawn` reads the scene back: every outline with its label outside it and nearest its own outline, and every item, region label and count wholly inside its own sets and outside the others. `venn-layout` checks that no texts overlap, items stand at least 4 px clear of every outline, and set labels sit clear of every circle.

## Fuzz

`pnpm nx run diagram-excalidraw:venn-fuzz` draws 900 random diagrams over three seeds (CI draws 12): two or three sets with short, long and non-Latin labels and colors, regions empty, sparse or packed to the caps with phrases up to 60 characters, sometimes labeled or counted. Every export validates before and after a reload, every item is drawn once, whole and inside exactly its region, no text overlaps, set labels stay outside every circle, fills stay translucent, and every diagram reads between 1:1.4 and 2.45:1.
