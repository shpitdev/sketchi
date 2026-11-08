import { DIAGRAM_ZONE_KINDS } from "../intermediate.js";
import { FLOWCHART_MAX_EDGES, FLOWCHART_MAX_NODES } from "../types/flowchart.js";
import type { RuleSource } from "./source.js";

const zoneKinds = `${DIAGRAM_ZONE_KINDS.slice(0, -1).join(", ")} or ${DIAGRAM_ZONE_KINDS.at(-1)}`;

/**
 * How a request becomes a flowchart. The generation prompt, the MCP docs and Studio chat each
 * render the rules they use from here; no surface words a flowchart rule of its own.
 */
export const FLOWCHART_RULES = {
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
	namedOutcomes: (source: RuleSource) =>
		`Use one node per outcome ${source} names: point every branch that reaches the same named outcome at that one node, and do not add end nodes ${source} does not name.`,
	technologyLabels:
		"Name technologies in node labels; a note draws as a small subtitle under the label, for detail.",
	zonesOutside: "Anything stated as outside a zone stays outside it.",
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
	/** The flowchart document's own rules, which every surface that writes one reads. */
	documentShape:
		'nodes map an id to its label or { label, … }; an edge is [from, to] or [from, to, "label"], and an end may list ids: [["web", "api"], "rds"] is one edge per id.',
	documentRoles: (source: RuleSource) =>
		`Sketchi reads roles from the edges: a question label is a decision, a node nothing enters starts the flow and one nothing leaves ends it. Draw only the steps and arrows ${source} states: a branch with no stated next step ends at its last step, with no onward arrow or closing node.`,
	documentNodeDetails:
		'A node is "Label", or { "label", "note"?, "shape"? } when it has a subtitle or a shape; give every database, queue, bucket and file its shape.',
	documentEdgeLabels: (source: RuleSource) =>
		`Label an arrow with the words ${source} gives it ("write orders", "publish jobs"): ["api", "db", "write orders"].`,
	documentZonesNotNodes: "A zone is only a group: never also a node, and never an arrow's end.",
	documentOwners: (source: RuleSource) =>
		`List each node, questions too, in the lane or group of whoever does it in ${source}, never of whoever it names or acts on: "support notifies the customer" is Support's, and a step redone after a rejection stays with whoever redoes it.`,
	documentFanOut:
		'A branch that leads to several steps lists them in one edge: ["short", ["notify", "reorder"], "yes"].',
	documentBranches: (source: RuleSource) =>
		`Label every branch of a question with ${source}'s outcome words, usually "yes" and "no", each label once.`,
	documentLoops:
		'A repeated step ("send another …", "try again", "resubmit") points back at the step it repeats, never at itself, and is never an end.',
	documentGroups: (source: RuleSource) =>
		`Only when ${source} groups steps (teams, zones, phases), declare groups: { id: { label, kind?, contains: [ids] } }, each listing the nodes and groups ${source} puts in it; a group may list members at any depth and Sketchi nests them. Every zone ${source} names is its own group; anything ${source} keeps outside a zone stays out of its list. Set kind (${zoneKinds}) when ${source} says what a zone is. Set shape on infrastructure nodes, entries and ends too: "database" for databases, "document" for files, archives and reports, "queue" for queues, streams and topics, "storage" for buckets and object stores.`,
	documentLanes: (source: RuleSource) =>
		`For swimlanes, a process across actors or roles, declare lanes: { id: { label, contains: [ids] } } in ${source}'s order, every step in its actor's lane; lanes take no groups.`,
	documentLogos: (source: RuleSource) =>
		`When ${source} names technologies or asks for logos, set logos: true: each node draws the logo of the first product its label names. icon: "Name" picks another, and icon: null drops it.`,
	documentDirection: (source: RuleSource) =>
		`Set direction: "LR" only when ${source} reads left to right; flowcharts run top to bottom otherwise.`,
	documentNoInventedSteps: (source: RuleSource) =>
		`Do not add decisions, loops, steps, or edges ${source} does not state; a step that handles "any errors" or acts "if needed" stays one step in sequence.`,
} as const;
