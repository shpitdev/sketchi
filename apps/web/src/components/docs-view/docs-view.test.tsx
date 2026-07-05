import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DocsView } from "./docs-view";

describe("DocsView", () => {
  it("renders the docs heading, section nav, and sections", () => {
    render(<DocsView />);

    expect(
      screen.getByRole("heading", { name: "Everything Sketchi can do" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("navigation", { name: "Docs sections" }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "How it works" })).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: /In your coding agent/ }),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Diagram types/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /FAQ/ })).toBeTruthy();
    expect(
      screen.getAllByRole("link", { name: "Sketchi Playground" })[0],
    ).toHaveProperty("href", "https://sketchi-studio.dimethyl.workers.dev/");
    expect(
      screen.queryByRole("link", { name: /Excalidraw workspace/ }),
    ).toBeNull();
  });
});
