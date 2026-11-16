import { Effect } from "effect";
import { Atom } from "effect/reactivity";

import { loadPublished, queryRuntime, retryOnce } from "../browser/query";
import { decodePackIcons, packIconsPath } from "./packs";

export const packQuery = Atom.family((id: string) =>
	queryRuntime
		.atom(
			loadPublished(packIconsPath(id), "Pack icons", decodePackIcons).pipe(Effect.retry(retryOnce)),
		)
		.pipe(Atom.setIdleTTL(0), Atom.withServerValueInitial),
);
