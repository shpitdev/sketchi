import { createFileRoute } from "@tanstack/react-router";
import { useAsyncResource } from "@/features/resources/use-async-resource";
import { artifactRouteUrls, fetchArtifactScene } from "@/features/artifacts/artifact-view-client";
import { EditableArtifactStage } from "@/features/artifacts/editable-artifact-stage";

export const Route = createFileRoute("/artifacts_/$artifactId/edit")({
	component: ArtifactEditRoute,
});

function ArtifactEditRoute() {
	const { artifactId } = Route.useParams();
	const state = useAsyncResource(
		(signal) => fetchArtifactScene(artifactId, signal).then((scene) => ({ scene })),
		[artifactId],
		"Artifact could not be loaded.",
	);
	const urls = artifactRouteUrls(artifactId);

	return (
		<EditableArtifactStage
			artifactId={artifactId}
			downloadName={artifactId}
			headerLinks={
				<a className="studio__artifact-link" href={urls.review}>
					Review
				</a>
			}
			loadingMessage="Loading artifact..."
			showSceneFile
			state={state}
		/>
	);
}
