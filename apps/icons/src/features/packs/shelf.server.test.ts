// @vitest-environment node
import { readFile } from "node:fs/promises";
import { beforeEach, expect, it, vi } from "vitest";
const bindings = vi.hoisted(() => ({ ASSETS: { fetch: vi.fn<typeof fetch>() } }));
vi.mock("cloudflare:workers", () => ({ env: bindings, waitUntil: () => {} }));
vi.mock("@tanstack/react-start/server-only", () => ({}));
import { loadPackIndex } from "./shelf.server.js";
const index = () => readFile("apps/icons/public/packs/index.json", "utf8");
beforeEach(() => bindings.ASSETS.fetch.mockReset());
it("retries a failed pack index read and then reuses the build metadata", async () => {
	const body = await index();
	bindings.ASSETS.fetch
		.mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
		.mockImplementation(async () => new Response(body));
	await expect(loadPackIndex("https://retry.example")).rejects.toMatchObject({
		_tag: "PackIndexError",
	});
	const loaded = await loadPackIndex("https://retry.example");
	expect(loaded.some((pack) => pack.id === "palantir")).toBe(true);
	expect(await loadPackIndex("https://retry.example")).toEqual(loaded);
	expect(bindings.ASSETS.fetch).toHaveBeenCalledTimes(2);
});
it("shares one in-flight pack index read for overlapping shelf requests", async () => {
	const started = Promise.withResolvers<void>(),
		release = Promise.withResolvers<void>();
	const body = await index();
	bindings.ASSETS.fetch.mockImplementation(async () => {
		started.resolve();
		await release.promise;
		return new Response(body);
	});
	const a = loadPackIndex("https://overlap.example");
	await started.promise;
	const b = loadPackIndex("https://overlap.example");
	release.resolve();
	const [one, two] = await Promise.all([a, b]);
	expect(two).toEqual(one);
	expect(one.length).toBeGreaterThan(0);
	expect(bindings.ASSETS.fetch).toHaveBeenCalledTimes(1);
});
