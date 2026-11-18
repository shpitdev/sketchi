import type { CloudflareAiGatewayProvider } from "@sketchi/cloudflare/ai-gateway";
import { takeClientRequest } from "@sketchi/community-icons";
import { lookAlikeMarks } from "@sketchi/icon-catalog/look-alikes";
import { ICON_DRAW_REQUEST_MAX_BYTES, type IconImagingJob } from "@sketchi/icon-draw";
import { describe, expect, it, vi } from "vitest";

import type { StudioEnv } from "../../../server/studio-env.server";
import type { CodeModePngRendererNamespace } from "../../render/browser-renderer.server";
import { runPlaygroundEffect } from "../../../server/runtime.server";
import { IconDrawBudget } from "../budget-object.server";
import { handleDrawIconRequest } from "../draw.server";

const SVG = `<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" fill="#e01e5a"/></svg>`;
const recipe = {
	parts: [{ kind: "rect", x: 2, y: 2, width: 20, height: 20, rounded: true, fill: "#e01e5a" }],
};

interface Calls {
	readonly gateway: { endpoint: string; provider: string; query: Record<string, unknown> }[];
	readonly jobs: IconImagingJob[];
	readonly assets: string[];
}

function fakeEnv(calls: Calls, authorReplies: unknown[]): StudioEnv {
	const ai: CloudflareAiGatewayProvider = {
		gateway: () => ({
			run: (input) => {
				calls.gateway.push(input as Calls["gateway"][number]);
				if (input.provider === "anthropic") {
					const text = JSON.stringify(authorReplies.shift());
					return Promise.resolve(
						Response.json({
							id: "msg_fixture",
							type: "message",
							role: "assistant",
							stop_sequence: null,
							model: "claude-sonnet-5-5",
							content: [{ type: "text", text }],
							stop_reason: "end_turn",
							usage: { input_tokens: 10, output_tokens: 30, cache_read_input_tokens: 900 },
						}),
					);
				}
				// The judge: always the first logo in its lineup.
				return Promise.resolve(
					Response.json({
						candidates: [{ content: { parts: [{ text: '{"logo": 1}' }] } }],
						usageMetadata: { promptTokenCount: 400, candidatesTokenCount: 5 },
					}),
				);
			},
			getUrl: () => Promise.resolve("https://gateway.invalid"),
		}),
	};
	const renderer: CodeModePngRendererNamespace = {
		getByName: () => ({
			renderPng: () => Promise.reject(new Error("not used")),
			runIconJob: ({ job }) => {
				calls.jobs.push(job);
				return Promise.resolve({
					_tag: "Done",
					result: {
						prepared: Object.fromEntries(
							job.prepare.map((item) => [
								item.id,
								{ png: "iVBORw0KGgo=", features: lookAlikeMarks["slack"]! },
							]),
						),
						exported: Object.fromEntries(job.exports.map((item) => [item.id, "iVBORw0KGgo="])),
					},
				});
			},
		}),
	};
	return {
		AI: ai,
		CODEMODE_PNG_RENDERER: renderer,
		ASSETS: {
			fetch: (input) => {
				calls.assets.push(input instanceof Request ? input.url : input.toString());
				return Promise.resolve(
					new Response('<svg viewBox="0 0 2 2"><rect width="2" height="2"/></svg>'),
				);
			},
		},
	};
}

describe("drawing is bounded per client and per day", () => {
	const recipeReplies = () => [
		{ accept: false, recipe },
		{ accept: true, recipe: null },
		{ accept: true, recipe: null },
	];
	const withRequest = (
		env: StudioEnv,
		body: unknown,
		ip = "203.0.113.7",
		contentLength?: number,
	) => {
		const request = new Request("https://studio.example/api/v1/icons/draw", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"cf-connecting-ip": ip,
				...(contentLength === undefined ? {} : { "content-length": String(contentLength) }),
			},
			body: JSON.stringify(body),
		});
		return runPlaygroundEffect(handleDrawIconRequest(request), {
			env,
			request,
			platform: { waitUntilPromise: () => undefined },
		});
	};

	it("refuses a client's seventh request in a minute with Retry-After, before reading its logo", async () => {
		const calls: Calls = { gateway: [], jobs: [], assets: [] };
		// The real sliding window, one store per object name, as the Durable Objects keep them.
		const objects = new Map<string, Map<string, unknown>>();
		const names: string[] = [];
		const env: StudioEnv = {
			...fakeEnv(calls, recipeReplies()),
			ICON_DRAW_CLIENT_LIMIT: {
				getByName: (name) => {
					names.push(name);
					const stored = objects.get(name) ?? new Map<string, unknown>();
					objects.set(name, stored);
					return {
						take: (limit, windowMs) =>
							takeClientRequest(
								{
									get: <T>(key: string) => Promise.resolve(stored.get(key) as T | undefined),
									put: <T>(key: string, value: T) => {
										stored.set(key, value);
										return Promise.resolve();
									},
								},
								limit,
								windowMs,
								Date.now(),
							),
					};
				},
			},
		};
		// Malformed or not, every request counts against its client.
		const statuses: number[] = [];
		for (let request = 0; request < 10; request += 1) {
			statuses.push((await withRequest(env, { name: "Acme", svg: "<svg" })).status);
		}
		expect(statuses).toEqual([400, 400, 400, 400, 400, 400, 429, 429, 429, 429]);
		const refused = await withRequest(env, { name: "Acme", svg: SVG });
		expect(refused.status).toBe(429);
		const retryAfter = Number(refused.headers.get("retry-after"));
		expect(retryAfter).toBeGreaterThan(0);
		expect(retryAfter).toBeLessThanOrEqual(60);
		expect(await refused.json()).toMatchObject({
			ok: false,
			status: "rate_limited",
			issues: [{ code: "rate_limited" }],
		});
		// Another address has its own count.
		expect((await withRequest(env, { name: "Acme", svg: "<svg" }, "198.51.100.2")).status).toBe(
			400,
		);
		expect(new Set(names)).toEqual(new Set(["client:203.0.113.7", "client:198.51.100.2"]));
		expect(calls.gateway).toEqual([]);
	});

	it("refuses every client once the real daily budget is spent, reopens at midnight UTC and never on a clock step back", async () => {
		const calls: Calls = { gateway: [], jobs: [], assets: [] };
		// The production budget object over Durable Object-shaped storage.
		const stored = new Map<string, unknown>();
		const budget = new IconDrawBudget(
			{
				storage: {
					list: ({ prefix = "" }: { prefix?: string } = {}) =>
						Promise.resolve(new Map([...stored].filter(([key]) => key.startsWith(prefix)))),
					put: (key: string, value: unknown) => {
						stored.set(key, value);
						return Promise.resolve();
					},
					delete: (keys: string[]) => {
						for (const key of keys) stored.delete(key);
						return Promise.resolve(keys.length);
					},
				},
			},
			{},
		);
		const env: StudioEnv = {
			...fakeEnv(calls, [...recipeReplies(), ...recipeReplies()]),
			SKETCHI_ICON_DAILY_DRAWS: "1",
			ICON_DRAW_BUDGET: { getByName: () => budget },
		};
		const at = (iso: string) => vi.setSystemTime(new Date(iso));
		vi.useFakeTimers({ toFake: ["Date"] });
		try {
			at("2026-11-09T23:59:00Z");
			// A request the input checks refuse never counts against the budget.
			expect((await withRequest(env, { name: "Acme", svg: "<svg" })).status).toBe(400);
			const drawn = await withRequest(env, { name: "Acme", svg: SVG });
			expect(drawn.status).toBe(200);
			expect(drawn.headers.get("cache-control")).toBe("no-store");
			expect(drawn.headers.get("x-sketchi-event-id")).toBeTruthy();
			const body: unknown = await drawn.json();
			expect(body).toMatchObject({
				ok: true,
				status: "drawn",
				name: "Acme",
				previews: { png28: expect.any(String), png112: expect.any(String) },
				excalidrawlib: { type: "excalidrawlib", libraryItems: [{ elements: expect.any(Array) }] },
				usage: {
					byCall: expect.arrayContaining([
						{
							role: "author",
							model: expect.any(String),
							usage: expect.any(Object),
							ms: expect.any(Number),
						},
					]),
				},
			});
			// Provider usage completeness is engine bookkeeping, not part of the public response.
			expect(JSON.stringify(body)).not.toContain('"usageReported"');
			const refused = await withRequest(env, { name: "Acme", svg: SVG }, "198.51.100.2");
			expect(refused.status).toBe(429);
			expect(await refused.json()).toMatchObject({ issues: [{ code: "daily_limit" }] });
			expect(refused.headers.get("retry-after")).toBe("60");

			at("2026-11-10T00:00:05Z");
			expect((await withRequest(env, { name: "Acme", svg: SVG })).status).toBe(200);
			// A clock that steps back into the previous day must not reopen it.
			at("2026-11-09T23:59:58Z");
			expect((await withRequest(env, { name: "Acme", svg: SVG })).status).toBe(429);
			at("2026-11-10T00:00:09Z");
			expect((await withRequest(env, { name: "Acme", svg: SVG })).status).toBe(429);
			expect([...stored]).toEqual([["draws:2026-11-10", 1]]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("refuses a body above the upload cap before admission", async () => {
		const body = { name: "Acme", svg: SVG };
		const response = await withRequest({}, body, undefined, ICON_DRAW_REQUEST_MAX_BYTES + 1);
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			ok: false,
			status: "invalid_input",
			issues: [{ code: "request_too_large" }],
		});
	});

	it("does not draw when the budget cannot be counted", async () => {
		const calls: Calls = { gateway: [], jobs: [], assets: [] };
		const env: StudioEnv = {
			...fakeEnv(calls, recipeReplies()),
			ICON_DRAW_BUDGET: { getByName: () => ({ admit: () => Promise.reject(new Error("down")) }) },
		};
		const response = await withRequest(env, { name: "Acme", svg: SVG });
		expect(response.status).toBe(503);
		expect(response.headers.get("retry-after")).toBe("60");
		expect(await response.json()).toMatchObject({ issues: [{ code: "budget_unavailable" }] });
		expect(calls.gateway).toEqual([]);
	});
});
