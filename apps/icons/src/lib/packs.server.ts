import "@tanstack/react-start/server-only";

import { env } from "cloudflare:workers";

import { decodePackIndex, PACK_INDEX_PATH, type PackSummary } from "./packs.js";

let cached: Promise<PackSummary[]> | undefined;

async function fetchPackIndex(origin: string): Promise<PackSummary[]> {
	const response: Response = await env.ASSETS.fetch(new URL(PACK_INDEX_PATH, origin));
	if (!response.ok) throw new Error(`Pack index returned HTTP ${response.status}.`);
	return decodePackIndex(await response.json());
}

/** The build's pack index, read once per isolate from the asset layer; a failed read is retried. */
export function loadPackIndex(origin: string): Promise<PackSummary[]> {
	const pending =
		cached ??
		fetchPackIndex(origin).catch((error: unknown) => {
			cached = undefined;
			throw error;
		});
	cached = pending;
	return pending;
}
