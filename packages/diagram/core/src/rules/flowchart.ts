import { DIAGRAM_NODE_COLOR_NAMES, DIAGRAM_ZONE_KINDS } from "../intermediate.js";
import { FLOWCHART_MAX_EDGES, FLOWCHART_MAX_NODES } from "../types/flowchart.js";
import type { RuleSource } from "./source.js";

const zoneKinds = `${DIAGRAM_ZONE_KINDS.slice(0, -1).join(", ")} or ${DIAGRAM_ZONE_KINDS.at(-1)}`;

/**
 * How a request becomes a flowchart. The generation prompt, the MCP docs and Studio chat each
 * render the rules they use from here; no surface words a flowchart rule of its own.
 */
export const FLOWCHART_RULES = {
	separateNodes: (source: RuleSource) =>
		`Keep every requested step and decision in a separate node, in ${source}'s order; never merge a destination with its next action.`,
	actionNodes: (source: RuleSource) =>
		`Give every action ${source} states its own node; never fold one into an edge label, another node, or a check. A return path that names an action or a state, even waiting, passes through a node for it before it rejoins.`,
	statedChecks:
		'A stated check or verification ("verify the signature", "stock is checked") is its own process node before the decision that reads its result; "check whether X" alone is just that decision.',
	labelWords: (source: RuleSource) =>
		`Label steps and decisions with ${source}'s own words, including how it phrases each decision; only when two labels would be identical, add the distinguishing words it uses.`,
	labelForm:
		'Label a step as a short action ("Resize image"), a decision as a short question ("Image too large?") and a component by its name; never paste a clause ("if the image is too large", "whether …", "is resized").',
	noBranchBorrowing: (source: RuleSource) =>
		`A step or check ${source} gives to some branches stays on those branches; never copy it onto another.`,
	branchNames: (source: RuleSource) =>
		`A branch ${source} names by its outcome ("pass", "retest", "reject") is the label on its decision's edge, never a decision of its own.`,
	namedOutcomes: (source: RuleSource) =>
		`Use one node per outcome ${source} names: point every branch that reaches the same named outcome at that one node, and do not add end nodes ${source} does not name.`,
	technologyLabels:
		"Name technologies in node labels; a note draws as a small subtitle under the label, for detail. A step that names two products, an app on its platform, is two nodes, platform first, so each draws its logo.",
	/** What a label may say: no more than its source says of that step, and who does it. */
	labelScope: (source: RuleSource) =>
		`A step's label adds no condition, timing or reason ${source} does not give that step ("Notify customer", not "Notify customer once approved"), and keeps the doer ${source} names when no lane or group shows who does it.`,
	zonesOutside: "Anything stated as outside a zone stays outside it.",
	limits: `At most ${FLOWCHART_MAX_NODES} nodes and ${FLOWCHART_MAX_EDGES} edges.`,
	limitsDetail: "Larger graphs fail with flowchart_too_large before render or persistence.",
	summarize:
		"Summarize a broad or vague repo/system architecture prompt into 8-14 high-signal nodes on a single readable spine with short side branches, not a dense dependency graph with one node per package or many crossing links.",
	/** Where the generation prompt also says never to drop stated content to fit a limit. */
	summarizeOnlyUnnamed: "Summarize only a request that names no steps or parts of its own.",
	layers:
		"When a prompt asks how packages or systems interact, group related packages into layers along the main flow.",
	keepNamed: (source: RuleSource) =>
		`Keep every package and component ${source} names under its own name; summarizing drops unnamed detail and never renames or generalizes named parts.`,
	/** The flowchart document's own rules, which every surface that writes one reads. */
	documentShape:
		'nodes map an id to its label or { label, … }; an edge is [from, to] or [from, to, "label"], and an end may list ids: [["web", "api"], "rds"] is one edge per id.',
	documentRoles: (_source: RuleSource) =>
		'Roles come from edges: question labels are decisions. Keep every stated "X before Y" or "X then Y" connection and branch rejoin; a branch with no stated next step ends at its last step, with no onward arrow or closing node.',

	documentNodeDetails:
		'A node is "Label", or { "label", "note"?, "shape"? } when it has a subtitle or a shape; give every database, queue, bucket and file its shape.',
	documentEdgeLabels: (source: RuleSource) =>
		`Label an arrow with the words ${source} gives it ("write orders", "publish jobs"): ["api", "db", "write orders"].`,
	documentZonesNotNodes: "A zone is only a group: never also a node, and never an arrow's end.",
	documentOwners: (source: RuleSource) =>
		`A node belongs to whoever does it in ${source}, never to whoever it names or acts on: "support notifies the customer" is Support's, in its lane or group.`,
	documentFanOut:
		'A branch that leads to several steps lists them in one edge: ["short", ["notify", "reorder"], "yes"].',
	documentBranches: (source: RuleSource) =>
		`Label every branch of a question with ${source}'s outcome words, usually "yes" and "no", each label once.`,
	documentLoops:
		"Keep each action on a return path as its own node in its actor's group or lane, then connect back to the repeated step; never make it an end or put its action only on an arrow.",

	documentGroups: (source: RuleSource) =>
		`When ${source} groups steps, declare groups: { id: { label, kind?, contains?: [ids] } }. For teams, each node names its doer in group, return-loop actions too; contains lists nested groups. For zones, contains lists nodes and groups at any depth; Sketchi nests them. node.group combines with contains; conflicting owners fail. Each named zone has its own group; outside stays out. Only zones, not teams, take kind (${zoneKinds}). Shapes on all nodes, entries/ends too: "database" for databases, "document" for files/archives/reports, "queue" for queues/streams/topics, "storage" for buckets/object stores.`,

	documentLanes: (source: RuleSource) =>
		`For swimlanes, a process across actors or roles, declare lanes: { id: "Label" } in ${source}'s order and set every node's lane, questions too, to whoever does it: { label, lane }. Lanes may be empty; no groups.`,
	documentLogos: (source: RuleSource) =>
		`When ${source} names technologies or asks for logos, set logos: true: each node draws the logo of the first product its label names; icon: "Name" picks another and icon: null drops it.`,
	documentDirection: (source: RuleSource) =>
		`Set direction: "LR" only when ${source} reads left to right, curved: true only when it asks for curved lines.`,
	documentNoInventedSteps: (source: RuleSource) =>
		`Do not add decisions, loops, steps, or edges ${source} does not state; a step that handles "any errors" or acts "if needed" stays one step in sequence.`,
} as const;

/**
 * How edits change a flowchart document, for every surface that writes them: the MCP's
 * editFlowchart, the CLI's edit and a hosted revision.
 */
export const FLOWCHART_EDIT_RULES = {
	ops: 'edits: [{ op: "insert", node: { id: label }, between: [from, to] } | { op: "set", nodes?: { [id]: label | { ...node fields } | null }, groups?: { [id]: { ...group fields } | null }, lanes?: { [id]: label | null }, title?, direction? } | { op: "connect", edges } | { op: "disconnect", edges: [[from, to]] }].',
	refs: "Name nodes, groups and lanes by id or exact label. insert splits an existing edge. set merges, adds new ids and removes with null, bridging a removed step. connect adds or relabels edges. What edits do not name stays.",
	colors: `Color a node only when asked, as set: { nodes: { id: { color } } } with color ${DIAGRAM_NODE_COLOR_NAMES.map((name) => `"${name}"`).join(", ")}; null clears it.`,
} as const;
