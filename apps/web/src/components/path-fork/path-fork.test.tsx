import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PathFork } from "./path-fork";

describe("PathFork", () => {
  it("offers a playground path and an agent path", () => {
    render(
      <PathFork
        agentsHref="/agents"
        surfaceUrls={{
          icons: "https://icons.example.test",
          playground: "https://play.example.test",
        }}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Pick your path." }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Open the playground" }),
    ).toHaveProperty("href", "https://play.example.test/");
    expect(
      screen.getByRole("link", { name: "Add to your agent" }),
    ).toHaveProperty("href", "http://localhost:3000/agents");
  });
});
