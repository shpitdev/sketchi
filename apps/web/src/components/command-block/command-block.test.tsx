import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CommandBlock } from "./command-block";

describe("CommandBlock", () => {
	it("keeps multi-line commands intact beside a labeled copy button", () => {
		const value =
			"opencode mcp add sketchi-code-mode \\\n  --url https://playground.sketchi.app/mcp";
		render(<CommandBlock label="connect command" value={value} />);

		const code = screen.getByLabelText("connect command");
		expect(code.textContent).toBe(value);
		expect(code.closest("[data-kind]")?.getAttribute("data-kind")).toBe("code");
		expect(screen.getByRole("button", { name: "Copy connect command" })).toBeTruthy();
	});

	it("marks chat prompts as prose so they wrap between words", () => {
		render(<CommandBlock kind="prose" label="first prompt" value="Draw a flowchart." />);

		expect(
			screen.getByLabelText("first prompt").closest("[data-kind]")?.getAttribute("data-kind"),
		).toBe("prose");
	});
});
