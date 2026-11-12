import type { IconRecipe } from "@sketchi/diagram-core/icon-recipe";
import { formatCollectionLabel, type SketchiIcon } from "@sketchi/icon-catalog";
import { Check, Info } from "lucide-react";
import { memo } from "react";

import { DrawnIcon } from "../drawn-icon/index.js";
import { IconMark } from "../icon-mark/index.js";

export interface IconCardProps {
	readonly active?: boolean;
	readonly copied?: boolean;
	readonly copying?: boolean;
	/** The mark's hand-drawn version: shown instead of the SVG, and copied for Excalidraw. */
	readonly drawing?: IconRecipe;
	readonly icon: SketchiIcon;
	/** Write the name under the drawing, as its copy will. */
	readonly named?: boolean;
	readonly onCopy?: (icon: SketchiIcon) => void;
	readonly onDetails?: (icon: SketchiIcon) => void;
	readonly onToggleSelected?: (icon: SketchiIcon) => void;
	readonly previewMode?: "dark" | "light";
	readonly selected?: boolean;
}

/**
 * One result. The tile copies the SVG; the corner checkbox adds the icon to
 * the selection and is always visible, so gathering several icons never
 * depends on hover. Memoized: a page of results appended while scrolling leaves
 * the cards already on screen alone.
 */
export const IconCard = memo(function IconCard({
	active = false,
	copied = false,
	copying = false,
	drawing,
	icon,
	named = false,
	onCopy,
	onDetails,
	onToggleSelected,
	previewMode = "light",
	selected = false,
}: IconCardProps) {
	const drawnName = drawing && named ? icon.name : undefined;
	return (
		<article
			className="icon-card"
			data-active={active ? "true" : "false"}
			data-selected={selected ? "true" : "false"}
		>
			<button
				aria-label={drawing ? `Copy ${icon.name} for Excalidraw` : `Copy ${icon.name} SVG`}
				aria-describedby={`icon-meta-${icon.slug}`}
				className="icon-card__copy"
				id={`icon-result-${icon.slug}`}
				onClick={() => onCopy?.(icon)}
				type="button"
			>
				<span className="icon-card__preview" data-preview={previewMode}>
					{drawing ? (
						<DrawnIcon
							className="icon-card__drawing"
							name={drawnName}
							previewMode={previewMode}
							recipe={drawing}
						/>
					) : (
						<IconMark icon={icon} lazy surface={previewMode} />
					)}
					<span className="icon-card__copy-cue">
						{copying ? "Copying" : copied ? "Copied" : drawing ? "Copy" : "Copy SVG"}
					</span>
				</span>
				{/* Named, the tile already writes the name. */}
				{drawnName ? null : <span className="icon-card__name">{icon.name}</span>}
				<span className="icon-card__collection" id={`icon-meta-${icon.slug}`}>
					{formatCollectionLabel(icon.collection)}
				</span>
			</button>
			<label className="icon-card__check" title={selected ? "Selected" : "Select"}>
				<input
					aria-label={`Select ${icon.name}`}
					checked={selected}
					onChange={() => onToggleSelected?.(icon)}
					type="checkbox"
				/>
				<span aria-hidden="true" className="icon-card__box">
					<Check />
				</span>
			</label>
			<button
				aria-label={`View ${icon.name} details`}
				className="icon-card__details"
				onClick={() => onDetails?.(icon)}
				title="Details"
				type="button"
			>
				<Info aria-hidden="true" />
			</button>
		</article>
	);
});
