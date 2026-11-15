import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { mindmapBuild } from "./build.js";

/** Only the external artifact capability is replaced; the public family operation is real. */
function run(input: unknown) {
	let exports = 0;
	const result = Effect.runPromise(
		Effect.result(
			Effect.flatMap(mindmapBuild.decode(input), (request) =>
				mindmapBuild.build(request, {
					createId: () => "build-mindmap",
					exportScene: (scene) => {
						exports++;
						return Effect.succeed({
							artifactId: "artifact-mindmap",
							diagramId: scene.diagramId,
							formats: [],
						});
					},
				}),
			),
		),
	);
	return { result, exports: () => exports };
}

describe("mindmap build policy", () => {
	it("normalizes authored text and bounds a derived ID without changing child order", async () => {
		const title =
			"A detailed launch strategy with a deliberately long document title for export identity";
		const operation = run({
			spec: {
				title: `  ${title}  `,
				root: {
					label: "  Launch,kind: ",
					children: [{ label: " Product,source: " }, { label: " Documentation " }],
				},
			},
		});
		const result = await operation.result;
		expect(Result.isSuccess(result)).toBe(true);
		if (Result.isFailure(result)) return expect.fail("Expected an accepted mindmap");
		expect(result.success.normalizedSpec).toMatchObject({
			id: "a-detailed-launch-strategy-with-a-deliberately-l",
			title,
			root: { label: "Launch", children: [{ label: "Product" }, { label: "Documentation" }] },
		});
		expect(operation.exports()).toBe(1);
	});

	const deep: { label: string; children?: unknown[] } = { label: "Root" };
	let current = deep;
	for (let depth = 0; depth < 2000; depth++) {
		const child = { label: `Level ${depth}` };
		current.children = [child];
		current = child;
	}
	it.each([
		["a root with no children", { label: "Root" }, "disconnected_graph"],
		["an extreme depth before recursive decoding", deep, "mindmap_too_deep"],
		[
			"too many authored topics",
			{ label: "Root", children: Array.from({ length: 201 }, (_, i) => ({ label: `Topic ${i}` })) },
			"mindmap_too_large",
		],
		[
			"malformed child slots without amplifying the response",
			{ label: "Root", children: Array.from({ length: 100000 }, () => null) },
			"mindmap_too_large",
		],
	] as const)("rejects %s without exporting", async (_name, root, code) => {
		const operation = run({ spec: { title: "Policy", root } });
		const result = await operation.result;
		expect(Result.isFailure(result)).toBe(true);
		if (Result.isSuccess(result)) throw new Error("Expected rejected mindmap");
		expect(result.failure.toResult()).toMatchObject({
			status: "invalid_mindmap",
			issues: [{ code, stage: "mindmap" }],
		});
		expect(JSON.stringify(result.failure).length).toBeLessThan(2000);
		expect(operation.exports()).toBe(0);
	});

	it.each([
		[{ title: "  ", root: { label: "Root", children: [{ label: "Child" }] } }, "spec.title"],
		[
			{ title: "Valid", root: { label: "Root", children: [{ label: "''" }] } },
			"spec.root.children.0.label",
		],
		[
			{ title: "Valid", root: { label: "Root", children: [{ label: " , title:" }] } },
			"spec.root.children.0.label",
		],
	] as const)("reports the actual location of invalid semantic text", async (spec, path) => {
		const operation = run({ spec });
		const result = await operation.result;
		expect(Result.isFailure(result)).toBe(true);
		if (Result.isSuccess(result)) throw new Error("Expected invalid input");
		expect(result.failure.toResult()).toMatchObject({
			status: "invalid_input",
			issues: [{ stage: "input", ref: { path } }],
		});
		expect(operation.exports()).toBe(0);
	});

	it("rejects a map of generic labels at the requested readability threshold", async () => {
		const operation = run({
			spec: { title: "Readability", root: { label: "Mindmap", children: [{ label: "Topic" }] } },
			options: { minQualityScore: 8 },
		});
		const result = await operation.result;
		expect(Result.isFailure(result)).toBe(true);
		if (Result.isSuccess(result)) throw new Error("Expected quality rejection");
		expect(result.failure.toResult()).toMatchObject({
			status: "quality_failed",
			quality: { score: 6, threshold: 8 },
			issues: [{ code: "generic_label" }, { code: "generic_label" }],
		});
		expect(operation.exports()).toBe(0);
	});
});
