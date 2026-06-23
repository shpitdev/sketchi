# Code Mode Agent Plugins

This repo packages the deployed Sketchi Code Mode MCP server for Codex and Claude Code.

The MCP surface follows the Code Mode convention: agents call a single `execute`
tool with generated JavaScript, and typed Sketchi tools are available in the
sandbox as `sketchi.buildFlowchart`, `sketchi.applyDiagramPatch`, and
`sketchi.getArtifact`. The server normalizes outer code fences and trailing
expression semicolons before execution, but examples intentionally omit those
wrappers so copied snippets are canonical function expressions.

For visual proof, agents should request `artifactFormats: ["scene",
"excalidraw", "png"]` and then call `sketchi.getArtifact({ format: "png",
inline: false })` for metadata. To view bytes, fetch
`https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/<artifactId>?format=png&raw=true`
outside `execute`. PNG bytes are hosted by the Studio Worker and rendered
through Cloudflare Browser Run; plugin users should not need to install local
browser binaries.

For complex diagrams that need PNG proof, agents should provide semantic graph
intent: stable node IDs, labeled decision branches, and edges that match the
real workflow. Fan-in, reused outcomes, and loop/back-edge cases are acceptable
when they describe the process. Sketchi owns deterministic layout and routing;
do not reshape a correct workflow solely to make the graph layout-friendly. If
`arrow_overlap` appears, retry with `rerouteEdges` or preserve the artifact
evidence for product repair unless the semantic structure itself is wrong.

## Codex

- Marketplace: `.agents/plugins/marketplace.json`
- Plugin: `plugins/sketchi-code-mode-codex`
- Skill: `plugins/sketchi-code-mode-codex/skills/sketchi-code-mode`
- MCP server key: `sketchi-code-mode`

The Codex skill includes `agents/openai.yaml` with UI metadata, bundled icon assets, and a `streamable_http` MCP dependency.

## Claude Code

- Marketplace: `.claude-plugin/marketplace.json`
- Plugin: `plugins/sketchi-code-mode-claude`
- Skill: `plugins/sketchi-code-mode-claude/skills/sketchi-code-mode`
- MCP server key: `sketchi-code-mode`

Claude Code loads the skill as `/sketchi-code-mode-claude:sketchi-code-mode` after plugin installation. Its `allowed-tools` list uses Claude's plugin MCP namespace for `docs`, `search`, and `execute`.

## Endpoint

Both plugins currently point at:

```text
https://sketchi-studio.dimethyl.workers.dev/mcp
```

The custom `studio.sketchi.app/mcp` endpoint was not attached when these plugin packages were created, so the Workers URL is the verified production endpoint.
