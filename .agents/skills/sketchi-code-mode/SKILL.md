---
name: sketchi-code-mode
description: Use when the user asks for sketchi-code-mode, Sketchi MCP, Sketchi Code Mode, or a Sketchi/Excalidraw diagram through MCP tools.
---

# Sketchi Code Mode

When the user asks to use `sketchi-code-mode`, use the configured MCP server tools. Do not replace the MCP flow with local repo scripts, in-process test harnesses, raw Mermaid, hand-written Excalidraw JSON, or Markdown reports.

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

5. If the MCP text content begins with `Sketchi artifact ready.`, paste that first text block as the final chat response and stop.
6. If the execute result contains `artifactDelivery.finalResponseText`, paste that text as the final chat response and stop.
7. Otherwise return the accepted Sketchi artifact id, diagram id, artifact format refs, and the Excalidraw/PNG raw URLs directly in the chat response.

## Guardrails

- Do not create or edit repo files unless the user explicitly asks for files.
- Do not call `write_to_file`, create an Antigravity artifact, inspect nested inline Excalidraw JSON, or create a Markdown wrapper such as `diagram_info.md` after Sketchi accepts an artifact. The final chat response with the Sketchi artifact ids and URLs is the deliverable.
- Do not write a Markdown/Mermaid summary as the deliverable after Sketchi accepts an artifact.
- Do not call `sketchi.getArtifact({ format: "scene" })` just to create a local summary or wrapper. `scene` is only for patching/debugging, and the accepted artifact bundle is already the deliverable.
- `scene` is for patching and debugging only. `excalidraw` and `png` are the user-facing outputs.
- If local repo context is needed, inspect files only to understand the graph, then send the final graph to the MCP execute tool.
- For vague repo/system architecture prompts, summarize into a readable 8-14 node flowchart. Prefer a mostly monotonic spine with short side branches; group related packages/systems into layers instead of drawing every transitive dependency edge.
- If PNG export fails with a hosted renderer error, retry the hosted MCP request once. If it still fails, return the Excalidraw URL and clearly say PNG export is unavailable. Do not fall back to local rendering or remove PNG silently.
