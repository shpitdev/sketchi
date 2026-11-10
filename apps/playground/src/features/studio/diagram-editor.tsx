import { createExcalidrawFile, type ExcalidrawScene } from "@sketchi/diagram-excalidraw";
import { downloadBlob, ExcalidrawSceneCanvas } from "@sketchi/diagram-ui";
import { saveStudioDiagramDrawing } from "@sketchi/studio-projects/client";
import { useCallback, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { IconActionBar, IconButton } from "@/components/sketch-icons";
import { StudioHeader } from "@/components/studio-header";

import { drawingFromScene, drawingSignature } from "./diagram-drawing";
import { createDrawingDraftCapture } from "./drawing-drafts";

export type DrawingSaveStatus = "error" | "saved" | "saving" | "unsaved";

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
	const [capture] = useState(() => createDrawingDraftCapture(diagramId));
	const latest = useRef<ExcalidrawScene | undefined>(draft);
	// What the server holds, as the editor reports it. A restored draft starts unsaved;
	// a saved drawing takes its signature from the editor's first report of it.
	const savedSignature = useRef<string | null>(draft ? "" : null);
	const capturedSignature = useRef<string | null>(null);
	const [status, setStatus] = useState<DrawingSaveStatus>(draft ? "unsaved" : "saved");
	const saving = useRef(false);

	// One rule for the draft and the button, run after every change and every Save. While
	// a Save is in flight the draft keeps the newest drawing whatever it matches: the
	// request may persist a drawing the user has since undone.
	const reconcile = useCallback(() => {
		const scene = latest.current;
		if (!scene) return;
		const signature = drawingSignature(scene);
		if (!saving.current && signature === savedSignature.current) {
			if (capturedSignature.current !== null) void capture.clear();
			capturedSignature.current = null;
			setStatus("saved");
			return;
		}
		if (signature !== capturedSignature.current) {
			capturedSignature.current = signature;
			capture.write(scene);
		}
		if (!saving.current) setStatus((current) => (current === "error" ? current : "unsaved"));
	}, [capture]);

	const onSceneChange = useCallback(
		(scene: ExcalidrawScene) => {
			latest.current = scene;
			savedSignature.current ??= drawingSignature(scene);
			reconcile();
		},
		[reconcile],
	);

	const save = useCallback(async () => {
		const scene = latest.current;
		if (!scene || saving.current) return;
		const signature = drawingSignature(scene);
		if (signature === savedSignature.current) return;
		saving.current = true;
		setStatus("saving");
		try {
			await saveStudioDiagramDrawing(diagramId, drawingFromScene(scene));
		} catch {
			saving.current = false;
			setStatus("error");
			return;
		}
		saving.current = false;
		savedSignature.current = signature;
		reconcile();
	}, [diagramId, reconcile]);

	const download = useCallback((fileName: string) => {
		const scene = latest.current;
		if (!scene) return;
		const file = createExcalidrawFile(scene, { source: window.location.origin });
		downloadBlob(
			new Blob([JSON.stringify(file, null, 2)], { type: "application/vnd.excalidraw+json" }),
			`${fileName}.excalidraw`,
		);
	}, []);

	return { download, onSceneChange, save, status };
}

/** Ctrl/Cmd+S saves to the diagram, ahead of Excalidraw's save-to-file. */
function isSaveShortcut(event: KeyboardEvent<HTMLElement>): boolean {
	return event.key.toLowerCase() === "s" && (event.metaKey || event.ctrlKey) && !event.altKey;
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
				void save();
			}}
		>
			<StudioHeader className="studio-header--ruled">
				{headerLinks}
				<IconActionBar>
					<IconButton
						disabled={status === "saved" || status === "saving"}
						icon="save"
						label={SAVE_LABELS[status]}
						onClick={() => void save()}
						showLabel
						tone={status === "saved" ? "default" : "primary"}
					/>
					<IconButton icon="download" label="Drawing file" onClick={() => download(diagramId)} />
				</IconActionBar>
			</StudioHeader>
			<section className="artifact-view__stage">
				<div className="sketchi-artifact-canvas" data-mode="edit">
					<ExcalidrawSceneCanvas
						onSceneChange={onSceneChange}
						revision={diagramId}
						scene={initialScene}
						title={title}
						viewModeEnabled={false}
						zenModeEnabled={false}
					/>
				</div>
			</section>
		</main>
	);
}
