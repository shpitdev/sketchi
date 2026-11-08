import { Result } from "effect";
import { describe, expect, it } from "vitest";
import {
	DIAGRAM_TYPES,
	decodeFlowchartDocument,
	deployPipelineLogoFlowchart,
	flowchartDiagramFromDocument,
	mindmapFixture,
	parseFlowchartDiagram,
	sequenceFixture,
} from "@sketchi/diagram-core";

import {
	CANONICAL_DOCUMENT_SPECS,
	CANONICAL_DOCUMENT_TYPES,
	canonicalDocumentFromDiagram,
	flowchartDocumentIds,
	isCanonicalDocumentType,
} from "./documents.js";

describe("canonical diagram documents", () => {
	it("registers one authoring spec per canonical family and nothing else", () => {
		expect(CANONICAL_DOCUMENT_TYPES).toEqual(DIAGRAM_TYPES);
		expect(Object.keys(CANONICAL_DOCUMENT_SPECS).sort()).toEqual([...DIAGRAM_TYPES].sort());
		expect(isCanonicalDocumentType("sequence")).toBe(true);
		expect(isCanonicalDocumentType("er")).toBe(true);
		expect(isCanonicalDocumentType("swimlane")).toBe(false);
	});

	it("keeps flowchart logos and maps vertical and horizontal directions", () => {
		const document = canonicalDocumentFromDiagram(deployPipelineLogoFlowchart);
		expect(document.type).toBe("flowchart");
		if (document.type !== "flowchart") return;
		expect(document.spec.nodes["push"]).toMatchObject({ icon: "github" });
		expect(document.spec.logos).toBe(true);
		const rightToLeft = canonicalDocumentFromDiagram(
			parseFlowchartDiagram({
				...deployPipelineLogoFlowchart,
				layout: { direction: "RL", edgeRouting: "orthogonal" },
			}),
		);
		expect(rightToLeft.type === "flowchart" && rightToLeft.spec.direction).toBe("LR");
	});

	it("keys a generated flowchart's free-form ids as document ids", () => {
		const generated = parseFlowchartDiagram({
			id: "hiring",
			title: "Hiring",
			type: "flowchart",
			layout: { direction: "TB", edgeRouting: "orthogonal" },
			nodes: [
				{ id: "post", label: "Post the role", kind: "start", lane: "Hiring manager" },
				{ id: "apply", label: "Apply", kind: "process", lane: "Candidate" },
				{ id: "Hiring manager", label: "Review", kind: "end", lane: "Hiring manager" },
			],
			edges: [
				{ id: "e1", source: "post", target: "apply" },
				{ id: "e2", source: "apply", target: "Hiring manager" },
			],
			lanes: [
				{ id: "Hiring manager", label: "Hiring manager" },
				{ id: "Candidate", label: "Candidate" },
			],
		});

		const ids = flowchartDocumentIds(generated);
		expect(Object.fromEntries(ids.nodes)).toEqual({
			post: "post",
			apply: "apply",
			"Hiring manager": "hiring-manager",
		});
		expect(Object.fromEntries(ids.lanes)).toEqual({
			"Hiring manager": "hiring-manager-2",
			Candidate: "Candidate",
		});
		const document = canonicalDocumentFromDiagram(generated);
		if (document.type !== "flowchart") throw new Error("Expected a flowchart document.");
		expect(document.spec.edges).toEqual([
			["post", "apply"],
			["apply", "hiring-manager"],
		]);
		expect(document.spec.lanes).toEqual({
			"hiring-manager-2": { label: "Hiring manager", contains: ["post", "hiring-manager"] },
			Candidate: { label: "Candidate", contains: ["apply"] },
		});
		const decoded = decodeFlowchartDocument(document.spec);
		if (!Result.isSuccess(decoded)) throw new Error("Expected a valid flowchart document.");
		expect(flowchartDiagramFromDocument(decoded.success).ok).toBe(true);
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
