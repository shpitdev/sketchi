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
    expect(screen.getByRole("heading", { name: /App surfaces/ })).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: /No-auth status/ }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /Excalidraw workspace/ }),
    ).toHaveProperty(
      "href",
      "https://sketchi-excalidraw.dimethyl.workers.dev/",
    );
  });
});
