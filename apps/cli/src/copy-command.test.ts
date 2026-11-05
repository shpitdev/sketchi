import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { cliProgram, makeCliApplicationLayer } from "./cli.js";
import { OutputWriter } from "./output.js";
import { makeStorageRootLayer } from "./storage.js";
import { makeFakeClipboard } from "./__tests__/clipboard-fake.js";
import type { ClipboardOutcome } from "./clipboard.js";

const testParent = resolve(process.cwd(), ".memory/cli-copy-tests");

const launchMap = JSON.stringify({
	type: "mindmap",
	spec: {
		id: "launch-map",
		title: "Launch plan",
		root: { label: "Launch", children: [{ label: "Product" }] },
	},
});

/** Run CLI arguments in-process against a temporary store and a fake clipboard. */
function harness(outcome?: ClipboardOutcome) {
	const stdout: string[] = [];
	const stderr: string[] = [];
	const clipboard = makeFakeClipboard(outcome);
	const run = (root: string, args: ReadonlyArray<string>) => {
		stdout.length = 0;
		stderr.length = 0;
		return cliProgram(args).pipe(
			Effect.provide(
				Layer.provideMerge(
					makeCliApplicationLayer({
						storageRoot: makeStorageRootLayer(root),
						clipboard: clipboard.layer,
						output: Layer.succeed(OutputWriter, {
							stdout: (value) => Effect.sync(() => stdout.push(String(value))),
							stderr: (value) => Effect.sync(() => stderr.push(String(value))),
						}),
					}),
					NodeServices.layer,
				),
			),
		);
	};
	return { stdout, stderr, copies: clipboard.copies, run };
}

const withRoot = <A, E, R>(use: (root: string) => Effect.Effect<A, E, R>) =>
	Effect.acquireUseRelease(
		Effect.promise(async () => {
			await mkdir(testParent, { recursive: true });
			return mkdtemp(join(testParent, "store-"));
		}),
		use,
		(root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
	);

describe("sketchi copy", () => {
	it.live("renders the newest diagram's PNG and hands it to the clipboard", () =>
		withRoot((root) =>
			Effect.gen(function* () {
				const cli = harness();
				assert.strictEqual(yield* cli.run(root, ["create", "--json", launchMap]), 0);
				assert.strictEqual(yield* cli.run(root, ["copy"]), 0);
				assert.strictEqual(
					cli.stdout.join(""),
					"Launch plan (mindmap)\nCopied    to clipboard, paste anywhere\nId        launch-map\n",
				);
				assert.strictEqual(cli.copies.length, 1);
				assert.strictEqual(
					Buffer.from(cli.copies[0] ?? [])
						.subarray(1, 4)
						.toString("latin1"),
					"PNG",
				);

				assert.strictEqual(yield* cli.run(root, ["copy", "launch", "--output", "json"]), 0);
				assert.deepStrictEqual(JSON.parse(cli.stdout.join("")), {
					ok: true,
					command: "copy",
					data: {
						id: "launch-map",
						type: "mindmap",
						title: "Launch plan",
						clipboard: { copied: true },
					},
				});
			}),
		),
	);

	it.live("fails with exit 8 and the reason when nothing can be copied", () =>
		withRoot((root) =>
			Effect.gen(function* () {
				const cli = harness({ _tag: "Skipped", reason: "no desktop clipboard in this session" });
				assert.strictEqual(yield* cli.run(root, ["create", "--json", launchMap]), 0);
				assert.strictEqual(yield* cli.run(root, ["copy", "launch-map"]), 8);
				assert.strictEqual(cli.stdout.join(""), "");
				assert.include(cli.stderr.join(""), "error: clipboard_unavailable\n");
				assert.include(cli.stderr.join(""), "no desktop clipboard in this session");
			}),
		),
	);

	it.live("suggests a close id instead of copying an unknown one", () =>
		withRoot((root) =>
			Effect.gen(function* () {
				const cli = harness();
				assert.strictEqual(yield* cli.run(root, ["create", "--json", launchMap]), 0);
				assert.strictEqual(yield* cli.run(root, ["copy", "lanch-map"]), 5);
				assert.include(cli.stderr.join(""), "Did you mean launch-map?");
				assert.strictEqual(cli.copies.length, 0);
			}),
		),
	);
});
