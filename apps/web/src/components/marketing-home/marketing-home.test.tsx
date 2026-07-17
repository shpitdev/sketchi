import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MarketingHome } from "./marketing-home";

describe("MarketingHome", () => {
  it("composes the hero, features, icons, and CTA", () => {
    render(<MarketingHome />);

    expect(
      screen.getByRole("heading", { name: /Sketchi draws it/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", {
        name: "Diagrams that behave like diagrams.",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", {
        name: "Every logo you need, already sketched.",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Start with a sentence." }),
    ).toBeTruthy();
  });

  it("uses configured surface URLs", () => {
    render(
      <MarketingHome
        surfaceUrls={{
          icons: "https://sketchi-icons-pr-42.dimethyl.workers.dev",
          playground: "https://sketchi-studio-pr-42.dimethyl.workers.dev",
        }}
      />,
    );

    for (const link of screen.getAllByRole("link", {
      name: "Open the playground",
    })) {
      expect(link.getAttribute("href")).toBe(
        "https://sketchi-studio-pr-42.dimethyl.workers.dev",
      );
    }

    expect(
      screen
        .getByRole("link", { name: /Browse the library/ })
        .getAttribute("href"),
    ).toBe("https://sketchi-icons-pr-42.dimethyl.workers.dev");
  });
});
