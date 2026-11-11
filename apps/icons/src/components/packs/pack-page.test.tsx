import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PackIcon, PackSummary } from "../../lib/packs";
import { TestIntersectionObserver } from "../../test-support/intersection-observer";
import { PackPage } from "./pack-page";

const icons: PackIcon[] = Array.from({ length: 120 }, (_, index) => ({
	slug: `app-${index}`,
	name: `App ${index}`,
	recipe: { parts: [{ kind: "rect", x: 4, y: 4, width: 16, height: 16 }] },
}));

const pack: PackSummary = { id: "palantir", name: "Palantir", count: 120, preview: [] };

describe("PackPage", () => {
	beforeEach(() => {
		vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("names the pack, with its size and both actions, before its icons load", () => {
		render(<PackPage origin="https://icons.sketchi.app" pack={pack} status="loading" />);
		expect(screen.getByRole("heading", { level: 1, name: "Palantir" })).toBeTruthy();
		expect(screen.getByText("120 icons")).toBeTruthy();
		expect(screen.getByRole("link", { name: "Download" }).getAttribute("href")).toBe(
			"/packs/palantir.excalidrawlib",
		);
		expect(screen.getByRole("link", { name: "Open in Excalidraw" }).getAttribute("href")).toBe(
			"https://excalidraw.com/#url=https%3A%2F%2Ficons.sketchi.app%2Fpacks%2Fpalantir.excalidraw",
		);
		expect(screen.getByLabelText("Loading icons")).toBeTruthy();
		const nav = screen.getByRole("navigation", { name: "Icon sets" });
		expect(within(nav).queryByRole("link", { current: "page" })).toBeNull();
	});

	it("draws every icon with its product name as the page scrolls", () => {
		render(
			<PackPage icons={icons} origin="https://icons.sketchi.app" pack={pack} status="ready" />,
		);
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
		render(
			<PackPage icons={icons} origin="https://icons.sketchi.app" pack={pack} status="ready" />,
		);
		fireEvent.click(screen.getByRole("button", { name: "Copy App 3 for Excalidraw" }));
		await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
		expect(JSON.parse(writeText.mock.calls[0]?.[0] ?? "{}")).toMatchObject({
			type: "excalidraw/clipboard",
		});
		expect(await screen.findByText("App 3 copied. Paste it into Excalidraw.")).toBeTruthy();
	});

	it("offers a retry when the icons cannot load", () => {
		const onRetry = vi.fn();
		render(
			<PackPage
				errorMessage="Drawings returned HTTP 503."
				onRetry={onRetry}
				origin="https://icons.sketchi.app"
				pack={pack}
				status="error"
			/>,
		);
		expect(screen.getByRole("alert").textContent).toContain("Drawings returned HTTP 503.");
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		expect(onRetry).toHaveBeenCalledTimes(1);
	});
});
