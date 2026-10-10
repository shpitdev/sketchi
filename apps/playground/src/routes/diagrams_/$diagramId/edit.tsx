import { createFileRoute } from "@tanstack/react-router";
import { useAsyncResource } from "@/features/resources/use-async-resource";
import { fetchDiagramScene } from "@/features/artifacts/artifact-view-client";
import { EditableArtifactStage } from "@/features/artifacts/editable-artifact-stage";

export const Route = createFileRoute("/diagrams_/$diagramId/edit")({
	component: DiagramEditRoute,
});

function DiagramEditRoute() {
	const { diagramId } = Route.useParams();
	const state = useAsyncResource(
		(signal) => fetchDiagramScene(diagramId, signal),
		[diagramId],
		"Studio diagram could not be loaded.",
	);

	return (
		<EditableArtifactStage
			{...(state.status === "ready" ? { artifactId: state.diagram.artifactId } : {})}
			downloadName={diagramId}
			headerLinks={
				state.status === "ready" ? (
					<>
						<a className="studio__artifact-link" href={`/diagrams/${state.diagram.id}`}>
							Review
						</a>
						<a className="studio__artifact-link" href={`/projects/${state.project.id}`}>
							Project
						</a>
					</>
				) : null
			}
			loadingMessage="Loading diagram..."
			state={state}
		/>
	);
}
