import { RegistryContext } from "@effect/atom-react";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import type { AtomRegistry } from "effect/reactivity";
import { createContext, useContext } from "react";
import { renderToReadableStream } from "react-dom/server";
import { expect, it, vi } from "vitest";

import { svgHttpLayer } from "./lib/svg-source-atom";
import { Route } from "./routes/__root";
import { Route as HomeRoute } from "./routes/index";

const owners: AtomRegistry.AtomRegistry[] = [];
const Source = createContext("");
const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.reject(new Error("SSR query I/O")));
const opened = vi.fn();
const closed = vi.fn();
vi.mock("@tanstack/react-router", async (original) => ({
	...(await original<typeof import("@tanstack/react-router")>()),
	HeadContent: () => null,
	Scripts: () => null,
	Outlet: () => <Page />,
}));
function Page() {
	const registry = useContext(RegistryContext);
	owners.push(registry);
	registry.set(
		svgHttpLayer,
		Layer.merge(
			FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch))),
			Layer.effectDiscard(
				Effect.acquireRelease(
					Effect.sync(() => opened()),
					() => Effect.sync(() => closed()),
				),
			),
		),
	);
	const Home = HomeRoute.options.component;
	if (!Home) throw new Error("Missing workspace route");
	return <Home />;
}
it("renders independent SVG request owners without starting query resources, and rejects untrusted handoffs before I/O", async () => {
	const Root = Route.options.component;
	if (!Root) throw new Error("Missing workspace root");
	const search = vi.spyOn(HomeRoute, "useSearch").mockImplementation(function useSearch() {
		return { svg: useContext(Source) };
	});
	try {
		const urls = [
			"https://icons.sketchi.app/output/upload-ready/svg/test/one.svg",
			"https://icons.sketchi.app/output/upload-ready/svg/test/two.svg",
			"https://attacker.invalid/output/upload-ready/svg/test/private.svg",
		];
		const streams = await Promise.all(
			urls.map((url) =>
				renderToReadableStream(
					<Source value={url}>
						<Root />
					</Source>,
				),
			),
		);
		const bodies = await Promise.all(streams.map((stream) => new Response(stream).text()));
		expect(bodies[0]).toContain("one.svg");
		expect(bodies[0]).not.toContain("two.svg");
		expect(bodies[1]).toContain("two.svg");
		expect(bodies[1]).not.toContain("one.svg");
		for (const body of bodies.slice(0, 2)) {
			expect(body).toContain("Loading source SVG");
			expect(body).toContain("Download library");
		}
		expect(bodies[2]).toContain("Workspace imports accept only public Sketchi icon SVG URLs.");
		expect(bodies[2]).not.toContain("Loading source SVG");
		expect(owners).toHaveLength(3);
		expect(new Set(owners).size).toBe(3);
		expect(fetch).not.toHaveBeenCalled();
		expect(opened).not.toHaveBeenCalled();
		expect(closed).not.toHaveBeenCalled();
	} finally {
		search.mockRestore();
		owners.forEach((registry) => registry.dispose());
	}
});
