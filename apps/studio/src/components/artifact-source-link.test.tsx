import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { IconActionBar } from "@/components/sketch-icons";

import { ArtifactSourceLink } from "./artifact-source-link";

describe("ArtifactSourceLink", () => {
  it("links a derived artifact review to its source artifact", () => {
    render(
      <IconActionBar>
        <ArtifactSourceLink
          provenance={{ sourceArtifactId: "artifact/source with spaces" }}
        />
      </IconActionBar>,
    );

    expect(
      screen
        .getByRole("link", { name: "Source artifact" })
        .getAttribute("href"),
    ).toBe("/artifacts/artifact%2Fsource%20with%20spaces");
  });

  it("renders no source link for a root artifact", () => {
    render(
      <IconActionBar>
        <ArtifactSourceLink />
      </IconActionBar>,
    );

    expect(screen.queryByRole("link", { name: "Source artifact" })).toBeNull();
  });
});
