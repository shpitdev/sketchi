import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest";

const binary = resolve(process.cwd(), "apps/cli/dist/sketchi.js");
const testParent = resolve(process.cwd(), ".memory/cli-history-tests");

const flowchart = {
	type: "flowchart",
	spec: {
		id: "checkout-flow",
		title: "Checkout flow",
		nodes: [
			{ id: "cart", label: "Cart", kind: "start" },
			{ id: "pay", label: "Pay", kind: "process" },
			{ id: "done", label: "Order placed", kind: "end" },
		],
		edges: [
			{ source: "cart", target: "pay" },
			{ source: "pay", target: "done" },
		],
	},
};

interface ProcessResult {
	readonly code: number;
	readonly stdout: string;
	readonly stderr: string;
}

let root = "";
let shims = "";
let server: Server;
let endpoint = "";
let copiedFile = "";

/**
 * The CLI under test sees a fake Wayland session whose wl-copy is a shim on PATH, so no
 * test reaches the real clipboard. CI is cleared so automatic copy is in play.
 */
function environment(home: string, overrides: Readonly<Record<string, string | undefined>> = {}) {
	const env: NodeJS.ProcessEnv = {
		PATH: `${shims}:/usr/bin:/bin`,
		HOME: home,
		WAYLAND_DISPLAY: "sketchi-test",
		SHIM_OUT: copiedFile,
	};
	for (const [key, value] of Object.entries(overrides)) {
		if (value === undefined) delete env[key];
		else env[key] = value;
	}
	return env;
}

function runCli(args: ReadonlyArray<string>, env: NodeJS.ProcessEnv, cwd = root) {
	return new Promise<ProcessResult>((complete, reject) => {
		const child = spawn(process.execPath, [binary, ...args], {
			cwd,
			env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
		child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
		child.on("error", reject);
		// "close" waits for every holder of the pipes, so a leaked daemon would hang here.
		child.on("close", (code) =>
			complete({
				code: code ?? -1,
				stdout: Buffer.concat(stdout).toString("utf8"),
				stderr: Buffer.concat(stderr).toString("utf8"),
			}),
		);
	});
}

async function freshHome(name: string) {
	const home = join(root, name);
	await mkdir(home, { recursive: true });
	return home;
}

const generate = (home: string, extra: ReadonlyArray<string> = [], env?: NodeJS.ProcessEnv) =>
	runCli(
		[
			"generate",
			"--prompt",
			"Map how a shopper pays at checkout",
			"--endpoint",
			endpoint,
			"--dest",
			join(home, "checkout-flow.png"),
			...extra,
		],
		env ?? environment(home),
	);

beforeAll(async () => {
	await mkdir(testParent, { recursive: true });
	root = await mkdtemp(join(testParent, "run-"));
	shims = join(root, "bin");
	copiedFile = join(root, "clipboard.png");
	await mkdir(shims);
	// Like wl-copy: read the image, fork a daemon holding inherited stdio, then exit.
	await writeFile(join(shims, "wl-copy"), '#!/bin/sh\ncat > "$SHIM_OUT"\n(sleep 5 &)\nexit 0\n');
	await chmod(join(shims, "wl-copy"), 0o755);

	// Seed the generate response from a real offline build of the same document.
	const seedHome = await freshHome("seed");
	const seeded = await runCli(
		["create", "--json", JSON.stringify(flowchart)],
		environment(seedHome),
	);
	if (seeded.code !== 0) throw new Error(`Seeding the generate response failed: ${seeded.stderr}`);
	const record = join(seedHome, ".sketchi/diagrams/checkout-flow");
	const scene = JSON.parse(await readFile(join(record, "scene.json"), "utf8"));
	const excalidraw = JSON.parse(await readFile(join(record, "diagram.excalidraw"), "utf8"));
	server = createServer((request, response) => {
		request.resume();
		request.on("end", () => {
			response.writeHead(200, { "content-type": "application/json" });
			response.end(
				JSON.stringify({
					ok: true,
					status: "generated",
					diagram: { document: flowchart, scene, excalidraw },
					generation: { model: "test-model", provider: "test-loopback" },
				}),
			);
		});
	});
	await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
	const address = server.address();
	endpoint = `http://127.0.0.1:${String(typeof address === "object" && address ? address.port : 0)}/api/v1/generate`;
}, 60_000);

afterAll(async () => {
	await new Promise((closed) => server.close(closed));
	await rm(root, { recursive: true, force: true });
});

describe("generate copies its PNG", () => {
	it("prints only the essentials and puts the PNG on the clipboard", async () => {
		const home = await freshHome("text");
		await rm(copiedFile, { force: true });
		const result = await generate(home);
		expect(result.code).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toBe(
			[
				"Checkout flow (flowchart)",
				`Saved     ${join(home, "checkout-flow.png")}`,
				"Copied    to clipboard, paste anywhere",
				"Id        checkout-flow",
				"",
			].join("\n"),
		);
		const copied = await readFile(copiedFile);
		expect(copied.equals(await readFile(join(home, "checkout-flow.png")))).toBe(true);
	});

	it("adds clipboard to JSON and writes nothing else to stdout", async () => {
		const home = await freshHome("json");
		const result = await generate(home, ["--output", "json"]);
		expect(result.code).toBe(0);
		const reply = JSON.parse(result.stdout);
		expect(reply).toMatchObject({
			ok: true,
			command: "generate",
			data: {
				id: "checkout-flow",
				type: "flowchart",
				title: "Checkout flow",
				prompt: "Map how a shopper pays at checkout",
				document: flowchart,
				generation: { model: "test-model", provider: "test-loopback" },
				export: { format: "png" },
				clipboard: { copied: true },
			},
		});
		expect(Date.parse(reply.data.createdAt)).toBeGreaterThan(0);
	});

	it("skips the copy with --no-copy, in CI, and for other formats", async () => {
		const noCopy = await generate(await freshHome("no-copy"), ["--no-copy", "--output", "json"]);
		expect(JSON.parse(noCopy.stdout).data.clipboard).toEqual({
			copied: false,
			reason: "disabled with --no-copy",
		});
		const ciHome = await freshHome("ci");
		const ci = await generate(ciHome, [], environment(ciHome, { CI: "1" }));
		expect(ci.code).toBe(0);
		expect(ci.stdout).not.toContain("Copied");
		expect(ci.stdout).not.toContain("Clipboard");
		const sceneHome = await freshHome("scene");
		const scene = await runCli(
			[
				"generate",
				"--prompt",
				"x",
				"--endpoint",
				endpoint,
				"--format",
				"excalidraw",
				"--dest",
				join(sceneHome, "a.excalidraw"),
				"--output",
				"json",
			],
			environment(sceneHome),
		);
		expect(JSON.parse(scene.stdout).data.clipboard).toEqual({
			copied: false,
			reason: "excalidraw is not an image",
		});
	});

	it("stays quiet without a desktop clipboard, like Frontierclimb's PATH and HOME only run", async () => {
		const home = await freshHome("headless");
		const env = { PATH: `${shims}:/usr/bin:/bin`, HOME: home };
		const text = await generate(home, [], env);
		expect(text.code).toBe(0);
		expect(text.stdout.split("\n")[2]).toBe("Id        checkout-flow");
		const json = await runCli(
			[
				"generate",
				"--prompt",
				"x",
				"--endpoint",
				endpoint,
				"--dest",
				join(home, "b.png"),
				"--output",
				"json",
			],
			{ ...env, HOME: await freshHome("headless-json") },
		);
		expect(JSON.parse(json.stdout).data.clipboard).toEqual({
			copied: false,
			reason: "no desktop clipboard in this session",
		});
	});

	it("keeps exit 0 and says why when the clipboard tool is missing", async () => {
		const home = await freshHome("missing");
		const emptyPath = join(root, "empty-bin");
		await mkdir(emptyPath, { recursive: true });
		const result = await generate(home, [], environment(home, { PATH: emptyPath }));
		expect(result.code).toBe(0);
		expect(result.stdout).toContain(
			"Clipboard not copied: wl-copy not found; install wl-clipboard\n",
		);
		expect((await readFile(join(home, "checkout-flow.png"))).byteLength).toBeGreaterThan(0);
	});
});

describe("finding past diagrams", () => {
	it("lists newest first, searches prompts, and resolves latest and prefixes", async () => {
		const home = await freshHome("history");
		const env = environment(home);
		const seeded = await runCli(
			[
				"create",
				"--json",
				JSON.stringify({
					type: "mindmap",
					spec: {
						id: "launch-map",
						title: "Launch plan",
						root: { label: "Launch", children: [{ label: "Product" }] },
					},
				}),
			],
			env,
		);
		expect(seeded.code).toBe(0);
		await new Promise((done) => setTimeout(done, 20));
		expect((await generate(home)).code).toBe(0);

		const listed = await runCli(["list"], env);
		expect(listed.stdout).toBe(
			[
				"checkout-flow  Checkout flow  flowchart  just now",
				"launch-map     Launch plan    mindmap    just now",
				"",
			].join("\n"),
		);
		const searched = await runCli(["list", "shopper", "pays"], env);
		expect(searched.stdout).toBe("checkout-flow  Checkout flow  flowchart  just now\n");
		const limited = await runCli(["list", "--limit", "1"], env);
		expect(limited.stdout).toContain("1 older not shown; --limit 2 shows all");
		const typed = await runCli(["list", "--type", "mindmap", "--output", "json"], env);
		expect(JSON.parse(typed.stdout).data.map((entry: { id: string }) => entry.id)).toEqual([
			"launch-map",
		]);
		expect((await runCli(["list", "nothing-matches"], env)).stdout).toBe("No matching diagrams.\n");

		const shown = await runCli(["show", "latest"], env);
		expect(shown.stdout).toMatch(
			/^Checkout flow \(flowchart\)\nId {8}checkout-flow\nCreated {3}just now\nPrompt {4}Map how a shopper pays at checkout\nRevision {2}1\nStored {4}~\/\.sketchi\/diagrams\/checkout-flow\n$/u,
		);
		const withDocument = await runCli(["show", "launch", "--document"], env);
		expect(withDocument.stdout).toContain('"type": "mindmap"');
		const shownJson = JSON.parse(
			(await runCli(["show", "latest", "--output", "json"], env)).stdout,
		);
		expect(shownJson.data.document).toMatchObject(flowchart);

		const unknown = await runCli(["show", "chekout-flow"], env);
		expect(unknown.code).toBe(5);
		expect(unknown.stderr).toContain(
			"next: Did you mean checkout-flow? Run sketchi list to search.",
		);

		await rm(copiedFile, { force: true });
		const copied = await runCli(["copy", "launch"], env);
		expect(copied.code).toBe(0);
		expect(copied.stdout).toBe(
			"Launch plan (mindmap)\nCopied    to clipboard, paste anywhere\nId        launch-map\n",
		);
		expect((await readFile(copiedFile)).subarray(1, 4).toString("latin1")).toBe("PNG");

		const headless = await runCli(["copy"], { PATH: "/usr/bin:/bin", HOME: home });
		expect(headless.code).toBe(8);
		expect(headless.stderr).toContain("error: clipboard_unavailable");
	});
});
