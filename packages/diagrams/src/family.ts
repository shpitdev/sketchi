import { flowchartBuild } from "./families/flowchart/build";
import { sequenceFixture } from "./families/sequence/fixtures";
import { sequenceBuild } from "./families/sequence/build";
import { vennBuild } from "./families/venn/build";
import { Effect, Result, Schema } from "effect";
import type * as Builds from "./build/builds";
import type { BuildRuntimeEnvironment } from "./build/runtime";
import { docs as chartFamilyDocs } from "./families/chart/docs";
import * as chartFamily from "./families/chart/document";
import { chartBuild } from "./families/chart/build";
import { docs as classFamilyDocs } from "./families/class/docs";
import * as classFamily from "./families/class/document";
import { classBuild } from "./families/class/build";
import { docs as erFamilyDocs } from "./families/er/docs";
import * as erFamily from "./families/er/document";
import { erBuild } from "./families/er/build";
import * as flowchartFamily from "./families/flowchart/document";
import { docs as flowchartFamilyDocs } from "./families/flowchart/docs";
import { docs as ganttFamilyDocs } from "./families/gantt/docs";
import * as ganttFamily from "./families/gantt/document";
import { ganttBuild } from "./families/gantt/build";
import { docs as journeyFamilyDocs } from "./families/journey/docs";
import * as journeyFamily from "./families/journey/document";
import { journeyBuild } from "./families/journey/build";
import { mindmapBuild } from "./families/mindmap/build";
import { docs as mindmapFamilyDocs } from "./families/mindmap/docs";
import { mindmapFixture } from "./families/mindmap/fixtures";

import { docs as orgChartFamilyDocs } from "./families/org-chart/docs";
import * as orgChartFamily from "./families/org-chart/document";
import { orgChartBuild } from "./families/org-chart/build";
import { docs as quadrantFamilyDocs } from "./families/quadrant/docs";
import * as quadrantFamily from "./families/quadrant/document";
import { quadrantBuild } from "./families/quadrant/build";
import { docs as sankeyFamilyDocs } from "./families/sankey/docs";
import * as sankeyFamily from "./families/sankey/document";
import { sankeyBuild } from "./families/sankey/build";
import { docs as sequenceFamilyDocs } from "./families/sequence/docs";

import { docs as stateMachineFamilyDocs } from "./families/state-machine/docs";
import * as stateMachineFamily from "./families/state-machine/document";
import { stateMachineBuild } from "./families/state-machine/build";
import { renderStateMachineDiagram } from "./families/state-machine/render";
import { docs as timelineFamilyDocs } from "./families/timeline/docs";
import * as timelineFamily from "./families/timeline/document";
import { timelineBuild } from "./families/timeline/build";
import { docs as vennFamilyDocs } from "./families/venn/docs";
import * as vennFamily from "./families/venn/document";

import { docs as wireframeFamilyDocs } from "./families/wireframe/docs";
import * as wireframeFamily from "./families/wireframe/document";
import { wireframeBuild } from "./families/wireframe/build";
import { renderFlowchartDiagram } from "./families/flowchart/render";
import { flowchartFixture } from "./families/flowchart/fixtures/index";
import { isStructurallyValidChartMark } from "./families/chart/render";
import { isStructurallyValidClassBox } from "./families/class/render";
import { isStructurallyValidErOptional, isStructurallyValidErTable } from "./families/er/render";
import { isStructurallyValidGanttMark } from "./families/gantt/render";
import { isStructurallyValidJourneyMark } from "./families/journey/render";
import { isStructurallyValidQuadrantMark } from "./families/quadrant/render";
import { isStructurallyValidSankeyMark } from "./families/sankey/render";
import {
	isStructurallyValidSequenceActivation,
	isStructurallyValidSequenceLifeline,
} from "./families/sequence/render";
import { isStructurallyValidTimelineMarker } from "./families/timeline/render";
import { isStructurallyValidVennSet } from "./families/venn/render";
import { isStructurallyValidStateMarker } from "./graph/compose";
import type { CanvasInput } from "./canvas/input";

type CanvasNodeInput = Extract<CanvasInput["elements"][number], { readonly type: "node" }>;
/**
 * The renderer roles a family's drawing gives canvas nodes. A hand-edited node keeps its role only
 * while the family's check still finds the structure that role draws.
 */
export type CanvasRoles = Readonly<
	Record<string, (scene: CanvasInput, node: CanvasNodeInput) => boolean>
>;
const NO_CANVAS_ROLES: CanvasRoles = {};

function canonical<S extends Schema.Top & { readonly Type: { readonly type: string } }, E, RE>(
	schema: S,
	type: S["Type"]["type"],
	validate: (diagram: S["Type"]) => Result.Result<S["Type"], E>,
	render: (diagram: S["Type"]) => Result.Result<import("@sketchi/drawing").CanvasSpec, RE>,
	counts: (diagram: S["Type"]) => import("./build/result").DiagramCounts,
): {
	readonly schema: S;
	readonly counts: (diagram: { readonly type: string }) => import("./build/result").DiagramCounts;
	readonly validate: (diagram: { readonly type: string }) => Result.Result<S["Type"], E>;
	readonly render: (diagram: {
		readonly type: string;
	}) => Result.Result<import("@sketchi/drawing").CanvasSpec, RE>;
} {
	// Only the tag is needed here: callers already carry the canonical schema's union.
	const matches = (diagram: { readonly type: string }): diagram is S["Type"] =>
		diagram.type === type;
	return {
		schema,
		counts: (diagram) => {
			if (!matches(diagram)) throw new Error("Mismatched canonical family");
			return counts(diagram);
		},
		validate: (diagram: { readonly type: string }): Result.Result<S["Type"], E> => {
			if (!matches(diagram)) throw new Error("Mismatched canonical family");
			return validate(diagram);
		},
		render: (diagram: {
			readonly type: string;
		}): Result.Result<import("@sketchi/drawing").CanvasSpec, RE> => {
			if (!matches(diagram)) throw new Error("Mismatched canonical family");
			return render(diagram);
		},
	};
}

/** Canonical documents already owned by a build need only the dispatch tag removed for storage. */
function fromBuild<
	D,
	N extends { readonly type: string },
	E,
	const S extends string,
	T extends Schema.Top,
	R,
>(build: ReturnType<typeof import("./build/operation").defineBuild<D, N, E, S, T, R>>) {
	return {
		canonical: canonical(
			build.normalized,
			build.name,
			(diagram) => Result.map(build.check(diagram), () => diagram),
			(diagram) => {
				const rendered = build.render(diagram);
				return Result.isResult(rendered) ? rendered : Result.succeed(rendered);
			},
			build.counts,
		),
		validationError: build.error,
		toDocument: (diagram: N) => {
			const { type: _type, ...spec } = diagram;
			const type: N["type"] = diagram.type;
			return { type, spec };
		},
	};
}

function family<
	const O extends string,
	D,
	N,
	C,
	E,
	const S extends string,
	T extends Schema.Top,
	P extends Schema.Codec<import("./build/result").BuildIssue>,
	R extends import("./build/icons").BuildIconSource,
	const F extends {
		readonly operation: O;
		readonly label: string;
		readonly path: string;
		readonly fixture: { readonly type: string };
		readonly canonical: {
			readonly schema: Schema.Top;
			readonly counts: (diagram: {
				readonly type: string;
			}) => import("./build/result").DiagramCounts;
		};
		readonly validationError: Schema.Top;
		readonly docs: unknown;
		readonly canvasRoles?: CanvasRoles;
	},
>(
	definition: F & {
		readonly build: ReturnType<
			typeof import("./build/operation").defineBuild<D, N, E, S, T, R, C, P>
		>;
	},
) {
	const build = definition.build;
	const type: F["fixture"]["type"] = definition.fixture.type;
	const document = Schema.Struct({ type: Schema.Literal(type), spec: build.document });
	return {
		...definition,
		type,
		spec: build.document,
		request: build.request,
		contracts: {
			input: build.input,
			output: build.result,
			accepted: build.accepted,
			rejected: build.rejected,
		},
		canvasRoles: definition.canvasRoles ?? NO_CANVAS_ROLES,
		studioInput: build.toolInput,
		counts: definition.canonical.counts,
		prepare: build.prepare,
		decode: build.decode,
		document,
		decodeDocument: (input: unknown) =>
			Effect.fromResult(build.prepare({ spec: input })).pipe(
				Effect.flatMap((prepared) =>
					Schema.decodeUnknownEffect(build.document, { errors: "all" })(
						typeof prepared === "object" && prepared !== null && "spec" in prepared
							? prepared.spec
							: undefined,
					),
				),
				Effect.map((spec) => ({ type, spec })),
			),
		build: (host: Pick<typeof Builds, "bindBuild">) => host.bindBuild(definition.operation, build),
	};
}

/** One composition of the existing family owners. Runtime selection is bound by the server host. */
const flowchartDescriptor = family({
	operation: "buildFlowchart",
	label: "Flowchart",
	path: "/api/v1/flowcharts/build",
	canvasRoles: {
		swimlane: (_scene, node) => node.shape === "rectangle" && !node.icon,
		"swimlane-header": (_scene, node) => node.shape === "rectangle" && !node.icon,
		// A zone's logo sits in its header.
		zone: (_scene, node) => node.shape === "rectangle",
	},
	canonical: canonical(
		flowchartFamily.FlowchartDiagram,
		flowchartFixture.type,
		flowchartFamily.validateFlowchartDiagram,
		(diagram) => Result.succeed(renderFlowchartDiagram(diagram)),
		flowchartFamily.counts,
	),
	validationError: flowchartFamily.FlowchartValidationError,
	fixture: flowchartFixture,
	build: flowchartBuild,
	docs: flowchartFamilyDocs,
});

const mindmapDescriptor = family({
	operation: "buildMindmap",
	label: "Mindmap",
	path: "/api/v1/mindmaps/build",
	build: mindmapBuild,
	...fromBuild(mindmapBuild),
	fixture: mindmapFixture,
	docs: mindmapFamilyDocs,
});

const sequenceDiagramDescriptor = family({
	operation: "buildSequenceDiagram",
	label: "Sequence diagram",
	path: "/api/v1/sequences/build",
	canvasRoles: {
		"sequence-lifeline": isStructurallyValidSequenceLifeline,
		"sequence-activation": isStructurallyValidSequenceActivation,
	},
	build: sequenceBuild,
	...fromBuild(sequenceBuild),
	fixture: sequenceFixture,
	docs: sequenceFamilyDocs,
});

const timelineDescriptor = family({
	operation: "buildTimeline",
	label: "Timeline",
	path: "/api/v1/timelines/build",
	canvasRoles: { "timeline-marker": (_scene, node) => isStructurallyValidTimelineMarker(node) },
	build: timelineBuild,
	...fromBuild(timelineBuild),
	fixture: timelineFamily.timelineFixture,
	docs: timelineFamilyDocs,
});

const chartDescriptor = family({
	operation: "buildChart",
	label: "Chart",
	path: "/api/v1/charts/build",
	canvasRoles: { "chart-mark": (_scene, node) => isStructurallyValidChartMark(node) },
	build: chartBuild,
	...fromBuild(chartBuild),
	fixture: chartFamily.chartFixture,
	docs: chartFamilyDocs,
});

const stateMachineDescriptor = family({
	operation: "buildStateMachine",
	label: "State machine",
	path: "/api/v1/state-machines/build",
	canvasRoles: { "state-marker": (_scene, node) => isStructurallyValidStateMarker(node) },
	build: stateMachineBuild,
	// Canonical State validation materializes omitted composite entries for CLI/generator callers.
	canonical: canonical(
		stateMachineFamily.StateMachineDiagram,
		stateMachineFamily.stateMachineFixture.type,
		stateMachineFamily.validateStateMachineDiagram,
		(diagram) => Result.succeed(renderStateMachineDiagram(diagram)),
		stateMachineFamily.counts,
	),
	validationError: stateMachineFamily.StateMachineValidationError,
	toDocument: ({ type, ...spec }: stateMachineFamily.StateMachineDiagram) => ({ type, spec }),
	fixture: stateMachineFamily.stateMachineFixture,
	docs: stateMachineFamilyDocs,
});

const ganttDescriptor = family({
	operation: "buildGantt",
	label: "Gantt chart",
	path: "/api/v1/gantts/build",
	canvasRoles: { "gantt-mark": (_scene, node) => isStructurallyValidGanttMark(node) },
	build: ganttBuild,
	...fromBuild(ganttBuild),
	fixture: ganttFamily.ganttFixture,
	docs: ganttFamilyDocs,
});

const erDiagramDescriptor = family({
	operation: "buildErDiagram",
	label: "ER diagram",
	path: "/api/v1/er-diagrams/build",
	canvasRoles: {
		"er-table": (_scene, node) => isStructurallyValidErTable(node),
		"er-optional": (_scene, node) => isStructurallyValidErOptional(node),
	},
	build: erBuild,
	...fromBuild(erBuild),
	fixture: erFamily.erFixture,
	docs: erFamilyDocs,
});

const classDiagramDescriptor = family({
	operation: "buildClassDiagram",
	label: "Class diagram",
	path: "/api/v1/class-diagrams/build",
	canvasRoles: { "class-box": (_scene, node) => isStructurallyValidClassBox(node) },
	build: classBuild,
	...fromBuild(classBuild),
	fixture: classFamily.classFixture,
	docs: classFamilyDocs,
});

const orgChartDescriptor = family({
	operation: "buildOrgChart",
	label: "Org chart",
	path: "/api/v1/org-charts/build",
	build: orgChartBuild,
	...fromBuild(orgChartBuild),
	fixture: orgChartFamily.orgChartFixture,
	docs: orgChartFamilyDocs,
});

const vennDiagramDescriptor = family({
	operation: "buildVennDiagram",
	label: "Venn diagram",
	path: "/api/v1/venn-diagrams/build",
	canvasRoles: { "venn-set": (_scene, node) => isStructurallyValidVennSet(node) },
	build: vennBuild,
	...fromBuild(vennBuild),
	fixture: vennFamily.vennFixture,
	docs: vennFamilyDocs,
});

const journeyMapDescriptor = family({
	operation: "buildJourneyMap",
	label: "Journey map",
	path: "/api/v1/journey-maps/build",
	canvasRoles: { "journey-mark": (_scene, node) => isStructurallyValidJourneyMark(node) },
	build: journeyBuild,
	...fromBuild(journeyBuild),
	fixture: journeyFamily.journeyFixture,
	docs: journeyFamilyDocs,
});

const sankeyDescriptor = family({
	operation: "buildSankey",
	label: "Sankey diagram",
	path: "/api/v1/sankey-diagrams/build",
	canvasRoles: { "sankey-mark": (_scene, node) => isStructurallyValidSankeyMark(node) },
	build: sankeyBuild,
	...fromBuild(sankeyBuild),
	fixture: sankeyFamily.sankeyFixture,
	docs: sankeyFamilyDocs,
});

const wireframeDescriptor = family({
	operation: "buildWireframe",
	label: "Wireframe",
	path: "/api/v1/wireframes/build",
	canvasRoles: {
		"wireframe-widget": (_scene, node) => !node.icon,
		"wireframe-region": (_scene, node) => !node.icon,
	},
	build: wireframeBuild,
	...fromBuild(wireframeBuild),
	fixture: wireframeFamily.wireframeFixture,
	docs: wireframeFamilyDocs,
});

const quadrantChartDescriptor = family({
	operation: "buildQuadrantChart",
	label: "Quadrant chart",
	path: "/api/v1/quadrant-charts/build",
	canvasRoles: { "quadrant-mark": (_scene, node) => isStructurallyValidQuadrantMark(node) },
	build: quadrantBuild,
	...fromBuild(quadrantBuild),
	fixture: quadrantFamily.quadrantFixture,
	docs: quadrantFamilyDocs,
});

export const families: readonly [
	typeof flowchartDescriptor,
	typeof mindmapDescriptor,
	typeof sequenceDiagramDescriptor,
	typeof timelineDescriptor,
	typeof chartDescriptor,
	typeof stateMachineDescriptor,
	typeof ganttDescriptor,
	typeof erDiagramDescriptor,
	typeof classDiagramDescriptor,
	typeof orgChartDescriptor,
	typeof vennDiagramDescriptor,
	typeof journeyMapDescriptor,
	typeof sankeyDescriptor,
	typeof wireframeDescriptor,
	typeof quadrantChartDescriptor,
] = [
	flowchartDescriptor,
	mindmapDescriptor,
	sequenceDiagramDescriptor,
	timelineDescriptor,
	chartDescriptor,
	stateMachineDescriptor,
	ganttDescriptor,
	erDiagramDescriptor,
	classDiagramDescriptor,
	orgChartDescriptor,
	vennDiagramDescriptor,
	journeyMapDescriptor,
	sankeyDescriptor,
	wireframeDescriptor,
	quadrantChartDescriptor,
];

export type DiagramFamily = (typeof families)[number];
export type DiagramTypeValue = DiagramFamily["type"];
export type FamilyBuildOperation = DiagramFamily["operation"];
export type FamilyBuildResult = DiagramFamily["contracts"]["output"]["Type"];
export const DIAGRAM_TYPES = families.map((family) => family.type);
export const FAMILY_BUILD_OPERATIONS = families.map((family) => family.operation);
export const CanonicalDiagramSchema = Schema.Union(
	families.map((family) => family.canonical.schema),
).pipe(Schema.toTaggedUnion("type"));
export type CanonicalDiagram = DiagramFamily["canonical"]["schema"]["Type"];
export type CanonicalValidationError = DiagramFamily["validationError"]["Type"];
export const CanonicalValidationErrorSchema = Schema.Union([
	...families.map((family) => family.validationError),
]);
export const diagramFixtures = families.map((family) => family.fixture);

export function familyForType<Type extends DiagramTypeValue>(
	type: Type,
): Extract<DiagramFamily, { readonly type: Type }> {
	const family = families.find(
		(family): family is Extract<DiagramFamily, { readonly type: Type }> => family.type === type,
	);
	if (!family) throw new Error(`Unknown diagram family: ${type}`);
	return family;
}
export function validateCanonicalDiagram(
	diagram: CanonicalDiagram,
): Result.Result<CanonicalDiagram, CanonicalValidationError> {
	return familyForType(diagram.type).canonical.validate(diagram);
}
export function parseCanonicalDiagram(
	input: unknown,
): Result.Result<CanonicalDiagram, Schema.SchemaError | CanonicalValidationError> {
	if (typeof input === "object" && input !== null && "type" in input) {
		const owner = families.find((entry) => entry.type === input.type);
		if (owner && "prepare" in owner) {
			const prepared: Result.Result<unknown, CanonicalValidationError | Schema.SchemaError> =
				owner.prepare({
					spec: input,
				});
			if (Result.isFailure(prepared)) return Result.fail(prepared.failure);
		}
	}
	return Result.flatMap(
		Schema.decodeUnknownResult(CanonicalDiagramSchema, { errors: "all" })(input),
		validateCanonicalDiagram,
	);
}
export function renderDiagram(
	diagram: CanonicalDiagram,
): Result.Result<
	import("@sketchi/drawing").CanvasSpec,
	CanonicalValidationError | Schema.SchemaError
> {
	return familyForType(diagram.type).canonical.render(diagram);
}

/** A host supplies the existing runtime; the browser family list never imports it. */
export interface FamilyOperation<A> {
	readonly operation: FamilyBuildOperation;
	readonly build: (
		host: Pick<typeof Builds, "bindBuild">,
	) => (
		input: unknown,
	) => Effect.Effect<
		A,
		import("./build/operation").BuildRejection<A>,
		import("./build/artifacts").ArtifactStorage | BuildRuntimeEnvironment
	>;
}

export type CanonicalDiagramDocument = DiagramFamily["document"]["Type"];
