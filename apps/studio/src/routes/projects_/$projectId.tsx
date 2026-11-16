import { Array } from "effect";
import { createFileRoute } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { projectQuery, resourceError } from "@/features/projects/client";

import { studioDiagramUrl } from "@/features/projects/contracts";
import { IconActionBar, IconLink } from "@/components/sketch-icons";
import { StudioHeader } from "@/components/studio-header";

export const Route = createFileRoute("/projects_/$projectId")({
	component: ProjectRoute,
});

function ProjectRoute() {
	const { projectId } = Route.useParams();
	const state = useAtomValue(projectQuery(projectId));
	return (
		<main className="studio-workspace">
			<StudioHeader className="studio-header--ruled">
				<a className="studio-header__link" href="/projects">
					Projects
				</a>
				<a className="studio-header__link" href="/">
					Playground
				</a>
			</StudioHeader>

			<section className="studio-workspace__body">
				{AsyncResult.isInitial(state) ? (
					<p className="studio-workspace__message">Loading project...</p>
				) : null}
				{AsyncResult.isFailure(state) ? (
					<p className="studio-workspace__message studio-workspace__message--error">
						{resourceError(state, "Studio project could not be loaded.")}
					</p>
				) : null}
				{AsyncResult.isSuccess(state) ? (
					<>
						<div className="studio-workspace__intro">
							<h1 className="studio-workspace__title">{state.value.details.project.title}</h1>
						</div>

						<div className="studio-workspace__grid">
							{Array.map(state.value.details.diagrams, (diagram) => (
								<article className="studio-project-row" key={diagram.id}>
									<div className="studio-project-row__content">
										<h2>{diagram.title}</h2>
										<p>{diagram.source.kind}</p>
									</div>
									<div className="studio-project-row__actions">
										<a className="studio__artifact-link" href={studioDiagramUrl(diagram.id)}>
											View
										</a>
										<IconActionBar>
											<IconLink href={diagram.editUrl} icon="edit" label="Edit" />
										</IconActionBar>
									</div>
								</article>
							))}
						</div>
					</>
				) : null}
			</section>
		</main>
	);
}
