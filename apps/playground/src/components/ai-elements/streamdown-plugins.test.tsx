import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MessageResponse } from "./message";
import { studioStreamdownPlugins } from "./streamdown-plugins";

describe("studioStreamdownPlugins", () => {
  it("keeps assistant markdown from registering alternate diagram renderers", () => {
    expect(Object.keys(studioStreamdownPlugins).sort()).toEqual([
      "cjk",
      "code",
      "math",
    ]);
  });

  it("renders Mermaid fences as source text instead of a diagram surface", () => {
    render(
      <MessageResponse>
        {"```mermaid\ngraph TD\n  A[Input] --> B[Output]\n```"}
      </MessageResponse>,
    );

    expect(screen.getByText(/graph TD/)).toBeTruthy();
    expect(document.querySelector("pre, code")?.textContent).toContain(
      "graph TD",
    );
    expect(document.querySelector(".mermaid")).toBeNull();
  });

  it("typesets display math and keeps invalid TeX readable", () => {
    render(
      <MessageResponse>
        {"$$\n\\frac{a}{b} + \\sqrt{x}\n$$\n\n$$\n\\notacommand{x}\n$$"}
      </MessageResponse>,
    );

    const [valid, invalid] = document.querySelectorAll(
      ".katex-display .katex-mathml",
    );
    expect(valid?.querySelector("mfrac")).not.toBeNull();
    expect(valid?.querySelector("msqrt")).not.toBeNull();
    // Unknown commands stay visible in the error colour instead of failing
    // the whole message.
    expect(invalid?.querySelector("mstyle[mathcolor] mtext")?.textContent).toBe(
      "\\notacommand",
    );
  });
});
