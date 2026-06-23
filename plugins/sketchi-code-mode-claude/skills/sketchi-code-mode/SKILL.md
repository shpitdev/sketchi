---
name: sketchi-code-mode
description: Use Sketchi Code Mode when creating, editing, styling, or retrieving Sketchi flowchart diagrams through the Sketchi MCP server.
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
3. Build or rebuild structure with `sketchi.buildFlowchart(input)`.
4. Apply non-structural visual edits with `sketchi.applyDiagramPatch(input)`.
5. Retrieve proof or output with `sketchi.getArtifact(input)`.

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
    options: { inlineArtifacts: ["scene"] },
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

  const png = await sketchi.getArtifact({
    artifactId: patched.artifact.artifactId,
    format: "png",
    inline: false,
  });

  return { patched, png };
}
```

To view the PNG bytes after `execute` returns metadata, fetch:

```text
https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/<artifactId>?format=png&raw=true
```

## Guardrails

- Keep IDs stable and readable.
- Express the real workflow semantics. Fan-in, reused outcomes, and loop/back-edge cases are acceptable when they describe the process; Sketchi owns deterministic placement and routing for export.
- Prefer typed graph generation for adding, removing, or reconnecting nodes.
- Use patching for style, layout hints, labels, and metadata only when the docs show support.
- If export reports `arrow_overlap`, keep the semantic graph intact unless the structure is actually wrong. Retry with `rerouteEdges` or report the artifact evidence rather than contorting the workflow solely for layout.
- Pass the function expression itself. `async () => { ... }` is canonical; outer markdown fences and a trailing semicolon are tolerated by the server, but omit them in generated code.
- Return the MCP result or artifact metadata so the caller has evidence.
- Request `artifactFormats: ["scene", "excalidraw", "png"]` when visual proof matters. PNG is hosted binary evidence; `sketchi.getArtifact({ format: "png", inline: false })` returns metadata, then fetch the raw Studio API URL outside `execute` for bytes.
- Do not install or require a local browser for plugin use; the deployed Studio Worker renders PNG artifacts through Cloudflare Browser Run.
- Do not pass secrets or credentials into `execute`.
- Do not treat the deployed Workers MCP endpoint as a private boundary; it is a tool surface for Code Mode operations.
