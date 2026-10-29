import { describe, expect, it } from "vitest";

import { Schema } from "effect";
import { toCodeModeJsonSchema } from "@sketchi/diagram-agent";
import {
	getWireframeValidationIssues,
	resolveWireframeShorthand,
	WIREFRAME_CONTAINER_TYPES,
	WIREFRAME_WIDGET_TYPES,
	type WireframeDiagram,
} from "@sketchi/diagram-core";
import { buildDiagramGenerationMessages } from "@sketchi/diagram-generation";
import { CODE_MODE_OPERATIONS, codeModeContracts, type CodeModeOperation } from "./mcp-docs/types";
import { getCodeModeDocs, SKETCHI_EXECUTE_CODE_DESCRIPTION } from "./mcp-docs.server";

/** A field as a docs skeleton writes it: `name?: "a" | "b" (note)`, `name: { … }` or `name: [{ … }]`. */
interface DocField {
	readonly name: string;
	readonly optional: boolean;
	/** Quoted values the docs give the field, in its value or its note. */
	readonly literals: readonly string[];
	readonly fields?: readonly DocField[];
}

/** Reads the `{ … }` skeleton opening at `start`, returning its fields and the index past it. */
function readSkeleton(text: string, start: number): { fields: DocField[]; end: number } {
	let index = start + 1;
	const fields: DocField[] = [];
	const fail = (what: string) => {
		throw new Error(`${what} at "${text.slice(index, index + 40)}" in "${text.slice(0, 60)}…"`);
	};
	const space = () => {
		while (text[index] === " ") index += 1;
	};
	/** Skips the bracketed group opening at index, quotes included. */
	const skipGroup = () => {
		const open = text[index]!;
		const close = { "(": ")", "[": "]", "{": "}" }[open]!;
		let depth = 0;
		do {
			const char = text[index];
			if (char === undefined) fail(`Unclosed ${open}`);
			if (char === '"') index = text.indexOf('"', index + 1);
			else if (char === open) depth += 1;
			else if (char === close) depth -= 1;
			index += 1;
		} while (depth > 0);
	};
	const quoted = (from: number, to: number) =>
		[...text.slice(from, to).matchAll(/"([^"]*)"/g)].map((match) => match[1]!);
	for (;;) {
		space();
		if (text[index] === "}") return { fields, end: index + 1 };
		// One entry, or alternatives such as `end? (last day) | duration? (days)`.
		for (;;) {
			const name = /^[A-Za-z_]\w*/.exec(text.slice(index))?.[0];
			if (!name) fail("Expected a field name");
			index += name!.length;
			const optional = text[index] === "?";
			if (optional) index += 1;
			space();
			const literals: string[] = [];
			let nested: DocField[] | undefined;
			if (text[index] === ":") {
				index += 1;
				space();
				const valueStart = index;
				if (text[index] === "{") ({ fields: nested, end: index } = readSkeleton(text, index));
				else if (text[index] === "[" && /^\[\s*\{/.test(text.slice(index))) {
					({ fields: nested, end: index } = readSkeleton(text, text.indexOf("{", index)));
					space();
					if (text[index] !== "]") fail("Expected ]");
					index += 1;
				} else if (text[index] === "[") skipGroup();
				else if (text[index] === '"') {
					// A literal or a union of literals: "a" | "b".
					for (;;) {
						index = text.indexOf('"', index + 1) + 1;
						space();
						if (!/^\|\s*"/.test(text.slice(index))) break;
						index = text.indexOf('"', index);
					}
					literals.push(...quoted(valueStart, index));
				} else while (index < text.length && !",}(".includes(text[index]!)) index += 1;
			}
			space();
			if (text[index] === "(") {
				const noteStart = index;
				skipGroup();
				literals.push(...quoted(noteStart, index));
			}
			fields.push({ name: name!, optional, literals, ...(nested ? { fields: nested } : {}) });
			space();
			if (text[index] !== "|") break;
			index += 1;
			space();
		}
		space();
		if (text[index] === ",") index += 1;
		else if (text[index] !== "}") fail("Expected , or }");
	}
}

type Json = Record<string, unknown>;

function requestSchema(operation: CodeModeOperation): Json {
	return toCodeModeJsonSchema(Schema.toEncoded(codeModeContracts[operation].input));
}

/** The object or array schema behind references and unions. */
function resolve(schema: unknown, root: Json): Json[] {
	const node = schema as Json;
	if (typeof node.$ref === "string")
		return resolve((root.$defs as Json)[node.$ref.slice("#/$defs/".length)], root);
	const members = (node.anyOf ?? node.oneOf) as unknown[] | undefined;
	if (members) return members.flatMap((member) => resolve(member, root));
	if (node.type === "array") return resolve(node.items, root);
	return [node];
}

function enumOf(schema: unknown, root: Json): string[] | undefined {
	const values = resolve(schema, root).flatMap((node) =>
		Array.isArray(node.enum) ? node.enum : "const" in node ? [node.const] : [],
	);
	return values.length === 0 ? undefined : values.map(String);
}

/**
 * What a skeleton gets wrong about its schema: a field the schema lacks, a required field it
 * omits or marks optional, or a value outside the field's literals.
 */
function skeletonErrors(fields: readonly DocField[], schema: unknown, root: Json, path: string) {
	const errors: string[] = [];
	const objects = resolve(schema, root).filter((node) => node.properties);
	const properties = Object.assign({}, ...objects.map((node) => node.properties)) as Json;
	const required = new Set(objects.flatMap((node) => (node.required as string[]) ?? []));
	for (const field of fields) {
		const at = `${path}.${field.name}`;
		const property = properties[field.name];
		if (property === undefined) {
			errors.push(`${at} is not a field`);
			continue;
		}
		if (field.optional && required.has(field.name)) errors.push(`${at} is required, not optional`);
		const values = enumOf(property, root);
		for (const literal of field.literals)
			if (values && !values.includes(literal)) errors.push(`${at} takes no "${literal}"`);
		if (field.fields) errors.push(...skeletonErrors(field.fields, property, root, at));
	}
	for (const name of required)
		if (!fields.some((field) => field.name === name)) errors.push(`${path}.${name} is missing`);
	return errors;
}

/** A code parameter line such as `- buildErDiagram (database schemas): spec: { … }`. */
const specLine = (operation: string) =>
	new RegExp(`^(?:- )?${operation}(?: \\([^)]*\\))?: spec: \\{`);

/** Every request skeleton in a text: `spec: { … }` and `accepts { spec: … }`. */
function skeletons(text: string): DocField[][] {
	return [
		...text.matchAll(/(?:accepts |^(?:- )?\w+(?: \([^)]*\))?: (?=spec: \{))(\{|spec: \{)/gm),
	].map((match) => {
		const open = match.index + match[0].length - 1;
		const { fields, end } = readSkeleton(text, open);
		expect(end, text.slice(match.index, end)).toBeGreaterThan(open);
		return match[1] === "{" ? fields : [{ name: "spec", optional: false, literals: [], fields }];
	});
}

const BUILDERS = CODE_MODE_OPERATIONS.filter(
	(operation): operation is Extract<CodeModeOperation, `build${string}`> =>
		operation.startsWith("build"),
);

describe("docs field lists", () => {
	it("give every builder skeleton exactly the fields, requirements and literals its schema has", () => {
		const lines = SKETCHI_EXECUTE_CODE_DESCRIPTION.split("\n");
		for (const operation of BUILDERS) {
			const line = lines.find((entry) => specLine(operation).test(entry));
			expect(line, `${operation} has a compact spec line`).toBeDefined();
			expect(skeletons(line!), operation).toHaveLength(1);
			const guidance = getCodeModeDocs({ topic: operation }).content.split("Request type:")[0]!;
			const schema = requestSchema(operation);
			for (const [where, text] of [
				["code parameter", line!],
				["topic", guidance],
			] as const)
				for (const fields of skeletons(text))
					expect(
						skeletonErrors(fields, schema, schema, operation),
						`${operation} ${where}`,
					).toEqual([]);
		}
	});

	it("reads skeleton grammar and reports what a schema rejects", () => {
		const schema = requestSchema("buildGantt");
		const [fields] = skeletons(
			'- buildGantt: spec: { title, tasks: [{ id, label?, start: "x", end? (last day) | duration? (days), mood: "glad" | "sad" }] }.',
		);
		expect(skeletonErrors(fields!, schema, schema, "buildGantt")).toEqual([
			"buildGantt.spec.tasks.label is required, not optional",
			"buildGantt.spec.tasks.mood is not a field",
		]);
		const chart = requestSchema("buildChart");
		const [chartFields] = skeletons(
			'- buildChart: spec: { title, kind: "bar" | "area", series: [{ values: number[] }], orientation? ("diagonal", bar) }',
		);
		expect(skeletonErrors(chartFields!, chart, chart, "buildChart")).toEqual([
			'buildChart.spec.kind takes no "area"',
			'buildChart.spec.orientation takes no "diagonal"',
			"buildChart.spec.categories is missing",
		]);
	});
});

const WIREFRAME_SAMPLES: Readonly<Record<string, (type: string) => unknown>> = {
	text: () => "Sample text",
	label: () => "Sample label",
	title: () => "Sample title",
	placeholder: () => "Sample hint",
	value: () => "Sample value",
	level: () => 2,
	lines: () => 2,
	variant: () => "primary",
	checked: () => true,
	disabled: () => true,
	items: () => ["Alpha", "Beta"],
	active: () => "Alpha",
	columns: (type) => (type === "table" ? ["Name"] : 2),
	rows: () => 2,
	kind: () => "bar",
	aspect: () => "square",
	side: () => "right",
	align: () => "center",
	target: () => "other",
	children: () => [{ type: "text", text: "Child" }],
};
const COMPONENT = "screens.[0].children.[0]";

/** One component on a screen beside another it may open, resolved and validated as builds do. */
function buildComponent(component: Record<string, unknown>) {
	const diagram = resolveWireframeShorthand({
		title: "Probe",
		screens: [
			{ id: "home", name: "Home", children: [component] },
			{ id: "other", name: "Other", children: [{ type: "text", text: "Elsewhere" }] },
		],
	}) as WireframeDiagram;
	const issues = getWireframeValidationIssues(diagram).filter(
		(issue) =>
			issue.path.startsWith(`${COMPONENT}.`) &&
			!issue.path.slice(COMPONENT.length + 1).includes("."),
	);
	const resolved: Record<string, unknown> = { ...diagram.screens[0]!.children[0]! };
	return { resolved, issues };
}

/** Fields a component of this type cannot build without. */
function requiredFields(type: string): string[] {
	return buildComponent({ type }).issues.map((issue) => issue.path.slice(COMPONENT.length + 1));
}

/** Whether a build keeps the field on a component of this type, under its name or another. */
function accepts(type: string, field: string): boolean {
	const base = Object.fromEntries(
		requiredFields(type).map((name) => [name, WIREFRAME_SAMPLES[name]!(type)]),
	);
	const sample = WIREFRAME_SAMPLES[field]!(type);
	const { resolved, issues } = buildComponent({ type, ...base, [field]: sample });
	return (
		issues.length === 0 &&
		(resolved[field] !== undefined || Object.values(resolved).includes(sample))
	);
}

/**
 * The per-type fields a clause such as `Widgets: heading (text, level?), checkbox, radio and
 * toggle (label, checked?), divider.` lists. A parenthetical belongs to every type named since the
 * previous one, which is how `checkbox, radio, toggle (label, checked?)` gives radio a label.
 */
function clauseFields(text: string, heading: RegExp): Map<string, Set<string>> {
	const matches = [...text.matchAll(new RegExp(heading.source, "g"))];
	expect(
		matches.map((match) => match[0]),
		`one ${heading} clause`,
	).toHaveLength(1);
	const start = matches[0]!.index + matches[0]![0].length;
	const parts: string[] = [];
	let depth = 0;
	let from = start;
	let index = start;
	for (; index < text.length; index += 1) {
		const char = text[index]!;
		if (char === '"') index = text.indexOf('"', index + 1);
		else if (char === "(") depth += 1;
		else if (char === ")") depth -= 1;
		else if (depth === 0 && char === ",") {
			parts.push(text.slice(from, index));
			from = index + 1;
		} else if (depth === 0 && char === "." && /^(\s|$)/.test(text.slice(index + 1))) break;
	}
	parts.push(text.slice(from, index));
	const shared = new Set(fieldNames(/\((.*)\)/.exec(matches[0]![0])?.[1] ?? ""));
	if (/\bchildren\b/.test(matches[0]![0])) shared.add("children");
	const result = new Map<string, Set<string>>();
	let pending: string[] = [];
	for (const part of parts) {
		const [, names = "", note] = /^\s*([^(]*?)\s*(?:\((.*)\))?\s*$/.exec(part)!;
		pending.push(...names.replace(/^and /, "").split(/ and /));
		if (note === undefined) continue;
		for (const type of pending) result.set(type, new Set([...shared, ...fieldNames(note)]));
		pending = [];
	}
	for (const type of pending) result.set(type, new Set(shared));
	return result;
}

/** Field names a parenthetical lists: `label?, placeholder or value`, `side: "left" | "right"`. */
function fieldNames(note: string): string[] {
	return note
		.replace(/"[^"]*"/g, "")
		.split(/[,;]| or /)
		.map((piece) => /^\s*(?:or\s+)?([a-z]+)/.exec(piece)?.[1] ?? "")
		.filter((name) => name in WIREFRAME_SAMPLES);
}

describe("wireframe docs", () => {
	const docs = {
		"code parameter": SKETCHI_EXECUTE_CODE_DESCRIPTION.split("\n").find((line) =>
			specLine("buildWireframe").test(line),
		)!,
		topic: getCodeModeDocs({ topic: "buildWireframe" }).content.split("Request type:")[0]!,
		"generation prompt": buildDiagramGenerationMessages({
			id: "probe",
			request: "Wireframe a screen.",
			requestedType: "wireframe",
		}).system,
	};

	it("probes every component field the schema declares", () => {
		const schema = requestSchema("buildWireframe");
		const component = Object.values(schema.$defs as Json).find(
			(definition) =>
				(definition as Json).properties && "children" in ((definition as Json).properties as Json),
		) as Json;
		expect(
			Object.keys(component.properties as Json)
				.filter((field) => field !== "type")
				.sort(),
		).toEqual(Object.keys(WIREFRAME_SAMPLES).sort());
		// The probes agree with the validator's own rules.
		expect(accepts("tabs", "active")).toBe(true);
		expect(accepts("list", "active")).toBe(false);
		expect(requiredFields("checkbox")).toEqual(["label"]);
	});

	for (const [where, text] of Object.entries(docs))
		it(`lists exactly the fields each component builds with in the ${where}`, () => {
			const listed = new Map([
				...clauseFields(text, /Containers[^:.]*:/),
				...clauseFields(text, /Widgets:/),
			]);
			expect([...listed.keys()].sort()).toEqual(
				[...WIREFRAME_CONTAINER_TYPES, ...WIREFRAME_WIDGET_TYPES].sort(),
			);
			const errors: string[] = [];
			for (const [type, fields] of listed) {
				for (const field of fields)
					if (!accepts(type, field)) errors.push(`${type} rejects ${field}`);
				for (const field of requiredFields(type))
					if (!fields.has(field)) errors.push(`${type} needs ${field}`);
			}
			expect(errors).toEqual([]);
		});
});
