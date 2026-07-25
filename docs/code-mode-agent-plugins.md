# Sketchi Code Mode agent quickstart

Sketchi Code Mode gives an agent one remote MCP surface for typed flowcharts and
mindmaps, visual patches, and hosted Excalidraw and PNG artifacts.

The supported public endpoint is:

```text
https://playground.sketchi.app/mcp
```

Sketchi does not require a Sketchi account, API key, OAuth login, or local
browser. Your agent harness still uses its normal provider authentication. PNG
rendering happens in the deployed Studio Worker through Cloudflare Browser Run.

Codex and Claude Code have installable plugins in the public
`shpitdev/sketchi` marketplace. Agy and OpenCode use the portable skill plus
the public MCP endpoint; there is no separate Sketchi plugin distribution path
for those harnesses.

## Codex

### Install

```sh
codex plugin marketplace add shpitdev/sketchi
codex plugin add sketchi-code-mode-codex@sketchi-agent-plugins
```

### Verify

```sh
codex plugin list --json
codex mcp get sketchi-code-mode
```

The plugin list should show `sketchi-code-mode-codex@sketchi-agent-plugins` as
installed and enabled. The MCP details should show the public endpoint with
`transport: streamable_http` and `enabled: true`. Start a new Codex session
after installation so the skill and MCP tools are in the session inventory.

### Create the first diagram

Start `codex`, then send:

```text
$sketchi-code-mode Create a top-to-bottom flowchart for request intake, review, approval or revision, and completion. Return the hosted Excalidraw and PNG artifacts.
```

The skill discovers the current contract, calls the `execute` tool, and returns
the accepted artifact ID plus raw Excalidraw and PNG URLs.

## Claude Code

### Install

```sh
claude plugin marketplace add shpitdev/sketchi
claude plugin install sketchi-code-mode-claude@sketchi-agent-plugins
```

### Verify

```sh
claude plugin list --json
claude plugin details sketchi-code-mode-claude@sketchi-agent-plugins
```

The details should report one `sketchi-code-mode` skill and one
`sketchi-code-mode` MCP server. Start a new Claude Code session after
installation, or run `/reload-plugins` in an existing session.

### Create the first diagram

Start `claude`, then send:

```text
/sketchi-code-mode-claude:sketchi-code-mode Create a top-to-bottom flowchart for request intake, review, approval or revision, and completion. Return the hosted Excalidraw and PNG artifacts.
```

A successful result includes the accepted artifact ID plus raw Excalidraw and
PNG URLs.

## Agy (Google Antigravity)

### Install

Copy the portable skill into the project where Agy will run:

```sh
mkdir -p .agents/skills/sketchi-code-mode
curl -fsSL https://raw.githubusercontent.com/shpitdev/sketchi/main/.agents/skills/sketchi-code-mode/SKILL.md \
  -o .agents/skills/sketchi-code-mode/SKILL.md
```

Add this server to `.agents/mcp_config.json`, merging it with any existing
servers instead of overwriting them:

```json
{
  "mcpServers": {
    "sketchi-code-mode": {
      "serverUrl": "https://playground.sketchi.app/mcp"
    }
  }
}
```

### Verify

From the configured project, verify that the portable skill and public endpoint
are present:

```sh
test -f .agents/skills/sketchi-code-mode/SKILL.md
rg -n '"sketchi-code-mode"|"serverUrl": "https://playground\.sketchi\.app/mcp"' .agents/mcp_config.json
```

### Create the first diagram

Open that project in Antigravity, then send:

```text
Use the sketchi-code-mode skill to create a top-to-bottom flowchart for request intake, review, approval or revision, and completion. Return the hosted Excalidraw and PNG artifacts.
```

That is the supported Sketchi setup boundary for Agy. Model selection,
invocation flags, authentication, and harness behavior belong to Agy.

## OpenCode

### Install

Copy the portable skill into OpenCode's global skill directory and register the
remote MCP server:

```sh
SKETCHI_SKILL_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode/skills/sketchi-code-mode"
mkdir -p "$SKETCHI_SKILL_DIR"
curl -fsSL https://raw.githubusercontent.com/shpitdev/sketchi/main/.agents/skills/sketchi-code-mode/SKILL.md \
  -o "$SKETCHI_SKILL_DIR/SKILL.md"
opencode mcp add sketchi-code-mode --url https://playground.sketchi.app/mcp
```

### Verify

Restart OpenCode after changing its skills or MCP configuration, then run:

```sh
test -f "${XDG_CONFIG_HOME:-$HOME/.config}/opencode/skills/sketchi-code-mode/SKILL.md"
opencode mcp list
```

The MCP list should show `sketchi-code-mode` as connected.

### Create the first diagram

Start `opencode`, then send:

```text
Use the sketchi-code-mode skill to create a top-to-bottom flowchart for request intake, review, approval or revision, and completion. Return the hosted Excalidraw and PNG artifacts.
```

That is the supported Sketchi setup boundary for OpenCode; provider, model, and
harness behavior remain OpenCode concerns.

## Troubleshooting

- Codex installs plugins with `codex plugin add`, not `codex plugin install`.
- If a newly installed Claude Code plugin is missing from an existing session,
  run `/reload-plugins` or start a new session.
- If you installed the removed Agy plugin from an earlier checkout, clean up its
  stale registration once with
  `agy plugin uninstall sketchi-code-mode-antigravity`. The message
  `Uninstalled plugin "sketchi-code-mode-antigravity"` confirms the cleanup. Do
  not reinstall it; use the portable skill and `.agents/mcp_config.json` above.
- Do not run an MCP login command for Sketchi. The endpoint is public and the
  plugin MCP configs contain no credentials.
- Do not install Chrome, Playwright, or another browser for PNG output. Rendering
  is hosted by Sketchi.

## Maintainer validation

The distributable sources are:

- `.agents/plugins/marketplace.json` and
  `plugins/sketchi-code-mode-codex` for Codex;
- `.claude-plugin/marketplace.json` and
  `plugins/sketchi-code-mode-claude` for Claude Code;
- `.agents/skills/sketchi-code-mode/SKILL.md` and
  `.agents/mcp_config.json` for portable Agy and OpenCode setup.

Run the focused drift checks with:

```sh
pnpm test:onboarding
claude plugin validate .
claude plugin validate plugins/sketchi-code-mode-claude
```
