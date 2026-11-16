import { createFileRoute } from "@tanstack/react-router";

import { IconActionBar, IconButton } from "@/components/sketch-icons";
import { StudioHeader } from "@/components/studio-header";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { resourceError } from "@/features/projects/client";
import { editableDiagramDrawing } from "@/features/projects/diagram-drawing";
import { DiagramEditor } from "@/features/projects/diagram-editor";

export const Route = createFileRoute("/diagrams_/$diagramId/edit")({
	component: DiagramEditRoute,
});

function DiagramEditRoute() {
	const { diagramId } = Route.useParams();
	const state = useAtomValue(editableDiagramDrawing(diagramId));
	if (AsyncResult.isSuccess(state))
		return (
			<DiagramEditor
				key={diagramId}
				diagramId={diagramId}
				draft={state.value.draft}
				headerLinks={
					<>
						<a className="studio-header__link" href={state.value.diagram.reviewUrl}>
							View
						</a>
						<a className="studio-header__link" href={`/projects/${state.value.project.id}`}>
							Project
						</a>
					</>
				}
				scene={state.value.scene}
				title={state.value.diagram.title}
			/>
		);

	return (
		<main className="artifact-view">
			<StudioHeader className="studio-header--ruled">
				<IconActionBar>
					<IconButton disabled icon="save" label="Save" showLabel />
				</IconActionBar>
			</StudioHeader>
			<section className="artifact-view__stage">
				<p
					className={`artifact-view__message${AsyncResult.isFailure(state) ? " artifact-view__message--error" : ""}`}
				>
					{AsyncResult.isFailure(state)
						? resourceError(state, "Studio diagram could not be loaded.")
						: "Loading diagram..."}
				</p>
			</section>
		</main>
	);
}
