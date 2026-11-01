import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HomeHero } from "./home-hero";

describe("HomeHero", () => {
	it("renders the headline and primary actions", () => {
		render(<HomeHero />);

		expect(
			screen.getByRole("heading", { name: "Editable diagrams from a prompt", level: 1 }),
		).toBeTruthy();
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
