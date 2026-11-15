import { FlowchartDocumentSchema } from "./families/flowchart/document.js";
import { vennBuild } from "./families/venn/build.js";
import { Effect, Result, Schema } from "effect";
import * as Build from "./build/code-mode/contract.js";
import type * as Runtime from "./build/code-mode/runtime.js";
import { docs as chartFamilyDocs } from "./families/chart/docs.js";
import * as chartFamily from "./families/chart/document.js";
import { renderChartDiagram } from "./families/chart/render.js";
import { docs as classFamilyDocs } from "./families/class/docs.js";
import * as classFamily from "./families/class/document.js";
import { renderClassDiagram } from "./families/class/render.js";
import { docs as erFamilyDocs } from "./families/er/docs.js";
import * as erFamily from "./families/er/document.js";
import { renderErDiagram } from "./families/er/render.js";
import * as flowchartFamily from "./families/flowchart/diagram.js";
import { docs as flowchartFamilyDocs } from "./families/flowchart/docs.js";
import { docs as ganttFamilyDocs } from "./families/gantt/docs.js";
import * as ganttFamily from "./families/gantt/document.js";
import { renderGanttDiagram } from "./families/gantt/render.js";
import { docs as journeyFamilyDocs } from "./families/journey/docs.js";
import * as journeyFamily from "./families/journey/document.js";
import { renderJourneyDiagram } from "./families/journey/render.js";
import { mindmapBuild } from "./families/mindmap/build.js";
import { docs as mindmapFamilyDocs } from "./families/mindmap/docs.js";
import * as mindmapFamily from "./families/mindmap/document.js";
import { mindmapFixture } from "./families/mindmap/fixtures.js";
import { renderMindmap } from "./families/mindmap/layout.js";
import { docs as orgChartFamilyDocs } from "./families/org-chart/docs.js";
import * as orgChartFamily from "./families/org-chart/document.js";
import { renderOrgChartDiagram } from "./families/org-chart/render.js";
import { docs as quadrantFamilyDocs } from "./families/quadrant/docs.js";
import * as quadrantFamily from "./families/quadrant/document.js";
import { renderQuadrantDiagram } from "./families/quadrant/render.js";
import { docs as sankeyFamilyDocs } from "./families/sankey/docs.js";
import * as sankeyFamily from "./families/sankey/document.js";
import { renderSankeyDiagram } from "./families/sankey/render.js";
import { docs as sequenceFamilyDocs } from "./families/sequence/docs.js";
import * as sequenceFamily from "./families/sequence/document.js";
import { renderSequenceDiagram } from "./families/sequence/render.js";
import { docs as stateMachineFamilyDocs } from "./families/state-machine/docs.js";
import * as stateMachineFamily from "./families/state-machine/document.js";
import { renderStateMachineDiagram } from "./families/state-machine/render.js";
import { docs as timelineFamilyDocs } from "./families/timeline/docs.js";
import * as timelineFamily from "./families/timeline/document.js";
import { renderTimelineDiagram } from "./families/timeline/render.js";
import { docs as vennFamilyDocs } from "./families/venn/docs.js";
import * as vennFamily from "./families/venn/document.js";
import { renderVennDiagram } from "./families/venn/render.js";
import { docs as wireframeFamilyDocs } from "./families/wireframe/docs.js";
import * as wireframeFamily from "./families/wireframe/document.js";
import { renderWireframeDiagram } from "./families/wireframe/render.js";
import { DiagramValidationError } from "./graph/intermediate.js";
import { renderIntermediateDiagram } from "./graph/scene.js";

function canonical<S extends Schema.Top & { readonly Type: { readonly type: string } }, E, RE>(
	schema: S,
	type: S["Type"]["type"],
	validate: (diagram: S["Type"]) => Result.Result<S["Type"], E>,
	render: (diagram: S["Type"]) => Result.Result<import("@sketchi/drawing").CanvasSpec, RE>,
): {
	readonly schema: S;
	readonly validate: (diagram: CanonicalDiagram) => Result.Result<S["Type"], E>;
	readonly render: (
		diagram: CanonicalDiagram,
	) => Result.Result<import("@sketchi/drawing").CanvasSpec, RE>;
} {
	// Only the tag is needed here: callers already carry the canonical schema's union.
	const matches = (diagram: { readonly type: string }): diagram is S["Type"] =>
		diagram.type === type;
	return {
		schema,
		validate: (diagram: CanonicalDiagram): Result.Result<S["Type"], E> => {
			if (!matches(diagram)) throw new Error("Mismatched canonical family");
			return validate(diagram);
		},
		render: (
			diagram: CanonicalDiagram,
		): Result.Result<import("@sketchi/drawing").CanvasSpec, RE> => {
			if (!matches(diagram)) throw new Error("Mismatched canonical family");
			return render(diagram);
		},
	};
}

function family<const Definition extends { readonly type: string; readonly spec: Schema.Top }>(
	definition: Definition,
) {
	const type: Definition["type"] = definition.type;
	const spec: Definition["spec"] = definition.spec;
	return {
		...definition,
		document: Schema.Struct({ type: Schema.Literal(type), spec }),
		decodeDocument: (input: unknown) =>
			Schema.decodeUnknownEffect(spec, { errors: "all" })(input).pipe(
				Effect.map((value) => ({ type, spec: value })),
			),
	};
}

/** One composition of the existing family owners. Runtime selection is bound by the server host. */
export const families = [
	family({
		type: flowchartFamily.flowchartFixture.type,
		operation: "buildFlowchart",
		label: "Flowchart",
		path: "/api/v1/flowcharts/build",
		canonical: canonical(
			flowchartFamily.FlowchartDiagram,
			flowchartFamily.flowchartFixture.type,
			flowchartFamily.validateFlowchartDiagram,
			renderIntermediateDiagram,
		),
		validationError: flowchartFamily.FlowchartValidationError,
		fixture: flowchartFamily.flowchartFixture,
		spec: FlowchartDocumentSchema,
		request: Build.BuildFlowchartRequestSchema,
		contracts: {
			input: Build.BuildFlowchartRequestSchema,
			output: Build.BuildFlowchartResultSchema,
		},
		studioInput: Build.BuildFlowchartRequestSchema.omit({ options: true }),
		build: (runtime: typeof Runtime) => runtime.buildFlowchart,
		docs: flowchartFamilyDocs,
	}),
	family({
		type: mindmapFixture.type,
		operation: "buildMindmap",
		label: "Mindmap",
		path: "/api/v1/mindmaps/build",
		canonical: canonical(
			mindmapFamily.Mindmap,
			mindmapFixture.type,
			mindmapFamily.validateMindmap,
			(diagram) => Result.succeed(renderMindmap(diagram)),
		),
		validationError: mindmapFamily.MindmapInputError,
		fixture: mindmapFixture,
		spec: mindmapFamily.MindmapDocument,
		request: mindmapBuild.request,
		contracts: {
			input: mindmapBuild.input,
			output: mindmapBuild.result,
		},
		studioInput: mindmapBuild.toolInput,
		build: (runtime: typeof Runtime) => runtime.buildMindmap,
		docs: mindmapFamilyDocs,
	}),
	family({
		type: sequenceFamily.sequenceFixture.type,
		operation: "buildSequenceDiagram",
		label: "Sequence diagram",
		path: "/api/v1/sequences/build",
		canonical: canonical(
			sequenceFamily.SequenceDiagram,
			sequenceFamily.sequenceFixture.type,
			sequenceFamily.validateSequenceDiagram,
			renderSequenceDiagram,
		),
		validationError: sequenceFamily.SequenceValidationError,
		fixture: sequenceFamily.sequenceFixture,
		spec: Build.SequenceDiagramSpec,
		request: Build.BuildSequenceDiagramRequest,
		contracts: {
			input: Schema.Struct({
				...Build.BuildSequenceDiagramRequest.fields,
				// Legacy palette inputs remain valid at runtime, but are not authoring controls.
				spec: Build.SequenceDiagramSpec.mapFields(({ id, title, participants, messages }) => ({
					id,
					title,
					participants,
					messages,
				})),
			}),
			output: Build.BuildSequenceDiagramResultSchema,
		},
		studioInput: Build.BuildSequenceDiagramToolInputSchema,
		build: (runtime: typeof Runtime) => runtime.buildSequenceDiagram,
		docs: sequenceFamilyDocs,
	}),
	family({
		type: timelineFamily.timelineFixture.type,
		operation: "buildTimeline",
		label: "Timeline",
		path: "/api/v1/timelines/build",
		canonical: canonical(
			timelineFamily.TimelineDiagram,
			timelineFamily.timelineFixture.type,
			timelineFamily.validateTimelineDiagram,
			renderTimelineDiagram,
		),
		validationError: timelineFamily.TimelineValidationError,
		fixture: timelineFamily.timelineFixture,
		spec: Build.TimelineSpec,
		request: Build.BuildTimelineRequest,
		contracts: {
			input: Schema.Struct({
				...Build.BuildTimelineRequest.fields,
				// Legacy palette inputs remain valid at runtime, but are not authoring controls.
				spec: Build.TimelineSpec.mapFields(({ id, title, events, lanes, today }) => ({
					id,
					title,
					events,
					lanes,
					today,
				})),
			}),
			output: Build.BuildTimelineResultSchema,
		},
		studioInput: Build.BuildTimelineToolInputSchema,
		build: (runtime: typeof Runtime) => runtime.buildTimeline,
		docs: timelineFamilyDocs,
	}),
	family({
		type: chartFamily.chartFixture.type,
		operation: "buildChart",
		label: "Chart",
		path: "/api/v1/charts/build",
		canonical: canonical(
			chartFamily.ChartDiagram,
			chartFamily.chartFixture.type,
			chartFamily.validateChartDiagram,
			renderChartDiagram,
		),
		validationError: chartFamily.ChartValidationError,
		fixture: chartFamily.chartFixture,
		spec: Build.ChartSpec,
		request: Build.BuildChartRequest,
		contracts: {
			input: Schema.Struct({
				...Build.BuildChartRequest.fields,
				// Legacy palette inputs remain valid at runtime, but are not authoring controls.
				spec: Build.ChartToolSpecSchema,
			}),
			output: Build.BuildChartResultSchema,
		},
		studioInput: Build.BuildChartToolInputSchema,
		build: (runtime: typeof Runtime) => runtime.buildChart,
		docs: chartFamilyDocs,
	}),
	family({
		type: stateMachineFamily.stateMachineFixture.type,
		operation: "buildStateMachine",
		label: "State machine",
		path: "/api/v1/state-machines/build",
		canonical: canonical(
			stateMachineFamily.StateMachineDiagram,
			stateMachineFamily.stateMachineFixture.type,
			stateMachineFamily.validateStateMachineDiagram,
			renderStateMachineDiagram,
		),
		validationError: stateMachineFamily.StateMachineValidationError,
		fixture: stateMachineFamily.stateMachineFixture,
		spec: Build.StateMachineSpec,
		request: Build.BuildStateMachineRequest,
		contracts: {
			input: Schema.Struct({
				...Build.BuildStateMachineRequest.fields,
				// Legacy palette inputs remain valid at runtime, but are not authoring controls.
				spec: Build.StateMachineSpec.mapFields(
					({ id, title, initial, states, transitions, layout }) => ({
						id,
						title,
						initial,
						states,
						transitions,
						layout,
					}),
				),
			}),
			output: Build.BuildStateMachineResultSchema,
		},
		studioInput: Build.BuildStateMachineToolInputSchema,
		build: (runtime: typeof Runtime) => runtime.buildStateMachine,
		docs: stateMachineFamilyDocs,
	}),
	family({
		type: ganttFamily.ganttFixture.type,
		operation: "buildGantt",
		label: "Gantt chart",
		path: "/api/v1/gantts/build",
		canonical: canonical(
			ganttFamily.GanttDiagram,
			ganttFamily.ganttFixture.type,
			ganttFamily.validateGanttDiagram,
			renderGanttDiagram,
		),
		validationError: ganttFamily.GanttValidationError,
		fixture: ganttFamily.ganttFixture,
		spec: Build.GanttSpec,
		request: Build.BuildGanttRequest,
		contracts: {
			input: Schema.Struct({
				...Build.BuildGanttRequest.fields,
				// Legacy palette inputs remain valid at runtime, but are not authoring controls.
				spec: Build.GanttToolSpecSchema,
			}),
			output: Build.BuildGanttResultSchema,
		},
		studioInput: Build.BuildGanttToolInputSchema,
		build: (runtime: typeof Runtime) => runtime.buildGantt,
		docs: ganttFamilyDocs,
	}),
	family({
		type: erFamily.erFixture.type,
		operation: "buildErDiagram",
		label: "ER diagram",
		path: "/api/v1/er-diagrams/build",
		canonical: canonical(
			erFamily.ErDiagram,
			erFamily.erFixture.type,
			erFamily.validateErDiagram,
			renderErDiagram,
		),
		validationError: erFamily.ErValidationError,
		fixture: erFamily.erFixture,
		spec: Build.ErSpec,
		request: Build.BuildErDiagramRequest,
		contracts: {
			input: Schema.Struct({
				...Build.BuildErDiagramRequest.fields,
				// Legacy palette inputs remain valid at runtime, but are not authoring controls.
				spec: Build.ErToolSpecSchema,
			}),
			output: Build.BuildErDiagramResultSchema,
		},
		studioInput: Build.BuildErDiagramToolInputSchema,
		build: (runtime: typeof Runtime) => runtime.buildErDiagram,
		docs: erFamilyDocs,
	}),
	family({
		type: classFamily.classFixture.type,
		operation: "buildClassDiagram",
		label: "Class diagram",
		path: "/api/v1/class-diagrams/build",
		canonical: canonical(
			classFamily.ClassDiagram,
			classFamily.classFixture.type,
			classFamily.validateClassDiagram,
			renderClassDiagram,
		),
		validationError: classFamily.ClassValidationError,
		fixture: classFamily.classFixture,
		spec: Build.ClassSpec,
		request: Build.BuildClassDiagramRequest,
		contracts: {
			input: Schema.Struct({
				...Build.BuildClassDiagramRequest.fields,
				// Legacy palette inputs remain valid at runtime, but are not authoring controls.
				spec: Build.ClassToolSpecSchema,
			}),
			output: Build.BuildClassDiagramResultSchema,
		},
		studioInput: Build.BuildClassDiagramToolInputSchema,
		build: (runtime: typeof Runtime) => runtime.buildClassDiagram,
		docs: classFamilyDocs,
	}),
	family({
		type: orgChartFamily.orgChartFixture.type,
		operation: "buildOrgChart",
		label: "Org chart",
		path: "/api/v1/org-charts/build",
		canonical: canonical(
			orgChartFamily.OrgChartDiagram,
			orgChartFamily.orgChartFixture.type,
			orgChartFamily.validateOrgChartDiagram,
			renderOrgChartDiagram,
		),
		validationError: orgChartFamily.OrgChartValidationError,
		fixture: orgChartFamily.orgChartFixture,
		spec: Build.OrgChartSpec,
		request: Build.BuildOrgChartRequest,
		contracts: {
			input: Schema.Struct({
				...Build.BuildOrgChartRequest.fields,
				// Legacy palette inputs remain valid at runtime, but are not authoring controls.
				spec: Build.OrgChartToolSpecSchema,
			}),
			output: Build.BuildOrgChartResultSchema,
		},
		studioInput: Build.BuildOrgChartToolInputSchema,
		build: (runtime: typeof Runtime) => runtime.buildOrgChart,
		docs: orgChartFamilyDocs,
	}),
	family({
		type: vennFamily.vennFixture.type,
		operation: "buildVennDiagram",
		label: "Venn diagram",
		path: "/api/v1/venn-diagrams/build",
		canonical: canonical(
			vennFamily.VennDiagram,
			vennFamily.vennFixture.type,
			vennFamily.validateVennDiagram,
			(diagram) => Result.succeed(renderVennDiagram(diagram)),
		),
		validationError: vennFamily.VennValidationError,
		fixture: vennFamily.vennFixture,
		spec: vennFamily.VennDocument,
		request: vennBuild.request,
		contracts: {
			input: vennBuild.input,
			output: vennBuild.result,
		},
		studioInput: vennBuild.toolInput,
		build: (runtime: typeof Runtime) => runtime.buildVennDiagram,
		docs: vennFamilyDocs,
	}),
	family({
		type: journeyFamily.journeyFixture.type,
		operation: "buildJourneyMap",
		label: "Journey map",
		path: "/api/v1/journey-maps/build",
		canonical: canonical(
			journeyFamily.JourneyDiagram,
			journeyFamily.journeyFixture.type,
			journeyFamily.validateJourneyDiagram,
			renderJourneyDiagram,
		),
		validationError: journeyFamily.JourneyValidationError,
		fixture: journeyFamily.journeyFixture,
		spec: Build.JourneySpec,
		request: Build.BuildJourneyMapRequest,
		contracts: {
			input: Schema.Struct({
				...Build.BuildJourneyMapRequest.fields,
				// Legacy palette inputs remain valid at runtime, but are not authoring controls.
				spec: Build.JourneyToolSpecSchema,
			}),
			output: Build.BuildJourneyMapResultSchema,
		},
		studioInput: Build.BuildJourneyMapToolInputSchema,
		build: (runtime: typeof Runtime) => runtime.buildJourneyMap,
		docs: journeyFamilyDocs,
	}),
	family({
		type: sankeyFamily.sankeyFixture.type,
		operation: "buildSankey",
		label: "Sankey diagram",
		path: "/api/v1/sankey-diagrams/build",
		canonical: canonical(
			sankeyFamily.SankeyDiagram,
			sankeyFamily.sankeyFixture.type,
			sankeyFamily.validateSankeyDiagram,
			renderSankeyDiagram,
		),
		validationError: sankeyFamily.SankeyValidationError,
		fixture: sankeyFamily.sankeyFixture,
		spec: Build.SankeySpec,
		request: Build.BuildSankeyRequest,
		contracts: {
			input: Schema.Struct({
				...Build.BuildSankeyRequest.fields,
				// Legacy palette inputs remain valid at runtime, but are not authoring controls.
				spec: Build.SankeyToolSpecSchema,
			}),
			output: Build.BuildSankeyResultSchema,
		},
		studioInput: Build.BuildSankeyToolInputSchema,
		build: (runtime: typeof Runtime) => runtime.buildSankey,
		docs: sankeyFamilyDocs,
	}),
	family({
		type: wireframeFamily.wireframeFixture.type,
		operation: "buildWireframe",
		label: "Wireframe",
		path: "/api/v1/wireframes/build",
		canonical: canonical(
			wireframeFamily.WireframeDiagram,
			wireframeFamily.wireframeFixture.type,
			wireframeFamily.validateWireframeDiagram,
			renderWireframeDiagram,
		),
		validationError: wireframeFamily.WireframeValidationError,
		fixture: wireframeFamily.wireframeFixture,
		spec: Build.WireframeSpec,
		request: Build.BuildWireframeRequest,
		contracts: {
			input: Schema.Struct({
				...Build.BuildWireframeRequest.fields,
				// Legacy palette inputs remain valid at runtime, but are not authoring controls.
				spec: Build.WireframeToolSpecSchema,
			}),
			output: Build.BuildWireframeResultSchema,
		},
		studioInput: Build.BuildWireframeToolInputSchema,
		build: (runtime: typeof Runtime) => runtime.buildWireframe,
		docs: wireframeFamilyDocs,
	}),
	family({
		type: quadrantFamily.quadrantFixture.type,
		operation: "buildQuadrantChart",
		label: "Quadrant chart",
		path: "/api/v1/quadrant-charts/build",
		canonical: canonical(
			quadrantFamily.QuadrantDiagram,
			quadrantFamily.quadrantFixture.type,
			quadrantFamily.validateQuadrantDiagram,
			renderQuadrantDiagram,
		),
		validationError: quadrantFamily.QuadrantValidationError,
		fixture: quadrantFamily.quadrantFixture,
		spec: Build.QuadrantChartSpec,
		request: Build.BuildQuadrantChartRequest,
		contracts: {
			input: Schema.Struct({
				...Build.BuildQuadrantChartRequest.fields,
				// Legacy palette inputs remain valid at runtime, but are not authoring controls.
				spec: Build.QuadrantChartToolSpecSchema,
			}),
			output: Build.BuildQuadrantChartResultSchema,
		},
		studioInput: Build.BuildQuadrantChartToolInputSchema,
		build: (runtime: typeof Runtime) => runtime.buildQuadrantChart,
		docs: quadrantFamilyDocs,
	}),
] as const;

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
export type CanonicalValidationError =
	| DiagramFamily["validationError"]["Type"]
	| DiagramValidationError;
export const CanonicalValidationErrorSchema = Schema.Union([
	DiagramValidationError,
	...families.map((family) => family.validationError),
]);
export const diagramFixtures = families.map((family) => family.fixture);

export function familyForType<Type extends DiagramTypeValue>(type: Type) {
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
	if (typeof input === "object" && input !== null && "type" in input && input.type === "mindmap")
		return mindmapFamily.parseMindmap(input);
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
		runtime: typeof Runtime,
	) => (
		input: unknown,
	) => Effect.Effect<
		A,
		import("./build/operation.js").BuildRejection<A>,
		| import("./build/code-mode/artifacts.js").CodeModeArtifactStorage
		| Runtime.CodeModeRuntimeEnvironment
	>;
}

export type CanonicalDiagramDocument = DiagramFamily["document"]["Type"];
