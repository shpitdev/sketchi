import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { PackSummary } from "../../lib/packs";
import { PackShelf } from "./pack-shelf";

function pack(id: string, name: string): PackSummary {
	return { id, name, version: "0123456789abcdef", count: 10, preview: [] };
}

describe("PackShelf", () => {
	it("puts the packs after the vendor packs behind More packs", () => {
		const { container } = render(
			<PackShelf
				packs={[
					pack("all", "All icons"),
					pack("aws", "AWS"),
					pack("data", "Data & backend"),
					pack("devtools", "Developer tools"),
				]}
				previewMode="light"
			/>,
		);
		const shelf = container.querySelector(".pack-shelf");
		const more = screen.getByRole("button", { name: "2 more packs" });
		expect(shelf?.getAttribute("data-expanded")).toBe("false");
		expect(more.getAttribute("aria-expanded")).toBe("false");
		expect(
			[...container.querySelectorAll('.pack-card[data-more="true"]')].map(
				(card) => card.textContent,
			),
		).toEqual([
			expect.stringContaining("Data & backend"),
			expect.stringContaining("Developer tools"),
		]);

		fireEvent.click(more);
		expect(shelf?.getAttribute("data-expanded")).toBe("true");
		expect(screen.getByRole("button", { name: "Fewer packs" }).getAttribute("aria-expanded")).toBe(
			"true",
		);
	});

	it("offers no More packs when every pack shows first", () => {
		render(
			<PackShelf packs={[pack("all", "All icons"), pack("aws", "AWS")]} previewMode="light" />,
		);
		expect(screen.queryByRole("button", { name: /more packs/u })).toBeNull();
	});
});
