import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CopyButton } from "./copy-button";

describe("CopyButton", () => {
  it("renders a labeled copy control", () => {
    render(<CopyButton label="demo command" value="echo hi" />);

    const button = screen.getByRole("button", { name: "Copy demo command" });
    expect(button).toBeTruthy();
    expect(button.textContent).toContain("Copy");
  });
});
