#!/usr/bin/env node
// Writes `projects=<JSON array>`: the Worker apps this production run deploys. A push deploys the
// apps whose `build` its commits reach, measured from the previous main commit (BASE_SHA); when
// that commit is unknown, it deploys every app.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

import { selectProductionProjects } from "./lib/deploy/production.mjs";

const run = (command, args, env = process.env) =>
	execFileSync(command, args, { encoding: "utf8", env, stdio: ["ignore", "pipe", "inherit"] });

function knownCommit(sha) {
	if (!sha || /^0+$/.test(sha)) return false;
	try {
		execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

let selection = process.env.PRODUCTION_SELECTION?.trim() || "affected";
let affected = [];
if (selection === "affected") {
	const { BASE_SHA: base, HEAD_SHA: head } = process.env;
	if (!head) throw new Error("HEAD_SHA is required for affected production deploys.");
	if (knownCommit(base)) {
		// Task-input selection (not nx.json's whole-project default): a project counts only when the
		// change reaches its `build` inputs, including through a dependency's.
		affected = JSON.parse(
			run(
				"pnpm",
				[
					"--silent",
					"nx",
					"show",
					"projects",
					"--affected",
					"--withTarget=build",
					`--base=${base}`,
					`--head=${head}`,
					"--json",
				],
				{ ...process.env, NX_LEGACY_AFFECTED: "false" },
			),
		);
	} else {
		console.log(`The previous main commit (${base || "none"}) is unknown; deploying every app.`);
		selection = "all";
	}
}
const projects = selectProductionProjects({ selection, affected });
console.log(`Production projects (${selection}): ${projects.join(", ") || "none"}`);
const text = `projects=${JSON.stringify(projects)}\n`;
process.stdout.write(text);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, text);
