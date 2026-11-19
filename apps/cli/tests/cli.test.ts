import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { afterEach, assert, describe, it } from "@effect/vitest";
import { ExcalidrawFile } from "@sketchi/drawing/excalidraw";
import { Schema } from "effect";

import { clipboardTool } from "../src/terminal/clipboard";

const binary = resolve(process.cwd(), "apps/cli/dist/sketchi.js");
const testParent = resolve(process.cwd(), ".memory/cli-tests");
const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

/** Every network entry point throws, so an offline command that reaches the network fails. */
const NETWORK_DISABLED = `'use strict';
const blocked = () => { throw new Error('NETWORK_DISABLED_BY_SKETCHI_TEST'); };
for (const name of ['node:net','node:tls','node:http','node:https','node:http2','node:dgram']) {
	const value = require(name);
	for (const key of ['connect','createConnection','request','get','createClient','createSocket']) {
		if (typeof value[key] === 'function') value[key] = blocked;
	}
}
const dns = require('node:dns');
for (const key of Object.keys(dns)) {
	if (/^(lookup|resolve)/.test(key) && typeof dns[key] === 'function') dns[key] = blocked;
}
globalThis.fetch = blocked;
`;

function offlineCli() {
	mkdirSync(testParent, { recursive: true });
	const home = mkdtempSync(join(testParent, "cli-"));
	roots.push(home);
	const preload = join(home, "network-disabled.cjs");
	writeFileSync(preload, NETWORK_DISABLED, "utf8");
	const env: NodeJS.ProcessEnv = {
		...process.env,
		HOME: home,
		NODE_OPTIONS: `--require=${preload}`,
	};
	delete env["FORCE_COLOR"];
	delete env["NO_COLOR"];
	const run = (args: ReadonlyArray<string>, input?: string) => {
		const result = spawnSync(process.execPath, [binary, ...args], {
			cwd: home,
			encoding: "utf8",
			env,
			input,
			timeout: 60_000,
		});
		assert.notInclude(result.stderr, "NETWORK_DISABLED_BY_SKETCHI_TEST");
		return result;
	};
	/** Runs a JSON-output command, checks its exit code and returns its parsed envelope. */
	const json = (exit: number, args: ReadonlyArray<string>, input?: string) => {
		const result = run([...args, "--output", "json"], input);
		assert.strictEqual(result.status, exit, `${args.join(" ")}: ${result.stderr}`);
		return JSON.parse(exit === 0 ? result.stdout : result.stderr);
	};
	return { home, run, json };
}

const flowchart = {
	type: "flowchart",
	spec: {
		id: "release-flow",
		title: "Release approval",
		nodes: {
			start: "Change proposed",
			review: "Review evidence",
			decision: "Evidence complete?",
			approve: "Approve release",
			revise: "Request revision",
			end: "Release decision recorded",
		},
		edges: [
			["start", "review"],
			["review", "decision"],
			["decision", "approve", "Complete"],
			["decision", "revise", "Incomplete"],
			["approve", "end"],
			["revise", "end"],
		],
	},
};
const mindmap = {
	type: "mindmap",
	spec: {
		id: "launch-map",
		title: "Launch plan",
		root: {
			label: "Launch",
			children: [
				{ label: "Product", children: [{ label: "Readiness review" }] },
				{ label: "Operations", children: [{ label: "Runbook" }] },
			],
		},
	},
};
const mindmapPatch = {
	intent: "Color the product branch.",
	operations: [
		{
			op: "setStyle",
			selector: { labels: ["Product"] },
			style: { fillColor: "#dbeafe", strokeColor: "#2563eb" },
		},
	],
};
const retitled = <T extends { spec: object }>(document: T, title: string): T => ({
	...document,
	spec: { ...document.spec, title },
});

describe("sketchi offline command flow", () => {
	it("creates, edits, restores, patches, lists and exports without touching the network", () => {
		const { home, json, run } = offlineCli();

		assert.strictEqual(
			json(0, ["create", "--json", JSON.stringify(flowchart)]).data.id,
			"release-flow",
		);
		const edited = json(0, [
			"edit",
			"release-flow",
			"--json",
			JSON.stringify(retitled(flowchart, "Release approval revised")),
		]);
		assert.strictEqual(edited.data.revision, 2);
		const restored = json(0, ["restore", "release-flow", "--revision", "1"]);
		assert.include(restored.data, { restoredFromRevision: 1, revision: 3, authority: "canonical" });
		assert.strictEqual(
			json(0, ["show", "release-flow"]).data.document.spec.title,
			"Release approval",
		);
		assert.strictEqual(
			json(3, ["patch", "release-flow", "--json", JSON.stringify(mindmapPatch)]).error.code,
			"invalid_document",
		);

		json(0, ["create", "--file", "-"], `${JSON.stringify(mindmap)}\n`);
		json(0, [
			"edit",
			"launch-map",
			"--json",
			JSON.stringify(retitled(mindmap, "Launch plan revised")),
		]);
		const patched = json(0, ["patch", "launch-map", "--file", "-"], JSON.stringify(mindmapPatch));
		assert.include(patched.data, { revision: 3, authority: "patched" });
		assert.strictEqual(
			json(6, ["edit", "launch-map", "--json", JSON.stringify(mindmap)]).error.code,
			"detached_edit",
		);
		assert.strictEqual(
			json(0, ["restore", "launch-map", "--revision", "2"]).data.authority,
			"canonical",
		);

		assert.sameMembers(
			json(0, ["list"]).data.map(({ id }: { id: string }) => id),
			["release-flow", "launch-map"],
		);
		const destination = join(home, "release-flow.png");
		const png = run(["export", "release-flow", "--format", "png", "--dest", destination]);
		assert.strictEqual(png.status, 0, png.stderr);
		assert.deepStrictEqual(
			[...readFileSync(destination).subarray(0, 8)],
			[137, 80, 78, 71, 13, 10, 26, 10],
		);
		const excalidraw = run(["export", "launch-map", "--format", "excalidraw", "--dest", "-"]);
		assert.strictEqual(excalidraw.status, 0, excalidraw.stderr);
		const file = Schema.decodeUnknownSync(ExcalidrawFile)(JSON.parse(excalidraw.stdout));
		assert.isAbove(file.elements.length, 0);

		assert.strictEqual(json(3, ["create", "--json", "{}"]).error.code, "invalid_document");
		assert.strictEqual(json(5, ["show", "missing-diagram"]).error.code, "diagram_not_found");
		assert.strictEqual(
			json(6, ["create", "--json", JSON.stringify(flowchart)]).error.code,
			"diagram_already_exists",
		);
	});

	it("keeps share-link keys out of parser and typed error output", () => {
		const { run } = offlineCli();
		const bearer = "https://excalidraw.com/#json=AAAAAAAAAAAAAAAAAAAAAA,BBBBBBBBBBBBBBBBBBBBBB";
		for (const args of [
			["pull", "missing", "--link", bearer, "--output", bearer],
			["pull", bearer, "--link", bearer, "--output", "json"],
		]) {
			const result = run(args);
			assert.include([2, 3], result.status);
			assert.notInclude(result.stdout, bearer);
			assert.notInclude(result.stderr, bearer);
			assert.include(result.stderr, "[redacted-share-link]");
		}
	});
});

describe("clipboard tools", () => {
	it("pass the PNG path as data, never inside a script", () => {
		const path = '/tmp/a "b"; rm -rf x.png';
		const mac = clipboardTool("darwin", {});
		assert.strictEqual(mac?._tag, "File");
		if (mac?._tag === "File") {
			const args = mac.args(path);
			assert.strictEqual(args.at(-1), path);
			assert.isFalse(args.slice(0, -1).some((arg) => arg.includes("/tmp/a")));
		}
		const windows = clipboardTool("win32", {});
		assert.strictEqual(windows?._tag, "File");
		if (windows?._tag === "File") {
			assert.isFalse(windows.args(path).some((arg) => arg.includes("/tmp/a")));
			assert.deepStrictEqual(windows.env(path), { SKETCHI_CLIPBOARD_FILE: path });
		}
	});
});
