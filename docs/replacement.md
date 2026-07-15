# One-shot repository replacement

This repository is the canonical Sketchi product source. The former clean-start
lab is historical; its final source snapshot was commit
`a8172fe3aa0ba3108806b2a6edcb37a1e07c191c` and is represented here directly,
not consumed as a fork, submodule, compatibility package, or parallel build.

## Retained target-repository artifacts

- `LICENSE` is retained byte-for-byte because the MIT grant, copyright owner,
  and repository distribution terms still apply.
- The `shpitdev/sketchi` GitHub repository identity, issue/discussion history,
  tags, and historical releases remain in place because a pull request replaces
  the tree without rewriting public repository history.

No other legacy source artifact is retained. The migration integrity test fails
if the retired Next.js/Convex/Vercel/Bun/Turborepo roots, legacy release
workflows, or their parallel package boundaries return.

## Deliberately retired contracts

- The old Next.js web app, Convex backend, WorkOS integration, Vercel deploy
  configuration, Bun/Turborepo workspace, Stagehand/Venom suites, and Sentry
  wiring are deleted. The current Nx packages and Cloudflare Worker apps replace
  those runtime and build boundaries.
- The source and release workflows for the published
  `@sketchi-app/opencode-excalidraw` package are deleted. Version `0.0.10`
  remains an immutable historical npm artifact, but it depends on the retired
  authenticated API and local Playwright rendering path. OpenCode now uses the
  portable `sketchi-code-mode` skill plus the public MCP endpoint documented in
  [the agent quickstart](code-mode-agent-plugins.md); maintaining both paths
  would preserve a false compatibility contract.
- Historical GitHub releases and tags remain readable but are not continued by
  the new tree. Worker deployments and agent-plugin manifests are the active
  distribution surfaces.

## Integrity proof

`pnpm run test:deploy-scripts` includes the cutover guard. It checks the retired
root/workflow denylist, canonical repository identifiers, the exact public
domain mapping, and the absence of production domains from checked-in Wrangler
configs.
