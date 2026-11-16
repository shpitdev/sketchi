import { Effect } from "effect";

import type { StoredDiagram } from "../contracts";
import { encodeJson, validateStorageId } from "../document";
import { CliShareError } from "../errors";
import { CliPngRenderer } from "../render/png-renderer";
import { ExcalidrawShare } from "./excalidraw";
import { validateShareScene } from "./protocol";
import { DiagramStore } from "../store/service";

function unsupportedPulledScene(error: { readonly message: string }): CliShareError {
	return CliShareError.make({
		code: "unsupported_scene",
		message: "The pulled Excalidraw scene cannot be rendered safely.",
		hint: "Use a supported, renderable Excalidraw scene and retry.",
		details: [error.message],
	});
}

export interface PullTarget {
	readonly id: string;
	readonly observed: StoredDiagram;
}

export const preflightPullTarget = Effect.fn("sketchi.cli.preflightPullTarget")(function* (
	diagramId: string,
) {
	const id = yield* validateStorageId(diagramId);
	const store = yield* DiagramStore;
	const observed = yield* store.show(id);
	return { id, observed } satisfies PullTarget;
});

export const pullIntoStore = Effect.fn("sketchi.cli.pullIntoStore")(function* (
	diagramId: string,
	suppliedLink: string,
	preflight?: PullTarget,
) {
	const target = preflight ?? (yield* preflightPullTarget(diagramId));
	const id = target.id;
	const store = yield* DiagramStore;
	const sharing = yield* ExcalidrawShare;
	const renderer = yield* CliPngRenderer;
	const raw = yield* sharing.pull(suppliedLink);
	yield* validateShareScene(raw);
	const normalized = yield* renderer
		.normalizeExcalidraw(raw)
		.pipe(Effect.mapError(unsupportedPulledScene));
	yield* validateShareScene(normalized);
	yield* renderer
		.renderPng({ excalidraw: normalized })
		.pipe(Effect.mapError(unsupportedPulledScene));
	const diagram = yield* store.replaceWithDetached(
		id,
		new TextEncoder().encode(encodeJson(normalized)),
		target.observed.manifest.revision,
	);
	const sourceIdentity = "unverified" as const;
	return { diagram, sourceIdentity };
});
