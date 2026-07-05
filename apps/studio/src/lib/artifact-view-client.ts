import {
  RenderedDiagramSceneSchema,
  type GetArtifactResult,
} from "@sketchi/diagram-agent";
import type { RenderedDiagramScene } from "@sketchi/diagram-renderer";

export type ArtifactViewState =
  | { status: "loading" }
  | { scene: RenderedDiagramScene; status: "ready" }
  | { message: string; status: "error" };

export interface ArtifactRouteUrls {
  drawing: string;
  edit: string;
  review: string;
  scene: string;
}

function isGetArtifactResult(value: unknown): value is GetArtifactResult {
  return Boolean(value) && typeof value === "object";
}

export function artifactRouteUrls(artifactId: string): ArtifactRouteUrls {
  const encoded = encodeURIComponent(artifactId);
  return {
    drawing: `/api/v1/artifacts/${encoded}?format=excalidraw&raw=true`,
    edit: `/artifacts/${encoded}/edit`,
    review: `/artifacts/${encoded}`,
    scene: `/api/v1/artifacts/${encoded}?format=scene&raw=true`,
  };
}

export async function fetchArtifactScene(
  artifactId: string,
): Promise<RenderedDiagramScene> {
  const response = await fetch(
    `/api/v1/artifacts/${encodeURIComponent(
      artifactId,
    )}?format=scene&inline=true`,
  );
  const payload: unknown = await response.json();

  if (!response.ok || !isGetArtifactResult(payload) || !payload.ok) {
    throw new Error("Artifact could not be loaded.");
  }

  const parsed = RenderedDiagramSceneSchema.safeParse(payload.inline);
  if (!parsed.success) {
    throw new Error("Artifact scene could not be rendered.");
  }

  return parsed.data as RenderedDiagramScene;
}
