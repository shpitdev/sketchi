import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CliBand } from "./cli-band";
import {
  CLI_INSTALL_COMMAND,
  CLI_NODE_REQUIREMENT,
  CLI_NPM_INSTALL_COMMAND,
  CLI_NPM_URL,
} from "../../lib/cli-package";

describe("CliBand", () => {
  it("publishes both verified install commands verbatim", () => {
    render(<CliBand />);

    expect(screen.getByText(CLI_INSTALL_COMMAND)).toBeTruthy();
    expect(screen.getByText(CLI_NPM_INSTALL_COMMAND)).toBeTruthy();
  });

  it("gives every command its own copy control", () => {
    render(<CliBand />);

    expect(
      screen
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Copy install script",
      "Copy npm install command",
      "Copy example command",
    ]);
  });

  /**
   * The copy control is the whole point of the section: what lands on the
   * clipboard has to be the exact command, not the wrapped text the reader
   * sees. Headless Chrome blocks clipboard writes outright, so the payload is
   * pinned here rather than in the browser pass.
   */
  it("copies the exact install command, not the wrapped rendering", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });

    render(<CliBand />);

    fireEvent.click(
      screen.getByRole("button", { name: "Copy install script" }),
    );
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(CLI_INSTALL_COMMAND);
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Copy npm install command" }),
    );
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(CLI_NPM_INSTALL_COMMAND);
    });

    vi.unstubAllGlobals();
  });

  /**
   * Generation needs the network, so counting the commands that do not is a
   * claim nobody installs a CLI for. The band makes no offline claim at all
   * now, and must not grow one back.
   */
  it("makes no offline claim", () => {
    const { container } = render(<CliBand />);

    expect(container.textContent).not.toMatch(/offline/i);
  });

  /**
   * Every install command carried a sentence explaining it. The commands are
   * self-evident, so the terminal card is commands and the Node floor, nothing
   * else.
   */
  it("captions none of the commands", () => {
    const { container } = render(<CliBand />);

    expect(
      [...container.querySelectorAll(".cli-band__body p")].map(
        (element) => element.textContent,
      ),
    ).toEqual([`Requires ${CLI_NODE_REQUIREMENT}.`]);
  });

  it("links to the real npm package page with the npm mark", () => {
    render(<CliBand />);

    const npmLink = screen.getByRole("link", { name: /View on npm/ });

    expect(npmLink.getAttribute("href")).toBe(CLI_NPM_URL);
    expect(CLI_NPM_URL).toBe("https://www.npmjs.com/package/sketchi");
    expect(screen.getByRole("img", { name: "npm" }).getAttribute("src")).toBe(
      "/brand/npm.svg",
    );
  });

  it("offers npm as the section's only trailing link", () => {
    const { container } = render(<CliBand />);

    expect(container.querySelectorAll(".cli-band__links a")).toHaveLength(1);
    expect(
      screen.queryByRole("link", { name: /Read the CLI docs/ }),
    ).toBeNull();
  });

  it("is anchored so navigation and footer entries can reach it", () => {
    const { container } = render(<CliBand />);

    expect(container.querySelector("#cli")).toBeTruthy();
  });

  /**
   * A package version in copy goes stale the moment we publish, and a pinned
   * install command installs yesterday's CLI. npm already shows the current
   * version, so neither the copy nor the commands may name one. The Node
   * engine floor is a different thing: it only moves when we choose to raise it.
   */
  it("pins no package version", () => {
    const { container } = render(<CliBand />);

    expect(container.textContent).not.toMatch(/sketchi@/);
    expect(container.textContent).not.toMatch(/\bv\d/);
    expect(screen.getByText(/Requires Node\.js .* or newer\./)).toBeTruthy();
  });
});
