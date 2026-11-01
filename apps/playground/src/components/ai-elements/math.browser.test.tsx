import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import "../../styles/app.css";
import { MessageResponse } from "./message";

afterEach(cleanup);

const markdown = [
  "Pythagoras says $$a^2 + b^2 = c^2$$ for right triangles.",
  "$$\n\\frac{a}{b} + \\sqrt{x}\n$$",
  "$$\n\\notacommand{x}\n$$",
].join("\n\n");

function visible(element: Element) {
  const { height, width } = element.getBoundingClientRect();
  return width > 1 && height > 1;
}

describe("chat math rendering", () => {
  it("typesets inline, display and invalid TeX with the KaTeX stylesheet", async () => {
    render(<MessageResponse>{markdown}</MessageResponse>);

    const displays = await waitFor(() => {
      const found = document.querySelectorAll(".katex-display");
      expect(found).toHaveLength(2);
      return found;
    });
    await document.fonts.ready;

    const inline = [...document.querySelectorAll(".katex")].find(
      (element) => !element.closest(".katex-display"),
    );
    expect(inline?.closest("p")?.textContent).toContain("for right triangles");

    for (const katex of document.querySelectorAll(".katex")) {
      // The MathML copy is for assistive technology only; the HTML layout is
      // what readers see. Without the stylesheet both show side by side.
      const mathml = katex.querySelector(".katex-mathml");
      const html = katex.querySelector(".katex-html");
      expect(mathml && visible(mathml)).toBe(false);
      expect(html && visible(html)).toBe(true);
      expect(getComputedStyle(katex).fontFamily).toContain("KaTeX_Main");
    }
    expect(document.fonts.check("16px KaTeX_Main")).toBe(true);

    const [formula, invalid] = displays;
    expect(getComputedStyle(formula as Element).textAlign).toBe("center");
    const fractionBar = formula?.querySelector(".frac-line");
    expect(fractionBar && getComputedStyle(fractionBar).borderBottomStyle).toBe("solid");
    // The bar is a hairline border, so only its width is substantial.
    expect(fractionBar?.getBoundingClientRect().width).toBeGreaterThan(8);
    expect(fractionBar?.getBoundingClientRect().height).toBeGreaterThan(0);

    // An unknown command stays readable in the error colour instead of
    // breaking the message.
    const error = [...(invalid?.querySelectorAll(".katex-html *") ?? [])].find(
      (element) => element.textContent === "\\notacommand" && element.children.length === 0,
    );
    expect(error && visible(error)).toBe(true);
    expect(error && getComputedStyle(error).color).not.toBe(
      getComputedStyle(formula as Element).color,
    );
  });
});
