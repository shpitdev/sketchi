import type { FlowchartDiagram } from "@sketchi/diagram-core";

import {
	flowchartBranchRestates,
	flowchartLabelMatches,
	flowchartLabelWords,
} from "./flowchart-labels.js";
import type { FlowchartScenario } from "./scenarios.js";

export type FlowchartConnection = Pick<
	FlowchartDiagram["edges"][number],
	"source" | "target" | "label"
>;
export type ExpectedEdge = FlowchartScenario["assertions"]["requiredEdges"][number];
type RequiredStep = FlowchartScenario["assertions"]["requiredNodes"][number];
type FlowchartNode = FlowchartDiagram["nodes"][number];
/** Whether a model connection's first-hop caption answers the expected branch. */
export type BranchMatcher = (edge: FlowchartConnection, expected: ExpectedEdge) => boolean;

export interface FlowchartStepMatches {
	/** Every model node that can stand for each required step. */
	readonly matchedNodes: Map<string, Set<string>>;
	/** The model diagram with merged check-decisions split into their two steps. */
	readonly graph: FlowchartDiagram;
	readonly branchMatches: BranchMatcher;
}

const MAX_ENTRY_NODES = 2;

function question(label: string): string {
	return label.replaceAll("?", "");
}

/** The text shares a content word with one of the alternatives. */
function sharesWord(text: string, alternatives: readonly string[]): boolean {
	return alternatives.some((alternative) =>
		flowchartLabelWords(alternative).some((word) => flowchartLabelMatches(text, [word])),
	);
}

function isYesNo(label: string | undefined): label is "yes" | "no" {
	return label === "yes" || label === "no";
}

/** The branch caption states the expected answer, not just a bare yes/no. */
function statesBranch(label: string, decision: RequiredStep, expected: ExpectedEdge): boolean {
	const stated = (expected.labels ?? []).filter((alternative) => !isYesNo(alternative));
	return (
		(stated.length > 0 && flowchartLabelMatches(label, stated)) ||
		(isYesNo(expected.label) && flowchartBranchRestates(label, decision.label, expected.label))
	);
}

/**
 * A decision labeled with a stated check (`Check supplier availability`)
 * whose branches state exactly the next decision's outcomes
 * (`Available`/`Unavailable` for `Supplier available?`) keeps both steps.
 * It is split into the check and that decision so ownership stays exclusive.
 * Bare yes/no branches do not state the decision and keep failing.
 */
function splitMergedChecks(scenario: FlowchartScenario, diagram: FlowchartDiagram) {
	const { requiredEdges, requiredNodes } = scenario.assertions;
	const steps = new Map(requiredNodes.map((step) => [step.id, step]));
	const splits = new Map<string, string>();
	let { nodes, edges } = diagram;
	for (const node of diagram.nodes) {
		if (node.kind !== "decision") continue;
		const outgoing = diagram.edges.filter((edge) => edge.source === node.id);
		const decision = requiredNodes.find((check) => {
			if (check.kind !== "process" || !flowchartLabelMatches(node.label, check.labels)) {
				return false;
			}
			return requiredEdges.some(({ sourceId, targetId }) => {
				if (sourceId !== check.id || steps.get(targetId)?.kind !== "decision") return false;
				const branches = requiredEdges.filter((edge) => edge.sourceId === targetId && edge.labels);
				const decisionStep = steps.get(targetId)!;
				const used = new Set<number>();
				return (
					branches.length === outgoing.length &&
					outgoing.every((edge) => {
						const index = branches.findIndex(
							(expected, candidate) =>
								!used.has(candidate) && statesBranch(edge.label ?? "", decisionStep, expected),
						);
						used.add(index);
						return index !== -1;
					})
				);
			});
		});
		if (!decision) continue;
		const target = requiredEdges.find(
			(edge) => edge.sourceId === decision.id && steps.get(edge.targetId)?.kind === "decision",
		)!.targetId;
		// Synthetic ids never collide with a model id, so ids cannot change grading.
		const taken = new Set([...nodes.map((entry) => entry.id), ...edges.map((edge) => edge.id)]);
		const fresh = (base: string) => {
			let id = base;
			for (let index = 2; taken.has(id); index += 1) id = `${base}-${index}`;
			taken.add(id);
			return id;
		};
		const split = fresh(`${node.id}#decision`);
		const splitEdge = fresh(`${node.id}#split`);
		splits.set(split, target);
		nodes = [
			...nodes.map((candidate): FlowchartNode =>
				candidate.id === node.id ? { ...candidate, kind: "process" } : candidate,
			),
			{ ...node, id: split },
		];
		edges = [
			...edges.map((edge) => (edge.source === node.id ? { ...edge, source: split } : edge)),
			{ id: splitEdge, source: node.id, target: split, metadata: {} },
		];
	}
	return { graph: { ...diagram, nodes, edges }, splits };
}

/** Match model nodes to required steps, including the structural forms below. */
export function matchFlowchartSteps(
	scenario: FlowchartScenario,
	diagram: FlowchartDiagram,
): FlowchartStepMatches {
	const { requiredEdges, requiredNodes } = scenario.assertions;
	const { graph, splits } = splitMergedChecks(scenario, diagram);
	const byId = new Map(graph.nodes.map((node) => [node.id, node]));
	const outgoing = (id: string) => graph.edges.filter((edge) => edge.source === id);
	const incoming = (id: string) => graph.edges.filter((edge) => edge.target === id);
	const reaches = (from: string, to: string) => {
		const queue = [from];
		const visited = new Set(queue);
		for (let index = 0; index < queue.length; index += 1) {
			if (queue[index] === to) return true;
			for (const edge of outgoing(queue[index]!)) {
				if (!visited.has(edge.target)) {
					visited.add(edge.target);
					queue.push(edge.target);
				}
			}
		}
		return false;
	};
	const namesStep = (label: string) =>
		requiredNodes.some((step) => flowchartLabelMatches(label, step.labels));
	// An expected end also accepts an action that represents it: one whose sole
	// edge leads to a terminal end, or one whose every edge loops back to work
	// it came from (a retry after `Request more details`). Never a start or
	// decision, a branch, or intervening work.
	const endActions = new Set(
		graph.nodes
			.filter((node) => {
				if (node.kind !== "process") return false;
				const next = outgoing(node.id);
				if (next.length === 0) return false;
				if (next.every((edge) => reaches(edge.target, node.id))) return true;
				if (next.length !== 1) return false;
				const target = byId.get(next[0]!.target);
				return target?.kind === "end" && outgoing(target.id).length === 0;
			})
			.map((node) => node.id),
	);
	const kindFits = (node: FlowchartNode, step: RequiredStep) =>
		node.kind === step.kind || (step.kind === "end" && endActions.has(node.id));
	const matchedNodes = new Map(
		requiredNodes.map((step) => [
			step.id,
			new Set(
				graph.nodes
					.filter((node) => kindFits(node, step) && flowchartLabelMatches(node.label, step.labels))
					.map((node) => node.id),
			),
		]),
	);
	for (const [split, step] of splits) matchedNodes.get(step)!.add(split);

	// The stated first event may be drawn as a start plus up to two plain
	// actions (`Request reaches Vercel → Next.js page receives the question`).
	// Their combined labels must match; the chain's last node owns the step.
	for (const start of graph.nodes.filter((node) => node.kind === "start")) {
		const chain = [start];
		while (chain.length <= MAX_ENTRY_NODES) {
			const next = outgoing(chain.at(-1)!.id);
			const node = next.length === 1 && !next[0]!.label ? byId.get(next[0]!.target) : undefined;
			if (node?.kind !== "process" || incoming(node.id).length !== 1 || namesStep(node.label)) {
				break;
			}
			chain.push(node);
			const combined = chain.map((entry) => question(entry.label)).join(" ");
			for (const step of requiredNodes) {
				if (step.kind === "start" && flowchartLabelMatches(combined, step.labels)) {
					matchedNodes.get(step.id)!.add(node.id);
				}
			}
		}
	}

	// A branch target qualified by its decision: `Severity? → Monitoring` on
	// the `Low` branch is `Monitoring low severity`. The target and the branch
	// must each contribute a criterion word, and the target alone names no step.
	for (const node of graph.nodes) {
		if (namesStep(node.label)) continue;
		for (const edge of incoming(node.id)) {
			const source = byId.get(edge.source);
			if (source?.kind !== "decision" || !edge.label) continue;
			const combined = `${question(source.label)} ${edge.label} ${question(node.label)}`;
			for (const step of requiredNodes) {
				if (
					kindFits(node, step) &&
					sharesWord(node.label, step.labels) &&
					sharesWord(edge.label, step.labels) &&
					flowchartLabelMatches(combined, step.labels)
				) {
					matchedNodes.get(step.id)!.add(node.id);
				}
			}
		}
	}

	// A dimension question answered by its branch values (`Risk level?` with
	// `High`/`Low`) is the decision `Risk high?` when its label plus one branch
	// label states the criterion. A node whose own label already names a step
	// is that step merged with a decision, handled by splitMergedChecks.
	const dimensionLabel = (nodeId: string, branch: string) =>
		`${question(byId.get(nodeId)?.label ?? "")} ${branch}`;
	const dimensionSteps = new Map<string, Set<string>>();
	for (const node of graph.nodes) {
		if (node.kind !== "decision" || namesStep(node.label)) continue;
		const branches = outgoing(node.id).flatMap((edge) => (edge.label ? [edge.label] : []));
		for (const step of requiredNodes) {
			if (
				step.kind === "decision" &&
				sharesWord(node.label, step.labels) &&
				branches.some((branch) =>
					flowchartLabelMatches(dimensionLabel(node.id, branch), step.labels),
				)
			) {
				matchedNodes.get(step.id)!.add(node.id);
				dimensionSteps.set(node.id, new Set([...(dimensionSteps.get(node.id) ?? []), step.id]));
			}
		}
	}

	const steps = new Map(requiredNodes.map((step) => [step.id, step]));
	const branchMatches: BranchMatcher = (edge, expected) => {
		if (!expected.labels) return true;
		const label = edge.label ?? "";
		if (flowchartLabelMatches(label, expected.labels)) return true;
		const decision = steps.get(expected.sourceId);
		if (!label || decision?.kind !== "decision") return false;
		const source = question(byId.get(edge.source)?.label ?? "");
		if (!isYesNo(expected.label)) {
			// A value question (`Cache hit?`) answers yes for the value it names
			// and no for the only other value (`miss`).
			const siblings = requiredEdges.filter(
				(other) => other.sourceId === expected.sourceId && other !== expected && other.labels,
			);
			if (flowchartLabelMatches(label, ["yes"])) {
				return flowchartLabelMatches(source, expected.labels);
			}
			return (
				flowchartLabelMatches(label, ["no"]) &&
				siblings.length === 1 &&
				flowchartLabelMatches(source, siblings[0]!.labels!)
			);
		}
		if (flowchartBranchRestates(label, decision.label, expected.label)) return true;
		// Branches of a dimension question carry values: the one completing the
		// criterion answers yes (`High` for `Risk high?`); any other value answers no.
		if (!dimensionSteps.get(edge.source)?.has(decision.id)) return false;
		const completes = flowchartLabelMatches(dimensionLabel(edge.source, label), decision.labels);
		return expected.label === "yes"
			? completes
			: !completes && !flowchartLabelMatches(label, ["yes"]);
	};
	return { matchedNodes, graph, branchMatches };
}
