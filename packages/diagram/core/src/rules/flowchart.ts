import { DIAGRAM_ZONE_KINDS } from "../intermediate.js";
import { FLOWCHART_MAX_EDGES, FLOWCHART_MAX_NODES } from "../types/flowchart.js";
import type { RuleSource } from "./source.js";

const zoneKinds = `${DIAGRAM_ZONE_KINDS.slice(0, -1).join(", ")} or ${DIAGRAM_ZONE_KINDS.at(-1)}`;

/**
 * How a request becomes a flowchart. The generation prompt, the MCP docs and Studio chat each
 * render the rules they use from here; no surface words a flowchart rule of its own.
 */
export const FLOWCHART_RULES = {
	singleStart: "Use exactly one start node and at least one end node.",
	edgesByKind:
		"Every non-end node must have at least one outgoing edge; every end node must have zero outgoing edges.",
	reachable: "Every node must be reachable from the single start and able to reach an end.",
	reachableDetail:
		"Closed cycles fail with nonterminating_node; retry loops remain valid when they retain an eventual exit to an end.",
	separateNodes: (source: RuleSource) =>
		`Keep every requested step and decision in a separate node, preserving ${source}'s step wording and order. Use plain step labels; do not merge a destination with its next action or replace a named step with a paraphrase.`,
	actionNodes: (source: RuleSource) =>
		`Give every action ${source} states its own node; never fold one into an edge label, another node, or a check. A return path that names an action or a state, even waiting, passes through a node for it before it rejoins.`,
	statedChecks:
		'A stated check or verification ("verify the signature", "stock is checked") is its own process node before the decision that reads its result; "check whether X" alone is just that decision.',
	labelWords: (source: RuleSource) =>
		`Label steps and decisions with ${source}'s own words, including how it phrases each decision, and keep every decision it states as a decision node. Only when two labels would be identical, add the distinguishing words ${source} itself uses.`,
	labelForm:
		'Label a step as a short action ("Resize image"), a decision as a short question ("Image too large?") and a component by its name; never paste a clause ("if the image is too large", "whether …", "is resized").',
	noBranchBorrowing: (source: RuleSource) =>
		`A step or check ${source} gives to some branches stays on those branches; never copy it onto another.`,
	branchNames: (source: RuleSource) =>
		`A branch ${source} names by its outcome ("pass", "retest", "reject") is the label on its decision's edge, never a decision of its own.`,
	statedEnd: (source: RuleSource) =>
		`If ${source} says where the flow ends, every branch leads to that node. Otherwise a branch with no stated next step stops at its last step: mark that step as the end node, never a new result after it.`,
	namedOutcomes: (source: RuleSource) =>
		`Use one node per outcome ${source} names: point every branch that reaches the same named outcome at that one node, and do not add end nodes ${source} does not name.`,
	noInventedSteps: (source: RuleSource) =>
		`Do not add decisions, loops, steps, or edges ${source} does not state; a step that handles "any errors" or acts "if needed" stays one step in sequence. A step that repeats an earlier step ("send another ...", "try again", "retry", "resubmit") continues that cycle: draw it as the earlier step or as a step that loops back to the decision after it, never as an end. Only a new, unrepeated final step with no stated next step is that branch's end node (kind: "end").`,
	decisionEdges:
		"Every decision node must have at least two outgoing edges with non-empty unique labels.",
	backEdges:
		"For each retry, return, or feedback loop, include a real back-edge to an earlier distinct process or decision. Never target start and never use a self-loop.",
	technologyLabels:
		"Name technologies in node labels; a description draws as a small subtitle under the label, for detail.",
	groups: (source: RuleSource) =>
		`Only when ${source} groups steps (teams, zones, phases), add groups [{ "id", "label" }] and set each member node's group to its innermost group id; leave other nodes ungrouped. Every zone ${source} names is its own group. One inside another sets "parent" to the zone that holds it, wherever ${source} says so, and "kind" (${zoneKinds}) when ${source} names what a zone is. Set "shape", also on a start or end: "database" for databases, "document" for files, archives and reports, "queue" for queues, streams and topics, "storage" for buckets and object stores; only users stay ellipses. In an architecture the entry is the start and each sink an end.`,
	/**
	 * The MCP's compact forms of decisionEdges, groups and lanes: the execute code parameter carries
	 * every flowchart rule on every turn, inside a fixed character budget.
	 */
	decisionsCompact: "Decision nodes need meaningful labeled outgoing branches, usually yes/no.",
	lanesCompact: (source: RuleSource) =>
		`For swimlanes, a process across actors or roles, declare lanes in ${source}'s order and set each node's lane to its actor; lanes take no groups.`,
	groupsCompact: (source: RuleSource) =>
		`Only when ${source} groups steps (teams, zones, phases), declare groups and set each member's group to its innermost group id; others stay ungrouped. Nested zones set parent (subnet in VPC) and kind. Set shape, even on a start or end: "database" databases; "document" files, archives, reports; "queue" queues, streams, topics; "storage" buckets, object stores. Only users stay ellipses. An architecture starts at its entry and ends at each sink.`,
	zonesOutside: "Anything stated as outside a zone stays outside it.",
	lanes: (source: RuleSource) =>
		`For swimlanes, a process across actors or roles, add lanes [{ "id", "label" }] in ${source}'s order and set every node's lane to its actor; lanes take no groups.`,
	direction: (source: RuleSource) =>
		`Use layout { "direction": "TB", "edgeRouting": "orthogonal" } unless ${source} says otherwise.`,
	limits: `At most ${FLOWCHART_MAX_NODES} nodes and ${FLOWCHART_MAX_EDGES} edges.`,
	limitsDetail: "Larger graphs fail with flowchart_too_large before render or persistence.",
	summarize:
		"Summarize a broad or vague repo/system architecture prompt into 8-14 high-signal nodes on a single readable spine with short side branches, not a dense dependency graph with one node per package or many crossing links.",
	/** Where the generation prompt also says never to drop stated content to fit a limit. */
	summarizeOnlyUnnamed: "Summarize only a request that names no steps or parts of its own.",
	layers:
		"When a prompt asks how packages or systems interact, group related packages into layers and show the main flow of responsibility. Use labels/descriptions for detail instead of adding every possible transitive edge.",
	keepNamed: (source: RuleSource) =>
		`Keep every package and component ${source} names under its own name; summarizing drops unnamed detail and never renames or generalizes named parts.`,
	/**
	 * The flowchart document's own rules: MCP and Studio chat author it today, and the
	 * generation prompt moves to it next.
	 */
	documentShape:
		'nodes map an id to its label or { label, … }; an edge is [from, to] or [from, to, "label"], and an end may list ids: [["web", "api"], "rds"] is one edge per id.',
	documentRoles: (source: RuleSource) =>
		`Sketchi reads roles from the edges: a question label is a decision, a node nothing enters starts the flow and one nothing leaves ends it. Draw only the steps and arrows ${source} states: a branch with no stated next step ends at its last step, with no onward arrow or closing node.`,
	documentBranches: (source: RuleSource) =>
		`Label every branch of a question with ${source}'s outcome words, usually "yes" and "no", each label once.`,
	documentLoops:
		'A step that repeats ("try again", "resubmit", "keeps waiting") points back to the step it repeats, never to itself.',
	documentGroups: (source: RuleSource) =>
		`Only when ${source} groups steps (teams, zones, phases), declare groups: { id: { label, kind?, contains: [ids] } }, each listing the nodes and groups ${source} puts in it; a group may list members at any depth and Sketchi nests them. Every zone ${source} names is its own group; anything ${source} keeps outside a zone stays out of its list. Set kind (${zoneKinds}) when ${source} says what a zone is. Set shape on infrastructure nodes, entries and ends too: "database" for databases, "document" for files, archives and reports, "queue" for queues, streams and topics, "storage" for buckets and object stores.`,
	documentLanes: (source: RuleSource) =>
		`For swimlanes, a process across actors or roles, declare lanes: { id: { label, contains: [ids] } } in ${source}'s order, every step in its actor's lane; lanes take no groups.`,
	documentLogos: (source: RuleSource) =>
		`When ${source} names technologies or asks for logos, set logos: true and each node whose label names a product draws its logo. A node's icon: "Name" picks a logo its label does not name, and icon: null drops one.`,
	documentDirection: (source: RuleSource) =>
		`Set direction: "LR" only when ${source} reads left to right; flowcharts run top to bottom otherwise.`,
	documentNoInventedSteps: (source: RuleSource) =>
		`Do not add decisions, loops, steps, or edges ${source} does not state; a step that handles "any errors" or acts "if needed" stays one step in sequence.`,
} as const;
