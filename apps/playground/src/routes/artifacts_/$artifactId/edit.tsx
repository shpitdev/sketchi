import { createFileRoute } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { resourceError } from "@/features/projects/client";
import { artifactRouteUrls, artifactReview } from "@/features/artifacts/artifact-view-client";
import { EditableArtifactStage } from "@/features/artifacts/editable-artifact-stage";

export const Route = createFileRoute("/artifacts_/$artifactId/edit")({
	component: ArtifactEditRoute,
});

function ArtifactEditRoute() {
	const { artifactId } = Route.useParams();
	const state = useAtomValue(artifactReview(artifactId));
	const urls = artifactRouteUrls(artifactId);

	return (
		<EditableArtifactStage
			artifactId={artifactId}
			downloadName={artifactId}
			headerLinks={
				<a className="studio-header__link" href={urls.review}>
					View
				</a>
			}
			loadingMessage="Loading artifact..."
			showSceneFile
			state={state}
		/>
	);
}
