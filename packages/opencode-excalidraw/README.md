# @sketchi-app/opencode-excalidraw

OpenCode plugin for generating and manipulating Excalidraw diagrams via Sketchi.

## Quickstart

1. Add the plugin to your `opencode.jsonc`:

```jsonc
{
  "plugins": ["@sketchi-app/opencode-excalidraw"]
}
```

2. Install the package:

```bash
npm i @sketchi-app/opencode-excalidraw
```

3. Install Playwright browsers once per machine (required for `diagram_to_png`):

```bash
npx playwright install
```

## Usage

The plugin exposes tools:

- `diagram_from_prompt`
- `diagram_tweak`
- `diagram_restructure`
- `diagram_to_png`
- `diagram_grade`

When this plugin is loaded, it registers a `sketchi-diagram` subagent (without disabling built-in `build`/`plan`) and injects routing guidance so diagram requests route to `diagram_*` tools instead of defaulting to Mermaid (unless Mermaid is explicitly requested).

## Configuration

Optional env override:

- `SKETCHI_API_URL` (defaults to `https://sketchi.app`)

## Testing

- Fast package tests: `bun run test`
- Optional live integration scenario (calls Sketchi API and renders PNG): `bun run test:integration`

## Links

- npm: https://www.npmjs.com/package/@sketchi-app/opencode-excalidraw
- GitHub: https://github.com/anand-testcompare/sketchi/tree/main/packages/opencode-excalidraw
