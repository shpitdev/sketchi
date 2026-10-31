# Mindmaps

A mindmap draws a nested topic hierarchy around one central topic: a brainstorm, study notes, a plan. It is a canonical family (`mindmap`), built with `sketchi.buildMindmap`, `POST /api/v1/mindmaps/build`, `sketchi create`, or `generate --type mindmap`.

```json
{"type":"mindmap","spec":{"title":"Team offsite","root":{"label":"Team offsite","children":[{"label":"Location","children":[{"label":"Mountain lodge"},{"label":"City hotel"}]},{"label":"Activities","children":[{"label":"Hiking"},{"label":"Cooking class"}]},{"label":"Food"}]}}}
```

## Contract

- One `root` topic with ordered `children`, nested to any depth up to 8 levels and 100 topics.
- `layout.direction` is `LR` (the default: branches run clockwise from the top right) or `RL` (mirrored: counter-clockwise from the top left).

## Layout

`renderMindmapDiagram` owns the layout; mindmaps never go through the flowchart router.

- The central topic is an ellipse in the middle. Main branches split into a right and a left side, in authored order clockwise, at the split whose two stacks are closest in height.
- Each subtree grows outward from its main branch: children stack one curve's run beyond their parent, each packed as close under the one before as their shapes allow, and the parent sits centered on them. Every node and every fan of curves is packed as a box, so no topic overlaps another and no curve crosses another or runs through a topic.
- Main branches sit on an arc: the farther a branch sits above or below the center, the closer it comes in, and one clear of the central topic may come in over it. While the map would export wider than 1.8:1, its main branches spread apart vertically; two lone branches are offset up and down instead.
- A map that would still export wider than 2.4:1 folds its deepest topics into lists below them, from ever shallower levels, and keeps the least folding that reads. A deep chain becomes a staircase.
- Labels step down from the center: 20 px in the central topic, 16 px on main branches, 14 px below. Lines balance to the narrowest width that keeps their count.
- Each main branch has its own color (the chart series palette), shared by its topics and curves. Fills fade with depth.

Why two sides rather than rings? Measured against a ring radial layout (wedges by leaf count, each ring as close in as its boxes allow, connectors ignored, so its best case) on the five scenarios and five stress maps:

- In a 1600×900 view, every two-sided map shows its text at full size; the radial 41-topic roadmap, 42-topic classification and 24-topic list shrink to 8–10 px, and the three-level notes and seven-branch plan to 13 px. Square maps waste a landscape screen.
- Fitted to a 2000 px long side, radial text is larger on small or deep maps (17.5 → 23.2 px on the five-level classification) and smaller on wide ones (38.8 → 16.7 px on the 24-topic list), while every two-sided scenario stays at 17.5 px or more.
- Two sides keep text in one reading direction per side, the authored order clockwise, and no crossings by construction; the arc gives small maps and lists of lone topics the radial look where it costs nothing.

## Excalidraw

Each curve is a curved Excalidraw arrow (`curved: true` on the scene connector) with no arrowhead, bound to both topics, so it follows a topic you move. The central topic is an ellipse; every other topic is a rounded rectangle with a bound label. Each main branch's topics, labels and inner curves form one group, so a branch drags as a unit; the curve from the center stays outside the group and stretches.

## Scenarios

Maintained scenarios: `team-offsite-mindmap-v2` (a small brainstorm), `photosynthesis-study-mindmap-v2` (study notes three levels deep), `app-launch-planning-mindmap-v2` (seven main branches), `ml-roadmap-mindmap-v2` (41 topics, labels that share words) and `animal-kingdom-mindmap-v2` (42 topics, five levels, two uneven branches). Their `--input` checks require the central topic, every stated topic under its stated parent, and no topic the prompt does not state (a stated topic drawn twice counts as invented); a scene check requires the drawn map to keep topics and curves clear and uncrossed.
