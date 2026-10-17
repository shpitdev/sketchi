#!/usr/bin/env node
// Decides which conditional CI gates a change needs. Nx affected already scopes
// typecheck/test/build; this covers the gates that are not per-project targets.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

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

function run(command, args) {
	return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

function main() {
	const all = process.env.CI_ALL_PROJECTS === "true";
	const { NX_BASE: base, NX_HEAD: head } = process.env;
	if (!all && (!base || !head)) {
		throw new Error("NX_BASE and NX_HEAD are required unless CI_ALL_PROJECTS=true.");
	}
	const projects = all
		? []
		: JSON.parse(run("pnpm", ["exec", "nx", "show", "projects", "--affected", "--json"]));
	const changedFiles = all
		? []
		: run("git", ["diff", "--name-only", base, head]).split("\n").filter(Boolean);
	const scope = ciScope({ all, projects, changedFiles });

	console.log(`Affected projects: ${all ? "all" : projects.join(", ") || "none"}`);
	const text = Object.entries(scope)
		.map(([key, value]) => `${key}=${value}`)
		.join("\n");
	console.log(text);
	if (process.env.GITHUB_OUTPUT) {
		appendFileSync(process.env.GITHUB_OUTPUT, `${text}\n`);
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	main();
}
