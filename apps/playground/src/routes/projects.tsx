import { createFileRoute } from "@tanstack/react-router";
import { useAsyncResource } from "@/features/resources/use-async-resource";

import {
  fetchStudioProjects,
  studioDiagramUrl,
  studioProjectUrl,
} from "@sketchi/studio-projects/client";
import { StudioBrand } from "@/components/studio-brand";

export const Route = createFileRoute("/projects")({
  component: ProjectsRoute,
});

function ProjectsRoute() {
  const state = useAsyncResource(
    (signal) => fetchStudioProjects(signal).then((projects) => ({ projects })),
    [],
    "Studio projects could not be loaded.",
  );

  return (
    <main className="studio-workspace">
      <header className="studio-workspace__bar">
        <StudioBrand />
        <div className="artifact-view__actions">
          <a className="studio__artifact-link" href="/">
            Playground
          </a>
        </div>
      </header>

      <section className="studio-workspace__body">
        <div className="studio-workspace__intro">
          <h1 className="studio-workspace__title">Projects</h1>
          <p className="studio__note">
            Saved to this browser only. No account yet — treat as temporary.
          </p>
        </div>

        {state.status === "loading" ? (
          <p className="studio-workspace__message">Loading projects...</p>
        ) : null}
        {state.status === "error" ? (
          <p className="studio-workspace__message studio-workspace__message--error">
            {state.message}
          </p>
        ) : null}
        {state.status === "ready" && state.projects.length === 0 ? (
          <div className="studio-workspace__empty">
            <p>No saved projects yet.</p>
            <a className="studio__artifact-link" href="/">
              Open Playground
            </a>
          </div>
        ) : null}
        {state.status === "ready" && state.projects.length > 0 ? (
          <div className="studio-workspace__grid">
            {state.projects.map((project) => (
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
                  <a
                    className="studio__artifact-link"
                    href={studioProjectUrl(project.id)}
                  >
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
