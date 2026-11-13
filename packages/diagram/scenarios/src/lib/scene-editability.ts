import { Effect, Schema } from "effect";

import { createEditSession } from "./edit-session.js";
import { type EditabilityMetrics, measureEditability } from "./editability.js";
import { loadExcalidrawEditor, withoutHeldTimers } from "./excalidraw-editor.js";

class EditabilityError extends Schema.TaggedError<EditabilityError>()("EditabilityError", {
	cause: Schema.optionalKey(Schema.Defect()),
	message: Schema.String,
}) {}

/** Why a scene's editability metrics are missing. */
export interface EditabilityUnavailable {
	readonly editUnavailable: string;
}

const failure = (reason: string) => (cause: unknown) =>
	EditabilityError.make({
		cause,
		message: `${reason}: ${cause instanceof Error ? cause.message : String(cause)}`,
	});

/** Whether the exported scene binds an arrow, so there is a route to drag. */
const bindsAnArrow = (elements: readonly unknown[]) =>
	elements.some((element) => {
		if (typeof element !== "object" || element === null) return false;
		const { type, startBinding, endBinding } = element as Record<string, unknown>;
		return type === "arrow" && Boolean(startBinding || endBinding);
	});

/**
 * How a delivered scene holds up when a person drags its shapes in Excalidraw,
 * loaded into this process. A scene that binds no arrow has nothing to drag and
 * never loads the editor. Metrics, never a check: a scene the editor can't open
 * or edit leaves them out, with the reason as `editUnavailable`, and the sample
 * keeps its result.
 */
export const editabilityMetrics = Effect.fn("diagramScenarios.editabilityMetrics")(
	function* (elements: readonly unknown[]) {
		if (!bindsAnArrow(elements)) return { editBoundRoutes: 0 } satisfies EditabilityMetrics;
		const editor = yield* Effect.tryPromise({
			try: () => loadExcalidrawEditor(),
			catch: failure("Unable to load Excalidraw's editor"),
		});
		return yield* Effect.try({
			try: (): EditabilityMetrics =>
				withoutHeldTimers(() => measureEditability(createEditSession(editor), elements)),
			catch: failure("Unable to edit the scene in Excalidraw"),
		});
	},
	Effect.catch((error): Effect.Effect<EditabilityUnavailable> =>
		Effect.succeed({ editUnavailable: error.message }),
	),
);
