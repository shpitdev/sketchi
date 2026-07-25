import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
  fetchStudioProjectDetails,
  studioDiagramUrl,
  type StudioProjectDetails,
} from "@sketchi/studio-projects/client";
import { IconActionBar, IconLink } from "@/components/sketch-icons";
import { StudioBrand } from "@/components/studio-brand";

export const Route = createFileRoute("/projects_/$projectId")({
  component: ProjectRoute,
});

type ProjectState =
  | { status: "loading" }
  | { message: string; status: "error" }
  | { details: StudioProjectDetails; status: "ready" };

function ProjectRoute() {
  const { projectId } = Route.useParams();
  const [state, setState] = useState<ProjectState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    setState({ status: "loading" });
    void fetchStudioProjectDetails(projectId)
      .then((details) => {
        if (!cancelled) {
          setState({ details, status: "ready" });
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setState({
            message:
              caught instanceof Error
                ? caught.message
                : "Studio project could not be loaded.",
            status: "error",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <main className="studio-workspace">
      <header className="studio-workspace__bar">
        <StudioBrand />
        <div className="artifact-view__actions">
          <a className="studio__artifact-link" href="/projects">
            Projects
          </a>
          <a className="studio__artifact-link" href="/">
            Playground
          </a>
        </div>
      </header>

      <section className="studio-workspace__body">
        {state.status === "loading" ? (
          <p className="studio-workspace__message">Loading project...</p>
        ) : null}
        {state.status === "error" ? (
          <p className="studio-workspace__message studio-workspace__message--error">
            {state.message}
          </p>
        ) : null}
        {state.status === "ready" ? (
          <>
            <div className="studio-workspace__intro">
              <h1 className="studio-workspace__title">
                {state.details.project.title}
              </h1>
            </div>

            <div className="studio-workspace__grid">
              {state.details.diagrams.map((diagram) => (
                <article className="studio-project-row" key={diagram.id}>
                  <div className="studio-project-row__content">
                    <h2>{diagram.title}</h2>
                    <p>{diagram.source.kind}</p>
                  </div>
                  <div className="studio-project-row__actions">
                    <a
                      className="studio__artifact-link"
                      href={studioDiagramUrl(diagram.id)}
                    >
                      Review
                    </a>
                    <IconActionBar>
                      <IconLink
                        href={diagram.editUrl}
                        icon="edit"
                        label="Edit"
                      />
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
