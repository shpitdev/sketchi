import { describe, expect, it } from "vitest";
import {
	candidateRouteQuality,
	getCanvasValidationIssues,
	groupFixtures,
	groupRegionIssues,
	labelFixtures,
	parseCanonicalDiagram,
	parseFlowchartDiagram,
	routingQualityFindings,
	routingQualityScale,
	segmentCrossesBoundsInterior,
	segmentsFromPoints,
} from "@sketchi/diagram-core";
import {
	renderDiagram,
	renderGraphDiagram,
	renderIntermediateDiagram,
} from "@sketchi/diagram-renderer";
import { convertSceneToExcalidraw, validateExcalidrawScene } from "./convert";

type Kind = "start" | "process" | "decision" | "end";

const WORDS = [
	"Stage",
	"Review request",
	"Check eligibility and limits",
	"Approve",
	"Notify customer",
	"Escalate to on-call engineer",
];

const BRANCHES = [
	"Yes",
	"No",
	"Retry",
	"Out of policy",
	"Details received",
	"Escalate",
	"Details were received and are now ready for further review",
	"Needs a second approval from finance",
];

/**
 * Deterministic pseudo-random flowcharts that the flowchart validator accepts:
 * one start, reachable steps with a forward exit, decisions with two to six
 * uniquely labeled branches (some long enough to wrap), fan-in and retry loops.
 */
function randomFlowcharts(count: number, start = 20261017, branches = BRANCHES, words = WORDS) {
	let seed = start;
	const random = () => {
		seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
		return seed / 2_147_483_648;
	};
	const pick = <T>(values: readonly T[]) => values[Math.floor(random() * values.length)]!;
	return Array.from({ length: count }, (_, index) => {
		const size = 4 + Math.floor(random() * 13);
		const kinds: Kind[] = Array.from({ length: size }, (_, i) =>
			i === 0
				? "start"
				: i === size - 1
					? "end"
					: random() < 0.3
						? "decision"
						: random() < 0.12
							? "end"
							: "process",
		);
		const later = (i: number) => pick(kinds.map((_, j) => j).filter((j) => j > i));
		const edges = new Map<string, readonly [number, number]>();
		const add = (source: number, target: number) => {
			if (source !== target && target !== 0 && !edges.has(`${source}>${target}`))
				edges.set(`${source}>${target}`, [source, target]);
		};
		const outgoing = (i: number) => [...edges.values()].filter(([source]) => source === i);
		for (let i = 1; i < size; i += 1) {
			const sources = kinds.flatMap((kind, j) => (j < i && kind !== "end" ? [j] : []));
			add(random() < 0.6 && kinds[i - 1] !== "end" ? i - 1 : pick(sources), i);
		}
		for (let i = 0; i < size - 1; i += 1) {
			if (kinds[i] === "end") continue;
			if (!outgoing(i).some(([, target]) => target > i)) add(i, later(i));
			if (kinds[i] === "decision") {
				const want = 2 + Math.floor(random() * 5);
				for (let attempt = 0; attempt < 12 && outgoing(i).length < want; attempt += 1)
					add(i, random() < 0.3 && i > 1 ? 1 + Math.floor(random() * (i - 1)) : later(i));
				for (let j = i + 1; j < size && outgoing(i).length < 2; j += 1) add(i, j);
				for (let j = 1; j < i && outgoing(i).length < 2; j += 1) add(i, j);
				if (outgoing(i).length < 2) kinds[i] = "process";
			} else if (random() < 0.15)
				add(i, random() < 0.3 && i > 1 ? 1 + Math.floor(random() * (i - 1)) : later(i));
		}
		const used = new Map<number, string[]>();
		const branchLabel = (source: number) => {
			const taken = used.get(source) ?? [];
			const label =
				branches.find((word) => !taken.includes(word) && random() < 0.4) ??
				branches.find((word) => !taken.includes(word))!;
			used.set(source, [...taken, label]);
			return label;
		};
		return {
			id: `fuzz-${index}`,
			title: `Fuzz ${index}`,
			nodes: kinds.map((kind, i) => ({ id: `n${i}`, label: `${pick(words)} ${i}`, kind })),
			edges: [...edges.values()].map(([source, target], edge) => ({
				id: `e${edge}`,
				source: `n${source}`,
				target: `n${target}`,
				...(kinds[source] === "decision"
					? { label: branchLabel(source) }
					: random() < 0.1
						? { label: pick(branches) }
						: {}),
			})),
		};
	});
}

/**
 * Long flows the layout wraps into rows or columns: a spine of 5 to 16 steps,
 * some handoffs labeled, with decisions whose other branch ends, skips a step or
 * loops back, so some cuts are clean and others are spanned.
 */
function randomLongFlows(count: number) {
	let seed = 20261018;
	const random = () => {
		seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
		return seed / 2_147_483_648;
	};
	const pick = <T>(values: readonly T[]) => values[Math.floor(random() * values.length)]!;
	const steps = ["Collect input", "Validate the request", "Render", "Store artifact", "Notify"];
	const handoffs = ["Request", "Validated spec", "Scene ready for export", "Artifact ID + URLs"];
	return Array.from({ length: count }, (_, index) => {
		const size = 5 + Math.floor(random() * 12);
		const nodes: { id: string; label: string; kind: "start" | "process" | "decision" | "end" }[] =
			Array.from({ length: size }, (_, i) => ({
				id: `n${i}`,
				label: `${pick(steps)} ${i}`,
				kind: i === 0 ? "start" : i === size - 1 ? "end" : "process",
			}));
		const edges: { id: string; source: string; target: string; label?: string }[] = [];
		for (let i = 1; i < size; i += 1)
			edges.push({
				id: `s${i}`,
				source: `n${i - 1}`,
				target: `n${i}`,
				...(random() < 0.5 ? { label: pick(handoffs) } : {}),
			});
		for (let i = 1; i < size - 2; i += 1) {
			if (random() > 0.25) continue;
			const node = nodes[i]!;
			node.kind = "decision";
			node.label = `Check ${i}?`;
			const spine = edges.find((edge) => edge.source === node.id)!;
			spine.label = "Yes";
			const branch = random();
			const target =
				branch < 0.4 || (branch >= 0.7 && i < 2)
					? (nodes.push({ id: `x${i}`, label: `Stop ${i}`, kind: "end" }), `x${i}`)
					: branch < 0.7
						? `n${Math.min(size - 1, i + 2)}`
						: `n${i - 1}`;
			edges.push({ id: `b${i}`, source: node.id, target, label: "No" });
		}
		return { id: `long-${index}`, title: `Long ${index}`, nodes, edges };
	});
}

/**
 * Flowcharts in this set that main (d050809c) already exports with validator
 * issues under straight and curved routing: a single straight segment cannot
 * leave the column or row of nodes between its ends. Never more than these.
 */
const PLAIN_DIRECT_FAILURES: Readonly<Record<"TB" | "BT" | "LR" | "RL", readonly number[]>> = {
	TB: [0, 7, 16, 26, 27, 31, 33, 35, 36, 39],
	BT: [0, 1, 7, 16, 26, 27, 31, 33, 35, 36, 39],
	LR: [0, 8, 16, 23, 26, 27, 29, 31, 33, 35, 39],
	RL: [0, 8, 16, 23, 26, 27, 29, 31, 33, 35, 39],
};

/** Interior crossings between arrows and reader-scale findings, as the layout guards count them. */
function routingCounts(scene: ReturnType<typeof renderIntermediateDiagram>) {
	const nodes = scene.elements.flatMap((e) => (e.type === "node" ? [e] : []));
	const arrows = scene.elements.flatMap((e) => (e.type === "arrow" ? [e] : []));
	const points = [
		...nodes.flatMap((n) => [
			{ x: n.x, y: n.y },
			{ x: n.x + n.width, y: n.y + n.height },
		]),
		...arrows.flatMap((a) => a.points),
	];
	const scale = routingQualityScale({
		width: Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x)),
		height: Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y)),
	});
	const routes = arrows.map((a) => ({
		id: a.edgeId,
		points: a.points,
		sourceId: a.sourceNodeId,
		targetId: a.targetNodeId,
	}));
	const quality = candidateRouteQuality(routes, scale);
	const inside = (value: number, p: number, q: number) =>
		value > Math.min(p, q) + 0.01 && value < Math.max(p, q) - 0.01;
	const horizontal = (p: { x: number; y: number }, q: { x: number; y: number }) =>
		Math.abs(p.y - q.y) < 0.01 && Math.abs(p.x - q.x) > 0.01;
	const vertical = (p: { x: number; y: number }, q: { x: number; y: number }) =>
		Math.abs(p.x - q.x) < 0.01 && Math.abs(p.y - q.y) > 0.01;
	let crossings = 0;
	for (const [index, a] of arrows.entries())
		for (const b of arrows.slice(index + 1))
			for (const [i, p] of a.points.slice(0, -1).entries())
				for (const [j, r] of b.points.slice(0, -1).entries()) {
					const q = a.points[i + 1]!;
					const u = b.points[j + 1]!;
					const [h0, h1, v0, v1] =
						horizontal(p, q) && vertical(r, u)
							? [p, q, r, u]
							: vertical(p, q) && horizontal(r, u)
								? [r, u, p, q]
								: [];
					if (h0 && h1 && v0 && v1 && inside(v0.x, h0.x, h1.x) && inside(h0.y, v0.y, v1.y))
						crossings += 1;
				}
	return {
		crossings,
		findings:
			routingQualityFindings(routes, scale).length +
			routes.filter((route) => quality(route).arrowheadsCrossed > 0).length,
	};
}

/**
 * Crossings and reader-scale findings ("crossings/findings") main (44f7c09e)
 * draws for each flowchart above, routed orthogonally, in order. Layout and
 * crossing repairs are kept only when they route no worse, so no flowchart may
 * draw more of either.
 */
const MAIN_ROUTING: Readonly<
	Record<"flowcharts" | "longFlows", Readonly<Record<"TB" | "BT" | "LR" | "RL", string>>>
> = {
	flowcharts: {
		TB: "131/61 32/2 1/0 20/1 20/3 0/0 4/0 22/1 29/16 15/0 8/2 25/1 0/0 4/0 18/1 8/2 3/0 2/0 1/0 0/0 3/0 0/0 22/3 68/4 17/2 58/22 19/0 42/3 58/8 11/0 73/3 4/0 87/25 42/4 1/0 2/0 36/7 16/6 5/1 52/11",
		BT: "130/17 31/1 1/0 16/3 16/7 0/0 3/0 13/0 25/7 16/2 4/3 25/1 0/0 1/0 18/1 18/2 6/1 1/0 1/0 0/0 6/0 0/0 23/5 68/6 17/4 64/19 25/7 40/3 56/7 15/5 76/7 3/0 102/34 37/4 1/0 2/0 46/11 16/7 5/1 39/0",
		LR: "148/34 43/9 1/0 24/4 30/9 0/0 3/1 18/6 33/28 13/2 7/2 37/13 0/0 4/0 8/3 18/5 2/3 2/0 3/1 0/0 6/1 0/0 23/4 89/21 34/16 81/11 18/3 42/75 48/16 12/1 78/14 6/0 65/18 25/7 1/0 4/1 55/16 23/12 6/4 38/10",
		RL: "129/36 28/13 1/0 14/2 28/8 0/0 2/1 11/5 22/8 16/3 7/2 37/10 0/0 4/0 8/3 18/5 5/1 1/0 3/1 0/0 6/1 0/0 18/4 91/26 34/16 82/10 25/11 42/75 37/17 14/9 78/14 2/0 88/14 22/7 1/0 4/1 57/13 22/12 6/4 42/4",
	},
	longFlows: {
		TB: "0/0 0/0 1/0 2/0 1/1 1/0 0/0 0/0 0/0 2/0 0/0 1/0 0/0 0/0 0/0 1/0 0/0 1/0 0/0 3/0 2/0 2/1 0/0 1/0 0/0 0/0 0/0 2/2 0/0 0/0",
		BT: "0/0 0/0 0/0 1/0 0/0 0/0 0/0 0/0 0/0 2/0 0/0 0/0 0/0 0/0 0/0 0/0 0/0 0/0 0/0 3/0 2/0 2/1 0/0 1/0 0/0 0/0 0/0 0/0 0/0 0/0",
		LR: "0/0 0/0 1/0 2/2 3/0 1/0 0/0 0/0 0/0 2/1 0/0 0/0 0/0 0/0 0/0 1/0 0/0 0/0 0/0 3/2 0/0 2/2 0/0 0/0 0/0 0/0 0/0 1/3 0/0 0/0",
		RL: "0/0 0/0 1/0 1/2 0/0 1/0 0/0 0/0 0/0 3/1 0/0 0/0 0/0 0/0 0/0 1/0 0/0 0/0 0/0 4/3 0/0 2/2 0/0 0/0 0/0 0/0 0/0 0/0 0/0 0/0",
	},
};

/** Long words, identifiers, a URL and authored line breaks, as models write labels. */
const LONG_BRANCHES = [
	"Acceptable",
	"Unacceptable",
	"No — unresolved",
	"Unavailable",
	"Reproduced",
	"renderer-independent",
	"buildSequenceDiagram",
	"https://example.com/api/v1/artifacts/download",
	"Retry after the provider\nconfirms the refund",
	"Escalate to the incident commander and page on-call",
];
const LONG_WORDS = [
	"Unacceptable",
	"buildSequenceDiagram output",
	"Verify renderer-independent layout",
	"Reproduced",
	"品質保証レビュー承認待ち",
	"Ship 🚀 release",
];

type ExportedElement = ReturnType<typeof convertSceneToExcalidraw>["elements"][number];

/** Line breaks the export inserted inside a Latin word or identifier of `original`. */
function midWordBreaks(original: string, wrapped: string): string[] {
	const word = /[\p{L}\p{N}]/u;
	const wide = /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u9fff\uac00-\ud7a3\uff00-\uff60]/u;
	const breaks: string[] = [];
	let index = 0;
	for (const char of wrapped.split("")) {
		if (char === "\n" && original[index] !== " " && original[index] !== "\n") {
			const [before, after] = [original[index - 1] ?? "", original[index] ?? ""];
			const camel = /\p{Ll}/u.test(before) && /\p{Lu}/u.test(after);
			if (word.test(before) && word.test(after) && !wide.test(before + after) && !camel)
				breaks.push(`${original.slice(0, index)}|${original.slice(index)}`);
			continue;
		}
		index += 1;
	}
	return breaks;
}

/**
 * Painted label defects in an export: a word broken across lines, or an
 * unbound edge label crossed by any arrow (its own included), overlapping a
 * node or another label, judged on the stored, wrapped text box.
 */
function labelDefects(
	elements: readonly ExportedElement[],
	authored: ReadonlyMap<string, string>,
): string[] {
	const box = (e: ExportedElement) => ({
		x: e.x as number,
		y: e.y as number,
		width: e.width as number,
		height: e.height as number,
	});
	const overlaps = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) =>
		a.x < b.x + b.width - 1 &&
		b.x < a.x + a.width - 1 &&
		a.y < b.y + b.height - 1 &&
		b.y < a.y + a.height - 1;
	// The box point nearest a shape's center minimizes both axis distances, so it
	// decides overlap with a rectangle, a diamond and an ellipse alike.
	const overlapsShape = (bounds: ReturnType<typeof box>, shape: ExportedElement) => {
		const { x, y, width, height } = box(shape);
		const [rx, ry] = [width / 2 - 1, height / 2 - 1];
		const dx = Math.max(bounds.x, Math.min(x + width / 2, bounds.x + bounds.width)) - x - width / 2;
		const dy =
			Math.max(bounds.y, Math.min(y + height / 2, bounds.y + bounds.height)) - y - height / 2;
		const [u, v] = [Math.abs(dx) / rx, Math.abs(dy) / ry];
		return shape.type === "diamond"
			? u + v < 1
			: shape.type === "ellipse"
				? u * u + v * v < 1
				: u < 1 && v < 1;
	};
	const texts = elements.filter((e) => e.type === "text");
	const labels = texts.filter((e) => !e.containerId);
	const shapes = elements.filter((e) => ["rectangle", "diamond", "ellipse"].includes(e.type));
	const arrows = elements.filter((e) => e.type === "arrow");
	const defects = texts.flatMap((text) =>
		midWordBreaks(
			authored.get(String(text.containerId)) ?? String(text.originalText),
			String(text.text),
		).map((at) => `${text.id} breaks ${at}`),
	);
	for (const [index, label] of labels.entries()) {
		const bounds = box(label);
		for (const arrow of arrows) {
			const points = (arrow.points as [number, number][]).map(([x, y]) => ({
				x: (arrow.x as number) + x,
				y: (arrow.y as number) + y,
			}));
			if (
				segmentsFromPoints(points).some((segment) =>
					segmentCrossesBoundsInterior(segment, bounds, 1),
				)
			)
				defects.push(`${label.id} crossed by ${arrow.id}`);
		}
		for (const shape of shapes)
			if (overlapsShape(bounds, shape)) defects.push(`${label.id} on ${shape.id}`);
		for (const other of labels.slice(index + 1))
			if (overlaps(bounds, box(other))) defects.push(`${label.id} on ${other.id}`);
	}
	return defects;
}

/**
 * Label defects the fuzz still draws: routes that run back across their own
 * source run, and crowded fan-ins where no spot within reach of the source is
 * clear. Main drew 38 crossed labels, 133 labels on nodes or labels and 1,348
 * broken words here. Never more than these.
 */
const KNOWN_LABEL_DEFECTS: Readonly<Record<"TB" | "BT" | "LR" | "RL", readonly string[]>> = {
	TB: ["7: edge:e7:label crossed by edge:e7"],
	BT: [
		"7: edge:e7:label crossed by edge:e7",
		"19: edge:e11:label crossed by edge:e11",
		"23: edge:e20:label on node:n7",
	],
	LR: [
		"0: edge:e26:label crossed by edge:e23",
		"8: edge:e19:label crossed by edge:e19",
		"16: edge:e24:label crossed by edge:e22",
		"16: edge:e24:label on node:n9",
		"16: edge:e33:label crossed by edge:e33",
		"23: edge:e12:label on edge:e14:label",
	],
	RL: [
		"0: edge:e26:label crossed by edge:e23",
		"14: edge:e16:label crossed by edge:e6",
		"16: edge:e24:label crossed by edge:e22",
		"16: edge:e24:label on node:n9",
		"23: edge:e10:label on edge:e14:label",
		"23: edge:e14:label crossed by edge:e10",
	],
};

describe("label fuzz", () => {
	// Long words and multi-line labels: words stay whole and every edge label stays
	// clear of every line, node and label, in every direction.
	const flowcharts = randomFlowcharts(30, 20261019, LONG_BRANCHES, LONG_WORDS);
	it.each(["TB", "BT", "LR", "RL"] as const)("keeps %s labels whole and clear", (direction) => {
		const defects = flowcharts.flatMap((spec, index) => {
			const elements = convertSceneToExcalidraw(
				renderIntermediateDiagram(
					parseFlowchartDiagram({
						...spec,
						type: "flowchart",
						layout: { direction, edgeRouting: "orthogonal" },
					}),
				),
			).elements;
			const authored = new Map(spec.nodes.map((node) => [`node:${node.id}`, node.label]));
			return labelDefects(elements, authored).map((defect) => `${index}: ${defect}`);
		});
		expect(defects.filter((defect) => !KNOWN_LABEL_DEFECTS[direction].includes(defect))).toEqual(
			[],
		);
	});
});

describe.each(["TB", "BT", "LR", "RL"] as const)("label fixtures: %s", (direction) => {
	it.each(Object.keys(labelFixtures) as (keyof typeof labelFixtures)[])(
		"keeps %s words whole and labels clear",
		(name) => {
			const fixture = labelFixtures[name];
			const elements = convertSceneToExcalidraw(
				renderIntermediateDiagram({ ...fixture, layout: { ...fixture.layout, direction } }),
			).elements;
			const authored = new Map(fixture.nodes.map((node) => [`node:${node.id}`, node.label]));
			expect(labelDefects(elements, authored)).toEqual([]);
		},
	);
});

/**
 * Long words, identifiers and URLs every family must fit: each unbreakable run
 * is at most the 24-glyph long-word bound, or breaks at a deliberate boundary.
 */
const LONG_TOKENS = [
	"AuthenticationController",
	"PaymentReconciliationWorker",
	"buildSequenceDiagram",
	"renderer-independent",
	"exportToExcalidrawScene(spec)",
	"https://example.com/api/v1/artifacts/download",
	"a_very_long_snake_case_identifier_name",
	"Unacceptable",
	"internationalization",
	"品質保証レビュー承認待ち",
	"Ship 🚀 release",
	"Retry after the provider\nconfirms the refund",
];

/** Seeded labels of one to three tokens, mixing long tokens with plain words. */
function tokenLabels(seed: number) {
	const random = () => {
		seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
		return seed / 2_147_483_648;
	};
	const pick = <T>(values: readonly T[]) => values[Math.floor(random() * values.length)]!;
	const label = () =>
		Array.from({ length: 1 + Math.floor(random() * 3) }, () =>
			random() < 0.6 ? pick(LONG_TOKENS) : pick(["review", "the", "order", "Stage 2"]),
		).join(" ");
	return { label, random, pick };
}

/** Canonical diagrams of every family whose every text field draws from `LONG_TOKENS`. */
function longTokenDiagrams(count: number) {
	return Array.from({ length: count }, (_, index) => {
		const { label, random } = tokenLabels(20261020 + index);
		const size = 3 + Math.floor(random() * 5);
		const ids = Array.from({ length: size }, (_, i) => `n${i}`);
		const flowchart = {
			id: `flow-${index}`,
			title: label(),
			type: "flowchart",
			nodes: ids.map((id, i) => ({
				id,
				label: label(),
				kind: i === 0 ? "start" : i === size - 1 ? "end" : i === 1 ? "decision" : "process",
			})),
			edges: [
				...ids.slice(1).map((id, i) => ({
					id: `e${i}`,
					source: ids[i]!,
					target: id,
					...(i === 1 ? { label: label() } : {}),
				})),
				{ id: "branch", source: "n1", target: ids.at(-1)!, label: label() },
			],
			layout: {
				direction: (["TB", "BT", "LR", "RL"] as const)[index % 4],
				edgeRouting: "orthogonal",
			},
		};
		const mindmap = {
			id: `mind-${index}`,
			title: label(),
			type: "mindmap",
			nodes: [
				{ id: "root", label: label(), kind: "root", metadata: { depth: 0, siblingIndex: 0 } },
				...ids.map((id, i) => ({
					id,
					label: label(),
					kind: "topic",
					metadata: { depth: i < 3 ? 1 : 2, siblingIndex: i < 3 ? i : i - 3 },
				})),
			],
			edges: ids.map((id, i) => ({
				id: `m${i}`,
				source: i < 3 ? "root" : "n0",
				target: id,
				metadata: { depth: i < 3 ? 1 : 2, siblingIndex: i < 3 ? i : i - 3 },
			})),
			layout: { direction: "LR", edgeRouting: "orthogonal" },
		};
		const lanes = [label(), label()];
		const timeline = {
			id: `time-${index}`,
			title: label(),
			type: "timeline",
			events: ids.map((id, i) => ({
				id,
				label: label(),
				date: `2026-0${1 + i}-01`,
				...(i % 3 === 1 ? { end: `2026-0${2 + i}-15` } : {}),
				...(i % 3 === 2 ? { kind: "milestone" } : {}),
				...(random() < 0.5 ? { description: label() } : {}),
				...(index % 2 === 0 ? { lane: lanes[i % 2]! } : {}),
			})),
		};
		const sequence = {
			id: `seq-${index}`,
			title: label(),
			type: "sequence",
			participants: ids.slice(0, Math.min(size, 5)).map((id) => ({ id, label: label() })),
			messages: Array.from({ length: size + 2 }, (_, i) => {
				const source = Math.floor(random() * Math.min(size, 5));
				const target =
					(source + 1 + Math.floor(random() * (Math.min(size, 5) - 1))) % Math.min(size, 5);
				return { id: `s${i}`, source: `n${source}`, target: `n${target}`, label: label() };
			}),
		};
		const stateMachine = {
			id: `state-${index}`,
			title: label(),
			type: "state-machine",
			initial: "n0",
			states: [
				...ids.map((id, i) => ({
					id,
					label: label(),
					...(i >= 2 && i < 4 ? { parent: "composite" } : {}),
				})),
				{ id: "composite", label: label(), initial: ids[2] ?? "n2" },
				{ id: "end", kind: "final" },
			].filter((state) => state.id !== "composite" || ids.length > 2),
			transitions: [
				...ids.slice(1).map((id, i) => ({
					id: `t${i}`,
					source: ids[i]!,
					target: i >= 1 && i < 3 && ids.length > 2 ? (i === 1 ? "composite" : id) : id,
					event: label(),
					...(i % 2 === 0 ? { guard: label() } : { action: label() }),
				})),
				{ id: "loop", source: "n0", target: "n0", event: label() },
				{ id: "done", source: ids.at(-1)!, target: "end" },
			],
		};
		return { flowchart, mindmap, timeline, sequence, "state-machine": stateMachine };
	});
}

describe("text fit fuzz", () => {
	// Every family sizes its containers to whole words: no validator issue and no
	// word broken across lines in the export.
	const diagrams = longTokenDiagrams(24);
	it.each(["flowchart", "mindmap", "timeline", "sequence", "state-machine"] as const)(
		"fits long words and identifiers in every %s",
		(family) => {
			const failures = diagrams.flatMap((specs, index) => {
				const diagram = parseCanonicalDiagram(specs[family]);
				const scene = renderDiagram(diagram);
				const elements = convertSceneToExcalidraw(scene).elements;
				const authored = new Map(
					[
						...("nodes" in diagram ? diagram.nodes : []),
						...("participants" in diagram ? diagram.participants : []),
						...("states" in diagram
							? diagram.states.flatMap((state) =>
									state.label ? [{ id: state.id, label: state.label }] : [],
								)
							: []),
					].map((node) => [`node:${node.id}`, node.label]),
				);
				return [
					...getCanvasValidationIssues(scene).map((issue) => issue.code),
					...validateExcalidrawScene({ ...convertSceneToExcalidraw(scene) }).issues.map(
						(issue) => issue.code,
					),
					...elements.flatMap((text) =>
						text.type === "text"
							? midWordBreaks(
									authored.get(String(text.containerId)) ?? String(text.originalText),
									String(text.text),
								)
							: [],
					),
				].map((failure) => `${index}: ${failure}`);
			});
			expect(failures).toEqual([]);
		},
	);
});

describe("routing fuzz", () => {
	// 40 flowcharts x 3 routing modes x 4 directions = 480 exports. Locally 4320
	// exports over six seeds had none worse than main, and none invalid orthogonally;
	// main fails 7-12 of these 40 per direction orthogonally. The timeout only guards a hang.
	const flowcharts = randomFlowcharts(40);
	const failures = (
		direction: "TB" | "BT" | "LR" | "RL",
		edgeRouting: "orthogonal" | "straight" | "curved",
	) =>
		flowcharts.flatMap((spec, index) => {
			const diagram = parseFlowchartDiagram({
				...spec,
				type: "flowchart",
				layout: { direction, edgeRouting },
			});
			const issues = validateExcalidrawScene(
				convertSceneToExcalidraw(renderIntermediateDiagram(diagram)),
			).issues;
			return issues.length > 0 ? [index] : [];
		});

	// Long flows wrap into bands only when the wrapped layout routes no worse; it
	// must never cost a valid export. Spine edges that run back along the flow
	// show which flows wrapped.
	const longFlows = randomLongFlows(30);
	const longFlowExports = (direction: "TB" | "BT" | "LR" | "RL") =>
		longFlows.map((spec) => {
			const scene = renderIntermediateDiagram(
				parseFlowchartDiagram({
					...spec,
					type: "flowchart",
					layout: { direction, edgeRouting: "orthogonal" },
				}),
			);
			const nodes = new Map(
				scene.elements.flatMap((e) => (e.type === "node" ? [[e.nodeId, e] as const] : [])),
			);
			const along = (id: string) => {
				const node = nodes.get(id)!;
				const vertical = direction === "TB" || direction === "BT";
				const value = vertical ? node.y + node.height / 2 : node.x + node.width / 2;
				return direction === "TB" || direction === "LR" ? value : -value;
			};
			return {
				issues: validateExcalidrawScene(convertSceneToExcalidraw(scene)).issues.length,
				wrapped: spec.edges.some(
					(edge) => edge.id.startsWith("s") && along(edge.target) < along(edge.source),
				),
			};
		});

	// Rendered flowcharts with more crossings or reader-scale findings than main.
	const worseThanMain = (direction: "TB" | "BT" | "LR" | "RL") =>
		(
			[
				["flowcharts", flowcharts],
				["longFlows", longFlows],
			] as const
		).flatMap(([set, specs]) => {
			const pinned = MAIN_ROUTING[set][direction]
				.split(" ")
				.map((pair) => pair.split("/").map(Number));
			return specs.flatMap((spec, index) => {
				const { crossings, findings } = routingCounts(
					renderIntermediateDiagram(
						parseFlowchartDiagram({
							...spec,
							type: "flowchart",
							layout: { direction, edgeRouting: "orthogonal" },
						}),
					),
				);
				const [mainCrossings, mainFindings] = pinned[index]!;
				return crossings > mainCrossings! || findings > mainFindings!
					? [`${set} ${index}: ${mainCrossings}/${mainFindings} -> ${crossings}/${findings}`]
					: [];
			});
		});

	it("routes the review's fan-in case no worse than main in RL", () => {
		// Seed 143289, case 33: an unguarded arrival order drew 8 crossings and 4 findings.
		const { crossings, findings } = routingCounts(
			renderIntermediateDiagram(
				parseFlowchartDiagram({
					...randomFlowcharts(34, 143289)[33]!,
					type: "flowchart",
					layout: { direction: "RL", edgeRouting: "orthogonal" },
				}),
			),
		);
		expect(crossings).toBeLessThanOrEqual(6);
		expect(findings).toBeLessThanOrEqual(3);
	});

	describe.each(["TB", "BT", "LR", "RL"] as const)("%s", (direction) => {
		it("draws no flowchart with more crossings or reader-scale findings than main", () => {
			expect(worseThanMain(direction)).toEqual([]);
		}, 60_000);

		it("exports every random flowchart without validator issues when routed orthogonally", () => {
			expect(failures(direction, "orthogonal")).toEqual([]);
		}, 60_000);

		it("exports every random long flow without validator issues, wrapped or not", () => {
			const exports = longFlowExports(direction);
			expect(exports.filter((result) => result.issues > 0)).toEqual([]);
			expect(exports.filter((result) => result.wrapped).length).toBeGreaterThan(5);
		}, 60_000);

		it.each(["straight", "curved"] as const)(
			"never exports a %s flowchart with issues that main exports cleanly",
			(edgeRouting) => {
				const allowed = PLAIN_DIRECT_FAILURES[direction];
				expect(
					failures(direction, edgeRouting).filter((index) => !allowed.includes(index)),
				).toEqual([]);
			},
			60_000,
		);
	});
});

const GROUP_LABELS = [
	"Finance",
	"QA",
	"Private subnet",
	"Customer support desk",
	"Legal and compliance review board",
	"WWW NETWORK OPERATIONS AND WEB WORKERS",
];

/**
 * The random flowcharts above with groups: one to four per flowchart, holding
 * runs of steps in flow order or, in about a third, steps scattered through the
 * flow, with about a quarter of the steps left ungrouped.
 */
function randomGroupedFlowcharts(count: number, start: number) {
	let seed = start;
	const random = () => {
		seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
		return seed / 2_147_483_648;
	};
	return randomFlowcharts(count, start).map((spec) => {
		const groupCount = 1 + Math.floor(random() * 4);
		const scattered = random() < 0.3;
		const membership = spec.nodes.map((_, index) =>
			random() < 0.25
				? undefined
				: scattered
					? Math.floor(random() * groupCount)
					: Math.min(groupCount - 1, Math.floor((index / spec.nodes.length) * groupCount)),
		);
		return {
			...spec,
			groups: Array.from({ length: groupCount }, (_, group) => ({
				id: `g${group}`,
				label: GROUP_LABELS[Math.floor(random() * GROUP_LABELS.length)]!,
			})).filter((_, group) => membership.includes(group)),
			nodes: spec.nodes.map((node, index) =>
				membership[index] === undefined ? node : { ...node, group: `g${membership[index]}` },
			),
		};
	});
}

/**
 * Crossings and reader-scale findings ("crossings/findings") the grouped
 * layout draws for each grouped flowchart, in order, when groups were added.
 * No grouped flowchart may draw more of either.
 */
const GROUPED_ROUTING: Readonly<Record<"TB" | "BT" | "LR" | "RL", string>> = {
	TB: "11/0 1/0 4/0 23/6 11/2 3/3 2/0 9/0 54/14 2/1 22/13 118/37 9/1 116/44 26/6 18/1 13/0 18/11 7/1 23/7 65/21 84/22 23/4 0/0 65/15 50/8 10/3 56/8 51/6 0/0",
	BT: "10/1 1/0 5/0 15/4 3/2 6/2 3/0 9/0 52/22 0/0 23/15 123/46 9/1 110/44 24/8 19/1 8/2 20/6 6/5 26/7 85/22 76/23 19/0 0/0 69/17 52/8 6/1 57/11 63/14 3/0",
	LR: "8/4 1/0 2/0 25/6 9/5 5/3 2/0 6/6 66/20 3/1 25/8 114/42 8/1 105/100 27/3 13/4 4/2 18/10 8/2 19/12 44/7 84/29 22/1 0/0 80/36 48/56 6/0 44/12 54/16 1/1",
	RL: "7/3 1/0 3/5 31/9 10/5 7/4 3/0 6/4 66/23 1/1 23/8 128/47 9/3 107/103 34/4 18/4 4/2 18/10 11/4 23/13 51/4 85/25 19/4 0/0 79/34 72/13 9/4 44/15 63/23 1/1",
};

describe("grouped routing fuzz", () => {
	// 30 grouped flowcharts x 4 directions, each rendered once. Every export is valid, each group's
	// frame holds exactly its members and stays apart from the others, no edge
	// passes through a group it does not belong to or runs along a frame, a
	// group's own edges stay inside it, and group names stay clear of edges and
	// labels. Branch labels on these dense random graphs are judged as the label
	// fuzz judges ungrouped ones; grouped, they draw no more defects in total.
	const flowcharts = randomGroupedFlowcharts(30, 20261020);
	const scenes = new Map<string, ReturnType<typeof renderIntermediateDiagram>[]>();
	const rendered = (direction: "TB" | "BT" | "LR" | "RL") => {
		if (!scenes.has(direction))
			scenes.set(
				direction,
				flowcharts.map((spec) =>
					renderIntermediateDiagram(
						parseFlowchartDiagram({
							...spec,
							type: "flowchart",
							layout: { direction, edgeRouting: "orthogonal" },
						}),
					),
				),
			);
		return scenes.get(direction)!;
	};

	describe.each(["TB", "BT", "LR", "RL"] as const)("%s", (direction) => {
		it("exports every grouped flowchart with its groups whole, apart and clear", () => {
			const failures = flowcharts.flatMap((spec, index) => {
				const scene = rendered(direction)[index]!;
				const exported = convertSceneToExcalidraw(scene);
				const members = new Map<string, string>(
					spec.nodes.flatMap((node) =>
						"group" in node ? [[`node:${node.id}`, `group:${node.group}`] as const] : [],
					),
				);
				return [
					...validateExcalidrawScene(exported).issues.map((issue) => issue.message),
					...groupRegionIssues(scene).map((issue) => issue.message),
					...getCanvasValidationIssues(scene).map((issue) => issue.message),
					...exported.elements
						.filter(
							(element) =>
								element.type === "ellipse" ||
								element.type === "rectangle" ||
								element.type === "diamond",
						)
						.flatMap((element) =>
							(members.get(element.id) ?? null) === element.frameId
								? []
								: [`${element.id} in frame ${String(element.frameId)}`],
						),
				].map((failure) => `${index}: ${failure}`);
			});
			expect(failures).toEqual([]);
		}, 60_000);

		it("draws no grouped flowchart with more crossings or reader-scale findings than when groups were added", () => {
			const counts = rendered(direction).map((scene) => routingCounts(scene));
			const pinned = GROUPED_ROUTING[direction]
				.split(" ")
				.map((pair) => pair.split("/").map(Number));
			expect(
				counts.flatMap(({ crossings, findings }, index) => {
					const [pinnedCrossings, pinnedFindings] = pinned[index] ?? [];
					return crossings > pinnedCrossings! || findings > pinnedFindings!
						? [`${index}: ${pinnedCrossings}/${pinnedFindings} -> ${crossings}/${findings}`]
						: [];
				}),
			).toEqual([]);
		}, 60_000);
	});

	it.each(Object.keys(groupFixtures) as (keyof typeof groupFixtures)[])(
		"exports the %s fixture with its groups whole, apart and clear",
		(name) => {
			for (const direction of ["TB", "BT", "LR", "RL"] as const) {
				const scene = renderIntermediateDiagram({
					...groupFixtures[name],
					layout: { direction, edgeRouting: "orthogonal" },
				});
				const exported = convertSceneToExcalidraw(scene);
				const authored = new Map(
					groupFixtures[name].nodes.map((node) => [`node:${node.id}`, node.label]),
				);
				expect([
					...validateExcalidrawScene(exported).issues,
					...groupRegionIssues(scene),
					...labelDefects(exported.elements, authored),
				]).toEqual([]);
			}
		},
	);
});

const EVENTS = [
	"pay",
	"cancel / refund",
	"timeout [retries < 3]",
	"[approved]",
	"ship / notify customer",
	"reject [stock missing] / restock",
	"tick",
	"return [within 30 days] / refund",
];

/**
 * Random graphs as a state machine draws them: an initial dot, a chain of
 * states with some returns (pairs), self-loops, a choice with guarded branches,
 * finals, and sometimes a composite state with its own initial dot and
 * transitions into and out of its frame.
 */
function randomStateGraphs(count: number, start = 20261021) {
	let seed = start;
	const random = () => {
		seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
		return seed / 2_147_483_648;
	};
	const pick = <T>(values: readonly T[]) => values[Math.floor(random() * values.length)]!;
	return Array.from({ length: count }, (_, index) => {
		const size = 3 + Math.floor(random() * 7);
		const states = Array.from({ length: size }, (_, i) => `s${i}`);
		const composite = size >= 5 && random() < 0.5;
		const members = composite ? states.slice(2, 4) : [];
		const node = (id: string, label: string, kind: string, group?: string) => ({
			id,
			label,
			kind,
			metadata: {},
			...(group ? { group } : {}),
		});
		const nodes = [
			node("init", "", "initial"),
			...(composite ? [node("c-init", "", "initial", "c")] : []),
			...states.map((id) =>
				node(id, `${pick(WORDS)} ${id}`, "state", members.includes(id) ? "c" : undefined),
			),
		];
		const edges: { id: string; source: string; target: string; label?: string; metadata: {} }[] =
			[];
		const add = (source: string, target: string, label?: string) =>
			edges.push({
				id: `e${edges.length}`,
				source,
				target,
				metadata: {},
				...(label ? { label } : {}),
			});
		add("init", "s0");
		if (composite) add("c-init", members[0]!);
		for (let i = 0; i + 1 < size; i += 1) {
			// The composite is entered and left at its frame, its members linked inside.
			const [from, to] = [states[i]!, states[i + 1]!];
			if (composite && members.includes(to) && !members.includes(from))
				add(from, "c", pick(EVENTS));
			else if (composite && members.includes(from) && !members.includes(to))
				add("c", to, pick(EVENTS));
			else add(from, to, pick(EVENTS));
			if (random() < 0.3 && !(composite && members.includes(from) !== members.includes(to)))
				add(to, from, pick(EVENTS));
		}
		for (const id of states) if (random() < 0.25) add(id, id, pick(EVENTS));
		if (size >= 4 && random() < 0.5) {
			nodes.push(node("choice", "", "choice"));
			const from = members.includes(states[1]!) ? "c" : states[1]!;
			add(from, "choice", pick(EVENTS));
			add("choice", states.at(-1)!, "[yes]");
			add("choice", "s0", "[else]");
		}
		for (const [i, id] of [states.at(-1)!, ...(random() < 0.5 ? [states[0]!] : [])].entries()) {
			nodes.push(node(`end${i}`, "", "final"));
			add(id, `end${i}`);
		}
		return {
			id: `state-${index}`,
			title: `State ${index}`,
			type: "flowchart",
			style: { accentColor: "#8f707f", backgroundColor: "#fffdf8" },
			metadata: {},
			nodes,
			edges,
			...(composite ? { groups: [{ id: "c", label: pick(GROUP_LABELS) }] } : {}),
		};
	});
}

/**
 * Crossings and reader-scale findings ("crossings/findings") each random state
 * graph drew when state graphs were added, in order. None may draw more.
 */
const STATE_ROUTING: Readonly<Record<"TB" | "BT" | "LR" | "RL", string>> = {
	TB: "0/0 0/0 1/0 0/0 1/0 0/0 2/1 5/0 0/0 0/0 0/0 1/0 0/0 0/0 0/0 3/0 1/1 1/0 0/0 0/0 0/0 0/0 0/0 2/0 0/0 1/1 1/0 0/0 0/0 3/1 0/0 0/0 0/0 1/0 2/0 3/1 0/0 1/1 4/1 3/0",
	BT: "0/0 0/0 0/0 0/0 0/0 0/0 2/1 3/0 0/0 0/0 0/0 0/1 0/0 0/0 0/0 1/0 4/1 0/0 0/0 0/0 0/0 0/1 1/1 2/0 0/0 1/0 0/2 0/0 0/0 0/1 0/0 0/0 0/0 1/0 2/0 3/0 0/0 0/0 1/1 0/0",
	LR: "0/0 0/0 1/1 0/0 1/0 0/0 0/0 2/4 0/0 0/0 0/0 3/0 1/2 0/0 0/0 1/2 2/5 2/1 0/0 0/0 0/0 2/1 1/5 0/0 0/0 2/1 1/2 0/0 0/0 1/0 0/0 0/0 1/0 1/1 2/1 1/3 0/0 0/1 4/0 1/1",
	RL: "0/0 0/0 0/1 0/0 0/0 0/0 0/0 2/3 0/0 0/0 0/0 0/0 0/1 0/0 0/0 2/4 2/4 3/2 0/0 0/0 0/0 1/3 1/2 0/0 0/0 1/1 1/1 1/0 0/0 0/3 0/0 0/0 1/0 1/1 1/1 3/4 0/0 0/1 3/1 0/1",
};

describe("state graph fuzz", () => {
	// 40 graphs x 4 directions. Self-loops, paired returns, choices and
	// transitions into and out of a composite's frame all export valid and bound,
	// with their groups whole and labels whole and clear.
	const graphs = randomStateGraphs(40);
	describe.each(["TB", "BT", "LR", "RL"] as const)("%s", (direction) => {
		it("exports every state graph valid, bound, grouped and labeled clear", () => {
			const failures = graphs.flatMap((graph, index) => {
				const scene = renderGraphDiagram(
					{ ...graph, layout: { direction, edgeRouting: "orthogonal" } } as never,
					{ pairedReturns: true },
				);
				const exported = convertSceneToExcalidraw(scene);
				const byId = new Map(exported.elements.map((element) => [element.id, element]));
				const binding = (arrow: ExportedElement, key: "startBinding" | "endBinding") =>
					(arrow[key] as { elementId?: string } | null)?.elementId;
				const unbound = scene.elements.flatMap((element) => {
					if (element.type !== "arrow") return [];
					const arrow = byId.get(element.id);
					const ends = arrow ? [binding(arrow, "startBinding"), binding(arrow, "endBinding")] : [];
					const expected = [element.sourceNodeId, element.targetNodeId].map((id) =>
						id === "c" ? "group:c" : `node:${id}`,
					);
					// A frame keeps a bound arrow's end only as an elbow arrow's fixed point.
					const straightToFrame = expected.includes("group:c") && arrow?.["elbowed"] !== true;
					return JSON.stringify(ends) === JSON.stringify(expected) && !straightToFrame
						? []
						: [
								`${element.id} binds ${JSON.stringify(ends)}${straightToFrame ? " as a straight arrow" : ""}`,
							];
				});
				const authored = new Map(graph.nodes.map((node) => [`node:${node.id}`, node.label]));
				return [
					...validateExcalidrawScene(exported).issues.map((issue) => issue.message),
					...groupRegionIssues(scene).map((issue) => issue.message),
					...getCanvasValidationIssues(scene).map((issue) => issue.message),
					...labelDefects(exported.elements, authored),
					...unbound,
				].map((failure) => `${index}: ${failure}`);
			});
			expect(failures).toEqual([]);
		}, 60_000);

		it("draws no state graph with more crossings or reader-scale findings than when they were added", () => {
			const counts = graphs.map((graph) =>
				routingCounts(
					renderGraphDiagram(
						{ ...graph, layout: { direction, edgeRouting: "orthogonal" } } as never,
						{ pairedReturns: true },
					),
				),
			);
			if (process.env.PRINT_STATE_ROUTING)
				console.log(direction, counts.map((c) => `${c.crossings}/${c.findings}`).join(" "));
			const pinned = STATE_ROUTING[direction].split(" ").map((pair) => pair.split("/").map(Number));
			expect(
				counts.flatMap(({ crossings, findings }, index) => {
					const [pinnedCrossings, pinnedFindings] = pinned[index] ?? [];
					return crossings > pinnedCrossings! || findings > pinnedFindings!
						? [`${index}: ${pinnedCrossings}/${pinnedFindings} -> ${crossings}/${findings}`]
						: [];
				}),
			).toEqual([]);
		}, 60_000);
	});
});
