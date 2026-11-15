import { RegistryProvider } from "@effect/atom-react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { CommunityPage } from "./components/community-gallery/community-page";
import { queryHttpLayer } from "./lib/query-atoms";
import { TestIntersectionObserver } from "./test-support/intersection-observer";

function requestUrl(input: RequestInfo | URL | undefined): URL {
	if (input === undefined) throw new Error("Expected a request");
	return new URL(input instanceof Request ? input.url : input);
}

const icon = (name: string) => ({
	slug: `community/${name.toLowerCase()}`,
	name,
	recipe: { parts: [{ kind: "ellipse", cx: 12, cy: 12, rx: 9, ry: 9 }] },
	createdAt: "2026-11-08T12:00:00.000Z",
	colors: [],
	url: `https://icons.sketchi.app/community/${name.toLowerCase()}`,
	api: `https://icons.sketchi.app/api/community/${name.toLowerCase()}`,
});
const page = (names: string[], nextCursor?: string) =>
	Response.json({
		query: "",
		count: names.length,
		results: names.map(icon),
		...(nextCursor ? { nextCursor } : {}),
	});
function owner(fetch: typeof globalThis.fetch, children: ReactNode) {
	return (
		<RegistryProvider
			initialValues={[
				[
					queryHttpLayer,
					FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch))),
				],
			]}
		>
			{children}
		</RegistryProvider>
	);
}
beforeEach(() => vi.stubGlobal("IntersectionObserver", TestIntersectionObserver));
afterEach(() => {
	vi.unstubAllGlobals();
	window.localStorage.clear();
});

it("keeps previous search results, aborts obsolete searches, and never overwrites the new result", async () => {
	const slow = Promise.withResolvers<Response>();
	const obsolete = Promise.withResolvers<Response>();
	const fetch = vi.fn<typeof globalThis.fetch>((input) => {
		const url = requestUrl(input);
		if (url.searchParams.get("q") === "slow") return slow.promise;
		if (url.searchParams.get("q") === "obsolete") return obsolete.promise;
		return Promise.resolve(page([url.searchParams.get("q") === "fresh" ? "Fresh" : "Original"]));
	});
	const view = render(owner(fetch, <CommunityPage />));
	expect(await screen.findByText("community/original")).toBeTruthy();
	fireEvent.change(screen.getByRole("searchbox"), { target: { value: "slow" } });
	await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
	expect(screen.getByText("community/original")).toBeTruthy();
	fireEvent.change(screen.getByRole("searchbox"), { target: { value: "fresh" } });
	expect(await screen.findByText("community/fresh")).toBeTruthy();
	expect(fetch.mock.calls[1]?.[1]?.signal?.aborted).toBe(true);
	await act(async () => {
		slow.resolve(page(["Stale"]));
		await slow.promise;
	});
	expect(screen.queryByText("community/stale")).toBeNull();
	expect(screen.getByText("community/fresh")).toBeTruthy();
	fireEvent.change(screen.getByRole("searchbox"), { target: { value: "obsolete" } });
	await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
	view.unmount();
	await waitFor(() => expect(fetch.mock.calls[3]?.[1]?.signal?.aborted).toBe(true));
	obsolete.resolve(page([]));
});

it("uses the next cursor once, deduplicates a repeated icon, and stops after the last page", async () => {
	const next = Promise.withResolvers<Response>();
	const fetch = vi.fn<typeof globalThis.fetch>((input) => {
		const cursor = requestUrl(input).searchParams.get("cursor");
		if (cursor === "next-page") return next.promise;
		return Promise.resolve(cursor === "three" ? page(["Three"]) : page(["One"], "next-page"));
	});
	render(owner(fetch, <CommunityPage />));
	expect(await screen.findByText("community/one")).toBeTruthy();
	act(() => {
		TestIntersectionObserver.scrollNearEnd();
		TestIntersectionObserver.scrollNearEnd();
	});
	await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
	expect(requestUrl(fetch.mock.calls[1]?.[0]).searchParams.get("cursor")).toBe("next-page");
	act(() => TestIntersectionObserver.scrollNearEnd());
	expect(fetch).toHaveBeenCalledTimes(2);
	await act(async () => {
		next.resolve(page(["One", "Two"], "three"));
		await next.promise;
	});
	expect(await screen.findByText("community/two")).toBeTruthy();
	expect(screen.getAllByText("community/one")).toHaveLength(1);
	// Resolving page two must not consume another cursor queued by the earlier
	// same-turn notifications. Only a later scroll may request page three.
	expect(fetch).toHaveBeenCalledTimes(2);
	expect(screen.getByText("2+ icons")).toBeTruthy();
	act(() => TestIntersectionObserver.scrollNearEnd());
	expect(await screen.findByText("community/three")).toBeTruthy();
	expect(fetch).toHaveBeenCalledTimes(3);
	expect(requestUrl(fetch.mock.calls[2]?.[0]).searchParams.get("cursor")).toBe("three");
	expect(screen.getByText("3 icons")).toBeTruthy();
	act(() => TestIntersectionObserver.scrollNearEnd());
	expect(fetch).toHaveBeenCalledTimes(3);
});

it("reads a 404 as a missing icon instead of an undefined result", async () => {
	const fetch = vi.fn<typeof globalThis.fetch>((input) =>
		Promise.resolve(
			requestUrl(input).pathname.endsWith("/gone") ? new Response("{}", { status: 404 }) : page([]),
		),
	);
	render(owner(fetch, <CommunityPage slug="community/gone" />));
	expect(
		await screen.findByRole("heading", { name: "community/gone is not published" }),
	).toBeTruthy();
	expect(
		fetch.mock.calls.find(([input]) => requestUrl(input).pathname.endsWith("/gone"))?.[1]?.method,
	).toBe("GET");
});

it("retries a linked failure and opens the recovered icon, while a list failure retries independently", async () => {
	let detailFails = true;
	let listFails = true;
	const fetch = vi.fn<typeof globalThis.fetch>((input) => {
		if (requestUrl(input).pathname.endsWith("/box"))
			return Promise.resolve(
				detailFails ? new Response("down", { status: 503 }) : Response.json(icon("Box")),
			);
		return Promise.resolve(listFails ? new Response("down", { status: 502 }) : page(["Box"]));
	});
	render(owner(fetch, <CommunityPage slug="community/box" />));
	expect(await screen.findByText("Community icons returned HTTP 502.")).toBeTruthy();
	expect(screen.getByRole("heading", { name: "Could not load community/box" })).toBeTruthy();
	detailFails = false;
	listFails = false;
	const retries = screen.getAllByRole("button", { name: "Try again" });
	for (const retry of retries) fireEvent.click(retry);
	expect(await screen.findByRole("dialog", { name: "Box details" })).toBeTruthy();
	expect(await screen.findByText("1 icon")).toBeTruthy();
});

it("revalidates community on reconnect but not focus", async () => {
	const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(page(["Box"])));
	render(owner(fetch, <CommunityPage />));
	expect(await screen.findByText("community/box")).toBeTruthy();
	fireEvent(window, new Event("focus"));
	fireEvent(document, new Event("visibilitychange"));
	expect(fetch).toHaveBeenCalledTimes(1);
	fireEvent(window, new Event("online"));
	await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
});

it("loads only the selected published pack, retries once, and allows an explicit retry", async () => {
	const { Route } = await import("./routes/packs/$id");
	const pack = {
		id: "palantir",
		name: "Palantir",
		version: "0123456789abcdef",
		count: 1,
		preview: [],
	};
	const loader = vi.spyOn(Route, "useLoaderData").mockReturnValue({ pack, excalidraw: undefined });
	const PackRoute = Route.options.component;
	if (!PackRoute) throw new Error("Missing pack component");
	let fail = true;
	const fetch = vi.fn<typeof globalThis.fetch>(() =>
		Promise.resolve(
			fail
				? new Response("down", { status: 503 })
				: Response.json([{ slug: "box", name: "Box", recipe: icon("Box").recipe }]),
		),
	);
	try {
		render(owner(fetch, <PackRoute />));
		expect(screen.getByRole("heading", { level: 1, name: "Palantir" })).toBeTruthy();
		expect(screen.getByText("1 icon")).toBeTruthy();
		expect(screen.getByRole("link", { name: "Download" }).getAttribute("href")).toBe(
			"/packs/palantir.excalidrawlib",
		);
		expect(document.querySelector('a[href*="excalidraw.com"]')).toBeNull();
		expect(screen.getByLabelText("Loading icons")).toBeTruthy();
		expect(
			within(screen.getByRole("navigation", { name: "Icon sets" })).queryByRole("link", {
				current: "page",
			}),
		).toBeNull();
		expect(
			await screen.findByText("Pack icons returned HTTP 503.", {}, { timeout: 2500 }),
		).toBeTruthy();
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(screen.getByRole("alert").textContent).toContain("Pack icons returned HTTP 503.");
		expect(fetch.mock.calls.map(([input]) => requestUrl(input).pathname)).toEqual([
			"/packs/palantir.icons.json",
			"/packs/palantir.icons.json",
		]);
		expect(fetch.mock.calls[0]?.[1]).toMatchObject({
			cache: "no-cache",
			signal: expect.any(AbortSignal),
		});
		fail = false;
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		expect(await screen.findByRole("button", { name: "Copy Box for Excalidraw" })).toBeTruthy();
		expect(fetch).toHaveBeenCalledTimes(3);
	} finally {
		loader.mockRestore();
	}
});
