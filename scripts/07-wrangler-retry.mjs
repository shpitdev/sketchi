#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import { runWithAssetsUploadRetry } from "./lib/deploy/wrangler-retry.mjs";

// Usage: scripts/07-wrangler-retry.mjs -- <command> [args...]
export async function wranglerRetryCommand(args = process.argv.slice(2)) {
	const [command, ...rest] = args[0] === "--" ? args.slice(1) : args;
	if (!command) {
		throw new Error("Usage: scripts/07-wrangler-retry.mjs -- <command> [args...]");
	}

	return runWithAssetsUploadRetry(command, rest);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	wranglerRetryCommand().then(
		(code) => {
			process.exitCode = code;
		},
		(error) => {
			console.error(error instanceof Error ? error.message : error);
			process.exitCode = 1;
		},
	);
}
