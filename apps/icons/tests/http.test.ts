// @vitest-environment node
// @effect-diagnostics-next-line nodeBuiltinImport:off -- The HTTP harness reads catalog assets from a local checkout for its Worker ASSETS stub.
import { existsSync } from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- The HTTP harness reads catalog assets from a local checkout for its Worker ASSETS stub.
import { resolve } from "node:path";

import { openD1 } from "./support/d1";

import { makeTelemetryTestSink } from "@sketchi/observability";
import { afterEach, expect, it } from "vitest";

import { makeIconsHttpHandler } from "../src/http.server";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function database() {
	const fixture = await openD1();
	cleanups.push(fixture.dispose);
	return fixture.database;
}

it("isolates overlapping bindings, origins and telemetry exports until each response completes", async () => {
	const { probe, sink } = makeTelemetryTestSink();
	const runtime = makeIconsHttpHandler({ sink });
	cleanups.push(runtime.dispose);
	const started = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const pending: Promise<unknown>[] = [];
	const rowsA: unknown[] = [],
		rowsB: unknown[] = [];
	const envA = {
		ASSETS: { fetch: async () => new Response("not used", { status: 404 }) },
		COMMUNITY_ICONS: await database(),
		TELEMETRY_SPANS: {
			send: async (rows: readonly unknown[]) => {
				rowsA.push(...rows);
			},
		},
		AI: {
			run: async () => {
				started.resolve();
				await release.promise;
				return { answers: { unfit: { type: "noul", noul: 0 } } };
			},
		},
	};
	const envB = {
		ASSETS: { fetch: async () => new Response("not used", { status: 404 }) },
		COMMUNITY_ICONS: await database(),
		TELEMETRY_SPANS: {
			send: async (rows: readonly unknown[]) => {
				rowsB.push(...rows);
			},
		},
		AI: {
			run: async () => ({ answers: { unfit: { type: "noul", noul: 0 } } }),
		},
	};
	const execution = {
		waitUntil: (promise: Promise<unknown>) => {
			pending.push(promise);
		},
	};
	const request = (origin: string, name: string, ray: string) =>
		new Request(`${origin}/api/community`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"cf-ray": ray,
				authorization: "Bearer must-not-appear",
			},
			body: JSON.stringify({
				name,
				recipe: { parts: [{ kind: "ellipse", cx: 12, cy: 12, rx: 9, ry: 9 }] },
			}),
		});
	const a = runtime.fetch(request("https://one.example", "First ring", "ray-a"), envA, execution);
	try {
		await started.promise;
		const b = await runtime.fetch(
			request("https://two.example", "Second ring", "ray-b"),
			envB,
			execution,
		);
		expect(b.status).toBe(201);
		expect(await b.json()).toMatchObject({
			slug: "community/second-ring",
			url: "https://two.example/community/second-ring",
		});
		expect(probe.spans.some((span) => span.name === "icons.http" && span.ray_id === "ray-a")).toBe(
			false,
		);
	} finally {
		release.resolve();
	}
	const responseA = await a;
	expect(responseA.status).toBe(201);
	expect(await responseA.json()).toMatchObject({
		slug: "community/first-ring",
		url: "https://one.example/community/first-ring",
	});
	await Promise.all(pending);
	const roots = probe.spans.filter((span) => span.name === "icons.http");
	expect(roots).toHaveLength(2);
	expect(new Set(roots.map((span) => span.trace_id)).size).toBe(2);
	expect(new Set(roots.map((span) => span.run_id)).size).toBe(2);
	for (const [rows, ray, name] of [
		[rowsA, "ray-a", "First ring"],
		[rowsB, "ray-b", "Second ring"],
	] as const) {
		expect(rows.length).toBeGreaterThan(0);
		expect(rows).toEqual(
			expect.arrayContaining([expect.objectContaining({ ray_id: ray, name: "icons.http" })]),
		);
		expect(JSON.stringify(rows)).toContain(name);
		expect(JSON.stringify(rows)).not.toContain("must-not-appear");
		expect(JSON.stringify(rows)).not.toContain(ray === "ray-a" ? "ray-b" : "ray-a");
	}
	expect(roots.every((span) => span.attributes["http.response.status_code"] === 201)).toBe(true);
	expect(probe.spans.some((span) => span.attributes["http.request.body"] !== undefined)).toBe(true);
});

it("exports only safe request headers while retaining request correlation", async () => {
	const runtime = makeIconsHttpHandler();
	const rows: unknown[] = [];
	const pending: Promise<unknown>[] = [];
	try {
		const response = await runtime.fetch(
			new Request("https://headers.example/api/icons?q=k8s", {
				headers: {
					"cf-connecting-ip": "192.0.2.41",
					"cf-connecting-ipv6": "2001:db8::41",
					"true-client-ip": "192.0.2.42",
					"x-real-ip": "192.0.2.43",
					"x-forwarded-for": "192.0.2.44, 192.0.2.45",
					forwarded: 'for="[2001:db8::46]";by=192.0.2.47',
					"x-original-forwarded-for": "192.0.2.48",
					"x-client-ip": "192.0.2.49",
					"x-envoy-external-address": "192.0.2.50",
					"x-forwarded-host": "192.0.2.51",
					authorization: "Bearer private-value",
					cookie: "session=private-value",
					"cf-ray": "safe-ray",
					traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
					"x-sketchi-client": "sketchi-cli",
					accept: "application/json",
				},
			}),
			{
				ASSETS: { fetch: async () => new Response("unused") },
				TELEMETRY_SPANS: {
					send: async (batch) => {
						rows.push(...batch);
					},
				},
			},
			{
				waitUntil: (promise) => {
					pending.push(promise);
				},
			},
		);
		await Promise.all(pending);
		expect(response.status).toBe(200);
		expect(rows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: "icons.http",
					kind: "server",
					trace_id: "0123456789abcdef0123456789abcdef",
					parent_span_id: "0123456789abcdef",
				}),
			]),
		);
		const serialized = JSON.stringify(rows);
		expect(serialized).not.toMatch(/192\.0\.2\.|2001:db8|private-value/);
		expect(serialized).toContain("safe-ray");
		expect(serialized).toContain("sketchi-cli");
		expect(serialized).toContain("application/json");
		expect(serialized).toContain(response.headers.get("x-sketchi-run-id"));
	} finally {
		await runtime.dispose();
		await Promise.all(pending);
	}
});

it("serves no pipeline reports or source review data", () => {
	const publicRoot = resolve(process.cwd(), "apps/icons/public");
	expect(existsSync(resolve(publicRoot, "output/reports"))).toBe(false);
	expect(existsSync(resolve(publicRoot, "output/review"))).toBe(false);
	expect(existsSync(resolve(publicRoot, "icons-manifest.json"))).toBe(true);
});
