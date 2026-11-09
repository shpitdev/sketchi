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
			{drawing.parts.map((part, index) =>
				part.kind === "text" ? (
					<text
						dominantBaseline="central"
						fill={part.fill}
						fontFamily="var(--font-script)"
						fontSize={part.size}
						key={index}
						textAnchor="middle"
						x={part.x}
						y={part.y}
					>
						{part.text}
					</text>
				) : (
					<g key={index}>
						{part.paths.map((path, pathIndex) => (
							<path
								d={path.d}
								fill={path.fill}
								key={pathIndex}
								stroke={path.stroke}
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={path.strokeWidth}
							/>
						))}
					</g>
				),
			)}
		</svg>
	);
}
