# Product Roadmap Backlog

These notes preserve product follow-ups that have not yet been promoted to
GitHub issues. They are not the active Agy layout RCA loop, but they should
remain visible when the layout work is healthy enough to move on.

## 1. Product UI/UX Readiness

Goal: keep the current app surfaces production-ready as Sketchi evolves.

Scope:

- Review `web`, `studio`, `excalidraw`, `icons`, and `playground` as product
  surfaces, not scaffolds.
- Keep billing out of scope. Auth and durable user persistence are only in scope
  when they are explicitly reopened by the product migration plan.
- Use real browser proof on desktop and mobile.
- Preserve app-local UI ownership unless a component is genuinely shared.
- Keep Storybook/test coverage for app components.

Done when:

- The public web surface clearly explains the product and links to the real app
  surfaces.
- The Excalidraw workspace feels like the beginning of the product app, not a
  demo canvas.
- The icon surface is fast to search, inspect, copy, and download from copied
  output assets.
- Production `workers.dev` surfaces remain reliable pre-cutover and rollback
  proof endpoints.

## 2. Broader Diagram And Excalidraw Element Support

Goal: expand beyond the current flowchart-first surface toward the useful set
of Excalidraw-native diagram shapes and chart-like structures.

Scope:

- Keep flowchart reliability high while adding new diagram contracts.
- Add diagram types through the workspace generator so each type has core,
  renderer, test, and Storybook coverage.
- Prefer semantic contracts over raw Excalidraw editing.
- Support the important Excalidraw element families in a typed way: shapes,
  connectors, text, arrows, groups, frames, images, and libraries where they
  belong.
- Inventory the Excalidraw affordances that map cleanly to product-level
  diagram contracts, then add them incrementally without weakening the
  flowchart path.

Done when:

- Agents can request multiple diagram families without switching to Mermaid,
  raw Excalidraw JSON, or manual coordinate editing.
- Each added diagram type has deterministic fixture coverage and visual
  Storybook coverage.
- The public Code Mode contract stays product-level instead of exposing internal
  renderer operations.

## 3. Link Converted Assets Back To Source Outputs

Goal: make generated Excalidraw/PNG/SVG-style artifacts traceable and usable
across harnesses and app surfaces.

Scope:

- Preserve source artifact references across scene, Excalidraw, PNG, and future
  SVG/export formats.
- Expose stable URLs and metadata for each generated format.
- Keep raw bytes hosted by Sketchi, not by harness-local files.
- Let app surfaces link to, preview, and inspect generated artifacts without
  re-running generation.
- Treat converted Excalidraw output as a first-class artifact reference, not a
  nested payload that only the harness can see.

Landed:

- Patched artifact manifests and bundles persist
  `provenance.sourceArtifactId`; `getArtifact` returns that typed reference for
  scene, Excalidraw, and PNG retrieval.
- Studio artifact review exposes a source-artifact link for derived artifacts.
- Root build artifacts omit provenance instead of manufacturing a source.

Done when:

- A harness final response can link to every useful generated format.
- A product UI can open the same artifact by id and inspect source metadata.
- Converted outputs remain associated with the accepted Sketchi artifact rather
  than becoming disconnected local files.

## 4. Post-cutover hardening

Goal: keep the canonical architecture coherent after the one-shot replacement.

Scope:

- Keep this repository clean and testable.
- Avoid parallel obsolete rendering systems.
- Document cutover blockers as they are removed.
- Keep DNS attachment operator-gated and defer authenticated Studio until it is
  deliberately launched.

Done when:

- Generation, app surfaces, and production Worker proof remain reliable.
- Retired approaches do not return as compatibility baggage.
