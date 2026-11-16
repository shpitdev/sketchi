import { DrawingEditor } from "@sketchi/editor";
import { createFileRoute } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { resourceError } from "@/features/projects/client";

import { diagramDrawing } from "@/features/projects/diagram-drawing";
import { IconActionBar, IconLink } from "@/components/sketch-icons";
import { StudioHeader } from "@/components/studio-header";

export const Route = createFileRoute("/diagrams/$diagramId")({
	component: DiagramRoute,
});

function DiagramRoute() {
	const { diagramId } = Route.useParams();
	const state = useAtomValue(diagramDrawing(diagramId));
	return (
		<main className="artifact-view">
			<StudioHeader className="studio-header--ruled">
				{AsyncResult.isSuccess(state) ? (
					<a className="studio-header__link" href={`/projects/${state.value.project.id}`}>
						Project
					</a>
				) : null}
				<a className="studio-header__link" href="/projects">
					Projects
				</a>
				{AsyncResult.isSuccess(state) ? (
					<IconActionBar>
						<IconLink href={state.value.diagram.editUrl} icon="edit" label="Edit" />
					</IconActionBar>
				) : null}
			</StudioHeader>

			<section className="artifact-view__stage">
				{AsyncResult.isInitial(state) ? (
					<p className="artifact-view__message">Loading diagram...</p>
				) : null}
				{AsyncResult.isFailure(state) ? (
					<p className="artifact-view__message artifact-view__message--error">
						{resourceError(state, "Studio diagram could not be loaded.")}
					</p>
				) : null}
				{AsyncResult.isSuccess(state) ? (
					<>
						<DrawingEditor
							revision={state.value.diagram.savedAt ?? "generated"}
							scene={state.value.scene}
							title={state.value.diagram.title}
							viewModeEnabled
						/>
					</>
				) : null}
			</section>
		</main>
	);
}
