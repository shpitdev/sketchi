import { describe, expect, it } from "vitest";

import {
  CLI_INSTALL_COMMAND,
  CLI_NPM_INSTALL_COMMAND,
  CLI_NPM_URL,
  CLI_PACKAGE_NAME,
  cliInstallOptions,
} from "./cli-package";

/**
 * A wrong install line on the homepage is worse than no install line: the
 * reader blames the product, not the copy. Both commands below were run
 * end-to-end against the published package before they shipped, so they are
 * pinned here byte-for-byte — changing one should require deliberately updating
 * this test, and re-running it for real.
 */
describe("CLI package facts", () => {
  it("publishes the verified installer one-liner", () => {
    expect(CLI_INSTALL_COMMAND).toBe(
      "curl -fsSL https://raw.githubusercontent.com/shpitdev/sketchi/main/install.sh | sh",
    );
  });

  it("publishes the verified npm install command", () => {
    expect(CLI_NPM_INSTALL_COMMAND).toBe("npm install -g sketchi");
  });

  it("uses the public package name, never the workspace name", () => {
    expect(CLI_PACKAGE_NAME).toBe("sketchi");
    expect(CLI_NPM_URL).toBe("https://www.npmjs.com/package/sketchi");

    for (const option of cliInstallOptions) {
      expect(option.command).not.toContain("@sketchi/cli");
    }
  });

  it("pins no version, so the copy cannot go stale", () => {
    for (const option of cliInstallOptions) {
      expect(option.command).not.toContain("sketchi@");
    }
  });
});
