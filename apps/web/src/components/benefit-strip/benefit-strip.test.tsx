import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BenefitStrip } from "./benefit-strip";

describe("BenefitStrip", () => {
	it("pairs each short title with its own visual", () => {
		render(<BenefitStrip />);

		const strip = screen.getByRole("region", { name: "Why Sketchi" });
		const items = within(strip).getAllByRole("listitem");

		expect(items.map((item) => item.querySelector(".benefit__title")?.textContent)).toEqual([
			"Native .excalidraw files",
			"Works in your agent or CLI",
			"No account or API key",
		]);
		for (const item of items) {
			expect(item.querySelector(".benefit__visual")?.childElementCount).toBe(1);
		}
	});

	it("uses the real agent marks and no generic glyphs", () => {
		const { container } = render(<BenefitStrip />);

		expect([...container.querySelectorAll("img")].map((img) => img.getAttribute("src"))).toEqual([
			"/agents/codex.svg",
			"/agents/claude-code.svg",
			"/agents/opencode.svg",
		]);
		expect(container.querySelector("svg.lucide")).toBeNull();
	});

	/**
	 * Sketchi itself is free, but an agent's model usage is billed by its own
	 * provider. The strip must not promise more than Sketchi controls.
	 */
	it("scopes the free claim to Sketchi", () => {
		render(<BenefitStrip />);

		expect(screen.getByText("$0")).toBeTruthy();
		expect(screen.queryByText(/free (model|tokens|usage)/i)).toBeNull();
		expect(screen.queryByText(/unlimited/i)).toBeNull();
	});
});
