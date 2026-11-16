/** Preserves actionable request diagnostics from native schema issues at the build boundary. */
import { Schema, SchemaAST, SchemaIssue } from "effect";
import { type CodeModeIssue, type CodeModeIssueCode } from "./result";

export const contractDiscriminatorAnnotation = "codeModeDiscriminator";
export const contractMissingKeyCodeAnnotation = "codeModeMissingKeyCode";

export const ContractSchemaIssue = Schema.Struct({
	code: Schema.Literal("custom"),
	issueTag: Schema.Literals([
		"Filter",
		"InvalidType",
		"InvalidValue",
		"MissingKey",
		"UnexpectedKey",
		"Forbidden",
		"OneOf",
		"AnyOf",
	]),
	astKind: Schema.optionalKey(Schema.String),
	missingKeyCode: Schema.optionalKey(Schema.Literal("invalid_type")),
	message: Schema.String,
	path: Schema.Array(Schema.PropertyKey),
}).annotate({ identifier: undefined });

export interface ContractSchemaIssue extends Schema.Schema.Type<typeof ContractSchemaIssue> {}

export class ContractSchemaError extends Schema.TaggedError<
	ContractSchemaError,
	{ readonly brand: unique symbol }
>()("ContractSchemaError", { issues: Schema.Array(Schema.toEncoded(ContractSchemaIssue)) }) {}

function actualType(value: unknown): string {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	return typeof value;
}

function expectedType(ast: SchemaAST.AST): string {
	if (SchemaAST.isString(ast)) return "string";
	if (SchemaAST.isNumber(ast)) return "number";
	if (SchemaAST.isBoolean(ast)) return "boolean";
	if (SchemaAST.isArrays(ast)) return "array";
	if (SchemaAST.isObjects(ast)) return "object";
	if (SchemaAST.isLiteral(ast)) return JSON.stringify(ast.literal);
	return "value";
}

const contractLeafHook: SchemaIssue.LeafHook = (issue) => {
	if (issue._tag !== "InvalidType") {
		return SchemaIssue.defaultLeafHook(issue);
	}
	const actual = SchemaIssue.hasInput(issue) ? issue.input : undefined;
	return `Invalid input: expected ${expectedType(issue.ast)}, received ${actualType(actual)}`;
};

const contractFormatter = SchemaIssue.makeFormatterStandardSchemaV1({
	leafHook: contractLeafHook,
});

function contractIssues(
	error: Schema.SchemaError,
): ReadonlyArray<typeof ContractSchemaIssue.Encoded> {
	const issues: Array<typeof ContractSchemaIssue.Encoded> = [];
	const visit = (
		node: SchemaIssue.Issue,
		path: readonly PropertyKey[],
		ast?: SchemaAST.AST,
	): void => {
		switch (node._tag) {
			case "Pointer":
				return visit(node.issue, [...path, ...node.path], ast);
			case "Encoding":
				return visit(node.issue, path, ast);
			case "Composite":
				for (const child of node.issues) visit(child, path, node.ast);
				return;
			case "AnyOf":
				if (node.issues.length > 0) {
					for (const child of node.issues) visit(child, path, node.ast);
					return;
				}
				break;
			case "Filter":
				if (
					SchemaIssue.defaultCheckHook(node) === undefined &&
					node.issue._tag !== "InvalidValue"
				) {
					return visit(node.issue, path, ast);
				}
				break;
			default:
				// Leaf issues are formatted below.
				break;
		}
		const nodeAst = "ast" in node ? node.ast : ast;
		const missingKeyCode =
			node._tag === "MissingKey" &&
			node.annotations?.[contractMissingKeyCodeAnnotation] === "invalid_type"
				? ("invalid_type" as const)
				: undefined;
		const astKind =
			nodeAst && SchemaAST.isUnion(nodeAst) && nodeAst.types.every(SchemaAST.isLiteral)
				? "LiteralUnion"
				: nodeAst?._tag;
		const discriminator = nodeAst?.annotations?.[contractDiscriminatorAnnotation];
		const issuePath = typeof discriminator === "string" ? [...path, discriminator] : path;
		for (const formatted of contractFormatter(node).issues) {
			issues.push({
				code: "custom",
				issueTag: node._tag,
				...(missingKeyCode ? { missingKeyCode } : {}),
				...(astKind ? { astKind } : {}),
				message: formatted.message,
				path: issuePath,
			});
		}
	};
	visit(error.issue, []);
	if (issues.length > 1 && issues.every((issue) => issue.path[0] === "source")) {
		return [
			{
				code: "custom",
				issueTag: "AnyOf",
				astKind: "Union",
				message: "Invalid input",
				path: ["source"],
			},
		];
	}
	return issues;
}

export function formatContractSchemaError(error: Schema.SchemaError): ContractSchemaError {
	return new ContractSchemaError({ issues: contractIssues(error) });
}

const MAX_INPUT_ISSUES = 20;

function pathForContractIssue(path: readonly PropertyKey[]): string {
	if (path.length === 0) {
		return "input";
	}
	return path.map((part) => (typeof part === "number" ? `[${part}]` : String(part))).join(".");
}

function codeForContractIssue(
	contractIssue: typeof ContractSchemaIssue.Encoded,
): CodeModeIssueCode {
	const path = pathForContractIssue(contractIssue.path);
	if (
		contractIssue.issueTag === "InvalidType" ||
		(contractIssue.issueTag === "MissingKey" && contractIssue.missingKeyCode === "invalid_type")
	)
		return "invalid_type";
	if (contractIssue.astKind === "LiteralUnion" && contractIssue.issueTag === "AnyOf")
		return "invalid_enum";
	if (path.toLowerCase().includes("color")) return "invalid_color";
	return path === "input" ? "invalid_type" : "missing_field";
}

export function inputIssues(
	error: ContractSchemaError,
	hintFor: (path: string) => string = (path) =>
		`Fix ${path} so it matches the Code Mode API contract.`,
	codeFor?: (path: string) => CodeModeIssueCode | undefined,
): CodeModeIssue[] {
	const issues = error.issues.slice(0, MAX_INPUT_ISSUES).map((contractIssue): CodeModeIssue => {
		const path = pathForContractIssue(contractIssue.path);
		return {
			severity: "error",
			code: codeFor?.(path) ?? codeForContractIssue(contractIssue),
			stage: "input",
			ref: { kind: "request", path },
			message: contractIssue.message,
			hint: hintFor(path),
		};
	});
	if (error.issues.length > MAX_INPUT_ISSUES) {
		issues.push({
			severity: "error",
			code: "invalid_type",
			stage: "input",
			ref: { kind: "request", path: "input" },
			message: `${error.issues.length - MAX_INPUT_ISSUES} additional input issues were omitted.`,
			hint: "Fix the summarized request shape before retrying.",
		});
	}
	return issues;
}
