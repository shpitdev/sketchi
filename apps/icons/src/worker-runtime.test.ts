// @vitest-environment node

import { Effect, Layer } from "effect";
import { McpClient, McpProtocol } from "effect/ai";
import { FetchHttpClient } from "effect/http";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:net";
import { request as httpRequest } from "node:http";
import { dirname, resolve } from "node:path";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const workerConfig = resolve(process.cwd(), "dist/apps/icons/server/wrangler.json");

let origin = "";
let worker: ChildProcessWithoutNullStreams | undefined;
let workerOutput = "";
let localDirectory = "";

async function availablePort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((resolveListen, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolveListen);
	});
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Could not reserve a local Worker port.");
	}
	await new Promise<void>((resolveClose, reject) =>
		server.close((error) => (error ? reject(error) : resolveClose())),
	);
	return address.port;
}

async function waitForWorker(url: string): Promise<void> {
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		if (worker?.exitCode !== null) {
			throw new Error(`Local Worker exited early.\n${workerOutput}`);
		}
		try {
			const response = await fetch(url);
			if (response.ok) return;
		} catch {
			// Wrangler is still starting.
		}
		await new Promise((resolveWait) => setTimeout(resolveWait, 100));
	}
	throw new Error(`Timed out waiting for local Worker.\n${workerOutput}`);
}

describe("built icons Worker", () => {
	beforeAll(async () => {
		// Exercise the built product with local bindings; never connect its configured
		// production AI or telemetry from a runtime test.
		await mkdir(resolve(process.cwd(), ".memory/worker-tests"), { recursive: true });
		localDirectory = await mkdtemp(resolve(process.cwd(), ".memory/worker-tests/icons-"));
		const config = JSON.parse(await readFile(workerConfig, "utf8"));
		delete config.ai;
		delete config.previews;
		delete config.pipelines;
		config.main = resolve(dirname(workerConfig), config.main);
		config.assets.directory = resolve(dirname(workerConfig), config.assets.directory);
		const localConfig = resolve(localDirectory, "wrangler.json");
		await writeFile(localConfig, JSON.stringify(config));
		const port = await availablePort();
		origin = `http://127.0.0.1:${port}`;
		worker = spawn(
			"pnpm",
			[
				"exec",
				"wrangler",
				"dev",
				"--config",
				localConfig,
				"--local",
				"--persist-to",
				localDirectory,
				"--ip",
				"127.0.0.1",
				"--port",
				String(port),
			],
			{ cwd: process.cwd(), env: process.env, detached: true },
		);
		worker.stdout.on("data", (chunk: Buffer) => {
			workerOutput += chunk.toString();
		});
		worker.stderr.on("data", (chunk: Buffer) => {
			workerOutput += chunk.toString();
		});
		await waitForWorker(`${origin}/api/icons?q=k8s&limit=1`);
	}, 35_000);

	afterAll(async () => {
		if (worker && worker.exitCode === null) {
			process.kill(-worker.pid!, "SIGTERM");
			await Promise.race([
				new Promise<void>((resolveExit) => worker?.once("exit", () => resolveExit())),
				new Promise<void>((resolveWait) => setTimeout(resolveWait, 5_000)),
			]);
			if (worker.exitCode === null) process.kill(-worker.pid!, "SIGKILL");
		}
		if (localDirectory) await rm(localDirectory, { recursive: true, force: true });
	});

	it("serves detail, raw SVG, HEAD, and CORS through the assets binding", async () => {
		const detail = await fetch(`${origin}/api/icons/kubernetes`);
		expect(detail.status).toBe(200);
		expect(detail.headers.get("Access-Control-Allow-Origin")).toBe("*");
		await expect(detail.json()).resolves.toMatchObject({
			name: "Kubernetes",
			slug: "kubernetes",
			svg: expect.stringContaining("<svg"),
		});

		const raw = await fetch(`${origin}/api/icons/react.svg`);
		expect(raw.status).toBe(200);
		expect(raw.headers.get("Content-Type")).toContain("image/svg+xml");
		expect(raw.headers.get("Access-Control-Allow-Origin")).toBe("*");
		await expect(raw.text()).resolves.toContain("<svg");

		const head = await fetch(`${origin}/api/icons/react.svg`, {
			method: "HEAD",
		});
		expect(head.status).toBe(200);
		expect(head.headers.get("Content-Type")).toContain("image/svg+xml");
		expect(await head.text()).toBe("");

		const options = await fetch(`${origin}/api/icons/react.svg`, {
			method: "OPTIONS",
		});
		expect(options.status).toBe(204);
		expect(options.headers.get("Access-Control-Allow-Origin")).toBe("*");
		expect(options.headers.get("Access-Control-Allow-Methods")).toContain("HEAD");
	});

	it("rejects oversized MCP bodies and loads raw SVG in the built Worker", async () => {
		// Observe the early HTTP rejection while upload is in flight. Node Fetch
		// can replace this response with a socket error when workerd closes it.
		const oversized = await new Promise<{ status: number | undefined; body: string }>(
			(resolveResponse, reject) => {
				const body = JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "tools/call",
					params: { name: "get_icon", arguments: { slug: "x".repeat(1024 * 1024) } },
				});
				const outgoing = httpRequest(
					`${origin}/mcp`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Accept: "application/json, text/event-stream",
							"Content-Length": Buffer.byteLength(body),
						},
					},
					(incoming) => {
						let text = "";
						incoming.setEncoding("utf8");
						incoming.on("data", (chunk: string) => {
							text += chunk;
						});
						incoming.on("error", reject);
						incoming.on("end", () => resolveResponse({ status: incoming.statusCode, body: text }));
					},
				);
				outgoing.on("error", reject);
				outgoing.end(body);
			},
		);
		expect(oversized).toEqual({ status: 413, body: "" });
		await Effect.runPromise(
			Effect.gen(function* () {
				const client = yield* McpClient.McpClient;
				const tool = (yield* client.listTools()).find((tool) => tool.name === "get_icon");
				if (!tool) throw new Error("get_icon missing from built Worker");
				const result = yield* client.callTool({ tool, arguments: { slug: "kubernetes" } });
				expect(result.content[0]).toMatchObject({
					type: "text",
					text: expect.stringContaining("<svg"),
				});
				expect(result.structuredContent).toMatchObject({ slug: "kubernetes" });
			}).pipe(
				Effect.provide(
					McpClient.layerHttp({
						name: "worker-smoke",
						version: "0.0.0",
						protocol: McpProtocol.v2025_11_25,
						url: `${origin}/mcp`,
					}).pipe(Layer.provide(FetchHttpClient.layer)),
				),
			),
		);
	});
});
