import {
	type DiagramNodeShape,
	type DiagramZoneKind,
	type FlowchartDiagram,
	type FlowchartNodeKind,
	SKETCHI_DIAGRAM_STYLE,
	parseFlowchartDiagram,
} from "@sketchi/diagram-core";

import { flowchartLabelWords } from "./flowchart-labels.js";

export interface FlowchartScenarioAssertions {
	minEdgeCount: number;
	minNodeCount: number;
	/** Logos the expected diagram draws; generated diagrams must include them. */
	requiredIconSlugs: string[];
	requiredBranchLabels: string[];
	requiredEdges: FlowchartScenarioRequiredEdge[];
	requiredNodeKinds: FlowchartNodeKind[];
	requiredNodes: FlowchartScenarioRequiredNode[];
	/** Fixture wording for diagnostic IDs and fixture intent, not label matching. */
	requiredNodeLabels: string[];
	/** Groups the prompt states, each with the steps it holds. */
	requiredGroups: FlowchartScenarioRequiredGroup[];
	/** Steps the prompt keeps outside every group. */
	ungroupedSteps: string[];
	/** Lanes the prompt states, in its order, each with the steps it holds. */
	requiredLanes: FlowchartScenarioRequiredLane[];
}

export interface FlowchartScenarioRequiredLane {
	id: string;
	label: string;
	/** Prompt-grounded alternatives for the lane's label. */
	labels: readonly string[];
	/** Required step ids the lane holds. */
	members: readonly string[];
}

export interface FlowchartScenarioRequiredGroup {
	id: string;
	label: string;
	/** Prompt-grounded alternatives for the group's label. */
	labels: readonly string[];
	/** Required step ids the group holds, directly or in a group nested in it. */
	members: readonly string[];
	/** The stated group this zone sits inside, at any depth. */
	parent?: string;
	/** The kinds that read as what the prompt calls this zone. */
	kinds?: readonly DiagramZoneKind[];
}

export interface FlowchartScenarioRequiredNode {
	id: string;
	kind: FlowchartNodeKind;
	label: string;
	labels: readonly string[];
	/** Prompt-grounded alternatives for a yes/no decision asked by its opposite condition. */
	inverseLabels?: readonly string[];
	/** The infrastructure shape the prompt makes this step: a database, queue or document. */
	shape?: DiagramNodeShape;
	/** Every shape that reads as what the prompt calls this step, `shape` first. */
	shapes?: readonly DiagramNodeShape[];
}

export interface FlowchartScenarioRequiredEdge {
	label?: string;
	labels?: readonly string[];
	sourceId: string;
	sourceLabel: string;
	targetId: string;
	targetLabel: string;
}

export type DiagramScenarioDifficulty = "smoke" | "standard" | "challenge";

/**
 * A catalog logo the scenario prompt names, exactly as `/api/v1/generate`
 * offers it (see logosNamedInText), aliases included.
 */
export interface DiagramScenarioLogo {
	readonly aliases?: readonly string[];
	readonly collection?: string;
	readonly name: string;
	readonly slug: string;
}

export interface FlowchartScenario {
	assertions: FlowchartScenarioAssertions;
	description: string;
	diagramType: "flowchart";
	difficulty: DiagramScenarioDifficulty;
	expectedDiagram: FlowchartDiagram;
	id: string;
	/** Logos offered to generation; generated icons must stay within them. */
	logos: DiagramScenarioLogo[];
	prompt: string;
	tags: string[];
	title: string;
}

type FlowchartNodeDefinition = readonly [
	id: string,
	label: string,
	kind: FlowchartNodeKind,
	labels: readonly [string, ...string[]],
	icon?: string,
];

/** A zone's place in the prompt's architecture: the stated group around it and what it is. */
interface FlowchartZoneDefinition {
	readonly parent?: string;
	/** Kinds that read as what the prompt calls the zone; the first is the fixture's. */
	readonly kinds?: readonly [DiagramZoneKind, ...DiagramZoneKind[]];
}

/** A group, its direct members (none for a zone that holds only zones), and its zone. */
type FlowchartGroupDefinition = readonly [
	id: string,
	label: string,
	labels: readonly [string, ...string[]],
	members: readonly string[],
	zone?: FlowchartZoneDefinition,
];

type FlowchartLaneDefinition = readonly [
	id: string,
	label: string,
	labels: readonly [string, ...string[]],
	members: readonly [string, ...string[]],
];

type FlowchartEdgeDefinition = readonly [
	id: string,
	source: string,
	target: string,
	label?: string,
	labels?: readonly [string, ...string[]],
];

interface FlowchartScenarioDefinition {
	description: string;
	diagramId?: string;
	difficulty: DiagramScenarioDifficulty;
	/** The prompt's stated reading direction; top to bottom by default. */
	direction?: "LR" | "TB";
	edges: readonly FlowchartEdgeDefinition[];
	/**
	 * Fixture nodes that continue the start step's entry chain, in order. They
	 * draw the stated first event across nodes and are not separate steps.
	 */
	entry?: readonly string[];
	/** Groups the prompt states and the fixture nodes each holds. */
	groups?: readonly FlowchartGroupDefinition[];
	/** Lanes the prompt states, in its order, and the fixture nodes each holds. */
	lanes?: readonly FlowchartLaneDefinition[];
	id: string;
	/**
	 * Yes/no decisions the prompt states only through their branches, opposite
	 * condition first (`If the receipt is missing` for `Receipt attached?`). A
	 * model may ask that opposite question; its yes answers the decision's no.
	 */
	inverse?: Readonly<Record<string, readonly [string, ...string[]]>>;
	logos?: readonly DiagramScenarioLogo[];
	nodes: readonly FlowchartNodeDefinition[];
	/**
	 * The infrastructure shape the prompt makes each such fixture node, or the
	 * shapes that each read as what it calls the node, the fixture's first.
	 */
	shapes?: Readonly<
		Record<string, DiagramNodeShape | readonly [DiagramNodeShape, ...DiagramNodeShape[]]>
	>;
	prompt: string;
	tags: readonly string[];
	title: string;
	/** Fixture nodes the prompt keeps outside every group. */
	ungrouped?: readonly string[];
}

const DEFAULT_STYLE = SKETCHI_DIAGRAM_STYLE;
const FLOWCHART_NODE_KIND_ORDER: readonly FlowchartNodeKind[] = [
	"start",
	"process",
	"decision",
	"end",
];

/** The shapes that read as what the prompt calls a fixture node, the fixture's first. */
function shapesOf(
	definition: FlowchartScenarioDefinition,
	id: string,
): readonly [DiagramNodeShape, ...DiagramNodeShape[]] | undefined {
	const shapes = definition.shapes?.[id];
	return shapes === undefined ? undefined : typeof shapes === "string" ? [shapes] : shapes;
}

function unique(values: readonly string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];

	for (const value of values) {
		const normalized = value.trim().toLowerCase();

		if (!seen.has(normalized)) {
			seen.add(normalized);
			result.push(value);
		}
	}

	return result;
}

function buildExpectedDiagram(definition: FlowchartScenarioDefinition): FlowchartDiagram {
	const groupOf = new Map(
		(definition.groups ?? []).flatMap(([group, , , members]) =>
			members.map((member) => [member, group] as const),
		),
	);
	const laneOf = new Map(
		(definition.lanes ?? []).flatMap(([lane, , , members]) =>
			members.map((member) => [member, lane] as const),
		),
	);
	return parseFlowchartDiagram({
		id: definition.diagramId ?? definition.id,
		title: definition.title,
		type: "flowchart",
		...(definition.groups
			? {
					groups: definition.groups.map(([id, label, , , zone]) => ({
						id,
						label,
						...(zone?.parent ? { parent: zone.parent } : {}),
						...(zone?.kinds ? { kind: zone.kinds[0] } : {}),
					})),
				}
			: {}),
		...(definition.lanes ? { lanes: definition.lanes.map(([id, label]) => ({ id, label })) } : {}),
		nodes: definition.nodes.map(([id, label, kind, _labels, icon]) => ({
			id,
			label,
			kind,
			...(icon ? { icon: { slug: icon } } : {}),
			...(groupOf.has(id) ? { group: groupOf.get(id) } : {}),
			...(laneOf.has(id) ? { lane: laneOf.get(id) } : {}),
			...(shapesOf(definition, id) ? { shape: shapesOf(definition, id)![0] } : {}),
		})),
		edges: definition.edges.map(([id, source, target, label]) => ({
			id,
			source,
			target,
			...(label ? { label } : {}),
		})),
		layout: {
			direction: definition.direction ?? "TB",
			edgeRouting: "orthogonal",
		},
		style: DEFAULT_STYLE,
	});
}

function buildAssertions(
	definition: FlowchartScenarioDefinition,
	diagram: FlowchartDiagram,
): FlowchartScenarioAssertions {
	const nodeKinds = new Set(diagram.nodes.map((node) => node.kind));
	const requiredNodeKinds = FLOWCHART_NODE_KIND_ORDER.filter((kind) => nodeKinds.has(kind));
	const nodesById = new Map(diagram.nodes.map((node) => [node.id, node]));
	const promptWords = new Set(flowchartLabelWords(definition.prompt));
	// An entry chain is one start step; edges leaving it leave from that step.
	const entry = new Set(definition.entry ?? []);
	const startId = diagram.nodes.find((node) => node.kind === "start")!.id;
	const entryLabel = [startId, ...entry].map((id) => nodesById.get(id)!.label).join(" → ");
	const stepOf = (id: string) => (entry.has(id) ? startId : id);
	const requiredNodes = definition.nodes.flatMap(([id, label, kind, labels]) => {
		const inverseLabels = definition.inverse?.[id];
		if (
			inverseLabels &&
			(kind !== "decision" ||
				definition.edges.some(
					([, source, , branch]) => source === id && branch !== "yes" && branch !== "no",
				))
		) {
			throw new Error(
				`Scenario "${definition.id}" inverts "${id}", which is not a yes/no decision.`,
			);
		}
		for (const alternative of [...labels, ...(inverseLabels ?? [])]) {
			const words = flowchartLabelWords(alternative);
			if (words.length === 0 || words.some((word) => !promptWords.has(word))) {
				throw new Error(
					`Scenario "${definition.id}" node "${id}" has an ungrounded alternative "${alternative}".`,
				);
			}
		}
		if (entry.has(id)) return [];
		const shaped = shapesOf(definition, id);
		return [
			{
				id,
				label: id === startId && entry.size > 0 ? entryLabel : label,
				kind,
				labels,
				...(inverseLabels ? { inverseLabels } : {}),
				...(shaped ? { shape: shaped[0], shapes: shaped } : {}),
			},
		];
	});
	// A zone holds its own members and every member of the zones nested in it.
	const groups = definition.groups ?? [];
	const heldBy = (groupId: string): string[] => [
		...(groups.find(([id]) => id === groupId)?.[3] ?? []),
		...groups.flatMap(([id, , , , zone]) => (zone?.parent === groupId ? heldBy(id) : [])),
	];

	return {
		minEdgeCount: diagram.edges.length - entry.size,
		minNodeCount: diagram.nodes.length - entry.size,
		requiredIconSlugs: unique(diagram.nodes.flatMap((node) => (node.icon ? [node.icon.slug] : []))),
		requiredBranchLabels: unique(
			diagram.edges.map((edge) => edge.label).filter((label): label is string => Boolean(label)),
		),
		requiredEdges: definition.edges.flatMap(([id, from, to, label, labels]) => {
			if (!nodesById.has(from) || !nodesById.has(to)) {
				throw new Error(`Scenario "${diagram.id}" has unresolved assertion edge "${id}".`);
			}
			const sourceId = stepOf(from);
			const targetId = stepOf(to);
			if (sourceId === targetId) return [];
			const source = requiredNodes.find((node) => node.id === sourceId)!;
			const target = requiredNodes.find((node) => node.id === targetId)!;

			// Contextual outcomes are explicit per connection, never global yes/no synonyms.
			for (const alternative of labels ?? []) {
				if (alternative === label) continue;
				const words = flowchartLabelWords(alternative);
				if (words.length === 0 || words.some((word) => !promptWords.has(word))) {
					throw new Error(
						`Scenario "${definition.id}" edge "${id}" has an ungrounded alternative "${alternative}".`,
					);
				}
			}

			return [
				{
					sourceId,
					sourceLabel: source.label,
					targetId,
					targetLabel: target.label,
					...(label ? { label, labels: labels ?? [label] } : {}),
				},
			];
		}),
		requiredNodeKinds,
		requiredNodes,
		requiredNodeLabels: diagram.nodes.map((node) => node.label),
		requiredGroups: groups.map(([id, label, labels, , zone]) => {
			for (const alternative of labels) {
				const words = flowchartLabelWords(alternative);
				if (words.length === 0 || words.some((word) => !promptWords.has(word))) {
					throw new Error(
						`Scenario "${definition.id}" group "${id}" has an ungrounded alternative "${alternative}".`,
					);
				}
			}
			const members = [...new Set(heldBy(id).map(stepOf))];
			if (members.length === 0)
				throw new Error(`Scenario "${definition.id}" group "${id}" holds no step.`);
			return {
				id,
				label,
				labels,
				members,
				...(zone?.parent ? { parent: zone.parent } : {}),
				...(zone?.kinds ? { kinds: zone.kinds } : {}),
			};
		}),
		ungroupedSteps: [...new Set((definition.ungrouped ?? []).map(stepOf))],
		requiredLanes: (definition.lanes ?? []).map(([id, label, labels, members]) => {
			for (const alternative of labels) {
				const words = flowchartLabelWords(alternative);
				if (words.length === 0 || words.some((word) => !promptWords.has(word))) {
					throw new Error(
						`Scenario "${definition.id}" lane "${id}" has an ungrounded alternative "${alternative}".`,
					);
				}
			}
			return { id, label, labels, members: [...new Set(members.map(stepOf))] };
		}),
	};
}

function defineFlowchartScenario(definition: FlowchartScenarioDefinition): FlowchartScenario {
	const expectedDiagram = buildExpectedDiagram(definition);
	const logos = [...(definition.logos ?? [])];
	const offered = new Set(logos.map((logo) => logo.slug));
	for (const node of expectedDiagram.nodes) {
		if (node.icon && !offered.has(node.icon.slug)) {
			throw new Error(
				`Scenario "${definition.id}" draws logo "${node.icon.slug}" that its prompt does not name.`,
			);
		}
	}

	return {
		assertions: buildAssertions(definition, expectedDiagram),
		description: definition.description,
		diagramType: "flowchart",
		difficulty: definition.difficulty,
		expectedDiagram,
		id: definition.id,
		logos,
		prompt: definition.prompt,
		tags: [...definition.tags],
		title: definition.title,
	};
}

const flowchartScenarioDefinitions = [
	{
		id: "sketchi-onboarding-decision-flow",
		diagramId: "onboarding-flow",
		title: "Sketchi onboarding decision flow",
		difficulty: "smoke",
		tags: ["baseline", "decision", "two-branch"],
		description:
			"A compact decision flow that exercises start/process/decision/end semantics and yes/no branch labels.",
		prompt:
			"Create a flowchart for a Sketchi diagram request. The flow starts when a prompt is received, extracts requirements, asks whether the scope is clear, drafts typed IR when clear, and otherwise moves to review. End at review.",
		nodes: [
			["prompt", "Prompt received", "start", ["prompt received", "prompt is received"]],
			["requirements", "Extract requirements", "process", ["extracts requirements"]],
			["clear", "Scope clear?", "decision", ["scope clear", "scope is clear"]],
			["draft", "Draft typed IR", "process", ["drafts typed IR"]],
			["review", "Review diagram", "end", ["review", "otherwise moves to review"]],
		],
		edges: [
			["prompt-requirements", "prompt", "requirements"],
			["requirements-clear", "requirements", "clear"],
			["clear-draft", "clear", "draft", "yes"],
			["clear-review", "clear", "review", "no"],
			["draft-review", "draft", "review"],
		],
	},
	{
		id: "pharma-batch-disposition",
		title: "Pharma batch disposition",
		difficulty: "challenge",
		tags: ["regulated", "multi-branch", "loop"],
		description:
			"A decision-heavy regulated workflow with multi-way branches and a loop back into final review.",
		prompt:
			"Create a flowchart for pharma batch disposition. A batch is received, QA reviews the Certificate of Analysis, and then decides whether it passes specs. Passing goes to QA Manager final review and packaging. Retest goes through investigation and returns to final review. Reject ends at reject batch.",
		nodes: [
			["batch-received", "Batch received", "start", ["batch received", "batch is received"]],
			[
				"qa-review",
				"QA reviews Certificate of Analysis",
				"process",
				["QA reviews", "reviews Certificate of Analysis"],
			],
			["passes-specs", "Passes specs?", "decision", ["passes specs"]],
			["final-review", "QA Manager final review", "process", ["final review"]],
			["packaging", "Send to packaging", "end", ["packaging"]],
			["investigate", "Investigate retesting", "process", ["investigation"]],
			["reject", "Reject batch", "end", ["reject batch", "reject ends at reject batch"]],
		],
		edges: [
			["batch-qa", "batch-received", "qa-review"],
			["qa-specs", "qa-review", "passes-specs"],
			["specs-pass", "passes-specs", "final-review", "yes", ["yes", "passing"]],
			["specs-investigate", "passes-specs", "investigate", "retest"],
			["specs-reject", "passes-specs", "reject", "reject"],
			["review-packaging", "final-review", "packaging"],
			["investigate-review", "investigate", "final-review"],
		],
	},
	{
		id: "repo-package-interaction-flow",
		title: "Repo package interaction flow",
		difficulty: "standard",
		tags: ["repo", "packages", "harness", "code-mode", "vague-prompt"],
		description:
			"A vague package-interaction request recast as a directed flowchart so harnesses keep the six stated stages in order instead of inventing a Mermaid dependency report.",
		prompt:
			"Create a diagram that showcases how the various packages in this repo interact. Show the high-level path from an app request through the agent, core diagram model, renderer, Excalidraw export, and hosted artifact response.",
		// The six stages the prompt states, in its order. The prompt names no
		// packages, so package names or an artifact store are not required.
		nodes: [
			["app-request", "App request", "start", ["app request", "request"]],
			["agent", "Agent", "process", ["agent"]],
			["core", "Core diagram model", "process", ["core diagram model"]],
			["renderer", "Renderer", "process", ["renderer"]],
			["excalidraw-export", "Excalidraw export", "process", ["Excalidraw export"]],
			["artifact-response", "Hosted artifact response", "end", ["hosted artifact response"]],
		],
		edges: [
			["request-agent", "app-request", "agent"],
			["agent-core", "agent", "core"],
			["core-renderer", "core", "renderer"],
			["renderer-export", "renderer", "excalidraw-export"],
			["export-response", "excalidraw-export", "artifact-response"],
		],
	},
	{
		id: "support-ticket-triage",
		title: "Support ticket triage",
		difficulty: "standard",
		tags: ["support", "escalation", "nested-decision"],
		description:
			"Routes incoming support tickets through outage detection, known-fix handling, and engineering escalation.",
		prompt:
			"Create a support ticket triage flowchart. A ticket is received, the team classifies it, decides if it is a production outage, and pages on-call for outages. Paged outages end when the outage is resolved. Non-outages check whether a known fix exists. Known fixes are sent to the customer and end as customer resolved. Unknown fixes escalate to engineering and end as engineering resolved.",
		nodes: [
			["ticket-received", "Ticket received", "start", ["ticket received", "ticket is received"]],
			["classify-ticket", "Classify ticket", "process", ["classifies"]],
			["production-outage", "Production outage?", "decision", ["production outage"]],
			["page-on-call", "Page on-call", "process", ["pages on-call"]],
			[
				"known-fix",
				"Known fix exists?",
				"decision",
				["known fix exists", "non-outages check whether a known fix exists"],
			],
			["send-fix", "Send fix to customer", "process", ["sent"]],
			["outage-resolved", "Outage resolved", "end", ["outage resolved", "outage is resolved"]],
			[
				"escalate-engineering",
				"Escalate to engineering",
				"process",
				[
					"escalate to engineering",
					"unknown fixes escalate to engineering and end as engineering resolved",
				],
			],
			["customer-resolved", "Customer resolved", "end", ["customer resolved"]],
			[
				"engineering-resolved",
				"Engineering resolved",
				"end",
				[
					"engineering resolved",
					"unknown fixes escalate to engineering and end as engineering resolved",
				],
			],
		],
		edges: [
			["ticket-classify", "ticket-received", "classify-ticket"],
			["classify-outage", "classify-ticket", "production-outage"],
			["outage-page", "production-outage", "page-on-call", "yes"],
			["outage-known-fix", "production-outage", "known-fix", "no"],
			["page-resolved", "page-on-call", "outage-resolved"],
			["known-send", "known-fix", "send-fix", "yes", ["yes", "known"]],
			["known-escalate", "known-fix", "escalate-engineering", "no", ["no", "unknown"]],
			["send-resolved", "send-fix", "customer-resolved"],
			["escalate-resolved", "escalate-engineering", "engineering-resolved"],
		],
	},
	{
		id: "ecommerce-return-authorization",
		title: "Ecommerce return authorization",
		difficulty: "standard",
		tags: ["commerce", "authorization", "inspection"],
		description:
			"Exercises eligibility checks, item inspection, and separate refund/rejection endings.",
		prompt:
			"Create a return authorization flowchart for an ecommerce order. A return request starts the flow, the system verifies the return window, and decides if the return is eligible. Eligible returns get a return label and item inspection. Inspection decides whether the item condition is acceptable. Acceptable items are refunded. Ineligible or unacceptable returns end as rejected returns.",
		nodes: [
			["return-request", "Return request received", "start", ["return request"]],
			[
				"verify-window",
				"Verify return window",
				"process",
				["verifies the return window", "verifies return window"],
			],
			["eligible", "Return eligible?", "decision", ["eligible"]],
			["issue-label", "Issue return label", "process", ["return label"]],
			["inspect-item", "Inspect returned item", "process", ["inspection"]],
			[
				"condition-ok",
				"Condition acceptable?",
				"decision",
				["condition acceptable", "condition is acceptable"],
			],
			["refund", "Refund customer", "end", ["refunded"]],
			[
				"reject-return",
				"Reject return",
				"end",
				["rejected returns", "ineligible or unacceptable returns end as rejected returns"],
			],
		],
		edges: [
			["request-window", "return-request", "verify-window"],
			["window-eligible", "verify-window", "eligible"],
			["eligible-label", "eligible", "issue-label", "yes", ["yes", "eligible"]],
			["eligible-reject", "eligible", "reject-return", "no", ["no", "ineligible"]],
			["label-inspect", "issue-label", "inspect-item"],
			["inspect-condition", "inspect-item", "condition-ok"],
			["condition-refund", "condition-ok", "refund", "yes", ["yes", "acceptable"]],
			["condition-reject", "condition-ok", "reject-return", "no", ["no", "unacceptable"]],
		],
	},
	{
		id: "incident-escalation",
		title: "Incident escalation",
		difficulty: "challenge",
		tags: ["incident", "severity", "escalation"],
		description:
			"A severity routing flow with direct resolution, triage, and incident bridge paths.",
		prompt:
			"Create an incident escalation flowchart. Monitoring creates an alert and the responder acknowledges it. A severity decision sends high severity incidents to an incident bridge, medium severity incidents to a triage queue, and low severity incidents to monitoring. The bridge mitigates impact, sends customer communications, and resolves the incident. Triage checks whether there is a fix. If yes, resolve the incident. If no, escalate to the incident bridge. Monitoring low severity incidents ends as resolved.",
		nodes: [
			[
				"alert-created",
				"Alert created",
				"start",
				["creates an alert", "creates alert", "alert created"],
			],
			["acknowledge", "Responder acknowledges", "process", ["acknowledges"]],
			["severity", "Severity?", "decision", ["severity"]],
			[
				"incident-bridge",
				"Open incident bridge",
				"process",
				["incident bridge", "if no, escalate to the incident bridge"],
			],
			["mitigate", "Mitigate impact", "process", ["mitigates impact"]],
			["customer-comms", "Send customer comms", "process", ["sends customer communications"]],
			["triage-queue", "Triage queue", "process", ["triage queue"]],
			["fix-found", "Fix available?", "decision", ["fix"]],
			["monitor", "Monitor low severity", "process", ["monitoring low severity"]],
			["resolved", "Incident resolved", "end", ["resolved", "resolve"]],
		],
		edges: [
			["alert-ack", "alert-created", "acknowledge"],
			["ack-severity", "acknowledge", "severity"],
			["severity-high", "severity", "incident-bridge", "high"],
			["severity-medium", "severity", "triage-queue", "medium"],
			["severity-low", "severity", "monitor", "low"],
			["bridge-mitigate", "incident-bridge", "mitigate"],
			["mitigate-comms", "mitigate", "customer-comms"],
			["comms-resolved", "customer-comms", "resolved"],
			["triage-fix", "triage-queue", "fix-found"],
			["fix-resolved", "fix-found", "resolved", "yes"],
			["fix-bridge", "fix-found", "incident-bridge", "no"],
			["monitor-resolved", "monitor", "resolved"],
		],
	},
	{
		id: "incident-response-code-mode-proof",
		title: "Incident response Code Mode proof",
		difficulty: "challenge",
		tags: ["incident", "code-mode", "dense-routing", "fan-in", "loop"],
		description:
			"Recovered from the Claude Code Mode browser-run proof: a dense incident flow with multi-way decisions, fan-out, fan-in into stability checks, and an escalation loop.",
		prompt:
			"Create an incident response escalation flow. An alert is received, triaged, and checked for whether it is a real incident. False alarms close. Real incidents are declared, stakeholders are notified, logs and deploy evidence are collected, then root cause is classified as deploy, code, or provider. Deploy issues roll back, code issues prepare a hotfix, and provider issues escalate to the provider. Rollback and hotfix paths both check whether the service is stable. Stable service goes to monitoring and then resolved. Unstable service escalates and loops back to collect fresh evidence.",
		nodes: [
			["alert", "Alert received", "start", ["alert received", "alert is received"]],
			["triage", "Triage signal", "process", ["triaged"]],
			["confirmed", "Real incident?", "decision", ["real incident"]],
			["false-alarm", "Close as false alarm", "end", ["close", "false alarms close"]],
			["declare", "Declare incident", "process", ["declared"]],
			["notify", "Notify stakeholders", "process", ["notified"]],
			[
				"collect-evidence",
				"Collect logs and deploy evidence",
				"process",
				[
					"collect logs",
					"collect evidence",
					"collect fresh evidence",
					"logs and deploy evidence collected",
				],
			],
			["root-cause", "Root cause known?", "decision", ["root cause"]],
			["rollback", "Rollback release", "process", ["roll back"]],
			["hotfix", "Prepare hotfix", "process", ["prepare hotfix", "prepare a hotfix"]],
			[
				"vendor-escalation",
				"Escalate to provider",
				"end",
				["escalate to provider", "escalate to the provider"],
			],
			["stable", "Service stable?", "decision", ["service stable", "service is stable"]],
			["monitor", "Monitor recovery", "process", ["monitoring"]],
			["resolved-success", "Resolved", "end", ["resolved"]],
			[
				"escalate-failure",
				"Escalate",
				"process",
				["escalates", "unstable service escalates and loops back to collect fresh evidence"],
			],
		],
		edges: [
			["alert-triage", "alert", "triage"],
			["triage-confirmed", "triage", "confirmed"],
			["confirmed-false-alarm", "confirmed", "false-alarm", "no", ["no", "false alarms"]],
			["confirmed-declare", "confirmed", "declare", "yes", ["yes", "real"]],
			["declare-notify", "declare", "notify"],
			["notify-evidence", "notify", "collect-evidence"],
			["evidence-root-cause", "collect-evidence", "root-cause"],
			["root-cause-rollback", "root-cause", "rollback", "deploy"],
			["root-cause-hotfix", "root-cause", "hotfix", "code"],
			["root-cause-vendor", "root-cause", "vendor-escalation", "provider"],
			["rollback-stable", "rollback", "stable"],
			["hotfix-stable", "hotfix", "stable"],
			["stable-monitor", "stable", "monitor", "yes", ["yes", "stable"]],
			["stable-escalate", "stable", "escalate-failure", "no", ["no", "unstable"]],
			["monitor-resolved", "monitor", "resolved-success"],
			["escalate-recollect", "escalate-failure", "collect-evidence"],
		],
	},
	{
		id: "invoice-approval",
		title: "Invoice approval",
		difficulty: "challenge",
		tags: ["finance", "approval", "exception"],
		description:
			"A finance approval process with PO matching, exception resolution, and threshold approval.",
		prompt:
			"Create an invoice approval flowchart. An invoice is received and matched to a purchase order. If it does not match, route it to exception review and decide whether the exception is resolved. Unresolved exceptions reject the invoice. Resolved or matched invoices decide whether the amount is over the approval threshold. Amounts over threshold require director approval before payment. Amounts under threshold schedule payment directly.",
		inverse: {
			"po-matches": ["does not match"],
		},
		nodes: [
			[
				"invoice-received",
				"Invoice received",
				"start",
				["invoice received", "invoice is received"],
			],
			[
				"match-po",
				"Match purchase order",
				"process",
				["match purchase order", "matched to a purchase order"],
			],
			["po-matches", "PO matches?", "decision", ["match"]],
			[
				"exception-review",
				"Exception review",
				"process",
				["exception review", "if it does not match, route it to exception review"],
			],
			[
				"exception-resolved",
				"Exception resolved?",
				"decision",
				["exception resolved", "exception is resolved"],
			],
			[
				"threshold",
				"Amount over threshold?",
				"decision",
				["over threshold", "over the approval threshold"],
			],
			["director-approval", "Director approval", "process", ["director approval"]],
			["schedule-payment", "Schedule payment", "end", ["schedule payment", "payment scheduled"]],
			[
				"reject-invoice",
				"Reject invoice",
				"end",
				["reject invoice", "reject the invoice", "unresolved exceptions reject the invoice"],
			],
		],
		edges: [
			["invoice-match", "invoice-received", "match-po"],
			["match-decision", "match-po", "po-matches"],
			["po-threshold", "po-matches", "threshold", "yes", ["yes", "matched"]],
			[
				"po-exception",
				"po-matches",
				"exception-review",
				"no",
				["no", "does not match", "not matched"],
			],
			["exception-decision", "exception-review", "exception-resolved"],
			["exception-threshold", "exception-resolved", "threshold", "yes", ["yes", "resolved"]],
			["exception-reject", "exception-resolved", "reject-invoice", "no", ["no", "unresolved"]],
			["threshold-director", "threshold", "director-approval", "yes", ["yes", "over threshold"]],
			["threshold-payment", "threshold", "schedule-payment", "no", ["no", "under threshold"]],
			["director-payment", "director-approval", "schedule-payment"],
		],
	},
	{
		id: "feature-flag-rollout",
		title: "Feature flag rollout",
		difficulty: "standard",
		tags: ["release", "progressive-delivery", "rollback"],
		description: "A progressive delivery flow with internal, beta, ramp, and rollback branches.",
		prompt:
			"Create a feature flag rollout flowchart. A flag is ready, then enabled internally. If internal checks are healthy, enable the beta cohort. If internal checks fail, roll back the feature. Beta also checks health. Healthy beta results ramp to all users and completes rollout. Unhealthy beta rolls back the feature.",
		nodes: [
			["flag-ready", "Flag ready", "start", ["flag ready", "flag is ready"]],
			["enable-internal", "Enable internal users", "process", ["enabled internally"]],
			[
				"internal-healthy",
				"Internal healthy?",
				"decision",
				["internal healthy", "internal checks healthy", "internal checks are healthy"],
			],
			[
				"enable-beta",
				"Enable beta cohort",
				"process",
				["enable beta cohort", "enable the beta cohort"],
			],
			[
				"beta-healthy",
				"Beta healthy?",
				"decision",
				["beta healthy", "healthy beta", "beta checks health"],
			],
			["ramp-all", "Ramp to all users", "process", ["ramp to all users"]],
			["complete", "Rollout complete", "end", ["completes rollout", "rollout complete"]],
			[
				"rollback",
				"Rollback feature",
				"end",
				[
					"roll back",
					"if internal checks fail, roll back the feature",
					"unhealthy beta rolls back the feature",
				],
			],
		],
		edges: [
			["ready-internal", "flag-ready", "enable-internal"],
			["internal-check", "enable-internal", "internal-healthy"],
			["internal-beta", "internal-healthy", "enable-beta", "yes", ["yes", "healthy"]],
			["internal-rollback", "internal-healthy", "rollback", "no", ["no", "fail"]],
			["beta-check", "enable-beta", "beta-healthy"],
			["beta-ramp", "beta-healthy", "ramp-all", "yes", ["yes", "healthy"]],
			["beta-rollback", "beta-healthy", "rollback", "no", ["no", "unhealthy"]],
			["ramp-complete", "ramp-all", "complete"],
		],
	},
	{
		id: "patient-intake-scheduling",
		title: "Patient intake scheduling",
		difficulty: "standard",
		tags: ["healthcare", "triage", "scheduling"],
		description:
			"A scheduling flow that separates urgent symptoms, insurance checks, and billing referral.",
		prompt:
			"Create a patient intake scheduling flowchart. A patient requests an appointment, the clinic collects intake information, and asks whether there are urgent symptoms. Urgent symptoms go to nurse triage and then a same-day appointment. Non-urgent requests check whether insurance is valid. Valid insurance schedules a routine appointment. Invalid insurance asks if the patient accepts self-pay. Self-pay schedules routine care; otherwise refer to billing.",
		nodes: [
			[
				"patient-request",
				"Patient requests appointment",
				"start",
				["requests appointment", "requests an appointment"],
			],
			["collect-info", "Collect intake information", "process", ["collects intake information"]],
			["urgent", "Urgent symptoms?", "decision", ["urgent symptoms"]],
			["nurse-triage", "Nurse triage", "process", ["nurse triage"]],
			["same-day", "Same-day appointment", "end", ["same-day appointment"]],
			[
				"insurance-valid",
				"Insurance valid?",
				"decision",
				[
					"insurance valid",
					"insurance is valid",
					"non-urgent requests check whether insurance is valid",
				],
			],
			[
				"self-pay",
				"Accepts self-pay?",
				"decision",
				["accepts self-pay", "invalid insurance asks if the patient accepts self-pay"],
			],
			[
				"routine",
				"Schedule routine appointment",
				"end",
				[
					"schedule routine appointment",
					"schedules routine care",
					"schedules a routine appointment",
				],
			],
			["billing", "Refer to billing", "end", ["refer to billing", "otherwise refer to billing"]],
		],
		edges: [
			["request-info", "patient-request", "collect-info"],
			["info-urgent", "collect-info", "urgent"],
			["urgent-triage", "urgent", "nurse-triage", "yes"],
			["urgent-insurance", "urgent", "insurance-valid", "no"],
			["triage-same-day", "nurse-triage", "same-day"],
			["insurance-routine", "insurance-valid", "routine", "yes", ["yes", "valid"]],
			["insurance-self-pay", "insurance-valid", "self-pay", "no", ["no", "invalid"]],
			["self-pay-routine", "self-pay", "routine", "yes"],
			["self-pay-billing", "self-pay", "billing", "no"],
		],
	},
	{
		id: "content-moderation",
		title: "Content moderation",
		difficulty: "challenge",
		tags: ["trust-safety", "moderation", "multi-end"],
		description:
			"A trust and safety flow with severe harm, policy violation, human review, and restore paths.",
		prompt:
			"Create a content moderation flowchart. A report is received and an automated scan runs. If severe harm is detected, remove the content and escalate to safety. If not severe, decide whether there is a policy violation. No violation restores content. Violations go to human review, then decide whether action is needed. Needed action limits content; otherwise restore content.",
		nodes: [
			["report-received", "Report received", "start", ["report received", "report is received"]],
			["automated-scan", "Automated scan", "process", ["automated scan"]],
			["severe-harm", "Severe harm?", "decision", ["severe harm"]],
			["remove-content", "Remove content", "process", ["remove content", "remove the content"]],
			[
				"safety-escalation",
				"Safety escalation",
				"end",
				["safety escalation", "escalate to safety"],
			],
			[
				"policy-violation",
				"Policy violation?",
				"decision",
				["policy violation", "if not severe, decide whether there is a policy violation"],
			],
			["human-review", "Human review", "process", ["human review"]],
			["action-needed", "Action needed?", "decision", ["action needed", "action is needed"]],
			["limit-content", "Limit content", "end", ["limits content"]],
			[
				"restore-content",
				"Restore content",
				"end",
				[
					"restore content",
					"restores content",
					"no violation restores content",
					"otherwise restore content",
				],
			],
		],
		edges: [
			["report-scan", "report-received", "automated-scan"],
			["scan-severe", "automated-scan", "severe-harm"],
			["severe-remove", "severe-harm", "remove-content", "yes", ["yes", "severe"]],
			["severe-policy", "severe-harm", "policy-violation", "no", ["no", "not severe"]],
			["remove-escalate", "remove-content", "safety-escalation"],
			["policy-review", "policy-violation", "human-review", "yes", ["yes", "violations"]],
			["policy-restore", "policy-violation", "restore-content", "no", ["no", "no violation"]],
			["review-action", "human-review", "action-needed"],
			["action-limit", "action-needed", "limit-content", "yes", ["yes", "needed"]],
			["action-restore", "action-needed", "restore-content", "no"],
		],
	},
	{
		id: "data-import-validation",
		title: "Data import validation",
		difficulty: "standard",
		tags: ["data", "validation", "dedupe"],
		description:
			"A data import pipeline with parse, schema, duplicate handling, and rejection branches.",
		prompt:
			"Create a data import validation flowchart. A file is uploaded and parsed. If parsing fails, reject the file. If parsing succeeds, validate the schema. Invalid schema returns mapping errors. Valid schema deduplicates records. If duplicates are found, merge duplicates before importing. If not, import records directly.",
		inverse: {
			"parse-success": ["parsing fails"],
		},
		nodes: [
			["file-uploaded", "File uploaded", "start", ["file uploaded", "file is uploaded"]],
			["parse-file", "Parse file", "process", ["parse file", "file parsed"]],
			["parse-success", "Parse successful?", "decision", ["parsing succeeds", "parse successful"]],
			["validate-schema", "Validate schema", "process", ["validate schema", "validate the schema"]],
			["schema-valid", "Schema valid?", "decision", ["schema valid", "valid schema"]],
			["deduplicate", "Deduplicate records", "process", ["deduplicates records"]],
			[
				"duplicates-found",
				"Duplicates found?",
				"decision",
				["duplicates found", "duplicates are found"],
			],
			["merge-duplicates", "Merge duplicates", "process", ["merge duplicates"]],
			[
				"import-records",
				"Import records",
				"end",
				["import records", "importing", "if not, import records directly"],
			],
			[
				"reject-file",
				"Reject file",
				"end",
				["reject file", "reject the file", "if parsing fails, reject the file"],
			],
			[
				"mapping-errors",
				"Return mapping errors",
				"end",
				["returns mapping errors", "invalid schema returns mapping errors"],
			],
		],
		edges: [
			["upload-parse", "file-uploaded", "parse-file"],
			["parse-decision", "parse-file", "parse-success"],
			["parse-schema", "parse-success", "validate-schema", "yes"],
			["parse-reject", "parse-success", "reject-file", "no"],
			["schema-decision", "validate-schema", "schema-valid"],
			["schema-dedupe", "schema-valid", "deduplicate", "yes"],
			["schema-errors", "schema-valid", "mapping-errors", "no"],
			["dedupe-duplicates", "deduplicate", "duplicates-found"],
			["duplicates-merge", "duplicates-found", "merge-duplicates", "yes"],
			["duplicates-import", "duplicates-found", "import-records", "no"],
			["merge-import", "merge-duplicates", "import-records"],
		],
	},
	{
		id: "password-reset-security",
		title: "Password reset security",
		difficulty: "standard",
		tags: ["auth", "security", "risk-check"],
		description:
			"A security-sensitive reset flow with generic responses, token expiry, and step-up verification.",
		prompt:
			"Create a password reset security flowchart. A reset is requested. If the account does not exist, show a generic response. If it exists, send the reset email and wait for the link click. If the link is not clicked, expire the token. If clicked, run a risk check. High risk requires step-up verification before resetting the password. Low risk resets the password directly.",
		inverse: {
			"account-exists": ["account does not exist"],
			"link-clicked": ["link is not clicked"],
		},
		nodes: [
			["reset-requested", "Reset requested", "start", ["reset requested", "reset is requested"]],
			["account-exists", "Account exists?", "decision", ["account exists"]],
			[
				"generic-response",
				"Show generic response",
				"end",
				[
					"show generic response",
					"show a generic response",
					"if the account does not exist, show a generic response",
				],
			],
			["send-email", "Send reset email", "process", ["send reset email", "send the reset email"]],
			["link-clicked", "Link clicked?", "decision", ["link clicked", "link click"]],
			[
				"expire-token",
				"Expire token",
				"end",
				["expire token", "expire the token", "if the link is not clicked, expire the token"],
			],
			["risk-check", "Run risk check", "process", ["run risk check", "run a risk check"]],
			["risk-high", "Risk high?", "decision", ["risk high", "high risk"]],
			["step-up", "Step-up verification", "process", ["step-up verification"]],
			[
				"reset-password",
				"Reset password",
				"end",
				["reset password", "resetting the password", "password reset"],
			],
		],
		edges: [
			["request-account", "reset-requested", "account-exists"],
			["account-email", "account-exists", "send-email", "yes", ["yes", "exists"]],
			["account-generic", "account-exists", "generic-response", "no", ["no", "does not exist"]],
			["email-link", "send-email", "link-clicked"],
			["link-risk", "link-clicked", "risk-check", "yes", ["yes", "clicked"]],
			["link-expire", "link-clicked", "expire-token", "no", ["no", "not clicked"]],
			["risk-decision", "risk-check", "risk-high"],
			["risk-step-up", "risk-high", "step-up", "yes", ["yes", "high"]],
			["risk-reset", "risk-high", "reset-password", "no", ["no", "low"]],
			["step-up-reset", "step-up", "reset-password"],
		],
	},
	{
		id: "warehouse-reorder",
		title: "Warehouse reorder",
		difficulty: "standard",
		tags: ["operations", "inventory", "procurement"],
		description: "An inventory reorder flow with supplier fallback and monitor/no-op branch.",
		prompt:
			"Create a warehouse reorder flowchart. A stock count is updated, then the system decides whether inventory is below the reorder point. If not, monitor stock. If yes, check supplier availability. Available suppliers create a purchase order and await delivery. Unavailable suppliers use a substitute supplier before creating the purchase order.",
		nodes: [
			[
				"stock-updated",
				"Stock count updated",
				"start",
				["stock count updated", "stock count is updated"],
			],
			[
				"below-reorder",
				"Below reorder point?",
				"decision",
				["below reorder point", "below the reorder point"],
			],
			["monitor-stock", "Monitor stock", "end", ["monitor stock", "if not, monitor stock"]],
			["check-supplier", "Check supplier availability", "process", ["check supplier availability"]],
			[
				"supplier-available",
				"Supplier available?",
				"decision",
				["supplier available", "available supplier"],
			],
			[
				"substitute-supplier",
				"Use substitute supplier",
				"process",
				[
					"use substitute supplier",
					"use a substitute supplier",
					"unavailable suppliers use a substitute supplier before creating the purchase order",
				],
			],
			[
				"purchase-order",
				"Create purchase order",
				"process",
				[
					"create purchase order",
					"create a purchase order",
					"creating the purchase order",
					"unavailable suppliers use a substitute supplier before creating the purchase order",
				],
			],
			["await-delivery", "Await delivery", "end", ["await delivery"]],
		],
		edges: [
			["stock-below", "stock-updated", "below-reorder"],
			["below-check", "below-reorder", "check-supplier", "yes"],
			["below-monitor", "below-reorder", "monitor-stock", "no"],
			["check-available", "check-supplier", "supplier-available"],
			["available-po", "supplier-available", "purchase-order", "yes", ["yes", "available"]],
			[
				"available-substitute",
				"supplier-available",
				"substitute-supplier",
				"no",
				["no", "unavailable"],
			],
			["substitute-po", "substitute-supplier", "purchase-order"],
			["po-delivery", "purchase-order", "await-delivery"],
		],
	},
	{
		id: "loan-application-underwriting",
		title: "Loan application underwriting",
		difficulty: "challenge",
		tags: ["finance", "underwriting", "exception"],
		description:
			"A loan application flow with identity verification, credit review, manual underwriting, and exception approval.",
		prompt:
			"Create a loan application underwriting flowchart. An application is submitted and identity is verified. Failed identity verification declines the application. Verified identity goes to credit review. Acceptable credit moves to income verification. Unacceptable credit goes to manual underwriting, where an exception approval decision either continues to income verification or declines. Income verification approves the loan.",
		inverse: {
			"identity-verified": ["failed identity verification"],
		},
		nodes: [
			[
				"application-submitted",
				"Application submitted",
				"start",
				["application submitted", "application is submitted"],
			],
			["verify-identity", "Verify identity", "process", ["verify identity", "identity verified"]],
			[
				"identity-verified",
				"Identity verified?",
				"decision",
				["identity verified", "verified identity"],
			],
			["credit-review", "Credit review", "process", ["credit review"]],
			[
				"credit-acceptable",
				"Credit acceptable?",
				"decision",
				["credit acceptable", "acceptable credit"],
			],
			[
				"manual-underwrite",
				"Manual underwriting",
				"process",
				["manual underwriting", "unacceptable credit goes to manual underwriting"],
			],
			[
				"exception-approved",
				"Exception approved?",
				"decision",
				["exception approval", "exception approved"],
			],
			["income-verification", "Income verification", "process", ["income verification"]],
			["approve-loan", "Approve loan", "end", ["approve loan", "approves the loan"]],
			[
				"decline-application",
				"Decline application",
				"end",
				[
					"decline application",
					"declines the application",
					"application declined",
					"failed identity verification declines the application",
				],
			],
		],
		edges: [
			["application-identity", "application-submitted", "verify-identity"],
			["identity-decision", "verify-identity", "identity-verified"],
			["identity-credit", "identity-verified", "credit-review", "yes", ["yes", "verified"]],
			["identity-decline", "identity-verified", "decline-application", "no", ["no", "failed"]],
			["credit-decision", "credit-review", "credit-acceptable"],
			["credit-income", "credit-acceptable", "income-verification", "yes", ["yes", "acceptable"]],
			["credit-manual", "credit-acceptable", "manual-underwrite", "no", ["no", "unacceptable"]],
			["manual-exception", "manual-underwrite", "exception-approved"],
			["exception-income", "exception-approved", "income-verification", "yes", ["yes", "approved"]],
			["exception-decline", "exception-approved", "decline-application", "no", ["no", "declines"]],
			["income-approve", "income-verification", "approve-loan"],
		],
	},
	{
		id: "customer-offboarding-retention",
		title: "Customer offboarding retention",
		difficulty: "standard",
		tags: ["customer-success", "retention", "cancellation"],
		description:
			"A cancellation flow with retention eligibility, offer acceptance, and account closure.",
		prompt:
			"Create a customer offboarding retention flowchart. A customer requests cancellation and the team collects a cancellation reason. If the customer is eligible for a save offer, present the offer and decide whether it is accepted. Accepted offers retain the customer. Declined offers confirm cancellation and close the account. If the customer is not eligible for a save offer, confirm cancellation directly and close the account.",
		nodes: [
			[
				"cancel-request",
				"Cancellation requested",
				"start",
				["cancellation requested", "requests cancellation"],
			],
			[
				"collect-reason",
				"Collect cancellation reason",
				"process",
				["collect cancellation reason", "collects a cancellation reason"],
			],
			[
				"save-eligible",
				"Save offer eligible?",
				"decision",
				["save offer eligible", "eligible for a save offer"],
			],
			[
				"present-offer",
				"Present save offer",
				"process",
				["present save offer", "present the offer", "present offer"],
			],
			["offer-accepted", "Offer accepted?", "decision", ["offer accepted", "offer is accepted"]],
			[
				"retain-customer",
				"Retain customer",
				"end",
				["retain customer", "retains the customer", "customer retained"],
			],
			[
				"confirm-cancel",
				"Confirm cancellation",
				"process",
				[
					"confirm cancellation",
					"declined offers confirm cancellation and close the account",
					"if the customer is not eligible for a save offer, confirm cancellation directly and close the account",
				],
			],
			[
				"close-account",
				"Close account",
				"end",
				[
					"close account",
					"close the account",
					"declined offers confirm cancellation and close the account",
					"if the customer is not eligible for a save offer, confirm cancellation directly and close the account",
				],
			],
		],
		edges: [
			["cancel-reason", "cancel-request", "collect-reason"],
			["reason-eligible", "collect-reason", "save-eligible"],
			["eligible-offer", "save-eligible", "present-offer", "yes", ["yes", "eligible"]],
			["eligible-confirm", "save-eligible", "confirm-cancel", "no", ["no", "not eligible"]],
			["offer-decision", "present-offer", "offer-accepted"],
			["accepted-retain", "offer-accepted", "retain-customer", "yes", ["yes", "accepted"]],
			["accepted-confirm", "offer-accepted", "confirm-cancel", "no", ["no", "declined"]],
			["confirm-close", "confirm-cancel", "close-account"],
		],
	},
	{
		id: "bug-report-routing",
		title: "Bug report routing",
		difficulty: "challenge",
		tags: ["engineering", "triage", "security"],
		description:
			"An engineering triage flow with reproducibility, security impact, priority routing, and release outcomes.",
		prompt:
			"Create a bug report routing flowchart. A bug is filed and the team tries to reproduce it. If it cannot be reproduced, request more details. If reproduced, decide whether it has security impact. Security issues go to security triage, then a hotfix branch, then release fix. Non-security issues decide whether priority is high. High priority goes to the sprint backlog and releases a fix. Low priority goes to the regular backlog.",
		inverse: {
			reproduced: ["cannot be reproduced"],
		},
		nodes: [
			["bug-filed", "Bug filed", "start", ["bug filed", "bug is filed"]],
			["reproduce", "Reproduce issue", "process", ["reproduce"]],
			["reproduced", "Reproduced?", "decision", ["reproduced"]],
			[
				"request-details",
				"Request more details",
				"end",
				["request more details", "if it cannot be reproduced, request more details"],
			],
			["security-impact", "Security impact?", "decision", ["security impact"]],
			["security-triage", "Security triage", "process", ["security triage"]],
			["hotfix-branch", "Hotfix branch", "process", ["hotfix branch"]],
			[
				"priority-high",
				"Priority high?",
				"decision",
				[
					"priority high",
					"priority is high",
					"high priority",
					"non-security issues decide whether priority is high",
				],
			],
			["sprint-backlog", "Sprint backlog", "process", ["sprint backlog"]],
			["regular-backlog", "Regular backlog", "end", ["regular backlog"]],
			["release-fix", "Release fix", "end", ["release fix", "release a fix", "releases a fix"]],
		],
		edges: [
			["bug-reproduce", "bug-filed", "reproduce"],
			["reproduce-decision", "reproduce", "reproduced"],
			["reproduced-security", "reproduced", "security-impact", "yes", ["yes", "reproduced"]],
			["reproduced-details", "reproduced", "request-details", "no", ["no", "cannot be reproduced"]],
			["security-triage-edge", "security-impact", "security-triage", "yes"],
			["security-priority", "security-impact", "priority-high", "no"],
			["triage-hotfix", "security-triage", "hotfix-branch"],
			["hotfix-release", "hotfix-branch", "release-fix"],
			["priority-sprint", "priority-high", "sprint-backlog", "yes", ["yes", "high"]],
			["priority-regular", "priority-high", "regular-backlog", "no", ["no", "low"]],
			["sprint-release", "sprint-backlog", "release-fix"],
		],
	},
	{
		id: "expense-reimbursement",
		title: "Expense reimbursement",
		difficulty: "standard",
		tags: ["finance", "policy", "approval"],
		description:
			"An expense reimbursement flow with missing receipt, policy exception, and approval outcomes.",
		prompt:
			"Create an expense reimbursement flowchart. An expense is submitted. If the receipt is missing, request a receipt. If attached, run a policy check. Expenses within policy go to manager approval and then payment. Out-of-policy expenses go to finance exception review. Approved exceptions go to manager approval; rejected exceptions reject the expense.",
		inverse: {
			"receipt-attached": ["receipt missing", "receipt is missing"],
		},
		nodes: [
			[
				"expense-submitted",
				"Expense submitted",
				"start",
				["expense submitted", "expense is submitted"],
			],
			[
				"receipt-attached",
				"Receipt attached?",
				"decision",
				["receipt attached", "receipt is attached"],
			],
			[
				"request-receipt",
				"Request receipt",
				"end",
				["request receipt", "request a receipt", "if the receipt is missing, request a receipt"],
			],
			["policy-check", "Policy check", "process", ["policy check"]],
			["within-policy", "Within policy?", "decision", ["within policy"]],
			[
				"finance-exception",
				"Finance exception review",
				"process",
				["finance exception review", "out-of-policy expenses go to finance exception review"],
			],
			[
				"exception-approved",
				"Exception approved?",
				"decision",
				["exception approved", "approved exceptions"],
			],
			["manager-approval", "Manager approval", "process", ["manager approval"]],
			["approve-payment", "Approve payment", "end", ["payment"]],
			[
				"reject-expense",
				"Reject expense",
				"end",
				["reject expense", "reject the expense", "rejected exceptions reject the expense"],
			],
		],
		edges: [
			["expense-receipt", "expense-submitted", "receipt-attached"],
			["receipt-policy", "receipt-attached", "policy-check", "yes", ["yes", "attached"]],
			["receipt-request", "receipt-attached", "request-receipt", "no", ["no", "missing"]],
			["policy-decision", "policy-check", "within-policy"],
			["policy-manager", "within-policy", "manager-approval", "yes", ["yes", "within policy"]],
			["policy-exception", "within-policy", "finance-exception", "no", ["no", "out of policy"]],
			["exception-decision", "finance-exception", "exception-approved"],
			["exception-manager", "exception-approved", "manager-approval", "yes", ["yes", "approved"]],
			["exception-reject", "exception-approved", "reject-expense", "no", ["no", "rejected"]],
			["manager-payment", "manager-approval", "approve-payment"],
		],
	},
	{
		id: "restaurant-waitlist",
		title: "Restaurant waitlist",
		difficulty: "challenge",
		tags: ["operations", "loop", "customer-response"],
		description: "A waitlist flow with customer response and a loop while a table is not ready.",
		prompt:
			"Create a restaurant waitlist flowchart. A party arrives, the host quotes a wait time, and checks whether a table is available. If available, seat the party. If not, add the party to the waitlist. When notified, decide whether the party responds. No response removes the party from the list. If they respond, check whether the table is ready. Ready seats the party; not ready keeps waiting and checks response again.",
		nodes: [
			["party-arrives", "Party arrives", "start", ["party arrives"]],
			["quote-wait", "Quote wait time", "process", ["quote wait time", "quotes a wait time"]],
			[
				"table-available",
				"Table available?",
				"decision",
				["table available", "table is available"],
			],
			["seat-party", "Seat party", "end", ["seat party", "seat the party", "seats the party"]],
			[
				"add-waitlist",
				"Add to waitlist",
				"process",
				[
					"add to waitlist",
					"add the party to the waitlist",
					"if not, add the party to the waitlist",
				],
			],
			["party-responds", "Party responds?", "decision", ["party responds", "responds"]],
			[
				"remove-list",
				"Remove from list",
				"end",
				[
					"remove from list",
					"removes the party",
					"remove party",
					"no response removes the party from the list",
				],
			],
			["table-ready", "Table ready?", "decision", ["table ready", "table is ready"]],
			[
				"keep-waiting",
				"Keep waiting",
				"process",
				[
					"keeps waiting",
					"not ready keeps waiting",
					"not ready keeps waiting and checks response again",
				],
			],
		],
		edges: [
			["arrives-quote", "party-arrives", "quote-wait"],
			["quote-available", "quote-wait", "table-available"],
			["available-seat", "table-available", "seat-party", "yes", ["yes", "available"]],
			["available-waitlist", "table-available", "add-waitlist", "no"],
			["waitlist-response", "add-waitlist", "party-responds"],
			["responds-ready", "party-responds", "table-ready", "yes", ["yes", "responds"]],
			["responds-remove", "party-responds", "remove-list", "no"],
			["ready-seat", "table-ready", "seat-party", "yes", ["yes", "ready"]],
			["ready-waiting", "table-ready", "keep-waiting", "no", ["no", "not ready"]],
			["waiting-response", "keep-waiting", "party-responds"],
		],
	},
	{
		id: "ci-release-gate",
		title: "CI release gate",
		difficulty: "standard",
		tags: ["devops", "release", "quality-gate"],
		description:
			"A release pipeline with tests, build, security scan, canary, promote, and rollback paths.",
		prompt:
			"Create a CI release gate flowchart. A commit is merged and the test suite runs. Failed tests block release. Passing tests build an artifact and run a security scan. A failed scan blocks release. A clean scan deploys a canary. If the canary is healthy, promote to production. If not, roll back the canary.",
		inverse: {
			"tests-pass": ["failed tests"],
			"scan-clean": ["failed scan"],
		},
		nodes: [
			["commit-merged", "Commit merged", "start", ["commit merged", "commit is merged"]],
			[
				"run-tests",
				"Run test suite",
				"process",
				["run test suite", "run the test suite", "test suite runs"],
			],
			["tests-pass", "Tests pass?", "decision", ["tests pass", "passing tests"]],
			[
				"block-release",
				"Block release",
				"end",
				[
					"block release",
					"blocks release",
					"failed tests block release",
					"failed scan blocks release",
					"a failed scan blocks release",
				],
			],
			["build-artifact", "Build artifact", "process", ["build artifact", "build an artifact"]],
			[
				"scan-clean",
				"Security scan clean?",
				"decision",
				["security scan clean", "scan clean", "clean scan"],
			],
			["deploy-canary", "Deploy canary", "process", ["deploy canary", "deploys a canary"]],
			["canary-healthy", "Canary healthy?", "decision", ["canary healthy", "canary is healthy"]],
			[
				"promote-production",
				"Promote production",
				"end",
				["promote production", "promote to production"],
			],
			[
				"rollback-canary",
				"Rollback canary",
				"end",
				["roll back canary", "roll back the canary", "if not, roll back the canary"],
			],
		],
		edges: [
			["commit-tests", "commit-merged", "run-tests"],
			["tests-decision", "run-tests", "tests-pass"],
			["tests-build", "tests-pass", "build-artifact", "yes", ["yes", "passing"]],
			["tests-block", "tests-pass", "block-release", "no", ["no", "failed"]],
			["build-scan", "build-artifact", "scan-clean"],
			["scan-canary", "scan-clean", "deploy-canary", "yes", ["yes", "clean"]],
			["scan-block", "scan-clean", "block-release", "no", ["no", "failed"]],
			["canary-decision", "deploy-canary", "canary-healthy"],
			["canary-promote", "canary-healthy", "promote-production", "yes", ["yes", "healthy"]],
			["canary-rollback", "canary-healthy", "rollback-canary", "no"],
		],
	},
	{
		id: "procurement-vendor-approval",
		title: "Procurement vendor approval",
		difficulty: "challenge",
		tags: ["procurement", "legal", "loop"],
		description:
			"A procurement workflow with preferred vendor routing, risk assessment, legal review, and renegotiation loop.",
		prompt:
			"Create a procurement vendor approval flowchart. A business need is identified and quotes are collected. If there is a preferred vendor, go to risk assessment. If not, run a competitive bid first and then risk assessment. Risk that is not acceptable rejects the vendor. Acceptable risk goes to legal review. If legal approves, create the contract. If legal does not approve, renegotiate terms and repeat legal review.",
		inverse: {
			"risk-acceptable": ["risk that is not acceptable"],
		},
		nodes: [
			["need-identified", "Need identified", "start", ["need identified", "need is identified"]],
			[
				"collect-quotes",
				"Collect quotes",
				"process",
				["collect quotes", "quotes collected", "quotes are collected"],
			],
			["preferred-vendor", "Preferred vendor?", "decision", ["preferred vendor"]],
			[
				"competitive-bid",
				"Competitive bid",
				"process",
				["competitive bid", "if not, run a competitive bid first and then risk assessment"],
			],
			[
				"risk-assessment",
				"Risk assessment",
				"process",
				["risk assessment", "if not, run a competitive bid first and then risk assessment"],
			],
			[
				"risk-acceptable",
				"Risk acceptable?",
				"decision",
				["risk acceptable", "acceptable risk", "risk is acceptable"],
			],
			[
				"legal-review",
				"Legal review",
				"process",
				["legal review", "if legal does not approve, renegotiate terms and repeat legal review"],
			],
			["legal-approved", "Legal approved?", "decision", ["legal approved", "legal approves"]],
			[
				"renegotiate",
				"Renegotiate terms",
				"process",
				[
					"renegotiate terms",
					"if legal does not approve, renegotiate terms and repeat legal review",
				],
			],
			["create-contract", "Create contract", "end", ["create contract", "create the contract"]],
			[
				"reject-vendor",
				"Reject vendor",
				"end",
				["reject vendor", "rejects the vendor", "risk that is not acceptable rejects the vendor"],
			],
		],
		edges: [
			["need-quotes", "need-identified", "collect-quotes"],
			["quotes-preferred", "collect-quotes", "preferred-vendor"],
			["preferred-risk", "preferred-vendor", "risk-assessment", "yes"],
			["preferred-bid", "preferred-vendor", "competitive-bid", "no"],
			["bid-risk", "competitive-bid", "risk-assessment"],
			["risk-decision", "risk-assessment", "risk-acceptable"],
			["risk-legal", "risk-acceptable", "legal-review", "yes", ["yes", "acceptable"]],
			["risk-reject", "risk-acceptable", "reject-vendor", "no", ["no", "not acceptable"]],
			["legal-decision", "legal-review", "legal-approved"],
			["legal-contract", "legal-approved", "create-contract", "yes", ["yes", "approves"]],
			["legal-renegotiate", "legal-approved", "renegotiate", "no", ["no", "does not approve"]],
			["renegotiate-legal", "renegotiate", "legal-review"],
		],
	},
	{
		id: "subscription-renewal-dunning",
		title: "Subscription renewal dunning",
		difficulty: "challenge",
		tags: ["billing", "dunning", "loop"],
		description:
			"A billing retry flow with payment update loops, grace period decisions, renewal, and pause outcomes.",
		prompt:
			"Create a subscription renewal dunning flowchart. A renewal is due and the system charges payment. If payment succeeds, renew the subscription. If payment fails, send a reminder and decide whether payment was updated. Updated payment retries the charge. If not updated, decide whether the grace period has expired. Expired grace pauses the subscription; otherwise send another reminder.",
		nodes: [
			["renewal-due", "Renewal due", "start", ["renewal due", "renewal is due"]],
			["charge-payment", "Charge payment", "process", ["charges payment", "retries the charge"]],
			[
				"payment-succeeded",
				"Payment succeeded?",
				"decision",
				["payment succeeds", "payment succeeded"],
			],
			[
				"renew-subscription",
				"Renew subscription",
				"end",
				["renew subscription", "renew the subscription"],
			],
			[
				"send-reminder",
				"Send reminder",
				"process",
				[
					"send reminder",
					"send a reminder",
					"send another reminder",
					"if payment fails, send a reminder and decide whether payment was updated",
					"otherwise send another reminder",
				],
			],
			[
				"payment-updated",
				"Payment updated?",
				"decision",
				["payment updated", "payment was updated", "updated payment"],
			],
			[
				"grace-expired",
				"Grace period expired?",
				"decision",
				[
					"grace period expired",
					"grace period has expired",
					"expired grace",
					"if not updated, decide whether the grace period has expired",
				],
			],
			[
				"pause-subscription",
				"Pause subscription",
				"end",
				["pause subscription", "pauses the subscription"],
			],
		],
		edges: [
			["renewal-charge", "renewal-due", "charge-payment"],
			["charge-decision", "charge-payment", "payment-succeeded"],
			["payment-renew", "payment-succeeded", "renew-subscription", "yes", ["yes", "succeeds"]],
			["payment-reminder", "payment-succeeded", "send-reminder", "no", ["no", "fails"]],
			["reminder-updated", "send-reminder", "payment-updated"],
			["updated-charge", "payment-updated", "charge-payment", "yes", ["yes", "updated"]],
			["updated-grace", "payment-updated", "grace-expired", "no", ["no", "not updated"]],
			["grace-pause", "grace-expired", "pause-subscription", "yes", ["yes", "expired"]],
			["grace-reminder", "grace-expired", "send-reminder", "no"],
		],
	},
	{
		id: "deploy-pipeline-logos",
		title: "Deploy pipeline with logos",
		difficulty: "smoke",
		tags: ["logos", "devops", "two-branch"],
		description:
			"The marketing hero as a real prompt: every named technology should appear as its logo inside the matching node, and nothing else.",
		prompt:
			"Diagram our deploy pipeline. A push to GitHub starts it, Docker builds the image, and the test suite runs. If the tests pass, ship to Cloudflare Workers; otherwise notify the team and stop.",
		logos: [
			{ collection: "devtools-ci", name: "Github", slug: "github" },
			{ collection: "devtools-ci", name: "Docker", slug: "docker" },
			{
				aliases: ["Cloudflare"],
				collection: "cloud-vendors",
				name: "Cloudflare",
				slug: "cloudflare",
			},
		],
		nodes: [
			["push", "Push to GitHub", "start", ["push to GitHub"], "github"],
			[
				"build",
				"Docker builds the image",
				"process",
				["Docker builds", "Docker builds the image", "build Docker"],
				"docker",
			],
			[
				"tests",
				"Run the test suite",
				"process",
				["run the test suite", "run test suite", "test suite runs"],
			],
			["passed", "Tests pass?", "decision", ["tests pass"]],
			["ship", "Ship to Cloudflare Workers", "end", ["ship to Cloudflare Workers"], "cloudflare"],
			[
				"notify",
				"Notify the team",
				"end",
				["notify the team", "notify team", "otherwise notify the team and stop"],
			],
		],
		edges: [
			["push-build", "push", "build"],
			["build-tests", "build", "tests"],
			["tests-passed", "tests", "passed"],
			["passed-ship", "passed", "ship", "yes"],
			["passed-notify", "passed", "notify", "no"],
		],
	},
	{
		id: "ai-app-stack-logos",
		title: "AI app request path with logos",
		difficulty: "standard",
		tags: ["logos", "ai", "cache", "two-branch"],
		description:
			"A request path naming five technologies: each should carry its logo, with no logos on generic steps.",
		prompt:
			"Show how a request flows through our app. A Next.js page on Vercel receives the question and checks the Redis cache. On a cache hit, return the cached answer. On a miss, call the OpenAI model, store the answer in Redis, and log any errors to Sentry before returning the answer.",
		logos: [
			{
				aliases: ["Next.js", "next", "next.js"],
				collection: "frontend-frameworks",
				name: "Next.js",
				slug: "nextjs",
			},
			{
				aliases: ["Vercel", "zeit"],
				collection: "cloud-hosting-paas",
				name: "Vercel",
				slug: "vercel",
			},
			{ collection: "data-storage", name: "Redis", slug: "redis" },
			{ aliases: ["OpenAI"], collection: "ai-model-labs", name: "OpenAI", slug: "openai" },
			{ collection: "observability-security", name: "Sentry", slug: "sentry" },
		],
		// The prompt's first event, `A Next.js page on Vercel receives the
		// question`, states no order between Vercel and the page: one entry step
		// that names both, drawn as one node or a short entry chain.
		entry: ["page"],
		nodes: [
			[
				"request",
				"Request reaches Vercel",
				"start",
				[
					"Next.js page on Vercel receives question",
					"Next.js page on Vercel receives the question",
				],
				"vercel",
			],
			["page", "Next.js page receives question", "process", ["Next.js page"], "nextjs"],
			[
				"cache",
				"Cached in Redis?",
				"decision",
				["cached in Redis", "Redis cache", "cache hit"],
				"redis",
			],
			[
				"cached",
				"Return cached answer",
				"end",
				["return cached answer", "return the cached answer", "cached answer returned"],
			],
			[
				"model",
				"Call the OpenAI model",
				"process",
				[
					"call the OpenAI model",
					"call OpenAI",
					"call OpenAI model",
					"on a miss, call the openai model, store the answer in redis, and log any errors to sentry before returning the answer",
				],
				"openai",
			],
			[
				"store",
				"Store answer in Redis",
				"process",
				[
					"store answer in Redis",
					"store the answer in Redis",
					"answer stored in Redis",
					"on a miss, call the openai model, store the answer in redis, and log any errors to sentry before returning the answer",
				],
				"redis",
			],
			[
				"log",
				"Log errors to Sentry",
				"process",
				[
					"log errors to Sentry",
					"log any errors to Sentry",
					"Sentry logs errors",
					"on a miss, call the openai model, store the answer in redis, and log any errors to sentry before returning the answer",
				],
				"sentry",
			],
			[
				"answer",
				"Return the answer",
				"end",
				[
					"return the answer",
					"return answer",
					"answer returned",
					"on a miss, call the openai model, store the answer in redis, and log any errors to sentry before returning the answer",
				],
			],
		],
		edges: [
			["request-page", "request", "page"],
			["page-cache", "page", "cache"],
			["cache-hit", "cache", "cached", "hit"],
			["cache-miss", "cache", "model", "miss"],
			["model-store", "model", "store"],
			["store-log", "store", "log"],
			["log-answer", "log", "answer"],
		],
	},
	{
		id: "grouped-expense-approval",
		title: "Grouped expense approval",
		difficulty: "standard",
		tags: ["groups", "approval", "loop"],
		description:
			"An approval process grouped by team, with a rejection loop back into the first team's group.",
		prompt:
			"Create a flowchart of an expense approval process grouped by team. In the Employee group, the employee submits an expense report, which starts the flow. In the Manager group, the manager reviews the report and decides whether it is approved. A rejected report goes back to the Employee group, where the employee revises the report and resubmits it for review. In the Finance group, finance verifies the receipts and then pays the employee, which ends the flow.",
		nodes: [
			[
				"submit",
				"Submit expense report",
				"start",
				["submits an expense report", "submit expense report"],
			],
			["review", "Review the report", "process", ["reviews the report", "review report"]],
			["approved", "Approved?", "decision", ["approved"]],
			["revise", "Revise the report", "process", ["revises the report", "revise report"]],
			["verify", "Verify receipts", "process", ["verifies the receipts", "verify receipts"]],
			["pay", "Pay the employee", "end", ["pays the employee", "pay employee"]],
		],
		edges: [
			["submit-review", "submit", "review"],
			["review-approved", "review", "approved"],
			["approved-verify", "approved", "verify", "yes", ["yes", "approved"]],
			["approved-revise", "approved", "revise", "no", ["no", "rejected"]],
			["revise-review", "revise", "review"],
			["verify-pay", "verify", "pay"],
		],
		groups: [
			["employee", "Employee", ["employee"], ["submit", "revise"]],
			["manager", "Manager", ["manager"], ["review", "approved"]],
			["finance", "Finance", ["finance"], ["verify", "pay"]],
		],
	},
	{
		id: "three-zone-request-path",
		title: "Three-zone request path",
		difficulty: "standard",
		tags: ["groups", "zones", "architecture", "left-to-right"],
		direction: "LR",
		description:
			"A request path through three network zones, with a cache decision that can end the flow early.",
		prompt:
			"Create a left-to-right flowchart of a web request crossing three network zones. In the Public internet zone, the browser sends a request, which starts the flow. In the DMZ, the CDN checks its cache and decides whether there is a cache hit. A hit returns the cached page and ends the flow. On a miss, the WAF filters the request. In the Private subnet zone, the API server handles the request and queries the database, and then the response is returned, which ends the flow.",
		nodes: [
			[
				"request",
				"Browser sends request",
				"start",
				["browser sends a request", "browser sends request"],
			],
			["cache", "CDN checks cache", "process", ["CDN checks its cache", "CDN checks cache"]],
			["hit", "Cache hit?", "decision", ["cache hit"]],
			["cached", "Return cached page", "end", ["returns the cached page", "cached page"]],
			["waf", "WAF filters request", "process", ["WAF filters the request", "WAF filters"]],
			[
				"api",
				"API server handles request",
				"process",
				["API server handles the request", "API server"],
			],
			["db", "Query the database", "process", ["queries the database", "query database"]],
			["response", "Response returned", "end", ["response is returned", "response returned"]],
		],
		edges: [
			["request-cache", "request", "cache"],
			["cache-hit", "cache", "hit"],
			["hit-cached", "hit", "cached", "hit"],
			["hit-waf", "hit", "waf", "miss"],
			["waf-api", "waf", "api"],
			["api-db", "api", "db"],
			["db-response", "db", "response"],
		],
		groups: [
			["internet", "Public internet", ["public internet", "internet"], ["request"]],
			["dmz", "DMZ", ["dmz"], ["cache", "hit", "waf"]],
			["private", "Private subnet", ["private subnet", "private"], ["api", "db"]],
		],
	},
	{
		id: "mixed-fulfilment-groups",
		title: "Order fulfilment with grouped and ungrouped steps",
		difficulty: "standard",
		tags: ["groups", "mixed-membership", "decision"],
		description:
			"Only some steps belong to groups: intake and the fraud decision stay outside, while warehouse and carrier work is grouped.",
		prompt:
			"Create a flowchart for order fulfilment where only the warehouse and carrier steps are grouped. An order is placed, which starts the flow, and a fraud check decides whether it passes; these two steps stay outside any group. A failed check cancels the order. In the Warehouse group, staff pick the items, pack the order, and print the shipping label. In the Carrier group, the carrier collects the parcel and delivers it to the customer, which ends the flow.",
		nodes: [
			["order", "Order placed", "start", ["order is placed", "order placed"]],
			["fraud", "Fraud check passed?", "decision", ["fraud check", "passes"]],
			["cancel", "Cancel the order", "end", ["cancels the order", "cancel order"]],
			["pick", "Pick the items", "process", ["pick the items", "pick items"]],
			["pack", "Pack the order", "process", ["pack the order", "pack order"]],
			["label", "Print shipping label", "process", ["print the shipping label", "shipping label"]],
			["collect", "Collect the parcel", "process", ["collects the parcel", "collect parcel"]],
			["deliver", "Deliver to customer", "end", ["delivers it to the customer", "deliver"]],
		],
		edges: [
			["order-fraud", "order", "fraud"],
			["fraud-pick", "fraud", "pick", "yes", ["yes", "passes"]],
			["fraud-cancel", "fraud", "cancel", "no", ["no", "failed"]],
			["pick-pack", "pick", "pack"],
			["pack-label", "pack", "label"],
			["label-collect", "label", "collect"],
			["collect-deliver", "collect", "deliver"],
		],
		groups: [
			["warehouse", "Warehouse", ["warehouse"], ["pick", "pack", "label"]],
			["carrier", "Carrier", ["carrier"], ["collect", "deliver"]],
		],
		ungrouped: ["order", "fraud"],
	},
	{
		id: "swimlane-order-fulfilment",
		title: "Order fulfilment swimlanes",
		difficulty: "standard",
		tags: ["lanes", "handoffs", "decision", "left-to-right"],
		direction: "LR",
		description:
			"Order fulfilment across four lanes, with straight handoffs between neighbors and an invoice that crosses from the last lane to the first and back.",
		prompt:
			"Create a left-to-right swimlane flowchart of order fulfilment with lanes for Customer, Sales, Warehouse and Finance, in that order. The customer places an order, which starts the flow. Sales reviews the order and decides whether the items are in stock. If not, sales notifies the customer of a backorder, which ends the flow. If they are, the warehouse picks the items, packs the order and ships it. Finance then sends the invoice, the customer pays the invoice, and finance records the payment, which ends the flow.",
		nodes: [
			["place", "Place order", "start", ["places an order", "place order"]],
			["review", "Review the order", "process", ["reviews the order", "review order"]],
			["stock", "Items in stock?", "decision", ["items are in stock", "in stock"]],
			[
				"backorder",
				"Notify customer of backorder",
				"end",
				["notifies the customer of a backorder", "backorder"],
			],
			["pick", "Pick the items", "process", ["picks the items", "pick items"]],
			["pack", "Pack the order", "process", ["packs the order", "pack order"]],
			["ship", "Ship the order", "process", ["ships it", "ship"]],
			["invoice", "Send the invoice", "process", ["sends the invoice", "send invoice"]],
			["pay", "Pay the invoice", "process", ["pays the invoice", "pay invoice"]],
			["record", "Record the payment", "end", ["records the payment", "record payment"]],
		],
		edges: [
			["place-review", "place", "review"],
			["review-stock", "review", "stock"],
			["stock-backorder", "stock", "backorder", "no", ["no", "not"]],
			["stock-pick", "stock", "pick", "yes", ["yes", "in stock"]],
			["pick-pack", "pick", "pack"],
			["pack-ship", "pack", "ship"],
			["ship-invoice", "ship", "invoice"],
			["invoice-pay", "invoice", "pay"],
			["pay-record", "pay", "record"],
		],
		lanes: [
			["customer", "Customer", ["customer"], ["place", "pay"]],
			["sales", "Sales", ["sales"], ["review", "stock", "backorder"]],
			["warehouse", "Warehouse", ["warehouse"], ["pick", "pack", "ship"]],
			["finance", "Finance", ["finance"], ["invoice", "record"]],
		],
	},
	{
		id: "swimlane-hiring",
		title: "Hiring process swimlanes",
		difficulty: "standard",
		tags: ["lanes", "handoffs", "decision", "loop"],
		description:
			"Hiring across three lanes, with a rejection handed back to the candidate and another interview round looping back across lanes.",
		prompt:
			"Create a swimlane flowchart of a hiring process with lanes for the Candidate, the Recruiter and the Hiring manager, in that order. The candidate submits an application, which starts the flow. The recruiter screens the application and decides whether the candidate is qualified. An unqualified candidate receives a rejection, which ends the flow. For a qualified candidate, the recruiter schedules an interview, the candidate attends the interview, and the hiring manager assesses the candidate and decides whether to hire. If the manager wants another round, the flow returns to scheduling an interview. On a hire, the recruiter sends an offer and the candidate accepts the offer, which ends the flow.",
		nodes: [
			["apply", "Submit application", "start", ["submits an application", "submit application"]],
			[
				"screen",
				"Screen the application",
				"process",
				["screens the application", "screen application"],
			],
			["qualified", "Qualified?", "decision", ["qualified"]],
			["reject", "Receive rejection", "end", ["receives a rejection", "rejection"]],
			[
				"schedule",
				"Schedule interview",
				"process",
				["schedules an interview", "schedule interview"],
			],
			["attend", "Attend interview", "process", ["attends the interview", "attend interview"]],
			["assess", "Assess the candidate", "process", ["assesses the candidate", "assess candidate"]],
			["hire", "Hire?", "decision", ["hire"]],
			["offer", "Send offer", "process", ["sends an offer", "send offer"]],
			["accept", "Accept offer", "end", ["accepts the offer", "accept offer"]],
		],
		edges: [
			["apply-screen", "apply", "screen"],
			["screen-qualified", "screen", "qualified"],
			["qualified-reject", "qualified", "reject", "no", ["no", "unqualified"]],
			["qualified-schedule", "qualified", "schedule", "yes", ["yes", "qualified"]],
			["schedule-attend", "schedule", "attend"],
			["attend-assess", "attend", "assess"],
			["assess-hire", "assess", "hire"],
			["hire-offer", "hire", "offer", "yes", ["yes", "hire"]],
			["hire-schedule", "hire", "schedule", "no", ["no", "another round"]],
			["offer-accept", "offer", "accept"],
		],
		lanes: [
			["candidate", "Candidate", ["candidate"], ["apply", "reject", "attend", "accept"]],
			["recruiter", "Recruiter", ["recruiter"], ["screen", "qualified", "schedule", "offer"]],
			["manager", "Hiring manager", ["hiring manager", "manager"], ["assess", "hire"]],
		],
	},
	{
		id: "swimlane-incident-response",
		title: "Incident response swimlanes",
		difficulty: "standard",
		tags: ["lanes", "handoffs", "loop", "left-to-right"],
		direction: "LR",
		description:
			"Incident response across three lanes, with a handoff that skips a lane and an unresolved incident looping back to the SRE.",
		prompt:
			"Create a left-to-right swimlane flowchart of incident response with lanes for On-call, SRE and Comms, in that order. An alert fires, which starts the flow, and the on-call engineer triages the alert and pages the SRE. The SRE investigates the incident and applies a mitigation. Comms then posts a status update. The on-call engineer checks whether the incident is resolved. If it is not, the flow loops back to the SRE investigating the incident. Once it is resolved, comms publishes the resolution, which ends the flow.",
		nodes: [
			["alert", "Alert fires", "start", ["alert fires"]],
			["triage", "Triage the alert", "process", ["triages the alert", "triage alert"]],
			["page", "Page the SRE", "process", ["pages the SRE", "page SRE"]],
			[
				"investigate",
				"Investigate the incident",
				"process",
				["investigates the incident", "investigate"],
			],
			["mitigate", "Apply a mitigation", "process", ["applies a mitigation", "mitigation"]],
			["status", "Post status update", "process", ["posts a status update", "status update"]],
			["resolved", "Incident resolved?", "decision", ["incident is resolved", "resolved"]],
			[
				"publish",
				"Publish the resolution",
				"end",
				["publishes the resolution", "publish resolution"],
			],
		],
		edges: [
			["alert-triage", "alert", "triage"],
			["triage-page", "triage", "page"],
			["page-investigate", "page", "investigate"],
			["investigate-mitigate", "investigate", "mitigate"],
			["mitigate-status", "mitigate", "status"],
			["status-resolved", "status", "resolved"],
			["resolved-investigate", "resolved", "investigate", "no", ["no", "not"]],
			["resolved-publish", "resolved", "publish", "yes", ["yes", "resolved"]],
		],
		lanes: [
			["oncall", "On-call", ["on-call", "on call"], ["alert", "triage", "page", "resolved"]],
			["sre", "SRE", ["sre"], ["investigate", "mitigate"]],
			["comms", "Comms", ["comms"], ["status", "publish"]],
		],
	},
	{
		id: "aws-three-tier-zones",
		title: "AWS three-tier app in nested zones",
		difficulty: "standard",
		tags: ["zones", "nesting", "architecture", "shapes", "left-to-right"],
		direction: "LR",
		description:
			"A three-tier AWS app: a load balancer in a public subnet, two services in a private subnet and a database in a database subnet, inside a VPC in a region, with a bucket in the region outside the VPC.",
		prompt:
			"Draw our AWS setup as a left-to-right architecture diagram. Users send requests, which starts the flow, to an Application Load Balancer in a public subnet. The load balancer routes requests to two ECS services in a private subnet, the web service and the API service. Both services query an RDS PostgreSQL database in a database subnet, which ends the flow, and the API service also stores uploads in an S3 bucket, which ends the flow too. All three subnets sit inside a VPC, and the VPC and the S3 bucket sit inside the us-east-1 region.",
		logos: [
			{
				aliases: ["AWS", "amazon", "amazon web services"],
				collection: "cloud-vendors",
				name: "AWS",
				slug: "aws",
			},
			{
				aliases: ["PostgreSQL", "postgres", "postgres sql", "psql"],
				collection: "data-storage",
				name: "PostgreSQL",
				slug: "postgresql",
			},
		],
		nodes: [
			["users", "Users send requests", "start", ["users send requests", "users"]],
			[
				"alb",
				"Application Load Balancer",
				"process",
				["Application Load Balancer", "load balancer"],
			],
			["web", "ECS web service", "process", ["web service"]],
			["api", "ECS API service", "process", ["API service"]],
			[
				"rds",
				"RDS PostgreSQL database",
				"end",
				["RDS PostgreSQL database", "RDS PostgreSQL", "PostgreSQL database"],
			],
			["s3", "S3 bucket", "end", ["S3 bucket", "stores uploads"]],
		],
		edges: [
			["users-alb", "users", "alb"],
			["alb-web", "alb", "web"],
			["alb-api", "alb", "api"],
			["web-rds", "web", "rds"],
			["api-rds", "api", "rds"],
			["api-s3", "api", "s3"],
		],
		groups: [
			["region", "us-east-1", ["us-east-1"], ["s3"], { kinds: ["region"] }],
			["vpc", "VPC", ["vpc"], [], { parent: "region", kinds: ["vpc"] }],
			[
				"public",
				"Public subnet",
				["public subnet", "public"],
				["alb"],
				{ parent: "vpc", kinds: ["subnet"] },
			],
			[
				"private",
				"Private subnet",
				["private subnet", "private"],
				["web", "api"],
				{ parent: "vpc", kinds: ["subnet"] },
			],
			[
				"data",
				"Database subnet",
				["database subnet"],
				["rds"],
				{ parent: "vpc", kinds: ["subnet"] },
			],
		],
		ungrouped: ["users"],
		shapes: { rds: "database", s3: "storage" },
	},
	{
		id: "kubernetes-cluster-zones",
		title: "Kubernetes cluster with namespaces",
		difficulty: "standard",
		tags: ["zones", "nesting", "architecture", "shapes", "kubernetes"],
		description:
			"Services and pods in three namespaces of a cluster, with a managed database and a message queue outside the cluster.",
		prompt:
			"Draw our Kubernetes architecture from top to bottom. A browser request starts the flow and reaches the ingress controller in the ingress namespace of our GKE cluster. The ingress controller forwards it to the web service in the frontend namespace, which sends it to the web pods in the same namespace. The web pods call the API service in the backend namespace, which sends it to the API pods there. The API pods write orders to a Cloud SQL database outside the cluster, which ends the flow, and publish jobs to a RabbitMQ queue, also outside the cluster. Worker pods in the backend namespace consume jobs from the queue and write results to the same database.",
		logos: [
			{
				aliases: ["Kubernetes", "k8s", "kube"],
				collection: "devtools-ci",
				name: "Kubernetes",
				slug: "kubernetes",
			},
			{ collection: "gcp", name: "Gke", slug: "gke" },
			{ collection: "gcp", name: "Cloud SQL", slug: "cloud-sql" },
			{ collection: "data-storage", name: "Rabbitmq", slug: "rabbitmq" },
		],
		nodes: [
			["browser", "Browser request", "start", ["browser request"]],
			["ingress", "Ingress controller", "process", ["ingress controller"]],
			["websvc", "Web service", "process", ["web service"]],
			["webpods", "Web pods", "process", ["web pods"]],
			["apisvc", "API service", "process", ["API service"]],
			["apipods", "API pods", "process", ["API pods"]],
			["queue", "RabbitMQ queue", "process", ["RabbitMQ queue", "RabbitMQ"]],
			["workers", "Worker pods", "process", ["worker pods"]],
			["db", "Cloud SQL database", "end", ["Cloud SQL database", "Cloud SQL"]],
		],
		edges: [
			["browser-ingress", "browser", "ingress"],
			["ingress-websvc", "ingress", "websvc"],
			["websvc-webpods", "websvc", "webpods"],
			["webpods-apisvc", "webpods", "apisvc"],
			["apisvc-apipods", "apisvc", "apipods"],
			["apipods-db", "apipods", "db"],
			["apipods-queue", "apipods", "queue"],
			["queue-workers", "queue", "workers"],
			["workers-db", "workers", "db"],
		],
		groups: [
			["cluster", "GKE cluster", ["GKE cluster", "cluster"], [], { kinds: ["cluster"] }],
			[
				"edge",
				"Ingress namespace",
				["ingress namespace", "ingress"],
				["ingress"],
				{ parent: "cluster", kinds: ["namespace"] },
			],
			[
				"frontend",
				"Frontend namespace",
				["frontend namespace", "frontend"],
				["websvc", "webpods"],
				{ parent: "cluster", kinds: ["namespace"] },
			],
			[
				"backend",
				"Backend namespace",
				["backend namespace", "backend"],
				["apisvc", "apipods", "workers"],
				{ parent: "cluster", kinds: ["namespace"] },
			],
		],
		ungrouped: ["browser", "queue", "db"],
		shapes: { queue: "queue", db: "database" },
	},
	{
		id: "hybrid-cloud-zones",
		title: "Hybrid on-prem and cloud setup",
		difficulty: "challenge",
		tags: ["zones", "nesting", "architecture", "shapes", "hybrid", "left-to-right"],
		direction: "LR",
		description:
			"An on-prem data center joined by a VPN to a cloud VPC four zones deep, where orders queue for a sync function that writes a table and archives invoices.",
		prompt:
			"Draw our hybrid setup from left to right. In the corporate network of our on-prem data center, office staff start the flow by entering orders in the legacy ERP, which also runs on the corporate network. The ERP stores records in an Oracle database in the data center, which ends the flow, and sends orders through a site-to-site VPN gateway in our production VPC. The VPN gateway passes them to the order API in the VPC's private subnet. The VPC sits in the eu-west-1 region of our AWS cloud. The order API puts each order on an order queue in the region, and a sync function takes orders from the queue, writes them to an orders table, which ends the flow, and saves each invoice as a PDF document in the invoice archive, which ends the flow too.",
		logos: [
			{ collection: "cloud-vendors", name: "Oracle", slug: "oracle" },
			{
				aliases: ["AWS", "amazon", "amazon web services"],
				collection: "cloud-vendors",
				name: "AWS",
				slug: "aws",
			},
		],
		nodes: [
			["staff", "Office staff", "start", ["office staff"]],
			["erp", "Legacy ERP", "process", ["legacy ERP", "ERP"]],
			["oracle", "Oracle database", "end", ["Oracle database"]],
			["vpn", "Site-to-site VPN gateway", "process", ["site-to-site VPN gateway", "VPN gateway"]],
			["api", "Order API", "process", ["order API"]],
			["queue", "Order queue", "process", ["order queue"]],
			["sync", "Sync function", "process", ["sync function"]],
			["table", "Orders table", "end", ["orders table"]],
			["archive", "Invoice archive", "end", ["invoice archive"]],
		],
		edges: [
			["staff-erp", "staff", "erp"],
			["erp-oracle", "erp", "oracle"],
			["erp-vpn", "erp", "vpn"],
			["vpn-api", "vpn", "api"],
			["api-queue", "api", "queue"],
			["queue-sync", "queue", "sync"],
			["sync-table", "sync", "table"],
			["sync-archive", "sync", "archive"],
		],
		groups: [
			[
				"onprem",
				"On-prem data center",
				["on-prem data center", "data center"],
				["oracle"],
				{ kinds: ["datacenter"] },
			],
			["corp", "Corporate network", ["corporate network"], ["staff", "erp"], { parent: "onprem" }],
			["aws", "AWS cloud", ["AWS cloud", "AWS"], [], { kinds: ["cloud"] }],
			[
				"region",
				"eu-west-1",
				["eu-west-1"],
				["queue", "sync", "table", "archive"],
				{ parent: "aws", kinds: ["region"] },
			],
			[
				"vpc",
				"Production VPC",
				["production VPC", "VPC"],
				["vpn"],
				{ parent: "region", kinds: ["vpc"] },
			],
			[
				"private",
				"Private subnet",
				["private subnet"],
				["api"],
				{ parent: "vpc", kinds: ["subnet"] },
			],
		],
		// The prompt saves PDF documents in an archive in a cloud region: a document
		// stack or an object-storage bucket each reads as that archive.
		shapes: {
			oracle: "database",
			queue: "queue",
			table: "database",
			archive: ["document", "storage"],
		},
	},
] satisfies readonly FlowchartScenarioDefinition[];

export const flowchartScenarios = flowchartScenarioDefinitions.map(defineFlowchartScenario);

export type FlowchartScenarioId = (typeof flowchartScenarioDefinitions)[number]["id"];

export function getFlowchartScenario(id: string): FlowchartScenario {
	const scenario = flowchartScenarios.find((candidate) => candidate.id === id);

	if (!scenario) {
		throw new Error(`Unknown scenario "${id}".`);
	}

	return scenario;
}
