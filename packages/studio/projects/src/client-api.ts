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
  const parsed = StudioProjectsListResponseSchema.safeParse(payload);

  if (!response.ok || !parsed.success) {
    throw new Error("Studio projects could not be loaded.");
  }

  return parsed.data.projects;
}

export async function fetchStudioProjectDetails(
  projectId: string,
): Promise<StudioProjectDetails> {
  const response = await fetch(
    `/api/studio/projects/${encodeURIComponent(projectId)}`,
  );
  const payload: unknown = await response.json();
  const parsed = StudioProjectDetailsResponseSchema.safeParse(payload);

  if (!response.ok || !parsed.success) {
    throw new Error("Studio project could not be loaded.");
  }

  return parsed.data.details;
}

export async function fetchStudioDiagramDetails(diagramId: string): Promise<{
  diagram: StudioDiagramSummary;
  project: StudioProjectSummary;
}> {
  const response = await fetch(
    `/api/studio/diagrams/${encodeURIComponent(diagramId)}`,
  );
  const payload: unknown = await response.json();
  const parsed = StudioDiagramDetailsResponseSchema.safeParse(payload);

  if (!response.ok || !parsed.success) {
    throw new Error("Studio diagram could not be loaded.");
  }

  return {
    diagram: parsed.data.diagram,
    project: parsed.data.project,
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
  const parsed =
    CreateStudioProjectFromArtifactResponseSchema.safeParse(payload);

  if (!response.ok || !parsed.success) {
    throw new Error("Artifact could not be saved to Studio.");
  }

  return parsed.data;
}
