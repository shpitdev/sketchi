import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HomeHero } from "./home-hero";

describe("HomeHero", () => {
	it("says what Sketchi makes and offers the two ways to start", () => {
		render(<HomeHero />);

		expect(
			screen.getByRole("heading", { name: "Excalidraw diagrams from a description", level: 1 }),
		).toBeTruthy();
		const primaryAction = screen.getByRole("link", { name: "Open Playground" });
		expect(primaryAction).toHaveProperty("href", "https://playground.sketchi.app/");
		expect(primaryAction.dataset.variant).toBe("brand");
		expect(screen.getByRole("link", { name: "Add to your agent" })).toHaveProperty(
			"href",
			"http://localhost:3000/agents",
		);
	});

	/** The paragraph adds what the heading does not say: logos, and that it stays editable. */
	it("adds logos and editing to the heading, without repeating it", () => {
		const { container } = render(<HomeHero />);

		const lead = container.querySelector(".home-hero__lead")?.textContent ?? "";
		expect(lead).toMatch(/logo/);
		expect(lead).toMatch(/editable/);
		expect(lead).not.toMatch(/Excalidraw diagrams/);
	});

	/**
	 * The agent action leads with the real marks of agents that have a setup
	 * page, and keeps a visible label so the logos never have to explain
	 * themselves.
	 */
	it("shows the Codex, Claude Code, and OpenCode marks on the agent action", () => {
		render(<HomeHero />);

		const action = screen.getByRole("link", { name: "Add to your agent" });
		expect(action.getAttribute("title")).toBe("Set up Sketchi in Codex, Claude Code, or OpenCode");
		expect(
			[...action.querySelectorAll(".agent-action__logo img")].map((img) => img.getAttribute("src")),
		).toEqual(["/agents/codex.svg", "/agents/claude-code.svg", "/agents/opencode.svg"]);
		expect(action.querySelector(".agent-action__stack")?.getAttribute("aria-hidden")).toBe("true");
	});

	it("shows a diagram Sketchi made, ready to edit", () => {
		render(<HomeHero />);

		expect(screen.getByRole("img", { name: /hand-drawn architecture diagram/i })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Edit diagram" })).toBeTruthy();
	});
});
