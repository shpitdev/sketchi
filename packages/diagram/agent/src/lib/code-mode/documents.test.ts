import { describe, expect, it } from "vitest";
import {
	DIAGRAM_TYPES,
	deployPipelineLogoFlowchart,
	mindmapFixture,
	parseFlowchartDiagram,
	sequenceFixture,
} from "@sketchi/diagram-core";

import {
	CANONICAL_DOCUMENT_SPECS,
	CANONICAL_DOCUMENT_TYPES,
	canonicalDocumentFromDiagram,
	isCanonicalDocumentType,
} from "./documents.js";

describe("canonical diagram documents", () => {
	it("registers one authoring spec per canonical family and nothing else", () => {
		expect(CANONICAL_DOCUMENT_TYPES).toEqual(DIAGRAM_TYPES);
		expect(Object.keys(CANONICAL_DOCUMENT_SPECS).sort()).toEqual([...DIAGRAM_TYPES].sort());
		expect(isCanonicalDocumentType("sequence")).toBe(true);
		expect(isCanonicalDocumentType("er")).toBe(false);
	});

	it("keeps flowchart logos and maps vertical and horizontal directions", () => {
		const document = canonicalDocumentFromDiagram(deployPipelineLogoFlowchart);
		expect(document.type).toBe("flowchart");
		if (document.type !== "flowchart") return;
		expect(document.spec.nodes.find((node) => node.id === "push")?.icon).toEqual({
			slug: "github",
		});
		const rightToLeft = canonicalDocumentFromDiagram(
			parseFlowchartDiagram({
				...deployPipelineLogoFlowchart,
				layout: { direction: "RL", edgeRouting: "orthogonal" },
			}),
		);
		expect(rightToLeft.type === "flowchart" && rightToLeft.spec.layout.direction).toBe("LR");
	});

	it("rebuilds the nested mindmap hierarchy in sibling order", () => {
		const document = canonicalDocumentFromDiagram(mindmapFixture);
		expect(document).toMatchObject({
			type: "mindmap",
			spec: {
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
			},
		});
	});

	it("carries sequence participants and ordered messages with their types", () => {
		const document = canonicalDocumentFromDiagram(sequenceFixture);
		expect(document.type).toBe("sequence");
		if (document.type !== "sequence") return;
		expect(document.spec.participants.map((participant) => participant.id)).toEqual([
			"customer",
			"store",
			"payments",
		]);
		expect(document.spec.messages.map((message) => [message.id, message.type])).toEqual([
			["checkout", undefined],
			["charge", undefined],
			["charged", "return"],
			["receipt", "return"],
		]);
	});
});
