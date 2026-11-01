import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StudioHeader } from "./studio-header";

describe("StudioHeader", () => {
	it("pairs the Sketchi lockup with route links and the shared Docs and GitHub icons", () => {
		render(
			<StudioHeader>
				<a href="/projects">Projects</a>
			</StudioHeader>,
		);

		const home = screen.getByRole("link", { name: "Sketchi home" });
		expect(home.getAttribute("href")).toBe("https://sketchi.app");
		expect(home.querySelector("img")?.getAttribute("src")).toBe("/icon.svg");
		expect(home.textContent).toBe("Sketchi");
		expect(screen.queryByText(/playground/i)).toBeNull();

		expect(screen.getByRole("link", { name: "Projects" }).getAttribute("href")).toBe("/projects");
		expect(screen.getByRole("link", { name: "Docs" }).getAttribute("href")).toBe(
			"https://sketchi.app/docs",
		);
		const github = screen.getByRole("link", { name: "Sketchi on GitHub" });
		expect(github.getAttribute("href")).toBe("https://github.com/shpitdev/sketchi");
		expect(github.getAttribute("target")).toBe("_blank");
	});
});
