import { convertSceneToExcalidraw } from "@sketchi/drawing/excalidraw";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { createProject, resourceError } from "@/features/projects/client";
import { DrawingEditor } from "@sketchi/editor";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";

import { artifactRouteUrls, artifactReview } from "@/features/artifacts/artifact-view-client";
import { ArtifactSourceLink } from "@/components/artifact-source-link";
import { IconActionBar, IconButton, IconLink } from "@/components/sketch-icons";
import { StudioHeader } from "@/components/studio-header";

export const Route = createFileRoute("/artifacts/$artifactId")({
	component: ArtifactRoute,
});

function ArtifactRoute() {
	const { artifactId } = Route.useParams();
	const state = useAtomValue(artifactReview(artifactId));
	const mutation = useMemo(() => createProject(artifactId), [artifactId]);
	const saveState = useAtomValue(mutation);
	const save = useAtomSet(mutation);
	const available = AsyncResult.isSuccess(state) && !state.waiting;
	const urls = artifactRouteUrls(artifactId);
	const saveToStudio = () => {
		if (available && !saveState.waiting) save();
	};

	return (
		<main className="artifact-view">
			<StudioHeader className="studio-header--ruled">
				<a className="studio-header__link" href="/">
					Playground
				</a>
				<IconActionBar>
					{AsyncResult.isSuccess(state) && state.value.provenance ? (
						<ArtifactSourceLink provenance={state.value.provenance} />
					) : null}
					{AsyncResult.isSuccess(saveState) ? (
						<IconLink
							href={saveState.value.urls.project}
							icon="project"
							label="Open project"
							tone="primary"
						/>
					) : (
						<IconButton
							disabled={!available || saveState.waiting}
							icon="save"
							label={saveState.waiting ? "Saving…" : "Save to Studio"}
							onClick={saveToStudio}
							tone="primary"
						/>
					)}
					{available ? (
						<IconLink href={urls.edit} icon="edit" label="Edit" />
					) : (
						<IconButton disabled icon="edit" label="Edit" />
					)}
					{available ? (
						<IconLink href={urls.scene} icon="scene" label="Scene file" />
					) : (
						<IconButton disabled icon="scene" label="Scene file" />
					)}
					{available ? (
						<IconLink href={urls.drawing} icon="drawing" label="Drawing file" />
					) : (
						<IconButton disabled icon="drawing" label="Drawing file" />
					)}
				</IconActionBar>
				{AsyncResult.isSuccess(saveState) ? (
					<span className="studio__note">Saved to Studio</span>
				) : null}
			</StudioHeader>

			<section className="artifact-view__stage">
				{AsyncResult.isFailure(saveState) ? (
					<p className="artifact-view__message artifact-view__message--error">
						{resourceError(saveState, "Artifact could not be saved to Studio.")}
					</p>
				) : null}
				{AsyncResult.isInitial(state) ? (
					<p className="artifact-view__message">Loading artifact...</p>
				) : null}
				{AsyncResult.isFailure(state) ? (
					<p className="artifact-view__message artifact-view__message--error">
						{resourceError(state, "Artifact could not be loaded.")}
					</p>
				) : null}
				{AsyncResult.isSuccess(state) ? (
					<DrawingEditor
						title={state.value.scene.title}
						revision={artifactId}
						scene={convertSceneToExcalidraw(state.value.scene)}
						viewModeEnabled={true}
						zenModeEnabled={true}
					/>
				) : null}
			</section>
		</main>
	);
}
