import { formatCollectionLabel, type SketchiIcon } from "@sketchi/icon-catalog";
import { Check, Info } from "lucide-react";

export interface IconCardProps {
	readonly active?: boolean;
	readonly copied?: boolean;
	readonly copying?: boolean;
	readonly icon: SketchiIcon;
	readonly onCopy?: (icon: SketchiIcon) => void;
	readonly onDetails?: (icon: SketchiIcon) => void;
	readonly onToggleSelected?: (icon: SketchiIcon) => void;
	readonly previewMode?: "dark" | "light";
	readonly selected?: boolean;
}

/**
 * One result. The tile copies the SVG; the corner checkbox adds the icon to
 * the selection and is always visible, so gathering several icons never
 * depends on hover.
 */
export function IconCard({
	active = false,
	copied = false,
	copying = false,
	icon,
	onCopy,
	onDetails,
	onToggleSelected,
	previewMode = "light",
	selected = false,
}: IconCardProps) {
	return (
		<article
			className="icon-card"
			data-active={active ? "true" : "false"}
			data-selected={selected ? "true" : "false"}
		>
			<button
				aria-label={`Copy ${icon.name} SVG`}
				aria-describedby={`icon-meta-${icon.slug}`}
				className="icon-card__copy"
				id={`icon-result-${icon.slug}`}
				onClick={() => onCopy?.(icon)}
				type="button"
			>
				<span className="icon-card__preview" data-preview={previewMode}>
					<img alt="" loading="lazy" src={icon.svgPath} />
					<span className="icon-card__copy-cue">
						{copying ? "Copying" : copied ? "Copied" : "Copy SVG"}
					</span>
				</span>
				<span className="icon-card__name">{icon.name}</span>
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
}
