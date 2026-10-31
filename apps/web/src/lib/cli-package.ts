/**
 * Facts about the published `sketchi` CLI, in one place so the homepage, the
 * docs page, and the footer cannot drift from each other or from the package.
 *
 * Every claim here is taken from the CLI's own command surface (`sketchi
 * --help`) and its published npm metadata. Do not add a capability that the
 * binary does not have, and do not hard-code a version: npm already shows the
 * current one, and a number in copy goes stale the next time we publish.
 */

import { SITE_URL } from "./site-meta";

/** Public package name. Never the workspace name `@sketchi/cli`. */
export const CLI_PACKAGE_NAME = "sketchi";

export const REPO_URL = "https://github.com/shpitdev/sketchi";

export const CLI_NPM_URL = `https://www.npmjs.com/package/${CLI_PACKAGE_NAME}`;

/** The installer as committed on main. */
export const CLI_INSTALL_SCRIPT_SOURCE_URL =
	"https://raw.githubusercontent.com/shpitdev/sketchi/main/install.sh";

/** Short URL for the installer; `/install.sh` redirects to the source above. */
export const CLI_INSTALL_SCRIPT_URL = `${SITE_URL}/install.sh`;

/**
 * The installer resolves the published package, then writes completions for a
 * detected zsh, bash, or fish shell. Verified against the live script; the
 * short URL serves the same bytes through a redirect `curl -L` follows.
 */
export const CLI_INSTALL_COMMAND = `curl -fsSL ${CLI_INSTALL_SCRIPT_URL} | sh`;

/** The plain npm path, for people who would rather not pipe a script to a shell. */
export const CLI_NPM_INSTALL_COMMAND = `npm install -g ${CLI_PACKAGE_NAME}`;

/** From the published package's `engines.node`. */
export const CLI_NODE_REQUIREMENT = "Node.js 24.13.0 or newer";

/** One command worth showing as proof that it does real work. */
export const CLI_EXAMPLE_COMMAND = `sketchi generate \\
  --prompt "Map release approval with pass and revise branches"`;
