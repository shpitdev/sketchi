import { Schema } from "effect";

/** Native serialized elements retain every editor field, including fields the server does not interpret. */
export const ExcalidrawElement = Schema.StructWithRest(
	Schema.Struct({
		id: Schema.NonEmptyString.pipe(Schema.mutableKey),
		type: Schema.NonEmptyString.pipe(Schema.mutableKey),
	}),
	[Schema.Record(Schema.String, Schema.Unknown.pipe(Schema.mutableKey))],
);
export interface ExcalidrawElement extends Schema.Schema.Type<typeof ExcalidrawElement> {}

export const ExcalidrawScene = Schema.Struct({
	appState: Schema.Record(Schema.String, Schema.Unknown),
	elements: Schema.Array(ExcalidrawElement),
	files: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});
export interface ExcalidrawScene extends Schema.Schema.Type<typeof ExcalidrawScene> {}

export const ExcalidrawFile = Schema.Struct({
	...ExcalidrawScene.fields,
	files: Schema.Record(Schema.String, Schema.Unknown),
	source: Schema.NonEmptyString,
	type: Schema.Literal("excalidraw"),
	version: Schema.Literal(2),
}).annotate({ identifier: "ExcalidrawFile" });
export interface ExcalidrawFile extends Schema.Schema.Type<typeof ExcalidrawFile> {}
