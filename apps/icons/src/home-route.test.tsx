import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getPackShelf, type PackShelfData } from "./lib/packs-rpc";
import { Route } from "./routes/index";

vi.mock("./lib/packs-rpc", () => ({ getPackShelf: vi.fn() }));

const shelf: PackShelfData = {
	origin: "https://pr-1-sketchi-icons.example.dev",
	packs: [
		{
			id: "palantir",
			name: "Palantir",
			count: 100,
			preview: [
				{
					slug: "palantir",
					name: "Palantir",
					recipe: { parts: [{ kind: "ellipse", cx: 12, cy: 12, rx: 8, ry: 8 }] },
				},
			],
		},
	],
};

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
	let loaderData: PackShelfData | undefined;

	beforeEach(() => {
		loaderData = undefined;
		vi.spyOn(Route, "useLoaderData").mockImplementation((() => loaderData) as never);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("loads the packs for the server render, and leaves them out when their index fails", async () => {
		const loader = Route.options.loader as unknown as () => Promise<PackShelfData | undefined>;
		vi.mocked(getPackShelf).mockResolvedValueOnce(shelf);
		await expect(loader()).resolves.toEqual(shelf);
		vi.mocked(getPackShelf).mockRejectedValueOnce(new Error("Pack index returned HTTP 404."));
		await expect(loader()).resolves.toBeUndefined();
	});

	it("leads with the packs: each downloads its library and opens on excalidraw.com", async () => {
		loaderData = shelf;
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(manifest)));

		renderHomeRoute();

		const download = screen.getByRole("link", { name: "Download" });
		expect(download.getAttribute("href")).toBe("/packs/palantir.excalidrawlib");
		expect(download.getAttribute("download")).toBe("sketchi-palantir.excalidrawlib");
		expect(download.getAttribute("aria-describedby")).toBe("pack-palantir");
		const open = screen.getByRole("link", { name: "Open in Excalidraw" });
		expect(open.getAttribute("href")).toBe(
			"https://excalidraw.com/#url=https%3A%2F%2Fpr-1-sketchi-icons.example.dev%2Fpacks%2Fpalantir.excalidraw",
		);
		expect(open.getAttribute("target")).toBe("_blank");
		expect(screen.getByRole("link", { name: "Palantir" }).getAttribute("href")).toBe(
			"/packs/palantir",
		);
		expect(screen.getByText("100 icons")).toBeTruthy();
		expect(await screen.findByRole("button", { name: /Copy Codex/ })).toBeTruthy();
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
