/**
 * Facts about the published `sketchi` CLI, in one place so the homepage, the
 * docs page, and the footer cannot drift from each other or from the package.
 *
 * Every claim here is taken from the CLI's own command surface (`sketchi
 * --help`) and its published npm metadata. Do not add a capability that the
 * binary does not have, and do not hard-code a version: npm already shows the
 * current one, and a number in copy goes stale the next time we publish.
 */

/** Public package name. Never the workspace name `@sketchi/cli`. */
export const CLI_PACKAGE_NAME = "sketchi";

export const CLI_NPM_URL = `https://www.npmjs.com/package/${CLI_PACKAGE_NAME}`;

/**
 * The installer resolves the published package, then writes completions for a
 * detected zsh, bash, or fish shell. Verified against the live script.
 */
export const CLI_INSTALL_COMMAND =
  "curl -fsSL https://raw.githubusercontent.com/shpitdev/sketchi/main/install.sh | sh";

/** The plain npm path, for people who would rather not pipe a script to a shell. */
export const CLI_NPM_INSTALL_COMMAND = `npm install -g ${CLI_PACKAGE_NAME}`;

/** From the published package's `engines.node`. */
export const CLI_NODE_REQUIREMENT = "Node.js 24.13.0 or newer";

/** One command worth showing as proof that it does real work. */
export const CLI_EXAMPLE_COMMAND =
  'sketchi generate --prompt "Map our release approval flow"';

export interface CliInstallOption {
  /** The shell command itself. */
  command: string;
  /** What this path gets you, beyond the binary. */
  detail: string;
  /** Accessible label for the copy control. */
  label: string;
}

export const cliInstallOptions: readonly CliInstallOption[] = [
  {
    command: CLI_INSTALL_COMMAND,
    detail:
      "Installs the package and sets up completions for zsh, bash, or fish.",
    label: "install script",
  },
  {
    command: CLI_NPM_INSTALL_COMMAND,
    detail:
      "Straight from npm, if you would rather configure completions yourself.",
    label: "npm install command",
  },
];

export interface CliCapability {
  description: string;
  title: string;
}

/**
 * Three honest capability claims. Each maps to real subcommands: the offline
 * seven (`create`, `patch`, `show`, `edit`, `list`, `export`, `restore`), the
 * credential-free `generate`, and the local PNG/Excalidraw exporter.
 */
export const cliCapabilities: readonly CliCapability[] = [
  {
    description:
      "One prompt, one HTTPS request, a validated diagram on disk. No API key, token, or account.",
    title: "Generate without signing in",
  },
  {
    description:
      "Create, patch, show, edit, list, export, and restore never touch the network or a model.",
    title: "Seven commands work offline",
  },
  {
    description:
      "Render PNG or Excalidraw locally, deterministically, without starting a browser.",
    title: "Export from the terminal",
  },
];
