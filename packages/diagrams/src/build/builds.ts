import { type ArtifactBuildCapabilities, type BuildDelivery } from "./result.js";
import { familyForType } from "../family.js";

import { Effect } from "effect";

import { type CodeModeArtifactStorage } from "./artifacts.js";
import { observeCodeModeBoundary, type ObservableCodeModeResult } from "./boundary.js";
import { artifactBuildCapabilities } from "./export.js";
import { BuildIconSource, catalogForRequest } from "./icons.js";
import { CodeModeRuntimeEnvironment } from "./runtime.js";

/** The host supplies one catalog and artifact boundary to both builds and edits. */
interface HostedBuild<A, E, R> {
	readonly decode: (input: unknown) => Effect.Effect<A, E>;
	readonly build: (
		request: A,
		capabilities: ArtifactBuildCapabilities<CodeModeRuntimeEnvironment | CodeModeArtifactStorage>,
		delivery?: Pick<BuildDelivery, "provenance">,
	) => Effect.Effect<R, E, CodeModeRuntimeEnvironment | CodeModeArtifactStorage | BuildIconSource>;
}
export function runFamilyBuild<A, E, R>(
	build: HostedBuild<A, E, R>,
	input: unknown,
	delivery?: Pick<BuildDelivery, "provenance">,
) {
	return Effect.gen(function* () {
		const request = yield* build.decode(input);
		const environment = yield* CodeModeRuntimeEnvironment;
		return yield* build.build(request, yield* artifactBuildCapabilities, delivery).pipe(
			Effect.provideService(BuildIconSource, {
				catalog: (document) =>
					catalogForRequest(environment.icons, environment.communityIcons, document),
				fillNamedLogos: environment.fillNamedLogos === true,
			}),
		);
	});
}

/** Bind the shared operation once, retaining typed errors to the host. */
export function bindBuild<
	A,
	E extends { readonly status: string },
	R extends ObservableCodeModeResult,
>(operation: string, build: HostedBuild<A, E, R>) {
	return (input: unknown) =>
		observeCodeModeBoundary(operation, input, runFamilyBuild(build, input));
}

export const buildFlowchart = familyForType("flowchart").build({ bindBuild });
export const buildMindmap = familyForType("mindmap").build({ bindBuild });
export const buildSequenceDiagram = familyForType("sequence").build({ bindBuild });
export const buildVennDiagram = familyForType("venn").build({ bindBuild });

export const buildStateMachine = familyForType("state-machine").build({ bindBuild });

export const buildErDiagram = familyForType("er").build({ bindBuild });

export const buildClassDiagram = familyForType("class").build({ bindBuild });

/** An org chart: people, the managers they report to, and dotted-line reports. */
export const buildOrgChart = familyForType("org-chart").build({ bindBuild });

export const buildJourneyMap = familyForType("journey").build({ bindBuild });

/** A Sankey diagram: nodes and the weighted flows between them. */
export const buildSankey = familyForType("sankey").build({ bindBuild });

/** A wireframe: low-fidelity screens, each a tree of components the host lays out. */
export const buildWireframe = familyForType("wireframe").build({ bindBuild });

/** A quadrant chart: two axes, four named quadrants and points placed by their scores. */
export const buildQuadrantChart = familyForType("quadrant").build({ bindBuild });

export const buildTimeline = familyForType("timeline").build({ bindBuild });

/** A bar, line or pie chart from categories and named series of numbers. */
export const buildChart = familyForType("chart").build({ bindBuild });

/** A Gantt chart from dated tasks, milestones, phases and finish-to-start dependencies. */
export const buildGantt = familyForType("gantt").build({ bindBuild });
