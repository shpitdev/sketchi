import {
  CodeModeArtifactStorageMemory,
  makeCodeModeRuntimeEnvironmentLayer,
} from "@sketchi/diagram-agent";
import { assert, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { PNG } from "pngjs";

import { DiagramBuilder, DiagramBuilderLive } from "./builder.js";
import { canonicalDocument } from "./__tests__/fixtures.js";
import { cliIconCatalog } from "./icon-catalog.js";
import { CliPngRenderer, CliPngRendererLive } from "./png-renderer.js";

const builderLayer = DiagramBuilderLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      CodeModeArtifactStorageMemory,
      makeCodeModeRuntimeEnvironmentLayer({
        createId: (prefix) => `${prefix}_png_logo_test`,
        icons: cliIconCatalog,
      }),
    ),
  ),
);

const logoFlowchart = {
  type: "flowchart",
  spec: {
    id: "deploy-logos",
    title: "Deploy pipeline",
    nodes: [
      {
        id: "push",
        label: "Push to GitHub",
        kind: "start",
        icon: { slug: "github" },
      },
      {
        id: "build",
        label: "Build the Docker image",
        kind: "process",
        icon: { slug: "docker" },
      },
      {
        id: "tests",
        label: "Tests pass?",
        kind: "decision",
        icon: { slug: "vitest" },
      },
      { id: "fix", label: "Fix the failing tests", kind: "process" },
      {
        id: "ship",
        label: "Ship to Cloudflare",
        kind: "end",
        icon: { slug: "cloudflare" },
      },
    ],
    edges: [
      { source: "push", target: "build" },
      { source: "build", target: "tests" },
      { source: "tests", target: "ship", label: "yes" },
      { source: "tests", target: "fix", label: "no" },
      { source: "fix", target: "build" },
    ],
  },
} as const;

/** Brand fills in the catalog SVGs; the Sketchi palette uses none of them. */
const BRAND_COLORS = {
  cloudflare: [0xf3, 0x80, 0x20],
  docker: [0x24, 0x96, 0xed],
  vitest: [0x72, 0x9b, 0x1b],
} as const;

function brandPixelCounts(bytes: Uint8Array) {
  const png = PNG.sync.read(Buffer.from(bytes));
  const counts = { cloudflare: 0, docker: 0, vitest: 0 };
  for (let offset = 0; offset < png.data.length; offset += 4) {
    for (const [slug, [red, green, blue]] of Object.entries(BRAND_COLORS)) {
      if (
        Math.abs((png.data[offset] ?? 0) - red) <= 12 &&
        Math.abs((png.data[offset + 1] ?? 0) - green) <= 12 &&
        Math.abs((png.data[offset + 2] ?? 0) - blue) <= 12
      ) {
        counts[slug as keyof typeof counts] += 1;
      }
    }
  }
  return counts;
}

layer(Layer.mergeAll(builderLayer, CliPngRendererLive))(
  "headless PNG node logos",
  (it) => {
    it.effect("rasterizes every node logo into the PNG", () =>
      Effect.gen(function* () {
        const builder = yield* DiagramBuilder;
        const renderer = yield* CliPngRenderer;
        const built = yield* builder.build(canonicalDocument(logoFlowchart));
        const images = built.excalidraw.elements.filter(
          (element) => element["type"] === "image",
        );
        assert.lengthOf(images, 4);
        assert.lengthOf(Object.keys(built.excalidraw.files), 4);

        const png = yield* renderer.renderPng({
          scene: built.scene,
          excalidraw: built.excalidraw,
        });
        const counts = brandPixelCounts(png);
        // Logos are 20-28px squares at 2x export scale. Thresholds are about
        // half of each mark's measured brand-color area (Docker 804, Cloudflare
        // 372, Vitest green 102), so a clipped or missing image fails.
        assert.isAbove(counts.docker, 400, "Docker mark painted");
        assert.isAbove(counts.cloudflare, 180, "Cloudflare mark painted");
        assert.isAbove(counts.vitest, 50, "Vitest mark painted");
      }),
    );

    it.effect("renders drawings whose image ids contain selector syntax", () =>
      Effect.gen(function* () {
        const builder = yield* DiagramBuilder;
        const renderer = yield* CliPngRenderer;
        const built = yield* builder.build(canonicalDocument(logoFlowchart));
        // Hand-edited and third-party drawings may use ids like node:a:icon.
        const elements = built.excalidraw.elements.map((element) =>
          element["type"] === "image"
            ? { ...element, id: String(element["id"]).replaceAll("-", ":") }
            : element,
        );

        const png = yield* renderer.renderPng({
          excalidraw: { ...built.excalidraw, elements },
        });
        assert.isAbove(brandPixelCounts(png).docker, 400);
      }),
    );

    it.effect("keeps image files when normalizing a shared drawing", () =>
      Effect.gen(function* () {
        const builder = yield* DiagramBuilder;
        const renderer = yield* CliPngRenderer;
        const built = yield* builder.build(canonicalDocument(logoFlowchart));
        const normalized = yield* renderer.normalizeExcalidraw(
          built.excalidraw,
        );

        assert.deepStrictEqual(
          Object.keys(
            Reflect.get(normalized as object, "files") as object,
          ).sort(),
          Object.keys(built.excalidraw.files).sort(),
        );
        const png = yield* renderer.renderPng({ excalidraw: normalized });
        assert.isAbove(brandPixelCounts(png).docker, 400);
      }),
    );
  },
);
