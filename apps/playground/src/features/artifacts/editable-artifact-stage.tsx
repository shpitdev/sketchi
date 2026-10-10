import {
	convertSceneToExcalidraw,
	createExcalidrawFile,
	type ExcalidrawScene,
} from "@sketchi/diagram-excalidraw";
import type { RenderedDiagramScene } from "@sketchi/diagram-renderer";
import { ArtifactCanvas } from "@sketchi/diagram-ui";
import { useCallback, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { IconActionBar, IconButton, IconLink } from "@/components/sketch-icons";
import { StudioBrand } from "@/components/studio-brand";
import { artifactRouteUrls, type ArtifactViewState } from "./artifact-view-client";

export function useEditedDrawingDownload(scene: RenderedDiagramScene) {
	const baseScene = useMemo(() => convertSceneToExcalidraw(scene), [scene]);
	const latestScene = useRef(baseScene);
	const [dirty, setDirty] = useState(false);
	const onSceneChange = useCallback(
		(next: ExcalidrawScene) => {
			latestScene.current = next;
			// Excalidraw versions content edits, not selection or viewport changes.
			// Compare cheap revision fields instead of serializing every pointer event.
			setDirty(
				next.appState.viewBackgroundColor !== baseScene.appState.viewBackgroundColor ||
					next.elements.length !== baseScene.elements.length ||
					next.elements.some((element, index) => {
						const original = baseScene.elements[index];
						return (
							!original ||
							element.id !== original.id ||
							element.version !== original.version ||
							element.versionNonce !== original.versionNonce ||
							element.isDeleted !== original.isDeleted
						);
					}),
			);
		},
		[baseScene],
	);
	const onDownload = useCallback(
		(event: MouseEvent<HTMLAnchorElement>) => {
			if (!dirty) return;
			const anchor = event.currentTarget;
			const originalHref = anchor.href;
			const file = createExcalidrawFile(latestScene.current, {
				source: window.location.origin,
			});
			const url = URL.createObjectURL(
				new Blob([JSON.stringify(file, null, 2)], {
					type: "application/vnd.excalidraw+json",
				}),
			);
			anchor.href = url;
			// The anchor's default download runs before the next task. No URL survives
			// a download, and scene updates do not allocate blobs or object URLs.
			window.setTimeout(() => {
				URL.revokeObjectURL(url);
				anchor.href = originalHref;
			}, 0);
		},
		[dirty],
	);
	return { dirty, onSceneChange, onDownload };
}

interface EditableArtifactStageProps {
	artifactId?: string;
	downloadName: string;
	headerLinks: ReactNode;
	loadingMessage: string;
	showSceneFile?: boolean;
	state: ArtifactViewState;
}

function EditorFrame({
	actions,
	children,
	headerLinks,
}: {
	actions: ReactNode;
	children: ReactNode;
	headerLinks: ReactNode;
}) {
	return (
		<main className="artifact-view artifact-view--edit">
			<header className="artifact-view__bar">
				<StudioBrand />
				<div className="artifact-view__actions">
					{headerLinks}
					<IconActionBar>{actions}</IconActionBar>
				</div>
			</header>
			<section className="artifact-view__stage">{children}</section>
		</main>
	);
}

function ReadyEditor({
	artifactId,
	downloadName,
	headerLinks,
	scene,
	showSceneFile,
}: {
	artifactId: string;
	downloadName: string;
	headerLinks: ReactNode;
	scene: RenderedDiagramScene;
	showSceneFile: boolean;
}) {
	const { dirty, onSceneChange, onDownload } = useEditedDrawingDownload(scene);
	const urls = artifactRouteUrls(artifactId);
	return (
		<EditorFrame
			headerLinks={headerLinks}
			actions={
				<>
					{showSceneFile ? <IconLink href={urls.scene} icon="scene" label="Scene file" /> : null}
					<IconLink
						download={`${downloadName}.excalidraw`}
						href={urls.drawing}
						onClick={onDownload}
						icon="download"
						label={dirty ? "Download changes" : "Drawing file"}
						tone={dirty ? "primary" : "default"}
					/>
				</>
			}
		>
			<ArtifactCanvas mode="edit" onSceneChange={onSceneChange} scene={scene} />
		</EditorFrame>
	);
}

export function EditableArtifactStage({
	artifactId,
	downloadName,
	headerLinks,
	loadingMessage,
	showSceneFile = false,
	state,
}: EditableArtifactStageProps) {
	if (state.status === "ready" && artifactId)
		return (
			<ReadyEditor
				key={artifactId}
				artifactId={artifactId}
				downloadName={downloadName}
				headerLinks={headerLinks}
				scene={state.scene}
				showSceneFile={showSceneFile}
			/>
		);
	return (
		<EditorFrame
			headerLinks={headerLinks}
			actions={<IconButton disabled icon="download" label="Drawing file" />}
		>
			<p
				className={`artifact-view__message${state.status === "error" ? " artifact-view__message--error" : ""}`}
			>
				{state.status === "error" ? state.message : loadingMessage}
			</p>
		</EditorFrame>
	);
}
