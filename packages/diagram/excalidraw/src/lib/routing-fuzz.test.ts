import { describe, expect, it } from "vitest";
import {
	candidateRouteQuality,
	getCanvasValidationIssues,
	groupFixtures,
	groupRegionIssues,
	labelFixtures,
	laneFixtures,
	laneRegionIssues,
	laneStressFixtures,
	parseCanonicalDiagram,
	parseFlowchartDiagram,
	routingQualityFindings,
	routingQualityScale,
	segmentCrossesBoundsInterior,
	segmentsFromPoints,
	zoneFixtures,
	zoneRegionIssues,
	zoneStressFixtures,
} from "@sketchi/diagram-core";
import {
	renderDiagram,
	renderGraphDiagram,
	renderIntermediateDiagram,
} from "@sketchi/diagram-renderer";
import { convertSceneToExcalidraw, validateExcalidrawScene } from "./convert";

// Keep every invariant and direction in the smoke run; the local target restores the full matrix.
const FULL = process.env["ROUTING_FUZZ"] === "full";

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
type Point = { x: number; y: number };

/** Arrows with a run that is neither horizontal nor vertical, which no orthogonal route has. */
function diagonalRuns(scene: ReturnType<typeof renderIntermediateDiagram>): string[] {
	return scene.elements.flatMap((element) =>
		element.type === "arrow" &&
		element.points.some(
			(point, index) =>
				index > 0 &&
				Math.abs(point.x - element.points[index - 1]!.x) > 0.01 &&
				Math.abs(point.y - element.points[index - 1]!.y) > 0.01,
		)
			? [`${element.id} runs diagonally`]
			: [],
	);
}

/** A route's corners alone, so a line crossing it where it runs straight on counts once. */
function corners(points: readonly Point[]): Point[] {
	return points.filter((p, i) => {
		const [a, b] = [points[i - 1], points[i + 1]];
		return (
			!a ||
			!b ||
			!(
				(Math.abs(a.x - p.x) < 0.01 && Math.abs(p.x - b.x) < 0.01) ||
				(Math.abs(a.y - p.y) < 0.01 && Math.abs(p.y - b.y) < 0.01)
			)
		);
	});
}

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
	const runs = arrows.map((arrow) => corners(arrow.points));
	for (const [index, a] of runs.entries())
		for (const b of runs.slice(index + 1))
			for (const [i, p] of a.slice(0, -1).entries())
				for (const [j, r] of b.slice(0, -1).entries()) {
					const q = a[i + 1]!;
					const u = b[j + 1]!;
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
 * Graphs drawn with more crossings or findings than pinned ("crossings/findings"
 * per graph, in order), and the whole set when its crossings are not fewer in
 * total than pinned, or, not `fewer`, more.
 */
function worseThanPinned(
	set: string,
	counts: readonly { crossings: number; findings: number }[],
	pins: string,
	fewer = true,
): string[] {
	const pinned = pins
		.split(" ")
		.slice(0, counts.length)
		.map((pair) => pair.split("/").map(Number));
	const failures = counts.flatMap(({ crossings, findings }, index) => {
		const [pinnedCrossings, pinnedFindings] = pinned[index]!;
		return crossings > pinnedCrossings! || findings > pinnedFindings!
			? [`${set} ${index}: ${pinnedCrossings}/${pinnedFindings} -> ${crossings}/${findings}`]
			: [];
	});
	const total = counts.reduce((sum, { crossings }) => sum + crossings, 0);
	const pinnedTotal = pinned.reduce((sum, [crossings]) => sum + crossings!, 0);
	return pinnedTotal > 0 && (fewer ? total >= pinnedTotal : total > pinnedTotal)
		? [...failures, `${set}: ${total} crossings in total, pinned ${pinnedTotal}`]
		: failures;
}

/**
 * Crossings and reader-scale findings ("crossings/findings") main (fd92ae12)
 * draws for each flowchart above, routed orthogonally, in order, counting a
 * line that crosses a route where the route runs straight on. Layout and
 * crossing repairs are kept only when they route no worse, so no flowchart may
 * draw more of either, and together they draw fewer crossings.
 */
const MAIN_ROUTING: Readonly<
	Record<"flowcharts" | "longFlows", Readonly<Record<"TB" | "BT" | "LR" | "RL", string>>>
> = {
	flowcharts: {
		TB: "136/61 26/0 1/0 19/1 24/3 0/0 4/0 12/0 30/16 12/0 4/0 27/1 0/0 2/0 14/0 11/2 1/0 2/0 2/0 0/0 5/0 0/0 22/3 72/4 20/2 59/22 19/0 45/3 60/8 7/0 78/3 4/0 91/25 29/3 1/0 2/0 37/7 15/6 4/1 33/7",
		BT: "135/17 33/0 1/0 14/2 18/7 0/0 1/0 9/0 28/7 14/0 5/3 26/1 0/0 1/0 14/0 21/2 3/0 1/0 2/0 0/0 3/0 0/0 15/0 72/6 18/4 68/19 21/1 42/3 57/7 16/5 81/7 3/0 106/34 35/3 1/0 2/0 47/11 15/7 4/1 41/0",
		LR: "150/34 31/5 1/0 22/3 28/8 0/0 3/1 19/6 34/28 14/1 7/2 39/13 0/0 4/0 8/3 18/5 2/3 2/0 3/1 0/0 3/1 0/0 22/3 96/21 21/5 81/11 12/2 46/75 50/16 12/1 80/14 5/0 68/18 26/7 2/0 4/1 58/16 24/12 6/4 37/10",
		RL: "129/36 30/6 1/0 14/2 25/8 0/0 2/1 11/5 24/8 16/2 7/2 39/10 0/0 4/0 8/3 18/5 6/1 1/0 3/1 0/0 3/1 0/0 18/4 96/26 19/7 82/10 16/5 46/75 40/17 15/9 80/14 1/0 92/14 23/7 2/0 4/1 58/13 23/12 6/4 42/4",
	},
	longFlows: {
		TB: "0/0 0/0 1/0 2/0 1/0 1/0 0/0 0/0 0/0 2/0 0/0 1/0 0/0 0/0 0/0 1/0 0/0 1/0 0/0 4/0 2/0 2/1 0/0 1/0 0/0 0/0 0/0 2/0 0/0 0/0",
		BT: "0/0 0/0 0/0 1/0 0/0 0/0 0/0 0/0 0/0 2/0 0/0 0/0 0/0 0/0 0/0 0/0 0/0 0/0 0/0 4/0 2/0 2/1 0/0 1/0 0/0 0/0 0/0 0/0 0/0 0/0",
		LR: "0/0 0/0 1/0 2/1 1/0 1/0 0/0 0/0 0/0 1/0 0/0 0/0 0/0 0/0 0/0 1/0 0/0 0/0 0/0 2/2 0/0 2/2 0/0 0/0 0/0 0/0 0/0 2/2 0/0 0/0",
		RL: "0/0 0/0 1/0 1/1 0/0 1/0 0/0 0/0 0/0 2/1 0/0 0/0 0/0 0/0 0/0 1/0 0/0 0/0 0/0 4/3 0/0 2/2 0/0 0/0 0/0 0/0 0/0 0/0 0/0 0/0",
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
	// A zone is a region labels sit in, not a shape they cover.
	const shapes = elements.filter(
		(e) =>
			["rectangle", "diamond", "ellipse"].includes(e.type) &&
			(e.customData as { sketchiRendererRole?: string } | undefined)?.sketchiRendererRole !==
				"zone",
	);
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

/** Room a label keeps from any other line past its distance from its own. */
const LABEL_OWN_MARGIN = 8;

/**
 * Edge labels that read as another line's, as `<edge>><other edge>`: an
 * unbound edge label whose box sits no clearer of some other arrow than of its
 * own, by `LABEL_OWN_MARGIN`.
 */
function detachedLabels(elements: readonly ExportedElement[]): string[] {
	const arrows = elements.filter((e) => e.type === "arrow");
	const segments = (arrow: ExportedElement) => {
		const points = (arrow.points as [number, number][]).map(([x, y]) => ({
			x: (arrow.x as number) + x,
			y: (arrow.y as number) + y,
		}));
		return points.slice(1).map((q, i) => [points[i]!, q] as const);
	};
	return elements.flatMap((label) => {
		const own = arrows.find((arrow) => `${arrow.id}:label` === label.id);
		if (label.type !== "text" || label.containerId || !own) return [];
		const [x, y, width, height] = [label.x, label.y, label.width, label.height] as [
			number,
			number,
			number,
			number,
		];
		const distance = (arrow: ExportedElement) =>
			Math.min(
				...segments(arrow).map(([p, q]) =>
					Math.hypot(
						Math.max(0, x - Math.max(p.x, q.x), Math.min(p.x, q.x) - x - width),
						Math.max(0, y - Math.max(p.y, q.y), Math.min(p.y, q.y) - y - height),
					),
				),
			);
		const mine = distance(own);
		return arrows.flatMap((arrow) => {
			if (arrow === own) return [];
			const other = distance(arrow);
			return other < mine + LABEL_OWN_MARGIN
				? [`${own.id.slice("edge:".length)}>${arrow.id.slice("edge:".length)}`]
				: [];
		});
	});
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

/**
 * Labels the label fuzz still sets no clearer of another line than of their
 * own, as `<flowchart>:<edge>><other edge>`: dense fan-ins whose lines run
 * between labels, and labels a crossing line already marks above. Main set 143
 * here. Never more than these.
 */
const KNOWN_DETACHED_LABELS: Readonly<Record<"TB" | "BT" | "LR" | "RL", string>> = {
	TB: "4:e12>e10 11:e11>e15 16:e26>e13 16:e33>e20 19:e11>e7 19:e11>e16 19:e14>e5 19:e15>e7 19:e17>e5 19:e17>e14 24:e7>e6",
	BT: "11:e11>e15 16:e27>e13 16:e27>e22 16:e33>e22 16:e33>e27",
	LR: "0:e13>e20 0:e19>e22 0:e26>e23 6:e11>e9 16:e22>e24 16:e24>e22 16:e26>e13 19:e11>e5 29:e28>e20",
	RL: "0:e13>e20 0:e19>e22 0:e20>e22 0:e26>e23 6:e11>e1 6:e11>e12 8:e19>e21 13:e22>e18 14:e7>e16 16:e22>e24 16:e24>e22 16:e33>e20 19:e11>e5 23:e14>e10 29:e28>e20",
};

describe("label fuzz", () => {
	// Long words and multi-line labels: words stay whole and every edge label stays
	// clear of every line, node and label, in every direction.
	const flowcharts = randomFlowcharts(FULL ? 30 : 4, 20261019, LONG_BRANCHES, LONG_WORDS);
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

	// Every edge label sits nearer its own line than any other, by a clear margin.
	it.each(["TB", "BT", "LR", "RL"] as const)(
		"sets %s labels nearer their own line than any other",
		(direction) => {
			const known = KNOWN_DETACHED_LABELS[direction].split(" ");
			const detached = flowcharts.flatMap((spec, index) =>
				detachedLabels(
					convertSceneToExcalidraw(
						renderIntermediateDiagram(
							parseFlowchartDiagram({
								...spec,
								type: "flowchart",
								layout: { direction, edgeRouting: "orthogonal" },
							}),
						),
					).elements,
				).map((label) => `${index}:${label}`),
			);
			expect(detached.filter((label) => !known.includes(label))).toEqual([]);
		},
	);
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
	const diagrams = longTokenDiagrams(FULL ? 24 : 4);
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
	// Full proof: 40 flowcharts x 3 routing modes x 4 directions = 480 exports. Locally 4320
	// exports over six seeds had none worse than main, and none invalid orthogonally;
	// main fails 7-12 of these 40 per direction orthogonally. The timeout only guards a hang.
	const flowcharts = randomFlowcharts(FULL ? 40 : 4);
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
			const scene = renderIntermediateDiagram(diagram);
			const issues = [
				...validateExcalidrawScene(convertSceneToExcalidraw(scene)).issues,
				...(edgeRouting === "orthogonal" ? diagonalRuns(scene) : []),
			];
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
				issues:
					validateExcalidrawScene(convertSceneToExcalidraw(scene)).issues.length +
					diagonalRuns(scene).length,
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
			const counts = specs.map((spec) =>
				routingCounts(
					renderIntermediateDiagram(
						parseFlowchartDiagram({
							...spec,
							type: "flowchart",
							layout: { direction, edgeRouting: "orthogonal" },
						}),
					),
				),
			);
			if (process.env.PRINT_ROUTING)
				console.log(
					"PIN",
					set,
					direction,
					counts.map((c) => `${c.crossings}/${c.findings}`).join(" "),
				);
			return worseThanPinned(set, counts, MAIN_ROUTING[set][direction]);
		});

	it("keeps every run of the review's clearance case horizontal or vertical", () => {
		// Seed 20261020, case 4, TB: moving one of two collinear runs clear of a
		// node once turned the stub beside it diagonal.
		const scene = renderIntermediateDiagram(
			parseFlowchartDiagram({
				...randomFlowcharts(40, 20261020)[4]!,
				type: "flowchart",
				layout: { direction: "TB", edgeRouting: "orthogonal" },
			}),
		);
		expect(diagonalRuns(scene)).toEqual([]);
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

		it("exports every random flowchart orthogonal and without validator issues when routed orthogonally", () => {
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
 * Crossings and reader-scale findings ("crossings/findings") main (fd92ae12)
 * draws for each grouped flowchart, in order, counted as for MAIN_ROUTING. No
 * grouped flowchart may draw more of either, and together they draw fewer
 * crossings.
 */
const GROUPED_ROUTING: Readonly<Record<"TB" | "BT" | "LR" | "RL", string>> = {
	TB: "11/0 1/0 5/0 23/6 12/2 3/3 2/0 10/0 59/14 2/1 24/13 122/37 9/1 119/44 26/6 19/1 13/0 20/11 7/1 24/7 67/21 87/22 23/4 0/0 66/15 51/8 10/3 57/8 51/6 0/0",
	BT: "10/1 1/0 5/0 15/4 3/2 6/2 3/0 9/0 54/22 0/0 25/15 126/46 9/1 113/44 24/8 19/1 8/2 20/6 6/5 27/7 85/22 78/23 19/0 0/0 70/17 53/8 7/1 58/11 63/14 4/0",
	LR: "9/4 1/0 2/0 26/6 10/5 5/3 2/0 6/6 66/20 3/1 27/8 117/42 8/1 108/100 31/3 14/4 5/2 19/10 8/2 19/12 45/7 88/29 22/1 0/0 80/36 53/56 6/0 48/12 55/16 1/1",
	RL: "8/3 1/0 3/5 32/9 11/5 7/4 3/0 6/4 66/23 1/1 28/8 129/47 9/3 110/103 36/4 18/4 4/2 19/10 12/4 25/13 53/4 87/25 19/4 0/0 79/34 74/13 9/4 45/15 65/23 1/1",
};

describe("grouped routing fuzz", () => {
	// Full proof: 30 grouped flowcharts x 4 directions, each rendered once. Every export is valid, each group's
	// frame holds exactly its members and stays apart from the others, no edge
	// passes through a group it does not belong to or runs along a frame, a
	// group's own edges stay inside it, and group names stay clear of edges and
	// labels. Branch labels on these dense random graphs are judged as the label
	// fuzz judges ungrouped ones; grouped, they draw no more defects in total.
	const flowcharts = randomGroupedFlowcharts(FULL ? 30 : 8, 20261020);
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
					...diagonalRuns(scene),
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

		it("draws no grouped flowchart with more crossings or reader-scale findings than main", () => {
			const counts = rendered(direction).map((scene) => routingCounts(scene));
			if (process.env.PRINT_ROUTING)
				console.log(
					"PIN grouped",
					direction,
					counts.map((c) => `${c.crossings}/${c.findings}`).join(" "),
				);
			expect(worseThanPinned("grouped", counts, GROUPED_ROUTING[direction])).toEqual([]);
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

const ZONE_KINDS = [
	"cloud",
	"datacenter",
	"region",
	"zone",
	"vpc",
	"subnet",
	"cluster",
	"namespace",
	undefined,
] as const;
const ZONE_SHAPES = ["database", "queue", "document", "storage"] as const;

/**
 * The random flowcharts above in nested zones: two to eight zones, each inside
 * an earlier one about two times in three (never past four deep), with random
 * kinds. Steps sit in runs of flow order in a zone, any zone, or no zone; a
 * fifth of the non-decision steps draw as a database, a queue, a document or a bucket.
 * Zones that hold no step, directly or through another zone, are dropped.
 */
function randomZonedFlowcharts(count: number, start: number) {
	let seed = start;
	const random = () => {
		seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
		return seed / 2_147_483_648;
	};
	return randomFlowcharts(count, start).map((spec) => {
		const zoneCount = 2 + Math.floor(random() * 7);
		const parents: (number | undefined)[] = [];
		const depthOf = (zone: number): number =>
			parents[zone] === undefined ? 1 : 1 + depthOf(parents[zone]);
		for (let zone = 0; zone < zoneCount; zone += 1) {
			const candidates = parents.flatMap((_, earlier) => (depthOf(earlier) < 4 ? [earlier] : []));
			parents.push(
				zone > 0 && candidates.length > 0 && random() < 0.67
					? candidates[Math.floor(random() * candidates.length)]
					: undefined,
			);
		}
		const membership = spec.nodes.map((_, index) =>
			random() < 0.2
				? undefined
				: random() < 0.6
					? Math.min(zoneCount - 1, Math.floor((index / spec.nodes.length) * zoneCount))
					: Math.floor(random() * zoneCount),
		);
		const held = new Set<number>();
		for (const zone of membership)
			for (let id = zone; id !== undefined; id = parents[id]) held.add(id);
		return {
			...spec,
			groups: parents.flatMap((parent, zone) => {
				if (!held.has(zone)) return [];
				const kind = ZONE_KINDS[Math.floor(random() * ZONE_KINDS.length)];
				return [
					{
						id: `z${zone}`,
						label: GROUP_LABELS[Math.floor(random() * GROUP_LABELS.length)]!,
						...(parent === undefined ? {} : { parent: `z${parent}` }),
						...(kind ? { kind } : {}),
					},
				];
			}),
			nodes: spec.nodes.map((node, index) => ({
				...node,
				...(membership[index] === undefined ? {} : { group: `z${membership[index]}` }),
				...(node.kind !== "decision" && random() < 0.2
					? { shape: ZONE_SHAPES[Math.floor(random() * ZONE_SHAPES.length)] }
					: {}),
			})),
		};
	});
}

/**
 * Crossings and reader-scale findings ("crossings/findings") each zoned
 * flowchart draws, counted as for MAIN_ROUTING, since zones too long for one
 * row or column wrap and each zone sits by its members (totals within 1% of
 * the first pins). No zoned flowchart may draw more of either, nor all of them
 * more crossings in total.
 */
const ZONED_ROUTING: Readonly<Record<"TB" | "BT" | "LR" | "RL", string>> = {
	TB: "97/31 0/0 17/3 30/5 36/7 36/12 7/0 12/1 68/24 32/8 0/0 28/12 22/5 0/0 0/0 41/9 0/0 0/0 36/24 173/65 77/21 98/44 60/11 33/11 1/0 22/2 138/59 0/0 86/25 62/12",
	BT: "99/26 0/0 16/2 30/8 21/6 42/7 1/0 9/0 61/25 44/9 0/0 30/16 22/11 0/0 0/0 47/8 0/0 0/0 37/14 184/64 79/24 92/45 60/15 35/16 1/0 14/2 146/59 0/0 94/30 54/7",
	LR: "77/42 0/1 11/6 23/3 30/12 45/11 11/4 5/4 73/21 37/9 0/1 27/11 24/14 0/0 0/1 44/12 0/0 0/0 38/31 202/68 79/28 102/41 74/25 34/23 0/0 8/2 136/61 0/1 104/34 44/26",
	RL: "65/49 0/0 10/5 21/7 28/8 49/12 8/4 3/3 72/34 41/7 0/1 25/6 22/17 0/0 0/1 49/10 0/0 0/0 38/22 175/55 86/33 84/41 77/26 35/20 0/0 14/12 157/79 0/1 89/31 44/23",
};

/**
 * Branch labels on these dense random graphs that still touch a zone's outline
 * or label, pinned as known, as the label fuzz pins its label defects: a long
 * decision label wedged between its diamond and a zone a loop enters.
 */
const ZONED_LABEL_DEFECTS: Readonly<Record<"TB" | "BT" | "LR" | "RL", readonly string[]>> = {
	TB: [],
	BT: [
		'6: Text "edge:e2:label" covers the label or outline of zone "group:z0".',
		'23: Text "edge:e19:label" covers the label or outline of zone "group:z6".',
	],
	LR: [],
	RL: [],
};

describe("zoned routing fuzz", () => {
	// Full proof: 30 zoned flowcharts x 4 directions, each rendered once. Every export is valid, every
	// step sits in its zone and every zone in its parent, zones that do not nest
	// stay apart, no edge passes through a zone neither end sits in, runs along an
	// outline or crosses a label, and an edge whose ends share a zone stays inside it.
	const flowcharts = randomZonedFlowcharts(FULL ? 30 : 4, 20261019);
	const scenes = new Map<string, ReturnType<typeof renderIntermediateDiagram>[]>();
	const parsed = (direction: "TB" | "BT" | "LR" | "RL") =>
		flowcharts.map((spec) =>
			parseFlowchartDiagram({
				...spec,
				type: "flowchart",
				layout: { direction, edgeRouting: "orthogonal" },
			}),
		);
	const rendered = (direction: "TB" | "BT" | "LR" | "RL") => {
		if (!scenes.has(direction))
			scenes.set(
				direction,
				parsed(direction).map((diagram) => renderIntermediateDiagram(diagram)),
			);
		return scenes.get(direction)!;
	};

	describe.each(["TB", "BT", "LR", "RL"] as const)("%s", (direction) => {
		it("exports every zoned flowchart with its zones nested, apart and clear", () => {
			const diagrams = parsed(direction);
			const failures = rendered(direction).flatMap((scene, index) =>
				[
					...validateExcalidrawScene(convertSceneToExcalidraw(scene)).issues.map(
						(issue) => issue.message,
					),
					...diagonalRuns(scene),
					...zoneRegionIssues(scene, diagrams[index]!).map((issue) => issue.message),
					...getCanvasValidationIssues(scene).map((issue) => issue.message),
				].map((failure) => `${index}: ${failure}`),
			);
			expect(
				failures.filter((failure) => !ZONED_LABEL_DEFECTS[direction].includes(failure)),
			).toEqual([]);
		}, 120_000);

		it("draws no zoned flowchart with more crossings or reader-scale findings than pinned", () => {
			const counts = rendered(direction).map((scene) => routingCounts(scene));
			if (process.env.PRINT_ROUTING)
				console.log(
					"PIN zoned",
					direction,
					counts.map((c) => `${c.crossings}/${c.findings}`).join(" "),
				);
			expect(worseThanPinned("zoned", counts, ZONED_ROUTING[direction], false)).toEqual([]);
		}, 120_000);
	});

	it.each([...Object.keys(zoneFixtures), ...(FULL ? Object.keys(zoneStressFixtures) : [])])(
		"exports the %s fixture with its zones nested, apart and clear",
		(name) => {
			const fixture = { ...zoneFixtures, ...zoneStressFixtures }[name]!;
			for (const direction of ["TB", "BT", "LR", "RL"] as const) {
				const scene = renderIntermediateDiagram({
					...fixture,
					layout: { direction, edgeRouting: "orthogonal" },
				});
				const exported = convertSceneToExcalidraw(scene);
				const authored = new Map(fixture.nodes.map((node) => [`node:${node.id}`, node.label]));
				expect([
					...validateExcalidrawScene(exported).issues,
					...zoneRegionIssues(scene, fixture),
					...labelDefects(exported.elements, authored),
				]).toEqual([]);
			}
		},
		120_000,
	);
});

const LANE_LABELS = [
	"Customer",
	"Sales",
	"Hiring manager",
	"On-call engineer",
	"Finance and procurement",
	"QA",
	"Platform team",
];

/**
 * The random flowcharts above with lanes: two to six, each step's lane a walk
 * from the step before it, mostly to the neighboring lane, sometimes staying
 * or jumping two, so handoffs run straight, skip lanes and loop back across
 * them. Lanes no step uses are dropped.
 */
function randomLanedFlowcharts(count: number, start: number) {
	let seed = start;
	const random = () => {
		seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
		return seed / 2_147_483_648;
	};
	return randomFlowcharts(count, start).map((spec) => {
		const laneCount = 2 + Math.floor(random() * 5);
		let lane = 0;
		const laneOf = spec.nodes.map(() => {
			const step = random();
			const move = step < 0.25 ? 0 : step < 0.85 ? 1 : 2;
			const next = lane + (random() < 0.5 ? move : -move);
			lane = next < 0 || next >= laneCount ? lane - (next - lane) : next;
			lane = Math.min(laneCount - 1, Math.max(0, lane));
			return lane;
		});
		const labels = Array.from({ length: laneCount }, (_, index) => ({
			id: `l${index}`,
			label: LANE_LABELS[(index + Math.floor(random() * LANE_LABELS.length)) % LANE_LABELS.length]!,
		}));
		return {
			...spec,
			lanes: labels.filter((_, index) => laneOf.includes(index)),
			nodes: spec.nodes.map((node, index) => ({ ...node, lane: `l${laneOf[index]}` })),
		};
	});
}

/** Lane bands and headers are background shapes, not the nodes labels keep clear of. */
function withoutLanes(elements: readonly ExportedElement[]): ExportedElement[] {
	return elements.filter((element) => {
		const role = (element.customData as Record<string, unknown> | null | undefined)?.[
			"sketchiRendererRole"
		];
		return role !== "swimlane" && role !== "swimlane-header";
	});
}

/**
 * Label defects the laned fuzz still draws, all on dense random graphs: a
 * decision with up to six long-labeled branches whose labels find no clear
 * spot within reach of their source. Never more than these.
 */
const KNOWN_LANED_LABEL_DEFECTS: Readonly<Record<"TB" | "BT" | "LR" | "RL", readonly string[]>> = {
	TB: ["6: edge:e8:label on edge:e10:label", "6: edge:e10:label crossed by edge:e1"],
	BT: [
		"14: edge:e28:label crossed by edge:e20",
		"14: edge:e28:label on node:n12",
		"20: edge:e19:label on node:n11",
		"23: edge:e30:label crossed by edge:e30",
		"27: edge:e4:label on edge:e6:label",
	],
	LR: [
		"0: edge:e20:label crossed by edge:e22",
		"0: edge:e20:label on node:n7",
		"1: edge:e27:label crossed by edge:e27",
		"6: edge:e10:label on a lane boundary",
		"14: edge:e24:label crossed by edge:e23",
		"14: edge:e28:label crossed by edge:e20",
		"18: edge:e2:label crossed by edge:e4",
		"18: edge:e2:label on a lane boundary",
		"19: edge:e25:label on node:n12",
		"20: edge:e19:label on a lane boundary",
		"23: edge:e30:label crossed by edge:e27",
		"28: edge:e16:label crossed by edge:e20",
	],
	RL: [
		"0: edge:e20:label crossed by edge:e22",
		"0: edge:e20:label on node:n7",
		"6: edge:e10:label crossed by edge:e8",
		"6: edge:e10:label on node:n1",
		"8: edge:e7:label on a lane boundary",
		"11: edge:e14:label crossed by edge:e3",
		"11: edge:e14:label on node:n3",
		"14: edge:e28:label crossed by edge:e8",
		"20: edge:e19:label crossed by edge:e21",
		"20: edge:e19:label on node:n11",
		"23: edge:e34:label crossed by edge:e11",
		"23: edge:e34:label on a lane boundary",
		"25: edge:e24:label crossed by edge:e26",
		"28: edge:e7:label on edge:e16:label",
		"28: edge:e16:label crossed by edge:e7",
	],
};

/**
 * Crossings and reader-scale findings ("crossings/findings") each laned
 * flowchart draws, in order, counted as for MAIN_ROUTING. No laned flowchart
 * may draw more of either, and together they draw no more crossings.
 */
const LANED_ROUTING: Readonly<Record<"TB" | "BT" | "LR" | "RL", string>> = {
	TB: "63/8 47/17 4/0 5/0 13/1 0/0 24/0 14/3 0/0 0/0 0/0 29/10 3/0 11/1 86/12 0/0 3/0 0/0 0/0 54/12 24/5 0/0 14/4 109/35 0/0 83/36 18/4 0/0 62/4 0/0",
	BT: "52/8 42/9 5/0 11/1 15/1 0/0 15/1 13/2 0/0 0/0 0/0 22/14 3/2 7/2 83/15 1/0 1/0 0/0 0/0 40/10 27/7 0/0 14/6 113/36 0/0 109/37 14/4 0/0 57/8 1/0",
	LR: "64/7 36/20 5/1 3/0 17/0 0/0 20/2 12/4 0/1 0/0 0/0 32/8 3/0 10/5 111/14 0/1 3/0 0/0 0/0 34/5 21/7 0/0 17/3 115/33 0/0 105/43 19/5 1/0 61/11 0/0",
	RL: "49/7 41/28 5/1 8/1 17/0 0/0 17/3 12/4 0/0 0/0 0/0 16/3 3/0 8/5 99/15 0/1 3/0 0/0 0/0 36/6 22/14 0/0 15/5 99/98 0/0 104/45 18/6 1/0 68/21 0/0",
};

describe("laned routing fuzz", () => {
	// 30 laned flowcharts x 4 directions, each rendered once. Every export is valid
	// and orthogonal, every step sits in its own lane's band, lanes keep their
	// order and one length, no edge crosses a header, runs along a lane boundary
	// or leaves the lanes, and labels stay whole and clear of nodes, headers and
	// boundaries.
	const flowcharts = randomLanedFlowcharts(30, 20261022);
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
		it("exports every laned flowchart with its steps in their lanes and its routes clear", () => {
			const failures = flowcharts.flatMap((spec, index) => {
				const scene = rendered(direction)[index]!;
				return [
					...validateExcalidrawScene(convertSceneToExcalidraw(scene)).issues.map(
						(issue) => issue.message,
					),
					...diagonalRuns(scene),
					...laneRegionIssues(scene, spec)
						.filter((issue) => issue.code !== "label-covered")
						.map((issue) => issue.message),
					...getCanvasValidationIssues(scene).map((issue) => issue.message),
				].map((failure) => `${index}: ${failure}`);
			});
			expect(failures).toEqual([]);
		}, 60_000);

		it("keeps laned labels whole and clear of lines, nodes, headers and boundaries", () => {
			const defects = flowcharts.flatMap((spec, index) => {
				const scene = rendered(direction)[index]!;
				const exported = convertSceneToExcalidraw(scene);
				const authored = new Map(spec.nodes.map((node) => [`node:${node.id}`, node.label]));
				return [
					...labelDefects(withoutLanes(exported.elements), authored),
					...laneRegionIssues(scene, spec)
						.filter((issue) => issue.code === "label-covered")
						.map((issue) => `${issue.elementId} on a lane boundary`),
				].map((defect) => `${index}: ${defect}`);
			});
			if (process.env.PRINT_ROUTING)
				console.log("LABELS laned", direction, JSON.stringify(defects));
			expect(
				defects.filter((defect) => !KNOWN_LANED_LABEL_DEFECTS[direction].includes(defect)),
			).toEqual([]);
		}, 60_000);

		it("draws no laned flowchart with more crossings or reader-scale findings than pinned", () => {
			const counts = rendered(direction).map((scene) => routingCounts(scene));
			if (process.env.PRINT_ROUTING)
				console.log(
					"PIN laned",
					direction,
					counts.map((c) => `${c.crossings}/${c.findings}`).join(" "),
				);
			expect(worseThanPinned("laned", counts, LANED_ROUTING[direction], false)).toEqual([]);
		}, 60_000);
	});

	it.each([...Object.keys(laneFixtures), ...Object.keys(laneStressFixtures)])(
		"exports the %s lanes valid and clear in every direction",
		(name) => {
			const fixture = { ...laneFixtures, ...laneStressFixtures }[name]!;
			for (const direction of ["TB", "BT", "LR", "RL"] as const) {
				const scene = renderIntermediateDiagram({
					...fixture,
					layout: { direction, edgeRouting: "orthogonal" },
				});
				const exported = convertSceneToExcalidraw(scene);
				const authored = new Map(fixture.nodes.map((node) => [`node:${node.id}`, node.label]));
				expect([
					...validateExcalidrawScene(exported).issues,
					...laneRegionIssues(scene, fixture),
					...labelDefects(withoutLanes(exported.elements), authored),
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
 * graph draws on main (fd92ae12), in order, counted as for MAIN_ROUTING. None
 * may draw more, and together they draw fewer crossings.
 */
const STATE_ROUTING: Readonly<Record<"TB" | "BT" | "LR" | "RL", string>> = {
	TB: "0/0 0/0 1/0 0/0 1/0 0/0 2/1 5/0 0/0 0/0 0/0 1/0 0/0 0/0 0/0 3/0 1/1 1/0 0/0 0/0 0/0 0/0 0/0 2/0 0/0 1/1 1/0 0/0 0/0 3/1 0/0 0/0 0/0 1/0 2/0 3/1 0/0 1/1 4/1 3/0",
	BT: "0/0 0/0 0/0 0/0 0/0 0/0 2/1 3/0 0/0 0/0 0/0 0/1 0/0 0/0 0/0 1/0 4/1 0/0 0/0 0/0 0/0 0/1 1/1 2/0 0/0 1/0 0/2 0/0 0/0 0/1 0/0 0/0 0/0 1/0 2/0 3/0 0/0 0/0 1/1 0/0",
	LR: "0/0 0/0 1/1 0/0 1/0 0/0 0/0 2/4 0/0 0/0 0/0 3/0 1/2 0/0 0/0 1/2 2/5 2/1 0/0 0/0 0/0 2/1 1/5 0/0 0/0 2/1 1/2 0/0 0/0 1/0 0/0 0/0 1/0 1/1 2/1 1/3 0/0 0/1 4/0 1/1",
	RL: "0/0 0/0 0/1 0/0 0/0 0/0 0/0 2/3 0/0 0/0 0/0 0/0 0/1 0/0 0/0 2/4 2/4 3/2 0/0 0/0 0/0 1/3 1/2 0/0 0/0 1/1 1/1 1/0 0/0 0/3 0/0 0/0 1/0 1/1 1/1 3/4 0/0 0/1 3/1 0/1",
};

/**
 * State graph labels still set no clearer of another line than of their own,
 * as for KNOWN_DETACHED_LABELS. Main set 47, among them return labels under
 * another transition's run. Graph 6 hooks a line around its final marker along
 * a self-loop's label, and graph 34 leaves a composite's frame beside a label
 * inside it. Never more than these.
 */
const KNOWN_DETACHED_STATE_LABELS: Readonly<Record<"TB" | "BT" | "LR" | "RL", string>> = {
	TB: "",
	BT: "",
	LR: "6:e3>e5 34:e5>e6",
	RL: "6:e3>e5 34:e5>e4",
};

describe("state graph fuzz", () => {
	// Full proof: 40 graphs x 4 directions. Self-loops, paired returns, choices and
	// transitions into and out of a composite's frame all export valid and bound,
	// with their groups whole and labels whole and clear.
	const graphs = randomStateGraphs(FULL ? 40 : 8);
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
					...diagonalRuns(scene),
					...groupRegionIssues(scene).map((issue) => issue.message),
					...getCanvasValidationIssues(scene).map((issue) => issue.message),
					...labelDefects(exported.elements, authored),
					...unbound,
				].map((failure) => `${index}: ${failure}`);
			});
			expect(failures).toEqual([]);
		}, 60_000);

		it("sets every state graph label nearer its own line than any other", () => {
			const known = KNOWN_DETACHED_STATE_LABELS[direction].split(" ");
			const detached = graphs.flatMap((graph, index) =>
				detachedLabels(
					convertSceneToExcalidraw(
						renderGraphDiagram(
							{ ...graph, layout: { direction, edgeRouting: "orthogonal" } } as never,
							{ pairedReturns: true },
						),
					).elements,
				).map((label) => `${index}:${label}`),
			);
			expect(detached.filter((label) => !known.includes(label))).toEqual([]);
		}, 60_000);

		it("draws no state graph with more crossings or reader-scale findings than main", () => {
			const counts = graphs.map((graph) =>
				routingCounts(
					renderGraphDiagram(
						{ ...graph, layout: { direction, edgeRouting: "orthogonal" } } as never,
						{ pairedReturns: true },
					),
				),
			);
			if (process.env.PRINT_ROUTING)
				console.log(
					"PIN state",
					direction,
					counts.map((c) => `${c.crossings}/${c.findings}`).join(" "),
				);
			expect(worseThanPinned("state", counts, STATE_ROUTING[direction])).toEqual([]);
		}, 60_000);
	});
});
