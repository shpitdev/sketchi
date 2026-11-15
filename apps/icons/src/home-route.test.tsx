import { RegistryProvider } from "@effect/atom-react";
import { Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { queryHttpLayer } from "./lib/query-atoms";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getPackShelf, type PackShelfData } from "./lib/packs-rpc";
import { Route } from "./routes/index";

vi.mock("./lib/packs-rpc", () => ({ getPackShelf: vi.fn() }));

const shelf: PackShelfData = {
	excalidraw: { palantir: { publishable: false } },
	packs: [
		{
			id: "palantir",
			name: "Palantir",
			version: "0123456789abcdef",
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
	return render(
		<RegistryProvider
			initialValues={[
				[
					queryHttpLayer,
					FetchHttpClient.layer.pipe(
						Layer.provide(Layer.succeed(FetchHttpClient.Fetch, globalThis.fetch)),
					),
				],
			]}
		>
			<HomeRoute />
		</RegistryProvider>,
	);
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

	it("leads with the packs: each downloads its library", async () => {
		loaderData = shelf;
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(manifest)));

		renderHomeRoute();

		const download = screen.getByRole("link", { name: "Download" });
		expect(download.getAttribute("href")).toBe("/packs/palantir.excalidrawlib");
		expect(download.getAttribute("download")).toBe("sketchi-palantir.excalidrawlib");
		expect(download.getAttribute("aria-describedby")).toBe("pack-palantir");
		// Publishing is off and nothing is submitted yet: no link to excalidraw.com, nothing to publish.
		expect(document.querySelector('a[href*="excalidraw.com"]')).toBeNull();
		expect(screen.queryByRole("button", { name: "Publish to Excalidraw" })).toBeNull();
		expect(screen.getByRole("link", { name: "Palantir" }).getAttribute("href")).toBe(
			"/packs/palantir",
		);
		expect(screen.getByText("100 icons")).toBeTruthy();
		expect(await screen.findByRole("button", { name: /Copy Codex/ })).toBeTruthy();
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
		const manifestLoads = fetchMock.mock.calls.filter(([url]) =>
			String(url).endsWith("/icons-manifest.json"),
		);
		expect(manifestLoads).toHaveLength(2);
	});

	it("loads the hand-drawn versions after the manifest and shows them in the hand-drawn view", async () => {
		const drawings = {
			codex: { parts: [{ kind: "rect", x: 4, y: 4, width: 16, height: 16, fill: "#10a37f" }] },
		};
		const fetchMock = vi.fn(async (url: RequestInfo | URL) =>
			Response.json(
				(url instanceof Request ? url.url : url.toString()).endsWith("/icon-drawings.json")
					? drawings
					: manifest,
			),
		);
		vi.stubGlobal("fetch", fetchMock);

		renderHomeRoute();

		fireEvent.click(await screen.findByRole("button", { name: "Hand-drawn" }));
		expect(await screen.findByRole("button", { name: "Copy Codex for Excalidraw" })).toBeTruthy();
	});

	it("keeps the SVG library when the drawings cannot load", async () => {
		const fetchMock = vi.fn(async (url: RequestInfo | URL) =>
			(url instanceof Request ? url.url : url.toString()).endsWith("/icon-drawings.json")
				? new Response("unavailable", { status: 503 })
				: Response.json(manifest),
		);
		vi.stubGlobal("fetch", fetchMock);

		renderHomeRoute();

		expect(await screen.findByRole("button", { name: /Copy Codex SVG/ })).toBeTruthy();
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3), { timeout: 2500 });
		expect(screen.getByRole("button", { name: /Copy Codex SVG/ })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Hand-drawn" })).toBeNull();
	});
	it("starts drawings only after a valid manifest and aborts the pending request on unmount", async () => {
		const manifestResponse = Promise.withResolvers<Response>();
		const drawingResponse = Promise.withResolvers<Response>();
		const fetchMock = vi.fn<typeof globalThis.fetch>((input) =>
			new URL(input instanceof Request ? input.url : input).pathname === "/icons-manifest.json"
				? manifestResponse.promise
				: drawingResponse.promise,
		);
		vi.stubGlobal("fetch", fetchMock);
		const view = renderHomeRoute();
		expect(screen.getByLabelText("Loading icons")).toBeTruthy();
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ cache: "no-cache", signal: expect.any(AbortSignal) });
		fireEvent(window, new Event("online"));
		fireEvent(window, new Event("focus"));
		expect(fetchMock).toHaveBeenCalledTimes(1);
		await act(async () => {
			manifestResponse.resolve(Response.json(manifest));
			await manifestResponse.promise;
		});
		expect(await screen.findByRole("button", { name: /Copy Codex SVG/ })).toBeTruthy();
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
		view.unmount();
		await waitFor(() => expect(fetchMock.mock.calls[1]?.[1]?.signal?.aborted).toBe(true));
		drawingResponse.resolve(Response.json({}));
	});
	it("reports invalid published data without starting optional drawings or silently retrying", async () => {
		const fetchMock = vi.fn<typeof globalThis.fetch>(() =>
			Promise.resolve(Response.json({ version: 2 })),
		);
		vi.stubGlobal("fetch", fetchMock);
		renderHomeRoute();
		expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
		expect(screen.getByText(/manifest/i, { selector: "p" })).toBeTruthy();
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
