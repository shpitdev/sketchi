/**
 * Every word Jev reads when it narrows an untyped request to the diagram families it could
 * mean, and the thresholds code reads its answers with. Nothing here names a scenario: each
 * option says what a family draws, and what separates it from the families it is confused with.
 */
import type { DiagramTypeValue } from "@sketchi/diagram-core";
import { Decision } from "effect/ai";
import { Schema } from "effect";

/** Pinned, not an alias, so a graded result stays reproducible. */
export const FAMILY_NARROWING_MODEL = "jev-1.14.0";

/** A Noul above `yes` reads as yes, below `no` as no; between, the question is not settled. */
export const FAMILY_THRESHOLDS = {
	/** A re-check's Choice at or above this, with its own Noul a yes, settles one family. */
	sure: 0.7,
	yes: 0.7,
	no: 0.3,
	/** The most families a narrowed prompt carries; more gets the full prompt. */
	maxFamilies: 3,
} as const;

export interface FamilyOption {
	readonly family: DiagramTypeValue;
	/** What a person calls this kind of diagram. */
	readonly label: string;
	/** What a request for one states, as a noun phrase. */
	readonly content: string;
	/** The fuller description a shortlist is re-checked with. */
	readonly detail: {
		readonly draws: string;
		readonly not_for: string;
	};
}

/**
 * One option per kind of diagram a person asks for. A flowchart draws two different things, a
 * process and a system's architecture, so it has an option for each.
 */
export const FAMILY_OPTIONS = {
	process_flowchart: {
		family: "flowchart",
		label: "process flowchart",
		content: "the steps of a process or workflow, with decisions that branch it",
		detail: {
			draws:
				"The steps of a process or workflow in order, the decisions that branch it and its outcomes, as boxes and arrows, optionally in swimlanes for who does each step.",
			not_for:
				"messages that named systems send back and forth in time order, which is a sequence diagram; the states one thing moves between, which is a state machine.",
		},
	},
	architecture_diagram: {
		family: "flowchart",
		label: "architecture diagram",
		content:
			"the parts of a software or infrastructure system, such as services, databases and networks, and how they connect",
		detail: {
			draws:
				"The components of a software or infrastructure system, such as clients, services, databases, queues and networks, how requests or data move between them, and the zones, subnets or clusters that group them.",
			not_for:
				"the order of the messages in one interaction, which is a sequence diagram; database tables and their columns, which is an entity-relationship diagram.",
		},
	},
	mind_map: {
		family: "mindmap",
		label: "mind map",
		content: "one central topic broken down into subtopics and ideas",
		detail: {
			draws:
				"One central topic branching into subtopics, and those into smaller ideas, as a tree of notes.",
			not_for:
				"people and who they report to, which is an org chart; steps in an order, which is a flowchart.",
		},
	},
	sequence_diagram: {
		family: "sequence",
		label: "sequence diagram",
		content:
			"the messages that participants such as people, apps or services send each other, in time order",
		detail: {
			draws:
				"Named participants, such as a user, an app and its services, and the requests, calls and replies they send each other, top to bottom in time order.",
			not_for:
				"a process of steps and decisions without participants exchanging messages, which is a flowchart.",
		},
	},
	timeline: {
		family: "timeline",
		label: "timeline",
		content: "events or milestones in the order they happen, with or without dates",
		detail: {
			draws:
				"Events, milestones or phases placed along one line in the order they happen, by date or by sequence.",
			not_for:
				"tasks with durations and dependencies on a schedule, which is a Gantt chart; numbers over time, which is a line chart.",
		},
	},
	data_chart: {
		family: "chart",
		label: "bar, line or pie chart",
		content: "numbers to plot, such as values per category or over time",
		detail: {
			draws: "Numeric values per category or over time, as bars, lines or pie slices.",
			not_for:
				"amounts that flow from sources to destinations, which is a Sankey diagram; items placed by two measures, which is a quadrant chart.",
		},
	},
	state_machine: {
		family: "state-machine",
		label: "state machine",
		content: "the states one thing can be in and the events that move it between them",
		detail: {
			draws:
				"The states one object or system can be in, where it starts, and the events or transitions that move it from state to state.",
			not_for: "the steps of a process that a person or team carries out, which is a flowchart.",
		},
	},
	gantt_chart: {
		family: "gantt",
		label: "Gantt chart",
		content: "project tasks with start dates, durations or end dates",
		detail: {
			draws:
				"A project schedule: tasks with start dates, durations or end dates, grouped in phases, with dependencies and milestones.",
			not_for: "single dated events without durations, which is a timeline.",
		},
	},
	er_diagram: {
		family: "er",
		label: "entity-relationship diagram",
		content: "database tables or entities, their columns or fields, and how they relate",
		detail: {
			draws:
				"Database tables or data entities with their columns, keys and types, and the relationships between them with their cardinalities.",
			not_for: "classes with methods in object-oriented code, which is a class diagram.",
		},
	},
	class_diagram: {
		family: "class",
		label: "class diagram",
		content:
			"classes or interfaces with fields and methods, and how they inherit from or use each other",
		detail: {
			draws:
				"Classes and interfaces with their attributes and methods, and inheritance, composition and associations between them, as in a UML class diagram or object-oriented code.",
			not_for: "database tables and their columns, which is an entity-relationship diagram.",
		},
	},
	org_chart: {
		family: "org-chart",
		label: "org chart",
		content: "people with their job titles and who reports to whom",
		detail: {
			draws: "The people of a team or company with their titles, arranged by who reports to whom.",
			not_for: "topics broken into subtopics, which is a mind map.",
		},
	},
	venn_diagram: {
		family: "venn",
		label: "Venn diagram",
		content: "two or three groups and what each overlap of them shares",
		detail: {
			draws:
				"Two or three overlapping sets, and which items belong to one set only or to each overlap.",
			not_for: "items placed on a grid by two measures, which is a quadrant chart.",
		},
	},
	journey_map: {
		family: "journey",
		label: "customer journey map",
		content: "a person's experience through stages of steps, scored for how they feel",
		detail: {
			draws:
				"One person's experience of a product or service across stages, each step scored for how they feel, with touchpoints, pain points and opportunities.",
			not_for: "the steps of a process with decisions, which is a flowchart.",
		},
	},
	sankey_diagram: {
		family: "sankey",
		label: "Sankey diagram",
		content: "amounts that flow from sources to destinations",
		detail: {
			draws:
				"Quantities such as money, energy, traffic or people flowing from sources through stages to destinations, each flow as wide as its amount.",
			not_for: "values compared per category, which is a bar or pie chart.",
		},
	},
	wireframe: {
		family: "wireframe",
		label: "wireframe",
		content:
			"the layout of an app screen or web page, such as headings, inputs, buttons and navigation",
		detail: {
			draws:
				"The layout of one or more screens of an app or website: headings, text, inputs, buttons, tables, tabs and navigation, in place.",
			not_for: "the steps a user takes through an app, which is a flowchart or journey map.",
		},
	},
	quadrant_chart: {
		family: "quadrant",
		label: "quadrant chart",
		content: "items placed on a two-by-two grid by two measures",
		detail: {
			draws:
				"Items placed in a two-by-two grid by two measures, such as effort and impact or urgency and importance, with a name for each quadrant.",
			not_for: "values compared on one axis, which is a bar chart.",
		},
	},
} as const satisfies Readonly<Record<string, FamilyOption>>;

export type FamilyOptionName = keyof typeof FAMILY_OPTIONS;
export const FAMILY_OPTION_NAMES = Object.keys(FAMILY_OPTIONS).filter(isFamilyOptionName);

export function isFamilyOptionName(name: string): name is FamilyOptionName {
	return Object.hasOwn(FAMILY_OPTIONS, name);
}

/** What Jev reads: the request, as the user typed it. */
export const FamilyNarrowingInput = Schema.Struct({ request: Schema.String });

function criteria(
	options: readonly FamilyOptionName[],
	describe: (option: FamilyOption) => Decision.Description,
): Record<string, Decision.Description> {
	return Object.fromEntries(options.map((option) => [option, describe(FAMILY_OPTIONS[option])]));
}

/** The Choice that ranks every option by what each one draws. */
export const whichKindQuestion = (options: readonly FamilyOptionName[] = FAMILY_OPTION_NAMES) =>
	Decision.classify({
		instructions: "Which kind of diagram draws what `request` asks for?",
		criteria: criteria(options, (option) => option.content),
	});

/** The companion to the Choice: does any of the kinds fit at all? */
export const anyKindFitsQuestion = Decision.probability({
	instructions: {
		question: "Can what `request` asks for be drawn as one of these kinds of diagram?",
		kinds: FAMILY_OPTION_NAMES.map((option) => FAMILY_OPTIONS[option].label),
	},
	criteria: {
		true: "The request asks for a diagram of content that one of these kinds draws.",
		false:
			"The request asks for no diagram, or for a picture none of these kinds draws, such as a photo, a 3D model or a floor plan.",
	},
});

/** The Choice that re-checks a shortlist, with each option's fuller description. */
export const whichOfShortlistQuestion = (options: readonly FamilyOptionName[]) =>
	Decision.classify({
		instructions:
			"Exactly one of these kinds of diagram is the right one for what `request` asks for. Which one? Read what each draws and what it is not for.",
		criteria: criteria(options, (option) => ({ kind: option.label, ...option.detail })),
	});

/** One Noul per shortlisted option: would this kind draw what the request asks for? */
export const kindFitsQuestion = (option: FamilyOptionName) => {
	const { detail, label } = FAMILY_OPTIONS[option];
	return Decision.probability({
		instructions: {
			question: `Would a ${label} draw what \`request\` asks for?`,
			[`a ${label} draws`]: detail.draws,
		},
		criteria: {
			true: `The request states what a ${label} draws.`,
			false: `The request asks for something else, such as ${detail.not_for}`,
		},
	});
};
