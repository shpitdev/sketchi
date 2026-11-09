import type { IconRecipe } from "@sketchi/diagram-core";
import { useMemo } from "react";

import { RECIPE_PREVIEW_SIZE, recipePreview } from "../../lib/recipe-drawing.js";
import type { PreviewMode } from "../preview-toggle/index.js";

/** Ink and paper of the preview tiles, matching `.icon-card__preview`. */
const PALETTES = {
	light: { ink: "#1e1e1e", paper: "#fffdf8" },
	dark: { ink: "#f1ece4", paper: "#25211c" },
} as const;

/** A recipe drawn by hand, in the preview's ink: what it looks like in a diagram. */
export function RecipePreview({
	className,
	label,
	previewMode,
	recipe,
}: {
	readonly className?: string;
	/** Accessible name; omitted, the drawing is decorative. */
	readonly label?: string;
	readonly previewMode: PreviewMode;
	readonly recipe: IconRecipe;
}) {
	const drawing = useMemo(
		() => recipePreview(recipe, PALETTES[previewMode]),
		[previewMode, recipe],
	);
	const pad = 4;
	return (
		<svg
			aria-hidden={label ? undefined : "true"}
			aria-label={label}
			className={className}
			role={label ? "img" : undefined}
			viewBox={`${-pad} ${-pad} ${RECIPE_PREVIEW_SIZE + pad * 2} ${RECIPE_PREVIEW_SIZE + pad * 2}`}
		>
			{drawing.paths.map((path, index) => (
				<path
					d={path.d}
					fill={path.fill}
					key={index}
					stroke={path.stroke}
					strokeLinecap="round"
					strokeLinejoin="round"
					strokeWidth={path.strokeWidth}
				/>
			))}
			{drawing.texts.map((text, index) => (
				<text
					dominantBaseline="central"
					fill={text.fill}
					fontFamily="var(--font-script)"
					fontSize={text.size}
					key={`text-${index}`}
					textAnchor="middle"
					x={text.x}
					y={text.y}
				>
					{text.text}
				</text>
			))}
		</svg>
	);
}
