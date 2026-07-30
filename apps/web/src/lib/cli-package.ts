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
  'sketchi generate --prompt "Map release approval with pass and revise branches"';

export interface CliInstallOption {
  /** The shell command itself. */
  command: string;
  /** Accessible label for the copy control. */
  label: string;
}

export const cliInstallOptions: readonly CliInstallOption[] = [
  {
    command: CLI_INSTALL_COMMAND,
    label: "install script",
  },
  {
    command: CLI_NPM_INSTALL_COMMAND,
    label: "npm install command",
  },
];
