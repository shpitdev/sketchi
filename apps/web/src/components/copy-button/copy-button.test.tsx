import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CopyButton } from "./copy-button";

describe("CopyButton", () => {
	it("renders an icon button named for what it copies", () => {
		render(<CopyButton label="demo command" value="echo hi" />);

		const button = screen.getByRole("button", { name: "Copy demo command" });
		expect(button.querySelector("svg")).toBeTruthy();
		expect(button.getAttribute("data-variant")).toBe("code");
	});
});
