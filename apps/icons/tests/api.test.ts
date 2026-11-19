// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";

import { makeIconsHttpHandler } from "../src/http.server";

const runtime = makeIconsHttpHandler();
afterAll(() => runtime.dispose());
const fetchIcons = (path: string, init?: RequestInit) =>
	runtime.fetch(
		new Request(`https://icons.sketchi.app${path}`, init),
		{ ASSETS: { fetch: async () => new Response('<svg viewBox="0 0 24 24" />') } },
		{ waitUntil: () => {} },
	);

describe("icons HTTP API", () => {
	it("ranks alias matches with absolute agent URLs, reading the first of a repeated query", async () => {
		const response = await fetchIcons("/api/icons?q=%20k8s%20&q=aws&limit=no&limit=5");
		expect(response.status).toBe(200);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
		expect(await response.json()).toMatchObject({
			query: "k8s",
			collection: null,
			count: 1,
			results: [
				{
					slug: "kubernetes",
					detailUrl: "https://icons.sketchi.app/api/icons/kubernetes",
					svgUrl: "https://icons.sketchi.app/api/icons/kubernetes.svg",
				},
			],
		});
		const capped = (await (await fetchIcons("/api/icons?limit=500")).json()) as {
			results: unknown[];
		};
		expect(capped.results).toHaveLength(100);
	});

	it("refuses community publishing without a store", async () => {
		const publish = await fetchIcons("/api/community", { method: "POST", body: "{}" });
		expect(publish.status).toBe(503);
		expect(publish.headers.get("Access-Control-Allow-Origin")).toBe("*");
		expect(await publish.json()).toMatchObject({ error: { code: "unavailable" } });
	});
});
