/**
 * Deterministic checks of a generated diagram against what its request states
 * outright: the classes, fields and tables pasted as code, quoted text, the
 * connections drawn with arrows, the containers an architecture names, and the
 * messages a sequence lists. A check reads only structure the request spells
 * out, so a request in plain prose passes without a cost.
 */
import { isUnknownRecord } from "./unknown-record.js";

export interface CoverageIssue {
	/** A stable code, such as `class_field_missing`. */
	readonly code: string;
	/** What the request states and the diagram lacks, worded as the fix. */
	readonly message: string;
}

type Json = Readonly<Record<string, unknown>>;

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

function stems(value: string): string[] {
	return words(value)
		.filter((word) => !STOP_WORDS.has(word))
		.map(stem);
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

/** Quoted text a clause asks to show; a clause that leaves something out asks for none of it. */
function requiredQuotes(request: string): string[] {
	return request.split(/[.;!?\n]+/u).flatMap((clause) => {
		const quotes = [...clause.matchAll(QUOTED)].map((match) => match[1]?.trim() ?? "");
		if (quotes.length === 0 || LEAVES_OUT.test(clause.replace(QUOTED, " "))) return [];
		return quotes.filter((quote) => /\p{L}/u.test(quote));
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
	return issues;
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

function flowchartIssues(request: string, diagram: Json): CoverageIssue[] {
	const nodes = records(diagram["nodes"]);
	const edges = records(diagram["edges"]);
	const nodeStems = nodes.map(
		(node) => new Set(stems(`${text(node["label"])} ${text(node["id"])}`)),
	);
	const match = (item: string): number | undefined => {
		const wanted = stems(item);
		const scores = nodeStems.map(
			(shown) => wanted.filter((word) => holds(shown, word)).length / wanted.length,
		);
		const best = Math.max(...scores);
		if (!(best >= 0.75)) return undefined;
		const winners = scores.flatMap((score, index) => (score === best ? [index] : []));
		return winners.length === 1 ? winners[0] : undefined;
	};
	const outgoing = new Map<string, string[]>();
	for (const edge of edges) {
		const source = text(edge["source"]);
		outgoing.set(source, [...(outgoing.get(source) ?? []), text(edge["target"])]);
	}
	const issues: CoverageIssue[] = [];
	const missing: string[] = [];
	for (const line of request.replace(DIRECTION, " ").split(/\n/u)) {
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
		// Reached within three edges, through no other node this line names.
		const reaches = (from: string, to: string) => {
			let frontier = [from];
			const seen = new Set(frontier);
			for (let depth = 0; depth < 3; depth += 1) {
				const next: string[] = [];
				for (const id of frontier) {
					for (const target of outgoing.get(id) ?? []) {
						if (target === to) return true;
						if (seen.has(target) || chainNodes.has(target)) continue;
						seen.add(target);
						next.push(target);
					}
				}
				frontier = next;
			}
			return false;
		};
		for (let index = 1; index < matched.length; index += 1) {
			for (const from of matched[index - 1] ?? []) {
				for (const to of matched[index] ?? []) {
					if (from.node === undefined || to.node === undefined || from.node === to.node) continue;
					const fromId = text(nodes[from.node]?.["id"]);
					const toId = text(nodes[to.node]?.["id"]);
					if (!reaches(fromId, toId)) missing.push(`${from.item} → ${to.item}`);
				}
			}
		}
	}
	if (missing.length > 0) {
		issues.push({
			code: "flowchart_connection_missing",
			message: `The request connects ${quoteList([...new Set(missing)])}, but the diagram has no such edge. Draw an edge for every stated arrow; "a + b → c" means both a → c and b → c.`,
		});
	}

	const containers = records(diagram["groups"])
		.concat(records(diagram["lanes"]))
		.map((group) => new Set(stems(`${text(group["label"])} ${text(group["id"])}`)));
	const missingContainers: string[] = [];
	for (const named of namedContainers(request)) {
		const found = containers.some(
			(container) =>
				named.heads.every((head) => holds(container, head)) &&
				(named.modifiers.length === 0 || named.modifiers.some((word) => holds(container, word))),
		);
		if (!found) missingContainers.push(named.phrase);
	}
	if (missingContainers.length > 0) {
		issues.push({
			code: "flowchart_container_missing",
			message: `The request names ${quoteList([...new Set(missingContainers)])}, but no group carries ${missingContainers.length === 1 ? "that name" : "those names"}. Make every named zone a group, nested in the zone that holds it.`,
		});
	}
	issues.push(...containmentIssues(request, nodes, records(diagram["groups"]), match));
	return issues;
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
		const named = namedContainers(phrase)[0];
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
	const stated: { item: string; zone: string }[] = [];
	for (const match of request.matchAll(/([^()→\n,.;:]+?)\s*\(([^()]+)\)/gu)) {
		if (namedContainers(match[2] ?? "").length === 0) continue;
		for (const item of (match[1] ?? "").split(/\s*\+\s*|\s*&\s*/u))
			stated.push({ item, zone: match[2] ?? "" });
	}
	for (const clause of request.split(/[.;\n]|,\s+/u)) {
		const sentence =
			/^(.*?)\s+(?:are|is|sit|sits|live|lives|run|runs|stay|stays)\s+(?:all\s+|both\s+)?(?:in|inside|within)\s+(.+)$/iu.exec(
				clause.trim(),
			);
		if (!sentence || namedContainers(sentence[2] ?? "").length === 0) continue;
		for (const item of (sentence[1] ?? "").split(/\s*\+\s*|\s*&\s*|\s*,\s*|\s+and\s+/u))
			stated.push({ item, zone: sentence[2] ?? "" });
	}
	const outside: string[] = [];
	for (const { item, zone } of stated) {
		const container = zoneGroup(zone);
		if (container === undefined || stems(item).length === 0) continue;
		const zoneId = text(groups[container]?.["id"]);
		const resolved = resolve(item);
		const inside =
			resolved.node !== undefined
				? ancestors(text(nodes[resolved.node]?.["group"])).has(zoneId)
				: resolved.groups.every(
						(index) =>
							index === container || ancestors(text(groups[index]?.["parent"])).has(zoneId),
					);
		if ((resolved.node !== undefined || resolved.groups.length > 0) && !inside)
			outside.push(`${item.trim()} in ${zone.trim()}`);
	}
	return outside.length === 0
		? []
		: [
				{
					code: "flowchart_containment_wrong",
					message: `The request puts ${quoteList([...new Set(outside)])}, but the diagram draws ${outside.length === 1 ? "it" : "them"} outside. Set each node's group, and each group's parent, to the zone the request puts it in.`,
				},
			];
}

/** Container nouns that are names on their own, and ones that name a container only with a modifier. */
const CONTAINER_HEADS = /^(?:subnet|vpc|vnet|namespac|dmz|data ?cent(?:er|re))$/u;
const QUALIFIED_HEADS = /^(?:network|zon|region|cluster)$/u;
const CONTAINER_PHRASE =
	/\b((?:[\w-]+\s+){0,2}?)(subnets?|vpcs?|vnets?|namespaces?|dmz|data\s?cent(?:er|re)s?|networks?|zones?|regions?|clusters?)\b|\b((?:us|eu|ap|sa|ca|me|af)-(?:north|south|east|west|central|northeast|southeast|northwest|southwest)-\d)\b/giu;
const NOT_A_NAME = new Set(
	"a an the our your their its this that each every all both same other one two three 3 2 4 own new separate".split(
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
			.map(stem);
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
			// A missing arrow may need an edge moved; the steps the request names stay either way.
			const rerouted = flowchartIssues(request, original).some(
				(issue) => issue.code === "flowchart_connection_missing",
			);
			return (
				keeps("nodes", named) && (rerouted || keepsLinks("edges", "source", "target", "nodes"))
			);
		}
		case "class": {
			const unstated = new Set(
				unstatedRelationships(request, original).flatMap(({ relationship }) =>
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
