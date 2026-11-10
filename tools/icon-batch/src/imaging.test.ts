import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { IconRecipe } from "@sketchi/diagram-core";
import { lookAlikeMarks } from "@sketchi/icon-catalog/look-alikes";
import { getIconSourceFile } from "@sketchi/icon-catalog/catalog";
import { previewScene, roundSheet } from "@sketchi/icon-draw";
import { describe, expect, it } from "vitest";

import { exportScenePng, initializeResvg } from "./excalidraw-export.js";
import { httpGateway } from "./gateway.js";
import { prepareSvg, reframeSvg } from "./imaging.js";

const catalogSvg = (slug: string) =>
	readFile(
		join(
			resolve(import.meta.dirname, "../../../packages/icons/catalog/svg"),
			getIconSourceFile(slug)!,
		),
		"utf8",
	);

function pngSize(base64: string) {
	const bytes = Buffer.from(base64, "base64");
	expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
	return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("prepareSvg", () => {
	it("measures a catalog mark as its look-alike entry does and draws it trimmed and square", async () => {
		await initializeResvg();
		const prepared = prepareSvg({
			id: "source",
			source: { kind: "svg", svg: await catalogSvg("docker"), colors: [] },
			size: 256,
			quantize: false,
		});
		expect(prepared).toBeDefined();
		const { hash: _hash, ...expected } = lookAlikeMarks["docker"] as { hash: string };
		expect(prepared?.features).toEqual(expected);
		expect(pngSize(prepared!.png)).toEqual({ width: 256, height: 256 });
	});

	it("reports a blank drawing as nothing", async () => {
		await initializeResvg();
		const blank =
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#ffffff"/></svg>';
		expect(
			prepareSvg({
				id: "x",
				source: { kind: "svg", svg: blank, colors: [] },
				size: 64,
				quantize: false,
			}),
		).toBeUndefined();
	});

	it("reframes only the root element", () => {
		const svg = '<svg viewBox="0 0 10 10" width="10" height="10"><svg viewBox="0 0 1 1"/></svg>';
		expect(reframeSvg(svg, { minX: 1, minY: 2, width: 3, height: 3 }, 64)).toBe(
			'<svg viewBox="1 2 3 3" width="64" height="64" preserveAspectRatio="xMidYMid meet"><svg viewBox="0 0 1 1"/></svg>',
		);
	});
});

describe("exportScenePng", () => {
	const recipe: IconRecipe = {
		parts: [
			{ kind: "ellipse", cx: 12, cy: 12, rx: 9, ry: 9, fill: "#2496ed" },
			{ kind: "text", cx: 12, cy: 12, text: "Hi", size: 8 },
		],
	};

	it("exports previews at the service's padding and scale", async () => {
		const large = await exportScenePng(previewScene(recipe, 112), {
			padding: 8,
			scale: 2,
			backgroundColor: "#ffffff",
		});
		expect(pngSize(Buffer.from(large).toString("base64"))).toEqual({ width: 256, height: 256 });
		const small = await exportScenePng(previewScene(recipe, 28), {
			padding: 4,
			scale: 2,
			backgroundColor: "#ffffff",
		});
		expect(pngSize(Buffer.from(small).toString("base64"))).toEqual({ width: 72, height: 72 });
	});

	it("exports the author's round sheet with the source image in it", async () => {
		const source = prepareSvg({
			id: "source",
			source: { kind: "svg", svg: await catalogSvg("docker"), colors: [] },
			size: 256,
			quantize: false,
		})!;
		const sheet = await exportScenePng(roundSheet(recipe, source.png), {
			padding: 12,
			scale: 2,
			backgroundColor: "#ffffff",
		});
		// Source, 112 px drawing and 28 px drawing with 24-unit gaps, 12 units of padding, at 2x.
		expect(pngSize(Buffer.from(sheet).toString("base64"))).toEqual({ width: 648, height: 272 });
	});
});

describe("httpGateway", () => {
	it("sends the binding's request to the provider route with the token and gateway options", async () => {
		const seen: Array<{ url: string; headers: Headers; body: string }> = [];
		const logs: string[] = [];
		const gateway = httpGateway(
			{
				accountId: "acct",
				token: "secret",
				fetch: async (url, init) => {
					seen.push({
						url: url instanceof Request ? url.url : url.toString(),
						headers: new Headers(init?.headers),
						body: typeof init?.body === "string" ? init.body : "",
					});
					return new Response("{}", { headers: { "cf-aig-log-id": "log-1" } });
				},
			},
			(logId) => logs.push(logId),
		).gateway("google-ai-studio");
		await gateway.run(
			{
				provider: "anthropic",
				endpoint: "v1/messages",
				headers: { "content-type": "application/json" },
				query: { model: "claude-sonnet-5-5" },
			},
			{ gateway: { collectLog: true, skipCache: true, metadata: { sketchiTraceId: "t" } } },
		);
		expect(seen[0]?.url).toBe(
			"https://gateway.ai.cloudflare.com/v1/acct/google-ai-studio/anthropic/v1/messages",
		);
		expect(seen[0]?.headers.get("cf-aig-authorization")).toBe("Bearer secret");
		expect(seen[0]?.headers.get("cf-aig-metadata")).toBe('{"sketchiTraceId":"t"}');
		expect(seen[0]?.headers.get("cf-aig-skip-cache")).toBe("true");
		expect(JSON.parse(seen[0]?.body ?? "")).toEqual({ model: "claude-sonnet-5-5" });
		expect(logs).toEqual(["log-1"]);
	});
});
