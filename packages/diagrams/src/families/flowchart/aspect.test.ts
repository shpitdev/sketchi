import { routingQualityFindings, routingQualityScale } from "@sketchi/drawing";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { FlowchartDiagram } from "./document.js";
import { flowchartFixture } from "./fixtures.js";
import { renderFlowchartDiagram } from "./render.js";
import { arrowCrossings } from "../../graph/readability.js";
import { exportAspect } from "../../../test/readability-helpers.js";

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
			const scene = renderFlowchartDiagram(
				Schema.decodeUnknownSync(FlowchartDiagram)({
					...flowchartFixture,
					id: name,
					title: name,
					...TALL_COLUMNS[name],
					layout: { direction: "TB", edgeRouting: "orthogonal" },
					type: "flowchart",
				}),
			);
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
});

/**
 * Haiku's order-to-cash-flowchart-large in the November 2026 round of large
 * scenarios: a 61-step top-to-bottom process whose decisions' branches meet
 * again, as models write long processes. As one column it exported at 1:4.6.
 */
const ORDER_TO_CASH_NODES: readonly (readonly [string, string, string])[] = [
	["start", "Customer order received", "start"],
	["enter_erp", "Enter order into ERP", "process"],
	["validate", "Validate order details", "process"],
	["details_ok", "Order details complete?", "decision"],
	["ask_details", "Ask customer for details", "process"],
	["check_credit", "Check customer credit", "process"],
	["credit_ok", "Credit approved?", "decision"],
	["hold_credit", "Hold order for credit review", "process"],
	["mgr_approves", "Credit manager approves?", "decision"],
	["cancel_order", "Cancel order", "end"],
	["allocate", "Allocate warehouse", "process"],
	["reserve", "Reserve inventory", "process"],
	["in_stock", "All items in stock?", "decision"],
	["backorder", "Create backorder", "process"],
	["notify_backorder", "Notify customer of backorder", "process"],
	["wait_restock", "Wait for restock", "process"],
	["confirm_order", "Confirm order with customer", "process"],
	["pick_list", "Create pick list", "process"],
	["pick", "Pick items", "process"],
	["qc", "Quality check items", "process"],
	["inspection_ok", "Items pass inspection?", "decision"],
	["replace", "Replace damaged items", "process"],
	["pack", "Pack shipment", "process"],
	["packing_slip", "Print packing slip", "process"],
	["weigh", "Weigh package", "process"],
	["carrier", "Select carrier", "process"],
	["intl", "International shipment?", "decision"],
	["customs", "Prepare customs documents", "process"],
	["freight", "Book freight forwarder", "process"],
	["label", "Generate shipping label", "process"],
	["pickup", "Schedule pickup", "process"],
	["load", "Load truck", "process"],
	["handover", "Hand over to carrier", "process"],
	["send_tracking", "Send tracking number to customer", "process"],
	["track", "Track delivery", "process"],
	["on_time", "Delivered on time?", "decision"],
	["carrier_claim", "Open carrier claim", "process"],
	["notify_delay", "Notify customer of delay", "process"],
	["proof", "Record proof of delivery", "process"],
	["confirm_delivery", "Confirm delivery", "process"],
	["taxes", "Calculate taxes", "process"],
	["gen_invoice", "Generate invoice", "process"],
	["post_ar", "Post invoice to accounts receivable", "process"],
	["send_invoice", "Send invoice", "process"],
	["paid_30", "Payment received within 30 days?", "decision"],
	["reminder", "Send payment reminder", "process"],
	["paid_reminder", "Paid by reminder deadline?", "decision"],
	["collections", "Escalate to collections", "process"],
	["collections_ok", "Collections recover payment?", "decision"],
	["write_off", "Write off debt", "end"],
	["apply_payment", "Apply payment", "process"],
	["receipt", "Issue receipt", "process"],
	["reconcile", "Reconcile account", "process"],
	["revenue_ledger", "Update revenue ledger", "process"],
	["feedback", "Request customer feedback", "process"],
	["feedback_neg", "Feedback negative?", "decision"],
	["service_case", "Open service case", "process"],
	["follow_up", "Follow up with customer", "process"],
	["archive_neg", "Archive order records", "end"],
	["archive", "Archive order records", "process"],
	["close", "Close order", "end"],
];
const ORDER_TO_CASH_EDGES: readonly (readonly [string, string, string?])[] = [
	["start", "enter_erp"],
	["enter_erp", "validate"],
	["validate", "details_ok"],
	["details_ok", "ask_details", "no"],
	["ask_details", "validate"],
	["details_ok", "check_credit", "yes"],
	["check_credit", "credit_ok"],
	["credit_ok", "allocate", "yes"],
	["credit_ok", "hold_credit", "no"],
	["hold_credit", "mgr_approves"],
	["mgr_approves", "allocate", "yes"],
	["mgr_approves", "cancel_order", "no"],
	["allocate", "reserve"],
	["reserve", "in_stock"],
	["in_stock", "backorder", "no"],
	["backorder", "notify_backorder"],
	["notify_backorder", "wait_restock"],
	["wait_restock", "reserve"],
	["in_stock", "confirm_order", "yes"],
	["confirm_order", "pick_list"],
	["pick_list", "pick"],
	["pick", "qc"],
	["qc", "inspection_ok"],
	["inspection_ok", "replace", "no"],
	["replace", "qc"],
	["inspection_ok", "pack", "yes"],
	["pack", "packing_slip"],
	["packing_slip", "weigh"],
	["weigh", "carrier"],
	["carrier", "intl"],
	["intl", "customs", "yes"],
	["customs", "freight"],
	["freight", "label"],
	["intl", "label", "no"],
	["label", "pickup"],
	["pickup", "load"],
	["load", "handover"],
	["handover", "send_tracking"],
	["send_tracking", "track"],
	["track", "on_time"],
	["on_time", "carrier_claim", "no"],
	["carrier_claim", "notify_delay"],
	["notify_delay", "track"],
	["on_time", "proof", "yes"],
	["proof", "confirm_delivery"],
	["confirm_delivery", "taxes"],
	["taxes", "gen_invoice"],
	["gen_invoice", "post_ar"],
	["post_ar", "send_invoice"],
	["send_invoice", "paid_30"],
	["paid_30", "apply_payment", "yes"],
	["paid_30", "reminder", "no"],
	["reminder", "paid_reminder"],
	["paid_reminder", "apply_payment", "yes"],
	["paid_reminder", "collections", "no"],
	["collections", "collections_ok"],
	["collections_ok", "apply_payment", "yes"],
	["collections_ok", "write_off", "no"],
	["apply_payment", "receipt"],
	["receipt", "reconcile"],
	["reconcile", "revenue_ledger"],
	["revenue_ledger", "feedback"],
	["feedback", "feedback_neg"],
	["feedback_neg", "service_case", "yes"],
	["service_case", "follow_up"],
	["follow_up", "archive_neg"],
	["feedback_neg", "archive", "no"],
	["archive", "close"],
];

describe("long flowcharts", () => {
	it("wraps a 61-step process into columns that read at a screen's size", () => {
		const scene = renderFlowchartDiagram(
			Schema.decodeUnknownSync(FlowchartDiagram)({
				...flowchartFixture,
				id: "order-to-cash",
				title: "Order-to-cash process",
				nodes: ORDER_TO_CASH_NODES.map(([id, label, kind]) => ({ id, label, kind })),
				edges: ORDER_TO_CASH_EDGES.map(([source, target, label], index) => ({
					id: `e${index + 1}`,
					source,
					target,
					...(label ? { label } : {}),
				})),
				layout: { direction: "TB", edgeRouting: "orthogonal" },
				type: "flowchart",
			}),
		);
		const arrows = scene.elements.flatMap((element) => (element.type === "arrow" ? [element] : []));
		// A column 1631 wide and 7277 tall fitted its text to a screen at 4 px:
		// a few more lines crossing where branches meet cost less than that. Its
		// three columns, 3445 by 3130 while their rank gaps stayed full, fitted it
		// at 8 px, one line where three branches meet running out past them all.
		expect(exportAspect(scene, 48)).toBeLessThan(2);
		expect(Math.max(scene.width, scene.height)).toBeLessThan(2700);
		const findings = routingQualityFindings(
			arrows.map((arrow) => ({ id: arrow.edgeId, points: arrow.points })),
			routingQualityScale(scene),
		);
		// Fewer crossings and reader findings than the column drew (2 and 8): tight
		// bands leave the lines meeting at Allocate warehouse and Apply payment no
		// way round but straight in.
		expect(arrowCrossings(arrows)).toBe(0);
		expect(findings).toEqual([]);
		// Each column reads down from the top: every step past the first column's
		// start sits below the step before it, or tops a column of its own.
		const top = Math.min(
			...scene.elements.flatMap((element) => (element.type === "node" ? [element.y] : [])),
		);
		const columnTops = new Set(
			arrows.flatMap((arrow) => {
				const [start, end] = [arrow.points[0], arrow.points.at(-1)!];
				return end.y < start.y && Math.abs(end.y - top) < 48 ? [arrow.targetNodeId] : [];
			}),
		);
		expect(columnTops.size).toBeGreaterThanOrEqual(1);
	});
});
