import {
	CANVAS_LIMITS,
	CanvasConnectorElement,
	CanvasFrameElement,
	CanvasIconElement,
	CanvasLineElement,
	CanvasNodeIcon,
	CanvasPoint,
	CanvasShapeElement,
	CanvasSpec,
	CanvasTextElement,
	DrawnIconSchema,
} from "@sketchi/drawing";
import { Schema } from "effect";

import { optionalContract, requiredArray } from "../build/schema";

/** Authoring adds inline recipes; accepted scenes resolve them to slugs and assets. */
const CanvasIconInput = Schema.Struct({
	...CanvasNodeIcon.fields,
	slug: optionalContract(CanvasNodeIcon.fields.slug).pipe(Schema.mutableKey),
	...DrawnIconSchema.fields,
});
const CanvasInputPoints = Schema.Array(CanvasPoint)
	.pipe(Schema.mutable)
	.check(Schema.isMinLength(2), Schema.isMaxLength(CANVAS_LIMITS.maxPointsPerElement));
export const CanvasElementInput = Schema.Union(
	[
		CanvasShapeElement.mapFields((fields) => ({
			...fields,
			icon: optionalContract(CanvasIconInput).pipe(Schema.mutableKey),
			points: optionalContract(CanvasInputPoints).pipe(Schema.mutableKey),
		})),
		CanvasTextElement,
		CanvasConnectorElement.mapFields((fields) => ({
			...fields,
			points: CanvasInputPoints.pipe(Schema.mutableKey),
		})),
		CanvasLineElement.mapFields((fields) => ({
			...fields,
			points: CanvasInputPoints.pipe(Schema.mutableKey),
		})),
		CanvasFrameElement.mapFields((fields) => ({
			...fields,
			icon: optionalContract(CanvasIconInput).pipe(Schema.mutableKey),
		})),
		CanvasIconElement.mapFields((fields) => ({
			...fields,
			slug: optionalContract(fields.slug).pipe(Schema.mutableKey),
			...DrawnIconSchema.fields,
		})),
	],
	{ mode: "oneOf" },
);
export const CanvasInput = CanvasSpec.mapFields((fields) => ({
	...fields,
	elements: requiredArray(
		Schema.Array(CanvasElementInput)
			.pipe(Schema.mutable)
			.annotate({ maxItems: CANVAS_LIMITS.maxElements }),
	),
}));

/** A canvas as a request authors it, before icons resolve and point lists normalize. */
export type CanvasInput = typeof CanvasInput.Type;
