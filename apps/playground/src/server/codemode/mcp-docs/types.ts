import { Schema } from "effect";
import {
	ApplyDiagramPatchRequestSchema,
	ApplyDiagramPatchResultSchema,
	BuildFlowchartAccepted,
	BuildFlowchartOptionsSchema,
	BuildFlowchartRejected,
	BuildFlowchartRequestSchema,
	BuildFlowchartResultSchema,
	BuildMindmapRequestSchema,
	BuildMindmapResultSchema,
	BuildSequenceDiagramRequestSchema,
	BuildStateMachineRequestSchema,
	BuildStateMachineResultSchema,
	BuildGanttRequestSchema,
	BuildGanttResultSchema,
	GanttToolSpecSchema,
	BuildErDiagramRequestSchema,
	BuildErDiagramResultSchema,
	BuildClassDiagramRequestSchema,
	BuildClassDiagramResultSchema,
	ClassToolSpecSchema,
	BuildOrgChartRequestSchema,
	BuildOrgChartResultSchema,
	OrgChartToolSpecSchema,
	BuildVennDiagramRequestSchema,
	BuildVennDiagramResultSchema,
	VennToolSpecSchema,
	BuildJourneyMapRequestSchema,
	BuildJourneyMapResultSchema,
	JourneyToolSpecSchema,
	BuildTimelineRequestSchema,
	BuildSequenceDiagramResultSchema,
	BuildTimelineResultSchema,
	BuildChartRequestSchema,
	BuildChartResultSchema,
	ChartToolSpecSchema,
	CodeModeIssueCodeSchema,
	CodeModeIssueRefSchema,
	CodeModeIssueSchema,
	CanvasSpecSchema,
	CreateCanvasRequestSchema,
	CreateCanvasResultSchema,
	DiagramSelectorSchema,
	ErToolSpecSchema,
	FlowchartSpecSchema,
	MindmapSpecSchema,
	SequenceDiagramSpecSchema,
	StateMachineSpecSchema,
	TimelineSpecSchema,
	GetArtifactRequestSchema,
	GetArtifactResultSchema,
	SceneElementSchema,
	SearchIconsRequestSchema,
	SearchIconsResultSchema,
	toCodeModeJsonSchema,
} from "@sketchi/diagram-agent";

export const codeModeContracts = {
	buildFlowchart: {
		input: Schema.Struct({
			...BuildFlowchartRequestSchema.fields,
			// Legacy palette inputs remain valid at runtime, but are not authoring controls.
			spec: FlowchartSpecSchema.mapFields(({ id, title, nodes, edges, groups, lanes, layout }) => ({
				id,
				title,
				nodes,
				edges,
				groups,
				lanes,
				layout,
			})),
		}),
		output: BuildFlowchartResultSchema,
	},
	buildMindmap: {
		input: Schema.Struct({
			...BuildMindmapRequestSchema.fields,
			// Legacy palette inputs remain valid at runtime, but are not authoring controls.
			spec: MindmapSpecSchema.mapFields(({ id, title, root, layout }) => ({
				id,
				title,
				root,
				layout,
			})),
		}),
		output: BuildMindmapResultSchema,
	},
	buildSequenceDiagram: {
		input: Schema.Struct({
			...BuildSequenceDiagramRequestSchema.fields,
			// Legacy palette inputs remain valid at runtime, but are not authoring controls.
			spec: SequenceDiagramSpecSchema.mapFields(({ id, title, participants, messages }) => ({
				id,
				title,
				participants,
				messages,
			})),
		}),
		output: BuildSequenceDiagramResultSchema,
	},
	buildTimeline: {
		input: Schema.Struct({
			...BuildTimelineRequestSchema.fields,
			// Legacy palette inputs remain valid at runtime, but are not authoring controls.
			spec: TimelineSpecSchema.mapFields(({ id, title, events, lanes, today }) => ({
				id,
				title,
				events,
				lanes,
				today,
			})),
		}),
		output: BuildTimelineResultSchema,
	},
	buildChart: {
		input: Schema.Struct({
			...BuildChartRequestSchema.fields,
			// Legacy palette inputs remain valid at runtime, but are not authoring controls.
			spec: ChartToolSpecSchema,
		}),
		output: BuildChartResultSchema,
	},
	buildStateMachine: {
		input: Schema.Struct({
			...BuildStateMachineRequestSchema.fields,
			// Legacy palette inputs remain valid at runtime, but are not authoring controls.
			spec: StateMachineSpecSchema.mapFields(
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
		output: BuildStateMachineResultSchema,
	},
	buildGantt: {
		input: Schema.Struct({
			...BuildGanttRequestSchema.fields,
			// Legacy palette inputs remain valid at runtime, but are not authoring controls.
			spec: GanttToolSpecSchema,
		}),
		output: BuildGanttResultSchema,
	},
	buildErDiagram: {
		input: Schema.Struct({
			...BuildErDiagramRequestSchema.fields,
			// Legacy palette inputs remain valid at runtime, but are not authoring controls.
			spec: ErToolSpecSchema,
		}),
		output: BuildErDiagramResultSchema,
	},
	buildClassDiagram: {
		input: Schema.Struct({
			...BuildClassDiagramRequestSchema.fields,
			// Legacy palette inputs remain valid at runtime, but are not authoring controls.
			spec: ClassToolSpecSchema,
		}),
		output: BuildClassDiagramResultSchema,
	},
	buildOrgChart: {
		input: Schema.Struct({
			...BuildOrgChartRequestSchema.fields,
			// Legacy palette inputs remain valid at runtime, but are not authoring controls.
			spec: OrgChartToolSpecSchema,
		}),
		output: BuildOrgChartResultSchema,
	},
	buildVennDiagram: {
		input: Schema.Struct({
			...BuildVennDiagramRequestSchema.fields,
			// Legacy palette inputs remain valid at runtime, but are not authoring controls.
			spec: VennToolSpecSchema,
		}),
		output: BuildVennDiagramResultSchema,
	},
	buildJourneyMap: {
		input: Schema.Struct({
			...BuildJourneyMapRequestSchema.fields,
			// Legacy palette inputs remain valid at runtime, but are not authoring controls.
			spec: JourneyToolSpecSchema,
		}),
		output: BuildJourneyMapResultSchema,
	},
	createCanvas: {
		input: CreateCanvasRequestSchema,
		output: CreateCanvasResultSchema,
	},
	getArtifact: {
		input: GetArtifactRequestSchema,
		output: GetArtifactResultSchema,
	},
	applyDiagramPatch: {
		input: ApplyDiagramPatchRequestSchema,
		output: ApplyDiagramPatchResultSchema,
	},
	searchIcons: {
		input: SearchIconsRequestSchema,
		output: SearchIconsResultSchema,
	},
};

export type CodeModeOperation = keyof typeof codeModeContracts;
export const CODE_MODE_OPERATIONS = Object.keys(codeModeContracts) as CodeModeOperation[];

/**
 * Package schemas that recur across operations. Each is declared once and referenced by name, so
 * per-operation declarations stay small as families are added.
 */
const sharedContracts = [
	["IssueCode", CodeModeIssueCodeSchema],
	["IssueRef", CodeModeIssueRefSchema],
	["Issue", CodeModeIssueSchema],
	["BuildOptions", BuildFlowchartOptionsSchema.schema],
	["Quality", BuildFlowchartAccepted.fields.quality],
	["ArtifactFormatRef", BuildFlowchartAccepted.fields.artifact.fields.formats.schema.value],
	["Artifact", BuildFlowchartAccepted.fields.artifact],
	["PartialArtifact", BuildFlowchartRejected.fields.partial.schema],
	["DiagramSelector", DiagramSelectorSchema],
	["CanvasElement", SceneElementSchema],
	["CanvasSpec", CanvasSpecSchema],
] as const;

const record = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown));

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.entries(value)
			.filter(([key]) => key !== "$schema")
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

const NON_FINITE = ["Infinity", "-Infinity", "NaN"];

/** JSON encodes non-finite numbers as strings; inside the sandbox they are plain numbers. */
function isNumberWithNonFiniteStrings(members: unknown[]): boolean {
	const [numeric, strings] = members.map((member) =>
		member && typeof member === "object" ? record(member) : {},
	);
	const values = strings?.enum;
	return (
		members.length === 2 &&
		(numeric?.type === "number" || numeric?.type === "integer") &&
		strings?.type === "string" &&
		Array.isArray(values) &&
		values.length === NON_FINITE.length &&
		NON_FINITE.every((value) => values.includes(value))
	);
}

function propertyName(name: string): string {
	return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

/** JSON constraints remain enforced by the host; declarations describe their structural types. */
export function jsonSchemaType(
	value: unknown,
	prefix: string,
	shared: ReadonlyMap<string, string> = new Map(),
): string {
	if (value === true) return "unknown";
	if (value === false) return "never";
	const schema = record(value);
	const sharedName = shared.get(canonical(schema));
	if (sharedName) return sharedName;
	const type = (member: unknown) => jsonSchemaType(member, prefix, shared);
	if (typeof schema.$ref === "string") {
		if (!schema.$ref.startsWith("#/$defs/"))
			throw new Error(`Unsupported reference: ${schema.$ref}`);
		return `${prefix}_${schema.$ref.slice("#/$defs/".length)}`;
	}
	if ("const" in schema) return JSON.stringify(schema.const);
	if (Array.isArray(schema.enum))
		return schema.enum.map((entry) => JSON.stringify(entry)).join(" | ");
	for (const keyword of ["anyOf", "oneOf"]) {
		const members = schema[keyword];
		if (Array.isArray(members)) {
			if (isNumberWithNonFiniteStrings(members)) return "number";
			return members.map(type).join(" | ");
		}
	}
	if (Array.isArray(schema.allOf))
		return schema.allOf.map((member) => `(${type(member)})`).join(" & ");
	switch (schema.type) {
		case "string":
			return "string";
		case "integer":
		case "number":
			return "number";
		case "boolean":
			return "boolean";
		case "null":
			return "null";
		case "array": {
			if (Array.isArray(schema.prefixItems)) {
				const tuple = schema.prefixItems.map(type);
				if (schema.items !== false) tuple.push(`...Array<${type(schema.items ?? {})}>`);
				return `[${tuple.join(", ")}]`;
			}
			return `Array<${type(schema.items ?? {})}>`;
		}
		case "object": {
			const required = Array.isArray(schema.required) ? schema.required : [];
			const fields = Object.entries(record(schema.properties ?? {})).map(
				([name, property]) =>
					`${propertyName(name)}${required.includes(name) ? "" : "?"}: ${type(property)};`,
			);
			if (schema.additionalProperties !== false) {
				fields.push(`[key: string]: ${type(schema.additionalProperties ?? {})};`);
			}
			return `{ ${fields.join(" ")} }`;
		}
		case undefined:
			if (
				Object.keys(schema).every((key) =>
					["$schema", "$defs", "title", "description", "default"].includes(key),
				)
			)
				return "unknown";
			// Fail the drift check rather than silently advertising an unsupported shape.
			throw new Error(`Unsupported Code Mode JSON Schema: ${JSON.stringify(schema)}`);
		default:
			throw new Error(`Unsupported Code Mode JSON Schema type: ${String(schema.type)}`);
	}
}

function jsonSchemaOf(schema: Schema.Top): Record<string, unknown> {
	const { $schema: _, ...json } = toCodeModeJsonSchema(schema);
	if (json.$defs) throw new Error("Shared Code Mode types must not carry definitions.");
	return json;
}

export function generateCodeModeTypes(): string {
	const shared = new Map<string, string>();
	const sharedDeclarations: string[] = [];
	for (const [name, contract] of sharedContracts) {
		// Results use the type side. Requests use the encoded side, which differs when fields have defaults.
		const result = jsonSchemaOf(Schema.toType(contract));
		const declaration = jsonSchemaType(result, name, shared);
		sharedDeclarations.push(`type ${name} = ${declaration};`);
		shared.set(canonical(result), name);
		const input = jsonSchemaOf(Schema.toEncoded(contract));
		const inputDeclaration = jsonSchemaType(input, name, shared);
		if (inputDeclaration === name || inputDeclaration === declaration) {
			shared.set(canonical(input), name);
		} else {
			sharedDeclarations.push(`type ${name}Input = ${inputDeclaration};`);
			shared.set(canonical(input), `${name}Input`);
		}
	}
	const signatures: string[] = [];
	const declarations: string[] = [];
	for (const [operation, contracts] of Object.entries(codeModeContracts)) {
		const name = operation.charAt(0).toUpperCase() + operation.slice(1);
		signatures.push(`  ${operation}(input: ${name}Request): Promise<${name}Result>;`);
		// Project inputs before the JSON Schema helper normalizes to the type side.
		for (const [suffix, contract] of [
			["Request", Schema.toEncoded(contracts.input)],
			["Result", Schema.toType(contracts.output)],
		] as const) {
			const alias = `${name}${suffix}`;
			const schema = toCodeModeJsonSchema(contract);
			declarations.push(`type ${alias} = ${jsonSchemaType(schema, alias, shared)};`);
			for (const [ref, definition] of Object.entries(record(schema.$defs ?? {}))) {
				declarations.push(`type ${alias}_${ref} = ${jsonSchemaType(definition, alias, shared)};`);
			}
		}
	}
	return `// Generated from the package Code Mode schemas. Do not edit by hand.\ndeclare const sketchi: {\n${signatures.join("\n")}\n};\n\n${[...sharedDeclarations, ...declarations].join("\n\n")}\n`;
}
