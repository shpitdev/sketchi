// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";

import { makeIconsHttpHandler } from "../src/lib/http.server";

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

	it("serves detail and raw SVG, a folded slug as its kept mark, and stable 404s", async () => {
		expect(await (await fetchIcons("/api/icons/postgresql")).json()).toMatchObject({
			slug: "postgresql",
			svg: '<svg viewBox="0 0 24 24" />',
		});
		expect(await (await fetchIcons("/api/icons/anthos-gcp-legacy")).json()).toMatchObject({
			slug: "anthos",
			collection: "gcp",
		});
		const raw = await fetchIcons("/api/icons/postgresql.svg");
		expect(raw.headers.get("Content-Type")).toContain("image/svg+xml");
		expect(raw.headers.get("Access-Control-Allow-Origin")).toBe("*");
		expect(await raw.text()).toBe('<svg viewBox="0 0 24 24" />');
		const missing = await fetchIcons("/api/icons/missing.svg");
		expect(missing.status).toBe(404);
		const head = await fetchIcons("/api/icons/postgresql", { method: "HEAD" });
		expect(head.status).toBe(405);
		expect(head.headers.get("Allow")).toBe("GET, OPTIONS");
		expect(head.headers.get("Access-Control-Allow-Origin")).toBe("*");
	});

	it("refuses community publishing without a store", async () => {
		const publish = await fetchIcons("/api/community", { method: "POST", body: "{}" });
		expect(publish.status).toBe(503);
		expect(publish.headers.get("Access-Control-Allow-Origin")).toBe("*");
		expect(await publish.json()).toMatchObject({ error: { code: "unavailable" } });
	});
});
