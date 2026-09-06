<p align="center">
  <img src="https://sketchi.app/icon.svg" alt="Sketchi" width="112" height="112" />
</p>

<h1 align="center">Sketchi CLI</h1>

<p align="center">
  <strong>Typed, deterministic diagrams from your terminal.</strong><br />
  Create, inspect, revise, and export local flowcharts, mindmaps, and sequence diagrams—or turn one prompt into validated, editable Excalidraw.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/sketchi"><img alt="npm version" src="https://img.shields.io/npm/v/sketchi?logo=npm&color=CB3837" /></a>
  <a href="https://sketchi.app/"><img alt="Sketchi website" src="https://img.shields.io/badge/sketchi.app-live-765264" /></a>
  <a href="https://github.com/shpitdev/sketchi/blob/main/LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-2F855A" /></a>
</p>

Sketchi stores canonical diagram documents and authoritative Excalidraw artifacts
under `~/.sketchi/diagrams`. Its manual and recovery workflows stay local;
generation, Universal Canvas compilation, and encrypted snapshot exchange are explicit, credential-free network
commands.

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

## Generate a PNG from a prompt

`generate` sends one prompt to Sketchi's public generation API, validates and
persists the editable result, then writes `<generated-id>.png` in the current
directory:

```sh
sketchi generate

# Direct and noninteractive:
sketchi generate --prompt "Map release approval with pass and revise branches"
```

With no `--prompt`, Sketchi opens a short wizard only when both standard input
and standard output are human terminals, output is text, and CI is absent. It
asks for prompt text, flowchart (the default), mind map, or sequence diagram, and where to save the
PNG. The choices are the current directory, a `diagrams/` folder under exactly
the directory where Sketchi was run, or a custom path with the same semantics as
`--dest`. Sketchi does not inspect Git, and it creates `diagrams/` only after
generation succeeds. An explicit `--type` or file `--dest` presets and skips
that wizard question. Explicit `--format png` may proceed; another format or
`--dest -` requires `--prompt` because the interactive wizard writes PNG files.

Scripts, pipes, redirected streams, CI, and `--output json` never prompt or
block. They must pass `--prompt`; omitting it retains the deterministic usage
error. Passing `--prompt` is always direct and noninteractive.
Without `--type`, the generation model selects flowchart, mindmap, or sequence
from the request. An explicit supported `--type` remains authoritative.
Explicit ER, architecture, swimlane, and state-machine requests return a typed
unsupported-type error instead of being coerced into a flowchart.

The PNG is rendered locally from the returned validated artifacts and is not
written back into the record. Choose another artifact or destination explicitly:

```sh
sketchi generate --prompt "Organize launch readiness" --type mindmap --format excalidraw --dest launch.excalidraw

sketchi generate --prompt "Show Browser calling API and API returning success" --type sequence --dest request-sequence.png
sketchi generate --prompt "Map release approval" --dest - > release.png
sketchi generate --prompt "Map release approval" --output json
```

`--format` accepts `png`, `excalidraw`, or `scene`; their default names are
`<id>.png`, `<id>.excalidraw`, and `<id>.scene.json`. With `--dest -`, stdout
contains artifact bytes only and the text or JSON status envelope moves to
stderr. Generation, Universal Canvas compilation, sharing, and pulling are the CLI's four network commands.

## Build a Universal CanvasSpec

`canvas` sends an already-authored, typed CanvasSpec to Sketchi's public
create-canvas API, validates the response, preserves the normalized scene and
editable Excalidraw artifact in the local store, and exports PNG by default:

```sh
sketchi canvas --file canvas.json --output json
printf '%s' "$CANVAS_SPEC" | sketchi canvas --file - --format excalidraw --dest canvas.excalidraw
```

The input is the CanvasSpec object itself—not a request wrapper and not raw
Excalidraw JSON. The command never prompts, so files and piped stdin are safe for
agents and scripts. `--format` and `--dest` have the same behavior as `generate`.
The endpoint defaults to
`https://playground.sketchi.app/api/v1/canvases/create`; use `--endpoint URL` or
`SKETCHI_CANVAS_ENDPOINT` only for preview and local testing. The existing
`create` command remains the separate, strictly offline command for accepted
flowchart, mindmap, and sequence documents.

## Create and work with a diagram offline

Create a canonical flowchart from inline JSON:

```sh
sketchi create --json '{"type":"flowchart","spec":{"id":"release-flow","title":"Release approval","nodes":[{"id":"start","label":"Change proposed","kind":"start"},{"id":"review","label":"Review evidence","kind":"process"},{"id":"end","label":"Release approved","kind":"end"}],"edges":[{"source":"start","target":"review"},{"source":"review","target":"end"}]}}'
```

Inspect it, replace it with another complete canonical document, and list the
local store:

```sh
sketchi show release-flow

sketchi edit release-flow --json '{"type":"flowchart","spec":{"id":"release-flow","title":"Release approval revised","nodes":[{"id":"start","label":"Change proposed","kind":"start"},{"id":"review","label":"Review complete evidence","kind":"process"},{"id":"end","label":"Release approved","kind":"end"}],"edges":[{"source":"start","target":"review"},{"source":"review","target":"end"}]}}'

sketchi patch release-flow --json '{"operations":[{"op":"setStyle","selector":{"nodeIds":["review"]},"style":{"fillColor":"#dbeafe","strokeColor":"#2563eb"}}]}'

sketchi list
```

`patch` reuses Sketchi's semantic selectors and operations (`setStyle`,
`setDefaultStyle`, `setShape`, `translate`, `replaceText`, and
`rerouteEdges`) without exposing raw Excalidraw mutation. It is fully offline,
preserves the prior full revision, retains `document.json` unchanged as
provenance, makes `scene.json` authoritative, and removes any stale stored PNG.
Patched records report `authority: "patched"` and
`documentAuthoritative: false`; restore a canonical revision before using
`edit` again.

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

## Share, pull, and restore browser edits

Create an immutable encrypted Excalidraw snapshot link from the record's current
authoritative artifact:

```sh
sketchi share release-flow
sketchi share release-flow --open --output json
```

The URL is a bearer secret: anyone who receives the complete URL can decrypt the
snapshot. Encryption hides the drawing from the storage service, but the service
can observe connection metadata, timing, and ciphertext size. Retention is
uncontrolled and may be indefinite; Sketchi cannot revoke or delete a link.
`--open` is opt-in, discloses the URL to the local opener and browser history,
and reports only whether the OS accepted the request—not whether a visible
window opened.

Browser edits do not update an existing link. In Excalidraw choose
**Save to… → Export to Link**, then pull the newly exported link:

```sh
sketchi pull release-flow --link 'https://excalidraw.com/#json=ID,KEY'
printf '%s\n' 'https://excalidraw.com/#json=ID,KEY' | sketchi pull release-flow --link -
```

The linked drawing has no trusted Sketchi identity and may be unrelated to
`release-flow`. A successful pull preserves the complete prior record under
`revisions/`, removes any stale stored PNG, and makes `diagram.excalidraw` the
sole authoritative artifact. `show` and `list` then report `authority:
"detached"` and `documentAuthoritative: false`; retained `document.json` and
`scene.json` are provenance only. Detached `edit` refuses, scene export is
unavailable, and on-demand PNG renders directly from `diagram.excalidraw` using
its background without a stale canonical title.

Recover any retained full snapshot through the strictly offline CLI:

```sh
sketchi restore release-flow --revision 1
```

Restore archives the displaced current state first, does not consume the chosen
snapshot, and advances revision numbering monotonically. New edit/pull/restore
history uses full `revisions/000001/` authority snapshots; legacy
`revisions/000001.json` document revisions remain restorable on canonical
records.

Share/pull v1 supports exactly `rectangle`, `ellipse`, `diamond`, `arrow`,
`line`, `freedraw`, and `text`. Text must use Excalifont `fontFamily` id `5`.
Images, non-empty `files`, frames, embeddables, iframes, external resources,
custom fonts, libraries, and unknown element types are rejected. Compatibility
is pinned to Excalidraw `e6ae6bf` and excalidraw-store `76de642`; both commands
use the unofficial `json.excalidraw.com` API without retries.

The enforced v1 bounds are a 4 KiB bearer link, 2 MiB encrypted body, 16 MiB
inflated contents, 10,000 elements, and JSON depth 64. Before any raster
allocation, Sketchi also limits each element dimension to 8,192 units, each
canvas dimension to 8,192 units, canvas area to 4,194,304 square units, and the
final PNG to 16,777,216 pixels. Share enforces its compressed-output budget
while streaming and reserves framing plus encryption overhead before encryption.
Pull requires exactly one literal root
`https://excalidraw.com/#json=ID,KEY` or
`https://www.excalidraw.com/#json=ID,KEY` URL (or one such URL through stdin);
userinfo, ports, query strings, alternate spellings, and repeated `--link`
flags are rejected.

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

The seven deterministic commands—`create`, `patch`, `show`, `edit`, `list`,
`export`, and `restore`—are fully offline and require no credentials, account,
browser, model, or MCP server. Those seven commands never send stored records
to a provider.
Agents can use
`--output json`, complete noninteractive input through `--json` or `--file`, and
raw artifact output through `export --dest -` without prompts.

Agents must pass `--prompt` to `generate`. Interactive prompting is restricted
to human text TTYs and is never enabled by JSON output, pipes, redirects, or CI.

After exporting PNG to a file, agents can follow the returned hint to display
that path as an inline Markdown image for the user.

`generate`, `canvas`, `share`, and `pull` are deliberately separate, explicit network
commands. They remain credential-free and each makes one HTTPS request. Share
is randomized by its key and IV; pull depends on remote availability and
untrusted input, so neither belongs to determinism claims.

## License

Sketchi CLI's own code is MIT-licensed. The published package also bundles
Excalidraw, resvg-wasm, and Excalifont under their respective licenses; see
the included `THIRD_PARTY_NOTICES` file for copyright, license, and source
availability details.

## Help

```sh
sketchi --help
sketchi docs
sketchi create --help
sketchi patch --help
sketchi generate --help
sketchi canvas --help
sketchi share --help
sketchi pull --help
sketchi restore --help
```

The root screen is deliberately progressive: it leads with `generate`, one
copyable prompt, and the few commands used to continue working with a diagram.
`sketchi docs` is the complete command and automation map; targeted
`COMMAND --help` pages retain every flag and example. Interactive terminals get
the Sketchi pencil lockup and restrained brand color. Pipes, `NO_COLOR`, and
JSON output remain plain and contain no ANSI control sequences.

Source, issue tracking, and architecture documentation live in the
[Sketchi repository](https://github.com/shpitdev/sketchi).

See the [changelog](https://github.com/shpitdev/sketchi/blob/main/apps/cli/CHANGELOG.md)
for everything that changed, or browse published versions on
[GitHub Releases](https://github.com/shpitdev/sketchi/releases).
