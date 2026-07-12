# SVG → Excalidraw Slice 0 support matrix

Checked against `@excalidraw/excalidraw@0.18.1`. The renderer matrix and budget
numbers are asserted against
`packages/svg-excalidraw/evidence/fill-spike-metrics.json` in the package tests.

| Case                             | Corpus fixture                      | Native Slice 0 result          | Evidence / limitation                                                                                                                                                                      |
| -------------------------------- | ----------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Actual counter / hole            | `ai-model-providers/ai21labsai.svg` | ✅ Keyhole selected            | SVG implicit closure is honored. Counter center stayed transparent across roughness 0/1/2 × solid/hachure. Keyhole: 4 elements / 287 points; triangulation: 275 / 1,100.                   |
| Fill-rule winding                | Inline nested contours              | ✅ Supported for spike subset  | `evenodd` alternates by nesting. Nested/disjoint `nonzero` contours accumulate winding; intersecting or self-intersecting nonzero contours produce an unsupported diagnostic.              |
| Multicolor                       | `ai-infrastructure/vllm.svg`        | ✅ Supported                   | Direct `#FDB515` and `#30A2FF` paints remain separate native elements.                                                                                                                     |
| Gradient                         | `programming-languages/kotlin.svg`  | ⚠️ Diagnostic flattening only  | Radial gradient is detected and deterministically flattened to representative `#d211ec`; exact native gradients do not exist.                                                              |
| Style-driven paint               | `gcp-legacy/cloud-router.svg`       | ✅ Supported for spike subset  | `.cls-1 { fill: #4285f4 }` resolves into canonical paint. Full CSS cascade is later work.                                                                                                  |
| Real clip                        | `ai-ecosystem/jimeng.svg`           | ⛔ Native unsupported          | Path clips are detected and omitted from native output. Boolean clipping alone would still leave rings; later work must intersect and then eliminate holes.                                |
| Stroke-only                      | `gcp-legacy/connectivity-test.svg`  | ✅ Supported                   | Two polylines become transparent-background native lines; `stroke-width="2"` under `scale(23.97)` becomes `47.94` scene units. Non-uniform transforms remain an approximation.             |
| Open fill plus distinct stroke   | Inline open path                    | ✅ Separated                   | Fill geometry is implicitly closed with a minimal fill-colored carrier stroke; the source-colored stroke remains an independent open native line, so no synthetic closing edge is stroked. |
| v1 disjoint multipath regression | `operating-systems/windows11.svg`   | ✅ Fixed                       | Four real corpus `M` subpaths become four elements; there is no synthetic connector stroke.                                                                                                |
| Implicit fill closure / stress   | `operating-systems/linux.svg`       | ⚠️ Above provisional threshold | 1,584 open-only filled shapes are now retained. The 474,098-byte / 1,716-path fixture constructs 92,105 points and triggers the provisional 4,096-point diagnostic threshold.              |
| Closed-line fill                 | Generated closed rectangle          | ✅ Supported                   | Real Excalidraw export filled repeated-first-point lines for roughness 0/1/2 × solid/hachure; all six outputs were distinct.                                                               |
| Construction determinism         | vLLM corpus fixture                 | ✅ Supported                   | Node and real Chromium runs both produce checksum `6977f090`; repeated construction is byte-identical.                                                                                     |
| Curved-line sparsity             | Measured circles at 16/32/64 points | ⚠️ Not beneficial              | `roundness: { type: 2 }` had lower IoU than sharp lines at every measured tier, so sharp is the default.                                                                                   |

## Decision summary

- Representation: deterministic hand-built closed `line` elements.
- Hole strategy: keyhole bridges; true triangulation retained as the oracle.
- Provisional diagnostic thresholds: 256 points per element and 4,096 points
  per icon. The synthetic circle matrix establishes output-cost behavior but is
  not representative enough to justify production hard caps.
- Fill modes proven: solid and hachure at roughness 0, 1, and 2.
- Go: Slice 1 IR and diagnostics, including representative budget research.
- No-go: production rejection or simplification at the provisional thresholds.
- No-go: product UI or full native-corpus claims.
