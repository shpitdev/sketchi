import type { CommunityPublished } from "@sketchi/community-icons/http-api";
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "@effect/vitest";

const binary = resolve(process.cwd(), "apps/cli/dist/sketchi.js");
const testParent = resolve(process.cwd(), ".memory/cli-icon-tests");

const SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="20" height="20" fill="#e01e5a"/></svg>';
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);

interface Seen {
	readonly path: string;
	readonly body: Record<string, unknown>;
}

function drawn(name: string) {
	return {
		ok: true,
		status: "drawn",
		name,
		recipe: {
			parts: [{ kind: "rect" as const, x: 2, y: 2, width: 20, height: 20, fill: "#e01e5a" }],
		},
		previews: { png28: PNG.toString("base64"), png112: PNG.toString("base64") },
		excalidrawlib: {
			type: "excalidrawlib",
			version: 2,
			source: "https://sketchi.app",
			libraryItems: [{ id: `item-${name}`, status: "published", created: 1, name, elements: [] }],
		},
		judge: { recognizable: true, picked: "source", model: "gemini-3.8-flash" },
		palette: [["#e01e5a", 100]],
		author: { model: "anthropic/claude-sonnet-5-5", rounds: 2, accepted: true, turns: [] },
		usage: { calls: 3, ms: 9000, inputTokens: 100, outputTokens: 50 },
	};
}

type Handler = (seen: Seen, response: ServerResponse) => void;

const servers: ReturnType<typeof createServer>[] = [];
afterEach(() => {
	for (const server of servers.splice(0)) server.close();
});

async function serve(handler: Handler) {
	const seen: Seen[] = [];
	const server = createServer((request: IncomingMessage, response) => {
		const chunks: Buffer[] = [];
		request.on("data", (chunk: Buffer) => chunks.push(chunk));
		request.on("end", () => {
			const entry = {
				path: request.url ?? "",
				body: JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>,
			};
			seen.push(entry);
			response.setHeader("content-type", "application/json");
			handler(entry, response);
		});
	});
	servers.push(server);
	await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
	const address = server.address();
	if (address === null || typeof address === "string") throw new Error("Expected a TCP address.");
	return { seen, origin: `http://127.0.0.1:${String(address.port)}` };
}

function runCli(args: readonly string[], cwd: string, env: NodeJS.ProcessEnv = {}) {
	return new Promise<{ code: number; stdout: string; stderr: string }>((complete, reject) => {
		const environment: NodeJS.ProcessEnv = { ...process.env, HOME: cwd, ...env };
		delete environment["FORCE_COLOR"];
		delete environment["NO_COLOR"];
		const child = spawn(process.execPath, [binary, ...args], { cwd, env: environment });
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
		child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
		child.on("error", reject);
		child.on("close", (code) =>
			complete({
				code: code ?? -1,
				stdout: Buffer.concat(stdout).toString(),
				stderr: Buffer.concat(stderr).toString(),
			}),
		);
	});
}

async function workspace() {
	await mkdir(testParent, { recursive: true });
	return mkdtemp(join(testParent, "run-"));
}

describe("sketchi icon draw", () => {
	it("draws a folder as one pack, sends rasters as base64, and waits out a short rate limit", async () => {
		const root = await workspace();
		await mkdir(join(root, "logos"));
		await writeFile(join(root, "logos", "beta_corp.png"), PNG);
		await writeFile(join(root, "logos", "alpha-labs.svg"), SVG);
		await writeFile(join(root, "logos", "notes.txt"), "not a logo");
		let limited = false;
		const { seen, origin } = await serve(({ body }, response) => {
			if (!limited) {
				limited = true;
				response.statusCode = 429;
				response.setHeader("retry-after", "1");
				response.end(
					JSON.stringify({
						ok: false,
						status: "rate_limited",
						issues: [{ code: "rate_limited", message: "Slow down.", hint: "Wait." }],
					}),
				);
				return;
			}
			response.end(JSON.stringify(drawn(String(body["name"]))));
		});
		const result = await runCli(
			["icon", "draw", "logos", "--dest", "out", "--endpoint", `${origin}/draw`],
			root,
		);
		expect(result.code).toBe(0);
		expect(seen.map(({ body }) => body["name"])).toEqual(["alpha labs", "alpha labs", "beta corp"]);
		expect(seen[2]?.body).toEqual({ name: "beta corp", image: PNG.toString("base64") });
		expect(result.stdout).toContain("✓ alpha labs");
		expect(result.stdout).toContain("pack: out/logos.excalidrawlib");
		const pack = JSON.parse(await readFile(join(root, "out", "logos.excalidrawlib"), "utf8"));
		expect(pack.libraryItems.map((item: { name: string }) => item.name)).toEqual([
			"alpha labs",
			"beta corp",
		]);
	});

	it("publishes each drawn icon with the judge's verdict, and keeps the icon when publishing fails", async () => {
		const root = await workspace();
		await writeFile(join(root, "acme.svg"), SVG);
		const draws = await serve(({ body }, response) =>
			response.end(JSON.stringify(drawn(String(body["name"])))),
		);
		const store = await serve((_seen, response) => {
			response.statusCode = 201;
			response.end(
				JSON.stringify({
					slug: "community/acme",
					name: "acme",
					recipe: drawn("acme").recipe,
					colors: ["#e01e5a"],
					createdAt: "2026-11-08T12:00:00.000Z",
					url: "https://icons.example/community/acme",
					api: "https://icons.example/api/community/acme",
					created: true,
				} satisfies typeof CommunityPublished.Type),
			);
		});
		const published = await runCli(
			["icon", "draw", "acme.svg", "--publish", "--endpoint", `${draws.origin}/draw`],
			root,
			{ SKETCHI_COMMUNITY_ENDPOINT: `${store.origin}/api/community` },
		);
		expect(published.code).toBe(0);
		expect(store.seen[0]?.body).toEqual({
			name: "acme",
			recipe: drawn("x").recipe,
			verdict: { recognizable: true, judge: "gemini-3.8-flash" },
		});
		expect(published.stdout).toContain("published: https://icons.example/community/acme");

		const refusing = await serve((_seen, response) => {
			response.statusCode = 422;
			response.end(JSON.stringify({ error: { code: "rejected", message: "Not allowed." } }));
		});
		const kept = await runCli(
			["icon", "draw", "acme.svg", "--publish", "--endpoint", `${draws.origin}/draw`],
			root,
			{ SKETCHI_COMMUNITY_ENDPOINT: `${refusing.origin}/api/community` },
		);
		expect(kept.code).toBe(0);
		expect(kept.stdout).toContain("not published: Not allowed.");
	});
});
