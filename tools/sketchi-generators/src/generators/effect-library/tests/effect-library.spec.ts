// @effect-diagnostics nodeBuiltinImport:off -- The Nx generator test inspects CLI and filesystem seams independently of the generated projects.

// @vitest-environment node
import { updateJson, type Tree, workspaceRoot } from "@nx/devkit";
import { FsTree } from "@nx/devkit/internal";
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { effectLibraryGenerator } from "../effect-library";

const workspaceRequire = createRequire(path.join(workspaceRoot, "package.json"));
const nxCli = workspaceRequire.resolve("nx/bin/nx.js");

function flush(tree: Tree) {
	for (const change of tree.listChanges()) {
		const destination = path.join(tree.root, change.path);
		if (change.type === "DELETE") rmSync(destination, { force: true });
		else {
			mkdirSync(path.dirname(destination), { recursive: true });
			writeFileSync(destination, change.content ?? "");
		}
	}
}

it("builds and runs a generated consumer, discovers affected imports, and protects user source", async () => {
	mkdirSync(path.join(workspaceRoot, ".memory"), { recursive: true });
	const directory = mkdtempSync(path.join(workspaceRoot, ".memory", "effect-library-"));
	try {
		const workspace = JSON.parse(readFileSync(path.join(workspaceRoot, "package.json"), "utf8"));
		writeFileSync(
			path.join(directory, "package.json"),
			JSON.stringify({
				name: "effect-library-proof",
				private: true,
				type: "module",
				packageManager: workspace.packageManager,
				devDependencies: workspace.devDependencies,
			}),
		);
		for (const file of ["pnpm-workspace.yaml", "pnpm-lock.yaml", "tsconfig.base.json"]) {
			writeFileSync(path.join(directory, file), readFileSync(path.join(workspaceRoot, file)));
		}
		writeFileSync(
			path.join(directory, "tsconfig.json"),
			JSON.stringify({ extends: "./tsconfig.base.json", files: [], references: [] }),
		);
		writeFileSync(
			path.join(directory, "nx.json"),
			JSON.stringify({
				sync: { globalGenerators: ["@nx/js:typescript-sync"] },
				targetDefaults: { build: { dependsOn: ["^build"] } },
			}),
		);
		writeFileSync(path.join(directory, ".gitignore"), "node_modules\ndist\n.nx\n");
		const modules = path.join(directory, "node_modules");
		mkdirSync(path.join(modules, "@sketchi"), { recursive: true });
		for (const entry of readdirSync(path.join(workspaceRoot, "node_modules"))) {
			if (entry !== "@sketchi") {
				symlinkSync(path.join(workspaceRoot, "node_modules", entry), path.join(modules, entry));
			}
		}
		const tree = new FsTree(directory, false);
		const producer = {
			directory: "packages/producer",
			name: "producer",
			importPath: "@sketchi/producer",
			tags: "scope:package,type:lib",
			skipFormat: true,
		};
		await effectLibraryGenerator(tree, producer);
		await effectLibraryGenerator(tree, {
			...producer,
			directory: "packages/consumer",
			name: "consumer",
			importPath: "@sketchi/consumer",
		});
		tree.write(
			"packages/producer/src/index.ts",
			'import { Effect } from "effect";\nexport const greeting = Effect.succeed("generated package");\n',
		);
		tree.write(
			"packages/consumer/src/index.ts",
			'import { Effect, String } from "effect";\nimport { greeting } from "@sketchi/producer";\nexport const message = Effect.map(greeting, String.toUpperCase);\n',
		);
		updateJson(tree, "packages/consumer/package.json", (manifest) => ({
			...manifest,
			dependencies: { ...manifest.dependencies, "@sketchi/producer": "workspace:*" },
		}));
		flush(tree);
		for (const project of ["producer", "consumer"]) {
			symlinkSync(
				path.join(directory, "packages", project),
				path.join(modules, "@sketchi", project),
			);
		}
		const run = (script: string, args: string[]) =>
			spawnSync(process.execPath, [script, ...args], {
				cwd: directory,
				env: { ...process.env, NX_DAEMON: "false", NX_INTERACTIVE: "false" },
				encoding: "utf8",
				maxBuffer: 4 * 1024 * 1024,
				timeout: 60_000,
			});
		for (const args of [
			["sync"],
			["sync:check"],
			["run", "consumer:build", "--skipNxCache", "--outputStyle=static"],
			["run", "consumer:typecheck", "--skipNxCache", "--outputStyle=static"],
		]) {
			const result = run(nxCli, args);
			expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
		}
		const affected = run(nxCli, [
			"show",
			"projects",
			"--affected",
			"--files=packages/producer/src/index.ts",
			"--json",
		]);
		expect(affected.status, affected.stderr).toBe(0);
		expect(JSON.parse(affected.stdout)).toEqual(expect.arrayContaining(["producer", "consumer"]));
		const consumer = path.join(directory, "consume.mjs");
		writeFileSync(
			consumer,
			'import { Effect } from "effect";\nimport { message } from "@sketchi/consumer";\nconsole.log(await Effect.runPromise(message));\n',
		);
		const runtime = run(consumer, []);
		expect(runtime.status, runtime.stderr).toBe(0);
		expect(runtime.stdout.trim()).toBe("GENERATED PACKAGE");
		const source = path.join(directory, "packages/producer/src/index.ts");
		const original = readFileSync(source, "utf8");
		await expect(effectLibraryGenerator(new FsTree(directory, false), producer)).rejects.toThrow(
			"Refusing to overwrite",
		);
		expect(readFileSync(source, "utf8")).toBe(original);
		writeFileSync(
			path.join(directory, "packages/consumer/src/index.ts"),
			'import { greeting } from "@sketchi/producer";\nexport const wrong: number = greeting;\n',
		);
		const invalid = run(nxCli, [
			"run",
			"consumer:typecheck",
			"--skipNxCache",
			"--outputStyle=static",
		]);
		expect(invalid.status).not.toBe(0);
		expect(invalid.stdout + invalid.stderr).toContain("TS2322");
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}, 120_000);
