import { nanoid } from "nanoid";
import { Context, Effect, Layer, Schema, DateTime, Array, String as Str } from "effect";

import {
	failureMessage,
	StudioDecodeError,
	StudioNotFoundError,
	StudioStorageError,
	type StudioResourceKind,
} from "./errors.server.js";

export interface StudioObjectMetadata {
	readonly uploaded: Date;
	readonly etag: string;
}

export interface StudioObjectBucketObject extends StudioObjectMetadata {
	readonly size?: number;
	arrayBuffer?(): Promise<ArrayBuffer>;
	text(): Promise<string>;
}

export type StudioObjectBucketBody = string | ArrayBuffer | Uint8Array;

export interface StudioObjectBucketListEntry {
	key: string;
}

export interface StudioObjectBucketListOptions {
	cursor?: string;
	prefix: string;
}

export interface StudioObjectBucketListResult {
	cursor?: string;
	objects: readonly StudioObjectBucketListEntry[];
	truncated?: boolean;
}

/** The minimal Cloudflare R2-compatible runtime binding accepted at the edge. */
export interface StudioObjectBucket {
	delete?(key: string): Promise<unknown>;
	head(key: string): Promise<StudioObjectMetadata | null>;
	get(key: string): Promise<StudioObjectBucketObject | null>;
	put(
		key: string,
		value: StudioObjectBucketBody,
		options?: {
			httpMetadata?: {
				contentType?: string;
			};
		},
	): Promise<StudioObjectMetadata | null>;
	list(options: StudioObjectBucketListOptions): Promise<StudioObjectBucketListResult>;
}

export interface StudioObjectStoreShape {
	readonly head: (key: string) => Effect.Effect<StudioObjectMetadata | null, StudioStorageError>;
	readonly delete: (key: string) => Effect.Effect<void, StudioStorageError>;
	readonly getText: (key: string) => Effect.Effect<string | null, StudioStorageError>;
	readonly list: (
		options: StudioObjectBucketListOptions,
	) => Effect.Effect<StudioObjectBucketListResult, StudioStorageError>;
	readonly put: (
		key: string,
		value: StudioObjectBucketBody,
		options?: {
			readonly httpMetadata?: {
				readonly contentType?: string;
			};
		},
	) => Effect.Effect<StudioObjectMetadata, StudioStorageError>;
}

export class StudioObjectStore extends Context.Service<StudioObjectStore, StudioObjectStoreShape>()(
	"@sketchi/studio/projects/StudioObjectStore",
) {}

function storageError(operation: "delete" | "get" | "head" | "list" | "put", target: string) {
	return (cause: unknown) =>
		StudioStorageError.make({
			cause,
			message: failureMessage(cause, "Studio persistence failed."),
			operation,
			target,
		});
}

export function makeStudioObjectStoreLayer(binding: unknown) {
	return Layer.effect(
		StudioObjectStore,
		Effect.gen(function* () {
			if (!isStudioObjectBucket(binding))
				return yield* storageError(
					"get",
					"binding",
				)(new Error("Studio persistence requires a complete R2 binding."));
			const bucket = binding;
			return StudioObjectStore.of({
				head: Effect.fn("studioPersistence.objectStore.head")((key: string) =>
					Effect.tryPromise({ try: () => bucket.head(key), catch: storageError("head", key) }),
				),
				delete: Effect.fn("studioPersistence.objectStore.delete")(function* (key: string) {
					const deleteObject = bucket.delete?.bind(bucket);
					if (!deleteObject) {
						return yield* Effect.fail(
							storageError(
								"delete",
								key,
							)(new Error("Studio persistence object deletion is unavailable.")),
						);
					}

					yield* Effect.tryPromise({
						try: () => deleteObject(key),
						catch: storageError("delete", key),
					});
				}),
				getText: Effect.fn("studioPersistence.objectStore.get")(function* (key: string) {
					const object = yield* Effect.tryPromise({
						try: () => bucket.get(key),
						catch: storageError("get", key),
					});
					return object
						? yield* Effect.tryPromise({
								try: () => object.text(),
								catch: storageError("get", key),
							})
						: null;
				}),
				list: Effect.fn("studioPersistence.objectStore.list")(function* (
					options: StudioObjectBucketListOptions,
				) {
					return yield* Effect.tryPromise({
						try: () => bucket.list(options),
						catch: storageError("list", options.prefix),
					});
				}),
				put: Effect.fn("studioPersistence.objectStore.put")(function* (
					key: string,
					value: StudioObjectBucketBody,
					options?: {
						readonly httpMetadata?: { readonly contentType?: string };
					},
				) {
					// R2 has no abortable put. Wait for the one atomic object operation to
					// settle before releasing ownership; interruption cannot compensate it.
					const metadata = yield* Effect.tryPromise({
						try: () => bucket.put(key, value, options),
						catch: storageError("put", key),
					}).pipe(Effect.uninterruptible);
					if (!metadata)
						return yield* storageError("put", key)(new Error("R2 did not return object metadata."));
					return metadata;
				}),
			});
		}),
	);
}

export class MemoryStudioObjectBucket implements StudioObjectBucket {
	readonly objects = new Map<string, string | Uint8Array>();
	readonly metadata = new Map<string, StudioObjectMetadata>();
	// @effect-diagnostics-next-line asyncFunction:off -- The existing local R2 binding implements the platform Promise interface; domain effects adapt it at StudioObjectStore.
	async head(key: string) {
		return this.objects.has(key) ? (this.metadata.get(key) ?? null) : null;
	}

	// @effect-diagnostics-next-line asyncFunction:off -- The existing local R2 binding implements the platform Promise interface; domain effects adapt it at StudioObjectStore.
	async delete(key: string): Promise<unknown> {
		this.objects.delete(key);
		this.metadata.delete(key);
		return null;
	}

	// @effect-diagnostics-next-line asyncFunction:off -- The existing local R2 binding implements the platform Promise interface; domain effects adapt it at StudioObjectStore.
	async get(key: string): Promise<StudioObjectBucketObject | null> {
		const value = this.objects.get(key);
		if (value === undefined) {
			return null;
		}

		const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;

		return {
			...(this.metadata.get(key) ?? {
				uploaded: DateTime.toDateUtc(DateTime.makeUnsafe(0)),
				etag: "fixture",
			}),
			size: bytes.byteLength,
			// @effect-diagnostics-next-line asyncFunction:off -- The existing local R2 binding implements the platform Promise interface; domain effects adapt it at StudioObjectStore.
			arrayBuffer: async () => {
				const buffer = new ArrayBuffer(bytes.byteLength);
				new Uint8Array(buffer).set(bytes);
				return buffer;
			},
			// @effect-diagnostics-next-line asyncFunction:off -- The existing local R2 binding implements the platform Promise interface; domain effects adapt it at StudioObjectStore.
			text: async () => (typeof value === "string" ? value : new TextDecoder().decode(value)),
		};
	}

	// @effect-diagnostics-next-line asyncFunction:off -- The existing local R2 binding implements the platform Promise interface; domain effects adapt it at StudioObjectStore.
	async put(key: string, value: StudioObjectBucketBody): Promise<StudioObjectMetadata> {
		this.objects.set(key, typeof value === "string" ? value : new Uint8Array(value));
		const metadata = { uploaded: DateTime.toDateUtc(DateTime.nowUnsafe()), etag: nanoid() };
		this.metadata.set(key, metadata);
		return metadata;
	}

	// @effect-diagnostics-next-line asyncFunction:off -- The existing local R2 binding implements the platform Promise interface; domain effects adapt it at StudioObjectStore.
	async list(options: StudioObjectBucketListOptions): Promise<StudioObjectBucketListResult> {
		return {
			objects: Array.map(
				Array.filter([...this.objects.keys()], (key) => Str.startsWith(options.prefix)(key)).sort(),
				(key) => ({ key }),
			),
			truncated: false,
		};
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isStudioObjectBucket(bucket: unknown): bucket is StudioObjectBucket {
	return (
		isRecord(bucket) &&
		typeof bucket["get"] === "function" &&
		typeof bucket["put"] === "function" &&
		typeof bucket["list"] === "function" &&
		typeof bucket["head"] === "function"
	);
}

export function makeStudioJsonPersistence(objectStore: StudioObjectStoreShape) {
	const read = Effect.fn("studioPersistence.readJson")(function* <
		S extends Schema.ConstraintCodec<unknown>,
	>(key: string, schema: S, resource: StudioResourceKind, id: string) {
		const text = yield* objectStore.getText(key);
		if (text === null) return yield* StudioNotFoundError.make({ id, resource });
		return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(text).pipe(
			Effect.mapError((cause) =>
				StudioDecodeError.make({
					cause,
					key,
					message: "Stored Studio data could not be decoded.",
					operation: "decode",
				}),
			),
		);
	});
	const put = Effect.fn("studioPersistence.putJson")(function* <
		S extends Schema.ConstraintCodec<unknown>,
	>(key: string, schema: S, value: S["Type"]) {
		const json = yield* Schema.encodeEffect(Schema.fromJsonString(schema))(value).pipe(
			Effect.mapError((cause) =>
				StudioDecodeError.make({
					cause,
					key,
					message: "Studio persistence failed.",
					operation: "encode",
				}),
			),
		);
		return yield* objectStore.put(key, json, { httpMetadata: { contentType: "application/json" } });
	});
	return { read, put };
}
