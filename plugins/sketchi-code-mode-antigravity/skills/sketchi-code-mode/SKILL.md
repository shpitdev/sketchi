---
name: sketchi-code-mode
description: Use when the user asks for sketchi-code-mode, Sketchi MCP, Sketchi Code Mode, or a Sketchi/Excalidraw diagram through MCP tools.
---

# Sketchi Code Mode

Use the bundled `sketchi-code-mode` MCP server for Sketchi diagrams instead of raw Excalidraw, Mermaid, ad hoc JSON edits, local repo scripts, or Markdown report artifacts.

## Required Flow

1. If syntax is unclear, call `sketchi-code-mode/docs` or `sketchi-code-mode/search`.
2. Call `sketchi-code-mode/execute` with an async JavaScript arrow function.
3. Inside the function, use `sketchi.buildFlowchart`, then `sketchi.applyDiagramPatch` only for styling or supported visual edits.
4. Request user-facing artifacts:

```js
options: {
  artifactFormats: ["scene", "excalidraw", "png"],
  inlineArtifacts: ["excalidraw"],
}
```

5. Prefer the `artifactDelivery` object from the execute result when present. It already contains the accepted artifact id, diagram id, format refs, and raw Excalidraw/PNG URLs.
6. Return the accepted Sketchi artifact id, diagram id, artifact format refs, and the Excalidraw/PNG raw URLs directly in the chat response.

## Guardrails

- Do not create or edit repo files unless the user explicitly asks for files.
- Do not call `write_to_file`, create an Antigravity artifact, or create a Markdown wrapper such as `diagram_info.md` after Sketchi accepts an artifact. The final chat response with the Sketchi artifact ids and URLs is the deliverable.
- Do not write a Markdown/Mermaid summary as the deliverable after Sketchi accepts an artifact.
- `scene` is for patching and debugging only. `excalidraw` and `png` are the user-facing outputs.
- If local repo context is needed, inspect files only to understand the graph, then send the final graph to the MCP execute tool.
- If PNG export fails with a hosted renderer error, retry the hosted MCP request once. If it still fails, return the Excalidraw URL and clearly say PNG export is unavailable. Do not fall back to local rendering or remove PNG silently.
