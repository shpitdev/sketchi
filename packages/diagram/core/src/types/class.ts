import { Effect, Schema } from "effect";

import { DiagramStyle, DiagramValidationError, SKETCHI_DIAGRAM_STYLE } from "../intermediate.js";

export const classDiagramType = "class" as const;

/**
 * What a class box stands for. An abstract class, an interface and an enum
 * show their keyword over the name, since a drawn name cannot be italic.
 */
export const CLASS_KINDS = ["class", "abstract", "interface", "enum"] as const;
export const ClassKindSchema = Schema.Literals(CLASS_KINDS);
export type ClassKind = (typeof CLASS_KINDS)[number];

/** Who may use a member, drawn `+`, `-`, `#` or `~` before its name. */
export const CLASS_VISIBILITIES = ["public", "private", "protected", "package"] as const;
export const ClassVisibilitySchema = Schema.Literals(CLASS_VISIBILITIES);
export type ClassVisibility = (typeof CLASS_VISIBILITIES)[number];
export const CLASS_VISIBILITY_SYMBOLS: Readonly<Record<ClassVisibility, string>> = {
	public: "+",
	private: "-",
	protected: "#",
	package: "~",
};

/**
 * How two classes relate, each drawn with its UML line and head:
 * - inheritance: `from` extends `to`; a solid line, a hollow triangle at `to`.
 * - realization: `from` implements the interface `to`; dashed, a hollow triangle at `to`.
 * - composition: `from` is the whole that owns the part `to`; a filled diamond at `from`.
 * - aggregation: `from` is the whole that holds the shared part `to`; a hollow diamond at `from`.
 * - association: `from` and `to` know each other.
 * - dependency: `from` uses `to`; dashed, an open arrow at `to`.
 *
 * An association, composition or aggregation marked navigable adds an open
 * arrow at `to`.
 */
export const CLASS_RELATIONSHIP_KINDS = [
	"inheritance",
	"realization",
	"composition",
	"aggregation",
	"association",
	"dependency",
] as const;
export const ClassRelationshipKindSchema = Schema.Literals(CLASS_RELATIONSHIP_KINDS);
export type ClassRelationshipKind = (typeof CLASS_RELATIONSHIP_KINDS)[number];

/** Inheritance and realization: the kinds that build a hierarchy, drawn top-down. */
export function isClassGeneralization(kind: ClassRelationshipKind): boolean {
	return kind === "inheritance" || kind === "realization";
}

/** Kinds that carry multiplicities and role names at their ends. */
export function hasClassEnds(kind: ClassRelationshipKind): boolean {
	return kind === "association" || kind === "composition" || kind === "aggregation";
}

/** Larger models stop reading as one diagram; split them by package instead. */
export const CLASS_MAX_CLASSES = 30;
export const CLASS_MAX_MEMBERS_PER_CLASS = 30;
export const CLASS_MAX_MEMBERS = 300;
export const CLASS_MAX_RELATIONSHIPS = 60;
/** Names stay on one line, so their box grows to fit them. */
export const CLASS_MAX_NAME_LENGTH = 64;
/** A whole member as drawn, such as `+ area(scale: double): double`. */
export const CLASS_MAX_MEMBER_LENGTH = 96;
export const CLASS_MAX_ISSUES = 20;

/** An attribute: `+ name: Type`, a class-wide one marked `{static}`. */
export class ClassAttribute extends Schema.Class<ClassAttribute>("ClassAttribute")({
	name: Schema.NonEmptyString,
	type: Schema.optionalKey(Schema.NonEmptyString),
	visibility: Schema.optionalKey(ClassVisibilitySchema),
	static: Schema.optionalKey(Schema.Boolean),
}) {}
export const ClassAttributeSchema = ClassAttribute;

/** One parameter of a method: `name: Type`. */
export class ClassParameter extends Schema.Class<ClassParameter>("ClassParameter")({
	name: Schema.NonEmptyString,
	type: Schema.optionalKey(Schema.NonEmptyString),
}) {}
export const ClassParameterSchema = ClassParameter;

/** A method: `+ name(params): Return`, marked `{abstract}` or `{static}`. */
export class ClassMethod extends Schema.Class<ClassMethod>("ClassMethod")({
	name: Schema.NonEmptyString,
	params: Schema.Array(ClassParameter).pipe(
		Schema.mutable,
		Schema.withDecodingDefault(Effect.succeed([])),
	),
	returns: Schema.optionalKey(Schema.NonEmptyString),
	visibility: Schema.optionalKey(ClassVisibilitySchema),
	static: Schema.optionalKey(Schema.Boolean),
	abstract: Schema.optionalKey(Schema.Boolean),
}) {}
export const ClassMethodSchema = ClassMethod;

/**
 * One class, interface or enum, drawn as a box of three compartments: its
 * name (under any keyword or stereotype), its attributes and its methods. An
 * enum lists its values as attributes.
 */
export class ClassNode extends Schema.Class<ClassNode>("ClassNode")({
	id: Schema.NonEmptyString,
	/** The name the box shows; the id when omitted. */
	name: Schema.optionalKey(Schema.NonEmptyString),
	kind: Schema.optionalKey(ClassKindSchema),
	/** A stereotype of your own, drawn `«stereotype»` over the name. */
	stereotype: Schema.optionalKey(Schema.NonEmptyString),
	attributes: Schema.Array(ClassAttribute).pipe(
		Schema.mutable,
		Schema.withDecodingDefault(Effect.succeed([])),
	),
	methods: Schema.Array(ClassMethod).pipe(
		Schema.mutable,
		Schema.withDecodingDefault(Effect.succeed([])),
	),
}) {}
export const ClassNodeSchema = ClassNode;

/**
 * A relationship between two classes (see CLASS_RELATIONSHIP_KINDS for what
 * `from` and `to` mean in each kind). Associations, compositions and
 * aggregations carry a multiplicity and a role name at either end.
 */
export class ClassRelationship extends Schema.Class<ClassRelationship>("ClassRelationship")({
	id: Schema.NonEmptyString,
	kind: ClassRelationshipKindSchema,
	from: Schema.NonEmptyString,
	to: Schema.NonEmptyString,
	/** How many of `from` relate to one `to`: `1`, `0..1`, `*`, `1..*`, `2..4`. */
	fromMultiplicity: Schema.optionalKey(Schema.NonEmptyString),
	toMultiplicity: Schema.optionalKey(Schema.NonEmptyString),
	/** The name `from` plays for `to`, drawn at `from`'s end. */
	fromRole: Schema.optionalKey(Schema.NonEmptyString),
	toRole: Schema.optionalKey(Schema.NonEmptyString),
	/** `from` follows the line to `to`: an open arrow at `to` (associations, compositions, aggregations). */
	navigable: Schema.optionalKey(Schema.Boolean),
	label: Schema.optionalKey(Schema.NonEmptyString),
}) {}
export const ClassRelationshipSchema = ClassRelationship;

/**
 * The canonical UML class diagram: classes with their members, and the
 * relationships between them. The renderer owns every coordinate. Every
 * surface that accepts, generates, renders or evaluates a class diagram uses
 * this shape.
 */
export class ClassDiagram extends Schema.Class<ClassDiagram>("ClassDiagram")({
	id: Schema.NonEmptyString,
	title: Schema.NonEmptyString,
	type: Schema.Literal(classDiagramType),
	classes: Schema.Array(ClassNode).pipe(Schema.mutable, Schema.check(Schema.isMinLength(1))),
	relationships: Schema.Array(ClassRelationship).pipe(
		Schema.mutable,
		Schema.withDecodingDefault(Effect.succeed([])),
	),
	style: DiagramStyle.pipe(
		Schema.withDecodingDefault(Effect.succeed({ ...SKETCHI_DIAGRAM_STYLE })),
	),
}) {}
export const ClassDiagramSchema = ClassDiagram;

export const ClassValidationIssueCodeSchema = Schema.Literals([
	"class_too_large",
	"invalid_class_id",
	"duplicate_class_id",
	"duplicate_class_name",
	"duplicate_member",
	"class_text_too_long",
	"duplicate_relationship_id",
	"missing_relationship_class",
	"inheritance_cycle",
	"invalid_inheritance",
	"invalid_realization",
	"invalid_multiplicity",
	"misplaced_end_label",
]);
export type ClassValidationIssueCode = typeof ClassValidationIssueCodeSchema.Type;

export class ClassValidationIssue extends Schema.Class<ClassValidationIssue>(
	"ClassValidationIssue",
)({
	code: ClassValidationIssueCodeSchema,
	/** Dotted path into the diagram, for example `relationships.[1].to`. */
	path: Schema.NonEmptyString,
	message: Schema.NonEmptyString,
	hint: Schema.NonEmptyString,
}) {}

/** The name a class box shows. */
export function classNodeName(node: Pick<ClassNode, "id" | "name">): string {
	return node.name ?? node.id;
}

/** The kind a class is drawn as: a plain class when omitted. */
export function classNodeKind(node: Pick<ClassNode, "kind">): ClassKind {
	return node.kind ?? "class";
}

const KIND_KEYWORDS: Readonly<Record<ClassKind, string | undefined>> = {
	class: undefined,
	abstract: "abstract",
	interface: "interface",
	enum: "enumeration",
};

/** The keyword line over a class's name, `«interface»`, or undefined for a plain class. */
export function classKeywordLine(node: Pick<ClassNode, "kind" | "stereotype">): string | undefined {
	const words = [KIND_KEYWORDS[classNodeKind(node)], node.stereotype?.trim()].filter(
		(word): word is string => typeof word === "string" && word.length > 0,
	);
	return words.length > 0 ? `«${words.join(", ")}»` : undefined;
}

function visibilityPrefix(visibility: ClassVisibility | undefined): string {
	return visibility ? `${CLASS_VISIBILITY_SYMBOLS[visibility]} ` : "";
}

/** An attribute as drawn: `- radius: double`, `+ count: int {static}`. */
export function classAttributeText(attribute: ClassAttribute): string {
	return `${visibilityPrefix(attribute.visibility)}${attribute.name.trim()}${
		attribute.type ? `: ${attribute.type.trim()}` : ""
	}${attribute.static ? " {static}" : ""}`;
}

/** A method as drawn: `+ area(): double {abstract}`, `+ of(x: int, y: int): Point {static}`. */
export function classMethodText(method: ClassMethod): string {
	const params = method.params
		.map((param) => `${param.name.trim()}${param.type ? `: ${param.type.trim()}` : ""}`)
		.join(", ");
	const marks = [method.abstract && "{abstract}", method.static && "{static}"].filter(Boolean);
	return `${visibilityPrefix(method.visibility)}${method.name.trim()}(${params})${
		method.returns ? `: ${method.returns.trim()}` : ""
	}${marks.length > 0 ? ` ${marks.join(" ")}` : ""}`;
}

/** The key two class or member names compare by: trimmed, ignoring case. */
export function classNameKey(name: string): string {
	return name.trim().toLowerCase();
}

/** `1`, `0..1`, `*`, `1..*`, `2..4`: a bound, or a range from a lower bound to a higher one. */
const MULTIPLICITY = /^(\d+|\*)(?:\.\.(\d+|\*))?$/u;

/** Whether a multiplicity reads as UML writes one, its lower bound no higher than its upper. */
export function isClassMultiplicity(value: string): boolean {
	const match = MULTIPLICITY.exec(value.trim());
	if (!match) return false;
	const [, lower, upper] = match;
	if (upper === undefined) return true;
	if (lower === "*") return false;
	return upper === "*" || Number(lower) <= Number(upper);
}

export function getClassValidationIssues(diagram: ClassDiagram): ClassValidationIssue[] {
	const issues: ClassValidationIssue[] = [];
	const memberCount = diagram.classes.reduce(
		(sum, node) => sum + node.attributes.length + node.methods.length,
		0,
	);
	if (diagram.classes.length > CLASS_MAX_CLASSES) {
		issues.push({
			code: "class_too_large",
			path: "classes",
			message: `The diagram has ${diagram.classes.length} classes; the supported maximum is ${CLASS_MAX_CLASSES}.`,
			hint: "Split the model into diagrams by package, or leave out minor classes.",
		});
	}
	if (memberCount > CLASS_MAX_MEMBERS) {
		issues.push({
			code: "class_too_large",
			path: "classes",
			message: `The diagram has ${memberCount} members; the supported maximum is ${CLASS_MAX_MEMBERS}.`,
			hint: "Keep the members the request names, or split the model by package.",
		});
	}
	if (diagram.relationships.length > CLASS_MAX_RELATIONSHIPS) {
		issues.push({
			code: "class_too_large",
			path: "relationships",
			message: `The diagram has ${diagram.relationships.length} relationships; the supported maximum is ${CLASS_MAX_RELATIONSHIPS}.`,
			hint: "Split the model into diagrams by package.",
		});
	}

	const classes = new Map<string, ClassNode>();
	const names = new Map<string, string>();
	diagram.classes.forEach((node, index) => {
		const path = `classes.[${index}]`;
		if (/[:\s]/u.test(node.id)) {
			issues.push({
				code: "invalid_class_id",
				path: `${path}.id`,
				message: `Class id "${node.id}" contains a colon or a space.`,
				hint: "Use letters, digits, dots, hyphens or underscores in class ids, and put the shown name in name.",
			});
		}
		if (classes.has(node.id)) {
			issues.push({
				code: "duplicate_class_id",
				path: `${path}.id`,
				message: `Class id "${node.id}" is used more than once.`,
				hint: "Give every class a unique id.",
			});
		}
		classes.set(node.id, node);
		const name = classNodeName(node);
		const namePath = node.name === undefined ? `${path}.id` : `${path}.name`;
		const named = names.get(classNameKey(name));
		if (named !== undefined && named !== node.id) {
			issues.push({
				code: "duplicate_class_name",
				path: namePath,
				message: `Classes "${named}" and "${node.id}" are both named "${name}".`,
				hint: "Give every class a distinct name, or merge the two.",
			});
		}
		names.set(classNameKey(name), node.id);
		for (const [key, text, limit] of [
			["name", name, CLASS_MAX_NAME_LENGTH],
			["stereotype", node.stereotype, CLASS_MAX_NAME_LENGTH],
		] as const) {
			if (text === undefined || (text.length <= limit && !/\n/u.test(text))) continue;
			issues.push({
				code: "class_text_too_long",
				path: key === "name" ? namePath : `${path}.stereotype`,
				message: `The ${key} of "${node.id}" is longer than ${limit} characters or spans lines.`,
				hint: `Write the ${key} on one line of at most ${limit} characters.`,
			});
		}
		const members = node.attributes.length + node.methods.length;
		if (members > CLASS_MAX_MEMBERS_PER_CLASS) {
			issues.push({
				code: "class_too_large",
				path,
				message: `Class "${node.id}" has ${members} members; the supported maximum is ${CLASS_MAX_MEMBERS_PER_CLASS}.`,
				hint: "Keep the members the request names.",
			});
		}
		const seen = new Set<string>();
		const member = (
			key: "attributes" | "methods",
			memberIndex: number,
			text: string,
			id: string,
		) => {
			const memberPath = `${path}.${key}.[${memberIndex}]`;
			if (seen.has(id)) {
				issues.push({
					code: "duplicate_member",
					path: memberPath,
					message: `Class "${node.id}" lists ${key === "attributes" ? "attribute" : "method"} "${text}" more than once.`,
					hint: "List each member once; overloads differ in their parameters.",
				});
			}
			seen.add(id);
			if (text.length > CLASS_MAX_MEMBER_LENGTH || /\n/u.test(text)) {
				issues.push({
					code: "class_text_too_long",
					path: memberPath,
					message: `Member "${text}" of "${node.id}" is longer than ${CLASS_MAX_MEMBER_LENGTH} characters or spans lines.`,
					hint: `Write each member on one line of at most ${CLASS_MAX_MEMBER_LENGTH} characters.`,
				});
			}
		};
		node.attributes.forEach((attribute, at) =>
			member("attributes", at, classAttributeText(attribute), `a:${classNameKey(attribute.name)}`),
		);
		node.methods.forEach((method, at) =>
			member(
				"methods",
				at,
				classMethodText(method),
				`m:${classNameKey(method.name)}(${method.params.map((param) => classNameKey(param.type ?? param.name)).join(",")})`,
			),
		);
	});

	const relationshipIds = new Set<string>();
	const generalizations = new Map<string, string[]>();
	const pairs = new Set<string>();
	diagram.relationships.forEach((relationship, index) => {
		const path = `relationships.[${index}]`;
		if (relationshipIds.has(relationship.id)) {
			issues.push({
				code: "duplicate_relationship_id",
				path: `${path}.id`,
				message: `Relationship id "${relationship.id}" is used more than once.`,
				hint: "Give every relationship a unique id, or omit ids to generate them.",
			});
		}
		relationshipIds.add(relationship.id);
		const ends = (["from", "to"] as const).map((key) => {
			const node = classes.get(relationship[key].trim());
			if (!node) {
				issues.push({
					code: "missing_relationship_class",
					path: `${path}.${key}`,
					message: `Relationship "${relationship.id}" ${key === "from" ? "starts" : "ends"} at "${relationship[key]}", which is not a class.`,
					hint: "Set it to the id of one of the classes.",
				});
			}
			return node;
		});
		const [from, to] = ends;
		const { kind } = relationship;
		if (from && to && isClassGeneralization(kind)) {
			const pair = `${kind}\u0000${from.id}\u0000${to.id}`;
			const [fromKind, toKind] = [classNodeKind(from), classNodeKind(to)];
			if (pairs.has(pair)) {
				issues.push({
					code: kind === "inheritance" ? "invalid_inheritance" : "invalid_realization",
					path,
					message: `"${from.id}" ${kind === "inheritance" ? "extends" : "implements"} "${to.id}" more than once.`,
					hint: "Draw each generalization once.",
				});
			} else if (from.id === to.id) {
				issues.push({
					code: "inheritance_cycle",
					path,
					message: `"${from.id}" ${kind === "inheritance" ? "extends" : "implements"} itself.`,
					hint: "A class extends or implements another class, never itself.",
				});
			} else if (
				kind === "inheritance" &&
				(fromKind === "interface") !== (toKind === "interface")
			) {
				issues.push({
					code: "invalid_inheritance",
					path,
					message:
						fromKind === "interface"
							? `Interface "${from.id}" extends "${to.id}", which is not an interface.`
							: `"${from.id}" extends interface "${to.id}".`,
					hint:
						fromKind === "interface"
							? "An interface extends only interfaces; make the class implement the interface instead (a realization from the class to the interface)."
							: 'A class implements an interface: use kind "realization" from the class to the interface.',
				});
			} else if (kind === "realization" && (fromKind === "interface" || toKind !== "interface")) {
				issues.push({
					code: "invalid_realization",
					path,
					message:
						fromKind === "interface"
							? `Interface "${from.id}" implements "${to.id}".`
							: `"${from.id}" implements "${to.id}", which is not an interface.`,
					hint:
						fromKind === "interface"
							? 'An interface extends another interface: use kind "inheritance".'
							: 'Mark "to" as kind "interface", or use kind "inheritance" to extend a class.',
				});
			}
			pairs.add(pair);
			if (from.id !== to.id)
				generalizations.set(from.id, [...(generalizations.get(from.id) ?? []), to.id]);
		}
		const ended = hasClassEnds(kind);
		for (const end of ["from", "to"] as const) {
			for (const key of [`${end}Multiplicity`, `${end}Role`] as const) {
				const value = relationship[key];
				if (value === undefined) continue;
				if (!ended) {
					issues.push({
						code: "misplaced_end_label",
						path: `${path}.${key}`,
						message: `${kind === "dependency" ? "A dependency" : `An ${kind}`} "${relationship.id}" has a ${key.endsWith("Role") ? "role" : "multiplicity"}.`,
						hint: "Only associations, compositions and aggregations carry multiplicities and roles; drop it.",
					});
				} else if (value.length > CLASS_MAX_NAME_LENGTH || /\n/u.test(value)) {
					issues.push({
						code: "class_text_too_long",
						path: `${path}.${key}`,
						message: `"${value}" at an end of "${relationship.id}" is longer than ${CLASS_MAX_NAME_LENGTH} characters or spans lines.`,
						hint: "Write it on one short line.",
					});
				} else if (key.endsWith("Multiplicity") && !isClassMultiplicity(value)) {
					issues.push({
						code: "invalid_multiplicity",
						path: `${path}.${key}`,
						message: `Multiplicity "${value}" of "${relationship.id}" is not a UML multiplicity.`,
						hint: 'Write a bound or a range: "1", "0..1", "*", "1..*", "0..*" or "2..4".',
					});
				} else if (
					key === "fromMultiplicity" &&
					kind === "composition" &&
					!["1", "0..1", "1..1"].includes(value.trim())
				) {
					issues.push({
						code: "invalid_multiplicity",
						path: `${path}.${key}`,
						message: `Composition "${relationship.id}" gives its whole "${relationship.from}" multiplicity "${value}".`,
						hint: 'A part belongs to one whole at a time: write "1" or "0..1", or use an aggregation for a shared part.',
					});
				}
			}
		}
		if (relationship.navigable !== undefined && !ended) {
			issues.push({
				code: "misplaced_end_label",
				path: `${path}.navigable`,
				message: `${kind === "dependency" ? "A dependency" : `An ${kind}`} "${relationship.id}" is marked navigable.`,
				hint:
					kind === "dependency"
						? "A dependency always draws its arrow; drop navigable."
						: "Only associations, compositions and aggregations take navigable; drop it.",
			});
		}
		if (relationship.label !== undefined && relationship.label.length > CLASS_MAX_NAME_LENGTH) {
			issues.push({
				code: "class_text_too_long",
				path: `${path}.label`,
				message: `The label of "${relationship.id}" is longer than ${CLASS_MAX_NAME_LENGTH} characters.`,
				hint: "Shorten the label.",
			});
		}
	});

	// A class reached again from itself by extending and implementing closes a cycle.
	const state = new Map<string, 1 | 2>();
	const cycle = (id: string, trail: readonly string[]): readonly string[] | undefined => {
		state.set(id, 1);
		for (const parent of generalizations.get(id) ?? []) {
			if (state.get(parent) === 1) return [...trail.slice(trail.indexOf(parent)), parent];
			if (state.get(parent) === undefined) {
				const found = cycle(parent, [...trail, parent]);
				if (found) return found;
			}
		}
		state.set(id, 2);
		return undefined;
	};
	for (const id of generalizations.keys()) {
		if (state.has(id)) continue;
		const found = cycle(id, [id]);
		if (found) {
			issues.push({
				code: "inheritance_cycle",
				path: "relationships",
				message: `Inheritance runs in a cycle: ${found.join(" → ")}.`,
				hint: "A class never extends one of its own subclasses; drop or reverse one generalization.",
			});
			break;
		}
	}
	return issues.slice(0, CLASS_MAX_ISSUES);
}

export class ClassValidationError extends DiagramValidationError {
	constructor(readonly issues: readonly ClassValidationIssue[]) {
		super(issues[0]?.message ?? "Class diagram failed semantic validation.");
		this.name = "ClassValidationError";
	}
}

export function validateClassDiagram(diagram: ClassDiagram): ClassDiagram {
	const issues = getClassValidationIssues(diagram);
	if (issues.length > 0) {
		throw new ClassValidationError(issues);
	}
	return diagram;
}

export function parseClassDiagram(input: unknown): ClassDiagram {
	return validateClassDiagram(Schema.decodeUnknownSync(ClassDiagram, { errors: "all" })(input));
}

const VISIBILITY_WORDS: Readonly<Record<string, ClassVisibility>> = {
	"+": "public",
	"-": "private",
	"#": "protected",
	"~": "package",
	public: "public",
	private: "private",
	protected: "protected",
	package: "package",
	internal: "package",
};

type Modifiers = { visibility?: ClassVisibility; static?: true; abstract?: true };

/** Leading `+`, `public`, `static`, `abstract` and trailing `{static}`, `{abstract}` or `$`, `*`. */
function stripModifiers(line: string): { rest: string; modifiers: Modifiers } {
	let rest = line.trim();
	const modifiers: Modifiers = {};
	for (;;) {
		const symbol = /^([+\-#~])\s*/u.exec(rest);
		if (symbol && !modifiers.visibility) {
			modifiers.visibility = VISIBILITY_WORDS[symbol[1]!]!;
			rest = rest.slice(symbol[0].length);
			continue;
		}
		const word = /^(public|private|protected|package|internal|static|abstract)\s+/iu.exec(rest);
		if (!word) break;
		const key = word[1]!.toLowerCase();
		if (key === "static") modifiers.static = true;
		else if (key === "abstract") modifiers.abstract = true;
		else modifiers.visibility = VISIBILITY_WORDS[key]!;
		rest = rest.slice(word[0].length);
	}
	for (;;) {
		const mark = /\s*(?:\{(static|abstract)\}|([$*]))$/iu.exec(rest);
		if (!mark || mark.index === 0) break;
		const key = (mark[1] ?? mark[2])!.toLowerCase();
		if (key === "static" || key === "$") modifiers.static = true;
		else modifiers.abstract = true;
		rest = rest.slice(0, mark.index);
	}
	return { rest: rest.trim(), modifiers };
}

/** `name: Type`, or a bare name. */
function nameAndType(text: string): { name: string; type?: string } {
	const colon = text.indexOf(":");
	if (colon < 0) return { name: text.trim() };
	const [name, type] = [text.slice(0, colon).trim(), text.slice(colon + 1).trim()];
	return { name: name || text.trim(), ...(name && type ? { type } : {}) };
}

/** The index of the `)` that closes the `(` at `open`, or -1 when none does. */
function matchingParenthesis(text: string, open: number): number {
	if (open < 0) return -1;
	let depth = 0;
	for (let index = open; index < text.length; index += 1) {
		if (text[index] === "(") depth += 1;
		else if (text[index] === ")") {
			depth -= 1;
			if (depth === 0) return index;
		}
	}
	return -1;
}

/** Split on commas outside `<>`, `()` and `[]`, so `Map<K, V>` stays one parameter. */
function splitParameters(text: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let start = 0;
	// Indexes stay in UTF-16 units, as slice counts them, so wide characters split cleanly.
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index]!;
		if ("<([{".includes(char)) depth += 1;
		else if (">)]}".includes(char)) depth = Math.max(0, depth - 1);
		else if (char === "," && depth === 0) {
			parts.push(text.slice(start, index));
			start = index + 1;
		}
	}
	parts.push(text.slice(start));
	return parts.map((part) => part.trim()).filter(Boolean);
}

/** Read a parameter written on one line: `"ctx: Canvas"`, or a bare name. */
export function parseClassParameterShorthand(text: string): { name: string; type?: string } {
	return nameAndType(text);
}

/**
 * Read an attribute written on one line, as UML draws it: `"- radius: double"`,
 * `"+ count: int {static}"`, `"# id: UUID"`, `"RED"` (an enum value). A
 * leading `+`, `-`, `#`, `~` or visibility word sets the visibility, and
 * `static` (or `{static}`, `$`) marks a class-wide one.
 */
export function parseClassAttributeShorthand(line: string): {
	name: string;
	type?: string;
	visibility?: ClassVisibility;
	static?: true;
} {
	const { rest, modifiers } = stripModifiers(line);
	const { visibility, static: isStatic } = modifiers;
	return {
		...nameAndType(rest),
		...(visibility ? { visibility } : {}),
		...(isStatic ? { static: true as const } : {}),
	};
}

/**
 * Read a method written on one line: `"+ area(): double"`,
 * `"+ draw(ctx: Canvas, scale: double): void {abstract}"`, `"# notify()"`,
 * `"+ of(x: int): Point {static}"`. Parameters are `name: Type`.
 */
export function parseClassMethodShorthand(line: string): {
	name: string;
	params: { name: string; type?: string }[];
	returns?: string;
	visibility?: ClassVisibility;
	static?: true;
	abstract?: true;
} {
	const { rest, modifiers } = stripModifiers(line);
	const open = rest.indexOf("(");
	const close = matchingParenthesis(rest, open);
	const flags = {
		...(modifiers.visibility ? { visibility: modifiers.visibility } : {}),
		...(modifiers.static ? { static: true as const } : {}),
		...(modifiers.abstract ? { abstract: true as const } : {}),
	};
	if (open < 0 || close < open) {
		const { name, type } = nameAndType(rest);
		return { name, params: [], ...(type ? { returns: type } : {}), ...flags };
	}
	const returns = rest
		.slice(close + 1)
		.replace(/^\s*:\s*/u, "")
		.trim();
	return {
		name: rest.slice(0, open).trim() || rest,
		params: splitParameters(rest.slice(open + 1, close)).map(nameAndType),
		...(returns ? { returns } : {}),
		...flags,
	};
}

const KIND_ALIASES: Readonly<Record<string, ClassRelationshipKind>> = {
	extends: "inheritance",
	inherits: "inheritance",
	generalization: "inheritance",
	"is-a": "inheritance",
	implements: "realization",
	realizes: "realization",
	"interface-realization": "realization",
	composes: "composition",
	"composed-of": "composition",
	aggregates: "aggregation",
	"uses-a": "dependency",
	uses: "dependency",
	depends: "dependency",
	"depends-on": "dependency",
	associates: "association",
};

/** A relationship kind as written, read as one of the six, or kept as given when it is none. */
export function resolveClassRelationshipKind(value: unknown): unknown {
	if (typeof value !== "string") return value;
	const key = value
		.trim()
		.toLowerCase()
		.replace(/[\s_]+/gu, "-");
	if ((CLASS_RELATIONSHIP_KINDS as readonly string[]).includes(key)) return key;
	return KIND_ALIASES[key] ?? value;
}

const MULTIPLICITY_ALIASES: Readonly<Record<string, string>> = {
	one: "1",
	"exactly-one": "1",
	"zero-or-one": "0..1",
	optional: "0..1",
	many: "*",
	n: "*",
	m: "*",
	"zero-or-many": "0..*",
	"zero-or-more": "0..*",
	"one-or-many": "1..*",
	"one-or-more": "1..*",
};

/** A multiplicity as written: words (`many`, `one or more`) and `n` bounds read as UML's. */
export function resolveClassMultiplicity(value: unknown): unknown {
	if (typeof value === "number" && Number.isInteger(value) && value >= 0) return String(value);
	if (typeof value !== "string") return value;
	const trimmed = value.trim();
	const word = MULTIPLICITY_ALIASES[trimmed.toLowerCase().replace(/[\s_]+/gu, "-")];
	if (word) return word;
	return trimmed.replace(/\s*\.\.\s*/gu, "..").replace(/(^|\.\.)[nm]$/iu, "$1*");
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Resolve the shapes models write for a class diagram before it is decoded:
 * members on one line (`"- radius: double"`, `"+ area(): double"`), parameters
 * as `"name: Type"`, an enum's `values`, visibility symbols, kind aliases
 * (`extends`, `implements`), `source`/`target` for `from`/`to`, and
 * multiplicity words (`many`, `0..n`). Anything else keeps its value, so
 * decoding still reports it.
 */
export function resolveClassShorthand(input: unknown): unknown {
	if (!isRecord(input)) return input;
	const visibility = (value: unknown) =>
		typeof value === "string" ? (VISIBILITY_WORDS[value.trim().toLowerCase()] ?? value) : value;
	const member = (value: unknown, method: boolean) => {
		if (typeof value === "string")
			return method ? parseClassMethodShorthand(value) : parseClassAttributeShorthand(value);
		if (!isRecord(value)) return value;
		const resolved: Record<string, unknown> = { ...value };
		if (resolved["visibility"] !== undefined)
			resolved["visibility"] = visibility(resolved["visibility"]);
		if (method) {
			if (resolved["returns"] === undefined && resolved["returnType"] !== undefined) {
				resolved["returns"] = resolved["returnType"];
				delete resolved["returnType"];
			}
			const params = resolved["params"] ?? resolved["parameters"];
			delete resolved["parameters"];
			if (typeof params === "string") resolved["params"] = splitParameters(params).map(nameAndType);
			else if (Array.isArray(params))
				resolved["params"] = params.map((param) =>
					typeof param === "string" ? nameAndType(param) : param,
				);
		}
		return resolved;
	};
	const classes = Array.isArray(input["classes"])
		? input["classes"].map((node) => {
				if (!isRecord(node)) return node;
				const { values, ...rest } = node;
				const attributes = Array.isArray(rest["attributes"])
					? rest["attributes"]
					: Array.isArray(values)
						? values
						: rest["attributes"];
				return {
					...rest,
					...(rest["kind"] === undefined && Array.isArray(values) ? { kind: "enum" } : {}),
					...(Array.isArray(attributes)
						? { attributes: attributes.map((value) => member(value, false)) }
						: attributes === undefined
							? {}
							: { attributes }),
					...(Array.isArray(rest["methods"])
						? { methods: rest["methods"].map((value) => member(value, true)) }
						: {}),
					...(typeof rest["kind"] === "string"
						? {
								kind:
									rest["kind"].trim().toLowerCase() === "enumeration"
										? "enum"
										: rest["kind"].trim().toLowerCase(),
							}
						: {}),
				};
			})
		: input["classes"];
	const relationships = Array.isArray(input["relationships"])
		? input["relationships"].map((relationship) => {
				if (!isRecord(relationship)) return relationship;
				const { source, target, type, ...rest } = relationship;
				const resolved: Record<string, unknown> = {
					...rest,
					from: rest["from"] ?? source,
					to: rest["to"] ?? target,
					kind: resolveClassRelationshipKind(rest["kind"] ?? type),
				};
				for (const key of ["fromMultiplicity", "toMultiplicity"])
					if (resolved[key] !== undefined) resolved[key] = resolveClassMultiplicity(resolved[key]);
				for (const key of ["from", "to", "kind"])
					if (resolved[key] === undefined) delete resolved[key];
				return resolved;
			})
		: input["relationships"];
	return {
		...input,
		...(classes === undefined ? {} : { classes }),
		...(relationships === undefined ? {} : { relationships }),
	};
}

/**
 * Shapes on a canvas: an interface every shape implements, an abstract base,
 * three concrete shapes and a square that refines the rectangle, held by a
 * canvas that aggregates them.
 */
export const classFixture = parseClassDiagram({
	id: "shapes",
	title: "Shapes",
	type: classDiagramType,
	classes: [
		{
			id: "Drawable",
			kind: "interface",
			methods: [{ name: "draw", params: [{ name: "ctx", type: "Canvas" }], returns: "void" }],
		},
		{
			id: "Shape",
			kind: "abstract",
			attributes: [
				{ name: "x", type: "double", visibility: "protected" },
				{ name: "y", type: "double", visibility: "protected" },
			],
			methods: [
				{ name: "area", returns: "double", visibility: "public", abstract: true },
				{
					name: "moveTo",
					params: [
						{ name: "x", type: "double" },
						{ name: "y", type: "double" },
					],
					returns: "void",
					visibility: "public",
				},
			],
		},
		{
			id: "Circle",
			attributes: [{ name: "radius", type: "double", visibility: "private" }],
			methods: [{ name: "area", returns: "double", visibility: "public" }],
		},
		{
			id: "Rectangle",
			attributes: [
				{ name: "width", type: "double", visibility: "private" },
				{ name: "height", type: "double", visibility: "private" },
			],
			methods: [{ name: "area", returns: "double", visibility: "public" }],
		},
		{
			id: "Square",
			methods: [
				{
					name: "of",
					params: [{ name: "side", type: "double" }],
					returns: "Square",
					visibility: "public",
					static: true,
				},
			],
		},
		{
			id: "Canvas",
			attributes: [{ name: "MAX_SHAPES", type: "int", visibility: "public", static: true }],
			methods: [
				{
					name: "add",
					params: [{ name: "shape", type: "Shape" }],
					returns: "void",
					visibility: "public",
				},
			],
		},
	],
	relationships: [
		{ id: "shape-draws", kind: "realization", from: "Shape", to: "Drawable" },
		{ id: "circle-is-shape", kind: "inheritance", from: "Circle", to: "Shape" },
		{ id: "rectangle-is-shape", kind: "inheritance", from: "Rectangle", to: "Shape" },
		{ id: "square-is-rectangle", kind: "inheritance", from: "Square", to: "Rectangle" },
		{
			id: "canvas-holds",
			kind: "aggregation",
			from: "Canvas",
			to: "Shape",
			fromMultiplicity: "1",
			toMultiplicity: "0..*",
			toRole: "shapes",
		},
	],
});
