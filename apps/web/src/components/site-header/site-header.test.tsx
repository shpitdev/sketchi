import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SiteHeader } from "./site-header";

describe("SiteHeader", () => {
	it("renders the brand, primary nav, and playground CTA", () => {
		render(<SiteHeader activePath="/docs" />);

		const brand = screen.getByRole("link", { name: "Sketchi home" });
		expect(brand.getAttribute("href")).toBe("/");
		expect(brand.querySelector(".site-header__brand-icon")).toBeTruthy();
		expect(brand.querySelector(".sk-wordmark")?.textContent).toBe("Sketchi");
		expect(screen.queryByRole("link", { name: "Product" })).toBeNull();
		expect(screen.getByRole("link", { name: "Playground" }).dataset.variant).toBe("brand");
		expect(screen.getByRole("link", { name: "Sketchi on GitHub" }).getAttribute("href")).toBe(
			"https://github.com/shpitdev/sketchi",
		);
		expect(screen.getByRole("link", { name: "sketchi on npm" }).getAttribute("href")).toBe(
			"https://www.npmjs.com/package/sketchi",
		);
		const docs = screen.getByRole("link", { name: "Docs" });
		expect(docs.getAttribute("href")).toBe("/docs");
		expect(docs.getAttribute("aria-current")).toBe("page");
		expect(docs.querySelector("svg.lucide-book-open")).toBeTruthy();
	});

	it("uses configured surface action URLs", () => {
		render(
			<SiteHeader
				surfaceUrls={{
					icons: "https://pr-42-sketchi-icons.dimethyl.workers.dev",
					playground: "https://pr-42-sketchi-studio.dimethyl.workers.dev",
				}}
			/>,
		);

		expect(screen.getByRole("link", { name: "Icons" }).getAttribute("href")).toBe(
			"https://pr-42-sketchi-icons.dimethyl.workers.dev",
		);
		expect(screen.getByRole("link", { name: "Playground" }).getAttribute("href")).toBe(
			"https://pr-42-sketchi-studio.dimethyl.workers.dev",
		);
	});

	/**
	 * The header is the brand, Icons, Docs, the source marks, and Playground.
	 * CLI and agent setup are reached from the homepage and footer instead.
	 */
	it("keeps CLI and Agents out of the header by default", () => {
		render(<SiteHeader />);

		expect(screen.queryByRole("navigation", { name: "Primary" })).toBeNull();
		expect(screen.queryByRole("link", { name: "CLI" })).toBeNull();
		expect(screen.queryByRole("link", { name: "Agents" })).toBeNull();
		expect(screen.getByRole("link", { name: "Docs" }).getAttribute("aria-current")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Toggle menu" }));

		expect(screen.queryByRole("link", { name: "CLI" })).toBeNull();
		expect(
			screen.getAllByRole("link", { name: "Docs" }).map((link) => link.getAttribute("href")),
		).toEqual(["/docs", "/docs"]);
	});

	it("still renders custom nav items in the bar and the sheet", () => {
		render(
			<SiteHeader
				activePath="/changelog"
				navItems={[{ href: "/changelog", label: "Changelog" }]}
			/>,
		);

		expect(screen.getByRole("navigation", { name: "Primary" })).toBeTruthy();
		expect(screen.getByRole("link", { name: "Changelog" }).getAttribute("aria-current")).toBe(
			"page",
		);

		fireEvent.click(screen.getByRole("button", { name: "Toggle menu" }));

		expect(screen.getAllByRole("link", { name: "Changelog" })).toHaveLength(2);
	});

	/**
	 * The header actions are hidden on narrow viewports, so both source marks
	 * have to survive into the sheet or they vanish on mobile entirely.
	 */
	it("carries the GitHub and npm marks into the mobile sheet", () => {
		render(<SiteHeader />);

		fireEvent.click(screen.getByRole("button", { name: "Toggle menu" }));

		expect(screen.getByRole("link", { name: "GitHub" }).getAttribute("href")).toBe(
			"https://github.com/shpitdev/sketchi",
		);
		expect(
			screen
				.getAllByRole("link", { name: "sketchi on npm" })
				.map((link) => link.getAttribute("href")),
		).toEqual(["https://www.npmjs.com/package/sketchi", "https://www.npmjs.com/package/sketchi"]);
	});

	it("toggles the mobile menu", () => {
		render(<SiteHeader />);

		const toggle = screen.getByRole("button", { name: "Toggle menu" });
		expect(toggle.getAttribute("aria-expanded")).toBe("false");

		fireEvent.click(toggle);
		expect(toggle.getAttribute("aria-expanded")).toBe("true");
	});
});
