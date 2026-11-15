import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Effect, Stream } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import { useState } from "react";

/** A new notice cancels the preceding expiry; unmount cancels the active sleep. */
export function useExportFeedback() {
	const [notice] = useState(() =>
		Atom.fn(
			(message: string) =>
				Stream.concat(
					Stream.make(message),
					Stream.fromEffect(Effect.as(Effect.sleep("3200 millis"), "")),
				),
			{ initialValue: "" },
		).pipe(Atom.setIdleTTL(0)),
	);
	const [copied] = useState(() =>
		Atom.fn((slug: string) =>
			Stream.concat(
				Stream.make(slug as string | undefined),
				Stream.fromEffect(Effect.as(Effect.sleep("1800 millis"), undefined)),
			),
		).pipe(Atom.setIdleTTL(0)),
	);
	return {
		notice: AsyncResult.getOrElse(useAtomValue(notice), () => ""),
		copiedSlug: AsyncResult.getOrElse(useAtomValue(copied), () => undefined),
		showNotice: useAtomSet(notice),
		showCopied: useAtomSet(copied),
	};
}
