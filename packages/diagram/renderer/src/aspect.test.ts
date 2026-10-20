import { describe, expect, it } from "vitest";
import {
	flowchartFixture,
	parseTimelineDiagram,
	routingQualityFindings,
	routingQualityScale,
} from "@sketchi/diagram-core";
import { renderTimelineDiagram } from "./timeline";
import { arrowCrossings, renderIntermediateDiagram, type RenderedDiagramScene } from "./scene";

/**
 * Width over height, either way up, of a scene in the hosted PNG's 20-unit
 * frame, in place of the scene's own padding.
 */
const exportAspect = ({ width, height }: RenderedDiagramScene, padding: number) =>
	(Math.max(width, height) - 2 * padding + 40) / (Math.min(width, height) - 2 * padding + 40);

/**
 * Flowcharts Frontierclimb round 19 flagged as extreme-aspect (over 2.5:1),
 * each a single TB column whose long branches leave no clean cut to wrap at.
 * Sol samples, except expense (Sonnet s1).
 */
const TALL_COLUMNS = {
	"ci-release-gate": {
		nodes: [
			{ id: "commit", label: "Commit is merged", kind: "start" },
			{ id: "tests", label: "Run test suite", kind: "process" },
			{ id: "test_result", label: "Tests passing?", kind: "decision" },
			{ id: "build", label: "Build an artifact", kind: "process" },
			{ id: "scan", label: "Run a security scan", kind: "process" },
			{ id: "scan_result", label: "Clean scan?", kind: "decision" },
			{ id: "block", label: "Block release", kind: "end" },
			{ id: "canary", label: "Deploy a canary", kind: "process" },
			{ id: "health", label: "Canary healthy?", kind: "decision" },
			{ id: "promote", label: "Promote to production", kind: "end" },
			{ id: "rollback", label: "Roll back the canary", kind: "end" },
		],
		edges: [
			{ id: "edge-1", source: "commit", target: "tests" },
			{ id: "edge-2", source: "tests", target: "test_result" },
			{ id: "edge-3", source: "test_result", target: "block", label: "Failed" },
			{ id: "edge-4", source: "test_result", target: "build", label: "Passing" },
			{ id: "edge-5", source: "build", target: "scan" },
			{ id: "edge-6", source: "scan", target: "scan_result" },
			{ id: "edge-7", source: "scan_result", target: "block", label: "Failed" },
			{ id: "edge-8", source: "scan_result", target: "canary", label: "Clean" },
			{ id: "edge-9", source: "canary", target: "health" },
			{ id: "edge-10", source: "health", target: "promote", label: "Yes" },
			{ id: "edge-11", source: "health", target: "rollback", label: "No" },
		],
	},
	"loan-application-underwriting": {
		nodes: [
			{ id: "submitted", label: "Application is submitted", kind: "start" },
			{ id: "verify_identity", label: "Identity is verified", kind: "process" },
			{ id: "identity_result", label: "Identity verified?", kind: "decision" },
			{ id: "credit_review", label: "Credit review", kind: "process" },
			{ id: "credit_result", label: "Acceptable credit?", kind: "decision" },
			{ id: "manual", label: "Manual underwriting", kind: "process" },
			{ id: "exception", label: "Exception approval?", kind: "decision" },
			{ id: "income", label: "Income verification", kind: "process" },
			{ id: "approved", label: "Approves the loan", kind: "end" },
			{ id: "declined", label: "Declines the application", kind: "end" },
		],
		edges: [
			{ id: "edge-1", source: "submitted", target: "verify_identity" },
			{ id: "edge-2", source: "verify_identity", target: "identity_result" },
			{ id: "edge-3", source: "identity_result", target: "declined", label: "Failed" },
			{ id: "edge-4", source: "identity_result", target: "credit_review", label: "Verified" },
			{ id: "edge-5", source: "credit_review", target: "credit_result" },
			{ id: "edge-6", source: "credit_result", target: "income", label: "Acceptable" },
			{ id: "edge-7", source: "credit_result", target: "manual", label: "Unacceptable" },
			{ id: "edge-8", source: "manual", target: "exception" },
			{ id: "edge-9", source: "exception", target: "income", label: "Approved" },
			{ id: "edge-10", source: "exception", target: "declined", label: "Not approved" },
			{ id: "edge-11", source: "income", target: "approved" },
		],
	},
	"sketchi-onboarding-decision-flow": {
		nodes: [
			{ id: "prompt", label: "Prompt is received", kind: "start" },
			{ id: "requirements", label: "Extract requirements", kind: "process" },
			{ id: "clear", label: "Is the scope clear?", kind: "decision" },
			{ id: "draft", label: "Draft typed IR", kind: "process" },
			{ id: "review", label: "Review", kind: "end" },
		],
		edges: [
			{ id: "edge-1", source: "prompt", target: "requirements" },
			{ id: "edge-2", source: "requirements", target: "clear" },
			{ id: "edge-3", source: "clear", target: "draft", label: "Yes" },
			{ id: "edge-4", source: "clear", target: "review", label: "No" },
			{ id: "edge-5", source: "draft", target: "review" },
		],
	},
	"expense-reimbursement": {
		nodes: [
			{ id: "submit", label: "Expense is submitted", kind: "start" },
			{ id: "receipt", label: "Is the receipt missing?", kind: "decision" },
			{ id: "request", label: "Request a receipt", kind: "end" },
			{ id: "policy", label: "Run policy check", kind: "process" },
			{ id: "within", label: "Is the expense within policy?", kind: "decision" },
			{ id: "mgr", label: "Manager approval", kind: "process" },
			{ id: "pay", label: "Payment", kind: "end" },
			{ id: "fin", label: "Finance exception review", kind: "process" },
			{ id: "exc", label: "Is the exception approved?", kind: "decision" },
			{ id: "rej", label: "Reject the expense", kind: "end" },
		],
		edges: [
			{ id: "edge-1", source: "submit", target: "receipt" },
			{ id: "edge-2", source: "receipt", target: "request", label: "yes" },
			{ id: "edge-3", source: "receipt", target: "policy", label: "no (attached)" },
			{ id: "edge-4", source: "policy", target: "within" },
			{ id: "edge-5", source: "within", target: "mgr", label: "yes" },
			{ id: "edge-6", source: "within", target: "fin", label: "no" },
			{ id: "edge-7", source: "mgr", target: "pay" },
			{ id: "edge-8", source: "fin", target: "exc" },
			{ id: "edge-9", source: "exc", target: "mgr", label: "approved" },
			{ id: "edge-10", source: "exc", target: "rej", label: "rejected" },
		],
	},
} as const;

describe("tall flowchart columns", () => {
	it.each(Object.keys(TALL_COLUMNS) as (keyof typeof TALL_COLUMNS)[])(
		"draws %s within 2.45:1 with no crossing or reader finding",
		(name) => {
			const scene = renderIntermediateDiagram({
				...flowchartFixture,
				id: name,
				title: name,
				...TALL_COLUMNS[name],
				layout: { direction: "TB", edgeRouting: "orthogonal" },
			});
			const arrows = scene.elements.flatMap((element) =>
				element.type === "arrow" ? [element] : [],
			);
			expect(exportAspect(scene, 48)).toBeLessThan(2.45);
			expect(arrowCrossings(arrows)).toBe(0);
			expect(
				routingQualityFindings(
					arrows.map((arrow) => ({ id: arrow.edgeId, points: arrow.points })),
					routingQualityScale(scene),
				),
			).toEqual([]);
		},
	);

	it("keeps a short column at the full rank gap", () => {
		const scene = renderIntermediateDiagram({
			...flowchartFixture,
			nodes: ["A", "B", "C"].map((id) => ({ id, label: id })),
			edges: [
				{ id: "ab", source: "A", target: "B" },
				{ id: "bc", source: "B", target: "C" },
			],
			layout: { direction: "TB", edgeRouting: "orthogonal" },
		});
		const ys = scene.elements.flatMap((element) => (element.type === "node" ? [element.y] : []));
		expect(ys).toEqual([48, 216, 384]);
	});
});

/** Single-row timelines round 19 flagged as wider than 2.5:1. */
const WIDE_ROWS = {
	"project-roadmap-timeline": {
		id: "project-roadmap",
		title: "Project Roadmap",
		events: [
			{ id: "discovery", label: "Discovery", order: 1 },
			{ id: "prototype", label: "Prototype", order: 2 },
			{ id: "pilot", label: "Pilot", order: 3 },
			{ id: "launch", label: "Launch", order: 4 },
			{ id: "retrospective", label: "Retrospective", order: 5 },
		],
	},
	"company-history-timeline": {
		id: "company-history",
		title: "Company history",
		events: [
			{ id: "founded", label: "Founded", date: "2019" },
			{ id: "seed", label: "Seed round", date: "2020-03" },
			{ id: "launch", label: "Public launch", date: "2021-06-14" },
			{ id: "enterprise", label: "First enterprise customer", date: "2021-11" },
			{ id: "users", label: "1 million users", date: "2023" },
		],
	},
} as const;

describe("wide single-row timelines", () => {
	it.each(Object.keys(WIDE_ROWS) as (keyof typeof WIDE_ROWS)[])(
		"stands %s's labels out on longer stems to read within 2.3:1",
		(name) => {
			const scene = renderTimelineDiagram(
				parseTimelineDiagram({ ...WIDE_ROWS[name], type: "timeline" }),
			);
			expect(exportAspect(scene, 40)).toBeLessThanOrEqual(2.3);
			// Every label still hangs from a stem that meets the axis.
			const stems = scene.elements.filter((element) => element.type === "line");
			expect(stems.length).toBeGreaterThanOrEqual(WIDE_ROWS[name].events.length);
		},
	);
});
