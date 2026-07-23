import {
  CodeModeArtifactStorageMemory,
  makeCodeModeRuntimeEnvironmentLayer,
} from "@sketchi/diagram-agent";
import { assert, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { PNG } from "pngjs";

import { DiagramBuilder, DiagramBuilderLive } from "./builder.js";
import {
  canonicalDocument,
  flowchartInput,
  mindmapInput,
} from "./__tests__/fixtures.js";
import { CliPngRenderer, CliPngRendererLive } from "./png-renderer.js";

const builderLayer = DiagramBuilderLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      CodeModeArtifactStorageMemory,
      makeCodeModeRuntimeEnvironmentLayer({
        createId: (prefix) => `${prefix}_png_renderer_test`,
      }),
    ),
  ),
);

function inkBounds(bytes: Uint8Array) {
  const png = PNG.sync.read(Buffer.from(bytes));
  const background = [...png.data.subarray(0, 4)];
  let minX = png.width;
  let minY = png.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const offset = (y * png.width + x) * 4;
      if (
        png.data[offset] === background[0] &&
        png.data[offset + 1] === background[1] &&
        png.data[offset + 2] === background[2] &&
        png.data[offset + 3] === background[3]
      ) {
        continue;
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  assert.isAtLeast(maxX, 0, "PNG must contain visible ink");
  return { width: png.width, height: png.height, minX, minY, maxX, maxY };
}

function assertInkHasPadding(bytes: Uint8Array): void {
  const bounds = inkBounds(bytes);
  const minimumPadding = 16;
  assert.isAtLeast(bounds.minX, minimumPadding);
  assert.isAtLeast(bounds.minY, minimumPadding);
  assert.isAtMost(bounds.maxX, bounds.width - minimumPadding - 1);
  assert.isAtMost(bounds.maxY, bounds.height - minimumPadding - 1);
}

layer(Layer.mergeAll(builderLayer, CliPngRendererLive))(
  "headless PNG renderer",
  (it) => {
    it.effect("renders flowchart and mindmap artifacts deterministically", () =>
      Effect.gen(function* () {
        const builder = yield* DiagramBuilder;
        const renderer = yield* CliPngRenderer;
        for (const input of [flowchartInput, mindmapInput]) {
          const built = yield* builder.build(canonicalDocument(input));
          const first = yield* renderer.renderPng({
            scene: built.scene,
            excalidraw: built.excalidraw,
          });
          const second = yield* renderer.renderPng({
            scene: built.scene,
            excalidraw: built.excalidraw,
          });

          assert.deepStrictEqual(first, second);
          assert.deepStrictEqual(
            [...first.slice(0, 8)],
            [137, 80, 78, 71, 13, 10, 26, 10],
          );
          assert.isAbove(first.byteLength, 1_000);
          assertInkHasPadding(first);
        }
      }),
    );

    it.effect("grows the canvas for a wide title without clipping ink", () =>
      Effect.gen(function* () {
        const builder = yield* DiagramBuilder;
        const renderer = yield* CliPngRenderer;
        const built = yield* builder.build(canonicalDocument(flowchartInput));
        const normal = yield* renderer.renderPng({
          scene: built.scene,
          excalidraw: built.excalidraw,
        });
        const wide = yield* renderer.renderPng({
          scene: { ...built.scene, title: "W".repeat(40) },
          excalidraw: built.excalidraw,
        });

        assertInkHasPadding(wide);
        assert.isAbove(inkBounds(wide).width, inkBounds(normal).width);
      }),
    );

    it.effect("fails instead of silently dropping unsupported glyphs", () =>
      Effect.gen(function* () {
        const builder = yield* DiagramBuilder;
        const renderer = yield* CliPngRenderer;
        const built = yield* builder.build(canonicalDocument(flowchartInput));
        const error = yield* Effect.flip(
          renderer.renderPng({
            scene: { ...built.scene, title: "Release 审查" },
            excalidraw: built.excalidraw,
          }),
        );
        assert.strictEqual(error._tag, "HeadlessPngRenderError");
        if (error._tag === "HeadlessPngRenderError") {
          assert.match(String(error.cause), /U\+5BA1/u);
        }
      }),
    );

    it.effect(
      "renders detached artifacts without stale canonical title semantics",
      () =>
        Effect.gen(function* () {
          const builder = yield* DiagramBuilder;
          const renderer = yield* CliPngRenderer;
          const built = yield* builder.build(canonicalDocument(flowchartInput));
          const detachedArtifact = {
            ...built.excalidraw,
            appState: {
              ...built.excalidraw.appState,
              viewBackgroundColor: "#ff0000",
            },
          };
          const canonical = yield* renderer.renderPng({
            scene: built.scene,
            excalidraw: detachedArtifact,
          });
          const detached = yield* renderer.renderPng({
            excalidraw: detachedArtifact,
          });
          const parsed = PNG.sync.read(Buffer.from(detached));
          assert.deepStrictEqual(
            [...parsed.data.subarray(0, 4)],
            [255, 0, 0, 255],
          );
          assert.isBelow(
            parsed.height,
            PNG.sync.read(Buffer.from(canonical)).height,
          );
        }),
    );

    it.effect("restores database share payloads before normalization", () =>
      Effect.gen(function* () {
        const builder = yield* DiagramBuilder;
        const renderer = yield* CliPngRenderer;
        const built = yield* builder.build(canonicalDocument(flowchartInput));
        const normalized = yield* renderer.normalizeExcalidraw({
          type: built.excalidraw.type,
          version: built.excalidraw.version,
          source: built.excalidraw.source,
          elements: built.excalidraw.elements,
          appState: {
            ...built.excalidraw.appState,
            lockedMultiSelections: { fixtureGroup: true },
          },
        });
        assert.equal(typeof normalized, "object");
        assert.isNotNull(normalized);
        if (typeof normalized === "object" && normalized !== null) {
          assert.deepStrictEqual(Reflect.get(normalized, "files"), {});
          assert.deepStrictEqual(
            Reflect.get(
              Reflect.get(normalized, "appState"),
              "lockedMultiSelections",
            ),
            { fixtureGroup: true },
          );
        }
      }),
    );
  },
);
