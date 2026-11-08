import { GanttDiagramSchema, type GanttDiagram } from "@sketchi/diagram-core";
import { Schema } from "effect";

/**
 * Wording that can state that one task waits for another: an after or depends-on column,
 * "after X", "once X ships", "blocked by X", "X then Y", an arrow. Broad on purpose: a request
 * that uses any of it keeps the dependencies the model read from it.
 */
const DEPENDENCY_WORDING =
	/\b(?:after|afterwards?|depend\w*|prerequisites?|predecessors?|successors?|block\w*|wait\w*|once|until|requires?|required|requiring|needs|follow\w*|preced\w*|before|then|gate[sd]?|gating|upon|when|finish(?:es)?[- ]to[- ]start|critical path)\b|->|=>|→|⇒|⟶/iu;

/** Whether a request has any wording that could state a dependency between tasks. */
export function statesGanttDependencies(request: string): boolean {
	return DEPENDENCY_WORDING.test(request);
}

/**
 * A Gantt chart drawn from a request that states no dependency at all, such as a plan that only
 * lists dated phases, without the dependencies a model read into its date order. A request with
 * any dependency wording keeps the chart as it is.
 */
export function withoutUnstatedGanttDependencies(
	diagram: GanttDiagram,
	request: string,
): { readonly diagram: GanttDiagram; readonly dropped: number } {
	const dropped = diagram.tasks.reduce((sum, task) => sum + (task.dependsOn?.length ?? 0), 0);
	if (dropped === 0 || statesGanttDependencies(request)) return { diagram, dropped: 0 };
	const encoded = Schema.encodeSync(GanttDiagramSchema)(diagram);
	return {
		diagram: Schema.decodeUnknownSync(GanttDiagramSchema)({
			...encoded,
			tasks: encoded.tasks.map(({ dependsOn: _dependsOn, ...task }) => task),
		}),
		dropped,
	};
}
