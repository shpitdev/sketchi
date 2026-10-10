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
        name: "Built on Excalidraw.",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", {
        name: "Your stack’s logos, already sketched.",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Describe your first diagram." }),
    ).toBeTruthy();
  });

  it("features the CLI on the homepage with a reachable anchor", () => {
    const { container } = render(<MarketingHome />);

    expect(
      screen.getByRole("heading", {
        name: "Draw diagrams from your terminal.",
      }),
    ).toBeTruthy();
    expect(container.querySelector("#cli")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /View on npm/ }).getAttribute("href"),
    ).toBe("https://www.npmjs.com/package/sketchi");
  });

  it("uses configured surface URLs", () => {
    render(
      <MarketingHome
        surfaceUrls={{
          icons: "https://pr-42-sketchi-icons.dimethyl.workers.dev",
          playground: "https://pr-42-sketchi-studio.dimethyl.workers.dev",
        }}
      />,
    );

    for (const link of screen.getAllByRole("link", {
      name: "Open the playground",
    })) {
      expect(link.getAttribute("href")).toBe(
        "https://pr-42-sketchi-studio.dimethyl.workers.dev",
      );
    }

    expect(
      screen
        .getByRole("link", { name: /Browse the library/ })
        .getAttribute("href"),
    ).toBe("https://pr-42-sketchi-icons.dimethyl.workers.dev");
  });
});
