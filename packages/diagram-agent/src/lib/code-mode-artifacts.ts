import {
  ArtifactProvenanceSchema,
  type ArtifactBundle,
  type ArtifactFormat,
  type ArtifactFormatRef,
  type ArtifactProvenance,
  type CodeModeIssue,
  type CodeModeIssueCode,
  type InlineArtifactFormat,
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
  provenance?: ArtifactProvenance;
  createdAt: string;
}

export interface ArtifactWriteInput {
  artifactId: string;
  diagramId: string;
  formats: StoredArtifactFormat[];
  inlineFormats: InlineArtifactFormat[];
  provenance?: ArtifactProvenance;
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
  arrayBuffer?(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

export type CodeModeObjectBucketBody = string | ArrayBuffer | Uint8Array;

export interface CodeModeObjectBucket {
  get(key: string): Promise<CodeModeObjectBucketObject | null>;
  put(
    key: string,
    value: CodeModeObjectBucketBody,
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
  png: "image/png",
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

export function isInlineArtifactFormat(
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
  provenance?: ArtifactProvenance;
}): ArtifactBundle {
  const preview = input.formats.find((format) => format.format === "scene");
  return {
    artifactId: input.artifactId,
    diagramId: input.diagramId,
    formats: input.formats,
    ...(input.provenance ? { provenance: input.provenance } : {}),
    ...(preview ? { preview } : {}),
  };
}

function cloneData<T>(value: T): T {
  return structuredClone(value);
}

export function jsonSizeBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function binarySizeBytes(value: ArrayBuffer | Uint8Array): number {
  return value.byteLength;
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
      const storedProvenance = input.provenance
        ? cloneData(input.provenance)
        : undefined;
      const manifest: StoredArtifactManifest = {
        artifactId: input.artifactId,
        diagramId: input.diagramId,
        formats: refs,
        ...(storedProvenance ? { provenance: storedProvenance } : {}),
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
        ...(input.provenance
          ? { provenance: cloneData(input.provenance) }
          : {}),
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
  const extension = format === "png" ? "png" : "json";
  return `${prefix}${artifactId}/${format}.${extension}`;
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
    (!("provenance" in value) || isArtifactProvenance(value.provenance)) &&
    typeof value.createdAt === "string"
  );
}

function isArtifactProvenance(value: unknown): value is ArtifactProvenance {
  return ArtifactProvenanceSchema.safeParse(value).success;
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

      if (format === "png") {
        const data = await readBinaryArtifact(object);
        return {
          format,
          mimeType: ARTIFACT_MIME_TYPES[format],
          data,
          sizeBytes: object.size ?? binarySizeBytes(data),
        };
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
        ...(input.provenance ? { provenance: input.provenance } : {}),
        createdAt: new Date().toISOString(),
      };

      await Promise.all(
        input.formats.map((artifact) =>
          bucket.put(
            keyForArtifact(prefix, input.artifactId, artifact.format),
            bodyForArtifact(artifact),
            {
              httpMetadata: { contentType: artifact.mimeType },
            },
          ),
        ),
      );
      await bucket.put(
        keyForArtifact(prefix, input.artifactId, MANIFEST_FORMAT),
        JSON.stringify(manifest),
        {
          httpMetadata: { contentType: "application/json" },
        },
      );

      const formats = input.formats.map((artifact) =>
        artifactRef(artifact, input.inlineFormats),
      );

      return bundleFromFormats({
        artifactId: input.artifactId,
        diagramId: input.diagramId,
        formats,
        ...(input.provenance ? { provenance: input.provenance } : {}),
      });
    },
  };
}

function bodyForArtifact(
  artifact: StoredArtifactFormat,
): CodeModeObjectBucketBody {
  if (artifact.format !== "png") {
    return JSON.stringify(artifact.data);
  }

  if (artifact.data instanceof ArrayBuffer) {
    return artifact.data;
  }

  if (artifact.data instanceof Uint8Array) {
    return artifact.data;
  }

  throw new Error("PNG artifact data must be binary.");
}

async function readBinaryArtifact(
  object: CodeModeObjectBucketObject,
): Promise<ArrayBuffer> {
  if (object.arrayBuffer) {
    return object.arrayBuffer();
  }

  throw new Error("Artifact object does not support binary reads.");
}

export function storageIssue(
  message: string,
  code: Extract<
    CodeModeIssueCode,
    "storage_read_failed" | "storage_write_failed"
  > = "storage_write_failed",
): CodeModeIssue {
  return {
    code,
    severity: "error",
    stage: "storage",
    message,
    hint: "Retry the request; if it keeps failing, inspect the artifact store binding.",
  };
}
