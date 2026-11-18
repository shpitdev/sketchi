// @effect-diagnostics nodeBuiltinImport:off -- The installer harness runs the real shell installer against a temporary installation tree.

import { spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readlinkSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

import { afterEach, describe, expect, it } from "@effect/vitest";

const workspaceRoot = resolve(process.cwd());
const installScript = resolve(workspaceRoot, "install.sh");
const memoryRoot = resolve(workspaceRoot, ".memory");
const testRoots: string[] = [];

function makeTestRoot(): string {
	mkdirSync(memoryRoot, { recursive: true });
	const root = mkdtempSync(resolve(memoryRoot, "cli-installer-test-"));
	testRoots.push(root);
	return root;
}

function writeExecutable(path: string, lines: ReadonlyArray<string>): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `#!/bin/sh\nset -eu\n${lines.join("\n")}\n`, "utf8");
	chmodSync(path, 0o755);
}

function writeFakeNpm(binDirectory: string): void {
	writeExecutable(resolve(binDirectory, "npm"), [
		'printf \'%s\\n\' "$@" >"$SKETCHI_TEST_NPM_ARGS"',
	]);
}

function writeSuccessfulSketchi(binDirectory: string): void {
	writeExecutable(resolve(binDirectory, "sketchi"), [
		'if [ "$1" != "--completions" ]; then exit 9; fi',
		'case "$2" in',
		"  zsh)",
		"    printf '%s\\n' '#compdef sketchi' '_sketchi() { :; }' 'compdef _sketchi sketchi'",
		"    ;;",
		"  bash)",
		"    printf '%s\\n' '_sketchi() { :; }' 'complete -F _sketchi sketchi'",
		"    ;;",
		"  fish)",
		"    printf '%s\\n' 'complete -c sketchi'",
		"    ;;",
		"  *) exit 9 ;;",
		"esac",
	]);
}

function installerEnvironment(root: string, shell: string): NodeJS.ProcessEnv {
	const binDirectory = resolve(root, "bin");
	const home = resolve(root, "home");
	mkdirSync(home, { recursive: true });
	return {
		HOME: home,
		PATH: `${binDirectory}:/usr/bin:/bin`,
		SHELL: shell,
		SKETCHI_TEST_NPM_ARGS: resolve(root, "npm-args.txt"),
		XDG_CONFIG_HOME: resolve(home, ".config"),
		ZDOTDIR: home,
	};
}

function runInstaller(environment: NodeJS.ProcessEnv) {
	return spawnSync("/bin/sh", [installScript], {
		cwd: workspaceRoot,
		encoding: "utf8",
		env: environment,
	});
}

afterEach(() => {
	for (const root of testRoots.splice(0)) {
		rmSync(root, { force: true, recursive: true });
	}
});

describe("noninteractive installer", () => {
	it("does not execute when the download ends before the final main invocation", () => {
		const root = makeTestRoot();
		const environment = installerEnvironment(root, "/bin/bash");
		const source = readFileSync(installScript, "utf8");
		const invocation = 'main "$@"\n';

		expect(source.endsWith(invocation)).toBe(true);

		const result = spawnSync("/bin/sh", [], {
			cwd: workspaceRoot,
			encoding: "utf8",
			env: environment,
			input: source.slice(0, -invocation.length),
		});

		expect(result.status).toBe(0);
		expect(existsSync(resolve(root, "npm-args.txt"))).toBe(false);
		expect(existsSync(resolve(root, "home/.sketchi"))).toBe(false);
	});

	it("fails closed without replacing an rc symlink loop", () => {
		const root = makeTestRoot();
		const binDirectory = resolve(root, "bin");
		const home = resolve(root, "home");
		const rcFile = resolve(home, ".bashrc");
		const secondLink = resolve(home, ".bashrc-loop");
		mkdirSync(home, { recursive: true });
		symlinkSync(".bashrc-loop", rcFile);
		symlinkSync(".bashrc", secondLink);
		writeFakeNpm(binDirectory);
		writeSuccessfulSketchi(binDirectory);

		const result = runInstaller(installerEnvironment(root, "/bin/bash"));

		expect(result.status).toBe(1);
		expect(result.stderr).toContain("symlink chain exceeds 40 links");
		expect(lstatSync(rcFile).isSymbolicLink()).toBe(true);
		expect(readlinkSync(rcFile)).toBe(".bashrc-loop");
		expect(lstatSync(secondLink).isSymbolicLink()).toBe(true);
		expect(readlinkSync(secondLink)).toBe(".bashrc");
	});

	it("preserves the rc file and its mode when the rewrite fails", () => {
		const root = makeTestRoot();
		const binDirectory = resolve(root, "bin");
		const home = resolve(root, "home");
		const rcFile = resolve(home, ".bashrc");
		mkdirSync(home, { recursive: true });
		writeFileSync(rcFile, "preserve-this-rc\n", "utf8");
		chmodSync(rcFile, 0o640);
		writeFakeNpm(binDirectory);
		writeSuccessfulSketchi(binDirectory);
		writeExecutable(resolve(binDirectory, "awk"), ["printf 'partial-rc\\n'", "exit 2"]);

		const result = runInstaller(installerEnvironment(root, "/bin/bash"));

		expect(result.status).toBe(1);
		expect(readFileSync(rcFile, "utf8")).toBe("preserve-this-rc\n");
		expect(statSync(rcFile).mode & 0o777).toBe(0o640);
		expect(readdirSync(home).filter((name) => name.startsWith(".bashrc.sketchi."))).toEqual([]);
	});
});
