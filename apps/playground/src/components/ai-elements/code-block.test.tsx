import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CodeBlock } from "./code-block";
import { studioStreamdownPlugins } from "./streamdown-plugins";

const padding = "x".repeat(110);
const json = (value: string) => JSON.stringify({ padding, value, tail: padding }, null, 2);

// Each source line renders as one block span; an empty line renders "\n".
const renderedSource = (container: HTMLElement) =>
  [...(container.querySelector("pre code")?.children ?? [])]
    .map((line) => (line.textContent === "\n" ? "" : line.textContent))
    .join("\n");

const isHighlighted = (container: HTMLElement) =>
  [...container.querySelectorAll("pre code span span")].some(
    (span) => (span as HTMLElement).style.color !== "inherit",
  );

describe("CodeBlock", () => {
  it("shows raw source before highlighting finishes, then highlighted tokens", async () => {
    const source = json("before");
    const { container } = render(<CodeBlock code={source} language="json" />);

    expect(renderedSource(container)).toBe(source);
    await waitFor(() => expect(isHighlighted(container)).toBe(true));
    expect(renderedSource(container)).toBe(source);
  });

  it("renders the current source after a same-length edit in the middle", async () => {
    const before = json("before");
    const after = json("after!");
    expect(after).toHaveLength(before.length);

    const { container, rerender } = render(<CodeBlock code={before} language="json" />);
    await waitFor(() => expect(isHighlighted(container)).toBe(true));

    rerender(<CodeBlock code={after} language="json" />);
    expect(renderedSource(container)).toBe(after);
    await waitFor(() => expect(isHighlighted(container)).toBe(true));
    expect(renderedSource(container)).toBe(after);
  });

  it("ignores a late highlight of the previous source after an edit", async () => {
    const before = json("pending-before");
    const after = json("pending-after!");
    const { container, rerender } = render(<CodeBlock code={before} language="json" />);

    // Edit before the first highlight resolves, then let both complete.
    rerender(<CodeBlock code={after} language="json" />);
    await waitFor(() => expect(isHighlighted(container)).toBe(true));
    // Wait until the plugin has also finished highlighting the old source.
    await new Promise<void>((resolve) => {
      const { code } = studioStreamdownPlugins;
      const options = { code: before, language: "json", themes: code.getThemes() } as const;
      if (code.highlight(options, () => resolve())) resolve();
    });
    expect(renderedSource(container)).toBe(after);
  });
});
