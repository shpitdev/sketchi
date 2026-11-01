import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MarketingHome } from "./marketing-home";

describe("MarketingHome", () => {
	it("composes the hero, benefits, CLI, and icons", () => {
		render(<MarketingHome />);

		expect(screen.getByRole("heading", { name: "Editable diagrams from a prompt" })).toBeTruthy();
		expect(screen.getByRole("region", { name: "Why Sketchi" })).toBeTruthy();
		expect(screen.queryByRole("heading", { name: "Built on Excalidraw" })).toBeNull();
		expect(
			screen.getByRole("heading", {
				name: "Logos for your stack",
			}),
		).toBeTruthy();
		// The hero carries the call to action; no closing band repeats it.
		expect(screen.queryByRole("heading", { name: /first diagram/ })).toBeNull();
	});

	it("features the CLI on the homepage with a reachable anchor", () => {
		const { container } = render(<MarketingHome />);

		expect(
			screen.getByRole("heading", {
				name: "CLI",
			}),
		).toBeTruthy();
		expect(container.querySelector("#cli")).toBeTruthy();
		expect(screen.getByRole("link", { name: /View on npm/ }).getAttribute("href")).toBe(
			"https://www.npmjs.com/package/sketchi",
		);
	});

	it("uses configured surface URLs", () => {
		render(
			<MarketingHome
				surfaceUrls={{
					icons: "https://pr-42-sketchi-icons.dimethyl.workers.dev",
					playground: "https://pr-42-sketchi-studio.dimethyl.workers.dev",
				}}
			/>,
		);

		for (const link of screen.getAllByRole("link", {
			name: "Open playground",
		})) {
			expect(link.getAttribute("href")).toBe("https://pr-42-sketchi-studio.dimethyl.workers.dev");
		}

		expect(screen.getByRole("link", { name: "Browse icons" }).getAttribute("href")).toBe(
			"https://pr-42-sketchi-icons.dimethyl.workers.dev",
		);
	});
});
