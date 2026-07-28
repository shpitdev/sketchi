import { Clock, Context, Effect, Layer, Schema } from "effect";

import {
  ArtifactProvenanceSchema,
  type ArtifactBundle,
  type ArtifactFormat,
  type ArtifactFormatRef,
  type ArtifactProvenance,
  type CodeModeIssue,
  type CodeModeIssueCode,
  type InlineArtifactFormat,
} from "./contract.js";

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

const ArtifactStorageOperationSchema = Schema.Literals([
  "read",
  "readManifest",
  "write",
]);

export class CodeModeArtifactStorageError extends Schema.TaggedErrorClass<CodeModeArtifactStorageError>()(
  "CodeModeArtifactStorageError",
  {
    cause: Schema.Defect(),
    message: Schema.String,
    operation: ArtifactStorageOperationSchema,
  },
) {}

export interface CodeModeArtifactStorageShape {
  readonly read: (
    artifactId: string,
    format: ArtifactFormat,
  ) => Effect.Effect<StoredArtifactFormat | null, CodeModeArtifactStorageError>;
  readonly readManifest: (
    artifactId: string,
  ) => Effect.Effect<
    StoredArtifactManifest | null,
    CodeModeArtifactStorageError
  >;
  readonly write: (
    input: ArtifactWriteInput,
  ) => Effect.Effect<ArtifactBundle, CodeModeArtifactStorageError>;
}

export class CodeModeArtifactStorage extends Context.Service<
  CodeModeArtifactStorage,
  CodeModeArtifactStorageShape
>()("@sketchi/diagram-agent/CodeModeArtifactStorage") {}

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

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

function storageError(operation: "read" | "readManifest" | "write") {
  return (cause: unknown) =>
    CodeModeArtifactStorageError.make({
      cause,
      message: errorMessage(
        cause,
        operation === "write"
          ? "Artifact storage failed."
          : "Artifact read failed.",
      ),
      operation,
    });
}

interface MemoryArtifactStorageState {
  readonly close: Effect.Effect<void>;
  readonly storage: CodeModeArtifactStorageShape;
}

function makeMemoryArtifactStorageState(): MemoryArtifactStorageState {
  const manifests = new Map<string, StoredArtifactManifest>();
  const artifacts = new Map<string, StoredArtifactFormat>();

  return {
    close: Effect.sync(() => {
      artifacts.clear();
      manifests.clear();
    }),
    storage: {
      read: Effect.fn("codeMode.artifacts.memory.read")(
        function* (artifactId, format) {
          return yield* Effect.try({
            try: () => {
              const artifact = artifacts.get(`${artifactId}:${format}`);
              return artifact
                ? {
                    ...artifact,
                    data: cloneData(artifact.data),
                  }
                : null;
            },
            catch: storageError("read"),
          });
        },
      ),
      readManifest: Effect.fn("codeMode.artifacts.memory.readManifest")(
        function* (artifactId) {
          return yield* Effect.try({
            try: () => {
              const manifest = manifests.get(artifactId);
              return manifest ? cloneData(manifest) : null;
            },
            catch: storageError("readManifest"),
          });
        },
      ),
      write: Effect.fn("codeMode.artifacts.memory.write")(function* (input) {
        const now = yield* Clock.currentTimeMillis;
        return yield* Effect.try({
          try: () => {
            const refs = input.formats.map(manifestRef);
            const storedProvenance = input.provenance
              ? cloneData(input.provenance)
              : undefined;
            const manifest: StoredArtifactManifest = {
              artifactId: input.artifactId,
              diagramId: input.diagramId,
              formats: refs,
              ...(storedProvenance ? { provenance: storedProvenance } : {}),
              createdAt: new Date(now).toISOString(),
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
          catch: storageError("write"),
        });
      }),
    },
  };
}

export function makeMemoryArtifactStorage(): CodeModeArtifactStorageShape {
  return makeMemoryArtifactStorageState().storage;
}

export const CodeModeArtifactStorageMemory = Layer.effect(
  CodeModeArtifactStorage,
)(
  Effect.acquireRelease(
    Effect.sync(makeMemoryArtifactStorageState),
    (state) => state.close,
  ).pipe(Effect.map((state) => state.storage)),
);

export interface ObjectBucketArtifactStorageOptions {
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
  if (!prefix) return "";
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

function isArtifactFormatRef(value: unknown): value is ArtifactFormatRef {
  if (!value || typeof value !== "object") return false;
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
  if (!value || typeof value !== "object") return false;
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

function bodyForArtifact(
  artifact: StoredArtifactFormat,
): CodeModeObjectBucketBody {
  if (artifact.format !== "png") return JSON.stringify(artifact.data);
  if (
    artifact.data instanceof ArrayBuffer ||
    artifact.data instanceof Uint8Array
  ) {
    return artifact.data;
  }
  throw new Error("PNG artifact data must be binary.");
}

function readBinaryArtifact(
  object: CodeModeObjectBucketObject,
): Effect.Effect<ArrayBuffer, CodeModeArtifactStorageError> {
  const arrayBuffer = object.arrayBuffer;
  if (!arrayBuffer) {
    return Effect.fail(
      CodeModeArtifactStorageError.make({
        cause: new Error("Artifact object does not support binary reads."),
        message: "Artifact object does not support binary reads.",
        operation: "read",
      }),
    );
  }
  return Effect.tryPromise({
    try: () => arrayBuffer.call(object),
    catch: storageError("read"),
  });
}

export function makeObjectBucketArtifactStorage(
  bucket: CodeModeObjectBucket,
  options: ObjectBucketArtifactStorageOptions = {},
): CodeModeArtifactStorageShape {
  const prefix = normalizedPrefix(options.prefix);

  return {
    read: Effect.fn("codeMode.artifacts.r2.read")(
      function* (artifactId, format) {
        const object = yield* Effect.tryPromise({
          try: () => bucket.get(keyForArtifact(prefix, artifactId, format)),
          catch: storageError("read"),
        });
        if (!object) return null;

        if (format === "png") {
          const data = yield* readBinaryArtifact(object);
          return {
            format,
            mimeType: ARTIFACT_MIME_TYPES[format],
            data,
            sizeBytes: object.size ?? binarySizeBytes(data),
          };
        }

        const text = yield* Effect.tryPromise({
          try: () => object.text(),
          catch: storageError("read"),
        });
        const data: unknown = yield* Effect.try({
          try: () => JSON.parse(text),
          catch: storageError("read"),
        });
        return {
          format,
          mimeType: ARTIFACT_MIME_TYPES[format],
          data,
          sizeBytes: object.size ?? jsonSizeBytes(data),
        };
      },
    ),
    readManifest: Effect.fn("codeMode.artifacts.r2.readManifest")(
      function* (artifactId) {
        const object = yield* Effect.tryPromise({
          try: () =>
            bucket.get(keyForArtifact(prefix, artifactId, MANIFEST_FORMAT)),
          catch: storageError("readManifest"),
        });
        if (!object) return null;

        const text = yield* Effect.tryPromise({
          try: () => object.text(),
          catch: storageError("readManifest"),
        });
        const data: unknown = yield* Effect.try({
          try: () => JSON.parse(text),
          catch: storageError("readManifest"),
        });
        return isStoredArtifactManifest(data) ? data : null;
      },
    ),
    write: Effect.fn("codeMode.artifacts.r2.write")(function* (input) {
      const now = yield* Clock.currentTimeMillis;
      const refs = input.formats.map(manifestRef);
      const manifest: StoredArtifactManifest = {
        artifactId: input.artifactId,
        diagramId: input.diagramId,
        formats: refs,
        ...(input.provenance ? { provenance: input.provenance } : {}),
        createdAt: new Date(now).toISOString(),
      };

      yield* Effect.forEach(
        input.formats,
        (artifact) =>
          Effect.gen(function* () {
            const body = yield* Effect.try({
              try: () => bodyForArtifact(artifact),
              catch: storageError("write"),
            });
            yield* Effect.tryPromise({
              try: () =>
                bucket.put(
                  keyForArtifact(prefix, input.artifactId, artifact.format),
                  body,
                  { httpMetadata: { contentType: artifact.mimeType } },
                ),
              catch: storageError("write"),
            });
          }),
        { concurrency: 3, discard: true },
      );
      yield* Effect.tryPromise({
        try: () =>
          bucket.put(
            keyForArtifact(prefix, input.artifactId, MANIFEST_FORMAT),
            JSON.stringify(manifest),
            { httpMetadata: { contentType: "application/json" } },
          ),
        catch: storageError("write"),
      });

      const formats = input.formats.map((artifact) =>
        artifactRef(artifact, input.inlineFormats),
      );
      return bundleFromFormats({
        artifactId: input.artifactId,
        diagramId: input.diagramId,
        formats,
        ...(input.provenance ? { provenance: input.provenance } : {}),
      });
    }),
  };
}

export function makeCodeModeArtifactStorageR2Layer(
  bucket: CodeModeObjectBucket,
  options: ObjectBucketArtifactStorageOptions = {},
) {
  return Layer.succeed(
    CodeModeArtifactStorage,
    makeObjectBucketArtifactStorage(bucket, options),
  );
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
