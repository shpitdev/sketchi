import { ArtifactCanvas } from "@sketchi/diagram-ui";
import { createFileRoute } from "@tanstack/react-router";
import { useAsyncResource } from "@/features/resources/use-async-resource";

import { fetchDiagramScene } from "@/features/artifacts/artifact-view-client";
import { IconActionBar, IconLink } from "@/components/sketch-icons";
import { StudioBrand } from "@/components/studio-brand";

export const Route = createFileRoute("/diagrams/$diagramId")({
	component: DiagramRoute,
});

function DiagramRoute() {
	const { diagramId } = Route.useParams();
	const state = useAsyncResource(
		(signal) => fetchDiagramScene(diagramId, signal),
		[diagramId],
		"Studio diagram could not be loaded.",
	);

	return (
		<main className="artifact-view">
			<header className="artifact-view__bar">
				<StudioBrand />
				<div className="artifact-view__actions">
					{state.status === "ready" ? (
						<a className="studio__artifact-link" href={`/projects/${state.project.id}`}>
							Project
						</a>
					) : null}
					<a className="studio__artifact-link" href="/projects">
						Projects
					</a>
					{state.status === "ready" ? (
						<IconActionBar>
							<IconLink href={state.diagram.editUrl} icon="edit" label="Edit" />
						</IconActionBar>
					) : null}
				</div>
			</header>

			<section className="artifact-view__stage">
				{state.status === "loading" ? (
					<p className="artifact-view__message">Loading diagram...</p>
				) : null}
				{state.status === "error" ? (
					<p className="artifact-view__message artifact-view__message--error">{state.message}</p>
				) : null}
				{state.status === "ready" ? <ArtifactCanvas scene={state.scene} /> : null}
			</section>
		</main>
	);
}
