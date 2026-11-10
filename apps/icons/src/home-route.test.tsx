import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Route } from "./routes/index";

const manifest = {
	icons: [
		{
			aliases: [],
			bytes: 1802,
			collection: "ai-apps-agents",
			colorMode: "multicolor",
			keywords: ["ai"],
			name: "Codex",
			slug: "codex",
			svgPath: "/icons/codex.svg",
			viewBox: { height: 512, minX: 0, minY: 0, width: 512 },
		},
	],
	summary: { collectionCounts: { "ai-apps-agents": 1 }, totalIcons: 1 },
	version: 1,
};

function renderHomeRoute() {
	const HomeRoute = Route.options.component;
	if (!HomeRoute) throw new Error("The home route has no component.");
	return render(<HomeRoute />);
}

describe("home route", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("loads the icon manifest into the library", async () => {
		const fetchMock = vi.fn().mockResolvedValue(Response.json(manifest));
		vi.stubGlobal("fetch", fetchMock);

		renderHomeRoute();

		expect(screen.getByLabelText("Loading icons")).toBeTruthy();
		expect(await screen.findByRole("button", { name: /Copy Codex/ })).toBeTruthy();
		expect(fetchMock).toHaveBeenCalledWith("/icons-manifest.json", {
			cache: "no-cache",
			signal: expect.any(AbortSignal),
		});
	});

	it("surfaces a failed load and retries through the same query", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
			.mockResolvedValueOnce(Response.json(manifest));
		vi.stubGlobal("fetch", fetchMock);

		renderHomeRoute();

		expect(await screen.findByText("Icon library returned HTTP 503.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));

		expect(await screen.findByRole("button", { name: /Copy Codex/ })).toBeTruthy();
		const manifestLoads = fetchMock.mock.calls.filter(([url]) => url === "/icons-manifest.json");
		expect(manifestLoads).toHaveLength(2);
	});

	it("loads the hand-drawn versions after the manifest and shows them in the hand-drawn view", async () => {
		const drawings = {
			codex: { parts: [{ kind: "rect", x: 4, y: 4, width: 16, height: 16, fill: "#10a37f" }] },
		};
		const fetchMock = vi.fn(async (url: string) =>
			Response.json(url === "/icon-drawings.json" ? drawings : manifest),
		);
		vi.stubGlobal("fetch", fetchMock);

		renderHomeRoute();

		fireEvent.click(await screen.findByRole("button", { name: "Hand-drawn" }));
		expect(await screen.findByRole("button", { name: "Copy Codex for Excalidraw" })).toBeTruthy();
		expect(screen.getByRole("link", { name: "Excalidraw library" }).getAttribute("href")).toBe(
			"/sketchi-icons.excalidrawlib",
		);
	});

	it("keeps the SVG library when the drawings cannot load", async () => {
		const fetchMock = vi.fn(async (url: string) =>
			url === "/icon-drawings.json"
				? new Response("unavailable", { status: 503 })
				: Response.json(manifest),
		);
		vi.stubGlobal("fetch", fetchMock);

		renderHomeRoute();

		expect(await screen.findByRole("button", { name: /Copy Codex SVG/ })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Hand-drawn" })).toBeNull();
	});
});
