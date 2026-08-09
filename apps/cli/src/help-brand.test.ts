import { describe, expect, it } from "@effect/vitest";
import stringWidth from "string-width";

import {
  renderRootHelp,
  terminalPaletteForBackground,
  terminalSupportsUnicode,
} from "./help-brand.js";

describe("CLI help brand", () => {
  it("falls back to the plain word without block art or escape sequences", () => {
    const output = renderRootHelp({ colors: "none", background: "dark" });

    expect(output).toContain("  sketchi\n");
    expect(output).toContain("describe it. sketchi draws it.");
    expect(output).toContain("START HERE");
    expect(output).toContain("WORK WITH A DIAGRAM");
    expect(output).not.toMatch(/[▀▄█]/u);
    expect(output).not.toContain("\u001b");
  });

  it("paints the pencil tile and wordmark when the terminal has colour", () => {
    const output = renderRootHelp({
      colors: "truecolor",
      background: "dark",
      unicode: true,
      width: 80,
    });
    const lockup = output.split("\n\n")[0] ?? "";

    // Plate, barrel, wood, graphite, ferrule and eraser all reach the screen.
    for (const material of [
      "38;2;158;124;140",
      "38;2;250;248;247",
      "38;2;214;186;152",
      "38;2;58;50;54",
      "38;2;186;190;196",
      "38;2;222;152;158",
    ]) {
      expect(lockup).toContain(material);
    }
    expect(lockup).toContain("48;2;");
    expect(lockup.split("\n")).toHaveLength(8);
    expect(output).toContain("\u001b[38;2;195;154;172m\u001b[1mSTART HERE");
  });

  it("keeps the light palette legible against its own background", () => {
    const light = renderRootHelp({
      colors: "truecolor",
      background: "light",
      unicode: true,
      width: 80,
    });

    expect(light).toContain("38;2;143;112;127");
    expect(light).toContain("\u001b[38;2;26;23;18m\u001b[1msketchi");
  });

  it("keeps every lockup line inside the terminal width", () => {
    for (const width of [32, 46, 52, 80, 120]) {
      const output = renderRootHelp({
        colors: "truecolor",
        background: "dark",
        unicode: true,
        width,
      });

      for (const line of output.split("\n")) {
        expect(stringWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  it("drops the tile but keeps the wordmark on narrow terminals", () => {
    const output = renderRootHelp({
      colors: "truecolor",
      background: "dark",
      unicode: true,
      width: 46,
    });

    expect(output).toMatch(/[▀▄█]/u);
    expect(output).not.toContain("48;2;");
  });

  it("wraps descriptions and drops block art without UTF-8", () => {
    const output = renderRootHelp({
      colors: "none",
      background: "dark",
      unicode: false,
      width: 36,
    });

    expect(output).toContain("  sketchi\n");
    expect(output).not.toMatch(/[▀▄█]/u);
    expect(output.split("\n").every((line) => [...line].length <= 36)).toBe(
      true,
    );
  });

  it("uses ASCII unless the effective locale explicitly supports UTF-8", () => {
    expect(terminalSupportsUnicode({ TERM: "dumb", LANG: "en_US.UTF-8" })).toBe(
      false,
    );
    expect(terminalSupportsUnicode({ TERM: "xterm", LC_ALL: "C" })).toBe(false);
    expect(
      terminalSupportsUnicode({
        TERM: "xterm",
        LC_ALL: "POSIX",
        LANG: "en_US.UTF-8",
      }),
    ).toBe(false);
    expect(terminalSupportsUnicode({ TERM: "xterm" })).toBe(false);
    expect(
      terminalSupportsUnicode({ TERM: "xterm", LANG: "en_US.ISO-8859-1" }),
    ).toBe(false);
    expect(
      terminalSupportsUnicode({ TERM: "xterm", LANG: "en_US.UTF-8" }),
    ).toBe(true);
    expect(
      terminalSupportsUnicode({
        TERM: "xterm",
        LC_ALL: "",
        LANG: "C.UTF-8",
      }),
    ).toBe(true);
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
