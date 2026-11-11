import type { PackExcalidrawState } from "../../lib/excalidraw-publish.js";
import { ALL_ICONS_PACK_ID, packPagePath, type PackSummary } from "../../lib/packs.js";
import type { PreviewMode } from "../preview-toggle/index.js";
import { RecipePreview } from "../recipe-preview/index.js";
import { PackActions } from "./pack-actions.js";
import { PackPublishDialog } from "./pack-publish-dialog.js";
import { usePackPublishing } from "./use-pack-publishing.js";

export function iconCount(count: number): string {
	return `${count.toLocaleString("en-US")} ${count === 1 ? "icon" : "icons"}`;
}

/** The packs, each a strip of its own drawings, its size, and its actions. */
export function PackShelf({
	excalidraw,
	packs,
	previewMode,
}: {
	readonly excalidraw?: Readonly<Record<string, PackExcalidrawState>>;
	readonly packs: readonly PackSummary[];
	readonly previewMode: PreviewMode;
}) {
	const publishing = usePackPublishing(excalidraw);
	if (!packs.length) return null;
	const publishingPack = packs.find((pack) => pack.id === publishing.publishing);
	return (
		<section aria-labelledby="pack-shelf-title" className="pack-shelf">
			<h2 className="pack-shelf__title" id="pack-shelf-title">
				Excalidraw libraries
			</h2>
			<ul className="pack-shelf__list">
				{packs.map((pack) => (
					<li
						className="pack-card"
						data-whole-catalog={pack.id === ALL_ICONS_PACK_ID ? "true" : undefined}
						key={pack.id}
					>
						<span aria-hidden="true" className="pack-card__strip" data-preview={previewMode}>
							{pack.preview.map((icon) => (
								<RecipePreview
									className="pack-card__icon"
									key={icon.slug}
									previewMode={previewMode}
									recipe={icon.recipe}
								/>
							))}
						</span>
						<span className="pack-card__head">
							<a className="pack-card__name" href={packPagePath(pack.id)} id={`pack-${pack.id}`}>
								{pack.name}
							</a>
							<span className="pack-card__count">{iconCount(pack.count)}</span>
						</span>
						<PackActions
							describedBy={`pack-${pack.id}`}
							excalidraw={publishing.states[pack.id]}
							onPublish={() => publishing.open(pack.id)}
							pack={pack}
						/>
					</li>
				))}
			</ul>
			{publishingPack ? (
				<PackPublishDialog
					onClose={publishing.close}
					onPublished={(result) => publishing.published(publishingPack.id, result)}
					pack={publishingPack}
				/>
			) : null}
		</section>
	);
}
