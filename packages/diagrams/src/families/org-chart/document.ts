// Maintained fixture literals/factories are trusted: invalid fixture data is a startup defect, not user input.
import { Effect, Graph, String as Str, Schema, Array as Arr, Option, Result } from "effect";

import { cleanToolString, slug } from "../../clean-text.js";

import { DiagramStyle, SKETCHI_DIAGRAM_STYLE } from "@sketchi/drawing";

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
export const OrgPerson = Schema.Struct({
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
}).annotate({ identifier: "OrgPerson" });

export interface OrgPerson extends Schema.Schema.Type<typeof OrgPerson> {}

/**
 * A secondary, dotted-line or matrix report: `report` also answers to
 * `manager`, outside the solid reporting line.
 */
export const OrgDottedLine = Schema.Struct({
	id: Schema.optionalKey(Schema.NonEmptyString),
	report: Schema.NonEmptyString,
	manager: Schema.NonEmptyString,
	label: Schema.optionalKey(Schema.NonEmptyString),
}).annotate({ identifier: "OrgDottedLine" });

export interface OrgDottedLine extends Schema.Schema.Type<typeof OrgDottedLine> {}

/**
 * An authored org chart: people and the managers they report to, with
 * optional dotted-line reports. The renderer owns every coordinate. Every
 * surface that accepts, generates, renders or evaluates an org chart uses this
 * shape.
 */
export const OrgChartDocument = Schema.Struct({
	id: Schema.optionalKey(Schema.NonEmptyString),
	title: Schema.NonEmptyString,
	people: Schema.Array(OrgPerson).pipe(Schema.mutable, Schema.check(Schema.isMinLength(1))),
	dottedLines: Schema.Array(OrgDottedLine).pipe(
		Schema.mutable,
		Schema.withDecodingDefaultKey(Effect.succeed([])),
	),
	/** Draw each department below the top as a labeled region around its people. */
	groupByDepartment: Schema.optionalKey(Schema.Boolean),
	/** Several separate trees side by side, each with a top person of its own. */
	forest: Schema.optionalKey(Schema.Boolean),
	style: DiagramStyle.pipe(
		Schema.withDecodingDefaultKey(Effect.succeed({ ...SKETCHI_DIAGRAM_STYLE })),
	),
});
export interface OrgChartDocument extends Schema.Schema.Type<typeof OrgChartDocument> {}

/** Authored fields have one owner; rendering adds the stable id and family tag. */
export const OrgChartDiagram = OrgChartDocument.mapFields((fields) => ({
	...fields,
	id: Schema.NonEmptyString,
	type: Schema.Literal(orgChartDiagramType),
	dottedLines: Schema.Array(
		OrgDottedLine.mapFields((fields) => ({ ...fields, id: Schema.NonEmptyString })),
	).pipe(Schema.mutable, Schema.withDecodingDefaultKey(Effect.succeed([]))),
})).annotate({ identifier: "OrgChartDiagram" });

export interface OrgChartDiagram extends Schema.Schema.Type<typeof OrgChartDiagram> {}

export function normalizeOrgChart(spec: OrgChartDocument): OrgChartDiagram {
	const title = cleanToolString(spec.title);
	const optional = (key: string, value: string | undefined) =>
		value && cleanToolString(value) ? { [key]: cleanToolString(value) } : {};
	const flag = (key: string, value: boolean | undefined) => (value ? { [key]: true } : {});
	// An omitted id takes the next `dotted-line-<n>` no dotted line claims explicitly.
	const used = new Set(
		Arr.flatMap(spec.dottedLines, (line) => {
			const id = line.id && cleanToolString(line.id);
			return id ? [id] : [];
		}),
	);
	const lineId = (index: number) => {
		let number = index + 1;
		while (used.has(`dotted-line-${number}`)) number += 1;
		used.add(`dotted-line-${number}`);
		return `dotted-line-${number}`;
	};
	return {
		id:
			((spec.id && cleanToolString(spec.id)) || undefined) ?? (slug(title) || "sketchi-org-chart"),
		title,
		type: orgChartDiagramType,
		people: Arr.map(spec.people, (person) => ({
			id: cleanToolString(person.id),
			name: cleanToolString(person.name),
			...optional("title", person.title),
			...optional("department", person.department),
			...optional("manager", person.manager),
			...flag("assistant", person.assistant),
			...flag("avatar", person.avatar),
		})),
		dottedLines: Arr.map(spec.dottedLines, (line, index) => ({
			id: ((line.id && cleanToolString(line.id)) || undefined) ?? lineId(index),
			report: cleanToolString(line.report),
			manager: cleanToolString(line.manager),
			...optional("label", line.label),
		})),
		...flag("groupByDepartment", spec.groupByDepartment),
		...flag("forest", spec.forest),
		style: { ...SKETCHI_DIAGRAM_STYLE },
	};
}

/** Resolve authored aliases before the one document decoder. */
export function prepareOrgChart(input: unknown): Result.Result<unknown, never> {
	return Result.succeed(
		isRecord(input) && "spec" in input
			? { ...input, spec: resolveOrgChartShorthand(input["spec"]) }
			: input,
	);
}

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

export const OrgChartValidationIssue = Schema.Struct({
	code: OrgChartValidationIssueCodeSchema,
	/** Dotted path into the diagram, for example `people.[3].manager`. */
	path: Schema.NonEmptyString,
	message: Schema.NonEmptyString,
	hint: Schema.NonEmptyString,
}).annotate({ identifier: "OrgChartValidationIssue" });

export interface OrgChartValidationIssue extends Schema.Schema.Type<
	typeof OrgChartValidationIssue
> {}

/** People with no manager: the top of each tree. */
export function orgChartRoots(diagram: Pick<OrgChartDiagram, "people">): OrgPerson[] {
	return Arr.filter(diagram.people, (person) => person.manager === undefined);
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
	const all = Arr.filter(Str.split(Str.trim(name), /\s+/u), (word) => /[\p{L}\p{N}]/u.test(word));
	// An honorific ahead of a name is no initial: "Dr. Sarah Okafor" is SO.
	const words =
		all.length > 2 && /^(dr|mr|mrs|ms|mx|prof|sir|dame)\.?$/iu.test(all[0]!) ? all.slice(1) : all;
	const first = (word: string | undefined) => {
		const letter = Option.getOrUndefined(
			Arr.findFirst(
				Arr.map(
					[...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(word ?? "")],
					(entry) => entry.segment,
				),
				(segment) => /[\p{L}\p{N}]/u.test(segment),
			),
		);
		return letter === undefined ? "" : Str.toLocaleUpperCase()(letter);
	};
	if (words.length === 0) return "?";
	if (words.length === 1) return first(words[0]) || "?";
	return `${first(words[0])}${first(words.at(-1))}`;
}

/** Reporting edges use the final person of each id; duplicate ids have their own refusal. */
function reportingGraph(people: readonly OrgPerson[]) {
	// Last authored identity owns its edge; duplicates still report their own issue.
	const byId = new Map(Arr.map(people, (person) => [person.id, person]));
	return Graph.directed<string, undefined>((mutable) => {
		const indices = new Map(Arr.map([...byId.keys()], (id) => [id, Graph.addNode(mutable, id)]));
		for (const person of byId.values()) {
			const from = indices.get(person.id);
			const to = person.manager === undefined ? undefined : indices.get(person.manager);
			if (from !== undefined && to !== undefined) Graph.addEdge(mutable, from, to, undefined);
		}
	});
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
	Arr.forEach(people, (person, index) => {
		const path = `people.[${index}]`;
		if (Str.includes(":")(person.id))
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
			if (value !== undefined && Str.trim(value).length > limit)
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
	Arr.forEach(people, (person, index) => {
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
	const graph = reportingGraph(people);
	const cycle = Option.getOrUndefined(
		Option.map(Graph.findCycle(graph), (found) =>
			Arr.reverse(Arr.map(found.path, (index) => Option.getOrThrow(Graph.getNode(graph, index)))),
		),
	);
	if (cycle)
		push(
			"reporting_cycle",
			`people.[${Option.getOrElse(
				Arr.findFirstIndex(people, (person) => person.id === cycle[0]),
				() => -1,
			)}].manager`,
			`Reporting lines run in a cycle: ${Arr.join(cycle, " → ")}.`,
			"Every chain of managers ends at a top person with no manager; remove one manager on the cycle.",
		);
	const roots = orgChartRoots(diagram);
	if (roots.length > 1 && diagram.forest !== true)
		push(
			"multiple_roots",
			`people.[${people.indexOf(roots[1]!)}].manager`,
			`${roots.length} people have no manager: ${Arr.join(
				Arr.map(roots.slice(0, 4), (person) => `"${person.id}"`),
				", ",
			)}${roots.length > 4 ? ", …" : ""}.`,
			"Give everyone but the top person a manager, or set forest: true to draw separate trees.",
		);
	const byId = new Map(Arr.map(people, (person) => [person.id, person]));
	// Depth walks the same graph the cycle check does: the last person of each id.
	if (!cycle && roots.length > 0) {
		const terminals = Graph.findNodes(graph, (id) => {
			const manager = byId.get(id)?.manager;
			return manager === undefined || !byId.has(manager);
		});
		const deepest =
			1 +
			Math.max(
				0,
				...Arr.flatMap(terminals, (start) => [
					...Graph.unweightedDistances(graph, start, { direction: "incoming" }).values(),
				]),
			);
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
	Arr.forEach(dottedLines, (line, index) => {
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
		if (line.label !== undefined && Str.trim(line.label).length > ORG_CHART_MAX_LABEL_LENGTH)
			push(
				"org_text_too_long",
				`${path}.label`,
				`The label of dotted line "${line.id}" is longer than ${ORG_CHART_MAX_LABEL_LENGTH} characters.`,
				`Shorten the label to at most ${ORG_CHART_MAX_LABEL_LENGTH} characters.`,
			);
	});
	return issues.slice(0, ORG_CHART_MAX_ISSUES);
}

export class OrgChartValidationError extends Schema.TaggedError<
	OrgChartValidationError,
	{ readonly brand: unique symbol }
>()("OrgChartValidationError", {
	message: Schema.String,
	issues: Schema.Array(OrgChartValidationIssue),
}) {
	static fromIssues(issues: readonly OrgChartValidationIssue[]): OrgChartValidationError {
		return OrgChartValidationError.make({
			issues,
			message: Option.match(Arr.head(issues), {
				onNone: () => "Org chart failed semantic validation.",
				onSome: (issue) => issue.message,
			}),
		});
	}
}

export function validateOrgChartDiagram(
	diagram: OrgChartDiagram,
): Result.Result<OrgChartDiagram, OrgChartValidationError> {
	const issues = getOrgChartValidationIssues(diagram);
	return issues.length > 0
		? Result.fail(OrgChartValidationError.fromIssues(issues))
		: Result.succeed(diagram);
}

export function parseOrgChartDiagram(
	input: unknown,
): Result.Result<OrgChartDiagram, Schema.SchemaError | OrgChartValidationError> {
	return Result.flatMap(
		Schema.decodeUnknownResult(OrgChartDiagram, { errors: "all" })(input),
		validateOrgChartDiagram,
	);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Arr.isArray(value);

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
	if (Arr.isArray(listed))
		for (const person of listed)
			if (isRecord(person))
				for (const key of ["directReports", "reports"])
					if (Arr.isArray(person[key]))
						for (const report of person[key])
							if (typeof report === "string" && !listedManagers.has(report))
								listedManagers.set(report, person["id"]);
	const people = Arr.isArray(listed)
		? Arr.map(listed, (person) => {
				if (!isRecord(person)) return person;
				const rest: Record<string, unknown> = { ...person };
				if (Arr.isArray(rest["directReports"])) delete rest["directReports"];
				if (Arr.isArray(rest["reports"])) delete rest["reports"];
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
				for (const target of Arr.isArray(dotted) ? dotted : dotted === undefined ? [] : [dotted])
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
	const lines = Option.getOrUndefined(
		Arr.findFirst([reportingLines, reports, edges], (value): value is unknown[] =>
			Arr.isArray(value),
		),
	);
	const resolvedPeople =
		Arr.isArray(people) && lines
			? Arr.map(people, (person) => {
					if (!isRecord(person) || person["manager"] !== undefined) return person;
					const line = Option.getOrUndefined(
						Arr.findFirst(
							lines,
							(entry) =>
								isRecord(entry) &&
								(entry["report"] ?? entry["to"] ?? entry["target"]) === person["id"] &&
								entry["dotted"] !== true,
						),
					);
					const manager = isRecord(line)
						? (line["manager"] ?? line["from"] ?? line["source"])
						: undefined;
					return manager === undefined ? person : { ...person, manager };
				})
			: people;
	const fromLines = Arr.filter(
		lines ?? [],
		(entry): entry is Record<string, unknown> => isRecord(entry) && entry["dotted"] === true,
	);
	const dottedInput = chart["dottedLines"];
	const dottedList = [
		// One dotted line written alone is a list of one, which the decoder checks like any other.
		...(Arr.isArray(dottedInput)
			? dottedInput
			: dottedInput === undefined || dottedInput === null
				? []
				: [dottedInput]),
		...extraDotted,
		...Arr.map(fromLines, ({ dotted: _dotted, ...line }) => ({
			report: line["report"] ?? line["to"] ?? line["target"],
			manager: line["manager"] ?? line["from"] ?? line["source"],
			...(line["label"] === undefined ? {} : { label: line["label"] }),
		})),
	];
	const used = new Set(
		Arr.flatMap(dottedList, (line) =>
			isRecord(line) && typeof line["id"] === "string" ? [line["id"]] : [],
		),
	);
	const dottedLines = Arr.map(dottedList, (line) => {
		if (!isRecord(line)) return line;
		const { from, to, source, target, person, employee, ...rest } = line;
		const resolved: Record<string, unknown> = {
			...rest,
			report: rest["report"] ?? from ?? source ?? person ?? employee,
			manager: rest["manager"] ?? to ?? target,
		};
		for (const key of ["report", "manager"]) if (resolved[key] === undefined) delete resolved[key];
		if (typeof resolved["id"] !== "string" || resolved["id"].length === 0) {
			const base = Str.replace(
				/[^\w-]+/gu,
				"-",
			)(`${String(resolved["report"])}-dotted-${String(resolved["manager"])}`);
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
}).pipe(Result.getOrThrow);

/** Counts and domain nouns shown by generation consumers. */
export function counts(diagram: OrgChartDiagram) {
	return {
		nodeCount: diagram.people.length,
		nodeNoun: "people",
		edgeCount:
			Arr.filter(diagram.people, (person) => person.manager !== undefined).length +
			diagram.dottedLines.length,
		edgeNoun: "reporting lines",
	};
}
