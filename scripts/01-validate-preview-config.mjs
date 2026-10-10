#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";

import { previewName, validatePreviewConfig, webPreviewUrls } from "./lib/deploy/preview.mjs";

const args = process.argv.slice(2);
function flag(name, fallback) {
	const index = args.indexOf(name);
	if (index === -1) return fallback;
	if (!args[index + 1] || args[index + 1].startsWith("--"))
		throw new Error(`Missing value for ${name}.`);
	return args[index + 1];
}
const prNumber = flag("--pr-number", process.env.PR_NUMBER);
const name = previewName(prNumber);
const project = validatePreviewConfig(
	JSON.parse(readFileSync(flag("--config"), "utf8")),
	flag("--project", process.env.PREVIEW_PROJECT_ID),
);
const subdomain = process.env.CF_PREVIEW_WORKERS_SUBDOMAIN;
const outputs = {
	preview_name: name,
	...(project.projectId === "web" && subdomain ? webPreviewUrls(prNumber, subdomain) : {}),
};
const text =
	Object.entries(outputs)
		.map(([key, value]) => `${key}=${value}`)
		.join("\n") + "\n";
process.stdout.write(text);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, text);
