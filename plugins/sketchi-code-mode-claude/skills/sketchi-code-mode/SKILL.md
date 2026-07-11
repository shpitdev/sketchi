---
name: sketchi-code-mode
description: Use Sketchi Code Mode when creating, editing, styling, or retrieving Sketchi flowchart or mindmap diagrams through the Sketchi MCP server.
allowed-tools:
  - mcp__plugin_sketchi-code-mode-claude_sketchi-code-mode__docs
  - mcp__plugin_sketchi-code-mode-claude_sketchi-code-mode__search
  - mcp__plugin_sketchi-code-mode-claude_sketchi-code-mode__execute
---

# Sketchi Code Mode

Use the bundled `sketchi-code-mode` MCP server for Sketchi diagrams instead of raw Excalidraw or ad hoc JSON edits. This follows the Code Mode pattern: call one `execute` tool with generated JavaScript, and use typed host tools exposed inside the sandbox as `sketchi.*`.

## Workflow

1. Call `docs` or `search` first when you need the current contract for graph input, patch input, artifact retrieval, or supported style fields.
2. Use `execute` with an async JavaScript arrow function expression.
3. Build structure with `sketchi.buildFlowchart(input)` for process graphs or `sketchi.buildMindmap(input)` for nested topic hierarchies.
4. Apply non-structural visual edits with `sketchi.applyDiagramPatch(input)`.
5. Only retrieve proof or output with `sketchi.getArtifact(input)` when you need raw Excalidraw/PNG metadata; do not fetch `scene` just to summarize the diagram.
6. If the MCP text content begins with `Sketchi artifact ready.`, paste that first text block as the final chat response and stop.
7. If the execute result contains `artifactDelivery.finalResponseText`, paste that text as the final chat response and stop.
8. Otherwise return the accepted Sketchi artifact id, format refs, and Excalidraw/PNG URLs. Do not recreate the accepted diagram as a Markdown or Mermaid artifact.

## Execute Shape

```text
async () => {
  const built = await sketchi.buildFlowchart({
    spec: {
      title: "Approval flow",
      nodes: [
        { id: "request", label: "Request", kind: "start" },
        { id: "approved", label: "Approved?", kind: "decision" },
        { id: "done", label: "Done", kind: "end" },
        { id: "revise", label: "Revise", kind: "end" },
      ],
      edges: [
        { source: "request", target: "approved" },
        { source: "approved", target: "done", label: "yes" },
        { source: "approved", target: "revise", label: "no" },
      ],
      layout: { direction: "TB" },
    },
    options: {
      artifactFormats: ["scene", "excalidraw", "png"],
      inlineArtifacts: ["excalidraw"],
    },
  });

  if (!built.ok) return built;

  const patched = await sketchi.applyDiagramPatch({
    source: { artifactId: built.artifact.artifactId },
    intent: "Make the decision node a purple diamond.",
    operations: [
      {
        op: "setStyle",
        selector: { nodeIds: ["approved"] },
        style: { strokeColor: "#7c3aed", fillColor: "#ede9fe" },
      },
      {
        op: "setShape",
        selector: { nodeIds: ["approved"] },
        shape: "diamond",
      },
    ],
    options: {
      artifactFormats: ["scene", "excalidraw", "png"],
      inlineArtifacts: ["scene", "excalidraw"],
    },
  });

  if (!patched.ok) return patched;

  const excalidraw = await sketchi.getArtifact({
    artifactId: patched.artifact.artifactId,
    format: "excalidraw",
    inline: false,
  });
  const png = await sketchi.getArtifact({
    artifactId: patched.artifact.artifactId,
    format: "png",
    inline: false,
  });

  return {
    ok: true,
    artifactId: patched.artifact.artifactId,
    diagramId: patched.artifact.diagramId,
    formats: patched.artifact.formats,
    excalidraw,
    png,
  };
}
```

To view the artifact bytes after `execute` returns metadata, fetch:

```text
https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/<artifactId>?format=excalidraw&raw=true
https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/<artifactId>?format=png&raw=true
```

## Guardrails

- Keep IDs stable and readable.
- Express the real workflow semantics, but keep export readability in mind. For broad repo/system prompts, summarize into a readable 8-14 node flowchart with a mostly monotonic spine and short side branches.
- Group related packages/systems into layers instead of drawing every transitive dependency edge. Prefer labels/descriptions for nuance over dense cross-links.
- Prefer typed graph generation for adding, removing, or reconnecting nodes.
- Use patching for style, layout hints, labels, and metadata only when the docs show support.
- If export reports `arrow_overlap`, keep the semantic graph intact unless the structure is actually wrong. Retry with `rerouteEdges` or report the artifact evidence rather than contorting the workflow solely for layout.
- Pass the function expression itself. `async () => { ... }` is canonical; outer markdown fences and a trailing semicolon are tolerated by the server, but omit them in generated code.
- Return the MCP result or artifact metadata so the caller has evidence. Do not make a separate Markdown/Mermaid diagram after Sketchi accepts an artifact.
- Do not call `sketchi.getArtifact({ format: "scene" })` just to create a local summary or wrapper. `scene` is only for patching/debugging, and the accepted artifact bundle is already the deliverable.
- When the execute tool returns `artifactDelivery.finalResponseText`, paste that string as the final response instead of digging through nested inline scene or Excalidraw JSON.
- Request `artifactFormats: ["scene", "excalidraw", "png"]` when visual proof matters. Excalidraw is importable JSON; PNG is hosted binary evidence. `sketchi.getArtifact({ format: "excalidraw" | "png", inline: false })` returns metadata with raw Studio API URLs.
- Do not install or require a local browser for plugin use; the deployed Studio Worker renders PNG artifacts through Cloudflare Browser Run.
- Do not pass secrets or credentials into `execute`.
- Do not treat the deployed Workers MCP endpoint as a private boundary; it is a tool surface for Code Mode operations.
