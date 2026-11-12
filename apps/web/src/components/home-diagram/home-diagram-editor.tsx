import type { ExcalidrawInitialDataState, ExcalidrawProps } from "@excalidraw/excalidraw/types";
import type { ComponentType } from "react";

import { HOME_DIAGRAM } from "./home-diagram-data.js";

export interface HomeDiagramEditorProps {
	/** Excalidraw's editor, from diagram-ui's loader. */
	Excalidraw: ComponentType<ExcalidrawProps>;
	/** The committed .excalidraw file, parsed. */
	scene: ExcalidrawInitialDataState;
	/** Rendered width of the image this editor replaces. */
	width: number;
}

/**
 * Excalidraw itself, opened on the home diagram. It starts at the image's own
 * zoom and position, so the drawing stays put while the toolbar appears.
 */
export function HomeDiagramEditor({ Excalidraw, scene, width }: HomeDiagramEditorProps) {
	return (
		<Excalidraw
			initialData={{
				...scene,
				appState: {
					...scene.appState,
					scrollX: -HOME_DIAGRAM.origin.x,
					scrollY: -HOME_DIAGRAM.origin.y,
					zoom: { value: width / HOME_DIAGRAM.width },
				} as NonNullable<ExcalidrawInitialDataState["appState"]>,
			}}
			name={HOME_DIAGRAM.title}
			UIOptions={{
				canvasActions: {
					changeViewBackgroundColor: false,
					clearCanvas: false,
					export: { saveFileToDisk: true },
					loadScene: false,
					saveAsImage: true,
					saveToActiveFile: false,
					toggleTheme: false,
				},
				// Pictures added here would only live in this tab; without the tool the
				// toolbar also fits a phone.
				tools: { image: false },
			}}
		/>
	);
}
