import { Clock, Context, Effect, Layer, Schema, Result } from "effect";

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

const ArtifactStorageOperationSchema = Schema.Literals(["read", "readManifest", "write"]);

export class CodeModeArtifactStorageError extends Schema.TaggedError<CodeModeArtifactStorageError>()(
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
	) => Effect.Effect<StoredArtifactManifest | null, CodeModeArtifactStorageError>;
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
		...(isInlineArtifactFormat(artifact.format) && inlineFormats.includes(artifact.format)
			? { inline: artifact.data }
			: {}),
		sizeBytes: artifact.sizeBytes,
	};
}

export function isInlineArtifactFormat(format: ArtifactFormat): format is InlineArtifactFormat {
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
	return {
		artifactId: input.artifactId,
		diagramId: input.diagramId,
		formats: input.formats,
		...(input.provenance ? { provenance: input.provenance } : {}),
	};
}

export function jsonSizeBytes(value: unknown): number {
	return new TextEncoder().encode(JSON.stringify(value)).length;
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
				operation === "write" ? "Artifact storage failed." : "Artifact read failed.",
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
			read: Effect.fn("codeMode.artifacts.memory.read")(function* (artifactId, format) {
				return yield* Effect.sync(() => {
					const artifact = artifacts.get(`${artifactId}:${format}`);
					return artifact ? { ...artifact, data: structuredClone(artifact.data) } : null;
				});
			}),
			readManifest: Effect.fn("codeMode.artifacts.memory.readManifest")(function* (artifactId) {
				return yield* Effect.sync(() => {
					const manifest = manifests.get(artifactId);
					return manifest ? structuredClone(manifest) : null;
				});
			}),
			write: Effect.fn("codeMode.artifacts.memory.write")(function* (input) {
				const now = yield* Clock.currentTimeMillis;
				return yield* Effect.try({
					try: () => {
						const refs = input.formats.map(manifestRef);
						const storedProvenance = input.provenance
							? structuredClone(input.provenance)
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
								data: structuredClone(artifact.data),
							});
						}

						const formats = input.formats.map((artifact) =>
							artifactRef(artifact, input.inlineFormats),
						);
						return bundleFromFormats({
							artifactId: input.artifactId,
							diagramId: input.diagramId,
							formats,
							...(input.provenance ? { provenance: structuredClone(input.provenance) } : {}),
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

export const CodeModeArtifactStorageMemory = Layer.effect(CodeModeArtifactStorage)(
	Effect.acquireRelease(Effect.sync(makeMemoryArtifactStorageState), (state) => state.close).pipe(
		Effect.map((state) => state.storage),
	),
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

function isStoredArtifactManifest(value: unknown): value is StoredArtifactManifest {
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
	return Result.isSuccess(
		Schema.decodeUnknownResult(ArtifactProvenanceSchema, {
			errors: "all",
			reportInput: true,
		})(value),
	);
}

function bodyForArtifact(
	artifact: StoredArtifactFormat,
): Effect.Effect<CodeModeObjectBucketBody, CodeModeArtifactStorageError> {
	if (artifact.format !== "png")
		return Effect.try({
			try: () => JSON.stringify(artifact.data),
			catch: storageError("write"),
		});
	if (artifact.data instanceof ArrayBuffer || artifact.data instanceof Uint8Array) {
		return Effect.succeed(artifact.data);
	}
	return Effect.fail(storageError("write")(new Error("PNG artifact data must be binary.")));
}

interface PreparedArtifactObject {
	readonly body: CodeModeObjectBucketBody;
	readonly bodyBytes: number;
	readonly bodyMs: number;
	readonly contentType: string;
	readonly format: ArtifactFormat | typeof MANIFEST_FORMAT;
}

const bodyEncoder = new TextEncoder();

function bodyByteLength(body: CodeModeObjectBucketBody): number {
	return typeof body === "string" ? bodyEncoder.encode(body).byteLength : body.byteLength;
}

const prepareArtifactObject = Effect.fnUntraced(function* (
	format: ArtifactFormat | typeof MANIFEST_FORMAT,
	contentType: string,
	body: Effect.Effect<CodeModeObjectBucketBody, CodeModeArtifactStorageError>,
) {
	const startedAt = yield* Clock.currentTimeMillis;
	const prepared = yield* body;
	const preparedAt = yield* Clock.currentTimeMillis;
	return {
		body: prepared,
		bodyBytes: bodyByteLength(prepared),
		bodyMs: preparedAt - startedAt,
		contentType,
		format,
	} satisfies PreparedArtifactObject;
});

function readBinaryArtifact(
	object: CodeModeObjectBucketObject,
): Effect.Effect<ArrayBuffer, CodeModeArtifactStorageError> {
	const arrayBuffer = object.arrayBuffer?.bind(object);
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
		try: () => arrayBuffer(),
		catch: storageError("read"),
	});
}


// PROBE ONLY (do not merge): R2 write timings, read back into execute logs.
type R2Probe = { writeMs: number; puts: { format: string; bytes: number; startMs: number; ms: number }[] };
const r2Probes = ((globalThis as { __sketchiR2Probe?: Map<string, R2Probe> }).__sketchiR2Probe ??=
	new Map<string, R2Probe>());
function probedPut(
	probe: R2Probe,
	t0: number,
	format: string,
	bytes: number,
	put: () => Promise<unknown>,
): () => Promise<unknown> {
	return async () => {
		const startedAt = Date.now();
		try {
			return await put();
		} finally {
			probe.puts.push({ format, bytes, startMs: startedAt - t0, ms: Date.now() - startedAt });
		}
	};
}
function probeBytes(body: CodeModeObjectBucketBody): number {
	return typeof body === "string" ? new TextEncoder().encode(body).byteLength : body.byteLength;
}

export function makeObjectBucketArtifactStorage(
	bucket: CodeModeObjectBucket,
	options: ObjectBucketArtifactStorageOptions = {},
): CodeModeArtifactStorageShape {
	const prefix = normalizedPrefix(options.prefix);

	return {
		read: Effect.fn("codeMode.artifacts.r2.read")(function* (artifactId, format) {
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
					sizeBytes: object.size ?? data.byteLength,
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
		}),
		readManifest: Effect.fn("codeMode.artifacts.r2.readManifest")(function* (artifactId) {
			const object = yield* Effect.tryPromise({
				try: () => bucket.get(keyForArtifact(prefix, artifactId, MANIFEST_FORMAT)),
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
		}),
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

			// Prepare every body before the first PUT, so a body that fails to serialize
			// publishes nothing.
			const objects = [
				...(yield* Effect.forEach(input.formats, (artifact) =>
					prepareArtifactObject(artifact.format, artifact.mimeType, bodyForArtifact(artifact)),
				)),
				yield* prepareArtifactObject(
					MANIFEST_FORMAT,
					"application/json",
					Effect.try({ try: () => JSON.stringify(manifest), catch: storageError("write") }),
				),
			];
			yield* Effect.annotateCurrentSpan({
				body_bytes: objects.reduce((total, object) => total + object.bodyBytes, 0),
				body_ms: objects.reduce((total, object) => total + object.bodyMs, 0),
				object_count: objects.length,
			});

			// One round trip: the manifest goes up with its formats. The artifact id is
			// fresh and reaches no caller until this write succeeds, so no reader can
			// fetch the manifest before every format it lists has landed. A failed PUT
			// fails the write and the id is never returned.
			const probe: R2Probe = { writeMs: 0, puts: [] };
			const t0 = Date.now();
			yield* Effect.forEach(
				objects,
				(object) =>
					Effect.tryPromise({
						try: probedPut(probe, t0, object.format, object.bodyBytes, () =>
							bucket.put(keyForArtifact(prefix, input.artifactId, object.format), object.body, {
								httpMetadata: { contentType: object.contentType },
							}),
						),
						catch: storageError("write"),
					}).pipe(
						Effect.withSpan("codeMode.artifacts.r2.put", {
							attributes: {
								artifact_format: object.format,
								body_bytes: object.bodyBytes,
								body_ms: object.bodyMs,
							},
						}),
					),
				{ concurrency: "unbounded", discard: true },
			);
			probe.writeMs = Date.now() - t0;
			r2Probes.set(input.artifactId, probe);

			const formats = input.formats.map((artifact) => artifactRef(artifact, input.inlineFormats));
			return bundleFromFormats({
				artifactId: input.artifactId,
				diagramId: input.diagramId,
				formats,
				...(input.provenance ? { provenance: input.provenance } : {}),
			});
		}),
	};
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
