// Decides which conditional gates `pnpm ci:local` runs. Nx affected already scopes
// typecheck/test/build; this covers the gates that are not per-project targets.

// Files that are outside every Nx project but feed the whole workspace graph.
const WORKSPACE_FILE =
	/^(?:tools\/|package\.json$|pnpm-lock\.yaml$|pnpm-workspace\.yaml$|nx\.json$|tsconfig(?:\.base)?\.json$|mise\.toml$|\.oxlintrc\.json$)/;

// Routing imports graph + flowchart fixtures and drawing's Canvas/text/native adapters.
// Other families keep their cross-family text-fit assertions in drawing:test. Changes to
// shared diagrams contracts/registry and runtime configuration conservatively select routing.
function routingInput(file) {
	if (file.startsWith("packages/diagrams/")) {
		return (
			!file.startsWith("packages/diagrams/src/families/") ||
			file.startsWith("packages/diagrams/src/families/flowchart/")
		);
	}
	return (
		file.startsWith("packages/drawing/") ||
		file.startsWith("packages/editor/public/fonts/") ||
		/^tools\/drawing-tests\/(?:routing[^/]*|text-fit-helpers)\.ts$/.test(file) ||
		/^scripts\/ci-(?:local|scope)\.mjs$/.test(file) ||
		/^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|nx\.json|vitest\.config\.ts|tsconfig(?:\.base)?\.json|mise\.toml|\.npmrc)$/.test(
			file,
		)
	);
}

/**
 * @param {{ all: boolean, full: boolean, projects: string[], changedFiles: string[] }} input
 */
export function ciScope({ all, full, projects, changedFiles }) {
	const affected = new Set(projects);
	const code = all || affected.size > 0 || changedFiles.some((file) => WORKSPACE_FILE.test(file));
	return {
		// Root native `tsc -b` reads every project.
		code,
		storybook: all || affected.has("editor"),
		routing: all || full || changedFiles.some(routingInput),
	};
}
