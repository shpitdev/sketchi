import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
	decodeFlowchartDocument,
	flowchartDiagramFromDocument,
	flowchartDocumentPairCount,
	type FlowchartDocument,
} from "./flowchart-document";

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

function build(document: FlowchartDocument) {
	const result = flowchartDiagramFromDocument(document);
	if (!result.ok) throw new Error(result.issues.map((issue) => issue.message).join("\n"));
	return result.diagram;
}

function issues(document: FlowchartDocument) {
	const result = flowchartDiagramFromDocument(document);
	return result.ok ? [] : result.issues.map((issue) => [issue.code, issue.ref?.path]);
}

const kinds = (document: FlowchartDocument) =>
	Object.fromEntries(build(document).nodes.map((node) => [node.id, node.kind]));

describe("flowchart reference resolution", () => {
	it("resolves unique spelling variants in list-ended edges and nested group members, with notes", () => {
		const source: FlowchartDocument = {
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
		};
		const result = flowchartDiagramFromDocument(source);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
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
		expect(result).toHaveProperty(
			"notes",
			expect.arrayContaining([
				expect.stringContaining('"SUBMIT FORM,"'),
				expect.stringContaining('"APPLICANT TEAM;"'),
			]),
		);
		expect(source.edges[0]?.[1]).toBe("review-form");
	});

	it("resolves legacy lane member variants and records their paths", () => {
		const result = flowchartDiagramFromDocument({
			title: "Sales",
			nodes: { submit_form: "Submit form", review_form: "Review form" },
			edges: [["submit_form", "review_form"]],
			lanes: { sales: { label: "Sales", contains: ["submit-form", "REVIEW FORM,"] } },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.diagram.nodes.map(({ lane }) => lane)).toEqual(["sales", "sales"]);
		expect(result.notes).toEqual(
			expect.arrayContaining([
				expect.stringContaining("lanes.sales.contains[0]"),
				expect.stringContaining('"submit_form"'),
			]),
		);
	});

	it("refuses ambiguous and unrelated spellings, retaining nearest-id hints", () => {
		const result = flowchartDiagramFromDocument({
			title: "Review",
			nodes: { start: "Start", review_form: "Review one", "review-form": "Review two" },
			edges: [
				["start", "REVIEW FORM,"],
				["start", "review_frm"],
			],
			groups: { team: { label: "Team", contains: ["REVIEW FORM"] } },
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		for (const code of ["missing_edge_target", "unknown_member"]) {
			expect(result.issues).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ code, hint: expect.stringContaining("review_form") }),
				]),
			);
		}
	});

	it("keeps exact references even when another id has the same normalized spelling", () => {
		const result = flowchartDiagramFromDocument({
			title: "Review",
			nodes: { start: "Start", review_form: "Review one", "review-form": "Review two" },
			edges: [["start", ["review_form", "review-form"]]],
		});
		expect(result.ok).toBe(true);
		if (result.ok) expect(result).toHaveProperty("notes", []);
	});
});

describe("flowchart documents", () => {
	it("decode a bare-label document and build it with roles read from the edges", () => {
		const decoded = decodeFlowchartDocument(waitlist);
		expect(Result.isSuccess(decoded)).toBe(true);
		const diagram = build(waitlist);
		expect(diagram.id).toBe("restaurant-waitlist");
		expect(diagram.layout.direction).toBe("TB");
		expect(kinds(waitlist)).toEqual({
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
		expect(diagram.edges.map((edge) => edge.id)).toContain("available->seat");
		expect(diagram.edges.find((edge) => edge.id === "ready->wait")?.label).toBe("no");
	});

	it("ends a branch at its last step without asking for another edge", () => {
		const document: FlowchartDocument = {
			title: "Incident",
			nodes: {
				alert: "Alert received",
				cause: "Classify root cause",
				rollback: "Roll back deploy",
				provider: "Escalate to provider",
				stable: "Service stable?",
				resolved: "Resolved",
			},
			edges: [
				["alert", "cause"],
				["cause", "rollback", "deploy"],
				["cause", "provider", "provider"],
				["rollback", "stable"],
				["stable", "resolved", "yes"],
				["stable", "cause", "no"],
			],
		};
		expect(kinds(document)).toMatchObject({
			cause: "process",
			provider: "end",
			stable: "decision",
			resolved: "end",
		});
	});

	it("takes the first node as the entry when a loop returns to it", () => {
		const document: FlowchartDocument = {
			title: "Expense approval",
			nodes: { submit: "Submit report", approved: "Approved?", pay: "Pay employee" },
			edges: [
				["submit", "approved"],
				["approved", "pay", "yes"],
				["approved", "submit", "no"],
			],
		};
		expect(kinds(document)).toEqual({ submit: "start", approved: "decision", pay: "end" });
	});

	it("allows several entries and expands list ends into one edge per id", () => {
		const document: FlowchartDocument = {
			title: "AWS",
			direction: "LR",
			nodes: {
				users: "Users",
				admins: "Admins",
				alb: "ALB",
				web: "Web service",
				api: "API service",
				rds: { label: "RDS PostgreSQL", shape: "database" },
			},
			edges: [
				[["users", "admins"], "alb"],
				["alb", ["web", "api"]],
				[["web", "api"], "rds"],
			],
		};
		const diagram = build(document);
		expect(diagram.edges.map((edge) => edge.id)).toEqual([
			"users->alb",
			"admins->alb",
			"alb->web",
			"alb->api",
			"web->rds",
			"api->rds",
		]);
		expect(kinds(document)).toMatchObject({ users: "start", admins: "start", rds: "end" });
		expect(diagram.nodes.find((node) => node.id === "rds")?.shape).toBe("database");
		expect(diagram.layout.direction).toBe("LR");
	});

	it("reads a labeled edge out of an ordinary step as a labeled edge, not a decision", () => {
		const document: FlowchartDocument = {
			title: "Sync",
			nodes: {
				queue: "Order queue",
				sync: "Sync function",
				table: "Orders table",
				archive: "Archive",
			},
			edges: [
				["queue", "sync"],
				["sync", "table"],
				["sync", "archive", "invoice PDF"],
			],
		};
		expect(kinds(document).sync).toBe("process");
	});

	it("draws a step given a diamond as a decision, and its other shapes only as drawings", () => {
		const document: FlowchartDocument = {
			title: "Classify",
			nodes: {
				alert: "Alert received",
				cause: { label: "Classify root cause", shape: "diamond" },
				rollback: "Roll back",
				hotfix: { label: "Prepare hotfix", shape: "document" },
			},
			edges: [
				["alert", "cause"],
				["cause", "rollback", "deploy"],
				["cause", "hotfix", "code"],
			],
		};
		const diagram = build(document);
		expect(kinds(document).cause).toBe("decision");
		expect(diagram.nodes.find((node) => node.id === "cause")?.shape).toBeUndefined();
		expect(diagram.nodes.find((node) => node.id === "hotfix")?.shape).toBe("document");
	});

	it("asks for a label on every branch of a question", () => {
		expect(
			issues({
				title: "Gate",
				nodes: { start: "Start", ok: "Tests pass?", ship: "Ship", fix: "Fix" },
				edges: [
					["start", "ok"],
					["ok", "ship", "yes"],
					["ok", "fix"],
				],
			}),
		).toEqual([["unlabeled_decision_branch", "edges[2]"]]);
	});

	it("derives the zone tree from what each container lists, innermost wins", () => {
		const document: FlowchartDocument = {
			title: "Hybrid",
			nodes: {
				staff: "Office staff",
				erp: "Legacy ERP",
				oracle: { label: "Oracle database", shape: "database" },
				vpn: "VPN gateway",
				api: "Order API",
				queue: { label: "Order queue", shape: "queue" },
				table: { label: "Orders table", shape: "database" },
			},
			edges: [
				["staff", "erp"],
				["erp", "oracle"],
				["erp", "vpn"],
				["vpn", "api"],
				["api", "queue"],
				["queue", "table"],
			],
			groups: {
				dc: { label: "On-prem data center", kind: "datacenter", contains: ["corp", "oracle"] },
				corp: { label: "Corporate network", kind: "zone", contains: ["staff", "erp"] },
				aws: { label: "AWS cloud", kind: "cloud", contains: ["eu"] },
				eu: { label: "eu-west-1", kind: "region", contains: ["vpc", "queue", "table", "api"] },
				vpc: { label: "Production VPC", kind: "vpc", contains: ["vpn", "private"] },
				private: { label: "Private subnet", kind: "subnet", contains: ["api"] },
			},
		};
		const diagram = build(document);
		expect(Object.fromEntries(diagram.nodes.map((node) => [node.id, node.group]))).toEqual({
			staff: "corp",
			erp: "corp",
			oracle: "dc",
			vpn: "vpc",
			api: "private",
			queue: "eu",
			table: "eu",
		});
		expect(
			Object.fromEntries((diagram.groups ?? []).map((group) => [group.id, group.parent])),
		).toEqual({
			dc: undefined,
			corp: "dc",
			aws: undefined,
			eu: "aws",
			vpc: "eu",
			private: "vpc",
		});
	});

	it("nests a group nobody lists inside the group that holds all its nodes", () => {
		const document: FlowchartDocument = {
			title: "On-prem",
			nodes: { staff: "Office staff", erp: "Legacy ERP", oracle: "Oracle database" },
			edges: [
				["staff", "erp"],
				["erp", "oracle"],
			],
			groups: {
				dc: { label: "Data center", contains: ["staff", "erp", "oracle"] },
				corp: { label: "Corporate network", contains: ["staff", "erp"] },
			},
		};
		const diagram = build(document);
		expect(diagram.groups?.find((group) => group.id === "corp")?.parent).toBe("dc");
		expect(diagram.nodes.find((node) => node.id === "staff")?.group).toBe("corp");
		expect(diagram.nodes.find((node) => node.id === "oracle")?.group).toBe("dc");
	});

	it("names each container problem at its path", () => {
		expect(
			issues({
				title: "Zones",
				nodes: { a: "A", b: "B", c: "C" },
				edges: [
					["a", "b"],
					["b", "c"],
				],
				groups: {
					left: { label: "Left", contains: ["a", "b"] },
					right: { label: "Right", contains: ["b", "c", "ghost"] },
				},
			}),
		).toEqual([
			["unknown_member", "groups.right.contains[2]"],
			["overlapping_containers", "groups"],
		]);
		expect(
			issues({
				title: "Loop",
				nodes: { a: "A", b: "B" },
				edges: [["a", "b"]],
				groups: {
					outer: { label: "Outer", contains: ["inner", "a"] },
					inner: { label: "Inner", contains: ["outer", "b"] },
				},
			}).map(([code]) => code),
		).toEqual(["group_cycle", "group_cycle"]);
	});

	it("never infers a group inside a group that already sits inside it", () => {
		const document: FlowchartDocument = {
			title: "Peers",
			nodes: { a: "A", b: "B" },
			edges: [["a", "b"]],
			groups: {
				inner: { label: "Inner", contains: ["a", "b"] },
				peer: { label: "Peer", contains: ["a", "b"] },
				outer: { label: "Outer", contains: ["inner"] },
			},
		};
		const diagram = build(document);
		const parents = Object.fromEntries(
			(diagram.groups ?? []).map((group) => [group.id, group.parent]),
		);
		expect(parents).toEqual({ inner: "outer", peer: "inner", outer: undefined });
		for (const group of diagram.groups ?? []) {
			const seen = new Set<string>();
			for (let id: string | undefined = group.id; id !== undefined; id = parents[id]) {
				expect(seen.has(id)).toBe(false);
				seen.add(id);
			}
		}
	});

	it("reaches the ends of a flow that opens with a question", () => {
		const document: FlowchartDocument = {
			title: "Gate",
			nodes: { ready: "Ready?", ship: "Ship", fix: "Fix" },
			edges: [
				["ready", "ship", "yes"],
				["ready", "fix", "no"],
			],
		};
		expect(issues(document)).toEqual([]);
		expect(kinds(document)).toEqual({ ready: "decision", ship: "end", fix: "end" });
	});

	it("puts every node in the lane it names", () => {
		const document: FlowchartDocument = {
			title: "Hiring",
			direction: "LR",
			nodes: {
				apply: { label: "Apply", lane: "candidate" },
				screen: { label: "Screen resume", lane: "recruiter" },
				offer: { label: "Make offer", lane: "recruiter" },
			},
			edges: [
				["apply", "screen"],
				["screen", "offer"],
			],
			lanes: { candidate: "Candidate", recruiter: "Recruiter" },
		};
		const diagram = build(document);
		expect(diagram.lanes?.map((lane) => [lane.id, lane.label])).toEqual([
			["candidate", "Candidate"],
			["recruiter", "Recruiter"],
		]);
		expect(diagram.nodes.map((node) => node.lane)).toEqual(["candidate", "recruiter", "recruiter"]);
		expect(
			issues({
				...document,
				nodes: {
					...document.nodes,
					screen: "Screen resume",
					offer: { label: "Make offer", lane: "hr" },
				},
				lanes: { candidate: "Candidate", manager: "Hiring manager" },
				groups: { g: { label: "G", contains: ["apply"] } },
			}),
		).toEqual([
			["lanes_with_groups", "groups"],
			["node_without_lane", "nodes.screen.lane"],
			["unknown_node_lane", "nodes.offer.lane"],
		]);
		expect(
			issues({ ...document, lanes: undefined } as unknown as FlowchartDocument).map(
				([code]) => code,
			),
		).toEqual(["unknown_node_lane", "unknown_node_lane", "unknown_node_lane"]);
	});

	it("keeps a named recipient lane empty instead of assigning it the sender's action", () => {
		const diagram = build({
			title: "On-call response",
			nodes: {
				alert: { label: "See alert", lane: "monitoring" },
				page: { label: "Page on-call engineer", lane: "monitoring" },
				fix: { label: "Fix service", lane: "engineer" },
				tell: { label: "Tell customer incident is resolved", lane: "monitoring" },
			},
			edges: [
				["alert", "page"],
				["page", "fix"],
				["fix", "tell"],
			],
			lanes: { monitoring: "Monitoring lead", engineer: "On-call engineer", customer: "Customer" },
		});
		expect(diagram.lanes?.map(({ id }) => id)).toEqual(["monitoring", "engineer", "customer"]);
		expect(diagram.nodes.find(({ id }) => id === "tell")?.lane).toBe("monitoring");
	});

	it("names unknown ends with the nearest ids, and every graph problem", () => {
		const result = flowchartDiagramFromDocument({
			title: "Broken",
			nodes: { review: "Review", pay: "Pay", "1x": "Bad id", lone: "Lone" },
			edges: [
				["review", "payy"],
				["review", "review"],
				["review", "pay"],
				["review", "pay"],
				["1x", "pay"],
			],
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.issues.map((issue) => issue.code)).toEqual([
			"invalid_id",
			"missing_edge_target",
			"self_loop",
			"duplicate_edge",
			"isolated_node",
		]);
		expect(result.issues[1]?.hint).toContain('"pay"');
	});

	it("reports a loop with no way out and a loop nothing enters", () => {
		expect(
			issues({
				title: "Loops",
				nodes: { a: "A", b: "B", c: "C", d: "D", e: "E" },
				edges: [
					["a", "b"],
					["b", "c"],
					["c", "b"],
					["d", "e"],
					["e", "d"],
				],
			}).map(([code]) => code),
		).toEqual([
			"unreachable_node",
			"unreachable_node",
			"nonterminating_node",
			"nonterminating_node",
			"nonterminating_node",
			"nonterminating_node",
			"nonterminating_node",
		]);
	});

	it("passes the logo style and node logos the host resolved to the drawing", () => {
		const result = flowchartDiagramFromDocument(
			{ ...waitlist, logos: "exact" },
			{ nodeIcons: new Map([["seat", "opentable"]]) },
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.diagram.metadata).toEqual({ logos: "exact" });
		expect(result.diagram.nodes.find((node) => node.id === "seat")?.icon?.slug).toBe("opentable");
	});

	it("rejects a document too small to draw", () => {
		expect(issues({ title: "One", nodes: { a: "A" }, edges: [] })).toEqual([
			["flowchart_too_small", "nodes"],
		]);
	});
});

describe("flowchart document limits", () => {
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
		expect(result).toEqual({
			ok: false,
			issues: [
				expect.objectContaining({
					code: "flowchart_too_large",
					message: "Flowchart draws 90002 edges; the supported maximum is 120.",
				}),
			],
		});
	});
});

describe("flowchart document branches", () => {
	const delay = (edges: FlowchartDocument["edges"]): FlowchartDocument => ({
		title: "Delayed order",
		nodes: {
			check: "Check stock",
			short: "Stock short?",
			notify: "Notify the customer",
			reorder: "Reorder stock",
			ship: "Ship the order",
		},
		edges,
	});

	it("reads one edge that lists several steps as one branch", () => {
		const result = flowchartDiagramFromDocument(
			delay([
				["check", "short"],
				["short", ["notify", "reorder"], "yes"],
				["short", "ship", "no"],
			]),
		);
		expect(result.ok).toBe(true);
	});

	it("still refuses two edges that repeat a branch label, and shows the list form", () => {
		const result = flowchartDiagramFromDocument(
			delay([
				["check", "short"],
				["short", "notify", "yes"],
				["short", "reorder", "yes"],
				["short", "ship", "no"],
			]),
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.issues).toEqual([
			expect.objectContaining({
				code: "duplicate_decision_branch_label",
				hint: 'Give each branch of the same question its own label; a branch that leads to several steps lists them in one edge: ["short", ["reorder", "…"], "yes"].',
			}),
		]);
	});
});
