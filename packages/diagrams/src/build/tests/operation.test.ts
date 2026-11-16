import { Effect, Result } from "effect";
import { expect, it } from "@effect/vitest";
import { vi } from "vitest";
import { type ArtifactBuildCapabilities } from "../result";
import { buildResponse, defineBuild } from "../operation";
import { sankeyBuild } from "../../families/sankey/build";
import { sankeyFixture } from "../../families/sankey/document";
import { renderSankeyDiagram } from "../../families/sankey/render";
import { mindmapBuild } from "../../families/mindmap/build";
import { vennBuild } from "../../families/venn/build";
import { renderMindmap } from "../../families/mindmap/layout";

vi.mock("../../families/mindmap/layout", async (original) => {
	const actual = await original<typeof import("../../families/mindmap/layout")>();
	return { ...actual, renderMindmap: vi.fn(actual.renderMindmap) };
});
const input = {
	requestId: "request-1",
	spec: { title: "Launch", root: { label: "Launch", children: [{ label: "Documentation" }] } },
};
const artifact = { artifactId: "artifact-1", diagramId: "launch", formats: [] };

it.effect(
	"assesses only valid rendered scenes and carries the assessed quality through delivery",
	() =>
		Effect.gen(function* () {
			for (const mode of [
				"document",
				"threshold",
				"scene",
				"readability",
				"accepted",
				"delivery",
			] as const) {
				const calls: string[] = [];
				const assessedQuality = {
					accepted: mode !== "readability",
					score: 9,
					threshold: 0,
					summary: { nodeCount: 7, edgeCount: 9 },
					checks: [],
				};
				const operation = defineBuild({
					...sankeyBuild,
					warnings: (_document, _request, _scene, authored) => {
						calls.push("warnings");
						expect(authored).toBe(request.spec);
						return [];
					},
					assess: (_document, threshold) => ({
						...assessedQuality,
						accepted: mode !== "threshold",
						score: 10,
						threshold,
					}),
					render: (document) => {
						calls.push("render");
						const scene = renderSankeyDiagram(document);
						return mode === "scene"
							? {
									...scene,
									elements: scene.elements.map((element) =>
										"width" in element ? { ...element, width: -1 } : element,
									),
								}
							: scene;
					},
					assessScene: () => {
						calls.push("assess");
						return assessedQuality;
					},
				});
				const request = yield* operation.decode({
					spec:
						mode === "document"
							? { ...sankeyFixture, links: [...sankeyFixture.links, sankeyFixture.links[0]] }
							: sankeyFixture,
					options: { minQualityScore: 0 },
				});
				const result = yield* buildResponse(
					operation.build(request, {
						createId: () => "build-1",
						exportScene: () => {
							calls.push("export");
							return mode === "delivery"
								? Effect.fail({ status: "storage_failed", issues: [] })
								: Effect.succeed(artifact);
						},
					}),
				);
				expect(calls, mode).toEqual(
					mode === "document" || mode === "threshold"
						? []
						: mode === "scene"
							? ["render"]
							: mode === "readability"
								? ["render", "assess"]
								: mode === "accepted"
									? ["render", "assess", "export", "warnings"]
									: ["render", "assess", "export"],
				);
				expect(result.status, mode).toBe(
					(
						{
							document: "invalid_sankey",
							threshold: "quality_failed",
							scene: "render_failed",
							readability: "quality_failed",
							accepted: "accepted",
							delivery: "storage_failed",
						} as const
					)[mode],
				);
				if (mode === "readability" || mode === "accepted" || mode === "delivery")
					expect(result.quality).toEqual(assessedQuality);
			}
		}),
);

it.effect("retains a renderer exception until transport projection and never exports it", () =>
	Effect.gen(function* () {
		const cause = new Error("layout cannot place the document");
		vi.mocked(renderMindmap).mockImplementationOnce(() => {
			throw cause;
		});
		let exports = 0;
		const request = yield* mindmapBuild.decode(input);
		const result = yield* Effect.result(
			mindmapBuild.build(request, {
				createId: () => "build-1",
				exportScene: () => {
					exports++;
					return Effect.succeed(artifact);
				},
			}),
		);
		expect(Result.isFailure(result)).toBe(true);
		if (Result.isSuccess(result)) return expect.fail("Expected render failure");
		expect(result.failure.reason).toEqual({ _tag: "Render", cause });
		expect(result.failure.toResult()).toMatchObject({
			ok: false,
			status: "render_failed",
			buildId: "build-1",
			requestId: "request-1",
			issues: [{ code: "render_failed", message: cause.message }],
		});
		expect(exports).toBe(0);
	}),
);

it.effect("refuses an invalid rendered scene before native export or persistence", () =>
	Effect.gen(function* () {
		const request = yield* mindmapBuild.decode(input);
		const valid = renderMindmap({ ...request.spec, id: "launch", type: "mindmap" });
		vi.mocked(renderMindmap).mockReturnValueOnce({
			...valid,
			elements: valid.elements.map((element) =>
				"width" in element ? { ...element, width: -1 } : element,
			),
		});
		let exports = 0;
		const result = yield* buildResponse(
			mindmapBuild.build(request, {
				createId: () => "build-1",
				exportScene: () => {
					exports++;
					return Effect.succeed(artifact);
				},
			}),
		);
		expect(result).toMatchObject({
			ok: false,
			status: "render_failed",
			issues: expect.arrayContaining([
				expect.objectContaining({ code: "invalid_canvas_geometry" }),
			]),
		});
		expect(exports).toBe(0);
	}),
);

it.effect("keeps delivery failures and partial identity through both family workflows", () =>
	Effect.gen(function* () {
		for (const status of ["export_failed", "storage_failed"] as const) {
			const issues = [
				{
					code:
						status === "storage_failed"
							? ("storage_write_failed" as const)
							: ("export_invalid_scene" as const),
					severity: "error" as const,
					stage: status === "storage_failed" ? ("storage" as const) : ("export" as const),
					message: "Deliberate adapter failure",
					hint: "Retry delivery.",
				},
			];
			const capability: ArtifactBuildCapabilities<never> = {
				createId: () => "build-1",
				exportScene: () => Effect.fail({ status, issues, partial: { diagramId: "partial-1" } }),
			};
			const mindmap = yield* mindmapBuild.decode(input);
			const venn = yield* vennBuild.decode({
				requestId: "request-1",
				spec: {
					title: "Plans",
					sets: [
						{ id: "a", label: "Basic" },
						{ id: "b", label: "Pro" },
					],
				},
			});
			for (const result of [
				yield* buildResponse(mindmapBuild.build(mindmap, capability)),
				yield* buildResponse(vennBuild.build(venn, capability)),
			]) {
				expect(result).toMatchObject({
					ok: false,
					status,
					requestId: "request-1",
					buildId: "build-1",
					partial: { diagramId: "partial-1" },
					issues,
				});
			}
		}
	}),
);
