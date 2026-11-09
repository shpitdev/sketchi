import type { CloudflareAiGatewayProvider } from "@sketchi/diagram-generation";
import { lookAlikeMarks } from "@sketchi/icon-catalog/look-alikes";
import type { IconImagingJob } from "@sketchi/icon-draw";
import { describe, expect, it } from "vitest";

import type { StudioEnv } from "../bindings/studio-env.server";
import type { CodeModePngRendererNamespace } from "../codemode/browser-renderer.server";
import { runPlaygroundEffect } from "../runtime/runtime.server";
import { handleDrawIconRequest } from "./draw.server";

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
