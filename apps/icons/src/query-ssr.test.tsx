import { RegistryContext } from "@effect/atom-react";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import type { AtomRegistry } from "effect/reactivity";
import { createContext, useContext } from "react";
import { renderToReadableStream } from "react-dom/server";
import { expect, it, vi } from "vitest";

import { CommunityPage } from "./features/community/community-page";
import { communitySearch } from "./lib/community-atoms";
import { queryHttpLayer } from "./lib/query-atoms";
import { Route } from "./routes/__root";
import { Route as HomeRoute } from "./routes/index";
import { Route as PackRoute } from "./routes/packs/$id";

const owners: AtomRegistry.AtomRegistry[] = [];
const Owner = createContext("");
const transport = vi.fn<typeof globalThis.fetch>(() => Promise.reject(new Error("SSR query I/O")));
const opened = vi.fn();
const closed = vi.fn();
vi.mock("./lib/packs-rpc", () => ({ getPackShelf: vi.fn() }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-router")>()),
	HeadContent: () => null,
	Scripts: () => null,
	Outlet: () => <Pages />,
}));
function Pages() {
	const owner = useContext(Owner);
	const registry = useContext(RegistryContext);
	owners.push(registry);
	registry.set(communitySearch, owner);
	registry.set(
		queryHttpLayer,
		Layer.merge(
			FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, transport))),
			Layer.effectDiscard(
				Effect.acquireRelease(
					Effect.sync(() => opened()),
					() => Effect.sync(() => closed()),
				),
			),
		),
	);
	const Home = HomeRoute.options.component;
	const Pack = PackRoute.options.component;
	if (!Home || !Pack) throw new Error("Missing Icons pages");
	return (
		<>
			<Home />
			<Pack />
			<CommunityPage slug="community/box" />
		</>
	);
}
it("renders concurrent Icons pages with isolated search state and no query transport or resource acquisition", async () => {
	const Root = Route.options.component;
	if (!Root) throw new Error("Missing Icons root");
	const readStorage = vi.spyOn(Storage.prototype, "getItem");
	const writeStorage = vi.spyOn(Storage.prototype, "setItem");
	const browserListeners = vi.spyOn(window, "addEventListener");
	const home = vi.spyOn(HomeRoute, "useLoaderData").mockReturnValue(undefined);
	const pack = vi.spyOn(PackRoute, "useLoaderData").mockReturnValue({
		pack: {
			id: "palantir",
			name: "Palantir",
			version: "0123456789abcdef",
			count: 1,
			preview: [],
		},
		excalidraw: undefined,
	});
	try {
		const streams = await Promise.all(
			["owner-one", "owner-two"].map((owner) =>
				renderToReadableStream(
					<Owner value={owner}>
						<Root />
					</Owner>,
				),
			),
		);
		const html = await Promise.all(streams.map((stream) => new Response(stream).text()));
		expect(html[0]).toContain('value="owner-one"');
		expect(html[0]).not.toContain('value="owner-two"');
		expect(html[1]).toContain('value="owner-two"');
		expect(html[1]).not.toContain('value="owner-one"');
		for (const body of html) {
			expect(body).toContain("Loading icons");
			expect(body).toContain("Palantir");
			expect(body).toContain("/packs/palantir.excalidrawlib");
			expect(body).toContain("Community icons");
		}
		expect(owners).toHaveLength(2);
		expect(owners[0]).not.toBe(owners[1]);
		expect(readStorage).not.toHaveBeenCalled();
		expect(writeStorage).not.toHaveBeenCalled();
		expect(browserListeners.mock.calls.filter(([name]) => name === "storage")).toHaveLength(0);
		expect(transport).not.toHaveBeenCalled();
		expect(opened).not.toHaveBeenCalled();
		expect(closed).not.toHaveBeenCalled();
	} finally {
		readStorage.mockRestore();
		writeStorage.mockRestore();
		browserListeners.mockRestore();
		home.mockRestore();
		pack.mockRestore();
		owners.forEach((registry) => registry.dispose());
	}
});
