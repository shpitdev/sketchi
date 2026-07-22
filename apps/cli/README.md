<p align="center">
  <img src="https://sketchi.app/icon.svg" alt="Sketchi" width="112" height="112" />
</p>

<h1 align="center">Sketchi CLI</h1>

<p align="center">
  <strong>Typed, deterministic diagrams from your terminal.</strong><br />
  Create, inspect, revise, and export local flowcharts and mindmaps—or turn one prompt into validated, editable Excalidraw.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/sketchi"><img alt="npm version" src="https://img.shields.io/npm/v/sketchi?logo=npm&color=CB3837" /></a>
  <a href="https://sketchi.app/"><img alt="Sketchi website" src="https://img.shields.io/badge/sketchi.app-live-765264" /></a>
  <a href="https://github.com/shpitdev/sketchi/blob/main/LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-2F855A" /></a>
</p>

Sketchi stores canonical diagram documents and deterministic Excalidraw artifacts
under `~/.sketchi/diagrams`. Its manual workflow stays local; generation is one
explicit, credential-free network command.

## Install

Use the noninteractive installer to install the npm package and configure
completions for a detected Zsh, Bash, or Fish shell:

```sh
curl -fsSL https://raw.githubusercontent.com/shpitdev/sketchi/main/install.sh | sh
```

Or install directly from npm:

```sh
npm install -g sketchi
sketchi --version
```

Sketchi requires Node.js 24.13.0 or newer.

## Create and work with a diagram

Create a canonical flowchart from inline JSON:

```sh
sketchi create --json '{"type":"flowchart","spec":{"id":"release-flow","title":"Release approval","nodes":[{"id":"start","label":"Change proposed","kind":"start"},{"id":"review","label":"Review evidence","kind":"process"},{"id":"end","label":"Release approved","kind":"end"}],"edges":[{"source":"start","target":"review"},{"source":"review","target":"end"}]}}'
```

Inspect it, replace it with another complete canonical document, and list the
local store:

```sh
sketchi show release-flow

sketchi edit release-flow --json '{"type":"flowchart","spec":{"id":"release-flow","title":"Release approval revised","nodes":[{"id":"start","label":"Change proposed","kind":"start"},{"id":"review","label":"Review complete evidence","kind":"process"},{"id":"end","label":"Release approved","kind":"end"}],"edges":[{"source":"start","target":"review"},{"source":"review","target":"end"}]}}'

sketchi list
```

Export the stored editable artifact:

```sh
sketchi export release-flow --format excalidraw --dest release-flow.excalidraw
```

Or render a PNG directly from the stored scene and Excalidraw artifacts:

```sh
sketchi export release-flow --format png --dest release-flow.png
```

PNG rendering is deterministic and fully local. Sketchi uses Excalidraw's
headless SVG exporter, bundled Excalifont files, and a bundled WASM rasterizer;
it does not start a browser or use the network. The rendered image is
export-only and is not added to the diagram record, while a pre-existing
`diagram.png` remains the fast path.

Every command also supports `--output json` for a stable machine-readable
result envelope. Export status always uses stderr. `export --dest -` writes
only artifact bytes to stdout; a PNG file export also includes one generic
inline-Markdown display hint for calling agents. Its destination is enclosed
in CommonMark angle brackets so local paths containing spaces remain valid.

## Generate from a prompt

`generate` sends one prompt to Sketchi's public generation API, validates the
result server-side, and commits the same local record shape used by `create`:

```sh
sketchi generate --prompt "Map release approval with pass and revise branches"
sketchi generate --prompt "Organize launch readiness" --type mindmap --output json
```

It requires no API key, token, account, or login. It is the CLI's only network
boundary.

## Shell completions

The installer configures completions automatically. For a direct npm install,
generate the script for your shell and source the dedicated file:

Zsh initializes its completion system before loading Sketchi:

```zsh
mkdir -p ~/.sketchi/completions
sketchi --completions zsh > ~/.sketchi/completions/sketchi.zsh
autoload -Uz compinit
(( ${+functions[compdef]} )) || compinit
source ~/.sketchi/completions/sketchi.zsh
```

For Bash:

```bash
mkdir -p ~/.sketchi/completions
sketchi --completions bash > ~/.sketchi/completions/sketchi.bash
if [ "${BASH_VERSINFO[0]:-0}" -ge 4 ]; then
  source ~/.sketchi/completions/sketchi.bash
fi
```

Generated Bash completions require Bash 4 or newer. The installer silently
skips them on the stock macOS Bash 3.2. Bash login shells may not read
`.bashrc`, so `.bash_profile` may need to source `.bashrc` for completions to be
available.

For Fish:

```fish
mkdir -p ~/.sketchi/completions
sketchi --completions fish > ~/.sketchi/completions/sketchi.fish
source ~/.sketchi/completions/sketchi.fish
```

## For AI agents

The five deterministic commands—`create`, `show`, `edit`, `list`, and
`export`—are fully offline and require no credentials, account, browser, model,
or MCP server. They never send stored records to a provider. Agents can use
`--output json`, complete noninteractive input through `--json` or `--file`, and
raw artifact output through `export --dest -` without prompts.

After exporting PNG to a file, agents can follow the returned hint to display
that path as an inline Markdown image for the user.

`generate` is deliberately separate: it uses the public Sketchi API, remains
credential-free, and is the only command that uses the network.

## License

Sketchi CLI's own code is MIT-licensed. The published package also bundles
Excalidraw, resvg-wasm, and Excalifont under their respective licenses; see
the included `THIRD_PARTY_NOTICES` file for copyright, license, and source
availability details.

## Help

```sh
sketchi --help
sketchi create --help
sketchi generate --help
```

Source, issue tracking, and architecture documentation live in the
[Sketchi repository](https://github.com/shpitdev/sketchi).
