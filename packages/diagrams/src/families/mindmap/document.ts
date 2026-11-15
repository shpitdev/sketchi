import { DiagramStyle, SKETCHI_DIAGRAM_STYLE } from "@sketchi/drawing";
import { Array, Effect, Result, Schema } from "effect";
import { cleanToolString, slug } from "../../clean-text.js";

/** The document people and models author, and the CLI persists. Children are in reading order. */
export interface MindmapTopic {
	readonly label: string;
	readonly children?: readonly MindmapTopic[] | undefined;
}

const SemanticText = Schema.NonEmptyString.check(
	Schema.makeFilter(
		(text) => {
			const cleaned = cleanToolString(text);
			return cleaned.length > 0 && !/^(?:""|''|``)$/.test(cleaned);
		},
		{ message: "Must contain semantic text after normalization." },
	),
);

export const MindmapTopic: Schema.Codec<MindmapTopic> = Schema.Struct({
	label: SemanticText,
	children: Schema.optionalKey(Schema.Array(Schema.suspend(() => MindmapTopic))),
}).annotate({ identifier: "MindmapTopic" });

const Layout = Schema.Struct({
	direction: Schema.Literals(["LR", "RL"]).pipe(
		Schema.withDecodingDefaultKey(Effect.succeed("LR")),
	),
});
export const MindmapDocument = Schema.Struct({
	id: Schema.optionalKey(Schema.NonEmptyString),
	title: SemanticText,
	root: MindmapTopic,
	layout: Layout.pipe(Schema.withDecodingDefaultKey(Effect.succeed({ direction: "LR" }))),
	style: DiagramStyle.pipe(Schema.withDecodingDefaultKey(Effect.succeed(SKETCHI_DIAGRAM_STYLE))),
});
export interface MindmapDocument extends Schema.Schema.Type<typeof MindmapDocument> {}

/** One decoded document; the tag is for the shared family dispatcher, not a second graph model. */
export const Mindmap = Schema.Struct({
	...MindmapDocument.fields,
	id: Schema.NonEmptyString,
	type: Schema.Literal("mindmap"),
});
export interface Mindmap extends Schema.Schema.Type<typeof Mindmap> {}
export const MAX_MINDMAP_DEPTH = 8;
export const MAX_MINDMAP_TOPICS = 200;
export class MindmapInputError extends Schema.TaggedError<
	MindmapInputError,
	{ readonly brand: unique symbol }
>()("MindmapInputError", {
	code: Schema.Literals(["disconnected_graph", "mindmap_too_deep", "mindmap_too_large"]),
	message: Schema.String,
	hint: Schema.String,
}) {}

/** Bound unknown trees before recursive Schema decoding (including cyclic/non-JSON callers). */
export function checkMindmapSize(root: unknown): Result.Result<void, MindmapInputError> {
	const stack: { topic: unknown; depth: number }[] = [{ topic: root, depth: 0 }];
	let count = 1;
	while (stack.length) {
		const current = stack.pop();
		if (!current) break;
		if (current.depth > MAX_MINDMAP_DEPTH)
			return Result.fail(
				new MindmapInputError({
					code: "mindmap_too_deep",
					message: `Mindmap depth exceeds the supported maximum of ${MAX_MINDMAP_DEPTH}.`,
					hint: "Combine overly deep topics into a shallower hierarchy.",
				}),
			);
		if (
			typeof current.topic !== "object" ||
			current.topic === null ||
			!("children" in current.topic) ||
			!Array.isArray(current.topic.children)
		)
			continue;
		count += current.topic.children.length;
		if (count > MAX_MINDMAP_TOPICS)
			return Result.fail(
				new MindmapInputError({
					code: "mindmap_too_large",
					message: `Mindmap exceeds the supported maximum of ${MAX_MINDMAP_TOPICS} topic slots.`,
					hint: "Split this hierarchy into smaller focused mindmaps.",
				}),
			);
		for (const child of current.topic.children)
			stack.push({ topic: child, depth: current.depth + 1 });
	}
	return Result.succeed(undefined);
}

export function normalizeMindmap(document: MindmapDocument): Mindmap {
	const title = cleanToolString(document.title);
	const id = document.id && cleanToolString(document.id);
	const normalize = (topic: MindmapTopic): MindmapTopic => ({
		label: cleanToolString(topic.label),
		...(topic.children ? { children: Array.map(topic.children, normalize) } : {}),
	});
	const derivedId = slug(title);
	return {
		...document,
		id: id || derivedId || "sketchi-mindmap",
		title,
		root: normalize(document.root),
		type: "mindmap",
	};
}

function decodeMindmapDocument(
	input: unknown,
): Result.Result<MindmapDocument, Schema.SchemaError | MindmapInputError> {
	return Result.gen(function* () {
		const root =
			typeof input === "object" && input !== null && "root" in input ? input.root : undefined;
		yield* checkMindmapSize(root);
		return yield* Schema.decodeUnknownResult(MindmapDocument, { errors: "all" })(input);
	});
}

export function parseMindmap(
	input: unknown,
): Result.Result<Mindmap, Schema.SchemaError | MindmapInputError> {
	return Result.gen(function* () {
		const document = yield* decodeMindmapDocument(input);
		yield* checkMindmapRoot(document.root);
		return normalizeMindmap(document);
	});
}

/** Visit authored topics with their stable path identity; parentage is never stored separately. */
export function mindmapTopics(
	root: MindmapTopic,
	path: readonly number[] = [0],
	parent?: string,
): readonly {
	readonly id: string;
	readonly label: string;
	readonly parent: string | undefined;
	readonly topic: MindmapTopic;
}[] {
	const id = `topic-${Array.join(
		Array.map(path, (index) => `${index}`),
		"-",
	)}`;
	return [
		{ id, label: root.label, parent, topic: root },
		...Array.flatMap(root.children ?? [], (child, index) =>
			mindmapTopics(child, Array.append(path, index), id),
		),
	];
}

/** Policy validation for typed in-process documents; unknown callers use parseMindmap. */
export function validateMindmap(
	document: MindmapDocument,
): Result.Result<Mindmap, MindmapInputError> {
	return Result.gen(function* () {
		yield* checkMindmapSize(document.root);
		yield* checkMindmapRoot(document.root);
		return normalizeMindmap(document);
	});
}

/** The root needs a branch; child topics may be leaves. */
export function checkMindmapRoot(root: MindmapTopic): Result.Result<void, MindmapInputError> {
	return root.children?.length
		? Result.succeed(undefined)
		: Result.fail(
				new MindmapInputError({
					code: "disconnected_graph",
					message: "Mindmap root must contain at least one child topic.",
					hint: "Add one or more nested topics under spec.root.children.",
				}),
			);
}

/** Counts and domain nouns shown by generation consumers. */
export function counts(diagram: Mindmap) {
	return {
		nodeCount: [...mindmapTopics(diagram.root)].length,
		edgeCount: [...mindmapTopics(diagram.root)].length - 1,
	};
}
