import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { assert, describe, it } from "@effect/vitest";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Effect, Layer } from "effect";

import {
	automaticCopySkipReason,
	Clipboard,
	clipboardData,
	clipboardTool,
	makeClipboardLayer,
} from "./clipboard.js";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const testParent = resolve(process.cwd(), ".memory/cli-clipboard-tests");

describe("clipboard tool selection", () => {
	it("uses wl-copy on Wayland, before X11", () => {
		const tool = clipboardTool("linux", { WAYLAND_DISPLAY: "wayland-1", DISPLAY: ":0" });
		assert.strictEqual(tool?._tag, "Stdin");
		assert.strictEqual(tool?.command, "wl-copy");
		assert.deepStrictEqual(tool?._tag === "Stdin" ? tool.args : [], ["--type", "image/png"]);
	});

	it("uses xclip on X11, ignoring an empty Wayland variable", () => {
		const tool = clipboardTool("linux", { WAYLAND_DISPLAY: "", DISPLAY: ":0" });
		assert.strictEqual(tool?.command, "xclip");
		assert.deepStrictEqual(tool?._tag === "Stdin" ? tool.args : [], [
			"-selection",
			"clipboard",
			"-t",
			"image/png",
			"-i",
		]);
	});

	it("finds no clipboard without a desktop session", () => {
		assert.isUndefined(clipboardTool("linux", { PATH: "/usr/bin", HOME: "/home/a" }));
		assert.isUndefined(clipboardTool("freebsd", {}));
	});

	it("passes the PNG path to osascript as an argument, not inside the script", () => {
		const tool = clipboardTool("darwin", {});
		assert.strictEqual(tool?._tag, "File");
		if (tool?._tag !== "File") return;
		const args = tool.args('/tmp/a "b".png');
		assert.strictEqual(tool.command, "osascript");
		assert.strictEqual(args.at(-1), '/tmp/a "b".png');
		assert.isTrue(args.some((arg) => arg.includes("«class PNGf»")));
		assert.isFalse(args.slice(0, -1).some((arg) => arg.includes("/tmp/a")));
	});

	it("hands PowerShell the PNG path through the environment and keeps the data after exit", () => {
		const tool = clipboardTool("win32", {});
		assert.strictEqual(tool?._tag, "File");
		if (tool?._tag !== "File") return;
		const args = tool.args("C:\\Temp\\diagram.png");
		assert.strictEqual(tool.command, "powershell.exe");
		assert.deepStrictEqual(args.slice(0, 4), ["-NoProfile", "-NonInteractive", "-STA", "-Command"]);
		assert.include(args[4], "$env:SKETCHI_CLIPBOARD_FILE");
		assert.include(args[4], "SetDataObject($data, $true)");
		assert.deepStrictEqual(tool.env("C:\\Temp\\diagram.png"), {
			SKETCHI_CLIPBOARD_FILE: "C:\\Temp\\diagram.png",
		});
	});
});

describe("automatic copy policy", () => {
	const base = {
		copy: true,
		continuousIntegration: false,
		format: "png",
		destination: "a.png",
	} as const;

	it("copies a PNG file by default", () => {
		assert.isUndefined(automaticCopySkipReason(base));
	});

	it("skips --no-copy, other formats, stdout, and CI", () => {
		assert.strictEqual(
			automaticCopySkipReason({ ...base, copy: false }),
			"disabled with --no-copy",
		);
		assert.strictEqual(
			automaticCopySkipReason({ ...base, format: "excalidraw" }),
			"excalidraw is not an image",
		);
		assert.strictEqual(automaticCopySkipReason({ ...base, destination: "-" }), "written to stdout");
		assert.strictEqual(
			automaticCopySkipReason({ ...base, continuousIntegration: true }),
			"running in CI",
		);
	});

	it("reports JSON as copied or not with a reason", () => {
		assert.deepStrictEqual(clipboardData({ _tag: "Copied" }), { copied: true });
		assert.deepStrictEqual(clipboardData({ _tag: "Failed", reason: "x" }), {
			copied: false,
			reason: "x",
		});
	});
});

/** A directory of fake clipboard tools on PATH; the real clipboard is never reached. */
async function shimDirectory(scripts: Readonly<Record<string, string>>) {
	await mkdir(testParent, { recursive: true });
	const directory = await mkdtemp(join(testParent, "shim-"));
	for (const [name, body] of Object.entries(scripts)) {
		const path = join(directory, name);
		await writeFile(path, `#!/bin/sh\n${body}\n`);
		await chmod(path, 0o755);
	}
	return directory;
}

/** Shims first, then the system tools the shim scripts themselves use. */
const shimPath = (directory: string) => `${directory}:/usr/bin:/bin`;

const copyWith = (options: Parameters<typeof makeClipboardLayer>[0]) =>
	Effect.gen(function* () {
		const clipboard = yield* Clipboard;
		return yield* clipboard.copyPng(png);
	}).pipe(Effect.provide(makeClipboardLayer(options).pipe(Layer.provide(NodeFileSystem.layer))));

describe.runIf(process.platform !== "win32")("clipboard adapter", () => {
	it.live("settles when the tool exits while its forked daemon keeps running", () =>
		Effect.gen(function* () {
			const directory = yield* Effect.promise(() =>
				shimDirectory({
					// Like wl-copy: read the image, fork a daemon that inherits stderr, then exit.
					"wl-copy": `cat > "$SHIM_OUT"\n(sleep 30 & echo $! > "$SHIM_DAEMON") \nexit 0`,
				}),
			);
			const out = join(directory, "copied.png");
			const daemon = join(directory, "daemon.pid");
			const started = Date.now();
			const outcome = yield* copyWith({
				platform: "linux",
				env: {
					PATH: shimPath(directory),
					WAYLAND_DISPLAY: "fake",
					SHIM_OUT: out,
					SHIM_DAEMON: daemon,
				},
			});
			const elapsed = Date.now() - started;
			assert.deepStrictEqual(outcome, { _tag: "Copied" });
			assert.isBelow(elapsed, 3_000);
			assert.deepStrictEqual(new Uint8Array(yield* Effect.promise(() => readFile(out))), png);
			const pid = Number((yield* Effect.promise(() => readFile(daemon, "utf8"))).trim());
			// The daemon is still alive after the copy settled; stop it.
			process.kill(pid, 0);
			process.kill(pid, "SIGTERM");
			yield* Effect.promise(() => rm(directory, { recursive: true, force: true }));
		}),
	);

	it.live("reports the tool's own error line when it fails", () =>
		Effect.gen(function* () {
			const directory = yield* Effect.promise(() =>
				shimDirectory({
					"wl-copy": `cat > /dev/null\necho "Failed to connect to a Wayland server" >&2\nexit 1`,
				}),
			);
			const outcome = yield* copyWith({
				platform: "linux",
				env: { PATH: shimPath(directory), WAYLAND_DISPLAY: "fake" },
			});
			assert.deepStrictEqual(outcome, {
				_tag: "Failed",
				reason: "wl-copy failed: Failed to connect to a Wayland server",
			});
			yield* Effect.promise(() => rm(directory, { recursive: true, force: true }));
		}),
	);

	it.live("names the package to install when the tool is missing", () =>
		Effect.gen(function* () {
			const directory = yield* Effect.promise(() => shimDirectory({}));
			assert.deepStrictEqual(
				yield* copyWith({ platform: "linux", env: { PATH: directory, DISPLAY: ":0" } }),
				{ _tag: "Failed", reason: "xclip not found; install xclip" },
			);
			assert.deepStrictEqual(
				yield* copyWith({ platform: "linux", env: { PATH: directory, WAYLAND_DISPLAY: "w" } }),
				{ _tag: "Failed", reason: "wl-copy not found; install wl-clipboard" },
			);
			yield* Effect.promise(() => rm(directory, { recursive: true, force: true }));
		}),
	);

	it.live("gives up on a tool that hangs and stops it", () =>
		Effect.gen(function* () {
			const directory = yield* Effect.promise(() =>
				shimDirectory({ "wl-copy": `echo $$ > "$SHIM_PID"\nexec sleep 30` }),
			);
			const pidFile = join(directory, "tool.pid");
			const outcome = yield* copyWith({
				platform: "linux",
				env: { PATH: shimPath(directory), WAYLAND_DISPLAY: "fake", SHIM_PID: pidFile },
				timeout: "300 millis",
			});
			assert.deepStrictEqual(outcome, { _tag: "Failed", reason: "wl-copy timed out" });
			const pid = Number((yield* Effect.promise(() => readFile(pidFile, "utf8"))).trim());
			yield* Effect.promise(() => new Promise((done) => setTimeout(done, 100)));
			assert.throws(() => process.kill(pid, 0));
			yield* Effect.promise(() => rm(directory, { recursive: true, force: true }));
		}),
	);

	it.live("skips a session with no desktop clipboard without spawning anything", () =>
		copyWith({ platform: "linux", env: { PATH: "/nonexistent" } }).pipe(
			Effect.map((outcome) =>
				assert.deepStrictEqual(outcome, {
					_tag: "Skipped",
					reason: "no desktop clipboard in this session",
				}),
			),
		),
	);

	it.live("copies through a temporary file for macOS and Windows tools, then removes it", () =>
		Effect.gen(function* () {
			const directory = yield* Effect.promise(() =>
				shimDirectory({
					osascript: `for last; do :; done\ncp "$last" "$SHIM_OUT"\necho "$last" > "$SHIM_PATH"`,
					"powershell.exe": `cp "$SKETCHI_CLIPBOARD_FILE" "$SHIM_OUT"\necho "$SKETCHI_CLIPBOARD_FILE" > "$SHIM_PATH"`,
				}),
			);
			for (const platform of ["darwin", "win32"] as const) {
				const out = join(directory, `${platform}.png`);
				const pathFile = join(directory, `${platform}.path`);
				const outcome = yield* copyWith({
					platform,
					env: { PATH: shimPath(directory), SHIM_OUT: out, SHIM_PATH: pathFile },
				});
				assert.deepStrictEqual(outcome, { _tag: "Copied" });
				assert.deepStrictEqual(new Uint8Array(yield* Effect.promise(() => readFile(out))), png);
				const staged = (yield* Effect.promise(() => readFile(pathFile, "utf8"))).trim();
				assert.isTrue(staged.startsWith(join(tmpdir(), "sketchi-clipboard-")));
				const remaining = yield* Effect.promise(() => readdir(tmpdir()));
				assert.notInclude(remaining, staged.split("/").at(-2));
			}
			yield* Effect.promise(() => rm(directory, { recursive: true, force: true }));
		}),
	);
});
