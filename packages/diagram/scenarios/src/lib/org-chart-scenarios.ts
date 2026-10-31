import {
	type OrgChartDiagram,
	type OrgPerson,
	orgChartReports,
	orgChartRoots,
	parseOrgChartDiagram,
} from "@sketchi/diagram-core";
import { orgChartLayoutIssues, type RenderedDiagramScene } from "@sketchi/diagram-renderer";

import type { ScenarioCheck } from "./evaluate.js";
import type { DiagramScenarioDifficulty } from "./scenarios.js";

/** A person the prompt names: the names and titles they may go by, and whom they report to. */
export interface OrgChartScenarioPerson {
	readonly names: readonly string[];
	/** Accepted titles; empty when the prompt states none. */
	readonly titles: readonly string[];
	/** Accepted departments, when the prompt states one. */
	readonly departments?: readonly string[];
	/** The key of their manager; none for the top person. */
	readonly manager?: string;
	readonly assistant: boolean;
}

/** A dotted-line report the prompt states, between people by key. */
export interface OrgChartScenarioDottedLine {
	readonly report: string;
	readonly manager: string;
	/** The scope or reason the prompt gives for it, which its label carries. */
	readonly scope?: string;
}

export interface OrgChartScenario {
	readonly assertions: {
		readonly people: Readonly<Record<string, OrgChartScenarioPerson>>;
		readonly dottedLines: readonly OrgChartScenarioDottedLine[];
		/** The prompt asks for departments drawn as regions. */
		readonly groupByDepartment: boolean;
	};
	readonly description: string;
	readonly diagramType: "org-chart";
	readonly difficulty: DiagramScenarioDifficulty;
	readonly expectedDiagram: OrgChartDiagram;
	readonly id: string;
	readonly logos: readonly [];
	readonly prompt: string;
	readonly tags: readonly string[];
	readonly title: string;
}

/** Names and titles compare without case, spaces or punctuation: "Head of Product" matches "head-of-product". */
const key = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const matchesAny = (found: string | undefined, accepted: readonly string[]) =>
	found !== undefined && accepted.some((value) => key(value) === key(found));

/**
 * Org chart checks score what the prompt states, each on its own: every
 * person by name with their title and department, the manager each reports
 * to (none for the top), every assistant and dotted-line report, no person or
 * dotted line the prompt does not state, and department regions when asked.
 */
export function orgChartScenarioChecks(
	scenario: OrgChartScenario,
	diagram: OrgChartDiagram,
): ScenarioCheck[] {
	const { people, dottedLines } = scenario.assertions;
	const matched = new Map(
		Object.entries(people).map(([personKey, expected]) => [
			personKey,
			diagram.people.find((person) => matchesAny(person.name, expected.names)),
		]),
	);
	const nameOf = (personKey: string) => people[personKey]!.names[0]!;
	const personChecks = Object.entries(people).flatMap(([personKey, expected]): ScenarioCheck[] => {
		const person = matched.get(personKey);
		const name = nameOf(personKey);
		const manager = expected.manager === undefined ? undefined : matched.get(expected.manager);
		return [
			{
				id: `person:${personKey}`,
				passed: person !== undefined,
				message: `Expected a person named "${expected.names.join('" or "')}".`,
			},
			...(expected.titles.length > 0
				? [
						{
							id: `title:${personKey}`,
							passed: matchesAny(person?.title, expected.titles),
							message: `Expected "${name}" to have title "${expected.titles.join('" or "')}"${person?.title ? `; found "${person.title}"` : ""}.`,
						},
					]
				: []),
			...(expected.departments
				? [
						{
							id: `department:${personKey}`,
							passed: matchesAny(person?.department, expected.departments),
							message: `Expected "${name}" in department "${expected.departments.join('" or "')}".`,
						},
					]
				: []),
			{
				id: `manager:${personKey}`,
				passed:
					person !== undefined &&
					(expected.manager === undefined
						? person.manager === undefined
						: manager !== undefined && person.manager === manager.id),
				message:
					expected.manager === undefined
						? `Expected "${name}" at the top, reporting to no one.`
						: `Expected "${name}" to report to "${nameOf(expected.manager)}".`,
			},
			...(expected.assistant
				? [
						{
							id: `assistant:${personKey}`,
							passed: person?.assistant === true,
							message: `Expected "${name}" drawn as an assistant beside their manager.`,
						},
					]
				: []),
		];
	});
	const lineChecks = dottedLines.flatMap((expected, index): ScenarioCheck[] => {
		const [report, manager] = [matched.get(expected.report), matched.get(expected.manager)];
		const lines = diagram.dottedLines.filter(
			(line) => line.report === report?.id && line.manager === manager?.id,
		);
		const { scope } = expected;
		return [
			{
				id: `dotted-line:${index + 1}`,
				passed: report !== undefined && manager !== undefined && lines.length > 0,
				message: `Expected a dotted line from "${nameOf(expected.report)}" to "${nameOf(expected.manager)}".`,
			},
			...(scope === undefined
				? []
				: [
						{
							id: `dotted-line-scope:${index + 1}`,
							passed: lines.some((line) => key(line.label ?? "").includes(key(scope))),
							message: `Expected the dotted line from "${nameOf(expected.report)}" to "${nameOf(expected.manager)}" labeled with its stated scope, "${scope}".`,
						},
					]),
		];
	});
	const stated = new Set(
		Object.entries(people).flatMap(([personKey, expected]) =>
			expected.assistant ? (matched.get(personKey)?.id ?? []) : [],
		),
	);
	const count = Object.keys(people).length;
	return [
		...personChecks,
		{
			id: "people-exact",
			passed: diagram.people.length === count,
			message: `Expected exactly ${count} people; found ${diagram.people.length}.`,
		},
		{
			id: "assistants-stated",
			passed: diagram.people.every((person) => !person.assistant || stated.has(person.id)),
			message: "Expected no assistant the prompt does not state.",
		},
		...lineChecks,
		{
			id: "dotted-lines-exact",
			passed: diagram.dottedLines.length === dottedLines.length,
			message: `Expected exactly ${dottedLines.length} dotted lines; found ${diagram.dottedLines.length}.`,
		},
		...(scenario.assertions.groupByDepartment
			? [
					{
						id: "department-regions",
						passed: diagram.groupByDepartment === true,
						message: "Expected departments grouped into regions (groupByDepartment: true).",
					},
				]
			: []),
	];
}

const flat = (text: string | undefined) => (text ?? "").replace(/\s+/gu, "");

/** Department roots below the top, outermost only: where the renderer draws regions. */
function expectedRegions(diagram: OrgChartDiagram): Map<string, string> {
	const regions = new Map<string, string>();
	if (diagram.groupByDepartment !== true) return regions;
	const reports = orgChartReports(diagram);
	const byId = new Map(diagram.people.map((person) => [person.id, person]));
	const visit = (person: OrgPerson, inside: boolean) => {
		const manager = person.manager === undefined ? undefined : byId.get(person.manager);
		const starts =
			!inside &&
			manager !== undefined &&
			person.department !== undefined &&
			person.department !== manager.department &&
			(reports.get(person.id)?.length ?? 0) > 0;
		if (starts) regions.set(person.id, person.department);
		for (const report of reports.get(person.id) ?? []) visit(report, inside || starts);
	};
	for (const root of orgChartRoots(diagram)) visit(root, false);
	return regions;
}

/**
 * The drawn scene says what the diagram says: a card for every person showing
 * their name and title, a solid line without heads from each manager to each
 * report, each dotted-line report dashed with a head at its second manager,
 * and, when grouping, a region named for each department below the top.
 */
export function orgChartDrawnCheck(
	diagram: OrgChartDiagram,
	scene: RenderedDiagramScene,
): ScenarioCheck {
	const byId = new Map(scene.elements.map((element) => [element.id, element]));
	const text = (id: string) => {
		const element = byId.get(id);
		return element?.type === "text" ? element.text : undefined;
	};
	const problems: string[] = [];
	for (const person of diagram.people) {
		if (byId.get(`node:${person.id}`)?.type !== "node") problems.push(`${person.id} card`);
		const name = text(`text:${person.id}:name`) ?? text(`label:${person.id}`);
		if (flat(name) !== flat(person.name)) problems.push(`${person.id} name`);
		if (person.title && !flat(text(`label:${person.id}`)).includes(flat(person.title)))
			problems.push(`${person.id} title`);
		if (person.manager === undefined) continue;
		const line = byId.get(`edge:${person.id}`);
		if (
			line?.type !== "arrow" ||
			line.sourceNodeId !== person.manager ||
			line.targetNodeId !== person.id ||
			(line.strokeStyle ?? "solid") !== "solid" ||
			(line.endArrowhead ?? null) !== null
		)
			problems.push(`${person.id} reporting line`);
	}
	for (const dotted of diagram.dottedLines) {
		const line = byId.get(`edge:dotted:${dotted.id}`);
		if (
			line?.type !== "arrow" ||
			line.sourceNodeId !== dotted.report ||
			line.targetNodeId !== dotted.manager ||
			line.strokeStyle !== "dashed" ||
			line.endArrowhead !== "arrow"
		)
			problems.push(`${dotted.id} dotted line`);
		if (dotted.label && flat(text(`text:dotted:${dotted.id}`)) !== flat(dotted.label))
			problems.push(`${dotted.id} dotted line label`);
	}
	for (const [root, department] of expectedRegions(diagram)) {
		const frame = byId.get(`frame:${root}`);
		if (frame?.type !== "frame" || frame.name !== department) problems.push(`${department} region`);
	}
	return {
		id: "org-chart-drawn",
		passed: problems.length === 0,
		message:
			problems.length === 0
				? "Every card, name, title, reporting line, dotted line and region is drawn as the diagram states."
				: `Drawn differently from the diagram: ${problems.slice(0, 8).join(", ")}.`,
	};
}

/** Cards apart, lines orthogonal from card to card and through none, reporting lines never crossing. */
export function orgChartLayoutCheck(scene: RenderedDiagramScene): ScenarioCheck {
	const issues = orgChartLayoutIssues(scene);
	return {
		id: "org-chart-layout",
		passed: issues.length === 0,
		message:
			issues.length === 0
				? "Cards stand apart, every line runs orthogonally between cards and through none, and no reporting lines cross."
				: issues
						.slice(0, 6)
						.map((issue) => issue.message)
						.join(" "),
	};
}

type PersonDefinition = readonly [
	key: string,
	/** The name as stated, or every form it may take. */
	names: string | readonly string[],
	/** The title as stated, every form it may take, or none. */
	titles: string | readonly string[] | undefined,
	manager?: string,
	extra?: { readonly department?: string | readonly string[]; readonly assistant?: true },
];

interface OrgChartScenarioDefinition {
	readonly id: string;
	readonly title: string;
	readonly difficulty: DiagramScenarioDifficulty;
	readonly tags: readonly string[];
	readonly description: string;
	readonly prompt: string;
	readonly people: readonly PersonDefinition[];
	readonly dottedLines?: readonly (readonly [report: string, manager: string, scope?: string])[];
	readonly groupByDepartment?: boolean;
}

const list = (value: string | readonly string[] | undefined): readonly string[] =>
	value === undefined ? [] : typeof value === "string" ? [value] : value;

function defineOrgChartScenario(definition: OrgChartScenarioDefinition): OrgChartScenario {
	const { people, dottedLines = [], groupByDepartment = false, ...scenario } = definition;
	return {
		...scenario,
		diagramType: "org-chart",
		logos: [],
		assertions: {
			people: Object.fromEntries(
				people.map(([personKey, names, titles, manager, extra]) => [
					personKey,
					{
						names: list(names),
						titles: list(titles),
						...(extra?.department ? { departments: list(extra.department) } : {}),
						...(manager === undefined ? {} : { manager }),
						assistant: extra?.assistant === true,
					},
				]),
			),
			dottedLines: dottedLines.map(([report, manager, scope]) => ({
				report,
				manager,
				...(scope === undefined ? {} : { scope }),
			})),
			groupByDepartment,
		},
		expectedDiagram: parseOrgChartDiagram({
			id: definition.id,
			title: definition.title,
			type: "org-chart",
			people: people.map(([id, names, titles, manager, extra]) => ({
				id,
				name: list(names)[0],
				...(titles === undefined ? {} : { title: list(titles)[0] }),
				...(extra?.department ? { department: list(extra.department)[0] } : {}),
				...(manager === undefined ? {} : { manager }),
				...(extra?.assistant ? { assistant: true } : {}),
			})),
			dottedLines: dottedLines.map(([report, manager, scope]) => ({
				id: `${report}-dotted-${manager}`,
				report,
				manager,
				...(scope === undefined ? {} : { label: scope }),
			})),
			...(groupByDepartment ? { groupByDepartment: true } : {}),
		}),
	};
}

const LUMEN_LABS_PEOPLE: readonly PersonDefinition[] = [
	["maya", "Maya Chen", ["CEO", "Chief Executive Officer"]],
	["jordan", "Jordan Patel", ["CTO", "Chief Technology Officer"], "maya"],
	["priya", "Priya Nair", "Head of Product", "maya"],
	["sam", "Sam Rivera", "Head of Growth", "maya"],
	["alex", "Alex Kim", "Senior Backend Engineer", "jordan"],
	["taylor", "Taylor Brooks", "Frontend Engineer", "jordan"],
	["chris", "Chris Morgan", "DevOps Engineer", "jordan"],
	["jamie", "Jamie Lee", "ML Engineer", "jordan"],
	["riley", "Riley Adams", "Product Designer", "priya"],
	["casey", "Casey Wong", "Product Manager", "priya"],
	["morgan", "Morgan Diaz", "Marketing Lead", "sam"],
	["avery", "Avery Scott", "Sales Lead", "sam"],
];

const ENGINEERING_DEPARTMENT_PEOPLE: readonly PersonDefinition[] = [
	[
		"elena",
		"Elena Petrova",
		["VP of Engineering", "VP Engineering", "Vice President of Engineering"],
	],
	["marcus", "Marcus Johnson", "Director of Platform", "elena"],
	["aisha", "Aisha Bello", "Director of Product Engineering", "elena"],
	["tomas", ["Tomás García", "Tomas Garcia"], "Director of Infrastructure", "elena"],
	["wei", "Wei Zhang", "Staff Engineer", "elena"],
	["ivan", "Ivan Novak", "Senior Engineer", "marcus"],
	["hannah", "Hannah Schmidt", "Senior Engineer", "marcus"],
	["diego", "Diego Ramos", "Engineer", "marcus"],
	["leila", "Leila Haddad", "Engineer", "marcus"],
	["owen", "Owen Price", "Engineer", "marcus"],
	["yuki", "Yuki Tanaka", "Engineer", "marcus"],
	["sofia", "Sofia Rossi", "Senior Engineer", "aisha"],
	["kwame", "Kwame Mensah", "Senior Engineer", "aisha"],
	["laura", "Laura Kowalski", "Engineer", "aisha"],
	["ben", "Ben Okafor", "Engineer", "aisha"],
	["mei", "Mei Lin", "Engineer", "aisha"],
	["noah", "Noah Fischer", "Engineer", "aisha"],
	["zara", "Zara Ahmed", "Engineer", "aisha"],
	["lucas", "Lucas Silva", "Associate Engineer", "aisha"],
	["anna", "Anna Berg", "Site Reliability Lead", "tomas"],
	["raj", "Raj Iyer", "Site Reliability Engineer", "tomas"],
	["chloe", "Chloe Martin", "Network Engineer", "tomas"],
	["pavel", "Pavel Sokolov", "Database Administrator", "tomas"],
	["grace", "Grace Obi", "Security Engineer", "tomas"],
	["felix", "Felix Wagner", "Cloud Engineer", "tomas"],
];

const NORTHWIND_LEADERSHIP_PEOPLE: readonly PersonDefinition[] = [
	["sarah", ["Dr. Sarah Okafor", "Sarah Okafor"], ["Chief Executive Officer", "CEO"]],
	["daniel", "Daniel Kim", "Executive Assistant", "sarah", { assistant: true }],
	["michael", "Michael Torres", ["Chief Financial Officer", "CFO"], "sarah"],
	["linda", "Linda Park", ["Chief Operating Officer", "COO"], "sarah"],
	["rahul", "Rahul Mehta", ["Chief Technology Officer", "CTO"], "sarah"],
	["grace", "Grace Liu", "Controller", "michael"],
	["owen", "Owen Hughes", ["FP&A Manager", "FPA Manager"], "michael"],
	["fatima", "Fatima Hassan", "Director of Clinical Operations", "linda"],
	["ben", "Ben Carter", "Director of Facilities", "linda"],
	["nina", "Nina Rossi", "Director of IT", "rahul"],
	["victor", "Victor Alvarez", "Security Lead", "rahul"],
];

const COMMERCIAL_ORGANIZATION_PEOPLE: readonly PersonDefinition[] = [
	["olivia", "Olivia Grant", ["Chief Revenue Officer", "CRO"]],
	["ethan", "Ethan Brooks", ["VP of Sales", "VP Sales"], "olivia", { department: "Sales" }],
	["hana", "Hana Sato", ["VP of Marketing", "VP Marketing"], "olivia", { department: "Marketing" }],
	[
		"carlos",
		"Carlos Mendes",
		["VP of Customer Success", "VP Customer Success"],
		"olivia",
		{ department: "Customer Success" },
	],
	["mia", "Mia Johansson", "Enterprise Account Executive", "ethan", { department: "Sales" }],
	[
		"liam",
		["Liam O'Brien", "Liam OBrien"],
		"Mid-Market Account Executive",
		"ethan",
		{ department: "Sales" },
	],
	["ava", "Ava Kowalczyk", "Sales Development Manager", "ethan", { department: "Sales" }],
	["noor", "Noor Rahman", "Sales Engineer", "ethan", { department: "Sales" }],
	[
		"jack",
		"Jack Wilson",
		["Sales Development Representative", "SDR"],
		"ava",
		{ department: "Sales" },
	],
	["isla", "Isla Murphy", "Content Marketing Manager", "hana", { department: "Marketing" }],
	["leo", "Leo Martins", "Demand Generation Manager", "hana", { department: "Marketing" }],
	["ruby", "Ruby Chen", "Product Marketing Manager", "hana", { department: "Marketing" }],
	[
		"samuel",
		"Samuel Adeyemi",
		"Customer Success Manager",
		"carlos",
		{ department: "Customer Success" },
	],
	["elif", "Elif Yilmaz", "Support Lead", "carlos", { department: "Customer Success" }],
];

const orgChartScenarioDefinitions: readonly OrgChartScenarioDefinition[] = [
	{
		id: "startup-team-org-chart-v2",
		title: "Lumen Labs team",
		difficulty: "smoke",
		tags: ["org-chart", "startup", "small-team", "real-voice"],
		description:
			"A twelve-person startup: a CEO, three leads under her, and their teams of two to four.",
		prompt: [
			"org chart for Lumen Labs",
			"",
			"name, title, reports to",
			"Maya Chen, CEO,",
			"Jordan Patel, CTO, Maya Chen",
			"Priya Nair, Head of Product, Maya Chen",
			"Sam Rivera, Head of Growth, Maya Chen",
			"Alex Kim, Senior Backend Engineer, Jordan Patel",
			"Taylor Brooks, Frontend Engineer, Jordan Patel",
			"Chris Morgan, DevOps Engineer, Jordan Patel",
			"Jamie Lee, ML Engineer, Jordan Patel",
			"Riley Adams, Product Designer, Priya Nair",
			"Casey Wong, Product Manager, Priya Nair",
			"Morgan Diaz, Marketing Lead, Sam Rivera",
			"Avery Scott, Sales Lead, Sam Rivera",
		].join("\n"),
		people: LUMEN_LABS_PEOPLE,
	},
	{
		id: "engineering-department-org-chart-v2",
		title: "Engineering department",
		difficulty: "standard",
		tags: ["org-chart", "department", "wide-team", "three-levels", "real-voice"],
		description:
			"A 25-person engineering department over three levels: a VP, a staff engineer and three directors, one of them with eight engineers.",
		prompt: [
			"org chart of the engineering dept",
			"",
			"name, title, reports to",
			"Elena Petrova, VP of Engineering,",
			"Marcus Johnson, Director of Platform, Elena Petrova",
			"Aisha Bello, Director of Product Engineering, Elena Petrova",
			"Tomás García, Director of Infrastructure, Elena Petrova",
			"Wei Zhang, Staff Engineer, Elena Petrova",
			"Ivan Novak, Senior Engineer, Marcus Johnson",
			"Hannah Schmidt, Senior Engineer, Marcus Johnson",
			"Diego Ramos, Engineer, Marcus Johnson",
			"Leila Haddad, Engineer, Marcus Johnson",
			"Owen Price, Engineer, Marcus Johnson",
			"Yuki Tanaka, Engineer, Marcus Johnson",
			"Sofia Rossi, Senior Engineer, Aisha Bello",
			"Kwame Mensah, Senior Engineer, Aisha Bello",
			"Laura Kowalski, Engineer, Aisha Bello",
			"Ben Okafor, Engineer, Aisha Bello",
			"Mei Lin, Engineer, Aisha Bello",
			"Noah Fischer, Engineer, Aisha Bello",
			"Zara Ahmed, Engineer, Aisha Bello",
			"Lucas Silva, Associate Engineer, Aisha Bello",
			"Anna Berg, Site Reliability Lead, Tomás García",
			"Raj Iyer, Site Reliability Engineer, Tomás García",
			"Chloe Martin, Network Engineer, Tomás García",
			"Pavel Sokolov, Database Administrator, Tomás García",
			"Grace Obi, Security Engineer, Tomás García",
			"Felix Wagner, Cloud Engineer, Tomás García",
		].join("\n"),
		people: ENGINEERING_DEPARTMENT_PEOPLE,
	},
	{
		id: "leadership-dotted-line-org-chart-v2",
		title: "Northwind Health leadership",
		difficulty: "standard",
		tags: ["org-chart", "assistant", "dotted-line", "matrix", "real-voice"],
		description:
			"A hospital group's leadership: a CEO with an executive assistant, three chiefs and their directors, and a director with a dotted-line report to another chief for a stated scope.",
		prompt: [
			"leadership org chart for Northwind Health",
			"",
			"name, title, reports to",
			"Dr. Sarah Okafor, Chief Executive Officer,",
			"Daniel Kim, Executive Assistant, Dr. Sarah Okafor",
			"Michael Torres, Chief Financial Officer, Dr. Sarah Okafor",
			"Linda Park, Chief Operating Officer, Dr. Sarah Okafor",
			"Rahul Mehta, Chief Technology Officer, Dr. Sarah Okafor",
			"Grace Liu, Controller, Michael Torres",
			"Owen Hughes, FP&A Manager, Michael Torres",
			"Fatima Hassan, Director of Clinical Operations, Linda Park",
			"Ben Carter, Director of Facilities, Linda Park",
			"Nina Rossi, Director of IT, Rahul Mehta",
			"Victor Alvarez, Security Lead, Rahul Mehta",
			"",
			"nina also has a dotted line to linda for clinical systems",
		].join("\n"),
		people: NORTHWIND_LEADERSHIP_PEOPLE,
		dottedLines: [["nina", "linda", "clinical systems"]],
	},
	{
		id: "sales-regions-org-chart-v2",
		title: "Commercial organization",
		difficulty: "standard",
		tags: ["org-chart", "departments", "regions", "real-voice"],
		description:
			"A commercial organization of fourteen grouped into Sales, Marketing and Customer Success regions under a Chief Revenue Officer.",
		prompt: [
			"org chart of our commercial org, grouped by department",
			"",
			"name, title, department, reports to",
			"Olivia Grant, Chief Revenue Officer, ,",
			"Ethan Brooks, VP of Sales, Sales, Olivia Grant",
			"Hana Sato, VP of Marketing, Marketing, Olivia Grant",
			"Carlos Mendes, VP of Customer Success, Customer Success, Olivia Grant",
			"Mia Johansson, Enterprise Account Executive, Sales, Ethan Brooks",
			"Liam O'Brien, Mid-Market Account Executive, Sales, Ethan Brooks",
			"Ava Kowalczyk, Sales Development Manager, Sales, Ethan Brooks",
			"Noor Rahman, Sales Engineer, Sales, Ethan Brooks",
			"Jack Wilson, Sales Development Representative, Sales, Ava Kowalczyk",
			"Isla Murphy, Content Marketing Manager, Marketing, Hana Sato",
			"Leo Martins, Demand Generation Manager, Marketing, Hana Sato",
			"Ruby Chen, Product Marketing Manager, Marketing, Hana Sato",
			"Samuel Adeyemi, Customer Success Manager, Customer Success, Carlos Mendes",
			"Elif Yilmaz, Support Lead, Customer Success, Carlos Mendes",
		].join("\n"),
		groupByDepartment: true,
		people: COMMERCIAL_ORGANIZATION_PEOPLE,
	},
];

export const orgChartScenarios: readonly OrgChartScenario[] =
	orgChartScenarioDefinitions.map(defineOrgChartScenario);
