import { z } from "zod";

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

export interface StudioObjectBucket {
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

export class MemoryStudioObjectBucket implements StudioObjectBucket {
  readonly objects = new Map<string, string | Uint8Array>();

  async get(key: string): Promise<StudioObjectBucketObject | null> {
    const value = this.objects.get(key);
    if (!value) {
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

export async function readStudioJson<T>(
  bucket: StudioObjectBucket,
  key: string,
  schema: z.ZodType<T>,
): Promise<T | null> {
  const object = await bucket.get(key);
  if (!object) {
    return null;
  }

  const parsed = schema.safeParse(JSON.parse(await object.text()));
  return parsed.success ? parsed.data : null;
}

export async function putStudioJson(
  bucket: StudioObjectBucket,
  key: string,
  value: unknown,
): Promise<void> {
  await bucket.put(key, JSON.stringify(value), {
    httpMetadata: { contentType: "application/json" },
  });
}
