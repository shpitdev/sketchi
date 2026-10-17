import { describe, expect, it } from "vitest";
import { parseFlowchartDiagram } from "@sketchi/diagram-core";
import { renderIntermediateDiagram } from "@sketchi/diagram-renderer";
import { convertSceneToExcalidraw, validateExcalidrawScene } from "./convert";

type Kind = "start" | "process" | "decision" | "end";

/**
 * Deterministic pseudo-random flowcharts that the flowchart validator accepts:
 * one start, reachable steps with a forward exit, decisions with two to six
 * uniquely labeled branches (some long enough to wrap), fan-in and retry loops.
 */
function randomFlowcharts(count: number) {
	let seed = 20261017;
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

	describe.each(["TB", "BT", "LR", "RL"] as const)("%s", (direction) => {
		it("exports every random flowchart without validator issues when routed orthogonally", () => {
			expect(failures(direction, "orthogonal")).toEqual([]);
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
