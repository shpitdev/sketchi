import { describe, expect, it } from "vitest";

import {
  boundLabelWidth,
  DEFAULT_GLYPH_UNITS,
  estimateTextWidth,
  textLineUnits,
  wrapTextToUnits,
  wrapTextToWidth,
} from "./text-metrics";

const EIGHTEEN_GLYPHS = 18 * DEFAULT_GLYPH_UNITS;

describe("label text metrics", () => {
  it("weights glyphs by the width Excalidraw paints them at", () => {
    expect(textLineUnits("review")).toBe(6 * 62);
    expect(textLineUnits("QA")).toBe(2 * 62);
    expect(textLineUnits("品質")).toBe(2 * 100);
    expect(textLineUnits("한글")).toBe(2 * 100);
    // One astral emoji is one glyph, and its variation selector is zero-width.
    expect(textLineUnits("🚀")).toBe(130);
    expect(textLineUnits("❤️")).toBe(130);
    expect(estimateTextWidth("ab\n品質保証", 10)).toBe(40);
  });

  it("counts each grapheme cluster once", () => {
    // ZWJ family, flag, keycap, and a decomposed accent are single glyphs.
    expect(textLineUnits("👨‍👩‍👧")).toBe(130);
    expect(textLineUnits("🇯🇵")).toBe(130);
    expect(textLineUnits("1️⃣")).toBe(130);
    expect(textLineUnits("é")).toBe(62);
    expect(wrapTextToUnits("👨‍👩‍👧👨‍👩‍👧", 130)).toBe("👨‍👩‍👧\n👨‍👩‍👧");
  });

  it("keeps text-presentation symbols at the default width", () => {
    expect(textLineUnits("©®™✔⚠➡↔")).toBe(7 * 62);
    expect(textLineUnits("✔️")).toBe(130);
    expect(textLineUnits("✅")).toBe(130);
  });

  it("keeps the historical width expression for default-width text", () => {
    for (const [line, fontSize] of [
      ["Release approval flow", 14],
      ["Concrete operation 33", 16],
      ["a".repeat(21), 16],
    ] as const) {
      expect(estimateTextWidth(line, fontSize)).toBe(
        line.length * fontSize * 0.62,
      );
    }
  });

  it("grows a label box past maxWidth only beyond its canvas padding", () => {
    // A 64px box plus 8px canvas padding per side holds the 79.36px estimate.
    expect(boundLabelWidth("Cell 100", 16, 56)).toBe(64);
    expect(boundLabelWidth("Cell 10", 16, 56)).toBe(56);
    expect(boundLabelWidth("Quality assurance review", 16, 116)).toBe(223);
    expect(boundLabelWidth("Short", 16, 116)).toBe(50);
  });

  it("wraps lowercase Latin at eighteen glyphs per line", () => {
    expect(
      wrapTextToUnits(
        "review the certificate of analysis and record deviations",
        EIGHTEEN_GLYPHS,
      ),
    ).toBe("review the\ncertificate of\nanalysis and\nrecord deviations");
    expect(
      wrapTextToUnits("supercalifragilisticexpialidocious", EIGHTEEN_GLYPHS),
    ).toBe("supercalifragilist\nicexpialidocious");
  });

  it("breaks unspaced CJK between glyphs and keeps authored line breaks", () => {
    expect(wrapTextToUnits("品質保証レビュー承認待ち", 1000)).toBe(
      "品質保証レビュー承認\n待ち",
    );
    expect(wrapTextToUnits("one\ntwo", EIGHTEEN_GLYPHS)).toBe("one\ntwo");
  });

  it("never splits a surrogate pair", () => {
    expect(wrapTextToUnits("🚀🚀🚀", 200).split("\n")).toEqual([
      "🚀",
      "🚀",
      "🚀",
    ]);
  });

  it("converts a pixel width to whole units without floating-point drift", () => {
    const line = "a".repeat(18);
    expect(wrapTextToWidth(line, 18 * 0.62 * 14, 14)).toBe(line);
  });
});
