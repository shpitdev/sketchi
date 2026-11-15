// @vitest-environment node
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import type { CommunityIconDatabase, CommunityIconStatement } from "@sketchi/community-icons";
import { makeTelemetryTestSink } from "@sketchi/observability";
import { afterEach, expect, it } from "vitest";

import { makeIconsHttpHandler } from "./http.server";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) await cleanup();
});
function database(): CommunityIconDatabase {
	const sqlite = new DatabaseSync(":memory:");
	cleanups.push(() => sqlite.close());
	function statement(sql: string, values: SQLInputValue[] = []): CommunityIconStatement {
		return {
			bind: (...args) =>
				statement(
					sql,
					args.map((value) => {
						if (typeof value === "string" || typeof value === "number" || value === null)
							return value;
						throw new Error("Unexpected D1 fixture value");
					}),
				),
			first: async <T>() => (sqlite.prepare(sql).get(...values) as T | undefined) ?? null,
			all: async <T>() => ({ results: sqlite.prepare(sql).all(...values) as T[] }),
			run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }),
		};
	}
	return { prepare: (sql) => statement(sql) };
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
		COMMUNITY_ICONS: database(),
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
		COMMUNITY_ICONS: database(),
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

it("cancels the request-owned asset read without losing another request's response", async () => {
	const runtime = makeIconsHttpHandler();
	cleanups.push(runtime.dispose);
	const started = Promise.withResolvers<void>();
	const aborted = Promise.withResolvers<void>();
	const controller = new AbortController();
	const env = {
		ASSETS: {
			fetch: (_input: Request | URL | string, init?: RequestInit) => {
				started.resolve();
				return new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener(
						"abort",
						() => {
							aborted.resolve();
							reject(new Error("Owned request interrupted"));
						},
						{ once: true },
					);
				});
			},
		},
	};
	const first = runtime.fetch(
		new Request("https://one.example/api/icons/kubernetes", { signal: controller.signal }),
		env,
		{ waitUntil: () => {} },
	);
	await started.promise;
	const second = await runtime.fetch(new Request("https://two.example/api/icons?q=k8s"), env, {
		waitUntil: () => {},
	});
	expect(await second.json()).toMatchObject({
		results: [{ detailUrl: "https://two.example/api/icons/kubernetes" }],
	});
	controller.abort();
	await aborted.promise;
	expect((await first).status).toBe(499);
});
