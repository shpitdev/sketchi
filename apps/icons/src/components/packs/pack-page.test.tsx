import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { PackIcon, PackSummary } from "../../lib/packs";
import { TestIntersectionObserver } from "../../test-support/intersection-observer";
import { PackPage } from "./pack-page";

const icons: PackIcon[] = Array.from({ length: 120 }, (_, index) => ({
	slug: `app-${index}`,
	name: `App ${index}`,
	recipe: { parts: [{ kind: "rect", x: 4, y: 4, width: 16, height: 16 }] },
}));

const pack: PackSummary = {
	id: "palantir",
	name: "Palantir",
	version: "0123456789abcdef",
	count: 120,
	preview: [],
};

describe("PackPage", () => {
	// The page loads the export code on first use; loading it here keeps its
	// transform time out of the clipboard waits.
	beforeAll(() => import("../../lib/excalidraw-export"));

	beforeEach(() => {
		vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		window.localStorage.clear();
	});

	it("names the pack, with its size and its download, before its icons load", () => {
		render(<PackPage pack={pack} status="loading" />);
		expect(screen.getByRole("heading", { level: 1, name: "Palantir" })).toBeTruthy();
		expect(screen.getByText("120 icons")).toBeTruthy();
		expect(screen.getByRole("link", { name: "Download" }).getAttribute("href")).toBe(
			"/packs/palantir.excalidrawlib",
		);
		// No install link yet: nothing on the page sends a pack to excalidraw.com.
		expect(screen.queryByRole("link", { name: "Add to Excalidraw" })).toBeNull();
		expect(document.querySelector('a[href*="excalidraw.com"]')).toBeNull();
		expect(screen.getByLabelText("Loading icons")).toBeTruthy();
		const nav = screen.getByRole("navigation", { name: "Icon sets" });
		expect(within(nav).queryByRole("link", { current: "page" })).toBeNull();
	});

	it("draws every icon with its product name as the page scrolls", () => {
		render(<PackPage icons={icons} pack={pack} status="ready" />);
		const grid = screen.getByRole("region", { name: "Palantir" });
		expect(within(grid).getAllByRole("article")).toHaveLength(96);
		expect(within(grid).getByText("App 0")).toBeTruthy();
		act(() => TestIntersectionObserver.scrollNearEnd());
		expect(within(grid).getAllByRole("article")).toHaveLength(120);
		expect(within(grid).getByText("App 119")).toBeTruthy();
	});

	it("copies an icon as Excalidraw shapes", async () => {
		const writeText = vi.fn(async (_value: string) => {});
		Object.assign(navigator, { clipboard: { writeText } });
		render(<PackPage icons={icons} pack={pack} status="ready" />);
		fireEvent.click(screen.getByRole("button", { name: "Copy App 3 for Excalidraw" }));
		await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
		expect(JSON.parse(writeText.mock.calls[0]?.[0] ?? "{}")).toMatchObject({
			type: "excalidraw/clipboard",
		});
		expect(await screen.findByText("App 3 copied. Paste it into Excalidraw.")).toBeTruthy();
	});

	it("writes names under the drawings, and copies and downloads them that way, until turned off", async () => {
		const writeText = vi.fn(async (_value: string) => {});
		Object.assign(navigator, { clipboard: { writeText } });
		render(
			<PackPage
				excalidraw={{ publishable: true }}
				icons={icons.slice(0, 3)}
				pack={pack}
				status="ready"
			/>,
		);
		const names = screen.getByRole("button", { name: "Names", pressed: false });
		expect(screen.getByRole("button", { name: "Publish to Excalidraw" })).toBeTruthy();

		fireEvent.click(names);
		expect(names.getAttribute("aria-pressed")).toBe("true");
		const download = screen.getByRole("link", { name: "Download with names" });
		expect(download.getAttribute("href")).toBe("/packs/palantir-with-names.excalidrawlib");
		expect(download.getAttribute("download")).toBe("sketchi-palantir-with-names.excalidrawlib");
		// Excalidraw's collection only has the plain library.
		expect(screen.queryByRole("button", { name: "Publish to Excalidraw" })).toBeNull();
		const tile = screen.getByRole("button", { name: "Copy App 1 for Excalidraw" });
		expect(tile.querySelector(".drawn-icon__name")?.textContent).toBe("App 1");

		fireEvent.click(tile);
		await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
		const pasted = JSON.parse(writeText.mock.calls[0]?.[0] ?? "{}") as {
			elements: { type: string; text?: string; groupIds: string[] }[];
		};
		expect(pasted.elements.at(-1)).toMatchObject({
			type: "text",
			text: "App 1",
			groupIds: ["catalog-app-1-named"],
		});

		fireEvent.click(names);
		expect(screen.getByRole("link", { name: "Download" }).getAttribute("href")).toBe(
			"/packs/palantir.excalidrawlib",
		);
		expect(tile.querySelector(".drawn-icon__name")).toBeNull();
	});

	it("previews dark Excalidraw with a canvas filter, without repainting the recipe", () => {
		const colored: PackIcon = {
			slug: "colored",
			name: "Colored",
			recipe: {
				parts: [
					{ kind: "rect", x: 2, y: 2, width: 20, height: 20, fill: "#c87619" },
					{ kind: "ellipse", cx: 12, cy: 12, rx: 4, ry: 4, fill: "paper" },
				],
			},
		};
		render(<PackPage icons={[colored]} pack={pack} status="ready" />);
		const svg = screen
			.getByRole("button", { name: "Copy Colored for Excalidraw" })
			.querySelector("svg")!;
		const paint = () =>
			[...svg.querySelectorAll("path")].map((path) => [
				path.getAttribute("fill"),
				path.getAttribute("stroke"),
			]);
		const light = paint();
		fireEvent.click(screen.getByRole("button", { name: "Dark preview" }));
		expect(paint()).toEqual(light);
		expect(svg.getAttribute("filter")).toBe("invert(93%) hue-rotate(180deg)");
		fireEvent.click(screen.getByRole("button", { name: "Light preview" }));
		expect(svg.getAttribute("filter")).toBeNull();
		expect(paint()).toEqual(light);
	});

	it("offers a retry when the icons cannot load", () => {
		const onRetry = vi.fn();
		render(
			<PackPage
				errorMessage="Drawings returned HTTP 503."
				onRetry={onRetry}
				pack={pack}
				status="error"
			/>,
		);
		expect(screen.getByRole("alert").textContent).toContain("Drawings returned HTTP 503.");
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		expect(onRetry).toHaveBeenCalledTimes(1);
	});
});
