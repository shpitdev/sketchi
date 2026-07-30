import { describe, expect, it } from "@effect/vitest";

import { renderRootHelp, terminalPaletteForBackground } from "./help-brand.js";

describe("CLI help brand", () => {
  it("renders a readable plain fallback without escape sequences", () => {
    const output = renderRootHelp({ colors: "none", background: "dark" });

    expect(output).toContain("/#####/\n");
    expect(output).toContain("               /__#/");
    expect(output).toContain("sketchi");
    expect(output).toContain("START HERE");
    expect(output).toContain("WORK WITH A DIAGRAM");
    expect(output).not.toContain("\u001b");
  });

  it("styles the complete help hierarchy with a background-aware palette", () => {
    const dark = renderRootHelp({ colors: "truecolor", background: "dark" });
    const light = renderRootHelp({
      colors: "truecolor",
      background: "light",
    });

    expect(dark).toContain("\u001b[38;2;195;154;172m");
    expect(dark).toContain("\u001b[1;38;2;246;241;231msketchi");
    expect(dark).toContain("\u001b[1;38;2;195;154;172mSTART HERE");
    expect(light).toContain("\u001b[1;38;2;26;23;18msketchi");
  });

  it("selects a readable complete palette for every ANSI background", () => {
    expect(
      Array.from({ length: 16 }, (_, index) =>
        terminalPaletteForBackground(index, "truecolor"),
      ),
    ).toEqual([
      { background: "dark", readable: true },
      { background: "dark", readable: false },
      { background: "light", readable: false },
      { background: "light", readable: false },
      { background: "dark", readable: false },
      { background: "dark", readable: false },
      { background: "light", readable: false },
      { background: "light", readable: true },
      { background: "light", readable: false },
      { background: "light", readable: false },
      { background: "light", readable: true },
      { background: "light", readable: true },
      { background: "dark", readable: false },
      { background: "light", readable: false },
      { background: "light", readable: true },
      { background: "light", readable: true },
    ]);
  });

  it("scores every ANSI background against the exact ANSI-256 roles", () => {
    expect(
      Array.from({ length: 16 }, (_, index) =>
        terminalPaletteForBackground(index, "ansi256"),
      ),
    ).toEqual([
      { background: "dark", readable: true },
      { background: "dark", readable: false },
      { background: "light", readable: false },
      { background: "light", readable: false },
      { background: "dark", readable: true },
      { background: "dark", readable: false },
      { background: "light", readable: false },
      { background: "light", readable: false },
      { background: "dark", readable: false },
      { background: "dark", readable: false },
      { background: "light", readable: false },
      { background: "light", readable: true },
      { background: "dark", readable: false },
      { background: "light", readable: false },
      { background: "light", readable: false },
      { background: "light", readable: true },
    ]);
  });

  it("handles representative ANSI-256 backgrounds deterministically", () => {
    expect(
      [16, 21, 196, 231, 232, 244, 255].map((index) => [
        index,
        terminalPaletteForBackground(index, "truecolor"),
      ]),
    ).toEqual([
      [16, { background: "dark", readable: true }],
      [21, { background: "dark", readable: false }],
      [196, { background: "light", readable: false }],
      [231, { background: "light", readable: true }],
      [232, { background: "dark", readable: true }],
      [244, { background: "light", readable: false }],
      [255, { background: "light", readable: true }],
    ]);
  });

  it("rejects ANSI-256 palettes whose emitted roles miss the contrast floor", () => {
    expect(
      [7, 10, 14, 46, 82].map((index) => [
        index,
        terminalPaletteForBackground(index, "ansi256"),
      ]),
    ).toEqual([
      [7, { background: "light", readable: false }],
      [10, { background: "light", readable: false }],
      [14, { background: "light", readable: false }],
      [46, { background: "light", readable: false }],
      [82, { background: "light", readable: false }],
    ]);
  });

  it("treats unknown background indices as unreadable", () => {
    expect(terminalPaletteForBackground(-1, "truecolor")).toEqual({
      background: "dark",
      readable: false,
    });
    expect(terminalPaletteForBackground(256, "ansi256")).toEqual({
      background: "dark",
      readable: false,
    });
  });
});
