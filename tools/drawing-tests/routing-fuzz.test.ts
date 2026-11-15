import { parseFlowchartDiagram } from "@sketchi/diagrams/families/flowchart/diagram";
import { renderIntermediateDiagram } from "@sketchi/diagrams/graph/scene";
import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { convertSceneToExcalidraw, validateExcalidrawScene } from "@sketchi/drawing/excalidraw";
import {
	randomFlowcharts,
	FULL,
	diagonalRuns,
	randomLongFlows,
	aroundTheBands,
	routingCounts,
	worseThanPinned,
	MAIN_ROUTING,
	moreHeadsThanPinned,
	moreSharedThanPinned,
	moreTouchesThanPinned,
	KNOWN_AROUND_THE_BANDS,
	PLAIN_DIRECT_FAILURES,
	ownEndStrays,
	curvedStrays,
} from "./routing-fuzz-helpers";

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
			}).pipe(Result.getOrThrow);
			const scene = renderIntermediateDiagram(diagram).pipe(Result.getOrThrow);
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
				}).pipe(Result.getOrThrow),
			).pipe(Result.getOrThrow);
			const nodes = new Map(
				scene.elements.flatMap((e) => (e.type === "node" ? [[e.nodeId, e] as const] : [])),
			);
			const along = (id: string) => {
				const node = nodes.get(id)!;
				const vertical = direction === "TB" || direction === "BT";
				const value = vertical ? node.y + node.height / 2 : node.x + node.width / 2;
				return direction === "TB" || direction === "LR" ? value : -value;
			};
			const spine = spec.edges.filter((edge) => edge.id.startsWith("s"));
			const continuations = new Set(
				spine.filter((edge) => along(edge.target) < along(edge.source)).map((edge) => edge.id),
			);
			return {
				around: aroundTheBands(scene, direction, spine, continuations),
				issues:
					validateExcalidrawScene(convertSceneToExcalidraw(scene)).issues.length +
					diagonalRuns(scene).length,
				wrapped: continuations.size > 0,
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
						}).pipe(Result.getOrThrow),
					).pipe(Result.getOrThrow),
				),
			);
			if (process.env.PRINT_ROUTING)
				console.log(
					"PIN",
					set,
					direction,
					counts
						.map((c) => `${c.crossings}/${c.findings}/${c.heads}/${c.shared}/${c.touches}`)
						.join(" "),
				);
			return [
				...worseThanPinned(set, counts, MAIN_ROUTING[set][direction]),
				...moreHeadsThanPinned(set, direction, counts),
				...moreSharedThanPinned(set, direction, counts),
				...moreTouchesThanPinned(set, direction, counts),
			];
		});

	it("keeps every run of the review's clearance case horizontal or vertical", () => {
		// Seed 20261020, case 4, TB: moving one of two collinear runs clear of a
		// node once turned the stub beside it diagonal.
		const scene = renderIntermediateDiagram(
			parseFlowchartDiagram({
				...randomFlowcharts(40, 20261020)[4]!,
				type: "flowchart",
				layout: { direction: "TB", edgeRouting: "orthogonal" },
			}).pipe(Result.getOrThrow),
		).pipe(Result.getOrThrow);
		expect(diagonalRuns(scene)).toEqual([]);
	});

	it("never lengthens the drawing of the #509 review's flowchart to clear an arrowhead", () => {
		// Seed 20261017, case 47, LR: main draws it 2357.5 x 1650 with a line
		// through a head; routing that line clear once stretched it to 2418.
		const scene = renderIntermediateDiagram(
			parseFlowchartDiagram({
				...randomFlowcharts(48)[47]!,
				type: "flowchart",
				layout: { direction: "LR", edgeRouting: "orthogonal" },
			}).pipe(Result.getOrThrow),
		).pipe(Result.getOrThrow);
		expect(Math.max(scene.width, scene.height)).toBeLessThanOrEqual(2357.5);
	});

	it("routes the review's fan-in case no worse than main in RL", () => {
		// Seed 143289, case 33: an unguarded arrival order drew 8 crossings and 4 findings.
		const { crossings, findings } = routingCounts(
			renderIntermediateDiagram(
				parseFlowchartDiagram({
					...randomFlowcharts(34, 143289)[33]!,
					type: "flowchart",
					layout: { direction: "RL", edgeRouting: "orthogonal" },
				}).pipe(Result.getOrThrow),
			).pipe(Result.getOrThrow),
		);
		expect(crossings).toBeLessThanOrEqual(6);
		expect(findings).toBeLessThanOrEqual(3);
	});

	it("grows a rank gap only where the drawing still reads no worse once its lines are cleared at last", () => {
		// Seed 20261026, case 44 in BT: judged before the last clearance pass, a
		// grown gap kept 80 crossings where the drawing without it cleared to 78.
		const { crossings, findings } = routingCounts(
			renderIntermediateDiagram(
				parseFlowchartDiagram({
					...randomFlowcharts(45, 20261026)[44]!,
					type: "flowchart",
					layout: { direction: "BT", edgeRouting: "orthogonal" },
				}).pipe(Result.getOrThrow),
			).pipe(Result.getOrThrow),
		);
		expect(crossings).toBeLessThanOrEqual(78);
		expect(findings).toBeLessThanOrEqual(13);
	});

	it.each(["LR", "RL"] as const)(
		"routes the review's wrapped long flow without reader findings in %s",
		(direction) => {
			// Long flow 39 of a longer run: through the gap between rows a branch
			// arrived with a 63.5-unit jog; its contended continuation leaving forward
			// draws it clean, as main does.
			const { crossings, findings } = routingCounts(
				renderIntermediateDiagram(
					parseFlowchartDiagram({
						...randomLongFlows(39)[38]!,
						type: "flowchart",
						layout: { direction, edgeRouting: "orthogonal" },
					}).pipe(Result.getOrThrow),
				).pipe(Result.getOrThrow),
			);
			expect(crossings).toBe(0);
			expect(findings).toBe(0);
		},
	);

	describe.each(["TB", "BT", "LR", "RL"] as const)("%s", (direction) => {
		it("draws no flowchart with more crossings or reader-scale findings than main", () => {
			expect(worseThanMain(direction)).toEqual([]);
		}, 60_000);

		it("exports every random flowchart orthogonal and without validator issues when routed orthogonally", () => {
			expect(failures(direction, "orthogonal")).toEqual([]);
		}, 60_000);

		it("exports every random long flow without validator issues, wrapped or not, stepping through the gap between bands", () => {
			const exports = longFlowExports(direction);
			expect(exports.filter((result) => result.issues > 0)).toEqual([]);
			expect(exports.filter((result) => result.wrapped).length).toBeGreaterThan(5);
			expect(
				exports.flatMap((result, index) =>
					KNOWN_AROUND_THE_BANDS[direction].includes(index)
						? []
						: result.around.map((failure) => `${index}: ${failure}`),
				),
			).toEqual([]);
		}, 60_000);

		it("never exports a straight flowchart with issues that main exports cleanly", () => {
			const allowed = PLAIN_DIRECT_FAILURES[direction];
			expect(failures(direction, "straight").filter((index) => !allowed.includes(index))).toEqual(
				[],
			);
		}, 60_000);

		it("routes no line into its own end node's drawn shape past the run that meets it", () => {
			const strays = [...flowcharts, ...(FULL ? longFlows : [])].flatMap((spec, index) =>
				ownEndStrays(
					renderIntermediateDiagram(
						parseFlowchartDiagram({
							...spec,
							type: "flowchart",
							layout: { direction, edgeRouting: "orthogonal" },
						}).pipe(Result.getOrThrow),
					).pipe(Result.getOrThrow),
				).map((stray) => `${index} ${stray}`),
			);
			expect(strays).toEqual([]);
		}, 60_000);

		it("exports every random flowchart curved without validator issues", () => {
			expect(failures(direction, "curved")).toEqual([]);
		}, 60_000);

		it("curves every line along its route, into no node past the runs that meet it and no label its route kept clear", () => {
			const strays = flowcharts.flatMap((spec, index) => {
				const [curved, square] = (["curved", "orthogonal"] as const).map((edgeRouting) =>
					renderIntermediateDiagram(
						parseFlowchartDiagram({
							...spec,
							type: "flowchart",
							layout: { direction, edgeRouting },
						}).pipe(Result.getOrThrow),
					).pipe(Result.getOrThrow),
				);
				return curvedStrays(curved!, square!).map((stray) => `${index} ${stray}`);
			});
			expect(strays).toEqual([]);
		}, 120_000);
	});
});
