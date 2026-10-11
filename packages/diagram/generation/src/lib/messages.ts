import { DIAGRAM_TYPES, type DiagramTypeValue } from "@sketchi/diagram-core";
import { Schema } from "effect";

import { DiagramGenerationTypeSchema, UnsupportedDiagramIntentKindSchema } from "./intent.js";

/** `a, b, or c` for a list of alternatives. */
export function listAlternatives(values: readonly string[]): string {
	return values.length < 2
		? values.join("")
		: `${values.slice(0, -1).join(", ")}, or ${values.at(-1)}`;
}

const NATIVE_KINDS = DIAGRAM_TYPES.map((type) => `"${type}"`);
const UNSUPPORTED_KINDS: readonly string[] = UnsupportedDiagramIntentKindSchema.literals;

/** A catalog logo the prompt names; the only slugs a node icon may use. */
export class DiagramGenerationLogo extends Schema.Class<DiagramGenerationLogo>(
	"DiagramGenerationLogo",
)({
	aliases: Schema.optionalKey(Schema.Array(Schema.String)),
	name: Schema.String,
	slug: Schema.String,
}) {}

export class DiagramGenerationPrompt extends Schema.Class<DiagramGenerationPrompt>(
	"DiagramGenerationPrompt",
)({
	id: Schema.String,
	/** Logos for technologies the prompt names, in order of mention. */
	logos: Schema.optionalKey(Schema.Array(DiagramGenerationLogo)),
	request: Schema.String,
	requestedType: Schema.optionalKey(DiagramGenerationTypeSchema),
}) {}

/** Provider adapters map these onto their own system and user channels. */
export class DiagramGenerationMessages extends Schema.Class<DiagramGenerationMessages>(
	"DiagramGenerationMessages",
)({
	system: Schema.String,
	user: Schema.String,
}) {}

const COMMON_INSTRUCTIONS = [
	"Return only compact, minified JSON on one line. Do not use markdown.",
	"Author one concise title of at most 60 characters. Do not copy the whole scenario into the title.",
	`Set intent.requestedKind to the diagram kind the scenario actually requests: ${listAlternatives([...NATIVE_KINDS, ...UNSUPPORTED_KINDS.map((kind) => `"${kind}"`)])}.`,
	`Sketchi supports only nativeKind ${listAlternatives(NATIVE_KINDS)}. If the requested kind is ${listAlternatives(UNSUPPORTED_KINDS)}, set nativeKind to null, omit diagram, and never coerce it into a supported kind.`,
	"When nativeKind is null, return an empty requirements array because there is no native artifact to validate.",
	"List every measurable scenario requirement once in intent.requirements. Convert counts and minimums into count requirements, hierarchy depth into topic_levels, and required names or branch/message text into label requirements.",
	'Count requirement target must be exactly one of "nodes", "decision_nodes", "terminal_nodes", "topics", "participants", "messages", or "cycles". Use "cycles" for loops and retry cycles; never invent another target name.',
	'Depth requirement target must be exactly "topic_levels". Label requirement target must be exactly one of "node", "branch", "topic", "participant", or "message".',
	'Use comparator "minimum" for phrases such as "at least" and "exact" for exact counts. Do not invent measurable requirements that the scenario did not request.',
	"The diagram must satisfy every requirement in the plan. Sketchi deterministically checks the plan against the artifact.",
];

const FLOWCHART_IR_INSTRUCTIONS = [
	'Use diagram type "flowchart".',
	'Every node must have id, label, and kind: "start", "process", "decision", or "end".',
	"Use exactly one start node and at least one end node.",
	"Every non-end node must have at least one outgoing edge; every end node must have zero outgoing edges.",
	"Every decision node must have at least two outgoing edges with non-empty unique labels.",
	"For each retry, return, or feedback loop, include a real back-edge to an earlier distinct process or decision. Never target start and never use a self-loop.",
	"Edges must use existing node ids.",
	'Use layout { "direction": "TB", "edgeRouting": "orthogonal" } unless the scenario says otherwise.',
];

const MINDMAP_IR_INSTRUCTIONS = [
	'Use diagram type "mindmap".',
	"Return one nested root topic with label and children. Every child also has label and children; use an empty children array for a leaf.",
	"Return the diagram id. Do not return flat nodes, edges, derived ids, depth, sibling indexes, or parent references; Sketchi derives them deterministically.",
	"Unless the scenario is intentionally tiny, create 2-4 children per major topic and 2-3 meaningful levels.",
	'Use layout { "direction": "LR", "edgeRouting": "curved" } unless the scenario says right-to-left.',
];

const SEQUENCE_IR_INSTRUCTIONS = [
	'Use diagram type "sequence".',
	"Return ordered participants with stable ids and human labels.",
	"Return chronological messages with stable ids, participant source and target ids, and concise labels.",
	'Use message type "message" for calls and "return" for responses; dashed style is appropriate for responses.',
	"Answer a call with a later return from the callee back to the caller; Sketchi draws the callee's activation bar from the call to its return. Leave fire-and-forget events unanswered.",
	"Every message source and target must reference a participant, and self-messages are not supported.",
	"Use at most 12 participants and 40 messages.",
];

/** Model-facing IR rules for each canonical family, in registry order. */
const IR_INSTRUCTIONS = {
	flowchart: { title: "Flowchart IR rules", rules: FLOWCHART_IR_INSTRUCTIONS },
	mindmap: { title: "Mindmap IR rules", rules: MINDMAP_IR_INSTRUCTIONS },
	sequence: { title: "Sequence IR rules", rules: SEQUENCE_IR_INSTRUCTIONS },
} as const satisfies Record<DiagramTypeValue, { title: string; rules: readonly string[] }>;

/** The JSON shape shown for an explicitly requested family. */
const FAMILY_EXAMPLES = {
	flowchart: {
		diagram: {
			id: "short-kebab-case-id",
			type: "flowchart",
			nodes: [
				{ id: "start-id", label: "Human label", kind: "start" },
				{ id: "decision-id", label: "Question?", kind: "decision" },
			],
			edges: [
				{
					id: "edge-id",
					source: "decision-id",
					target: "target-id",
					label: "yes",
				},
			],
			layout: { direction: "TB", edgeRouting: "orthogonal" },
		},
		requirements: [
			{ kind: "count", target: "nodes", comparator: "minimum", value: 8 },
			{ kind: "label", target: "branch", value: "retry" },
		],
	},
	mindmap: {
		diagram: {
			id: "short-kebab-case-id",
			type: "mindmap",
			root: {
				label: "Root topic",
				children: [{ label: "Child topic", children: [] }],
			},
			layout: { direction: "LR", edgeRouting: "curved" },
		},
		requirements: [
			{ kind: "count", target: "topics", comparator: "minimum", value: 8 },
			{ kind: "label", target: "topic", value: "Operations" },
		],
	},
	sequence: {
		diagram: {
			id: "short-kebab-case-id",
			type: "sequence",
			participants: [
				{ id: "client", label: "Client" },
				{ id: "service", label: "Service" },
			],
			messages: [
				{
					id: "request",
					source: "client",
					target: "service",
					label: "Request",
					type: "message",
				},
			],
		},
		requirements: [
			{ kind: "count", target: "messages", comparator: "minimum", value: 4 },
			{ kind: "label", target: "participant", value: "Service" },
		],
	},
} as const satisfies Record<DiagramTypeValue, { diagram: object; requirements: readonly object[] }>;

function expectedJsonShape(prompt: DiagramGenerationPrompt): string {
	const selectedType = prompt.requestedType;
	if (!selectedType) {
		const supportedExample = {
			title: "Release approval",
			intent: {
				requestedKind: "flowchart",
				nativeKind: "flowchart",
				requirements: [
					{
						kind: "count",
						target: "nodes",
						comparator: "minimum",
						value: 4,
					},
					{ kind: "label", target: "branch", value: "revise" },
				],
			},
			diagram: {
				id: "release-approval",
				type: "flowchart",
				nodes: [
					{ id: "start", label: "Start", kind: "start" },
					{ id: "draft", label: "Prepare release", kind: "process" },
					{ id: "review", label: "Approved?", kind: "decision" },
					{ id: "end", label: "Release approved", kind: "end" },
				],
				edges: [
					{ id: "begin", source: "start", target: "draft" },
					{ id: "submit", source: "draft", target: "review" },
					{
						id: "approve",
						source: "review",
						target: "end",
						label: "approve",
					},
					{
						id: "revise",
						source: "review",
						target: "draft",
						label: "revise",
					},
				],
				layout: { direction: "TB", edgeRouting: "orthogonal" },
			},
		};
		const unsupportedExample = {
			title: "Customer order relationships",
			intent: {
				requestedKind: "er",
				nativeKind: null,
				requirements: [],
			},
		};
		return [
			`Supported response example: ${JSON.stringify(supportedExample)}`,
			`Unsupported response example: ${JSON.stringify(unsupportedExample)}`,
		].join("\n");
	}
	const { diagram, requirements } = FAMILY_EXAMPLES[selectedType];
	return JSON.stringify({
		title: "Concise model-authored title",
		intent: {
			requestedKind: selectedType,
			nativeKind: selectedType,
			requirements,
		},
		diagram,
	});
}

/** Families that draw catalog logos, and which element carries them. */
const LOGO_TARGETS = {
	flowchart: { element: "flowchart node", owner: "node" },
	sequence: { element: "sequence participant", owner: "participant" },
} as const;

function logoSection(prompt: DiagramGenerationPrompt): string[] {
	const logos = prompt.logos ?? [];
	const targets =
		prompt.requestedType === undefined
			? Object.values(LOGO_TARGETS)
			: prompt.requestedType === "flowchart" || prompt.requestedType === "sequence"
				? [LOGO_TARGETS[prompt.requestedType]]
				: [];
	if (logos.length === 0 || targets.length === 0) {
		return [];
	}
	const element = targets.map((target) => target.element).join(" or ");
	const owner = targets.map((target) => target.owner).join(" or ");
	return [
		"",
		"Available logos:",
		...logos.map(
			(logo) =>
				`- ${logo.slug}: ${logo.name}${logo.aliases?.length ? ` (also ${logo.aliases.join(", ")})` : ""}`,
		),
		`A ${element} about one of these technologies may set "icon": { "slug": "<slug>" } using a slug from this list exactly. Put each logo on the ${owner} whose label names that technology. Omit icon on every other ${owner}. Never invent a slug.`,
	];
}

export function buildDiagramGenerationMessages(
	prompt: DiagramGenerationPrompt,
): DiagramGenerationMessages {
	const explicitType = prompt.requestedType;
	const system = [
		"You are creating one typed Sketchi generation response.",
		"",
		"Response contract:",
		...COMMON_INSTRUCTIONS.map((instruction) => `- ${instruction}`),
		...DIAGRAM_TYPES.flatMap((type) => [
			"",
			`${IR_INSTRUCTIONS[type].title}:`,
			...IR_INSTRUCTIONS[type].rules.map((instruction) => `- ${instruction}`),
		]),
	].join("\n");
	const typeAuthority = explicitType
		? `The caller explicitly requires ${explicitType}. Set both intent.requestedKind and intent.nativeKind to ${explicitType}, and return that diagram type.`
		: "The caller omitted type. Select the scenario's requested kind; generate it only when it is natively supported.";
	const user = [
		"Scenario:",
		prompt.request,
		"",
		"Type authority:",
		typeAuthority,
		"",
		"Expected JSON shape (adapt the intent plan and diagram to the scenario):",
		expectedJsonShape(prompt),
		...logoSection(prompt),
	].join("\n");

	return { system, user };
}
