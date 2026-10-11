import {
	CANONICAL_DOCUMENT_SPECS,
	CANONICAL_DOCUMENT_TYPES,
	type CanonicalDiagramDocument,
	CanvasSpec,
	isCanonicalDocumentType,
} from "@sketchi/diagram-agent";
import { Effect, Schema, SchemaIssue } from "effect";

import { CliInputError, CliValidationError } from "./errors.js";

function pathForIssue(path: ReadonlyArray<PropertyKey>): string {
	if (path.length === 0) return "document";
	return path.map((part) => (typeof part === "number" ? `[${part}]` : String(part))).join(".");
}

function isPropertyKey(value: unknown): value is PropertyKey {
	return typeof value === "string" || typeof value === "number" || typeof value === "symbol";
}

function pathSegment(value: unknown): PropertyKey | undefined {
	if (isPropertyKey(value)) return value;
	if (value !== null && typeof value === "object" && "key" in value) {
		return isPropertyKey(value.key) ? value.key : undefined;
	}
	return undefined;
}

export type { CanonicalDiagramDocument };

export type CanvasDiagramDocument = {
	readonly type: "canvas";
	readonly spec: CanvasSpec;
};

export type DiagramDocument = CanonicalDiagramDocument | CanvasDiagramDocument;

const formatSchemaIssue = SchemaIssue.makeFormatterStandardSchemaV1();
/** `a, b, or c` for a list of alternatives. */
export function alternativeList(values: readonly string[]): string {
	if (values.length < 2) return values.join("");
	return `${values.slice(0, -1).join(", ")}${values.length > 2 ? "," : ""} or ${values.at(-1)}`;
}

const canonicalTypeList = alternativeList(CANONICAL_DOCUMENT_TYPES.map((type) => `"${type}"`));
const canonicalDocumentHint = `Use ${alternativeList(
	CANONICAL_DOCUMENT_TYPES.map((type) => `{"type":"${type}","spec":...}`),
)}.`;

const decodeCanvasSpec = Schema.decodeUnknownEffect(CanvasSpec, {
	errors: "all",
});

function validationError(details: ReadonlyArray<string>) {
	return CliValidationError.make({
		message: "The canonical diagram document is invalid.",
		hint: canonicalDocumentHint,
		details,
	});
}

function schemaDetails(issue: SchemaIssue.Issue): ReadonlyArray<string> {
	return formatSchemaIssue(issue).issues.map((detail) => {
		const path = (detail.path ?? []).flatMap((segment) => {
			const normalized = pathSegment(segment);
			return normalized === undefined ? [] : [normalized];
		});
		return `${pathForIssue(["spec", ...path])}: ${detail.message}`;
	});
}

function canvasDocument(spec: CanvasSpec): CanvasDiagramDocument {
	return { type: "canvas", spec };
}

function documentFields(
	input: unknown,
): { readonly type: unknown; readonly spec: unknown } | undefined {
	if (
		typeof input !== "object" ||
		input === null ||
		Array.isArray(input) ||
		!("type" in input) ||
		!("spec" in input)
	) {
		return undefined;
	}
	return { type: input.type, spec: input.spec };
}

export const decodeCanonicalDiagramDocument = Effect.fn("sketchi.cli.document.decodeCanonical")(
	function* (input: unknown) {
		const fields = documentFields(input);
		if (!fields) {
			return yield* validationError(["document: Expected an object with type and spec."]);
		}
		if (isCanonicalDocumentType(fields.type)) {
			const type = fields.type;
			const spec: unknown = yield* Schema.decodeUnknownEffect(CANONICAL_DOCUMENT_SPECS[type], {
				errors: "all",
			})(fields.spec).pipe(Effect.mapError((error) => validationError(schemaDetails(error.issue))));
			// The registry pairs each family with its spec schema.
			return { type, spec } as CanonicalDiagramDocument;
		}
		return yield* validationError([`document.type: Expected ${canonicalTypeList}.`]);
	},
);

export const parseJsonDocument = Effect.fn("sketchi.cli.document.parseJson")(function* (
	text: string,
) {
	const input: unknown = yield* Effect.try({
		try: () => JSON.parse(text),
		catch: () =>
			CliInputError.make({
				code: "invalid_json",
				message: "The input is not valid JSON.",
				hint: "Pass one complete canonical document object.",
			}),
	});

	return yield* decodeCanonicalDiagramDocument(input);
});

/** Decode every document shape that the local store can own. */
export const decodeStoredDiagramDocument = Effect.fn("sketchi.cli.document.decodeStored")(
	function* (input: unknown) {
		const fields = documentFields(input);
		if (fields?.type !== "canvas") {
			return yield* decodeCanonicalDiagramDocument(input);
		}
		const spec = yield* decodeCanvasSpec(fields.spec).pipe(
			Effect.mapError((error) => validationError(schemaDetails(error.issue))),
		);
		return canvasDocument(spec);
	},
);

export function encodeJson(value: unknown): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

export function documentId(document: CanonicalDiagramDocument): string {
	const explicitId = document.spec.id?.trim();
	if (explicitId) return explicitId;
	const slug = document.spec.title
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
	return slug || `sketchi-${document.type}`;
}

export function validateStorageId(id: string): Effect.Effect<string, CliValidationError> {
	if (/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id)) {
		return Effect.succeed(id);
	}
	return Effect.fail(
		CliValidationError.make({
			message: `Diagram id "${id}" is not safe for local storage.`,
			hint: "Use 1-128 ASCII letters, digits, dots, underscores, or hyphens; start with a letter or digit.",
			details: ["spec.id"],
		}),
	);
}
