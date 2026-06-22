# Code Mode Agent Plugins

This repo packages the deployed Sketchi Code Mode MCP server for Codex and Claude Code.

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
