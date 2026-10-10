#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

import { previewName, previewProjectConfig } from "./lib/deploy/preview.mjs";

function readFlag(args, name, fallback) {
	const index = args.indexOf(name);

	if (index === -1) {
		return fallback;
	}

	const value = args[index + 1];
	if (!value) {
		throw new Error(`Missing value for ${name}.`);
	}

	return value;
}

function writeOutputs(outputs) {
	const text = Object.entries(outputs)
		.map(([key, value]) => `${key}=${value}`)
		.join("\n");

	process.stdout.write(`${text}\n`);

	if (process.env.GITHUB_OUTPUT) {
		appendFileSync(process.env.GITHUB_OUTPUT, `${text}\n`);
	}
}

// Cloudflare answers a hostname with no live Preview with this 404. Anything
// else, including the app's own responses, means the Preview still serves.
async function previewRetired(previewUrl) {
	try {
		const response = await fetch(`${previewUrl}/?sketchi-cleanup=${Date.now()}`, {
			headers: { "Cache-Control": "no-cache" },
			redirect: "manual",
		});
		await response.body?.cancel();
		return response.status === 404 && response.headers.get("x-preview-user-error") === "true";
	} catch {
		return false;
	}
}

export async function deletePreview(
	args = process.argv.slice(2),
	{ attempts = 12, intervalMs = 10_000, wait = sleep } = {},
) {
	const project = previewProjectConfig(readFlag(args, "--project"));
	const name = previewName(readFlag(args, "--pr-number", process.env.PR_NUMBER));
	const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
	const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();

	if (!accountId || !apiToken) {
		console.log("::warning::Cloudflare credentials are not configured. Nothing was deleted.");
		return;
	}

	const workerApi = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/workers/${project.workerName}`;
	const headers = { Authorization: `Bearer ${apiToken}` };

	const worker = await fetch(workerApi, { headers });
	const suffix = (await worker.json().catch(() => null))?.result?.subdomain?.preview_url_suffix;
	if (
		!worker.ok ||
		typeof suffix !== "string" ||
		!suffix.startsWith(`-${project.workerName}.`) ||
		!suffix.endsWith(".workers.dev")
	) {
		throw new Error(
			`Cannot resolve the Preview URL of ${project.workerName} (HTTP ${worker.status}).`,
		);
	}
	const previewUrl = `https://${name}${suffix}`;

	// Deletes only this PR's Preview of the production Worker. 404 means it is already gone.
	const deleted = await fetch(`${workerApi}/previews/${name}`, {
		headers,
		method: "DELETE",
	});
	if (!deleted.ok && deleted.status !== 404) {
		throw new Error(
			`Cloudflare Preview delete failed with HTTP ${deleted.status}: ${await deleted.text()}`,
		);
	}

	// A successful delete can leave the hostname serving the deleted code
	// (cloudflare/workers-sdk#15945), so only report deletion once it stops.
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		if (await previewRetired(previewUrl)) {
			writeOutputs({
				comment_status: "deleted",
				preview_name: name,
				preview_url: previewUrl,
			});
			return;
		}
		if (attempt < attempts) {
			await wait(intervalMs);
		}
	}

	writeOutputs({
		comment_status: "deletion-pending",
		preview_name: name,
		preview_url: previewUrl,
	});
	throw new Error(
		`Cloudflare deleted Preview ${name}, but ${previewUrl} still serves after ${attempts} checks (cloudflare/workers-sdk#15945).`,
	);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	deletePreview().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}
