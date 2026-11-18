import { IconRecipeSchema } from "@sketchi/drawing";
import { Schema } from "effect";

export const ICON_NAME_MAX_LENGTH = 48;
/** Largest decoded raster accepted. */
export const ICON_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
/** A request carries one SVG or one base64 raster; this bounds the JSON around it. */
export const ICON_DRAW_REQUEST_MAX_BYTES = Math.ceil((ICON_IMAGE_MAX_BYTES * 4) / 3) + 64 * 1024;

export const IconDrawRequestSchema = Schema.Struct({
	name: Schema.String,
	svg: Schema.optionalKey(Schema.String),
	/** A PNG, JPEG or WebP file as base64, or as a `data:` URL. */
	image: Schema.optionalKey(Schema.String),
	/** The author model; omitted uses the service default. */
	model: Schema.optionalKey(Schema.String),
});
export interface IconDrawRequest extends Schema.Schema.Type<typeof IconDrawRequestSchema> {}

const ModelUsage = Schema.Struct({
	/** Uncached input; cache reads and writes are counted separately. */
	inputTokens: Schema.Number,
	outputTokens: Schema.Number,
	cacheReadTokens: Schema.Number,
	cacheWriteTokens: Schema.Number,
});
const ModelCall = Schema.Struct({
	role: Schema.Literals(["author", "judge"]),
	model: Schema.String,
	usage: ModelUsage,
	ms: Schema.Number,
});
export interface ModelCall extends Schema.Schema.Type<typeof ModelCall> {}

const IconDrawUsage = Schema.Struct({
	calls: Schema.Number,
	/** Every input token, cached or not. */
	inputTokens: Schema.Number,
	cacheReadTokens: Schema.Number,
	cacheWriteTokens: Schema.Number,
	outputTokens: Schema.Number,
	ms: Schema.Number,
	byCall: Schema.Array(ModelCall),
});
export interface IconDrawUsage extends Schema.Schema.Type<typeof IconDrawUsage> {}

const IconJudgeVerdict = Schema.Struct({
	recognizable: Schema.Boolean,
	/** `source` or a look-alike's catalog slug; omitted when the judge gave no answer. */
	picked: Schema.optionalKey(Schema.String),
	lineup: Schema.Array(Schema.String),
	model: Schema.String,
	attempts: Schema.Number,
	error: Schema.optionalKey(Schema.String),
});
export interface IconJudgeVerdict extends Schema.Schema.Type<typeof IconJudgeVerdict> {}

const AuthorTurnOutcome = Schema.Struct({
	outcome: Schema.Literals(["drawn", "accepted", "invalid"]),
	issues: Schema.optionalKey(Schema.Array(Schema.String)),
});
export interface AuthorTurnOutcome extends Schema.Schema.Type<typeof AuthorTurnOutcome> {}

const IconLibrary = Schema.Struct({
	type: Schema.Literal("excalidrawlib"),
	version: Schema.Literal(2),
	source: Schema.String,
	libraryItems: Schema.Array(
		Schema.Struct({
			id: Schema.String,
			status: Schema.Literal("published"),
			created: Schema.Number,
			name: Schema.String,
			// Elements travel as Excalidraw data, not as a second drawing model.
			elements: Schema.Array(Schema.Unknown),
		}),
	),
});
export interface IconLibrary extends Schema.Schema.Type<typeof IconLibrary> {}

export const IconDrawSuccess = Schema.Struct({
	ok: Schema.Literal(true),
	status: Schema.Literal("drawn"),
	name: Schema.String,
	recipe: IconRecipeSchema,
	/** Base64 PNGs at node size and four times node size, exported at twice their size. */
	previews: Schema.Struct({ png28: Schema.String, png112: Schema.String }),
	excalidrawlib: IconLibrary,
	/** The source colors the recipe may use, with the share of the mark each covers. */
	palette: Schema.Array(Schema.Tuple([Schema.String, Schema.Number])),
	judge: IconJudgeVerdict,
	author: Schema.Struct({
		model: Schema.String,
		rounds: Schema.Number,
		accepted: Schema.Boolean,
		turns: Schema.Array(AuthorTurnOutcome),
	}),
	usage: IconDrawUsage,
});
export interface IconDrawSuccess extends Schema.Schema.Type<typeof IconDrawSuccess> {}
