import { describe, expect, test } from "bun:test";

import { mapPlaywrightLaunchError } from "./render";

describe("mapPlaywrightLaunchError", () => {
  test("maps missing browser launch failure to actionable message", () => {
    const mapped = mapPlaywrightLaunchError(
      new Error(
        "launch: Executable doesn't exist at /tmp/chrome-headless-shell"
      )
    );

    expect(mapped).not.toBeNull();
    expect(mapped?.message).toContain("npx playwright install chromium");
    expect(mapped?.message).toContain("does not auto-install");
  });

  test("leaves unrelated launch errors unchanged", () => {
    const mapped = mapPlaywrightLaunchError(new Error("network timeout"));
    expect(mapped).toBeNull();
  });
});
