---
name: sketchi-code-mode
description: Use Sketchi Code Mode when creating, editing, styling, or retrieving Sketchi flowchart diagrams through the Sketchi MCP server.
allowed-tools:
  - mcp__plugin_sketchi-code-mode-claude_sketchi-code-mode__docs
  - mcp__plugin_sketchi-code-mode-claude_sketchi-code-mode__search
  - mcp__plugin_sketchi-code-mode-claude_sketchi-code-mode__execute
---

# Sketchi Code Mode

Use the bundled `sketchi-code-mode` MCP server for Sketchi diagrams instead of raw Excalidraw or ad hoc JSON edits.

## Workflow

1. Call `docs` or `search` first when you need the current contract for graph input, patch input, artifact retrieval, or supported style fields.
2. Use `execute` with an async JavaScript arrow function.
3. Build or rebuild structure with `sketchi.buildFlowchart(input)`.
4. Apply non-structural visual edits with `sketchi.applyDiagramPatch(input)`.
5. Retrieve proof or output with `sketchi.getArtifact(input)`.

## Execute Shape

```js
async () => {
  const built = await sketchi.buildFlowchart({
    title: "Example",
    nodes: [
      { id: "start", label: "Start" },
      { id: "done", label: "Done" }
    ],
    edges: [
      { from: "start", to: "done", label: "next" }
    ]
  });

  return built;
}
```

## Guardrails

- Keep IDs stable and readable.
- Prefer typed graph generation for adding, removing, or reconnecting nodes.
- Use patching for style, layout hints, labels, and metadata only when the docs show support.
- Return the MCP result or artifact metadata so the caller has evidence.
- Do not pass secrets or credentials into `execute`.
- Do not treat the deployed Workers MCP endpoint as a private boundary; it is a tool surface for Code Mode operations.
