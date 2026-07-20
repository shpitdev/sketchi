import { Result, Schema } from "effect";

import {
  CreateStudioProjectFromArtifactResponseSchema,
  StudioDiagramDetailsResponseSchema,
  StudioProjectDetailsResponseSchema,
  StudioProjectsListResponseSchema,
  type CreateStudioProjectFromArtifactResponse,
  type StudioDiagramSummary,
  type StudioProjectDetails,
  type StudioProjectSummary,
} from "./contracts.js";

export async function fetchStudioProjects(): Promise<StudioProjectSummary[]> {
  const response = await fetch("/api/studio/projects");
  const payload: unknown = await response.json();
  const parsed = Schema.decodeUnknownResult(StudioProjectsListResponseSchema)(
    payload,
  );

  if (!response.ok || Result.isFailure(parsed)) {
    throw new Error("Studio projects could not be loaded.");
  }

  return parsed.success.projects;
}

export async function fetchStudioProjectDetails(
  projectId: string,
): Promise<StudioProjectDetails> {
  const response = await fetch(
    `/api/studio/projects/${encodeURIComponent(projectId)}`,
  );
  const payload: unknown = await response.json();
  const parsed = Schema.decodeUnknownResult(StudioProjectDetailsResponseSchema)(
    payload,
  );

  if (!response.ok || Result.isFailure(parsed)) {
    throw new Error("Studio project could not be loaded.");
  }

  return parsed.success.details;
}

export async function fetchStudioDiagramDetails(diagramId: string): Promise<{
  diagram: StudioDiagramSummary;
  project: StudioProjectSummary;
}> {
  const response = await fetch(
    `/api/studio/diagrams/${encodeURIComponent(diagramId)}`,
  );
  const payload: unknown = await response.json();
  const parsed = Schema.decodeUnknownResult(StudioDiagramDetailsResponseSchema)(
    payload,
  );

  if (!response.ok || Result.isFailure(parsed)) {
    throw new Error("Studio diagram could not be loaded.");
  }

  return {
    diagram: parsed.success.diagram,
    project: parsed.success.project,
  };
}

export async function createStudioProjectFromArtifact(
  artifactId: string,
): Promise<CreateStudioProjectFromArtifactResponse> {
  const response = await fetch("/api/studio/projects/from-artifact", {
    body: JSON.stringify({ artifactId }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload: unknown = await response.json();
  const parsed = Schema.decodeUnknownResult(
    CreateStudioProjectFromArtifactResponseSchema,
  )(payload);

  if (!response.ok || Result.isFailure(parsed)) {
    throw new Error("Artifact could not be saved to Studio.");
  }

  return parsed.success;
}
