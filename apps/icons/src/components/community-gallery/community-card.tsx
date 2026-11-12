import { Info } from "lucide-react";

import type { CommunityIconEntry } from "../../lib/community-client.js";
import { DrawnIcon } from "../drawn-icon/index.js";
import type { PreviewMode } from "../preview-toggle/index.js";

/** One community icon. The tile copies it as Excalidraw shapes; the corner opens its details. */
export function CommunityCard({
	copied,
	icon,
	named,
	onCopy,
	onDetails,
	previewMode,
}: {
	readonly copied: boolean;
	readonly icon: CommunityIconEntry;
	/** Write the name under the drawing, as its copy will. */
	readonly named: boolean;
	readonly onCopy: (icon: CommunityIconEntry) => void;
	readonly onDetails: (icon: CommunityIconEntry) => void;
	readonly previewMode: PreviewMode;
}) {
	const metaId = `community-meta-${icon.slug.replace("/", "-")}`;
	return (
		<article className="icon-card">
			<button
				aria-describedby={metaId}
				aria-label={`Copy ${icon.name} for Excalidraw`}
				className="icon-card__copy"
				onClick={() => onCopy(icon)}
				type="button"
			>
				<span className="icon-card__preview" data-preview={previewMode}>
					<DrawnIcon
						className="community-card__drawing"
						name={named ? icon.name : undefined}
						previewMode={previewMode}
						recipe={icon.recipe}
					/>
					<span className="icon-card__copy-cue">{copied ? "Copied" : "Copy"}</span>
				</span>
				{/* Named, the tile already writes the name. */}
				{named ? null : <span className="icon-card__name">{icon.name}</span>}
				<span className="icon-card__collection community-card__slug" id={metaId}>
					{icon.slug}
				</span>
			</button>
			<button
				aria-label={`View ${icon.name} details`}
				className="icon-card__details"
				onClick={() => onDetails(icon)}
				title="Details"
				type="button"
			>
				<Info aria-hidden="true" />
			</button>
		</article>
	);
}
