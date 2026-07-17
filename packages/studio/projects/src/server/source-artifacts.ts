export interface StudioSourceArtifact {
  diagramId: string;
  title: string;
}

export interface StudioSourceArtifactLoadFailure {
  code: string;
  message: string;
  ok: false;
  status: number;
}

export interface StudioSourceArtifactLoadSuccess {
  artifact: StudioSourceArtifact;
  ok: true;
}

export type StudioSourceArtifactLoadResult =
  | StudioSourceArtifactLoadSuccess
  | StudioSourceArtifactLoadFailure;

export interface StudioSourceArtifacts {
  load(artifactId: string): Promise<StudioSourceArtifactLoadResult>;
}
