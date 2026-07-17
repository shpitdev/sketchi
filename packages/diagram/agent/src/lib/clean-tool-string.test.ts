import { describe, expect, it } from "vitest";

import { cleanToolString } from "./clean-tool-string";

describe("cleanToolString", () => {
  it("strips welded trailing key fragments seen in flash-lite tool calls", () => {
    expect(cleanToolString("start-node,kind:")).toBe("start-node");
    expect(cleanToolString("ci-pipeline,target:")).toBe("ci-pipeline");
    expect(cleanToolString("pass,source:")).toBe("pass");
    expect(cleanToolString("smoke-check,target:,source:")).toBe("smoke-check");
  });

  it("keeps legitimate commas that are not key fragments", () => {
    expect(cleanToolString("Rollback, then alert")).toBe(
      "Rollback, then alert",
    );
    expect(cleanToolString("Deploy with Wrangler")).toBe(
      "Deploy with Wrangler",
    );
  });
});
