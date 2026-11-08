import {
	CodeModeArtifactStorageMemory,
	CodeModeIconLoadError,
	makeCodeModeIconCatalog,
	makeCodeModeRuntimeEnvironmentLayer,
} from "@sketchi/diagram-agent";
import { iconManifest } from "@sketchi/icon-catalog/catalog";
import nodeLogoSvgs from "@sketchi/icon-catalog/node-logo-svgs";
import { assert, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { PNG } from "pngjs";

import { DiagramBuilder, DiagramBuilderLive } from "./builder.js";
import { canonicalDocument } from "./__tests__/fixtures.js";
import { CliPngRenderer, CliPngRendererLive } from "./png-renderer.js";

/** A hand-drawn Docker: a whale-blue hull, in a color no scene uses, and an ink deck. */
const DOCKER_RECIPE = {
	parts: [
		{
			kind: "stroke",
			smooth: true,
			closed: true,
			fill: "#0db7ed",
			points: [
				[2, 12],
				[22, 12],
				[19, 19],
				[6, 19],
			],
		},
		{ kind: "rect", x: 6, y: 6, width: 4, height: 4, fill: "ink" },
		{ kind: "rect", x: 11, y: 6, width: 4, height: 4, fill: "ink" },
	],
};

const catalog = makeCodeModeIconCatalog({
	icons: iconManifest.icons,
	loadSvg: (icon) => {
		const svg = Object.hasOwn(nodeLogoSvgs, icon.slug) ? nodeLogoSvgs[icon.slug] : undefined;
		return svg === undefined
			? Effect.fail(
					CodeModeIconLoadError.make({
						cause: new Error("missing"),
						message: `Missing ${icon.slug}.`,
						slug: icon.slug,
					}),
				)
			: Effect.succeed(svg);
	},
	recipes: { docker: DOCKER_RECIPE },
	slugLookup: "https://icons.sketchi.app",
});

const builderLayer = DiagramBuilderLive.pipe(
	Layer.provide(
		Layer.mergeAll(
			CodeModeArtifactStorageMemory,
			makeCodeModeRuntimeEnvironmentLayer({
				createId: (prefix) => `${prefix}_native_icon_test`,
				icons: catalog,
			}),
		),
	),
);

const flowchart = {
	type: "flowchart",
	spec: {
		id: "native-logos",
		title: "Native logos",
		nodes: {
			push: { label: "Push to GitHub", icon: "github" },
			build: { label: "Build the Docker image", icon: "docker" },
			ship: "Ship it",
		},
		edges: [
			["push", "build"],
			["build", "ship"],
		],
	},
} as const;

function pixelsNear(bytes: Uint8Array, [red, green, blue]: readonly [number, number, number]) {
	const png = PNG.sync.read(Buffer.from(bytes));
	let count = 0;
	for (let offset = 0; offset < png.data.length; offset += 4) {
		if (
			Math.abs((png.data[offset] ?? 0) - red) <= 12 &&
			Math.abs((png.data[offset + 1] ?? 0) - green) <= 12 &&
			Math.abs((png.data[offset + 2] ?? 0) - blue) <= 12
		)
			count += 1;
	}
	return count;
}

layer(Layer.mergeAll(builderLayer, CliPngRendererLive))("headless PNG hand-drawn icons", (it) => {
	it.effect("draws a recipe logo as native parts and paints it, beside an exact SVG logo", () =>
		Effect.gen(function* () {
			const builder = yield* DiagramBuilder;
			const renderer = yield* CliPngRenderer;
			const built = yield* builder.build(canonicalDocument(flowchart));
			const elements = built.excalidraw.elements;
			const parts = elements.filter((element) =>
				String(element["id"]).startsWith("node-build-icon-"),
			);
			const images = elements.filter((element) => element["type"] === "image");

			assert.deepStrictEqual(
				parts.map((part) => part["type"]),
				["line", "rectangle", "rectangle"],
			);
			// GitHub has no recipe here, so it stays the embedded SVG.
			assert.deepStrictEqual(
				images.map((image) => image["id"]),
				["node-push-icon"],
			);
			assert.lengthOf(Object.keys(built.excalidraw.files), 1);

			const png = yield* renderer.renderPng({ scene: built.scene, excalidraw: built.excalidraw });
			assert.isAbove(pixelsNear(png, [0x0d, 0xb7, 0xed]), 60, "Docker recipe hull painted");

			// Excalidraw's own restore keeps every part, in one group inside the node's.
			const { restoreElements } = yield* Effect.promise(() => import("@excalidraw/excalidraw"));
			const restored = restoreElements(parts as never, null);
			assert.lengthOf(restored, parts.length);
			for (const part of restored) {
				assert.deepStrictEqual([...part.groupIds], ["node-build-icon", "node:build:logo"]);
			}
		}),
	);
});
