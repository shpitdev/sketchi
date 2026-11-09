import { Info } from "lucide-react";

import type { CommunityIconEntry } from "../../lib/community-client.js";
import type { PreviewMode } from "../preview-toggle/index.js";
import { RecipePreview } from "./recipe-preview.js";

/** One community icon. The tile copies it as Excalidraw shapes; the corner opens its details. */
export function CommunityCard({
	copied,
	icon,
	onCopy,
	onDetails,
	previewMode,
}: {
	readonly copied: boolean;
	readonly icon: CommunityIconEntry;
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
					<RecipePreview
						className="community-card__drawing"
						previewMode={previewMode}
						recipe={icon.recipe}
					/>
					<span className="icon-card__copy-cue">{copied ? "Copied" : "Copy"}</span>
				</span>
				<span className="icon-card__name">{icon.name}</span>
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
