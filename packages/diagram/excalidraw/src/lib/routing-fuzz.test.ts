import { describe, expect, it } from "vitest";
import {
	candidateRouteQuality,
	parseFlowchartDiagram,
	routingQualityFindings,
	routingQualityScale,
} from "@sketchi/diagram-core";
import { renderIntermediateDiagram } from "@sketchi/diagram-renderer";
import { convertSceneToExcalidraw, validateExcalidrawScene } from "./convert";

type Kind = "start" | "process" | "decision" | "end";

/**
 * Deterministic pseudo-random flowcharts that the flowchart validator accepts:
 * one start, reachable steps with a forward exit, decisions with two to six
 * uniquely labeled branches (some long enough to wrap), fan-in and retry loops.
 */
function randomFlowcharts(count: number, start = 20261017) {
	let seed = start;
	const random = () => {
		seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
		return seed / 2_147_483_648;
	};
	const pick = <T>(values: readonly T[]) => values[Math.floor(random() * values.length)]!;
	const words = [
		"Stage",
		"Review request",
		"Check eligibility and limits",
		"Approve",
		"Notify customer",
		"Escalate to on-call engineer",
	];
	const branches = [
		"Yes",
		"No",
		"Retry",
		"Out of policy",
		"Details received",
		"Escalate",
		"Details were received and are now ready for further review",
		"Needs a second approval from finance",
	];
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
