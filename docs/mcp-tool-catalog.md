# Sketchi Code Mode API

Agents reach Sketchi through one MCP server, `sketchi-code-mode`, at
`https://playground.sketchi.app/mcp` (Streamable HTTP, no account or key). The
server describes its own contract, so this page says where that contract lives
rather than repeating it.

## Tools

| Tool      | What it does                                                                                                                                  |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `execute` | Runs one async JavaScript arrow function against the typed `sketchi` client and returns its result, with `artifactDelivery` for an accepted artifact. |
| `docs`    | Returns one topic: a builder or helper (`buildGantt`, `editFlowchart`), or `overview`, `examples`, `issues`, `patchOperations`.               |
| `search`  | Finds documentation entries by keyword.                                                                                                       |

The `execute` description lists every builder and helper, and its `code`
parameter carries each builder's spec and rules, so most first builds need no
`docs` call. Only `createCanvas` asks for its topic first.

## Where the contract lives

- `apps/playground/src/server/codemode/mcp-docs/catalog.ts`: the tool
  descriptions, docs topics and search entries. The shared drawing rules come
  from `packages/diagram/core/src/rules`, which the generate prompt reads too.
- `apps/playground/src/server/codemode/mcp-docs/code-mode-types.generated.txt`:
  TypeScript declarations for every operation's request and result, generated
  from the package schemas. A test fails when it falls out of date.
- [CanvasSpec v1](canvas-spec.md): the scene format `createCanvas` takes and
  every builder produces.

## Results

A build or edit resolves to `{ ok: true, artifact, … }` or to
`{ ok: false, status, issues: [{ code, message, hint }] }`. Each issue's `hint`
says how to fix the spec; `docs({ topic: "issues" })` lists every code,
including the size limits. An accepted build stores scene, Excalidraw and PNG
artifacts, which `getArtifact` reads and
`https://playground.sketchi.app/api/v1/artifacts/<artifactId>?format=excalidraw&raw=true`
serves (`format=png` or `scene` for the others). `execute` adds
`artifactDelivery.finalResponseText`, the text an agent should give as its
answer.

A flowchart changes through `editFlowchart`, which stores a new artifact; any
other diagram through `applyDiagramPatch`. The same builders, `editFlowchart`,
patches, canvases and generation are also HTTP endpoints under
`https://playground.sketchi.app/api/v1/`, such as `flowcharts/build`.
