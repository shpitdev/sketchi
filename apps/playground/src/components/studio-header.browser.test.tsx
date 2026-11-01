import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import "../styles/app.css";
import { IconActionBar, IconButton, IconLink } from "./sketch-icons/icon-action";
import { StudioHeader } from "./studio-header";

afterEach(cleanup);

// The app root loads Hanken Grotesk from Google Fonts and the Excalifont
// wordmark from /fonts; row measurements are only meaningful with both real
// faces loaded, not fallback metrics.
const HANKEN_STYLESHEET =
	"https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400..700&display=swap";

beforeAll(async () => {
	const link = document.createElement("link");
	link.rel = "stylesheet";
	link.href = HANKEN_STYLESHEET;
	await new Promise<void>((resolve, reject) => {
		link.onload = () => resolve();
		link.onerror = () => reject(new Error("Hanken Grotesk stylesheet failed to load"));
		document.head.append(link);
	});
});

async function renderWithFonts(ui: Parameters<typeof render>[0]) {
	render(ui);
	await Promise.all([
		document.fonts.load('600 14.5px "Hanken Grotesk"', "Playground Projects"),
		document.fonts.load("28px Excalifont", "Sketchi"),
	]);
	await document.fonts.ready;
	expect(document.fonts.check('600 14.5px "Hanken Grotesk"', "Playground")).toBe(true);
	expect(document.fonts.check("28px Excalifont", "Sketchi")).toBe(true);
}

/** Distinct row tops among the header's visible controls. */
function rowsOf(header: HTMLElement) {
	const controls = [...header.querySelectorAll("a, button")].filter((control) => {
		const { height, width } = control.getBoundingClientRect();
		return width > 0 && height > 0;
	});
	const tops: number[] = [];
	for (const control of controls) {
		const { top } = control.getBoundingClientRect();
		if (!tops.some((rowTop) => Math.abs(rowTop - top) < 12)) tops.push(top);
	}
	return tops.length;
}

function expectWithinViewport(header: HTMLElement) {
	expect(document.documentElement.scrollWidth).toBe(document.documentElement.clientWidth);
	for (const control of header.querySelectorAll("a, button")) {
		const { left, right } = control.getBoundingClientRect();
		expect(left).toBeGreaterThanOrEqual(0);
		expect(right).toBeLessThanOrEqual(innerWidth);
	}
}

/** The artifact page header: a route link and five icon actions. */
function ArtifactHeader() {
	return (
		<StudioHeader className="studio-header--ruled">
			<a className="studio-header__link" href="/">
				Playground
			</a>
			<IconActionBar>
				<IconLink href="/diagrams/source" icon="review" label="Source diagram" />
				<IconButton icon="save" label="Save to Studio" tone="primary" />
				<IconLink href="/artifacts/a/edit" icon="edit" label="Edit" />
				<IconLink href="/artifacts/a/scene" icon="scene" label="Scene file" />
				<IconLink href="/artifacts/a/drawing" icon="drawing" label="Drawing file" />
			</IconActionBar>
		</StudioHeader>
	);
}

describe("StudioHeader layout", () => {
	for (const width of [320, 390]) {
		it(`puts route actions on one row under the lockup and Docs/GitHub at ${width}px`, async () => {
			await page.viewport(width, 700);
			await renderWithFonts(<ArtifactHeader />);
			const header = document.querySelector<HTMLElement>(".studio-header");
			if (!header) throw new Error("Missing header");

			expect(rowsOf(header)).toBe(2);
			expectWithinViewport(header);

			const top = (name: string) => screen.getByRole("link", { name }).getBoundingClientRect().top;
			const brand = screen.getByRole("link", { name: "Sketchi home" }).getBoundingClientRect();
			// Lockup and Docs/GitHub share the first row; the route row sits below.
			expect(Math.abs(top("Docs") - top("Sketchi home"))).toBeLessThan(brand.height);
			expect(top("Sketchi on GitHub")).toBe(top("Docs"));
			expect(top("Playground")).toBeGreaterThanOrEqual(brand.bottom);
			expect(Math.abs(top("Edit") - top("Playground"))).toBeLessThan(brand.height);
			// Links start the row, actions end it.
			const drawing = screen.getByRole("link", { name: "Drawing file" }).getBoundingClientRect();
			const github = screen
				.getByRole("link", { name: "Sketchi on GitHub" })
				.getBoundingClientRect();
			expect(Math.abs(drawing.right - github.right)).toBeLessThan(2);
		});

		it(`keeps a route with only links on one row at ${width}px`, async () => {
			await page.viewport(width, 700);
			await renderWithFonts(
				<StudioHeader>
					<a className="studio-header__link" href="/projects">
						Projects
					</a>
				</StudioHeader>,
			);
			const header = document.querySelector<HTMLElement>(".studio-header");
			if (!header) throw new Error("Missing header");

			expect(rowsOf(header)).toBe(1);
			expectWithinViewport(header);
		});
	}

	it("keeps every desktop header on one row", async () => {
		await page.viewport(1280, 700);
		await renderWithFonts(<ArtifactHeader />);
		const header = document.querySelector<HTMLElement>(".studio-header");
		if (!header) throw new Error("Missing header");

		expect(rowsOf(header)).toBe(1);
		const order = ["Sketchi home", "Playground", "Drawing file", "Docs"].map(
			(name) => screen.getByRole("link", { name }).getBoundingClientRect().left,
		);
		expect(order).toEqual([...order].sort((a, b) => a - b));
	});
});
