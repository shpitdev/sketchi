import { Array } from "effect";
import { projectsQuery } from "@/features/projects/client";
import { createFileRoute } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { resourceError } from "@/features/projects/client";

import { studioDiagramUrl, studioProjectUrl } from "@/features/projects/contracts";
import { StudioHeader } from "@/components/studio-header";

export const Route = createFileRoute("/projects")({
	component: ProjectsRoute,
});

function ProjectsRoute() {
	const state = useAtomValue(projectsQuery);
	return (
		<main className="studio-workspace">
			<StudioHeader className="studio-header--ruled">
				<a className="studio-header__link" href="/">
					Playground
				</a>
			</StudioHeader>

			<section className="studio-workspace__body">
				<div className="studio-workspace__intro">
					<h1 className="studio-workspace__title">Projects</h1>
				</div>

				{AsyncResult.isInitial(state) ? (
					<p className="studio-workspace__message">Loading projects...</p>
				) : null}
				{AsyncResult.isFailure(state) ? (
					<p className="studio-workspace__message studio-workspace__message--error">
						{resourceError(state, "Studio projects could not be loaded.")}
					</p>
				) : null}
				{AsyncResult.isSuccess(state) && state.value.projects.length === 0 ? (
					<div className="studio-workspace__empty">
						<p>No saved projects yet.</p>
						<a className="studio__artifact-link" href="/">
							Open Playground
						</a>
					</div>
				) : null}
				{AsyncResult.isSuccess(state) && state.value.projects.length > 0 ? (
					<div className="studio-workspace__grid">
						{Array.map(state.value.projects,(project) => (
							<article className="studio-project-row" key={project.id}>
								<div className="studio-project-row__content">
									<h2>{project.title}</h2>
									<p>
										{project.diagramCount} diagram
										{project.diagramCount === 1 ? "" : "s"}
									</p>
								</div>
								<div className="studio-project-row__actions">
									{project.primaryDiagramId ? (
										<a
											className="studio__artifact-link"
											href={studioDiagramUrl(project.primaryDiagramId)}
										>
											Diagram
										</a>
									) : null}
									<a className="studio__artifact-link" href={studioProjectUrl(project.id)}>
										Project
									</a>
								</div>
							</article>
						))}
					</div>
				) : null}
			</section>
		</main>
	);
}
