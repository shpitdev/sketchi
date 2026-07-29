import { describe, expect, it } from "@effect/vitest";

import { renderHelpBrand } from "./help-brand.js";

describe("CLI help brand", () => {
  it("renders a readable plain fallback without escape sequences", () => {
    const output = renderHelpBrand({ colors: "none", background: "dark" });

    expect(output).toContain("/\\");
    expect(output).toContain("sketchi");
    expect(output).not.toContain("\u001b");
  });

  it("uses branded truecolor with a background-aware wordmark", () => {
    const dark = renderHelpBrand({ colors: "truecolor", background: "dark" });
    const light = renderHelpBrand({ colors: "truecolor", background: "light" });

    expect(dark).toContain("\u001b[38;2;143;112;127m");
    expect(dark).toContain("\u001b[38;2;246;241;231msketchi");
    expect(light).toContain("\u001b[38;2;26;23;18msketchi");
  });
});
