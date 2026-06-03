import { relative, resolve } from "node:path";
import { describe, expect, test } from "vitest";

import {
  buildDefaultPngPath,
  resolveOutputPath,
  resolveSessionPngOutputRoot,
} from "./output.js";

const BASE_DIR = resolve(process.cwd(), "tmp-output-policy");

describe("output path policy", () => {
  test("buildDefaultPngPath writes under session-scoped .sketchi root", () => {
    const outputPath = buildDefaultPngPath("diagram", BASE_DIR, "session-123");
    const root = resolveSessionPngOutputRoot(BASE_DIR, "session-123");
    const relativePath = relative(root, outputPath);

    expect(relativePath.startsWith("..")).toBe(false);
    expect(relativePath).not.toBe("");
    expect(outputPath.endsWith(".png")).toBe(true);
  });

  test("resolveOutputPath keeps bare filenames inside session root", () => {
    const resolved = resolveOutputPath("diagram.png", BASE_DIR, "session-1");
    const root = resolveSessionPngOutputRoot(BASE_DIR, "session-1");

    expect(resolved).toBe(resolve(root, "diagram.png"));
  });

  test("resolveOutputPath keeps nested relative paths inside session root", () => {
    const resolved = resolveOutputPath(
      "exports/diagram.png",
      BASE_DIR,
      "session-2"
    );
    const root = resolveSessionPngOutputRoot(BASE_DIR, "session-2");

    expect(resolved).toBe(resolve(root, "exports/diagram.png"));
  });

  test("resolveOutputPath accepts absolute paths only when already in session root", () => {
    const root = resolveSessionPngOutputRoot(BASE_DIR, "session-3");
    const allowedAbsolute = resolve(root, "exports", "diagram.png");

    expect(resolveOutputPath(allowedAbsolute, BASE_DIR, "session-3")).toBe(
      allowedAbsolute
    );
  });

  test("resolveOutputPath rejects traversal attempts by default", () => {
    expect(() =>
      resolveOutputPath("../escape.png", BASE_DIR, "session-4")
    ).toThrow("must stay within");
  });

  test("resolveOutputPath rejects absolute paths outside session root by default", () => {
    const outsideAbsolute = resolve(BASE_DIR, "..", "outside.png");
    expect(() =>
      resolveOutputPath(outsideAbsolute, BASE_DIR, "session-5")
    ).toThrow("must stay within");
  });

  test("resolveOutputPath opt-out allows paths outside session root", () => {
    const resolved = resolveOutputPath("../escape.png", BASE_DIR, "session-6", {
      allowUnsafeOutputPath: true,
    });

    expect(resolved).toBe(resolve(BASE_DIR, "../escape.png"));
  });

  test("session output root sanitizes session IDs for safe directory names", () => {
    const root = resolveSessionPngOutputRoot(BASE_DIR, "session/../:weird");
    expect(root).toBe(
      resolve(BASE_DIR, ".sketchi", "sessions", "session_..__weird", "png")
    );
  });
});
