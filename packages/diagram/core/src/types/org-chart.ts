import { Effect, Schema } from "effect";

import { DiagramStyle, DiagramValidationError, SKETCHI_DIAGRAM_STYLE } from "../intermediate.js";

export const orgChartDiagramType = "org-chart" as const;

/** Larger organizations stop reading as one chart; draw each division on its own. */
export const ORG_CHART_MAX_PEOPLE = 100;
export const ORG_CHART_MAX_DOTTED_LINES = 24;
/** Reporting chains deeper than this stop reading top-down. */
export const ORG_CHART_MAX_DEPTH = 12;
export const ORG_CHART_MAX_NAME_LENGTH = 60;
export const ORG_CHART_MAX_TITLE_LENGTH = 80;
export const ORG_CHART_MAX_DEPARTMENT_LENGTH = 40;
export const ORG_CHART_MAX_LABEL_LENGTH = 40;
export const ORG_CHART_MAX_ISSUES = 20;

/**
 * One person or position, drawn as a card: the name, the title under it and
 * the department. `manager` is the person they report to; the chart's top
 * person has none. An assistant sits beside their manager instead of among
 * the manager's reports.
 */
export class OrgPerson extends Schema.Class<OrgPerson>("OrgPerson")({
	id: Schema.NonEmptyString,
	name: Schema.NonEmptyString,
	/** Job title or position, drawn under the name. */
	title: Schema.optionalKey(Schema.NonEmptyString),
	/** Team or department; people of one department share a color. */
	department: Schema.optionalKey(Schema.NonEmptyString),
	/** Id of the person they report to. */
	manager: Schema.optionalKey(Schema.NonEmptyString),
	/** Drawn beside the manager, off the reporting line; an assistant has no reports. */
	assistant: Schema.optionalKey(Schema.Boolean),
	/** Draw an initials placeholder for a photo. */
	avatar: Schema.optionalKey(Schema.Boolean),
}) {}
export const OrgPersonSchema = OrgPerson;

/**
 * A secondary, dotted-line or matrix report: `report` also answers to
 * `manager`, outside the solid reporting line.
 */
export class OrgDottedLine extends Schema.Class<OrgDottedLine>("OrgDottedLine")({
	id: Schema.NonEmptyString,
	report: Schema.NonEmptyString,
	manager: Schema.NonEmptyString,
	label: Schema.optionalKey(Schema.NonEmptyString),
}) {}
export const OrgDottedLineSchema = OrgDottedLine;

/**
 * The canonical org chart: people and the managers they report to, with
 * optional dotted-line reports. The renderer owns every coordinate. Every
 * surface that accepts, generates, renders or evaluates an org chart uses this
 * shape.
 */
export class OrgChartDiagram extends Schema.Class<OrgChartDiagram>("OrgChartDiagram")({
	id: Schema.NonEmptyString,
	title: Schema.NonEmptyString,
	type: Schema.Literal(orgChartDiagramType),
	people: Schema.Array(OrgPerson).pipe(Schema.mutable, Schema.check(Schema.isMinLength(1))),
	dottedLines: Schema.Array(OrgDottedLine).pipe(
		Schema.mutable,
		Schema.withDecodingDefault(Effect.succeed([])),
	),
	/** Draw each department below the top as a labeled region around its people. */
	groupByDepartment: Schema.optionalKey(Schema.Boolean),
	/** Several separate trees side by side, each with a top person of its own. */
	forest: Schema.optionalKey(Schema.Boolean),
	style: DiagramStyle.pipe(
		Schema.withDecodingDefault(Effect.succeed({ ...SKETCHI_DIAGRAM_STYLE })),
	),
}) {}
export const OrgChartDiagramSchema = OrgChartDiagram;

export const OrgChartValidationIssueCodeSchema = Schema.Literals([
	"org_chart_too_large",
	"invalid_person_id",
	"duplicate_person_id",
	"org_text_too_long",
	"unknown_manager",
	"self_manager",
	"reporting_cycle",
	"multiple_roots",
	"invalid_assistant",
	"duplicate_dotted_line_id",
	"invalid_dotted_line",
]);
export type OrgChartValidationIssueCode = typeof OrgChartValidationIssueCodeSchema.Type;

export class OrgChartValidationIssue extends Schema.Class<OrgChartValidationIssue>(
	"OrgChartValidationIssue",
)({
	code: OrgChartValidationIssueCodeSchema,
	/** Dotted path into the diagram, for example `people.[3].manager`. */
	path: Schema.NonEmptyString,
	message: Schema.NonEmptyString,
	hint: Schema.NonEmptyString,
}) {}

/** People with no manager: the top of each tree. */
export function orgChartRoots(diagram: Pick<OrgChartDiagram, "people">): OrgPerson[] {
	return diagram.people.filter((person) => person.manager === undefined);
}

/** Each manager's direct reports and assistants, in authored order. */
export function orgChartReports(
	diagram: Pick<OrgChartDiagram, "people">,
): ReadonlyMap<string, readonly OrgPerson[]> {
	const reports = new Map<string, OrgPerson[]>();
	for (const person of diagram.people) {
		if (person.manager === undefined) continue;
		const list = reports.get(person.manager) ?? [];
		list.push(person);
		reports.set(person.manager, list);
	}
	return reports;
}

/** A person's initials for an avatar placeholder: the first letters of their first and last names. */
export function orgPersonInitials(name: string): string {
	const all = name
		.trim()
		.split(/\s+/u)
		.filter((word) => /[\p{L}\p{N}]/u.test(word));
	// An honorific ahead of a name is no initial: "Dr. Sarah Okafor" is SO.
	const words =
		all.length > 2 && /^(dr|mr|mrs|ms|mx|prof|sir|dame)\.?$/iu.test(all[0]!) ? all.slice(1) : all;
	const first = (word: string | undefined) => {
		const letter = [
			...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(word ?? ""),
		]
			.map((entry) => entry.segment)
			.find((segment) => /[\p{L}\p{N}]/u.test(segment));
		return letter?.toLocaleUpperCase() ?? "";
	};
	if (words.length === 0) return "?";
	if (words.length === 1) return first(words[0]) || "?";
	return `${first(words[0])}${first(words.at(-1))}`;
}

/** Ids on one reporting cycle, in order, or undefined when every chain reaches a top person. */
function reportingCycle(people: readonly OrgPerson[]): string[] | undefined {
	const managers = new Map(people.map((person) => [person.id, person.manager]));
	const done = new Set<string>();
	for (const person of people) {
		const chain: string[] = [];
		const onChain = new Set<string>();
		let id: string | undefined = person.id;
		while (id !== undefined && managers.has(id) && !done.has(id)) {
			if (onChain.has(id)) return [...chain.slice(chain.indexOf(id)), id];
			onChain.add(id);
			chain.push(id);
			id = managers.get(id);
		}
		for (const visited of chain) done.add(visited);
	}
	return undefined;
}

export function getOrgChartValidationIssues(diagram: OrgChartDiagram): OrgChartValidationIssue[] {
	const issues: OrgChartValidationIssue[] = [];
	const push = (code: OrgChartValidationIssueCode, path: string, message: string, hint: string) =>
		issues.push({ code, path, message, hint });
	const { people, dottedLines } = diagram;
	if (people.length > ORG_CHART_MAX_PEOPLE)
		push(
			"org_chart_too_large",
			"people",
			`An org chart holds at most ${ORG_CHART_MAX_PEOPLE} people; this one has ${people.length}.`,
			"Draw each division as its own chart, or keep the levels the request asks for.",
		);
	if (dottedLines.length > ORG_CHART_MAX_DOTTED_LINES)
		push(
			"org_chart_too_large",
			"dottedLines",
			`An org chart holds at most ${ORG_CHART_MAX_DOTTED_LINES} dotted lines; this one has ${dottedLines.length}.`,
			"Keep the dotted-line reports the request states.",
		);
	const ids = new Set<string>();
	people.forEach((person, index) => {
		const path = `people.[${index}]`;
		if (person.id.includes(":"))
			push(
				"invalid_person_id",
				`${path}.id`,
				`Person id "${person.id}" contains a colon.`,
				"Use a short id without colons, such as ada or vp-eng.",
			);
		if (ids.has(person.id))
			push(
				"duplicate_person_id",
				`${path}.id`,
				`Person id "${person.id}" is used more than once.`,
				"Give each person a unique id; two people with one name need two ids.",
			);
		ids.add(person.id);
		const long = (field: string, value: string | undefined, limit: number) => {
			if (value !== undefined && value.trim().length > limit)
				push(
					"org_text_too_long",
					`${path}.${field}`,
					`The ${field} of "${person.id}" is longer than ${limit} characters.`,
					`Shorten the ${field} to at most ${limit} characters.`,
				);
		};
		long("name", person.name, ORG_CHART_MAX_NAME_LENGTH);
		long("title", person.title, ORG_CHART_MAX_TITLE_LENGTH);
		long("department", person.department, ORG_CHART_MAX_DEPARTMENT_LENGTH);
	});
	const reports = orgChartReports(diagram);
	people.forEach((person, index) => {
		const path = `people.[${index}]`;
		if (person.manager === undefined) {
			if (person.assistant)
				push(
					"invalid_assistant",
					`${path}.assistant`,
					`Assistant "${person.id}" has no manager.`,
					"Set manager to the person they assist.",
				);
			return;
		}
		if (person.manager === person.id)
			push(
				"self_manager",
				`${path}.manager`,
				`"${person.id}" is their own manager.`,
				"Set manager to the person they report to, or omit it for the top person.",
			);
		else if (!ids.has(person.manager))
			push(
				"unknown_manager",
				`${path}.manager`,
				`Manager "${person.manager}" of "${person.id}" is not a person in the chart.`,
				"Use the id of a person in people, or add the manager as a person.",
			);
		if (person.assistant && (reports.get(person.id)?.length ?? 0) > 0)
			push(
				"invalid_assistant",
				`${path}.assistant`,
				`Assistant "${person.id}" has reports of their own.`,
				"An assistant sits beside their manager with no reports; drop assistant: true to draw them as a manager.",
			);
	});
	const cycle = reportingCycle(people);
	if (cycle)
		push(
			"reporting_cycle",
			`people.[${people.findIndex((person) => person.id === cycle[0])}].manager`,
			`Reporting lines run in a cycle: ${cycle.join(" → ")}.`,
			"Every chain of managers ends at a top person with no manager; remove one manager on the cycle.",
		);
	const roots = orgChartRoots(diagram);
	if (roots.length > 1 && diagram.forest !== true)
		push(
			"multiple_roots",
			`people.[${people.indexOf(roots[1]!)}].manager`,
			`${roots.length} people have no manager: ${roots
				.slice(0, 4)
				.map((person) => `"${person.id}"`)
				.join(", ")}${roots.length > 4 ? ", …" : ""}.`,
			"Give everyone but the top person a manager, or set forest: true to draw separate trees.",
		);
	const byId = new Map(people.map((person) => [person.id, person]));
	// Depth walks the same graph the cycle check does: the last person of each id.
	if (!cycle && roots.length > 0) {
		const depthOf = new Map<string, number>();
		const depth = (person: OrgPerson): number => {
			const known = depthOf.get(person.id);
			if (known !== undefined) return known;
			const manager = person.manager === undefined ? undefined : byId.get(person.manager);
			const value = manager && manager.id !== person.id ? depth(manager) + 1 : 1;
			depthOf.set(person.id, value);
			return value;
		};
		const deepest = Math.max(...people.map(depth));
		if (deepest > ORG_CHART_MAX_DEPTH)
			push(
				"org_chart_too_large",
				"people",
				`Reporting chains run ${deepest} levels deep; an org chart draws at most ${ORG_CHART_MAX_DEPTH}.`,
				"Draw the deepest teams as charts of their own.",
			);
	}
	const lineIds = new Set<string>();
	const pairs = new Set<string>();
	dottedLines.forEach((line, index) => {
		const path = `dottedLines.[${index}]`;
		if (lineIds.has(line.id))
			push(
				"duplicate_dotted_line_id",
				`${path}.id`,
				`Dotted line id "${line.id}" is used more than once.`,
				"Give each dotted line a unique id.",
			);
		lineIds.add(line.id);
		for (const end of ["report", "manager"] as const)
			if (!ids.has(line[end]))
				push(
					"invalid_dotted_line",
					`${path}.${end}`,
					`Dotted line "${line.id}" names unknown ${end} "${line[end]}".`,
					"Use the ids of two people in the chart.",
				);
		if (line.report === line.manager)
			push(
				"invalid_dotted_line",
				path,
				`Dotted line "${line.id}" joins "${line.report}" to themselves.`,
				"A dotted line joins a person to a second manager.",
			);
		else if (byId.get(line.report)?.manager === line.manager)
			push(
				"invalid_dotted_line",
				path,
				`"${line.report}" already reports to "${line.manager}" on a solid line.`,
				"Draw a dotted line only to a second manager, outside the solid reporting line.",
			);
		const pair = `${line.report}\u0000${line.manager}`;
		if (pairs.has(pair))
			push(
				"invalid_dotted_line",
				path,
				`"${line.report}" has two dotted lines to "${line.manager}".`,
				"Draw each dotted-line report once.",
			);
		pairs.add(pair);
		if (line.label !== undefined && line.label.trim().length > ORG_CHART_MAX_LABEL_LENGTH)
			push(
				"org_text_too_long",
				`${path}.label`,
				`The label of dotted line "${line.id}" is longer than ${ORG_CHART_MAX_LABEL_LENGTH} characters.`,
				`Shorten the label to at most ${ORG_CHART_MAX_LABEL_LENGTH} characters.`,
			);
	});
	return issues.slice(0, ORG_CHART_MAX_ISSUES);
}

export class OrgChartValidationError extends DiagramValidationError {
	constructor(readonly issues: readonly OrgChartValidationIssue[]) {
		super(issues[0]?.message ?? "Org chart failed semantic validation.");
		this.name = "OrgChartValidationError";
	}
}

export function validateOrgChartDiagram(diagram: OrgChartDiagram): OrgChartDiagram {
	const issues = getOrgChartValidationIssues(diagram);
	if (issues.length > 0) throw new OrgChartValidationError(issues);
	return diagram;
}

export function parseOrgChartDiagram(input: unknown): OrgChartDiagram {
	return validateOrgChartDiagram(
		Schema.decodeUnknownSync(OrgChartDiagram, { errors: "all" })(input),
	);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** The first of `keys` a record sets, removed from `rest`. */
function take(rest: Record<string, unknown>, keys: readonly string[]): unknown {
	let found: unknown;
	for (const key of keys) {
		if (found === undefined && rest[key] !== undefined) found = rest[key];
		delete rest[key];
	}
	return found;
}

const MANAGER_KEYS = [
	"manager",
	"reportsTo",
	"managerId",
	"manager_id",
	"reports_to",
	"parent",
	"boss",
];
const TITLE_KEYS = ["title", "role", "position", "jobTitle", "job_title"];
const DEPARTMENT_KEYS = ["department", "team", "dept", "division", "group"];
const DOTTED_KEYS = [
	"dottedLines",
	"dottedLine",
	"dottedLineTo",
	"dottedManager",
	"dottedManagers",
];

/**
 * Read the ways people write an org chart into the canonical shape: `reportsTo`
 * (and the like) for `manager`, `role` or `position` for `title`, `team` for
 * `department`, `kind: "assistant"`, explicit `reportingLines: [{ manager,
 * report }]`, and dotted lines written on a person (`dottedLineTo: "cfo"`) or
 * as `{ from, to }` (from reports to to).
 */
export function resolveOrgChartShorthand(input: unknown): unknown {
	if (!isRecord(input)) return input;
	const { employees, members, reportingLines, reports, edges, ...chart } = input;
	const listed = chart["people"] ?? employees ?? members;
	const extraDotted: Record<string, unknown>[] = [];
	// A person may list their direct reports by id instead of each report naming them.
	const listedManagers = new Map<unknown, unknown>();
	if (Array.isArray(listed))
		for (const person of listed)
			if (isRecord(person))
				for (const key of ["directReports", "reports"])
					if (Array.isArray(person[key]))
						for (const report of person[key] as unknown[])
							if (typeof report === "string" && !listedManagers.has(report))
								listedManagers.set(report, person["id"]);
	const people = Array.isArray(listed)
		? listed.map((person) => {
				if (!isRecord(person)) return person;
				const rest: Record<string, unknown> = { ...person };
				if (Array.isArray(rest["directReports"])) delete rest["directReports"];
				if (Array.isArray(rest["reports"])) delete rest["reports"];
				const manager = take(rest, MANAGER_KEYS) ?? listedManagers.get(rest["id"]);
				const title = take(rest, TITLE_KEYS);
				const department = take(rest, DEPARTMENT_KEYS);
				const dotted = take(rest, DOTTED_KEYS);
				const name = rest["name"] ?? rest["label"];
				delete rest["label"];
				if (rest["kind"] === "assistant" || rest["type"] === "assistant") {
					rest["assistant"] = true;
					delete rest["kind"];
					delete rest["type"];
				}
				for (const target of Array.isArray(dotted) ? dotted : dotted === undefined ? [] : [dotted])
					extraDotted.push(
						isRecord(target)
							? { report: rest["id"], ...target }
							: { report: rest["id"], manager: target },
					);
				return {
					...rest,
					...(name === undefined ? {} : { name }),
					...(manager === undefined || manager === null || manager === "" ? {} : { manager }),
					...(title === undefined || title === "" ? {} : { title }),
					...(department === undefined || department === "" ? {} : { department }),
				};
			})
		: listed;
	// Explicit reporting lines set each report's manager, unless the person already names one.
	const lines = [reportingLines, reports, edges].find(Array.isArray) as unknown[] | undefined;
	const resolvedPeople =
		Array.isArray(people) && lines
			? people.map((person) => {
					if (!isRecord(person) || person["manager"] !== undefined) return person;
					const line = lines.find(
						(entry) =>
							isRecord(entry) &&
							(entry["report"] ?? entry["to"] ?? entry["target"]) === person["id"] &&
							entry["dotted"] !== true,
					);
					const manager = isRecord(line)
						? (line["manager"] ?? line["from"] ?? line["source"])
						: undefined;
					return manager === undefined ? person : { ...person, manager };
				})
			: people;
	const fromLines = (lines ?? []).filter(
		(entry): entry is Record<string, unknown> => isRecord(entry) && entry["dotted"] === true,
	);
	const dottedInput = chart["dottedLines"];
	const dottedList = [
		// One dotted line written alone is a list of one, which the decoder checks like any other.
		...(Array.isArray(dottedInput)
			? dottedInput
			: dottedInput === undefined || dottedInput === null
				? []
				: [dottedInput]),
		...extraDotted,
		...fromLines.map(({ dotted: _dotted, ...line }) => ({
			report: line["report"] ?? line["to"] ?? line["target"],
			manager: line["manager"] ?? line["from"] ?? line["source"],
			...(line["label"] === undefined ? {} : { label: line["label"] }),
		})),
	];
	const used = new Set(
		dottedList.flatMap((line) =>
			isRecord(line) && typeof line["id"] === "string" ? [line["id"]] : [],
		),
	);
	const dottedLines = dottedList.map((line) => {
		if (!isRecord(line)) return line;
		const { from, to, source, target, person, employee, ...rest } = line;
		const resolved: Record<string, unknown> = {
			...rest,
			report: rest["report"] ?? from ?? source ?? person ?? employee,
			manager: rest["manager"] ?? to ?? target,
		};
		for (const key of ["report", "manager"]) if (resolved[key] === undefined) delete resolved[key];
		if (typeof resolved["id"] !== "string" || resolved["id"].length === 0) {
			const base = `${String(resolved["report"])}-dotted-${String(resolved["manager"])}`.replace(
				/[^\w-]+/gu,
				"-",
			);
			let id = base;
			for (let suffix = 2; used.has(id); suffix += 1) id = `${base}-${suffix}`;
			used.add(id);
			resolved["id"] = id;
		}
		return resolved;
	});
	return {
		...chart,
		...(resolvedPeople === undefined ? {} : { people: resolvedPeople }),
		...(dottedInput === undefined && dottedLines.length === 0 ? {} : { dottedLines }),
	};
}

export const orgChartFixture = parseOrgChartDiagram({
	id: "startup-team",
	title: "Startup team",
	type: orgChartDiagramType,
	people: [
		{ id: "ada", name: "Ada Lovelace", title: "Chief Executive Officer", department: "Executive" },
		{
			id: "grace",
			name: "Grace Hopper",
			title: "Executive Assistant",
			department: "Executive",
			manager: "ada",
			assistant: true,
		},
		{
			id: "linus",
			name: "Linus Torvalds",
			title: "Chief Technology Officer",
			department: "Engineering",
			manager: "ada",
		},
		{
			id: "margaret",
			name: "Margaret Hamilton",
			title: "Engineering Manager",
			department: "Engineering",
			manager: "linus",
		},
		{
			id: "ken",
			name: "Ken Thompson",
			title: "Platform Engineer",
			department: "Engineering",
			manager: "linus",
		},
		{
			id: "radia",
			name: "Radia Perlman",
			title: "Head of Product",
			department: "Product",
			manager: "ada",
		},
		{
			id: "don",
			name: "Don Norman",
			title: "Product Designer",
			department: "Product",
			manager: "radia",
		},
	],
	dottedLines: [{ id: "ken-to-radia", report: "ken", manager: "radia" }],
});
