import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BenefitStrip } from "./benefit-strip";

describe("BenefitStrip", () => {
	it("lists the three benefits with one line each", () => {
		render(<BenefitStrip />);

		const strip = screen.getByRole("region", { name: "Why Sketchi" });
		const items = within(strip).getAllByRole("listitem");

		expect(items.map((item) => item.querySelector(".benefit__title")?.textContent)).toEqual([
			"Native Excalidraw files",
			"Your agent or CLI",
			"Free, no account required",
		]);
		for (const item of items) {
			expect(item.querySelector(".benefit__detail")?.textContent).toBeTruthy();
		}
	});

	/**
	 * Sketchi itself is free, but an agent's model usage is billed by its own
	 * provider. The copy must not promise more than Sketchi controls.
	 */
	it("scopes the free claim to Sketchi", () => {
		render(<BenefitStrip />);

		expect(screen.getByText("Sketchi needs no sign-up, API key, or payment.")).toBeTruthy();
		expect(screen.queryByText(/free (model|tokens|usage)/i)).toBeNull();
	});

	it("keeps agent logos out of the strip", () => {
		const { container } = render(<BenefitStrip />);

		expect(container.querySelector("img")).toBeNull();
	});
});
