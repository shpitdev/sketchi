import { describe, expect, it } from "vitest";

import {
  ARTIFACT_MIME_TYPES,
  createMemoryArtifactStore,
  createObjectBucketArtifactStore,
  jsonSizeBytes,
  type CodeModeObjectBucket,
  type CodeModeObjectBucketBody,
  type CodeModeObjectBucketObject,
  type StoredArtifactFormat,
} from "./code-mode-artifacts";

class MemoryBucket implements CodeModeObjectBucket {
  readonly objects = new Map<string, CodeModeObjectBucketBody>();

  async get(key: string): Promise<CodeModeObjectBucketObject | null> {
    const value = this.objects.get(key);
    if (value === undefined) {
      return null;
    }

    const bytes =
      typeof value === "string"
        ? new TextEncoder().encode(value)
        : new Uint8Array(value);

    return {
      size: bytes.byteLength,
      arrayBuffer: async () => bytes.slice().buffer,
      text: async () => new TextDecoder().decode(bytes),
    };
  }

  async put(key: string, value: CodeModeObjectBucketBody): Promise<unknown> {
    this.objects.set(key, value);
    return null;
  }
}

function storedFormats(): StoredArtifactFormat[] {
  const scene = { diagramId: "diagram-child", elements: [] };
  const excalidraw = { type: "excalidraw", version: 2, elements: [] };
  const png = new Uint8Array([137, 80, 78, 71]);

  return [
    {
      data: scene,
      format: "scene",
      mimeType: ARTIFACT_MIME_TYPES.scene,
      sizeBytes: jsonSizeBytes(scene),
    },
    {
      data: excalidraw,
      format: "excalidraw",
      mimeType: ARTIFACT_MIME_TYPES.excalidraw,
      sizeBytes: jsonSizeBytes(excalidraw),
    },
    {
      data: png,
      format: "png",
      mimeType: ARTIFACT_MIME_TYPES.png,
      sizeBytes: png.byteLength,
    },
  ];
}

describe("object bucket artifact storage", () => {
  it("round-trips source provenance in the manifest and returned bundle", async () => {
    const bucket = new MemoryBucket();
    const store = createObjectBucketArtifactStore(bucket, {
      prefix: "codemode",
    });
    const provenance = { sourceArtifactId: "artifact-parent" };

    const bundle = await store.write({
      artifactId: "artifact-child",
      diagramId: "diagram-child",
      formats: storedFormats(),
      inlineFormats: ["scene"],
      provenance,
    });

    expect(bundle.provenance).toEqual(provenance);
    await expect(store.readManifest("artifact-child")).resolves.toMatchObject({
      artifactId: "artifact-child",
      provenance,
      formats: [
        { format: "scene" },
        { format: "excalidraw" },
        { format: "png" },
      ],
    });
    await expect(store.read("artifact-child", "scene")).resolves.toMatchObject({
      format: "scene",
    });
    await expect(
      store.read("artifact-child", "excalidraw"),
    ).resolves.toMatchObject({ format: "excalidraw" });
    await expect(store.read("artifact-child", "png")).resolves.toMatchObject({
      format: "png",
      sizeBytes: 4,
    });
  });
});

describe("memory artifact storage", () => {
  it("isolates stored provenance from mutations to the returned bundle", async () => {
    const store = createMemoryArtifactStore();
    const bundle = await store.write({
      artifactId: "artifact-child",
      diagramId: "diagram-child",
      formats: storedFormats(),
      inlineFormats: ["scene"],
      provenance: { sourceArtifactId: "artifact-parent" },
    });

    if (!bundle.provenance) {
      throw new Error("Expected the returned bundle to include provenance.");
    }
    bundle.provenance.sourceArtifactId = "artifact-mutated";

    await expect(store.readManifest("artifact-child")).resolves.toMatchObject({
      provenance: { sourceArtifactId: "artifact-parent" },
    });
  });
});
