import {
	compositeStateIds,
	type DiagramEdge,
	type DiagramNode,
	type IntermediateDiagram,
	routingQualityFindings,
	routingQualityScale,
	type StateMachineDiagram,
	stateKind,
	stateLabel,
	stateTransitionLabel,
} from "@sketchi/diagram-core";

import {
	type ArrowSceneElement,
	arrowCrossings,
	type RenderedDiagramScene,
	renderGraphDiagram,
} from "./scene.js";

/** The machine's own initial pseudostate; state ids never contain ":". */
const INITIAL_ID = ":initial";

/**
 * A layout whose exported long side runs past 2.5 times its short side reads poorly. Export padding
 * and font metrics stretch a scene slightly, so a scene must stay under 2.2 to export under 2.5.
 */
const READABLE_ASPECT = 2.2;

/**
 * The graph a state machine draws: an initial dot into the starting state, a
 * frame for each composite with its own initial dot inside, one bullseye per
 * transition into an unlabeled final state, and every transition labeled
 * `event [guard] / action`. A labeled final state draws as its named state
 * followed by a bullseye, which reads the same.
 */
export function stateMachineGraph(
	diagram: StateMachineDiagram,
	direction: "TB" | "LR",
): IntermediateDiagram {
	const composites = compositeStateIds(diagram);
	const node = (id: string, label: string, kind: string, group?: string): DiagramNode => ({
		id,
		label,
		kind,
		metadata: {},
		...(group ? { group } : {}),
	});
	const edge = (id: string, source: string, target: string, label?: string): DiagramEdge => ({
		id,
		source,
		target,
		metadata: {},
		...(label ? { label } : {}),
	});
	// The graph's own edges take ids no authored transition uses.
	const taken = new Set(diagram.transitions.map((transition) => transition.id));
	const fresh = (base: string) => {
		let id = base;
		for (let suffix = 2; taken.has(id); suffix += 1) id = `${base}~${suffix}`;
		taken.add(id);
		return id;
	};
	const nodes: DiagramNode[] = [node(INITIAL_ID, "", "initial")];
	const edges: DiagramEdge[] = [edge(fresh(INITIAL_ID), INITIAL_ID, diagram.initial)];
	// Each transition into an unlabeled final state ends at a bullseye of its own.
	const bullseyes = new Map<string, string>();
	const finals = new Map<string, string[]>();
	for (const state of diagram.states) {
		if (stateKind(state) !== "final" || stateLabel(state) !== undefined) continue;
		const arrivals = diagram.transitions.filter((transition) => transition.target === state.id);
		const ids = arrivals.map((_, index) => (index === 0 ? state.id : `${state.id}:${index + 1}`));
		arrivals.forEach((transition, index) => bullseyes.set(transition.id, ids[index]!));
		finals.set(state.id, ids.length > 0 ? ids : [state.id]);
	}
	for (const state of diagram.states) {
		const group = state.parent;
		if (composites.has(state.id)) {
			if (state.initial) {
				nodes.push(node(`${state.id}${INITIAL_ID}`, "", "initial", state.id));
				edges.push(
					edge(fresh(`${state.id}${INITIAL_ID}`), `${state.id}${INITIAL_ID}`, state.initial),
				);
			}
			continue;
		}
		const kind = stateKind(state);
		const label = stateLabel(state);
		if (kind === "final" && label === undefined) {
			for (const id of finals.get(state.id)!) nodes.push(node(id, "", "final", group));
			continue;
		}
		if (kind === "final") {
			nodes.push(node(state.id, label!, "state", group));
			nodes.push(node(`${state.id}:end`, "", "final", group));
			edges.push(edge(fresh(`${state.id}:end`), state.id, `${state.id}:end`));
			continue;
		}
		nodes.push(node(state.id, label ?? "", kind, group));
	}
	for (const transition of diagram.transitions) {
		const label = stateTransitionLabel(transition);
		edges.push(
			edge(
				transition.id,
				transition.source,
				bullseyes.get(transition.id) ?? transition.target,
				label || undefined,
			),
		);
	}
	return {
		id: diagram.id,
		title: diagram.title,
		type: "flowchart",
		nodes,
		edges,
		groups: diagram.states
			.filter((state) => composites.has(state.id))
			.map((state) => ({ id: state.id, label: stateLabel(state) ?? "" })),
		layout: { direction, edgeRouting: "orthogonal" },
		style: diagram.style,
		metadata: {},
	};
}

/** Crossings plus reader-scale findings, judged at the scene's export size. */
function routingCost(scene: RenderedDiagramScene): number {
	const arrows = scene.elements.filter((e): e is ArrowSceneElement => e.type === "arrow");
	return (
		arrowCrossings(arrows) +
		routingQualityFindings(
			arrows.map((arrow) => ({
				id: arrow.id,
				points: arrow.points,
				sourceId: arrow.sourceNodeId,
				targetId: arrow.targetNodeId,
			})),
			routingQualityScale({ width: scene.width, height: scene.height }),
		).length
	);
}

/**
 * Render a state machine in its authored direction or, when it names none, in
 * whichever of left-to-right and top-to-bottom reads better: among layouts
 * whose aspect stays readable, the one with fewer crossings and reader
 * findings (left to right on a tie); otherwise the less elongated one.
 */
export function renderStateMachineDiagram(diagram: StateMachineDiagram): RenderedDiagramScene {
	const render = (direction: "TB" | "LR") =>
		renderGraphDiagram(stateMachineGraph(diagram, direction), { pairedReturns: true });
	if (diagram.layout) return render(diagram.layout.direction);
	const candidates = (["LR", "TB"] as const).map((direction) => {
		const scene = render(direction);
		const aspect = Math.max(scene.width / scene.height, scene.height / scene.width);
		return { aspect, cost: routingCost(scene), scene };
	});
	const readable = candidates.filter((candidate) => candidate.aspect <= READABLE_ASPECT);
	const [best] =
		readable.length > 0
			? readable.toSorted((a, b) => a.cost - b.cost)
			: candidates.toSorted((a, b) => a.aspect - b.aspect);
	return best!.scene;
}
