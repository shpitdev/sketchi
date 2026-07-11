# Code Mode Agent Plugins

This repo packages the deployed Sketchi Code Mode MCP server for Codex, Claude
Code, and Google Antigravity.

The MCP surface follows the Code Mode convention: agents call a single `execute`
tool with generated JavaScript, and typed Sketchi tools are available in the
sandbox as `sketchi.buildFlowchart`, `sketchi.buildMindmap`, `sketchi.applyDiagramPatch`, and
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

When the MCP `execute` wrapper returns `artifactDelivery`, agents should paste
`artifactDelivery.finalResponseText` as the final chat response and stop. It is
a compact summary of the accepted artifact id, diagram id, format refs, raw
Excalidraw URL, and raw PNG URL when available. This avoids low-reasoning
harnesses digging through nested inline scene or Excalidraw JSON and
accidentally creating Markdown/Mermaid/local wrapper artifacts.

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

## Google Antigravity

- Workspace MCP config: `.agents/mcp_config.json`
- Workspace skill: `.agents/skills/sketchi-code-mode/SKILL.md`
- Plugin: `plugins/sketchi-code-mode-antigravity`
- Plugin MCP config: `plugins/sketchi-code-mode-antigravity/mcp_config.json`
- Plugin skill: `plugins/sketchi-code-mode-antigravity/skills/sketchi-code-mode/SKILL.md`
- MCP server key: `sketchi-code-mode`

When `agy` is launched from this repository, Antigravity loads the workspace MCP
config and workspace skill. To install the reusable local plugin into a global
Antigravity CLI profile:

```sh
agy plugin install ./plugins/sketchi-code-mode-antigravity
```

Use fresh print-mode conversations for harness testing:

```sh
agy --print --dangerously-skip-permissions --model gemini-3.5-flash \
  'use sketchi-code-mode to go create me a diagram that showcases how the various packages in this repo interact'
```

Do not pass `--continue` for eval runs; each run should start from a fresh
conversation. If Agy prints an authentication URL, complete login before
interpreting the harness result.

## Harness Evals

### Manual Agy Scenario Capture TODO

Before building another eval framework, run a visible Agy/tmux capture pass and
promote the results into one Markdown report. The report should keep the minimum
fields that are useful for product decisions:

First tracked capture:
[Agy Code Mode Scenario Capture](evals/agy-code-mode-scenario-capture-2026-06-27.md).

| Field           | Notes                                                   |
| --------------- | ------------------------------------------------------- |
| Prompt          | Full user prompt given to Agy                           |
| Harness         | Usually `agy` for this pass                             |
| Model           | For example `gemini-3.5-flash`                          |
| Reasoning level | The configured harness reasoning setting, when visible  |
| JSON URL        | Raw hosted Excalidraw/scene artifact URL from Sketchi   |
| PNG URL         | Raw hosted PNG artifact URL from Sketchi                |
| Notes           | Short result summary, failure mode, or verification gap |

Use a scenario mix that exercises different complexity bands:

- simple linear flow;
- basic decision tree;
- nested decision workflow;
- retry/loop workflow;
- lifecycle or state-machine flow;
- incident escalation;
- actor handoff or swimlane-like flow;
- repo/package architecture;
- dense 10-15 node business process;
- vague product/architecture request where the harness must infer structure.

Keep this pass intentionally lightweight: verify that the JSON and PNG URLs load,
capture obvious semantic or artifact failures, and do not add new eval tooling
until the example set shows which checks matter.

Use the harness eval runner to measure whether an external agent can create
correct Code Mode artifacts through the deployed MCP server. The runner launches
the selected harness, injects the no-auth public MCP config, asks the agent to
call `sketchi.buildFlowchart`, then grades the returned `normalizedSpec` with
the maintained diagram scenarios.

```sh
pnpm eval:harness -- --harness opencode --model opencode-go/kimi-k2.7-code --all \
  --report-out .memory/harness-evals/opencode-kimi27-all/report.json \
  --candidate-out-dir .memory/harness-evals/opencode-kimi27-all \
  --events-out-dir .memory/harness-evals/opencode-kimi27-all
```

```sh
pnpm eval:harness -- --harness claude --scenario sketchi-onboarding-decision-flow \
  --report-out .memory/harness-evals/claude-smoke/report.json \
  --candidate-out-dir .memory/harness-evals/claude-smoke \
  --events-out-dir .memory/harness-evals/claude-smoke
```

```sh
pnpm eval:harness -- --harness antigravity --model gemini-3.5-flash \
  --scenario repo-package-interaction-flow --repeat 3 \
  --report-out .memory/harness-evals/antigravity-flash35-repo/report.json \
  --candidate-out-dir .memory/harness-evals/antigravity-flash35-repo \
  --events-out-dir .memory/harness-evals/antigravity-flash35-repo
```

Reports include semantic scenario checks, Excalidraw validation issues, MCP tool
call counts, raw harness event paths, candidate JSON paths, duration, cost, and
token buckets when the harness exposes them. Antigravity reports also include
the latest conversation transcript path when the CLI exposes one through its
local brain cache. For Agy TUI runs where `--print` auth is unavailable, replay
an existing local brain transcript without launching Agy:

```sh
pnpm eval:harness -- --harness antigravity --scenario repo-package-interaction-flow \
  --antigravity-conversation-id <conversation-id> \
  --delivery-only \
  --report-out .memory/harness-evals/antigravity-replay/report.json \
  --candidate-out-dir .memory/harness-evals/antigravity-replay \
  --events-out-dir .memory/harness-evals/antigravity-replay
```

The replay mode fails the run if Antigravity created wrapper files such as
`diagram_info.md`, local PNG/SVG/JSON exports, or other non-MCP artifacts after
Sketchi accepted an artifact.

## Endpoint

Both plugins currently point at:

```text
https://sketchi-studio.dimethyl.workers.dev/mcp
```

The custom `studio.sketchi.app/mcp` endpoint was not attached when these plugin packages were created, so the Workers URL is the verified production endpoint.
