import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DocsView } from "./docs-view";

describe("DocsView", () => {
  it("renders the docs heading, section nav, and sections", () => {
    render(<DocsView />);

    expect(
      screen.getByRole("heading", {
        name: "How Sketchi v2 is put together",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("navigation", { name: "Docs sections" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Generation pipeline" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: /Product routes/ }),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Agent setup/ })).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: /Internal surfaces/ }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: /Auth and persistence/ }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /Sketchi Playground/ }),
    ).toHaveProperty("href", "https://sketchi-studio.dimethyl.workers.dev/");
    expect(
      screen.queryByRole("link", { name: /Excalidraw workspace/ }),
    ).toBeNull();
  });
});
