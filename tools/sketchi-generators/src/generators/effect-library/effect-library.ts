import {
	formatFiles,
	joinPathFragments,
	normalizePath,
	readJson,
	readProjectConfiguration,
	type Tree,
	updateJson,
	updateProjectConfiguration,
	visitNotIgnoredFiles,
} from "@nx/devkit";
import { libraryGenerator } from "@nx/js";

import type { EffectLibraryGeneratorSchema } from "./schema";

export async function effectLibraryGenerator(tree: Tree, options: EffectLibraryGeneratorSchema) {
	const directory = normalizePath(options.directory);
	if (!directory || directory.startsWith("/") || directory.split("/").includes("..")) {
		throw new Error("Use a workspace-relative library directory.");
	}
	if (tree.children(directory).length > 0) {
		throw new Error(`Refusing to overwrite existing library directory: ${directory}`);
	}
	const workspace = readJson(tree, "package.json");
	const nativeVersion = workspace.devDependencies?.["@typescript/native"]?.replace(
		/^npm:typescript@/,
		"",
	);
	if (typeof nativeVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(nativeVersion)) {
		throw new Error("The workspace must pin its supported native TypeScript version.");
	}
	const finish = await libraryGenerator(tree, {
		...options,
		bundler: "tsc",
		unitTestRunner: "none",
		// Lint and formatting already run through the root coupled toolchain.
		linter: "none",
		formatter: "none",
		useProjectJson: true,
		minimal: true,
		skipPackageJson: true,
		skipFormat: true,
	});
	const project = readProjectConfiguration(tree, options.name);
	const sourceRoot = project.sourceRoot ?? joinPathFragments(directory, "src");
	// The directory was empty: remove only upstream's generated sample implementation.
	visitNotIgnoredFiles(tree, sourceRoot, (file) => tree.delete(file));
	tree.write(joinPathFragments(sourceRoot, "index.ts"), "export {};\n");
	updateJson(tree, joinPathFragments(directory, "package.json"), (manifest) => ({
		...manifest,
		dependencies: { effect: "catalog:" },
	}));
	updateJson(tree, joinPathFragments(directory, "tsconfig.json"), (config) => ({
		...config,
		compilerOptions: { ...config.compilerOptions, noEmit: false },
	}));
	updateJson(tree, joinPathFragments(directory, "tsconfig.lib.json"), (config) => ({
		...config,
		compilerOptions: { ...config.compilerOptions, noEmit: false, importHelpers: false },
	}));
	const compiler = `effect-tsgo tsc@${nativeVersion}`;
	project.targets = {
		...project.targets,
		build: {
			executor: "nx:run-commands",
			outputs: ["{projectRoot}/dist"],
			options: { command: `${compiler} -p tsconfig.lib.json`, cwd: directory },
		},
		typecheck: {
			executor: "nx:run-commands",
			options: { command: `${compiler} -p tsconfig.lib.json --noEmit`, cwd: directory },
		},
	};
	updateProjectConfiguration(tree, options.name, project);
	if (!options.skipFormat) await formatFiles(tree);
	return finish;
}

export default effectLibraryGenerator;
