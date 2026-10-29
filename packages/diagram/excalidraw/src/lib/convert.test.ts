import { describe, expect, it } from "vitest";

import { generateKeyBetween } from "fractional-indexing";

import {
	apiRequestSequence,
	flowchartFixture,
	mindmapFixture,
	pharmaBatchDispositionFlowchart,
	parseChartDiagram,
	parseFlowchartDiagram,
	parseSequenceDiagram,
	selfMessageSequence,
	sequenceFixture,
	type CanvasSpec,
	getCanvasValidationIssues,
	groupFixtures,
	zoneFixtures,
} from "@sketchi/diagram-core";
import {
	renderChartDiagram,
	renderIntermediateDiagram,
	renderMindmapDiagram,
	renderSequenceDiagram,
} from "@sketchi/diagram-renderer";

import {
	convertSceneToExcalidraw,
	createExcalidrawFile,
	type ExcalidrawElement,
	validateExcalidrawScene,
} from "./convert";

describe("authored node geometry", () => {
	it("exports a sequence with a three-line participant label without growing shapes", () => {
		const scene = renderSequenceDiagram({
			type: "sequence",
			id: "multiline-sequence",
			title: "Multiline sequence",
			participants: [
				{ id: "a", label: "one\ntwo\nthree" },
				{ id: "b", label: "B" },
			],
			messages: [{ id: "ab", source: "a", target: "b", label: "Continue" }],
			style: { accentColor: "#111827", backgroundColor: "#ffffff" },
		});
		const converted = convertSceneToExcalidraw(scene);
		expect(validateExcalidrawScene(converted)).toEqual({
			ok: true,
			issues: [],
		});
		expect(converted.elements.find(({ id }) => id === "node:a")).toMatchObject({
			height: 75,
		});
		for (const element of scene.elements) {
			if (element.type === "node") {
				expect(converted.elements.find(({ id }) => id === element.id)).toMatchObject({
					x: element.x,
					y: element.y,
					width: element.width,
					height: element.height,
				});
			}
		}
	});

	it("keeps a tall label from moving a bottom-edge arrow off its 200x30 node", () => {
		const scene: CanvasSpec = {
			kind: "canvas",
			version: 1,
			diagramId: "tall-label",
			title: "Tall label",
			width: 400,
			height: 400,
			accentColor: "#111827",
			backgroundColor: "#ffffff",
			layers: [],
			layouts: [],
			zOrder: ["a", "b", "ab"],
			elements: [
				{
					type: "node",
					id: "a",
					nodeId: "a",
					shape: "rectangle",
					x: 20,
					y: 20,
					width: 200,
					height: 30,
					label: "line one\nline two\nline three",
				},
				{
					type: "node",
					id: "b",
					nodeId: "b",
					shape: "rectangle",
					x: 20,
					y: 200,
					width: 200,
					height: 60,
					label: "B",
				},
				{
					type: "arrow",
					id: "ab",
					edgeId: "ab",
					sourceNodeId: "a",
					targetNodeId: "b",
					points: [
						{ x: 120, y: 50 },
						{ x: 120, y: 200 },
					],
				},
			],
		};
		const converted = convertSceneToExcalidraw(scene);
		expect(converted.elements.find(({ id }) => id === "a")).toMatchObject({
			x: 20,
			y: 20,
			width: 200,
			height: 30,
		});
		expect(firstGlobalPoint(converted.elements.find(({ id }) => id === "ab"))).toEqual({
			x: 120,
			y: 50,
		});
		expect(validateExcalidrawScene(converted).issues.map(({ code }) => code)).not.toContain(
			"arrow-endpoint-off-shape",
		);
		expect(getCanvasValidationIssues(scene)).toContainEqual(
			expect.objectContaining({
				code: "label_overflow",
				path: "elements[0].label",
			}),
		);
	});
});

function bindingFixedPoint(
	element: ExcalidrawElement | undefined,
	key: "startBinding" | "endBinding",
): [number, number] {
	const binding = element?.[key] as { fixedPoint?: unknown } | undefined;

	if (
		!Array.isArray(binding?.fixedPoint) ||
		binding.fixedPoint.length < 2 ||
		typeof binding.fixedPoint[0] !== "number" ||
		typeof binding.fixedPoint[1] !== "number"
	) {
		throw new Error(`Expected ${key} fixedPoint.`);
	}

	return [binding.fixedPoint[0], binding.fixedPoint[1]];
}

function bindingGap(
	element: ExcalidrawElement | undefined,
	key: "startBinding" | "endBinding",
): number {
	const binding = element?.[key] as { gap?: unknown } | undefined;

	if (typeof binding?.gap !== "number") {
		throw new Error(`Expected ${key} gap.`);
	}

	return binding.gap;
}

function globalPointFromFixedPoint(
	shape: ExcalidrawElement | undefined,
	fixedPoint: readonly [number, number],
) {
	if (
		!shape ||
		typeof shape.x !== "number" ||
		typeof shape.y !== "number" ||
		typeof shape.width !== "number" ||
		typeof shape.height !== "number"
	) {
		throw new Error("Expected numeric shape bounds.");
	}

	return {
		x: shape.x + shape.width * fixedPoint[0],
		y: shape.y + shape.height * fixedPoint[1],
	};
}

function firstGlobalPoint(element: ExcalidrawElement | undefined) {
	const points = element?.points;

	if (
		!Array.isArray(points) ||
		!Array.isArray(points[0]) ||
		typeof points[0][0] !== "number" ||
		typeof points[0][1] !== "number" ||
		typeof element?.x !== "number" ||
		typeof element.y !== "number"
	) {
		throw new Error("Expected a numeric arrow start point.");
	}

	return {
		x: element.x + points[0][0],
		y: element.y + points[0][1],
	};
}

function expectClosePoint(actual: { x: number; y: number }, expected: { x: number; y: number }) {
	expect(Math.abs(actual.x - expected.x)).toBeLessThan(0.05);
	expect(Math.abs(actual.y - expected.y)).toBeLessThan(0.05);
}

function expectValidOrderKeys(elements: readonly ExcalidrawElement[]) {
	let previous: string | null = null;

	for (const element of elements) {
		const index = element.index;

		expect(typeof index).toBe("string");
		if (typeof index !== "string") {
			throw new Error(`Expected ${element.id} to have a string order key.`);
		}

		expect(() => generateKeyBetween(previous, index)).not.toThrow();
		if (previous !== null) {
			expect(previous < index).toBe(true);
		}
		previous = index;
	}

	expect(() => generateKeyBetween(previous, null)).not.toThrow();
}

function expectFlowchartExportValid(input: Parameters<typeof parseFlowchartDiagram>[0]) {
	const scene = convertSceneToExcalidraw(renderIntermediateDiagram(parseFlowchartDiagram(input)));

	expect(validateExcalidrawScene(scene)).toEqual({ ok: true, issues: [] });
}

describe("convertSceneToExcalidraw", () => {
	it("renders a node label when no explicit bound text is present", () => {
		const scene: CanvasSpec = {
			kind: "canvas",
			version: 1,
			diagramId: "automatic-label",
			title: "Automatic label",
			width: 320,
			height: 200,
			accentColor: "#2563eb",
			backgroundColor: "#ffffff",
			layers: [],
			layouts: [],
			elements: [
				{
					type: "node",
					id: "service",
					nodeId: "service",
					shape: "rectangle",
					x: 40,
					y: 60,
					width: 180,
					height: 80,
					label: "API service",
				},
			],
			zOrder: ["service"],
		};

		const converted = convertSceneToExcalidraw(scene);
		const label = converted.elements.find(
			(element) => element.id === "__sketchi_node_label__service",
		);

		expect(label).toMatchObject({
			type: "text",
			text: "API service",
			containerId: "service",
		});
		expect(converted.elements.map((element) => element.type)).toEqual(["rectangle", "text"]);
		expect(validateExcalidrawScene(converted)).toEqual({
			ok: true,
			issues: [],
		});
	});

	it("converts CanvasSpec polygons, frames, standalone text, bound lines, and z-order", () => {
		const canvas: CanvasSpec = {
			kind: "canvas",
			version: 1,
			diagramId: "converter-canvas",
			title: "Converter canvas",
			width: 600,
			height: 400,
			accentColor: "#111827",
			backgroundColor: "#ffffff",
			layers: [{ id: "content" }],
			layouts: [],
			elements: [
				{
					type: "frame",
					id: "frame",
					name: "Group",
					x: 20,
					y: 20,
					width: 500,
					height: 300,
				},
				{
					type: "node",
					id: "polygon",
					nodeId: "polygon-node",
					shape: "polygon",
					points: [
						{ x: 0, y: 50 },
						{ x: 50, y: 0 },
						{ x: 100, y: 50 },
						{ x: 50, y: 100 },
					],
					x: 80,
					y: 100,
					width: 100,
					height: 100,
					label: "Polygon",
					frameId: "frame",
					groupIds: ["group"],
				},
				{
					type: "line",
					id: "bound-line",
					points: [
						{ x: 180, y: 150 },
						{ x: 520, y: 150 },
					],
					startBinding: { elementId: "polygon" },
					endBinding: { elementId: "frame" },
					endArrowhead: "triangle",
					strokeStyle: "dotted",
				},
				{
					type: "text",
					id: "note",
					text: "Standalone",
					x: 280,
					y: 260,
					fontSize: 22,
					fontFamily: "mono",
					textAlign: "left",
					opacity: 80,
				},
			],
			zOrder: ["frame", "polygon", "bound-line", "note"],
		};

		const exported = convertSceneToExcalidraw(canvas);

		expect(exported.elements.map((element) => element.id)).toEqual([
			"frame",
			"polygon",
			"__sketchi_node_label__polygon",
			"bound-line",
			"note",
		]);
		expect(exported.elements.find((element) => element.id === "polygon")).toMatchObject({
			type: "line",
			frameId: "frame",
			groupIds: ["group"],
			customData: { sketchiShape: "polygon" },
		});
		expect(exported.elements.find((element) => element.id === "bound-line")).toMatchObject({
			type: "arrow",
			endArrowhead: "triangle",
			strokeStyle: "dotted",
			startBinding: { elementId: "polygon" },
			endBinding: { elementId: "frame" },
		});
		expect(exported.elements.find((element) => element.id === "note")).toMatchObject({
			type: "text",
			containerId: null,
			fontFamily: 3,
			textAlign: "left",
			opacity: 80,
		});
		expect(validateExcalidrawScene(exported)).toEqual({ ok: true, issues: [] });
	});

	it("preserves standalone arrows and bound polylines as valid exports", () => {
		const canvas: CanvasSpec = {
			kind: "canvas",
			version: 1,
			diagramId: "line-arrows",
			title: "Line arrows",
			width: 480,
			height: 300,
			accentColor: "#111827",
			backgroundColor: "#ffffff",
			layers: [],
			layouts: [],
			elements: [
				{
					type: "node",
					id: "left",
					nodeId: "left",
					shape: "rectangle",
					x: 20,
					y: 40,
					width: 100,
					height: 80,
					label: "Left",
				},
				{
					type: "node",
					id: "right",
					nodeId: "right",
					shape: "rectangle",
					x: 340,
					y: 40,
					width: 100,
					height: 80,
					label: "Right",
				},
				{
					type: "line",
					id: "standalone",
					points: [
						{ x: 40, y: 220 },
						{ x: 200, y: 220 },
					],
					endArrowhead: "arrow",
				},
				{
					type: "line",
					id: "partially-bound",
					points: [
						{ x: 120, y: 100 },
						{ x: 240, y: 160 },
					],
					startBinding: { elementId: "left" },
					endArrowhead: "triangle",
				},
				{
					type: "line",
					id: "bound-polyline",
					points: [
						{ x: 120, y: 80 },
						{ x: 230, y: 80 },
						{ x: 230, y: 100 },
						{ x: 340, y: 100 },
					],
					startBinding: { elementId: "left" },
					endBinding: { elementId: "right" },
					endArrowhead: "arrow",
				},
			],
			zOrder: ["left", "right", "standalone", "partially-bound", "bound-polyline"],
		};

		const exported = convertSceneToExcalidraw(canvas);

		expect(exported.elements.find((element) => element.id === "standalone")).toMatchObject({
			type: "arrow",
			startBinding: null,
			endBinding: null,
		});
		expect(exported.elements.find((element) => element.id === "partially-bound")).toMatchObject({
			type: "arrow",
			startBinding: { elementId: "left" },
			endBinding: null,
		});
		expect(exported.elements.find((element) => element.id === "bound-polyline")).toMatchObject({
			type: "arrow",
			elbowed: true,
			fixedSegments: [],
			roundness: null,
		});
		expect(validateExcalidrawScene(exported)).toEqual({ ok: true, issues: [] });
	});

	it("omits hidden layers and locks every exported element on locked layers", () => {
		const canvas: CanvasSpec = {
			kind: "canvas",
			version: 1,
			diagramId: "layer-semantics",
			title: "Layer semantics",
			width: 480,
			height: 300,
			accentColor: "#111827",
			backgroundColor: "#ffffff",
			layers: [
				{ id: "hidden", visible: false },
				{ id: "locked", locked: true },
			],
			layouts: [],
			elements: [
				{
					type: "node",
					id: "hidden-node",
					nodeId: "hidden-node",
					shape: "rectangle",
					x: 20,
					y: 20,
					width: 100,
					height: 60,
					label: "Hidden",
					layerId: "hidden",
				},
				{
					type: "node",
					id: "locked-node",
					nodeId: "locked-node",
					shape: "rectangle",
					x: 180,
					y: 20,
					width: 120,
					height: 60,
					label: "Locked",
					layerId: "locked",
					locked: false,
				},
				{
					type: "line",
					id: "locked-arrow",
					points: [
						{ x: 180, y: 160 },
						{ x: 320, y: 160 },
					],
					endArrowhead: "arrow",
					label: "Locked label",
					layerId: "locked",
				},
			],
			zOrder: ["hidden-node", "locked-node", "locked-arrow"],
		};

		const exported = convertSceneToExcalidraw(canvas);

		expect(exported.elements.map((element) => element.id)).not.toContain("hidden-node");
		expect(exported.elements.map((element) => element.id)).not.toContain(
			"__sketchi_node_label__hidden-node",
		);
		expect(exported.elements).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "locked-node", locked: true }),
				expect.objectContaining({
					id: "__sketchi_node_label__locked-node",
					locked: true,
				}),
				expect.objectContaining({ id: "locked-arrow", locked: true }),
				expect.objectContaining({ id: "locked-arrow:label", locked: true }),
			]),
		);
		expect(validateExcalidrawScene(exported)).toEqual({ ok: true, issues: [] });
	});

	it("uses explicit arrow-bound text instead of a derived connector label", () => {
		const canvas: CanvasSpec = {
			kind: "canvas",
			version: 1,
			diagramId: "bound-arrow-text",
			title: "Bound arrow text",
			width: 400,
			height: 200,
			accentColor: "#111827",
			backgroundColor: "#ffffff",
			layers: [],
			layouts: [],
			elements: [
				{
					type: "node",
					id: "source",
					nodeId: "source",
					shape: "rectangle",
					x: 20,
					y: 60,
					width: 100,
					height: 60,
					label: "Source",
				},
				{
					type: "node",
					id: "target",
					nodeId: "target",
					shape: "rectangle",
					x: 280,
					y: 60,
					width: 100,
					height: 60,
					label: "Target",
				},
				{
					type: "arrow",
					id: "request",
					edgeId: "request",
					sourceNodeId: "source",
					targetNodeId: "target",
					points: [
						{ x: 120, y: 90 },
						{ x: 280, y: 90 },
					],
					label: "derived fallback",
				},
				{
					type: "text",
					id: "request-label",
					containerId: "request",
					x: 200,
					y: 90,
					text: "POST /events",
					fontSize: 14,
				},
			],
			zOrder: ["source", "target", "request", "request-label"],
		};

		const exported = convertSceneToExcalidraw(canvas);
		expect(exported.elements.find((element) => element.id === "request")).toMatchObject({
			boundElements: [{ id: "request-label", type: "text" }],
		});
		expect(exported.elements.find((element) => element.id === "request-label")).toMatchObject({
			type: "text",
			containerId: "request",
			text: "POST /events",
		});
		expect(exported.elements.some((element) => element.id === "request:label")).toBe(false);
		expect(validateExcalidrawScene(exported)).toEqual({ ok: true, issues: [] });
	});

	it("exports mindmap branches as curved arrows bound to both topics", () => {
		const exported = convertSceneToExcalidraw(renderMindmapDiagram(mindmapFixture));
		expect(validateExcalidrawScene(exported)).toEqual({ ok: true, issues: [] });
		const arrows = exported.elements.filter((element) => element.type === "arrow");
		expect(arrows).toHaveLength(mindmapFixture.edges.length);
		const byId = new Map(exported.elements.map((element) => [element.id, element]));
		for (const arrow of arrows) {
			// Excalidraw draws a smooth curve through the points and keeps it a curve on edit.
			expect(arrow).toMatchObject({ elbowed: false, roundness: { type: 2 }, endArrowhead: null });
			expect(Array.isArray(arrow.points) && arrow.points.length).toBeGreaterThan(2);
			for (const binding of ["startBinding", "endBinding"] as const) {
				const target = byId.get((arrow[binding] as { elementId: string }).elementId);
				expect(target?.boundElements).toContainEqual({ id: arrow.id, type: "arrow" });
			}
		}
		// The central topic is an ellipse; each main branch moves as one Excalidraw group.
		expect(byId.get("node:topic-0")).toMatchObject({ type: "ellipse" });
		expect(byId.get("node:topic-0-0-1")?.groupIds).toEqual(["branch:topic-0-0"]);
		expect(byId.get("label:topic-0-0-1")?.groupIds).toEqual(["branch:topic-0-0"]);
	});

	it("still reports a multi-point arrow that is neither an elbow nor a curve", () => {
		const exported = convertSceneToExcalidraw(renderMindmapDiagram(mindmapFixture));
		const curve = exported.elements.find((element) => element.id === "edge:branch-0-0-0")!;
		curve.roundness = null;
		expect(validateExcalidrawScene(exported).issues).toContainEqual(
			expect.objectContaining({ code: "invalid-elbow-binding", elementId: "edge:branch-0-0-0" }),
		);
	});

	it("wraps scenes as importable Excalidraw files", () => {
		const scene = convertSceneToExcalidraw(renderIntermediateDiagram(flowchartFixture));
		const file = createExcalidrawFile(scene, {
			source: "https://studio.sketchi.app",
		});

		expect(file).toMatchObject({
			type: "excalidraw",
			version: 2,
			source: "https://studio.sketchi.app",
			elements: scene.elements,
			appState: scene.appState,
			files: {},
		});
	});

	it("creates bound arrows that validate as real Excalidraw elements", () => {
		const scene = convertSceneToExcalidraw(renderIntermediateDiagram(flowchartFixture));
		const branchArrow = scene.elements.find((element) => element.id === "edge:clear-review");

		const validation = validateExcalidrawScene(scene);

		expect(validation).toEqual({ ok: true, issues: [] });
		expect(scene.appState).toMatchObject({
			viewBackgroundColor: "#fffdf8",
			zoom: {
				value: expect.any(Number),
			},
		});
		expect(scene.elements.find((element) => element.type === "text")).toMatchObject({
			strokeColor: "#1a1712",
		});
		expect(scene.elements.filter((element) => element.type === "arrow")).toHaveLength(
			flowchartFixture.edges.length,
		);
		expect(branchArrow).toMatchObject({
			type: "arrow",
			points: expect.arrayContaining([expect.any(Array), expect.any(Array), expect.any(Array)]),
			elbowed: true,
			fixedSegments: [],
			roundness: null,
			startBinding: expect.objectContaining({
				fixedPoint: expect.arrayContaining([expect.any(Number)]),
			}),
		});
	});

	it("opens maintained vertical flowcharts at an embedded-canvas friendly zoom", () => {
		const scene = convertSceneToExcalidraw(renderIntermediateDiagram(flowchartFixture));

		expect(scene.appState.zoom).toEqual({
			value: expect.any(Number),
		});
		// The tall column wraps into two, so it opens larger than it once did.
		expect((scene.appState.zoom as { value: number }).value).toBeGreaterThanOrEqual(0.42);
		expect((scene.appState.zoom as { value: number }).value).toBeLessThanOrEqual(0.7);
	});

	it("keeps wrapped flowchart text inside real shape containers", () => {
		const scene = convertSceneToExcalidraw(
			renderIntermediateDiagram(pharmaBatchDispositionFlowchart),
		);

		const validation = validateExcalidrawScene(scene);
		const qaText = scene.elements.find((element) => element.id === "label:qa-review");

		expect(validation).toEqual({ ok: true, issues: [] });
		expect(qaText).toMatchObject({
			type: "text",
			containerId: "node:qa-review",
			text: expect.stringContaining("\n"),
		});
	});

	it("keeps maintained flowchart arrow routes from overlapping", () => {
		const maintainedScenes = [flowchartFixture, pharmaBatchDispositionFlowchart].map((diagram) =>
			convertSceneToExcalidraw(renderIntermediateDiagram(diagram)),
		);

		for (const scene of maintainedScenes) {
			expect(validateExcalidrawScene(scene).issues).not.toContainEqual(
				expect.objectContaining({ code: "overlapping-arrow-segment" }),
			);
		}
	});

	it("keeps Agy feedback-loop flowcharts valid without changing layout direction", () => {
		const feedbackLoopSpecs = [
			{
				id: "enterprise-sales-to-implementation-handoff",
				title: "Enterprise Sales-to-Implementation Handoff",
				type: "flowchart",
				nodes: [
					{
						id: "sales_qualify",
						label: "Sales: Qualify Opportunity",
						kind: "start",
					},
					{
						id: "solutions_scope",
						label: "Solutions: Scope Integration",
						kind: "process",
					},
					{
						id: "legal_review",
						label: "Legal: Review Contract",
						kind: "process",
					},
					{
						id: "contract_approved",
						label: "Contract Approved?",
						kind: "decision",
					},
					{
						id: "legal_redline",
						label: "Legal: Redline Contract",
						kind: "process",
					},
					{
						id: "finance_approve",
						label: "Finance: Approve Billing",
						kind: "process",
					},
					{
						id: "customer_sign",
						label: "Customer: Sign Order",
						kind: "process",
					},
					{
						id: "impl_kickoff",
						label: "Implementation: Kickoff",
						kind: "process",
					},
					{
						id: "customer_contacts",
						label: "Customer: Tech Contacts",
						kind: "process",
					},
					{
						id: "impl_configure",
						label: "Implementation: Config Workspace",
						kind: "process",
					},
					{
						id: "customer_validate",
						label: "Customer: Launch Checklist",
						kind: "process",
					},
					{
						id: "support_handoff",
						label: "Support: Success Handoff",
						kind: "end",
					},
				],
				edges: [
					{ id: "edge-1", source: "sales_qualify", target: "solutions_scope" },
					{ id: "edge-2", source: "solutions_scope", target: "legal_review" },
					{ id: "edge-3", source: "legal_review", target: "contract_approved" },
					{
						id: "edge-4",
						source: "contract_approved",
						target: "legal_redline",
						label: "no",
					},
					{ id: "edge-5", source: "legal_redline", target: "legal_review" },
					{
						id: "edge-6",
						source: "contract_approved",
						target: "finance_approve",
						label: "yes",
					},
					{ id: "edge-7", source: "finance_approve", target: "customer_sign" },
					{ id: "edge-8", source: "customer_sign", target: "impl_kickoff" },
					{ id: "edge-9", source: "impl_kickoff", target: "customer_contacts" },
					{
						id: "edge-10",
						source: "customer_contacts",
						target: "impl_configure",
					},
					{
						id: "edge-11",
						source: "impl_configure",
						target: "customer_validate",
					},
					{
						id: "edge-12",
						source: "customer_validate",
						target: "support_handoff",
					},
				],
				layout: { direction: "TB" },
			},
			{
				id: "agentic-diagram-pipeline-feedback-loop",
				title: "Agentic Diagram Pipeline & Feedback Loop",
				type: "flowchart",
				nodes: [
					{
						id: "user_prompt",
						label: "Messy User Request Received",
						kind: "start",
					},
					{
						id: "agent_orchestration",
						label: "Agent Requests IR Candidate",
						kind: "process",
					},
					{
						id: "core_validation",
						label: "diagram-core Validates IR Schema",
						kind: "process",
					},
					{ id: "ir_valid", label: "IR Valid?", kind: "decision" },
					{
						id: "agent_repair",
						label: "Agent Repairs IR Candidate",
						kind: "process",
					},
					{
						id: "scene_rendering",
						label: "diagram-renderer Generates Scene",
						kind: "process",
					},
					{
						id: "export_elements",
						label: "diagram-excalidraw Exports Elements",
						kind: "process",
					},
					{
						id: "export_succeeded",
						label: "Export Succeeded?",
						kind: "decision",
					},
					{ id: "log_failure", label: "Log Error & Alert Owner", kind: "end" },
					{
						id: "store_artifacts",
						label: "Store Scene, Excalidraw & PNG",
						kind: "process",
					},
					{
						id: "telemetry_logs",
						label: "Cloudflare Gateway Logs Telemetry",
						kind: "process",
					},
					{
						id: "eval_usage",
						label: "Evaluate Usage & Tune Prompts",
						kind: "process",
					},
					{
						id: "deliver_block",
						label: "Deliver Final Artifact Ready Block",
						kind: "end",
					},
				],
				edges: [
					{
						id: "edge-1",
						source: "user_prompt",
						target: "agent_orchestration",
					},
					{
						id: "edge-2",
						source: "agent_orchestration",
						target: "core_validation",
					},
					{ id: "edge-3", source: "core_validation", target: "ir_valid" },
					{
						id: "edge-4",
						source: "ir_valid",
						target: "agent_repair",
						label: "no",
					},
					{
						id: "edge-5",
						source: "agent_repair",
						target: "agent_orchestration",
					},
					{
						id: "edge-6",
						source: "ir_valid",
						target: "scene_rendering",
						label: "yes",
					},
					{
						id: "edge-7",
						source: "scene_rendering",
						target: "export_elements",
					},
					{
						id: "edge-8",
						source: "export_elements",
						target: "export_succeeded",
					},
					{
						id: "edge-9",
						source: "export_succeeded",
						target: "log_failure",
						label: "no",
					},
					{
						id: "edge-10",
						source: "export_succeeded",
						target: "store_artifacts",
						label: "yes",
					},
					{
						id: "edge-11",
						source: "store_artifacts",
						target: "telemetry_logs",
					},
					{ id: "edge-12", source: "telemetry_logs", target: "eval_usage" },
					{ id: "edge-13", source: "eval_usage", target: "deliver_block" },
				],
				layout: { direction: "TB" },
			},
		];

		for (const spec of feedbackLoopSpecs) {
			expectFlowchartExportValid(spec);
		}
	});

	it("routes same-rank branch arrows without crossing nodes in other ranks", () => {
		const scene = convertSceneToExcalidraw(
			renderIntermediateDiagram({
				id: "ecommerce-return-process",
				title: "Ecommerce returns with 18 steps",
				type: "flowchart",
				nodes: [
					{ id: "end-reject", label: "Closure: Rejected", kind: "end" },
					{
						id: "notify-final",
						label: "Notify Customer: Finalized",
						kind: "process",
					},
					{
						id: "restock-dec",
						label: "Restocking Decision",
						kind: "decision",
					},
					{
						id: "partial-refund",
						label: "Process Partial Refund",
						kind: "process",
					},
					{
						id: "notify-label",
						label: "Notify Customer: Label Ready",
						kind: "process",
					},
					{
						id: "refund-method",
						label: "Refund Method Decision",
						kind: "decision",
					},
					{
						id: "notify-receipt",
						label: "Notify Customer: Received",
						kind: "process",
					},
					{ id: "restock", label: "Restock Item", kind: "process" },
					{ id: "pickup", label: "Carrier Pickup", kind: "process" },
					{
						id: "start",
						label: "Initiate Return Request",
						kind: "start",
					},
					{ id: "end-success", label: "Closure: Success", kind: "end" },
					{
						id: "notify-reject",
						label: "Notify Customer: Rejected",
						kind: "process",
					},
					{
						id: "eligibility",
						label: "Eligibility Check",
						kind: "decision",
					},
					{ id: "receipt", label: "Warehouse Receipt", kind: "process" },
					{ id: "fraud-check", label: "Fraud Review", kind: "decision" },
					{
						id: "label-gen",
						label: "Generate Return Label",
						kind: "process",
					},
				],
				edges: [
					{ id: "e19", source: "notify-final", target: "end-success" },
					{
						id: "e15",
						source: "refund-method",
						target: "partial-refund",
						label: "refund",
					},
					{
						id: "e2",
						source: "eligibility",
						target: "label-gen",
						label: "eligible",
					},
					{
						id: "e12",
						source: "restock-dec",
						target: "restock",
						label: "restockable",
					},
					{ id: "e17", source: "partial-refund", target: "notify-final" },
					{ id: "e6", source: "pickup", target: "receipt" },
					{ id: "e20", source: "notify-reject", target: "end-reject" },
					{ id: "e1", source: "start", target: "eligibility" },
					{
						id: "e10",
						source: "fraud-check",
						target: "restock-dec",
						label: "pass",
					},
					{ id: "e5", source: "notify-label", target: "pickup" },
					{
						id: "e13",
						source: "restock-dec",
						target: "refund-method",
						label: "damaged",
					},
				],
				layout: { direction: "TB", edgeRouting: "orthogonal" },
			}),
		);

		expect(validateExcalidrawScene(scene)).toEqual({ ok: true, issues: [] });
	});

	it("routes Agy left-to-right skip edges around intervening row nodes", () => {
		expectFlowchartExportValid({
			id: "enterprise-vendor-onboarding-flow",
			title: "Enterprise Vendor Onboarding Flow",
			type: "flowchart",
			nodes: [
				{
					id: "intake_request",
					label: "Intake Request Submitted",
					kind: "start",
				},
				{
					id: "requester_details",
					label: "Gather Requester Details",
					kind: "process",
				},
				{
					id: "risk_screening",
					label: "Vendor Risk Screening",
					kind: "process",
				},
				{ id: "high_risk", label: "High Risk?", kind: "decision" },
				{
					id: "security_questionnaire",
					label: "Security Questionnaire",
					kind: "process",
				},
				{ id: "legal_review", label: "Legal Review", kind: "process" },
				{ id: "finance_tax", label: "Finance Tax Review", kind: "process" },
				{
					id: "procurement_approval",
					label: "Procurement Approval",
					kind: "process",
				},
				{
					id: "spend_threshold",
					label: "Spend Above Threshold?",
					kind: "decision",
				},
				{
					id: "executive_approval",
					label: "Executive Approval",
					kind: "process",
				},
				{
					id: "po_creation",
					label: "Purchase Order Creation",
					kind: "process",
				},
				{
					id: "portal_and_bank",
					label: "Portal Invite & Bank Validation",
					kind: "process",
				},
				{ id: "invoice_match", label: "First Invoice Match", kind: "process" },
				{
					id: "activate_and_archive",
					label: "Activate & Archive Evidence",
					kind: "end",
				},
			],
			edges: [
				{ id: "edge-1", source: "intake_request", target: "requester_details" },
				{ id: "edge-2", source: "requester_details", target: "risk_screening" },
				{ id: "edge-3", source: "risk_screening", target: "high_risk" },
				{
					id: "edge-4",
					source: "high_risk",
					target: "security_questionnaire",
					label: "yes",
				},
				{
					id: "edge-5",
					source: "security_questionnaire",
					target: "legal_review",
				},
				{
					id: "edge-6",
					source: "high_risk",
					target: "legal_review",
					label: "no",
				},
				{ id: "edge-7", source: "legal_review", target: "finance_tax" },
				{
					id: "edge-8",
					source: "finance_tax",
					target: "procurement_approval",
				},
				{
					id: "edge-9",
					source: "procurement_approval",
					target: "spend_threshold",
				},
				{
					id: "edge-10",
					source: "spend_threshold",
					target: "executive_approval",
					label: "yes",
				},
				{
					id: "edge-11",
					source: "executive_approval",
					target: "po_creation",
				},
				{
					id: "edge-12",
					source: "spend_threshold",
					target: "po_creation",
					label: "no",
				},
				{ id: "edge-13", source: "po_creation", target: "portal_and_bank" },
				{ id: "edge-14", source: "portal_and_bank", target: "invoice_match" },
				{
					id: "edge-15",
					source: "invoice_match",
					target: "activate_and_archive",
				},
			],
			layout: { direction: "LR" },
		});
	});

	it("allows shared bound stems when decision branches diverge", () => {
		const scene = convertSceneToExcalidraw(
			renderIntermediateDiagram(
				parseFlowchartDiagram({
					id: "shared-stem-branch",
					title: "Shared stem branch",
					type: "flowchart",
					nodes: [
						{ id: "start", label: "Start", kind: "start" },
						{ id: "gate", label: "Proceed?", kind: "decision" },
						{ id: "left", label: "Left path", kind: "process" },
						{ id: "right", label: "Right path", kind: "process" },
						{ id: "done", label: "Done", kind: "end" },
					],
					edges: [
						{ id: "start-gate", source: "start", target: "gate" },
						{ id: "gate-left", source: "gate", target: "left", label: "yes" },
						{ id: "gate-right", source: "gate", target: "right", label: "no" },
						{ id: "left-done", source: "left", target: "done" },
						{ id: "right-done", source: "right", target: "done" },
					],
					layout: { direction: "TB", edgeRouting: "orthogonal" },
				}),
			),
		);

		expect(validateExcalidrawScene(scene).issues).not.toContainEqual(
			expect.objectContaining({ code: "overlapping-arrow-segment" }),
		);
	});

	it("emits valid Excalidraw order keys for dense scenes past 90 elements", () => {
		const scene = convertSceneToExcalidraw(
			renderIntermediateDiagram(
				parseFlowchartDiagram({
					id: "production-release-incident-response-rollback-de",
					title: "Production Release, Incident Response & Rollback Decision Flow",
					type: "flowchart",
					nodes: [
						{ id: "start", label: "Release Triggered", kind: "start" },
						{ id: "ci_build", label: "CI Build & Unit Tests", kind: "process" },
						{ id: "ci_gate", label: "CI Green?", kind: "decision" },
						{
							id: "security_scan",
							label: "Security & Dependency Scan",
							kind: "process",
						},
						{ id: "scan_gate", label: "Scan Clean?", kind: "decision" },
						{
							id: "deploy_staging",
							label: "Deploy to Staging",
							kind: "process",
						},
						{ id: "vuln_gate", label: "Exploitable Vuln?", kind: "decision" },
						{
							id: "smoke_staging",
							label: "Staging Smoke + Integration Tests",
							kind: "process",
						},
						{
							id: "staging_gate",
							label: "Staging Healthy?",
							kind: "decision",
						},
						{ id: "fix_code", label: "Fix Code & Rebuild", kind: "process" },
						{
							id: "canary_deploy",
							label: "Canary 5% Rollout",
							kind: "process",
						},
						{
							id: "canary_gate",
							label: "Canary Metrics OK?",
							kind: "decision",
						},
						{
							id: "full_rollout",
							label: "Full Production Rollout",
							kind: "process",
						},
						{
							id: "monitor",
							label: "Monitor SLOs, Errors & Alerts",
							kind: "process",
						},
						{
							id: "incident_gate",
							label: "Incident Detected?",
							kind: "decision",
						},
						{
							id: "severity_gate",
							label: "Sev1 / Customer Impact?",
							kind: "decision",
						},
						{
							id: "page_oncall",
							label: "Page On-Call & Declare Incident",
							kind: "process",
						},
						{
							id: "mitigate",
							label: "Apply Mitigation / Feature Flag",
							kind: "process",
						},
						{
							id: "mitigation_gate",
							label: "Mitigated Within SLA?",
							kind: "decision",
						},
						{
							id: "rollback",
							label: "Rollback to Last Good Build",
							kind: "process",
						},
						{
							id: "rollback_gate",
							label: "Health Restored?",
							kind: "decision",
						},
						{
							id: "manual_recovery",
							label: "Escalate: Manual Infra/DB Recovery",
							kind: "process",
						},
						{
							id: "postmortem",
							label: "Postmortem & Action Items",
							kind: "process",
						},
						{ id: "incident_closed", label: "Incident Closed", kind: "end" },
					],
					edges: [
						{ id: "edge-1", source: "start", target: "ci_build" },
						{ id: "edge-2", source: "ci_build", target: "ci_gate" },
						{
							id: "edge-3",
							source: "ci_gate",
							target: "security_scan",
							label: "yes",
						},
						{
							id: "edge-4",
							source: "ci_gate",
							target: "fix_code",
							label: "no",
						},
						{
							id: "edge-5",
							source: "fix_code",
							target: "ci_build",
							label: "rebuild",
						},
						{ id: "edge-6", source: "security_scan", target: "scan_gate" },
						{
							id: "edge-7",
							source: "scan_gate",
							target: "deploy_staging",
							label: "clean",
						},
						{
							id: "edge-8",
							source: "scan_gate",
							target: "vuln_gate",
							label: "vulns found",
						},
						{
							id: "edge-9",
							source: "vuln_gate",
							target: "incident_closed",
							label: "exploitable",
						},
						{
							id: "edge-10",
							source: "vuln_gate",
							target: "fix_code",
							label: "patchable",
						},
						{
							id: "edge-11",
							source: "deploy_staging",
							target: "smoke_staging",
						},
						{
							id: "edge-12",
							source: "smoke_staging",
							target: "staging_gate",
						},
						{
							id: "edge-13",
							source: "staging_gate",
							target: "canary_deploy",
							label: "healthy",
						},
						{
							id: "edge-14",
							source: "staging_gate",
							target: "fix_code",
							label: "failed",
						},
						{
							id: "edge-15",
							source: "canary_deploy",
							target: "canary_gate",
						},
						{
							id: "edge-16",
							source: "canary_gate",
							target: "full_rollout",
							label: "metrics ok",
						},
						{
							id: "edge-17",
							source: "canary_gate",
							target: "rollback",
							label: "regression",
						},
						{ id: "edge-18", source: "full_rollout", target: "monitor" },
						{ id: "edge-19", source: "monitor", target: "incident_gate" },
						{
							id: "edge-20",
							source: "incident_gate",
							target: "incident_closed",
							label: "stable",
						},
						{
							id: "edge-21",
							source: "incident_gate",
							target: "severity_gate",
							label: "anomaly",
						},
						{
							id: "edge-22",
							source: "severity_gate",
							target: "page_oncall",
							label: "sev1",
						},
						{
							id: "edge-23",
							source: "severity_gate",
							target: "mitigate",
							label: "low sev",
						},
						{ id: "edge-24", source: "page_oncall", target: "mitigate" },
						{ id: "edge-25", source: "mitigate", target: "mitigation_gate" },
						{
							id: "edge-26",
							source: "mitigation_gate",
							target: "monitor",
							label: "mitigated",
						},
						{
							id: "edge-27",
							source: "mitigation_gate",
							target: "rollback",
							label: "not mitigated",
						},
						{ id: "edge-28", source: "rollback", target: "rollback_gate" },
						{
							id: "edge-29",
							source: "rollback_gate",
							target: "postmortem",
							label: "restored",
						},
						{
							id: "edge-30",
							source: "rollback_gate",
							target: "manual_recovery",
							label: "still failing",
						},
						{
							id: "edge-31",
							source: "manual_recovery",
							target: "rollback_gate",
							label: "re-verify",
						},
						{ id: "edge-32", source: "postmortem", target: "incident_closed" },
					],
					layout: { direction: "TB", edgeRouting: "orthogonal" },
				}),
			),
		);

		expect(scene.elements.length).toBeGreaterThan(90);
		expect(scene.elements.map((element) => element.index)).not.toContain("a90");
		expectValidOrderKeys(scene.elements);
	});

	it("uses fixed elbow bindings so Excalidraw can preserve connectors when shapes move", () => {
		const scene = convertSceneToExcalidraw(renderIntermediateDiagram(flowchartFixture));
		const branchArrow = scene.elements.find((element) => element.id === "edge:clear-review");
		const sourceShape = scene.elements.find((element) => element.id === "node:clear");
		const startFixedPoint = bindingFixedPoint(branchArrow, "startBinding");
		const originalStart = firstGlobalPoint(branchArrow);
		const fixedStart = globalPointFromFixedPoint(sourceShape, startFixedPoint);
		const movedStart = globalPointFromFixedPoint(
			sourceShape
				? {
						...sourceShape,
						x: Number(sourceShape.x) + 48,
						y: Number(sourceShape.y) + 32,
					}
				: undefined,
			startFixedPoint,
		);

		expect(branchArrow).toMatchObject({
			elbowed: true,
			fixedSegments: [],
			startBinding: expect.objectContaining({
				elementId: "node:clear",
				fixedPoint: expect.any(Array),
				gap: 0,
			}),
			endBinding: expect.objectContaining({
				elementId: "node:review",
				fixedPoint: expect.any(Array),
				gap: 0,
			}),
		});
		expect(bindingGap(branchArrow, "startBinding")).toBe(0);
		expect(bindingGap(branchArrow, "endBinding")).toBe(0);
		expectClosePoint(fixedStart, originalStart);
		expectClosePoint(movedStart, {
			x: originalStart.x + 48,
			y: originalStart.y + 32,
		});
	});

	it("exports boundary-bound arrows with zero binding gaps", () => {
		const diagrams = [flowchartFixture, pharmaBatchDispositionFlowchart];

		for (const diagram of diagrams) {
			const scene = convertSceneToExcalidraw(renderIntermediateDiagram(diagram));
			const arrows = scene.elements.filter((element) => element.type === "arrow");

			for (const arrow of arrows) {
				expect(bindingGap(arrow, "startBinding")).toBe(0);
				expect(bindingGap(arrow, "endBinding")).toBe(0);
			}
		}
	});

	it("accepts Excalidraw-edited elbow arrows with null fixed segments", () => {
		const scene = convertSceneToExcalidraw(renderIntermediateDiagram(flowchartFixture));
		const branchArrow = scene.elements.find((element) => element.id === "edge:clear-review");

		if (branchArrow) {
			branchArrow.fixedSegments = null;
		}

		expect(validateExcalidrawScene(scene)).toEqual({ ok: true, issues: [] });
	});

	it("reports broken reciprocal arrow bindings", () => {
		const scene = convertSceneToExcalidraw(renderIntermediateDiagram(flowchartFixture));
		const firstShape = scene.elements.find((element) => element.id === "node:prompt");

		if (firstShape) {
			firstShape.boundElements = [];
		}

		const validation = validateExcalidrawScene(scene);

		expect(validation.ok).toBe(false);
		expect(validation.issues).toContainEqual(
			expect.objectContaining({
				code: "missing-bound-arrow",
				elementId: "node:prompt",
			}),
		);
	});

	it("reports overlapping arrow route segments", () => {
		const scene = convertSceneToExcalidraw(renderIntermediateDiagram(flowchartFixture));
		const promptArrow = scene.elements.find((element) => element.id === "edge:prompt-requirements");
		const requirementsArrow = scene.elements.find(
			(element) => element.id === "edge:requirements-clear",
		);

		if (promptArrow && requirementsArrow) {
			requirementsArrow.x = promptArrow.x;
			requirementsArrow.y = promptArrow.y;
			requirementsArrow.points = promptArrow.points;
		}

		const validation = validateExcalidrawScene(scene);

		expect(validation.ok).toBe(false);
		expect(validation.issues).toContainEqual(
			expect.objectContaining({
				code: "overlapping-arrow-segment",
				elementId: "edge:prompt-requirements",
			}),
		);
	});

	it("reports routes through ordinary nodes claiming lifeline identity", () => {
		const scene = convertSceneToExcalidraw({
			kind: "canvas",
			version: 1,
			diagramId: "through-node-route",
			title: "Through-node route",
			width: 420,
			height: 140,
			accentColor: "#0f766e",
			backgroundColor: "#ffffff",
			elements: [
				{
					type: "arrow",
					id: "edge:start-end",
					edgeId: "start-end",
					sourceNodeId: "start",
					targetNodeId: "end",
					points: [
						{ x: 120, y: 70 },
						{ x: 320, y: 70 },
					],
				},
				{
					type: "node",
					id: "node:start",
					nodeId: "start",
					shape: "rectangle",
					x: 20,
					y: 40,
					width: 100,
					height: 60,
					label: "Start",
				},
				{
					type: "node",
					id: "node:middle:lifeline",
					nodeId: "middle:lifeline",
					kind: "sequence-lifeline",
					shape: "rectangle",
					x: 170,
					y: 40,
					width: 100,
					height: 60,
					label: "Middle",
				},
				{
					type: "node",
					id: "node:end",
					nodeId: "end",
					shape: "rectangle",
					x: 320,
					y: 40,
					width: 100,
					height: 60,
					label: "End",
				},
			],
			layers: [],
			layouts: [],
			zOrder: ["edge:start-end", "node:start", "node:middle:lifeline", "node:end"],
		});

		const validation = validateExcalidrawScene(scene);

		expect(validation.ok).toBe(false);
		expect(validation.issues).toContainEqual(
			expect.objectContaining({
				code: "arrow-segment-through-node",
				elementId: "edge:start-end",
			}),
		);
	});

	it("reports arrow endpoints that no longer land on their bound shapes", () => {
		const scene = convertSceneToExcalidraw(renderIntermediateDiagram(flowchartFixture));
		const promptArrow = scene.elements.find((element) => element.id === "edge:prompt-requirements");

		if (promptArrow) {
			promptArrow.x = Number(promptArrow.x) + 220;
		}

		const validation = validateExcalidrawScene(scene);

		expect(validation.ok).toBe(false);
		expect(validation.issues).toContainEqual(
			expect.objectContaining({
				code: "arrow-endpoint-off-shape",
				elementId: "edge:prompt-requirements",
			}),
		);
	});

	it("reports diamond endpoints that only land on the bounding box", () => {
		const scene = convertSceneToExcalidraw(renderIntermediateDiagram(flowchartFixture));
		const branchArrow = scene.elements.find((element) => element.id === "edge:clear-review");
		const decisionShape = scene.elements.find((element) => element.id === "node:clear");

		if (
			!branchArrow ||
			!decisionShape ||
			typeof decisionShape.x !== "number" ||
			typeof decisionShape.y !== "number" ||
			typeof decisionShape.width !== "number" ||
			typeof decisionShape.height !== "number"
		) {
			throw new Error("Expected clear-review arrow and clear decision shape.");
		}

		const offDiamondPoint = {
			x: decisionShape.x + decisionShape.width / 2 - 9,
			y: decisionShape.y + decisionShape.height,
		};
		const startBinding = branchArrow.startBinding;

		if (!(startBinding && typeof startBinding === "object")) {
			throw new Error("Expected clear-review start binding.");
		}

		branchArrow.x = offDiamondPoint.x;
		branchArrow.y = offDiamondPoint.y;
		branchArrow.points = Array.isArray(branchArrow.points)
			? [[0, 0], ...branchArrow.points.slice(1)]
			: [[0, 0]];
		branchArrow.startBinding = {
			...startBinding,
			fixedPoint: [(offDiamondPoint.x - decisionShape.x) / decisionShape.width, 1],
		};

		const validation = validateExcalidrawScene(scene);

		expect(validation.ok).toBe(false);
		expect(validation.issues).toContainEqual(
			expect.objectContaining({
				code: "arrow-endpoint-off-shape",
				elementId: "edge:clear-review",
			}),
		);
	});

	it("reports orthogonal routes missing Excalidraw elbow metadata", () => {
		const scene = convertSceneToExcalidraw(renderIntermediateDiagram(flowchartFixture));
		const branchArrow = scene.elements.find((element) => element.id === "edge:clear-review");

		if (branchArrow) {
			branchArrow.elbowed = false;
			delete branchArrow.fixedSegments;
		}

		const validation = validateExcalidrawScene(scene);

		expect(validation.ok).toBe(false);
		expect(validation.issues).toContainEqual(
			expect.objectContaining({
				code: "invalid-elbow-binding",
				elementId: "edge:clear-review",
			}),
		);
	});

	it("accepts sequence messages that cross intermediate lifelines", () => {
		const scene = convertSceneToExcalidraw(
			renderSequenceDiagram({
				type: "sequence",
				id: "cross-lifeline",
				title: "Cross lifeline",
				participants: [
					{ id: "left", label: "Left" },
					{
						id: "middle",
						label: "Middle",
						kind: "sequence-lifeline",
					},
					{ id: "right", label: "Right" },
				],
				messages: [
					{
						id: "cross",
						source: "left",
						target: "right",
						label: "Cross middle",
					},
				],
				style: { accentColor: "#000000", backgroundColor: "#ffffff" },
			}),
		);

		expect(validateExcalidrawScene(scene)).toEqual({ ok: true, issues: [] });
		expect(scene.elements.find((element) => element.id === "node:middle:lifeline")).toMatchObject({
			customData: { sketchiRendererRole: "sequence-lifeline" },
		});
		expect(scene.elements.find((element) => element.id === "node:middle")).not.toHaveProperty(
			"customData.sketchiRendererRole",
		);
	});

	it("exports a self-message as an elbow loop bound to its bars with its label beside it", () => {
		const diagram = parseSequenceDiagram({
			id: "oauth-self",
			title: "OAuth with credential check",
			type: "sequence",
			participants: [
				{ id: "browser", label: "Browser" },
				{ id: "idp", label: "Identity Provider" },
			],
			messages: [
				{ id: "authorize", source: "browser", target: "idp", label: "Authorize" },
				{ id: "validate", source: "idp", target: "idp", label: "Validate the user's credentials" },
				{ id: "code", source: "idp", target: "browser", label: "Code", type: "return" },
				{ id: "retry", source: "browser", target: "browser", label: "Retry", type: "return" },
			],
		});
		const scene = convertSceneToExcalidraw(renderSequenceDiagram(diagram));
		expect(validateExcalidrawScene(scene)).toEqual({ ok: true, issues: [] });
		// A reload reads the same scene back from the file.
		const reloaded = JSON.parse(JSON.stringify(createExcalidrawFile(scene))) as {
			elements: ExcalidrawElement[];
		};
		expect(validateExcalidrawScene({ ...scene, elements: reloaded.elements })).toEqual({
			ok: true,
			issues: [],
		});

		const element = (id: string) => {
			const found = scene.elements.find((candidate) => candidate.id === id);
			if (!found) throw new Error(`Missing ${id}.`);
			return found;
		};
		const loop = element("arrow:validate");
		expect(loop).toMatchObject({
			type: "arrow",
			elbowed: true,
			startBinding: {
				elementId: "node:idp:lifeline:activation:authorize",
				fixedPoint: [1, expect.any(Number)],
			},
			endBinding: {
				elementId: "node:idp:lifeline:activation:validate",
				fixedPoint: [1, expect.any(Number)],
			},
			boundElements: null,
		});
		expect(element("node:idp:lifeline:activation:validate").boundElements).toEqual(
			expect.arrayContaining([{ id: "arrow:validate", type: "arrow" }]),
		);
		// The label is free text right of the loop's outer leg, grouped with the
		// loop so they move together, and keeps its stored wrap on edit.
		const points = loop.points as [number, number][];
		const label = element("arrow:validate:label");
		expect(label).toMatchObject({
			type: "text",
			containerId: null,
			autoResize: false,
			groupIds: loop.groupIds,
		});
		expect(loop.groupIds).toEqual(["message:validate"]);
		expect(label.x as number).toBeGreaterThan((loop.x as number) + points[1]![0]);
		const loopTop = (loop.y as number) + points[1]![1];
		const loopBottom = (loop.y as number) + points[2]![1];
		expect(label.y as number).toBeGreaterThanOrEqual(loopTop);
		expect((label.y as number) + (label.height as number)).toBeLessThanOrEqual(loopBottom);
		// The idle browser's self-return loops on its lifeline.
		expect(element("arrow:retry")).toMatchObject({
			elbowed: true,
			strokeStyle: "dashed",
			startBinding: { elementId: "node:browser:lifeline" },
			endBinding: { elementId: "node:browser:lifeline" },
		});
	});

	it("exports activation bars as unlabeled bound shapes that other messages may cross", () => {
		const nested = parseSequenceDiagram({
			id: "oauth",
			title: "OAuth callback",
			type: "sequence",
			participants: [
				{ id: "client", label: "Client" },
				{ id: "api", label: "API" },
				{ id: "auth", label: "Auth" },
			],
			messages: [
				{ id: "login", source: "client", target: "api", label: "Log in" },
				{ id: "authorize", source: "api", target: "auth", label: "Authorize" },
				{ id: "callback", source: "auth", target: "api", label: "Callback" },
				{ id: "ack", source: "api", target: "auth", label: "Ack", type: "return" },
				{ id: "token", source: "auth", target: "api", label: "Token", type: "return" },
				{ id: "direct", source: "auth", target: "client", label: "Direct notice" },
				{ id: "session", source: "api", target: "client", label: "Session", type: "return" },
			],
		});
		for (const diagram of [sequenceFixture, apiRequestSequence, selfMessageSequence, nested]) {
			const scene = convertSceneToExcalidraw(renderSequenceDiagram(diagram));
			expect(validateExcalidrawScene(scene), diagram.id).toEqual({ ok: true, issues: [] });
		}

		const scene = convertSceneToExcalidraw(renderSequenceDiagram(sequenceFixture));
		const bar = scene.elements.find(
			(element) => element.id === "node:store:lifeline:activation:checkout",
		);
		expect(bar).toMatchObject({
			type: "rectangle",
			customData: { sketchiRendererRole: "sequence-activation" },
			boundElements: expect.arrayContaining([
				{ id: "arrow:checkout", type: "arrow" },
				{ id: "arrow:receipt", type: "arrow" },
			]),
		});
		expect(
			scene.elements.some(
				(element) =>
					element.type === "text" &&
					element.containerId === "node:store:lifeline:activation:checkout",
			),
		).toBe(false);
	});
});

describe("bound label first paint", () => {
	// Excalidraw paints restored bound text at its stored size and wrap, so
	// anything wider than the stored width is clipped until the label is edited.
	const converted = convertSceneToExcalidraw(
		renderIntermediateDiagram(
			parseFlowchartDiagram({
				id: "label-metrics",
				title: "Label metrics",
				type: "flowchart",
				nodes: [
					{ id: "start", label: "Start", kind: "start" },
					{ id: "cjk", label: "品質保証レビュー承認待ち", kind: "process" },
					{ id: "end", label: "End", kind: "end" },
				],
				edges: [
					{
						id: "start-cjk",
						source: "start",
						target: "cjk",
						label: "Escalate to the quality manager for final disposition",
					},
					{ id: "cjk-end", source: "cjk", target: "end" },
				],
				layout: { direction: "TB", edgeRouting: "orthogonal" },
			}),
		),
	);
	const text = (id: string) => {
		const element = converted.elements.find((entry) => entry.id === id);
		if (!element) throw new Error(`Missing ${id}`);
		return element;
	};

	it("wraps arrow labels to the label width and keeps the authored text", () => {
		expect(text("edge:start-cjk:label")).toMatchObject({
			originalText: "Escalate to the quality manager for final disposition",
			text: "Escalate to the\nquality manager for\nfinal disposition",
			width: 154,
			height: 53,
		});
	});

	it("sizes CJK node labels at a full em per glyph", () => {
		const label = text("label:cjk");
		expect(label.text).toBe("品質保証レビュー承認待\nち");
		expect(label.width).toBeGreaterThanOrEqual(11 * 14);
		expect(validateExcalidrawScene(converted)).toEqual({
			ok: true,
			issues: [],
		});
	});

	it("wraps sequence participant headers inside the header", () => {
		const sequence = convertSceneToExcalidraw(
			renderSequenceDiagram({
				type: "sequence",
				id: "long-participants",
				title: "Long participants",
				participants: [
					{ id: "qa", label: "Quality Assurance Department" },
					{ id: "cjk", label: "品質保証レビュー承認待ち部門" },
				],
				messages: [{ id: "m", source: "qa", target: "cjk", label: "Review" }],
				style: { accentColor: "#111827", backgroundColor: "#ffffff" },
			}),
		);
		const header = (id: string) =>
			sequence.elements.find((element) => element.id === `label:${id}`);
		expect(header("qa")).toMatchObject({
			text: "Quality Assurance\nDepartment",
		});
		expect(header("cjk")?.text).toBe("品質保証レビュー承認待\nち部門");
		for (const id of ["qa", "cjk"]) {
			expect(header(id)?.width).toBeLessThanOrEqual(156);
		}
		expect(validateExcalidrawScene(sequence)).toEqual({ ok: true, issues: [] });
	});

	it("keeps wrapped unbound line labels at their stored width on edit", () => {
		const scene = convertSceneToExcalidraw({
			...renderIntermediateDiagram(flowchartFixture),
			elements: [
				{
					type: "line",
					id: "divider",
					points: [
						{ x: 0, y: 0 },
						{ x: 400, y: 0 },
					],
					label: "Escalate to the quality manager for final disposition",
				},
			],
		});
		expect(scene.elements.find((element) => element.id === "divider:label")).toMatchObject({
			autoResize: false,
			containerId: null,
			text: "Escalate to the\nquality manager for\nfinal disposition",
		});
	});
});

describe("group frames", () => {
	it("exports each group as a named frame that holds its members", () => {
		const exported = convertSceneToExcalidraw(
			renderIntermediateDiagram(groupFixtures["grouped-approval"]),
		);
		const frames = exported.elements.filter((element) => element.type === "frame");
		expect(frames.map((frame) => [frame.id, frame.name])).toEqual([
			["group:employee", "Employee"],
			["group:manager", "Manager"],
			["group:finance", "Finance"],
		]);
		const frameOf = (id: string) => exported.elements.find((element) => element.id === id)?.frameId;
		expect(frameOf("node:submit")).toBe("group:employee");
		expect(frameOf("label:submit")).toBe("group:employee");
		expect(frameOf("node:approved")).toBe("group:manager");
		expect(frameOf("node:incurred")).toBeNull();
		// A group's own edge belongs to it; an edge between groups belongs to neither.
		expect(frameOf("edge:e7")).toBe("group:finance");
		expect(frameOf("edge:e2")).toBeNull();
		expect(validateExcalidrawScene(exported)).toEqual({ ok: true, issues: [] });
	});

	it("lets an arrow cross only the frames that hold one of its ends", () => {
		const node = (id: string, x: number, y: number, frameId?: string) => ({
			type: "node" as const,
			id: `node:${id}`,
			nodeId: id,
			shape: "rectangle" as const,
			x,
			y,
			width: 100,
			height: 60,
			label: id,
			...(frameId ? { frameId } : {}),
		});
		const scene = convertSceneToExcalidraw({
			kind: "canvas",
			version: 1,
			diagramId: "frames",
			title: "Frames",
			width: 900,
			height: 400,
			accentColor: "#111827",
			backgroundColor: "#ffffff",
			elements: [
				{ type: "frame", id: "group:team", name: "Team", x: 300, y: 40, width: 200, height: 300 },
				node("inside", 350, 60, "group:team"),
				node("left", 40, 70),
				node("right", 700, 70),
				node("below-left", 40, 260),
				node("below-right", 700, 260),
				{
					type: "arrow",
					id: "edge:into",
					edgeId: "into",
					sourceNodeId: "left",
					targetNodeId: "inside",
					points: [
						{ x: 140, y: 90 },
						{ x: 350, y: 90 },
					],
				},
				{
					type: "arrow",
					id: "edge:through",
					edgeId: "through",
					sourceNodeId: "below-left",
					targetNodeId: "below-right",
					points: [
						{ x: 140, y: 290 },
						{ x: 700, y: 290 },
					],
				},
			],
			layers: [],
			layouts: [],
			zOrder: [
				"group:team",
				"node:inside",
				"node:left",
				"node:right",
				"node:below-left",
				"node:below-right",
				"edge:into",
				"edge:through",
			],
		});
		expect(
			validateExcalidrawScene(scene).issues.filter(
				(issue) => issue.code === "arrow-segment-through-node",
			),
		).toEqual([
			{
				code: "arrow-segment-through-node",
				elementId: "edge:through",
				message: 'Arrow "edge:through" passes through shape "group:team".',
			},
		]);
	});

	describe("an overlay drawn after what it holds", () => {
		const node = (id: string, x: number, y: number, extra: Record<string, unknown> = {}) => ({
			type: "node" as const,
			id: `node:${id}`,
			nodeId: id,
			shape: "rectangle" as const,
			x,
			y,
			width: 100,
			height: 60,
			label: id,
			...extra,
		});
		const crossing = (cover: Record<string, unknown>) => {
			const scene = convertSceneToExcalidraw({
				kind: "canvas",
				version: 1,
				diagramId: "covered",
				title: "Covered",
				width: 900,
				height: 300,
				accentColor: "#111827",
				backgroundColor: "#ffffff",
				elements: [
					{ ...cover, id: "cover", x: 20, y: 20, width: 460, height: 160 } as never,
					node("source", 40, 70, cover["type"] === "frame" ? { frameId: "cover" } : {}),
					node("between", 260, 70, cover["type"] === "frame" ? { frameId: "cover" } : {}),
					node("outside", 700, 70),
					{
						type: "arrow",
						id: "edge:out",
						edgeId: "out",
						sourceNodeId: "source",
						targetNodeId: "outside",
						points: [
							{ x: 140, y: 100 },
							{ x: 700, y: 100 },
						],
					},
				],
				layers: [],
				layouts: [],
				zOrder: ["node:source", "node:between", "node:outside", "edge:out", "cover"],
			});
			// The cover comes after what it holds, as an overlay does.
			const covering = scene.elements.filter(
				(element) => element.id === "cover" || element.containerId === "cover",
			);
			const elements = [
				...scene.elements.filter((element) => !covering.includes(element)),
				...covering,
			];
			return validateExcalidrawScene({ ...scene, elements })
				.issues.filter((issue) => issue.code === "arrow-segment-through-node")
				.map((issue) => issue.message);
		};
		it("never hides an obstacle under a frame or a transparent box, which mask nothing", () => {
			const through = 'Arrow "edge:out" passes through shape "node:between".';
			expect(crossing({ type: "frame", name: "Screen" })).toContain(through);
			expect(crossing({ type: "node", nodeId: "cover", shape: "rectangle", label: "" })).toContain(
				through,
			);
		});

		it("hides an obstacle under a filled overlay that holds the arrow's end, as a modal does", () => {
			expect(
				crossing({
					type: "node",
					nodeId: "cover",
					shape: "rectangle",
					label: "",
					fillColor: "#ffffff",
				}),
			).toEqual([]);
		});
	});
});

describe("architecture zones and infrastructure shapes", () => {
	const aws = renderIntermediateDiagram(zoneFixtures["aws-three-tier"]);
	const exported = convertSceneToExcalidraw(aws);
	const byId = new Map(exported.elements.map((element) => [element.id, element]));

	it("exports zones as locked, square, crossable rectangles under a locked label", () => {
		const vpc = byId.get("group:vpc")!;
		expect(vpc).toMatchObject({
			type: "rectangle",
			locked: true,
			roundness: null,
			strokeStyle: "solid",
			customData: { sketchiRendererRole: "zone" },
		});
		expect(byId.get("zone-label:vpc")).toMatchObject({
			type: "text",
			containerId: null,
			locked: true,
			text: "VPC 10.0.0.0/16",
			textAlign: "left",
		});
		expect(exported.elements.some((element) => element.type === "frame")).toBe(false);
		expect(validateExcalidrawScene(exported).issues).toEqual([]);
	});

	it("draws a database as a bindable box under the strokes of a cylinder, grouped together", () => {
		const box = byId.get("node:rds")!;
		expect(box).toMatchObject({
			type: "rectangle",
			strokeColor: "transparent",
			backgroundColor: "transparent",
			customData: { sketchiShape: "cylinder" },
			groupIds: ["node:rds:shape"],
		});
		const arrow = exported.elements.find((element) => element.id === "edge:e4")!;
		expect(arrow["endBinding"]).toMatchObject({ elementId: "node:rds" });
		const label = exported.elements.find(
			(element) => element.type === "text" && element["containerId"] === "node:rds",
		)!;
		expect(label["groupIds"]).toEqual(["node:rds:shape"]);
		const strokes = exported.elements.filter((element) =>
			element.id.startsWith("node:rds:stroke-"),
		);
		// The lid's back and front, both sides and the foot.
		expect(strokes.map((stroke) => [stroke.type, stroke["roundness"], stroke["groupIds"]])).toEqual(
			[
				["line", { type: 2 }, ["node:rds:shape"]],
				["line", { type: 2 }, ["node:rds:shape"]],
				["line", null, ["node:rds:shape"]],
				["line", null, ["node:rds:shape"]],
				["line", { type: 2 }, ["node:rds:shape"]],
			],
		);
		// Every stroke stays within the box arrows bind to.
		for (const stroke of strokes)
			for (const [x, y] of stroke["points"] as [number, number][]) {
				expect((stroke["x"] as number) + x).toBeGreaterThanOrEqual((box["x"] as number) - 0.01);
				expect((stroke["y"] as number) + y).toBeLessThanOrEqual(
					(box["y"] as number) + (box["height"] as number) + 0.01,
				);
			}
	});

	it("fills a composed shape's outline when the node asks for a fill", () => {
		const scene = {
			...aws,
			elements: aws.elements.map((element) =>
				element.id === "node:rds" && element.type === "node"
					? { ...element, fillColor: "#efe6ec" }
					: element,
			),
		};
		const filled = convertSceneToExcalidraw(scene).elements.filter((element) =>
			element.id.startsWith("node:rds:stroke-"),
		);
		expect(filled[0]).toMatchObject({ backgroundColor: "#efe6ec", strokeColor: "transparent" });
		const points = filled[0]!["points"] as [number, number][];
		expect(points.at(-1)).toEqual(points[0]);
		expect(filled).toHaveLength(6);
	});

	it("binds a line to a bucket's tapered side, not its box", () => {
		const scene = renderIntermediateDiagram(
			parseFlowchartDiagram({
				id: "bucket",
				title: "Bucket",
				type: "flowchart",
				layout: { direction: "LR", edgeRouting: "orthogonal" },
				nodes: [
					{ id: "api", label: "API service", kind: "start" },
					{ id: "assets", label: "Assets bucket", kind: "end", shape: "storage" },
				],
				edges: [{ id: "e1", source: "api", target: "assets" }],
			}),
		);
		const exported = convertSceneToExcalidraw(scene);
		expect(validateExcalidrawScene(exported).issues).toEqual([]);
		const box = exported.elements.find((element) => element.id === "node:assets")!;
		const arrow = exported.elements.find((element) => element.id === "edge:e1")!;
		const points = arrow["points"] as [number, number][];
		const end = points.at(-1)!;
		// The line ends in from the box, on the side the bucket leans in by.
		expect((arrow["x"] as number) + end[0]).toBeGreaterThan((box["x"] as number) + 1);
		// Stopped at the box's edge instead, it no longer lands on the shape.
		const short = {
			...arrow,
			points: [...points.slice(0, -1), [(box["x"] as number) - (arrow["x"] as number), end[1]]],
		};
		expect(
			validateExcalidrawScene({
				...exported,
				elements: exported.elements.map((element) => (element.id === "edge:e1" ? short : element)),
			}).issues.map((issue) => issue.code),
		).toContain("arrow-endpoint-off-shape");
	});

	it("exports queues and documents as valid composed shapes", () => {
		const hybrid = convertSceneToExcalidraw(
			renderIntermediateDiagram(zoneFixtures["hybrid-cloud"]),
		);
		const shapes = new Map(
			hybrid.elements.flatMap((element) =>
				element.customData && typeof element.customData === "object"
					? [[element.id, (element.customData as Record<string, unknown>)["sketchiShape"]]]
					: [],
			),
		);
		expect(shapes.get("node:orders")).toBe("pipe");
		expect(shapes.get("node:invoice")).toBe("document");
		expect(validateExcalidrawScene(hybrid).issues).toEqual([]);
	});
});

describe("chart marks", () => {
	const chart = (input: object) =>
		renderChartDiagram(parseChartDiagram({ id: "chart", title: "Chart", type: "chart", ...input }));

	it("exports bars with square corners and no generated labels", () => {
		const converted = convertSceneToExcalidraw(
			chart({ kind: "bar", categories: ["A", "B"], series: [{ values: [3, -2] }] }),
		);
		expect(validateExcalidrawScene(converted)).toEqual({ ok: true, issues: [] });
		const bars = converted.elements.filter((element) => element.id.startsWith("node:chart:bar:"));
		expect(bars).toHaveLength(2);
		for (const bar of bars) {
			expect(bar.type).toBe("rectangle");
			expect(bar.roundness).toBeNull();
			expect(bar.roughness).toBe(0);
			expect(bar.boundElements).toBeNull();
			expect(bar.customData).toEqual({ sketchiRendererRole: "chart-mark" });
		}
		expect(
			converted.elements.some((element) => element.id.includes("__sketchi_node_label__")),
		).toBe(false);
	});

	it("exports pie slices as closed filled polygons that keep their role", () => {
		const converted = convertSceneToExcalidraw(
			chart({ kind: "pie", donut: true, categories: ["A", "B"], series: [{ values: [3, 1] }] }),
		);
		expect(validateExcalidrawScene(converted)).toEqual({ ok: true, issues: [] });
		const slices = converted.elements.filter((element) =>
			element.id.startsWith("node:chart:slice:"),
		);
		expect(slices).toHaveLength(2);
		for (const slice of slices) {
			const points = slice.points as [number, number][];
			expect(slice.type).toBe("line");
			expect(slice.roundness).toBeNull();
			expect(points[0]).toEqual(points.at(-1));
			expect(slice.backgroundColor).not.toBe("transparent");
			expect(slice.customData).toEqual({
				sketchiShape: "polygon",
				sketchiRendererRole: "chart-mark",
			});
		}
	});
});

describe("entity tables and crow's-foot ends", () => {
	/** Two tables a relationship joins row to row, an optional end ringed on its line. */
	const scene: CanvasSpec = {
		kind: "canvas",
		version: 1,
		diagramId: "tables",
		title: "Tables",
		width: 700,
		height: 300,
		accentColor: "#8f707f",
		backgroundColor: "#fffdf8",
		elements: [
			...(["customers", "orders"] as const).flatMap((id, index) => {
				const x = 40 + index * 400;
				return [
					{
						type: "node" as const,
						id: `node:${id}`,
						nodeId: id,
						rendererRole: "er-table" as const,
						shape: "rectangle" as const,
						x,
						y: 40,
						width: 200,
						height: 108,
						label: id,
						groupIds: [`table:${id}`],
					},
					{
						type: "node" as const,
						id: `node:${id}:header`,
						nodeId: `${id}:header`,
						rendererRole: "er-table" as const,
						shape: "rectangle" as const,
						x,
						y: 40,
						width: 200,
						height: 40,
						label: id,
						fillColor: "#efe6ec",
						groupIds: [`table:${id}`],
					},
					{
						type: "text" as const,
						id: `label:${id}:header`,
						containerId: `node:${id}:header`,
						x: x + 100,
						y: 60,
						text: id,
						fontSize: 16,
						maxWidth: 172,
						groupIds: [`table:${id}`],
					},
					{
						type: "text" as const,
						id: `text:${id}:fields`,
						x: x + 14 + 40,
						y: 86 + 28,
						text: "id\ncustomer_id",
						fontSize: 14,
						lineHeight: 2,
						textAlign: "left" as const,
						maxWidth: 80,
						groupIds: [`table:${id}`],
					},
				];
			}),
			{
				type: "arrow",
				id: "edge:places",
				edgeId: "places",
				sourceNodeId: "customers",
				targetNodeId: "orders",
				startArrowhead: "crowfoot_one",
				endArrowhead: "crowfoot_many",
				points: [
					{ x: 240, y: 100 },
					{ x: 440, y: 100 },
				],
			},
			{
				type: "node",
				id: "node:orders:optional:0",
				nodeId: "orders:optional:0",
				rendererRole: "er-optional",
				shape: "circle",
				x: 402,
				y: 94,
				width: 12,
				height: 12,
				label: "Optional end",
				fillColor: "#fffdf8",
				fillStyle: "solid",
				groupIds: ["table:orders"],
			},
		],
		layers: [],
		layouts: [],
		zOrder: [],
	};
	const exported = () => {
		const withOrder = { ...scene, zOrder: scene.elements.map((element) => element.id) };
		expect(getCanvasValidationIssues(withOrder)).toEqual([]);
		return convertSceneToExcalidraw(withOrder);
	};
	const element = (id: string) => exported().elements.find((candidate) => candidate.id === id)!;

	it("keeps a table's outline and name band square, so the band fills its top", () => {
		expect(element("node:orders")).toMatchObject({ type: "rectangle", roundness: null });
		expect(element("node:orders:header")).toMatchObject({ type: "rectangle", roundness: null });
	});

	it("exports crow's-foot heads and binds a straight line to its rows as an elbow arrow", () => {
		const arrow = element("edge:places");
		expect(arrow).toMatchObject({
			startArrowhead: "crowfoot_one",
			endArrowhead: "crowfoot_many",
			elbowed: true,
		});
		// The row sits 60 of the table's 108 units down; a moved table keeps it there.
		expect((arrow["startBinding"] as { fixedPoint: number[] }).fixedPoint).toEqual([1, 60 / 108]);
		expect((arrow["endBinding"] as { fixedPoint: number[] }).fixedPoint).toEqual([0, 60 / 108]);
	});

	it("keeps a column's rows at its line height", () => {
		expect(element("text:orders:fields")).toMatchObject({
			lineHeight: 2,
			height: 2 * 14 * 2,
			y: 114 - 28,
			textAlign: "left",
		});
	});

	it("lets a line cross the ring of its own optional end and nothing else", () => {
		expect(validateExcalidrawScene(exported())).toEqual({ ok: true, issues: [] });
	});
});
