#!/usr/bin/env node
// Writes `projects=<JSON array>`: the Worker apps this preview run deploys.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

import { selectPreviewProjects } from "./lib/deploy/preview.mjs";

const selection = process.env.PREVIEW_SELECTION?.trim() || "affected";
let affected = [];
let changedFiles = [];
if (selection === "affected") {
	const { BASE_SHA: base, HEAD_SHA: head } = process.env;
	if (!base || !head) throw new Error("BASE_SHA and HEAD_SHA are required for affected previews.");
	const run = (command, args) =>
		execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
	const mergeBase = run("git", ["merge-base", base, head]).trim();
	changedFiles = run("git", ["diff", "--name-only", mergeBase, head]).split("\n").filter(Boolean);
	affected = JSON.parse(
		run("pnpm", [
			"--silent",
			"nx",
			"show",
			"projects",
			"--affected",
			`--base=${mergeBase}`,
			`--head=${head}`,
			"--json",
		]),
	);
}
const projects = selectPreviewProjects({ selection, affected, changedFiles });
console.log(`Preview projects (${selection}): ${projects.join(", ") || "none"}`);
const text = `projects=${JSON.stringify(projects)}\n`;
process.stdout.write(text);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, text);
