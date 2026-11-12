import type { IconRecipe } from "@sketchi/diagram-core/icon-recipe";

import type { PreviewMode } from "../preview-toggle/index.js";
import { RecipePreview } from "../recipe-preview/index.js";

/**
 * A drawing as it lands in Excalidraw: alone, or with its name written under
 * it in the same hand, in the proportions the named libraries use.
 */
export function DrawnIcon({
	className,
	label,
	name,
	previewMode,
	recipe,
}: {
	/** Sizes the drawing, or the drawing and its name together. */
	readonly className: string;
	/** Accessible name; omitted, the drawing is decorative. */
	readonly label?: string;
	/** The name to write under the drawing; omitted, the drawing stands alone. */
	readonly name?: string | undefined;
	readonly previewMode: PreviewMode;
	readonly recipe: IconRecipe;
}) {
	if (name === undefined) {
		return (
			<RecipePreview
				className={className}
				{...(label ? { label } : {})}
				previewMode={previewMode}
				recipe={recipe}
			/>
		);
	}
	return (
		<span
			aria-label={label}
			className={`drawn-icon ${className}`}
			data-preview={previewMode}
			role={label ? "img" : undefined}
		>
			<RecipePreview className="drawn-icon__drawing" previewMode={previewMode} recipe={recipe} />
			<span aria-hidden="true" className="drawn-icon__name">
				{name}
			</span>
		</span>
	);
}
