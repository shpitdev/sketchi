import { createServerFn } from "@tanstack/react-start";

import type { PackSummary } from "./packs.js";

export interface PackShelfData {
	/** The site's own origin, which excalidraw.com fetches a pack's scene from. */
	readonly origin: string;
	readonly packs: readonly PackSummary[];
}

/** Every pack's summary, rendered on the server so the drawings paint with the page. */
export const getPackShelf = createServerFn({ method: "GET" }).handler(
	async (): Promise<PackShelfData> => {
		const [{ getRequestUrl }, { loadPackIndex }] = await Promise.all([
			import("@tanstack/react-start/server"),
			import("./packs.server.js"),
		]);
		const { origin } = getRequestUrl();
		return { origin, packs: await loadPackIndex(origin) };
	},
);
