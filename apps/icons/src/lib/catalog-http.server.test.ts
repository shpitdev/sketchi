// @vitest-environment node
import { IconCatalogHttpApi } from "@sketchi/icon-catalog/http-api";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { HttpApiTest, OpenApi } from "effect/http-api";
import { expect, it } from "vitest";

import { IconSource } from "./api.server";
import { IconCatalogHttpHandlers } from "./catalog-http.server";

it("serves ranked aliases, canonical URLs and SVG through one generated catalog client", async () => {
	const requestLayer = Layer.succeed(IconSource, {
		origin: "https://catalog.example",
		sourceLoader: async () => '<svg viewBox="0 0 24 24" />',
	});

	await Effect.runPromise(
		Effect.gen(function* () {
			const client = yield* HttpApiTest.groups(IconCatalogHttpApi, ["catalog"], {
				baseUrl: "https://catalog.example",
			});
			const page = yield* client.catalog.search({ query: { q: "  k8s  ", limit: "invalid" } });
			expect(page).toMatchObject({
				query: "k8s",
				collection: null,
				count: 1,
				results: [
					{ slug: "kubernetes", svgUrl: "https://catalog.example/api/icons/kubernetes.svg" },
				],
			});
			const detail = yield* client.catalog.detail({ params: { slug: "kubernetes" } });
			const svg = yield* client.catalog.raw({ params: { slug: "kubernetes" } });
			const head = yield* client.catalog.rawHead({
				params: { slug: "kubernetes" },
				responseMode: "decoded-and-response",
			});
			expect(head[0]).toBeUndefined();
			expect(head[1].status).toBe(200);
			expect(svg).toBe(detail.svg);
			expect(svg).toBe('<svg viewBox="0 0 24 24" />');
		}).pipe(
			Effect.provide(
				IconCatalogHttpHandlers.pipe(
					Layer.provide(requestLayer),
					HttpRouter.provideRequest(requestLayer),
				),
			),
			Effect.provide(HttpServer.layerServices),
			Effect.scoped,
		),
	);
});

it("declares the preserved empty 200 raw HEAD response in OpenAPI", () => {
	const spec = OpenApi.fromApi(IconCatalogHttpApi);
	expect(spec.paths["/api/icons/{slug}.svg"]?.head?.responses).toMatchObject({ "200": {} });
	expect(spec.paths["/api/icons/{slug}.svg"]?.head?.responses).not.toHaveProperty("204");
});
