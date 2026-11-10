/**
 * Deterministic checks of a generated diagram against what its request states
 * outright: the classes, fields and tables pasted as code, quoted text, the
 * connections drawn with arrows or explicit before/then order, the containers an architecture names, and the
 * messages a sequence lists. A check reads only structure the request spells
 * out, without another model call.
 */

/** What a flowchart can miss of its request, which every surface that builds one can check. */
export const FLOWCHART_COVERAGE_CODES = [
	"quoted_text_missing",
	"flowchart_connection_missing",
	"flowchart_return_step_missing",
	"flowchart_check_step_missing",
	"flowchart_step_borrowed",
	"flowchart_step_split",
	"flowchart_container_missing",
	"flowchart_containment_wrong",
	"flowchart_containment_unstated",
	"flowchart_zone_merged",
] as const;

export const COVERAGE_ISSUE_CODES = [
	...FLOWCHART_COVERAGE_CODES,
	"class_missing",
	"class_field_missing",
	"class_link_missing",
	"class_generalization_missing",
	"class_relationship_unstated",
	"class_whole_part_unstated",
	"er_table_missing",
	"er_column_missing",
	"er_marker_mismatch",
	"er_reference_missing",
	"sequence_message_missing",
	"sequence_order_changed",
] as const;
export type CoverageIssueCode = (typeof COVERAGE_ISSUE_CODES)[number];

export interface CoverageIssue {
	/** A stable code, such as `class_field_missing`. */
	readonly code: CoverageIssueCode;
	/** What the request states and the diagram lacks, worded as the fix. */
	readonly message: string;
}

type Json = Readonly<Record<string, unknown>>;

const isUnknownRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

const records = (value: unknown): Json[] =>
	Array.isArray(value) ? value.filter((entry): entry is Json => isUnknownRecord(entry)) : [];
const text = (value: unknown): string => (typeof value === "string" ? value : "");

const STOP_WORDS = new Set(
	"a an the of to and or in on at for with by from into onto its it is are be been was were this that these those our your their his her my we us then also as".split(
		" ",
	),
);

/** Lowercase words without accents or punctuation. */
function words(value: string): string[] {
	return value
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/gu, "")
		.split(/[^a-z0-9]+/u)
		.filter(Boolean);
}

/** A crude stem, so "validates", "validated" and "validate" compare equal. */
function stem(word: string): string {
	let result = word;
	if (result.length > 4 && result.endsWith("ies")) result = `${result.slice(0, -3)}y`;
	else if (result.length > 4 && /(?:ss|sh|ch|x|z)es$/u.test(result)) result = result.slice(0, -2);
	else if (result.length > 3 && result.endsWith("s") && !result.endsWith("ss"))
		result = result.slice(0, -1);
	if (result.length > 5 && result.endsWith("ing")) result = result.slice(0, -3);
	else if (result.length > 4 && result.endsWith("ed")) result = result.slice(0, -2);
	if (result.length > 3 && result.endsWith("e")) result = result.slice(0, -1);
	return result;
}

/** Abbreviations a request and a label use interchangeably: "db subnet" is the "Database subnet". */
const SPELLED_OUT: Readonly<Record<string, string>> = { db: "database" };

const stemWord = (word: string) => stem(SPELLED_OUT[word] ?? word);

function stems(value: string): string[] {
	return words(value)
		.filter((word) => !STOP_WORDS.has(word))
		.map(stemWord);
}

const normalized = (value: string) => words(value).join(" ");

/** Whether a set of stems holds a word, as itself or as the start of a longer one ("postgr" in "postgresql"). */
function holds(shown: ReadonlySet<string>, word: string): boolean {
	if (shown.has(word)) return true;
	return (
		word.length >= 3 &&
		[...shown].some(
			(other) => other.length >= 3 && (other.startsWith(word) || word.startsWith(other)),
		)
	);
}

/** Every human-readable string in a diagram, without ids, references or enums. */
function diagramText(value: unknown): string {
	const skip = new Set([
		"id",
		"source",
		"target",
		"from",
		"to",
		"parent",
		"group",
		"lane",
		"type",
		"kind",
		"shape",
		"slug",
		"manager",
		"style",
		"layout",
		"visibility",
	]);
	const out: string[] = [];
	const visit = (node: unknown) => {
		if (typeof node === "string") out.push(node);
		else if (Array.isArray(node)) node.forEach(visit);
		else if (isUnknownRecord(node)) {
			for (const [key, child] of Object.entries(node)) if (!skip.has(key)) visit(child);
		}
	};
	visit(value);
	return normalized(out.join(" \n "));
}

/** `a, b and c`. */
function listed(values: readonly string[]): string {
	return values.length < 2
		? values.join("")
		: `${values.slice(0, -1).join(", ")} and ${values.at(-1)}`;
}

const quoteList = (values: readonly string[]) => listed(values.map((value) => `"${value}"`));

// ---------------------------------------------------------------------------
// Quoted text

/** Quoted text that starts and ends with a character and holds a letter, so `"1" o-- "*"` quotes nothing. */
const QUOTED = /["“]([^"”\s{}();=<>][^"”\n{}();=<>]{0,78}[^"”\s{}();=<>])["”]/gu;

/** A clause that leaves something out: "do not show", "without", "instead of", "remove". */
const LEAVES_OUT =
	/\b(?:no|not|never|none|nor|without|avoid|omit|omits|omitted|exclude|excludes|excluding|remove|removes|removed|hide|hides|hidden|drop|drops|except|unless|instead|rather|don't|doesn't|isn't|aren't|won't|shouldn't|mustn't)\b/iu;

/** Ordering negation, not action names such as "Remove item" or "Drop package". */
const NEGATES_ORDER =
	/\b(?:cannot|(?:can|mustn|shouldn|don|doesn|isn|aren|wasn|weren)['’]t|(?:must|should|do|does|is|are|was|were)\s+not|forbidden|never|without|avoid)\b/iu;

/** A verb negated: "do not send", "never retries". A bare "not ready" or "no reply" is a condition. */
const NEGATED_ACTION =
	/\b(?:(?:do|does|did|will|would|must|should|can|could|may|might)\s+not|(?:don|doesn|didn|won|wouldn|can|mustn|shouldn)['’]t|cannot|never|avoid|without)\b/iu;
/** A clause that places nothing where it names: "do not put the API in the public subnet". */
const NEGATED_PLACEMENT = new RegExp(
	`${NEGATED_ACTION.source}|\\b(?:not|no|nor|none|outside|except|instead)\\b`,
	"iu",
);

/**
 * An edit that replaces quoted text: `rename "A" to "B"`, `change the label from "A" to "B"`,
 * `replace "A" with "B"`, and any further `"C" to "D"` pairs it lists. Group 1 is the text replaced.
 */
const REPLACES =
	/\b(?:rename|replace|change|swap|relabel)\b(?:\s+[^\s"“”]+){0,8}?\s+["“]([^"”\n]+)["”]\s+(?:to|with|into|for)\s+["“][^"”\n]+["”]/giu;
const REPLACES_NEXT =
	/\s*(?:,\s*)?(?:and\s+)?["“]([^"”\n]+)["”]\s+(?:to|with|into|for)\s+["“][^"”\n]+["”]/uy;

/** The quoted texts a clause asks to replace, which the diagram no longer shows. */
function replacedQuotes(clause: string): Set<string> {
	const replaced = new Set<string>();
	for (const match of clause.matchAll(REPLACES)) {
		replaced.add(match[1]?.trim() ?? "");
		REPLACES_NEXT.lastIndex = match.index + match[0].length;
		for (let next = REPLACES_NEXT.exec(clause); next; next = REPLACES_NEXT.exec(clause)) {
			replaced.add(next[1]?.trim() ?? "");
		}
	}
	return replaced;
}

/**
 * Quoted text a clause asks to show; a clause that leaves something out asks for none of it,
 * and an edit that replaces text asks only for the new text.
 */
function requiredQuotes(request: string): string[] {
	return request.split(/[.;!?\n]+/u).flatMap((clause) => {
		const quotes = [...clause.matchAll(QUOTED)].map((match) => match[1]?.trim() ?? "");
		if (quotes.length === 0 || LEAVES_OUT.test(clause.replace(QUOTED, " "))) return [];
		const replaced = replacedQuotes(clause);
		return quotes.filter((quote) => /\p{L}/u.test(quote) && !replaced.has(quote));
	});
}

function quotedTextIssues(request: string, diagram: Json): CoverageIssue[] {
	const shown = ` ${diagramText(diagram)} `;
	const missing = requiredQuotes(request).filter(
		(quote) => !shown.includes(` ${normalized(quote)} `),
	);
	return missing.length === 0
		? []
		: [
				{
					code: "quoted_text_missing",
					message: `The request quotes ${quoteList([...new Set(missing)])}, but the diagram does not show ${missing.length === 1 ? "it" : "them"}. Use each quoted text exactly, on the element it belongs to.`,
				},
			];
}

// ---------------------------------------------------------------------------
// Classes declared as code

interface DeclaredField {
	readonly name: string;
	readonly type: string;
}

interface DeclaredClass {
	readonly name: string;
	readonly parents: readonly string[];
	readonly fields: readonly DeclaredField[];
	/** Every identifier in the declaration, members and bodies included. */
	readonly mentions: ReadonlySet<string>;
}

const DECLARATION =
	/\b(?:(?:public|private|protected|internal|abstract|export|final|sealed|static|data|open)\s+)*(class|interface|enum|record)\s+([A-Za-z_]\w*)(?:\s*<[^<>{}]*(?:<[^<>{}]*>[^<>{}]*)*>)?((?:\s+(?:extends|implements)\s+[\w.<>~]+(?:\s*,\s*[\w.<>~]+)*)*)\s*(?::\s*[\w.<>~,\s]+?)?\s*\{/gu;

/** The text between a "{" and its matching "}", and its top level without nested bodies. */
function braceBody(source: string, open: number): { readonly all: string; readonly top: string } {
	let depth = 0;
	let top = "";
	for (let index = open; index < source.length; index += 1) {
		const character = source[index];
		if (character === "{") {
			depth += 1;
			if (depth === 1) continue;
		} else if (character === "}") {
			depth -= 1;
			if (depth === 0) return { all: source.slice(open + 1, index), top };
		}
		if (depth === 1) top += character;
	}
	return { all: source.slice(open + 1), top };
}

const FIELD_MODIFIERS =
	/^(?:(?:public|private|protected|internal|static|final|readonly|const|volatile|transient|override|val|var|let|required|late)\s+)+/u;

function declaredField(statement: string): DeclaredField | undefined {
	let value = statement
		.replace(/^\s*(?:@\w+(?:\([^)]*\))?\s*)+/u, "")
		.replace(/=.*$/su, "")
		.trim();
	if (!value || value.includes("(") || value.startsWith("<<") || /^(?:return|case)\b/u.test(value))
		return undefined;
	value = value
		.replace(/^[+\-#~]\s*/u, "")
		.replace(FIELD_MODIFIERS, "")
		.replace(/~([^~]+)~/gu, "<$1>")
		.trim();
	const colon = value.indexOf(":");
	if (colon > 0) {
		const name = value.slice(0, colon).replace(/[?!]$/u, "").trim();
		return /^[A-Za-z_]\w*$/u.test(name) ? { name, type: value.slice(colon + 1).trim() } : undefined;
	}
	// Join a generic's arguments, so "Map<String, Room> rooms" keeps its type whole.
	const joined = value.replace(/<[^<>]*(?:<[^<>]*>[^<>]*)*>/gu, (generic) =>
		generic.replace(/\s+/gu, ""),
	);
	const tokens = joined.split(/\s+/u).filter(Boolean);
	const name = tokens.at(-1)?.replace(/[?!]$/u, "") ?? "";
	if (!/^[A-Za-z_]\w*$/u.test(name) || tokens.length > 3) return undefined;
	return { name, type: tokens.slice(0, -1).join(" ") };
}

function declaredClasses(request: string): DeclaredClass[] {
	return [...request.matchAll(DECLARATION)].flatMap((match) => {
		const [whole, kind, name] = match;
		if (!name || !kind) return [];
		const body = braceBody(request, (match.index ?? 0) + whole.length - 1);
		const parents = [...(match[3] ?? "").matchAll(/[A-Za-z_]\w*/gu)]
			.map((entry) => entry[0])
			.filter((word) => word !== "extends" && word !== "implements");
		const fields =
			kind === "enum"
				? []
				: body.top
						.split(/[;\n]/u)
						.map(declaredField)
						.filter((field): field is DeclaredField => field !== undefined);
		const mentions = new Set(
			[...`${match[3] ?? ""} ${body.all}`.matchAll(/[A-Za-z_]\w*/gu)].map((entry) => entry[0]),
		);
		return [{ name, parents, fields, mentions }];
	});
}

const MERMAID_RELATION =
	/^\s*([A-Za-z_]\w*)\s*(?:"[^"]*"\s*)?(?:<\|--|--\|>|\*--|--\*|o--|--o|-->|<--|\.\.>|<\.\.|\.\.\|>|<\|\.\.|--|\.\.)\s*(?:"[^"]*"\s*)?([A-Za-z_]\w*)/gmu;

/** The request without its class declarations and their bodies: the prose around the code. */
function outsideDeclarations(request: string): string {
	let prose = "";
	let from = 0;
	for (const match of request.matchAll(DECLARATION)) {
		const start = match.index ?? 0;
		if (start < from) continue;
		const open = start + match[0].length - 1;
		prose += `${request.slice(from, start)}\n`;
		from = open + braceBody(request, open).all.length + 2;
	}
	return prose + request.slice(from);
}

/** Clauses of the prose, for whole-part statements such as "a library is composed of its branches". */
function proseClauses(prose: string): string[][] {
	return prose
		.split(/[.;:\n]|,\s*(?:and|but|while)\s+/u)
		.map((clause) => stems(clause))
		.filter((clause) => clause.length > 0);
}

/** "WeatherStation" as the words of a sentence: "weather station". */
const nameStems = (name: string) => stems(name.replace(/([a-z0-9])([A-Z])/gu, "$1 $2"));

function classIssues(request: string, diagram: Json): CoverageIssue[] {
	const declared = declaredClasses(request);
	if (declared.length === 0) return [];
	const declaredNames = new Map(declared.map((entry) => [entry.name.toLowerCase(), entry]));
	const classes = records(diagram["classes"]);
	const byName = new Map<string, Json>();
	for (const entry of classes) {
		for (const key of [text(entry["id"]), text(entry["name"])])
			if (key) byName.set(key.toLowerCase(), entry);
	}
	const idOf = (name: string) => {
		const entry = byName.get(name.toLowerCase());
		return entry ? text(entry["id"]) : undefined;
	};
	const relationships = records(diagram["relationships"]);
	const ends = (relationship: Json) => [
		text(relationship["from"]).split(".")[0] ?? "",
		text(relationship["to"]).split(".")[0] ?? "",
	];
	const related = (a: string, b: string) =>
		relationships.some((relationship) => {
			const [from, to] = ends(relationship);
			return (from === a && to === b) || (from === b && to === a);
		});
	const issues: CoverageIssue[] = [];

	const missingClasses = declared.filter((entry) => idOf(entry.name) === undefined);
	if (missingClasses.length > 0) {
		issues.push({
			code: "class_missing",
			message: `The request declares ${listed(missingClasses.map((entry) => entry.name))}, but the diagram has no such class. Draw every declared class with its members.`,
		});
	}

	for (const entry of declared) {
		const id = idOf(entry.name);
		if (id === undefined) continue;
		const shown = byName.get(entry.name.toLowerCase());
		const attributes = new Set(
			records(shown?.["attributes"])
				.map((attribute) => text(attribute["name"]).toLowerCase())
				.concat(
					(Array.isArray(shown?.["attributes"]) ? shown["attributes"] : [])
						.filter((attribute): attribute is string => typeof attribute === "string")
						.map((attribute) => declaredField(attribute)?.name.toLowerCase() ?? ""),
				),
		);
		const missingFields = entry.fields.filter((field) => !attributes.has(field.name.toLowerCase()));
		if (missingFields.length > 0) {
			issues.push({
				code: "class_field_missing",
				message: `${entry.name} declares ${listed(missingFields.map((field) => field.name))}, but its box lists ${missingFields.length === 1 ? "no such attribute" : "none of them"}. Keep every declared field in its class's attributes, even when a relationship also draws it.`,
			});
		}
		for (const field of entry.fields) {
			const target = [...field.type.matchAll(/[A-Za-z_]\w*/gu)]
				.map((word) => declaredNames.get(word[0].toLowerCase()))
				.find((other) => other !== undefined && other.name !== entry.name);
			const targetId = target ? idOf(target.name) : undefined;
			if (target && targetId !== undefined && !related(id, targetId)) {
				issues.push({
					code: "class_link_missing",
					message: `${entry.name}.${field.name} is typed ${field.type}, but no relationship joins ${entry.name} and ${target.name}. Draw one from ${entry.name} to ${target.name} whose toRole is "${field.name}".`,
				});
			}
		}
		for (const parent of entry.parents) {
			const parentId = idOf(parent);
			if (parentId === undefined || !declaredNames.has(parent.toLowerCase())) continue;
			const drawn = relationships.some((relationship) => {
				const [from, to] = ends(relationship);
				return (
					from === id &&
					to === parentId &&
					(relationship["kind"] === "inheritance" || relationship["kind"] === "realization")
				);
			});
			if (!drawn) {
				issues.push({
					code: "class_generalization_missing",
					message: `${entry.name} extends or implements ${parent}, but the diagram draws no inheritance or realization from ${entry.name} to ${parent}.`,
				});
			}
		}
	}

	for (const { relationship, names } of unstatedRelationships(request, diagram)) {
		issues.push({
			code: "class_relationship_unstated",
			message: `The diagram draws a ${text(relationship["kind"]) || "relationship"} between ${names[0]} and ${names[1]}, but nothing in the request relates them: no field, signature, body or sentence names both. Remove it.`,
		});
	}
	for (const { names } of unstatedWholeParts(request, diagram)) {
		issues.push({
			code: "class_whole_part_unstated",
			message: `The diagram draws ${names[0]}–${names[1]} as a composition, but the request never calls that pair composed or part of the other. Draw it as an association, keeping its multiplicities and roles.`,
		});
	}
	return issues;
}

/** A sentence that makes one thing part of another: "is composed of", "aggregates", "made of", "owns". */
const WHOLE_PART =
	/\b(?:compos\w*|aggregat\w*|made (?:up )?of|consists? of|comprised? of|part of|owns?|owned by)\b/iu;
const MERMAID_WHOLE_PART =
	/^\s*([A-Za-z_]\w*)\s*(?:"[^"]*"\s*)?(?:\*--|--\*|o--|--o)\s*(?:"[^"]*"\s*)?([A-Za-z_]\w*)/gmu;

/**
 * Compositions between declared classes that the request supports as a relationship but never
 * states as whole and part: a field typed with another class is an association unless a
 * sentence calls the pair composed.
 */
function unstatedWholeParts(
	request: string,
	diagram: Json,
): { readonly relationship: Json; readonly names: readonly [string, string] }[] {
	const declaredNames = new Map(
		declaredClasses(request).map((entry) => [entry.name.toLowerCase(), entry]),
	);
	if (declaredNames.size === 0) return [];
	const sentences = outsideDeclarations(request)
		.split(/[.;\n]+/u)
		.filter((sentence) => WHOLE_PART.test(sentence))
		.map((sentence) => stems(sentence));
	const mermaid = [...request.matchAll(MERMAID_WHOLE_PART)].map((match) =>
		[match[1] ?? "", match[2] ?? ""].map((name) => name.toLowerCase()),
	);
	const unstated = new Set(
		unstatedRelationships(request, diagram).map(({ relationship }) => relationship),
	);
	const nameOfId = new Map(records(diagram["classes"]).map((entry) => [text(entry["id"]), entry]));
	return records(diagram["relationships"]).flatMap((relationship) => {
		const kind = text(relationship["kind"]);
		// An aggregation of a collection field reads as a loose whole; a composition claims ownership.
		if (kind !== "composition" || unstated.has(relationship)) return [];
		const ends = [relationship["from"], relationship["to"]].map(
			(end) => text(end).split(".")[0] ?? "",
		);
		const [a, b] = ends.map((end) =>
			declaredNames.get((text(nameOfId.get(end)?.["name"]) || end).toLowerCase()),
		);
		if (!a || !b || a === b) return [];
		const stated =
			sentences.some((sentence) =>
				[a.name, b.name].every((name) =>
					nameStems(name).every((word) => holds(new Set(sentence), word)),
				),
			) ||
			mermaid.some(
				([left, right]) =>
					(left === a.name.toLowerCase() && right === b.name.toLowerCase()) ||
					(left === b.name.toLowerCase() && right === a.name.toLowerCase()),
			);
		return stated ? [] : [{ relationship, names: [a.name, b.name] as const }];
	});
}

/** Relationships between declared classes that no member, signature, body or sentence supports. */
function unstatedRelationships(
	request: string,
	diagram: Json,
): { readonly relationship: Json; readonly names: readonly [string, string] }[] {
	const declaredNames = new Map(
		declaredClasses(request).map((entry) => [entry.name.toLowerCase(), entry]),
	);
	if (declaredNames.size === 0) return [];
	const clauses = proseClauses(outsideDeclarations(request));
	const mermaidPairs = [...request.matchAll(MERMAID_RELATION)].map((match) =>
		[match[1] ?? "", match[2] ?? ""].map((name) => name.toLowerCase()),
	);
	const nameOfId = new Map(records(diagram["classes"]).map((entry) => [text(entry["id"]), entry]));
	return records(diagram["relationships"]).flatMap((relationship) => {
		const ends = [relationship["from"], relationship["to"]].map(
			(end) => text(end).split(".")[0] ?? "",
		);
		if (!ends[0] || !ends[1] || ends[0] === ends[1]) return [];
		const [a, b] = ends.map((end) =>
			declaredNames.get((text(nameOfId.get(end)?.["name"]) || end).toLowerCase()),
		);
		if (!a || !b) return [];
		const supported =
			a.mentions.has(b.name) ||
			b.mentions.has(a.name) ||
			a.parents.includes(b.name) ||
			b.parents.includes(a.name) ||
			mermaidPairs.some(
				([left, right]) =>
					(left === a.name.toLowerCase() && right === b.name.toLowerCase()) ||
					(left === b.name.toLowerCase() && right === a.name.toLowerCase()),
			) ||
			clauses.some((clause) =>
				[a.name, b.name].every((name) => nameStems(name).every((word) => clause.includes(word))),
			);
		return supported ? [] : [{ relationship, names: [a.name, b.name] as const }];
	});
}

// ---------------------------------------------------------------------------
// Tables declared as SQL

interface ColumnMarkers {
	readonly pk: boolean;
	readonly fk: boolean;
	readonly unique: boolean;
	readonly nullable: boolean;
}

interface DeclaredColumn extends ColumnMarkers {
	readonly name: string;
}

interface DeclaredTable {
	readonly name: string;
	readonly columns: readonly DeclaredColumn[];
	readonly references: readonly string[];
}

const CREATE_TABLE =
	/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:\w+\.)?[`"[]?(\w+)[`"\]]?\s*\(/giu;

function parenBody(source: string, open: number): string {
	let depth = 0;
	for (let index = open; index < source.length; index += 1) {
		if (source[index] === "(") depth += 1;
		else if (source[index] === ")") {
			depth -= 1;
			if (depth === 0) return source.slice(open + 1, index);
		}
	}
	return source.slice(open + 1);
}

function splitTopLevel(body: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let current = "";
	for (const character of body) {
		if (character === "(") depth += 1;
		else if (character === ")") depth -= 1;
		if (character === "," && depth === 0) {
			parts.push(current);
			current = "";
		} else current += character;
	}
	parts.push(current);
	return parts.map((part) => part.trim()).filter(Boolean);
}

const columnNames = (list: string) =>
	[...list.matchAll(/[`"[]?(\w+)[`"\]]?/gu)].map((entry) => (entry[1] ?? "").toLowerCase());

function declaredTables(request: string): DeclaredTable[] {
	return [...request.matchAll(CREATE_TABLE)].flatMap((match) => {
		const name = match[1];
		if (!name) return [];
		const items = splitTopLevel(parenBody(request, (match.index ?? 0) + match[0].length - 1));
		const references: string[] = [];
		const tablePk = new Set<string>();
		const tableUnique = new Set<string>();
		const tableFk = new Set<string>();
		const inline: { name: string; item: string }[] = [];
		for (const item of items) {
			const reference = /\breferences\s+(?:\w+\.)?[`"[]?(\w+)/iu.exec(item)?.[1];
			if (reference) references.push(reference);
			const constraint =
				/^(?:constraint\s+\w+\s+)?(primary\s+key|unique|foreign\s+key)\s*(?:\w+\s*)?\(([^)]*)\)/iu.exec(
					item,
				);
			if (constraint) {
				const kind = (constraint[1] ?? "").toLowerCase();
				const target = kind.startsWith("primary")
					? tablePk
					: kind === "unique"
						? tableUnique
						: tableFk;
				for (const column of columnNames(constraint[2] ?? "")) target.add(column);
				continue;
			}
			if (/^(?:primary|foreign|constraint|unique|check|index|key|exclude)\b/iu.test(item)) continue;
			const column = /^[`"[]?(\w+)/u.exec(item)?.[1];
			if (column) inline.push({ name: column, item });
		}
		const columns = inline.map(({ name: column, item }) => {
			const key = column.toLowerCase();
			const pk = /\bprimary\s+key\b/iu.test(item) || tablePk.has(key);
			return {
				name: column,
				pk,
				fk: /\breferences\b/iu.test(item) || tableFk.has(key),
				unique: !pk && (/\bunique\b/iu.test(item) || tableUnique.has(key)),
				nullable: !pk && !/\bnot\s+null\b/iu.test(item),
			};
		});
		return [{ name, columns, references }];
	});
}

/** The markers a diagram field shows, written as an object or as "name type PK FK UK" with "?" for nullable. */
function fieldMarkers(field: unknown): ColumnMarkers & { readonly name: string } {
	if (typeof field === "string") {
		const tokens = field.trim().split(/\s+/u);
		const upper = tokens.slice(1).map((token) => token.toUpperCase());
		return {
			name: (tokens[0] ?? "").replace(/\?$/u, ""),
			pk: upper.includes("PK"),
			fk: upper.includes("FK"),
			unique: upper.includes("UK") || upper.includes("UNIQUE") || upper.includes("UQ"),
			nullable: tokens.some((token) => token.endsWith("?")) || upper.includes("NULL"),
		};
	}
	const record = isUnknownRecord(field) ? field : {};
	return {
		name: text(record["name"]),
		pk: record["pk"] === true,
		fk: record["fk"] === true,
		unique: record["unique"] === true,
		nullable: record["nullable"] === true,
	};
}

function erIssues(request: string, diagram: Json): CoverageIssue[] {
	const tables = declaredTables(request);
	if (tables.length === 0) return [];
	const entities = records(diagram["entities"]);
	const byName = new Map<string, Json>();
	for (const entity of entities) {
		for (const key of [text(entity["id"]), text(entity["name"])])
			if (key) byName.set(key.toLowerCase(), entity);
	}
	const relationships = records(diagram["relationships"]);
	const issues: CoverageIssue[] = [];
	const missingTables = tables.filter((table) => !byName.has(table.name.toLowerCase()));
	if (missingTables.length > 0) {
		issues.push({
			code: "er_table_missing",
			message: `The request creates ${listed(missingTables.map((table) => table.name))}, but the diagram has no such entity. Draw every table with all its columns.`,
		});
	}
	for (const table of tables) {
		const entity = byName.get(table.name.toLowerCase());
		if (!entity) continue;
		const id = text(entity["id"]);
		const fields = new Map(
			(Array.isArray(entity["fields"]) ? entity["fields"] : [])
				.map(fieldMarkers)
				.map((field) => [field.name.toLowerCase(), field] as const),
		);
		const missing = table.columns.filter((column) => !fields.has(column.name.toLowerCase()));
		if (missing.length > 0) {
			issues.push({
				code: "er_column_missing",
				message: `${table.name} has the columns ${listed(missing.map((column) => column.name))} in the request, but its entity lists ${missing.length === 1 ? "no such field" : "none of them"}. Keep every column.`,
			});
		}
		const wrong = table.columns.flatMap((column) => {
			const shown = fields.get(column.name.toLowerCase());
			if (!shown) return [];
			const fixes = [
				column.pk && !shown.pk ? "PK" : "",
				column.fk && !shown.fk ? "FK" : "",
				column.unique && !shown.unique ? "UK" : "",
				column.nullable && !shown.nullable ? "nullable (?)" : "",
				!column.nullable && shown.nullable ? "not nullable (no ?)" : "",
			].filter(Boolean);
			return fixes.length > 0 ? [`${column.name} ${fixes.join(" ")}`] : [];
		});
		if (wrong.length > 0) {
			issues.push({
				code: "er_marker_mismatch",
				message: `In ${table.name}, the SQL makes ${listed(wrong)}, but the entity shows otherwise. Mark every key PK, FK or UK and every column without NOT NULL with ?, as the SQL states.`,
			});
		}
		for (const reference of table.references) {
			const other = byName.get(reference.toLowerCase());
			if (!other || other === entity) continue;
			const otherId = text(other["id"]);
			const drawn = relationships.some((relationship) => {
				const from = text(relationship["from"]).split(".")[0];
				const to = text(relationship["to"]).split(".")[0];
				return (from === id && to === otherId) || (from === otherId && to === id);
			});
			if (!drawn) {
				issues.push({
					code: "er_reference_missing",
					message: `${table.name} references ${reference}, but no relationship joins them. Draw it from ${table.name} to ${reference}.`,
				});
			}
		}
	}
	return issues;
}

// ---------------------------------------------------------------------------
// Messages listed one per line

const MESSAGE_LINE =
	/^\s*(?:\d+[.)]\s*)?([^\n:>-][^\n:]*?)\s*(-->>|->>|-->|->|=>|→)\s*([^\n:]+?)\s*:\s*(.+?)\s*$/gmu;

function labelMatches(listed: string, drawn: string): boolean {
	const wanted = stems(listed);
	if (wanted.length === 0) return true;
	const shown = new Set(stems(drawn));
	return wanted.filter((word) => holds(shown, word)).length / wanted.length >= 0.5;
}

function sequenceIssues(request: string, diagram: Json): CoverageIssue[] {
	const listed = [...request.matchAll(MESSAGE_LINE)].map((match) => ({
		source: match[1] ?? "",
		target: match[3] ?? "",
		label: match[4] ?? "",
	}));
	if (listed.length < 2) return [];
	const participants = records(diagram["participants"]);
	const participantId = (name: string) => {
		const wanted = normalized(name);
		const exact = participants.find(
			(entry) =>
				normalized(text(entry["label"])) === wanted || normalized(text(entry["id"])) === wanted,
		);
		return text(exact?.["id"]) || undefined;
	};
	const messages = records(diagram["messages"]);
	const missing: string[] = [];
	const positions: number[] = [];
	for (const entry of listed) {
		const source = participantId(entry.source);
		const target = participantId(entry.target);
		if (source === undefined || target === undefined) continue;
		const index = messages.findIndex(
			(message, position) =>
				!positions.includes(position) &&
				message["source"] === source &&
				message["target"] === target &&
				labelMatches(entry.label, text(message["label"])),
		);
		if (index === -1) missing.push(`${entry.source} → ${entry.target}: ${entry.label}`);
		else positions.push(index);
	}
	const issues: CoverageIssue[] = [];
	if (missing.length > 0) {
		issues.push({
			code: "sequence_message_missing",
			message: `The request lists ${quoteList(missing)}, but the diagram has no such message between those participants. Draw every listed message.`,
		});
	}
	const inversion = positions.findIndex(
		(position, index) => index > 0 && position < (positions[index - 1] ?? 0),
	);
	if (inversion > 0) {
		issues.push({
			code: "sequence_order_changed",
			message: `The diagram does not keep the request's numbered order of messages: "${text(messages[positions[inversion] ?? 0]?.["label"])}" comes before "${text(messages[positions[inversion - 1] ?? 0]?.["label"])}". Keep the listed order exactly.`,
		});
	}
	return issues;
}

// ---------------------------------------------------------------------------
// Flowchart connections drawn with arrows, and named containers

const ARROW = /\s*(?:→|->|=>|⟶)\s*/u;
const BRANCH_ANSWER = /^(?:yes|no|y|n|true|false|ok|pass(?:es|ed)?|fail(?:s|ed)?)[.,:]?$/iu;
const DIRECTION =
	/\b(?:L|R|T|B|left|right|top|bottom)\s*(?:→|->|to)\s*(?:L|R|T|B|left|right|top|bottom)\b/giu;

function chainItems(segment: string, position: "first" | "middle" | "last"): string[] {
	let value = segment;
	// The words before a chain's first arrow and after its last can belong to other sentences.
	if (position === "first") value = value.split(/[.:;!?]\s|\n/u).at(-1) ?? value;
	if (position === "last") value = value.split(/[.;!?]\s|[.;!?]$|\n/u)[0] ?? value;
	value = value.replace(/\([^)]*\)/gu, " ").replace(/[:,]\s*$/u, "");
	return (
		value
			// Only "+" and "&" list parallel ends; a comma or "and" in prose usually continues a sequence.
			.split(/\s*\+\s*|\s*&\s*/u)
			.map((item) => item.trim())
			.filter((item) => stems(item).length > 0)
	);
}

/**
 * The arrow chains of a request, one per line or clause. A ";" ends a chain, and so does a
 * parenthesized branch with arrows of its own ("complete? (no → ask; yes → check)"), which states
 * what follows the step before it only through the answer inside.
 */
function arrowChains(request: string): string[] {
	let flattened = request;
	for (let previous = ""; previous !== flattened;) {
		previous = flattened;
		flattened = flattened.replace(/\(([^()]*)\)/gu, (group, inner: string) =>
			ARROW.test(inner) ? `;${inner};` : group,
		);
	}
	return flattened.split(/[\n;]/u);
}

/** The one node an item names, by most of its words, or none when it names none or several. */
function nodeMatcher(nodes: readonly Json[]): (item: string) => number | undefined {
	const nodeStems = nodes.map(
		(node) => new Set(stems(`${text(node["label"])} ${text(node["id"])}`)),
	);
	return (item) => {
		const wanted = stems(item);
		const scores = nodeStems.map(
			(shown) => wanted.filter((word) => holds(shown, word)).length / wanted.length,
		);
		const best = Math.max(...scores);
		if (!(best >= 0.75)) return undefined;
		const winners = scores.flatMap((score, index) => (score === best ? [index] : []));
		return winners.length === 1 ? winners[0] : undefined;
	};
}

function flowchartIssues(request: string, diagram: Json): CoverageIssue[] {
	const nodes = records(diagram["nodes"]);
	const edges = records(diagram["edges"]);
	const match = nodeMatcher(nodes);
	const outgoing = new Map<string, string[]>();
	for (const edge of edges) {
		const source = text(edge["source"]);
		outgoing.set(source, [...(outgoing.get(source) ?? []), text(edge["target"])]);
	}
	// A stated order can pass through intermediate steps; arrow chains limit those to three.
	const reaches = (from: string, to: string, blocked = new Set<string>(), limit = nodes.length) => {
		let frontier = [from];
		const seen = new Set(frontier);
		for (let depth = 0; depth < limit; depth += 1) {
			const next: string[] = [];
			for (const id of frontier) {
				for (const target of outgoing.get(id) ?? []) {
					if (target === to) return true;
					if (seen.has(target) || blocked.has(target)) continue;
					seen.add(target);
					next.push(target);
				}
			}
			frontier = next;
		}
		return false;
	};
	const issues: CoverageIssue[] = [];
	const missing: string[] = [];
	for (const line of arrowChains(request.replace(DIRECTION, " "))) {
		// A yes or no between two arrows labels the edge rather than naming a step.
		const segments = line.split(ARROW).filter((segment) => !BRANCH_ANSWER.test(segment.trim()));
		if (segments.length < 2) continue;
		const items = segments.map((segment, index) =>
			chainItems(
				segment,
				index === 0 ? "first" : index === segments.length - 1 ? "last" : "middle",
			),
		);
		const matched = items.map((group) => group.map((item) => ({ item, node: match(item) })));
		const chainNodes = new Set(
			matched
				.flat()
				.flatMap((entry) => (entry.node === undefined ? [] : [text(nodes[entry.node]?.["id"])])),
		);
		for (let index = 1; index < matched.length; index += 1) {
			for (const from of matched[index - 1] ?? []) {
				for (const to of matched[index] ?? []) {
					if (from.node === undefined || to.node === undefined || from.node === to.node) continue;
					const fromId = text(nodes[from.node]?.["id"]);
					const toId = text(nodes[to.node]?.["id"]);
					if (!reaches(fromId, toId, chainNodes, 3)) missing.push(`${from.item} → ${to.item}`);
				}
			}
		}
	}
	// Prose is checked only when both sides explicitly name one unambiguous node.
	// Read the closest complete label before/after the connective, not incidental
	// mentions elsewhere in the sentence; negated ordering is left to the model.
	const proseNode = (phrase: string, before: boolean): number | undefined => {
		const tokens = stems(phrase);
		const candidates = nodes
			.flatMap((node, index) => {
				const wanted = stems(text(node["label"]));
				if (wanted.length === 0) return [];
				const positions = wanted.map((word) =>
					before
						? tokens.findLastIndex((token) => holds(new Set([token]), word))
						: tokens.findIndex((token) => holds(new Set([token]), word)),
				);
				if (positions.some((position) => position < 0)) return [];
				return [
					{
						index,
						near: before ? Math.min(...positions) : -Math.max(...positions),
						words: wanted.length,
					},
				];
			})
			.sort((left, right) => right.near - left.near || right.words - left.words);
		const [first, second] = candidates;
		return first && !(second && first.near === second.near && first.words === second.words)
			? first.index
			: undefined;
	};
	for (const sentence of request.split(/[.!;\n]/u)) {
		// Conditional alternatives do not state an order between their outcomes.
		// Skip uncertain prose rather than spending a repair on a false connection.
		if (NEGATES_ORDER.test(sentence) || /\bif\b.*\bthen\b|\b(?:otherwise|else)\b/iu.test(sentence))
			continue;
		const parts = sentence.split(/\b(?:before|then)\b/iu);
		for (let index = 1; index < parts.length; index += 1) {
			const left = parts[index - 1] ?? "";
			const from = proseNode(left, true);
			const to = proseNode(parts[index] ?? "", false);
			if (from === undefined || to === undefined || from === to) continue;
			if (!reaches(text(nodes[from]?.["id"]), text(nodes[to]?.["id"])))
				missing.push(`${text(nodes[from]?.["label"])} → ${text(nodes[to]?.["label"])}`);
		}
	}

	if (missing.length > 0) {
		issues.push({
			code: "flowchart_connection_missing",
			message: `The request connects ${quoteList([...new Set(missing)])}, but the diagram has no directed path between them. Keep every stated arrow, "X before Y" and "X then Y" continuation; "a + b → c" means both a → c and b → c.`,
		});
	}
	const unshown = returnActions(request, nodes, edges);
	if (unshown.length > 0) {
		issues.push({
			code: "flowchart_return_step_missing",
			message: `The request states ${quoteList(unshown)} before a step repeats, but no node on that loop shows ${unshown.length === 1 ? "it" : "them"}. Give each such action its own node on the return path, then connect it back to the repeated step.`,
		});
	}
	const folded = foldedChecks(request, nodes, edges);
	if (folded.length > 0) {
		issues.push({
			code: "flowchart_check_step_missing",
			message: `The request states ${quoteList(folded)} as a step, but the diagram folds ${folded.length === 1 ? "it" : "them"} into a decision. Draw each check as its own process node right before the decision that reads its result.`,
		});
	}
	for (const { step, given, borrowers } of borrowedSteps(request, nodes, edges, match)) {
		issues.push({
			code: "flowchart_step_borrowed",
			message: `The request gives "${step}" to ${listed(given)}, but the diagram also leads ${quoteList(borrowers)} into it. Remove ${borrowers.length === 1 ? "that arrow" : "those arrows"}, and any copy of "${step}" only it reaches, so ${borrowers.length === 1 ? "that step ends its branch" : "each such step ends its branch"} with no new arrow: a branch with no stated next step ends at its last step.`,
		});
	}
	for (const { step, next } of splitSteps(request, nodes, edges)) {
		issues.push({
			code: "flowchart_step_split",
			message: `The diagram draws "${step}" more than once, and only some copies continue to ${quoteList(next)}. If the request means one step, draw it once and point every branch that reaches it at that node; if the copies are different steps, label each with the request's own distinguishing words.`,
		});
	}

	const containers = records(diagram["groups"])
		.concat(records(diagram["lanes"]))
		.map((group) => new Set(stems(`${text(group["label"])} ${text(group["id"])}`)));
	const missingContainers: string[] = [];
	const placements = placementStatements(request, nodes);
	const zones = namedContainers(request);
	for (const named of zones) {
		// "the VPC" after "our production VPC" is that zone, checked and described under its name.
		if (named.modifiers.length === 0 && qualifiedZone(zones, named.heads)) continue;
		const found = containers.some(
			(container) =>
				named.heads.every((head) => holds(container, head)) &&
				(named.modifiers.length === 0 || named.modifiers.some((word) => holds(container, word))),
		);
		if (!found) missingContainers.push(missingZone(named, zones, placements, nodes, match));
	}
	if (missingContainers.length > 0) {
		const unique = [...new Set(missingContainers)];
		issues.push({
			code: "flowchart_container_missing",
			message: `The request names ${listed(unique)}, but no group carries ${unique.length === 1 ? "that name" : "those names"}. Make every named zone a group holding what the request puts in it, nested in the zone that holds it.`,
		});
	}
	issues.push(...containmentIssues(request, nodes, records(diagram["groups"]), match));
	return issues;
}

/** A clause that goes back to an earlier step: "checks again", "loops back to", "repeat the review". */
const RETURNS = /\b(?:again|back\s+to|loops?\s+back|returns?\s+to|repeats?)\b/iu;
/** A clause that states when, not what: the condition before a branch's actions. */
const CONDITION = /\b(?:if|when|whenever|unless|once|after|before|while|until)\b/iu;
/** The condition that ends a repeat: "until done", "while pending". */
const LOOP_CONDITION = /\s*\b(?:until|till|unless|while|as long as|if|when|once)\b.*$/iu;
/** Words that name no action of their own: "keeps waiting" acts by waiting. */
const AUXILIARY = new Set(
	"keep keeps keeping continue continues stay stays remain remains go goes going through still just instead get gets start starts begin begins will can may must should would not no never"
		.split(" ")
		.map(stem),
);

/**
 * Actions a request states on the way back to an earlier step ("not ready keeps waiting and
 * checks again") that no node on a loop shows. Words a decision already shows are the branch's
 * condition, not its action. Arrow chains are left to the connection check.
 */
function returnActions(request: string, nodes: readonly Json[], edges: readonly Json[]): string[] {
	const ids = nodes.map((node) => text(node["id"]));
	const labelStems = nodes.map((node) => new Set(stems(text(node["label"]))));
	const decisionStems = new Set(
		nodes.flatMap((node, index) =>
			node["kind"] === "decision" ? [...(labelStems[index] ?? [])] : [],
		),
	);
	const successors = new Map<string, string[]>();
	for (const edge of edges) {
		const source = text(edge["source"]);
		successors.set(source, [...(successors.get(source) ?? []), text(edge["target"])]);
	}
	const reaches = (from: string, to: string) => {
		const seen = new Set<string>();
		const pending = [...(successors.get(from) ?? [])];
		while (pending.length > 0) {
			const id = pending.pop() ?? "";
			if (id === to) return true;
			if (seen.has(id)) continue;
			seen.add(id);
			pending.push(...(successors.get(id) ?? []));
		}
		return false;
	};
	const onLoop = new Set(ids.filter((id) => reaches(id, id)));
	const missing: string[] = [];
	for (const line of request.split("\n")) {
		if (ARROW.test(line)) continue;
		for (const sentence of line.split(/[.!?;]/u)) {
			const conjuncts = sentence
				.split(/,|\b(?:and|then|but)\b/iu)
				.map((part) => part.trim())
				.filter(Boolean);
			const back = conjuncts.findIndex((part) => RETURNS.test(part));
			const action = conjuncts[back - 1];
			const repeat = conjuncts[back] ?? "";
			// A forbidden action is no step to draw, and a stated condition is no action.
			if (
				back < 1 ||
				action === undefined ||
				CONDITION.test(action) ||
				NEGATED_ACTION.test(action) ||
				NEGATED_ACTION.test(repeat)
			)
				continue;
			// "repeat Check status until done" repeats Check status; "until done" is when it stops.
			const repeated = new Set(stems(repeat.replace(LOOP_CONDITION, "")));
			const repeatedStep = [...repeated].filter(
				(word) => !AUXILIARY.has(word) && !RETURNS.test(word) && !/^(?:loop|back)$/u.test(word),
			);
			const wanted = stems(action).filter(
				(word) => !AUXILIARY.has(word) && !holds(decisionStems, word) && !holds(repeated, word),
			);
			if (wanted.length === 0) continue;
			const shown = nodes.some((node, index) => {
				if (node["kind"] === "decision") return false;
				if (!wanted.some((word) => holds(labelStems[index] ?? new Set(), word))) return false;
				const id = text(node["id"]);
				// An unrolled repeat draws the action just before a node for the step it repeats.
				const leadsToRepeat =
					repeatedStep.length > 0 &&
					(successors.get(id) ?? []).some((next) => {
						const stemsOfNext = labelStems[ids.indexOf(next)] ?? new Set();
						return repeatedStep.every((word) => holds(stemsOfNext, word));
					});
				return onLoop.size === 0 || onLoop.has(id) || leadsToRepeat;
			});
			if (!shown) missing.push(action);
		}
	}
	return [...new Set(missing)];
}

/** A label word that names a check: "Verify", "verification", "Check", "validated". */
const CHECK_WORD = /^(?:check|verif|validat|inspect|audit)/u;
/**
 * A verification stated as an action: "verify the badge", "validate the payload". "check the
 * cache" often names only the decision that follows ("On a hit, …"), so only its passive form,
 * "stock is checked", states a step.
 */
const ACTIVE_CHECK =
	/\b(?:verify|verifies|verifying|validate|validates|validating|inspect|inspects|inspecting|audit|audits|auditing)\s+([^,.;:!?()\n]+)/giu;
/** A check stated of its object: "the badge is verified", "stock is checked". */
const PASSIVE_CHECK =
	/([^,.;:!?()\n]+?)\s+(?:is|are|gets?|was|were)\s+(?:(?:then|first|also|now)\s+)?(?:checked|verified|validated|inspected|audited)\b([^,.;:!?()\n]*)/giu;
/** Where a check's object ends: the next clause, step or qualifier. */
const OBJECT_END =
	/\s+(?:and|or|then|before|after|to|for|with|if|when|until|so|against|by|while|once|but|on|in|at)\b.*$/iu;
/** An object that states the result ("the payment is authorized"): the check is that decision alone. */
const STATES_RESULT = /\b(?:is|are|was|were|has|have|can|will|whether|if|that)\b/iu;

/**
 * Checks a request states as a step of their own ("verify the badge", "stock is checked") that
 * the diagram folds into the decision reading their result ("Verify badge?", "Stock low?"): a
 * decision names the checked thing, and no other node does with a check word or right before it.
 * "check whether X" states only that decision.
 */
function foldedChecks(request: string, nodes: readonly Json[], edges: readonly Json[]): string[] {
	const stated: { readonly phrase: string; readonly object: string[] }[] = [];
	const objectStems = (phrase: string) =>
		stems(phrase.replace(OBJECT_END, "")).filter(
			(word) => word.length >= 3 && !AUXILIARY.has(word),
		);
	for (const sentence of request.split(/[.!?;\n]/u)) {
		if (NEGATED_ACTION.test(sentence)) continue;
		for (const match of sentence.matchAll(ACTIVE_CHECK)) {
			const object = (match[1] ?? "").replace(/^\s*for\s+/iu, "").replace(OBJECT_END, "");
			if (/^\s*(?:whether|if|that|to\s+see)\b/iu.test(match[1] ?? "") || STATES_RESULT.test(object))
				continue;
			stated.push({ phrase: match[0].replace(OBJECT_END, "").trim(), object: objectStems(object) });
		}
		for (const match of sentence.matchAll(PASSIVE_CHECK)) {
			if (/^\s*(?:for\s+)?(?:whether|if|that)\b/iu.test(match[2] ?? "")) continue;
			// "an order is placed and the badge is verified": the subject is the last phrase. In
			// "if the badge is verified, open the door" the check is the condition, not a step.
			const parts = (match[1] ?? "").split(
				/(,|\b(?:and|then|but|or|once|after|before|when|whenever|if|unless|until|while|whether)\b)/iu,
			);
			if (CONDITION.test(parts.at(-2) ?? "") || /\bwhether\b/iu.test(parts.at(-2) ?? "")) continue;
			const subject = parts.at(-1) ?? "";
			stated.push({
				phrase: `${subject.trim()} ${match[0]
					.slice((match[1] ?? "").length)
					.replace(OBJECT_END, "")
					.trim()}`,
				object: objectStems(subject).slice(-3),
			});
		}
	}
	const ids = nodes.map((node) => text(node["id"]));
	const labelStems = nodes.map((node) => [...new Set(stems(text(node["label"])))]);
	// "availability" and "Available?" name one thing: words that share their first six letters.
	const names = (index: number, word: string) =>
		(labelStems[index] ?? []).some(
			(other) => holds(new Set([other]), word) || sharedPrefix(other, word) >= 6,
		);
	const decision = (index: number) =>
		nodes[index]?.["kind"] === "decision" || text(nodes[index]?.["label"]).trim().endsWith("?");
	const folded: string[] = [];
	for (const { phrase, object } of stated) {
		if (object.length === 0) continue;
		const decisions = new Set(
			nodes.flatMap((_, index) =>
				decision(index) && object.every((word) => names(index, word)) ? [ids[index] ?? ""] : [],
			),
		);
		if (decisions.size === 0) continue;
		const before = new Set(
			edges.flatMap((edge) => (decisions.has(text(edge["target"])) ? [text(edge["source"])] : [])),
		);
		// The check as a node: a check word on the checked thing, or a step on it right before.
		const shown = nodes.some(
			(node, index) =>
				!decision(index) &&
				object.some((word) => names(index, word)) &&
				(before.has(ids[index] ?? "") ||
					words(text(node["label"])).some((word) => CHECK_WORD.test(word))),
		);
		if (!shown) folded.push(phrase);
	}
	return [...new Set(folded)];
}

/** How many leading letters two words share. */
function sharedPrefix(left: string, right: string): number {
	let index = 0;
	while (index < left.length && index < right.length && left[index] === right[index]) index += 1;
	return index;
}

/** Branches a request lists as sharing a step: "retry and fallback paths both log the attempt". */
const SHARED_BY =
	/^\s*(.+?\s+and\s+.+?)\s+(?:(?:paths?|branches?|routes?|cases?)\s+)?(?:both|each|all)\s+(.+)$/iu;

/**
 * A step the request gives to listed branches ("A and B both check stock") that the diagram also
 * gives a sibling branch the request leaves out: a branch of the same decision, or of a decision
 * chained to it, leads into it through plain steps alone. Each listed branch and the step must
 * name nodes unmistakably.
 */
function borrowedSteps(
	request: string,
	nodes: readonly Json[],
	edges: readonly Json[],
	matchNode: (item: string) => number | undefined,
): {
	readonly step: string;
	readonly given: string[];
	readonly borrowers: string[];
	/** The arrows a fix removes: each borrower's into the step, and on from a copy only it reaches. */
	readonly arrows: readonly (readonly [string, string])[];
}[] {
	const ids = nodes.map((node) => text(node["id"]));
	const targets = new Map<string, string[]>();
	for (const edge of edges) {
		const source = text(edge["source"]);
		targets.set(source, [...(targets.get(source) ?? []), text(edge["target"])]);
	}
	const found: {
		step: string;
		given: string[];
		borrowers: string[];
		arrows: (readonly [string, string])[];
	}[] = [];
	for (const sentence of request.split(/[.!?;\n]/u)) {
		const shared = SHARED_BY.exec(sentence);
		if (!shared || NEGATED_ACTION.test(sentence)) continue;
		const items = (shared[1] ?? "")
			.split(/\s*,\s*(?:and\s+)?|\s+and\s+/iu)
			.map((item) => item.replace(/^(?:the|both)\s+/iu, "").trim())
			.filter(Boolean);
		const given = items.map(matchNode);
		if (items.length < 2 || given.some((index) => index === undefined)) continue;
		const givenIds = new Set(given.map((index) => ids[index ?? -1] ?? ""));
		// The step: the nodes the rest names in full, the longest such label, every copy of it.
		const said = new Set(stems(shared[2] ?? ""));
		const named = nodes.flatMap((node, index) => {
			const wanted = stems(text(node["label"]));
			return wanted.length > 0 &&
				!givenIds.has(ids[index] ?? "") &&
				wanted.every((word) => holds(said, word))
				? [{ index, size: wanted.length, label: normalized(text(node["label"])) }]
				: [];
		});
		const size = Math.max(0, ...named.map((entry) => entry.size));
		const label = named.find((entry) => entry.size === size)?.label;
		const step = new Set(
			named.flatMap((entry) => (entry.label === label ? [ids[entry.index] ?? ""] : [])),
		);
		if (step.size === 0) continue;
		// Another sentence may give the step to a branch too: "production also runs smoke tests"
		// names the step in full and a word of that branch no listed branch has.
		const givenWords = new Set(
			[...givenIds].flatMap((id) => stems(text(nodes[ids.indexOf(id)]?.["label"]))),
		);
		const stepWords = stems(text(nodes[ids.indexOf([...step][0] ?? "")]?.["label"]));
		const statedElsewhere = (id: string) =>
			request
				.split(/[.!?;\n]/u)
				.filter((other) => other !== sentence)
				.some((other) => {
					const said = new Set(stems(other));
					return (
						stepWords.every((word) => holds(said, word)) &&
						stems(text(nodes[ids.indexOf(id)]?.["label"])).some(
							(word) => !givenWords.has(word) && !stepWords.includes(word) && holds(said, word),
						)
					);
				});
		// A choice drawn as a chain of decisions ("Deploy issue?" no to "Code issue?") offers each
		// later decision's branches beside the earlier ones.
		const decision = (id: string) => {
			const node = nodes[ids.indexOf(id)];
			return node?.["kind"] === "decision" || text(node?.["label"]).trim().endsWith("?");
		};
		const branches = (parent: string, seen: Set<string>): string[] =>
			(targets.get(parent) ?? []).flatMap((child) => {
				if (seen.has(child)) return [];
				seen.add(child);
				const chained = decision(child) && !givenIds.has(child) && !step.has(child);
				return [child, ...(chained ? branches(child, seen) : [])];
			});
		// A branch may start a few plain steps before a listed one ("Deploy issue" then "Roll back"),
		// and a sibling may run a few plain steps before it reaches the shared step.
		const sources = new Map<string, string[]>();
		for (const [source, next] of targets)
			for (const target of next) sources.set(target, [...(sources.get(target) ?? []), source]);
		const plain = (id: string) => !decision(id) && !givenIds.has(id) && !step.has(id);
		const branchHead = (id: string) => {
			let head = id;
			for (let hops = 0; hops < 4; hops += 1) {
				const [parent, ...others] = sources.get(head) ?? [];
				if (!parent || others.length > 0 || !plain(parent) || targets.get(parent)?.length !== 1)
					break;
				head = parent;
			}
			return head;
		};
		// What the listed branches reach on their way to the step: a sibling that merges into it
		// shares their path rather than borrowing the step.
		const listedPath = new Set<string>(givenIds);
		for (const queue = [...givenIds]; queue.length > 0;) {
			for (const next of targets.get(queue.pop() ?? "") ?? []) {
				if (step.has(next) || listedPath.has(next)) continue;
				listedPath.add(next);
				queue.push(next);
			}
		}
		/** A sibling's own run of plain steps straight into the step, if it shares none of them. */
		const runInto = (id: string): string[] | undefined => {
			const run = [id];
			for (let hops = 0; hops < 4; hops += 1) {
				const current = run.at(-1) ?? "";
				if (listedPath.has(current)) return undefined;
				const next = targets.get(current) ?? [];
				if (next.some((target) => step.has(target))) return run;
				const [only, ...others] = next;
				if (!only || others.length > 0 || !plain(only)) return undefined;
				run.push(only);
			}
			return undefined;
		};
		const borrowers = new Set<string>();
		for (const given of givenIds) {
			const head = branchHead(given);
			for (const parent of sources.get(head) ?? []) {
				for (const child of branches(parent, new Set([parent]))) {
					if (child === head || givenIds.has(child) || step.has(child) || child === parent)
						continue;
					const run = runInto(child);
					// The request may give the step to that branch elsewhere: "Production also runs smoke tests".
					if (run && !run.some(statedElsewhere)) borrowers.add(run.at(-1) ?? child);
				}
			}
		}
		if (borrowers.size === 0) continue;
		const labelOf = (id: string) => text(nodes[ids.indexOf(id)]?.["label"]);
		const into = [...borrowers].flatMap((id) =>
			(targets.get(id) ?? []).flatMap((next) => (step.has(next) ? [[id, next] as const] : [])),
		);
		const onlyBorrowed = [...step].filter((id) =>
			[...targets].every(([source, next]) => !next.includes(id) || borrowers.has(source)),
		);
		found.push({
			step: labelOf([...step][0] ?? ""),
			given: [...givenIds].map(labelOf),
			borrowers: [...borrowers].map(labelOf),
			arrows: [
				...into,
				...onlyBorrowed.flatMap((id) => (targets.get(id) ?? []).map((next) => [id, next] as const)),
			],
		});
	}
	return found;
}

/**
 * A stated step drawn as several nodes of one label where some copies continue and others end
 * there, as when a branch that should rejoin a step gets a dead-end copy of it instead.
 */
function splitSteps(
	request: string,
	nodes: readonly Json[],
	edges: readonly Json[],
): { readonly step: string; readonly next: string[] }[] {
	const requested = new Set(stems(request));
	const labelOf = new Map(nodes.map((node) => [text(node["id"]), normalized(text(node["label"]))]));
	const successors = new Map<string, string[]>();
	for (const edge of edges) {
		const source = text(edge["source"]);
		successors.set(source, [...(successors.get(source) ?? []), text(edge["target"])]);
	}
	const copies = new Map<string, Json[]>();
	for (const node of nodes) {
		const label = normalized(text(node["label"]));
		if (!label || node["kind"] === "decision" || text(node["label"]).trim().endsWith("?")) continue;
		copies.set(label, [...(copies.get(label) ?? []), node]);
	}
	const split: { step: string; next: string[] }[] = [];
	for (const [label, drawn] of copies) {
		if (drawn.length < 2) continue;
		const wanted = stems(label);
		if (wanted.length === 0 || !wanted.every((word) => holds(requested, word))) continue;
		const onward = drawn.map((node) =>
			(successors.get(text(node["id"])) ?? []).filter((next) => labelOf.get(next) !== label),
		);
		const ends = drawn.filter((node) => (successors.get(text(node["id"])) ?? []).length === 0);
		const next = [...new Set(onward.flat())].map((id) =>
			text(nodes.find((node) => text(node["id"]) === id)?.["label"]),
		);
		if (ends.length > 0 && next.length > 0) split.push({ step: text(drawn[0]?.["label"]), next });
	}
	return split;
}

/**
 * What the request puts inside a named zone, as "ALB (public subnet)" or "VPC + S3 are in
 * us-east-1", drawn outside it.
 */
function containmentIssues(
	request: string,
	nodes: readonly Json[],
	groups: readonly Json[],
	matchNode: (item: string) => number | undefined,
): CoverageIssue[] {
	if (groups.length === 0) return [];
	const groupStems = groups.map(
		(group) => new Set(stems(`${text(group["label"])} ${text(group["id"])}`)),
	);
	const parentOf = new Map(groups.map((group) => [text(group["id"]), text(group["parent"])]));
	const ancestors = (id: string) => {
		const chain = new Set<string>();
		for (let current = id; current && !chain.has(current); current = parentOf.get(current) ?? "")
			chain.add(current);
		return chain;
	};
	/** The one group a zone phrase names, if exactly one does. */
	const zoneGroup = (phrase: string): number | undefined => {
		const named = zoneName(phrase);
		if (!named) return undefined;
		const hits = groupStems.flatMap((shown, index) =>
			named.heads.every((head) => holds(shown, head)) &&
			(named.modifiers.length === 0 || named.modifiers.some((word) => holds(shown, word)))
				? [index]
				: [],
		);
		return hits.length === 1 ? hits[0] : undefined;
	};
	/** Groups an item names: "the subnets" names every subnet; nodes otherwise. */
	const resolve = (item: string): { groups: number[]; node?: number } => {
		const plural =
			/^(?:the\s+|our\s+|all\s+|both\s+)*(subnets|vpcs|namespaces|clusters|regions|zones|networks)$/iu.exec(
				item.trim(),
			);
		if (plural) {
			const head = stem((plural[1] ?? "").toLowerCase());
			return { groups: groupStems.flatMap((shown, index) => (holds(shown, head) ? [index] : [])) };
		}
		const group = zoneGroup(item);
		if (group !== undefined) return { groups: [group] };
		const node = matchNode(item);
		return node === undefined ? { groups: [] } : { groups: [], node };
	};
	/** The longest end of a clause that names a node or zone: "saves files to a file server" names the server. */
	const namingTail = (phrase: string) => {
		const parts = phrase.trim().split(/\s+/u);
		for (let start = 0; start < parts.length; start += 1) {
			const tail = parts.slice(start).join(" ");
			const resolved = resolve(tail);
			if (resolved.node !== undefined || resolved.groups.length > 0) return tail;
		}
		return phrase;
	};
	const stated = placementStatements(request, nodes, namingTail);
	const outside: string[] = [];
	const merged: string[] = [];
	// Two statements of one fact, such as "VPC + S3 are in us-east-1" and "the VPC … in us-east-1".
	const checked = new Set<string>();
	/** Each node's stated zones, and the zones whose members the request names. */
	const zonesOf = new Map<number, { readonly container: number; readonly zone: string }[]>();
	const withMembers = new Set<number>();
	for (const { item, zone, node } of stated) {
		const container = zoneGroup(zone);
		if (container === undefined || stems(item).length === 0) continue;
		const zoneId = text(groups[container]?.["id"]);
		const resolved = node === undefined ? resolve(item) : { groups: [], node };
		const statement = `${item.trim()} in ${zone.trim()}`;
		if (resolved.node !== undefined || resolved.groups.some((index) => index !== container))
			withMembers.add(container);
		if (resolved.node !== undefined) {
			if (checked.has(`node ${resolved.node} ${container}`)) continue;
			checked.add(`node ${resolved.node} ${container}`);
			zonesOf.set(resolved.node, [...(zonesOf.get(resolved.node) ?? []), { container, zone }]);
			if (!ancestors(text(nodes[resolved.node]?.["group"])).has(zoneId)) outside.push(statement);
			continue;
		}
		for (const index of resolved.groups) {
			if (checked.has(`group ${index} ${container}`)) continue;
			checked.add(`group ${index} ${container}`);
			if (index === container) {
				// One group named for two zones the request nests, such as "Production VPC (eu-west-1)".
				if (!sameZone(item, zone)) merged.push(statement);
			} else if (!ancestors(text(groups[index]?.["parent"])).has(zoneId)) outside.push(statement);
		}
	}
	// "the VPC, queue and table are all in eu-west-1": the queue sits beside the VPC, not in it. A
	// node drawn inside a zone whose members the request names, but not it, adds a placement.
	const groupIndex = new Map(groups.map((group, index) => [text(group["id"]), index]));
	const inside = (inner: number, outer: number) =>
		ancestors(text(groups[inner]?.["id"])).has(text(groups[outer]?.["id"]));
	const added: string[] = [];
	for (const [node, placed] of zonesOf) {
		const drawn = [...ancestors(text(nodes[node]?.["group"]))].flatMap((id) => {
			const index = groupIndex.get(id);
			return index === undefined ? [] : [index];
		});
		for (const { container, zone } of placed) {
			if (!drawn.includes(container)) continue;
			const extra = drawn.find(
				(index) =>
					index !== container &&
					inside(index, container) &&
					withMembers.has(index) &&
					!placed.some((other) => inside(other.container, index)),
			);
			if (extra !== undefined)
				added.push(
					`${text(nodes[node]?.["label"])} in ${zone.trim()}, not in ${text(groups[extra]?.["label"])}`,
				);
		}
	}
	const issues: CoverageIssue[] = [];
	if (added.length > 0)
		issues.push({
			code: "flowchart_containment_unstated",
			message: `The request puts ${quoteList([...new Set(added)])}, but the diagram draws ${added.length === 1 ? "it" : "them"} inside that inner zone too, which the request gives other members. Move each to the zone the request puts it in.`,
		});
	if (outside.length > 0)
		issues.push({
			code: "flowchart_containment_wrong",
			message: `The request puts ${quoteList([...new Set(outside)])}, but the diagram draws ${outside.length === 1 ? "it" : "them"} outside. Set each node's group, and each group's parent, to the zone the request puts it in.`,
		});
	if (merged.length > 0)
		issues.push({
			code: "flowchart_zone_merged",
			message: `The request puts ${quoteList([...new Set(merged)])}, but one group stands for both zones. Draw each as its own group, the inner zone's parent set to the outer one.`,
		});
	return issues;
}

/**
 * A named zone the diagram lacks, quoted with the zone the request puts it in and the steps it
 * puts in it: '"corporate network" (inside "on-prem data center", holding "Office staff" and
 * "Legacy ERP")', so a repair draws the group whole.
 */
function missingZone(
	named: NamedZone,
	zones: readonly NamedZone[],
	placements: readonly Placement[],
	nodes: readonly Json[],
	matchNode: (item: string) => number | undefined,
): string {
	/** The zone a phrase names, a bare "the VPC" standing for the request's one qualified VPC. */
	const resolved = (phrase: string) => {
		const zone = zoneName(phrase);
		if (!zone || zone.modifiers.length > 0) return zone;
		const qualified = qualifiedZone(zones, zone.heads);
		return qualified ?? zone;
	};
	const names = (phrase: string) => {
		const zone = resolved(phrase);
		return (
			zone !== undefined &&
			zone.heads.join(" ") === named.heads.join(" ") &&
			(named.modifiers.length === 0 ||
				zone.modifiers.some((word) => named.modifiers.includes(word)))
		);
	};
	const shown = (phrase: string) => {
		const zone = zoneName(phrase);
		const qualified = zone?.modifiers.length === 0 ? qualifiedZone(zones, zone.heads) : undefined;
		return qualified?.phrase ?? phrase.trim().replace(/^(?:the|our|a|an)\s+/iu, "");
	};
	const outer = placements.flatMap(({ item, zone }) =>
		names(item) && !names(zone) ? [shown(zone)] : [],
	);
	const members = placements.flatMap(({ item, zone, node }) => {
		if (!names(zone) || zoneName(item)) return [];
		const index = node ?? matchNode(item);
		return index === undefined ? [] : [text(nodes[index]?.["label"])];
	});
	const details = [
		...(outer[0] ? [`inside "${outer[0]}"`] : []),
		...(members.length > 0 ? [`holding ${quoteList([...new Set(members)])}`] : []),
	];
	return `"${named.phrase}"${details.length > 0 ? ` (${details.join(", ")})` : ""}`;
}

interface NamedZone {
	readonly phrase: string;
	readonly heads: readonly string[];
	readonly modifiers: readonly string[];
}

/**
 * The one qualified zone of a kind the request names ("production VPC"), which a bare mention of
 * that kind ("the VPC") refers back to; none when the request names several or none.
 */
function qualifiedZone(
	zones: readonly NamedZone[],
	heads: readonly string[],
): NamedZone | undefined {
	const qualified = new Map(
		zones
			.filter((zone) => zone.modifiers.length > 0 && zone.heads.join(" ") === heads.join(" "))
			.map((zone) => [zone.modifiers.join(" "), zone]),
	);
	return qualified.size === 1 ? [...qualified.values()][0] : undefined;
}

/** What a request places in a zone: a step or zone, the zone's phrase, and the node it names. */
interface Placement {
	readonly item: string;
	readonly zone: string;
	readonly node?: number;
}

/**
 * Every placement a request states: "ALB (public subnet)", "the VPC and queue are in
 * eu-west-1", "staff and ERP, both on the corporate network", "gateway in our production VPC",
 * and a line headed by a zone. `tail` picks the words of a clause's end that name its item.
 */
function placementStatements(
	request: string,
	nodes: readonly Json[],
	tail: (phrase: string) => string = (phrase) => phrase,
): Placement[] {
	/** Nodes a phrase names in full: "office staff enter orders in the legacy ERP" names both. */
	const mentioned = (phrase: string) => {
		const said = new Set(stems(phrase));
		return nodes.flatMap((node, index) => {
			const wanted = stems(text(node["label"]));
			return wanted.length > 0 && wanted.every((word) => holds(said, word)) ? [index] : [];
		});
	};
	const stated: Placement[] = [];
	for (const match of request.matchAll(/([^()→\n,.;:]+?)\s*\(([^()]+)\)/gu)) {
		if (namedContainers(match[2] ?? "").length === 0 || NEGATED_PLACEMENT.test(match[0])) continue;
		for (const item of (match[1] ?? "").split(/\s*\+\s*|\s*&\s*/u))
			stated.push({ item, zone: match[2] ?? "" });
	}
	for (const sentence of request.split(/[.;\n]/u).map((part) => part.trim())) {
		if (NEGATED_PLACEMENT.test(sentence)) continue;
		// "the VPC, queue and table are all in eu-west-1, in our AWS cloud": each item in the first
		// zone, and that zone in the second.
		const located =
			/^(.*?)\s+(?:are|is|sit|sits|live|lives|run|runs|stay|stays)\s+(?:all\s+|both\s+)?(?:in|inside|within|on)\s+([^,]+)(?:,\s*(?:all\s+)?(?:in|inside|within|on)\s+([^,]+))?/iu.exec(
				sentence,
			);
		if (located && zoneName(located[2] ?? "")) {
			for (const item of (located[1] ?? "").split(/\s*\+\s*|\s*&\s*|\s*,\s*|\s+and\s+/u))
				stated.push({ item, zone: located[2] ?? "" });
			if (zoneName(located[3] ?? ""))
				stated.push({ item: located[2] ?? "", zone: located[3] ?? "" });
		}
		// "office staff enter orders in the legacy ERP, both on the corporate network".
		const both = /^(.*),\s*both\s+(?:are\s+)?(?:in|inside|within|on)\s+([^,]+)$/iu.exec(sentence);
		const pair = both ? mentioned(both[1] ?? "") : [];
		if (both && pair.length === 2 && zoneName(both[2] ?? "")) {
			for (const node of pair)
				stated.push({ item: text(nodes[node]?.["label"]), zone: both[2] ?? "", node });
		}
	}
	// "VPN gateway in our production VPC → order API in the VPC's private subnet": each step in the
	// zone right after it, and a possessive zone in its owner.
	for (const segment of request.split(/→|->|=>|[\n.;:(),]/u)) {
		if (NEGATED_PLACEMENT.test(segment)) continue;
		const pieces = segment.split(/\s+(?:in|inside|within)\s+/iu);
		for (let index = 1; index < pieces.length; index += 1) {
			const possessive = /^(.*?)['’]s\s+(.+)$/u.exec(pieces[index] ?? "");
			const zone = possessive?.[2] ?? pieces[index] ?? "";
			if (!zoneName(zone)) continue;
			// "VPC + S3 are in us-east-1" lists its items before the verb.
			const items = (pieces[index - 1] ?? "")
				.replace(/\s+(?:are|is|sit|sits|live|lives|run|runs|stay|stays)(?:\s+(?:all|both))?$/iu, "")
				.split(/\s*\+\s*|\s*&\s*|\s+and\s+/u);
			for (const item of items) stated.push({ item: tail(item), zone });
			if (possessive && zoneName(possessive[1] ?? ""))
				stated.push({ item: zone, zone: possessive[1] ?? "" });
		}
	}
	// A line headed by a zone ("on-prem data center: … on the corporate network") puts every zone
	// it places something in inside that zone.
	for (const line of request.split("\n")) {
		const heading = /^\s*([^:\n]{1,60}?)\s*:\s*(.+)$/u.exec(line);
		const head = heading?.[1] ?? "";
		const named = zoneName(head);
		if (
			!heading ||
			!named ||
			!stems(head).every((word) => [...named.heads, ...named.modifiers].includes(word))
		)
			continue;
		for (const clause of (heading[2] ?? "").split(/[,.;]/u)) {
			if (NEGATED_PLACEMENT.test(clause)) continue;
			for (const place of clause.matchAll(/\b(?:in|inside|within|on)\s+([^,.;:()→]+)/giu)) {
				const zone = place[1] ?? "";
				if (zoneName(zone) && !sameZone(zone, head)) stated.push({ item: zone, zone: head });
			}
		}
	}
	return stated;
}

/** A zone a phrase names: a container phrase, or a named cloud ("our AWS cloud") where it locates something. */
function zoneName(
	phrase: string,
): { readonly heads: readonly string[]; readonly modifiers: readonly string[] } | undefined {
	const named = namedContainers(phrase)[0];
	if (named) return named;
	const cloud = /\b((?:[\w-]+\s+){1,2})clouds?\b/iu.exec(phrase);
	const modifiers = words(cloud?.[1] ?? "")
		.filter((word) => !NOT_A_NAME.has(word) && !STOP_WORDS.has(word))
		.map(stemWord);
	return modifiers.length > 0 ? { heads: ["cloud"], modifiers } : undefined;
}

/** Whether two phrases name the same kind of zone, such as "the data center" and "on-prem data center". */
function sameZone(a: string, b: string): boolean {
	const left = zoneName(a);
	const right = zoneName(b);
	return (
		left !== undefined && right !== undefined && left.heads.join(" ") === right.heads.join(" ")
	);
}

/** Container nouns that are names on their own, and ones that name a container only with a modifier. */
const CONTAINER_HEADS = /^(?:subnet|vpc|vnet|namespac|dmz|data ?cent(?:er|re))$/u;
const QUALIFIED_HEADS = /^(?:network|zon|region|cluster)$/u;
const CONTAINER_PHRASE =
	/\b((?:[\w-]+\s+){0,2}?)(subnets?|vpcs?|vnets?|namespaces?|dmz|data\s?cent(?:er|re)s?|networks?|zones?|regions?|clusters?)\b|\b((?:us|eu|ap|sa|ca|me|af)-(?:north|south|east|west|central|northeast|southeast|northwest|southwest)-\d)\b/giu;
const NOT_A_NAME = new Set(
	"a an the our your their its this that each every all both same other one two three 3 2 4 own new separate s".split(
		" ",
	),
);

function namedContainers(
	request: string,
): { readonly phrase: string; readonly heads: string[]; readonly modifiers: string[] }[] {
	return [...request.matchAll(CONTAINER_PHRASE)].flatMap((match) => {
		if (match[3]) {
			const phrase = match[3];
			return [{ phrase, heads: stems(phrase), modifiers: [] }];
		}
		const head = match[2] ?? "";
		// "two subnets" or "the zones" speak of several, not a zone's name.
		if (/s$/iu.test(head) && !/^(?:dmz|vpc)$/iu.test(head)) return [];
		const headStems = stems(head);
		const joinedHead = headStems.join(" ");
		const modifiers = words(match[1] ?? "")
			.filter((word) => !NOT_A_NAME.has(word) && !STOP_WORDS.has(word))
			.map(stemWord);
		const specific = CONTAINER_HEADS.test(joinedHead);
		if (!specific && (!QUALIFIED_HEADS.test(joinedHead) || modifiers.length === 0)) return [];
		const named = (match[1] ?? "")
			.trim()
			.split(/\s+/u)
			.filter(
				(word) =>
					word && !NOT_A_NAME.has(word.toLowerCase()) && !STOP_WORDS.has(word.toLowerCase()),
			);
		const phrase = [...named, head].join(" ");
		return [{ phrase, heads: headStems, modifiers }];
	});
}

// ---------------------------------------------------------------------------

/** What the request states outright that the diagram lacks, or nothing. */
export function checkRequestCoverage(request: string, diagram: unknown): CoverageIssue[] {
	if (!isUnknownRecord(diagram)) return [];
	const family = {
		class: classIssues,
		er: erIssues,
		flowchart: flowchartIssues,
		sequence: sequenceIssues,
	}[text(diagram["type"])];
	return [...quotedTextIssues(request, diagram), ...(family ? family(request, diagram) : [])];
}

/** Flowchart issues whose fix moves edges rather than only adding to the diagram. */
const REROUTING_CODES: ReadonlySet<CoverageIssueCode> = new Set([
	"flowchart_connection_missing",
	"flowchart_return_step_missing",
	"flowchart_check_step_missing",
]);

/** How many words a diagram shows, to tell a repair that drops content from one that adds it. */
export function diagramContentSize(diagram: unknown): number {
	return words(diagramText(diagram)).length;
}

/**
 * Whether a repair keeps what the original diagram drew of the request: every flowchart step
 * the request names, every class with its fields, every table with its columns, every
 * participant and message, and every relationship except one the check found unstated. A
 * repair that adds what was missing keeps all of these; one that deletes to pass does not.
 */
export function keepsStatedStructure(
	request: string,
	original: unknown,
	repaired: unknown,
): boolean {
	if (!isUnknownRecord(original) || !isUnknownRecord(repaired)) return false;
	const requested = new Set(stems(request));
	const label = (entry: Json) =>
		normalized(text(entry["label"]) || text(entry["name"]) || text(entry["id"]));
	const labels = (value: unknown) => new Set(records(value).map(label));
	const named = (entry: Json) => {
		const wanted = stems(label(entry));
		return (
			wanted.length > 0 &&
			wanted.filter((word) => holds(requested, word)).length / wanted.length >= 0.75
		);
	};
	const keeps = (key: string, only: (entry: Json) => boolean = () => true) => {
		const after = labels(repaired[key]);
		return records(original[key])
			.filter(only)
			.every((entry) => after.has(label(entry)));
	};
	const fieldsOf = (diagram: Json, key: string, members: string) =>
		new Map(
			records(diagram[key]).map((entry) => [
				label(entry),
				new Set(
					(Array.isArray(entry[members]) ? entry[members] : []).map((member) =>
						typeof member === "string"
							? (declaredField(member)?.name ?? member.trim().split(/\s+/u)[0] ?? "").toLowerCase()
							: text(isUnknownRecord(member) ? member["name"] : "").toLowerCase(),
					),
				),
			]),
		);
	const keepsMembers = (key: string, members: string) => {
		const after = fieldsOf(repaired, key, members);
		return [...fieldsOf(original, key, members)].every(([name, fields]) =>
			[...fields].every((field) => after.get(name)?.has(field) === true),
		);
	};
	/** An edge or relationship by the labels of its two ends, so renumbered ids still match. */
	const links = (diagram: Json, key: string, from: string, to: string, ends: string) => {
		const names = new Map(records(diagram[ends]).map((entry) => [text(entry["id"]), label(entry)]));
		const end = (value: unknown) => {
			const id = text(value).split(".")[0] ?? "";
			return names.get(id) ?? normalized(id);
		};
		return records(diagram[key]).map(
			(link) => `${end(link[from])} → ${end(link[to])} ${text(link["kind"])}`,
		);
	};
	const keepsLinks = (
		key: string,
		from: string,
		to: string,
		ends: string,
		removable = new Set<string>(),
	) => {
		const after = new Set(links(repaired, key, from, to, ends));
		return links(original, key, from, to, ends).every(
			(link) => after.has(link) || removable.has(link),
		);
	};
	switch (text(original["type"])) {
		case "flowchart": {
			// A missing arrow, return step or check may need an edge moved; the steps the request
			// names stay either way. A borrowed step loses only the arrows that borrow it, and a
			// split step's dead-end copy merges into the step by label.
			const rerouted = flowchartIssues(request, original).some((issue) =>
				REROUTING_CODES.has(issue.code),
			);
			const originalNodes = records(original["nodes"]);
			const borrowed = borrowedSteps(
				request,
				originalNodes,
				records(original["edges"]),
				nodeMatcher(originalNodes),
			).flatMap(({ arrows }) =>
				links(
					{
						...original,
						edges: arrows.map(([source, target]) => ({ source, target })),
					},
					"edges",
					"source",
					"target",
					"nodes",
				),
			);
			return (
				keeps("nodes", named) &&
				(rerouted || keepsLinks("edges", "source", "target", "nodes", new Set(borrowed)))
			);
		}
		case "class": {
			const unstated = new Set(
				[
					...unstatedRelationships(request, original),
					...unstatedWholeParts(request, original),
				].flatMap(({ relationship }) =>
					links(
						{ ...original, relationships: [relationship] },
						"relationships",
						"from",
						"to",
						"classes",
					),
				),
			);
			return (
				keeps("classes") &&
				keepsMembers("classes", "attributes") &&
				keepsLinks("relationships", "from", "to", "classes", unstated)
			);
		}
		case "er":
			return (
				keeps("entities") &&
				keepsMembers("entities", "fields") &&
				keepsLinks("relationships", "from", "to", "entities")
			);
		case "sequence":
			return keeps("participants") && keepsLinks("messages", "source", "target", "participants");
		default:
			return diagramContentSize(repaired) >= diagramContentSize(original);
	}
}
