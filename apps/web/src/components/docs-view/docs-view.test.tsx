import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DocsView } from "./docs-view";

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

  it("links to the live read-only example and the public source", () => {
    render(<DocsView />);

    expect(
      screen
        .getByRole("link", { name: /interactive read-only diagram/ })
        .getAttribute("href"),
    ).toBe("https://sketchi-studio.dimethyl.workers.dev/examples/how-it-works");
    expect(
      screen
        .getByRole("link", { name: /github\.com\/shpitdev\/sketchi/ })
        .getAttribute("href"),
    ).toBe("https://github.com/shpitdev/sketchi");
  });
});
