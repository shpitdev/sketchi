import { decodeJson } from "../../test-support/json";
import { Array as Arr, String as Str } from "effect";
import { render } from "../../test-support/render";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { type CommunityIconEntry } from "../../lib/community-client";
import { TestIntersectionObserver } from "../../test-support/intersection-observer";
import { CommunityGallery } from "./community-gallery";
import { RecipePreview } from "../../components/recipe-preview/recipe-preview.js";

const ICONS: CommunityIconEntry[] = [
	{
		slug: "community/ring-queue",
		name: "Ring queue",
		recipe: { parts: [{ kind: "ellipse", cx: 12, cy: 12, rx: 9, ry: 9 }] },
		createdAt: "2026-11-08T12:00:00.000Z",
		url: "https://icons.sketchi.app/community/ring-queue",
	},
	{
		slug: "community/box",
		name: "Box",
		recipe: { parts: [{ kind: "rect", x: 4, y: 4, width: 16, height: 16 }] },
		createdAt: "2026-11-07T12:00:00.000Z",
		url: "https://icons.sketchi.app/community/box",
	},
];

function gallery(props: Partial<Parameters<typeof CommunityGallery>[0]> = {}) {
	const onQueryChange = vi.fn();
	render(
		<CommunityGallery
			icons={ICONS}
			onQueryChange={onQueryChange}
			query=""
			status="ready"
			{...props}
		/>,
	);
	return { onQueryChange };
}

describe("CommunityGallery", () => {
	// The gallery loads the export code on first use; loading it here keeps its
	// transform time out of the clipboard waits.
	beforeAll(() => import("../export/excalidraw-export"));

	afterEach(() => {
		vi.unstubAllGlobals();
		window.localStorage.clear();
	});

	it("loads the next page as the list nears the viewport, once at a time", () => {
		vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
		const onLoadMore = vi.fn();
		const { rerender } = render(
			<CommunityGallery
				hasMore
				icons={ICONS}
				onLoadMore={onLoadMore}
				onQueryChange={() => undefined}
				query=""
				status="ready"
			/>,
		);
		expect(screen.queryByRole("button", { name: /more/i })).toBeNull();
		act(() => TestIntersectionObserver.scrollNearEnd());
		expect(onLoadMore).toHaveBeenCalledTimes(1);

		// While that page loads, nothing else is asked for.
		rerender(
			<CommunityGallery
				hasMore
				icons={ICONS}
				loadingMore
				onLoadMore={onLoadMore}
				onQueryChange={() => undefined}
				query=""
				status="ready"
			/>,
		);
		act(() => TestIntersectionObserver.scrollNearEnd());
		expect(onLoadMore).toHaveBeenCalledTimes(1);
		expect(TestIntersectionObserver.live.size).toBe(0);
	});

	it("shows community icons with their diagram slugs under the Community set", () => {
		gallery();
		const nav = screen.getByRole("navigation", { name: "Icon sets" });
		expect(within(nav).getByRole("link", { name: "Community" }).getAttribute("aria-current")).toBe(
			"page",
		);
		expect(within(nav).getByRole("link", { name: "Catalog" }).getAttribute("href")).toBe("/");
		const results = screen.getByRole("region", { name: "Community icons" });
		expect(within(results).getByText("community/ring-queue")).toBeTruthy();
		expect(screen.getByText("2 icons")).toBeTruthy();
	});

	// @effect-diagnostics-next-line asyncFunction:off -- React act, hydration and Testing Library await native DOM callbacks at the test host.
	it("copies an icon as Excalidraw shapes and its slug from the details", async () => {
		// @effect-diagnostics-next-line asyncFunction:off -- React and Testing Library callbacks await native DOM or Blob promises at this test host.
		const writeText = vi.fn(async (_value: string) => {});
		Object.assign(navigator, { clipboard: { writeText } });
		gallery();
		fireEvent.click(screen.getByRole("button", { name: "Copy Ring queue for Excalidraw" }));
		await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
		expect(decodeJson(writeText.mock.calls[0]?.[0] ?? "{}")).toMatchObject({
			type: "excalidraw/clipboard",
		});

		fireEvent.click(screen.getByRole("button", { name: "View Box details" }));
		const dialog = screen.getByRole("dialog", { name: "Box details" });
		fireEvent.click(within(dialog).getByRole("button", { name: "Copy slug" }));
		await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("community/box"));
		fireEvent.keyDown(document.activeElement ?? document, { key: "Escape" });
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	// @effect-diagnostics-next-line asyncFunction:off -- React act, hydration and Testing Library await native DOM callbacks at the test host.
	it("starts the clipboard write inside the click, before the export code has loaded", async () => {
		const items: { "text/plain": Promise<Blob> }[] = [];
		// @effect-diagnostics-next-line asyncFunction:off -- React and Testing Library callbacks await native DOM or Blob promises at this test host.
		const write = vi.fn(async (_items: unknown[]) => {});
		vi.stubGlobal(
			"ClipboardItem",
			class {
				constructor(item: { "text/plain": Promise<Blob> }) {
					items.push(item);
				}
			},
		);
		Object.assign(navigator, { clipboard: { write, writeText: vi.fn() } });
		gallery();
		fireEvent.click(screen.getByRole("button", { name: "Copy Ring queue for Excalidraw" }));
		// Synchronously, while the click's activation still holds.
		expect(write).toHaveBeenCalledTimes(1);
		const text = await (await items[0]!["text/plain"]).text();
		expect(decodeJson(text)).toMatchObject({ type: "excalidraw/clipboard" });
		await screen.findByText("Ring queue copied. Paste it into Excalidraw.");
		vi.unstubAllGlobals();
	});

	// @effect-diagnostics-next-line asyncFunction:off -- React act, hydration and Testing Library await native DOM callbacks at the test host.
	it("copies and downloads drawings with their names once Names is on", async () => {
		// @effect-diagnostics-next-line asyncFunction:off -- React and Testing Library callbacks await native DOM or Blob promises at this test host.
		const writeText = vi.fn(async (_value: string) => {});
		Object.assign(navigator, { clipboard: { writeText } });
		gallery();
		fireEvent.click(screen.getByRole("button", { name: "Names", pressed: false }));
		expect(screen.getByRole("button", { name: "Download with names" })).toBeTruthy();
		const tile = screen.getByRole("button", { name: "Copy Ring queue for Excalidraw" });
		expect(tile.querySelector(".drawn-icon__name")?.textContent).toBe("Ring queue");
		fireEvent.click(tile);
		await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
		const { elements } = decodeJson(writeText.mock.calls[0]?.[0] ?? "{}") as {
			elements: { type: string; text?: string; groupIds: string[] }[];
		};
		expect(elements.at(-1)).toMatchObject({
			type: "text",
			text: "Ring queue",
			groupIds: ["community-ring-queue-named"],
		});
	});

	// @effect-diagnostics-next-line asyncFunction:off -- The real community download reports a refused native Blob handoff without changing its loaded icons.
	it("reports a refused community library download", async () => {
		vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
			throw new DOMException("refused", "SecurityError");
		});
		gallery();
		fireEvent.click(screen.getByRole("button", { name: "Download library" }));
		expect(await screen.findByText("Could not prepare the library. Try again.")).toBeTruthy();
		expect(screen.getByRole("region", { name: "Community icons" })).toBeTruthy();
		vi.restoreAllMocks();
	});

	it("opens a linked icon and offers the next useful step when nothing is found", () => {
		const linked = ICONS[1];
		if (!linked) throw new Error("fixture");
		gallery({ icons: [], initialIcon: linked });
		expect(screen.getByRole("dialog", { name: "Box details" })).toBeTruthy();
	});

	it("lets an empty gallery's state stand in for a zero count", () => {
		gallery({ icons: [] });
		expect(screen.getByRole("heading", { name: "No community icons yet" })).toBeTruthy();
		expect(screen.queryByText("0 icons")).toBeNull();
		expect(Arr.map(screen.getAllByRole("status"), (status) => status.textContent)).toContain(
			"No community icons yet",
		);
	});

	it("clears a search that finds nothing", () => {
		const { onQueryChange } = gallery({ icons: [], query: "zzz" });
		expect(screen.getByRole("heading", { name: "No icons found" })).toBeTruthy();
		fireEvent.click(screen.getAllByRole("button", { name: "Clear search" }).at(-1)!);
		expect(onQueryChange).toHaveBeenCalledWith("");
		expect(screen.getByRole("button", { name: "Download library" }).hasAttribute("disabled")).toBe(
			true,
		);
	});
});

describe("RecipePreview", () => {
	it("paints parts in recipe order, so a paper mask covers the letter before it", () => {
		const { container } = render(
			<RecipePreview
				previewMode="light"
				recipe={{
					parts: [
						{ kind: "text", cx: 12, cy: 12, text: "A", size: 12 },
						{ kind: "rect", x: 4, y: 10, width: 16, height: 4, stroke: "none", fill: "paper" },
					],
				}}
			/>,
		);
		const children = Arr.map([...(container.querySelector("svg")?.children ?? [])], (child) =>
			Str.toLowerCase(child.tagName),
		);
		expect(children).toEqual(["text", "g"]);
	});
});
