import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { fetchCommunityIcon, type CommunityIconEntry } from "../../lib/community-client";
import { TestIntersectionObserver } from "../../test-support/intersection-observer";
import { CommunityGallery } from "./community-gallery";
import { RecipePreview } from "../recipe-preview/index.js";

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
	beforeAll(() => import("../../lib/excalidraw-export"));

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

	it("copies an icon as Excalidraw shapes and its slug from the details", async () => {
		const writeText = vi.fn(async (_value: string) => {});
		Object.assign(navigator, { clipboard: { writeText } });
		gallery();
		fireEvent.click(screen.getByRole("button", { name: "Copy Ring queue for Excalidraw" }));
		await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
		expect(JSON.parse(writeText.mock.calls[0]?.[0] ?? "{}")).toMatchObject({
			type: "excalidraw/clipboard",
		});

		fireEvent.click(screen.getByRole("button", { name: "View Box details" }));
		const dialog = screen.getByRole("dialog", { name: "Box details" });
		fireEvent.click(within(dialog).getByRole("button", { name: "Copy slug" }));
		await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("community/box"));
		fireEvent.keyDown(window, { key: "Escape" });
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("starts the clipboard write inside the click, before the export code has loaded", async () => {
		const items: { "text/plain": Promise<Blob> }[] = [];
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
		expect(JSON.parse(text)).toMatchObject({ type: "excalidraw/clipboard" });
		await screen.findByText("Ring queue copied. Paste it into Excalidraw.");
		vi.unstubAllGlobals();
	});

	it("copies and downloads drawings with their names once Names is on", async () => {
		const writeText = vi.fn(async (_value: string) => {});
		Object.assign(navigator, { clipboard: { writeText } });
		gallery();
		fireEvent.click(screen.getByRole("button", { name: "Names", pressed: false }));
		expect(screen.getByRole("button", { name: "Download with names" })).toBeTruthy();
		const tile = screen.getByRole("button", { name: "Copy Ring queue for Excalidraw" });
		expect(tile.querySelector(".drawn-icon__name")?.textContent).toBe("Ring queue");
		fireEvent.click(tile);
		await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
		const { elements } = JSON.parse(writeText.mock.calls[0]?.[0] ?? "{}") as {
			elements: { type: string; text?: string; groupIds: string[] }[];
		};
		expect(elements.at(-1)).toMatchObject({
			type: "text",
			text: "Ring queue",
			groupIds: ["community-ring-queue-named"],
		});
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
		expect(screen.getAllByRole("status").map((status) => status.textContent)).toContain(
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

describe("linked community icons", () => {
	it("says when a linked icon is not published, and retries one that failed to load", () => {
		const { unmount } = render(
			<CommunityGallery
				icons={ICONS}
				linked={{ slug: "community/gone", status: "missing" }}
				onQueryChange={() => {}}
				query=""
				status="ready"
			/>,
		);
		expect(screen.getByRole("heading", { name: "community/gone is not published" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
		unmount();

		const onRetryLinked = vi.fn();
		render(
			<CommunityGallery
				icons={ICONS}
				linked={{ slug: "community/box", status: "error" }}
				onQueryChange={() => {}}
				onRetryLinked={onRetryLinked}
				query=""
				status="ready"
			/>,
		);
		expect(screen.getByRole("heading", { name: "Could not load community/box" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		expect(onRetryLinked).toHaveBeenCalledTimes(1);
	});

	it("reads a 404 as a missing icon instead of an undefined result", async () => {
		const fetchMock = vi.fn(async () => new Response("{}", { status: 404 }));
		vi.stubGlobal("fetch", fetchMock);
		await expect(fetchCommunityIcon("community/gone")).resolves.toEqual({ status: "missing" });
		expect(fetchMock).toHaveBeenCalledWith("/api/community/gone", {});
		vi.unstubAllGlobals();
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
		const children = [...(container.querySelector("svg")?.children ?? [])].map((child) =>
			child.tagName.toLowerCase(),
		);
		expect(children).toEqual(["text", "g"]);
	});
});
