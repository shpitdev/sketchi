import { Effect } from "effect";
import { Atom } from "effect/reactivity";
import { decodeIconManifest } from "@sketchi/icon-catalog";

import { loadPublished, queryRuntime, retryOnce } from "../browser/query";
import { decodeDrawings, DRAWINGS_PATH } from "./drawings";

export const manifestQuery = queryRuntime
	.atom(loadPublished("/icons-manifest.json", "Icon library", decodeIconManifest))
	.pipe(Atom.setIdleTTL(0), Atom.withServerValueInitial);
export const drawingsQuery = queryRuntime
	.atom((get) =>
		get
			.result(manifestQuery)
			.pipe(
				Effect.andThen(
					loadPublished(DRAWINGS_PATH, "Drawings", decodeDrawings).pipe(Effect.retry(retryOnce)),
				),
			),
	)
	.pipe(Atom.setIdleTTL(0), Atom.withServerValueInitial);
