import type { IconRecipe } from "@sketchi/diagram-core/icon-recipe";
import { useMemo } from "react";

import { RECIPE_PREVIEW_SIZE, recipePreview } from "../../lib/recipe-drawing.js";
import type { PreviewMode } from "../preview-toggle/index.js";

/** Excalidraw inverts the entire light canvas, including brand colors, in dark mode. */
const PALETTE = { ink: "#1e1e1e", paper: "#ffffff" } as const;
const DARK_FILTER = "invert(93%) hue-rotate(180deg)";

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
	const drawing = useMemo(() => recipePreview(recipe, PALETTE), [recipe]);
	const pad = 4;
	return (
		<svg
			aria-hidden={label ? undefined : "true"}
			aria-label={label}
			className={className}
			data-recipe-preview={previewMode}
			filter={previewMode === "dark" ? DARK_FILTER : undefined}
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
