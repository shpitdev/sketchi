import type {
  ArtifactBundle,
  ArtifactFormat,
  ArtifactFormatRef,
  CodeModeIssue,
  InlineArtifactFormat,
} from "./code-mode-contract.js";

export interface StoredArtifactFormat {
  format: ArtifactFormat;
  mimeType: string;
  data: unknown;
  sizeBytes: number;
}

export interface StoredArtifactManifest {
  artifactId: string;
  diagramId: string;
  formats: ArtifactFormatRef[];
  createdAt: string;
}

export interface ArtifactWriteInput {
  artifactId: string;
  diagramId: string;
  formats: StoredArtifactFormat[];
  inlineFormats: InlineArtifactFormat[];
}

export interface CodeModeArtifactStore {
  read(
    artifactId: string,
    format: ArtifactFormat,
  ): Promise<StoredArtifactFormat | null>;
  readManifest(artifactId: string): Promise<StoredArtifactManifest | null>;
  write(input: ArtifactWriteInput): Promise<ArtifactBundle>;
}

export interface CodeModeObjectBucketObject {
  readonly size?: number;
  text(): Promise<string>;
}

export interface CodeModeObjectBucket {
  get(key: string): Promise<CodeModeObjectBucketObject | null>;
  put(
    key: string,
    value: string,
    options?: {
      httpMetadata?: {
        contentType?: string;
      };
    },
  ): Promise<unknown>;
}

const MANIFEST_FORMAT = "manifest";

export const ARTIFACT_MIME_TYPES: Record<ArtifactFormat, string> = {
  excalidraw: "application/vnd.excalidraw+json",
  scene: "application/vnd.sketchi.scene+json",
};

function artifactRef(
  artifact: StoredArtifactFormat,
  inlineFormats: readonly InlineArtifactFormat[],
): ArtifactFormatRef {
  return {
    format: artifact.format,
    mimeType: artifact.mimeType,
    ...(isInlineArtifactFormat(artifact.format) &&
    inlineFormats.includes(artifact.format)
      ? { inline: artifact.data }
      : {}),
    sizeBytes: artifact.sizeBytes,
  };
}

function isInlineArtifactFormat(
  format: ArtifactFormat,
): format is InlineArtifactFormat {
  return format === "excalidraw" || format === "scene";
}

function manifestRef(artifact: StoredArtifactFormat): ArtifactFormatRef {
  return {
    format: artifact.format,
    mimeType: artifact.mimeType,
    sizeBytes: artifact.sizeBytes,
  };
}

function bundleFromFormats(input: {
  artifactId: string;
  diagramId: string;
  formats: ArtifactFormatRef[];
}): ArtifactBundle {
  const preview = input.formats.find((format) => format.format === "scene");
  return {
    artifactId: input.artifactId,
    diagramId: input.diagramId,
    formats: input.formats,
    ...(preview ? { preview } : {}),
  };
}

function cloneData<T>(value: T): T {
  return structuredClone(value);
}

export function jsonSizeBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

export function createMemoryArtifactStore(): CodeModeArtifactStore {
  const manifests = new Map<string, StoredArtifactManifest>();
  const artifacts = new Map<string, StoredArtifactFormat>();

  return {
    async read(artifactId, format) {
      const artifact = artifacts.get(`${artifactId}:${format}`);
      return artifact
        ? {
            ...artifact,
            data: cloneData(artifact.data),
          }
        : null;
    },
    async readManifest(artifactId) {
      const manifest = manifests.get(artifactId);
      return manifest ? cloneData(manifest) : null;
    },
    async write(input) {
      const refs = input.formats.map(manifestRef);
      const manifest: StoredArtifactManifest = {
        artifactId: input.artifactId,
        diagramId: input.diagramId,
        formats: refs,
        createdAt: new Date().toISOString(),
      };

      manifests.set(input.artifactId, manifest);
      for (const artifact of input.formats) {
        artifacts.set(`${input.artifactId}:${artifact.format}`, {
          ...artifact,
          data: cloneData(artifact.data),
        });
      }

      const formats = input.formats.map((artifact) =>
        artifactRef(artifact, input.inlineFormats),
      );

      return bundleFromFormats({
        artifactId: input.artifactId,
        diagramId: input.diagramId,
        formats,
      });
    },
  };
}

export interface ObjectBucketArtifactStoreOptions {
  prefix?: string;
}

function keyForArtifact(
  prefix: string,
  artifactId: string,
  format: ArtifactFormat | typeof MANIFEST_FORMAT,
): string {
  return `${prefix}${artifactId}/${format}.json`;
}

function normalizedPrefix(prefix: string | undefined): string {
  if (!prefix) {
    return "";
  }
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

function isArtifactFormatRef(value: unknown): value is ArtifactFormatRef {
  if (!value || typeof value !== "object") {
    return false;
  }
  return (
    "format" in value &&
    "mimeType" in value &&
    typeof value.format === "string" &&
    typeof value.mimeType === "string"
  );
}

function isStoredArtifactManifest(
  value: unknown,
): value is StoredArtifactManifest {
  if (!value || typeof value !== "object") {
    return false;
  }
  return (
    "artifactId" in value &&
    "diagramId" in value &&
    "formats" in value &&
    "createdAt" in value &&
    typeof value.artifactId === "string" &&
    typeof value.diagramId === "string" &&
    Array.isArray(value.formats) &&
    value.formats.every(isArtifactFormatRef) &&
    typeof value.createdAt === "string"
  );
}

export function createObjectBucketArtifactStore(
  bucket: CodeModeObjectBucket,
  options: ObjectBucketArtifactStoreOptions = {},
): CodeModeArtifactStore {
  const prefix = normalizedPrefix(options.prefix);

  return {
    async read(artifactId, format) {
      const object = await bucket.get(
        keyForArtifact(prefix, artifactId, format),
      );
      if (!object) {
        return null;
      }

      const data: unknown = JSON.parse(await object.text());
      return {
        format,
        mimeType: ARTIFACT_MIME_TYPES[format],
        data,
        sizeBytes: object.size ?? jsonSizeBytes(data),
      };
    },
    async readManifest(artifactId) {
      const object = await bucket.get(
        keyForArtifact(prefix, artifactId, MANIFEST_FORMAT),
      );
      if (!object) {
        return null;
      }

      const data: unknown = JSON.parse(await object.text());
      if (!isStoredArtifactManifest(data)) {
        return null;
      }

      return data;
    },
    async write(input) {
      const refs = input.formats.map(manifestRef);
      const manifest: StoredArtifactManifest = {
        artifactId: input.artifactId,
        diagramId: input.diagramId,
        formats: refs,
        createdAt: new Date().toISOString(),
      };

      await Promise.all([
        bucket.put(
          keyForArtifact(prefix, input.artifactId, MANIFEST_FORMAT),
          JSON.stringify(manifest),
          {
            httpMetadata: { contentType: "application/json" },
          },
        ),
        ...input.formats.map((artifact) =>
          bucket.put(
            keyForArtifact(prefix, input.artifactId, artifact.format),
            JSON.stringify(artifact.data),
            {
              httpMetadata: { contentType: artifact.mimeType },
            },
          ),
        ),
      ]);

      const formats = input.formats.map((artifact) =>
        artifactRef(artifact, input.inlineFormats),
      );

      return bundleFromFormats({
        artifactId: input.artifactId,
        diagramId: input.diagramId,
        formats,
      });
    },
  };
}

export function storageIssue(message: string): CodeModeIssue {
  return {
    code: "storage_write_failed",
    severity: "error",
    stage: "storage",
    message,
    hint: "Retry the request; if it keeps failing, inspect the artifact store binding.",
  };
}
