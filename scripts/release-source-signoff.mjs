#!/usr/bin/env node
// Decides whether the release commit's exact source already passed `pnpm ci:local`. It did when a
// merged PR head that the gate itself signed off (not a carried signoff) has the same tree as
// HEAD, or as HEAD's parent when HEAD is a Version Packages commit that only bumps versions.
// Writes `verified=true|false`; release.yml runs the full gate when it is false.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const VERSION_FILE = /^\.changeset\/|(?:^|\/)CHANGELOG\.md$|(?:^|\/)package\.json$/;
const VERSION_LINE = /^[+-]\s*"version": "[^"]+",?$/;

/**
 * Whether a diff only consumes changesets, writes changelogs and bumps package versions.
 * @param {{ files: string[], packageDiff: string }} input `packageDiff` is `git diff -U0` of the
 *   package.json files.
 */
export function isVersionBump({ files, packageDiff }) {
	if (!files.every((file) => VERSION_FILE.test(file))) return false;
	return packageDiff
		.split("\n")
		.filter((line) => /^[+-]/.test(line) && !/^(?:\+\+\+|---) /.test(line))
		.every((line) => VERSION_LINE.test(line));
}

/** A `local-ci` success the gate posted itself; a carried one was checked on another base. */
export function gateSignoff(statuses) {
	return statuses.find(
		({ context, state, description }) =>
			context === "local-ci" && state === "success" && !/^carried\b/i.test(description ?? ""),
	);
}

function run(command, args) {
	return execFileSync(command, args, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "inherit"],
	}).trim();
}

function api(path) {
	return JSON.parse(run("gh", ["api", `repos/${process.env.GITHUB_REPOSITORY}/${path}`]));
}

/** Whether `head`'s tree differs from `source` by at most a version bump. */
function sameSource(source, head) {
	const files = run("git", ["diff", "--name-only", source, head]).split("\n").filter(Boolean);
	if (files.length === 0) return true;
	const packageDiff = run("git", ["diff", "-U0", source, head, "--", "*package.json"]);
	return isVersionBump({ files, packageDiff });
}

function main() {
	const head = run("git", ["rev-parse", "HEAD"]);
	// The release commit and, for a Version Packages commit, the merge before it.
	const commits = [head, run("git", ["rev-parse", "HEAD^"])];
	for (const commit of commits) {
		for (const pr of api(`commits/${commit}/pulls`).filter(({ merged_at }) => merged_at)) {
			const signoff = gateSignoff(api(`commits/${pr.head.sha}/statuses?per_page=100`));
			if (!signoff) {
				console.log(`PR #${pr.number} head ${pr.head.sha.slice(0, 12)} has no local-ci signoff.`);
				continue;
			}
			run("git", [
				"fetch",
				"--quiet",
				"--no-tags",
				"--depth=1",
				"origin",
				`refs/pull/${pr.number}/head`,
			]);
			if (run("git", ["rev-parse", "FETCH_HEAD"]) !== pr.head.sha) {
				console.log(`PR #${pr.number} head moved after its merge; skipping it.`);
				continue;
			}
			if (sameSource(pr.head.sha, head)) {
				console.log(
					`The released source matches PR #${pr.number} head ${pr.head.sha.slice(0, 12)}, signed off as local-ci (${signoff.description}).`,
				);
				return true;
			}
			console.log(
				`PR #${pr.number} head ${pr.head.sha.slice(0, 12)} differs from the released source.`,
			);
		}
	}
	return false;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	const verified = main();
	if (!verified) console.log("No local-ci signoff covers the released source; the full gate runs.");
	if (process.env.GITHUB_OUTPUT)
		appendFileSync(process.env.GITHUB_OUTPUT, `verified=${verified}\n`);
}
