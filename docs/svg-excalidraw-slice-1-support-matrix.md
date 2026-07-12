# SVG → Excalidraw Slice 1 IR and diagnostics support matrix

Checked evidence:
`packages/svg-excalidraw/evidence/slice-1-ir-capability-metrics.json`.
Historical Slice 0 renderer evidence remains in `fill-spike-metrics.json`.

| Boundary                                                                   | Slice 1 result        | Proof / policy                                                                                                                                                                                                             |
| -------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| XML boundary                                                               | Supported             | Malformed XML and non-SVG roots return typed fatal results.                                                                                                                                                                |
| `path`                                                                     | Supported             | Absolute normalization, separate `M` subpaths, implicit fill closure kept distinct from source stroke closure.                                                                                                             |
| `rect`, rounded `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon` | Supported             | All lower into the same absolute canonical subpath IR.                                                                                                                                                                     |
| Nested transforms                                                          | Supported             | matrix / translate / scale / rotate(center) / skewX / skewY compose at every nesting level; numeric tokens and operation arities are strict.                                                                               |
| CSS paint and inheritance                                                  | Supported subset      | Presentation attributes, simple selectors, specificity, inline style, `currentColor`, opacity, inherited paint, reversible visibility, and irreversible display suppression. Unsupported selectors/at-rules/nesting block. |
| Advanced stroke presentation                                               | Native unsupported    | Dash arrays/offsets, caps, joins, miter limits, markers, paint order, and vector effects block rather than being ignored. Sixteen corpus files apply at least one.                                                         |
| `<use>`                                                                    | Supported / bounded   | Local expansion, inherited paint, x/y/transforms, stable identity, and deterministic defaults of 64 depth / 10,000 expansions / 20,000 shapes. Missing/cyclic refs and budget exhaustion block.                            |
| `<symbol>` via `<use>`                                                     | Supported subset      | Numeric width/height plus viewBox and `none`/`meet`/`slice` mapping are exact with `overflow="visible"`. Percentage/auto sizes, implicit viewport clipping, and symbol-level positioning/transform/ref points block.       |
| Gradients                                                                  | Diagnostic flattening | 161 files; representative stop color is deterministic. Exact native gradients remain unavailable.                                                                                                                          |
| Full-canvas clip                                                           | Normalized            | 259 files; known 100×100 or exact root-viewBox rectangles are stripped only after clip-child display/visibility and axis-aligned edge topology are verified.                                                               |
| Real clip                                                                  | Native unsupported    | 26 files contain at least one non-canvas clip. Geometry stays in IR with clip IDs; native construction omits it visibly.                                                                                                   |
| Mask / filter / pattern / image                                            | Native unsupported    | 20 / 11 / 2 / 2 files; applied mask/filter attributes also block for missing or external URLs.                                                                                                                             |
| Adaptive flattening                                                        | Supported             | Cubics subdivide in output space; arcs use exact elliptical parameterization with the `M*h²/8` error bound. Default tolerance 0.5, max depth 18; limit exhaustion blocks.                                                  |
| Hole representation                                                        | Preserved decision    | Native keyhole closed lines remain selected; all measured counter centers stay transparent.                                                                                                                                |
| Triangulation                                                              | Preserved oracle      | True hole-eliminating triangulation remains the comparison oracle, not the default representation.                                                                                                                         |
| Determinism                                                                | Supported             | Node and Chromium checksums match for geometry and explicit UTF-16 code-unit diagnostic ordering, including non-ASCII paths.                                                                                               |
| Point budgets                                                              | Diagnostic only       | 256/element and 4,096/icon remain provisional. Representative default-tolerance maximum is 98/element; Linux is 31,888/icon.                                                                                               |

## Checked corpus summary

| Metric                                 |        Files |
| -------------------------------------- | -----------: |
| Corpus                                 |        1,412 |
| Native-capable at the Slice 1 boundary |        1,342 |
| Blocking capability diagnostic         |           70 |
| Clip path                              |          282 |
| Known full-canvas clip removed         |          259 |
| At least one real clip                 |           26 |
| Gradient                               |          161 |
| Style block                            |          130 |
| Unsupported advanced stroke semantics  |           16 |
| Mask / filter / use                    | 20 / 11 / 11 |
| Image / pattern / text                 |    2 / 2 / 0 |

Feature rows overlap; they must not be summed to derive the 70 unsupported
files. Counts are defined and asserted at the deduplicated file level.
