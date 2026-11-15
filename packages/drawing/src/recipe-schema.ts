import { Schema } from "effect";
const RecipeNumber = Schema.Finite;
const RecipePoints = Schema.Array(Schema.Tuple([RecipeNumber, RecipeNumber]));
const recipePaint = {
	stroke: Schema.optionalKey(Schema.String),
	fill: Schema.optionalKey(Schema.String),
	pen: Schema.optionalKey(Schema.Literals([1, 2])),
};

/**
 * A recipe's shape. Decoding checks only types; iconRecipeIssues checks the
 * grid, the limits and the colors.
 */
export const IconRecipeSchema = Schema.Struct({
	parts: Schema.Array(
		Schema.Union(
			[
				Schema.Struct({
					kind: Schema.Literal("rect"),
					x: RecipeNumber,
					y: RecipeNumber,
					width: RecipeNumber,
					height: RecipeNumber,
					rounded: Schema.optionalKey(Schema.Boolean),
					...recipePaint,
				}),
				Schema.Struct({
					kind: Schema.Literal("ellipse"),
					cx: RecipeNumber,
					cy: RecipeNumber,
					rx: RecipeNumber,
					ry: RecipeNumber,
					...recipePaint,
				}),
				Schema.Struct({
					kind: Schema.Literal("stroke"),
					points: RecipePoints,
					smooth: Schema.optionalKey(Schema.Boolean),
					closed: Schema.optionalKey(Schema.Boolean),
					...recipePaint,
				}),
				Schema.Struct({
					kind: Schema.Literal("arrow"),
					points: RecipePoints,
					smooth: Schema.optionalKey(Schema.Boolean),
					stroke: recipePaint.stroke,
					pen: recipePaint.pen,
				}),
				Schema.Struct({
					kind: Schema.Literal("text"),
					cx: RecipeNumber,
					cy: RecipeNumber,
					text: Schema.String,
					size: RecipeNumber,
					color: Schema.optionalKey(Schema.String),
				}),
			],
			{ mode: "oneOf" },
		),
	),
});

/**
 * An icon drawn for one diagram and never published: what sketchi.drawIcon
 * returns, or any `{ name, recipe }`. It draws wherever a slug does, under
 * its drawnIconSlug. A missing or undrawable recipe drops the icon with a
 * warning instead of failing the diagram, so a failed drawing (no recipe)
 * still builds.
 */
export const DrawnIconSchema = Schema.Struct({
	name: Schema.optionalKey(Schema.String),
	recipe: Schema.optionalKey(IconRecipeSchema),
});
export type DrawnIcon = typeof DrawnIconSchema.Type;
