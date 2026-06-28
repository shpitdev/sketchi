import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MarketingHome } from "./marketing-home";

describe("MarketingHome", () => {
  it("composes the hero, pipeline, and surfaces", () => {
    render(<MarketingHome />);

    expect(
      screen.getByRole("heading", { name: /validated diagrams/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Generation stays inspectable." }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Four surfaces, one pipeline." }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Excalidraw workspace" }),
    ).toBeTruthy();
  });

  it("uses configured surface URLs", () => {
    render(
      <MarketingHome
        surfaceUrls={{
          excalidraw: "https://sketchi-excalidraw-pr-42.dimethyl.workers.dev",
          icons: "https://sketchi-icons-pr-42.dimethyl.workers.dev",
          playground: "https://sketchi-playground-pr-42.dimethyl.workers.dev",
        }}
      />,
    );

    expect(
      screen
        .getByRole("link", { name: /Excalidraw workspace/ })
        .getAttribute("href"),
    ).toBe("https://sketchi-excalidraw-pr-42.dimethyl.workers.dev");
    expect(
      screen.getByText("sketchi-excalidraw-pr-42.dimethyl.workers.dev"),
    ).toBeTruthy();
  });
});
