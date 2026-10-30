// Decides which conditional gates `pnpm ci:local` runs. Nx affected already scopes
// typecheck/test/build; this covers the gates that are not per-project targets.

// Files that are outside every Nx project but feed the whole workspace graph.
const WORKSPACE_FILE =
	/^(?:tools\/|package\.json$|pnpm-lock\.yaml$|pnpm-workspace\.yaml$|nx\.json$|tsconfig(?:\.base)?\.json$|mise\.toml$|\.oxlintrc\.json$)/;

/**
 * @param {{ all: boolean, projects: string[], changedFiles: string[] }} input
 */
export function ciScope({ all, projects, changedFiles }) {
	const affected = new Set(projects);
	const code = all || affected.size > 0 || changedFiles.some((file) => WORKSPACE_FILE.test(file));
	return {
		// Root `tsc6 -b` and the project-graph structural tests read every project.
		code,
		storybook: all || affected.has("diagram-ui"),
	};
}
