import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { IconActionBar, IconButton, IconLink } from "./index";

describe("icon actions", () => {
  it("renders an accessible, labelled link", () => {
    render(
      <IconActionBar>
        <IconLink href="/edit" icon="edit" label="Edit" />
      </IconActionBar>,
    );

    const link = screen.getByRole("link", { name: "Edit" });
    expect(link.getAttribute("href")).toBe("/edit");
  });

  it("renders a labelled button that fires onClick", () => {
    let clicks = 0;
    render(
      <IconActionBar>
        <IconButton
          icon="save"
          label="Save to Studio"
          onClick={() => {
            clicks += 1;
          }}
        />
      </IconActionBar>,
    );

    const button = screen.getByRole("button", { name: "Save to Studio" });
    button.click();
    expect(clicks).toBe(1);
  });
});
