import { describe, expect, it } from "vitest";
import {
	type AxisAlignedSegment,
	candidateRouteQuality,
	type ClassDiagram,
	type ClassRelationshipKind,
	estimateTextWidth,
	getCanvasValidationIssues,
	parseClassDiagram,
	resolveClassShorthand,
	routingQualityFindings,
	routingQualityScale,
	segmentsFromPoints,
} from "@sketchi/diagram-core";
import { renderDiagram, type RenderedDiagramScene } from "@sketchi/diagram-renderer";

import { convertSceneToExcalidraw, validateExcalidrawScene } from "./convert";

const NAMES = [
	"Order",
	"Customer",
	"Repository<T>",
	"PaymentReconciliationService",
	"AbstractAuthenticationController",
	"品質保証レビュー",
	"Node",
	"Event",
];
const TYPES = ["int", "String", "double", "List<Item>", "Map<String, Integer>", "UUID", "bool"];
const MEMBERS = [
	"id",
	"name",
	"createdAt",
	"status",
	"aVeryLongDescriptiveIdentifierName",
	"total",
];
const LABELS = ["places", "owns", "is reviewed by the assigned team lead"];
const MULTIPLICITIES = ["1", "0..1", "*", "1..*", "0..*", "2..4"];
const ROLES = ["items", "owner", "reviewers", "parent"];

/**
 * A seeded random number source, so every run draws the same models: a 32-bit
 * LCG in exact integer arithmetic, which never falls into a short cycle.
 */
function seeded(start: number) {
	let seed = start >>> 0;
	const random = () => {
		seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
		return seed / 4_294_967_296;
	};
	return {
		random,
		pick: <T>(values: readonly T[]) => values[Math.floor(random() * values.length)]!,
	};
}

/**
 * Seeded random models as people draw them: a few interfaces, hierarchies
 * where each class may extend an earlier one or implement an interface,
 * associations with multiplicities, roles and names, compositions,
 * aggregations, dependencies, and the odd relationship to itself.
 */
function randomModels(count: number, start: number): ClassDiagram[] {
	const { random, pick } = seeded(start);
	return Array.from({ length: count }, (_, index) => {
		const size = 2 + Math.floor(random() * 14);
		const interfaces = Math.floor(random() * Math.min(3, size / 2));
		const classes = Array.from({ length: size }, (_, at) => {
			const kind =
				at < interfaces
					? "interface"
					: random() < 0.15
						? "abstract"
						: random() < 0.08
							? "enum"
							: undefined;
			const attributes = Array.from(
				{ length: Math.floor(random() * (kind === "interface" ? 1 : 5)) },
				(_, member) =>
					`${pick(["+", "-", "#", "~"])} ${pick(MEMBERS)}${member}: ${pick(TYPES)}${random() < 0.1 ? " {static}" : ""}`,
			);
			const methods = Array.from({ length: Math.floor(random() * 4) }, (_, member) => {
				const params = Array.from(
					{ length: Math.floor(random() * 3) },
					(_, param) => `p${param}: ${pick(TYPES)}`,
				);
				const text = () =>
					`+ ${pick(MEMBERS)}${member}(${params.join(", ")}): ${pick(TYPES)}${kind === "abstract" && random() < 0.5 ? " {abstract}" : ""}`;
				// Members stay within the 96 characters a member may run.
				let written = text();
				while (written.length > 96 && params.length > 0) {
					params.pop();
					written = text();
				}
				return written;
			});
			return {
				id: `c${at}`,
				name: `${pick(NAMES)}${at}`,
				...(kind ? { kind } : {}),
				attributes,
				methods: kind === "enum" ? [] : methods,
			};
		});
		const relationships: Record<string, unknown>[] = [];
		const relate = (kind: ClassRelationshipKind, from: number, to: number, ends = false) => {
			relationships.push({
				id: `r${relationships.length}`,
				kind,
				from: `c${from}`,
				to: `c${to}`,
				...(ends && random() < 0.7
					? {
							fromMultiplicity: kind === "composition" ? pick(["1", "0..1"]) : pick(MULTIPLICITIES),
							toMultiplicity: pick(MULTIPLICITIES),
						}
					: {}),
				...(ends && random() < 0.3 ? { toRole: pick(ROLES) } : {}),
				...(ends && random() < 0.15 ? { fromRole: pick(ROLES) } : {}),
				...(kind === "association" && random() < 0.4 ? { navigable: true } : {}),
				...(random() < 0.12 ? { label: pick(LABELS) } : {}),
			});
		};
		for (let at = interfaces; at < size; at += 1) {
			const roll = random();
			const isInterface = (node: number) => classes[node]!.kind === "interface";
			if (classes[at]!.kind === "enum") {
				if (at > 0 && random() < 0.6) relate("dependency", Math.floor(random() * at), at);
				continue;
			}
			if (roll < 0.45 && at > interfaces) {
				const parent = interfaces + Math.floor(random() * (at - interfaces));
				if (classes[parent]!.kind !== "enum") relate("inheritance", at, parent);
			} else if (roll < 0.6 && interfaces > 0)
				relate("realization", at, Math.floor(random() * interfaces));
			if (at > 0 && random() < 0.55) {
				const other = Math.floor(random() * at);
				if (!isInterface(other) || random() < 0.3)
					relate(
						pick(["association", "association", "composition", "aggregation"] as const),
						other,
						at,
						true,
					);
			}
			if (random() < 0.06) relate("association", at, at, true);
		}
		for (let at = 1; at < interfaces; at += 1) if (random() < 0.5) relate("inheritance", at, 0);
		if (size >= 4 && random() < 0.4)
			relate("dependency", size - 1, Math.floor(random() * (size - 1)));
		return parseClassDiagram(
			resolveClassShorthand({
				id: `class-fuzz-${index}`,
				title: `Class fuzz ${index}`,
				type: "class",
				classes,
				relationships,
			}),
		);
	});
}

/** Interior crossings between arrows, counted on corners only, and reader-scale findings. */
function routingCounts(scene: RenderedDiagramScene) {
	const arrows = scene.elements.flatMap((e) => (e.type === "arrow" ? [e] : []));
	const routes = arrows.map((a) => ({
		id: a.edgeId,
		points: a.points,
		sourceId: a.sourceNodeId,
		targetId: a.targetNodeId,
	}));
	const scale = routingQualityScale({ width: scene.width, height: scene.height });
	const quality = candidateRouteQuality(routes, scale);
	const between = (value: number, p: number, q: number) =>
		value > Math.min(p, q) + 0.01 && value < Math.max(p, q) - 0.01;
	let crossings = 0;
	for (const [index, a] of arrows.entries())
		for (const b of arrows.slice(index + 1))
			for (const s of segmentsFromPoints(a.points))
				for (const t of segmentsFromPoints(b.points)) {
					if (s.orientation === t.orientation) continue;
					const [h, v] = s.orientation === "horizontal" ? [s, t] : [t, s];
					if (
						between(v.staticCoordinate, h.min, h.max) &&
						between(h.staticCoordinate, v.min, v.max)
					)
						crossings += 1;
				}
	return {
		crossings,
		findings:
			routingQualityFindings(routes, scale).length +
			routes.filter((route) => quality(route).arrowheadsCrossed > 0).length,
	};
}

/** Neighboring ports on one side of a box stand at least this far apart. */
const PORT_CLEARANCE = 24;
/** Parallel runs of two lines closer than this read as one line. */
const PARALLEL_CLEARANCE = 10;
/**
 * A label reads as its own line's only when every other line stands half again
 * as far off, and at least this much further.
 */
const ATTRIBUTION_RATIO = 1.5;
const ATTRIBUTION_MARGIN = 8;
/** A multiplicity or role sits beside its end when its middle stands this near the end's tip. */
const END_LABEL_REACH = 110;

/** Everything the export validator, the canvas validator or the layout guards would flag. */
function defects(diagram: ClassDiagram): string[] {
	const scene = renderDiagram(diagram);
	const exported = convertSceneToExcalidraw(scene);
	const boxes = scene.elements.flatMap((element) =>
		element.type === "node" && element.kind === "class" ? [element] : [],
	);
	const arrows = scene.elements.flatMap((element) => (element.type === "arrow" ? [element] : []));
	const overlapping = boxes.flatMap((box, index) =>
		boxes
			.slice(index + 1)
			.filter(
				(other) =>
					box.x < other.x + other.width &&
					other.x < box.x + box.width &&
					box.y < other.y + other.height &&
					other.y < box.y + box.height,
			)
			.map((other) => `${box.id} overlaps ${other.id}`),
	);
	const diagonal = arrows.flatMap((arrow) =>
		arrow.points.some(
			(point, index) =>
				index > 0 &&
				Math.abs(point.x - arrow.points[index - 1]!.x) > 0.01 &&
				Math.abs(point.y - arrow.points[index - 1]!.y) > 0.01,
		)
			? [`${arrow.id} runs diagonally`]
			: [],
	);
	// Every end has a port of its own.
	const ports = arrows.flatMap((arrow) => [
		`${arrow.sourceNodeId}@${arrow.points[0].x},${arrow.points[0].y}`,
		`${arrow.targetNodeId}@${arrow.points.at(-1)!.x},${arrow.points.at(-1)!.y}`,
	]);
	const shared = ports
		.filter((port, index) => ports.indexOf(port) !== index)
		.map((port) => `${port} shared`);
	// No side packs its ports closer than a port step's worth: crowded boxes grow instead.
	const sides = new Map<string, number[]>();
	for (const arrow of arrows)
		for (const [node, point] of [
			[arrow.sourceNodeId, arrow.points[0]],
			[arrow.targetNodeId, arrow.points.at(-1)!],
		] as const) {
			const box = boxes.find((candidate) => candidate.nodeId === node)!;
			const level =
				Math.abs(point.y - box.y) < 0.01 || Math.abs(point.y - box.y - box.height) < 0.01;
			const side = level ? `${node}:y${point.y}` : `${node}:x${point.x}`;
			sides.set(side, [...(sides.get(side) ?? []), level ? point.x : point.y]);
		}
	const packed = [...sides].flatMap(([side, along]) => {
		const sorted = along.toSorted((a, b) => a - b);
		return sorted.slice(1).some((value, index) => value - sorted[index]! < PORT_CLEARANCE)
			? [`${side} packs its ports`]
			: [];
	});
	// Class text never wraps: each compartment holds its widest member, the band its name.
	const unwrapped = exported.elements.flatMap((element) =>
		element.type === "text" &&
		/^(?:text:|label:[^:]+:name$)/u.test(element.id) &&
		element.text !== element.originalText
			? [`${element.id} wraps`]
			: [],
	);
	// Every free label stands clear of boxes, lines and other labels.
	const labels = scene.elements.flatMap((element) => {
		if (
			element.type !== "text" ||
			element.containerId !== undefined ||
			!element.id.startsWith("relationship:")
		)
			return [];
		const width = estimateTextWidth(element.text, element.fontSize);
		const height = element.text.split("\n").length * element.fontSize * 1.35;
		return [
			{
				id: element.id,
				left: element.x - width / 2,
				right: element.x + width / 2,
				top: element.y - height / 2,
				bottom: element.y + height / 2,
			},
		];
	});
	const segments = arrows.flatMap((arrow) => segmentsFromPoints(arrow.points));
	const crowded = labels.flatMap((label, index) => [
		...boxes
			.filter(
				(box) =>
					label.left < box.x + box.width &&
					box.x < label.right &&
					label.top < box.y + box.height &&
					box.y < label.bottom,
			)
			.map((box) => `${label.id} on ${box.id}`),
		...segments
			.filter((segment) =>
				segment.orientation === "horizontal"
					? segment.staticCoordinate > label.top &&
						segment.staticCoordinate < label.bottom &&
						segment.max > label.left &&
						segment.min < label.right
					: segment.staticCoordinate > label.left &&
						segment.staticCoordinate < label.right &&
						segment.max > label.top &&
						segment.min < label.bottom,
			)
			.map(() => `${label.id} on a line`),
		...labels
			.slice(index + 1)
			.filter(
				(other) =>
					label.left < other.right &&
					other.left < label.right &&
					label.top < other.bottom &&
					other.top < label.bottom,
			)
			.map((other) => `${label.id} on ${other.id}`),
	]);
	// Every free label reads as its own line's: every other line stands clearly further off.
	const routes = new Map(arrows.map((arrow) => [arrow.edgeId, segmentsFromPoints(arrow.points)]));
	const gap = (label: (typeof labels)[number], run: AxisAlignedSegment) => {
		const [x0, x1, y0, y1] =
			run.orientation === "horizontal"
				? [run.min, run.max, run.staticCoordinate, run.staticCoordinate]
				: [run.staticCoordinate, run.staticCoordinate, run.min, run.max];
		return Math.hypot(
			Math.max(0, label.left - x1, x0 - label.right),
			Math.max(0, label.top - y1, y0 - label.bottom),
		);
	};
	const misattributed = labels.flatMap((label) => {
		const owner = label.id.split(":")[1]!;
		const own = Math.min(...routes.get(owner)!.map((run) => gap(label, run)));
		const [other, nearest] = [...routes]
			.filter(([id]) => id !== owner)
			.map(([id, runs]) => [id, Math.min(...runs.map((run) => gap(label, run)))] as const)
			.reduce((best, next) => (next[1] < best[1] ? next : best), ["", Infinity] as const);
		return nearest < Math.max(ATTRIBUTION_RATIO * own, own + ATTRIBUTION_MARGIN)
			? [`${label.id} ${own.toFixed(0)} px from its line, ${nearest.toFixed(0)} px from ${other}`]
			: [];
	});
	// Every multiplicity and role reads as its own end's: beside that end's tip, and the
	// line's other tip clearly further off.
	const tips = new Map(arrows.map((arrow) => [arrow.edgeId, arrow.points]));
	const reach = (label: (typeof labels)[number], tip: { x: number; y: number }) =>
		Math.hypot(
			Math.max(0, label.left - tip.x, tip.x - label.right),
			Math.max(0, label.top - tip.y, tip.y - label.bottom),
		);
	const misplaced = labels.flatMap((label) => {
		const [, owner, end] = label.id.split(":");
		if (end !== "from" && end !== "to") return [];
		const points = tips.get(owner!)!;
		const [tip, far] = end === "from" ? [points[0], points.at(-1)!] : [points.at(-1)!, points[0]];
		const [own, other] = [reach(label, tip), reach(label, far)];
		const center = Math.hypot(
			(label.left + label.right) / 2 - tip.x,
			(label.top + label.bottom) / 2 - tip.y,
		);
		return center > END_LABEL_REACH ||
			other < Math.max(ATTRIBUTION_RATIO * own, own + ATTRIBUTION_MARGIN)
			? [`${label.id} ${own.toFixed(0)} px from its end, ${other.toFixed(0)} px from the other`]
			: [];
	});
	// No two lines run side by side closer than a reader can tell apart.
	const runs = arrows.flatMap((arrow) =>
		segmentsFromPoints(arrow.points).map((segment) => ({ arrow: arrow.id, segment })),
	);
	const hugging = runs.flatMap((left, index) =>
		runs
			.slice(index + 1)
			.filter(
				(right) =>
					right.arrow !== left.arrow &&
					right.segment.orientation === left.segment.orientation &&
					Math.abs(right.segment.staticCoordinate - left.segment.staticCoordinate) <
						PARALLEL_CLEARANCE &&
					Math.min(right.segment.max, left.segment.max) -
						Math.max(right.segment.min, left.segment.min) >
						0,
			)
			.map((right) => `${left.arrow} runs beside ${right.arrow}`),
	);
	return [
		...getCanvasValidationIssues(scene).map((issue) => issue.message),
		...validateExcalidrawScene(exported).issues.map((issue) => issue.message),
		...overlapping,
		...diagonal,
		...shared,
		...packed,
		...unwrapped,
		...crowded,
		...misattributed,
		...misplaced,
		...hugging,
	];
}

/**
 * Crossings and reader-scale findings ("crossings/findings") each random model
 * draws, in order. None may draw more crossings, nor more crossings and
 * findings together, and together they may draw no more of either.
 */
const CLASS_ROUTING = "0/0 0/0 0/0 0/2 0/0 0/0 0/2 0/0 0/0 1/0 0/0 0/1 0/0 0/0 0/0 0/0";

/** Models checked in CI; the full fuzz runs locally with CLASS_FUZZ=full (and any CLASS_FUZZ_SEED). */
const CI_MODELS = 16;
const FULL = process.env["CLASS_FUZZ"] === "full";

describe("class diagram routing fuzz", () => {
	const models = randomModels(
		FULL ? 240 : CI_MODELS,
		Number(process.env["CLASS_FUZZ_SEED"] ?? 20261019),
	);

	it("exports every random model valid, orthogonal, unwrapped, with ports apart and labels clear", () => {
		const failures = models.flatMap((model, index) =>
			defects(model).map((defect) => `${index}: ${defect}`),
		);
		expect(failures).toEqual([]);
	});

	it("draws no random model with more crossings or reader-scale findings than pinned", () => {
		const counts = models.slice(0, CI_MODELS).map((model) => routingCounts(renderDiagram(model)));
		if (process.env["PRINT_ROUTING"])
			console.log("PIN class", counts.map((c) => `${c.crossings}/${c.findings}`).join(" "));
		const pinned = CLASS_ROUTING.split(" ").map((pair) => pair.split("/").map(Number));
		const worse = counts.flatMap(({ crossings, findings }, index) => {
			const [pinnedCrossings, pinnedFindings] = pinned[index] as [number, number];
			return crossings > pinnedCrossings || crossings + findings > pinnedCrossings + pinnedFindings
				? [`${index}: ${pinned[index]!.join("/")} -> ${crossings}/${findings}`]
				: [];
		});
		const total = (pairs: readonly (readonly number[])[], at: number) =>
			pairs.reduce((sum, pair) => sum + pair[at]!, 0);
		const drawn = counts.map(({ crossings, findings }) => [crossings, findings]);
		expect(worse).toEqual([]);
		expect(total(drawn, 0)).toBeLessThanOrEqual(total(pinned, 0));
		expect(total(drawn, 1)).toBeLessThanOrEqual(total(pinned, 1));
	});
});

/** Text-fit fuzz: member counts up to the limit and signatures up to the longest allowed. */
describe("class diagram text fit fuzz", () => {
	it("fits every compartment's text in its box at any member count and signature length", () => {
		const { random, pick } = seeded(Number(process.env["CLASS_FUZZ_SEED"] ?? 7));
		const failures: string[] = [];
		for (let round = 0; round < (FULL ? 120 : 12); round += 1) {
			const signature = (length: number) => {
				const params: string[] = [];
				while (`+ run(${params.join(", ")}): ${pick(TYPES)}`.length < length - 24)
					params.push(`p${params.length}: ${pick(TYPES)}`);
				return `+ run${round}(${params.join(", ")}): ${pick(TYPES)}`;
			};
			const members = Math.floor(random() * 30);
			const node = {
				id: `Wide${round}`,
				name: `${pick(NAMES)}${"X".repeat(Math.floor(random() * 30))}`,
				kind: pick(["interface", "abstract", undefined] as const),
				attributes: Array.from(
					{ length: Math.floor(members / 2) },
					(_, at) => `- ${pick(MEMBERS)}${at}: ${pick(TYPES)}`,
				),
				methods: Array.from({ length: members - Math.floor(members / 2) }, (_, at) =>
					signature(20 + Math.floor(random() * 56)).replace("run", `run${at}`),
				),
			};
			const diagram = parseClassDiagram(
				resolveClassShorthand({
					id: `fit-${round}`,
					title: "Fit",
					type: "class",
					classes: [JSON.parse(JSON.stringify(node)), { id: "Other" }],
					relationships: [
						{ id: "r", kind: "association", from: node.id, to: "Other", toMultiplicity: "0..*" },
					],
				}),
			);
			const scene = renderDiagram(diagram);
			const exported = convertSceneToExcalidraw(scene);
			const outline = scene.elements.find((element) => element.id === `node:${node.id}`);
			if (outline?.type !== "node") throw new Error("missing outline");
			for (const element of scene.elements) {
				if (element.type !== "text" || !element.id.startsWith(`text:${node.id}:`)) continue;
				const width = estimateTextWidth(element.text, element.fontSize);
				const height =
					element.text.split("\n").length * element.fontSize * (element.lineHeight ?? 1.35);
				if (
					element.x - width / 2 < outline.x ||
					element.x + width / 2 > outline.x + outline.width ||
					element.y - height / 2 < outline.y ||
					element.y + height / 2 > outline.y + outline.height
				)
					failures.push(`${round}: ${element.id} outside its box`);
			}
			failures.push(
				...getCanvasValidationIssues(scene).map((issue) => `${round}: ${issue.message}`),
				...exported.elements.flatMap((element) =>
					element.type === "text" && element.text !== element.originalText
						? [`${round}: ${element.id} wraps`]
						: [],
				),
			);
		}
		expect(failures).toEqual([]);
	});
});
