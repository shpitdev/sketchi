import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CtaBand } from "./cta-band";

describe("CtaBand", () => {
	it("points the primary action at the playground", () => {
		render(<CtaBand playgroundHref="https://play.example.test" />);

		expect(screen.getByRole("heading", { name: "Describe your first diagram." })).toBeTruthy();
		const primaryAction = screen.getByRole("link", {
			name: "Open playground",
		});
		expect(primaryAction).toHaveProperty("href", "https://play.example.test/");
		expect(primaryAction.dataset.variant).toBe("brand");
	});

	/**
	 * The hero already offers the agent route and the CLI has its own section,
	 * so the closing sheet repeats only the one primary action.
	 */
	it("closes on one primary action", () => {
		const { container } = render(<CtaBand />);

		expect(container.querySelectorAll(".cta-band__actions a")).toHaveLength(1);
		expect(screen.queryByRole("link", { name: /coding agent/ })).toBeNull();
		expect(screen.queryByRole("link", { name: /install the CLI/ })).toBeNull();
	});
});
