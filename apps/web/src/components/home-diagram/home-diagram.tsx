import type { ExcalidrawInitialDataState, ExcalidrawProps } from "@excalidraw/excalidraw/types";
import { Button } from "@sketchi/ui/components/button";
import { Spinner } from "@sketchi/ui/components/spinner";
import { Pencil, RotateCcw } from "lucide-react";
import { type ComponentType, useRef, useState } from "react";

import { HomeDiagramEditor } from "./home-diagram-editor.js";
import { HOME_DIAGRAM } from "./home-diagram-data.js";

interface LoadedEditor {
	Excalidraw: ComponentType<ExcalidrawProps>;
	scene: ExcalidrawInitialDataState;
}

let editorLoad: Promise<LoadedEditor> | undefined;

/**
 * Fetches Excalidraw, its stylesheet and the scene together, once. Excalidraw
 * comes through diagram-ui's loader, which serves its fonts from this site;
 * diagram-ui itself loads here too, so none of it is on the page before Edit.
 * A failed load is forgotten so a retry starts over.
 */
function loadEditor(): Promise<LoadedEditor> {
	editorLoad ??= Promise.all([
		import("@sketchi/diagram-ui").then(({ loadExcalidraw }) => loadExcalidraw()),
		import("@excalidraw/excalidraw/index.css"),
		fetch(HOME_DIAGRAM.scene).then((response) => {
			if (!response.ok) throw new Error(`${HOME_DIAGRAM.scene} returned ${response.status}`);
			return response.json() as Promise<ExcalidrawInitialDataState>;
		}),
	]).then(([{ Excalidraw }, , scene]) => ({ Excalidraw, scene }));
	editorLoad.catch(() => {
		editorLoad = undefined;
	});
	return editorLoad;
}

type EditorState =
	| { status: "image" | "loading" | "failed" }
	| ({ status: "editing"; revision: number; width: number } & LoadedEditor);

/**
 * A real Sketchi diagram under the prompt that made it. The page loads only
 * Excalidraw's SVG export; Edit swaps in Excalidraw on the same scene, in
 * place, and Reset puts the original back.
 */
export function HomeDiagram() {
	const paperRef = useRef<HTMLDivElement>(null);
	const [state, setState] = useState<EditorState>({ status: "image" });
	const paperWidth = () => paperRef.current?.clientWidth || HOME_DIAGRAM.width;

	const editing = state.status === "editing";
	const edit = () => {
		if (state.status === "loading") return;
		setState({ status: "loading" });
		loadEditor().then(
			(loaded) => setState({ status: "editing", revision: 0, width: paperWidth(), ...loaded }),
			() => setState({ status: "failed" }),
		);
	};
	const reset = () => {
		if (state.status === "editing") {
			setState({ ...state, revision: state.revision + 1, width: paperWidth() });
		}
	};
	// Pointing at Edit starts the download, so the click has less to wait for.
	const prefetch = () => {
		loadEditor().catch(() => undefined);
	};

	return (
		<figure aria-busy={state.status === "loading"} className="home-diagram">
			<div className="home-diagram__bar">
				<figcaption className="home-diagram__prompt">
					<span className="sr-only">Made from the prompt </span>“{HOME_DIAGRAM.prompt}”
				</figcaption>
				{/* One button that stays enabled, so focus stays on it from Edit to Reset. */}
				<Button
					aria-label={editing ? "Reset diagram" : "Edit diagram"}
					onClick={editing ? reset : edit}
					onFocus={editing ? undefined : prefetch}
					onPointerEnter={editing ? undefined : prefetch}
					size="sm"
					variant="outline"
				>
					{editing ? (
						<RotateCcw aria-hidden="true" />
					) : state.status === "loading" ? (
						<Spinner aria-hidden="true" />
					) : (
						<Pencil aria-hidden="true" />
					)}
					{editing ? "Reset" : "Edit"}
				</Button>
			</div>
			<div className="home-diagram__paper" ref={paperRef}>
				<img
					alt={HOME_DIAGRAM.alt}
					aria-hidden={editing || undefined}
					className="home-diagram__image"
					fetchPriority="high"
					height={HOME_DIAGRAM.height}
					src={HOME_DIAGRAM.image}
					width={HOME_DIAGRAM.width}
				/>
				{editing ? (
					<div className="home-diagram__editor">
						<HomeDiagramEditor
							Excalidraw={state.Excalidraw}
							key={state.revision}
							scene={state.scene}
							width={state.width}
						/>
					</div>
				) : null}
			</div>
			{state.status === "failed" ? (
				<p className="home-diagram__error" role="alert">
					The editor didn&rsquo;t load. Check your connection and try again.
				</p>
			) : null}
		</figure>
	);
}
