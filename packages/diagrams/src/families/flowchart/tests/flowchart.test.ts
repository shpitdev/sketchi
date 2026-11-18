// Positive fixtures deliberately unwrap Results: failure here is invalid test data, not user input.
import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { embedCanvasIcons, type CanvasShapeElement } from "@sketchi/drawing";
import { convertSceneToExcalidraw, validateExcalidrawScene } from "@sketchi/drawing/excalidraw";

import {
	decodeFlowchartDocument,
	FLOWCHART_MAX_NODES,
	FlowchartDiagram,
	flowchartDiagramFromDocument,
	flowchartDocumentPairCount,
	type FlowchartDocument,
	FlowchartValidationIssueCodeSchema,
	getFlowchartValidationIssues,
} from "../document";
import { applyFlowchartEdits, type FlowchartEdit } from "../edits";
import { deployPipelineLogoFlowchart, flowchartFixture } from "../fixtures/index";
import { renderFlowchartDiagram } from "../render";

const waitlist: FlowchartDocument = {
	title: "Restaurant waitlist",
	nodes: {
		arrive: "Party arrives",
		quote: "Quote wait time",
		available: "Table available?",
		seat: "Seat party",
		waitlist: "Add party to waitlist",
		responds: "Party responds?",
		remove: "Remove party from list",
		ready: "Table ready?",
		wait: "Keep waiting",
	},
	edges: [
		["arrive", "quote"],
		["quote", "available"],
		["available", "seat", "yes"],
		["available", "waitlist", "no"],
		["waitlist", "responds"],
		["responds", "remove", "no"],
		["responds", "ready", "yes"],
		["ready", "seat", "yes"],
		["ready", "wait", "no"],
		["wait", "responds"],
	],
};

const order: FlowchartDocument = {
	title: "Order",
	nodes: {
		place: "Place order",
		review: "Review order",
		approved: "Approved?",
		pay: "Take payment",
		wait: "Keep waiting",
		cancel: "Cancel order",
	},
	edges: [
		["place", "review"],
		["review", "approved"],
		["approved", "pay", "yes"],
		["approved", "wait", "no"],
		["wait", "review"],
		["approved", "cancel", "cancelled"],
	],
};

function apply(document: FlowchartDocument, edits: readonly FlowchartEdit[]) {
	const result = applyFlowchartEdits(document, edits);
	if (!result.ok) throw new Error(result.issues.map((issue) => issue.message).join("\n"));
	return result.document;
}

describe("flowchart documents", () => {
	it("decode, build with roles read from the edges, and export a valid Excalidraw file", () => {
		expect(Result.isSuccess(decodeFlowchartDocument(waitlist))).toBe(true);
		const result = flowchartDiagramFromDocument(waitlist);
		if (!result.ok) throw new Error(result.issues.map((issue) => issue.message).join("\n"));
		const kinds = Object.fromEntries(result.diagram.nodes.map((node) => [node.id, node.kind]));
		expect(kinds).toEqual({
			arrive: "start",
			quote: "process",
			available: "decision",
			seat: "end",
			waitlist: "process",
			responds: "decision",
			remove: "end",
			ready: "decision",
			wait: "process",
		});
		const excalidraw = convertSceneToExcalidraw(renderFlowchartDiagram(result.diagram));
		expect(validateExcalidrawScene(excalidraw)).toEqual({ ok: true, issues: [] });
		expect(excalidraw.elements.filter((element) => element.type === "arrow")).toHaveLength(
			waitlist.edges.length,
		);
	});

	it("resolves unique spelling variants in list-ended edges and nested group members", () => {
		const result = flowchartDiagramFromDocument({
			title: "Review",
			nodes: { submit_form: "Submit", review_form: "Review", issue_permit: "Issue" },
			edges: [
				[["SUBMIT FORM,"], "review-form"],
				["review_form", "issue-permit."],
			],
			groups: {
				applicant_team: { label: "Applicant", contains: ["submit-form"] },
				office: { label: "Office", contains: ["review form", "issue_permit"] },
				process: { label: "Process", contains: ["APPLICANT TEAM;", "office"] },
			},
		});
		if (!result.ok) throw new Error(result.issues.map((issue) => issue.message).join("\n"));
		expect(result.diagram.edges.map(({ source, target }) => [source, target])).toEqual([
			["submit_form", "review_form"],
			["review_form", "issue_permit"],
		]);
		expect(result.diagram.nodes.find(({ id }) => id === "submit_form")?.group).toBe(
			"applicant_team",
		);
		expect(result.diagram.groups?.find(({ id }) => id === "applicant_team")?.parent).toBe(
			"process",
		);
	});

	it("refuses an ambiguous spelling instead of binding it to either node", () => {
		const result = flowchartDiagramFromDocument({
			title: "Review",
			nodes: { start: "Start", review_form: "Review one", "review-form": "Review two" },
			edges: [["start", "REVIEW FORM,"]],
			groups: { team: { label: "Team", contains: ["REVIEW FORM"] } },
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.issues.map((issue) => issue.code)).toEqual(
			expect.arrayContaining(["missing_edge_target", "unknown_member"]),
		);
	});

	it("counts list-ended edges without expanding them, and refuses past the limit", () => {
		const ids = (prefix: string) => Array.from({ length: 300 }, (_, index) => `${prefix}${index}`);
		const edges: FlowchartDocument["edges"] = [
			[ids("a"), ids("b")],
			["x", ["y", "z"]],
		];
		expect(flowchartDocumentPairCount(edges)).toBe(90_002);
		const result = flowchartDiagramFromDocument({
			title: "Fan out",
			nodes: { x: "X", y: "Y" },
			edges,
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.issues.map((issue) => issue.code)).toEqual(["flowchart_too_large"]);
	});
});

describe("flowchart edits", () => {
	it("inserts a node into an edge, keeping the edge's label on the way in", () => {
		const edited = apply(order, [
			{ op: "insert", node: { card: "Check card" }, between: ["approved", "pay"] },
		]);
		expect(edited.edges).toContainEqual(["approved", "card", "yes"]);
		expect(edited.edges).toContainEqual(["card", "pay"]);
		expect(edited.edges).not.toContainEqual(["approved", "pay", "yes"]);
		expect(flowchartDiagramFromDocument(edited).ok).toBe(true);
	});

	it("removes a node, joining its one way in to its one way out", () => {
		const edited = apply(order, [{ op: "set", nodes: { wait: null } }]);
		expect(edited.nodes).not.toHaveProperty("wait");
		expect(edited.edges).toContainEqual(["approved", "review", "no"]);
		expect(edited.edges.some((edge) => edge.includes("wait"))).toBe(false);
		expect(flowchartDiagramFromDocument(edited).ok).toBe(true);
	});

	it("connects new edges, relabels existing ones and disconnects", () => {
		const edited = apply(order, [
			{
				op: "connect",
				edges: [
					["approved", "pay", "approved"],
					[["pay", "cancel"], "place"],
				],
			},
			{ op: "disconnect", edges: [["wait", "review"]] },
		]);
		expect(edited.edges).toContainEqual(["approved", "pay", "approved"]);
		expect(edited.edges).toContainEqual(["pay", "place"]);
		expect(edited.edges).toContainEqual(["cancel", "place"]);
		expect(edited.edges).not.toContainEqual(["wait", "review"]);
	});

	it("refuses list ends that would draw too many edges, before expanding them", () => {
		const ids = Array.from({ length: 200 }, (_, index) => `n${index}`);
		const result = applyFlowchartEdits(order, [{ op: "connect", edges: [[ids, ids]] }]);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.issues.map((issue) => [issue.code, issue.path])).toEqual([
			["invalid_edit", "edits[0].edges"],
		]);
	});

	it("names an unknown target at its path and applies nothing", () => {
		const result = applyFlowchartEdits(order, [
			{ op: "set", nodes: { pay: "Charge card" } },
			{ op: "insert", node: { x: "X" }, between: ["reveiw", "pay"] },
			{ op: "disconnect", edges: [["place", "cancel"]] },
		]);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.issues.map((issue) => [issue.code, issue.path])).toEqual([
			["unknown_edit_target", "edits[1].between[0]"],
			["unknown_edit_target", "edits[2].edges[0]"],
		]);
		expect(result).not.toHaveProperty("document");
	});
});

// Plain input objects: each case is decoded, so it omits defaulted fields such as metadata.
type Node = { readonly id: string; readonly kind?: string } & Record<string, unknown>;
type Edge = { readonly id: string; readonly source: string; readonly target: string } & Record<
	string,
	unknown
>;
type Canonical = { readonly nodes?: readonly Node[]; readonly edges?: readonly Edge[] } & Record<
	string,
	unknown
>;
const fixtureNodes: readonly Node[] = flowchartFixture.nodes;
const fixtureEdges: readonly Edge[] = flowchartFixture.edges;

const nodes = (change: (node: Node) => Node) => fixtureNodes.map(change);
const withKind = (id: string, kind: string) =>
	nodes((node) => (node.id === id ? { ...node, kind } : node));
const withEdges = (...edges: Edge[]) => [...fixtureEdges, ...edges];
const withoutEdge = (id: string) => fixtureEdges.filter((edge) => edge.id !== id);
const relabel = (id: string, label: string | undefined) =>
	flowchartFixture.edges.map((edge) => (edge.id === id ? { ...edge, label } : edge));
const inGroup = (group: string) =>
	nodes((node) => (node.id === "draft" ? { ...node, group } : node));

/** One minimal bad canonical diagram per code the validator owns. */
const canonical: Record<string, Canonical> = {
	duplicate_node_id: { nodes: [...flowchartFixture.nodes, flowchartFixture.nodes[3]!] },
	duplicate_edge_id: {
		edges: withEdges({ id: "draft-review", source: "requirements", target: "draft" }),
	},
	missing_edge_source: {
		edges: withEdges({ id: "ghost-review", source: "ghost", target: "review" }),
	},
	missing_edge_target: {
		edges: withEdges({ id: "draft-ghost", source: "draft", target: "ghost" }),
	},
	self_loop: { edges: withEdges({ id: "draft-draft", source: "draft", target: "draft" }) },
	missing_start: { nodes: withKind("prompt", "process") },
	multiple_starts: { nodes: withKind("requirements", "start") },
	missing_end: { nodes: withKind("review", "process") },
	start_has_incoming: {
		edges: withEdges({ id: "draft-prompt", source: "draft", target: "prompt" }),
	},
	end_has_outgoing: { edges: withEdges({ id: "review-draft", source: "review", target: "draft" }) },
	unreachable_node: {
		nodes: [...flowchartFixture.nodes, { id: "orphan", label: "Orphan step", kind: "process" }],
		edges: withEdges({ id: "orphan-review", source: "orphan", target: "review" }),
	},
	missing_outgoing_edge: { edges: withoutEdge("draft-review") },
	underbranched_decision: { edges: withoutEdge("clear-review") },
	unlabeled_decision_branch: { edges: relabel("clear-draft", undefined) },
	duplicate_decision_branch_label: { edges: relabel("clear-review", "yes") },
	nonterminating_node: {
		nodes: [
			...flowchartFixture.nodes,
			{ id: "x", label: "Retry x", kind: "process" },
			{ id: "y", label: "Retry y", kind: "process" },
		],
		edges: withEdges(
			{ id: "draft-x", source: "draft", target: "x" },
			{ id: "x-y", source: "x", target: "y" },
			{ id: "y-x", source: "y", target: "x" },
		),
	},
	duplicate_group_id: {
		groups: [
			{ id: "team", label: "Team" },
			{ id: "team", label: "Twice" },
		],
		nodes: inGroup("team"),
	},
	unknown_node_group: { groups: [{ id: "team", label: "Team" }], nodes: inGroup("nope") },
	empty_group: {
		groups: [
			{ id: "team", label: "Team" },
			{ id: "spare", label: "Spare" },
		],
		nodes: inGroup("team"),
	},
	unknown_group_parent: {
		groups: [{ id: "team", label: "Team", parent: "cloud" }],
		nodes: inGroup("team"),
	},
	group_cycle: { groups: [{ id: "team", label: "Team", parent: "team" }], nodes: inGroup("team") },
	shaped_decision: {
		nodes: nodes((node) => (node.id === "clear" ? { ...node, shape: "queue" } : node)),
	},
	duplicate_lane_id: {
		lanes: [
			{ id: "author", label: "Author" },
			{ id: "author", label: "Twice" },
		],
		nodes: nodes((node) => ({ ...node, lane: "author" })),
	},
	unknown_node_lane: {
		nodes: nodes((node) => (node.id === "review" ? { ...node, lane: "nope" } : node)),
	},
	lanes_with_groups: {
		lanes: [{ id: "author", label: "Author" }],
		groups: [{ id: "team", label: "Team" }],
		nodes: nodes((node) => ({ ...node, lane: "author", group: "team" })),
	},
};

/** Codes only an authored document can raise, before it becomes a canonical diagram. */
const documents: Record<string, FlowchartDocument> = {
	invalid_id: { title: "Ids", nodes: { "1x": "Bad id", b: "B" }, edges: [["1x", "b"]] },
	duplicate_edge: {
		title: "Twice",
		nodes: { a: "A", b: "B" },
		edges: [
			["a", "b"],
			["a", "b"],
		],
	},
	isolated_node: { title: "Lone", nodes: { a: "A", b: "B", lone: "Lone" }, edges: [["a", "b"]] },
	unknown_member: {
		title: "Members",
		nodes: { a: "A", b: "B" },
		edges: [["a", "b"]],
		groups: { team: { label: "Team", contains: ["a", "ghost"] } },
	},
	overlapping_containers: {
		title: "Overlap",
		nodes: { a: "A", b: "B", c: "C" },
		edges: [
			["a", "b"],
			["b", "c"],
		],
		groups: {
			left: { label: "Left", contains: ["a", "b"] },
			right: { label: "Right", contains: ["b", "c"] },
		},
	},
	node_without_lane: {
		title: "Lanes",
		lanes: { author: "Author" },
		nodes: { a: { label: "A", lane: "author" }, b: "B" },
		edges: [["a", "b"]],
	},
	flowchart_too_small: { title: "One", nodes: { a: "A" }, edges: [] },
	flowchart_too_large: {
		title: "Too many",
		nodes: Object.fromEntries(
			Array.from({ length: FLOWCHART_MAX_NODES + 1 }, (_, index) => [`n${index}`, `Step ${index}`]),
		),
		edges: Array.from({ length: FLOWCHART_MAX_NODES }, (_, index) => [
			`n${index}`,
			`n${index + 1}`,
		]),
	},
};

describe("flowchart validator", () => {
	it("covers every issue code it can raise", () => {
		expect(new Set([...Object.keys(canonical), ...Object.keys(documents)])).toEqual(
			new Set(FlowchartValidationIssueCodeSchema.literals),
		);
	});

	it.each(Object.entries(canonical))("raises %s for a minimal bad diagram", (code, change) => {
		// @effect-diagnostics-next-line schemaSync:off -- Decode an authored fixture synchronously so invalid test input fails at setup.
		const diagram = Schema.decodeUnknownSync(FlowchartDiagram)({ ...flowchartFixture, ...change });
		expect(getFlowchartValidationIssues(diagram).map((issue) => issue.code)).toContain(code);
	});

	it.each(Object.entries(documents))("raises %s for a minimal bad document", (code, document) => {
		const result = flowchartDiagramFromDocument(document);
		expect(result.ok ? [] : result.issues.map((issue) => issue.code)).toContain(code);
	});
});

const svgFor = (slug: string) =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><title>${slug}</title></svg>`;

function logoScene() {
	return embedCanvasIcons(renderFlowchartDiagram(deployPipelineLogoFlowchart), (slug) => ({
		name: slug,
		svg: svgFor(slug),
	})).scene;
}

describe("node logos in Excalidraw output", () => {
	it("emits one image per logo node backed by an SVG file", () => {
		const scene = logoScene();
		const excalidraw = convertSceneToExcalidraw(scene);
		const logoNodes = scene.elements.filter(
			(element): element is CanvasShapeElement =>
				element.type === "node" && element.icon !== undefined,
		);
		const images = excalidraw.elements.filter((element) => element.type === "image");
		expect(images.map((image) => image.id)).toEqual(
			logoNodes.map((node) => `node-${node.nodeId}-icon`),
		);
		for (const image of images)
			expect(excalidraw.files?.[String(image.fileId)]).toMatchObject({
				id: image.fileId,
				mimeType: "image/svg+xml",
			});
		expect(validateExcalidrawScene(excalidraw)).toEqual({ ok: true, issues: [] });
	});

	it.each(["constructor", "toString", "__proto__"])(
		"neither paints nor accepts a logo named after the prototype member %s",
		(slug) => {
			const scene = logoScene();
			const excalidraw = convertSceneToExcalidraw({
				...scene,
				elements: scene.elements.map((element) =>
					element.type === "node" && element.nodeId === "build"
						? { ...element, icon: { slug, size: 28 } }
						: element,
				),
			});
			expect(excalidraw.elements.filter((element) => element.type === "image")).toHaveLength(3);
			expect(validateExcalidrawScene(excalidraw).ok).toBe(true);

			const valid = convertSceneToExcalidraw(scene);
			const image = valid.elements.find((element) => element.type === "image")!;
			const issues = validateExcalidrawScene({
				...valid,
				elements: valid.elements.map((element) =>
					element === image ? { ...element, fileId: slug } : element,
				),
			}).issues;
			expect(issues.map((issue) => [issue.code, issue.elementId])).toEqual([
				["missing-image-file", image.id],
			]);
		},
	);
});
