import { Schema, Result } from "effect";
import {
  RenderedDiagramSceneSchema,
  type ArtifactProvenance,
  type GetArtifactResult,
} from "@sketchi/diagram-agent";
import { fetchStudioDiagramDetails } from "@sketchi/studio-projects/client";
import type { RenderedDiagramScene } from "@sketchi/diagram-renderer";

import type { AsyncResource } from "@/features/resources/use-async-resource";

export type ArtifactViewState = AsyncResource<ArtifactReview>;

export interface ArtifactReview {
  provenance?: ArtifactProvenance;
  scene: RenderedDiagramScene;
}

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

export async function fetchArtifactReview(
  artifactId: string,
  signal?: AbortSignal,
): Promise<ArtifactReview> {
  const response = await fetch(
    `/api/v1/artifacts/${encodeURIComponent(
      artifactId,
    )}?format=scene&inline=true`,
    signal ? { signal } : {},
  );
  if (!response.ok) throw new Error("Artifact could not be loaded.");
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Artifact could not be loaded.");
  }

  if (!isGetArtifactResult(payload) || !payload.ok) {
    throw new Error("Artifact could not be loaded.");
  }

  const parsed = Schema.decodeUnknownResult(RenderedDiagramSceneSchema, {
    errors: "all",
    reportInput: true,
  })(payload.inline);
  if (!Result.isSuccess(parsed)) {
    throw new Error("Artifact scene could not be rendered.");
  }

  return {
    scene: parsed.success as RenderedDiagramScene,
    ...(payload.provenance ? { provenance: payload.provenance } : {}),
  };
}

export async function fetchArtifactScene(
  artifactId: string,
  signal?: AbortSignal,
): Promise<RenderedDiagramScene> {
  return (await fetchArtifactReview(artifactId, signal)).scene;
}

export async function fetchDiagramScene(
  diagramId: string,
  signal: AbortSignal,
) {
  const details = await fetchStudioDiagramDetails(diagramId, signal);
  const scene = await fetchArtifactScene(details.diagram.artifactId, signal);
  return { ...details, scene };
}
