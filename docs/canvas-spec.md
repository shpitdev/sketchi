# CanvasSpec v1

`CanvasSpec` is Sketchi's canonical, renderer-independent scene IR. All
rendered flowchart, mindmap, sequence, and agent-authored canvas scenes compile
to this representation before Excalidraw, PNG, or scene persistence.

Agents call `sketchi.createCanvas({ spec, options })` through the existing Code
Mode `execute` surface. There is no diagram-specific MCP tool and raw
Excalidraw JSON is never accepted as input.

## Capabilities

- Shapes: rectangle, ellipse, diamond, circle, and polygon.
- Standalone or bound text with font, alignment, color, and width controls.
- Lines, polylines, and bound connectors with independently selected endpoint
  arrowheads.
- Frames, nested group identifiers, layers, locking, opacity, and explicit
  back-to-front `zOrder`.
- Deterministic row, column, grid, stack, align, and distribute layout
  primitives.
- Structural patches: insert, remove, replace, reorder, group, and ungroup.
  Element ids remain stable across replacement and reordering.

Layout primitives execute in request order. Connector endpoints and bound text
are synchronized after layout, and the persisted scene contains the resolved
geometry plus the original layout intent.

A node's required `label` renders automatically when the scene has no explicit
text element bound to that node. Add a bound text element when the label needs
custom font, alignment, color, or width settings; it replaces the automatic
label rather than duplicating it.
The same override rule applies when text is explicitly bound to a connector
that also has a `label`.

## Safety and limits

Validation enforces reference integrity, unique ids, positive bounds, finite
typed values, polygon/point structure, and resource limits. Overlap is not an
error because dashboards, wireframes, annotations, and layered illustrations
use overlap intentionally.

CanvasSpec has no image URL, SVG, HTML, script, data URL, or arbitrary payload
field. It therefore cannot execute markup or fetch external resources. This v1
slice intentionally omits long-tail vector paths and asset references rather
than introducing an unreliable or unsafe partial contract.

Limits are 600 elements, 64 layers, 128 layouts, 256 points per element, 16
groups per element, 4,096 characters per text element, 16,384 units per canvas
dimension, 600 z-order entries, and 1.5 MB serialized input.

Executable Code Mode examples for ERD, architecture map, timeline,
dashboard/chart, wireframe, and a dense 120-element matrix live in
`examples/code-mode/create-canvas-matrix.mjs`.
