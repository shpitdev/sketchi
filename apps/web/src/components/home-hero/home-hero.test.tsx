import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HomeHero } from "./home-hero";

describe("HomeHero", () => {
	it("renders the headline and primary actions", () => {
		render(<HomeHero />);

		expect(screen.getByRole("heading", { name: /Sketchi draws it/i })).toBeTruthy();
		const primaryAction = screen.getByRole("link", {
			name: "Open playground",
		});
		expect(primaryAction).toHaveProperty("href", "https://playground.sketchi.app/");
		expect(primaryAction.dataset.variant).toBe("brand");
		expect(screen.getByRole("link", { name: "Add to your agent" })).toHaveProperty(
			"href",
			"http://localhost:3000/agents",
		);
	});

	it("lets the headline and the board say what Sketchi is, without a subtitle", () => {
		const { container } = render(<HomeHero />);

		expect(container.querySelector(".home-hero__copy p")).toBeNull();
	});

	it("labels the sketched diagram illustration", () => {
		render(<HomeHero />);

		expect(screen.getByRole("img", { name: /hand-drawn flowchart/i })).toBeTruthy();
	});

	it("draws four complete connectors behind the flowchart nodes", () => {
		const { container } = render(<HomeHero />);

		const connectors = container.querySelectorAll(".sketch-board__wires .wire");
		expect(connectors).toHaveLength(4);
		expect(connectors[3]?.getAttribute("d")).toContain("L34 36");
		expect(connectors[3]?.getAttribute("d")).toContain("L52 21");
	});
});
