import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DocsView } from "./docs-view";
import {
  CLI_INSTALL_COMMAND,
  CLI_NPM_INSTALL_COMMAND,
} from "../../lib/cli-package";

describe("DocsView", () => {
  it("renders the docs heading, section nav, and sections", () => {
    render(<DocsView />);

    expect(
      screen.getByRole("heading", { name: "How Sketchi works" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("navigation", { name: "Docs sections" }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "How it works" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Open source/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Diagram types/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /FAQ/ })).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: /In your coding agent/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("link", { name: /Excalidraw workspace/ }),
    ).toBeNull();
  });

  it("documents the CLI as the third path, with copyable install commands", () => {
    render(<DocsView />);

    expect(screen.getByRole("heading", { name: "Three paths" })).toBeTruthy();
    expect(screen.getByText("The terminal")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "The CLI" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "CLI" }).getAttribute("href")).toBe(
      "#cli",
    );
    expect(screen.getByText(CLI_INSTALL_COMMAND)).toBeTruthy();
    expect(screen.getByText(CLI_NPM_INSTALL_COMMAND)).toBeTruthy();
    expect(
      screen
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["Copy install script", "Copy npm install command"]);
    expect(
      screen
        .getByRole("link", { name: /npmjs\.com\/package\/sketchi/ })
        .getAttribute("href"),
    ).toBe("https://www.npmjs.com/package/sketchi");
  });

  /**
   * The docs describe only commands the binary actually has. `sketchi --help`
   * is the source of truth for this list.
   */
  it("names only real subcommands", () => {
    const { container } = render(<DocsView />);

    const realCommands = [
      "generate",
      "create",
      "edit",
      "patch",
      "show",
      "list",
      "restore",
      "export",
      "share",
      "pull",
    ];

    const named = [
      ...container.querySelectorAll("#cli .docs-defs dt code"),
    ].map((element) => element.textContent);

    expect(named.length).toBeGreaterThan(0);
    for (const command of named) {
      expect(realCommands).toContain(command);
    }
  });

  it("links to the live read-only example and the public source", () => {
    render(<DocsView />);

    expect(
      screen
        .getByRole("link", { name: /interactive read-only diagram/ })
        .getAttribute("href"),
    ).toBe("https://playground.sketchi.app/examples/how-it-works");
    expect(
      screen
        .getByRole("link", { name: /github\.com\/shpitdev\/sketchi/ })
        .getAttribute("href"),
    ).toBe("https://github.com/shpitdev/sketchi");
  });
});
