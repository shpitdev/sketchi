import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const t = convexTest(schema, modules);

const baseStyleSettings = {
  strokeColor: "#000000",
  backgroundColor: "transparent",
  strokeWidth: 2,
  strokeStyle: "solid" as const,
  fillStyle: "hachure" as const,
  opacity: 100,
};

describe("iconLibraries", () => {
  test("create defaults roughness to 0.4", async () => {
    const id = await t.mutation(api.iconLibraries.create, { name: "Test Lib" });
    const data = await t.query(api.iconLibraries.get, { id });

    expect(data.library.styleSettings.roughness).toBeCloseTo(0.4, 5);
  });

  test("update clamps roughness to <= 2", async () => {
    const id = await t.mutation(api.iconLibraries.create, {
      name: "Clamp Lib",
    });
    await t.mutation(api.iconLibraries.update, {
      id,
      styleSettings: { ...baseStyleSettings, roughness: 5 },
    });

    const data = await t.query(api.iconLibraries.get, { id });
    expect(data.library.styleSettings.roughness).toBe(2);
  });

  test("update clamps roughness to >= 0", async () => {
    const id = await t.mutation(api.iconLibraries.create, {
      name: "Clamp Lib 2",
    });
    await t.mutation(api.iconLibraries.update, {
      id,
      styleSettings: { ...baseStyleSettings, roughness: -1 },
    });

    const data = await t.query(api.iconLibraries.get, { id });
    expect(data.library.styleSettings.roughness).toBe(0);
  });
});
