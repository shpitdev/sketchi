import type { CloudflareAiGatewayProvider } from "@sketchi/diagram-generation";
import { takeClientRequest } from "@sketchi/community-icons";
import { lookAlikeMarks } from "@sketchi/icon-catalog/look-alikes";
import type { IconImagingJob } from "@sketchi/icon-draw";
import { describe, expect, it } from "vitest";

import type { StudioEnv } from "../bindings/studio-env.server";
import type { CodeModePngRendererNamespace } from "../codemode/browser-renderer.server";
import { runPlaygroundEffect } from "../runtime/runtime.server";
import { drawIconForAgent, handleDrawIconRequest, secondsUntilUtcMidnight } from "./draw.server";

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
			prewarm: () => undefined,
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

function draw(env: StudioEnv, body: unknown): Promise<Response> {
	const request = new Request("https://studio.example/api/v1/icons/draw", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
	return runPlaygroundEffect(handleDrawIconRequest(request), {
		env,
		request,
		platform: { waitUntilPromise: () => undefined },
	});
}

describe("POST /api/v1/icons/draw", () => {
	it("draws a logo through the gateway and Browser Rendering and returns the icon", async () => {
		const calls: Calls = { gateway: [], jobs: [], assets: [] };
		// The fake judge always picks the first logo; when that is a look-alike the author gets one
		// more turn, and here it keeps its drawing.
		const replies = [
			{ accept: false, recipe },
			{ accept: true, recipe: null },
			{ accept: true, recipe: null },
		];
		const response = await draw(fakeEnv(calls, replies), {
			name: "Acme",
			svg: SVG,
		});
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		const body = (await response.json()) as Record<string, unknown>;
		expect(body).toMatchObject({
			ok: true,
			status: "drawn",
			name: "Acme",
			recipe,
			previews: { png28: "iVBORw0KGgo=", png112: "iVBORw0KGgo=" },
			excalidrawlib: { type: "excalidrawlib", version: 2 },
			author: { model: "anthropic/claude-sonnet-5-5", accepted: true },
		});
		const judge = body["judge"] as { lineup: string[]; picked: string; recognizable: boolean };
		expect(judge).toMatchObject({ model: "gemini-3.8-flash", attempts: 1 });
		expect(judge.lineup).toHaveLength(5);
		expect(judge.picked).toBe(judge.lineup[0]);
		expect(judge.recognizable).toBe(judge.lineup[0] === "source");
		// Author turns on the native Messages API, the judge on Gemini.
		expect(calls.gateway.map((call) => `${call.provider} ${call.endpoint}`)).toEqual([
			"anthropic v1/messages",
			"anthropic v1/messages",
			"google-ai-studio v1beta/models/gemini-3.8-flash:generateContent",
			...(judge.recognizable ? [] : ["anthropic v1/messages"]),
		]);
		expect(calls.gateway[0]?.query).toMatchObject({
			model: "claude-sonnet-5-5",
			thinking: { type: "adaptive" },
			output_config: { effort: "low", format: { type: "json_schema" } },
		});
		// The look-alikes come from the Worker's own node-logo assets.
		// Eight ranked look-alikes load, so a spare replaces any that fails.
		expect(calls.assets).toHaveLength(8);
		expect(calls.assets.every((url) => url.startsWith("https://studio.example/node-logos/"))).toBe(
			true,
		);
	});

	it("answers bad input without calling a model", async () => {
		const calls: Calls = { gateway: [], jobs: [], assets: [] };
		const env = fakeEnv(calls, []);
		const status = async (body: unknown) => {
			const response = await draw(env, body);
			const json = (await response.json()) as { status: string; issues: { code: string }[] };
			return `${response.status} ${json.status} ${json.issues[0]?.code}`;
		};
		expect(await status("{")).toBe("400 invalid_input invalid_json");
		expect(await status({ name: "Acme" })).toBe("400 invalid_input one_source_required");
		expect(await status({ name: "Acme", svg: "<svg" })).toBe("400 invalid_input malformed_svg");
		expect(await status({ name: "Acme", svg: SVG, model: "gpt-5" })).toBe(
			"400 unsupported_model unsupported_model",
		);
		expect(await status({ name: "Acme", image: "x".repeat(6 * 1024 * 1024) })).toBe(
			"400 invalid_input request_too_large",
		);
		expect(calls.gateway).toEqual([]);
		expect(calls.jobs).toEqual([]);
	});

	it("says so when the deployment cannot draw", async () => {
		const response = await draw({}, { name: "Acme", svg: SVG });
		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({ ok: false, status: "not_configured" });
	});
});

describe("drawing is bounded per client and per day", () => {
	const recipeReplies = () => [
		{ accept: false, recipe },
		{ accept: true, recipe: null },
		{ accept: true, recipe: null },
	];
	const withRequest = (env: StudioEnv, body: unknown, ip = "203.0.113.7") => {
		const request = new Request("https://studio.example/api/v1/icons/draw", {
			method: "POST",
			headers: { "content-type": "application/json", "cf-connecting-ip": ip },
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

	it("refuses every client once the day's budget is spent, until midnight UTC", async () => {
		const calls: Calls = { gateway: [], jobs: [], assets: [] };
		const admitted: number[] = [];
		let used = 0;
		const env: StudioEnv = {
			...fakeEnv(calls, recipeReplies()),
			SKETCHI_ICON_DAILY_DRAWS: "1",
			ICON_DRAW_BUDGET: {
				getByName: () => ({
					admit: (cap) => {
						admitted.push(cap);
						if (used >= cap) return Promise.resolve({ admitted: false, used });
						used += 1;
						return Promise.resolve({ admitted: true, used });
					},
				}),
			},
		};
		// A request the input checks refuse never counts against the budget.
		expect((await withRequest(env, { name: "Acme", svg: "<svg" })).status).toBe(400);
		expect(admitted).toEqual([]);
		expect((await withRequest(env, { name: "Acme", svg: SVG })).status).toBe(200);
		const refused = await withRequest(env, { name: "Acme", svg: SVG }, "198.51.100.2");
		expect(refused.status).toBe(429);
		expect(await refused.json()).toMatchObject({ issues: [{ code: "daily_limit" }] });
		const retryAfter = Number(refused.headers.get("retry-after"));
		expect(retryAfter).toBeGreaterThan(0);
		expect(retryAfter).toBeLessThanOrEqual(24 * 60 * 60);
		expect(admitted).toEqual([1, 1]);
	});

	it("does not draw when the budget cannot be counted", async () => {
		const calls: Calls = { gateway: [], jobs: [], assets: [] };
		const env: StudioEnv = {
			...fakeEnv(calls, recipeReplies()),
			ICON_DRAW_BUDGET: { getByName: () => ({ admit: () => Promise.reject(new Error("down")) }) },
		};
		const response = await withRequest(env, { name: "Acme", svg: SVG });
		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({ issues: [{ code: "budget_unavailable" }] });
		expect(calls.gateway).toEqual([]);
	});

	it("gives an agent's script the recipe and verdict without the images", async () => {
		const calls: Calls = { gateway: [], jobs: [], assets: [] };
		const env = fakeEnv(calls, recipeReplies());
		const request = new Request("https://studio.example/mcp", { method: "POST" });
		const result = await runPlaygroundEffect(drawIconForAgent({ name: "Acme", svg: SVG }), {
			env,
			request,
			platform: { waitUntilPromise: () => undefined },
		});
		expect(result).toMatchObject({ ok: true, status: "drawn", name: "Acme", recipe });
		expect(result).not.toHaveProperty("previews");
		expect(result).not.toHaveProperty("excalidrawlib");
		expect(Object.keys(result).sort()).toEqual(
			["author", "judge", "name", "ok", "palette", "recipe", "status", "usage"].sort(),
		);
	});
});

describe("secondsUntilUtcMidnight", () => {
	it("counts to the next UTC day", () => {
		expect(secondsUntilUtcMidnight(Date.UTC(2026, 10, 9, 23, 59, 0))).toBe(60);
		expect(secondsUntilUtcMidnight(Date.UTC(2026, 10, 9, 0, 0, 0))).toBe(24 * 60 * 60);
	});
});
