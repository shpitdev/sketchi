---
name: sketchi-code-mode
description: Use Sketchi Code Mode when creating, editing, styling, or retrieving Sketchi flowchart diagrams through the Sketchi MCP server.
---

# Sketchi Code Mode

Use the `sketchi-code-mode` MCP server for Sketchi diagrams instead of raw Excalidraw or ad hoc JSON edits. This follows the Code Mode pattern: call one `execute` tool with generated JavaScript, and use typed host tools exposed inside the sandbox as `sketchi.*`.

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
    options: { inlineArtifacts: ["scene", "excalidraw"] },
  });

  if (!patched.ok) return patched;

  return patched;
}
```

## Guardrails

- Keep IDs stable and readable.
- Prefer typed graph generation for adding, removing, or reconnecting nodes.
- Use patching for style, layout hints, labels, and metadata only when the docs show support.
- Pass the function expression itself. `async () => { ... }` is canonical; outer markdown fences and a trailing semicolon are tolerated by the server, but omit them in generated code.
- Return the MCP result or artifact metadata so the caller has evidence.
- Do not pass secrets or credentials into `execute`.
- Do not treat the deployed Workers MCP endpoint as a private boundary; it is a tool surface for Code Mode operations.
