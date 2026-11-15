// Positive fixtures deliberately unwrap Results: failure here is invalid test/story data, not user input.
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import { mindmapDiagramFromTree, mindmapFixture, parseMindmapDiagram } from "./mindmap";

describe("Mindmap diagram type", () => {
	it("rejects topics with multiple parents", () => {
		expect(
			parseMindmapDiagram({
				...mindmapFixture,
				edges: [
					...mindmapFixture.edges,
					{
						id: "duplicate-parent",
						source: "topic-0-1",
						target: "topic-0-0-0",
						metadata: { depth: 2, siblingIndex: 0 },
					},
				],
			}),
		).toMatchObject({ failure: { message: expect.stringMatching(/exactly one parent/) } });
	});

	it("rejects inconsistent child ordering metadata", () => {
		expect(
			parseMindmapDiagram({
				...mindmapFixture,
				nodes: mindmapFixture.nodes.map((node) =>
					node.id === "topic-0-1"
						? { ...node, metadata: { ...node.metadata, siblingIndex: 4 } }
						: node,
				),
			}),
		).toMatchObject({
			failure: {
				message: expect.stringMatching(/metadata must match|contiguous sibling ordering/),
			},
		});
	});

	it("builds the canonical map of a nested topic tree", () => {
		expect(
			mindmapDiagramFromTree({
				id: mindmapFixture.id,
				title: mindmapFixture.title,
				root: {
					label: "Public mindmaps",
					children: [
						{
							label: "Semantic input",
							children: [{ label: "Nested topics" }, { label: "Stable ordering" }],
						},
						{ label: "Artifact output", children: [{ label: "Scene" }, { label: "Excalidraw" }] },
					],
				},
			}).pipe(Result.getOrThrow),
		).toEqual(mindmapFixture);
	});
});
