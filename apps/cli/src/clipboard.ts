import { spawn } from "node:child_process";
import { join } from "node:path";

import { Context, type Duration, Effect, FileSystem, Layer } from "effect";

import type { DiagramFormat } from "./contracts.js";

/** What happened when Sketchi tried, or declined, to put a PNG on the clipboard. */
export type ClipboardOutcome =
	| { readonly _tag: "Copied" }
	/** Not attempted: policy said no, or the session has no desktop clipboard. */
	| { readonly _tag: "Skipped"; readonly reason: string }
	/** Attempted and failed; the reason says why and how to fix it. */
	| { readonly _tag: "Failed"; readonly reason: string };

/** The JSON shape: `{ copied: true }` or `{ copied: false, reason }`. */
export function clipboardData(outcome: ClipboardOutcome) {
	return outcome._tag === "Copied"
		? { copied: true as const }
		: { copied: false as const, reason: outcome.reason };
}

export class Clipboard extends Context.Service<
	Clipboard,
	{
		/** Never fails: a clipboard problem is an outcome, not an error. */
		readonly copyPng: (png: Uint8Array) => Effect.Effect<ClipboardOutcome>;
	}
>()("@sketchi/cli/Clipboard") {}

/**
 * How one platform clipboard tool receives a PNG. Stdin tools (wl-copy, xclip) fork a
 * daemon that keeps serving the selection after the CLI exits; file tools (osascript,
 * PowerShell) copy synchronously from a temporary file.
 */
export type ClipboardTool =
	| {
			readonly _tag: "Stdin";
			readonly name: string;
			readonly command: string;
			readonly args: ReadonlyArray<string>;
			readonly missing: string;
	  }
	| {
			readonly _tag: "File";
			readonly name: string;
			readonly command: string;
			readonly args: (path: string) => ReadonlyArray<string>;
			readonly env: (path: string) => Readonly<Record<string, string>>;
			readonly missing: string;
	  };

const APPLESCRIPT_COPY_PNG = [
	"on run argv",
	"set the clipboard to (read (POSIX file (item 1 of argv)) as «class PNGf»)",
	"end run",
];

/** Keeps both a PNG stream and a bitmap, so apps that read either can paste. */
const POWERSHELL_COPY_PNG = [
	"$ErrorActionPreference = 'Stop'",
	"Add-Type -AssemblyName System.Windows.Forms, System.Drawing",
	"$bytes = [IO.File]::ReadAllBytes($env:SKETCHI_CLIPBOARD_FILE)",
	"$data = New-Object Windows.Forms.DataObject",
	"$data.SetData('PNG', (New-Object IO.MemoryStream(,$bytes)))",
	"$data.SetImage([Drawing.Image]::FromStream((New-Object IO.MemoryStream(,$bytes))))",
	"[Windows.Forms.Clipboard]::SetDataObject($data, $true)",
].join("; ");

const present = (value: string | undefined) => value !== undefined && value.trim() !== "";

/** Pick the clipboard tool for this session, or undefined when it has no desktop clipboard. */
/**
 * Replaces platform detection: a command that reads the PNG on stdin, or "off". It serves
 * clipboards Sketchi does not detect (WSL's clip.exe wrappers, remote sessions) and keeps
 * every test that spawns the CLI away from the real clipboard on any OS.
 */
export const SKETCHI_CLIPBOARD_COMMAND_ENV = "SKETCHI_CLIPBOARD_COMMAND";
export const CLIPBOARD_OFF = "off";

export function clipboardTool(
	platform: NodeJS.Platform,
	env: NodeJS.ProcessEnv,
): ClipboardTool | undefined {
	const override = env[SKETCHI_CLIPBOARD_COMMAND_ENV]?.trim();
	if (override) {
		return {
			_tag: "Stdin",
			name: override,
			command: override,
			args: [],
			missing: `${override} not found; check ${SKETCHI_CLIPBOARD_COMMAND_ENV}`,
		};
	}
	switch (platform) {
		case "darwin":
			return {
				_tag: "File",
				name: "osascript",
				command: "osascript",
				args: (path) => [...APPLESCRIPT_COPY_PNG.flatMap((line) => ["-e", line]), path],
				env: () => ({}),
				missing: "osascript not found",
			};
		case "win32":
			return {
				_tag: "File",
				name: "PowerShell",
				command: "powershell.exe",
				args: () => ["-NoProfile", "-NonInteractive", "-STA", "-Command", POWERSHELL_COPY_PNG],
				env: (path) => ({ SKETCHI_CLIPBOARD_FILE: path }),
				missing: "powershell.exe not found",
			};
		default:
			if (present(env["WAYLAND_DISPLAY"])) {
				return {
					_tag: "Stdin",
					name: "wl-copy",
					command: "wl-copy",
					args: ["--type", "image/png"],
					missing: "wl-copy not found; install wl-clipboard",
				};
			}
			if (present(env["DISPLAY"])) {
				return {
					_tag: "Stdin",
					name: "xclip",
					command: "xclip",
					args: ["-selection", "clipboard", "-t", "image/png", "-i"],
					missing: "xclip not found; install xclip",
				};
			}
			return undefined;
	}
}

/** Why generate should not copy automatically, or undefined when it should. */
export function automaticCopySkipReason(input: {
	readonly copy: boolean;
	readonly continuousIntegration: boolean;
	readonly format: DiagramFormat;
	readonly destination: string;
}): string | undefined {
	if (!input.copy) return "disabled with --no-copy";
	if (input.format !== "png") return `${input.format} is not an image`;
	if (input.destination === "-") return "written to stdout";
	if (input.continuousIntegration) return "running in CI";
	return undefined;
}

const NO_DESKTOP_CLIPBOARD = "no desktop clipboard in this session";
const MAX_STDERR_BYTES = 4096;

function hasCode(cause: unknown, code: string): boolean {
	return typeof cause === "object" && cause !== null && "code" in cause && cause.code === code;
}

function failureReason(name: string, stderr: string, code: number | null, signal: string | null) {
	const line = stderr
		.split(/\r?\n/u)
		.map((entry) => entry.trim())
		.find((entry) => entry.length > 0);
	if (line) return `${name} failed: ${line.slice(0, 200)}`;
	return signal ? `${name} stopped by ${signal}` : `${name} exited with code ${String(code)}`;
}

interface RunInput {
	readonly tool: ClipboardTool;
	readonly args: ReadonlyArray<string>;
	readonly env: NodeJS.ProcessEnv;
	readonly stdin?: Uint8Array;
}

/**
 * Run one clipboard tool and settle when its first process exits. The tool's stdout is
 * discarded and its stderr is our own pipe, so a forked daemon never holds the CLI's
 * streams; the stderr read end is closed on exit so the CLI can exit while the daemon
 * keeps serving the paste. Stdin tools run detached so the daemon outlives the shell.
 */
const runTool = ({ tool, args, env, stdin }: RunInput) =>
	Effect.callback<ClipboardOutcome>((resume) => {
		let settled = false;
		const settle = (outcome: ClipboardOutcome) => {
			if (settled) return;
			settled = true;
			resume(Effect.succeed(outcome));
		};
		const child = spawn(tool.command, [...args], {
			env,
			shell: false,
			stdio: [stdin ? "pipe" : "ignore", "ignore", "pipe"],
			detached: tool._tag === "Stdin",
			windowsHide: true,
		});
		const stderr: Buffer[] = [];
		let stderrBytes = 0;
		let stderrEnded = false;
		child.stderr?.on("data", (chunk: Buffer) => {
			if (stderrBytes >= MAX_STDERR_BYTES) return;
			stderr.push(chunk);
			stderrBytes += chunk.byteLength;
		});
		child.stderr?.once("end", () => {
			stderrEnded = true;
		});
		const release = () => {
			child.stderr?.destroy();
			child.unref();
		};
		child.once("error", (error) => {
			release();
			settle({
				_tag: "Failed",
				reason: hasCode(error, "ENOENT") ? tool.missing : `${tool.name} failed: ${error.message}`,
			});
		});
		child.once("exit", (code, signal) => {
			if (code === 0) {
				release();
				settle({ _tag: "Copied" });
				return;
			}
			// A failed tool forked nothing, so its stderr closes promptly; read it for the reason.
			const finish = () => {
				release();
				settle({
					_tag: "Failed",
					reason: failureReason(tool.name, Buffer.concat(stderr).toString("utf8"), code, signal),
				});
			};
			if (stderrEnded || !child.stderr) finish();
			else {
				child.stderr.once("end", finish);
				setTimeout(finish, 250).unref();
			}
		});
		if (stdin && child.stdin) {
			// A tool that exits before reading everything closes the pipe; its exit reports why.
			child.stdin.on("error", () => undefined);
			child.stdin.end(stdin);
		}
		return Effect.sync(() => {
			if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
			release();
		});
	});

export interface ClipboardLayerOptions {
	readonly platform?: NodeJS.Platform;
	readonly env?: NodeJS.ProcessEnv;
	readonly timeout?: Duration.Input;
}

/** The live clipboard; its file tools stage the PNG through the platform FileSystem. */
export function makeClipboardLayer(options: ClipboardLayerOptions = {}) {
	const platform = options.platform ?? process.platform;
	const env = options.env ?? process.env;
	const timeout = options.timeout ?? "10 seconds";
	return Layer.effect(
		Clipboard,
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const copyFromFile = (
				tool: Extract<ClipboardTool, { readonly _tag: "File" }>,
				png: Uint8Array,
			) =>
				Effect.scoped(
					Effect.gen(function* () {
						const directory = yield* fs.makeTempDirectoryScoped({ prefix: "sketchi-clipboard-" });
						const path = join(directory, "diagram.png");
						yield* fs.writeFile(path, png, { mode: 0o600 });
						return yield* runTool({
							tool,
							args: tool.args(path),
							env: { ...env, ...tool.env(path) },
						});
					}),
				).pipe(
					Effect.catch(() =>
						Effect.succeed<ClipboardOutcome>({
							_tag: "Failed",
							reason: "could not stage the PNG for the clipboard",
						}),
					),
				);
			return Clipboard.of({
				copyPng: Effect.fn("sketchi.cli.clipboard.copyPng")(function* (png: Uint8Array) {
					if (env[SKETCHI_CLIPBOARD_COMMAND_ENV]?.trim() === CLIPBOARD_OFF) {
						return {
							_tag: "Skipped",
							reason: `turned off by ${SKETCHI_CLIPBOARD_COMMAND_ENV}`,
						} as const;
					}
					const tool = clipboardTool(platform, env);
					if (!tool) return { _tag: "Skipped", reason: NO_DESKTOP_CLIPBOARD } as const;
					const run =
						tool._tag === "Stdin"
							? runTool({ tool, args: tool.args, env, stdin: png })
							: copyFromFile(tool, png);
					return yield* run.pipe(
						Effect.timeoutOrElse({
							duration: timeout,
							orElse: () =>
								Effect.succeed<ClipboardOutcome>({
									_tag: "Failed",
									reason: `${tool.name} timed out`,
								}),
						}),
					);
				}),
			});
		}),
	);
}

export const ClipboardLive = makeClipboardLayer();
