import { createFileRoute } from "@tanstack/react-router";

import { IconActionBar, IconButton } from "@/components/sketch-icons";
import { StudioHeader } from "@/components/studio-header";
import { useAsyncResource } from "@/features/resources/use-async-resource";
import { fetchDiagramDrawing } from "@/features/studio/diagram-drawing";
import { DiagramEditor } from "@/features/studio/diagram-editor";
import { readDrawingDraft } from "@/features/studio/drawing-drafts";

export const Route = createFileRoute("/diagrams_/$diagramId/edit")({
	component: DiagramEditRoute,
});

function DiagramEditRoute() {
	const { diagramId } = Route.useParams();
	const state = useAsyncResource(
		async (signal) => {
			const [drawing, draft] = await Promise.all([
				fetchDiagramDrawing(diagramId, signal),
				readDrawingDraft(diagramId),
			]);
			return { ...drawing, draft };
		},
		[diagramId],
		"Studio diagram could not be loaded.",
	);

	if (state.status === "ready")
		return (
			<DiagramEditor
				key={diagramId}
				diagramId={diagramId}
				draft={state.draft}
				headerLinks={
					<>
						<a className="studio-header__link" href={state.diagram.reviewUrl}>
							View
						</a>
						<a className="studio-header__link" href={`/projects/${state.project.id}`}>
							Project
						</a>
					</>
				}
				scene={state.scene}
				title={state.diagram.title}
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
					className={`artifact-view__message${state.status === "error" ? " artifact-view__message--error" : ""}`}
				>
					{state.status === "error" ? state.message : "Loading diagram..."}
				</p>
			</section>
		</main>
	);
}
