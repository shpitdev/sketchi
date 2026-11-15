import { Schema } from "effect";
export const BUILD_ARTIFACT_FORMATS = ["excalidraw", "scene", "png"] as const;

export const ARTIFACT_FORMATS = [...BUILD_ARTIFACT_FORMATS, "document"] as const;

export const INLINE_ARTIFACT_FORMATS = ["excalidraw", "scene", "document"] as const;

export const BuildArtifactFormatSchema = Schema.Literals(BUILD_ARTIFACT_FORMATS);

export const ArtifactFormatSchema = Schema.Literals(ARTIFACT_FORMATS);

export const InlineArtifactFormatSchema = Schema.Literals(INLINE_ARTIFACT_FORMATS);

export type ArtifactFormat = typeof ArtifactFormatSchema.Type;

export type InlineArtifactFormat = typeof InlineArtifactFormatSchema.Type;

export const ArtifactProvenance = Schema.Struct({
	sourceArtifactId: Schema.NonEmptyString.pipe(Schema.mutableKey),
}).annotate({ identifier: undefined });

export interface ArtifactProvenance extends Schema.Schema.Type<typeof ArtifactProvenance> {}

export interface ArtifactFormatRef {
	readonly format: ArtifactFormat;
	readonly mimeType: string;
	readonly url?: string;
	readonly expiresAt?: string;
	readonly inline?: unknown;
	readonly sizeBytes?: number;
}

export interface ArtifactBundle {
	readonly artifactId: string;
	readonly diagramId: string;
	readonly formats: ArtifactFormatRef[];
	readonly provenance?: ArtifactProvenance;
}

export interface PartialArtifactBundle {
	readonly artifactId?: string;
	readonly diagramId?: string;
	readonly formats?: ArtifactFormatRef[];
}

export const ArtifactFormatRefSchema = Schema.Struct({
	format: ArtifactFormatSchema,
	mimeType: Schema.String,
	url: Schema.optionalKey(Schema.String),
	expiresAt: Schema.optionalKey(Schema.String),
	inline: Schema.optionalKey(Schema.Unknown),
	sizeBytes: Schema.optionalKey(Schema.Number),
});

export const ArtifactBundleSchema = Schema.Struct({
	artifactId: Schema.String,
	diagramId: Schema.String,
	formats: Schema.Array(ArtifactFormatRefSchema).pipe(Schema.mutable),
	provenance: Schema.optionalKey(ArtifactProvenance),
});

export const PartialArtifactBundleSchema = Schema.Struct({
	artifactId: Schema.optionalKey(Schema.String),
	diagramId: Schema.optionalKey(Schema.String),
	formats: Schema.optionalKey(Schema.Array(ArtifactFormatRefSchema).pipe(Schema.mutable)),
});
