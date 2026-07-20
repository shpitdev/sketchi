import { Context, Effect, Layer } from "effect";
import type { z } from "zod";

import {
  failureMessage,
  StudioDecodeError,
  StudioNotFoundError,
  StudioStorageError,
  type StudioResourceKind,
} from "./errors.js";

export interface StudioObjectBucketObject {
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
  get(key: string): Promise<StudioObjectBucketObject | null>;
  put(
    key: string,
    value: StudioObjectBucketBody,
    options?: {
      httpMetadata?: {
        contentType?: string;
      };
    },
  ): Promise<unknown>;
  list(
    options: StudioObjectBucketListOptions,
  ): Promise<StudioObjectBucketListResult>;
}

export interface StudioObjectStoreShape {
  readonly delete: (key: string) => Effect.Effect<void, StudioStorageError>;
  readonly getText: (
    key: string,
  ) => Effect.Effect<string | null, StudioStorageError>;
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
  ) => Effect.Effect<void, StudioStorageError>;
}

export class StudioObjectStore extends Context.Service<
  StudioObjectStore,
  StudioObjectStoreShape
>()("@sketchi/studio-projects/StudioObjectStore") {}

function storageError(
  operation: "delete" | "get" | "list" | "put",
  target: string,
) {
  return (cause: unknown) =>
    StudioStorageError.make({
      cause,
      message: failureMessage(cause, "Studio persistence failed."),
      operation,
      target,
    });
}

export function makeStudioObjectStoreLayer(bucket: StudioObjectBucket) {
  return Layer.succeed(StudioObjectStore, {
    delete: Effect.fn("studioPersistence.objectStore.delete")(function* (
      key: string,
    ) {
      if (!bucket.delete) {
        return yield* Effect.fail(
          storageError(
            "delete",
            key,
          )(new Error("Studio persistence object deletion is unavailable.")),
        );
      }

      yield* Effect.tryPromise({
        try: () => bucket.delete?.(key) ?? Promise.resolve(),
        catch: storageError("delete", key),
      });
    }),
    getText: Effect.fn("studioPersistence.objectStore.get")(function* (
      key: string,
    ) {
      return yield* Effect.tryPromise({
        try: async () => {
          const object = await bucket.get(key);
          return object ? object.text() : null;
        },
        catch: storageError("get", key),
      });
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
      yield* Effect.tryPromise({
        try: () => bucket.put(key, value, options),
        catch: storageError("put", key),
      });
    }),
  });
}

export class MemoryStudioObjectBucket implements StudioObjectBucket {
  readonly objects = new Map<string, string | Uint8Array>();

  async delete(key: string): Promise<unknown> {
    this.objects.delete(key);
    return null;
  }

  async get(key: string): Promise<StudioObjectBucketObject | null> {
    const value = this.objects.get(key);
    if (value === undefined) {
      return null;
    }

    const bytes =
      typeof value === "string" ? new TextEncoder().encode(value) : value;

    return {
      size: bytes.byteLength,
      arrayBuffer: async () => {
        const buffer = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(buffer).set(bytes);
        return buffer;
      },
      text: async () =>
        typeof value === "string" ? value : new TextDecoder().decode(value),
    };
  }

  async put(key: string, value: StudioObjectBucketBody): Promise<unknown> {
    this.objects.set(
      key,
      typeof value === "string" ? value : new Uint8Array(value),
    );
    return null;
  }

  async list(
    options: StudioObjectBucketListOptions,
  ): Promise<StudioObjectBucketListResult> {
    return {
      objects: [...this.objects.keys()]
        .filter((key) => key.startsWith(options.prefix))
        .sort()
        .map((key) => ({ key })),
      truncated: false,
    };
  }
}

export function makeMemoryStudioObjectStoreTestLayer(
  bucket: MemoryStudioObjectBucket,
) {
  return makeStudioObjectStoreLayer(bucket);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isStudioObjectBucket(
  bucket: unknown,
): bucket is StudioObjectBucket {
  return (
    isRecord(bucket) &&
    typeof bucket["get"] === "function" &&
    typeof bucket["put"] === "function" &&
    typeof bucket["list"] === "function"
  );
}

export function makeStudioJsonPersistence(objectStore: StudioObjectStoreShape) {
  const read = Effect.fn("studioPersistence.readJson")(function* <T>(
    key: string,
    schema: z.ZodType<T>,
    resource: StudioResourceKind,
    id: string,
  ) {
    const text = yield* objectStore.getText(key);

    if (text === null) {
      return yield* Effect.fail(StudioNotFoundError.make({ id, resource }));
    }

    const json = yield* Effect.try({
      try: () => JSON.parse(text),
      catch: (cause) =>
        StudioDecodeError.make({
          cause,
          key,
          message: failureMessage(cause, "Studio persistence failed."),
          operation: "decode",
        }),
    });
    const parsed = schema.safeParse(json);

    if (!parsed.success) {
      return yield* Effect.fail(
        StudioDecodeError.make({
          cause: parsed.error,
          key,
          message: "Stored Studio data could not be decoded.",
          operation: "decode",
        }),
      );
    }

    return parsed.data;
  });

  const put = Effect.fn("studioPersistence.putJson")(function* (
    key: string,
    value: unknown,
  ) {
    const json = yield* Effect.try({
      try: () => JSON.stringify(value),
      catch: (cause) =>
        StudioDecodeError.make({
          cause,
          key,
          message: failureMessage(cause, "Studio persistence failed."),
          operation: "encode",
        }),
    });

    if (json === undefined) {
      return yield* Effect.fail(
        StudioDecodeError.make({
          cause: new TypeError("Value cannot be encoded as JSON"),
          key,
          message: "Studio persistence failed.",
          operation: "encode",
        }),
      );
    }

    yield* objectStore.put(key, json, {
      httpMetadata: { contentType: "application/json" },
    });
  });

  return { put, read };
}
