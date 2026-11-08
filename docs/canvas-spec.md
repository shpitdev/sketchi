# CanvasSpec v1

`CanvasSpec` is Sketchi's canonical, renderer-independent scene IR. All
rendered flowchart, mindmap, sequence, and agent-authored canvas scenes compile
to this representation before Excalidraw, PNG, or scene persistence.

Agents call `sketchi.createCanvas({ spec, options })` through the existing Code
Mode `execute` surface. There is no diagram-specific MCP tool and raw
Excalidraw JSON is never accepted as input.

The published CLI exposes the same production contract without requiring MCP:

```sh
sketchi canvas --file canvas.json --output json
cat canvas.json | sketchi canvas --file - --format excalidraw --dest canvas.excalidraw
```

The command defaults to
`https://playground.sketchi.app/api/v1/canvases/create`, validates input and
response with the shared CanvasSpec/CreateCanvas schemas, stores the returned
diagram locally, and exports PNG, Excalidraw, or scene consistently with
`generate`. `SKETCHI_CANVAS_ENDPOINT` and `--endpoint` are intended only for
preview and local testing.

## Capabilities

- Shapes: rectangle, ellipse, diamond, circle, and polygon.
- Standalone or bound text with font, alignment, color, and width controls.
- Lines, polylines, and bound connectors with independently selected endpoint
  arrowheads. A connector with `curved: true` draws a smooth curve through its
  points, as mindmap branches do, instead of an orthogonal route.
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

Limits are 5,000 elements, 64 layers, 128 layouts, 256 points per element, 16
groups per element, 4,096 characters per text element, 16,384 units per canvas
dimension, 5,000 z-order entries, and 4 MB serialized input. These are
ceilings, not targets: each diagram family keeps its own, much smaller limits
(a flowchart holds 80 nodes), and a canvas reads best well under them.

A canvas may also export at most 10,000 Excalidraw elements, the most a CLI share link pulls back, so no accepted canvas has more elements than a share link holds. A labelled node
or connector exports as two Excalidraw elements and a composed shape, such as a
labelled cylinder, as several, so 5,000 elements leaves room for a canvas of
the simple ones. A 5,000-element canvas validates and converts in under a second
in Node, its Browser Run PNG export takes about 14 of its 30 seconds, and Studio
opens it in about 3 seconds. An MCP `execute` script's
default PNG has a 15-second budget, which a canvas of a few thousand elements
over a large area can miss: the build then succeeds with a `png_unavailable`
warning, and a script that asks for `png` in `artifactFormats` gets the full 30
seconds. A build, patch or generate request over any of these limits
fails with `canvas_limit_exceeded` and status `limit_exceeded` (HTTP 413). The
HTTP canvas and patch endpoints accept request bodies up to the serialized limit
plus 64 KB; the other builders keep their 256 KB.

Executable Code Mode examples for ERD, architecture map, timeline,
dashboard/chart, wireframe, and a dense 120-element matrix live in
`examples/code-mode/create-canvas-matrix.mjs`.
