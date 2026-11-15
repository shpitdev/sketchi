import { createServerFn } from "@tanstack/react-start";

import type { PackExcalidrawState } from "../features/packs/publication.js";
import type { PackSummary } from "./packs.js";

export interface PackShelfData {
	readonly packs: readonly PackSummary[];
	/** Each pack's install link and whether it can be published, by pack id. */
	readonly excalidraw: Readonly<Record<string, PackExcalidrawState>>;
}

/** Every pack's summary, rendered on the server so the drawings paint with the page. */
export const getPackShelf = createServerFn({ method: "GET" }).handler(
	async (): Promise<PackShelfData> => {
		const [{ getRequestUrl }, { loadPackShelf }] = await Promise.all([
			import("@tanstack/react-start/server"),
			import("../features/packs/shelf.server.js"),
		]);
		return loadPackShelf(getRequestUrl().origin);
	},
);
