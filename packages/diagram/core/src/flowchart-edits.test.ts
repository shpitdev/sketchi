import { Result } from "effect";
import { describe, expect, it } from "vitest";

import { flowchartDiagramFromDocument, type FlowchartDocument } from "./flowchart-document";
import { applyFlowchartEdits, decodeFlowchartEdits, type FlowchartEdit } from "./flowchart-edits";

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

describe("flowchart edits", () => {
	it("decode the four ops", () => {
		const decoded = decodeFlowchartEdits([
			{ op: "insert", node: { fraud: "Check for fraud" }, between: ["review", "approved"] },
			{ op: "set", nodes: { pay: { note: "Card" }, wait: null } },
			{ op: "connect", edges: [["fraud", "cancel", "flagged"]] },
			{ op: "disconnect", edges: [["approved", "cancel"]] },
		]);
		expect(Result.isSuccess(decoded)).toBe(true);
		expect(Result.isFailure(decodeFlowchartEdits([{ op: "rename", id: "a" }]))).toBe(true);
	});

	it("inserts a node into an edge, keeping the edge's label on the way in", () => {
		const edited = apply(order, [
			{ op: "insert", node: { card: "Check card" }, between: ["approved", "pay"] },
		]);
		expect(Object.keys(edited.nodes)).toEqual([
			"place",
			"review",
			"approved",
			"card",
			"pay",
			"wait",
			"cancel",
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

	it("merges node changes and leaves everything else as it was", () => {
		const edited = apply(order, [
			{
				op: "set",
				title: "Orders",
				nodes: { pay: { note: "Card or cash" }, place: "Customer orders" },
			},
			{ op: "set", nodes: { pay: { note: null, shape: "database" }, refund: "Refund" } },
			{ op: "connect", edges: [["cancel", "refund"]] },
		]);
		expect(edited.title).toBe("Orders");
		expect(edited.nodes.pay).toEqual({ label: "Take payment", shape: "database" });
		expect(edited.nodes.place).toBe("Customer orders");
		expect(edited.nodes.refund).toBe("Refund");
		expect(edited.edges.slice(0, 5)).toEqual(order.edges.slice(0, 5));
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

	it("keeps one authored fan-out branch valid through title, insert and remove edits", () => {
		const document: FlowchartDocument = {
			title: "Stock",
			nodes: {
				question: "Stock short?",
				notify: "Notify customer",
				reorder: "Reorder stock",
				done: "Ship order",
			},
			edges: [
				["question", ["notify", "reorder"], "yes"],
				["question", "done", "no"],
			],
		};
		expect(flowchartDiagramFromDocument(document).ok).toBe(true);
		const renamed = apply(document, [{ op: "set", title: "Stock check" }]);
		expect(flowchartDiagramFromDocument(renamed).ok).toBe(true);
		const inserted = apply(renamed, [
			{ op: "insert", node: { audit: "Record notice" }, between: ["question", "notify"] },
		]);
		expect(flowchartDiagramFromDocument(inserted).ok).toBe(true);
		const removed = apply(inserted, [{ op: "set", nodes: { audit: null } }]);
		expect(removed.edges).toEqual(renamed.edges);
		expect(flowchartDiagramFromDocument(removed).ok).toBe(true);
		const disconnected = apply(removed, [
			{ op: "disconnect", edges: [["question", "notify"]] },
			{ op: "set", nodes: { notify: null } },
		]);
		expect(disconnected.edges).toContainEqual(["question", "reorder", "yes"]);
		expect(flowchartDiagramFromDocument(disconnected).ok).toBe(true);
	});

	it("keeps list-ended connect as one branch across later edits and extensions", () => {
		const document: FlowchartDocument = {
			title: "Stock",
			nodes: {
				question: "Stock short?",
				notify: "Notify customer",
				reorder: "Reorder stock",
				done: "Ship order",
			},
			edges: [
				["question", "notify", "yes"],
				["question", "done", "no"],
			],
		};
		const connected = apply(document, [
			{ op: "connect", edges: [["question", ["notify", "reorder"], "yes"]] },
		]);
		expect(flowchartDiagramFromDocument(connected).ok).toBe(true);
		const renamed = apply(connected, [
			{ op: "set", title: "Stock check" },
			{ op: "connect", edges: [["question", "notify", "yes"]] },
		]);
		expect(renamed.edges).toEqual(connected.edges);
		expect(flowchartDiagramFromDocument(renamed).ok).toBe(true);
		const extended = apply(renamed, [
			{ op: "set", nodes: { track: "Track stock" } },
			{ op: "connect", edges: [["question", ["notify", "track"], "yes"]] },
		]);
		expect(extended.edges).toContainEqual(["question", ["notify", "reorder", "track"], "yes"]);
		expect(flowchartDiagramFromDocument(extended).ok).toBe(true);
	});

	it("moves a fan-out target to another branch and matches branch labels without case", () => {
		const document: FlowchartDocument = {
			title: "Stock",
			nodes: { question: "Stock short?", notify: "Notify", reorder: "Reorder", done: "Done" },
			edges: [
				["question", ["notify", "reorder"], "yes"],
				["question", "done", "no"],
			],
		};
		const same = apply(document, [{ op: "connect", edges: [["question", "reorder", "Yes"]] }]);
		expect(same.edges).toEqual(document.edges);
		expect(flowchartDiagramFromDocument(same).ok).toBe(true);
		const moved = apply(document, [
			{ op: "connect", edges: [["question", "reorder", "no"]] },
			{ op: "connect", edges: [["question", "done", "No"]] },
		]);
		expect(moved.edges).toContainEqual(["question", "notify", "yes"]);
		expect(moved.edges).toContainEqual(["question", ["reorder", "done"], "no"]);
		expect(flowchartDiagramFromDocument(moved).ok).toBe(true);
	});

	it("allows a same-set deletion of the label-only group its removed node already pruned", () => {
		const document: FlowchartDocument = {
			title: "Office",
			nodes: { a: "A", b: "B", c: { label: "C", group: "office" } },
			edges: [
				["a", "b"],
				["b", "c"],
			],
			groups: { office: { label: "Office" } },
		};
		const result = apply(document, [{ op: "set", nodes: { c: null }, groups: { office: null } }]);
		expect(result.groups).toBeUndefined();
		expect(flowchartDiagramFromDocument(result).ok).toBe(true);
		expect(applyFlowchartEdits(document, [{ op: "set", groups: { missing: null } }]).ok).toBe(
			false,
		);
	});

	it("does not merge independently authored branches that repeat a label", () => {
		const edited = apply(
			{
				title: "Stock",
				nodes: { question: "Stock short?", notify: "Notify customer", reorder: "Reorder stock" },
				edges: [
					["question", "notify", "yes"],
					["question", "reorder", "yes"],
				],
			},
			[{ op: "set", title: "Still invalid" }],
		);
		const built = flowchartDiagramFromDocument(edited);
		expect(built.ok).toBe(false);
		if (!built.ok)
			expect(built.issues.some(({ code }) => code === "duplicate_decision_branch_label")).toBe(
				true,
			);
	});

	it("refuses list ends that would draw too many edges, before expanding them", () => {
		const ids = Array.from({ length: 200 }, (_, index) => `n${index}`);
		const result = applyFlowchartEdits(order, [{ op: "connect", edges: [[ids, ids]] }]);
		expect(result).toEqual({
			ok: false,
			issues: [
				expect.objectContaining({
					code: "invalid_edit",
					path: "edits[0].edges",
					message: "edits[0].edges names 40000 edges; a flowchart draws at most 120.",
				}),
			],
		});
	});

	it("names an unknown target at its path and applies nothing", () => {
		const result = applyFlowchartEdits(order, [
			{ op: "set", nodes: { pay: "Charge card" } },
			{ op: "insert", node: { x: "X" }, between: ["reveiw", "pay"] },
			{ op: "insert", node: { y: "Y" }, between: ["place", "pay"] },
			{ op: "disconnect", edges: [["place", "cancel"]] },
			{ op: "set", nodes: { ghost: null, fresh: { note: "no label" } } },
		]);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.issues.map((issue) => [issue.code, issue.path])).toEqual([
			["unknown_edit_target", "edits[1].between[0]"],
			["unknown_edit_target", "edits[2].between"],
			["unknown_edit_target", "edits[3].edges[0]"],
			["unknown_edit_target", "edits[4].nodes.ghost"],
			["invalid_edit", "edits[4].nodes.fresh"],
		]);
		expect(result.issues[0]?.hint).toContain('"review"');
	});

	it("keeps an inserted node in the lane of the step before it and in the groups around both ends", () => {
		const laned = apply(
			{
				title: "Hiring",
				nodes: {
					apply: { label: "Apply", lane: "candidate" },
					screen: { label: "Screen", lane: "recruiter" },
					offer: { label: "Offer", lane: "recruiter" },
				},
				edges: [
					["apply", "screen"],
					["screen", "offer"],
				],
				lanes: { candidate: "Candidate", recruiter: "Recruiter" },
			},
			[{ op: "insert", node: { call: "Phone call" }, between: ["screen", "offer"] }],
		);
		expect(laned.nodes["call"]).toEqual({ label: "Phone call", lane: "recruiter" });
		// A lane edit is a node change; a lane's own entry only names it.
		const moved = apply(laned, [
			{ op: "set", nodes: { offer: { lane: "candidate" } }, lanes: { recruiter: "Recruiting" } },
		]);
		expect(moved.nodes["offer"]).toEqual({ label: "Offer", lane: "candidate" });
		expect(moved.lanes).toEqual({ candidate: "Candidate", recruiter: "Recruiting" });
		const grouped = apply(
			{
				title: "Zones",
				nodes: { a: "A", b: "B", c: "C" },
				edges: [
					["a", "b"],
					["b", "c"],
				],
				groups: { vpc: { label: "VPC", contains: ["b", "c"] } },
			},
			[
				{ op: "insert", node: { waf: "WAF" }, between: ["b", "c"] },
				{ op: "insert", node: { cdn: "CDN" }, between: ["a", "b"] },
			],
		);
		expect(grouped.groups?.vpc?.contains).toEqual(["b", "c", "waf"]);
	});

	it("keeps node-group ownership through inserts, moves and removal of groups or their last nodes", () => {
		const document: FlowchartDocument = {
			title: "Teams",
			nodes: {
				a: { label: "A", group: "team" },
				b: { label: "B", group: "team" },
				c: { label: "C", group: "office" },
			},
			edges: [
				["a", "b"],
				["b", "c"],
			],
			groups: {
				outer: { label: "Workflow", contains: ["team"] },
				team: { label: "Team" },
				office: { label: "Office" },
			},
		};
		const inserted = apply(document, [{ op: "insert", node: { x: "X" }, between: ["a", "b"] }]);
		expect(inserted.nodes.x).toEqual({ label: "X", group: "team" });
		expect(flowchartDiagramFromDocument(inserted).ok).toBe(true);
		const moved = apply(inserted, [
			{ op: "set", nodes: { x: { group: "audit" } }, groups: { audit: { label: "Audit" } } },
		]);
		expect(flowchartDiagramFromDocument(moved).ok).toBe(true);
		const ungrouped = apply(moved, [{ op: "set", groups: { team: null } }]);
		expect(ungrouped.nodes.a).toEqual({ label: "A", group: "outer" });
		expect(flowchartDiagramFromDocument(ungrouped).ok).toBe(true);
		const pruned = apply(ungrouped, [{ op: "set", nodes: { a: null, b: null } }]);
		expect(pruned.groups).not.toHaveProperty("outer");
		expect(flowchartDiagramFromDocument(pruned).ok).toBe(true);
	});

	it("does not prune a group added for a later edit when removing an unrelated node", () => {
		const edited = apply(
			{
				title: "Teams",
				nodes: { a: "A", b: "B", c: "C" },
				edges: [
					["a", "b"],
					["b", "c"],
				],
				groups: { team: { label: "Team", contains: ["a", "b"] } },
			},
			[
				{ op: "set", groups: { next: { label: "Next team" } } },
				{ op: "set", nodes: { c: null } },
				{ op: "set", nodes: { b: { group: "next" } }, groups: { team: { contains: ["a"] } } },
			],
		);
		expect(edited.groups).toHaveProperty("next");
		expect(flowchartDiagramFromDocument(edited).ok).toBe(true);
	});

	it("moves members between containers and removes a container without losing what it held", () => {
		const document: FlowchartDocument = {
			title: "Zones",
			nodes: { a: "A", b: "B", c: "C" },
			edges: [
				["a", "b"],
				["b", "c"],
			],
			groups: {
				region: { label: "Region", contains: ["vpc", "c"] },
				vpc: { label: "VPC", contains: ["a", "b"] },
			},
		};
		const moved = apply(document, [
			{
				op: "set",
				groups: { vpc: { contains: ["a"] }, dmz: { label: "DMZ", kind: "zone", contains: ["b"] } },
			},
		]);
		expect(moved.groups?.dmz).toEqual({ label: "DMZ", kind: "zone", contains: ["b"] });
		expect(moved.groups?.vpc?.contains).toEqual(["a"]);
		const removed = apply(document, [{ op: "set", groups: { vpc: null } }]);
		expect(removed.groups).toEqual({ region: { label: "Region", contains: ["a", "b", "c"] } });
	});

	it("removes groups a removal empties, and the ancestors they empty in turn", () => {
		const edited = apply(
			{
				title: "Nested",
				nodes: { a: "A", b: "B", c: "C" },
				edges: [
					["a", "b"],
					["b", "c"],
				],
				groups: {
					outer: { label: "Outer", contains: ["inner", "c"] },
					inner: { label: "Inner", contains: ["b"] },
					lone: { label: "Lone", contains: ["only"] },
					only: { label: "Only", contains: ["a"] },
				},
			},
			[{ op: "set", nodes: { b: null, a: null } }],
		);
		expect(edited.groups).toEqual({ outer: { label: "Outer", contains: ["c"] } });
		expect(
			flowchartDiagramFromDocument({
				...edited,
				nodes: { ...edited.nodes, d: "D" },
				edges: [["c", "d"]],
			}).ok,
		).toBe(true);
	});

	it("puts an inserted node in the innermost group around both ends, by the derived tree", () => {
		const edited = apply(
			{
				title: "Nested",
				nodes: { a: "A", b: "B", c: "C" },
				edges: [
					["a", "b"],
					["b", "c"],
				],
				groups: {
					outer: { label: "Outer", contains: ["inner", "c"] },
					inner: { label: "Inner", contains: ["a", "b"] },
				},
			},
			[{ op: "insert", node: { x: "X" }, between: ["b", "c"] }],
		);
		expect(edited.groups?.outer?.contains).toEqual(["inner", "c", "x"]);
		expect(edited.groups?.inner?.contains).toEqual(["a", "b"]);
		const built = flowchartDiagramFromDocument(edited);
		expect(built.ok && built.diagram.nodes.find((node) => node.id === "x")?.group).toBe("outer");
	});

	it("splits a list-end edge once it is edited", () => {
		const edited = apply(
			{
				title: "Fan in",
				nodes: { web: "Web", api: "API", db: "DB" },
				edges: [[["web", "api"], "db"]],
			},
			[{ op: "disconnect", edges: [["web", "db"]] }],
		);
		expect(edited.edges).toEqual([["api", "db"]]);
	});
});
