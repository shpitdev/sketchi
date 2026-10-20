import { describe, expect, it } from "vitest";
import {
	flowchartFixture,
	parseClassDiagram,
	parseTimelineDiagram,
	routingQualityFindings,
	routingQualityScale,
} from "@sketchi/diagram-core";
import { renderClassDiagram } from "./class-diagram";
import { renderTimelineDiagram } from "./timeline";
import {
	arrowCrossings,
	type NodeSceneElement,
	renderIntermediateDiagram,
	type RenderedDiagramScene,
} from "./scene";

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

const method = (name: string, params: readonly (readonly [string, string])[] = []) => ({
	name,
	params: params.map(([param, type]) => ({ name: param, type })),
	returns: "void",
	visibility: "public",
});
const field = (name: string, type: string, visibility = "private") => ({ name, type, visibility });

/** Round 19's observer-pattern-class (Sol s1): two interfaces, three implementers. */
const OBSERVER = {
	id: "weather-app-observer-pattern",
	title: "Weather App — Observer Pattern",
	classes: [
		{
			id: "Subject",
			kind: "interface",
			attributes: [],
			methods: [
				method("attach", [["o", "Observer"]]),
				method("detach", [["o", "Observer"]]),
				method("notifyObservers"),
			],
		},
		{
			id: "Observer",
			kind: "interface",
			attributes: [],
			methods: [method("update", [["subject", "Subject"]])],
		},
		{
			id: "WeatherStation",
			attributes: [field("temperature", "double"), field("humidity", "double")],
			methods: [
				method("attach", [["o", "Observer"]]),
				method("detach", [["o", "Observer"]]),
				method("notifyObservers"),
				method("setMeasurements", [
					["t", "double"],
					["h", "double"],
				]),
			],
		},
		{
			id: "PhoneDisplay",
			attributes: [field("lastReading", "double")],
			methods: [method("update", [["subject", "Subject"]])],
		},
		{ id: "WindowDisplay", attributes: [], methods: [method("update", [["subject", "Subject"]])] },
	],
	relationships: [
		{ id: "relationship-1", kind: "realization", from: "WeatherStation", to: "Subject" },
		{ id: "relationship-2", kind: "realization", from: "PhoneDisplay", to: "Observer" },
		{ id: "relationship-3", kind: "realization", from: "WindowDisplay", to: "Observer" },
		{
			id: "relationship-4",
			kind: "association",
			from: "Subject",
			to: "Observer",
			fromMultiplicity: "1",
			toMultiplicity: "0..*",
			toRole: "observers",
			navigable: true,
		},
		{
			id: "relationship-5",
			kind: "dependency",
			from: "PhoneDisplay",
			to: "WeatherStation",
			label: "reads",
		},
	],
};

/** Round 19's online-shop-domain-class (Sonnet s3): an enum Order depends on at the end of a row. */
const ONLINE_SHOP = {
	id: "online-shop-domain-model",
	title: "Online Shop Domain Model",
	classes: [
		{
			id: "Customer",
			attributes: [field("id", "UUID"), field("name", "String"), field("email", "String")],
			methods: [{ ...method("placeOrder", [["cart", "Cart"]]), returns: "Order" }],
		},
		{
			id: "Address",
			attributes: [field("street", "String"), field("city", "String"), field("postcode", "String")],
			methods: [],
		},
		{
			id: "Order",
			attributes: [
				field("id", "UUID"),
				field("placedAt", "DateTime"),
				field("status", "OrderStatus"),
			],
			methods: [{ ...method("total"), returns: "Money" }, method("cancel")],
		},
		{
			id: "LineItem",
			attributes: [field("quantity", "int"), field("unitPrice", "Money")],
			methods: [{ ...method("subtotal"), returns: "Money" }],
		},
		{
			id: "Product",
			attributes: [field("sku", "String"), field("name", "String"), field("price", "Money")],
			methods: [],
		},
		{
			id: "Payment",
			kind: "abstract",
			attributes: [field("amount", "Money", "protected"), field("paidAt", "DateTime", "protected")],
			methods: [{ ...method("authorize"), returns: "bool", abstract: true }],
		},
		{
			id: "CardPayment",
			attributes: [field("cardLast4", "String")],
			methods: [{ ...method("authorize"), returns: "bool" }],
		},
		{
			id: "BankTransfer",
			attributes: [field("iban", "String")],
			methods: [{ ...method("authorize"), returns: "bool" }],
		},
		{
			id: "OrderStatus",
			kind: "enum",
			attributes: ["PENDING", "PAID", "SHIPPED", "CANCELLED"].map((name) => ({ name })),
			methods: [],
		},
	],
	relationships: [
		{
			id: "relationship-1",
			kind: "association",
			from: "Customer",
			to: "Order",
			fromMultiplicity: "1",
			toMultiplicity: "0..*",
			navigable: true,
			label: "places",
		},
		{
			id: "relationship-2",
			kind: "aggregation",
			from: "Customer",
			to: "Address",
			fromMultiplicity: "1",
			toMultiplicity: "1..*",
			toRole: "addresses",
		},
		{
			id: "relationship-3",
			kind: "composition",
			from: "Order",
			to: "LineItem",
			fromMultiplicity: "1",
			toMultiplicity: "1..*",
			toRole: "items",
		},
		{
			id: "relationship-4",
			kind: "association",
			from: "LineItem",
			to: "Product",
			fromMultiplicity: "0..*",
			toMultiplicity: "1",
			navigable: true,
		},
		{
			id: "relationship-5",
			kind: "association",
			from: "Order",
			to: "Payment",
			fromMultiplicity: "1",
			toMultiplicity: "0..1",
		},
		{ id: "relationship-6", kind: "inheritance", from: "CardPayment", to: "Payment" },
		{ id: "relationship-7", kind: "inheritance", from: "BankTransfer", to: "Payment" },
		{ id: "relationship-8", kind: "dependency", from: "Order", to: "OrderStatus" },
	],
};

const classScene = (spec: object) =>
	renderClassDiagram(parseClassDiagram({ type: "class", ...spec }));
const classBox = (scene: RenderedDiagramScene, id: string) =>
	scene.elements.find(
		(element): element is NodeSceneElement =>
			element.type === "node" && element.id === `node:${id}`,
	)!;
const readsClean = (scene: RenderedDiagramScene) => {
	const arrows = scene.elements.flatMap((element) => (element.type === "arrow" ? [element] : []));
	expect(arrowCrossings(arrows)).toBe(0);
	expect(
		routingQualityFindings(
			arrows.map((arrow) => ({ id: arrow.edgeId, points: arrow.points })),
			routingQualityScale(scene),
		),
	).toEqual([]);
};

describe("wide class diagrams", () => {
	it("steps the observer hierarchy down beside the subject's, within 2.4:1", () => {
		const scene = classScene(OBSERVER);
		expect(exportAspect(scene, 48)).toBeLessThanOrEqual(2.4);
		readsClean(scene);
		// Each interface still stands above the classes that implement it.
		for (const [parent, child] of [
			["Subject", "WeatherStation"],
			["Observer", "PhoneDisplay"],
			["Observer", "WindowDisplay"],
		] as const)
			expect(classBox(scene, child).y).toBeGreaterThan(
				classBox(scene, parent).y + classBox(scene, parent).height,
			);
	});

	it("keeps two side-by-side hierarchies in their rows while they read within 2.4:1", () => {
		// With one display fewer, the subject's and the observer's rows fit.
		const scene = classScene({
			...OBSERVER,
			classes: OBSERVER.classes.filter((node) => node.id !== "WindowDisplay"),
			relationships: OBSERVER.relationships.filter((link) => link.from !== "WindowDisplay"),
		});
		expect(exportAspect(scene, 48)).toBeLessThanOrEqual(2.4);
		expect(classBox(scene, "Observer").y).toBe(classBox(scene, "Subject").y);
	});

	it("draws online-shop's enumeration beside Order, within 2.4:1", () => {
		const scene = classScene(ONLINE_SHOP);
		expect(exportAspect(scene, 48)).toBeLessThanOrEqual(2.4);
		readsClean(scene);
		const [order, status] = [classBox(scene, "Order"), classBox(scene, "OrderStatus")];
		expect(status.y).toBe(order.y);
		// One end run either side of the dependency's line, no more.
		expect(status.x - order.x - order.width).toBeLessThanOrEqual(100);
	});
});
