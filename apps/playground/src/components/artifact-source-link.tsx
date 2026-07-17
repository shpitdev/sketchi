import type { ArtifactProvenance } from "@sketchi/diagram-agent";

import { IconLink } from "@/components/sketch-icons";
import { artifactRouteUrls } from "@/features/artifacts/artifact-view-client";

export function ArtifactSourceLink({
  provenance,
}: {
  provenance?: ArtifactProvenance;
}) {
  if (!provenance) {
    return null;
  }

  return (
    <IconLink
      href={artifactRouteUrls(provenance.sourceArtifactId).review}
      icon="review"
      label="Source artifact"
    />
  );
}
