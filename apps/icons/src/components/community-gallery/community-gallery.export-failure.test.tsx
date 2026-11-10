import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { CommunityIconEntry } from "../../lib/community-client";
import { CommunityGallery } from "./community-gallery";

// The export chunk fails to load, as it would offline or after a deploy removed it.
const chunk = vi.hoisted(() => ({ loads: 0 }));
vi.mock("../../lib/excalidraw-export.js", () => {
	chunk.loads += 1;
	throw new Error("Failed to fetch dynamically imported module");
});

const ICON: CommunityIconEntry = {
	slug: "community/ring-queue",
	name: "Ring queue",
	recipe: { parts: [{ kind: "ellipse", cx: 12, cy: 12, rx: 9, ry: 9 }] },
	createdAt: "2026-11-08T12:00:00.000Z",
	url: "https://icons.sketchi.app/community/ring-queue",
};

describe("CommunityGallery without its export code", () => {
	it("prefetches quietly and reports failed copies and downloads", async () => {
		Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });
		render(<CommunityGallery icons={[ICON]} onQueryChange={() => {}} query="" status="ready" />);
		const copy = screen.getByRole("button", { name: "Copy Ring queue for Excalidraw" });
		fireEvent.pointerOver(copy);
		await waitFor(() => expect(chunk.loads).toBe(1));
		fireEvent.click(copy);
		expect(await screen.findByText("Could not copy Ring queue. Try again.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Download library" }));
		expect(await screen.findByText("Could not prepare the library. Try again.")).toBeTruthy();
		// The prefetch, the copy and the download each tried the chunk; none left a rejection unhandled.
		expect(chunk.loads).toBe(3);
	});
});
