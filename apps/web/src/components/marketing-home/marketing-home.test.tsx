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
      screen.getByRole("heading", { name: "Public routes, one pipeline." }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", {
        name: "Direct Workers are the review surface.",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", {
        name: "Sketchi Playground keeps generation inspectable.",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Sketchi Playground" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("link", { name: /Excalidraw workspace/ }),
    ).toBeNull();
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

    expect(
      screen
        .getByRole("link", { name: /Sketchi Playground/ })
        .getAttribute("href"),
    ).toBe("https://sketchi-studio-pr-42.dimethyl.workers.dev");
    expect(
      screen.getByText("sketchi-studio-pr-42.dimethyl.workers.dev"),
    ).toBeTruthy();
  });
});
