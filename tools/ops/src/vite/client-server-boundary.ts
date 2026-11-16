import type { Plugin } from "vite";

import { workerProjectConfig } from "../workers";

/**
 * Bundled module ids that are server-only source of the project: anything under `src/server/`,
 * and any `*.server.*` file under `src/features/`. The source root comes from the Worker
 * project's own root, so it follows the app directory.
 */
export function serverModuleIds(moduleIds: readonly string[], projectId: string) {
	const sourceRoot = `/${workerProjectConfig(projectId).projectRoot}/src/`;
	return moduleIds
		.map((moduleId) => moduleId.replaceAll("\\", "/"))
		.filter((moduleId) => {
			const sourceStart = moduleId.indexOf(sourceRoot);
			if (sourceStart === -1) return false;
			const sourcePath = moduleId.slice(sourceStart + sourceRoot.length);
			return sourcePath.startsWith("server/") || /^features\/.*\.server\./.test(sourcePath);
		});
}

/** Fails a client build that bundles any of the project's server-only modules. */
export function clientServerBoundary(projectId: string): Plugin {
	return {
		name: "playground-client-server-boundary",
		apply: "build",
		applyToEnvironment: (environment) => environment.name === "client",
		generateBundle(_options, bundle) {
			const leaked = serverModuleIds(
				Object.values(bundle).flatMap((output) =>
					output.type === "chunk" ? Object.keys(output.modules) : [],
				),
				projectId,
			);
			if (leaked.length > 0) {
				this.error(`Playground server modules entered the client bundle:\n${leaked.join("\n")}`);
			}
		},
	};
}
