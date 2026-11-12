import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ICON_PACK_LINKS, IconWall } from "./icon-wall";

describe("IconWall", () => {
	it("links to the configured icon library", () => {
		render(<IconWall iconsHref="https://icons.example.test" />);

		expect(screen.getByRole("heading", { name: "Product logos and icon packs" })).toBeTruthy();
		expect(screen.getByRole("link", { name: "Browse icons" })).toHaveProperty(
			"href",
			"https://icons.example.test/",
		);
	});

	it("links each vendor pack to its page on Sketchi Icons", () => {
		render(<IconWall iconsHref="https://icons.example.test/" />);

		const packs = screen.getByRole("list", { name: "Icon packs" });
		expect(
			[...packs.querySelectorAll("a")].map((link) => [link.textContent, link.getAttribute("href")]),
		).toEqual(
			ICON_PACK_LINKS.map((pack) => [pack.name, `https://icons.example.test/packs/${pack.id}`]),
		);
		expect(ICON_PACK_LINKS.map((pack) => pack.name)).toEqual([
			"Palantir",
			"AWS",
			"Google Cloud",
			"Databricks",
			"Snowflake",
			"SaaS & payments",
		]);
	});

	it("keeps every logo unique within each marquee cycle", () => {
		const { container } = render(<IconWall />);
		const cycles = [...container.querySelectorAll("[data-icon-cycle]")];

		expect(cycles).toHaveLength(4);
		for (const cycle of cycles) {
			const sources = [...cycle.querySelectorAll("img")].map((image) => image.getAttribute("src"));
			expect(sources.length).toBeGreaterThanOrEqual(13);
			expect(new Set(sources).size).toBe(sources.length);
		}
	});
});
