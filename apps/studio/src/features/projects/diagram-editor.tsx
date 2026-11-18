import { constant } from "effect/Function";
import { createExcalidrawFile, type ExcalidrawScene } from "@sketchi/drawing/excalidraw";
import { downloadBlob, DrawingEditor } from "@sketchi/editor-surface";
import { RegistryContext, useAtomMount, useAtomSet, useAtomValue } from "@effect/atom-react";
import { Effect, Schema, Stream, String as Str } from "effect";
import { Atom, AsyncResult } from "effect/reactivity";
import { StudioRecordIdSchema } from "./contracts";
import { StudioApi, projectsRuntime } from "./client";
import { useCallback, useContext, useState, type KeyboardEvent, type ReactNode } from "react";

import { IconActionBar, IconButton } from "@/components/sketch-icons";
import { StudioHeader } from "@/components/studio-header";

import { drawingFromScene, drawingSignature } from "./diagram-drawing";
import { drawingDraft } from "./drawing-drafts";

export type DrawingSaveStatus = "error" | "saved" | "saving" | "unsaved";

interface LatestScene {
	readonly scene: ExcalidrawScene;
	readonly signature: string;
}

const SAVE_LABELS: Record<DrawingSaveStatus, string> = {
	error: "Save failed, retry",
	saved: "Saved",
	saving: "Saving",
	unsaved: "Save",
};

/**
 * Every content edit goes to the browser's draft store as it happens; Save sends the
 * current drawing to the diagram and drops the draft it covered.
 */
export function useDrawingSession({
	diagramId,
	draft,
}: {
	diagramId: string;
	draft: ExcalidrawScene | undefined;
}) {
	const registry = useContext(RegistryContext);
	const [session] = useState(() => {
		// Excalidraw edits its elements in place and hands the same objects to every
		// change, so a held scene always reads as current. Each scene keeps the
		// signature it had when it arrived.
		const latest = Atom.make<LatestScene | undefined>(
			draft && { scene: draft, signature: drawingSignature(draft) },
		);
		const savedSignature = Atom.make<string | null>(draft ? "" : null);
		const persistedDraft = drawingDraft(diagramId);
		const save = projectsRuntime
			.fn((_value: void, get) =>
				Stream.fromEffect(
					Effect.gen(function* () {
						const scene = get(latest);
						if (!scene) return;
						const { signature } = scene;
						if (signature === get(savedSignature)) return;
						const id = yield* Schema.decodeUnknownEffect(StudioRecordIdSchema)(diagramId);
						const api = yield* StudioApi;
						yield* api.projects.save({
							params: { diagramId: id },
							payload: drawingFromScene(scene.scene),
						});
						get.set(savedSignature, signature);
						if (get(latest)?.signature === signature) get.set(persistedDraft, undefined);
					}),
				),
			)
			.pipe(Atom.setIdleTTL(0), Atom.withServerValue(constant(AsyncResult.initial())));
		const change = Atom.writable(
			(get) => get(latest),
			(context, scene: ExcalidrawScene) => {
				const previous = context.get(latest);
				const signature = drawingSignature(scene);
				context.set(latest, { scene, signature });
				if (context.get(savedSignature) === null) {
					context.set(savedSignature, signature);
					return;
				}
				if (previous?.signature === signature) return;
				context.set(
					persistedDraft,
					!context.get(save).waiting && signature === context.get(savedSignature)
						? undefined
						: drawingFromScene(scene),
				);
			},
		);
		const status = Atom.make((get): DrawingSaveStatus => {
			// Retain both content authorities through pending mutations. FnContext
			// reads do not mount atoms, and a waiting-only branch would release the
			// saved baseline before the request settles.
			const scene = get(latest);
			const persisted = get(savedSignature);
			const result = get(save);
			if (result.waiting) return "saving";
			if (!scene || scene.signature === persisted) return "saved";
			return AsyncResult.isFailure(result) ? "error" : "unsaved";
		});
		return { latest, persistedDraft, save, change, status };
	});
	useAtomMount(session.persistedDraft);
	const onSceneChange = useAtomSet(session.change);
	const save = useAtomSet(session.save);
	const status = useAtomValue(session.status);
	const download = useCallback(
		(fileName: string) => {
			const scene = registry.get(session.latest)?.scene;
			if (!scene) return;
			const file = createExcalidrawFile(scene, { source: window.location.origin });
			downloadBlob(
				// @effect-diagnostics-next-line globalJson:off -- Synchronous native file download serializes the Excalidraw payload during the user action.
				new Blob([JSON.stringify(file, null, 2)], { type: "application/vnd.excalidraw+json" }),
				`${fileName}.excalidraw`,
			);
		},
		[registry, session],
	);
	return {
		download,
		onSceneChange,
		save: () => {
			if (registry.get(session.status) !== "saving") save();
		},
		status,
	};
}

/** Ctrl/Cmd+S saves to the diagram, ahead of Excalidraw's save-to-file. */
function isSaveShortcut(event: KeyboardEvent<HTMLElement>): boolean {
	return Str.toLowerCase(event.key) === "s" && (event.metaKey || event.ctrlKey) && !event.altKey;
}

export function DiagramEditor({
	diagramId,
	draft,
	headerLinks,
	scene,
	title,
}: {
	diagramId: string;
	draft: ExcalidrawScene | undefined;
	headerLinks: ReactNode;
	scene: ExcalidrawScene;
	title: string;
}) {
	const { download, onSceneChange, save, status } = useDrawingSession({ diagramId, draft });
	const [initialScene] = useState(() => draft ?? scene);
	return (
		<main
			className="artifact-view"
			onKeyDownCapture={(event) => {
				if (!isSaveShortcut(event)) return;
				event.preventDefault();
				event.stopPropagation();
				save();
			}}
		>
			<StudioHeader className="studio-header--ruled">
				{headerLinks}
				<IconActionBar>
					<IconButton
						disabled={status === "saved" || status === "saving"}
						icon="save"
						label={SAVE_LABELS[status]}
						onClick={save}
						showLabel
						tone={status === "saved" ? "default" : "primary"}
					/>
					<IconButton icon="download" label="Drawing file" onClick={() => download(diagramId)} />
				</IconActionBar>
			</StudioHeader>
			<section className="artifact-view__stage">
				<>
					<DrawingEditor
						onSceneChange={onSceneChange}
						revision={diagramId}
						scene={initialScene}
						title={title}
						viewModeEnabled={false}
						zenModeEnabled={false}
					/>
				</>
			</section>
		</main>
	);
}
