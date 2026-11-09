import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { CommunityIconEntry } from "../../lib/community-client";
import { CommunityGallery } from "./community-gallery";

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

	it("opens a linked icon and offers the next useful step when nothing is found", () => {
		const linked = ICONS[1];
		if (!linked) throw new Error("fixture");
		gallery({ icons: [], initialIcon: linked });
		expect(screen.getByRole("dialog", { name: "Box details" })).toBeTruthy();
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
