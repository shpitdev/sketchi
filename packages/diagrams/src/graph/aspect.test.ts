// Positive fixtures deliberately unwrap Results: failure here is invalid test data.
import {
	routingQualityFindings,
	routingQualityScale,
	type CanvasShapeElement as NodeSceneElement,
	type CanvasSpec,
} from "@sketchi/drawing";
import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { parseClassDiagram } from "../families/class/document.js";
import { parseTimelineDiagram } from "../families/timeline/document.js";
import { renderClassDiagram } from "../families/class/render.js";
import { renderTimelineDiagram } from "../families/timeline/render.js";
import { arrowCrossings } from "./readability.js";
import { exportAspect } from "../../test/readability-helpers.js";

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
				parseTimelineDiagram({ ...WIDE_ROWS[name], type: "timeline" }).pipe(Result.getOrThrow),
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
	renderClassDiagram(parseClassDiagram({ type: "class", ...spec }).pipe(Result.getOrThrow)).pipe(
		Result.getOrThrow,
	);
const classBox = (scene: CanvasSpec, id: string) =>
	scene.elements.find(
		(element): element is NodeSceneElement =>
			element.type === "node" && element.id === `node:${id}`,
	)!;
const readsClean = (scene: CanvasSpec) => {
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
