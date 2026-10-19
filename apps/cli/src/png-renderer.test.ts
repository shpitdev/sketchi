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
	largeFlowchartInput,
	largeMindmapInput,
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

layer(Layer.mergeAll(builderLayer, CliPngRendererLive))("headless PNG renderer", (it) => {
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
				assert.deepStrictEqual([...first.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
				assert.isAbove(first.byteLength, 1_000);
				assertInkHasPadding(first);
			}
		}),
	);

	it.effect("exports a state machine whose transitions bind to a composite frame", () =>
		Effect.gen(function* () {
			const builder = yield* DiagramBuilder;
			const renderer = yield* CliPngRenderer;
			const built = yield* builder.build(
				canonicalDocument({
					type: "state-machine",
					spec: {
						title: "Media player",
						initial: "stopped",
						states: [
							{ id: "stopped", label: "Stopped" },
							{ id: "active", label: "Active", initial: "playing" },
							{ id: "playing", label: "Playing", parent: "active" },
							{ id: "paused", label: "Paused", parent: "active" },
						],
						transitions: [
							{ source: "stopped", target: "active", event: "play" },
							{ source: "playing", target: "paused", event: "pause" },
							{ source: "paused", target: "playing", event: "resume" },
							{ source: "active", target: "stopped", event: "stop" },
						],
					},
				}),
			);
			const frame = built.excalidraw.elements.find((element) => element["type"] === "frame")!;
			assert.lengthOf(frame["boundElements"] as unknown[], 2);
			const png = yield* renderer.renderPng({
				scene: built.scene,
				excalidraw: built.excalidraw,
			});
			assert.isAbove(png.byteLength, 1_000);
			assertInkHasPadding(png);
		}),
	);

	it.effect("exports an ER diagram whose tables move whole and whose lines keep their rows", () =>
		Effect.gen(function* () {
			const builder = yield* DiagramBuilder;
			const renderer = yield* CliPngRenderer;
			const built = yield* builder.build(
				canonicalDocument({
					type: "er",
					spec: {
						title: "Org chart",
						entities: [
							{
								id: "employees",
								fields: ["id int PK", "manager_id int? FK", "department_id int FK"],
							},
							{ id: "departments", fields: ["id int PK", "name text UK"] },
						],
						relationships: [
							{
								from: "employees.manager_id",
								to: "employees.id",
								fromCardinality: "zero-or-many",
								toCardinality: "zero-or-one",
							},
							{
								from: "employees.department_id",
								to: "departments.id",
								fromCardinality: "one-or-many",
								toCardinality: "one",
							},
						],
					},
				}),
			);
			const arrows = built.excalidraw.elements.filter((element) => element["type"] === "arrow");
			assert.lengthOf(arrows, 2);
			for (const arrow of arrows) assert.isTrue(arrow["elbowed"]);
			const png = yield* renderer.renderPng({ scene: built.scene, excalidraw: built.excalidraw });
			assert.isAbove(png.byteLength, 1_000);
			assertInkHasPadding(png);
		}),
	);

	it.effect("exports a class diagram whose lines bind elbowed with their UML heads", () =>
		Effect.gen(function* () {
			const builder = yield* DiagramBuilder;
			const renderer = yield* CliPngRenderer;
			const built = yield* builder.build(
				canonicalDocument({
					type: "class",
					spec: {
						title: "Shapes",
						classes: [
							{ id: "Shape", kind: "abstract", methods: ["+ area(): double {abstract}"] },
							{ id: "Circle", attributes: ["- radius: double"], methods: ["+ area(): double"] },
							{ id: "Canvas", methods: ["+ add(shape: Shape): void"] },
						],
						relationships: [
							{ kind: "inheritance", from: "Circle", to: "Shape" },
							{
								kind: "aggregation",
								from: "Canvas",
								to: "Shape",
								fromMultiplicity: "1",
								toMultiplicity: "0..*",
							},
						],
					},
				}),
			);
			const arrows = built.excalidraw.elements.filter((element) => element["type"] === "arrow");
			assert.lengthOf(arrows, 2);
			for (const arrow of arrows) assert.isTrue(arrow["elbowed"]);
			assert.sameMembers(
				arrows.map(
					(arrow) => `${String(arrow["startArrowhead"])}>${String(arrow["endArrowhead"])}`,
				),
				["null>triangle_outline", "diamond_outline>null"],
			);
			const png = yield* renderer.renderPng({ scene: built.scene, excalidraw: built.excalidraw });
			assert.isAbove(png.byteLength, 1_000);
			assertInkHasPadding(png);
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

	it.effect(
		"exports the preserved 20-node flowchart and 29-topic mindmap repros",
		() =>
			Effect.gen(function* () {
				const builder = yield* DiagramBuilder;
				const renderer = yield* CliPngRenderer;
				for (const input of [largeFlowchartInput, largeMindmapInput]) {
					const built = yield* builder.build(canonicalDocument(input));
					const png = yield* renderer.renderPng({
						scene: built.scene,
						excalidraw: built.excalidraw,
					});
					assert.isAbove(png.byteLength, 1_000);
					assertInkHasPadding(png);
				}
			}),
		60_000,
	);

	it.effect("paints group frames and their names without measuring text", () =>
		Effect.gen(function* () {
			const builder = yield* DiagramBuilder;
			const renderer = yield* CliPngRenderer;
			const built = yield* builder.build(canonicalDocument(flowchartInput));
			const first = built.excalidraw.elements.find((element) => element["type"] === "ellipse")!;
			const framed = (name: string) => ({
				...built.excalidraw,
				elements: [
					{
						...first,
						id: "group:team",
						type: "frame",
						name,
						x: Number(first["x"]) - 40,
						y: Number(first["y"]) - 40,
						width: Number(first["width"]) + 80,
						height: Number(first["height"]) + 80,
						boundElements: null,
						frameId: null,
						groupIds: [],
					},
					...built.excalidraw.elements.map((element) =>
						element["id"] === first["id"] ? { ...element, frameId: "group:team" } : element,
					),
				],
			});
			const named = yield* renderer.renderPng({ excalidraw: framed("Team") });
			const unnamed = yield* renderer.renderPng({ excalidraw: framed("") });
			assert.deepStrictEqual(named, yield* renderer.renderPng({ excalidraw: framed("Team") }));
			// The name is painted above the frame, so the export grows to hold it.
			assert.isAbove(inkBounds(named).height, inkBounds(unnamed).height);
			assertInkHasPadding(named);
			// A name of wide glyphs is measured, not estimated, so it is not cut off.
			assertInkHasPadding(yield* renderer.renderPng({ excalidraw: framed("W".repeat(50)) }));
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

	it.effect("renders detached artifacts without stale canonical title semantics", () =>
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
			assert.deepStrictEqual([...parsed.data.subarray(0, 4)], [255, 0, 0, 255]);
			assert.isBelow(parsed.height, PNG.sync.read(Buffer.from(canonical)).height);
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
					Reflect.get(Reflect.get(normalized, "appState"), "lockedMultiSelections"),
					{ fixtureGroup: true },
				);
			}
		}),
	);
});
